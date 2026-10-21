/**
 * Localhost WebSocket bridge between the plugin and the Chrome extension(s).
 *
 * The plugin is the server; each Chrome profile running the extension connects as one client.
 * This module deliberately has no Stream Deck SDK imports so it can be unit-tested in plain Node.
 */
import { EventEmitter } from "node:events";
import { WebSocket, WebSocketServer } from "ws";

import {
	BRIDGE_HOST,
	BRIDGE_PORT,
	COMMAND_TIMEOUT_MS,
	HEARTBEAT_INTERVAL_MS,
	MAX_PAYLOAD_BYTES,
	SERVER_RETRY_MS,
	isAllowedOrigin,
} from "./config";

export type Kind = "mic" | "camera";
export type DeviceState = "on" | "off" | "unknown";
export type Site = "meet" | "zoom" | "teams" | null;

/** The `state` message body sent by the extension; always describes the one meeting it would act on. */
export type MeetingState = {
	inMeeting: boolean;
	site: Site;
	mic: DeviceState;
	camera: DeviceState;
	focused: boolean;
};

/** What the keys render from: whether any extension is connected, plus the target client's meeting. */
export type BridgeStatus = {
	connected: boolean;
	inMeeting: boolean;
	site: Site;
	mic: DeviceState;
	camera: DeviceState;
};

/** Minimal logger so the bridge can take the SDK logger without importing it. */
export type BridgeLogger = {
	debug(...data: unknown[]): unknown;
	info(...data: unknown[]): unknown;
	warn(...data: unknown[]): unknown;
	error(...data: unknown[]): unknown;
};

export type BridgeOptions = {
	host?: string;
	port?: number;
	commandTimeoutMs?: number;
	heartbeatIntervalMs?: number;
	retryMs?: number;
	logger?: BridgeLogger;
};

type Client = {
	socket: WebSocket;
	clientId: string | null;
	state: MeetingState;
	/** Monotonic sequence bumped when the client enters a meeting or reports focus while in one. */
	lastActive: number;
	alive: boolean;
};

type Pending = {
	client: Client;
	resolve: (ok: boolean) => void;
	timer: NodeJS.Timeout;
};

const NO_MEETING: MeetingState = { inMeeting: false, site: null, mic: "unknown", camera: "unknown", focused: false };
const DISCONNECTED: BridgeStatus = { connected: false, inMeeting: false, site: null, mic: "unknown", camera: "unknown" };

const silentLogger: BridgeLogger = { debug() {}, info() {}, warn() {}, error() {} };

export class Bridge extends EventEmitter {
	readonly #host: string;
	readonly #port: number;
	readonly #commandTimeoutMs: number;
	readonly #heartbeatIntervalMs: number;
	readonly #retryMs: number;
	readonly #log: BridgeLogger;

	#server: WebSocketServer | null = null;
	#clients = new Map<WebSocket, Client>();
	#pending = new Map<string, Pending>();
	#heartbeat: NodeJS.Timeout | null = null;
	#retry: NodeJS.Timeout | null = null;
	#stopped = false;
	#seq = 0;
	#commandSeq = 0;
	#status: BridgeStatus = DISCONNECTED;

	constructor(options: BridgeOptions = {}) {
		super();
		this.#host = options.host ?? BRIDGE_HOST;
		this.#port = options.port ?? BRIDGE_PORT;
		this.#commandTimeoutMs = options.commandTimeoutMs ?? COMMAND_TIMEOUT_MS;
		this.#heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
		this.#retryMs = options.retryMs ?? SERVER_RETRY_MS;
		this.#log = options.logger ?? silentLogger;
	}

	/** Current status; `connected` is true when any client is connected, the rest describes the target client. */
	get status(): BridgeStatus {
		return this.#status;
	}

	/** Port the server is listening on (useful when constructed with port 0 in tests). */
	get port(): number {
		const address = this.#server?.address();
		return typeof address === "object" && address ? address.port : this.#port;
	}

	/** Number of currently connected clients. */
	get clientCount(): number {
		return this.#clients.size;
	}

	/** Starts listening; resolves once the server is up. On error it logs and retries every `retryMs`. */
	start(): Promise<void> {
		this.#stopped = false;
		return new Promise((resolve) => {
			const server = new WebSocketServer({
				host: this.#host,
				port: this.#port,
				maxPayload: MAX_PAYLOAD_BYTES,
				verifyClient: (info) => this.#verifyClient(info.origin, info.req.socket.remoteAddress),
			});
			this.#server = server;

			server.once("listening", () => {
				this.#log.info(`Bridge listening on ws://${this.#host}:${this.port}`);
				this.#startHeartbeat();
				resolve();
			});

			server.on("connection", (socket) => this.#onConnection(socket));

			server.on("error", (err: NodeJS.ErrnoException) => {
				this.#log.error(`Bridge server error (${err.code ?? "unknown"}): ${err.message}; retrying in ${this.#retryMs} ms`);
				this.#stopHeartbeat();
				server.close();
				this.#server = null;
				if (!this.#stopped) {
					this.#retry = setTimeout(() => {
						this.#retry = null;
						void this.start().then(resolve);
					}, this.#retryMs);
				}
			});
		});
	}

	/** Closes the server and every client socket. */
	async stop(): Promise<void> {
		this.#stopped = true;
		if (this.#retry) {
			clearTimeout(this.#retry);
			this.#retry = null;
		}
		this.#stopHeartbeat();
		for (const pending of this.#pending.values()) {
			clearTimeout(pending.timer);
			pending.resolve(false);
		}
		this.#pending.clear();
		for (const client of this.#clients.keys()) {
			client.terminate();
		}
		this.#clients.clear();
		const server = this.#server;
		this.#server = null;
		await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
		this.#updateStatus();
	}

	/**
	 * Sends a toggle command to the target client. Resolves `false` immediately when there is no client
	 * or no meeting, with the client's `result.ok` otherwise, or `false` after the command timeout.
	 */
	toggle(kind: Kind): Promise<boolean> {
		const target = this.#pickTarget();
		if (!target || !target.state.inMeeting) {
			this.#log.info(`toggle ${kind}: no target meeting (clients: ${this.#clients.size})`);
			return Promise.resolve(false);
		}

		const id = String(++this.#commandSeq);
		this.#log.info(`toggle ${kind}: command ${id} -> client ${describe(target)}`);

		return new Promise<boolean>((resolve) => {
			const timer = setTimeout(() => {
				this.#pending.delete(id);
				this.#log.warn(`command ${id} timed out after ${this.#commandTimeoutMs} ms`);
				resolve(false);
			}, this.#commandTimeoutMs);
			this.#pending.set(id, { client: target, resolve, timer });
			this.#send(target, { type: "command", id, action: "toggle", kind });
		});
	}

	// ---- connections -----------------------------------------------------------------------------

	#verifyClient(origin: string | undefined, remote: string | undefined): boolean {
		if (isAllowedOrigin(origin)) {
			return true;
		}
		this.#log.warn(`Rejected WebSocket connection from origin ${JSON.stringify(origin ?? null)} (${remote ?? "?"})`);
		return false;
	}

	#onConnection(socket: WebSocket): void {
		const client: Client = { socket, clientId: null, state: NO_MEETING, lastActive: 0, alive: true };
		this.#clients.set(socket, client);
		this.#log.info(`Client connected (${this.#clients.size} total)`);

		socket.on("pong", () => (client.alive = true));
		socket.on("message", (data) => this.#onMessage(client, data.toString()));
		socket.on("error", (err) => this.#log.warn(`Client ${describe(client)} socket error: ${err.message}`));
		socket.on("close", () => this.#onClose(client));

		this.#updateStatus();
	}

	#onClose(client: Client): void {
		if (this.#clients.get(client.socket) !== client) {
			return;
		}
		this.#clients.delete(client.socket);
		for (const [id, pending] of this.#pending) {
			if (pending.client === client) {
				clearTimeout(pending.timer);
				this.#pending.delete(id);
				pending.resolve(false);
			}
		}
		this.#log.info(`Client ${describe(client)} disconnected (${this.#clients.size} left)`);
		this.#updateStatus();
	}

	#onMessage(client: Client, raw: string): void {
		let msg: unknown;
		try {
			msg = JSON.parse(raw);
		} catch {
			this.#log.debug(`Ignoring malformed JSON from ${describe(client)}`);
			return;
		}
		if (!isRecord(msg) || typeof msg.type !== "string") {
			return;
		}

		switch (msg.type) {
			case "hello":
				this.#onHello(client, msg);
				break;
			case "state":
				this.#onState(client, msg);
				break;
			case "result":
				this.#onResult(client, msg);
				break;
			case "ping":
				client.alive = true;
				break;
			default:
				this.#log.debug(`Ignoring unknown message type ${JSON.stringify(msg.type)}`);
		}
	}

	#onHello(client: Client, msg: Record<string, unknown>): void {
		const clientId = typeof msg.clientId === "string" && msg.clientId ? msg.clientId : null;
		const version = typeof msg.version === "string" ? msg.version : "?";

		if (clientId) {
			for (const other of this.#clients.values()) {
				if (other !== client && other.clientId === clientId) {
					this.#log.info(`Client ${clientId} reconnected; terminating its stale socket`);
					this.#clients.delete(other.socket);
					other.socket.terminate();
				}
			}
		}

		client.clientId = clientId;
		this.#log.info(`hello from client ${clientId ?? "(no id)"} extension v${version}`);
		this.#updateStatus();
	}

	#onState(client: Client, msg: Record<string, unknown>): void {
		const next = parseState(msg);
		const enteredMeeting = next.inMeeting && !client.state.inMeeting;
		client.state = next;

		if (enteredMeeting || (next.inMeeting && next.focused)) {
			client.lastActive = ++this.#seq;
		}

		this.#log.debug(
			`state from ${describe(client)}: inMeeting=${next.inMeeting} site=${next.site} mic=${next.mic} camera=${next.camera} focused=${next.focused}`,
		);
		this.#updateStatus();
	}

	#onResult(client: Client, msg: Record<string, unknown>): void {
		const id = typeof msg.id === "string" ? msg.id : typeof msg.id === "number" ? String(msg.id) : null;
		if (id === null) {
			return;
		}
		const pending = this.#pending.get(id);
		if (!pending || pending.client !== client) {
			return;
		}
		clearTimeout(pending.timer);
		this.#pending.delete(id);
		const ok = msg.ok === true;
		if (!ok) {
			this.#log.warn(`command ${id} failed: ${typeof msg.error === "string" ? msg.error : "unknown error"}`);
		}
		pending.resolve(ok);
	}

	#send(client: Client, payload: Record<string, unknown>): void {
		if (client.socket.readyState === WebSocket.OPEN) {
			client.socket.send(JSON.stringify(payload));
		}
	}

	// ---- target selection and status --------------------------------------------------------------

	/** Prefer clients in a meeting; among those, the one most recently active. */
	#pickTarget(): Client | null {
		let best: Client | null = null;
		for (const client of this.#clients.values()) {
			if (!best) {
				best = client;
				continue;
			}
			if (client.state.inMeeting !== best.state.inMeeting) {
				if (client.state.inMeeting) best = client;
				continue;
			}
			if (client.lastActive > best.lastActive) {
				best = client;
			}
		}
		return best;
	}

	#computeStatus(): BridgeStatus {
		const target = this.#pickTarget();
		if (!target) {
			return DISCONNECTED;
		}
		const { inMeeting, site, mic, camera } = target.state;
		return inMeeting ? { connected: true, inMeeting, site, mic, camera } : { ...DISCONNECTED, connected: true };
	}

	#updateStatus(): void {
		const next = this.#computeStatus();
		if (sameStatus(next, this.#status)) {
			return;
		}
		this.#status = next;
		const target = this.#pickTarget();
		this.#log.info(
			`status: connected=${next.connected} inMeeting=${next.inMeeting} site=${next.site} mic=${next.mic} camera=${next.camera}` +
				(target ? ` target=${describe(target)}` : ""),
		);
		this.emit("change", next);
	}

	// ---- liveness ---------------------------------------------------------------------------------

	#startHeartbeat(): void {
		this.#stopHeartbeat();
		this.#heartbeat = setInterval(() => {
			for (const client of this.#clients.values()) {
				if (!client.alive) {
					this.#log.warn(`Client ${describe(client)} missed a pong; terminating`);
					client.socket.terminate();
					continue;
				}
				client.alive = false;
				client.socket.ping();
			}
		}, this.#heartbeatIntervalMs);
	}

	#stopHeartbeat(): void {
		if (this.#heartbeat) {
			clearInterval(this.#heartbeat);
			this.#heartbeat = null;
		}
	}
}

// ---- helpers --------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDevice(value: unknown): DeviceState {
	return value === "on" || value === "off" ? value : "unknown";
}

function parseSite(value: unknown): Site {
	return value === "meet" || value === "zoom" || value === "teams" ? value : null;
}

/** Validates every field of an incoming `state`; anything unexpected degrades to a safe value. */
export function parseState(msg: Record<string, unknown>): MeetingState {
	const inMeeting = msg.inMeeting === true;
	return {
		inMeeting,
		site: inMeeting ? parseSite(msg.site) : null,
		mic: inMeeting ? parseDevice(msg.mic) : "unknown",
		camera: inMeeting ? parseDevice(msg.camera) : "unknown",
		focused: msg.focused === true,
	};
}

function sameStatus(a: BridgeStatus, b: BridgeStatus): boolean {
	return a.connected === b.connected && a.inMeeting === b.inMeeting && a.site === b.site && a.mic === b.mic && a.camera === b.camera;
}

function describe(client: Client): string {
	return `${client.clientId ?? "(no id)"}${client.state.site ? `/${client.state.site}` : ""}`;
}

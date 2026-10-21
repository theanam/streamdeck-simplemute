import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { createServer } from "node:net";

import { Bridge, type BridgeStatus } from "../src/bridge";
import { PLUGIN_UUID, isAllowedOrigin } from "../src/config";

const EXT_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

type TestClient = {
	socket: WebSocket;
	received: Record<string, unknown>[];
	/** Resolves with the next message of the given type. */
	next(type: string): Promise<Record<string, unknown>>;
	send(msg: Record<string, unknown>): void;
	close(): Promise<void>;
};

let bridge: Bridge;
let clients: TestClient[] = [];

/** Connects a raw client; pass `null` as origin to send no Origin header at all. */
async function connect(origin: string | null = EXT_ORIGIN): Promise<TestClient> {
	const socket = new WebSocket(`ws://127.0.0.1:${bridge.port}`, origin ? { origin } : {});
	const received: Record<string, unknown>[] = [];
	const waiters: { type: string; resolve: (m: Record<string, unknown>) => void }[] = [];
	socket.on("message", (data) => {
		const msg = JSON.parse(data.toString());
		received.push(msg);
		const i = waiters.findIndex((w) => w.type === msg.type);
		if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
	});
	await new Promise<void>((resolve, reject) => {
		socket.once("open", resolve);
		socket.once("error", reject);
	});
	const client: TestClient = {
		socket,
		received,
		next: (type) =>
			new Promise((resolve) => {
				const found = received.find((m) => m.type === type);
				if (found) {
					received.splice(received.indexOf(found), 1);
					resolve(found);
				} else {
					waiters.push({ type, resolve });
				}
			}),
		send: (msg) => socket.send(JSON.stringify(msg)),
		close: () =>
			new Promise((resolve) => {
				socket.once("close", () => resolve());
				socket.close();
			}),
	};
	clients.push(client);
	return client;
}

async function hello(id: string, origin?: string): Promise<TestClient> {
	const c = await connect(origin);
	c.send({ type: "hello", version: "0.1.0", clientId: id });
	await waitFor(() => bridge.clientCount >= 1);
	return c;
}

function state(c: TestClient, overrides: Record<string, unknown> = {}): void {
	c.send({ type: "state", inMeeting: true, site: "meet", mic: "on", camera: "off", share: "off", focused: false, ...overrides });
}

/** Resolves when `predicate` becomes true, polling; fails after 2 s. */
async function waitFor(predicate: () => boolean, label: () => string = () => "condition"): Promise<void> {
	const until = Date.now() + 2000;
	while (!predicate()) {
		if (Date.now() > until) throw new Error(`Timed out waiting for ${label()}`);
		await new Promise((r) => setTimeout(r, 5));
	}
}

async function waitForStatus(partial: Partial<BridgeStatus>): Promise<void> {
	await waitFor(
		() => Object.entries(partial).every(([k, v]) => bridge.status[k as keyof BridgeStatus] === v),
		() => `status ${JSON.stringify(partial)}, got ${JSON.stringify(bridge.status)}`,
	);
}

/** Auto-answers commands on a client with the given ok value and records them. */
function answerCommands(c: TestClient, ok: boolean): Record<string, unknown>[] {
	const seen: Record<string, unknown>[] = [];
	c.socket.on("message", (data) => {
		const msg = JSON.parse(data.toString());
		if (msg.type === "command") {
			seen.push(msg);
			c.send({ type: "result", id: msg.id, ok });
		}
	});
	return seen;
}

beforeEach(async () => {
	bridge = new Bridge({ port: 0, commandTimeoutMs: 150, heartbeatIntervalMs: 60_000, logger: process.env.BRIDGE_DEBUG ? console : undefined });
	await bridge.start();
});

afterEach(async () => {
	for (const c of clients) c.socket.terminate();
	clients = [];
	await bridge.stop();
});

describe("isAllowedOrigin", () => {
	it("accepts chrome-extension origins only", () => {
		expect(isAllowedOrigin(EXT_ORIGIN)).toBe(true);
		expect(isAllowedOrigin("https://example.com")).toBe(false);
		expect(isAllowedOrigin("chrome-extension://short")).toBe(false);
		expect(isAllowedOrigin("chrome-extension://abcdefghijklmnopabcdefghijklmnoq")).toBe(false);
		expect(isAllowedOrigin(undefined)).toBe(false);
	});
});

describe("Bridge connections", () => {
	it("rejects a website origin", async () => {
		await expect(connect("https://evil.example")).rejects.toThrow(/401/);
		expect(bridge.clientCount).toBe(0);
	});

	it("rejects a missing origin", async () => {
		await expect(connect(null)).rejects.toThrow(/401/);
	});

	it("answers a plain HTTP probe with 426 so the extension can check reachability silently", async () => {
		const res = await fetch(`http://127.0.0.1:${bridge.port}/`);
		expect(res.status).toBe(426);
		expect(res.headers.get("connection")).toBe("close");
	});

	it("welcomes a client after hello, naming the plugin and port", async () => {
		const a = await hello("a");
		const welcome = await a.next("welcome");
		expect(welcome).toMatchObject({ type: "welcome", plugin: PLUGIN_UUID, port: bridge.port });
		expect(typeof welcome.version).toBe("string");
	});

	it("falls back to the next port when the first is taken", async () => {
		const blocker = createServer();
		await new Promise<void>((r) => blocker.listen(0, "127.0.0.1", r));
		const taken = (blocker.address() as { port: number }).port;
		const fallback = new Bridge({ ports: [taken, 0], heartbeatIntervalMs: 60_000 });
		await fallback.start();
		expect(fallback.port).not.toBe(taken);
		expect(fallback.port).toBeGreaterThan(0);
		await fallback.stop();
		await new Promise<void>((r) => blocker.close(() => r()));
	});

	it("accepts an extension origin and reports connected", async () => {
		expect(bridge.status.connected).toBe(false);
		await hello("a");
		await waitForStatus({ connected: true, inMeeting: false });
	});

	it("resets status on disconnect", async () => {
		const a = await hello("a");
		state(a);
		await waitForStatus({ connected: true, inMeeting: true, mic: "on", camera: "off", share: "off", site: "meet" });
		await a.close();
		await waitForStatus({ connected: false, inMeeting: false, mic: "unknown", camera: "unknown", share: "unknown", site: null });
	});

	it("does not emit change for identical states", async () => {
		const changes: BridgeStatus[] = [];
		bridge.on("change", (s) => changes.push(s));
		const a = await hello("a");
		await waitForStatus({ connected: true });
		state(a);
		await waitForStatus({ inMeeting: true });
		const before = changes.length;
		state(a);
		state(a, { focused: true });
		state(a);
		await new Promise((r) => setTimeout(r, 50));
		expect(changes.length).toBe(before);
		state(a, { mic: "off" });
		await waitForStatus({ mic: "off" });
		expect(changes.length).toBe(before + 1);
	});

	it("ignores malformed JSON and unknown types without dropping the client", async () => {
		const a = await hello("a");
		a.socket.send("{not json");
		a.send({ type: "whatever", foo: 1 });
		a.send({ type: "state", inMeeting: "yes", mic: 42 });
		await new Promise((r) => setTimeout(r, 30));
		expect(bridge.clientCount).toBe(1);
		expect(bridge.status).toMatchObject({ connected: true, inMeeting: false });
	});

	it("treats unexpected device values as unknown", async () => {
		const a = await hello("a");
		state(a, { mic: "muted", camera: 1, site: "skype" });
		await waitForStatus({ inMeeting: true, mic: "unknown", camera: "unknown", site: null });
	});
});

describe("Bridge.toggle", () => {
	it("returns false with no client", async () => {
		await expect(bridge.toggle("mic")).resolves.toBe(false);
	});

	it("returns false with a client but no meeting", async () => {
		const a = await hello("a");
		const seen = answerCommands(a, true);
		await waitForStatus({ connected: true });
		await expect(bridge.toggle("mic")).resolves.toBe(false);
		expect(seen).toHaveLength(0);
	});

	it("returns true when the client answers ok", async () => {
		const a = await hello("a");
		const seen = answerCommands(a, true);
		state(a);
		await waitForStatus({ inMeeting: true });
		await expect(bridge.toggle("camera")).resolves.toBe(true);
		expect(seen).toHaveLength(1);
		expect(seen[0]).toMatchObject({ type: "command", action: "toggle", kind: "camera" });
		expect(typeof seen[0].id).toBe("string");
	});

	it("sends share toggles and leave commands", async () => {
		const a = await hello("a");
		const seen = answerCommands(a, true);
		state(a, { share: "on" });
		await waitForStatus({ inMeeting: true, share: "on" });
		await expect(bridge.toggle("share")).resolves.toBe(true);
		await expect(bridge.leave()).resolves.toBe(true);
		expect(seen.map((m) => [m.action, m.kind])).toEqual([
			["toggle", "share"],
			["leave", "leave"],
		]);
	});

	it("returns false from leave when there is no meeting", async () => {
		await hello("a");
		await waitForStatus({ connected: true });
		await expect(bridge.leave()).resolves.toBe(false);
	});

	it("returns false when the client answers ok: false", async () => {
		const a = await hello("a");
		answerCommands(a, false);
		state(a);
		await waitForStatus({ inMeeting: true });
		await expect(bridge.toggle("mic")).resolves.toBe(false);
	});

	it("returns false after the timeout when the client never answers", async () => {
		const a = await hello("a");
		state(a);
		await waitForStatus({ inMeeting: true });
		const started = Date.now();
		await expect(bridge.toggle("mic")).resolves.toBe(false);
		expect(Date.now() - started).toBeGreaterThanOrEqual(140);
	});

	it("returns false when the target disconnects mid-command", async () => {
		const a = await hello("a");
		state(a);
		await waitForStatus({ inMeeting: true });
		const p = bridge.toggle("mic");
		await a.next("command");
		a.socket.terminate();
		await expect(p).resolves.toBe(false);
	});
});

describe("Bridge with multiple profiles", () => {
	it("keeps both clients connected", async () => {
		await hello("work");
		await hello("personal");
		await waitFor(() => bridge.clientCount === 2);
		await waitForStatus({ connected: true, inMeeting: false });
	});

	it("follows the client that is in a meeting", async () => {
		const work = await hello("work");
		const personal = await hello("personal");
		await waitFor(() => bridge.clientCount === 2);
		state(personal, { mic: "off", camera: "on", site: "zoom" });
		await waitForStatus({ inMeeting: true, site: "zoom", mic: "off", camera: "on" });
		personal.send({ type: "state", inMeeting: false });
		state(work, { mic: "on", camera: "on", site: "meet" });
		await waitForStatus({ inMeeting: true, site: "meet", mic: "on", camera: "on" });
	});

	it("moves the target to the client that reports focus when both are in meetings", async () => {
		const work = await hello("work");
		const personal = await hello("personal");
		await waitFor(() => bridge.clientCount === 2);
		state(work, { site: "meet", mic: "on" });
		await waitForStatus({ site: "meet" });
		state(personal, { site: "zoom", mic: "off" });
		await waitForStatus({ site: "zoom", mic: "off" });
		state(work, { site: "meet", mic: "on", focused: true });
		await waitForStatus({ site: "meet", mic: "on" });
		state(personal, { site: "zoom", mic: "off", focused: true });
		await waitForStatus({ site: "zoom", mic: "off" });
	});

	it("sends commands to the target only", async () => {
		const work = await hello("work");
		const personal = await hello("personal");
		await waitFor(() => bridge.clientCount === 2);
		const workSeen = answerCommands(work, true);
		const personalSeen = answerCommands(personal, true);
		state(work, { site: "meet" });
		await waitForStatus({ site: "meet" });
		state(personal, { site: "zoom" });
		await waitForStatus({ site: "zoom" });
		state(work, { site: "meet", focused: true });
		await waitForStatus({ site: "meet" });
		await expect(bridge.toggle("mic")).resolves.toBe(true);
		expect(workSeen).toHaveLength(1);
		expect(personalSeen).toHaveLength(0);
	});

	it("falls back to the other client when the target closes", async () => {
		const work = await hello("work");
		const personal = await hello("personal");
		await waitFor(() => bridge.clientCount === 2);
		state(work, { site: "meet", mic: "on" });
		await waitForStatus({ site: "meet" });
		state(personal, { site: "zoom", mic: "off" });
		await waitForStatus({ site: "zoom" });
		await personal.close();
		await waitForStatus({ connected: true, inMeeting: true, site: "meet", mic: "on" });
	});

	it("replaces the old socket when the same clientId says hello again", async () => {
		const old = await hello("work");
		await waitFor(() => bridge.clientCount === 1);
		const closed = new Promise<void>((resolve) => old.socket.once("close", () => resolve()));
		const fresh = await hello("work");
		await closed;
		await waitFor(() => bridge.clientCount === 1);
		state(fresh, { site: "teams" });
		await waitForStatus({ inMeeting: true, site: "teams" });
	});
});

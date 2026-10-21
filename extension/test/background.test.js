// @vitest-environment node
// Integration test: runs the real background.js against the real plugin bridge, with `chrome` mocked.
// Each worker runs in its own vm context with tracked timers and sockets, so teardown really stops it.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { Agent, fetch as undiciFetch } from "undici";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket as WsClient } from "ws";

import { createServer } from "node:http";
import { WebSocketServer } from "ws";

import { Bridge } from "../../plugin/src/bridge";

const EXT_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const backgroundSrc = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "background.js"), "utf8");

/** Builds a `chrome` mock that records listeners so tests can fire events. */
function mockChrome() {
	const listeners = {};
	const on = (name) => ({ addListener: (fn) => ((listeners[name] ??= []).push(fn)) });
	const fire = (name, ...args) =>
		(listeners[name] || []).map((fn) => {
			// Supply a sendResponse callback like Chrome does and remember what it was given.
			const sendResponse = (r) => (api.lastResponse = r);
			return fn(...args, sendResponse);
		});
	const storage = {};
	const api = { lastResponse: undefined };
	const chrome = {
		runtime: {
			id: "abcdefghijklmnopabcdefghijklmnop",
			getManifest: () => ({ version: "0.1.0", content_scripts: [] }),
			onMessage: on("onMessage"),
			onStartup: on("onStartup"),
			onInstalled: on("onInstalled"),
		},
		storage: {
			local: {
				get: async (key) => (key in storage ? { [key]: storage[key] } : {}),
				set: async (obj) => Object.assign(storage, obj),
			},
		},
		action: {
			setBadgeText: vi.fn(async () => {}),
			setBadgeBackgroundColor: vi.fn(async () => {}),
			setTitle: vi.fn(async () => {}),
		},
		tabs: {
			onActivated: on("onActivated"),
			onRemoved: on("onRemoved"),
			onUpdated: on("onUpdated"),
			query: vi.fn(async () => []),
			sendMessage: vi.fn(async () => ({ ok: true })),
		},
		windows: {
			WINDOW_ID_NONE: -1,
			onFocusChanged: on("onFocusChanged"),
		},
		alarms: {
			create: vi.fn(),
			onAlarm: on("onAlarm"),
		},
		scripting: { executeScript: vi.fn(async () => {}) },
	};
	Object.assign(api, { chrome, fire, storage });
	return api;
}

/**
 * Runs background.js in an isolated context. Timers and sockets it creates are tracked so
 * `teardown()` stops the worker for good; `outgoing` holds every frame it sent to the plugin.
 */
function loadWorker(chrome, ports) {
	// The real extensions in the user's Chrome profiles poll 51234 and would connect to a test bridge
	// on that port, so each test runs on random free ports, patched into the worker source.
	const list = Array.isArray(ports) ? ports : [ports];
	const src = backgroundSrc.replace("const PORTS = [51234, 51235, 51236, 51237];", `const PORTS = [${list.join(", ")}];`);
	if (src === backgroundSrc) throw new Error("could not patch PORTS in background.js");
	const timers = new Set();
	const sockets = [];
	const outgoing = [];
	let dead = false;

	const ctx = {
		chrome,
		console,
		crypto,
		// After teardown a probe in flight must not resurrect the worker, so dead workers cannot fetch...
		// Each probe also gets a fresh connection: Node's fetch would otherwise reuse a keep-alive socket
		// that the previous test's bridge closed and fail with ECONNRESET (Chrome retries that case itself).
		fetch: (url, init) => {
			if (dead) return Promise.reject(new Error("worker torn down"));
			// undici's own fetch is used because a dispatcher must match the fetch implementation's version.
			const agent = new Agent();
			return undiciFetch(url, { ...init, dispatcher: agent }).finally(() => agent.close());
		},
		AbortSignal,
		self: { addEventListener: () => {} },
		// Chrome sets the Origin header itself; emulate that on the ws client the worker constructs.
		// ...nor open sockets.
		WebSocket: class extends WsClient {
			constructor(url) {
				if (dead) throw new Error("worker torn down");
				super(url, { origin: EXT_ORIGIN });
				sockets.push(this);
			}
			send(data) {
				outgoing.push(JSON.parse(data));
				super.send(data);
			}
		},
		setTimeout: (fn, ms) => {
			if (dead) return 0;
			const h = setTimeout(() => {
				timers.delete(h);
				if (!dead) fn();
			}, ms);
			timers.add(h);
			return h;
		},
		clearTimeout: (h) => {
			clearTimeout(h);
			timers.delete(h);
		},
		setInterval: (fn, ms) => {
			if (dead) return 0;
			const h = setInterval(() => {
				if (!dead) fn();
			}, ms);
			timers.add(h);
			return h;
		},
		clearInterval: (h) => {
			clearInterval(h);
			timers.delete(h);
		},
	};
	vm.createContext(ctx);
	vm.runInContext(src, ctx, { filename: "background.js" });

	return {
		sockets,
		outgoing,
		states: () => outgoing.filter((m) => m.type === "state"),
		teardown() {
			dead = true;
			for (const h of timers) {
				clearTimeout(h);
				clearInterval(h);
			}
			timers.clear();
			for (const s of sockets) s.terminate();
		},
	};
}

async function waitFor(predicate, label = "condition", timeoutMs = 3000) {
	const until = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > until) throw new Error(`Timed out waiting for ${label}`);
		await new Promise((r) => setTimeout(r, 5));
	}
}

let bridge = null;
let mock;
let worker = null;

let port = 0;

/** Starts the bridge on a random free port the first time, then reuses that port for restarts. */
async function startBridge() {
	bridge = new Bridge({ port, commandTimeoutMs: 500 });
	await bridge.start();
	port = bridge.port;
}

beforeEach(() => {
	vi.spyOn(console, "debug").mockImplementation(() => {});
	mock = mockChrome();
	port = 0;
});

afterEach(async () => {
	worker?.teardown();
	worker = null;
	if (bridge) await bridge.stop();
	bridge = null;
	vi.restoreAllMocks();
});

function contentState(tabId, frameId, state) {
	mock.fire("onMessage", { type: "sdmc:state", ...state }, { tab: { id: tabId }, frameId });
}

describe("background service worker", () => {
	beforeEach(async () => {
		await startBridge();
		worker = loadWorker(mock.chrome, port);
		await waitFor(() => bridge.clientCount === 1, "worker to connect");
		await waitFor(() => bridge.status.connected, "bridge to see the client");
		await waitFor(() => worker.outgoing.some((m) => m.type === "hello"), "hello to be sent");
	});

	it("answers the popup's status request", async () => {
		contentState(3, 0, { site: "zoom", inMeeting: true, mic: "off", camera: "on", share: "off" });
		await waitFor(() => bridge.status.inMeeting);
		mock.fire("onMessage", { type: "sdmc:status" }, { id: "popup" });
		expect(mock.lastResponse).toMatchObject({ connected: true, port, state: { inMeeting: true, site: "zoom", mic: "off" } });
		expect(mock.lastResponse.ports).toEqual([port]);
	});

	it("says hello with a persisted clientId and clears the badge", async () => {
		expect(typeof mock.storage.clientId).toBe("string");
		expect(mock.storage.clientId).toMatch(/^[0-9a-f-]{36}$/);
		expect(mock.chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: "" });
		expect(bridge.status).toMatchObject({ connected: true, inMeeting: false });
	});

	it("relays meeting state and routes commands to the meeting frame", async () => {
		contentState(7, 0, { site: "meet", inMeeting: true, mic: "on", camera: "off" });
		await waitFor(() => bridge.status.inMeeting, "state to reach the bridge");
		expect(bridge.status).toMatchObject({ site: "meet", mic: "on", camera: "off" });

		await expect(bridge.toggle("camera")).resolves.toBe(true);
		expect(mock.chrome.tabs.sendMessage).toHaveBeenCalledWith(7, { type: "sdmc:command", action: "toggle", kind: "camera" }, { frameId: 0 });
	});

	it("forwards share state and leave commands", async () => {
		contentState(8, 0, { site: "meet", inMeeting: true, mic: "on", camera: "on", share: "on" });
		await waitFor(() => bridge.status.share === "on", "share state");
		await expect(bridge.leave()).resolves.toBe(true);
		expect(mock.chrome.tabs.sendMessage).toHaveBeenLastCalledWith(8, { type: "sdmc:command", action: "leave", kind: "leave" }, { frameId: 0 });
	});

	it("reports ok: false when the content script is unreachable", async () => {
		contentState(7, 0, { site: "meet", inMeeting: true, mic: "on", camera: "on" });
		await waitFor(() => bridge.status.inMeeting);
		mock.chrome.tabs.sendMessage.mockRejectedValueOnce(new Error("Receiving end does not exist"));
		await expect(bridge.toggle("mic")).resolves.toBe(false);
	});

	it("targets the most recently focused or joined meeting", async () => {
		contentState(1, 0, { site: "meet", inMeeting: true, mic: "on", camera: "on" });
		await waitFor(() => bridge.status.site === "meet");
		await new Promise((r) => setTimeout(r, 5));
		contentState(2, 3, { site: "zoom", inMeeting: true, mic: "off", camera: "off" });
		await waitFor(() => bridge.status.site === "zoom", "newer meeting to win");

		await new Promise((r) => setTimeout(r, 5));
		mock.fire("onActivated", { tabId: 1, windowId: 10 });
		await waitFor(() => bridge.status.site === "meet", "focused tab to win");

		await expect(bridge.toggle("mic")).resolves.toBe(true);
		expect(mock.chrome.tabs.sendMessage).toHaveBeenLastCalledWith(1, expect.objectContaining({ kind: "mic" }), { frameId: 0 });

		mock.fire("onRemoved", 1);
		await waitFor(() => bridge.status.site === "zoom", "fallback after tab close");
		await expect(bridge.toggle("mic")).resolves.toBe(true);
		expect(mock.chrome.tabs.sendMessage).toHaveBeenLastCalledWith(2, expect.anything(), { frameId: 3 });
	});

	it("drops a frame when its tab navigates away", async () => {
		contentState(4, 0, { site: "teams", inMeeting: true, mic: "on", camera: "on" });
		await waitFor(() => bridge.status.inMeeting);
		mock.fire("onUpdated", 4, { status: "loading" });
		await waitFor(() => !bridge.status.inMeeting, "meeting to disappear");
	});

	it("tracks window focus so the plugin can pick between profiles", async () => {
		mock.fire("onActivated", { tabId: 9, windowId: 1 });
		contentState(9, 0, { site: "meet", inMeeting: true, mic: "on", camera: "on" });
		await waitFor(() => worker.states().some((s) => s.inMeeting && s.focused === true), "focused state");

		mock.fire("onFocusChanged", mock.chrome.windows.WINDOW_ID_NONE);
		await waitFor(() => worker.states().at(-1)?.focused === false, "unfocused state");

		mock.chrome.tabs.query.mockResolvedValueOnce([{ id: 9 }]);
		await Promise.all(mock.fire("onFocusChanged", 1));
		await waitFor(() => worker.states().at(-1)?.focused === true, "refocused state");
	});

	it("only sends a state when it changed", async () => {
		contentState(5, 0, { site: "meet", inMeeting: true, mic: "on", camera: "on" });
		await waitFor(() => bridge.status.inMeeting);
		const before = worker.states().length;
		contentState(5, 0, { site: "meet", inMeeting: true, mic: "on", camera: "on" });
		contentState(5, 0, { site: "meet", inMeeting: true, mic: "on", camera: "on" });
		await new Promise((r) => setTimeout(r, 30));
		expect(worker.states().length).toBe(before);
	});

	it("survives a plugin restart without opening sockets while the port is closed", async () => {
		const opened = worker.sockets.length;
		await bridge.stop();
		bridge = null;
		await new Promise((r) => setTimeout(r, 2500));
		expect(worker.sockets.length).toBe(opened); // probes only, no WebSocket attempts
		expect(mock.chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: "!" });

		await startBridge();
		await waitFor(() => bridge.clientCount === 1, "worker to reconnect", 12_000);
		expect(worker.sockets.length).toBe(opened + 1);
	}, 20_000);
});

describe("background service worker with the plugin down", () => {
	it("probes silently and never opens a WebSocket until the port answers", async () => {
		// Reserve a port by binding and releasing it, so the worker probes a closed port.
		await startBridge();
		await bridge.stop();
		bridge = null;
		worker = loadWorker(mock.chrome, port);
		await new Promise((r) => setTimeout(r, 2500));
		expect(worker.sockets.length).toBe(0);

		await startBridge();
		await waitFor(() => bridge.clientCount === 1, "worker to connect once the port answers", 12_000);
		expect(worker.sockets.length).toBe(1);
	}, 20_000);
});

describe("background service worker port discovery", () => {
	it("skips a port held by something else and connects on the fallback port", async () => {
		// A plain HTTP server answers the probe but is not a WebSocket server.
		const stranger = createServer((req, res) => res.end("hi"));
		await new Promise((r) => stranger.listen(0, "127.0.0.1", r));
		const strangerPort = stranger.address().port;
		await startBridge();
		worker = loadWorker(mock.chrome, [strangerPort, port]);
		await waitFor(() => bridge.clientCount === 1, "worker to reach the fallback port", 12_000);
		await waitFor(() => worker.outgoing.some((m) => m.type === "state"), "state after welcome");
		mock.fire("onMessage", { type: "sdmc:status" }, { id: "popup" });
		expect(mock.lastResponse).toMatchObject({ connected: true, port });
		await new Promise((r) => stranger.close(r));
	}, 20_000);

	it("skips a WebSocket server that never says welcome", async () => {
		const impostor = new WebSocketServer({ host: "127.0.0.1", port: 0 });
		await new Promise((r) => impostor.once("listening", r));
		const impostorPort = impostor.address().port;
		await startBridge();
		worker = loadWorker(mock.chrome, [impostorPort, port]);
		await waitFor(() => bridge.clientCount === 1, "worker to move past the impostor", 12_000);
		expect(worker.sockets.length).toBe(2); // one to the impostor, one to the real plugin
		await new Promise((r) => impostor.close(r));
	}, 20_000);
});

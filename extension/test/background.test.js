// @vitest-environment node
// Integration test: runs the real background.js against the real plugin bridge, with `chrome` mocked.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket as WsClient } from "ws";

import { Bridge } from "../../plugin/src/bridge";

const EXT_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const backgroundSrc = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "background.js"), "utf8");

/** Builds a `chrome` mock that records listeners so tests can fire events. */
function mockChrome() {
	const listeners = {};
	const on = (name) => ({ addListener: (fn) => ((listeners[name] ??= []).push(fn)) });
	const fire = (name, ...args) => (listeners[name] || []).map((fn) => fn(...args));
	const storage = {};
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
	return { chrome, fire, storage };
}

async function waitFor(predicate, label = "condition") {
	const until = Date.now() + 3000;
	while (!predicate()) {
		if (Date.now() > until) throw new Error(`Timed out waiting for ${label}`);
		await new Promise((r) => setTimeout(r, 5));
	}
}

let bridge;
let mock;
/** Every frame the worker sent to the plugin, parsed. */
let outgoing;

beforeEach(async () => {
	vi.spyOn(console, "debug").mockImplementation(() => {});
	bridge = new Bridge({ port: 51234, commandTimeoutMs: 500, logger: undefined });
	await bridge.start();
	mock = mockChrome();
	globalThis.chrome = mock.chrome;
	// Chrome sets the Origin header itself; emulate that on the ws client the worker will construct,
	// and record what the worker sends so tests can assert on `focused`.
	outgoing = [];
	globalThis.WebSocket = class extends WsClient {
		constructor(url) {
			super(url, { origin: EXT_ORIGIN });
		}
		send(data) {
			outgoing.push(JSON.parse(data));
			super.send(data);
		}
	};
	new Function(backgroundSrc)();
	await waitFor(() => bridge.clientCount === 1, "worker to connect");
	await waitFor(() => bridge.status.connected, "bridge to see the client");
});

afterEach(async () => {
	await bridge.stop();
	vi.restoreAllMocks();
});

function contentState(tabId, frameId, state) {
	mock.fire("onMessage", { type: "sdmc:state", ...state }, { tab: { id: tabId }, frameId });
}

describe("background service worker", () => {
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
		const states = () => outgoing.filter((m) => m.type === "state");
		mock.fire("onActivated", { tabId: 9, windowId: 1 });
		contentState(9, 0, { site: "meet", inMeeting: true, mic: "on", camera: "on" });
		await waitFor(() => states().some((s) => s.inMeeting && s.focused === true), "focused state");

		mock.fire("onFocusChanged", mock.chrome.windows.WINDOW_ID_NONE);
		await waitFor(() => states().at(-1)?.focused === false, "unfocused state");

		mock.chrome.tabs.query.mockResolvedValueOnce([{ id: 9 }]);
		await Promise.all(mock.fire("onFocusChanged", 1));
		await waitFor(() => states().at(-1)?.focused === true, "refocused state");
	});

	it("only sends a state when it changed", async () => {
		contentState(5, 0, { site: "meet", inMeeting: true, mic: "on", camera: "on" });
		await waitFor(() => bridge.status.inMeeting);
		const before = outgoing.filter((m) => m.type === "state").length;
		contentState(5, 0, { site: "meet", inMeeting: true, mic: "on", camera: "on" });
		contentState(5, 0, { site: "meet", inMeeting: true, mic: "on", camera: "on" });
		await new Promise((r) => setTimeout(r, 30));
		expect(outgoing.filter((m) => m.type === "state").length).toBe(before);
	});
});

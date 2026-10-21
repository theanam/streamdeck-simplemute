// SimpleMute service worker: keeps a WebSocket to the Stream Deck plugin, tracks which meeting
// tab/frame a key press should act on, and relays commands to that frame's content script.

/** Port of the plugin's localhost WebSocket server. Mirrored in `plugin/src/config.ts` (BRIDGE_PORT); change both together. */
const PORT = 51234;
const URL_ = `ws://127.0.0.1:${PORT}`;

const VERSION = chrome.runtime.getManifest().version;
const PING_INTERVAL_MS = 20_000; // keep-alive to the plugin; also keeps this worker alive (Chrome 116+)
const STALE_FRAME_MS = 10_000; // drop frames not heard from in this long
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 10_000; // retries are silent (see pluginReachable), so they can be frequent
const PROBE_URL = `http://127.0.0.1:${PORT}/`;
const PROBE_TIMEOUT_MS = 1_500;
/** If the probe has never succeeded, try a raw WebSocket every Nth attempt in case the probe is what is broken. */
const RAW_FALLBACK_EVERY = 12;
const LOG = "[SimpleMute]";

// ---- error policy ---------------------------------------------------------------------------------
// Nothing in this worker is worth surfacing as an extension error. Every failure is transient
// (plugin not running, tab closed mid-command, worker restarted) and is retried by the next
// alarm, heartbeat or reconnect. Log at debug level and carry on.

self.addEventListener("error", (event) => {
	event.preventDefault();
	console.debug(LOG, "ignored error:", event.message || event.error);
});

self.addEventListener("unhandledrejection", (event) => {
	event.preventDefault();
	console.debug(LOG, "ignored rejection:", event.reason && event.reason.message ? event.reason.message : event.reason);
});

/** Runs `fn` and swallows anything it throws or rejects with, returning `fallback` instead. */
async function quiet(fn, fallback = undefined) {
	try {
		return await fn();
	} catch (err) {
		console.debug(LOG, "ignored:", err && err.message ? err.message : err);
		return fallback;
	}
}

let socket = null;
let connecting = false;
let failedAttempts = 0;
let probeEverSucceeded = false;
let probeFailures = 0;
let backoffMs = BACKOFF_MIN_MS;
let reconnectTimer = null;
let pingTimer = null;
let clientId = null;
let lastSentState = null;

/** Frame registry keyed by "tabId:frameId": site, inMeeting, mic, camera, share, seenAt, joinedAt. */
const frames = new Map();
/** Last time each tab was focused, by tabId. */
const tabFocus = new Map();
let focusedTabId = null;
let windowFocused = true;

// ---- client id ----------------------------------------------------------------------------------

async function getClientId() {
	if (clientId) return clientId;
	const stored = await quiet(() => chrome.storage.local.get("clientId"), {});
	if (stored && typeof stored.clientId === "string" && stored.clientId) {
		clientId = stored.clientId;
	} else {
		clientId = crypto.randomUUID();
		await quiet(() => chrome.storage.local.set({ clientId }));
	}
	return clientId;
}

// ---- connection ---------------------------------------------------------------------------------

/**
 * Checks whether anything answers on the plugin's port before opening a WebSocket.
 *
 * Chrome logs "WebSocket connection to ... failed: net::ERR_CONNECTION_REFUSED" as an extension
 * error whenever a socket is opened against a closed port, and no handler can suppress it. A
 * `fetch` to the same port fails with a plain rejected promise instead, so probing first keeps the
 * error console clean while the Stream Deck app is closed. The plugin's server answers the probe
 * with "426 Upgrade Required"; in no-cors mode any answer at all resolves the promise.
 */
async function pluginReachable() {
	try {
		await fetch(PROBE_URL, { method: "GET", mode: "no-cors", cache: "no-store", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
		probeEverSucceeded = true;
		probeFailures = 0;
		return true;
	} catch {
		probeFailures += 1;
		return false;
	}
}

/** Opens the WebSocket if it is not already open or opening. Safe to call often. */
function connect() {
	if (socket || connecting) return;
	connecting = true;
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
	attemptConnect().catch((err) => {
		console.debug(LOG, "connect attempt failed:", err && err.message ? err.message : err);
		connecting = false;
		scheduleReconnect();
	});
}

async function attemptConnect() {
	const reachable = await pluginReachable();
	const rawFallback = !reachable && !probeEverSucceeded && probeFailures % RAW_FALLBACK_EVERY === 0;
	if (!reachable && !rawFallback) {
		connecting = false;
		if (++failedAttempts === 1) console.debug(LOG, "plugin not reachable; retrying quietly");
		scheduleReconnect();
		return;
	}
	openSocket();
}

/** Creates the WebSocket and wires its handlers. Only called once the port answered a probe. */
function openSocket() {
	let ws;
	try {
		ws = new WebSocket(URL_);
	} catch (err) {
		connecting = false;
		console.debug(LOG, "WebSocket constructor failed", err);
		scheduleReconnect();
		return;
	}

	ws.onopen = () =>
		quiet(async () => {
			socket = ws;
			connecting = false;
			backoffMs = BACKOFF_MIN_MS;
			failedAttempts = 0;
			lastSentState = null;
			console.debug(LOG, "connected to plugin");
			setBadge(true);
			send({ type: "hello", version: VERSION, clientId: await getClientId() });
			pushState();
			startPing();
		});

	ws.onmessage = (event) => {
		let msg;
		try {
			msg = JSON.parse(event.data);
		} catch {
			return;
		}
		if (msg && msg.type === "command") {
			void quiet(() => handleCommand(msg));
		}
	};

	ws.onerror = () => {
		// Chrome logs the network failure itself; onclose follows and schedules the retry.
	};

	ws.onclose = () => {
		const wasOpen = socket === ws;
		if (wasOpen) socket = null;
		connecting = false;
		stopPing();
		setBadge(false);
		if (wasOpen) {
			console.debug(LOG, "disconnected from plugin");
		} else if (++failedAttempts === 1) {
			console.debug(LOG, "plugin not reachable; retrying quietly with backoff");
		}
		scheduleReconnect();
	};
}

function scheduleReconnect() {
	if (reconnectTimer) return;
	reconnectTimer = setTimeout(() => {
		reconnectTimer = null;
		connect();
	}, backoffMs);
	backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
}

function send(msg) {
	if (!socket || socket.readyState !== WebSocket.OPEN) return false;
	try {
		socket.send(JSON.stringify(msg));
		return true;
	} catch (err) {
		console.debug(LOG, "send failed:", err && err.message ? err.message : err);
		return false;
	}
}

function startPing() {
	stopPing();
	pingTimer = setInterval(() => send({ type: "ping" }), PING_INTERVAL_MS);
}

function stopPing() {
	if (pingTimer) {
		clearInterval(pingTimer);
		pingTimer = null;
	}
}

function setBadge(connected) {
	void quiet(() => chrome.action.setBadgeText({ text: connected ? "" : "!" }));
	void quiet(() => chrome.action.setBadgeBackgroundColor({ color: "#dc2626" }));
	void quiet(() => chrome.action.setTitle({ title: connected ? "Connected to Stream Deck" : "Stream Deck plugin not reachable" }));
}

// ---- frame registry and target selection -------------------------------------------------------

function frameKey(tabId, frameId) {
	return `${tabId}:${frameId}`;
}

function pruneStale() {
	const cutoff = Date.now() - STALE_FRAME_MS;
	for (const [key, frame] of frames) {
		if (frame.seenAt < cutoff) frames.delete(key);
	}
}

/** The one meeting frame a command would act on: in a meeting, and focused or joined most recently. */
function pickTarget() {
	pruneStale();
	let best = null;
	let bestScore = -1;
	for (const frame of frames.values()) {
		if (!frame.inMeeting) continue;
		const score = Math.max(tabFocus.get(frame.tabId) ?? 0, frame.joinedAt ?? 0);
		if (score > bestScore) {
			best = frame;
			bestScore = score;
		}
	}
	return best;
}

function currentState() {
	const target = pickTarget();
	if (!target) {
		return { type: "state", inMeeting: false, site: null, mic: "unknown", camera: "unknown", share: "unknown", focused: false };
	}
	return {
		type: "state",
		inMeeting: true,
		site: target.site,
		mic: target.mic,
		camera: target.camera,
		share: target.share,
		focused: windowFocused && focusedTabId === target.tabId,
	};
}

/** Sends the current state to the plugin, only when it differs from the last one sent. */
function pushState() {
	const state = currentState();
	const encoded = JSON.stringify(state);
	if (encoded === lastSentState) return;
	if (send(state)) lastSentState = encoded;
}

function recordFocus(tabId) {
	if (tabId === undefined || tabId === null || tabId < 0) return;
	tabFocus.set(tabId, Date.now());
	focusedTabId = tabId;
}

// ---- commands -----------------------------------------------------------------------------------

async function handleCommand(msg) {
	let target = null;
	try {
		target = pickTarget();
	} catch (err) {
		console.debug(LOG, "pickTarget failed:", err);
	}
	if (!target) {
		send({ type: "result", id: msg.id, ok: false, error: "no meeting" });
		return;
	}
	try {
		const response = await chrome.tabs.sendMessage(
			target.tabId,
			{ type: "sdmc:command", action: msg.action, kind: msg.kind },
			{ frameId: target.frameId },
		);
		if (response && response.ok) {
			send({ type: "result", id: msg.id, ok: true });
		} else {
			send({ type: "result", id: msg.id, ok: false, error: (response && response.error) || "content script refused" });
		}
	} catch (err) {
		send({ type: "result", id: msg.id, ok: false, error: `content script unreachable: ${err && err.message ? err.message : err}` });
	}
}

// ---- content script messages --------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender) => {
	try {
		onContentState(msg, sender);
	} catch (err) {
		console.debug(LOG, "state message failed:", err);
	}
	// Returning nothing closes the channel; the content script does not wait for a reply.
});

function onContentState(msg, sender) {
	if (!msg || msg.type !== "sdmc:state" || !sender || !sender.tab || typeof sender.tab.id !== "number") return;
	const tabId = sender.tab.id;
	const frameId = sender.frameId ?? 0;
	const key = frameKey(tabId, frameId);
	const now = Date.now();
	const previous = frames.get(key);
	const inMeeting = msg.inMeeting === true;
	frames.set(key, {
		tabId,
		frameId,
		site: msg.site ?? null,
		inMeeting,
		mic: normalizeDevice(msg.mic),
		camera: normalizeDevice(msg.camera),
		share: normalizeDevice(msg.share),
		seenAt: now,
		joinedAt: inMeeting ? (previous && previous.inMeeting ? previous.joinedAt : now) : null,
	});
	connect();
	pushState();
}

function normalizeDevice(value) {
	return value === "on" || value === "off" ? value : "unknown";
}

// ---- focus tracking -----------------------------------------------------------------------------

chrome.tabs.onActivated.addListener((info) =>
	quiet(() => {
		windowFocused = true;
		recordFocus(info && info.tabId);
		pushState();
	}),
);

chrome.windows.onFocusChanged.addListener((windowId) =>
	quiet(async () => {
		if (windowId === chrome.windows.WINDOW_ID_NONE) {
			// Focus went to another app or another Chrome profile.
			windowFocused = false;
			focusedTabId = null;
			pushState();
			return;
		}
		windowFocused = true;
		const tabs = await quiet(() => chrome.tabs.query({ active: true, windowId }), []);
		if (tabs && tabs[0]) recordFocus(tabs[0].id);
		pushState();
	}),
);

chrome.tabs.onRemoved.addListener((tabId) =>
	quiet(() => {
		for (const [key, frame] of frames) {
			if (frame.tabId === tabId) frames.delete(key);
		}
		tabFocus.delete(tabId);
		if (focusedTabId === tabId) focusedTabId = null;
		pushState();
	}),
);

chrome.tabs.onUpdated.addListener((tabId, changeInfo) =>
	quiet(() => {
		// A navigation kills the content script; forget its frames rather than waiting for them to go stale.
		if (!changeInfo || changeInfo.status !== "loading") return;
		for (const [key, frame] of frames) {
			if (frame.tabId === tabId) frames.delete(key);
		}
		pushState();
	}),
);

/** Seeds the focused tab after the worker (re)starts, since no onActivated fires until the user switches tabs. */
async function seedFocus() {
	const tabs = await quiet(() => chrome.tabs.query({ active: true, lastFocusedWindow: true }), []);
	if (tabs && tabs[0]) recordFocus(tabs[0].id);
}

// ---- lifecycle ----------------------------------------------------------------------------------

void quiet(() => chrome.alarms.create("sdmc-reconnect", { periodInMinutes: 0.5 }));
chrome.alarms.onAlarm.addListener((alarm) =>
	quiet(() => {
		if (!alarm || alarm.name !== "sdmc-reconnect") return;
		connect();
		pushState(); // also drops stale frames
	}),
);

chrome.runtime.onStartup.addListener(() =>
	quiet(() => {
		void seedFocus();
		connect();
	}),
);

chrome.runtime.onInstalled.addListener(() =>
	quiet(() => {
		void injectIntoOpenTabs();
		connect();
	}),
);

/** After install/update, inject the content scripts into matching tabs that are already open. */
async function injectIntoOpenTabs() {
	const scripts = chrome.runtime.getManifest().content_scripts || [];
	for (const script of scripts) {
		const tabs = await quiet(() => chrome.tabs.query({ url: script.matches }), []);
		for (const tab of tabs || []) {
			// Fails on tabs that are discarded or not yet loaded; they get the script when they load.
			await quiet(() =>
				chrome.scripting.executeScript({
					target: { tabId: tab.id, allFrames: !!script.all_frames },
					files: script.js,
				}),
			);
		}
	}
}

// Every time the worker starts (not only on install/startup), reconnect and re-check stale frames.
setInterval(() => void quiet(pushState), 3_000);
void seedFocus();
setBadge(false);
connect();

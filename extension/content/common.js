// SimpleMute content-script runtime shared by all site adapters.
// Polls the adapter for mic/camera state, reports changes to the service worker, and clicks on command.
(() => {
	if (globalThis.__sdmc) return; // already injected into this frame

	const LOG = "[SimpleMute]";
	const POLL_MS = 400;
	const HEARTBEAT_MS = 3_000;
	const POST_CLICK_POLL_MS = 150;

	const util = {
		/** aria-label of `el`, else its data-tooltip, else the first descendant's aria-label. */
		label(el) {
			if (!el) return "";
			const own = el.getAttribute("aria-label");
			if (own) return own;
			const tip = el.getAttribute("data-tooltip");
			if (tip) return tip;
			const child = el.querySelector("[aria-label]");
			return (child && child.getAttribute("aria-label")) || "";
		},
		/** Keeps elements that have layout (non-empty getClientRects). */
		visible(list) {
			return Array.from(list).filter((el) => el.getClientRects().length > 0);
		},
	};

	let adapter = null;
	let timer = null;
	let lastState = null;
	let lastSentAt = 0;

	function alive() {
		try {
			return typeof chrome !== "undefined" && !!chrome.runtime && !!chrome.runtime.id;
		} catch {
			return false;
		}
	}

	function deviceState(found) {
		if (!found) return "unknown";
		if (found.on === true) return "on";
		if (found.on === false) return "off";
		return "unknown";
	}

	function safe(fn) {
		try {
			return fn();
		} catch (err) {
			console.debug(LOG, "adapter threw", err);
			return null;
		}
	}

	function readState() {
		const mic = safe(() => adapter.mic());
		const camera = safe(() => adapter.camera());
		return {
			site: adapter.site,
			inMeeting: !!(mic || camera),
			mic: deviceState(mic),
			camera: deviceState(camera),
		};
	}

	function stop() {
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
	}

	function poll() {
		if (!alive()) {
			// The extension was reloaded or removed; this copy is orphaned.
			stop();
			return;
		}
		const state = readState();
		const encoded = JSON.stringify(state);
		const changed = encoded !== lastState;
		const now = Date.now();
		if (changed || (state.inMeeting && now - lastSentAt >= HEARTBEAT_MS)) {
			lastState = encoded;
			lastSentAt = now;
			if (changed) console.debug(LOG, "state", state);
			try {
				const p = chrome.runtime.sendMessage({ type: "sdmc:state", ...state });
				if (p && typeof p.catch === "function") p.catch(() => {});
			} catch {
				stop();
			}
		}
	}

	function onCommand(msg, sender, respond) {
		if (!msg || msg.type !== "sdmc:command" || !adapter) return false;
		if (msg.action !== "toggle") {
			respond({ ok: false, error: `unsupported action ${msg.action}` });
			return false;
		}
		const kind = msg.kind === "camera" ? "camera" : msg.kind === "mic" ? "mic" : null;
		if (!kind) {
			respond({ ok: false, error: `unsupported kind ${msg.kind}` });
			return false;
		}
		const found = safe(() => adapter[kind]());
		if (!found || !found.button) {
			respond({ ok: false, error: `${kind} control not found` });
			return false;
		}
		found.button.click();
		respond({ ok: true });
		setTimeout(poll, POST_CLICK_POLL_MS);
		return false;
	}

	function register(nextAdapter) {
		adapter = nextAdapter;
		stop();
		chrome.runtime.onMessage.addListener(onCommand);
		timer = setInterval(poll, POLL_MS);
		poll();
	}

	globalThis.__sdmc = { register, util, stop };
})();

// SimpleMute content-script runtime shared by all site adapters.
// Polls the adapter for mic/camera/share state, reports changes to the service worker, and clicks on command.
//
// Adapter interface (register it with `globalThis.__sdmc.register(adapter)`):
//   site:     "meet" | "zoom" | "teams"
//   mic():    { button, on } | null      on: true (live), false (muted), null (unreadable)
//   camera(): { button, on } | null
//   share():  { button, on } | null      optional; on: true while sharing
//   leave():  { button, confirm? } | null optional; confirm() clicks a confirmation popover if the site shows one
(() => {
	if (globalThis.__sdmc) return; // already injected into this frame

	const LOG = "[SimpleMute]";
	const POLL_MS = 400;
	const HEARTBEAT_MS = 3_000;
	const POST_CLICK_POLL_MS = 150;
	const CONFIRM_DELAY_MS = 300;

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
		const share = adapter.share ? safe(() => adapter.share()) : null;
		return {
			site: adapter.site,
			inMeeting: !!(mic || camera),
			mic: deviceState(mic),
			camera: deviceState(camera),
			share: deviceState(share),
		};
	}

	function stop() {
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
	}

	function poll() {
		try {
			pollOnce();
		} catch (err) {
			// Never let a page quirk or a dead extension context surface as an error; the next tick retries.
			console.debug(LOG, "poll failed", err);
			if (!alive()) stop();
		}
	}

	function pollOnce() {
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

	const TOGGLE_KINDS = ["mic", "camera", "share"];

	function onCommand(msg, sender, respond) {
		if (!msg || msg.type !== "sdmc:command" || !adapter) return false;
		try {
			return handleCommand(msg, respond);
		} catch (err) {
			console.debug(LOG, "command failed", err);
			try {
				respond({ ok: false, error: `content script error: ${err && err.message ? err.message : err}` });
			} catch {
				// channel already closed
			}
			return false;
		}
	}

	function handleCommand(msg, respond) {
		if (msg.action === "leave") {
			if (typeof adapter.leave !== "function") {
				respond({ ok: false, error: "leave not supported on this site" });
				return false;
			}
			const found = safe(() => adapter.leave());
			if (!found || !found.button) {
				respond({ ok: false, error: "leave control not found" });
				return false;
			}
			found.button.click();
			// Some sites ask "Leave meeting?" in a popover; give the adapter a chance to confirm.
			if (typeof found.confirm === "function") {
				setTimeout(() => safe(() => found.confirm()), CONFIRM_DELAY_MS);
			}
			respond({ ok: true });
			setTimeout(poll, POST_CLICK_POLL_MS);
			return false;
		}

		if (msg.action !== "toggle") {
			respond({ ok: false, error: `unsupported action ${msg.action}` });
			return false;
		}
		const kind = TOGGLE_KINDS.includes(msg.kind) ? msg.kind : null;
		if (!kind) {
			respond({ ok: false, error: `unsupported kind ${msg.kind}` });
			return false;
		}
		if (typeof adapter[kind] !== "function") {
			respond({ ok: false, error: `${kind} not supported on this site` });
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
		if (!alive()) return; // sandboxed or about:blank frame without extension APIs
		try {
			chrome.runtime.onMessage.addListener(onCommand);
		} catch (err) {
			console.debug(LOG, "cannot listen for commands in this frame", err);
			return;
		}
		timer = setInterval(poll, POLL_MS);
		poll();
	}

	globalThis.__sdmc = { register, util, stop };
})();

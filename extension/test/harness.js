// Test harness: runs the real content scripts inside jsdom against a mocked `chrome`.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";

const contentDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "content");

/** Installs a fake `chrome.runtime`; returns the messages sent by the content script and a way to dispatch to it. */
export function mockChrome() {
	vi.spyOn(console, "debug").mockImplementation(() => {});
	const listeners = [];
	const sent = [];
	globalThis.chrome = {
		runtime: {
			id: "test-extension-id",
			sendMessage: vi.fn((msg) => {
				sent.push(msg);
				return Promise.resolve();
			}),
			onMessage: {
				addListener: (fn) => listeners.push(fn),
			},
		},
	};
	return {
		sent,
		/** Dispatches a message the way the service worker would and returns the synchronous response. */
		dispatch(msg) {
			let response;
			for (const fn of listeners) fn(msg, { id: "test-extension-id" }, (r) => (response = r));
			return response;
		},
		/** Simulates the extension being reloaded: this copy of the script is orphaned. */
		orphan() {
			globalThis.chrome.runtime.id = undefined;
		},
	};
}

/** jsdom has no layout; treat elements inside a `hidden` ancestor (or with display:none) as invisible. */
export function stubLayout() {
	Element.prototype.getClientRects = function () {
		let el = this;
		while (el) {
			if (el.hasAttribute && (el.hasAttribute("hidden") || el.style?.display === "none")) return [];
			el = el.parentElement;
		}
		return [{ width: 10, height: 10 }];
	};
}

/** Evaluates one content-script file in the current jsdom globals, exactly as Chrome would inject it. */
export function loadFile(file) {
	const src = readFileSync(path.join(contentDir, file), "utf8");
	new Function(src)();
}

/** Evaluates common.js followed by the site adapter. */
export function loadSite(site) {
	delete globalThis.__sdmc;
	loadFile("common.js");
	loadFile(`${site}.js`);
}

export function lastState(sent) {
	const states = sent.filter((m) => m.type === "sdmc:state");
	return states[states.length - 1];
}

/** Wires a button so that clicking it flips an attribute between two values. */
export function toggleOnClick(button, attr, a, b) {
	button.addEventListener("click", () => {
		button.setAttribute(attr, button.getAttribute(attr) === a ? b : a);
	});
}

export function teardown() {
	vi.restoreAllMocks();
	globalThis.__sdmc?.stop();
	delete globalThis.__sdmc;
	document.body.innerHTML = "";
}

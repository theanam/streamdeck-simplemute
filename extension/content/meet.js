// Google Meet adapter. Works on the pre-join screen and inside the call.
//
// Mic and camera buttons carry `data-is-muted="true|false"` and an aria-label that ends with the
// keyboard shortcut, e.g. "Turn off microphone (⌘ + d)" or "Mikrofon ausschalten (Strg + d)". Matching on
// the shortcut suffix makes this work in any UI language; the device word is only a fallback.
//
// Share and leave buttons have no shortcut in their label, so they are found by the Material icon
// ligature inside the button (language-independent), with an English label as fallback.
(() => {
	const sdmc = globalThis.__sdmc;
	if (!sdmc) return;
	const { util } = sdmc;

	function findMuted(shortcutKey, fallbackWord) {
		const candidates = util.visible(document.querySelectorAll("[data-is-muted]"));
		const shortcut = new RegExp(`\\+\\s*${shortcutKey}\\)\\s*$`, "i");
		let el = candidates.find((c) => shortcut.test(util.label(c)));
		if (!el) el = candidates.find((c) => util.label(c).toLowerCase().includes(fallbackWord));
		if (!el) return null;
		const muted = el.getAttribute("data-is-muted");
		return { button: el, on: muted === "false" ? true : muted === "true" ? false : null };
	}

	/** Visible button whose Material icon text is one of `icons`, else whose label matches `labelRe`. */
	function findButton(icons, labelRe) {
		const buttons = util.visible(document.querySelectorAll("button, [role='button']"));
		const byIcon = buttons.find((b) => {
			for (const i of b.querySelectorAll("i")) {
				if (icons.includes(i.textContent.trim())) return true;
			}
			return false;
		});
		return byIcon || buttons.find((b) => labelRe.test(util.label(b))) || null;
	}

	const SHARE_START = ["present_to_all", "screen_share"];
	const SHARE_STOP = ["cancel_presentation", "stop_screen_share"];

	function share() {
		const stop = findButton(SHARE_STOP, /stop (presenting|sharing)/i);
		if (stop) return { button: stop, on: true };
		const start = findButton(SHARE_START, /^(present now|share screen)/i);
		return start ? { button: start, on: false } : null;
	}

	function leave() {
		const button = findButton(["call_end"], /^leave call/i);
		return button ? { button } : null;
	}

	sdmc.register({
		site: "meet",
		mic: () => findMuted("d", "microphone"),
		camera: () => findMuted("e", "camera"),
		share,
		leave,
	});
})();

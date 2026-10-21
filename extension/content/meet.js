// Google Meet adapter. Works on the pre-join screen and inside the call.
//
// Meet's mic and camera buttons carry `data-is-muted="true|false"` and an aria-label that ends with the
// keyboard shortcut, e.g. "Turn off microphone (⌘ + d)" or "Mikrofon ausschalten (Strg + d)". Matching on
// the shortcut suffix makes this work in any UI language; the device word is only a fallback.
(() => {
	const sdmc = globalThis.__sdmc;
	if (!sdmc) return;
	const { util } = sdmc;

	function find(shortcutKey, fallbackWord) {
		const candidates = util.visible(document.querySelectorAll("[data-is-muted]"));
		const shortcut = new RegExp(`\\+\\s*${shortcutKey}\\)\\s*$`, "i");
		let el = candidates.find((c) => shortcut.test(util.label(c)));
		if (!el) el = candidates.find((c) => util.label(c).toLowerCase().includes(fallbackWord));
		if (!el) return null;
		const muted = el.getAttribute("data-is-muted");
		return { button: el, on: muted === "false" ? true : muted === "true" ? false : null };
	}

	sdmc.register({
		site: "meet",
		mic: () => find("d", "microphone"),
		camera: () => find("e", "camera"),
	});
})();

// Microsoft Teams web adapter (experimental). Runs in all frames because the calling UI is often an iframe.
//
// The toolbar buttons have stable ids and a `data-state` attribute describing the icon shown:
// `mic` / `mic-off` and `call-video` / `call-video-off`. `aria-pressed` is the fallback.
(() => {
	const sdmc = globalThis.__sdmc;
	if (!sdmc) return;
	const { util } = sdmc;

	function read(id, onState, offState) {
		const button = util.visible(document.querySelectorAll(`#${id}`))[0] || null;
		if (!button) return null;
		const state = (button.getAttribute("data-state") || "").toLowerCase();
		let on = null;
		if (state === onState) on = true;
		else if (state === offState) on = false;
		else {
			const pressed = button.getAttribute("aria-pressed");
			if (pressed === "true") on = true;
			else if (pressed === "false") on = false;
		}
		return { button, on };
	}

	sdmc.register({
		site: "teams",
		mic: () => read("microphone-button", "mic", "mic-off"),
		camera: () => read("video-button", "call-video", "call-video-off"),
	});
})();

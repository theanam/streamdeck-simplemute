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

	function share() {
		const button = util.visible(document.querySelectorAll("#share-button"))[0] || null;
		if (!button) return null;
		const label = util.label(button).toLowerCase();
		const pressed = button.getAttribute("aria-pressed");
		let on = null;
		if (label.includes("stop")) on = true;
		else if (pressed === "true") on = true;
		else if (pressed === "false" || label.includes("share")) on = false;
		return { button, on };
	}

	function leave() {
		const button = util.visible(document.querySelectorAll("#hangup-button"))[0] || null;
		return button ? { button } : null;
	}

	sdmc.register({
		site: "teams",
		mic: () => read("microphone-button", "mic", "mic-off"),
		camera: () => read("video-button", "call-video", "call-video-off"),
		share,
		leave,
	});
})();

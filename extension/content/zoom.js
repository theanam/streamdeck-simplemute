// Zoom web client adapter (https://*.zoom.us/wc/...). The meeting UI may live in an iframe, so this
// script runs in all frames; frames without the controls simply report no meeting.
//
// Known limitation: Zoom's button labels are matched in English only.
(() => {
	const sdmc = globalThis.__sdmc;
	if (!sdmc) return;
	const { util } = sdmc;

	function first(selector) {
		return util.visible(document.querySelectorAll(selector))[0] || null;
	}

	function mic() {
		const button = first("button.join-audio-container__btn");
		if (!button) return null;
		const label = util.label(button).toLowerCase();
		let on = null;
		if (label.includes("unmute")) on = false;
		else if (label.includes("join audio")) on = false;
		else if (label.includes("mute")) on = true;
		return { button, on };
	}

	function camera() {
		const button = first("button.send-video-container__btn");
		if (!button) return null;
		const label = util.label(button).toLowerCase();
		let on = null;
		if (label.includes("stop")) on = true;
		else if (label.includes("start")) on = false;
		return { button, on };
	}

	/** Visible button whose label matches; Zoom's toolbar labels are English-only. */
	function byLabel(re) {
		return util.visible(document.querySelectorAll("button")).find((b) => re.test(util.label(b))) || null;
	}

	function share() {
		const stop = byLabel(/stop shar/i);
		if (stop) return { button: stop, on: true };
		const start = byLabel(/share screen/i);
		return start ? { button: start, on: false } : null;
	}

	function leave() {
		const button = first("button.footer__leave-btn") || byLabel(/^(leave|end)$/i);
		if (!button) return null;
		// Zoom opens a popover asking to confirm; click "Leave Meeting" in it.
		const confirm = () => {
			const btn = first("button.leave-meeting-options__btn") || byLabel(/leave meeting/i);
			if (btn) btn.click();
		};
		return { button, confirm };
	}

	sdmc.register({ site: "zoom", mic, camera, share, leave });
})();

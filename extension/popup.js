// Toolbar popup: shows whether the plugin is reachable and what the keys are controlling.
const LINKS = {
	pluginDownload: "https://marketplace.elgato.com/product/simplemute-3e505bc6-2650-4048-8475-f86d27ca9adc",
	guide: "https://github.com/theanam/streamdeck-simplemute#install",
};

const SITE_NAMES = { meet: "Google Meet", zoom: "Zoom", teams: "Microsoft Teams" };
const DEVICE = { on: "on", off: "off", unknown: "unknown" };

const $ = (id) => document.getElementById(id);

function render(status) {
	const connected = !!(status && status.connected);
	$("dot").className = `dot ${connected ? "ok" : "bad"}`;
	$("connected").hidden = !connected;
	$("disconnected").hidden = connected;

	if (connected) {
		const state = status.state || {};
		const inMeeting = !!state.inMeeting;
		$("no-meeting").hidden = inMeeting;
		$("site").textContent = inMeeting ? SITE_NAMES[state.site] || "a meeting" : "Mac microphone (no meeting open)";
		$("mic").textContent = inMeeting ? DEVICE[state.mic] || "unknown" : "–";
		$("camera").textContent = inMeeting ? DEVICE[state.camera] || "unknown" : "–";
		$("share").textContent = inMeeting ? DEVICE[state.share] || "unknown" : "–";
	}

	const parts = [`Extension ${status && status.extensionVersion ? status.extensionVersion : ""}`.trim()];
	if (connected) {
		if (status.pluginVersion) parts.push(`Plugin ${status.pluginVersion}`);
		if (status.port) parts.push(`Port ${status.port}`);
	}
	$("footer").textContent = parts.join(" · ");
}

async function refresh() {
	try {
		const status = await chrome.runtime.sendMessage({ type: "sdmc:status" });
		render(status);
	} catch {
		render({ connected: false });
	}
}

$("download").href = LINKS.pluginDownload;
$("guide").href = LINKS.guide;
$("retry").addEventListener("click", async () => {
	$("retry").disabled = true;
	try {
		await chrome.runtime.sendMessage({ type: "sdmc:reconnect" });
	} catch {
		// worker restarting; the refresh below shows the result
	}
	setTimeout(() => {
		$("retry").disabled = false;
		void refresh();
	}, 1500);
});

void refresh();
const timer = setInterval(refresh, 2000);
window.addEventListener("unload", () => clearInterval(timer));

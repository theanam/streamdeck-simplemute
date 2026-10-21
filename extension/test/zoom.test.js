import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lastState, loadSite, mockChrome, stubLayout, teardown } from "./harness.js";

let chromeMock;

beforeEach(() => {
	vi.useFakeTimers();
	stubLayout();
	chromeMock = mockChrome();
});

afterEach(() => {
	teardown();
	vi.useRealTimers();
});

function page(micLabel, camLabel) {
	document.body.innerHTML = `
		<div hidden><button class="join-audio-container__btn" aria-label="mute my microphone"></button></div>
		<button id="mic" class="join-audio-container__btn" aria-label="${micLabel}"></button>
		<button id="cam" class="send-video-container__btn" aria-label="${camLabel}"></button>`;
	// Clicking swaps the label the way Zoom does.
	const swap = (id, a, b) => {
		const el = document.getElementById(id);
		el.addEventListener("click", () => el.setAttribute("aria-label", el.getAttribute("aria-label") === a ? b : a));
	};
	swap("mic", "mute my microphone", "unmute my microphone");
	swap("cam", "stop my video", "start my video");
}

describe("Zoom adapter", () => {
	it("reads mute/unmute and start/stop labels", () => {
		page("unmute my microphone", "stop my video");
		loadSite("zoom");
		expect(lastState(chromeMock.sent)).toMatchObject({ site: "zoom", inMeeting: true, mic: "off", camera: "on" });
	});

	it("treats 'join audio' as mic off", () => {
		page("join audio", "start my video");
		loadSite("zoom");
		expect(lastState(chromeMock.sent)).toMatchObject({ mic: "off", camera: "off" });
	});

	it("ignores the hidden duplicate and toggles via command", () => {
		page("mute my microphone", "stop my video");
		loadSite("zoom");
		expect(lastState(chromeMock.sent)).toMatchObject({ mic: "on", camera: "on" });
		expect(chromeMock.dispatch({ type: "sdmc:command", action: "toggle", kind: "mic" })).toEqual({ ok: true });
		vi.advanceTimersByTime(150);
		expect(lastState(chromeMock.sent)).toMatchObject({ mic: "off", camera: "on" });
		expect(chromeMock.dispatch({ type: "sdmc:command", action: "toggle", kind: "camera" })).toEqual({ ok: true });
		vi.advanceTimersByTime(150);
		expect(lastState(chromeMock.sent)).toMatchObject({ mic: "off", camera: "off" });
	});

	it("shares and leaves, confirming Zoom's leave popover", () => {
		page("mute my microphone", "stop my video");
		document.body.insertAdjacentHTML(
			"beforeend",
			`<button id="share" aria-label="Share Screen"></button>
			 <button id="leave" class="footer__leave-btn" aria-label="Leave"></button>`,
		);
		const clicks = [];
		document.getElementById("share").addEventListener("click", () => clicks.push("share"));
		document.getElementById("leave").addEventListener("click", () => {
			clicks.push("leave");
			document.body.insertAdjacentHTML("beforeend", `<button id="confirm" class="leave-meeting-options__btn">Leave Meeting</button>`);
			document.getElementById("confirm").addEventListener("click", () => clicks.push("confirm"));
		});
		loadSite("zoom");
		expect(lastState(chromeMock.sent)).toMatchObject({ share: "off" });
		expect(chromeMock.dispatch({ type: "sdmc:command", action: "toggle", kind: "share" })).toEqual({ ok: true });
		expect(chromeMock.dispatch({ type: "sdmc:command", action: "leave" })).toEqual({ ok: true });
		vi.advanceTimersByTime(400);
		expect(clicks).toEqual(["share", "leave", "confirm"]);
	});

	it("reports inMeeting: false on a page without controls", () => {
		document.body.innerHTML = `<p>Launching Zoom…</p>`;
		loadSite("zoom");
		expect(lastState(chromeMock.sent)).toMatchObject({ site: "zoom", inMeeting: false });
	});
});

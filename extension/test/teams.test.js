import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lastState, loadSite, mockChrome, stubLayout, teardown, toggleOnClick } from "./harness.js";

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

describe("Teams adapter", () => {
	it("reads data-state", () => {
		document.body.innerHTML = `
			<div hidden><button id="microphone-button" data-state="mic"></button></div>
			<button id="microphone-button" data-state="mic-off" aria-label="Unmute"></button>
			<button id="video-button" data-state="call-video" aria-label="Turn camera off"></button>`;
		loadSite("teams");
		expect(lastState(chromeMock.sent)).toMatchObject({ site: "teams", inMeeting: true, mic: "off", camera: "on" });
	});

	it("falls back to aria-pressed", () => {
		document.body.innerHTML = `
			<button id="microphone-button" aria-pressed="true"></button>
			<button id="video-button" aria-pressed="false"></button>`;
		loadSite("teams");
		expect(lastState(chromeMock.sent)).toMatchObject({ mic: "on", camera: "off" });
	});

	it("toggles via command and ignores hidden duplicates", () => {
		document.body.innerHTML = `
			<div hidden><button id="microphone-button" data-state="mic"></button></div>
			<div><button id="microphone-button" data-state="mic-off"></button>
			<button id="video-button" data-state="call-video"></button></div>`;
		const [, mic] = document.querySelectorAll("#microphone-button");
		const cam = document.querySelector("#video-button");
		toggleOnClick(mic, "data-state", "mic", "mic-off");
		toggleOnClick(cam, "data-state", "call-video", "call-video-off");
		loadSite("teams");
		expect(chromeMock.dispatch({ type: "sdmc:command", action: "toggle", kind: "mic" })).toEqual({ ok: true });
		vi.advanceTimersByTime(150);
		expect(lastState(chromeMock.sent)).toMatchObject({ mic: "on", camera: "on" });
		expect(chromeMock.dispatch({ type: "sdmc:command", action: "toggle", kind: "camera" })).toEqual({ ok: true });
		vi.advanceTimersByTime(150);
		expect(lastState(chromeMock.sent)).toMatchObject({ mic: "on", camera: "off" });
	});

	it("reports inMeeting: false on a page without controls", () => {
		document.body.innerHTML = `<div id="chat">Hello</div>`;
		loadSite("teams");
		expect(lastState(chromeMock.sent)).toMatchObject({ site: "teams", inMeeting: false });
	});
});

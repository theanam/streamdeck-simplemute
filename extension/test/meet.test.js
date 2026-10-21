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

const ENGLISH = `
	<div hidden>
		<button id="dup-mic" data-is-muted="true" aria-label="Turn on microphone (⌘ + d)"></button>
		<button id="dup-cam" data-is-muted="true" aria-label="Turn on camera (⌘ + e)"></button>
	</div>
	<div>
		<button id="mic" data-is-muted="false" aria-label="Turn off microphone (⌘ + d)"></button>
		<button id="cam" data-is-muted="true" aria-label="Turn on camera (⌘ + e)"></button>
	</div>`;

const GERMAN = `
	<div id="mic" data-is-muted="false" data-tooltip="Mikrofon ausschalten (Strg + d)" role="button"></div>
	<div id="cam" data-is-muted="true" data-tooltip="Kamera einschalten (Strg + e)" role="button"></div>`;

const NESTED_LABEL = `
	<div id="mic" data-is-muted="true"><span aria-label="Turn on microphone (ctrl + d)"></span></div>`;

describe("Meet adapter", () => {
	it("reads on/off from data-is-muted", () => {
		document.body.innerHTML = ENGLISH;
		loadSite("meet");
		expect(lastState(chromeMock.sent)).toMatchObject({ site: "meet", inMeeting: true, mic: "on", camera: "off" });
	});

	it("ignores hidden duplicate buttons", () => {
		document.body.innerHTML = ENGLISH;
		loadSite("meet");
		let clicked = null;
		for (const id of ["dup-mic", "dup-cam", "mic", "cam"]) {
			document.getElementById(id).addEventListener("click", () => (clicked = id));
		}
		expect(chromeMock.dispatch({ type: "sdmc:command", action: "toggle", kind: "mic" })).toEqual({ ok: true });
		expect(clicked).toBe("mic");
		expect(chromeMock.dispatch({ type: "sdmc:command", action: "toggle", kind: "camera" })).toEqual({ ok: true });
		expect(clicked).toBe("cam");
	});

	it("clicking via sdmc:command changes the reported state", () => {
		document.body.innerHTML = ENGLISH;
		toggleOnClick(document.getElementById("mic"), "data-is-muted", "true", "false");
		toggleOnClick(document.getElementById("cam"), "data-is-muted", "true", "false");
		loadSite("meet");
		expect(chromeMock.dispatch({ type: "sdmc:command", action: "toggle", kind: "mic" })).toEqual({ ok: true });
		vi.advanceTimersByTime(150);
		expect(lastState(chromeMock.sent)).toMatchObject({ mic: "off", camera: "off" });
		expect(chromeMock.dispatch({ type: "sdmc:command", action: "toggle", kind: "camera" })).toEqual({ ok: true });
		vi.advanceTimersByTime(150);
		expect(lastState(chromeMock.sent)).toMatchObject({ mic: "off", camera: "on" });
	});

	it("works with German labels via the shortcut suffix", () => {
		document.body.innerHTML = GERMAN;
		loadSite("meet");
		expect(lastState(chromeMock.sent)).toMatchObject({ inMeeting: true, mic: "on", camera: "off" });
		let clicked = null;
		document.getElementById("cam").addEventListener("click", () => (clicked = "cam"));
		expect(chromeMock.dispatch({ type: "sdmc:command", action: "toggle", kind: "camera" })).toEqual({ ok: true });
		expect(clicked).toBe("cam");
	});

	it("reads a label from a descendant", () => {
		document.body.innerHTML = NESTED_LABEL;
		loadSite("meet");
		expect(lastState(chromeMock.sent)).toMatchObject({ inMeeting: true, mic: "off", camera: "unknown" });
	});

	it("reports inMeeting: false on a page without controls", () => {
		document.body.innerHTML = `<h1>Meet landing page</h1><button aria-label="New meeting"></button>`;
		loadSite("meet");
		expect(lastState(chromeMock.sent)).toEqual({ type: "sdmc:state", site: "meet", inMeeting: false, mic: "unknown", camera: "unknown", share: "unknown" });
	});

	it("finds share and leave by Material icon ligature regardless of language", () => {
		document.body.innerHTML = `
			${GERMAN}
			<button id="share"><i class="google-symbols">present_to_all</i></button>
			<button id="leave" aria-label="Anruf verlassen"><i class="google-symbols">call_end</i></button>`;
		loadSite("meet");
		expect(lastState(chromeMock.sent)).toMatchObject({ inMeeting: true, share: "off" });
		let clicked = null;
		for (const id of ["share", "leave"]) document.getElementById(id).addEventListener("click", () => (clicked = id));
		expect(chromeMock.dispatch({ type: "sdmc:command", action: "toggle", kind: "share" })).toEqual({ ok: true });
		expect(clicked).toBe("share");
		expect(chromeMock.dispatch({ type: "sdmc:command", action: "leave" })).toEqual({ ok: true });
		expect(clicked).toBe("leave");
	});

	it("reports share on while presenting and stops it on toggle", () => {
		document.body.innerHTML = `
			${ENGLISH}
			<button id="stop" aria-label="Stop presenting"><i>cancel_presentation</i></button>`;
		let clicked = null;
		document.getElementById("stop").addEventListener("click", () => (clicked = "stop"));
		loadSite("meet");
		expect(lastState(chromeMock.sent)).toMatchObject({ share: "on" });
		expect(chromeMock.dispatch({ type: "sdmc:command", action: "toggle", kind: "share" })).toEqual({ ok: true });
		expect(clicked).toBe("stop");
	});

	it("answers leave with an error when no leave button exists (pre-join screen)", () => {
		document.body.innerHTML = ENGLISH;
		loadSite("meet");
		expect(chromeMock.dispatch({ type: "sdmc:command", action: "leave" })).toEqual({ ok: false, error: "leave control not found" });
	});
});

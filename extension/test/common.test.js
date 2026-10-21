import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lastState, loadFile, loadSite, mockChrome, stubLayout, teardown } from "./harness.js";

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

function meetPage() {
	document.body.innerHTML = `
		<button data-is-muted="false" aria-label="Turn off microphone (⌘ + d)"></button>
		<button data-is-muted="true" aria-label="Turn on camera (⌘ + e)"></button>`;
}

describe("content runtime", () => {
	it("reports state immediately and only on change", () => {
		meetPage();
		loadSite("meet");
		expect(chromeMock.sent).toHaveLength(1);
		expect(lastState(chromeMock.sent)).toMatchObject({ type: "sdmc:state", site: "meet", inMeeting: true, mic: "on", camera: "off" });
		vi.advanceTimersByTime(1200);
		expect(chromeMock.sent).toHaveLength(1);
	});

	it("sends a heartbeat every 3 s while in a meeting, and none when not", () => {
		meetPage();
		loadSite("meet");
		vi.advanceTimersByTime(3200);
		expect(chromeMock.sent.length).toBe(2);
		document.body.innerHTML = "";
		vi.advanceTimersByTime(400);
		expect(lastState(chromeMock.sent)).toMatchObject({ inMeeting: false });
		const count = chromeMock.sent.length;
		vi.advanceTimersByTime(10_000);
		expect(chromeMock.sent.length).toBe(count);
	});

	it("stops polling once the extension is reloaded (orphaned copy)", () => {
		meetPage();
		loadSite("meet");
		chromeMock.orphan();
		document.querySelector("[aria-label*='microphone']").setAttribute("data-is-muted", "true");
		vi.advanceTimersByTime(5000);
		expect(chromeMock.sent).toHaveLength(1);
	});

	it("does not re-register when injected twice", () => {
		meetPage();
		loadSite("meet");
		const first = globalThis.__sdmc;
		loadFile("common.js");
		expect(globalThis.__sdmc).toBe(first);
	});

	it("answers commands for missing controls with an error", () => {
		document.body.innerHTML = "";
		loadSite("meet");
		expect(chromeMock.dispatch({ type: "sdmc:command", action: "toggle", kind: "mic" })).toEqual({ ok: false, error: "mic control not found" });
		expect(chromeMock.dispatch({ type: "sdmc:command", action: "toggle", kind: "laser" })).toMatchObject({ ok: false });
		expect(chromeMock.dispatch({ type: "sdmc:command", action: "wave", kind: "mic" })).toMatchObject({ ok: false });
		expect(chromeMock.dispatch({ type: "something-else" })).toBeUndefined();
	});

	it("maps an unreadable button state to unknown", () => {
		document.body.innerHTML = `<button data-is-muted="maybe" aria-label="Turn off microphone (⌘ + d)"></button>`;
		loadSite("meet");
		expect(lastState(chromeMock.sent)).toMatchObject({ inMeeting: true, mic: "unknown", camera: "unknown" });
	});
});

import { describe, expect, it, vi } from "vitest";

import { createSystemMic } from "../src/system-mic";
import { imageNameFor } from "../src/actions/media-toggle";
import type { BridgeStatus } from "../src/bridge";

/** Fakes osascript: keeps an input level and records the commands it saw. */
function fakeMac(initialLevel: number) {
	let level = initialLevel;
	const calls: string[] = [];
	const run = vi.fn(async (_file: string, args: string[]) => {
		const script = args[1];
		calls.push(script);
		const m = /set volume input volume (\d+)/.exec(script);
		if (m) {
			level = Number(m[1]);
			return "";
		}
		return `${level}\n`;
	});
	return { run, calls, level: () => level };
}

describe("createSystemMic", () => {
	it("is unsupported off macOS", async () => {
		const mic = createSystemMic("win32");
		expect(mic.supported).toBe(false);
		await expect(mic.getMuted()).resolves.toBeNull();
		await expect(mic.setMuted(true)).resolves.toBe(false);
	});

	it("reads muted from the macOS input level", async () => {
		const live = fakeMac(60);
		await expect(createSystemMic("darwin", live.run).getMuted()).resolves.toBe(false);
		const muted = fakeMac(0);
		await expect(createSystemMic("darwin", muted.run).getMuted()).resolves.toBe(true);
	});

	it("mutes to 0 and restores the previous level", async () => {
		const mac = fakeMac(60);
		const mic = createSystemMic("darwin", mac.run);
		await expect(mic.setMuted(true)).resolves.toBe(true);
		expect(mac.level()).toBe(0);
		await expect(mic.setMuted(false)).resolves.toBe(true);
		expect(mac.level()).toBe(60);
	});

	it("falls back to a sane level when it never saw the input live", async () => {
		const mac = fakeMac(0);
		const mic = createSystemMic("darwin", mac.run);
		await mic.setMuted(false);
		expect(mac.level()).toBe(75);
	});

	it("reports null and false when osascript fails", async () => {
		const run = vi.fn(async () => {
			throw new Error("boom");
		});
		const mic = createSystemMic("darwin", run);
		await expect(mic.getMuted()).resolves.toBeNull();
		await expect(mic.setMuted(true)).resolves.toBe(false);
	});
});

describe("imageNameFor", () => {
	const meeting: BridgeStatus = { connected: true, inMeeting: true, site: "zoom", mic: "on", camera: "off", share: "unknown" };
	const idle: BridgeStatus = { connected: true, inMeeting: false, site: null, mic: "unknown", camera: "unknown", share: "unknown" };
	const gone: BridgeStatus = { ...idle, connected: false };

	it("adds the site pill while in a meeting", () => {
		expect(imageNameFor(meeting, "mic")).toBe("mic-on-zoom");
		expect(imageNameFor(meeting, "camera")).toBe("camera-off-zoom");
		expect(imageNameFor(meeting, "share")).toBe("share-idle");
		expect(imageNameFor(meeting, "leave")).toBe("leave-active-zoom");
		expect(imageNameFor({ ...meeting, site: null }, "mic")).toBe("mic-on");
	});

	it("uses the OS input for the mute key when no meeting is running", () => {
		expect(imageNameFor(idle, "mic", { supported: true, muted: false })).toBe("mic-on-system");
		expect(imageNameFor(idle, "mic", { supported: true, muted: true })).toBe("mic-off-system");
		expect(imageNameFor(gone, "mic", { supported: true, muted: true })).toBe("mic-off-system-nolink");
		expect(imageNameFor(idle, "mic", { supported: false, muted: null })).toBe("mic-idle");
		expect(imageNameFor(idle, "mic", { supported: true, muted: null })).toBe("mic-idle");
		expect(imageNameFor(gone, "mic")).toBe("mic-disconnected");
	});

	it("shows idle or disconnected for the other keys", () => {
		expect(imageNameFor(idle, "camera")).toBe("camera-idle");
		expect(imageNameFor(gone, "share")).toBe("share-disconnected");
		expect(imageNameFor(idle, "leave")).toBe("leave-idle");
	});
});

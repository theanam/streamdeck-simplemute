/**
 * Mute control for the operating system's default audio input, used by the Mute key when no
 * browser meeting is running.
 *
 * macOS: driven through `osascript` and the system input volume. Muting sets the input volume to 0
 * and remembers the previous level so unmuting restores it.
 * Windows and Linux: not supported yet; `supported` is false and the key falls back to idle.
 */
import { execFile } from "node:child_process";

export type CommandRunner = (file: string, args: string[]) => Promise<string>;

export type SystemMic = {
	readonly supported: boolean;
	/** `true` when muted, `false` when live, `null` when it could not be read. */
	getMuted(): Promise<boolean | null>;
	/** Resolves `true` when the change was applied. */
	setMuted(muted: boolean): Promise<boolean>;
};

const DEFAULT_RESTORE_LEVEL = 75;

const defaultRunner: CommandRunner = (file, args) =>
	new Promise((resolve, reject) => {
		execFile(file, args, { timeout: 3_000 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
	});

export function createSystemMic(platform: NodeJS.Platform = process.platform, run: CommandRunner = defaultRunner): SystemMic {
	if (platform === "darwin") {
		return macSystemMic(run);
	}
	return {
		supported: false,
		getMuted: async () => null,
		setMuted: async () => false,
	};
}

function macSystemMic(run: CommandRunner): SystemMic {
	let restoreLevel = DEFAULT_RESTORE_LEVEL;

	async function readLevel(): Promise<number | null> {
		try {
			const out = await run("osascript", ["-e", "input volume of (get volume settings)"]);
			const level = Number.parseInt(out.trim(), 10);
			return Number.isFinite(level) ? level : null;
		} catch {
			return null;
		}
	}

	return {
		supported: true,
		async getMuted() {
			const level = await readLevel();
			if (level === null) return null;
			if (level > 0) restoreLevel = level;
			return level === 0;
		},
		async setMuted(muted) {
			const level = await readLevel();
			if (level === null) return false;
			if (level > 0) restoreLevel = level;
			const target = muted ? 0 : restoreLevel;
			try {
				await run("osascript", ["-e", `set volume input volume ${target}`]);
				return true;
			} catch {
				return false;
			}
		},
	};
}

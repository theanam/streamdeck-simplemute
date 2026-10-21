/**
 * Loads the eight runtime key images (2 kinds × 4 statuses) as base64 PNG data URLs.
 * The folder is resolved relative to the bundled plugin file, not the working directory,
 * because Stream Deck launches the plugin with an arbitrary cwd.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Kind } from "./bridge";

export type KeyStatus = "on" | "off" | "idle" | "disconnected";
export const KEY_STATUSES: readonly KeyStatus[] = ["on", "off", "idle", "disconnected"];

export type KeyImages = Record<Kind, Record<KeyStatus, string>>;

/** Reads `imgs/keys/<kind>-<status>.png` next to the bundle (bin/plugin.js → ../imgs/keys). */
export function loadKeyImages(): KeyImages {
	const binDir = path.dirname(fileURLToPath(import.meta.url));
	const keysDir = path.resolve(binDir, "..", "imgs", "keys");

	const load = (kind: Kind): Record<KeyStatus, string> => {
		const out = {} as Record<KeyStatus, string>;
		for (const status of KEY_STATUSES) {
			const file = path.join(keysDir, `${kind}-${status}.png`);
			out[status] = `data:image/png;base64,${readFileSync(file).toString("base64")}`;
		}
		return out;
	};

	return { mic: load("mic"), camera: load("camera") };
}

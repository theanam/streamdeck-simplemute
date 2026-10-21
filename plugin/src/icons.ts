/**
 * Loads every runtime key image in `imgs/keys` as a base64 PNG data URL, keyed by file name
 * without extension (e.g. `mic-on-meet`). The folder is resolved relative to the bundled plugin
 * file, not the working directory, because Stream Deck launches the plugin with an arbitrary cwd.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type KeyImages = ReadonlyMap<string, string>;

export function loadKeyImages(): KeyImages {
	const binDir = path.dirname(fileURLToPath(import.meta.url));
	const keysDir = path.resolve(binDir, "..", "imgs", "keys");
	const images = new Map<string, string>();
	for (const file of readdirSync(keysDir)) {
		if (!file.endsWith(".png")) continue;
		const data = readFileSync(path.join(keysDir, file)).toString("base64");
		images.set(file.slice(0, -".png".length), `data:image/png;base64,${data}`);
	}
	return images;
}

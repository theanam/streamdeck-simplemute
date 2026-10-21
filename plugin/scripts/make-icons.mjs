/**
 * Generates every PNG the plugin and the extension use from inline SVG.
 *
 *   npm run icons
 *
 * Output (all committed):
 *   <sdPlugin>/imgs/keys/<kind>-<status>.png     144 px, runtime key images (loaded by src/icons.ts)
 *   <sdPlugin>/imgs/actions/<kind>/key(.png|@2x)  72 / 144 px, manifest default key image
 *   <sdPlugin>/imgs/actions/<kind>/icon(.png|@2x) 20 / 40 px, action list icon
 *   <sdPlugin>/imgs/plugin/category-icon(@2x)     28 / 56 px
 *   <sdPlugin>/imgs/plugin/marketplace(@2x)       256 / 512 px
 *   extension/icons/icon{16,32,48,128}.png
 */
import { Resvg } from "@resvg/resvg-js";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(here, "..");
const repoDir = path.resolve(pluginDir, "..");
const sdPlugin = path.join(pluginDir, "com.anamahmed.simplemute.sdPlugin");
const imgs = path.join(sdPlugin, "imgs");
const extIcons = path.join(repoDir, "extension", "icons");

export const KINDS = ["mic", "camera"];
export const STATUSES = ["on", "off", "idle", "disconnected"];

const STYLE = {
	on: { bg: "#16a34a", glyph: "#ffffff", slash: false, dot: false },
	off: { bg: "#dc2626", glyph: "#ffffff", slash: true, dot: false },
	idle: { bg: "#3f3f46", glyph: "#a1a1aa", slash: true, dot: false },
	disconnected: { bg: "#27272a", glyph: "#71717a", slash: true, dot: true },
};

/** Mic or camera glyph in a 144×144 box, drawn with `color`. */
function glyph(kind, color) {
	if (kind === "mic") {
		return `
			<rect x="58" y="24" width="28" height="52" rx="14" fill="${color}"/>
			<path d="M44 64 a28 28 0 0 0 56 0" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round"/>
			<path d="M72 92 v16 M54 110 h36" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round"/>`;
	}
	return `
		<rect x="26" y="44" width="66" height="54" rx="12" fill="${color}"/>
		<path d="M96 64 L118 50 L118 92 L96 78 Z" fill="${color}"/>`;
}

/** Diagonal slash through the glyph; a wider stroke in the background colour "cuts" the glyph first. */
function slash(bg, color) {
	return `
		<path d="M38 34 L106 110" stroke="${bg}" stroke-width="22" stroke-linecap="round"/>
		<path d="M38 34 L106 110" stroke="${color}" stroke-width="9" stroke-linecap="round"/>`;
}

function dot() {
	return `<circle cx="118" cy="26" r="13" fill="#f97316" stroke="#18181b" stroke-width="4"/>`;
}

/** Full key image: rounded background, glyph, optional slash and dot. */
export function keySvg(kind, status) {
	const s = STYLE[status];
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">
		<rect width="144" height="144" rx="22" fill="${s.bg}"/>
		${glyph(kind, s.glyph)}
		${s.slash ? slash(s.bg, s.glyph) : ""}
		${s.dot ? dot() : ""}
	</svg>`;
}

/** Monochrome glyph on a transparent background, for action-list and category icons. */
function monoSvg(kind, color = "#e4e4e7") {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">${glyph(kind, color)}</svg>`;
}

/** Plugin/extension icon: dark tile with mic (green) and a small camera badge. */
function appSvg() {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">
		<rect width="144" height="144" rx="30" fill="#18181b"/>
		<rect x="16" y="16" width="112" height="112" rx="24" fill="#16a34a"/>
		${glyph("mic", "#ffffff")}
	</svg>`;
}

function png(svg, size) {
	return new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
}

function write(file, svg, size) {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, png(svg, size));
	console.log(`${path.relative(repoDir, file)} (${size}px)`);
}

for (const kind of KINDS) {
	for (const status of STATUSES) {
		write(path.join(imgs, "keys", `${kind}-${status}.png`), keySvg(kind, status), 144);
	}
	write(path.join(imgs, "actions", kind, "key.png"), keySvg(kind, "idle"), 72);
	write(path.join(imgs, "actions", kind, "key@2x.png"), keySvg(kind, "idle"), 144);
	write(path.join(imgs, "actions", kind, "icon.png"), monoSvg(kind), 20);
	write(path.join(imgs, "actions", kind, "icon@2x.png"), monoSvg(kind), 40);
}

write(path.join(imgs, "plugin", "category-icon.png"), monoSvg("mic"), 28);
write(path.join(imgs, "plugin", "category-icon@2x.png"), monoSvg("mic"), 56);
write(path.join(imgs, "plugin", "marketplace.png"), appSvg(), 256);
write(path.join(imgs, "plugin", "marketplace@2x.png"), appSvg(), 512);

for (const size of [16, 32, 48, 128]) {
	write(path.join(extIcons, `icon${size}.png`), appSvg(), size);
}

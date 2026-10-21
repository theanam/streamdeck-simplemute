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
const sdPlugin = path.join(pluginDir, "co.anam.simplemute.sdPlugin");
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

/** Monochrome glyph on a transparent background, for action-list icons. */
function monoSvg(kind, color = "#e4e4e7") {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">${glyph(kind, color)}</svg>`;
}

/**
 * SimpleMute brand mark: a mic with a bold amber slash, drawn in one colour for the category icon
 * and on an indigo tile for the plugin and extension icons. Deliberately shows no conferencing brand.
 */
function markSvg(micColor, slashColor, cutColor) {
	return `
		<rect x="58" y="22" width="28" height="54" rx="14" fill="${micColor}"/>
		<path d="M44 64 a28 28 0 0 0 56 0" fill="none" stroke="${micColor}" stroke-width="10" stroke-linecap="round"/>
		<path d="M72 92 v18 M52 110 h40" fill="none" stroke="${micColor}" stroke-width="10" stroke-linecap="round"/>
		<path d="M34 30 L110 114" stroke="${cutColor}" stroke-width="26" stroke-linecap="round"/>
		<path d="M34 30 L110 114" stroke="${slashColor}" stroke-width="12" stroke-linecap="round"/>`;
}

function categorySvg() {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">${markSvg("#e4e4e7", "#e4e4e7", "transparent")}</svg>`;
}

function appSvg() {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">
		<defs>
			<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
				<stop offset="0" stop-color="#4f46e5"/>
				<stop offset="1" stop-color="#312e81"/>
			</linearGradient>
		</defs>
		<rect width="144" height="144" rx="32" fill="url(#bg)"/>
		${markSvg("#ffffff", "#f59e0b", "#3730a3")}
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

write(path.join(imgs, "plugin", "category-icon.png"), categorySvg(), 28);
write(path.join(imgs, "plugin", "category-icon@2x.png"), categorySvg(), 56);
write(path.join(imgs, "plugin", "marketplace.png"), appSvg(), 256);
write(path.join(imgs, "plugin", "marketplace@2x.png"), appSvg(), 512);

for (const size of [16, 32, 48, 128]) {
	write(path.join(extIcons, `icon${size}.png`), appSvg(), size);
}

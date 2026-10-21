/**
 * Generates every PNG the plugin and the extension use from inline SVG.
 *
 *   npm run icons
 *
 * Output (all committed):
 *   <sdPlugin>/imgs/keys/<name>.png                144 px runtime key images, see keyVariants() for names
 *   <sdPlugin>/imgs/actions/<kind>/key(.png|@2x)    72 / 144 px manifest default key image
 *   <sdPlugin>/imgs/actions/<kind>/icon(.png|@2x)   20 / 40 px action list icon
 *   <sdPlugin>/imgs/plugin/category-icon(@2x)       28 / 56 px
 *   <sdPlugin>/imgs/plugin/marketplace(@2x)         256 / 512 px
 *   extension/icons/icon{16,32,48,128}.png
 */
import { Resvg } from "@resvg/resvg-js";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(here, "..");
const repoDir = path.resolve(pluginDir, "..");
const sdPlugin = path.join(pluginDir, "co.anam.simplemute.sdPlugin");
const imgs = path.join(sdPlugin, "imgs");
const extIcons = path.join(repoDir, "extension", "icons");

export const KINDS = ["mic", "camera", "share", "leave"];

/** Background and glyph colours per status. */
const STYLE = {
	on: { bg: "#16a34a", glyph: "#ffffff", slash: false },
	off: { bg: "#dc2626", glyph: "#ffffff", slash: true },
	idle: { bg: "#3f3f46", glyph: "#a1a1aa", slash: true },
	disconnected: { bg: "#27272a", glyph: "#71717a", slash: true },
	/** Leave key while in a meeting: a plain red "hang up". */
	active: { bg: "#dc2626", glyph: "#ffffff", slash: false },
};

/** Small pill at the bottom of the key naming what the key controls. */
const BADGE = {
	meet: { text: "MEET", bg: "#0f9d58" },
	zoom: { text: "ZOOM", bg: "#2d8cff" },
	teams: { text: "TEAMS", bg: "#6264a7" },
	system: { text: "SYSTEM", bg: "#52525b" },
};

/** Glyph for a kind in a 144×144 box, drawn with `color`. */
function glyph(kind, color) {
	switch (kind) {
		case "mic":
			return `
				<rect x="58" y="22" width="28" height="50" rx="14" fill="${color}"/>
				<path d="M44 60 a28 28 0 0 0 56 0" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round"/>
				<path d="M72 88 v14 M54 102 h36" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round"/>`;
		case "camera":
			return `
				<rect x="26" y="38" width="66" height="52" rx="12" fill="${color}"/>
				<path d="M96 58 L118 44 L118 84 L96 70 Z" fill="${color}"/>`;
		case "share":
			return `
				<rect x="24" y="30" width="96" height="62" rx="10" fill="none" stroke="${color}" stroke-width="9"/>
				<path d="M72 80 V48 M56 62 L72 46 L88 62" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
				<path d="M52 106 h40" stroke="${color}" stroke-width="9" stroke-linecap="round"/>`;
		case "leave":
			// Material "call_end" receiver, scaled from its 24-unit box.
			return `
				<g transform="translate(22 14) scale(4.17)">
					<path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.68-1.36-2.66-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" fill="${color}"/>
				</g>`;
	}
	throw new Error(`unknown kind ${kind}`);
}

/** Diagonal slash through the glyph; a wider stroke in the background colour "cuts" the glyph first. */
function slash(bg, color) {
	return `
		<path d="M38 28 L106 100" stroke="${bg}" stroke-width="22" stroke-linecap="round"/>
		<path d="M38 28 L106 100" stroke="${color}" stroke-width="9" stroke-linecap="round"/>`;
}

function dot() {
	return `<circle cx="118" cy="26" r="13" fill="#f97316" stroke="#18181b" stroke-width="4"/>`;
}

function badge(name) {
	const b = BADGE[name];
	if (!b) return "";
	const w = 16 + b.text.length * 11;
	const x = (144 - w) / 2;
	return `
		<rect x="${x}" y="112" width="${w}" height="24" rx="12" fill="${b.bg}"/>
		<text x="72" y="129" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="15" font-weight="700" letter-spacing="1" fill="#ffffff">${b.text}</text>`;
}

/** Full key image: rounded background, glyph, optional slash, badge pill and "no link" dot. */
export function keySvg(kind, status, { badgeName = null, dotFlag = false } = {}) {
	const s = STYLE[status];
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">
		<rect width="144" height="144" rx="22" fill="${s.bg}"/>
		${glyph(kind, s.glyph)}
		${s.slash && kind !== "leave" ? slash(s.bg, s.glyph) : ""}
		${badge(badgeName)}
		${dotFlag || status === "disconnected" ? dot() : ""}
	</svg>`;
}

/**
 * Every runtime key image, named `<kind>-<status>[-<badge>][-nolink]`.
 * `src/icons.ts` loads them all; `src/actions/*.ts` picks one by name.
 */
export function keyVariants() {
	const sites = ["meet", "zoom", "teams"];
	const out = [];
	for (const kind of ["mic", "camera", "share"]) {
		for (const status of ["on", "off"]) {
			out.push({ name: `${kind}-${status}`, kind, status });
			for (const site of sites) out.push({ name: `${kind}-${status}-${site}`, kind, status, badgeName: site });
		}
		out.push({ name: `${kind}-idle`, kind, status: "idle" });
		out.push({ name: `${kind}-disconnected`, kind, status: "disconnected" });
	}
	// Leave: active while in a meeting (with site badge), otherwise idle / disconnected.
	out.push({ name: "leave-active", kind: "leave", status: "active" });
	for (const site of sites) out.push({ name: `leave-active-${site}`, kind: "leave", status: "active", badgeName: site });
	out.push({ name: "leave-idle", kind: "leave", status: "idle" });
	out.push({ name: "leave-disconnected", kind: "leave", status: "disconnected" });
	// Mic controlling the OS default input when no meeting is running; "-nolink" adds the orange dot.
	for (const status of ["on", "off"]) {
		out.push({ name: `mic-${status}-system`, kind: "mic", status, badgeName: "system" });
		out.push({ name: `mic-${status}-system-nolink`, kind: "mic", status, badgeName: "system", dotFlag: true });
	}
	return out;
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
	return new Resvg(svg, { fitTo: { mode: "width", value: size }, font: { loadSystemFonts: true } }).render().asPng();
}

function write(file, svg, size) {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, png(svg, size));
	console.log(`${path.relative(repoDir, file)} (${size}px)`);
}

// Runtime key images: wipe the folder first so renamed variants do not linger.
rmSync(path.join(imgs, "keys"), { recursive: true, force: true });
for (const v of keyVariants()) {
	write(path.join(imgs, "keys", `${v.name}.png`), keySvg(v.kind, v.status, v), 144);
}

for (const kind of KINDS) {
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

console.log(`\n${readdirSync(path.join(imgs, "keys")).length} runtime key images`);

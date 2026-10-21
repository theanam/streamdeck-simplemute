/**
 * Generates store listing images for the Chrome Web Store and the Elgato Marketplace from the
 * plugin's key images and brand mark.
 *
 *   npm run assets:store
 *
 * Output (committed):
 *   store/chrome/icon-128.png                 128 px icon with 96 px artwork + 16 px transparent padding
 *   store/chrome/promo-small-440x280.png      required small promo tile
 *   store/chrome/promo-marquee-1400x560.png   optional marquee
 *   store/chrome/screenshot-N-1280x800.png    screenshots (full bleed, square corners)
 *   store/elgato/app-icon-288.png             Marketplace app icon
 *   store/elgato/thumbnail-1920x960.png       Marketplace thumbnail
 *   store/elgato/gallery-N-1920x960.png       Marketplace gallery images
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { Resvg } = require("../plugin/node_modules/@resvg/resvg-js");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const keysDir = path.join(root, "plugin", "co.anam.simplemute.sdPlugin", "imgs", "keys");
const markPng = path.join(root, "plugin", "co.anam.simplemute.sdPlugin", "imgs", "plugin", "marketplace@2x.png");
const out = { chrome: path.join(root, "store", "chrome"), elgato: path.join(root, "store", "elgato") };

const FONT = "Helvetica Neue, Helvetica, Arial, sans-serif";
const BG = "#0f0f14";
const INK = "#f4f4f5";
const MUTED = "#a1a1aa";
const ACCENT = "#6366f1";

const dataUri = (file) => `data:image/png;base64,${readFileSync(file).toString("base64")}`;
const key = (name) => dataUri(path.join(keysDir, `${name}.png`));
const mark = dataUri(markPng);

/** A Stream Deck-like device: dark bezel with a grid of key images. */
function device(x, y, keys, { cols = 3, size = 150, gap = 22, pad = 34 } = {}) {
	const rows = Math.ceil(keys.length / cols);
	const w = pad * 2 + cols * size + (cols - 1) * gap;
	const h = pad * 2 + rows * size + (rows - 1) * gap;
	const cells = keys
		.map((k, i) => {
			const cx = x + pad + (i % cols) * (size + gap);
			const cy = y + pad + Math.floor(i / cols) * (size + gap);
			if (!k) return `<rect x="${cx}" y="${cy}" width="${size}" height="${size}" rx="${size * 0.15}" fill="#1c1c22"/>`;
			return `<image x="${cx}" y="${cy}" width="${size}" height="${size}" href="${key(k)}"/>`;
		})
		.join("");
	return `
		<rect x="${x - 6}" y="${y - 6}" width="${w + 12}" height="${h + 12}" rx="34" fill="#2a2a32"/>
		<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="28" fill="#121217" stroke="#3a3a44" stroke-width="2"/>
		${cells}`;
}

function text(x, y, str, size, { weight = 600, color = INK, anchor = "start", spacing = 0 } = {}) {
	return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}" letter-spacing="${spacing}">${str}</text>`;
}

/**
 * Wraps a scene in a canvas with the background gradient. Scenes are designed at 1920×960; for other
 * aspect ratios the scene is scaled to the canvas width and centred vertically on the same background.
 */
function frame(w, h, inner, { designW = w, designH = h } = {}) {
	const scale = w / designW;
	const dy = (h - designH * scale) / 2;
	const body = scale === 1 && dy === 0 ? inner : `<g transform="translate(0 ${dy}) scale(${scale})">${inner}</g>`;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
		<defs>
			<radialGradient id="glow" cx="0.8" cy="0.2" r="0.9">
				<stop offset="0" stop-color="#312e81" stop-opacity="0.9"/>
				<stop offset="1" stop-color="${BG}" stop-opacity="0"/>
			</radialGradient>
		</defs>
		<rect width="${w}" height="${h}" fill="${BG}"/>
		<rect width="${w}" height="${h}" fill="url(#glow)"/>
		${body}
	</svg>`;
}

/** A 1920×960 scene. `at(w, h)` renders it on a canvas of another size. */
function scene(inner) {
	return { at: (w, h) => frame(w, h, inner, { designW: 1920, designH: 960 }) };
}

// ---- compositions (designed at 1920×960, scaled for other sizes) ----------------------------------

/** Hero: headline + device with the four keys in a Meet call. */
function hero() {
	return scene(`
		<image x="120" y="120" width="120" height="120" href="${mark}"/>
		${text(270, 206, "SimpleMute", 72, { weight: 700 })}
		${text(120, 330, "One mute key for every", 68, { weight: 700 })}
		${text(120, 410, "browser meeting.", 68, { weight: 700 })}
		${text(120, 500, "Mutes whatever call is running in your browser.", 34, { weight: 400, color: MUTED })}
		${text(120, 548, "Keys show live state and the app they control.", 34, { weight: 400, color: MUTED })}
		${text(120, 640, "GOOGLE MEET   ·   ZOOM WEB   ·   MICROSOFT TEAMS WEB", 24, { weight: 700, color: ACCENT, spacing: 2 })}
		${device(1060, 190, ["mic-on-meet", "camera-off-meet", "share-off-meet", "leave-active-meet", "mic-off-system", null], { size: 190, gap: 28, pad: 44 })}`);
}

/** Live state: the same key across apps and states. */
function states() {
	const row = (y, name, label) => `
		<image x="160" y="${y}" width="180" height="180" href="${key(name)}"/>
		${text(390, y + 108, label, 40, { weight: 500 })}`;
	return scene(`
		${text(120, 150, "The key always shows the truth.", 64, { weight: 700 })}
		${row(230, "mic-on-meet", "Live in Google Meet")}
		${row(450, "mic-off-zoom", "Muted in Zoom")}
		${row(670, "mic-on-system", "No call: controls your Mac's microphone")}
		${device(1180, 220, ["mic-on-teams", "camera-on-teams", "share-on-teams", "leave-active-teams", "mic-off-meet", "camera-off-zoom"], { size: 170, gap: 26, pad: 40 })}`);
}

/** Flow diagram: how the pieces connect. */
function flow() {
	const box = (x, y, w, title, sub) => `
		<rect x="${x}" y="${y}" width="${w}" height="170" rx="24" fill="#1c1c24" stroke="#3f3f4a" stroke-width="2"/>
		${text(x + w / 2, y + 78, title, 36, { weight: 700, anchor: "middle" })}
		${text(x + w / 2, y + 126, sub, 24, { weight: 400, color: MUTED, anchor: "middle" })}`;
	const arrow = (x, y) => `<path d="M${x} ${y} h70 m-18 -18 l18 18 l-18 18" fill="none" stroke="${ACCENT}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`;
	return scene(`
		${text(120, 150, "Nothing leaves your machine.", 64, { weight: 700 })}
		${text(120, 215, "The plugin talks to the browser extension over localhost. No cloud, no accounts, no data collection.", 30, { weight: 400, color: MUTED })}
		${box(120, 400, 380, "Stream Deck", "key press")}
		${arrow(520, 485)}
		${box(610, 400, 380, "SimpleMute plugin", "ws://127.0.0.1:51234")}
		${arrow(1010, 485)}
		${box(1100, 400, 380, "Browser extension", "finds the meeting tab")}
		${arrow(1500, 485)}
		${box(1590, 400, 210, "Meeting", "click")}
		<image x="120" y="660" width="150" height="150" href="${key("mic-off-meet")}"/>
		${text(300, 720, "Mic muted in the meeting", 32, { weight: 600 })}
		${text(300, 765, "The key updates within a second, whichever side you press.", 26, { weight: 400, color: MUTED })}`);
}

/** Profiles: two Chrome profiles, one key. */
function profiles() {
	const profile = (x, name, keys) => `
		${text(x + 170, 300, name, 32, { weight: 700, anchor: "middle", color: MUTED })}
		${device(x, 330, keys, { cols: 2, size: 150, gap: 20, pad: 30 })}`;
	return scene(`
		${text(120, 150, "Several profiles, one key.", 64, { weight: 700 })}
		${text(120, 215, "Work and personal Chrome profiles stay connected at once. The key follows the meeting you looked at last.", 30, { weight: 400, color: MUTED })}
		${profile(260, "WORK PROFILE", ["mic-on-meet", "camera-off-meet", "share-off-meet", "leave-active-meet"])}
		${profile(760, "PERSONAL PROFILE", ["mic-off-zoom", "camera-off-zoom", "share-off-zoom", "leave-active-zoom"])}
		<image x="1330" y="330" width="380" height="380" href="${key("mic-on-meet")}"/>
		${text(1520, 790, "Stream Deck key", 30, { weight: 600, anchor: "middle", color: MUTED })}`);
}

/** Promo tile: brand mark and keys, no text (store guidance). */
function promo(w, h) {
	const s = h / 280;
	return frame(
		w,
		h,
		`
		<image x="${40 * s}" y="${60 * s}" width="${160 * s}" height="${160 * s}" href="${mark}"/>
		${["mic-on-meet", "mic-off-zoom", "camera-on-teams"]
			.map((k, i) => `<image x="${(230 + i * 70) * s}" y="${(105 * s)}" width="${60 * s}" height="${60 * s}" href="${key(k)}"/>`)
			.join("")}`);
}

/** Chrome store icon: 96 px artwork centred on a 128 px transparent canvas. */
function storeIcon() {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><image x="16" y="16" width="96" height="96" href="${mark}"/></svg>`;
}

function appIcon288() {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="288" height="288"><image width="288" height="288" href="${mark}"/></svg>`;
}

// ---- render ----------------------------------------------------------------------------------------

function render(file, svg, width) {
	mkdirSync(path.dirname(file), { recursive: true });
	const png = new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: true } }).render().asPng();
	writeFileSync(file, png);
	console.log(path.relative(root, file));
}

const scenes = [hero(), states(), flow(), profiles()];

render(path.join(out.chrome, "icon-128.png"), storeIcon(), 128);
render(path.join(out.chrome, "promo-small-440x280.png"), promo(440, 280), 440);
render(path.join(out.chrome, "promo-marquee-1400x560.png"), promo(1400, 560), 1400);
scenes.forEach((sc, i) => render(path.join(out.chrome, `screenshot-${i + 1}-1280x800.png`), sc.at(1280, 800), 1280));

render(path.join(out.elgato, "app-icon-288.png"), appIcon288(), 288);
render(path.join(out.elgato, "thumbnail-1920x960.png"), scenes[0].at(1920, 960), 1920);
scenes.slice(1).forEach((sc, i) => render(path.join(out.elgato, `gallery-${i + 1}-1920x960.png`), sc.at(1920, 960), 1920));

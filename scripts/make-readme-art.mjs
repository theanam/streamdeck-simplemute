/**
 * Renders the README's install explainer (docs/install.png) from SVG, reusing the plugin's key art.
 *   node scripts/make-readme-art.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { Resvg } = require("../plugin/node_modules/@resvg/resvg-js");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imgs = path.join(root, "plugin", "co.anam.simplemute.sdPlugin", "imgs");
const uri = (f) => `data:image/png;base64,${readFileSync(f).toString("base64")}`;
const mark = uri(path.join(imgs, "plugin", "marketplace@2x.png"));
const key = (n) => uri(path.join(imgs, "keys", `${n}.png`));
const ext = uri(path.join(root, "extension", "icons", "icon128.png"));

const FONT = "Helvetica Neue, Helvetica, Arial, sans-serif";
const W = 1600;
const H = 520;
const INK = "#f4f4f5";
const MUTED = "#a1a1aa";
const ACCENT = "#818cf8";

const t = (x, y, s, size, o = {}) =>
	`<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${o.w ?? 600}" fill="${o.c ?? INK}" text-anchor="${o.a ?? "start"}">${s}</text>`;

/** One step panel: number, title, what to do, and an illustration area. */
function panel(x, n, title, line1, line2, art) {
	const w = 700;
	return `
		<rect x="${x}" y="60" width="${w}" height="400" rx="28" fill="#17171c" stroke="#2e2e36" stroke-width="2"/>
		<circle cx="${x + 56}" cy="116" r="26" fill="${ACCENT}"/>
		${t(x + 56, 127, n, 30, { a: "middle", w: 700, c: "#0f0f14" })}
		${t(x + 104, 128, title, 34, { w: 700 })}
		${t(x + 40, 190, line1, 24, { w: 400, c: MUTED })}
		${t(x + 40, 226, line2, 24, { w: 400, c: MUTED })}
		${art(x, 260)}`;
}

/** Plugin step: brand mark dropping into a Stream Deck with keys. */
const pluginArt = (x, y) => `
	<image x="${x + 40}" y="${y}" width="150" height="150" href="${mark}"/>
	<path d="M${x + 210} ${y + 75} h60 m-16 -16 l16 16 l-16 16" fill="none" stroke="${ACCENT}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
	<rect x="${x + 300}" y="${y - 10}" width="360" height="170" rx="22" fill="#121217" stroke="#3a3a44" stroke-width="2"/>
	${["mic-on-meet", "camera-off-meet", "share-off-meet"].map((k, i) => `<image x="${x + 322 + i * 110}" y="${y + 12}" width="96" height="96" href="${key(k)}"/>`).join("")}
	${t(x + 480, y + 148, "Stream Deck app", 20, { a: "middle", w: 500, c: MUTED })}`;

/** Extension step: extension icon dropping into a browser window with a meeting tab. */
const extensionArt = (x, y) => `
	<image x="${x + 40}" y="${y}" width="150" height="150" href="${ext}"/>
	<path d="M${x + 210} ${y + 75} h60 m-16 -16 l16 16 l-16 16" fill="none" stroke="${ACCENT}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
	<rect x="${x + 300}" y="${y - 10}" width="360" height="170" rx="16" fill="#121217" stroke="#3a3a44" stroke-width="2"/>
	<rect x="${x + 300}" y="${y - 10}" width="360" height="40" rx="16" fill="#1f1f26"/>
	<rect x="${x + 300}" y="${y + 14}" width="360" height="16" fill="#1f1f26"/>
	<circle cx="${x + 322}" cy="${y + 10}" r="6" fill="#ff5f57"/><circle cx="${x + 342}" cy="${y + 10}" r="6" fill="#febc2e"/><circle cx="${x + 362}" cy="${y + 10}" r="6" fill="#28c840"/>
	<rect x="${x + 390}" y="${y - 2}" width="190" height="24" rx="8" fill="#2a2a32"/>
	${t(x + 485, y + 15, "meet.google.com", 15, { a: "middle", w: 500, c: MUTED })}
	<image x="${x + 622}" y="${y - 4}" width="28" height="28" href="${ext}"/>
	<rect x="${x + 330}" y="${y + 50}" width="300" height="90" rx="10" fill="#0f0f14"/>
	<image x="${x + 436}" y="${y + 58}" width="40" height="40" href="${key("mic-on")}"/>
	<image x="${x + 486}" y="${y + 58}" width="40" height="40" href="${key("camera-on")}"/>
	${t(x + 480, y + 128, "your meeting tab", 18, { a: "middle", w: 500, c: MUTED })}
	${t(x + 480, y + 148, "", 1)}`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
	<rect width="${W}" height="${H}" fill="#0f0f14"/>
	${panel(60, "1", "Stream Deck plugin", "Install it from the Elgato Marketplace, or download the", "file and double-click it. It runs inside the Stream Deck app.", pluginArt)}
	${panel(840, "2", "Browser extension", "Add it from the Chrome Web Store, once per browser profile.", "It finds the meeting tab and clicks its buttons for you.", extensionArt)}
	${t(W / 2, 500, "They talk to each other on your machine only. Then drag the Mute key onto your Stream Deck.", 22, { a: "middle", w: 400, c: MUTED })}
</svg>`;

mkdirSync(path.join(root, "docs"), { recursive: true });
const png = new Resvg(svg, { fitTo: { mode: "width", value: W }, font: { loadSystemFonts: true } }).render().asPng();
writeFileSync(path.join(root, "docs", "install.png"), png);
console.log("docs/install.png");

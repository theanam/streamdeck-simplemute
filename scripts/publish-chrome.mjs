/**
 * Uploads store/chrome/simplemute-extension.zip to an existing Chrome Web Store item and, with
 * --publish, submits it for review. Uses the Chrome Web Store Publish API.
 *
 *   npm run pack:extension
 *   node scripts/publish-chrome.mjs            # upload only (new draft version)
 *   node scripts/publish-chrome.mjs --publish  # upload and submit for review
 *   node scripts/publish-chrome.mjs --token    # one-time: obtain the refresh token
 *
 * One-time setup (all in the browser):
 *   1. console.cloud.google.com → create a project → enable "Chrome Web Store API".
 *   2. APIs & Services → Credentials → Create OAuth client ID, type "Desktop app". Note the client id and secret.
 *   3. OAuth consent screen → add your Google account as a test user.
 *   4. Run `node scripts/publish-chrome.mjs --token` with CWS_CLIENT_ID and CWS_CLIENT_SECRET set,
 *      open the URL it prints, approve, paste the code back. It prints CWS_REFRESH_TOKEN.
 *   5. Create the item once in the Web Store developer dashboard (upload the zip there, fill in the
 *      listing and privacy tabs). Its 32-character id is in the dashboard URL: that is CWS_ITEM_ID.
 *
 * Environment: CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN, CWS_ITEM_ID (a .env file in the
 * repo root is read if present; it is gitignored).
 */
import { createInterface } from "node:readline/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const zip = path.join(root, "store", "chrome", "simplemute-extension.zip");

// Minimal .env loader so secrets stay out of the shell history.
const envFile = path.join(root, ".env");
if (existsSync(envFile)) {
	for (const line of readFileSync(envFile, "utf8").split("\n")) {
		const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
		if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
	}
}

const { CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN, CWS_ITEM_ID } = process.env;
const args = new Set(process.argv.slice(2));

function need(name, value) {
	if (!value) {
		console.error(`Missing ${name}. See the comment at the top of scripts/publish-chrome.mjs.`);
		process.exit(1);
	}
	return value;
}

async function getRefreshToken() {
	need("CWS_CLIENT_ID", CWS_CLIENT_ID);
	need("CWS_CLIENT_SECRET", CWS_CLIENT_SECRET);
	const redirect = "urn:ietf:wg:oauth:2.0:oob";
	const url =
		`https://accounts.google.com/o/oauth2/auth?response_type=code&scope=https://www.googleapis.com/auth/chromewebstore` +
		`&client_id=${encodeURIComponent(CWS_CLIENT_ID)}&redirect_uri=${encodeURIComponent(redirect)}&access_type=offline&prompt=consent`;
	console.log(`Open this URL, approve access, then paste the code:\n\n${url}\n`);
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const code = (await rl.question("Code: ")).trim();
	rl.close();
	const res = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ code, client_id: CWS_CLIENT_ID, client_secret: CWS_CLIENT_SECRET, redirect_uri: redirect, grant_type: "authorization_code" }),
	});
	const json = await res.json();
	if (!json.refresh_token) {
		console.error("No refresh token in response:", json);
		process.exit(1);
	}
	console.log(`\nCWS_REFRESH_TOKEN=${json.refresh_token}\n\nPut that in .env (gitignored) together with CWS_CLIENT_ID, CWS_CLIENT_SECRET and CWS_ITEM_ID.`);
}

async function accessToken() {
	need("CWS_CLIENT_ID", CWS_CLIENT_ID);
	need("CWS_CLIENT_SECRET", CWS_CLIENT_SECRET);
	need("CWS_REFRESH_TOKEN", CWS_REFRESH_TOKEN);
	const res = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ client_id: CWS_CLIENT_ID, client_secret: CWS_CLIENT_SECRET, refresh_token: CWS_REFRESH_TOKEN, grant_type: "refresh_token" }),
	});
	const json = await res.json();
	if (!json.access_token) {
		console.error("Could not get an access token:", json);
		process.exit(1);
	}
	return json.access_token;
}

async function upload(token) {
	if (!existsSync(zip)) {
		console.error(`${path.relative(root, zip)} is missing; run npm run pack:extension first.`);
		process.exit(1);
	}
	const res = await fetch(`https://www.googleapis.com/upload/chromewebstore/v1.1/items/${CWS_ITEM_ID}`, {
		method: "PUT",
		headers: { Authorization: `Bearer ${token}`, "x-goog-api-version": "2" },
		body: readFileSync(zip),
	});
	const json = await res.json();
	if (json.uploadState !== "SUCCESS") {
		console.error("Upload failed:", JSON.stringify(json, null, 2));
		process.exit(1);
	}
	console.log(`Uploaded ${path.relative(root, zip)} to item ${CWS_ITEM_ID} (state: ${json.uploadState}).`);
}

async function publish(token) {
	const res = await fetch(`https://www.googleapis.com/chromewebstore/v1.1/items/${CWS_ITEM_ID}/publish`, {
		method: "POST",
		headers: { Authorization: `Bearer ${token}`, "x-goog-api-version": "2", "Content-Length": "0" },
	});
	const json = await res.json();
	console.log("Publish response:", JSON.stringify(json, null, 2));
	if (!(json.status || []).includes("OK") && !(json.status || []).includes("ITEM_PENDING_REVIEW")) process.exit(1);
}

if (args.has("--token")) {
	await getRefreshToken();
} else {
	need("CWS_ITEM_ID", CWS_ITEM_ID);
	const token = await accessToken();
	await upload(token);
	if (args.has("--publish")) await publish(token);
	else console.log("Draft uploaded. Re-run with --publish to submit it for review.");
}

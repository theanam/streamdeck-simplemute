// Zips the extension for the Chrome Web Store, leaving out tests and OS cruft.
// Before zipping, checks the manifest against the store's hard limits so a rejected upload never happens.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extDir = path.join(root, "extension");
const outDir = path.join(root, "store", "chrome");
const zip = path.join(outDir, "simplemute-extension.zip");

// Chrome Web Store limits (developer.chrome.com/docs/webstore/prepare and the dashboard's own validation).
const LIMITS = { name: 45, short_name: 12, description: 132 };

const manifest = JSON.parse(readFileSync(path.join(extDir, "manifest.json"), "utf8"));
const problems = [];

if (manifest.manifest_version !== 3) problems.push("manifest_version must be 3");
for (const [field, max] of Object.entries(LIMITS)) {
	const value = manifest[field];
	if (value !== undefined && typeof value !== "string") problems.push(`${field} must be a string`);
	if (typeof value === "string" && value.length > max) problems.push(`${field} is ${value.length} characters; the store allows ${max}`);
}
if (!manifest.name) problems.push("name is required");
if (!manifest.description) problems.push("description is required");
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version || "")) problems.push(`version "${manifest.version}" must be 1 to 4 dot-separated integers`);
for (const size of ["16", "48", "128"]) {
	const file = manifest.icons?.[size];
	if (!file) problems.push(`icons.${size} is required by the store`);
	else if (!existsSync(path.join(extDir, file))) problems.push(`icons.${size} points to a missing file: ${file}`);
}
for (const field of ["key", "update_url"]) {
	if (field in manifest) problems.push(`${field} must not be in a store upload; the store sets it`);
}
if (manifest.background && !manifest.background.service_worker) problems.push("MV3 background must declare a service_worker");
for (const script of manifest.content_scripts || []) {
	for (const file of script.js || []) {
		if (!existsSync(path.join(extDir, file))) problems.push(`content script file missing: ${file}`);
	}
}

if (problems.length) {
	console.error("Chrome Web Store compatibility problems:\n - " + problems.join("\n - "));
	process.exit(1);
}
console.log(`manifest ok: name ${manifest.name.length}/${LIMITS.name}, description ${manifest.description.length}/${LIMITS.description}, version ${manifest.version}`);

mkdirSync(outDir, { recursive: true });
rmSync(zip, { force: true });
execFileSync("zip", ["-r", "-q", zip, ".", "-x", "test/*", ".DS_Store", "*/.DS_Store"], { cwd: extDir, stdio: "inherit" });
console.log(path.relative(root, zip));
execFileSync("unzip", ["-l", zip], { stdio: "inherit" });

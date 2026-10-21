// Syntax-checks every extension JS file and validates manifest.json. Used by `npm run check`.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ext = path.join(root, "extension");

function walk(dir) {
	return readdirSync(dir).flatMap((name) => {
		const file = path.join(dir, name);
		if (name === "node_modules" || name === "test") return [];
		return statSync(file).isDirectory() ? walk(file) : file.endsWith(".js") ? [file] : [];
	});
}

let failed = false;
for (const file of walk(ext)) {
	try {
		execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
		console.log(`ok   ${path.relative(root, file)}`);
	} catch (err) {
		failed = true;
		console.error(`FAIL ${path.relative(root, file)}\n${err.stderr}`);
	}
}

try {
	const manifest = JSON.parse(readFileSync(path.join(ext, "manifest.json"), "utf8"));
	if (manifest.manifest_version !== 3) throw new Error("manifest_version must be 3");
	console.log("ok   extension/manifest.json");
} catch (err) {
	failed = true;
	console.error(`FAIL extension/manifest.json: ${err.message}`);
}

process.exit(failed ? 1 : 0);

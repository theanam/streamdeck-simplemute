// Zips the extension for the Chrome Web Store, leaving out tests and OS cruft.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "store", "chrome");
const zip = path.join(outDir, "simplemute-extension.zip");
mkdirSync(outDir, { recursive: true });
rmSync(zip, { force: true });
execFileSync("zip", ["-r", "-q", zip, ".", "-x", "test/*", ".DS_Store", "*/.DS_Store"], { cwd: path.join(root, "extension"), stdio: "inherit" });
console.log(path.relative(root, zip));
execFileSync("unzip", ["-l", zip], { stdio: "inherit" });

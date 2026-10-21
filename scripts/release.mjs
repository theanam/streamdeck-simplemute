/**
 * Cuts a release. Enforces the checklist in CLAUDE.md so no step is skipped.
 *
 *   node scripts/release.mjs 0.2.0 --notes "What changed, for the GitHub release and the stores"
 *
 * Steps, in order; any failure stops the release before anything is committed:
 *   1. Working tree must be clean and on main; the tag must not exist yet.
 *   2. Writes the version into both manifests (extension x.y.z, plugin x.y.z.0).
 *   3. Runs the full test suite.
 *   4. Builds the plugin bundle and both packages (npm run pack).
 *   5. Prepends the notes to the release-notes log in store/LISTING.md.
 *   6. Commits "Release x.y.z", tags vx.y.z, pushes main and the tag.
 *   7. Creates the GitHub release with both packages attached.
 * Then it prints what still has to be done by hand (store uploads, README review).
 */
import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extManifest = path.join(root, "extension", "manifest.json");
const pluginManifest = path.join(root, "plugin", "co.anam.simplemute.sdPlugin", "manifest.json");
const listing = path.join(root, "store", "LISTING.md");
const assets = [path.join(root, "store", "elgato", "co.anam.simplemute.streamDeckPlugin"), path.join(root, "store", "chrome", "simplemute-extension.zip")];

const args = process.argv.slice(2);
const version = args.find((a) => /^\d+\.\d+\.\d+$/.test(a));
const notesIndex = args.indexOf("--notes");
const notes = notesIndex >= 0 ? args[notesIndex + 1] : null;

function fail(msg) {
	console.error(`\nRelease aborted: ${msg}`);
	process.exit(1);
}
function sh(cmd, opts = {}) {
	return execSync(cmd, { cwd: root, stdio: opts.quiet ? "pipe" : "inherit", encoding: "utf8" });
}
function run(file, fileArgs) {
	execFileSync(file, fileArgs, { cwd: root, stdio: "inherit" });
}

if (!version) fail("usage: node scripts/release.mjs <x.y.z> --notes \"...\"");
if (!notes || notes.length < 20) fail("--notes is required and should say what changed (at least 20 characters)");

// 1. Preconditions.
if (sh("git status --porcelain", { quiet: true }).trim()) fail("working tree is not clean; commit or stash first");
if (sh("git rev-parse --abbrev-ref HEAD", { quiet: true }).trim() !== "main") fail("releases are cut from main");
if (sh(`git tag -l v${version}`, { quiet: true }).trim()) fail(`tag v${version} already exists`);
try {
	sh("gh auth status", { quiet: true });
} catch {
	fail("gh is not authenticated; run gh auth login");
}

// 2. Versions.
const ext = JSON.parse(readFileSync(extManifest, "utf8"));
const plugin = JSON.parse(readFileSync(pluginManifest, "utf8"));
const previous = ext.version;
if (previous === version) fail(`extension manifest is already at ${version}; bump to a new version`);
ext.version = version;
plugin.Version = `${version}.0`;
writeFileSync(extManifest, JSON.stringify(ext, null, "\t") + "\n");
writeFileSync(pluginManifest, JSON.stringify(plugin, null, "\t") + "\n");
console.log(`Version ${previous} → ${version} (plugin ${plugin.Version})`);

// 3. Tests. 4. Build and pack.
run("npm", ["test"]);
run("npm", ["--prefix", "plugin", "run", "build"]);
run("npm", ["run", "pack"]);
// The Stream Deck CLI rewrites the manifest without a trailing newline; keep the file tidy.
writeFileSync(pluginManifest, JSON.stringify(JSON.parse(readFileSync(pluginManifest, "utf8")), null, "\t") + "\n");
for (const asset of assets) if (!existsSync(asset)) fail(`missing package ${path.relative(root, asset)}`);

// 5. Release notes log.
const date = new Date().toISOString().slice(0, 10);
let text = readFileSync(listing, "utf8");
const marker = "## Release notes";
if (!text.includes(marker)) text += `\n${marker}\n\nNewest first. Paste the matching entry into each store's release-notes field.\n`;
text = text.replace(marker, `${marker}\n\n### ${version} (${date})\n${notes}\n`);
writeFileSync(listing, text);

// 6. Commit, tag, push.
run("git", ["add", "-A"]);
run("git", ["commit", "-q", "-m", `Release ${version}\n\n${notes}\n\nCo-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`]);
run("git", ["tag", `v${version}`]);
run("git", ["push"]);
run("git", ["push", "origin", `v${version}`]);

// 7. GitHub release.
run("gh", ["release", "create", `v${version}`, ...assets, "--title", `SimpleMute ${version}`, "--notes", `${notes}\n\nInstall guide: https://github.com/theanam/streamdeck-simplemute#install`]);

console.log(`
Released ${version}. Still to do by hand:
  1. Chrome Web Store: upload store/chrome/simplemute-extension.zip (or run npm run publish:chrome) and paste the release notes.
  2. Elgato Marketplace: upload store/elgato/co.anam.simplemute.streamDeckPlugin in Maker Console with the release notes.
  3. If behaviour, keys or install steps changed, make sure README.md already says so (it is part of this release commit).
`);

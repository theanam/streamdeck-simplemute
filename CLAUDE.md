# SimpleMute project rules

Rules for anyone (person or agent) working in this repository.

## Commits

- Author every commit as `Anam Ahmed <anam.ahmed.a@gmail.com>`. The repo-local git config sets this; never change the global config.
- Work on `main`; push after each coherent change.

## Releasing

A release is anything that produces a new `.streamDeckPlugin` or extension zip for users. Never hand-edit versions or upload packages built from an unreleased tree. Always run:

```sh
npm run release -- <x.y.z> --notes "What changed, in one or two sentences"
```

The script (`scripts/release.mjs`) refuses to run unless the tree is clean and on `main`, then does, in order: bumps both manifests (extension `x.y.z`, plugin `x.y.z.0`), runs the full test suite, rebuilds the plugin bundle and both packages, adds the notes to the release-notes log in `store/LISTING.md`, commits `Release x.y.z`, tags `vx.y.z`, pushes, and creates the GitHub release with both packages attached.

Before running it, make sure these are already committed in the same tree:

1. **README.md** reflects any change to keys, behaviour, supported sites, requirements or install steps. The README is for repository visitors; keep it free of development history.
2. **PRIVACY.md** still holds if permissions or data handling changed.
3. **store/LISTING.md** descriptions still match the product (store descriptions are pasted from here).
4. **Store assets** regenerated with `npm run assets:store` if the key art or icon changed.

After the script finishes, upload the packages to the stores by hand (Chrome Web Store dashboard or `npm run publish:chrome`; Elgato Maker Console) and paste the release notes.

## Versions

- The extension `version` and the plugin `Version` always move together: `0.2.0` and `0.2.0.0`.
- Both stores reject re-uploads of a version they have already seen, so every upload needs a bump.
- The packaged builds under `store/` are committed and must match the tagged version; `npm run release` keeps that true. Do not commit packages built outside a release.

## Documentation

- Install instructions sit at the top of the README: the explainer image (`docs/install.png`, rendered by `scripts/make-readme-art.mjs`) and the two store badges side by side (`docs/badge-*.png`, official artwork, resize only). Direct downloads are a footnote; build commands live only under Development.
- Store links: Chrome Web Store `https://chromewebstore.google.com/detail/simplemute-for-stream-dec/aioaipbckipbgkgmhagngbchpcbhoemm`, Elgato Marketplace `https://marketplace.elgato.com/product/simplemute-3e505bc6-2650-4048-8475-f86d27ca9adc`. They appear in README, `store/LISTING.md` and `extension/popup.js`.
- The Chrome Web Store caps the manifest `description` at 132 characters and `name` at 45; `npm run pack:extension` enforces this.
- Elgato's Marketplace product name cannot be changed after the first submission.

## Code

- The extension is plain JavaScript with no build step; do not add a bundler, options page, analytics or permissions without asking.
- The plugin bridge (`plugin/src/bridge.ts`) must stay free of Stream Deck SDK imports so it is testable in plain Node.
- Site adapters (`extension/content/*.js`) are the files most likely to need changes; every selector change comes with a jsdom fixture in `extension/test/`.
- Nothing in the extension may surface as an error in `chrome://extensions`; failures are retried quietly at debug level.
- Nothing the plugin owns may keep the Node process alive (`unref` servers, sockets and timers), so a stopped plugin exits.
- The port list appears in exactly two places: `BRIDGE_PORTS` in `plugin/src/config.ts` and `PORTS` in `extension/background.js`.
- The popup (`extension/popup.*`) is the only UI; it needs no extra permissions and asks the worker for status over `sdmc:status`.

## Workspace

- `.vscode/settings.json` carries the Peacock color (#4f46e5, the brand indigo). Keep it committed.
- `npx streamdeck dev` must have been run once on a machine before `streamdeck restart` and `stop` work; the Stream Deck app ignores them otherwise.

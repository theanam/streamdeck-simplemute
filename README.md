# SimpleMute for Stream Deck

Toggle your microphone and camera in browser-based meetings from a Stream Deck key, with key icons that show the live state. SimpleMute is two pieces: a Stream Deck plugin that runs inside the Stream Deck app and hosts a tiny WebSocket server on localhost, and a Chrome extension whose service worker connects to that server and relays commands to a content script in the meeting tab. There is no desktop companion app, no cloud service and no data collection. Google Meet is the primary target; the Zoom web client and Microsoft Teams web are supported with caveats (see [Known limitations](#known-limitations)).

```
Stream Deck key
   │ keyDown
   ▼
Stream Deck app ──launches──▶ Plugin (Node.js, @elgato/streamdeck)
                                │  WebSocket server ws://127.0.0.1:51234
                                │
              command ▼         ▲ state / result
                                │
                    Extension service worker (MV3)
                                │
        chrome.tabs.sendMessage ▼         ▲ chrome.runtime.sendMessage
                                │
            Content script in Meet / Zoom / Teams tab
                (site adapter reads and clicks buttons)
```

## Requirements

- Stream Deck app 7.1 or newer, on macOS 12+ or Windows 10+.
- Node.js 24 or newer (to build the plugin; the Stream Deck app bundles its own runtime).
- Chrome 116 or newer. Edge, Brave and Arc work too since they load the same unpacked extension.

## Setup

### 1. Build and link the plugin

```sh
cd plugin
npm install
npm run build
npx streamdeck link com.anamahmed.simplemute.sdPlugin
```

`link` creates a symlink in the Stream Deck plugins folder. Restart the Stream Deck app (or run `npx streamdeck restart com.anamahmed.simplemute`) and a **SimpleMute** category with *Toggle Microphone* and *Toggle Camera* appears in the action list. Drag either onto a key. A built `bin/plugin.js` is committed, so `npm run build` is only required after changing the source.

Other scripts in `plugin/`: `npm run typecheck`, `npm run validate` (manifest and layout checks), `npm run pack` (creates a `.streamDeckPlugin` installer), `npm run icons` (regenerates every PNG), `npm run watch` (rebuild and restart on change), `npm test`.

### 2. Load the extension

1. Open `chrome://extensions`, turn on **Developer mode**.
2. Click **Load unpacked** and choose the `extension/` folder of this repository.
3. The toolbar icon shows a red `!` badge until the plugin is reachable. Once the Stream Deck app is running with the plugin linked, the badge clears within 30 seconds (usually immediately).

Repeat step 2 in every Chrome profile you use for meetings. Each profile runs its own copy of the extension and keeps its own connection; the keys follow whichever profile's meeting you focused or joined most recently.

Tabs already open on Meet, Zoom or Teams get the content script injected when the extension installs or updates, so there is no need to reload them.

## What the key colors mean

| Key | Meaning |
| --- | --- |
| Green, no slash | A meeting was found and the mic or camera is live. Press to mute / turn off. |
| Red, slashed | A meeting was found and the mic is muted or the camera is off. Press to unmute / turn on. |
| Grey, slashed | The extension is connected but no meeting is open, or the button state could not be read. Pressing shows an alert. |
| Dark grey, slashed, orange dot | No extension is connected (Chrome closed, extension disabled, or the plugin cannot bind its port). Pressing shows an alert. |

If you set a custom image on a key in the Stream Deck app, Stream Deck ignores the plugin's images and the key no longer reflects the state. Remove the custom image to restore it.

## Protocol

All traffic is JSON text frames over `ws://127.0.0.1:51234`. The extension is the client and the plugin is the server. Unknown message types are ignored on both sides.

| Direction | Type | Fields | When |
| --- | --- | --- | --- |
| ext → plugin | `hello` | `version`, `clientId` (random UUID persisted per Chrome profile) | Right after connecting |
| ext → plugin | `state` | `inMeeting`, `site` (`"meet"`, `"zoom"`, `"teams"` or null), `mic` and `camera` (`"on"`, `"off"`, `"unknown"`), `focused` | On connect and whenever the target meeting's state changes |
| ext → plugin | `ping` | none | Every 20 s (keeps the MV3 service worker alive) |
| plugin → ext | `command` | `id`, `action` (`"toggle"`), `kind` (`"mic"` or `"camera"`) | On key press |
| ext → plugin | `result` | `id`, `ok`, `error` (optional) | After handling a command |

A `state` always describes one meeting: the one the extension would act on, which is the in-meeting tab the user focused or joined most recently. `result.ok` means the button was found and clicked; the new state arrives separately as a `state` message. When several profiles are connected, the plugin prefers clients that are in a meeting and, among those, the one that most recently entered a meeting or reported `focused: true`. Commands go to that one client only.

## Customizing

**Rename the plugin UUID.** `com.anamahmed.simplemute` appears in six places: `plugin/src/config.ts` (`PLUGIN_UUID`, used for the action UUIDs), `plugin/com.anamahmed.simplemute.sdPlugin/manifest.json` (`UUID` and both action `UUID`s), the folder name itself, `plugin/package.json` (the `watch`, `validate` and `pack` scripts), `plugin/rollup.config.mjs` (`sdPlugin`) and `plugin/scripts/make-icons.mjs` (`sdPlugin`). Rename the folder, update those references, rebuild and re-link.

**Change the port.** The port appears in exactly two places: `BRIDGE_PORT` in `plugin/src/config.ts` and `PORT` in `extension/background.js`. Change both, rebuild the plugin and reload the extension.

**Lock the bridge to one extension ID.** By default the plugin accepts a connection from any `chrome-extension://` origin, which already blocks websites because browsers set the `Origin` header themselves. To restrict it to your extension only, first pin the extension ID so it is stable across machines and profiles: generate a key pair and add its public key as `"key"` in `extension/manifest.json` (see Chrome's documentation on "Keep a consistent extension ID"). Then replace the regular expression in `isAllowedOrigin()` in `plugin/src/config.ts` with an exact comparison against `chrome-extension://<your id>`.

## Fixing a broken selector

Meeting sites change their markup now and then. Each site lives in one file under `extension/content/`, and the service worker and plugin never need to change for a selector fix.

1. Open the meeting in Chrome, open DevTools (F12) and switch to the **Console**. Choose the extension's context in the dropdown at the top of the console (it is named after the extension) and look for `[SimpleMute] state` lines; `inMeeting: false` on a live call means the adapter found no controls.
2. In the **Elements** tab, use the picker to select the mic button. Note a stable attribute: on Meet it is `data-is-muted` plus an `aria-label` ending in the keyboard shortcut; on Zoom a class name such as `join-audio-container__btn`; on Teams the `id` and `data-state`.
3. Edit the matching file (`meet.js`, `zoom.js` or `teams.js`). Each adapter exposes `mic()` and `camera()` that return `{ button, on }` or `null`. Use `util.visible()` so hidden duplicates are skipped and `util.label()` to read the accessible label.
4. Add or update a fixture in `extension/test/<site>.test.js` with the new markup, run `npm test` at the repository root, then reload the extension on `chrome://extensions`.

## Development

```sh
npm install            # root: vitest + jsdom for the extension tests
npm test               # syntax-checks the extension, runs the adapter and worker tests, then the bridge tests
```

The background test binds the real bridge to port 51234, so stop the Stream Deck app (or unlink the plugin) before running it.

Repository layout:

```
plugin/                      Stream Deck plugin (TypeScript, @elgato/streamdeck 3)
  src/plugin.ts              entry: start bridge, register actions, connect
  src/config.ts              port, origin allowlist, timeouts, plugin UUID
  src/bridge.ts              WebSocket server and client tracking (no SDK imports; unit-tested)
  src/icons.ts               key image loader
  src/actions/media-toggle.ts  ToggleMic / ToggleCamera
  scripts/make-icons.mjs     renders every PNG from SVG
  test/bridge.test.ts        bridge tests with real ws clients
  com.anamahmed.simplemute.sdPlugin/   manifest, built bin/plugin.js, generated imgs/
extension/                   Chrome extension (Manifest V3, plain JavaScript, no build step)
  background.js              service worker: connection, frame registry, focus, command relay
  content/common.js          shared content-script runtime
  content/meet.js, zoom.js, teams.js   site adapters
  test/                      jsdom adapter tests and the worker integration test
```

## Known limitations

- Native desktop apps (Zoom desktop, Teams desktop) are not supported; only the browser clients are.
- Zoom's button labels are matched in English only. Meet works in any language because it matches on the keyboard shortcut in the label. Teams support is experimental.
- Only toggle mic and toggle camera exist. No leave call, raise hand or screen share; no Stream Deck+ dial support; no settings UI.
- A key press acts on exactly one meeting: the one focused or joined most recently. There is no way to pin a key to a particular tab or profile.
- Content scripts only read button attributes and call `click()`. They never touch media streams, so the meeting UI always shows the true state, but the key can lag the real state by up to the 400 ms poll interval.
- Stream Deck ignores `setImage` on keys that have a user-set custom image.
- If port 51234 is taken by another program the plugin logs the error and retries every 3 seconds; the keys show the disconnected icon meanwhile.

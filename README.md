# SimpleMute for Stream Deck

A generic mute button for browser-based meetings. SimpleMute lets a Stream Deck key toggle your microphone, camera and screen share, or leave the call, in whatever conferencing site is open in your browser. Key icons show the live state and a small pill naming the site they control. When no meeting is running, the Mute key mutes your Mac's default microphone instead. It is two pieces: a Stream Deck plugin that runs inside the Stream Deck app and hosts a tiny WebSocket server on localhost, and a browser extension whose service worker connects to that server and relays commands to a content script in the meeting tab. There is no desktop companion app, no cloud service and no data collection.

Sites are supported through small adapters, one file each, so adding another conferencing service means adding one adapter. Adapters ship for Google Meet, the Zoom web client and Microsoft Teams web (see [Known limitations](#known-limitations)).

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
npx streamdeck link co.anam.simplemute.sdPlugin
```

`link` creates a symlink in the Stream Deck plugins folder. Run `npx streamdeck dev` once as well: it turns on the Stream Deck app's developer mode, without which the CLI's `restart` and `stop` commands are silently ignored by the app. Restart the Stream Deck app (or run `npx streamdeck restart co.anam.simplemute`) and a **SimpleMute** category with *Toggle Microphone* and *Toggle Camera* appears in the action list. Drag either onto a key. A built `bin/plugin.js` is committed, so `npm run build` is only required after changing the source.

Other scripts in `plugin/`: `npm run typecheck`, `npm run validate` (manifest and layout checks), `npm run pack` (creates a `.streamDeckPlugin` installer), `npm run icons` (regenerates every PNG), `npm run watch` (rebuild and restart on change), `npm test`.

### 2. Load the extension

1. Open `chrome://extensions`, turn on **Developer mode**.
2. Click **Load unpacked** and choose the `extension/` folder of this repository.
3. The toolbar icon shows a red `!` badge until the plugin is reachable. Once the Stream Deck app is running with the plugin linked, the badge clears within 30 seconds (usually immediately).

Repeat step 2 in every Chrome profile you use for meetings. Each profile runs its own copy of the extension and keeps its own connection; the keys follow whichever profile's meeting you focused or joined most recently.

Tabs already open on Meet, Zoom or Teams get the content script injected when the extension installs or updates, so there is no need to reload them.

## Keys

| Key | What it does |
| --- | --- |
| **Mute** | Toggles the microphone of the meeting running in your browser. With no meeting open, it mutes or unmutes the operating system's default input instead (macOS only; the key shows a SYSTEM pill). |
| **Camera** | Toggles the meeting's camera. |
| **Share Screen** | Stops an active screen share. When not sharing it clicks the site's share control; see the limitation below. |
| **Leave Meeting** | Leaves the meeting with a single press. Where the site asks for confirmation (Zoom), the adapter confirms it. |

## What the key colors mean

| Key | Meaning |
| --- | --- |
| Green, no slash, site pill | A meeting was found and the device is live. Press to mute / turn off. |
| Red, slashed, site pill | A meeting was found and the device is muted or off. Press to unmute / turn on. |
| Red handset, site pill | Leave key while in a meeting. |
| Green or red with SYSTEM pill | Mute key with no meeting open, showing the OS input state. An orange dot means the extension is not connected. |
| Grey, slashed | The extension is connected but no meeting is open, or the button state could not be read. Pressing shows an alert. |
| Dark grey, slashed, orange dot | No extension is connected (Chrome closed, extension disabled, or the plugin cannot bind its port). Pressing shows an alert. |

The pill names the site the key is acting on: MEET, ZOOM or TEAMS.

If you set a custom image on a key in the Stream Deck app, Stream Deck ignores the plugin's images and the key no longer reflects the state. Remove the custom image to restore it.

## Protocol

All traffic is JSON text frames over `ws://127.0.0.1:51234`. The extension is the client and the plugin is the server. Unknown message types are ignored on both sides.

| Direction | Type | Fields | When |
| --- | --- | --- | --- |
| ext → plugin | `hello` | `version`, `clientId` (random UUID persisted per Chrome profile) | Right after connecting |
| ext → plugin | `state` | `inMeeting`, `site` (`"meet"`, `"zoom"`, `"teams"` or null), `mic`, `camera` and `share` (`"on"`, `"off"`, `"unknown"`), `focused` | On connect and whenever the target meeting's state changes |
| ext → plugin | `ping` | none | Every 20 s (keeps the MV3 service worker alive) |
| plugin → ext | `command` | `id`, `action` (`"toggle"` or `"leave"`), `kind` (`"mic"`, `"camera"`, `"share"` or `"leave"`) | On key press |
| ext → plugin | `result` | `id`, `ok`, `error` (optional) | After handling a command |

A `state` always describes one meeting: the one the extension would act on, which is the in-meeting tab the user focused or joined most recently. `result.ok` means the button was found and clicked; the new state arrives separately as a `state` message. When several profiles are connected, the plugin prefers clients that are in a meeting and, among those, the one that most recently entered a meeting or reported `focused: true`. Commands go to that one client only.

## Customizing

**Rename the plugin UUID.** `co.anam.simplemute` appears in six places: `plugin/src/config.ts` (`PLUGIN_UUID`, used for the action UUIDs), `plugin/co.anam.simplemute.sdPlugin/manifest.json` (`UUID` and both action `UUID`s), the folder name itself, `plugin/package.json` (the `watch`, `validate` and `pack` scripts), `plugin/rollup.config.mjs` (`sdPlugin`) and `plugin/scripts/make-icons.mjs` (`sdPlugin`). Rename the folder, update those references, rebuild and re-link.

**Change the port.** The port appears in exactly two places: `BRIDGE_PORT` in `plugin/src/config.ts` and `PORT` in `extension/background.js`. Change both, rebuild the plugin and reload the extension.

**Lock the bridge to one extension ID.** By default the plugin accepts a connection from any `chrome-extension://` origin, which already blocks websites because browsers set the `Origin` header themselves. To restrict it to your extension only, first pin the extension ID so it is stable across machines and profiles: generate a key pair and add its public key as `"key"` in `extension/manifest.json` (see Chrome's documentation on "Keep a consistent extension ID"). Then replace the regular expression in `isAllowedOrigin()` in `plugin/src/config.ts` with an exact comparison against `chrome-extension://<your id>`.

## Fixing a broken selector

Meeting sites change their markup now and then. Each site lives in one file under `extension/content/`, and the service worker and plugin never need to change for a selector fix.

1. Open the meeting in Chrome, open DevTools (F12) and switch to the **Console**. Choose the extension's context in the dropdown at the top of the console (it is named after the extension) and look for `[SimpleMute] state` lines; `inMeeting: false` on a live call means the adapter found no controls.
2. In the **Elements** tab, use the picker to select the mic button. Note a stable attribute: on Meet it is `data-is-muted` plus an `aria-label` ending in the keyboard shortcut; on Zoom a class name such as `join-audio-container__btn`; on Teams the `id` and `data-state`.
3. Edit the matching file (`meet.js`, `zoom.js` or `teams.js`). Each adapter exposes `mic()`, `camera()` and `share()` that return `{ button, on }` or `null`, and `leave()` that returns `{ button, confirm? }` or `null`. Use `util.visible()` so hidden duplicates are skipped and `util.label()` to read the accessible label. On Meet, share and leave are found by the Material icon name inside the button (`present_to_all`, `cancel_presentation`, `call_end`), which does not change with the UI language.
4. Add or update a fixture in `extension/test/<site>.test.js` with the new markup, run `npm test` at the repository root, then reload the extension on `chrome://extensions`.

## Development

```sh
npm install            # root: vitest + jsdom for the extension tests
npm test               # syntax-checks the extension, runs the adapter and worker tests, then the bridge tests
```

Tests bind the bridge to random free ports, so they run fine while the Stream Deck app and the extension are active.

Repository layout:

```
plugin/                      Stream Deck plugin (TypeScript, @elgato/streamdeck 3)
  src/plugin.ts              entry: start bridge, register actions, connect
  src/config.ts              port, origin allowlist, timeouts, plugin UUID
  src/bridge.ts              WebSocket server and client tracking (no SDK imports; unit-tested)
  src/icons.ts               key image loader
  src/system-mic.ts          OS default-input mute (macOS via osascript)
  src/actions/media-toggle.ts  Mute, Camera, Share Screen, Leave Meeting keys
  scripts/make-icons.mjs     renders every PNG from SVG
  test/bridge.test.ts        bridge tests with real ws clients
  co.anam.simplemute.sdPlugin/   manifest, built bin/plugin.js, generated imgs/
extension/                   Chrome extension (Manifest V3, plain JavaScript, no build step)
  background.js              service worker: connection, frame registry, focus, command relay
  content/common.js          shared content-script runtime
  content/meet.js, zoom.js, teams.js   site adapters
  test/                      jsdom adapter tests and the worker integration test
```

## Known limitations

- Native desktop apps (Zoom desktop, Teams desktop) are not supported; only the browser clients are.
- Zoom's button labels are matched in English only. Meet works in any language because it matches on the keyboard shortcut in the label. Teams support is experimental.
- **Starting a screen share from a key is limited by the browser.** Chrome only opens the screen picker from a real click or key press inside the page, and a Stream Deck press is not one. The Share Screen key clicks the site's share control, which on some sites opens the picker and on others is ignored. Stopping a share always works.
- **System mic fallback is macOS only.** It uses the system input volume (mute sets it to 0 and unmute restores the previous level), so it affects every app. Windows and Linux show the idle icon when no meeting is running.
- Leave Meeting leaves on a single press with no confirmation from the Stream Deck side.
- No raise hand, no Stream Deck+ dial support, no settings UI.
- A key press acts on exactly one meeting: the one focused or joined most recently. There is no way to pin a key to a particular tab or profile.
- Content scripts only read button attributes and call `click()`. They never touch media streams, so the meeting UI always shows the true state, but the key can lag the real state by up to the 400 ms poll interval.
- Stream Deck ignores `setImage` on keys that have a user-set custom image.
- If port 51234 is taken by another program the plugin logs the error and retries every 3 seconds; the keys show the disconnected icon meanwhile.

## Error handling

Nothing in the extension is meant to surface as an error in `chrome://extensions`. All failures it can hit are transient (plugin not running, tab closed mid-command, worker restarted by Chrome) and are retried on the next alarm, heartbeat or reconnect; they are logged at debug level only. Two details worth knowing:

- Before opening its WebSocket, the worker sends a plain HTTP request to the plugin's port. Chrome logs a failed WebSocket handshake as an extension error and nothing can suppress that, whereas a failed `fetch` is just a rejected promise. The plugin answers the probe with `426 Upgrade Required`, which is enough to know it is up. While the Stream Deck app is closed the worker probes every 1 to 10 seconds in silence.
- The plugin never keeps its own process alive: the bridge's listener, client sockets and timers are all `unref`ed, so when Stream Deck stops or uninstalls the plugin the process exits and frees the port instead of lingering.

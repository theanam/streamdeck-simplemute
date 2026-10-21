# Store listings

Copy for the Chrome Web Store and the Elgato Marketplace, plus the exact files to upload. Regenerate images with `npm run assets:store`; build the uploadable packages with `npm run pack`.

## Chrome Web Store

**Name:** SimpleMute for Stream Deck

**Summary (132 characters max):**
Lets a Stream Deck key mute your mic, camera and screen share in browser meetings. Companion to the SimpleMute Stream Deck plugin.

**Description:**
One mute key for every browser meeting.

SimpleMute connects your Stream Deck to the meeting running in your browser. Press a key and it mutes or unmutes your microphone, turns your camera on or off, stops a screen share, or leaves the call. The keys show the live state, so a glance at your Stream Deck tells you whether you're muted, and a small label on each key names the app it is controlling.

Works with
• Google Meet
• Zoom (web client)
• Microsoft Teams (web)
Any Chrome profile, with the key following the meeting you looked at last.

This extension is the browser half of SimpleMute. It needs the free SimpleMute Stream Deck plugin running in the Stream Deck app; on its own it does nothing. Install both, drop the Mute key on your Stream Deck, and you're done.

Private by design
• Everything stays on your computer. The extension talks only to the plugin over localhost (127.0.0.1).
• No account, no cloud service, no analytics, no data collection.
• It never touches your audio or video. It only clicks the meeting's own buttons, so the meeting always shows the true state.
• It runs only on meeting pages.

Requirements
• Chrome 116 or newer (Edge, Brave and Arc work too)
• Stream Deck app 7.1 or newer with the SimpleMute plugin

Open source
Code, setup guide and plugin download: https://github.com/theanam/streamdeck-simplemute
Stream Deck plugin: Elgato Marketplace link coming soon.

**Category:** Productivity → Tools. **Language:** English.

**Single purpose description (Privacy tab):**
Relays mute, camera, share and leave commands from the SimpleMute Stream Deck plugin (via localhost) to the meeting open in the browser, and reports the meeting's state back.

**Permission justifications (Privacy tab):**
- `alarms`: wakes the service worker every 30 seconds to reconnect to the local plugin if the connection dropped.
- `scripting`: injects the content script into meeting tabs that are already open when the extension is installed or updated, so users do not have to reload them.
- `storage`: stores one random identifier per Chrome profile so the plugin can tell profiles apart. Nothing else is stored.
- Host permissions (meet.google.com, *.zoom.us/wc, teams.microsoft.com, teams.live.com, teams.cloud.microsoft): needed to read the mic/camera/share button state on meeting pages and click them.
- Remote code: none. All code ships in the package.

**Data usage disclosure:** the extension does not collect or transmit user data. Check "This item does not collect user data" in the dashboard.

**Privacy policy URL:** https://github.com/theanam/streamdeck-simplemute/blob/main/PRIVACY.md

**Files to upload:**
- Package: `store/chrome/simplemute-extension.zip`
- Icon: `store/chrome/icon-128.png`
- Screenshots: `store/chrome/screenshot-1-1280x800.png` … `screenshot-4-1280x800.png`
- Small promo tile (required): `store/chrome/promo-small-440x280.png`
- Marquee (optional): `store/chrome/promo-marquee-1400x560.png`

**Before uploading:** bump `version` in `extension/manifest.json` for every new upload; the store rejects a version it has already seen.

**Updates after the first release:** `npm run publish:chrome` packs the zip, uploads it to the existing item and submits it for review through the Publish API. One-time credential setup is described at the top of `scripts/publish-chrome.mjs`; the listing itself is only editable in the dashboard.

## Elgato Marketplace

**Product name (30 characters max, cannot be changed later):** SimpleMute

**Description (250 to 1500 characters, first 250 matter most for search):**
One mute key for every browser-based meeting. SimpleMute detects the meeting running in your browser (Google Meet, Zoom web client or Microsoft Teams web) and mutes or unmutes it from a Stream Deck key. Keys show live on/off state and a small pill naming the app they control, so you always know what a press will do. Four actions: Mute, Camera, Share Screen and Leave Meeting. With no meeting open, the Mute key mutes your Mac's microphone instead. Everything runs on your machine: the plugin talks to a small browser extension over localhost, with no cloud, no account and no data collection.

Requirements: Stream Deck 7.1 or newer, Chrome 116 or newer (or Edge, Brave, Arc) with the free SimpleMute browser extension installed. Screen share can be stopped from the key; starting one is limited by the browser to a click inside the page. The system microphone fallback is macOS only.

**Tags:** meetings, mute, microphone, camera, Google Meet, Zoom, Teams, browser, video call.

**Additional links:** repository (README with setup and troubleshooting), extension install page (Chrome Web Store URL once published).

**Release notes (first version):** Initial release. Mute, Camera, Share Screen and Leave Meeting keys for Google Meet, Zoom web and Teams web; live key state with app pill; macOS system mic fallback.

**Files to upload:**
- Product file: `store/elgato/co.anam.simplemute.streamDeckPlugin`
- App icon: `store/elgato/app-icon-288.png`
- Thumbnail: `store/elgato/thumbnail-1920x960.png`
- Gallery (3 minimum): `store/elgato/gallery-1-1920x960.png` … `gallery-3-1920x960.png`

**Before uploading:** bump `Version` in the plugin manifest (four-part, e.g. `0.1.1.0`); Maker Console requires a higher version for each new upload.

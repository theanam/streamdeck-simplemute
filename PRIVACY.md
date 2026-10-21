# SimpleMute Privacy Policy

Effective date: 22 October 2026

SimpleMute is a Stream Deck plugin and a companion browser extension that let a Stream Deck key mute or unmute your microphone, camera and screen share in browser-based meetings. This policy explains what the software does with data. The short version: it collects nothing, and nothing leaves your computer.

## What SimpleMute does not do

- It does not collect, store or transmit personal data.
- It does not use analytics, telemetry, crash reporting or advertising.
- It does not create accounts or contact any server on the internet.
- It does not access, record or process your audio or video. It only clicks the mute, camera, share and leave buttons that the meeting website already shows you.
- It does not read page content beyond the state of those buttons, and it does not read your meeting's participants, chat or name.
- It is not sold, and it contains no remote code.

## How the two parts communicate

The Stream Deck plugin opens a small server on your own computer at `127.0.0.1`, on port 51234 or the next free one up to 51237. The browser extension connects to it over that loopback address only. The messages exchanged are limited to: whether a meeting is open, which supported site it is on (Meet, Zoom or Teams), whether the microphone, camera and screen share are on or off, whether the meeting tab is focused, and the commands sent by key presses. None of this is written to disk or sent anywhere else.

The plugin only accepts connections from a browser extension origin, so web pages cannot connect to it.

## Data stored on your device

- **Extension:** one randomly generated identifier, stored in the browser's extension storage for the profile the extension is installed in. It lets the plugin tell one browser profile from another when several are connected. It is not tied to you, your Google account or anything else, and it is deleted when you remove the extension.
- **Plugin:** log files written by the Stream Deck SDK into the plugin's own folder for troubleshooting. They record connection events and command outcomes, not meeting content. You can delete them at any time.

## Browser permissions and why they are needed

- `alarms`: wakes the extension's background worker periodically to reconnect to the local plugin.
- `scripting`: injects the extension's script into meeting tabs that were already open when the extension was installed or updated.
- `storage`: holds the identifier described above.
- Site access to `meet.google.com`, `*.zoom.us/wc`, `teams.microsoft.com`, `teams.live.com` and `teams.cloud.microsoft`: required to read the state of the meeting's buttons and click them. The extension runs on no other sites.

## System microphone (macOS)

When no meeting is open, the Mute key can mute or unmute the Mac's default audio input by changing the system input volume. This is done locally through the operating system and involves no data collection.

## Third parties

SimpleMute interacts with the meeting services you use (Google Meet, Zoom, Microsoft Teams) only by clicking their buttons in your browser. Your use of those services is governed by their own privacy policies. SimpleMute shares nothing with them and receives nothing from them beyond what is visible on the page.

## Children

SimpleMute is a general-purpose productivity tool and is not directed at children. It collects no data from anyone.

## Changes

If this policy changes, the new version will be published at the same address with an updated effective date. Because the software collects no data, changes are expected to be rare and editorial.

## Contact

Questions about this policy: open an issue at https://github.com/theanam/streamdeck-simplemute/issues or email anam.ahmed.a@gmail.com.

Source code: https://github.com/theanam/streamdeck-simplemute

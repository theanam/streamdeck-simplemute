/**
 * Plugin-wide constants. Everything that someone renaming or re-pointing the
 * plugin needs to touch lives here.
 */

/** Plugin UUID. Must match `UUID` and the action UUIDs in manifest.json and the folder name `<UUID>.sdPlugin`. */
export const PLUGIN_UUID = "com.anamahmed.simplemute";

/** Interface the bridge binds to. Keep this on loopback; never use 0.0.0.0. */
export const BRIDGE_HOST = "127.0.0.1";

/**
 * Port of the localhost WebSocket server the extension connects to.
 * The same number is hard-coded in `extension/background.js` (`PORT`); change both together.
 */
export const BRIDGE_PORT = 51234;

/** How long `toggle()` waits for the extension to answer a command before giving up. */
export const COMMAND_TIMEOUT_MS = 2_000;

/** Interval between WebSocket pings; a client that misses one pong is terminated. */
export const HEARTBEAT_INTERVAL_MS = 15_000;

/** Delay before the server tries to listen again after an error such as EADDRINUSE. */
export const SERVER_RETRY_MS = 3_000;

/** Largest frame the server accepts. State and result messages are a few hundred bytes. */
export const MAX_PAYLOAD_BYTES = 64 * 1024;

/**
 * Origin check for incoming WebSocket connections.
 *
 * Browsers set the `Origin` header themselves and web pages cannot override it, so this is the
 * line that keeps a random website from toggling the user's mic. Only extension origins pass:
 * `chrome-extension://` followed by a 32-character ID made of the letters a–p.
 *
 * To lock the bridge to one specific extension, pin the extension ID by adding a `key` to
 * `extension/manifest.json` (so the ID is stable across machines and Chrome profiles), then replace
 * the regular expression below with an exact comparison, e.g.
 *
 *     return origin === "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
 */
export function isAllowedOrigin(origin: string | undefined): boolean {
	if (typeof origin !== "string") {
		return false;
	}
	return /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
}

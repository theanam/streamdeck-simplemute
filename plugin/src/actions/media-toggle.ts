import streamDeck, { action, type KeyDownEvent, SingletonAction, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";

import type { Bridge, BridgeStatus, Kind } from "../bridge";
import { PLUGIN_UUID } from "../config";
import type { KeyImages, KeyStatus } from "../icons";

/** The key action type as the SDK hands it to `onKeyDown`, so no settings generic needs to be spelled out. */
type Key = KeyDownEvent["action"];

/** Maps the bridge status to what a key for `kind` should show. */
export function keyStatusFor(status: BridgeStatus, kind: Kind): KeyStatus {
	if (!status.connected) return "disconnected";
	if (!status.inMeeting) return "idle";
	const device = status[kind];
	return device === "on" || device === "off" ? device : "idle";
}

/**
 * Shared behaviour for the mic and camera keys: render the current status as an image,
 * send a toggle on press, and re-render whenever the bridge status changes.
 */
export abstract class MediaToggle extends SingletonAction {
	protected abstract readonly kind: Kind;

	/** Visible key instances by action id. */
	readonly #keys = new Map<string, Key>();
	/** Last status rendered per key, so unchanged keys are skipped. */
	readonly #rendered = new Map<string, KeyStatus>();

	constructor(
		private readonly bridge: Bridge,
		private readonly images: KeyImages,
	) {
		super();
		bridge.on("change", () => void this.renderAll());
	}

	override onWillAppear(ev: WillAppearEvent): Promise<void> | void {
		if (!ev.action.isKey()) {
			return;
		}
		this.#keys.set(ev.action.id, ev.action);
		return this.render(ev.action);
	}

	override onWillDisappear(ev: WillDisappearEvent): void {
		this.#keys.delete(ev.action.id);
		this.#rendered.delete(ev.action.id);
	}

	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		const ok = await this.bridge.toggle(this.kind);
		if (!ok) {
			await ev.action.showAlert();
		}
		// On success the extension pushes a new state and the bridge's change event re-renders the key.
	}

	private async render(key: Key): Promise<void> {
		const status = keyStatusFor(this.bridge.status, this.kind);
		if (this.#rendered.get(key.id) === status) {
			return;
		}
		this.#rendered.set(key.id, status);
		try {
			await key.setImage(this.images[this.kind][status]);
		} catch (err) {
			streamDeck.logger.warn(`Failed to set ${this.kind} image on ${key.id}: ${String(err)}`);
		}
	}

	private async renderAll(): Promise<void> {
		await Promise.all([...this.#keys.values()].map((key) => this.render(key)));
	}
}

@action({ UUID: `${PLUGIN_UUID}.mic` })
export class ToggleMic extends MediaToggle {
	protected readonly kind = "mic";
}

@action({ UUID: `${PLUGIN_UUID}.camera` })
export class ToggleCamera extends MediaToggle {
	protected readonly kind = "camera";
}

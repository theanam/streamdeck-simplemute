import streamDeck, { action, type KeyDownEvent, SingletonAction, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";

import type { Bridge, BridgeStatus, Kind, ToggleKind } from "../bridge";
import { PLUGIN_UUID } from "../config";
import type { KeyImages } from "../icons";
import type { SystemMic } from "../system-mic";

/** The key action type as the SDK hands it to `onKeyDown`, so no settings generic needs to be spelled out. */
type Key = KeyDownEvent["action"];

/** What the Mute key knows about the OS input when no meeting is running. */
export type SystemMicState = { supported: boolean; muted: boolean | null };

/**
 * Name of the image (see scripts/make-icons.mjs → keyVariants) a key of `kind` should show.
 * In a meeting the key shows the device state plus a pill naming the site. The Mute key falls back
 * to the OS input (SYSTEM pill) when no meeting is running; the orange dot then marks a missing extension.
 */
export function imageNameFor(status: BridgeStatus, kind: Kind, system?: SystemMicState): string {
	const site = status.site ? `-${status.site}` : "";

	if (status.inMeeting) {
		if (kind === "leave") return `leave-active${site}`;
		const device = status[kind];
		return device === "on" || device === "off" ? `${kind}-${device}${site}` : `${kind}-idle`;
	}

	if (kind === "mic" && system?.supported && system.muted !== null) {
		return `mic-${system.muted ? "off" : "on"}-system${status.connected ? "" : "-nolink"}`;
	}

	return `${kind}-${status.connected ? "idle" : "disconnected"}`;
}

/**
 * Shared behaviour for every key: render the current status as an image, act on press, and
 * re-render whenever the bridge status changes.
 */
export abstract class MeetingKey extends SingletonAction {
	protected abstract readonly kind: Kind;

	/** Visible key instances by action id. */
	protected readonly keys = new Map<string, Key>();
	/** Last image rendered per key, so unchanged keys are skipped. */
	readonly #rendered = new Map<string, string>();

	constructor(
		protected readonly bridge: Bridge,
		private readonly images: KeyImages,
	) {
		super();
		bridge.on("change", () => void this.renderAll());
	}

	override onWillAppear(ev: WillAppearEvent): Promise<void> | void {
		if (!ev.action.isKey()) {
			return;
		}
		this.keys.set(ev.action.id, ev.action);
		return this.render(ev.action);
	}

	override onWillDisappear(ev: WillDisappearEvent): void {
		this.keys.delete(ev.action.id);
		this.#rendered.delete(ev.action.id);
	}

	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		const ok = await this.act();
		if (!ok) {
			await ev.action.showAlert();
		}
		// On success the extension pushes a new state and the bridge's change event re-renders the key.
	}

	/** Performs the key's action; `false` shows the alert. */
	protected abstract act(): Promise<boolean>;

	/** Extra state the image depends on besides the bridge status. */
	protected systemState(): SystemMicState | undefined {
		return undefined;
	}

	protected async render(key: Key): Promise<void> {
		const name = imageNameFor(this.bridge.status, this.kind, this.systemState());
		if (this.#rendered.get(key.id) === name) {
			return;
		}
		this.#rendered.set(key.id, name);
		const image = this.images.get(name) ?? this.images.get(`${this.kind}-idle`);
		try {
			await key.setImage(image);
		} catch (err) {
			streamDeck.logger.warn(`Failed to set image ${name} on ${key.id}: ${String(err)}`);
		}
	}

	protected async renderAll(): Promise<void> {
		await Promise.all([...this.keys.values()].map((key) => this.render(key)));
	}
}

/** A key that toggles one device in the meeting. */
abstract class ToggleKey extends MeetingKey {
	protected abstract override readonly kind: ToggleKind;

	protected act(): Promise<boolean> {
		return this.bridge.toggle(this.kind);
	}
}

const SYSTEM_POLL_MS = 2_000;

/**
 * The Mute key. In a meeting it toggles the meeting's microphone; otherwise it mutes and unmutes
 * the operating system's default input, polling its state while any Mute key is visible.
 */
@action({ UUID: `${PLUGIN_UUID}.mic` })
export class ToggleMic extends MeetingKey {
	protected readonly kind = "mic";
	#system: SystemMicState;
	#poll: NodeJS.Timeout | null = null;

	constructor(
		bridge: Bridge,
		images: KeyImages,
		private readonly systemMic: SystemMic,
	) {
		super(bridge, images);
		this.#system = { supported: systemMic.supported, muted: null };
	}

	override onWillAppear(ev: WillAppearEvent): Promise<void> | void {
		this.#startPolling();
		return super.onWillAppear(ev);
	}

	override onWillDisappear(ev: WillDisappearEvent): void {
		super.onWillDisappear(ev);
		if (this.keys.size === 0) this.#stopPolling();
	}

	protected override systemState(): SystemMicState {
		return this.#system;
	}

	protected async act(): Promise<boolean> {
		if (this.bridge.status.inMeeting) {
			return this.bridge.toggle("mic");
		}
		if (!this.systemMic.supported) {
			streamDeck.logger.warn("No meeting running and system input mute is not supported on this platform");
			return false;
		}
		const muted = await this.systemMic.getMuted();
		if (muted === null) return false;
		const ok = await this.systemMic.setMuted(!muted);
		await this.#refreshSystem();
		return ok;
	}

	#startPolling(): void {
		if (this.#poll || !this.systemMic.supported) return;
		void this.#refreshSystem();
		this.#poll = setInterval(() => void this.#refreshSystem(), SYSTEM_POLL_MS);
		this.#poll.unref(); // never keep the process alive once Stream Deck has disconnected
	}

	#stopPolling(): void {
		if (this.#poll) {
			clearInterval(this.#poll);
			this.#poll = null;
		}
	}

	async #refreshSystem(): Promise<void> {
		if (this.bridge.status.inMeeting) return; // the OS state is irrelevant while a meeting shows
		const muted = await this.systemMic.getMuted();
		if (muted === this.#system.muted) return;
		this.#system = { ...this.#system, muted };
		await this.renderAll();
	}
}

@action({ UUID: `${PLUGIN_UUID}.camera` })
export class ToggleCamera extends ToggleKey {
	protected readonly kind = "camera";
}

@action({ UUID: `${PLUGIN_UUID}.share` })
export class ToggleShare extends ToggleKey {
	protected readonly kind = "share";
}

@action({ UUID: `${PLUGIN_UUID}.leave` })
export class LeaveMeeting extends MeetingKey {
	protected readonly kind = "leave";

	protected act(): Promise<boolean> {
		return this.bridge.leave();
	}
}

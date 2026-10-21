import streamDeck from "@elgato/streamdeck";

import { LeaveMeeting, ToggleCamera, ToggleMic, ToggleShare } from "./actions/media-toggle";
import { Bridge } from "./bridge";
import { loadKeyImages } from "./icons";
import { createSystemMic } from "./system-mic";

streamDeck.logger.setLevel("info");

const bridge = new Bridge({ logger: streamDeck.logger.createScope("bridge") });
const images = loadKeyImages();
const systemMic = createSystemMic();

streamDeck.actions.registerAction(new ToggleMic(bridge, images, systemMic));
streamDeck.actions.registerAction(new ToggleCamera(bridge, images));
streamDeck.actions.registerAction(new ToggleShare(bridge, images));
streamDeck.actions.registerAction(new LeaveMeeting(bridge, images));

void bridge.start();
streamDeck.connect();

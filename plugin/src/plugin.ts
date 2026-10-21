import streamDeck from "@elgato/streamdeck";

import { ToggleCamera, ToggleMic } from "./actions/media-toggle";
import { Bridge } from "./bridge";
import { loadKeyImages } from "./icons";

streamDeck.logger.setLevel("info");

const bridge = new Bridge({ logger: streamDeck.logger.createScope("bridge") });
const images = loadKeyImages();

streamDeck.actions.registerAction(new ToggleMic(bridge, images));
streamDeck.actions.registerAction(new ToggleCamera(bridge, images));

void bridge.start();
streamDeck.connect();

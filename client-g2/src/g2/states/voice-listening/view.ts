import { TextContainerProperty } from "@evenrealities/even_hub_sdk";
import type { G2PageDef } from "../../display-manager";
import { DISPLAY_WIDTH, DISPLAY_HEIGHT } from "../../pages/constants";

export function buildListeningPage(): G2PageDef {
  return {
    textContainers: [
      new TextContainerProperty({
        xPosition: 0,
        yPosition: 0,
        width: DISPLAY_WIDTH,
        height: DISPLAY_HEIGHT - 160,
        borderWidth: 1,
        borderColor: 3,
        borderRadius: 8,
        paddingLength: 4,
        containerName: "voiceText",
        content: "● Listening...",
      }),
    ],
  };
}

import { TextContainerProperty } from "@evenrealities/even_hub_sdk";
import type { G2PageDef } from "../../display-manager";
import { DISPLAY_WIDTH, DISPLAY_HEIGHT } from "../../pages/constants";

export function buildErrorPage(message: string): G2PageDef {
  return {
    textContainers: [
      new TextContainerProperty({
        xPosition: 0,
        yPosition: 0,
        width: DISPLAY_WIDTH,
        height: DISPLAY_HEIGHT,
        borderWidth: 0,
        borderColor: 5,
        paddingLength: 4,
        containerName: "error",
        content: `${message}\n\nTap to retry`,
      }),
    ],
  };
}

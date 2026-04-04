import { TextContainerProperty } from "@evenrealities/even_hub_sdk";
import type { G2PageDef } from "../../display-manager";
import { DISPLAY_WIDTH, DISPLAY_HEIGHT } from "../../pages/constants";

const STATUS_HEIGHT = 40;
const LOG_HEIGHT = DISPLAY_HEIGHT - STATUS_HEIGHT;

export function buildMainPage(statusText: string, logText: string): G2PageDef {
  return {
    textContainers: [
      new TextContainerProperty({
        xPosition: 0,
        yPosition: 0,
        width: DISPLAY_WIDTH,
        height: STATUS_HEIGHT,
        borderWidth: 1,
        borderColor: 5,
        borderRadius: 8,
        paddingLength: 4,
        containerName: "status",
        content: statusText,
      }),
      new TextContainerProperty({
        xPosition: 0,
        yPosition: STATUS_HEIGHT,
        width: DISPLAY_WIDTH,
        height: LOG_HEIGHT,
        borderWidth: 0,
        borderColor: 5,
        paddingLength: 4,
        containerName: "log",
        content: logText,
      }),
    ],
  };
}

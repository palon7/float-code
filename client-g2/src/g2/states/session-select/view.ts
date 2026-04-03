import {
  TextContainerProperty,
  ListContainerProperty,
  ListItemContainerProperty,
} from "@evenrealities/even_hub_sdk";
import type { G2PageDef } from "../../display-manager";
import { DISPLAY_WIDTH, DISPLAY_HEIGHT } from "../../pages/constants";

const HEADER_HEIGHT = 72;
const LIST_HEIGHT = DISPLAY_HEIGHT - HEADER_HEIGHT;
const MAX_LIST_ITEMS = 5;
export const MAX_SESSIONS = MAX_LIST_ITEMS - 2;

export function buildSessionSelectPage(
  sessionNames: string[],
  errorMessage?: string,
): G2PageDef {
  const items = ["New session", ...sessionNames.slice(0, MAX_SESSIONS), "Back"];
  const header = errorMessage ? errorMessage : `Sessions`;

  return {
    textContainers: [
      new TextContainerProperty({
        xPosition: 0,
        yPosition: 0,
        width: DISPLAY_WIDTH,
        height: HEADER_HEIGHT,
        borderWidth: 0,
        borderColor: 5,
        paddingLength: 4,
        containerName: "header",
        content: header,
      }),
    ],
    listContainers: [
      new ListContainerProperty({
        xPosition: 0,
        yPosition: HEADER_HEIGHT,
        width: DISPLAY_WIDTH,
        height: LIST_HEIGHT,
        borderWidth: 0,
        borderColor: 5,
        paddingLength: 4,
        containerName: "sessionList",
        itemContainer: new ListItemContainerProperty({
          itemCount: items.length,
          itemWidth: DISPLAY_WIDTH - 24 - 8,
          isItemSelectBorderEn: 1,
          itemName: items,
        }),
      }),
    ],
  };
}

export function buildSessionLoadingPage(): G2PageDef {
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
        containerName: "status",
        content: "Loading sessions...",
      }),
    ],
  };
}

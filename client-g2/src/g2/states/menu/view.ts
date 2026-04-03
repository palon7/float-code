import {
  TextContainerProperty,
  ListContainerProperty,
  ListItemContainerProperty,
} from "@evenrealities/even_hub_sdk";
import type { G2PageDef } from "../../display-manager";
import { DISPLAY_WIDTH, DISPLAY_HEIGHT } from "../../pages/constants";

const HEADER_HEIGHT = 48;
const LIST_HEIGHT = DISPLAY_HEIGHT - HEADER_HEIGHT;

export function buildMenuPage(): G2PageDef {
  const items = ["Abort", "Open...", "Cancel"];

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
        content: "Menu",
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
        containerName: "menuList",
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

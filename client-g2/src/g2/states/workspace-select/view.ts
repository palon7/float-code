import {
  TextContainerProperty,
  ListContainerProperty,
  ListItemContainerProperty,
} from "@evenrealities/even_hub_sdk";
import type { G2PageDef } from "../../display-manager";
import { DISPLAY_WIDTH, DISPLAY_HEIGHT } from "../../pages/constants";

const HEADER_HEIGHT = 48;
const LIST_HEIGHT = DISPLAY_HEIGHT - HEADER_HEIGHT;

const MAX_LIST_ITEMS = 19;
export const MAX_WORKSPACES = MAX_LIST_ITEMS - 1;

export function buildWorkspaceSelectPage(
  names: string[],
  errorMessage?: string,
): G2PageDef {
  const items = [...names.slice(0, MAX_WORKSPACES), "Retry"];
  const header = errorMessage
    ? `Select workspace\n${errorMessage}`
    : "Select workspace";

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
        containerName: "workspaceList",
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

export function buildWorkspaceLoadingPage(): G2PageDef {
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
        content: "Loading workspaces...",
      }),
    ],
  };
}

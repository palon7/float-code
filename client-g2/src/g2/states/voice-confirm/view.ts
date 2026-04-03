import {
  TextContainerProperty,
  ListContainerProperty,
  ListItemContainerProperty,
} from "@evenrealities/even_hub_sdk";
import type { G2PageDef } from "../../display-manager";
import { DISPLAY_WIDTH, DISPLAY_HEIGHT } from "../../pages/constants";
import { MAX_CONTENT_BYTES } from "../../../constants";
import { truncateToBytes } from "../../text-utils";

const TEXT_WIDTH = 400;
const LIST_WIDTH = DISPLAY_WIDTH - TEXT_WIDTH - 10;

/** 認識結果確認ページ: テキスト表示 + OK/Retry/Cancel 選択リスト */
export function buildConfirmPage(resultText: string): G2PageDef {
  return {
    textContainers: [
      new TextContainerProperty({
        xPosition: 0,
        yPosition: 0,
        width: DISPLAY_WIDTH,
        height: DISPLAY_HEIGHT - 160,
        borderWidth: 1,
        borderColor: 5,
        paddingLength: 4,
        containerName: "voiceResult",
        content: truncateToBytes(resultText, MAX_CONTENT_BYTES),
      }),
    ],
    listContainers: [
      new ListContainerProperty({
        xPosition: 0,
        yPosition: DISPLAY_HEIGHT - 160,
        width: LIST_WIDTH,
        height: 160,
        borderWidth: 0,
        borderColor: 5,
        paddingLength: 4,
        containerName: "voiceMenu",
        itemContainer: new ListItemContainerProperty({
          itemCount: 3,
          itemWidth: LIST_WIDTH - 24 - 8,
          isItemSelectBorderEn: 1,
          itemName: ["OK", "Retry", "Cancel"],
        }),
      }),
    ],
  };
}

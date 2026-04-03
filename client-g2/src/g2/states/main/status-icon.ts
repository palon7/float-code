import type { StatusIcon, StatusInfo } from "../../../client/session-format";

const PRIMARY_ICONS: Record<StatusIcon, string> = {
  idle: "○",
  spawning: "◇",
  running: "▶",
  thinking: "◌",
  tool_call: "●",
  permission: "▲",
};

const BLINK_ICONS: Partial<Record<StatusIcon, string>> = {
  spawning: "◆",
  running: "▷",
  thinking: "●",
  tool_call: "○",
};

/**
 * StatusInfo をステータスバー用の文字列に変換する。
 * blinkPhase が true のとき、点滅対象のアイコンは代替文字に差し替わる。
 */
export function formatStatusText(
  info: StatusInfo,
  blinkPhase: boolean,
): string {
  const icon =
    (blinkPhase && BLINK_ICONS[info.icon]) || PRIMARY_ICONS[info.icon];
  return `${icon} ${info.text}`;
}

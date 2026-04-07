import type { EvenHubEvent } from "@evenrealities/even_hub_sdk";
import { OsEventTypeList } from "@evenrealities/even_hub_sdk";

/** EvenHubEvent から eventType を抽出する */
export function getEventType(event: EvenHubEvent): OsEventTypeList | undefined {
  return (
    event.textEvent?.eventType ??
    event.listEvent?.eventType ??
    event.sysEvent?.eventType
  );
}

export function isClickEvent(event: EvenHubEvent): boolean {
  const eventType = getEventType(event);
  if (eventType === OsEventTypeList.CLICK_EVENT) {
    return true;
  }
  if (eventType !== undefined) {
    return false;
  }

  // Even G2 SDK では CLICK_EVENT(0) が undefined に潰れることがある。
  // text/list/sys のイベント本体だけ来て eventType が欠けている場合は click とみなす。
  if (event.textEvent || event.listEvent) {
    return true;
  }
  if (!event.sysEvent) {
    return false;
  }

  return (
    event.sysEvent.imuData == null &&
    event.sysEvent.systemExitReasonCode == null
  );
}

export function isDoubleClickEvent(event: EvenHubEvent): boolean {
  return getEventType(event) === OsEventTypeList.DOUBLE_CLICK_EVENT;
}

export function isTapGestureEvent(event: EvenHubEvent): boolean {
  return isClickEvent(event) || isDoubleClickEvent(event);
}

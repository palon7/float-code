import type {
  EvenHubEvent,
  OsEventTypeList,
} from "@evenrealities/even_hub_sdk";

/** EvenHubEvent から eventType を抽出する */
export function getEventType(event: EvenHubEvent): OsEventTypeList | undefined {
  return (
    event.textEvent?.eventType ??
    event.listEvent?.eventType ??
    event.sysEvent?.eventType
  );
}

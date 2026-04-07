import { describe, expect, it } from "vitest";
import {
  IMU_Report_Data,
  List_ItemEvent,
  OsEventTypeList,
  Sys_ItemEvent,
  Text_ItemEvent,
} from "@evenrealities/even_hub_sdk";
import {
  getEventType,
  isClickEvent,
  isDoubleClickEvent,
  isTapGestureEvent,
} from "./event-utils";

describe("event-utils", () => {
  it("textEvent > listEvent > sysEvent の順で eventType を解決する", () => {
    expect(
      getEventType({
        textEvent: new Text_ItemEvent({
          eventType: OsEventTypeList.CLICK_EVENT,
        }),
        listEvent: new List_ItemEvent({
          eventType: OsEventTypeList.SCROLL_BOTTOM_EVENT,
        }),
        sysEvent: new Sys_ItemEvent({
          eventType: OsEventTypeList.FOREGROUND_ENTER_EVENT,
        }),
      }),
    ).toBe(OsEventTypeList.CLICK_EVENT);

    expect(
      getEventType({
        listEvent: new List_ItemEvent({
          eventType: OsEventTypeList.SCROLL_BOTTOM_EVENT,
        }),
        sysEvent: new Sys_ItemEvent({
          eventType: OsEventTypeList.FOREGROUND_ENTER_EVENT,
        }),
      }),
    ).toBe(OsEventTypeList.SCROLL_BOTTOM_EVENT);
  });

  it("sysEvent の CLICK_EVENT をタップとして扱う", () => {
    const event = {
      sysEvent: new Sys_ItemEvent({ eventType: OsEventTypeList.CLICK_EVENT }),
    };

    expect(isClickEvent(event)).toBe(true);
    expect(isTapGestureEvent(event)).toBe(true);
  });

  it("eventType が undefined に潰れた click を拾う", () => {
    expect(
      isClickEvent({
        textEvent: new Text_ItemEvent({ containerName: "status" }),
      }),
    ).toBe(true);

    expect(
      isClickEvent({
        listEvent: new List_ItemEvent({ containerName: "menuList" }),
      }),
    ).toBe(true);

    expect(
      isClickEvent({
        sysEvent: new Sys_ItemEvent({ eventSource: 2 }),
      }),
    ).toBe(true);
  });

  it("DOUBLE_CLICK_EVENT をダブルタップとして扱う", () => {
    const event = {
      sysEvent: new Sys_ItemEvent({
        eventType: OsEventTypeList.DOUBLE_CLICK_EVENT,
      }),
    };

    expect(isDoubleClickEvent(event)).toBe(true);
    expect(isTapGestureEvent(event)).toBe(true);
  });

  it("前後景イベントはタップ扱いしない", () => {
    const enterEvent = {
      sysEvent: new Sys_ItemEvent({
        eventType: OsEventTypeList.FOREGROUND_ENTER_EVENT,
      }),
    };
    const exitEvent = {
      sysEvent: new Sys_ItemEvent({
        eventType: OsEventTypeList.FOREGROUND_EXIT_EVENT,
      }),
    };

    expect(isTapGestureEvent(enterEvent)).toBe(false);
    expect(isTapGestureEvent(exitEvent)).toBe(false);
  });

  it("IMU や system exit の sysEvent は click 扱いしない", () => {
    expect(
      isClickEvent({
        sysEvent: new Sys_ItemEvent({
          imuData: new IMU_Report_Data({ x: 1, y: 2, z: 3 }),
        }),
      }),
    ).toBe(false);

    expect(
      isClickEvent({
        sysEvent: new Sys_ItemEvent({
          systemExitReasonCode: 1,
        }),
      }),
    ).toBe(false);
  });
});

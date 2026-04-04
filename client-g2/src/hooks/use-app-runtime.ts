import { useEffect, useMemo, useRef, useState } from "react";
import {
  EvenAppBridge,
  waitForEvenAppBridge,
} from "@evenrealities/even_hub_sdk";
import type { AppRuntimeHandle } from "../app/create-app-runtime";
import { createAppRuntime } from "../app/create-app-runtime";
import { useAppStore, setupSettingsPersistence } from "../app/app-store";
import { useSessionStore } from "../client/session-store";
import { G2DisplayManager } from "../g2/display-manager";
import {
  NOOP_ACTIONS,
  type RuntimeActions,
} from "../app/runtime-actions-context";

const BRIDGE_TIMEOUT_MS = 3000;

export function useAppRuntime(): RuntimeActions {
  const displayManager = useMemo(() => new G2DisplayManager(), []);
  const runtimeRef = useRef<AppRuntimeHandle | null>(null);
  const [actions, setActions] = useState<RuntimeActions>(NOOP_ACTIONS);

  const appendDebugLog = useAppStore((state) => state.appendDebugLog);
  const setBridgeStatus = useAppStore((state) => state.setBridgeStatus);
  const setWsStatus = useAppStore((state) => state.setWsStatus);

  useEffect(() => {
    let disposed = false;
    let unsubscribeWs: (() => void) | undefined;
    let unsubscribeLaunch: (() => void) | undefined;
    let unsubscribePersistence: (() => void) | undefined;

    async function init() {
      appendDebugLog("init: waiting for bridge...");

      let bridge: EvenAppBridge;
      try {
        bridge = await Promise.race([
          waitForEvenAppBridge(),
          new Promise<never>((_, reject) =>
            window.setTimeout(
              () => reject(new Error("bridge timeout")),
              BRIDGE_TIMEOUT_MS,
            ),
          ),
        ]);
        if (disposed) return;
        appendDebugLog("init: bridge ready (waitFor)");
      } catch {
        appendDebugLog("init: waitFor timed out, trying getInstance...");
        try {
          bridge = EvenAppBridge.getInstance();
          if (disposed) return;
          appendDebugLog("init: bridge ready (getInstance)");
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          appendDebugLog(`init: getInstance failed: ${message}`);
          setBridgeStatus("error");
          return;
        }
      }

      setBridgeStatus("connected");
      useAppStore.getState().setBridge(bridge);
      await useAppStore.getState().hydrateSettings();
      if (disposed) return;
      unsubscribePersistence = setupSettingsPersistence();

      unsubscribeLaunch = bridge.onLaunchSource((source) => {
        appendDebugLog(`launchSource: ${source}`);
      });

      const handle = await createAppRuntime(
        bridge,
        displayManager,
        appendDebugLog,
      );
      runtimeRef.current = handle;

      useAppStore.getState().setWsClient(handle.wsClient);
      useAppStore.getState().setHttpClient(handle.httpClient);
      setWsStatus(handle.wsClient.getStatus());

      unsubscribeWs = handle.wsClient.onStatusChange((status) => {
        setWsStatus(status);
      });

      await handle.runtime.start();
      if (disposed) return;
      setActions({
        requestConnect: () => handle.runtime.requestConnect(),
      });
    }

    init().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      appendDebugLog(`init error: ${message}`);
      setBridgeStatus("error");
    });

    return () => {
      disposed = true;
      unsubscribePersistence?.();
      unsubscribeLaunch?.();
      unsubscribeWs?.();
      useAppStore.getState().setWsClient(null);
      useAppStore.getState().setHttpClient(null);
      runtimeRef.current?.runtime.dispose();
      runtimeRef.current = null;
      setActions(NOOP_ACTIONS);
      useSessionStore.getState().reset();
    };
  }, [appendDebugLog, displayManager, setBridgeStatus, setWsStatus]);

  return actions;
}

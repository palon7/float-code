import type { ServerMessage } from "@float-code/shared/protocol";
import { useSessionStore } from "../../client/session-store";

/** session 同期で監視するメッセージタイプ */
const SESSION_SYNC_TYPES = new Set([
  "session.opened",
  "session.started",
  "session.error",
]);

/** cc イベントが session 同期の対象かどうか */
export function isSessionSyncMessage(msg: ServerMessage): boolean {
  return SESSION_SYNC_TYPES.has(msg.type);
}

/** store 上で active session が成立しているか */
export function hasActiveSession(): boolean {
  return useSessionStore.getState().hasActive;
}

/** store 上の現在の sessionId を取得 */
export function getActiveSessionId(): string | null {
  return useSessionStore.getState().sessionId;
}

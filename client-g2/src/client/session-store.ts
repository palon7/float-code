import { create } from "zustand";
import type { ServerMessage, SessionStatus } from "@float-code/shared/protocol";
import {
  getLogText,
  getStatusInfo,
  getStatusText,
  type LogLine,
  type StatusInfo,
} from "./session-format";
import {
  INITIAL_SESSION_STATE,
  reduceLocalUserMessage,
  reduceMessage,
} from "./session-reducer";

interface SessionStoreState {
  lines: readonly LogLine[];
  sessionStatus: SessionStatus | "none";
  hasActive: boolean;
  sessionId: string | null;
  workspacePath: string | null;

  getStatusText: () => string;
  getStatusInfo: () => StatusInfo;
  getLogText: () => string;
  handleMessage: (msg: ServerMessage) => void;
  addUserMessage: (text: string) => void;
  reset: () => void;
}

export const useSessionStore = create<SessionStoreState>((set, get) => ({
  ...INITIAL_SESSION_STATE,

  getStatusText: () => {
    const { sessionStatus, lines } = get();
    return getStatusText(sessionStatus, lines);
  },

  getStatusInfo: () => {
    const { sessionStatus, lines } = get();
    return getStatusInfo(sessionStatus, lines);
  },

  getLogText: () => getLogText(get().lines),

  handleMessage: (msg) => {
    const next = reduceMessage(get(), msg);
    if (next) set(next);
  },

  addUserMessage: (text) => {
    set(reduceLocalUserMessage(get(), text));
  },

  reset: () => set(INITIAL_SESSION_STATE),
}));

import { create } from "zustand";
import type { ServerMessage, SessionStatus } from "@float-code/shared/protocol";
import {
  getLogText,
  getStatusInfo,
  getStatusText,
  type EntryFilter,
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

  getStatusText: (filter?: EntryFilter) => string;
  getStatusInfo: (filter?: EntryFilter) => StatusInfo;
  getLogText: (filter?: EntryFilter) => string;
  handleMessage: (msg: ServerMessage) => void;
  addUserMessage: (text: string) => void;
  reset: () => void;
}

export const useSessionStore = create<SessionStoreState>((set, get) => ({
  ...INITIAL_SESSION_STATE,

  getStatusText: (filter?: EntryFilter) => {
    const { sessionStatus, lines } = get();
    return getStatusText(sessionStatus, lines, filter);
  },

  getStatusInfo: (filter?: EntryFilter) => {
    const { sessionStatus, lines } = get();
    return getStatusInfo(sessionStatus, lines, filter);
  },

  getLogText: (filter?: EntryFilter) => getLogText(get().lines, filter),

  handleMessage: (msg) => {
    const next = reduceMessage(get(), msg);
    if (next) set(next);
  },

  addUserMessage: (text) => {
    set(reduceLocalUserMessage(get(), text));
  },

  reset: () => set(INITIAL_SESSION_STATE),
}));

import { createContext, useContext } from "react";

export interface RuntimeActions {
  requestConnect: () => void;
}

export const NOOP_ACTIONS: RuntimeActions = {
  requestConnect: () => {},
};

export const RuntimeActionsContext =
  createContext<RuntimeActions>(NOOP_ACTIONS);

export function useRuntimeActions(): RuntimeActions {
  return useContext(RuntimeActionsContext);
}

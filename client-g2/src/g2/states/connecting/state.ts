import type { G2State } from "../../runtime/g2-state";
import { buildConnectingPage } from "./view";

export function createConnectingState(): G2State {
  return {
    id: "connecting",
    async enter(ctx) {
      await ctx.display.setPage(buildConnectingPage());
    },
  };
}

import type { EvenHubEvent } from "@evenrealities/even_hub_sdk";
import type { ServerMessage } from "@float-code/shared/protocol";
import type { VoiceInputEvent } from "../../voice-input/service-types";
import type { ConnectionStatus } from "../../client/ws";
import type { G2Context } from "./g2-context";

/** runtime に入るすべてのイベントを統一した union 型 */
export type RuntimeEvent =
  | { kind: "g2"; event: EvenHubEvent }
  | { kind: "voice"; event: VoiceInputEvent }
  | { kind: "cc"; message: ServerMessage }
  | { kind: "ws"; status: ConnectionStatus };

/** G2 state machine の各 state が実装する interface */
export interface G2State {
  id: string;
  enter(ctx: G2Context): Promise<void> | void;
  exit?(ctx: G2Context): Promise<void> | void;
  handle?(ctx: G2Context, event: RuntimeEvent): Promise<void> | void;
}

import type { WSContext } from "hono/ws";
import { verifyToken } from "../auth/shared-token.js";
import { isApproved } from "../auth/approved-keys.js";
import { createChallenge, verifySignature } from "../auth/challenge.js";
import { requestPairing } from "../auth/pairing.js";
import { WsCloseCode } from "@float-code/shared/protocol";
import type {
  AuthChallenge,
  AuthErrorCode,
  ServerMessageMap,
} from "@float-code/shared/protocol";
import { logger } from "../utils/logger.js";

const log = logger.child({ name: "ws-auth" });

const AUTH_TIMEOUT_MS = 10_000;

type AuthState =
  | { phase: "awaiting_auth" }
  | { phase: "awaiting_response"; challenge: AuthChallenge; publicKey: string }
  | { phase: "authenticated" };

export class WsAuthenticator {
  private states = new Map<WSContext, AuthState>();
  private timers = new Map<WSContext, NodeJS.Timeout>();

  isPending(ws: WSContext): boolean {
    const state = this.states.get(ws);
    return (
      state?.phase === "awaiting_auth" || state?.phase === "awaiting_response"
    );
  }

  isAuthenticated(ws: WSContext): boolean {
    return this.states.get(ws)?.phase === "authenticated";
  }

  async handleAuth(
    ws: WSContext,
    publicKey: string,
    authToken: string,
    connId?: string,
  ): Promise<void> {
    if (!verifyToken(authToken)) {
      log.warn({ connId }, "authToken invalid");
      this.sendErrorAndClose(
        ws,
        "AUTH_TOKEN_INVALID",
        "Invalid auth token",
        WsCloseCode.AUTH_FAILED,
      );
      return;
    }

    const approved = await isApproved(publicKey);
    if (!approved) {
      log.info({ connId }, "Public key not approved, registering pairing");
      const result = await requestPairing(publicKey);
      if (!result.ok) {
        const code: AuthErrorCode =
          result.reason === "collision"
            ? "PAIRING_CODE_COLLISION"
            : "TOO_MANY_PENDING";
        const message =
          result.reason === "collision"
            ? "Pairing code collision — regenerate keypair"
            : "Too many pending pairing requests";
        this.sendErrorAndClose(ws, code, message, WsCloseCode.AUTH_FAILED);
        return;
      }
      log.info({ connId, code: result.code }, "Pairing registered");
      this.sendErrorAndClose(
        ws,
        "KEY_NOT_APPROVED",
        "Public key is not approved — pairing registered",
        WsCloseCode.KEY_NOT_APPROVED,
      );
      return;
    }

    const challenge = createChallenge(publicKey);
    this.states.set(ws, {
      phase: "awaiting_response",
      challenge,
      publicKey,
    });

    this.sendMessage(ws, "auth.challenge", { challenge });
    log.info({ connId, challengeId: challenge.challengeId }, "Challenge sent");
  }

  async handleResponse(
    ws: WSContext,
    signature: string,
    connId?: string,
  ): Promise<boolean> {
    const state = this.states.get(ws);
    if (state?.phase !== "awaiting_response") {
      log.warn({ connId }, "auth.response received in unexpected phase");
      return false;
    }

    const valid = await verifySignature(
      state.challenge,
      signature,
      state.publicKey,
    );

    if (!valid) {
      log.warn({ connId }, "Signature verification failed");
      this.sendErrorAndClose(
        ws,
        "SIGNATURE_INVALID",
        "Challenge-response signature verification failed",
        WsCloseCode.AUTH_FAILED,
      );
      return false;
    }

    // Re-check approval in case the key was revoked after challenge was issued
    const stillApproved = await isApproved(state.publicKey);
    if (!stillApproved) {
      log.warn({ connId }, "Key revoked during authentication");
      this.sendErrorAndClose(
        ws,
        "KEY_NOT_APPROVED",
        "Key was revoked during authentication",
        WsCloseCode.KEY_NOT_APPROVED,
      );
      return false;
    }

    this.clearAuthTimeout(ws);
    this.states.set(ws, { phase: "authenticated" });
    log.info({ connId }, "WebSocket authenticated via challenge-response");
    return true;
  }

  startTimeout(ws: WSContext, connId?: string): void {
    this.states.set(ws, { phase: "awaiting_auth" });
    const timer = setTimeout(() => {
      this.timers.delete(ws);
      log.warn({ connId }, "WebSocket auth timeout");
      this.sendErrorAndClose(
        ws,
        "AUTH_TIMEOUT",
        "Authentication timeout",
        WsCloseCode.AUTH_TIMEOUT,
      );
    }, AUTH_TIMEOUT_MS);
    this.timers.set(ws, timer);
  }

  clearAuthTimeout(ws: WSContext): void {
    const timer = this.timers.get(ws);
    if (timer) {
      globalThis.clearTimeout(timer);
      this.timers.delete(ws);
    }
  }

  removeConnection(ws: WSContext): void {
    this.states.delete(ws);
    this.clearAuthTimeout(ws);
  }

  stopAll(): void {
    for (const timer of this.timers.values()) {
      globalThis.clearTimeout(timer);
    }
    this.timers.clear();
    this.states.clear();
  }

  private sendMessage<K extends keyof ServerMessageMap>(
    ws: WSContext,
    type: K,
    payload: ServerMessageMap[K],
  ): void {
    try {
      ws.send(
        JSON.stringify({
          type,
          ...payload,
          timestamp: new Date().toISOString(),
        }),
      );
    } catch {
      // ignore
    }
  }

  private sendError(ws: WSContext, code: AuthErrorCode, message: string): void {
    this.sendMessage(ws, "auth.error", { code, message });
  }

  private sendErrorAndClose(
    ws: WSContext,
    code: AuthErrorCode,
    message: string,
    closeCode: { code: number; reason: string },
  ): void {
    this.sendError(ws, code, message);
    try {
      ws.close(closeCode.code, closeCode.reason);
    } catch {
      // ignore
    }
  }
}

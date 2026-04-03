import { Hono } from "hono";
import { createNodeWebSocket } from "@hono/node-ws";
import type { WebSocketServer } from "ws";
import { WsGateway } from "./ws/gateway.js";
import { ConnectionRegistry } from "./ws/connection-registry.js";
import type { HealthResponse } from "@float-code/shared/protocol";
import { bearerAuth } from "./api/auth-middleware.js";
import workspacesRouter from "./api/workspaces.js";
import { createSessionsRouter } from "./api/sessions.js";
import { SessionManager } from "./session/session-manager.js";
import { PidTracker } from "./session/pid-tracker.js";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

export type AppContext = {
  app: Hono;
  gateway: WsGateway;
  sessionManager: SessionManager;
  wss: WebSocketServer;
  injectWebSocket: ReturnType<typeof createNodeWebSocket>["injectWebSocket"];
};

export function createApp(startTime: number): AppContext {
  const pidTracker = new PidTracker();
  const registry = new ConnectionRegistry();
  const sessionManager = new SessionManager(registry, pidTracker);
  const gateway = new WsGateway(sessionManager, registry);
  const app = new Hono();
  const { injectWebSocket, upgradeWebSocket, wss } = createNodeWebSocket({
    app,
  });

  app.use(logger());
  app.use(
    "*",
    cors({ origin: "*", allowHeaders: ["Authorization", "Content-Type"] }),
  );

  // Health check (認証不要)
  app.get("/health", (c) => {
    const resp: HealthResponse = {
      status: "ok",
      uptime: Math.floor((Date.now() - startTime) / 1000),
      activeSessions: sessionManager.getActiveSessionCount(),
    };
    return c.json(resp);
  });

  // REST API (認証必須)
  const api = new Hono();
  api.use("*", bearerAuth);
  api.route("/workspaces", workspacesRouter);
  api.route("/sessions", createSessionsRouter(sessionManager));
  app.route("/api", api);

  // WebSocket
  app.get(
    "/ws",
    upgradeWebSocket(() => ({
      onOpen(_event, ws) {
        gateway.handleOpen(ws);
      },
      onMessage(event, ws) {
        gateway.handleMessage(ws, event.data);
      },
      onClose(event, ws) {
        gateway.handleClose(ws, event.code, event.reason);
      },
    })),
  );

  return { app, gateway, sessionManager, wss, injectWebSocket };
}

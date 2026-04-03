import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { initTokenCache } from "./auth/shared-token.js";
import { createApp } from "./app.js";
import { startHeartbeat } from "./ws/heartbeat.js";
import { logger } from "./utils/logger.js";

async function main() {
  const config = await loadConfig();
  initTokenCache();
  const { app, gateway, sessionManager, wss, injectWebSocket } = createApp(
    Date.now(),
  );

  await sessionManager.killOrphans();

  const server = serve(
    {
      fetch: app.fetch,
      hostname: "0.0.0.0",
      port: config.port,
    },
    (info) => {
      logger.info(
        { port: info.port },
        `Server listening on http://0.0.0.0:${info.port}`,
      );
      // 初回起動時などトークンの確認が必要な場合は data/config.json を参照
    },
  );

  injectWebSocket(server);
  const heartbeatTimer = startHeartbeat(wss);

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down...");
    clearInterval(heartbeatTimer);
    gateway.stop();
    await sessionManager.shutdown();
    server.close();
    process.exit(0);
  };

  // 予期しないプロセス終了時の安全ネット
  process.on("exit", () => {
    sessionManager.killAllSync();
  });

  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

main().catch((err: unknown) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});

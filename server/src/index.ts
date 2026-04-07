import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { initTokenCache } from "./auth/shared-token.js";
import { cleanupExpired } from "./auth/pairing.js";
import { createApp } from "./app.js";
import { createLocalServer } from "./local-server.js";
import { startHeartbeat } from "./ws/heartbeat.js";
import { startNonceCleanup, stopNonceCleanup } from "./auth/nonce-store.js";
import { runCli } from "./cli/index.js";
import { logger } from "./utils/logger.js";

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    const handled = await runCli(args);
    if (handled) return;
  }

  const config = await loadConfig();
  initTokenCache();

  await cleanupExpired();

  const { app, gateway, sessionManager, wss, injectWebSocket } = createApp(
    Date.now(),
  );

  await sessionManager.killOrphans();

  const hostname = config.networkMode === "lan" ? "0.0.0.0" : "127.0.0.1";

  if (config.networkMode === "lan") {
    logger.warn(
      "WARNING: Running in LAN mode. Transport is unencrypted — " +
        "session content is visible to network observers. " +
        "Use 'tailscale' or 'local' mode for untrusted networks.",
    );
  }

  const server = serve(
    {
      fetch: app.fetch,
      hostname,
      port: config.port,
    },
    (info) => {
      logger.info(
        { port: info.port, hostname, networkMode: config.networkMode },
        `Server listening on http://${hostname}:${info.port}`,
      );
    },
  );

  injectWebSocket(server);
  startNonceCleanup();
  const heartbeatTimer = startHeartbeat(wss);

  const localApp = createLocalServer();
  const localServer = serve(
    {
      fetch: localApp.fetch,
      hostname: "127.0.0.1",
      port: config.localPort,
    },
    (info) => {
      logger.info(
        { port: info.port },
        `Local management server listening on http://127.0.0.1:${info.port}`,
      );
    },
  );

  const shutdown = async () => {
    logger.info("Shutting down...");
    stopNonceCleanup();
    clearInterval(heartbeatTimer);
    gateway.stop();
    await sessionManager.shutdown();
    server.close();
    localServer.close();
    process.exit(0);
  };

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

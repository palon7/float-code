import React from "react";
import { render } from "ink";
import { App } from "./app.js";
import { parseConfig } from "./config.js";
import { loadOrCreateKeypair } from "./auth/keypair.js";

async function main() {
  const config = parseConfig(process.argv.slice(2));
  const keypair = await loadOrCreateKeypair();
  const clearRef = { current: () => {} };
  const instance = render(
    <App
      wsUrl={config.wsUrl}
      httpUrl={config.httpUrl}
      token={config.token}
      keypair={keypair}
      clearScreen={() => clearRef.current()}
    />,
  );
  clearRef.current = () => {
    instance.clear();
    process.stdout.write("\x1B[2J\x1B[H");
  };
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});

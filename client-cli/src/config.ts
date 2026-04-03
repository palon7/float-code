import * as fs from "node:fs";
import * as path from "node:path";

const DEFAULT_HOST = "localhost:8080";

export type CliConfig = {
  wsUrl: string;
  httpUrl: string;
  token: string;
};

function normalizeHost(raw: string): string {
  // Strip protocol prefixes if accidentally provided
  return raw
    .replace(/^wss?:\/\//, "")
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, ""); // strip path like /ws
}

export function parseConfig(args: string[]): CliConfig {
  let host = "";
  let token = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--url" && args[i + 1]) {
      host = args[++i];
    } else if (args[i] === "--token" && args[i + 1]) {
      token = args[++i];
    }
  }

  if (!token) {
    token = readServerToken();
  }

  const normalized = normalizeHost(host || DEFAULT_HOST);

  return {
    wsUrl: `ws://${normalized}/ws`,
    httpUrl: `http://${normalized}`,
    token,
  };
}

function readServerToken(): string {
  try {
    const configPath = path.resolve(
      import.meta.dirname,
      "../../server/data/config.json",
    );
    const raw = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw) as { authToken?: string };
    return config.authToken ?? "";
  } catch {
    return "";
  }
}

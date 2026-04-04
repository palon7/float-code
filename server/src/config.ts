import * as crypto from "node:crypto";
import {
  readJsonSafe,
  writeSecretJsonAtomic,
  dataPath,
  configDir,
} from "./utils/fs.js";
import { logger } from "./utils/logger.js";

const PERMISSION_MODES = [
  "acceptEdits",
  "default",
  "bypassPermissions",
  "plan",
  "auto",
  "dontAsk",
] as const;
const OPTIONAL_STRING_KEYS = ["model", "appendSystemPrompt"] as const;
const STRING_ARRAY_KEYS = [
  "allowedTools",
  "disallowedTools",
  "extraArgs",
] as const;
const DEFAULT_PORT = 8080;
const DEFAULT_LOCAL_PORT = 9090;
const MAX_PORT = 65_535;
const DEFAULT_PERMISSION_MODE = "acceptEdits";
const NETWORK_MODES = ["local", "tailscale", "lan"] as const;

type ClaudePermissionMode = (typeof PERMISSION_MODES)[number];
type OptionalStringKey = (typeof OPTIONAL_STRING_KEYS)[number];
export type NetworkMode = (typeof NETWORK_MODES)[number];

export type ClaudeCliConfig = {
  model?: string;
  appendSystemPrompt?: string;
  mcpConfig: Record<string, unknown>;
  allowedTools: string[];
  disallowedTools: string[];
  permissionMode: ClaudePermissionMode;
  bypassPermissions?: boolean;
  env: Record<string, string>;
  extraArgs: string[];
};

export type ServerConfig = {
  version: 2;
  port: number;
  authToken: string;
  localAuthToken: string;
  localPort: number;
  networkMode: NetworkMode;
  claude: ClaudeCliConfig;
};

const CONFIG_PATH = dataPath("config.json");

let cachedConfig: ServerConfig | null = null;

export async function loadConfig(): Promise<ServerConfig> {
  await import("node:fs/promises").then((fs) =>
    fs.mkdir(configDir(), { recursive: true, mode: 0o700 }),
  );
  const loaded = await readJsonSafe<unknown>(
    CONFIG_PATH,
    createDefaultConfig(),
  );
  const config = normalizeServerConfig(loaded);

  let modified = false;

  if (!config.authToken) {
    config.authToken = crypto.randomBytes(32).toString("hex");
    logger.info({ path: CONFIG_PATH }, "Auth token generated");
    modified = true;
  }

  if (!config.localAuthToken) {
    config.localAuthToken = crypto.randomBytes(32).toString("hex");
    logger.info({ path: CONFIG_PATH }, "Local auth token generated");
    modified = true;
  }

  if (modified || JSON.stringify(loaded) !== JSON.stringify(config)) {
    await writeSecretJsonAtomic(CONFIG_PATH, config);
    logger.info({ path: CONFIG_PATH }, "Config saved");
  }

  cachedConfig = config;
  return config;
}

export function getConfig(): ServerConfig {
  if (!cachedConfig) {
    throw new Error("Config not loaded. Call loadConfig() first.");
  }
  return cachedConfig;
}

function normalizeServerConfig(raw: unknown): ServerConfig {
  const record = asRecord(raw);
  const config = createDefaultConfig();

  config.port = normalizePort(record?.port, DEFAULT_PORT);
  config.authToken =
    typeof record?.authToken === "string" ? record.authToken : "";
  config.localAuthToken =
    typeof record?.localAuthToken === "string" ? record.localAuthToken : "";
  config.localPort = normalizePort(record?.localPort, DEFAULT_LOCAL_PORT);

  const networkMode = record?.networkMode;
  if (
    typeof networkMode === "string" &&
    (NETWORK_MODES as readonly string[]).includes(networkMode)
  ) {
    config.networkMode = networkMode as NetworkMode;
  }

  config.claude = normalizeClaudeConfig(record?.claude);

  return config;
}

function createDefaultConfig(): ServerConfig {
  return {
    version: 2,
    port: DEFAULT_PORT,
    authToken: "",
    localAuthToken: "",
    localPort: DEFAULT_LOCAL_PORT,
    networkMode: "local",
    claude: createDefaultClaudeConfig(),
  };
}

function normalizeClaudeConfig(raw: unknown): ClaudeCliConfig {
  const record = asRecord(raw);
  const config = createDefaultClaudeConfig();
  const permissionMode = record?.permissionMode;
  if (
    typeof permissionMode === "string" &&
    (PERMISSION_MODES as readonly string[]).includes(permissionMode)
  ) {
    config.permissionMode = permissionMode as ClaudePermissionMode;
  }

  for (const key of OPTIONAL_STRING_KEYS) {
    assignOptionalString(config, key, record?.[key]);
  }

  const mcpConfig = record?.mcpConfig;
  const normalizedMcpConfig = asRecord(mcpConfig);
  if (normalizedMcpConfig) {
    config.mcpConfig = normalizedMcpConfig;
  }

  for (const key of STRING_ARRAY_KEYS) {
    config[key] = normalizeStringArray(record?.[key]);
  }

  if (typeof record?.bypassPermissions === "boolean") {
    config.bypassPermissions = record.bypassPermissions;
  }

  config.env = normalizeStringRecord(record?.env);

  return config;
}

function createDefaultClaudeConfig(): ClaudeCliConfig {
  return {
    permissionMode: DEFAULT_PERMISSION_MODE,
    mcpConfig: {},
    allowedTools: [],
    disallowedTools: [],
    env: {},
    extraArgs: [],
  };
}

function normalizePort(raw: unknown, defaultPort: number): number {
  if (
    typeof raw !== "number" ||
    !Number.isInteger(raw) ||
    raw <= 0 ||
    raw > MAX_PORT
  ) {
    return defaultPort;
  }
  return raw;
}

function normalizeStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((value): value is string => typeof value === "string");
}

function normalizeStringRecord(raw: unknown): Record<string, string> {
  const record = asRecord(raw);
  if (!record) {
    return {};
  }

  const entries = Object.entries(record).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return Object.fromEntries(entries);
}

function normalizeOptionalString(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length === 0) {
    return undefined;
  }
  return raw;
}

function assignOptionalString(
  target: ClaudeCliConfig,
  key: OptionalStringKey,
  raw: unknown,
): void {
  const value = normalizeOptionalString(raw);
  if (value) {
    target[key] = value;
  }
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  return raw as Record<string, unknown>;
}

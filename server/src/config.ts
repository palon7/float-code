import * as crypto from "node:crypto";
import * as path from "node:path";
import {
  readJsonSafe,
  writeJsonAtomic,
  ensureDir,
  dataPath,
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
const MAX_PORT = 65_535;
const DEFAULT_PERMISSION_MODE = "acceptEdits";

type ClaudePermissionMode = (typeof PERMISSION_MODES)[number];
type OptionalStringKey = (typeof OPTIONAL_STRING_KEYS)[number];

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
  version: 1;
  port: number;
  authToken: string;
  claude: ClaudeCliConfig;
};

const CONFIG_PATH = dataPath("config.json");

let cachedConfig: ServerConfig | null = null;

export async function loadConfig(): Promise<ServerConfig> {
  await ensureDir(path.dirname(CONFIG_PATH));
  const loaded = await readJsonSafe<unknown>(
    CONFIG_PATH,
    createDefaultConfig(),
  );
  const config = normalizeServerConfig(loaded);

  if (!config.authToken) {
    config.authToken = crypto.randomBytes(32).toString("hex");
    logger.info({ path: CONFIG_PATH }, "Auth token generated");
  }

  if (JSON.stringify(loaded) !== JSON.stringify(config)) {
    await writeJsonAtomic(CONFIG_PATH, config);
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

  config.port = normalizePort(record?.port);
  config.authToken =
    typeof record?.authToken === "string" ? record.authToken : "";
  config.claude = normalizeClaudeConfig(record?.claude);

  return config;
}

function createDefaultConfig(): ServerConfig {
  return {
    version: 1,
    port: DEFAULT_PORT,
    authToken: "",
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

function normalizePort(raw: unknown): number {
  if (
    typeof raw !== "number" ||
    !Number.isInteger(raw) ||
    raw <= 0 ||
    raw > MAX_PORT
  ) {
    return DEFAULT_PORT;
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

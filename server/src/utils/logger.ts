// TTY なら色付き整形出力、非 TTY (パイプ/ファイル) なら JSON 出力
const isTTY = Boolean(process.stdout.isTTY);

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

const currentLevel: number =
  LEVELS[(process.env.NODE_ENV === "production" ? "info" : "debug") as Level];

type Fields = Record<string, unknown>;

// Error は JSON.stringify すると {} になるため個別にシリアライズする
function serializeField(v: unknown): unknown {
  if (v instanceof Error) {
    return {
      name: v.name,
      message: v.message,
      stack: v.stack,
      ...(v.cause !== undefined && { cause: String(v.cause) }),
    };
  }
  return v;
}

function serializeFields(fields: Fields): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = serializeField(v);
  }
  return out;
}

// ─── Pretty format ────────────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  gray: "\x1b[90m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
} as const;

const LEVEL_STYLE: Record<
  Level,
  { color: string; icon: string; label: string }
> = {
  debug: { color: C.gray, icon: "·", label: "DEBUG" },
  info: { color: C.cyan, icon: "ℹ", label: "INFO " },
  warn: { color: C.yellow, icon: "⚠", label: "WARN " },
  error: { color: C.red, icon: "✖", label: "ERROR" },
};

function formatTime(): string {
  return new Date().toTimeString().slice(0, 8);
}

function formatFieldsPretty(fields: Fields): string {
  const pairs = Object.entries(fields).map(([k, v]) => {
    const val =
      v === null || v === undefined
        ? String(v)
        : typeof v === "object"
          ? JSON.stringify(v)
          : String(v);
    return `${C.dim}${k}${C.reset}${C.gray}=${C.reset}${val}`;
  });
  return pairs.length > 0 ? "  " + pairs.join(" ") : "";
}

function writePretty(
  level: Level,
  name: string,
  fields: Fields,
  msg: string,
): void {
  const s = LEVEL_STYLE[level];
  const line =
    `${C.gray}${formatTime()}${C.reset}` +
    `  ${s.color}${s.icon} ${s.label}${C.reset}` +
    `  ${C.magenta}${name}${C.reset}` +
    `  ${msg}` +
    formatFieldsPretty(serializeFields(fields)) +
    "\n";

  if (level === "error" || level === "warn") {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

// ─── JSON format ──────────────────────────────────────────────────────────────

function writeJson(
  level: Level,
  name: string,
  fields: Fields,
  msg: string,
): void {
  // reserved キー (level/time/name/msg) がフィールドで上書きされないよう後ろに置く
  const entry = {
    ...serializeFields(fields),
    level,
    time: new Date().toISOString(),
    name,
    msg,
  };
  const line = JSON.stringify(entry) + "\n";
  if (level === "error" || level === "warn") {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

// ─── Logger interface ─────────────────────────────────────────────────────────

export interface Logger {
  debug(fields: Fields, msg: string): void;
  debug(msg: string): void;
  info(fields: Fields, msg: string): void;
  info(msg: string): void;
  warn(fields: Fields, msg: string): void;
  warn(msg: string): void;
  error(fields: Fields, msg: string): void;
  error(msg: string): void;
  child(bindings: Fields): Logger;
}

function makeLogger(name: string, bindings: Fields = {}): Logger {
  function makeMethod(level: Level) {
    return (fieldsOrMsg: Fields | string, msg?: string) => {
      if (LEVELS[level] < currentLevel) return;
      if (typeof fieldsOrMsg === "string") {
        if (isTTY) writePretty(level, name, bindings, fieldsOrMsg);
        else writeJson(level, name, bindings, fieldsOrMsg);
      } else {
        const merged = { ...bindings, ...fieldsOrMsg };
        if (isTTY) writePretty(level, name, merged, msg ?? "");
        else writeJson(level, name, merged, msg ?? "");
      }
    };
  }

  return {
    debug: makeMethod("debug"),
    info: makeMethod("info"),
    warn: makeMethod("warn"),
    error: makeMethod("error"),
    child(extraBindings: Fields) {
      return makeLogger(name, { ...bindings, ...extraBindings });
    },
  };
}

export const logger = makeLogger("server");

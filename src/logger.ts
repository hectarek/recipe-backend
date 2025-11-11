import { inspect } from "bun";

type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

const levelPriority: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

const parseLevel = (value: string | undefined): LogLevel => {
  if (!value) {
    return "info";
  }

  const normalized = value.toLowerCase() as LogLevel;
  return levelPriority[normalized] ? normalized : "info";
};

const activeLevel = parseLevel(process.env.LOG_LEVEL);

const shouldLog = (level: LogLevel): boolean =>
  levelPriority[level] >= levelPriority[activeLevel];

const consoleMethod: Record<
  LogLevel,
  (message?: unknown, ...optionalParams: unknown[]) => void
> = {
  trace: console.trace.bind(console),
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  fatal: console.error.bind(console),
};

const formatMeta = (meta: unknown): string | undefined => {
  if (meta == null) {
    return;
  }

  if (typeof meta === "string") {
    return meta;
  }

  return inspect(meta, { colors: false });
};

const log =
  (level: LogLevel) =>
  (arg1: unknown, arg2?: unknown): void => {
    if (!shouldLog(level)) {
      return;
    }

    let message: string | undefined;
    let meta: unknown;

    if (
      typeof arg1 === "string" ||
      typeof arg1 === "number" ||
      typeof arg1 === "boolean"
    ) {
      message = String(arg1);
      meta = arg2;
    } else {
      meta = arg1;
      message =
        typeof arg2 === "string" ||
        typeof arg2 === "number" ||
        typeof arg2 === "boolean"
          ? String(arg2)
          : undefined;
    }

    const parts: string[] = [
      `[${new Date().toISOString()}]`,
      level.toUpperCase(),
    ];
    if (message) {
      parts.push(message);
    }
    const metaString = formatMeta(meta);
    if (metaString) {
      parts.push(metaString);
    }

    consoleMethod[level](parts.join(" "));
  };

export const logger = {
  trace: log("trace"),
  debug: log("debug"),
  info: log("info"),
  warn: log("warn"),
  error: log("error"),
  fatal: log("fatal"),
};

import pino, { type Logger } from "pino";
import type { Config } from "./config";

/** Structured JSON logs (pino). Secrets are redacted. Pretty output only in local development. */
export function createLogger(config: Pick<Config, "LOG_LEVEL" | "NODE_ENV">, name = "api"): Logger {
  const usePretty = config.NODE_ENV === "development" && process.stdout.isTTY;
  return pino({
    name,
    level: process.env.VITEST ? "silent" : config.LOG_LEVEL,
    redact: { paths: ["req.headers.authorization", "req.headers.cookie", "headers.authorization", "headers.cookie", "*.password", "*.token"], censor: "[redacted]" },
    ...(usePretty ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } } } : {}),
  });
}

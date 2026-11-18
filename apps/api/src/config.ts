import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().default(3000),
  /** Public base URL, used to build signed file URLs for the local storage driver. */
  PUBLIC_URL: z.string().default("http://localhost:3000"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  /** Behind Caddy the real client IP is in X-Forwarded-For. */
  TRUST_PROXY: bool.default(false),

  /** Runtime role (soe_app), no schema rights. */
  DATABASE_URL: z.string().min(1),
  DB_POOL_MAX: z.coerce.number().int().min(1).default(10),

  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  RATE_LIMIT_WINDOW: z.string().default("1 minute"),

  /** Dev-only actor, ignored when NODE_ENV=production. */
  DEV_ACTOR_ID: z.string().default("01900000-0000-7000-8000-000000000001"),

  TRASH_RETENTION_DAYS: z.coerce.number().int().min(1).default(7),

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default(".local-storage"),
  /** HMAC key for local signed URLs. Required in production when the local driver is used. */
  STORAGE_SIGNING_SECRET: z.string().min(16).default("dev-only-signing-secret-change-me"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool.default(false),

  FILE_MAX_BYTES: z.coerce.number().int().default(25 * 1024 * 1024),
  FILE_USER_QUOTA_BYTES: z.coerce.number().int().default(2 * 1024 * 1024 * 1024),
  FILE_ALLOWED_TYPES: z
    .string()
    .default("image/png,image/jpeg,image/webp,image/gif,application/pdf,text/csv,text/plain,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
  DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().default(300),
  UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().default(600),

  /** Folder with the built web app (apps/web/dist). Served by the api when it exists. */
  WEB_DIST_DIR: z.string().optional(),

  WORKER_OUTBOX_POLL_MS: z.coerce.number().int().min(100).default(1000),
});

export type Config = z.infer<typeof EnvSchema> & {
  isProduction: boolean;
  /** True only outside production. Production never enables the temporary dev actor. */
  devAuthEnabled: boolean;
  allowedFileTypes: string[];
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Cấu hình môi trường không hợp lệ: ${msg}`);
  }
  const c = parsed.data;
  const isProduction = c.NODE_ENV === "production";
  if (isProduction && c.STORAGE_DRIVER === "local" && c.STORAGE_SIGNING_SECRET === "dev-only-signing-secret-change-me") {
    throw new Error("STORAGE_SIGNING_SECRET phải được đặt trong production.");
  }
  if (c.STORAGE_DRIVER === "s3" && (!c.S3_BUCKET || !c.S3_ACCESS_KEY_ID || !c.S3_SECRET_ACCESS_KEY)) {
    throw new Error("STORAGE_DRIVER=s3 cần S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY.");
  }
  return {
    ...c,
    isProduction,
    devAuthEnabled: !isProduction,
    allowedFileTypes: c.FILE_ALLOWED_TYPES.split(",").map((s) => s.trim()).filter(Boolean),
  };
}

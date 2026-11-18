import type { Config } from "../config";
import { LocalStorageDriver } from "./local";
import { S3StorageDriver } from "./s3";
import type { StorageDriver } from "./types";

export * from "./types";
export { LocalStorageDriver } from "./local";

export function createStorage(cfg: Config): StorageDriver {
  if (cfg.STORAGE_DRIVER === "s3") return new S3StorageDriver(cfg);
  return new LocalStorageDriver(cfg.STORAGE_LOCAL_DIR, cfg.PUBLIC_URL, cfg.STORAGE_SIGNING_SECRET);
}

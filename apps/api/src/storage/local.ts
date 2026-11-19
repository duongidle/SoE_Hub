import { createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import type { SignedUpload, StorageDriver } from "./types";

export type LocalOp = "put" | "get";

export interface LocalSignedParams {
  op: LocalOp;
  key: string;
  exp: number;
  /** Content type for put (must match the upload) or response type for get. */
  ct: string;
  /** Download file name (get only). */
  fn: string;
  sig: string;
}

/** Development driver. Bytes live on disk; URLs are signed with HMAC and served by `/api/v1/storage/local/*`. */
export class LocalStorageDriver implements StorageDriver {
  readonly name = "local" as const;
  private readonly root: string;

  constructor(
    dir: string,
    private readonly publicUrl: string,
    private readonly secret: string,
  ) {
    this.root = path.resolve(dir);
  }

  private sign(p: Omit<LocalSignedParams, "sig">): string {
    return createHmac("sha256", this.secret).update([p.op, p.key, p.exp, p.ct, p.fn].join("\n")).digest("hex");
  }

  /** Returns true if the signature is valid and not expired. */
  verify(p: LocalSignedParams, now = Date.now()): boolean {
    if (!Number.isFinite(p.exp) || p.exp * 1000 < now) return false;
    const expected = Buffer.from(this.sign(p), "hex");
    const given = Buffer.from(p.sig, "hex");
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  private url(op: LocalOp, key: string, exp: number, ct: string, fn: string): string {
    const sig = this.sign({ op, key, exp, ct, fn });
    const q = new URLSearchParams({ key, exp: String(exp), ct, fn, sig });
    return `${this.publicUrl.replace(/\/$/, "")}/api/v1/storage/local/${op}?${q.toString()}`;
  }

  async createUploadUrl(o: { key: string; contentType: string; sizeBytes: number; ttlSeconds: number }): Promise<SignedUpload> {
    const exp = Math.floor(Date.now() / 1000) + o.ttlSeconds;
    return {
      url: this.url("put", o.key, exp, o.contentType, ""),
      method: "PUT",
      headers: { "content-type": o.contentType },
      expiresAt: new Date(exp * 1000),
    };
  }

  async createDownloadUrl(o: { key: string; filename: string; contentType: string; ttlSeconds: number }) {
    const exp = Math.floor(Date.now() / 1000) + o.ttlSeconds;
    return { url: this.url("get", o.key, exp, o.contentType, o.filename), expiresAt: new Date(exp * 1000) };
  }

  /** Resolves a key to a path inside the root; rejects anything that escapes it. */
  private pathFor(key: string): string {
    const p = path.resolve(this.root, key);
    if (p !== this.root && !p.startsWith(this.root + path.sep)) throw new Error("invalid storage key");
    return p;
  }

  async put(key: string, bytes: Buffer, _contentType: string): Promise<void> {
    await this.write(key, bytes);
  }

  async write(key: string, bytes: Buffer): Promise<void> {
    const p = this.pathFor(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, bytes);
  }

  read(key: string): Readable {
    return createReadStream(this.pathFor(key));
  }

  async stat(key: string) {
    try {
      const s = await stat(this.pathFor(key));
      return { sizeBytes: s.size };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}

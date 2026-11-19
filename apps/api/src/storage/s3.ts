import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PassThrough, type Readable } from "node:stream";
import type { Config } from "../config";
import type { SignedUpload, StorageDriver } from "./types";

/** S3-compatible driver: Cloudflare R2, MinIO or AWS S3. The bucket is private. */
export class S3StorageDriver implements StorageDriver {
  readonly name = "s3" as const;
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(cfg: Pick<Config, "S3_ENDPOINT" | "S3_REGION" | "S3_BUCKET" | "S3_ACCESS_KEY_ID" | "S3_SECRET_ACCESS_KEY" | "S3_FORCE_PATH_STYLE">) {
    this.bucket = cfg.S3_BUCKET!;
    this.client = new S3Client({
      region: cfg.S3_REGION,
      endpoint: cfg.S3_ENDPOINT,
      forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: cfg.S3_ACCESS_KEY_ID!, secretAccessKey: cfg.S3_SECRET_ACCESS_KEY! },
      // Presigned URLs must not carry optional checksum headers that browsers cannot send.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  async createUploadUrl(o: { key: string; contentType: string; sizeBytes: number; ttlSeconds: number }): Promise<SignedUpload> {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: o.key, ContentType: o.contentType }),
      { expiresIn: o.ttlSeconds },
    );
    return { url, method: "PUT", headers: { "content-type": o.contentType }, expiresAt: new Date(Date.now() + o.ttlSeconds * 1000) };
  }

  async createDownloadUrl(o: { key: string; filename: string; contentType: string; ttlSeconds: number }) {
    const safeName = o.filename.replace(/["\r\n]/g, "_");
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: o.key,
        ResponseContentType: o.contentType,
        ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`,
      }),
      { expiresIn: o.ttlSeconds },
    );
    return { url, expiresAt: new Date(Date.now() + o.ttlSeconds * 1000) };
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: contentType }));
  }

  read(key: string): Readable {
    const out = new PassThrough();
    this.client
      .send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
      .then((r) => (r.Body as Readable).on("error", (e) => out.destroy(e)).pipe(out))
      .catch((e) => out.destroy(e as Error));
    return out;
  }

  async stat(key: string) {
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { sizeBytes: Number(r.ContentLength ?? 0) };
    } catch (e) {
      const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) return null;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

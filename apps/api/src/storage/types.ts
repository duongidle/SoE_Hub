/**
 * File storage abstraction (design section 15). Files are private; callers get short-lived signed URLs.
 * Drivers: `s3` (Cloudflare R2, MinIO, AWS) for production and `local` (disk) for development.
 */
export interface SignedUpload {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface StorageDriver {
  readonly name: "s3" | "local";
  createUploadUrl(o: { key: string; contentType: string; sizeBytes: number; ttlSeconds: number }): Promise<SignedUpload>;
  createDownloadUrl(o: { key: string; filename: string; contentType: string; ttlSeconds: number }): Promise<{ url: string; expiresAt: Date }>;
  /** Size of the stored object, or null when it does not exist. */
  stat(key: string): Promise<{ sizeBytes: number } | null>;
  delete(key: string): Promise<void>;
}

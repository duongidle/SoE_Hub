import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { files, outbox, purgeTrash } from "@soe/db";
import type { LocalStorageDriver } from "../src/storage";
import { registerTrashTables } from "../src/modules";
import { DEV_USER, devHeaders, makeApp, type TestApp } from "./helpers";

let t: TestApp;
beforeAll(async () => {
  t = await makeApp({ FILE_MAX_BYTES: 1000, FILE_USER_QUOTA_BYTES: 3000 });
});
afterAll(async () => {
  await t.close();
});

const OWNER = "01900000-0000-7000-8000-0000000000f1";
const OTHER = "01900000-0000-7000-8000-0000000000f2";

async function init(user: string, body: object) {
  return t.app.inject({ method: "POST", url: "/api/v1/files", headers: devHeaders(user), payload: body });
}
function localPath(url: string) {
  const u = new URL(url);
  return u.pathname + u.search;
}

describe("file storage with signed URLs (local driver)", () => {
  it("init -> upload -> complete -> signed download", async () => {
    const bytes = Buffer.from("xin chào SoE Hub");
    const r = await init(OWNER, { filename: "../../etc/báo cáo.pdf", content_type: "application/pdf", size_bytes: bytes.length });
    expect(r.statusCode).toBe(201);
    const { file, upload } = r.json().data;
    expect(file.filename).toBe("báo cáo.pdf"); // path stripped
    expect(file.status).toBe("pending");

    // Download before the upload completes is refused.
    const early = await t.app.inject({ method: "GET", url: `/api/v1/files/${file.id}/download-url`, headers: devHeaders(OWNER) });
    expect(early.statusCode).toBe(404);

    // Completing before the bytes exist fails.
    const noBytes = await t.app.inject({ method: "POST", url: `/api/v1/files/${file.id}/complete`, headers: devHeaders(OWNER) });
    expect(noBytes.statusCode).toBe(400);

    const put = await t.app.inject({ method: "PUT", url: localPath(upload.url), headers: upload.headers, payload: bytes });
    expect(put.statusCode).toBe(204);

    const done = await t.app.inject({ method: "POST", url: `/api/v1/files/${file.id}/complete`, headers: devHeaders(OWNER) });
    expect(done.statusCode).toBe(200);
    expect(done.json().data.status).toBe("ready");
    expect((await t.c.db.db.select().from(outbox).where(eq(outbox.aggregateId, file.id))).map((e) => e.event)).toContain("file.file.uploaded");

    const dl = await t.app.inject({ method: "GET", url: `/api/v1/files/${file.id}/download-url`, headers: devHeaders(OWNER) });
    expect(dl.statusCode).toBe(200);
    const got = await t.app.inject({ method: "GET", url: localPath(dl.json().data.url) });
    expect(got.statusCode).toBe(200);
    expect(got.rawPayload.equals(bytes)).toBe(true);
    expect(got.headers["content-disposition"]).toContain("attachment");
    expect(got.headers["x-content-type-options"]).toBe("nosniff");

    // Only the owner (until Stage 1 adds sharing).
    const other = await t.app.inject({ method: "GET", url: `/api/v1/files/${file.id}/download-url`, headers: devHeaders(OTHER) });
    expect(other.statusCode).toBe(404);
  });

  it("download links expire (5 minutes by default) and cannot be forged", async () => {
    const storage = t.c.storage as LocalStorageDriver;
    expect(t.c.config.DOWNLOAD_URL_TTL_SECONDS).toBe(300);
    const { url } = await storage.createDownloadUrl({ key: "files/x", filename: "a.txt", contentType: "text/plain", ttlSeconds: 300 });
    const u = new URL(url);
    const params = Object.fromEntries(u.searchParams) as { key: string; exp: string; ct: string; fn: string; sig: string };
    const p = { op: "get" as const, key: params.key, exp: Number(params.exp), ct: params.ct, fn: params.fn, sig: params.sig };
    expect(storage.verify(p)).toBe(true);
    expect(storage.verify(p, Date.now() + 301 * 1000)).toBe(false); // expired
    expect(storage.verify({ ...p, key: "files/other" })).toBe(false); // other key
    expect(storage.verify({ ...p, exp: p.exp + 1000 })).toBe(false); // extended expiry
    expect(storage.verify({ ...p, op: "put" })).toBe(false); // wrong operation
    const forged = await t.app.inject({ method: "GET", url: `/api/v1/storage/local/get?key=files/x&exp=${p.exp}&ct=text/plain&fn=a.txt&sig=${"0".repeat(64)}` });
    expect(forged.statusCode).toBe(403);
  });

  it("refuses wrong types, oversize files and quota overflow", async () => {
    expect((await init(OTHER, { filename: "a.exe", content_type: "application/x-msdownload", size_bytes: 10 })).json().error.code).toBe("unsupported_media_type");
    expect((await init(OTHER, { filename: "a.pdf", content_type: "application/pdf", size_bytes: 1001 })).json().error.code).toBe("payload_too_large");
    for (let i = 0; i < 3; i++) expect((await init(OTHER, { filename: `f${i}.pdf`, content_type: "application/pdf", size_bytes: 1000 })).statusCode).toBe(201);
    const over = await init(OTHER, { filename: "g.pdf", content_type: "application/pdf", size_bytes: 1 });
    expect(over.statusCode).toBe(422);
    expect(over.json().error.code).toBe("quota_exceeded");
  });

  it("the upload link only accepts the declared content type", async () => {
    const r = await init(DEV_USER, { filename: "a.csv", content_type: "text/csv", size_bytes: 3 });
    const up = r.json().data.upload;
    const bad = await t.app.inject({ method: "PUT", url: localPath(up.url), headers: { "content-type": "application/pdf" }, payload: "abc" });
    expect(bad.statusCode).toBe(415);
  });

  it("delete moves the file to the trash with a version check; purge removes the bytes", async () => {
    registerTrashTables({ config: t.c.config, storage: t.c.storage });
    const bytes = Buffer.from("bye");
    const r = await init(DEV_USER, { filename: "gone.txt", content_type: "text/plain", size_bytes: bytes.length });
    const { file, upload } = r.json().data;
    await t.app.inject({ method: "PUT", url: localPath(upload.url), headers: upload.headers, payload: bytes });
    await t.app.inject({ method: "POST", url: `/api/v1/files/${file.id}/complete`, headers: devHeaders() });

    const stale = await t.app.inject({ method: "DELETE", url: `/api/v1/files/${file.id}?version=1`, headers: devHeaders() });
    expect(stale.statusCode).toBe(409); // completing bumped the version to 2
    const del = await t.app.inject({ method: "DELETE", url: `/api/v1/files/${file.id}?version=2`, headers: devHeaders() });
    expect(del.statusCode).toBe(200);

    const [row] = await t.c.db.db.select().from(files).where(eq(files.id, file.id));
    expect(row!.deletedAt).not.toBeNull();
    expect(await t.c.storage.stat(row!.storageKey)).not.toBeNull(); // still restorable

    await t.c.db.db.execute(sql`UPDATE files SET deleted_at = now() - interval '8 days' WHERE id = ${file.id}`);
    await purgeTrash(t.c.db.db, 7);
    expect(await t.c.db.db.select().from(files).where(eq(files.id, file.id))).toHaveLength(0);
    expect(await t.c.storage.stat(row!.storageKey)).toBeNull();
  });
});

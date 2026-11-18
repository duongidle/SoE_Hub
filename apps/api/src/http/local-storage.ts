import type { FastifyPluginAsync } from "fastify";
import { AppError } from "@soe/shared";
import type { LocalSignedParams, LocalStorageDriver } from "../storage/local";

function readParams(op: "put" | "get", q: Record<string, unknown>): LocalSignedParams {
  const s = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : "");
  return { op, key: s("key"), exp: Number(s("exp")), ct: s("ct"), fn: s("fn"), sig: s("sig") };
}

/** Signed upload/download endpoints of the local (dev) storage driver. The signature is the credential. */
export function registerLocalStorageRoutes(driver: LocalStorageDriver, maxBytes: number): FastifyPluginAsync {
  return async (app) => {
    // Raw bytes for every content type (also application/json): a file is a file, not an API body.
    app.removeAllContentTypeParsers();
    app.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: maxBytes }, (_req, body, done) => done(null, body));

    app.put("/api/v1/storage/local/put", { bodyLimit: maxBytes }, async (req, reply) => {
      const p = readParams("put", req.query as Record<string, unknown>);
      if (!p.key.startsWith("files/") || !driver.verify(p)) throw new AppError("forbidden", "Link tải lên sai hoặc đã hết hạn.");
      const ct = String(req.headers["content-type"] ?? "").split(";")[0]!.trim();
      if (ct !== p.ct) throw new AppError("unsupported_media_type", "Content-Type không khớp với link đã ký.");
      const body = req.body;
      if (!Buffer.isBuffer(body)) throw new AppError("validation_error", "Thiếu nội dung file.");
      await driver.write(p.key, body);
      return reply.code(204).send();
    });

    app.get("/api/v1/storage/local/get", async (req, reply) => {
      const p = readParams("get", req.query as Record<string, unknown>);
      if (!p.key.startsWith("files/") || !driver.verify(p)) throw new AppError("forbidden", "Link tải xuống sai hoặc đã hết hạn.");
      if (!(await driver.stat(p.key))) throw new AppError("not_found", "Không có file.");
      const safeName = p.fn.replace(/["\r\n]/g, "_");
      return reply
        .header("content-type", p.ct || "application/octet-stream")
        .header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`)
        .header("x-content-type-options", "nosniff")
        .send(driver.read(p.key));
    });
  };
}

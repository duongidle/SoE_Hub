import { buildApp } from "./http/app";
import { createContainer } from "./bootstrap";
import { SseHub } from "./http/sse";

const c = createContainer();
const sse = new SseHub(c.config.DATABASE_URL, c.logger);
await sse.start();
const app = await buildApp({ ...c, sse });

if (c.auth.mode === "test") {
  c.logger.warn("TEST AUTH ĐANG BẬT: chấp nhận header X-Dev-Actor. Chỉ dùng khi chạy test (NODE_ENV=test).");
}

const shutdown = async (signal: string) => {
  c.logger.info({ signal }, "shutting down");
  await app.close();
  await sse.stop();
  await c.db.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: c.config.HOST, port: c.config.PORT });

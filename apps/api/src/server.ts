import { buildApp } from "./http/app";
import { createContainer } from "./bootstrap";
import { SseHub } from "./http/sse";

const c = createContainer();
const sse = new SseHub(c.config.DATABASE_URL, c.logger);
await sse.start();
const app = await buildApp({ ...c, sse });

if (c.auth.mode === "dev") {
  c.logger.warn("DEV AUTH ĐANG BẬT: tác nhân lấy từ header X-Dev-Actor. Chỉ dùng khi phát triển (NODE_ENV != production).");
} else {
  c.logger.warn("Chưa có đăng nhập (Stage 1): mọi thao tác cần tác nhân đều bị từ chối. Chỉ /health và system.ping hoạt động.");
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

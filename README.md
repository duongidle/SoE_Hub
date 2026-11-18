# SoE Hub

Nơi làm việc chung của team SoE (Base): deal, chỉ số, Datahub, dashboard, form, onboarding, knowledge, AI Hub, giao việc.
Thiết kế nằm trong `design/`, quy ước làm việc trong `CLAUDE.md`, tiến độ trong `progress.md`.

Trạng thái code: **Stage 0 (nền tảng)**. Chưa có đăng nhập và chưa có chức năng nghiệp vụ.

## Yêu cầu

- Node.js 22 trở lên (đã thử trên Node 24).
- pnpm 12 (`brew install pnpm`).
- PostgreSQL 17 chạy trên máy, có sẵn `pg_trgm` và `unaccent` (`brew install postgresql@17 && brew services start postgresql@17`).
- Docker chỉ cần cho production. Dev không cần.

## Chạy trên máy dev

```bash
pnpm install
cp .env.example .env          # sửa DATABASE_MIGRATE_URL / DATABASE_ADMIN_URL cho khớp user Postgres của máy
pnpm db:setup                 # tạo database soe_hub và chạy migration (chạy lại được nhiều lần)
pnpm dev                      # api :3000, worker, web :5173
```

Trên macOS với Homebrew, user Postgres mặc định là tên user máy, nên các URL có dạng `postgres://<tên-user>@localhost:5432/soe_hub`.
Nếu lệnh `psql` không có trong PATH: `export PATH=/opt/homebrew/opt/postgresql@17/bin:$PATH`.

Chạy riêng từng phần: `pnpm dev:api`, `pnpm dev:worker`, `pnpm dev:web`.

Kiểm tra:

| Địa chỉ | Nội dung |
|---|---|
| http://localhost:5173 | Trang khung (web dev, tự chuyển `/api` và `/health` sang api) |
| http://localhost:3000/health | Tình trạng api, database, worker |
| http://localhost:3000/api/docs | Tài liệu API (OpenAPI 3.1, giao diện Scalar) |
| http://localhost:3000/api/openapi.json | Tệp OpenAPI |

### Tác nhân tạm thời khi dev

Stage 0 chưa có người dùng. Khi `NODE_ENV` khác `production`, api lấy tác nhân từ header `X-Dev-Actor` (một uuid), mặc định là `DEV_ACTOR_ID` trong `.env`.
Header `X-Dev-Scopes: a:b,c:d` giới hạn quyền để thử trường hợp bị từ chối.
Phần này nằm trong `apps/api/src/auth/dev.ts`, được đánh dấu tạm thời và **bị tắt hoàn toàn khi `NODE_ENV=production`**: khi đó mọi yêu cầu cần tác nhân đều bị từ chối cho đến khi Stage 1 có đăng nhập.

Ví dụ:

```bash
curl localhost:3000/api/v1/system/whoami
curl -X PUT localhost:3000/api/v1/system/settings/trash.retention_days \
  -H 'content-type: application/json' -H 'Idempotency-Key: thu-nghiem-0001' -d '{"value": 7}'
curl -N localhost:3000/api/v1/events      # luồng SSE
```

## Lệnh thường dùng

| Lệnh | Việc |
|---|---|
| `pnpm test` | Chạy toàn bộ test (cần Postgres; tự tạo database `soe_hub_test`) |
| `pnpm typecheck` | Kiểm tra kiểu TypeScript mọi package |
| `pnpm lint` | ESLint |
| `pnpm build` | Build web và bundle api/worker/migrate |
| `pnpm db:generate` | Sinh migration từ schema Drizzle (sau khi sửa `packages/db/src/schema`) |
| `pnpm db:migrate` | Chạy migration |

Test dùng user Postgres của máy (cần quyền superuser, mặc định của Homebrew). Đổi bằng biến `TEST_ADMIN_URL`.

## Cấu trúc

```
apps/api        Fastify: registry, REST, OpenAPI, SSE, file; src/worker.ts là tiến trình worker
apps/web        React + Vite + TanStack Router/Query + Tailwind (chỉ trang khung)
packages/shared Mã lỗi, actor, cú pháp bộ lọc (Zod), dùng chung server và trình duyệt
packages/db     Schema Drizzle, migration, helper (audit, lịch sử dòng, outbox, khoá kỳ, lọc, keyset...)
packages/formula, packages/metrics   Chỗ trống, làm ở Stage 2 và 3
docs/api/bruno  Bộ request Bruno (mở thư mục này bằng Bruno, chọn môi trường dev)
design/         Thiết kế từng module
```

Thêm một thao tác mới: khai báo bằng `defineCommand` / `defineQuery` (xem `apps/api/src/modules/system/`), thêm vào `apps/api/src/modules/index.ts`.
REST, OpenAPI và (sau này) MCP đều sinh từ registry. Nhớ thêm request vào `docs/api/bruno/`; test `openapi.test.ts` sẽ báo nếu thiếu.

## Production (một VPS)

```bash
cp .env.example .env     # điền SITE_ADDRESS, POSTGRES_PASSWORD, APP_DB_PASSWORD, STORAGE_DRIVER=s3 và S3_*
docker compose up -d --build
```

Compose chạy `postgres` (không mở ra ngoài), `migrate` (chạy một lần), `api`, `worker`, `caddy` (TLS tự động, cổng 80/443). Chi tiết hạ tầng: `design/ha-tang.md`.
Tệp `docker-compose.yml` chưa được chạy thử trên máy dev vì máy không có Docker; các bản build api/worker/migrate đã được chạy thử bằng `node dist/*.js`.

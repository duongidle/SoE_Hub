# Tiến độ

Cập nhật: 18/11/2026

## Giai đoạn hiện tại

- Thiết kế: Module 0 đã chốt; đang chuẩn bị Module 1 (phiên khác lo).
- Code: **Stage 0 đang làm** trên nhánh `dev`.

## Đã xong

- Phân tích brief, file mẫu, chốt tech stack, thiết kế Module 0 và hạ tầng.
- Stage 0, bước 1: khung monorepo pnpm (`apps/api`, `apps/web`, `packages/{shared,db,formula,metrics}`), cấu hình TS, vitest.
- Stage 0, bước 2: `packages/shared` (mã lỗi, actor, bộ lọc Zod) và `packages/db` (schema Drizzle, 2 migration, audit append-only bằng quyền + trigger, `row_history`, outbox, idempotency, khoá kỳ, snapshot, file, settings, thùng rác + purge, versionedUpdate, filter DSL → SQL, keyset). 36 test DB pass.

- Stage 0, bước 3: `apps/api` đủ lõi: registry + executor (audit, outbox, idempotency trong giao dịch), actor/authorize cắm được (dev-only, production khoá), REST sinh từ registry, OpenAPI + Scalar `/api/docs`, `/health`, SSE, file storage (S3 + local, link ký số), rate limit, header bảo mật; worker pg-boss + dispatcher outbox + 4 job; bộ Bruno đủ endpoint. 83 test pass, typecheck + lint sạch.

## Đang làm (Stage 0)

Còn lại:
1. `apps/web` tối thiểu (React + Vite + TanStack Router/Query + Tailwind/shadcn): trang khung + trạng thái `/health`.
2. `Dockerfile`, `docker-compose.yml`, `Caddyfile`, `README.md`.
3. Mục "Quyết định khi code" trong `design/module0-nen-tang.md`.
4. Kiểm tra cuối: chạy api + worker + web thật, `pnpm build`, test, lint, typecheck.

## Bước tiếp theo

- Làm mục 1: tạo `apps/web` (package.json, vite.config.ts, index.html, src/main.tsx, src/routes). Dev server proxy `/api` và `/health` sang `localhost:3000`.

## Câu hỏi còn mở

- Module 1: Leader có được đẩy cột chung xuống team không, hay chỉ Manager?
- Module 4: CR1→CR4 là những bước nào; cách tính winrate theo cycle (đề xuất: theo cohort, chỉ tính nhóm deal đã nhận lâu hơn cycle trung vị); có theo dõi thanh toán nhiều đợt ngay từ bản đầu không.

# Tiến độ

Cập nhật: 18/11/2026

## Giai đoạn hiện tại

- Thiết kế: Module 0 đã chốt; đang chuẩn bị Module 1 (phiên khác lo).
- Code: **Stage 0 đang làm** trên nhánh `dev`.

## Đã xong

- Phân tích brief, file mẫu, chốt tech stack, thiết kế Module 0 và hạ tầng.
- Stage 0, bước 1: khung monorepo pnpm (`apps/api`, `apps/web`, `packages/{shared,db,formula,metrics}`), cấu hình TS, vitest.
- Stage 0, bước 2: `packages/shared` (mã lỗi, actor, bộ lọc Zod) và `packages/db` (schema Drizzle, 2 migration, audit append-only bằng quyền + trigger, `row_history`, outbox, idempotency, khoá kỳ, snapshot, file, settings, thùng rác + purge, versionedUpdate, filter DSL → SQL, keyset). 36 test DB pass.

## Đang làm (Stage 0)

Kế hoạch các bước còn lại:
1. `apps/api` lõi: config, registry (defineCommand/defineQuery), actor + authorize cắm được (dev-only), lỗi chuẩn, audit/outbox/idempotency trong executor, REST sinh từ registry.
2. Lệnh mẫu `system.*`, file storage (S3 + local), SSE, OpenAPI + Scalar `/api/docs`, `/health`, rate limit, header bảo mật.
3. Worker: pg-boss, dispatcher outbox, job mẫu, dọn thùng rác, dọn idempotency.
4. `apps/web` tối thiểu (React + Vite + TanStack + Tailwind).
5. Docker Compose, Caddyfile, `.env.example`, README, bộ Bruno, ESLint.
6. Ghi mục "Quyết định khi code" vào `design/module0-nen-tang.md`.

## Bước tiếp theo

- Làm bước 1 ở trên: tạo `apps/api/src/core/*` (registry, executor). Chưa có file nào trong `apps/api/src`.

## Câu hỏi còn mở

- Module 1: Leader có được đẩy cột chung xuống team không, hay chỉ Manager?
- Module 4: CR1→CR4 là những bước nào; cách tính winrate theo cycle (đề xuất: theo cohort, chỉ tính nhóm deal đã nhận lâu hơn cycle trung vị); có theo dõi thanh toán nhiều đợt ngay từ bản đầu không.

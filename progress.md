# Tiến độ

Cập nhật: 18/11/2026

## Giai đoạn hiện tại

- Thiết kế: Module 0, Module 1 đã chốt.
- Code: **Stage 0 đang hoàn thiện**, sau đó Stage 1, trên nhánh `dev`.

## Đã xong

- Phân tích brief, file mẫu, chốt tech stack, thiết kế Module 0, hạ tầng, Module 1.
- **Stage 0 xong** (18/11/2026): monorepo, `packages/shared`, `packages/db` (schema, migration, audit append-only + dọn có kiểm soát sau 2 năm, lịch sử dòng, outbox, idempotency, khoá kỳ, snapshot, file, settings, thùng rác, lọc, keyset), `apps/api` (registry, executor, REST, OpenAPI + Scalar, `/health`, SSE, file, rate limit, worker pg-boss + 5 job), `apps/web` tối thiểu, Docker/compose/Caddy, README, Bruno, `pnpm docs:openapi`. 90 test pass; build, lint, typecheck sạch; đã chạy thật api + worker + web và bản bundle production.

## Đang làm

- Stage 1 (Module 1): lên kế hoạch.

## Bước tiếp theo

- Ghi kế hoạch Stage 1 vào mục "Đang làm".

## Câu hỏi còn mở

- Module 1: Leader có được đẩy cột chung xuống team không, hay chỉ Manager?
- Module 4: CR1→CR4 là những bước nào; cách tính winrate theo cycle (đề xuất: theo cohort, chỉ tính nhóm deal đã nhận lâu hơn cycle trung vị); có theo dõi thanh toán nhiều đợt ngay từ bản đầu không.
- `docker-compose.yml` chưa chạy thử (máy dev không có Docker): phải chạy thử trên VPS trước khi dùng thật.

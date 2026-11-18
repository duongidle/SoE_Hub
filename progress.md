# Tiến độ

Cập nhật: 18/11/2026

## Giai đoạn hiện tại

- Thiết kế: Module 0, Module 1 đã chốt.
- Code: **Stage 0 đang hoàn thiện**, sau đó Stage 1, trên nhánh `dev`.

## Đã xong

- Phân tích brief, file mẫu, chốt tech stack, thiết kế Module 0, hạ tầng, Module 1.
- Stage 0, bước 1–3: monorepo, `packages/shared`, `packages/db` (schema, migration, audit append-only, lịch sử dòng, outbox, idempotency, khoá kỳ, snapshot, file, settings, thùng rác, lọc, keyset), `apps/api` (registry, executor, REST, OpenAPI + Scalar, `/health`, SSE, file, rate limit, worker pg-boss + 4 job), Bruno. 84 test pass.
- Stage 0, bước 4–5: `apps/web` tối thiểu (khung + tình trạng `/health`), `Dockerfile`, `docker-compose.yml`, `Caddyfile`, `README.md`. `pnpm build` chạy được.

## Đang làm (Stage 0, phần cuối)

1. Migration `0002_audit_purge`: hàm `soe_purge_audit_before(cutoff)` (SECURITY DEFINER, sàn 2 năm, cài đặt `audit.retention_days`), trigger cho phép xoá chỉ trong hàm; job `system-audit-purge` hằng tháng; test.
2. Script `pnpm docs:openapi` → `docs/api/openapi.json` + test kiểm tra file khớp.
3. Ghi "Quyết định khi code" Module 0 (purge audit, docs, compose chưa chạy thử).
4. Kiểm tra cuối (chạy thật api + worker + web, build, test, lint, typecheck) → đánh dấu Stage 0 xong, commit.

## Bước tiếp theo

- Mục 1: viết `packages/db/drizzle/0002_audit_purge.sql` (thêm vào `meta/_journal.json`), job ở `apps/api/src/jobs/index.ts`.

## Câu hỏi còn mở

- Module 1: Leader có được đẩy cột chung xuống team không, hay chỉ Manager?
- Module 4: CR1→CR4 là những bước nào; cách tính winrate theo cycle (đề xuất: theo cohort, chỉ tính nhóm deal đã nhận lâu hơn cycle trung vị); có theo dõi thanh toán nhiều đợt ngay từ bản đầu không.
- `docker-compose.yml` chưa chạy thử (máy dev không có Docker): phải chạy thử trên VPS trước khi dùng thật.

# Tiến độ

Cập nhật: 18/11/2026

## Giai đoạn hiện tại

- Thiết kế: Module 0, Module 1 đã chốt.
- Code: Stage 0 xong. **Stage 1 đang làm** trên nhánh `dev`.

## Đã xong

- Phân tích brief, file mẫu, chốt tech stack, thiết kế Module 0, hạ tầng, Module 1.
- **Stage 0 xong** (18/11/2026): monorepo, `packages/shared`, `packages/db` (schema, migration, audit append-only + dọn có kiểm soát sau 2 năm, lịch sử dòng, outbox, idempotency, khoá kỳ, snapshot, file, settings, thùng rác, lọc, keyset), `apps/api` (registry, executor, REST, OpenAPI + Scalar, `/health`, SSE, file, rate limit, worker pg-boss + 5 job), `apps/web` tối thiểu, Docker/compose/Caddy, README, Bruno, `pnpm docs:openapi`. 90 test pass; build, lint, typecheck sạch; đã chạy thật api + worker + web và bản bundle production.

## Đang làm

Stage 1 (Module 1), kế hoạch:
1. Schema + migration `0003`: `users` (kind person/service/system, roles[], trạng thái), `org_memberships`, `user_permissions`, `sessions`, `auth_codes`, `api_tokens`, `service_accounts`, `notifications`, `data_grants`; dòng `SYSTEM_USER_ID`; khoá ngoại `*_by`/`owner_id`/`actor_user_id`.
2. `packages/shared/permissions.ts`: danh mục quyền, bảng vai trò → quyền, quyền bổ sung, mẫu Guest.
3. Lõi auth ở `apps/api/src/auth/`: argon2id (hash-wasm), mật khẩu phổ biến, session + cookie + CSRF, `ActorResolver` (cookie, `soe_pat_`, `soe_svc_`), `Authorizer`, phạm vi dữ liệu → SQL, chặn truy vấn thẳng bảng có chủ.
4. Module `auth`/`org`/`notification`/`guest`/`transfer`: command/query, mã 6 số, thông báo qua outbox, SSE lọc theo quyền, nhật ký Admin (lọc, chi tiết, xuất), cài đặt, Google (tắt mặc định), CLI `admin:create`, `auth:reset-code`.
5. Test: ma trận quyền, luồng mã, khoá, phiên, CSRF, token, lịch sử org, chuyển giao, SSE, truy vấn có phạm vi. Sửa test Stage 0 theo auth thật.
6. Web: các trang mục 11. Bruno + `pnpm docs:openapi`. Ghi "Quyết định khi code" Module 1.

## Bước tiếp theo

- Mục 1: viết schema ở `packages/db/src/schema/{users,auth,notifications,grants}.ts`, rồi `pnpm db:generate`, sửa SQL sinh ra để thêm dòng hệ thống và khoá ngoại.

## Câu hỏi còn mở

- Module 4: CR1→CR4 là những bước nào; cách tính winrate theo cycle (đề xuất: theo cohort, chỉ tính nhóm deal đã nhận lâu hơn cycle trung vị); có theo dõi thanh toán nhiều đợt ngay từ bản đầu không.
- `docker-compose.yml` chưa chạy thử (máy dev không có Docker): phải chạy thử trên VPS trước khi dùng thật.

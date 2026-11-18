# Tiến độ

Cập nhật: 18/11/2026

## Giai đoạn hiện tại

- Thiết kế: Module 0, Module 1 đã chốt.
- Code: Stage 0 xong. **Stage 1 đang làm** trên nhánh `dev`.

## Đã xong

- Phân tích brief, file mẫu, chốt tech stack, thiết kế Module 0, hạ tầng, Module 1.
- **Stage 0 xong** (18/11/2026): monorepo, `packages/shared`, `packages/db` (schema, migration, audit append-only + dọn có kiểm soát sau 2 năm, lịch sử dòng, outbox, idempotency, khoá kỳ, snapshot, file, settings, thùng rác, lọc, keyset), `apps/api` (registry, executor, REST, OpenAPI + Scalar, `/health`, SSE, file, rate limit, worker pg-boss + 5 job), `apps/web` tối thiểu, Docker/compose/Caddy, README, Bruno, `pnpm docs:openapi`. 90 test pass; build, lint, typecheck sạch; đã chạy thật api + worker + web và bản bundle production.

## Đang làm (Stage 1, bàn giao giữa chừng)

Đã xong (API + test, commit `e1b409b`, `b554176`):
- Migration `0003_stage1_accounts` (users, org_memberships, user_permissions, sessions, auth_codes, api_tokens, service_accounts, notifications, data_grants; dòng `SYSTEM_USER_ID`; khoá ngoại `*_by`/`owner_id`/`actor_user_id`). Quyền ở `packages/shared/src/permissions.ts`.
- `apps/api/src/auth/`: argon2id (hash-wasm), ~1.000 mật khẩu phổ biến, phiên cookie + CSRF ký theo phiên, `SessionTokenResolver` (`soe_pat_`, `soe_svc_`), `RoleAuthorizer`, `AccessContext` + phạm vi dữ liệu → SQL, `query-guard.ts` chặn truy vấn thẳng `files`/`notifications` khi không phải production. `X-Dev-Actor` chỉ còn khi NODE_ENV=test.
- Module `auth`, `org`, `notification`, `guest`, `transfer`, nhật ký (get/export CSV/che giá trị), cài đặt có kiểm tra; Google (`modules/auth/google.ts`, tắt mặc định); CLI `pnpm cli admin:create --email …` / `auth:reset-code`; job dọn phiên, xoá mã khỏi thông báo sau 6 giờ; SSE lọc theo audience của sự kiện.
- Bruno đủ endpoint (`pnpm docs:bruno` sinh file thiếu), `docs/api/openapi.json` cập nhật. 293 test pass, lint/typecheck/build sạch.
- Web (chưa commit trước đây, commit này): `lib/api.ts` (fetch + CSRF), `lib/session.tsx` (`useMe`, `can`, `useLiveUpdates` SSE), `components/ui/form.tsx`; trang `pages/auth.tsx` (đăng nhập, đăng ký/quên mật khẩu bằng mã, đặt mật khẩu Google), `pages/org.tsx` (bảng + cây, thêm/sửa, khoá/mở khoá, quyền bổ sung, lịch sử, thu hồi phiên), `pages/account.tsx` (đổi mật khẩu, thiết bị, token cá nhân, hộp thông báo, `TokenTable` dùng lại cho Admin). Route đã khai báo trong `router.tsx`. **Chưa chạy thử trong trình duyệt.**

Còn lại:
1. `pages/shell.tsx`: chặn route theo đăng nhập (chưa đăng nhập → `/dang-nhap`; `must_set_password` → `/dat-mat-khau`), menu theo quyền, chuông (`/notifications/unread-count`, query key `["unread"]`), menu tài khoản + đăng xuất (`POST /auth/logout`), gọi `useLiveUpdates`. Sửa `pages/home.tsx` (bỏ chữ "Stage 0, chưa có đăng nhập").
2. Trang chưa viết: `pages/admin.tsx` gồm duyệt token (`/admin/tokens`, approve/reject), tài khoản hệ thống (`/admin/service-accounts`, tạo token `soe_svc_`), nhật ký (`/system/audit-log` lọc + chi tiết `/system/audit-log/:id` + nút xuất `/system/audit-log/export`), chuyển giao (`/admin/transfer/preview` → `/admin/transfer`, và `/admin/trees/:manager_id/transfer`), cài đặt (`/system/settings-catalog` + `PUT /system/settings/:key`, nhớ gửi `version` khi sửa); `pages/guest.tsx` cấp dữ liệu Guest (`/guest/data-types`, `/guest/grants`; hiện chưa có loại dữ liệu nào, chỉ là khung). Thêm route `/quan-tri/token`, `/quan-tri/tai-khoan-he-thong`, `/quan-tri/nhat-ky`, `/quan-tri/chuyen-giao`, `/quan-tri/cai-dat`, `/cap-du-lieu`.
3. Kiểm tra bằng trình duyệt thật (CLAUDE.md "Định nghĩa xong" mục 5): chạy `pnpm dev`, Playwright (thêm devDependency), đi hết luồng: `pnpm cli admin:create` → đăng nhập → thêm người → đăng ký bằng mã lấy từ thông báo → đăng nhập user/leader/manager → quên mật khẩu → token + Admin duyệt → nhật ký → cài đặt → chuyển giao; desktop + điện thoại; không lỗi console/network; ghi kết quả vào đây. Chú ý: `tsx watch` hay để lại tiến trình giữ cổng 3000, kiểm tra `lsof -iTCP:3000` trước khi chạy.
4. Ghi mục "Quyết định khi code" cuối `design/module1-tai-khoan-phan-quyen.md` (**chưa viết**). Các quyết định cần ghi: tự viết auth thay better-auth (hash-wasm argon2id, arctic cho Google, `@fastify/cookie`) vì luồng mã kích hoạt + org chart + không email; CSRF = HMAC(session id) gửi qua cookie `soe_csrf` + header; tên quyền (`knowledge:article:read`, `org:role:elevated`, `review:reviewer:choose`…); token không mang `auth:*`/`onboarding:*`; Admin không tự duyệt token của mình khi còn Admin khác; chuyển giao token = thu hồi (không trao credential cho người khác); Guest tự đăng ký chỉ tạo dòng `users` khi nhập đúng mã; mã gửi qua outbox được mã hoá AES-GCM; lệnh công khai bỏ qua Idempotency-Key; `ctx.outside` cho bộ đếm sai mật khẩu/mã; query guard + marker `/*scope*/`; SSE audience; Leader/Manager còn người dưới quyền thì không gỡ vai trò; system user có mọi quyền nhưng không đăng nhập được; migration tạo dòng giữ chỗ khoá cho actor cũ của Stage 0.
5. README: thay phần "Tác nhân tạm thời khi dev" bằng cách bootstrap (`pnpm cli admin:create --email …` → trang Đăng ký → "Tôi đã có mã"), biến `AUTH_SECRET`, `GOOGLE_CLIENT_ID/SECRET` (thêm vào `.env.example` và `docker-compose.yml`, hiện **chưa thêm**), lệnh `docs:bruno`, `cli`; Docker: `docker compose exec api node dist/cli.js admin:create --email …`.
6. Cuối cùng: `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm docs:openapi`, đánh dấu Stage 1 xong.

## Bước tiếp theo

- Làm mục 1 (shell + chặn route) ở `apps/web/src/pages/shell.tsx`, rồi mục 2, rồi mục 3–6 theo thứ tự trên.

## Câu hỏi còn mở

- Module 4: CR1→CR4 là những bước nào; cách tính winrate theo cycle (đề xuất: theo cohort, chỉ tính nhóm deal đã nhận lâu hơn cycle trung vị); có theo dõi thanh toán nhiều đợt ngay từ bản đầu không.
- `docker-compose.yml` chưa chạy thử (máy dev không có Docker): phải chạy thử trên VPS trước khi dùng thật.

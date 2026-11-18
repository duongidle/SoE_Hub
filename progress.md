# Tiến độ

Cập nhật: 18/11/2026

## Giai đoạn hiện tại

- Thiết kế: Module 0, 1, 2 đã chốt.
- Code: Stage 0 và **Stage 1 xong** (18/11/2026) trên nhánh `dev`. Stage 2 (Module 2 – Datahub) chờ Opus giao việc.

## Đã xong

- Phân tích brief, file mẫu, chốt tech stack, thiết kế Module 0, hạ tầng, Module 1, Module 2.
- **Stage 0 xong**: monorepo, schema + migration, registry, audit append-only, lịch sử dòng, outbox, worker pg-boss, SSE, file, OpenAPI, Docker/compose/Caddy.
- **Stage 1 xong**:
  - API: tài khoản, org chart, vai trò, quyền bổ sung, phiên + CSRF, mã kích hoạt/quên mật khẩu, Google (tắt mặc định), token cá nhân + duyệt, tài khoản hệ thống, thông báo, cấp dữ liệu Guest (khung), chuyển giao, nhật ký + xuất CSV, cài đặt, CLI `admin:create` / `auth:reset-code`. Bruno + OpenAPI đủ.
  - Web: shell chặn route theo đăng nhập và quyền, chuông SSE, menu theo quyền; đăng nhập/đăng ký/quên mật khẩu/đặt mật khẩu; org chart; tài khoản, token, thông báo; Admin: duyệt token, tài khoản hệ thống, nhật ký, chuyển giao, cài đặt; Manager: cấp dữ liệu Guest (trống).
  - Cấu hình: `AUTH_SECRET` (bắt buộc ở production, có test), `GOOGLE_*`, `SESSION_*` trong `.env.example` và `docker-compose.yml`; README có cách tạo Admin đầu tiên, đặt lại mật khẩu Admin duy nhất, chạy test, chạy test giao diện.
  - "Quyết định khi code" của Module 1 đã ghi vào `design/module1-tai-khoan-phan-quyen.md`.

### Kết quả kiểm thử Stage 1

- `pnpm test`: 302 test pass (20 file). `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm docs:openapi`, `pnpm docs:bruno` sạch (không thêm endpoint mới).
- `pnpm test:e2e` (Playwright, DB rỗng `soe_hub_e2e`, api + worker + web thật): **16 luồng x 2 bề ngang (desktop 1440x900, điện thoại 390x844) = 32 pass**, kèm kiểm tra trang không tràn ngang và ngày dd/mm/yyyy, mỗi phiên kiểm tra không lỗi console/network (trừ 401/403/423 khai báo trước). Ảnh chụp ở `apps/web/e2e/screenshots/` (không commit).
- Luồng đã đi: CLI tạo Admin -> đăng ký bằng mã -> đăng nhập; đăng xuất xoá phiên, trang bảo vệ về đăng nhập rồi quay lại đúng trang; Admin thấy menu quản trị; Admin thêm Manager/Leader/User; mã đăng ký hiện ở chuông Admin, Manager, Leader ngay (SSE, không tải lại); User đăng nhập; quên mật khẩu (Leader đọc mã); sai 5 lần thì khoá; token cá nhân tạo -> chờ duyệt -> Admin duyệt -> gọi API Bearer được; tài khoản hệ thống (token hiện một lần, dùng, thu hồi); trang Guest trống của Manager; User mở trang Admin thấy "Không có quyền" + API 403; cài đặt (đổi, lưu, tải lại, sai giá trị báo tiếng Việt); nhật ký (lọc hành động/người/kết quả/kênh/thời gian, chi tiết cũ -> mới, phân trang, xuất CSV); chuyển giao dữ liệu (xem trước, xác nhận, kết quả, nguồn bị khoá).
- Lỗi đã sửa: (1) `GET /org/members` trả `roles` là chuỗi, trang Org chart sập; (2) `GET /system/settings` trả `value` là chuỗi JSON, nút bật/tắt cài đặt không phản ánh; (3) trang bảo vệ vẫn dựng và gọi API (401) trong lúc router chuyển trang; (4) đăng xuất làm trang cũ gọi lại API bằng phiên đã chết; (5) ô số của cài đặt bị kiểm tra bằng thông báo của trình duyệt (tiếng Anh) thay vì tiếng Việt. (6) nhật ký bị ngập dòng `auth.me` chưa đăng nhập; (7) dòng ẩn danh thiếu kênh/IP/email; (8) bảng nhật ký bị cắt trên điện thoại (nay dạng thẻ); (9) ô ngày hiện mm/dd/yyyy (nay dd/mm/yyyy); (10) test đổi mật khẩu vai trò `soe_app` của database dev (nay vai trò riêng). Có test hồi quy cho (1), (2), (6), (7), (10).
- Chưa kiểm thử giao diện: chuyển cả cây (`/admin/trees/:id/transfer`, có test API), đăng nhập Google (cần Google Cloud thật), `docker-compose.yml` (máy dev không có Docker).

## Đang làm: Stage 2 (Module 2 – Datahub), do Sonnet code, Opus rà soát

Kế hoạch Stage 2:
- **2A – Lưu trữ và API lõi** (đang làm, nhánh `dev`).
- 2B – Engine công thức, cột tính toán (formula, relation/lookup/rollup), tính lại, golden test.
- 2C – Giao diện grid, view kiểu Lark tự lưu, trình soạn công thức, chia sẻ/thùng rác/giới hạn.
- 2D – Import/export, import công thức, load test 100k dòng, e2e cả stage.

Các bước của 2A (đánh dấu khi xong):
- [ ] 1. Schema + migration (datahub, bảng, cột, dòng, view, chia sẻ, giới hạn riêng, hàm SQL cho index và view xuất)
- [ ] 2. Tên, kiểu cột (registry cắm được), ColumnSource, truy cập/chia sẻ
- [ ] 3. API cấu trúc: datahub, bảng, cột, đổi kiểu (xem trước), view, chia sẻ, giới hạn
- [ ] 4. API dòng: CRUD, batch, upsert, lọc, sắp xếp, keyset, gộp ô, lịch sử, thùng rác
- [ ] 5. SSE, chuyển giao, view SQL `dh_views`, tự tạo index, thiết lập quyền/cài đặt
- [ ] 6. Test, OpenAPI, Bruno, README, quyết định khi code

## Bước tiếp theo

- Làm bước 1 của 2A: `packages/db/src/schema/datahub.ts` + migration `0004`.

## Câu hỏi còn mở

- Module 4: CR1→CR4 là những bước nào; cách tính winrate theo cycle (đề xuất: theo cohort, chỉ tính nhóm deal đã nhận lâu hơn cycle trung vị); có theo dõi thanh toán nhiều đợt ngay từ bản đầu không.
- `docker-compose.yml` chưa chạy thử (máy dev không có Docker): phải chạy thử trên VPS trước khi dùng thật. Biến `AUTH_SECRET` giờ bắt buộc trong compose.
- Đăng nhập Google chưa thử với Google thật; cần tạo Google Cloud client (xem `design/ha-tang.md` mục 4) rồi thử một lần trước khi bật.
- Danh sách token cần duyệt và tài khoản hệ thống chưa phân trang (giới hạn 500); phân trang ở Stage 5 khi có kết nối AI.

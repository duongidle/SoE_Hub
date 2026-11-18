# Tiến độ

Cập nhật: 18/11/2026

## Giai đoạn hiện tại

- Thiết kế: Module 0, 1, 2, **3** đã chốt (Module 3 có Bảng gộp, lọc chéo, chịu tải; Module 2 có thêm mục 7a Tìm dòng trùng). **Module 4: bản nháp** `design/module4-quan-ly-deal.md` (18/11), chờ Dương chốt.
- Code: Stage 0 và **Stage 1 xong** (18/11/2026) trên nhánh `dev`. **Stage 2 phần 2A code xong**, chờ Opus rà soát.

## Ghi chú điều phối (Opus) — đọc trước khi làm tiếp

1. 2A đã rà soát, đã push `main` + `dev` (18/11). **Dương bảo làm 2B (18/11).** 2B xong thì Opus rà soát, báo Dương, chờ Dương bảo mới làm 2C.
2. Nếu phiên trước bị ngắt khi 2A chưa xong: agent 2A có thể đã dừng giữa chừng. Xem danh sách bước 2A bên dưới, `git status`, `git log`; giao Sonnet làm tiếp từ bước chưa đánh dấu (prompt: đọc CLAUDE.md, progress.md, `design/module2-datahub.md` + "Quyết định khi code" của Module 0/1; phạm vi 2A như danh sách bước; không làm 2B/2C/2D).
3. Ghi nhớ cho các phần sau của Stage 2:
   - 2B: golden test được đọc thẳng `examples/Quản lý Deal SoE (Dương TVD).xlsx` (Dương cho phép), không commit dữ liệu lấy từ file, máy không có file thì test tự bỏ qua.
   - 2C: làm cả công cụ **Tìm dòng trùng** (Module 2 mục 7a).
   - Bảng gộp thuộc Stage 3 (Module 3 mục 4), không làm ở Stage 2.
4. **Module 4 đang chờ Dương chốt bản nháp.** Chốt xong: đổi trạng thái file thành `Đã chốt`, cập nhật bảng module và "Quy định đã chốt" trong CLAUDE.md (chia 4A/4B, winrate cohort, CR1 là tham số kế hoạch).
5. **Golden test 2B:** sheet `Deals` của file mẫu không có dòng dữ liệu, Index/Cumulative Index trong file đều bằng 0. Golden test so số phải dùng `Raw PODPS` + script tham chiếu (Module 4 mục 18); công thức của sheet Index vẫn dùng để test engine công thức.

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
- **2A – Lưu trữ và API lõi** (xong, đã rà soát).
- **2B – Engine công thức, cột tính toán (formula, relation/lookup/rollup), tính lại, golden test** (đang làm).
- 2C – Giao diện grid, view kiểu Lark tự lưu, trình soạn công thức, chia sẻ/thùng rác/giới hạn.
- 2D – Import/export, import công thức, load test 100k dòng, e2e cả stage.

Các bước của 2A (đánh dấu khi xong):
- [x] 1. Schema + migration
- [x] 2. Tên, kiểu cột, ColumnSource, truy cập/chia sẻ
- [x] 3. API cấu trúc
- [x] 4. API dòng
- [x] 5. SSE, chuyển giao, view SQL `dh_views`, tự tạo index
- [x] 6. Test, OpenAPI, Bruno, README, quyết định khi code (xong, chờ Opus rà soát)

### Kết quả kiểm thử 2A

- `pnpm test`: 27 file, 396 test pass (chạy hai lần). `pnpm lint`, `pnpm typecheck`, `pnpm build` sạch (lint: đổi `console.log` thành `console.warn` trong test tốc độ).
- 2A chưa có giao diện (giao diện là 2C) nên không có test trình duyệt.
- Test tốc độ 100.000 dòng (`npx vitest run apps/api/test/datahub-perf.test.ts`), trung vị 7 lần, trang 50 dòng:
  - Trước index: lọc Mức+Doanh thu, sắp Mức+Hạn 23 ms; lọc Hạn, sắp Doanh thu 81 ms; lọc Nhãn 39 ms; chỉ sắp Doanh thu + tổng 43 ms; trang 500 dòng 7 ms; lọc chứa chữ 53 ms; tìm kiếm 4 ms.
  - Sau index tự động (4 index): 38, 35, 2,7, 15, 4,5, 43, 5 ms. Trang keyset kế tiếp 2,7 ms mỗi trang. Nạp 100.000 dòng mất khoảng 3,4 s.
- 4 lỗi test phụ thuộc thứ tự đã sửa: (1) `worker.test.ts` không dọn outbox còn tồn; (2) `datahub-infra.test.ts` đếm index toàn DB thay vì theo bảng của test; (3) cùng file thiếu `ANALYZE` trước `EXPLAIN`; (4) `auth.test.ts` không khôi phục cài đặt mặc định.

## Bước tiếp theo

Các bước của 2B (Sonnet đánh dấu khi xong, commit sau mỗi bước):
- [x] 1. `packages/formula`: lexer/parser (`src/parser.ts`), AST, tham chiếu tên ↔ mã (`src/refs.ts`: lưu dạng `{c_xxx}` / `{<uuid bảng>.c_xxx}`), suy kiểu (`infer.ts`), lỗi Excel (`types.ts`), phân tích phụ thuộc và lời gọi gom nhóm được (`analyze.ts`)
- [x] 2. Thư viện hàm 113 hàm (`src/functions/*.ts`, danh mục `catalog.ts`) + điều kiện kiểu Excel (`criteria.ts`); `pnpm vitest run packages/formula` = 26 test pass
- [ ] 3. Kiểu cột formula, relation, lookup, rollup (bỏ `available: false` ở `apps/api/src/modules/datahub/column-types.ts`); migration `0006` (cột `calc_*` của `dh_columns`, bảng `dh_formula_deps`); kiểm tra khi lưu (cùng chủ, vòng lặp, `#REF!`, ngưỡng 20.000)
- [ ] 4. Tính lại: cùng dòng trong lúc lưu (`row-ops.ts`/`rows.ts`); khác bảng qua worker; cả cột khi tạo/sửa (tiến độ); `TODAY()` 00:05, `NOW()` mỗi giờ, chạy bù; không sinh log; SSE
- [ ] 5. Gom nhóm SQL cho tra cứu/tổng hợp điều kiện bằng; test tốc độ 100k × 100k
- [ ] 6. Golden test với công thức file mẫu (máy không có file thì bỏ qua)
- [ ] 7. API xem trước công thức + danh mục hàm; OpenAPI, Bruno, README, quyết định khi code

## Câu hỏi còn mở

- Module 4 (bản nháp): mốc "cohort đã chín" P75 hay trung vị; CR1 là tham số kế hoạch; có làm com tạm tính ở 4A không; trọng số workload; nguồn tiền thực nhận cho 4B (đề xuất BPM). Chi tiết mục 12.4 của file thiết kế.
- `docker-compose.yml` chưa chạy thử (máy dev không có Docker): phải chạy thử trên VPS trước khi dùng thật. Biến `AUTH_SECRET` giờ bắt buộc trong compose.
- Đăng nhập Google chưa thử với Google thật; cần tạo Google Cloud client (xem `design/ha-tang.md` mục 4) rồi thử một lần trước khi bật.
- Danh sách token cần duyệt và tài khoản hệ thống chưa phân trang (giới hạn 500); phân trang ở Stage 5 khi có kết nối AI.

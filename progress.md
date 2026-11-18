# Tiến độ

Cập nhật: 18/11/2026

## Giai đoạn hiện tại

- Thiết kế: Module 0, 1, 2, **3** đã chốt (Module 3 có Bảng gộp, lọc chéo, chịu tải; Module 2 có thêm mục 7a Tìm dòng trùng). **Module 4: bản nháp vòng 2** `design/module4-quan-ly-deal.md` (18/11), chờ Dương chốt.
- Code: Stage 0 và Stage 1 xong. Stage 2: 2A xong và đã rà soát; **2B (công thức) code xong, chờ Opus rà soát**; 2C, 2D chưa làm.

## Ghi chú điều phối (Opus) — đọc trước khi làm tiếp

1. 2A đã rà soát, đã push `main` + `dev`. **2B code xong (18/11), chờ Opus rà soát**, báo Dương, chờ Dương bảo mới làm 2C. Nếu phiên bị ngắt: xem `git status`, `git log`, danh sách bước 2B bên dưới.
3. Ghi nhớ cho các phần sau của Stage 2:
   - 2B: golden test được đọc thẳng `examples/Quản lý Deal SoE (Dương TVD).xlsx` (Dương cho phép), không commit dữ liệu lấy từ file, máy không có file thì test tự bỏ qua.
   - 2C: làm cả công cụ **Tìm dòng trùng** (Module 2 mục 7a).
   - 2C: làm cả ô **Lọc theo thời gian** (Module 2 mục 5.4, bổ sung 18/11): lưu trong `config.time_filter` của view, server dịch sang `between`/toán tử ngày; không cần đổi schema.
   - Bảng gộp thuộc Stage 3 (Module 3 mục 4), không làm ở Stage 2.
4. **Module 4 đang chờ Dương chốt bản nháp.** Chốt xong: đổi trạng thái file thành `Đã chốt`, cập nhật bảng module và "Quy định đã chốt" trong CLAUDE.md (mục 18 của file: template Admin + Manager, bốn lớp cột, datahub "Quản lý Deal" được tạo bảng và được bảo vệ, Deals/Probation KPI theo phạm vi deal). Khi code Stage 4 làm mục 19 (đối chiếu Module 2).
5. Golden test 2B đã làm (đọc file mẫu, 3.322 công thức); số liệu và hai điểm lạ của file mẫu ở `design/module2-datahub.md` mục 2B.

## Đã xong

- Phân tích brief, file mẫu, chốt tech stack, thiết kế Module 0, hạ tầng, Module 1, Module 2.
- **Stage 0 xong**: monorepo, schema + migration, registry, audit append-only, lịch sử dòng, outbox, worker pg-boss, SSE, file, OpenAPI, Docker/compose/Caddy.
- **Stage 1 xong**:
  - API: tài khoản, org chart, vai trò, quyền bổ sung, phiên + CSRF, mã kích hoạt/quên mật khẩu, Google (tắt mặc định), token cá nhân + duyệt, tài khoản hệ thống, thông báo, cấp dữ liệu Guest (khung), chuyển giao, nhật ký + xuất CSV, cài đặt, CLI `admin:create` / `auth:reset-code`. Bruno + OpenAPI đủ.
  - Web: shell chặn route theo đăng nhập và quyền, chuông SSE, menu theo quyền; đăng nhập/đăng ký/quên mật khẩu/đặt mật khẩu; org chart; tài khoản, token, thông báo; Admin: duyệt token, tài khoản hệ thống, nhật ký, chuyển giao, cài đặt; Manager: cấp dữ liệu Guest (trống).
  - Cấu hình: `AUTH_SECRET` (bắt buộc ở production, có test), `GOOGLE_*`, `SESSION_*` trong `.env.example` và `docker-compose.yml`; README có cách tạo Admin đầu tiên, đặt lại mật khẩu Admin duy nhất, chạy test, chạy test giao diện.
  - "Quyết định khi code" của Module 1 đã ghi vào `design/module1-tai-khoan-phan-quyen.md`.

### Kết quả kiểm thử Stage 1 (tóm tắt, chi tiết trong git log)

- 302 test pass; `pnpm test:e2e` 16 luồng x 2 bề ngang = 32 pass, không lỗi console/network; 10 lỗi tìm thấy khi chạy giao diện thật đã sửa. Chưa thử: chuyển cả cây bằng giao diện, đăng nhập Google, `docker-compose.yml`.

## Đang làm: Stage 2 (Module 2 – Datahub), do Sonnet code, Opus rà soát

Kế hoạch Stage 2:
- **2A – Lưu trữ và API lõi** (xong, đã rà soát).
- **2B – Engine công thức, cột tính toán, tính lại, golden test** (code xong, chờ Opus rà soát).
- **2B+ – Tính lại theo phần, nhật ký thay đổi, đợi tính xong** (Module 2 mục 6.7, Dương chốt 18/11; đang làm). Các bước (Sonnet đánh dấu, commit sau mỗi bước):
  - [ ] 1. Index GIN cho cột Liên kết + tra ngược; hàng đợi thay đổi dùng chung, cộng dồn
  - [ ] 2. Tính theo phần: liên kết/lookup/rollup, gom nhóm theo khoá cũ/mới, chuỗi phụ thuộc, ngưỡng 20%
  - [ ] 3. Sự kiện `cũ → mới` chia lô 500, SSE dùng chung; worker song song (cài đặt)
  - [ ] 4. Số thứ tự thay đổi, `consistent_after`/`consistent`, cờ `stale`, "đang tính" theo ô
  - [ ] 5. Test so sánh ngẫu nhiên, job đối soát hằng đêm, test tốc độ, OpenAPI/Bruno, quyết định khi code
- 2C – Giao diện grid, view kiểu Lark tự lưu, trình soạn công thức, chia sẻ/thùng rác/giới hạn.
- 2D – Import/export, import công thức, load test 100k dòng, e2e cả stage.

2A: 6 bước đã xong (schema, kiểu cột, API cấu trúc, API dòng, SSE/chuyển giao/view SQL/index tự động, test và tài liệu).

### Kết quả kiểm thử 2A (tóm tắt)

- 396 test pass; test tốc độ 100.000 dòng (`datahub-perf.test.ts`): trước index 23–81 ms, sau index tự động 3–44 ms, trang keyset 2,7 ms; nạp 100.000 dòng 3,4 s. 4 lỗi test phụ thuộc thứ tự đã sửa.

## Bước tiếp theo

2B xong cả 7 bước (mỗi bước một commit trên `dev`): 1-2 `packages/formula` (parser, 106 hàm); 3-4 cột formula/relation/lookup/rollup + tính lại (`apps/api/src/modules/datahub/computed.ts`, `recalc.ts`, `row-formulas.ts`, migration `0006`); 5 gom nhóm SQL + test tốc độ; 6 golden test; 7 API `datahub.formula.functions|preview`, OpenAPI, Bruno, README, quyết định khi code (`design/module2-datahub.md` mục 2B).

Việc kế: **Opus rà soát 2B**, rồi chờ Dương bảo làm 2C (giao diện grid, view tự lưu, trình soạn công thức dùng `datahub.formula.preview` và `datahub.formula.functions`, Tìm dòng trùng, chia sẻ/thùng rác/giới hạn). 2D: import công thức (dịch tham chiếu Excel sang tên, cảnh báo `LEFT(ngày,2)`).

### Kết quả kiểm thử 2B

- `pnpm test`: 33 file, 475 test pass (chạy hai lần); `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm docs:openapi`, `pnpm docs:bruno` sạch. Chạy thử `node apps/api/dist/worker.js` trên DB rỗng: worker khởi động, lên lịch 2 job mới.
- Mới so với 2A: 79 test (formula 26, `datahub-formulas` 43, gom nhóm 1, tốc độ 7, golden 2). 2B chưa có giao diện nên không có test trình duyệt.
- Tốc độ 100.000 x 100.000 dòng, tính lại cả cột: SUMIFS 1,92 s; COUNTIFS 2 điều kiện 2,32 s; XLOOKUP 1,87 s; AVERAGEIFS 1,92 s; MAXIFS ngày 2,48 s; gộp 2,51 s; sửa 1 dòng nguồn rồi 6 cột phụ thuộc tính lại 4,08 s (sau khi thêm xử lý lỗi nguồn).
- Golden test: 3.322/3.322 công thức file mẫu parse và chạy, 3.321 khớp Excel (1 công thức `TODAY()` chỉ kiểm chạy).
- Sau rà soát của Opus: lỗi ở cột nguồn nay truyền đi như Excel (SQL gom nhóm và duyệt từng dòng giống nhau, test tương đương mở rộng, test rollup, test sửa nguồn thì lỗi phụ thuộc hết).
- Lỗi tìm thấy khi test và đã sửa: (1) cột kẹt `running` vì mốc claim mất phần micro giây; (2) vị trí lỗi tên hàm tính trên văn bản đã đổi sang mã; (3) `IFERROR(a/b, "")` bị suy thành cột chữ; (4) `XLOOKUP` với giá trị thay thế suy sai kiểu; (5) chữ ngày `dd/mm/yyyy` chưa ép thành số khi tính; (6) dọn thùng rác chưa xoá khoá lỗi `!<mã cột>`; (7) `DATEDIF "MD"` ra số âm.

## Câu hỏi còn mở

- 2B: Dương đã đồng ý (b), (c), (d); (a) thay bằng mục 6.7 (2B+). 2D phải cảnh báo `LEFT(ngày,2)` khi import (324 công thức trong file mẫu dựa vào chữ hiển thị `MM/yyyy`).
- Module 4 (vòng 2): cột cơ bản chọn từ sheet Deals (mục 4.1); cột mặc định của Manager/Leader (4.2); sheet Index gốc cộng POD Express hai lần (4.6); bảng Probation KPI (6); bảng Thanh toán chờ Dương bàn với Manager (7). Dữ liệu BPM/Dataset đã ghi ở `examples/bpm-dataset-soe.md`.
- `docker-compose.yml` chưa chạy thử (máy dev không có Docker): phải chạy thử trên VPS trước khi dùng thật. Biến `AUTH_SECRET` giờ bắt buộc trong compose.
- Đăng nhập Google chưa thử với Google thật; cần tạo Google Cloud client (xem `design/ha-tang.md` mục 4) rồi thử một lần trước khi bật.
- Danh sách token cần duyệt và tài khoản hệ thống chưa phân trang (giới hạn 500); phân trang ở Stage 5 khi có kết nối AI.

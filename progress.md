# Tiến độ

Cập nhật: 20/11/2026

## Trạng thái

- **Thiết kế:** Module 0–5 và 7 đã chốt. Module 6 là bản nháp vòng 1, chờ Dương phản biện. Module 8–11 chưa làm.
- **Code:** Stage 0–3 xong. Stage 4 đang làm: bước con 4.1 xong (20/11), tiếp theo là dựng Deals.
- **Git:** đã push `main` + `dev` tới 154655d (hết bước con 4.1, Dương yêu cầu 20/11).
- **Mốc test** (f8e71cf, 20/11): `pnpm exec vitest run apps packages` 1073 pass, 9 skip (golden + load, chạy khi có file mẫu hoặc bật cờ); `pnpm test:e2e --project=desktop` 100/100. Không chạy hai lệnh vitest song song (chung DB).

## Đã xong

- **Stage 0:** monorepo, migration, registry, audit, lịch sử dòng, outbox, worker, SSE, file, OpenAPI.
- **Stage 1:** tài khoản, org chart, vai trò, phiên, mã kích hoạt, token, thông báo, nhật ký, chuyển giao, cài đặt. Quyết định: `design/module1-tai-khoan-phan-quyen.md`.
- **Stage 2** (19/11): Datahub, công thức (106 hàm, golden 3.321/3.322 khớp Excel), tính lại theo phần, grid, view, import/export. Quyết định, số đo: `design/module2-quyet-dinh-khi-code.md`.
- **Stage 3** (20/11): engine metric, bảng gộp, dashboard 22 loại biểu đồ, chia sẻ dashboard, Guest. Quyết định, số đo: `design/module3-quyet-dinh-khi-code.md`.
- **Stage 4, bước con 4.1** (20/11, Opus rà đạt cả 4 phần; Module 4 mục 19a việc 1–21). Chi tiết từng phần: `design/module4-quyet-dinh-khi-code.md` mục 4.1a–4.1d.
  - 4.1a: khoá phân chia, cho phép sửa theo cột, ô Người dùng chỉ nhận thành viên, thêm dòng hàng loạt, SSE lọc theo dòng.
  - 4.1b: Lookup/Rollup/công thức tính theo người đọc, bỏ `PhysicalSource`, bảng gộp từ nguồn có khoá. Load 20 phạm vi: chậm nhất 2,89 s (ngưỡng 3 s). **Triển khai: schema `mfold` thuộc `soe_app`.**
  - 4.1c: hạ tầng bảng template (cờ bảo vệ, lớp cột, vai trò cột, trùng tên, thành viên theo cây/team), Liên kết sang bảng template.
  - 4.1d: giao diện chia sẻ/cột/grid, thu gọn nhóm, xuất tổng hợp, cột "Ngày sửa của cột", đổi tên lựa chọn cập nhật công thức.

## Đang làm: Stage 4 (Module 4, Quản lý Deal), Sonnet code, Opus rà

**Kế hoạch (20/11):** 4.2 server bảng mặc định (đang làm: [ ] 1 siết chốt chặn `dh_rows`, [ ] 2 kiểu Người dùng có thuộc tính + gửi xuống, [ ] 3 bộ mặc định theo cây, [ ] 4 công thức sang bảng template khác chủ, [ ] 5 việc để lại từ 4.1, [ ] 6 OpenAPI/Bruno/quyết định); 4.3 giao diện (trang Template, menu Quản lý Deal, màn Deals); 4.4 thanh toán và com; 4.5 chốt kỳ/BANT/forecast/snapshot; 4.6 chỉ số + dashboard Deals; 4.7 API ngoài, nhập lịch sử, Guest; 4.8 kiểm thử cuối.

**Việc đầu tiên của 4.2 (Opus quyết 20/11):** siết chốt chặn truy vấn (`apps/api/src/auth/query-guard.ts`): `TableAccess.rows()` gắn dấu riêng (ví dụ `/*scope:rows*/`), mọi truy vấn đọc/ghi `dh_rows` phải mang dấu đó hoặc `/*scope:system*/`; dấu `/*scope*/` của `scope()` (chỉ quyền vào bảng) không còn đủ. Mục đích: dùng nhầm `scope()` thay `rows()` (bỏ qua khoá phân chia) sẽ làm cả bộ test fail.

Việc phải làm trong bước dựng Deals (để lại từ 4.1):
- Lookup/Rollup/công thức từ bảng riêng sang bảng template của người khác (ví dụ Index đọc Deals), tính lại theo người đọc.
- Web đặt ô chỉ đọc theo từng dòng (Leader xem deal của team); server đã chặn `row_not_editable`.
- Xoá cột đang được "Ngày sửa của cột" theo dõi: bỏ cột đó khỏi danh sách theo dõi; nếu là cột cuối thì cảnh báo trước khi xoá.
- Điền lại "Ngày sửa của cột" từ lịch sử phải đẩy tính lại các công thức phụ thuộc.
- Chuyển giao: deal đã đóng giữ người cũ (đăng ký điều kiện ở `transfer.ts`, 4.1a).
- "Cho phép leader sửa deal của tôi": màn Deals gọi `datahub.prefs.set` (server đã có).

Mục tiêu Deals hạ xuống **20.000 deal** (Dương chốt 20/11): load test Stage 4 dùng 20.000 deal, 20 người phạm vi khác nhau, mọi biểu đồ ≤ 3 s; Datahub thường giữ 100.000 dòng.

Các bước sau (Opus chia chi tiết khi tới): thanh toán và com theo đợt (mục 7, 12); chốt kỳ, snapshot, forecast, BANT; chỉ số + dashboard Deals trỏ cột theo vai trò, API ngoài, `data_grants.options` (mục 19 việc 14–16); kiểm thử cuối Stage 4.

## Ghi nhận để sau

- Stage 3: người xem qua chia sẻ dashboard không tự tải lại khi dữ liệu đổi (Stage 4); chữ giữa gauge đè nhãn trục, lọc chéo khó bấm cột < 1 px, thang gauge phần trăm làm tròn ở web (Stage 12).
- 4.1b: đổi cây tổ chức của một người tính lại 3,6 s (đang đánh dấu mọi cột theo người đọc của mọi chủ); thu hẹp khi cần.
- Grid chưa chạy `impeccable audit`, chưa thử trên điện thoại thật (Stage 12).
- Module 2 mục 11 chưa ghi giới hạn 150 cột cho bảng có form (Module 7 mục 1.1a; CLAUDE.md đã ghi). Opus ghi khi rảnh.
- Chưa thử: chuyển cả cây bằng giao diện, link Google Sheet thật, `docker-compose.yml` (máy dev không có Docker), đăng nhập Google thật (`design/ha-tang.md` mục 4). Import cột Liên kết/Người/Đính kèm chưa có.

## Lỗi điện thoại để sau

Không chặn bước con (CLAUDE.md, "Điện thoại là ưu tiên thấp"); gom sửa một đợt, Opus quyết khi nào.

- `stage1.spec.ts` phone "cài đặt hệ thống" từng hết giờ 1 lần; sau f8835de chạy 3 lần liền 16/16 pass. Theo dõi tiếp. Lệnh: `pnpm test:e2e stage1 --project=phone`.

## Câu hỏi còn mở (chờ Dương)

- **Guest xem dashboard (3C-2):** đang dùng cờ `guest_visible` theo từng dashboard (mặc định tắt) để Guest không thấy mọi dashboard của cây. Đúng ý Module 1 mục 5.2 chưa, hay cấp theo từng dashboard ở khung cấp dữ liệu?
- **Nhật ký xem dashboard (3C-2):** ghi một dòng mỗi lần mở dashboard của người khác, không ghi từng biểu đồ. Gọi thẳng `chart.data` không qua `view` thì không có nhật ký.
- **Grid và trình đọc màn hình (2C-1):** Glide không dựng bảng ẩn cho trình đọc màn hình trên React 19. Có bắt buộc không? Nếu có thì phải thêm bảng DOM song song hoặc đổi thư viện.
- **Grid (2C-1):** cột Mã dòng hiện `#<số dòng>`, còn export/API trả uuid; hoàn tác chỉ trong phiên mở bảng.
- **Đối soát công thức (2B+):** ngân sách 1.000.000 dòng/đêm và chờ mặc định 5 s là giá trị tự chọn.
- **Import (2B):** công thức `LEFT(ngày,2)` chỉ được cảnh báo, không tự đổi sang `TEXT(ngày,"mm")`. Có muốn tự đổi không?
- **Module 4:** màn so sánh phiên bản chính sách com khi AI cập nhật (đề xuất, chưa chốt).
- **Module 6:** câu hỏi ở cuối file thiết kế; chốt xong cập nhật CLAUDE.md theo mục "Thay đổi so với quy định đã chốt".
- **Stage 9 Onboarding:** lúc bắt đầu stage hỏi Dương có kiểm giao diện kỹ như ngoại lệ không; tới lúc đó giữ quy định cũ (kiểm kỹ).
- Danh sách token cần duyệt và tài khoản hệ thống chưa phân trang (giới hạn 500); phân trang ở Stage 5.

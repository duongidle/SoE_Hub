# Tiến độ

Cập nhật: 22/11/2026

## Trạng thái

- **Thiết kế:** Module 0–7 đã chốt (Module 6 chốt 21/11). Module 8–11 chưa làm.
- **Code:** Stage 0–3 xong. Stage 4 đang làm: 4.1–4.6 xong (Opus rà đạt, 4.6E chờ rà); 4.7A server xong 22/11 (xem "4.7 BÀN GIAO"); tiếp 4.7B (web + e2e), rồi 4.8.
- **Git:** đã push `main` + `dev` tới 56b1834 (hết 4.4, Dương yêu cầu 21/11). Sau đó chưa push.
- **Mốc test** (không chạy hai lệnh vitest song song, chung DB): xem dòng "Mốc test 4.7A" bên dưới; mốc trước (4.6E, mã 9695a8b) vitest 1218 pass 9 skip; e2e desktop 116–124 pass.

## Đã xong

- **Stage 0–3:** nền tảng, tài khoản/phân quyền, Datahub (106 hàm, golden khớp Excel), metric + dashboard + Guest. Quyết định: `design/module{0..3}-*.md`, `design/module{2,3}-quyet-dinh-khi-code.md`.
- **4.1** (20/11) sửa Stage 2: khoá phân chia, tính theo người đọc, bảng template, giao diện chia sẻ (`module4-quyet-dinh-khi-code.md` 4.1a–d).
- **4.2** bộ bảng mặc định theo cây, kiểu Người dùng có thuộc tính. **4.3** giao diện Quản lý Deal + trang Template. **4.4** thanh toán và com theo đợt (4.4A server, 4.4B web). **4.5** chốt kỳ, BANT, forecast, snapshot (+ sửa chập chờn: `columnTx`, hàng đợi ưu tiên). **4.6** chỉ số, dashboard Deals, `deal.cycle`, hiệu năng hàng đợi (4.6A–D). Quyết định chi tiết: `design/module4-quyet-dinh-khi-code.md` 4.2–4.6D; bản đồ: `design/ban-do-code.md`.
- **4.6E** (22/11, chờ Opus rà) hàm người xem ME/ISME/ATTR, bộ mặc định bỏ phần cứng, vai trò đa cột `nguoi_tham_gia`; phần còn lại làm ở 4.7A (INSCOPE/ATTRSUM, lệnh tiền tính ngay, trần % com ở lệnh).

## Đang làm: Stage 4 (Quản lý Deal), Sonnet code, Opus rà

**4.7 đã chốt (Dương 22/11):** phần chung Datahub (email ở ô Người dùng, import cột Liên kết và Người, upsert theo cột khoá, cấp bảng cho Guest kèm chọn cột) và phần Deal (lệnh tiền nhận mã ngoài của đợt, chốt kỳ xác nhận đợt import). Com cũ import dạng `Com cố định` + Đã chốt, không đổi engine. Dời: bảng ánh xạ BPM, `deal.upsert` riêng. Ước 25–30M, hai agent (A server, B web).

### 4.7 BÀN GIAO (4.7A server xong 22/11; 4.7B làm web + e2e)

Chi tiết quyết định: `design/module4-quyet-dinh-khi-code.md` mục "4.7A". Bản đồ cập nhật. Commit: 4a7c0f5 (INSCOPE, ATTRSUM), 01d74cd (lệnh tiền tính ngay, trần %), 8bb30be (email, import Người/Liên kết), f24ccf6 (mã ngoài), 0d9b6df (Guest cấp bảng), cca0f3b (chốt kỳ import); OpenAPI đã sinh lại.

| Việc | Lệnh / hàm mới | Lỗi chính |
| --- | --- | --- |
| Hàm `INSCOPE`, `ATTRSUM`; cột team của Deals thành công thức | `packages/formula` nhóm "Người xem" | `#VALUE!` nếu đối số ba khác `"của tôi"` |
| Lệnh tiền tính ngay; trần % com | `participantsOf`, `assertComCap` | `com_over_cap`; bỏ `participants_recalculating` |
| Email ở ô Người dùng (ghi dòng, import) | `rows.ts` `resolveEmails` | lỗi đúng dòng: "Email ... không có trong hệ thống" |
| Import cột Người, Liên kết | `import-refs.ts`; mapping thêm `link_by` (cột Liên kết) | lỗi dòng: email/tên lạ, tên trùng, liên kết 0 hoặc nhiều dòng; "cột X là cột công thức, không nhập được" |
| Guest cấp bảng + cột | `guest.grant.create` nhận `options {table_id, columns}`, `data_type: "datahub_table"`; kênh `web`/`api`/`export` | `grant_options`, `grant_column_personal`, `grant_column_attachment`, `grant_table_not_yours`; Guest tìm kiếm: `guest_search` |
| Mã ngoài của đợt | `payment.schedule` mỗi đợt `source` + `external_id`; `payment.confirm` allocation `external_id` thay `payment_id`; `payments[].external_id` | `external_id_unsupported`, `external_id_taken`, `duplicate_external_id`, `payment_ref_required`, `payment_not_found` |
| Chốt kỳ đợt import | `period.review` loại mới `received_unconfirmed`; lệnh `period.confirm_received {month}` (kết quả `payments`, `won_deal_ids`, `ledger_ids`, `skipped_ledger`) | `period_already_closed` |

**Việc web cho 4.7B:** (1) màn Chốt kỳ: hiện loại `received_unconfirmed`, nút "Xác nhận rồi chốt" = `period.confirm_received`, chờ công thức, rồi `period.close` (thử lại khi `recalc_pending`); (2) màn import: ghép cột Người/Liên kết vào cột có sẵn (cột đích kiểu Người dùng/Liên kết giờ chọn được), ô `link_by` cho cột Liên kết, hiện lỗi mới ở bước xem trước; (3) màn cấp dữ liệu Guest: loại "Bảng Datahub", chọn bảng + cột + phạm vi + kênh; Guest xem bảng được cấp (`guest.grant.mine` có `options`), lưới chỉ có cột được cấp, không có ô tìm kiếm; (4) trang Template: ô chọn vai trò hiện mọi cột giữ vai trò đa cột (Opus quyết ở 4.6E); (5) e2e cho các màn trên; (6) cột `Mã ngoài` chỉ có ở cây mới (cây cũ: 4.8 bù cột).

**Mốc test 4.7A (mã cca0f3b, sau đó chỉ thêm tài liệu và Bruno):** `pnpm exec vitest run apps packages` 1233 pass, 9 skip, 1 fail (`openapi.test.ts` thiếu Bruno cho `period.confirm_received`; đã thêm `docs/api/bruno/deal/period-confirm_received.bru`, chạy lại `openapi` + `ban-do-code` 8/8 pass), 101 file pass, 2 skip, khoảng 10 phút. Không chạy e2e (4.7B làm). `typecheck`: chỉ còn lỗi có sẵn (`apps/api` 15 lỗi ở `http/app.ts`, `auth/google.ts`; `apps/web` 31 lỗi) ; `lint` sạch.

## Còn nợ / ghi nhận để sau

- **4.8 bản cơ bản (Dương chốt 22/11):** vitest cả bộ một lần (`DH_EQUIV_EDITS=2500`), e2e cả bộ một lần, load test 20.000 deal (chỉ ghi số, sửa khi vượt rõ 3 s), chỉ sửa lỗi thật. Dời: Bruno sang Stage 5; bù cột còn thiếu cho cây đang chạy (cột mới, `Mã ngoài`, cột team thành công thức); 375px sang Stage 12.
- 4.6: Manager đặt mốc cohort mặc định cho cây; Index của team chưa đọc từ `Doanh thu theo người`; ô lọc theo cột của biểu đồ chưa có nhóm Vai trò.
- 4.5: việc tính lại nền xếp sau việc người dùng, chưa chống đói. 4.1b: đổi cây của một người tính lại 3,6 s.
- 4.7A: Guest cấp bảng, nhiều team cùng cấp thì cột theo người đọc để trống; created_by/updated_by (id người) vẫn có trong dòng Guest đọc; `com_split` gửi tay chưa kiểm trần; khoá ghép nhiều cột cho upsert chưa có (dùng một cột Duy nhất dạng `nguồn:mã`).
- Cột phụ thuộc người xem tính lúc đọc (Dương 22/11: hoãn; dùng `dh_personal_rows`). Xem lại khi thấy chậm.
- Stage 3: người xem qua chia sẻ dashboard không tự tải lại khi dữ liệu đổi; chữ giữa gauge, lọc chéo cột < 1 px (Stage 12).
- Grid chưa `impeccable audit`, chưa thử điện thoại thật (Stage 12). Module 2 mục 11 chưa ghi giới hạn 150 cột cho bảng có form.
- Chưa thử: chuyển cả cây bằng giao diện, Google Sheet thật, `docker-compose.yml`, đăng nhập Google thật (`design/ha-tang.md` mục 4).

## Lỗi điện thoại để sau

Không chặn bước con; gom sửa một đợt. `stage1.spec.ts` phone "cài đặt hệ thống" từng hết giờ 1 lần (`pnpm test:e2e stage1 --project=phone`), theo dõi.

## Câu hỏi còn mở (chờ Dương)

- Guest xem dashboard (3C-2): cờ `guest_visible` theo dashboard đúng ý Module 1 mục 5.2 chưa, hay cấp theo từng dashboard ở khung cấp dữ liệu? Nhật ký xem dashboard chỉ ghi lần mở `view`.
- Grid và trình đọc màn hình (2C-1): có bắt buộc bảng DOM song song không. Cột Mã dòng `#<số>` vs uuid ở export/API.
- Đối soát công thức (2B+): ngân sách 1.000.000 dòng/đêm, chờ 5 s là giá trị tự chọn.
- Module 4 (4.4A): cây đã tạo trước 4.4 giữ `Đã thu` là cột thường; bảng Tiền về "chỉ Manager" làm bằng khoá phân chia theo cột `Người xem` luôn trống.
- Stage 9 Onboarding: hỏi Dương có kiểm giao diện kỹ như ngoại lệ không. Danh sách token cần duyệt chưa phân trang (500), làm ở Stage 5.

- **DỪNG 22/11 (hết quota):** 4.7A xong (cd7e5fd, 54,8M token, vượt ước vì 193 lượt). 4.7B vừa bắt đầu: còn thay đổi chưa commit ở việc 1 (trần `Tỉ lệ SoE` cho `com_split` gửi tay; `participants.ts`, `payments.ts`, `deal-flexible-layout.test.ts`), **chưa chạy test**. **Phiên sau:** xem diff đó, giao lại 4.7B đủ 8 việc như prompt cũ (câu trả lời của Opus ở `design/module4-quyet-dinh-khi-code.md` mục "4.7A: Opus trả lời"); mỗi agent tối đa khoảng 5 việc, Opus tự kiểm số lượt ở mốc khoảng 100.

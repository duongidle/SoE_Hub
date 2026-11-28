# Tiến độ

Cập nhật: 28/11/2026

## Trạng thái

- **Thiết kế:** Module 0–9, 11 (Cài đặt + Feedback, 28/11) và 12 (giao diện Luminous Bento, 27/11) đã chốt. Module 10 (Workspace) là đề xuất của Khuê, chờ Dương duyệt. **Code Stage 11 trước Stage 10** (Dương 28/11): một bước con 11A server / 11B web + kiểm thử gộp, test tối giản (`module11-cai-dat-feedback.md` mục 7–8).
- **Code:** Stage 0–9 và 12 xong (Stage 5–7 bản rút gọn; Stage 8–9 test tối giản).
- **Mốc test (12G):** vitest cả bộ 1394 pass, 10 skip, 0 fail (`DH_EQUIV_EDITS=2500`, mã babc896); e2e desktop cả bộ 179 pass / 1 fail đã sửa và chạy riêng pass (mã 7d7f068 → 11576f1); 12G-2 spec bị chạm pass (mã b32498d). Không chạy hai lệnh vitest song song (chung DB).
- **Git:** `main` và `dev` push sau 12G (28/11).
- **Việc dời:** thiết kế đã chốt nhưng dời → `design/update_v1.md`; giao diện → `design/stage12.md`.

## Stage 12 xong (28/11/2026)

12A nền và khung · 12B người dùng · 12C Datahub · 12D Tổng quan + Deal · 12E Dynamic Form · 12F Onboarding, Knowledge, AI Hub, màn còn lại · 12G kiểm thử (12G-1 chức năng, 5 vai trò × 21 màn, dữ liệu xấu nhất; 12G-2 thang chữ, break-ui 14 màn, trang điền form ở điện thoại). Chi tiết và quyết định: `design/module12-quyet-dinh-khi-code.md`; lịch sử: git log. Ảnh: scratchpad `12a1/`…`12g2/`.

## Bước tiếp

0. **12H — sửa giao diện sau dùng thử** (Dương chốt 28/11; thiết kế: `module12-giao-dien.md` mục "Sửa sau dùng thử", có bảng thông số mockup). Ba agent lần lượt, test theo "Việc nhỏ test nhanh" (spec của màn bị chạm, không chạy cả bộ):
   - [x] **12H-1 nền** (xong 28/11; chi tiết `module12-quyet-dinh-khi-code.md` mục 12H-1; typecheck, lint, e2e desktop `stage12g2` + `stage1` 62 pass / 0 fail / 0 skip, mã ghi ở commit 12H-1; ảnh scratchpad `12h-1/after/`): thang chữ, khoảng cách, nút, bảng (grid canvas), thẻ, popover/menu, modal, ngăn kéo (Drawer nổi + nền mờ + trượt), hiệu ứng fadeUp, thanh cuộn, chip lựa chọn có màu tự gán. Sửa ở token và `components/ui`, grid theme.
   - [x] **12H-2 Datahub/Deal** (xong 28/11; chi tiết `module12-quyet-dinh-khi-code.md` mục 12H-2; typecheck, lint sạch; e2e desktop `stage2c1` `stage4-3` `stage4-5` `stage4-6` `stage12d2` `stage12g1` pass / 0 fail / 0 skip, mã ghi ở commit 12H-2; ảnh scratchpad `12h-2/`): dải kỳ thành nút trên thanh công cụ + "Toàn bộ thời gian" (chỉ web); thanh công cụ một dòng ở 1280 và 1440, bỏ ô tick rời; chọn dòng bằng ô tick khi rê số thứ tự; ngăn kéo dòng theo mockup.
   - [x] **12H-4 thanh công cụ Datahub/Deal + dropdown + Workhub/sidebar/top bar** (xong 28/11, chi tiết `module12-quyet-dinh-khi-code.md` mục 12H-4; typecheck, lint sạch; CHƯA chạy e2e theo lệnh Dương 28/11, spec `stage4-5` đã sửa mở Lọc trước khi bấm `quick-*` nhưng chưa chạy; ảnh scratchpad `12h-4/`; `stage1` đọc menu "Org chart" qua `hasMenu` (đã nằm trong danh sách chỉ-ở-Cài đặt của helper), 12H-6 rà).
   - [x] **12H-5 Knowledge + AI Hub bám mockup** (xong 28/11, chi tiết `module12-quyet-dinh-khi-code.md` mục 12H-5; bỏ nút Tìm trong ô tìm, khối đầu trang, thẻ phổ biến có màu, thẻ bài/skill, nút top bar, chữ trang đọc 15px; typecheck + eslint thư mục bị chạm sạch; **chưa chạy e2e** trừ `stage8` vì đổi selector nút Tìm; ảnh scratchpad `12h-5/`).
   - [x] **12H-6 Org chart vào Cài đặt + sơ đồ cây** (xong 28/11, chi tiết `module12-quyet-dinh-khi-code.md` mục 12H-6; typecheck, eslint file đã sửa sạch; e2e desktop `stage1` 16 + `stage12f2` 4 pass / 0 fail / 0 skip, chạy trên mã 47c44cb + thay đổi chưa commit của 12H-6; ảnh scratchpad `12h-6/`): mục "Org chart" nằm ở Cài đặt > Quản trị (cùng quyền `org:member:read`), bỏ dòng gợi ý "Thêm người vào org chart là cách duy nhất…"; chế độ Dạng cây vẽ sơ đồ tổ chức thật (thẻ người, nối vuông 1px, thu/mở nhánh, zoom, kéo, Vừa khung).
   - [x] **12H-7 trang điền form gọn** (xong 28/11, chi tiết `module12-quyet-dinh-khi-code.md` mục 12H-7; bản đồ câu chỉ ở Bài kiểm tra, bỏ chip loại form, đầu câu một dòng; typecheck sạch, e2e `stage12e2` 5 pass / 0 fail / 0 skip, mã ở commit 12H-7; ảnh `12h-7/`).
   - [x] **12H-8 trình soạn Dynamic Form theo mockup** (xong 28/11, mã sửa code dc81cef + 8fc05c3; chi tiết `module12-quyet-dinh-khi-code.md` mục 12H-8; typecheck, lint sạch; e2e desktop `stage7` `stage12e1` `stage12e2` 13 pass / 0 fail / 0 skip; ảnh scratchpad `12h-8/`): thanh bước một hàng sát top bar (lưới 3 cột), tờ form một thẻ có dải 4px + chip nguồn, câu không viền riêng, thuộc tính theo mockup, mục lục thành tab trong panel phải, xem trước là chip thoát.
   - [x] **12H-3 Onboarding + rà tab toàn app** (xong 28/11, mã sửa code ghi ở commit 12H-3; chi tiết `module12-quyet-dinh-khi-code.md` mục 12H-3; typecheck sạch, lint chỉ còn file chụp tạm của 12H-2, e2e desktop `stage12f1` 3 + `stage9` 2 + `stage6` 4 + `stage7` 6 pass / 0 fail / 0 skip; ảnh scratchpad `12h-3/`): gọn khoảng một màn; huy hiệu checkpoint trên mốc thay nhãn; dải trên một hàng; danh sách tuần gọn. Rà toàn app theo quyết định 7–9 (không lồng tab, thùng rác là nút icon, bỏ tab/bộ lọc chỉ có một nhóm): chuông (Nhắc hẹn Sắp tới/Đã xong), Dynamic Form (Form của tôi/Thùng rác), và mọi chỗ khác tìm được.
   - [x] **12H-10 Cài đặt thông báo dễ hiểu + hộp thông báo đã/chưa đọc** (xong 28/11, chi tiết `module12-quyet-dinh-khi-code.md` mục 12H-10; typecheck, lint sạch; vitest `apps/api/test/notify*` 31 pass / 0 fail; e2e desktop `stage6` 4 pass / 0 fail / 0 skip, chạy trên 537352b + thay đổi chưa commit của 12H-10; ảnh `12h-10/settings.png`): `label`/`description` bắt buộc ở `defineNotification` và trả qua `GET /notifications/settings`; trang chia thẻ theo mảng với công tắc, loại bắt buộc gom dòng "Luôn nhận"; chuông và trang Thông báo có chấm chưa đọc, giờ tương đối, chip "Chỉ chưa đọc".
1. Stage 11 (Cài đặt + Feedback): Opus rà phạm vi theo `kinh-nghiem-quyet-dinh.md` rồi giao 11A (server) / 11B (web + kiểm thử gộp).
2. Module 10 (Workspace): chờ Dương duyệt đề xuất. Menu sidebar tên **"Workhub"** đã có (trang "đang phát triển", Dương 28/11); Module 10 code thì gắn vào đó.

## Còn nợ (lỗi và nợ kỹ thuật ngắn hạn)

- Form: nhãn lựa chọn của form cho 200 ký tự, tên lựa chọn cột Datahub chỉ 100 → `form.question.create_columns` lỗi với lựa chọn dài; tên cột tối đa 100 ký tự nên câu dài bị cắt tên cột. Chuỗi NFD từ file ngoài làm lỗi `option_missing` khi publish: nên chuẩn hoá NFC ở engine.
- `ensureTreeTemplates` không hoàn thiện cây dựng dở (`module4-quyet-dinh-khi-code.md` cuối file).
- Deal: việc tính lại nền xếp sau việc người dùng, chưa chống đói; đổi cây của một người tính lại 3,6 s; Manager chưa đặt được mốc cohort mặc định; Index của team chưa đọc từ `Doanh thu theo người`; ô lọc theo cột của biểu đồ chưa có nhóm Vai trò.
- Guest (4.7A): nhiều team cùng cấp thì cột theo người đọc để trống; dòng Guest đọc vẫn có created_by/updated_by (id); `com_split` gửi tay chưa kiểm trần; chưa có khoá ghép nhiều cột cho upsert.
- Dashboard: người xem qua chia sẻ không tự tải lại khi dữ liệu đổi.
- Onboarding: thông báo checkpoint đạt chỉ phát từ job quét 10 phút; tick của tuần bị dời bởi `week_break` giữ ngày cũ.
- Module 2 mục 11 chưa ghi giới hạn 150 cột cho bảng có form.
- Chưa thử thật: chuyển cả cây bằng giao diện, Google Sheet, `docker-compose.yml`, đăng nhập Google (`design/ha-tang.md` mục 4).
- Dữ liệu demo: bài test Work+ dùng đáp án tạm; có đáp án thật thì thêm `k` vào `../SoE_hub_demo-test.json` rồi `pnpm --filter @soe/api demo:seed --reset-onboarding`.

## Lỗi điện thoại để sau

(Trống; lỗi chưa rõ nguyên nhân ở `design/chua-ro-nguyen-nhan.md`.)

## Câu hỏi còn mở (chờ Dương)

- Lỗi chưa rõ nguyên nhân (chập chờn chưa tái hiện): đã gác, ghi ở `design/chua-ro-nguyen-nhan.md`.
- Việc giao diện để sau: trang `/cai-dat` hai cột như mockup; tab đang chọn ở Onboarding rỗng; nhãn cột lưới cắt không có "…".

- Bảng lệnh ⌘K (gõ để nhảy tới trang, datahub, form, dashboard): cần tìm kiếm xuyên module, có thể thêm một API tìm chung. Ước 6–10M token. Làm trong Stage 12 không? (Opus hứa hỏi ở 12F; Dương đang ngủ nên ghi ở đây.)

- Guest xem dashboard: cờ `guest_visible` theo dashboard có đúng ý Module 1 mục 5.2 không, hay cấp theo từng dashboard ở khung cấp dữ liệu? Nhật ký xem dashboard chỉ ghi lần mở.
- Grid và trình đọc màn hình: có bắt buộc bảng DOM song song không. Cột Mã dòng `#<số>` hay uuid ở export/API.
- Đối soát công thức: ngân sách 1.000.000 dòng/đêm, chờ 5 s là giá trị tự chọn.
- Deal: cây tạo trước 4.4 giữ `Đã thu` là cột thường; bảng Tiền về "chỉ Manager" làm bằng khoá phân chia theo cột `Người xem` luôn trống.

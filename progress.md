# Tiến độ

Cập nhật: 23/11/2026

## Trạng thái

- **Thiết kế:** Module 0–9 đã chốt. Module 10 (Workspace, giao việc) và 11 chưa có thiết kế.
- **Code:** Stage 0–9 xong (Stage 5–7 bản rút gọn; Stage 8–9 test tối giản).
- **Mốc test:** vitest cả bộ 1362 pass, 10 skip, 0 fail (`DH_EQUIV_EDITS=2500`, sau Com PS, mã 5137100 + thay đổi). Typecheck 0 lỗi. Không chạy hai lệnh vitest song song (chung DB).
- **Git:** `main` và `dev` đã push tới abe3d39 (23/11).
- **Việc dời:** thiết kế đã chốt nhưng dời → `design/update_v1.md`; giao diện → `design/stage12.md`.

## Bước tiếp

1. **Sửa lỗi bảo mật form công khai** (ưu tiên, trước Stage 10):
   - `form.form.update` đổi `access` sang `public` không kiểm lại câu `fill_self`; `submitResponse` (`apps/api/src/modules/form/fill.ts`) ở chế độ công khai giữ giá trị trình duyệt gửi cho "Người điền" → người ngoài nộp bài dưới tên người khác.
   - `checkPublish` (`ops.ts`) không chặn câu `user`, `relation` ở form công khai (Module 7 mục 2: chỉ form nội bộ).
   - Sửa tận gốc: một hàm luật "chỉ form nội bộ" gọi cả khi publish lẫn khi đổi access; nộp công khai luôn bỏ giá trị `user`/`fill_self`/`relation`; test tái hiện.
2. Thiết kế Module 10 (Workspace).

## Còn nợ (lỗi và nợ kỹ thuật ngắn hạn)

- Form: nhãn lựa chọn của form cho 200 ký tự, tên lựa chọn cột Datahub chỉ 100 → `form.question.create_columns` lỗi với lựa chọn dài; tên cột tối đa 100 ký tự nên câu dài bị cắt tên cột. Chuỗi NFD từ file ngoài làm lỗi `option_missing` khi publish: nên chuẩn hoá NFC ở engine.
- `ensureTreeTemplates` không hoàn thiện cây dựng dở (`module4-quyet-dinh-khi-code.md` cuối file).
- `metrics-perf` (join 100k dòng) từng 1246 ms khi máy bận; chạy riêng pass. Theo dõi lần chạy cả bộ sau.
- Deal: việc tính lại nền xếp sau việc người dùng, chưa chống đói; đổi cây của một người tính lại 3,6 s; Manager chưa đặt được mốc cohort mặc định; Index của team chưa đọc từ `Doanh thu theo người`; ô lọc theo cột của biểu đồ chưa có nhóm Vai trò.
- Guest (4.7A): nhiều team cùng cấp thì cột theo người đọc để trống; dòng Guest đọc vẫn có created_by/updated_by (id); `com_split` gửi tay chưa kiểm trần; chưa có khoá ghép nhiều cột cho upsert.
- Dashboard: người xem qua chia sẻ không tự tải lại khi dữ liệu đổi.
- Onboarding: thông báo checkpoint đạt chỉ phát từ job quét 10 phút; tick của tuần bị dời bởi `week_break` giữ ngày cũ.
- Module 2 mục 11 chưa ghi giới hạn 150 cột cho bảng có form.
- Chưa thử thật: chuyển cả cây bằng giao diện, Google Sheet, `docker-compose.yml`, đăng nhập Google (`design/ha-tang.md` mục 4).
- Dữ liệu demo: bài test Work+ dùng đáp án tạm; có đáp án thật thì thêm `k` vào `../SoE_hub_demo-test.json` rồi `pnpm --filter @soe/api demo:seed --reset-onboarding`.

## Lỗi điện thoại để sau

`stage1.spec.ts` phone "cài đặt hệ thống" từng hết giờ 1 lần (`pnpm test:e2e stage1 --project=phone`), theo dõi.

## Câu hỏi còn mở (chờ Dương)

- Guest xem dashboard: cờ `guest_visible` theo dashboard có đúng ý Module 1 mục 5.2 không, hay cấp theo từng dashboard ở khung cấp dữ liệu? Nhật ký xem dashboard chỉ ghi lần mở.
- Grid và trình đọc màn hình: có bắt buộc bảng DOM song song không. Cột Mã dòng `#<số>` hay uuid ở export/API.
- Đối soát công thức: ngân sách 1.000.000 dòng/đêm, chờ 5 s là giá trị tự chọn.
- Deal: cây tạo trước 4.4 giữ `Đã thu` là cột thường; bảng Tiền về "chỉ Manager" làm bằng khoá phân chia theo cột `Người xem` luôn trống.

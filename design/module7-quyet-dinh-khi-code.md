# Module 7: quyết định khi code

## 7A1 (22/11/2026, Sonnet)

- **Cấu hình `soe-form/1`:** `title`, `description`, `appearance` (tự do), `blocks[]`. Khối: `heading`, `text`, `image`, `divider`, `page_break`, `group` (`blocks`, `show_if`), `question`. Câu hỏi: `id` (mã riêng của form), `input` (kiểu cột hoặc `scale`), `label`, `description`, `hint`, `required`, `default`, `column_id` (KHÓA cột, chỉ ở server), `param` (mã tham số link), `hidden` (trường ẩn), `show_if` (cú pháp lọc Module 0, `field` = id câu), `options[{id,label}]`, `reveal` (`{mã lựa chọn: [id khối]}` cho "Khi chọn thì hiện"), `scale`, `unique_message`. Đối tượng `looseObject`: thêm trường mới (đáp án, điểm của 7A2) không bị cắt.
- **Điều kiện** chỉ nhìn lại câu đứng trước (vị trí đọc, nhóm đứng trước con). Câu ẩn coi như trống với khối sau. Trường ẩn (`hidden: true`) bỏ qua điều kiện, luôn ghi. `reveal` khớp theo mã lựa chọn hoặc tên lựa chọn.
- **Mã lựa chọn:** khi tạo cột từ câu hỏi, cột tự cấp mã `o_xxxx`; mã trong câu hỏi và khoá `reveal` được viết lại theo mã của cột (khớp theo tên). Giá trị ô lựa chọn gửi lên là mã hoặc tên (cột Module 2 nhận cả hai).
- **Trạng thái người điền thấy (`stateOf`):** suy ra từ trạng thái chủ chọn + ngày mở/đóng + số phản hồi tối đa + bảng còn sống. Không lưu "tạm dừng do xoá bảng", nên khôi phục bảng thì form chạy lại. Đủ số phản hồi tối đa thì ghi `closed` luôn.
- **Phiên bản form:** cột Số tên `Phiên bản form`, tạo khi tạo form có bảng và khi xuất bản, tìm theo tên.
- **Câu bị tắt (cột đã xoá):** không vào bản gửi người điền, không chặn xuất bản, không bắt buộc. Chủ chưa nhận thông báo (dời).
- **Chống bấm hai lần:** `attempt_id` duy nhất theo form (`form_responses`), áp cho cả công khai (không có Idempotency-Key). Gửi lại cùng mã trả `replayed: true`. Form nội bộ vẫn nhận `Idempotency-Key` của executor.
- **Kênh ghi:** nộp bằng token/MCP ghi `via = api`/`mcp` (thiết kế 5.1), web và công khai ghi `form`.
- **Công khai:** REST ở `/api/v1/public/forms/:code` (`form.public.get`, `.submit`, `.upload_init`, `.upload_complete`). Trang `/f/<mã>` là việc của web (7B2). Token giờ mở ký HMAC bằng `AUTH_SECRET`: server không tin giờ do trình duyệt gửi. Hằng số spam ở `SPAM` (`fill.ts`), đếm IP trong bộ nhớ một tiến trình (đủ cho một API; nhiều tiến trình thì đếm riêng từng tiến trình).
- **Người điền không có quyền bảng:** `submitResponse` dựng quyền của CHỦ bảng để gọi `applyRowOps`, người tạo dòng là người điền (hoặc "Form công khai").
- **Giới hạn 150 cột:** áp khi bảng có form chưa xoá; `datahub.table.get` trả `max_columns` theo đó.
- **Dời trong 7A1:** thông báo chủ khi cột bị xoá, báo chủ một lần khi bị spam (chỉ ghi nhật ký), chuyển giao form khi đổi chủ datahub, link tiếp tục cho form công khai (đã dời ở mục 14), bảng đích bị xoá cứng thì form mồ côi (khoá ngoại chặn xoá bảng có form; job dọn thùng rác sẽ báo lỗi cho tới khi xoá form: kiểm ở 7A2).

## Opus rà 7A1 (22/11/2026)

- Đạt. Cấu hình công khai lọc `column_id`, đáp án, điểm, `quiz`; gửi bài chỉ ghi cột của câu đang hiện và đã nối.
- Giao 7A2: chuyển giao form theo datahub (mục 9, Module 1 mục 8); kiểm job xoá cứng thùng rác với bảng có form (khoá ngoại); thông báo chủ form khi cột nối câu bị xoá (mục 1.3, bắt buộc).
- Báo chủ form khi bị spam: chỉ ghi nhật ký, không thông báo (dời, `update_v1.md`).

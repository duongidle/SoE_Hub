# Module 11 — Cài đặt còn lại, Feedback

> Trạng thái: **Đã chốt** · 28/11/2026 (Opus đề xuất, Dương phản biện và chốt trong chat cùng ngày).
> Phụ thuộc: [Module 0](module0-nen-tang.md) (registry, file, audit), [Module 1](module1-tai-khoan-phan-quyen.md) (quyền bổ sung, Guest), [Module 5](module5-ket-noi-ai.md) (menu `feedback`), [Module 6](module6-thong-bao.md) (`notify`, hai loại thông báo Feedback), [Module 12](module12-giao-dien.md) (top bar, Cài đặt hai cột).
> **Thứ tự code:** giữ số Module 11, nhưng **code trước Module 10** (Dương 28/11): Feedback không dùng gì của Workspace.
> **Làm đơn giản, nhanh, ít token; test tối giản** (Dương 28/11).

Nguồn: brief mục 15 "Dấu hỏi" (feedback ứng dụng, yêu cầu tính năng) và mục 16 "Cài đặt" (Admin xem/phản hồi feedback). Không có file mẫu trong `examples/`: mọi giá trị ở mục 5 "Thêm vì hệ thống cần".

## 0. Phạm vi

Brief mục 16 đã có gần hết từ các module trước: đổi mật khẩu (M1), cài đặt kết nối AI (M5), giới hạn hệ thống (M0, M2, M3), quyền bổ sung trong ngăn kéo người ở Org chart (M1). Module 11 chỉ gồm:

1. Feedback (mục 1–3).
2. Hai chỗ vá Cài đặt (mục 4).

Không thêm cài đặt hệ thống mới. Hằng số còn viết cứng (giới hạn metric, giữ thông báo) vẫn ở `update_v1.md`.

## 1. Gửi feedback

- **Lối vào:** nút "?" trên top bar, cạnh chuông. Mở menu nhỏ: "Gửi góp ý", "Góp ý của tôi", "Hướng dẫn kết nối AI" (mục 4.2).
- **Ai gửi:** mọi người đã đăng nhập, **kể cả Guest** (Dương 28/11).
- **Form gọn** (hộp thoại; điện thoại là trang đầy màn):
  - Loại: Báo lỗi / Góp ý / Yêu cầu tính năng (bắt buộc).
  - Nội dung: chữ thường, tối đa 5.000 ký tự (bắt buộc).
  - Ảnh: tối đa 3, mỗi ảnh ≤ 5 MB, dán bằng Ctrl+V hoặc chọn file; dùng lệnh file của Module 0. Không tự chụp màn hình.
  - Tự ghi kèm, người gửi không điền: đường dẫn trang đang mở, user agent, cỡ màn hình.
- **Ảnh không cảnh báo, không chặn.** Admin là vai trò xử lý hệ thống, không có nghiệp vụ nên không xem và không cần xem Datahub hay Deal; quy định này không đổi. Ảnh trong feedback là thứ người gửi tự đưa cho người xử lý, không phải quyền truy cập Datahub, nên không cần cảnh báo (Dương 28/11).
- Người gửi **rút lại** được khi còn trạng thái Mới (xoá mềm).

## 2. Xử lý feedback

- **Quyền mới `feedback:inbox:manage`:** Admin mặc định có. Thêm vào `SUPPLEMENTARY_PERMISSIONS` ("Xử lý feedback", Admin cấp, vai trò hợp lệ: Manager, Leader, User) để giao cho người khác không cần thêm vai trò.
- **Trạng thái:** Mới → Đang xem → Đã lên kế hoạch → Đã xong / Không làm. Chỉ người xử lý đổi; đổi tự do, không ép thứ tự.
- **Trao đổi:** luồng tin nhắn hai chiều giữa người xử lý và người gửi (chữ, tối đa 5.000 ký tự; không ảnh). Không sửa, không xoá tin đã gửi.
- **Ai thấy gì:** người gửi chỉ thấy feedback của mình; người xử lý thấy tất cả. Không có bình chọn, không xem feedback của người khác.
- **Thông báo** qua `notify` (Module 6 mục 3, đã dự kiến): feedback mới → mọi người có `feedback:inbox:manage`; tin nhắn mới hoặc đổi trạng thái → người gửi; người gửi nhắn lại → người xử lý đã từng trả lời (chưa ai trả lời thì mọi người xử lý).

## 3. Màn hình, API, AI

- **Góp ý của tôi** (`/gop-y`, Cài đặt nhóm Cá nhân): danh sách (loại, trích nội dung, trạng thái, ngày), bấm mở ngăn kéo xem chi tiết và luồng tin nhắn, ô nhắn lại.
- **Feedback** (`/quan-tri/feedback`, Cài đặt nhóm Quản trị, quyền `feedback:inbox:manage`): danh sách lọc theo loại và trạng thái, mặc định Mới + Đang xem, mới nhất trước, phân trang keyset; ngăn kéo chi tiết: nội dung, ảnh, thông tin tự ghi, người gửi (thẻ người), đổi trạng thái, luồng tin nhắn.
- **Lệnh** (registry, REST tự sinh): `feedback.create`, `feedback.withdraw`, `feedback.mine`, `feedback.get`, `feedback.message.create`, `feedback.list` (người xử lý), `feedback.status.set` (người xử lý).
- **AI:** menu `feedback` (Module 5, mặc định Xem). Kết nối mức Sửa gửi được feedback hộ người dùng và nhắn lại; AI của người xử lý đọc, trả lời, đổi trạng thái. Không thêm tool chọn lọc: đi qua `soe_call`.
- **Dữ liệu:** bảng `feedback` (id, người gửi, loại, nội dung, ảnh = mảng id file, ngữ cảnh JSON {url, user_agent, viewport}, trạng thái, `version`, ngày tạo/sửa, xoá mềm) và `feedback_messages` (id, feedback, người viết, nội dung, ngày). Audit như mọi lệnh ghi. Chuyển giao dữ liệu (M1): không chuyển, feedback giữ người gửi cũ.

## 4. Vá Cài đặt

### 4.1 Trang Phân quyền bổ sung

- `/quan-tri/quyen-bo-sung`, Cài đặt nhóm Quản trị, quyền `org:permission:grant` (Admin, Manager).
- Xem theo từng quyền bổ sung: "Duyệt Knowledge: A, B, C"; thêm người (`PeoplePicker`, chỉ người có vai trò hợp lệ), gỡ người. Brief: danh sách người duyệt chọn "trong cài đặt phân quyền".
- Dùng lệnh cấp/gỡ có sẵn của Module 1; chỉ thêm một lệnh liệt kê theo quyền. Manager chỉ thấy và cấp trong phạm vi cây như ở Org chart; quyền chỉ Admin cấp thì Manager thấy nhưng không sửa.

### 4.2 Hướng dẫn kết nối AI

- Mục trong menu "?": mở trang Kết nối AI của người dùng, kèm link hướng dẫn từ `docs/ket-noi-ai.md`. Không viết trang trợ giúp riêng.

## 5. Thêm vì hệ thống cần (không có file mẫu)

| Thứ | Giá trị | Lý do |
|---|---|---|
| Loại feedback | Báo lỗi, Góp ý, Yêu cầu tính năng | Brief nêu "feedback ứng dụng / yêu cầu tính năng"; tách Báo lỗi để Admin lọc |
| Trạng thái | Mới, Đang xem, Đã lên kế hoạch, Đã xong, Không làm | Người gửi biết góp ý tới đâu |
| Giới hạn | 5.000 ký tự, 3 ảnh × 5 MB | Đủ cho mô tả lỗi; chặn lạm dụng |
| Thông tin tự ghi | URL, user agent, cỡ màn | Tái hiện lỗi |

## 6. Không làm

Bình chọn +1, xem feedback của người khác, gắn nhãn, mức ưu tiên, giao feedback cho người cụ thể, tự chụp màn hình, xuất CSV riêng (API registry đủ), cài đặt hệ thống mới.

## 7. Kiểm thử (tối giản, Dương 28/11)

- Unit: người gửi chỉ thấy feedback của mình; người không có `feedback:inbox:manage` không gọi được `feedback.list`/`status.set`; Guest gửi được; rút lại chỉ khi Mới; thông báo tới đúng người; trang Phân quyền bổ sung không cấp cho vai trò không hợp lệ.
- e2e desktop một spec `stage11`: Guest gửi feedback có ảnh → Admin thấy, đổi trạng thái, nhắn → người gửi thấy ở Góp ý của tôi.
- Không chạy 375px riêng (trừ mở form gửi không tràn), không `break-ui`.

## 8. Chia bước

Một bước con, hai agent Sonnet:

- **11A (server):** migration hai bảng, lệnh mục 3, quyền mới + quyền bổ sung, lệnh liệt kê theo quyền (4.1), hai loại thông báo, menu AI, unit test, Bruno.
- **11B (web + kiểm thử):** nút "?", form gửi, hai trang, trang Phân quyền bổ sung, spec `stage11`; cuối bước chạy cả bộ vitest một lần + spec `stage11` + các spec bị chạm (`stage1` nếu đổi top bar). **Gộp kiểm thử cuối stage vào 11B** (Dương 28/11: test cực kỳ đơn giản), không tách bước kiểm thử riêng.

Ước 15–25M token tổng (so cỡ 12D-1, chưa đo).

## 9. Thay đổi so với quy định đã chốt

- Code Module 11 trước Module 10 (bảng stage trong `CLAUDE.md`).
- Stage 11 không có bước kiểm thử riêng: gộp vào 11B (ngoại lệ của luật "mọi stage có giao diện kết thúc bằng một bước con kiểm thử riêng").

## Quyết định khi code

(Trống.)

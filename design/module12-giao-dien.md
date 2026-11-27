# Module 12 — Giao diện (Luminous Bento)

Đã chốt: 27/11/2026 (Dương).

Thống nhất concept giao diện cho Stage 12. File này ngắn, chỉ nói cái mới; mọi quy định trong `chuan-giao-dien.md` vẫn giữ, trừ các điểm ghi "đổi" ở mục 3.

## 1. Nguồn

- Mockup và mô tả phong cách: `design/giao_dien_mau/` (8 màn HTML + `Luminous Bento Workspace.md`). Dữ liệu trong mockup là giả (Dương xác nhận 27/11/2026), commit cùng repo.
- **Mockup chỉ để hình dung cách trình bày, không phải đặc tả chức năng.** Chức năng theo thiết kế module đã chốt. Mockup có mà thiết kế không có thì không làm (ví dụ: việc của tôi, tải việc đội ngũ, người trực tuyến, tim/lưu bài, ghế, webhook, nút "Lưu thay đổi" chung). Ngoại lệ: tiện ích thuần giao diện, làm nhanh, không đổi dữ liệu hay quyền (ví dụ thu gọn sidebar, phím tắt chọn đáp án, bản đồ câu hỏi ở form) thì được làm, ghi vào quyết định khi code.
- Màn chưa có mockup (Onboarding, AI Hub, Duyệt bài, đăng nhập, chuông, ngăn kéo chi tiết, điện thoại của app) dựng theo concept ở mục 2, ghép từ màn cùng loại.
- Những gì đã chốt và đã code (menu sau khi gom vào chuông và Tổng quan, tên "Dynamic Form", dropdown riêng thay `<select>`, thẻ người…) giữ nguyên; mockup lệch thì theo cái đã chốt.

## 2. Concept

- **Ba lớp:** nền sáng có hai quầng màu nhạt → khung app trắng nổi (bo 20px, bóng nhẹ ánh tím than) → thẻ và bảng trắng (bo 16px, viền 1px) trên vùng làm việc xám rất nhạt.
- **Sidebar** 220px, thu gọn 64px: một danh sách phẳng; mục đang mở nền indigo nhạt, chữ indigo, vạch dọc 3px bên trái. Đáy sidebar: Cài đặt, Đăng xuất. Các trang quản trị gom vào trang Cài đặt hai cột (menu nhóm bên trái, nội dung bên phải) như mockup Settings.
- **Top bar** một dòng 48px: breadcrumb trái; nút chính, chuông, tài khoản phải. Không chồng hai ba tầng header.
- **Trang dữ liệu:** dải tab với Dashboard và "+" ghim trái → thanh công cụ một dòng (thao tác hay dùng trái; một ô tìm, mật độ dòng, menu "•••" cho việc ít dùng bên phải) → bảng → xem chi tiết bằng ngăn kéo trượt phải 420–560px.
- **Trang báo cáo:** thanh chọn kỳ một hàng → hàng thẻ KPI → lưới biểu đồ 2 cột.
- **Trang thư viện** (Knowledge, AI Hub): một ô tìm → tab phân loại một chạm + dải thẻ phổ biến → lưới thẻ 2–3 cột.
- **Form:** trình soạn 4 bước (Thiết kế · Thiết lập · Chia sẻ · Phản hồi), giữa là tờ form thật, phải là thuộc tính. Form công khai: thanh tiến độ ghim đỉnh, dải bìa, bản đồ câu bên phải (điện thoại: ẩn bản đồ).
- **Màu theo nghĩa** dùng thống nhất từ bảng tới biểu đồ tới thẻ: xanh lá = xong/đạt, xanh dương = đang xử lý, hổ phách = chờ/sắp hạn, đỏ hồng = quá hạn/lỗi, tím = nhóm đặc thù/AI. Mỗi màu gồm nền, chữ, viền, chấm (mã ở mockup md mục 2.2), tương phản AA.
- **Điện thoại:** khung app tràn sát mép (bỏ lề và bo góc ngoài), sidebar thành ngăn kéo.

## 3. Token và thương hiệu

- **Tên:** SoE HUB. **Slogan:** Solution of Excellence (dòng dưới tên ở sidebar, trang đăng nhập, tiêu đề trang). Thay "Internal Workspace" trong mockup.
- **Font:** giữ như chuẩn: Be Vietnam Pro cho chữ, chữ số "SoE Number" (Roboto). Không dùng Inter, Plus Jakarta Sans, JetBrains Mono của mockup.
- **Đổi** màu token trong `apps/web/src/index.css` (thay xám trung tính và primary xanh than): primary `#4F46E5` (hover `#4338CA`), primary nhạt `#EEF0FF`, chữ chính `#1E1B3A`, chữ phụ `#646A82`, chữ mờ `#94A3B8` (chỉ cho chữ lớn hoặc vô hiệu, chữ thường phụ dùng `#646A82` để đạt AA), viền `#E2E8F0` / `#ECEEF5`, nền `#F4F5FA` / `#F8F9FC` / sidebar `#FAF9FE`. Vẫn chỉ dùng token, không mã màu cứng trong component.
- **Bo góc:** khung 20px, thẻ 16px, ô và nút 10px.
- **Đổi** hai điều cấm của chuẩn, chỉ trong phạm vi này: kính mờ được dùng ở top bar (nội dung cuộn dưới nó); gradient chỉ ở quầng nền, thanh tiến độ 3px và dải bìa form. Các điều cấm khác giữ: không viền màu dày bên trái thẻ (mockup Deal/Knowledge có, thay bằng chip màu), không chữ gradient, không thẻ lồng thẻ.
- Mỗi màn một nút chính đặc màu, kể cả khi mockup có hai.

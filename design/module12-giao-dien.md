# Module 12 — Giao diện (Luminous Bento)

Đã chốt: 27/11/2026 (Dương).

Thống nhất concept giao diện cho Stage 12. File này ngắn, chỉ nói cái mới; mọi quy định trong `chuan-giao-dien.md` vẫn giữ, trừ các điểm ghi "đổi" ở mục 3.

## 1. Nguồn

- Mockup và mô tả phong cách: `design/giao_dien_mau/` (8 màn HTML + `Luminous Bento Workspace.md`). Dữ liệu trong mockup là giả (Dương xác nhận 27/11/2026), commit cùng repo.
- **Mockup chỉ để hình dung cách trình bày, không phải đặc tả chức năng.** Chức năng theo thiết kế module đã chốt. Mockup có mà thiết kế không có thì không làm (ví dụ: việc của tôi, tải việc đội ngũ, người trực tuyến, tim/lưu bài, ghế, webhook, nút "Lưu thay đổi" chung). Ngoại lệ: tiện ích thuần giao diện, làm nhanh, không đổi dữ liệu hay quyền (ví dụ thu gọn sidebar, bản đồ câu hỏi ở form) thì được làm, ghi vào quyết định khi code.
- **Cải thiện trải nghiệm** (Dương cho phép 27/11/2026): trong Stage 12, Opus được tự thêm cải thiện thuần giao diện giúp dùng nhanh, dễ hơn (lối tắt, nhớ lựa chọn, hoàn tác, trạng thái rỗng có việc nên làm tiếp…) khi rẻ và không đổi dữ liệu, quyền, cách tính hay luồng nghiệp vụ. Mỗi cái ghi vào `module12-quyet-dinh-khi-code.md` và báo Dương ở cuối giai đoạn. Cái tốn công (ước trên khoảng 5M token) hoặc chạm server thì hỏi trước.
- **Tự do bố cục** (Dương cho phép 28/11/2026): trong Stage 12, Opus được tự sắp xếp lại mọi thứ trên màn (vị trí nút, thanh công cụ, nhóm thao tác, menu, tab, panel, mật độ thông tin) theo mockup hoặc theo cách của sản phẩm chuẩn (Lark Base, Airtable, Linear, Notion) để trực quan, dễ dùng, dễ nhìn, gọn và đẹp. Giới hạn: không bỏ chức năng đã chốt (chỉ được giấu vào menu "•••" hay panel), không đổi dữ liệu, quyền, cách tính; mỗi màn vẫn một nút chính; thay đổi lớn ghi vào quyết định khi code và báo Dương cuối giai đoạn.
- **Nút và lối tắt** (Dương cho phép 28/11/2026): chỗ nào thao tác hay dùng hoặc nơi hay vào đang bị giấu sâu thì được đưa ra thành nút, hoặc thêm lối tắt truy cập (link nhảy thẳng tới nơi cần, mục truy cập nhanh, "mở gần đây", nút đi tới màn liên quan). Lối tắt chỉ dẫn tới nơi người dùng có quyền vào.
- **Không chồng tiêu đề** (Dương chốt 28/11/2026): breadcrumb ở top bar đã nói trang đang ở đâu thì trang không hiện lại tiêu đề lớn trùng tên. Giữ `h1` cho trình đọc màn hình (ẩn bằng `sr-only`) để đúng thứ tự tiêu đề. Nút của tiêu đề cũ (ví dụ "Tạo datahub") chuyển lên top bar bên phải hoặc vào thanh công cụ của trang. Trang có nội dung riêng mà breadcrumb không nói (tên datahub, tên form đang sửa) thì tên đó nằm ở breadcrumb, không lặp thêm dòng.
- **Lối tắt đã duyệt** (Dương 28/11/2026), làm trong giai đoạn của màn đó:
  - 12D Tổng quan: khu "Mở gần đây" (datahub, form, dashboard vừa mở, bấm vào thẳng; lưu theo người ở server, dùng chung bảng tuỳ chọn người dùng của 12D để đổi máy vẫn giữ; chỉ hiện thứ còn quyền mở).
  - 12D Quản lý Deal: từ dòng deal đi thẳng tới đợt thanh toán / com của deal đó; bấm tên người mở thẻ người.
  - 12E Dynamic Form: form đã nối Datahub có nút đi thẳng tới bảng phản hồi.
  - 12F Onboarding: mỗi checkpoint có link tới đúng bài test hoặc form cần làm.
- Màn chưa có mockup (Onboarding, AI Hub, Duyệt bài, đăng nhập, chuông, ngăn kéo chi tiết, điện thoại của app) dựng theo concept ở mục 2, ghép từ màn cùng loại.
- Những gì đã chốt và đã code (menu sau khi gom vào chuông và Tổng quan, tên "Dynamic Form", dropdown riêng thay `<select>`, thẻ người…) giữ nguyên; mockup lệch thì theo cái đã chốt.

## 2. Concept

- **Ba lớp:** nền sáng có hai quầng màu nhạt → khung app trắng nổi (bo 20px, bóng nhẹ ánh tím than) → thẻ và bảng trắng (bo 16px, viền 1px) trên vùng làm việc xám rất nhạt.
- **Sidebar** 220px, thu gọn 64px: một danh sách phẳng; mục đang mở nền indigo nhạt, chữ indigo, vạch dọc 3px bên trái. Đáy sidebar: Cài đặt, Đăng xuất. Các trang quản trị gom vào trang Cài đặt hai cột (menu nhóm bên trái, nội dung bên phải) như mockup Settings.
- **Top bar** một dòng 48px: breadcrumb trái; nút chính, chuông, tài khoản phải. Không chồng hai ba tầng header.
- **Trang dữ liệu:** dải tab với Dashboard và "+" ghim trái → thanh công cụ một dòng (thao tác hay dùng trái; một ô tìm, mật độ dòng, menu "•••" cho việc ít dùng bên phải) → bảng → xem chi tiết bằng ngăn kéo trượt phải 420–560px.
- **Trang báo cáo:** thanh chọn kỳ một hàng → hàng thẻ KPI → lưới biểu đồ 2 cột.
- **Trang thư viện** (Knowledge, AI Hub): một ô tìm → tab phân loại một chạm + dải thẻ phổ biến → lưới thẻ 2–3 cột.
- **Form:** trình soạn 4 bước (Thiết kế · Thiết lập · Chia sẻ · Phản hồi), giữa là tờ form thật, phải là thuộc tính. **Không kéo thả** (thay việc "kéo khối vào vị trí" trong `stage12.md`, Dương chốt 27/11/2026): giữa hai câu có vạch chèn với nút "+", bấm mở bảng chọn loại câu (lưới 2 cột, nhóm theo màu) và chèn đúng chỗ đó; cuối form có nút "Thêm câu hỏi"; đổi thứ tự bằng nút lên/xuống trên câu đang chọn. Vạch "+" hiện khi di chuột trên desktop; trên cảm ứng và khi focus bằng bàn phím luôn bấm được. Form công khai: thanh tiến độ ghim đỉnh, dải bìa, bản đồ câu bên phải (điện thoại: ẩn bản đồ); không làm phím tắt A–D.
- **Màu theo nghĩa** dùng thống nhất từ bảng tới biểu đồ tới thẻ: xanh lá = xong/đạt, xanh dương = đang xử lý, hổ phách = chờ/sắp hạn, đỏ hồng = quá hạn/lỗi, tím = nhóm đặc thù/AI. Mỗi màu gồm nền, chữ, viền, chấm (mã ở mockup md mục 2.2), tương phản AA.
- **Điện thoại:** khung app tràn sát mép (bỏ lề và bo góc ngoài), sidebar thành ngăn kéo.

## 3. Token và thương hiệu

- **Tên:** SoE HUB. **Slogan:** Solution of Excellence (dòng dưới tên ở sidebar, trang đăng nhập, tiêu đề trang). Thay "Internal Workspace" trong mockup.
- **Font:** giữ như chuẩn: Be Vietnam Pro cho chữ, chữ số "SoE Number" (Roboto). Không dùng Inter, Plus Jakarta Sans, JetBrains Mono của mockup.
- **Đổi** màu token trong `apps/web/src/index.css` (thay xám trung tính và primary xanh than): primary `#4F46E5` (hover `#4338CA`), primary nhạt `#EEF0FF`, chữ chính `#1E1B3A`, chữ phụ `#646A82`, chữ mờ `#94A3B8` (chỉ cho chữ lớn hoặc vô hiệu, chữ thường phụ dùng `#646A82` để đạt AA), viền `#E2E8F0` / `#ECEEF5`, nền `#F4F5FA` / `#F8F9FC` / sidebar `#FAF9FE`. Vẫn chỉ dùng token, không mã màu cứng trong component.
- **Bo góc:** khung 20px, thẻ 16px, ô và nút 10px.
- **Đổi** hai điều cấm của chuẩn, chỉ trong phạm vi này: kính mờ được dùng ở top bar (nội dung cuộn dưới nó); gradient chỉ ở quầng nền, thanh tiến độ 3px và dải bìa form. Các điều cấm khác giữ: không viền màu dày bên trái thẻ (mockup Deal/Knowledge có, thay bằng chip màu), không chữ gradient, không thẻ lồng thẻ.
- Mỗi màn một nút chính đặc màu, kể cả khi mockup có hai.

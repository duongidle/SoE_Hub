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
- **Dashboard trong Datahub phải khác hẳn bảng** (Dương 28/11/2026; tab Dashboard hiện trông như một tab bảng, khó phân biệt). Cách làm (Opus chọn, tham khảo Lark Base "Dashboard" và Airtable "Interface"): đầu trang datahub có **công tắc hai chế độ "Dữ liệu | Dashboard"** (nút phân đoạn, icon bảng / icon biểu đồ) ghim trái, thay cho tab Dashboard nằm chung dải tab bảng. Chế độ Dữ liệu: dải tab bảng + thanh công cụ dữ liệu như cũ. Chế độ Dashboard: dải tab bảng ẩn, thay bằng thanh của dashboard (chọn kỳ/thời gian, lọc chung, "Thêm biểu đồ", "Sửa bố cục", chia sẻ); nền là lưới bento (thẻ biểu đồ trắng bo 16px trên nền xám rất nhạt, khoảng cách đều), hàng thẻ KPI lớn ở trên nếu có, biểu đồ xếp lưới 2 cột, thẻ có tiêu đề + nguồn bảng nhỏ + menu "•••". Chế độ đang mở lưu trên URL. Trạng thái rỗng của dashboard có gợi ý mẫu biểu đồ nên tạo từ bảng đang có.
- **Dải tab bảng phải đọc được khi nhiều bảng** (Dương 28/11/2026; mockup một hàng tab cuộn ngang chưa đủ: datahub Deal có 9 bảng, tab cuối bị khuất, không biết còn bao nhiêu bảng). Opus chọn theo Airtable: đầu dải có nút **"Bảng ▾ (9)"** mở danh sách mọi bảng (ô tìm, icon, số dòng, bảng đang mở có dấu, bảng chung/riêng có chip; kéo để đổi thứ tự nếu đã hỗ trợ); dải tab vẫn hiện các bảng vừa đủ chỗ, tab đang mở luôn cuộn vào tầm nhìn, hai mép có bóng mờ + mũi tên khi còn tab khuất; tên dài cắt kèm tooltip.
- **Grid Datahub, cột số thứ tự** (Dương 28/11/2026): bấm chuột trái vào số thứ tự dòng (1, 2, 3…) mở chi tiết dòng (ngăn kéo phải); bấm chuột phải vào số thứ tự thì chọn dòng (giữ Shift/Cmd để chọn nhiều như hiện có) và hiện menu thao tác với các dòng đã chọn nếu grid đã có menu đó. Trên cảm ứng: chạm số thứ tự mở chi tiết, nhấn giữ để chọn.
- **Thanh công cụ Datahub phải gọn** (Dương 28/11/2026, bản 12C-1 còn lộn xộn): nút cùng một kiểu (nút trơn không viền, icon + chữ, cao 32px, cách đều), chia nhóm bằng vạch mảnh: [chọn view] · [Thêm dòng] · [Lọc · Sắp xếp · Nhóm · Ẩn cột · Tô màu · Thời gian] · khoảng trống · [ô tìm · mật độ · •••]. Hoàn tác/Làm lại vào "•••" (vẫn dùng Cmd+Z). Nút đang áp hiện số và nền primary nhạt. Không trộn nút có viền và nút trơn trong cùng thanh.
- **Chi tiết/cấu hình cột** (Dương 28/11/2026: popover/hộp thoại cột hiện chật, kích thước và khoảng cách khác mockup): mở bằng ngăn kéo phải 480px (đúng quy tắc "ngăn kéo thay popup chật" của mockup), lề trong 20–24px, chia mục có tiêu đề nhỏ (Cơ bản · Định dạng · Thuộc tính · Nâng cao), thuộc tính bật/tắt dùng công tắc gạt như cột phải của mockup Dynamic Form, nút Lưu/Huỷ ghim đáy. Áp cùng kiểu cho trình sửa công thức nếu đang là popover chật. Menu nhanh khi bấm đầu cột (đổi tên, sắp xếp, ẩn, chèn…) vẫn là menu nhỏ.
- **Điện thoại** (Dương chốt 28/11/2026): chỉ trang điền form cần đẹp và đủ ở 375px; màn khác không tốn token, lỗi nhẹ không sửa (xem `kiem-thu.md` mục 4).
- **Kiểm thử 12G thêm** (Dương 28/11/2026): so cỡ chữ và màu chữ từng loại (tiêu đề, nhãn, chữ phụ, số, chữ trong bảng, chip) với mockup và thang cỡ chữ của chuẩn; lệch thì sửa ở token/thành phần chung.
- **Lối tắt đã duyệt** (Dương 28/11/2026), làm trong giai đoạn của màn đó:
  - 12D Tổng quan: khu "Mở gần đây" (datahub, form, dashboard vừa mở, bấm vào thẳng; lưu theo người ở server, dùng chung bảng tuỳ chọn người dùng của 12D để đổi máy vẫn giữ; chỉ hiện thứ còn quyền mở).
  - 12D Quản lý Deal: từ dòng deal đi thẳng tới đợt thanh toán / com của deal đó; bấm tên người mở thẻ người.
  - 12E Dynamic Form: form đã nối Datahub có nút đi thẳng tới bảng phản hồi.
  - 12F Onboarding: mỗi checkpoint có link tới đúng bài test hoặc form cần làm.
- Màn chưa có mockup (Onboarding, AI Hub, Duyệt bài, đăng nhập, chuông, ngăn kéo chi tiết, điện thoại của app) dựng theo concept ở mục 2. **Ở các màn này Opus được sáng tạo nhiều nhất** (Dương 28/11/2026): bố cục chuẩn production, dễ dùng, trực quan, sinh động; không bị bó vào kiểu "danh sách thẻ". Ví dụ Onboarding là một **hành trình**: lộ trình hiện như con đường theo tuần với các mốc (checkpoint), thấy mình đang ở đâu, đã qua gì, mốc tiếp theo cần gì, có cảm giác tiến lên và muốn khám phá; không phải đống thẻ việc. Chức năng và số liệu vẫn theo thiết kế Module 9.
- **Mockup đề xuất đã chốt** (Dương 28/11/2026): `design/giao_dien_mau/de_xuat/onboarding_hanh_trinh.html` (Opus được tinh chỉnh thêm khi code) và `de_xuat/tong_quan.html`. AI Hub theo mockup gốc `soe_hub_knowledge_ai_hub.html` (bấm AI Hub), nhưng nội dung theo Module 8: skill là **gói Agent Skills** (SKILL.md, zip), không phải prompt để chép. Ô "System prompt mẫu" của thẻ thành đoạn đầu `description`/SKILL.md; "Chép Skill" thành "Sao chép lệnh cài" (Claude Code); "Dùng thử" thành "Xem" mở ngăn kéo (cách cài từng client, cây file, phiên bản; nội dung ngăn kéo theo `de_xuat/ai_hub_chuc_nang.html`, Dương xác nhận đúng chức năng); tab client là Claude Code / Claude Desktop / claude.ai / Khác; bỏ dòng tiêu đề lớn trùng breadcrumb.
- **Màn sáng tạo lớn làm mockup trước:** với màn đổi hẳn cách trình bày (Onboarding, AI Hub, Tổng quan), Opus dựng một mockup HTML tĩnh (cùng token màu, dữ liệu giả) cho Dương xem và chốt, rồi mới giao code. Rẻ hơn nhiều so với code xong rồi làm lại.
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

## Sửa sau dùng thử (Dương chốt 28/11/2026) — bước 12H

Dương dùng thử sau 12G: chữ to quá, nội dung "đấm vào mắt", khoảng trống không rõ, thành phần không phân biệt; dải kỳ Deal chiếm chỗ; thanh công cụ chán, dropdown to; thẻ lựa chọn không màu; chọn nhiều dòng không đoán được; ngăn kéo dòng thô, thiếu nền mờ; Onboarding dài lê thê, hành trình nhiều cờ chồng nhau, thanh cuộn to. Nguyên nhân gốc: agent chỉ xem ảnh mockup, không có thông số; 12G-2 còn tăng thang chữ ngược mockup. **Từ nay bám thông số dưới đây** (Opus rút từ HTML mockup 28/11), thay cho thang chữ 12G-2.

### Thông số mockup (bắt buộc)

| Thành phần | Thông số |
| --- | --- |
| Chữ thân, ô bảng | 13px (ô bảng 12.5–13px); chữ phụ, nhãn 11.5–12px; chú thích, chip 11px; tối thiểu 10.5px (số đếm nhỏ) |
| Tiêu đề | tiêu đề trang/khối lớn 18px bold; tiêu đề thẻ 14.5–15px semibold; số KPI 20–24px bold; top bar 14.5px semibold |
| Độ đậm | 500 chữ thường của nút/menu, 600 nhãn và tiêu đề nhỏ, 700 tiêu đề; không dùng 400 cho nhãn nút |
| Sidebar | mục cao 35px, chữ 13px/500, màu #4B5068, bo 9px, icon 16px, gap 10px, padding ngang 11px |
| Top bar | cao 48px, padding ngang 16–20px, chỉ top bar có blur (`bg-white/85 backdrop-blur-md`) |
| Nút | cao 28px (thanh công cụ) hoặc 32px (thường), 36px ô nhập form; padding ngang 10px; chữ 12–12.5px; bo 7–9px |
| Bảng | hàng tiêu đề 36px chữ 11.5px/600 màu #646A82 nền #F8F9FB; hàng thân khoảng 42px chữ 13px; cột # 48px chữ 12px màu slate-400, đổi primary khi rê; vạch #EEF0F6 |
| Thẻ | padding 16px (p-4), thẻ lớn 20px; bo 14–16px; khoảng giữa thẻ 12–16px; vùng main padding 24px dọc, 16–32px ngang |
| Khoảng cách nhỏ | gap 6–10px trong cụm; py-0.5/1 chip; px-2.5/3 nút |
| Chip lựa chọn | chấm tròn 6px + nền nhạt + viền nhạt cùng màu + chữ đậm cùng màu, 11.5px/600, bo full; lựa chọn chưa gán màu thì **tự gán theo thứ tự** trong bảng màu, không để xám |
| Popover/menu | rộng 192–330px, bo 12–14px, viền slate-200, bóng xl, padding dọc 6–8px, chữ 12.5px; dòng menu cao 32px |
| Ngăn kéo chi tiết | thẻ nổi `top/bottom/right 12px`, rộng tối đa 490px, bo 18px, bóng 2xl; nền sau `slate-900/20` + `backdrop-blur 2px`; trượt vào 300ms ease-out (nền mờ 200ms); đầu ngăn kéo có chip # dòng + chip giá trị chính; nội dung chia ô bo 12px nền nhạt, chữ 13.5px; chân: Đóng + một nút chính |
| Modal | nền `slate-900/25` + blur 2px, hiện bằng fade-up |
| Hiệu ứng | `fadeUp` 240ms `cubic-bezier(0.16,1,0.3,1)` cho popover/thẻ mới; đổi màu nền 120–140ms; thu gọn sidebar 220ms cùng đường cong; tôn trọng `prefers-reduced-motion` |
| Thanh cuộn | 5–6px, rãnh trong suốt, con trượt `rgba(148,155,180,.35)` bo full, rê thì đậm hơn; dải tab/thanh công cụ ẩn thanh cuộn (`no-scrollbar`) |
| Bóng | thường `shadow-2xs`; popover `shadow-xl`; ngăn kéo `shadow-2xl` |

Agent làm giao diện **được đọc đoạn HTML mockup của đúng thành phần** (grep theo class/id), không chỉ xem ảnh.

### Quyết định

1. **Dải kỳ Deal thành một nút trên thanh công cụ** (giống cụm chọn kỳ `h-8` của mockup Deal), chỉ hiện ở bảng theo kỳ: "📅 Quý 4/2026 ▾". Bảng nhỏ khi bấm: chọn Tháng/Quý/Năm, lùi/tới, **"Toàn bộ thời gian"** (mới), ô "Theo kỳ chung", và một dòng nói rõ lọc gì: Deals "Deal liên quan đến kỳ (theo ngày bắt đầu và ngày đóng)" + cách hiểu kỳ; Index "Lọc theo cột Tháng". Mặc định vẫn Quý này. Đổi Module 4 mục 11a.
2. **Thanh công cụ gọn kiểu Lark:** nút 28px chữ 12–12.5px; công cụ đang bật tô primary nhạt và có số ("Lọc 2", "Cột 1"); không còn ô tick rời: "Theo kỳ chung" vào nút kỳ, "Cho phép leader sửa deal của tôi" vào "•••" (hoặc cạnh Chia sẻ). Dropdown của công cụ theo thông số popover.
3. **Chọn dòng kiểu Lark** (thay quy định "trái mở, phải chọn" 28/11): rê vào số thứ tự thì hiện ô tick; tick để chọn, tick nhiều dòng, Shift chọn dải, ô tick ở tiêu đề chọn hết; bấm số (hoặc icon mở rộng hiện khi rê) mở chi tiết dòng; chuột phải không còn chọn. Cảm ứng: chạm số mở, ô tick luôn hiện khi đang có dòng được chọn.
4. **Thẻ lựa chọn có màu** theo bảng thông số.
5. **Ngăn kéo chi tiết dòng** theo bảng thông số.
6. **Onboarding gọn trong khoảng một màn hình:**
   - Hành trình: mỗi tuần một mốc; checkpoint **không vẽ nhãn trên con đường** nữa, chỉ một huy hiệu nhỏ trên mốc ("⚑3", màu theo trạng thái xấu nhất: trễ cam, đạt xanh, chưa tới xám). Rê hiện tooltip danh sách checkpoint, bấm mở ngăn kéo tuần. Chiều cao khối hành trình cố định khoảng 160–200px, cuộn ngang nếu nhiều tuần.
   - Dải "Bạn đang ở" gọn một hàng; không lặp số liệu.
   - Phần tuần hiện tại: danh sách việc gọn (dòng 36–40px), checkpoint bên phải; nội dung dài thì thu lại có "Xem thêm", không kéo trang dài.

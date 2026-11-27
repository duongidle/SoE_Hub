# Module 12: quyết định khi code

## 12A-1 (27/11/2026)

- **Token:** `apps/web/src/index.css`. Màu theo nghĩa có bốn biến mỗi màu: `--ok` (chữ), `--ok-bg`, `--ok-border`, `--ok-dot`; tương tự `info`, `warn`, `bad`, `ai`. `--ok/--warn/--bad` đổi sang màu chữ AA (#047857, #B45309, #BE123C) nên `text-bad` cũ vẫn đạt tương phản. Thêm `--workspace`, `--sidebar`, `--faint`, `--border-soft`, `--primary-hover/-soft/-border`, `--glow-1/2`.
- **Bo góc:** đổi luôn thang Tailwind (`rounded-md` 10px, `rounded-lg` 12px, `rounded-xl` 16px, `rounded-2xl` 20px) để cả app theo concept mà không sửa từng file. Thêm `rounded-control/card/frame`. Card giữ class `rounded-xl` vì e2e stage1 chọn `div.rounded-xl`.
- **Bóng:** `shadow-sm/md/lg` ánh tím than; thêm `shadow-card`, `shadow-frame`.
- **Grid canvas:** đọc màu qua `lib/theme.ts` `token()` (getComputedStyle), nhận hex bình thường, không đổi.
- **Shell:** khung nổi `h-dvh`, trang cuộn trong vùng nội dung (không cuộn document); top bar kính mờ sticky trong vùng cuộn. Sidebar thu gọn nhớ ở localStorage `soe.sidebar.collapsed`. Dưới 1024px: sidebar thành ngăn kéo trái (Radix Dialog), nút "Mở menu", nav tên "Menu điện thoại"; trên desktop nav tên "Menu chính" (helper e2e giữ nguyên). Nút "Đăng xuất" chỉ nằm ở đáy sidebar desktop; dưới 1024px là nút biểu tượng ở top bar.
- **Breadcrumb:** suy từ đường dẫn (`crumbs` trong shell.tsx); trang chưa tự đặt được breadcrumb.
- **Trang /cai-dat tạm:** `pages/settings.tsx` (`SettingsHubPage`), danh sách link theo quyền từ `SETTINGS_LINKS` (shell.tsx). Link có `aria-label` = tên để e2e khớp exact.
- **e2e helper:** `Session.menuLink/clickMenu/hasMenu` với mục quản trị tự đi qua "Cài đặt" rồi tìm link trong `main`.
- **Drawer:** `components/ui/drawer.tsx`, 420px (560px với `wide`), đầy màn dưới 640px, hỏi khi `dirty`, có `footer`.

## 12A-2 (27/11/2026)

- **Chuông là popover rộng (28rem), không dùng Drawer:** ba tab (Thông báo, Nhắc hẹn, Thông báo chung) đều là danh sách ngắn; popover giữ nguyên `getByRole("dialog", { name: "Thông báo" })` của e2e. Form tạo (nhắc hẹn, thông báo chung) mở bằng Modal ở ngoài popover (popover đóng trước), tạo xong chuông mở lại đúng tab.
- **Tab Nhắc hẹn** chỉ hiện với `notification:manage`. **Tab Thông báo chung**: ai cũng thấy "Đã nhận"; `notification:announce` thấy thêm "Đã gửi". Nút "+" chỉ hiện khi có ít nhất một quyền; mỗi mục theo quyền riêng.
- **Tái dùng:** `RemindersPanel` (`showNew` tắt nút "Nhắc mới" khi nằm trong chuông), `AnnouncementsPanel` (tab điều khiển từ ngoài), `ComposeForm` (chỉ form, không Card). Trang `/nhac-hen` và `/thong-bao-chung` vẫn có, dùng cùng các thành phần.
- **Bộ lọc "Tất cả/Chưa đọc" của chuông** đổi thành nút "Chỉ chưa đọc" trong tab Thông báo (tránh hai dải tab lồng nhau).
- **Cài đặt hai cột:** `SettingsLayout` (`pages/settings.tsx`) bọc mọi trang cài đặt ngay trong `shell.tsx` (`isSettingsPath`, `settingsLinkFor` chọn mục khớp dài nhất; `/tai-khoan/*` thuộc Cài đặt). Nhóm "Cá nhân" = mục không đòi quyền; "Quản trị" = còn lại. `/cai-dat`: màn rộng (>=768px) chuyển thẳng sang mục đầu tiên (Tài khoản của tôi); điện thoại hiện danh sách, chọn thì vào trang con có link quay lại "Cài đặt". Nav tên "Menu cài đặt"; link có `aria-label` = tên.
- **e2e helper `menuLink`:** sau khi bấm "Cài đặt" ở sidebar, tìm link trong nav "Menu cài đặt" (không còn kiểm URL `/cai-dat$` vì desktop chuyển trang).
- **Sửa theo:** `crumbs` chọn mục cài đặt dài nhất (trước đó `/tai-khoan/thong-bao` ra nhầm "Tài khoản của tôi"); mục Cài đặt ở sidebar sáng khi đang ở trang cài đặt bất kỳ.
- **Button secondary:** đã là nền trắng (`bg-card`) + viền từ 12A-1, chỉ hover mới tím nhạt; không sửa.

## 12A-3 (27/11/2026)

- **Select mới** (`components/ui/select.tsx`, `form.tsx` xuất lại để ~52 file giữ import): nút kích hoạt `role="combobox"` (kiểu Input, `data-value` giữ giá trị), danh sách `role="listbox"` trong `Popover` qua portal. Đọc `<option>`/`<optgroup>` qua `React.Children` (cả trong fragment, mảng); giá trị số đổi thành chuỗi; option `disabled` bị bỏ qua khi di chuyển và không chọn được. `onChange` nhận `{ target: { value, name }, currentTarget: { value, name } }` (kiểu `SelectChange`), không phải `ChangeEvent`: một chỗ (`admin.tsx` `set`) khai kiểu lại. Có `name` thì thêm `<input type="hidden">` cùng tên (chưa chỗ nào dùng). Không hỗ trợ `multiple`/`size` (không nơi nào dùng).
- **Ô tìm** hiện khi hơn 8 lựa chọn (bỏ dấu, không phân biệt hoa thường); ít hơn thì gõ chữ để nhảy tới lựa chọn bắt đầu bằng chữ đó. Phím: lên/xuống, Home/End, Enter chọn, Esc đóng và trả focus về nút, nút cũng mở được bằng mũi tên. Focus vào ô tìm (hoặc danh sách) qua `onOpenAutoFocus`; mục sáng nối bằng `aria-activedescendant`.
- **Panel modal** (`Popover` thêm `modal` và `onOpenAutoFocus`): Select mở từ trong hộp thoại (Radix Dialog) bị bẫy focus của hộp thoại kéo ngược về nút nên không nhận được bàn phím. Nguyên nhân gốc: `react-popover` 1.1.15 kéo `react-focus-scope` 1.1.7, còn `react-dialog` 1.3.1 dùng 1.3.1; hai bản có hai ngăn xếp riêng nên popover không tạm dừng được bẫy của hộp thoại. Nâng `@radix-ui/react-popover` lên 1.3.1 (cùng bản phụ thuộc với dialog) và dùng `modal`. Hệ quả: khi danh sách mở, phần trang sau nó bị `aria-hidden`; bấm ra ngoài chỉ đóng danh sách.
- **Tên truy cập:** panel đặt tên cố định "Danh sách lựa chọn" và danh sách không mang `aria-label` của nút, để `getByLabel("Kết quả")` của e2e không khớp thêm phần tử khi đang mở.
- **E2e:** `chooseOption(trigger, "giá trị" | { label } | { index })` (chuỗi khớp `data-value` trước, rồi nhãn); `openSelect(trigger)` trả danh sách, `closeSelect(list)`; `expectSelectValue(trigger, v)` thay `toHaveValue` của select. `openSelect` giữ nút bằng handle vì khi danh sách mở, locator `getByRole` trong hộp thoại không còn khớp (trang `aria-hidden`). Chỗ cũ dùng `locator("option")`, `locator("select")` đã đổi theo (stage1, 2c1, 3b, 4-1d, 4-3, 9).

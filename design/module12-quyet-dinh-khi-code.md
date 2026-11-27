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

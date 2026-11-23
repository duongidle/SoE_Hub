# Stage 12 — việc giao diện gom lại

> Tạo 23/11/2026 (Dương yêu cầu). Gom các điều chỉnh giao diện Dương nêu khi dùng thử, để Stage 12 (làm lại giao diện, rà chuẩn giao diện) làm một lượt. Quy định chung về giao diện vẫn ở `chuan-giao-dien.md`; việc dời theo thiết kế module vẫn ở `update_v1.md`. Làm xong thì xoá dòng.

| Việc | Màn / chỗ code | Ghi chú |
|---|---|---|
| **Thẻ người dùng chung, phân biệt người trùng tên** | mọi nơi hiện người dùng | Quy định đủ ở `chuan-giao-dien.md` mục "Hiển thị người dùng" (Dương 23/11) |
| **Ghi rõ đây là bộ lọc danh sách deal theo kỳ** (Dương 23/11) | `apps/web/src/pages/deal/period-bar.tsx` | Cách hiển thị hiện tại dễ nhầm với bộ lọc thời gian chung của grid/dashboard. Có nhãn rõ (ví dụ "Kỳ của danh sách deal"), ghi lọc theo cột nào, và tách hẳn về vị trí/kiểu dáng khỏi bộ lọc thời gian |
| **Dropdown hệ thống thay `<select>` của hệ điều hành** (Dương 23/11) | `Select` trong `apps/web/src/components/ui` và khoảng 41 file đang dùng `<select>`/`Select` | Một component dropdown chung (dựng trên `popover.tsx`, qua portal) thay mọi dropdown mặc định của OS: cùng giao diện trên mọi máy, có tìm kiếm khi danh sách dài, bàn phím (lên/xuống, Enter, Esc, gõ để nhảy), đọc được bằng trình đọc màn hình, trên điện thoại vẫn dễ chạm. Đổi trong component chung để các màn tự nhận; e2e đang chọn bằng `selectOption` phải sửa theo |

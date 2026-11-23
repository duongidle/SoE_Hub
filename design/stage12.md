# Stage 12 — việc giao diện gom lại

> Tạo 23/11/2026 (Dương yêu cầu). Gom các điều chỉnh giao diện Dương nêu khi dùng thử, để Stage 12 (làm lại giao diện, rà chuẩn giao diện) làm một lượt. Quy định chung về giao diện vẫn ở `chuan-giao-dien.md`; việc dời theo thiết kế module vẫn ở `update_v1.md`. Làm xong thì xoá dòng.

| Việc | Màn / chỗ code | Ghi chú |
|---|---|---|
| **Thẻ người dùng chung, phân biệt người trùng tên** | mọi nơi hiện người dùng | Quy định đủ ở `chuan-giao-dien.md` mục "Hiển thị người dùng" (Dương 23/11) |
| **Bộ lọc kỳ của Quản lý Deal: thêm khoảng thời gian tuỳ chỉnh** (Dương 23/11) | `apps/web/src/pages/deal/period-bar.tsx` | Hiện chỉ chọn kỳ cụ thể (tháng, quý, năm), theo quyết định 4.5B "Kỳ chung" (`module4-quyet-dinh-khi-code.md`). Thêm "Tuỳ chỉnh: từ ngày – đến ngày" cho danh sách deal. Phải định nghĩa trước khi làm: Index lọc cột `thang`, Probation KPI lọc cột `nam`, chốt kỳ theo tháng, nên khoảng tuỳ chỉnh áp vào các bảng đó thế nào (ví dụ: tính theo các tháng khoảng đó chạm tới, hoặc chỉ áp cho danh sách deal và ghi rõ trên các bảng kia). Hỏi Dương khi tới lượt |
| **Ghi rõ đây là bộ lọc danh sách deal theo kỳ** (Dương 23/11) | `apps/web/src/pages/deal/period-bar.tsx` | Cách hiển thị hiện tại dễ nhầm với bộ lọc thời gian chung của grid/dashboard. Có nhãn rõ (ví dụ "Kỳ của danh sách deal"), ghi lọc theo cột nào, và tách hẳn về vị trí/kiểu dáng khỏi bộ lọc thời gian |

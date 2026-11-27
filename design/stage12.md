# Stage 12 — việc giao diện gom lại

> Tạo 23/11/2026 (Dương yêu cầu). Gom các điều chỉnh giao diện Dương nêu khi dùng thử, để Stage 12 (làm lại giao diện, rà chuẩn giao diện) làm một lượt. Quy định chung về giao diện vẫn ở `chuan-giao-dien.md`; việc dời theo thiết kế module vẫn ở `update_v1.md`. Làm xong thì xoá dòng.

| Việc | Màn / chỗ code | Ghi chú |
|---|---|---|
| **Ghi rõ đây là bộ lọc danh sách deal theo kỳ** (Dương 23/11) | `apps/web/src/pages/deal/period-bar.tsx` | Cách hiển thị hiện tại dễ nhầm với bộ lọc thời gian chung của grid/dashboard. Có nhãn rõ (ví dụ "Kỳ của danh sách deal"), ghi lọc theo cột nào, và tách hẳn về vị trí/kiểu dáng khỏi bộ lọc thời gian |
| **Dynamic Form: trình soạn kiểu Lark** (Dương 23/11, đổi 27/11) | `apps/web/src/pages/form/editor.tsx` | Form dài thì chỉ khung giữa cuộn; thanh trái và thanh thuộc tính (phải) đứng yên (sticky, cao bằng màn hình, cuộn riêng nếu dài). Thêm câu theo mockup, không kéo thả: nút "+" giữa hai câu chèn đúng chỗ (`module12-giao-dien.md` mục 2) |
| **Dynamic Form: tên và giao diện** (Dương 23/11) | `apps/web/src/pages/shell.tsx` (menu đang ghi "Form"), `apps/web/src/pages/form/` | Menu, tiêu đề trang, breadcrumb dùng đúng tên "Dynamic Form". Làm lại cho gọn, trực quan, chuyên nghiệp: bớt nút và chữ phụ, nhóm thiết lập rõ ràng |
| **Dynamic Form: "Chế độ Bài kiểm tra" nằm trong tab Thiết lập** (Dương 23/11) | `apps/web/src/pages/form/settings.tsx`, phần bài kiểm tra hiện tách riêng | Một công tắc "Chế độ Bài kiểm tra"; bật lên mới hiện thiết lập của nó (thang điểm, điểm đạt, số lần làm tối đa, hiện gì cho người làm). Khi bật: ẩn "Mỗi người một phản hồi" (server đã bỏ qua tuỳ chọn này khi là bài kiểm tra, số lần làm thay thế). "Số phản hồi tối đa" là tổng của cả form, khác "số lần làm" (mỗi người), giữ cả hai và ghi chú rõ nghĩa ngay dưới ô |
| **Lỗi giao diện nhỏ còn sót từ Stage 2–9** (chuyển từ `progress.md` 23/11) | nhiều màn | Grid chưa `impeccable audit`, chưa thử điện thoại thật; e2e 375px cho Knowledge/AI Hub; 375px của Quản lý Deal (dời từ 4.8) |

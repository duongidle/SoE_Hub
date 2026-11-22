# Module 5 — Quyết định khi code

## 5A1 (22/11/2026)

- **Chỗ ánh xạ:** `apps/api/src/core/ai-policy.ts` (bảng `RULES` theo tên). Thao tác khai riêng bằng `menu`/`access`/`forbidden` trong `defineCommand`/`defineQuery`. Test "mọi thao tác" ở `apps/api/test/ai-connections.test.ts`.
- **Menu `admin`** là menu chọn được cho kết nối (gồm thao tác có nhóm cấm). Kết nối cần có menu `admin` ở mức đủ **và** Admin đã bật nhóm. Menu `none` (whoami, auth.me, các hàm tra cứu công thức) luôn được.
- **Nhóm cấm báo `ai_not_allowed`** (cùng mã với cấm cứng và công tắc khẩn cấp), kiểm trước khi tìm kết nối. Lý do: test cũ `http.test.ts` đòi `ai_not_allowed` cho `system.setting.set` qua `mcp` không có kết nối.
- **Bật `aiAllowed` cho thao tác thuộc nhóm** (trước là `false`): `system.setting.set`, `system.audit.*`, `org.member.create/update/lock/unlock`, `org.permission.grant/revoke`, `guest.*`, `data.transfer.*`, `org.tree.transfer`, `datahub.limit.user.*`. Mặc định chúng vẫn đóng vì nhóm tắt.
- **Đổi sang `aiAllowed: false`** (thao tác lớn dời, mục 12 "Dời" 3): `period.close`, `period.reopen`, `period.confirm_received` (cùng luồng chốt kỳ), `datahub.template.*` ghi (create/update/archive/restore, column.create/update/type_change/delete/restore/set_role). **Cũng đóng `datahub.import.*`** (analyze/sheet/preview/start): mapping nhiều sheet có `table_id` lồng sâu, chưa có cách tìm menu đích chắc chắn; mở lại khi có yêu cầu (Opus xem lại).
- **Xoá nhiều dòng:** `datahub.row.batch` có hơn một `delete` và `datahub.row.duplicates.resolve` cần mức `full` (`accessOfInput`).
- **Tìm menu đích:** nhìn mọi id ở tầng ngoài (phải biết hết) và `table_id`/`source` dạng UUID lồng trong input; thấy bảng của datahub Deal thì cả lệnh là `deal`. Dùng marker `/*scope:system*/` vì chỉ đọc loại datahub, không đọc dữ liệu.
- **Metric nội tuyến** (`metrics.query` với `metric.source` là id bảng) cũng tính theo bảng đó; chỉ truyền tên nguồn mà không có `datahub_id` thì đóng.
- **Token cá nhân cũ** ở dev: migration `0023_connection_menus.sql` cho menu mặc định, token đang `active` về `pending`, `scopes` rỗng. Cột `scopes` chỉ còn cho token `soe_svc_`.
- **`reconcileUserTokens`** thành hàm rỗng cho token cá nhân: quyền chủ giao với menu lúc gọi nên không còn gì để thu hẹp (test cũ viết lại: quyền mất ngay ở lần gọi kế).
- **Token chờ duyệt:** `SessionTokenResolver` ném `connection_pending` (401) thay `unauthenticated`; executor cũng kiểm trạng thái. 5A2: `/mcp` cần cho phép token `pending` đi qua bắt tay rồi trả `connection_pending` khi gọi tool (mục 2.4); resolver hiện từ chối ngay, cần thêm đường riêng.
- **Nguồn nhập:** cột chọn của template giữ Tay/AI/API (không có `AI (tên)`); cột text ghi `AI (tên kết nối)`. Tên kết nối nằm ở nhật ký (`details.connection_name`) và `connection_id`. **Câu hỏi cho Opus:** muốn thêm cột `Kết nối` hay đổi cột chọn thành text để view "Do AI nhập chưa kiểm" thấy tên?
- **Tốc độ:** bộ đếm trong bộ nhớ theo kết nối, 120 gọi/phút, 30 ghi/phút (cố định theo phút), quá thì `rate_limited` 429 kèm `retry_after_seconds`. Chưa có 5.000 dòng/giờ (mục 12 không giữ).
- **Test cũ sửa vì scope thành menu:** `tokens.test.ts`, `permissions.test.ts` (ma trận bật mọi nhóm trong `beforeAll`, tắt lại ở `afterAll`), `org.test.ts` (token theo vai trò), `datahub-access.test.ts` (một ca), `fixtures.ts` (`activeToken` nhận `menus`, mặc định mọi menu mức `full`).

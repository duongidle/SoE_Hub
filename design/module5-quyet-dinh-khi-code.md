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

## Opus rà 5A1 (22/11/2026)

- Thao tác thuộc nhóm cấm mặc định (`system.setting.set`, `system.audit.*`, `org.member.*`, `org.permission.*`, `guest.*`, `data.transfer.*`, `org.tree.transfer`, `datahub.limit.user.*`) để `aiAllowed: true`, đóng bằng nhóm: đúng mục 3.3.
- `period.confirm_received` cấm AI cùng luồng chốt kỳ: giữ. `datahub.import.*` cấm AI (chưa tìm chắc menu đích của mapping nhiều sheet): giữ tạm, AI ghi dòng bằng `rows_write`; ghi vào "Còn nợ", mở lại khi có nhu cầu.
- Nguồn nhập: cột lựa chọn giữ `AI` / `API`; tên kết nối đọc ở nhật ký. Không thêm cột `Kết nối`, không đổi cột lựa chọn thành chữ (view "Do AI nhập chưa kiểm" lọc theo lựa chọn là đủ).
- Hạn 5.000 dòng ghi/giờ: không làm (mục 12 chỉ giữ 120 gọi, 30 ghi mỗi phút).
- Thao tác `menu: by_target` mà đầu vào không có đích (ví dụ liệt kê) bị đóng. 5A2 kiểm các thao tác mà 7 tool gọi tới; thao tác liệt kê datahub khai menu cố định `datahub` và lọc bỏ datahub "Quản lý Deal" (mục 3.1).

## 5A2 (22/11/2026)

- **JSON-RPC viết tay, không dùng `@modelcontextprotocol/sdk`:** `/mcp` không trạng thái chỉ cần `initialize`, `ping`, `tools/list`, `tools/call`; thêm SDK kéo thêm phụ thuộc và lớp truyền tải. Phiên bản giao thức trả lại đúng bản client xin nếu thuộc `2025-06-18`, `2025-03-26`, `2024-11-05`. GET/DELETE `/mcp` trả 405 (không có luồng server gửi xuống).
- **Xác thực `/mcp`:** chỉ `soe_pat_`; không token, token `soe_svc_`, cookie đều 401 kèm `WWW-Authenticate: Bearer`. Token thu hồi/hết hạn cũng 401. Token chờ duyệt bắt tay và liệt kê tool được; mọi tool ném `connection_pending` từ executor.
- **`tools/list`:** tool chung luôn có; tool Deal cần menu `deal` mức Xem; `rows_query`/`metrics_query` cần `deal` hoặc `datahub` mức Xem; `rows_write` mức Sửa. Cổng thật vẫn ở executor lúc gọi (kết nối chỉ Datahub gọi `rows_query` vào bảng Deal bị `forbidden`).
- **`soe_operations`** mỗi dòng `tên|mức|tóm tắt 80 ký tự`, lọc `q`/`menu`, mặc định 300 dòng. `soe_call` trả `{items, next_cursor, total}` cho thao tác danh sách.
- **Thêm lệnh `deal.dashboard`** (menu `deal`, mức Xem): mã dashboard hệ thống "Deals" của cây người gọi (của mình nếu là Manager, hoặc datahub được chia sẻ). Lý do: `metrics.dashboard.shared` thuộc menu `datahub` nên kết nối chỉ có menu Deal không gọi được; `deal_metrics` cần đường trong menu `deal`. `deal_metrics` mặc định trả các KPI; `names` chọn biểu đồ khác theo tiêu đề; `filters` chuyển tiếp bộ lọc chung của dashboard.
- **`deals_list`:** `status` theo `meaning` của lựa chọn (không theo tên), `period` + `period_mode` (`related` mặc định, `received`, `closed`, `expected`); `expected` đơn giản hơn forecast: chỉ deal đang mở có Ngày dự kiến chốt trong kỳ, chưa tính đợt thanh toán chưa về hạn. `scope: mine` lọc `eq` theo id người gọi trên mọi cột vai trò `nguoi_tham_gia`.
- **`rows_write` ghi từng phần bằng một lệnh `datahub.row.batch`:** lô cả bó; lỗi có số dòng (`details.issues[].row`, `details.row`, `row_id`, xung đột) thì bỏ dòng đó rồi gửi lại phần còn lại (tối đa 5 vòng); lỗi không chỉ ra dòng thì báo nguyên lỗi. Nhờ vậy 500 dòng chỉ tính 1–5 lần vào hạn 30 ghi/phút. Dòng sửa phải có `version` (từ `_version`) hoặc `base`, thiếu thì bỏ dòng, không đoán. Xoá dòng qua `soe_call` (`datahub.row.delete`, nhiều dòng cần mức Toàn quyền).
- **`metrics_query`:** nguồn là mã bảng mà không có `datahub_id` thì tool tự lấy `datahub_id` của bảng (`menuOfTarget` chỉ tìm ra bảng Deal ở `source` lồng, bảng thường phải có `datahub_id`). Không đợi `consistent` cho chỉ số (engine metric không có tham số này): chỉ `rows_query`/`deals_list`/`deal_get` đợi tối đa 5 giây.
- **Tên người ở ô Người dùng:** tool tra `users` theo id để trả `{name, email, ...thuộc tính}`; các id này đã nằm trong dòng người đó đọc được.

## Opus rà 5A2 (22/11/2026)

- Tự viết JSON-RPC không trạng thái thay cho `@modelcontextprotocol/sdk`: giữ (ít phụ thuộc, Claude Code đã chạy thật). Xem lại khi làm OAuth.
- Lệnh mới `deal.dashboard` (menu `deal`, Xem) để `deal_metrics` đọc dashboard hệ thống Deals: giữ, đúng mục 4.3 (một nơi tính).
- `rows_write` bỏ dòng lỗi rồi gửi lại tối đa 5 vòng; lỗi không gắn dòng (hoặc quá 5 vòng) thì báo lỗi cả lô, không ghi nửa: chấp nhận.
- `soe_call` kiểm đầu vào trước quyền (thao tác cấm với đầu vào sai trả `validation_error`): chấp nhận, không lộ dữ liệu.
- **Import qua AI mở lại ở 5B** (Dương hỏi 22/11): `datahub.import.analyze`, `.sheet`, `.preview` menu cố định `datahub` (chưa ghi dữ liệu); `.start` lấy menu theo các bảng đích trong mapping (có bảng "Quản lý Deal" → `deal`), mức theo chế độ (thay toàn bộ → `full`).

## 5B

- Import qua AI (việc 1): `datahub.import.analyze/sheet/preview` menu `datahub`, mức `read` (chỉ tạo việc nháp, không ghi dữ liệu bảng); `datahub.import.start` menu theo `mapping` (`importMenu` trong `ai-gate.ts`: datahub hay bảng có sẵn thuộc "Quản lý Deal" -> `deal`, còn lại `datahub`; id sai -> đóng cửa), mức `write`, có sheet `write: "replace"` -> `full` (`accessOfInput`). Việc nhập chạy nền bằng quyền chủ việc nên không cần kết nối lúc chạy.
- Giao diện (việc 2-3): trang người dùng đổi tên thành "Kết nối AI" (menu Admin "Duyệt token" cũng đổi thành "Kết nối AI"); chỉ hiện 3 menu có module (Deal, Datahub, Thông báo); khối chính sách đọc/ghi `ai.killed`, `ai.groups_enabled` bằng `PUT /system/settings/:key` (trang Cài đặt hệ thống chung vẫn sửa được dạng chữ). `stage1.spec.ts` đổi theo nhãn mới.

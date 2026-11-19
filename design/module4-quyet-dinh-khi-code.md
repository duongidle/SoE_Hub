# Module 4: quyết định khi code

Quyết định nhỏ Sonnet tự đặt lúc code Stage 4 (CLAUDE.md, "Tự quyết chi tiết nhỏ"). Điều đổi quy định đã chốt thì nằm ở `progress.md` mục "Câu hỏi còn mở".

## 4.1a Khoá phân chia và quyền (server)

Việc 1–9 và 11a của Module 4 mục 19a. Code ở `apps/api/src/modules/datahub/` (`access.ts`, `split-ops.ts` mới, `rows.ts`, `events.ts`, `transfer.ts`, ...), migration `0013_datahub_split_lock.sql`.

**Lưu cấu hình**
- `dh_tables`: `key_split` (bật/tắt), `key_columns text[]` (mã cột, tối đa 5, check ở DB), `key_primary`, `members_bulk_create` (mặc định bật). `dh_columns.allow_edit` (mặc định bật). Mặc định "tắt" cho bảng template đặt lúc dựng bảng template (4.1c), vì chưa có khái niệm template ở 4.1a: lệnh tạo cột nhận `allow_edit`, lệnh `share_options.set` nhận `members_bulk_create`.
- Một lệnh duy nhất đặt khoá: `datahub.table.share_options.set` (`PUT /tables/:table_id/share-options`, chỉ chủ): `key_split`, `key_columns`, `key_primary`, `members_bulk_create`. Hộp thoại ở 4.1d và trang Template (Stage 4) gọi lệnh này. `allow_edit` là thuộc tính cột (`datahub.column.create/update`). `TableOut` trả `key_split{enabled,key_columns,primary}` và `members_bulk_create`; `ColumnOut` trả `allow_edit`.
- "Cho phép leader sửa deal của tôi": bảng `dh_user_prefs(user_id, leader_can_edit)` + `datahub.prefs.get/set`. Đây là **ô cắm**: Quản lý Deal (4.x) chưa có chỗ lưu riêng, màn Deals sẽ gọi `datahub.prefs.set`. Server đã áp luật khi ghi. Là cờ theo người (không theo bảng): mọi bảng có khoá phân chia đều theo cờ này.

**Một chỗ quyết phạm vi dòng**
- `TableAccess.scope()` giữ nguyên nghĩa "điều kiện bảng" (còn dùng cho cột, view, chia sẻ). Thêm `TableAccess.rows(alias)` = `scope()` + điều kiện khoá phân chia, và mọi truy vấn `dh_rows` làm cho một người đều đi qua `rows()`: danh sách, một dòng, lịch sử dòng (kiểm dòng thấy được trước khi đọc `row_history`), nhóm, tìm trùng, thùng rác, tải file, metric (`MTable.scope`), nguồn bảng gộp (`readableRows`), xem trước công thức, mọi ghi (UPDATE/DELETE/restore).
- Điều kiện: người đọc không phải chủ, bảng bật khoá → `((data->>'<key>')::uuid = ANY(<id người đọc + người họ quản lý>))` OR qua các cột khoá. Chủ không bị lọc. Danh sách khoá rỗng mà bật → `false` (đóng).
- "Người họ quản lý" (`loadReader` trong `access.ts`) đọc `org_memberships` hiện tại: Manager quản lý mọi người có `manager_id` của mình; Leader quản lý người có `leader_id` của mình. Quyền **sửa** hộ: Manager mọi người trong cây, Leader chỉ người đã bật `leader_can_edit`.
- Index: dùng loại `uuid` có sẵn (`soe_dh_ensure_index(..., 'uuid')`, btree trên `(data->>key)::uuid`), **không phải GIN** như Module 4 ghi: ô Người dùng hiện là một uuid đơn (kiểu "Người dùng có thuộc tính" của Module 4 mục 4.5 chưa có). Khi có kiểu mảng, đổi `keyMatch` (một hàm) và loại index trong cùng chỗ. Index tạo khi cột vào danh sách khoá, bỏ khi ra khỏi (trừ khi có yêu cầu index `uuid` từ lọc).
- Khoá cache metric `scopeKey(access)`: bảng không khoá/chủ: `<bảng>:<mức>` như cũ; người đọc bị khoá: băm của (cột khoá + tập id người đó thấy). Hai người cùng tập dòng dùng chung câu trả lời; đổi cây làm đổi tập nên đổi khoá; thêm vào đó `org.member.changed` vẫn xoá cache như Stage 3.
- Tổng số dòng của bảng (`row_count` ở `table.get` và danh sách datahub) với người bị khoá là số dòng họ thấy, không lộ cỡ bảng.

**Ghi (`rows.ts`)**
- Sửa/xoá/khôi phục dòng: cần quyền Sửa **và** `canEditRow` (dòng mang tên mình, hoặc người mình được sửa hộ). Lỗi `forbidden` + `reason=row_not_editable`.
- Mỗi ô đổi giá trị ở cột `allow_edit = false` bị chặn với người không phải chủ: `reason=column_not_editable` (liệt kê cột). Ô không đổi giá trị không tính là sửa. Thêm dòng cũng kiểm các cột người dùng điền (cột chính tự điền không tính).
- Thành viên thêm dòng: tên mình tự điền vào cột khoá chính nếu trống; nếu dòng mới không thuộc tập mình thấy (điền người khác ngoài cấp dưới) thì `reason=row_outside_scope`.
- Thêm hàng loạt (11a): hơn một dòng **mới** trong một lần ghi (batch, upsert sinh dòng mới) → `reason=bulk_create_off` khi chủ tắt `members_bulk_create`. Import: `datahub.import.preview` báo `blocking`; `datahub.import.start` ném `bulk_create_off`. Dán trong grid đi qua `datahub.row.batch` nên server cũng chặn (web chặn trước ở 4.1d).
- Upsert mà dòng khớp khoá nằm ngoài phạm vi: coi như dòng mới (không lộ sự tồn tại), nhưng cột `duplicate_value` (cột "duy nhất") vẫn có thể cho biết giá trị đã có ở dòng ẩn. Chấp nhận, ghi ở "Việc còn lại".
- Ô Người dùng chỉ nhận thành viên (chủ + người được chia sẻ cả datahub hoặc bảng này): kiểm ở `applyRowOps` cho giá trị **mới** (dòng mới, hoặc ô đổi) ở mọi kênh (web, API, MCP, import không ghi ô người ở Stage 2, form sau này gọi cùng hàm). Giá trị đã lưu của người đã bị gỡ giữ nguyên.
- `datahub.people.lookup` thêm `table_id`: `q` chỉ gợi ý chủ và thành viên; `ids` vẫn đổi mã ra tên cho mọi người và trả `member` (false = "không còn quyền"). Không có `table_id` thì như cũ (dùng cho hộp thoại Chia sẻ).
- Gỡ thành viên: `datahub.share.tagged` (xem trước) và `datahub.share.remove` trả `tagged_rows`. Tag giữ nguyên.

**SSE**
- Sự kiện dòng (`datahub.row.*`) và `datahub.formula.recalculated` loại `changed` đi theo `rowAudience`: chủ + thành viên thấy ít nhất một dòng. Người từng thấy dòng mà khoá vừa chuyển sang người khác vẫn nhận được: payload có `key_users` (id đang nằm ở cột khoá **trước và sau** khi ghi). Sự kiện `pending`/`done` của cột (không có dòng) và `structure.changed` vẫn gửi cho mọi người thấy bảng (chỉ mang mã cột, không mang dòng). SSE không mang giá trị; lọc theo dòng chặn việc lộ "có dòng nào đó vừa đổi".
- Bật/tắt/đổi cột khoá phát `datahub.structure.changed` (`table_updated`): xoá cache metric, bảng gộp đọc bảng này đồng bộ lại, màn hình đang mở tải lại.

**Cấu trúc cột**
- Cột khoá phải kiểu Người dùng, tối đa 5, không trùng; chủ bảng đặt. Không xoá / đổi kiểu khi còn là khoá (`reason=key_column_rule`). Tắt khoá giữ cấu hình.

**Chuyển giao (`transfer.ts`)**
- `datahub_split_membership`: ở mọi bảng bật khoá mà người nguồn là thành viên (hoặc datahub đổi chủ), người đích nhận cùng chia sẻ (quyền cao hơn thắng; chủ không cần) và mọi dòng mang tên người nguồn ở cột khoá chuyển sang người đích, có lịch sử dòng, hàng đợi tính lại và sự kiện. "Deal đã đóng giữ người cũ" (Module 1 mục 8) chưa làm được vì chưa có deal; Stage 4 đăng ký điều kiện giữ lại ở chỗ này.

## Việc còn lại / ghi chú cho 4.1b–d
- Lịch sử dòng (`rowHistory`): với người bị khoá, kiểm dòng nằm trong `rows()` trước khi đọc `row_history` (chủ và bảng không khoá giữ nguyên, kể cả dòng đã xoá hẳn).
- `loadSource` (bảng gộp) vẫn đòi chủ bảng nguồn: một Leader/Manager dựng bảng gộp từ bảng chung của người khác (Deals) chưa được. Để 4.1b/Stage 4 quyết cùng "bảng riêng/ bảng chung".
- Web: hộp thoại chia sẻ, ngăn sửa cột, ô Người dùng gọi `datahub.people.lookup` với `table_id`, "không còn quyền" (4.1d).

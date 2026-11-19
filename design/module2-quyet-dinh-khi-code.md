# Module 2 — Quyết định khi code

> Tách từ `module2-datahub.md` ngày 19/11/2026 để bước con chỉ đọc thiết kế. Tra file này khi cần biết một bước đã làm thế nào; ghi quyết định của bước con mới (2C-3 trở đi) vào cuối file này, không ghi vào `module2-datahub.md`.
> Thiết kế đã chốt: [module2-datahub.md](module2-datahub.md).

### Stage 2A (lưu trữ và API lõi)

Phạm vi 2A: schema, cấu trúc, dòng, view, chia sẻ, giới hạn, thùng rác, SSE, chuyển giao, view SQL, index tự động. Chưa có công thức, relation, lookup, rollup (2B), chưa có giao diện (2C), chưa có import/export (2D).

**Lưu trữ**
- Bảng: `dh_datahubs`, `dh_tables`, `dh_columns`, `dh_rows`, `dh_views`, `dh_view_overrides`, `dh_table_state`, `dh_shares`, `dh_user_limits`, `dh_index_requests` (migration `0004`). Code ở `packages/db/src/schema/datahub.ts` và `apps/api/src/modules/datahub/`.
- Giá trị ô nằm trong `dh_rows.data` (jsonb), khoá là **mã cột**, không phải tên cột. Mã cột dạng `c_xxxxxxxx` (ngẫu nhiên, không sinh từ tên, có ràng buộc `^[a-z][a-z0-9_]{0,40}$`). Đổi tên cột không đụng vào dữ liệu.
- API nhận cột bằng mã hoặc tên; server dịch tên sang mã. Trường chuẩn dùng tiền tố `_`: `_row_no`, `_created_at`, `_updated_at`, `_created_by`, `_updated_by`, `_id`, `_version`.
- Ô rỗng thì khoá bị bỏ khỏi `data` (không lưu `null`).
- Cột Một lựa chọn lưu **mã lựa chọn** `o_xxxxxxxx`; Nhiều lựa chọn lưu mảng mã. Đổi tên lựa chọn không đụng dữ liệu. API nhận mã hoặc tên (không phân biệt hoa thường, bỏ dấu); `labels=true` khi đọc thì trả tên. Thứ tự trong mảng `options` là thứ tự sắp xếp. Tên lựa chọn không trùng trong cột, tối đa 200 lựa chọn.
- `dh_rows.search` gom chữ của mọi ô kiểu chữ để tìm toàn bảng; có index trigram trên `soe_unaccent(lower(search))`. Tìm kiếm tách tối đa 8 từ, từ nào cũng phải khớp.
- `row_no` tăng theo bảng, không dùng lại. Cột Số tự tăng giữ bộ đếm trong `config.seq`.
- Tên (datahub, bảng, cột) không trùng không phân biệt hoa thường và dấu cách thừa: cột `name_norm` sinh tự động, có unique index chỉ tính bản ghi chưa xoá. Tên tối đa 100 ký tự, không có `[` `]`.
- Kiểu cột có sẵn trong 2A: chữ, chữ dài, số, tiền, phần trăm, ngày, ngày giờ, checkbox, đánh giá, một lựa chọn, nhiều lựa chọn, người dùng, email, điện thoại, link, đính kèm, số tự tăng, và các cột hệ thống (mã dòng, thời gian tạo/sửa, người tạo/sửa). `formula`, `relation`, `lookup`, `rollup` đã giữ tên nhưng tạo cột sẽ bị từ chối (`available: false`) cho đến 2B. Kiểu cột là một registry (`registerColumnType`), 2B cắm thêm vào.
- Đổi kiểu cột có API xem trước (`datahub.column.type_preview`: đếm ô đổi được, ô mất) rồi mới đổi (`datahub.column.type_change`).

**Ghi dòng**
- Mọi thao tác ghi đi qua một chỗ (`applyRowOps` trong `rows.ts`): tạo, sửa, xoá, upsert, batch. Gọi đơn lẻ là batch một phần tử. Batch tối đa 500, chạy một giao dịch; lỗi nhiều ô được gom lại báo một lần (`issues` có số dòng, tên cột, lý do).
- Sửa dòng **gộp theo từng ô**: client gửi `base` (giá trị đã đọc). Chỉ khi chính ô đó bị người khác đổi sau đó mới trả 409 `conflict` kèm giá trị hiện tại; sửa hai ô khác nhau thì gộp. Không có `base` thì bắt buộc gửi `version`.
- Sửa mà không đổi gì thì kết quả `unchanged`: không tăng `version`, không ghi lịch sử.
- Upsert theo khoá: cột khoá phải là cột `unique`; cột `unique` có unique index thật (loại `uniq`, tạo ngay khi bật, không tính vào ngân sách 8 index tự động). Bỏ `unique` hoặc xoá cột thì index bị bỏ.
- Xoá dòng là xoá mềm (`deleted_at`); khôi phục bằng `datahub.row.restore`. Lịch sử dòng (`row_history`) giữ mãi, kể cả sau khi dòng bị dọn khỏi thùng rác. Lịch sử đọc bằng `datahub.row.history` (phân trang theo `version` giảm dần).

**Đọc dòng**
- `datahub.row.list`: lọc bằng cú pháp chung của Module 0, sắp xếp nhiều cấp (`sort` dạng JSON hoặc `cột:asc:last,...`), `fields`, `search`, `labels`. Mặc định `limit` 50, tối đa 500 (`MAX_PAGE_LIMIT`).
- Phân trang **keyset** (con trỏ `next_cursor`), không dùng offset. Luôn thêm `row_no` vào cuối thứ tự sắp để ổn định. Cột Một lựa chọn sắp theo thứ tự lựa chọn, không theo chữ. `include_total=true` mới đếm tổng (đếm tốn thời gian trên bảng lớn).
- Lọc, sắp xếp, tìm kiếm đều chạy ở server bằng SQL trên jsonb; client không bao giờ tải cả bảng.

**Index tự động** (Module 0 mục 6.2)
- Mỗi lần đọc, nếu bảng có **từ 5.000 dòng** (`DH_AUTO_INDEX_MIN_ROWS`) và có lọc hoặc sắp xếp theo một cột, server ghi một yêu cầu vào `dh_index_requests` (mỗi bộ bảng-cột-loại một dòng, `ON CONFLICT DO NOTHING`). Việc ghi này làm "cố gắng hết sức": lỗi thì bỏ qua, không làm hỏng lần đọc.
- Loại index theo kiểu cột: `num`, `text`, `date`, `ts`, `bool`, `uuid`; lọc `contains` hoặc `starts_with` trên cột chữ thì dùng `trgm` (GIN trigram, đã bỏ dấu và chữ thường). Cột ảo (mã dòng, thời gian tạo/sửa...) đã có cột thật nên không cần index.
- Worker chạy job `datahub-autoindex` mỗi phút, xử lý tối đa 50 yêu cầu mỗi lượt. **Tối đa 8 index tự động mỗi bảng** (`DH_AUTO_INDEX_MAX_PER_TABLE`); yêu cầu vượt ngân sách bị đánh dấu `skipped` kèm ghi chú. Lỗi thì `failed`, ghi lý do (cắt 300 ký tự).
- Index là **index biểu thức một phần**: chỉ trên một bảng và dòng chưa xoá (`WHERE table_id = ... AND deleted_at IS NULL`). Tên: `dh_ix_<12 ký tự đầu của id bảng>_<mã cột>_<loại>`.
- Vai trò `soe_app` không có quyền DDL, nên việc tạo/xoá index và view đi qua hàm `SECURITY DEFINER` (`soe_dh_ensure_index`, `soe_dh_drop_indexes`, `soe_dh_regenerate_view`, `soe_dh_sync_views`, migration `0005`). Hàm chỉ dựng SQL từ mã cột đã kiểm tra mẫu và loại cố định. Hàm `soe_date`, `soe_ts` bọc việc ép kiểu ngày để dùng được trong index (IMMUTABLE).
- Khi xoá hẳn cột (dọn thùng rác) thì giá trị bị gỡ khỏi `data` và các index của cột bị bỏ.

**View SQL xuất** (mục 3)
- Mỗi bảng có một view trong schema `dh_views`, tên `<phần trước @ của email chủ> – <datahub> – <bảng>`. Cột view mang tên cột người dùng đặt; giá trị đã đổi sang dạng đọc được (lựa chọn thành tên, người dùng thành họ tên, số thành `numeric`/`bigint`, ngày thành `date`/`timestamptz`). Luôn có `id` và `row_no`.
- **Tên dài:** Postgres giới hạn định danh 63 byte. Tên được cắt theo byte nhưng không cắt giữa ký tự tiếng Việt (`soe_dh_ident`). Hai bảng cắt ra cùng tên thì bảng sau thêm đuôi ` #` + 6 ký tự đầu của id. Tên cột trùng sau khi cắt (hoặc trùng `id`, `row_no`) thì thêm `_2`, `_3`...
- Bảng hoặc datahub nằm trong thùng rác thì không có view. Chỉ chủ schema đọc được `dh_views`; vai trò ứng dụng không đọc.
- View dựng lại ở worker khi nhận sự kiện `datahub.structure.changed`; thêm job `datahub-views-sync` mỗi đêm 03:20 dựng lại mọi view và xoá view mồ côi.

**Giới hạn, thùng rác, chia sẻ**
- Giới hạn mặc định nằm trong cài đặt hệ thống: `datahub.max_datahubs` (5), `datahub.max_tables` (10), `datahub.max_columns` (70, tối đa 200). Chỉnh riêng từng người trong `dh_user_limits` (`datahub.limit.user.set`); giá trị trống là dùng mặc định. Cột không bao giờ vượt trần 200 dù cài đặt hay chỉnh riêng. Vượt giới hạn trả mã `quota_exceeded`.
- Thùng rác dùng chung cài đặt `trash.retention_days` (mặc định 7) của Module 0; job dọn hằng đêm xoá hẳn theo thứ tự dòng, cột, bảng, datahub. Khoá ngoại xoá dây chuyền view, chia sẻ, yêu cầu index.
- Chia sẻ: `view` hoặc `edit_data`; theo cả datahub (`table_id` trống) hoặc từng bảng. Mỗi cặp (datahub, người) hoặc (bảng, người) chỉ có một dòng. Quyền sửa cấu trúc chỉ của chủ.

**SSE (sự kiện)**
- `datahub.row.created|updated|deleted|restored`: mang `table_id`, `row_ids` (tối đa 500), `columns` (mã các cột đổi, để 2B tính lại phần phụ thuộc). Không mang giá trị.
- `datahub.structure.changed`: mang `datahub_id`, `table_id`, `change` (datahub/bảng/cột tạo, sửa, xoá, khôi phục, đổi chủ, đổi kiểu cột). Worker dùng nó để dựng lại view SQL.
- `datahub.share.changed`: người được chia sẻ nhận cả khi vừa bị gỡ.
- Chỉ người nhìn thấy bảng (chủ và người được chia sẻ) nhận tín hiệu.

**Chuyển giao dữ liệu** (Module 1 mục 8)
- Datahub của tài khoản nguồn (cả datahub trong thùng rác) đổi chủ sang tài khoản đích. Tên trùng với datahub của đích thì thêm ` (chuyển giao)`, rồi ` (chuyển giao 2)`... để không mất và không bị từ chối. Chia sẻ mà đích đã có sẵn trên datahub đó bị xoá vì thừa. View SQL dựng lại vì tên view chứa tên chủ.

**Lệch hoặc bổ sung so với thiết kế**
- Thiết kế chưa nói con số cụ thể của ngân sách index; code chốt 8 mỗi bảng, ngưỡng 5.000 dòng.
- Index `uniq` (cột `unique`) tạo ngay, không qua job và không tính vào ngân sách 8.
- Chỉnh giới hạn riêng từng người (`datahub.limit.user.list|set`) dùng quyền cài đặt hệ thống `system:setting:read|write`.
- Không có lệch nào với quy định đã chốt trong CLAUDE.md.

**Đo tốc độ (bảng 100.000 dòng, máy dev, `apps/api/test/datahub-perf.test.ts`)**
- Trung vị 7 lần, trang đầu 50 dòng: trước index 23–81 ms, sau index 3–44 ms; tìm kiếm trigram 4–5 ms; trang keyset kế tiếp 2,7 ms mỗi trang. Mọi tình huống dưới 300 ms. Số cụ thể ở `progress.md`.

### Stage 2B (công thức và cột tính toán)

Phạm vi 2B: engine công thức (`packages/formula`), các cột `formula`, `relation`, `lookup`, `rollup`, tính lại, API xem trước và danh mục hàm. Chưa có giao diện trình soạn (2C), chưa import công thức (2D), chưa có Bảng gộp (Stage 3).

**Engine (`packages/formula`)**
- TypeScript thuần, không phụ thuộc Node, chạy ở trình duyệt (xem trước) và server (giá trị chính thức). Gồm lexer, parser (có vị trí ký tự cho từng lỗi), suy kiểu tĩnh, danh mục hàm, bộ chạy, phân tích phụ thuộc.
- **Dạng lưu**: `config.expr` bỏ dấu `=` đầu, tham chiếu đổi thành mã: `{c_ab12cd34}` (ô cùng dòng), `{<uuid bảng>.c_ab12cd34}` (cả cột của một bảng, kể cả bảng này). Hiển thị lại theo tên hiện tại (đổi tên cột/bảng/datahub không làm hỏng công thức); mã trỏ tới thứ đã xoá hiện `[#REF!]`. Cách bố cục của người gõ (xuống dòng, khoảng trắng) được giữ. Vị trí lỗi cú pháp, tên hàm, số đối số tính trên chính văn bản người gõ.
- **Ngày là số** như Excel (ngày 1899-12-30 = 0, giờ Việt Nam), kiểu kết quả được suy tĩnh nên cột ngày lưu lại `YYYY-MM-DD`. Chữ dạng `dd/mm/yyyy` hoặc `yyyy-mm-dd` được ép thành ngày khi tính toán (như Excel, file mẫu cần: `DATEDIF(TODAY(),"31/12/2025","D")`).
- **Kiểu kết quả** (`config.result_type`): `number`, `percent`, `text`, `date`, `datetime`, `checkbox`. Tự suy; người dùng ghi đè được khi lưu. Hai nhánh khác kiểu thì kết quả là chữ (`mixed`), nhưng chuỗi rỗng `""` không quyết định kiểu (`IFERROR(a/b, "")` vẫn là cột số, ô lỗi thành ô trống). Không có `currency`, `rating`, lựa chọn làm kiểu kết quả: dùng `display` (đơn vị, số lẻ) cho tiền. *Quy tắc hai nhánh khác kiểu: Dương đồng ý 18/11/2026.*
- **106 hàm** (design nói khoảng 100): đủ các hàm của mục 6.2, thêm `CONCATENATE`, `REPT`, `EXACT`, `LN`, `SIGN`, `TRUNC`, `HOUR`, `MINUTE`. Mỗi hàm có nhóm, cú pháp, mô tả tiếng Việt, một ví dụ và kết quả ví dụ (`FUNCTION_CATALOG`, test kiểm mọi ví dụ parse được).
- Tra cứu theo **cột** vì không có ô: `VLOOKUP(giá_trị, cột_tìm, cột_kết_quả, [gần_đúng])`, `INDEX(cột, n)`, `MATCH(giá_trị, cột, [kiểu])`. Toán tử áp lên cả cột chạy từng phần tử (như công thức mảng), nên `SUMPRODUCT(([Bảng].[Loại]="x")*[Bảng].[Tiền])` và `FILTER` hoạt động. Hàm trả danh sách (`FILTER`, `UNIQUE`, `SORT`) mà là kết quả cuối thì được nối bằng ", ".
- **Điều kiện kiểu Excel** (`COUNTIFS`...): `"="`, `">="`, `"<>"`, ký tự đại diện `*` `?` `~`; chữ không phân biệt hoa thường, **có phân biệt dấu**; chữ dạng số bằng số đó; ô điều kiện trống tính là 0 (như Excel); lỗi thì lỗi. `XLOOKUP` với kiểu khớp mặc định coi `*` là chữ thường.
- Lỗi: `#DIV/0!`, `#N/A`, `#VALUE!`, `#REF!`, `#CYCLE!`, `#PERM!`, thêm `#NAME?` (tên hàm lạ) và `#NUM!`.

**Lưu giá trị**
- Giá trị lưu ở `data[mã cột]`. **Lỗi của ô lưu riêng ở khoá `!<mã cột>`** (giá trị bị xoá), để lọc và sắp xếp theo số/ngày không bao giờ gặp chữ `#DIV/0!`. API trả mã lỗi thay cho giá trị (cả khi chọn `fields=`); view SQL xuất hiện ô lỗi là NULL.
- Cột tính toán lọc, sắp xếp, đánh index theo kiểu kết quả của nó. Không có `unique`, `required`, giá trị mặc định. Không vào ô tìm kiếm toàn bảng.
- Trạng thái tính nằm ở **cột** (`dh_columns.calc_status`: `ready` / `pending` / `running`, `calc_done`, `calc_total`, `calc_at`, `calc_volatile`), API cột trả `calc`. "Đang tính" hiện cho cả cột, không theo từng ô. Bảng phụ thuộc `dh_formula_deps` (cột tính toán đọc gì: `cell` = cột cùng dòng, `range` = cả cột của một bảng) phục vụ kiểm tra vòng lặp và tính lại.
- Người không phải chủ datahub (được chia sẻ) chỉ thấy giá trị và kiểu kết quả; văn bản công thức và tên bảng đích không hiện (khỏi lộ tên bảng họ không được xem). *Dương đồng ý 18/11/2026.*

**Tính lại**
- **Công thức chỉ đọc cột cùng dòng**: API tính trong giao dịch lưu dòng (`row-formulas.ts`), theo thứ tự phụ thuộc, nên giá trị có ngay. Không vào lịch sử dòng (kể cả khi xoá dòng); tên cột công thức đổi giá trị được thêm vào `columns` của sự kiện dòng để cột ở bảng khác tính tiếp.
- **Công thức đọc bảng khác, lookup, rollup**: worker tính. Bộ nghe outbox `datahub.formula` đánh dấu `pending` các cột bị ảnh hưởng (đổi dòng nguồn, thêm/xoá/khôi phục dòng, cột/bảng/datahub xoá hoặc khôi phục, đổi chủ, đổi kiểu cột); vòng lặp trong worker (`startRecalcLoop`, chu kỳ `WORKER_OUTBOX_POLL_MS`) nhận từng cột đang chờ, tính **cả cột**, ghi từng lô 2.000 dòng, báo tiến độ. Nhiều thay đổi liên tiếp được gộp (một cột `pending` chỉ tính một lần). Cột A đang chờ mà cột B đọc A cũng đang chờ thì B đợi A xong (đúng thứ tự phụ thuộc). Dòng mới tạo có ô công thức liên bảng trống cho đến khi worker tính xong (vài giây).
- Mỗi lần ghi chỉ thay **hai khoá của cột đó** (`data - [khoá, !khoá] || {...}`) trên dữ liệu hiện tại của dòng, nên không đè sửa tay đồng thời; ô không đổi giá trị thì bỏ qua; **không** lịch sử dòng, không nhật ký, không đổi `version` và `updated_at`. Cuối mỗi lần tính phát `datahub.formula.recalculated` (`state: pending|done`, số dòng đổi, tối đa 500 mã dòng hoặc null) tới người nhìn thấy bảng, và là thứ kích hoạt cột phụ thuộc (khi có dòng đổi).
- **`TODAY()`**: job `datahub-formula-today` 00:05 giờ Việt Nam; **`NOW()`**: job `datahub-formula-now` mỗi giờ. Cả hai gọi `markVolatilePending`: đánh dấu cột có `calc_at` cũ hơn mốc đáng ra đã tính (00:05 gần nhất / đầu giờ gần nhất). Worker khởi động cũng gọi nó (**chạy bù**) và đưa các cột còn `running` do sập máy về `pending`. `calc_at` là thời điểm dùng để tính, không phải giờ ghi.
- Lỗi khi tính một cột: ghi log, nhả cột (`ready`), không chặn các cột khác.

**Kiểm tra khi lưu cột** (`computed.ts`, dùng chung với API xem trước)
- Chỉ **chủ** datahub tạo/sửa cột tính toán. Tên bảng/datahub chỉ tìm trong **datahub chưa xoá do chính chủ sở hữu**; datahub người khác (kể cả đã chia sẻ) không tìm thấy, thông báo nhắc `#PERM!`. Lúc tính, bảng không còn cùng chủ (ví dụ sau chuyển giao) cho `#PERM!`, bảng/cột đã xoá cho `#REF!`.
- **Vòng lặp** bị chặn bằng tìm đường đi trong đồ thị phụ thuộc của cả bộ datahub của chủ, kể cả cạnh lookup/rollup; thông báo nêu đường đi `[Bảng].[Cột] → ...`. Công thức tự đọc chính cột mình cũng là vòng.
- **Ngưỡng 20.000 dòng**: lời gọi không gom nhóm được bằng SQL (điều kiện `>=`, ký tự đại diện, regex, `MATCH` gần đúng, `FILTER`... trên cột của bảng khác) phải duyệt từng dòng nên bảng nguồn > 20.000 dòng bị từ chối ngay khi lưu (`details.code = scan_too_large`); lúc tính, bảng đã phình quá ngưỡng cho `#VALUE!`.
- **Gom nhóm SQL** (mục 6.6): `COUNTIFS`, `COUNTIF`, `SUMIFS`, `SUMIF`, `AVERAGEIFS`, `AVERAGEIF`, `MINIFS`, `MAXIFS` với điều kiện bằng; `XLOOKUP` (khớp đúng, tìm từ đầu), `VLOOKUP` (không gần đúng), `INDEX(…, MATCH(…, 0))`; và `SUM`/`COUNT`/`COUNTA`/`AVERAGE`/`MIN`/`MAX` cả một cột. Điều kiện là chữ có toán tử/ký tự đại diện, hoặc vùng điều kiện nằm trong biểu thức thì không gom nhóm (đi đường duyệt từng dòng). Mỗi lời gọi gom nhóm = **một câu `GROUP BY` cho cả cột** (`buildPlan`), kết quả nạp vào bảng băm để từng dòng tra; giá trị điều kiện của một dòng mà hoá ra có toán tử/ký tự đại diện (đến từ ô) thì dòng đó quay về đường duyệt (nếu bảng nhỏ) hoặc `#VALUE!`. Khoá nhóm dùng chung hàm `equalityKey` với đường duyệt nên hai đường cho kết quả giống nhau (test `datahub-formulas-grouped.test.ts` so 22 cặp công thức). Chỉ gom nhóm theo cột lưu trong `data` kiểu chữ, số, ngày, ngày giờ, checkbox, một lựa chọn, người dùng.
- **Lỗi trong cột nguồn truyền đi như Excel** (cùng quy tắc ở SQL gom nhóm và ở đường duyệt từng dòng, có test tương đương): nếu một dòng **khớp điều kiện** có ô giá trị (cột cộng/trung bình/min/max, cột kết quả của lookup) đang lỗi thì kết quả là lỗi đó (lỗi của dòng có `row_no` nhỏ nhất); dòng không khớp không ảnh hưởng. SQL gom nhóm mang theo cờ lỗi và mã lỗi đầu tiên theo `row_no` của mỗi nhóm. Lỗi nằm ở cột **điều kiện** thì dòng đó chỉ không khớp điều kiện bằng. `COUNT` không đếm ô lỗi, `COUNTA` có đếm; rollup count/counta/countunique cũng vậy, các rollup còn lại (sum, avg, min, max, concat) trả lỗi đầu tiên. `XLOOKUP`/`VLOOKUP`/`INDEX…MATCH` trả về ô đang lỗi thì trả lỗi đó. `LEFT`/`MID`... trên ngày lấy chữ số của số ngày (đúng Excel, xem golden test).

**Cột liên kết**
- `relation`: giá trị ô là **mảng mã dòng** của bảng đích (một dòng hay nhiều tuỳ `multiple`). Bảng đích phải thuộc datahub của cùng chủ; mã dòng phải là dòng chưa xoá của bảng đích (kiểm tra mỗi lần ghi). **Chỉ chủ** datahub ghi được ô liên kết (người được chia sẻ quyền Sửa không ghi được: tránh biết/ghi mã dòng của bảng họ không xem được). *Ngoại lệ của quyền Sửa dữ liệu, Dương đồng ý 18/11/2026.* Không đổi được bảng đích của cột có sẵn.
- `lookup` (`{relation, target_column}`): giá trị cột đích của dòng được liên kết; liên kết một dòng thì kiểu của cột đích, liên kết nhiều dòng thì chữ nối bằng ", ". `rollup` (`{relation, target_column, fn}`, `fn` = sum, count, counta, avg, min, max, countunique, concat): sum/avg cần cột số, min/max cột số hoặc ngày. Lookup/rollup do worker tính.

**API**
- `datahub.formula.functions` (GET `/datahub/formula-functions`): danh mục hàm + mã lỗi.
- `datahub.formula.preview` (POST `/tables/:table_id/formula/preview`, chỉ chủ): `ok`, `errors[{message,start,end}]`, `formula` (tên hiện tại), `result_type`, `volatile`, `reads` (cột/bảng đọc, số lời gọi gom nhóm, bảng phải duyệt), `rows` (5 dòng đầu: giá trị hoặc mã lỗi + câu giải thích). Công thức sai trả `ok: false` chứ không lỗi HTTP. Dùng đúng mã kiểm tra của lúc lưu.
- `datahub.column.create|update` nhận `config.formula` (công thức), `config.result_type` (tuỳ chọn); `GET table` và cột trả `config.formula` (có `=`), `calc`.

**Lệch hoặc bổ sung so với thiết kế**
- Thiết kế nói "ô đang chờ hiện biểu tượng đang tính": làm ở mức **cột** (`calc.status`), không theo ô. Mục 6.7 chuyển sang theo ô (bước 2B+).
- Thiết kế nói "hàm khoảng 100": 106 hàm. `VLOOKUP`, `INDEX`, `MATCH` theo cột, không theo vùng ô.
- Cột tính toán tính lại **cả cột** khi nguồn đổi (có gộp), không tính riêng những dòng bị ảnh hưởng. Đủ nhanh ở 100.000 dòng (số đo bên dưới); nếu sau này cần thì thêm tính theo dòng. **Đã thay bằng mục 6.7 (chốt 18/11/2026), làm ở bước 2B+.**
- Không có lệch nào với quy định đã chốt trong CLAUDE.md.

**Golden test** (`apps/api/test/formula-golden.test.ts`, đọc thẳng file mẫu, bỏ qua khi máy không có file)
- 3.322 công thức của 6 sheet (`Raw PODPS`, `Index`, `Cumulative Index`, `Plan 2024 -2025`, `Phân tích PS`, `BC-ML Com Policy`) đều parse và chạy; 3.321 khớp giá trị Excel đã lưu trong file, 1 công thức `TODAY()` chỉ kiểm parse và chạy. Hàm file dùng: COUNTIFS, SUMIFS, DATEDIF, IFS, IFERROR, IF, EOMONTH, EDATE, ROUNDUP, ROUNDDOWN, ROUND, MOD, LEFT, SUM, TODAY.
- Adapter chỉ có trong test (A1/bảng Excel sang tham chiếu của engine, lấy giá trị đã lưu từ XML của file). Việc dịch công thức Excel khi import là của 2D.
- Hai điểm của file mẫu: (1) giá trị đã lưu cho `IFERROR(IF(MOD(LEFT($A3,2),3)=0, ...` (324 công thức) dựa vào chữ hiển thị `MM/yyyy` của ô ngày, trong khi Excel và engine lấy `LEFT` của số ngày; adapter viết lại thành `TEXT(ngày,"mm")` để kiểm phần còn lại. Khi import (2D) cần cảnh báo kiểu công thức này. (2) File lưu lỗi dưới dạng chữ (`t="str"` "#DIV/0!"); adapter coi đó là lỗi.
- Sheet `Deals` không có dòng dữ liệu nên Index đều bằng 0; test thứ hai kiểm `COUNTIFS`/`SUMIFS` kiểu Index trên dòng deal tự tạo (không lấy từ file).

**Đo tốc độ** (`apps/api/test/datahub-formulas-perf.test.ts`, 100.000 dòng nguồn x 100.000 dòng đích, máy dev)
- Tính lại cả cột 100.000 dòng: SUMIFS 1,76 s, COUNTIFS hai điều kiện 2,33 s, XLOOKUP 2,08 s, AVERAGEIFS 1,97 s, MAXIFS trên ngày 2,34 s, SUMIFS/COUNTIFS gộp 2,52 s. Sửa một dòng nguồn thì 6 cột phụ thuộc tính lại trong 3,95 s.


### Stage 2B+ (tính lại theo phần, sự kiện, đợi tính xong, đối soát)

Làm theo mục 6.7. Ghi lại chi tiết khi code; không đổi quy định đã chốt.

**Hàng đợi và tính theo phần** (`change-queue.ts`, `partial.ts`, `recalc.ts`; migration `0007`)
- Một bảng `dh_change_queue` cho cả hệ thống, một dòng mỗi lần ghi cho mỗi cột bị ảnh hưởng. `mode`: `rows` (dòng của chính bảng), `linked` (dòng của bảng đích Liên kết, tra ngược bằng index GIN rồi mới ra dòng của bảng này), `keys` (khoá nhóm cũ và mới của dòng nguồn), `full` (cả cột). Ghi vào hàng đợi nằm **trong giao dịch ghi dòng**, nên ghi đã commit thì chắc chắn có mục trong hàng đợi.
- `touchColumns` khoá các cột theo thứ tự id rồi đặt `pending` + `calc_requested_at`; nhờ vậy mục ghi trong lúc cột đang chạy không bao giờ mất (cột chạy xong thấy `calc_requested_at` mới hơn mốc nhận việc thì quay lại `pending`).
- Worker nhận **cả đợt** của một cột, tính chỉ các dòng được nêu, rồi trong MỘT giao dịch: xoá đúng các mục đã đọc, nhả cột, ghi `calc_seq`, xếp mục cho cột đọc cột này (chuỗi, mang theo `cũ → mới`) và phát sự kiện `done`. Vượt `PARTIAL_MAX_RATIO` = 20% số dòng của bảng, hoặc có mục `full`, hoặc quá `CHAIN_LIMIT` = 5.000 thay đổi thì tính cả cột.
- Nhóm khoá chỉ theo cột kiểu chữ/số/ngày (`keyFamily`); khoá kiểu khác (lựa chọn, ngày giờ, checkbox) tính cả cột. Hàm SQL `soe_eqk` là bản SQL của `equalityKey`.
- Công thức chỉ đọc cột cùng dòng vẫn do API tính trong giao dịch ghi (như 2B), không qua hàng đợi.

**Sự kiện và song song**
- `datahub.formula.recalculated`: `pending` (khi đánh dấu), `changed` (mỗi lô tối đa `EVENT_ROWS` = 500 phần tử `row_id, column, old, new`; giá trị hoặc `{error: "#DIV/0!"}`; ô không đổi thì không có phần tử), `done` (tổng số dòng đổi, không có danh sách vì danh sách đã đi qua các sự kiện `changed`). Lô `changed` được ghi vào outbox trong **cùng giao dịch** với lô ghi giá trị. Không có sự kiện "tải lại cả bảng".
- SSE dùng chung sự kiện này nhưng chỉ phát **tín hiệu** (không có giá trị, như mọi tín hiệu SSE: `core/subscribers.ts`); người nghe cần giá trị (Automation) đọc outbox. Người nhận SSE = người nhìn thấy bảng.
- Song song: `processPendingColumns` chạy `datahub.recalc_parallel` làn (mặc định 2, 1–4, Admin chỉnh trong Cài đặt hệ thống; trang Cài đặt đọc từ catalog nên không cần giao diện riêng). Một làn chỉ nhận cột mà các cột nó đọc đã `ready` (`claimNext`), nên chuỗi A→B giữ thứ tự dù nhiều làn.

**Số thứ tự thay đổi và đợi tính xong** (`consistency.ts`, `rows-read.ts`, `row-ops.ts`)
- Sequence `dh_change_seq`. Mọi lệnh ghi dòng trả **`seq`**: `row.create|update|restore` (trường `seq` cạnh các trường của dòng), `row.delete` và `row.upsert` (`seq`), `row.batch` (`seq` ở ngoài và trong từng phần tử `results`; cả lô một số). `calc_seq` của cột (`calc.seq` trong API cột) = số cao nhất cột đã tính tới.
- **"Xong tới số S"** của một cột tính toán = không còn mục hàng đợi `seq <= S` ở cột đó **và ở mọi cột nó đọc, kể cả gián tiếp** (đệ quy qua `dh_formula_deps`; chuỗi A→B: mục của B chỉ xuất hiện lúc A xong, nên chỉ xét B thì sai). Cột `pending`/`running` mà không có mục nào (làm mới `TODAY()`/`NOW()`) tính là chưa xong với mọi S. Lấy hàng đợi làm nguồn sự thật thay vì so `calc_seq >= S`, vì cột không bị lần ghi S đụng tới thì `calc_seq` không bao giờ lên tới S.
- `datahub.row.list` và `datahub.row.get` nhận `consistent_after=<số>` và `consistent=true` (= `currentChangeSeq` lúc gọi; cả hai thì lấy số lớn hơn). Đợi bằng vòng hỏi cách 25 ms tăng dần tới 250 ms. **Thời gian chờ tối đa mặc định 5.000 ms**, cài đặt `datahub.consistent_wait_ms` (0–60.000, Admin chỉnh). Hết giờ thì vẫn trả giá trị hiện có.
- Kết quả có `consistency: { seq, stale, columns }` chỉ khi người gọi xin tuỳ chọn: ở danh sách là trường cạnh `data`/`next_cursor` (cơ chế `listExtra` của registry, có trong OpenAPI), ở `row.get` là trường của dòng. `columns` là mã các cột chưa xong. Quyền không đổi: người không đọc được bảng nhận `not_found` dù có dùng tuỳ chọn; mã cột trả ra chứ không phải công thức.
- **"Đang tính" theo ô**: mỗi dòng trả về có trường `pending` (mảng mã cột) khi có ô đang tính; không có thì không có trường. Cách tính: cột có mục `full`, cột đang làm mới không có mục, hoặc cột có cột nguồn đang chờ → **mọi dòng** của trang (chưa biết dòng nào đổi); còn lại chỉ các dòng mà hàng đợi nêu (`rows`) hoặc suy ra được (`linked` qua GIN giới hạn trong các dòng của trang, `keys` qua `soe_eqk` giới hạn trong các dòng của trang). Khi có `fields=`, chỉ xét các cột được chọn. Mỗi lần đọc thêm 1–2 truy vấn nhẹ trên `dh_columns`/`dh_change_queue`.
- Thay đổi không qua `applyRowOps` (đổi cấu trúc, xoá/khôi phục cột hoặc bảng, chuyển giao; import ở 2D sẽ theo cách này) đánh dấu cột bằng `markPending` (mục `full` kèm số mới) nên cũng được đợi bằng `consistent=true`, nhưng không trả `seq` (không có lệnh ghi dòng nào để trả).

**Đối soát hằng đêm** (`reconcile.ts`, job `datahub-reconcile` 03:45 giờ Việt Nam; migration `0008` thêm `dh_columns.reconciled_at`)
- Lấy các cột tính toán **đang nghỉ** (`ready`, không có mục hàng đợi, không `TODAY()`/`NOW()` vì chúng đổi hợp lệ theo giờ), thứ tự `reconciled_at` cũ nhất trước (chưa từng đối soát = đầu tiên), tới khi hết **ngân sách 1.000.000 dòng** (tổng số dòng của bảng chứa cột; cột đầu tiên luôn được lấy dù lớn hơn ngân sách). Nhận việc giống worker rồi gọi `recalcColumn` tính **cả cột**; số ô `recalcColumn` phải ghi đổi = số ô lệch. Ghi đúng giá trị là lúc đó đã xong (không đổi `version`, không lịch sử).
- Nếu trong lúc đối soát cột bị ghi (`calc_requested_at` sau mốc nhận việc) thì **không phán xét** (giá trị vẫn được sửa vì tính từ dữ liệu hiện tại, nhưng chênh lệch có thể do lần ghi đó).
- Lệch: `logger.error`, một bản ghi audit `datahub.reconcile` (mã bảng, mã cột, số ô; không giá trị) và sự kiện `datahub.reconcile.mismatch` → thông báo trong ứng dụng cho **mọi Admin** đang hoạt động (số ô, tên cột; không giá trị, không tên bảng, không công thức). Kết quả tính lại của cột đó đi tiếp theo đường thường (sự kiện `changed`, cột phụ thuộc).

**Test và số đo**
- `datahub-partial.test.ts` (chỉ dòng bị ảnh hưởng được tính: làm hỏng tay một ô ở dòng không liên quan, nó phải còn hỏng), `datahub-partial-equivalence.test.ts` (2.500 lần sửa ngẫu nhiên, tính theo phần giống hệt tính cả cột; đổi bằng biến `DH_EQUIV_EDITS`), `datahub-events.test.ts`, `datahub-consistency.test.ts`, `datahub-reconcile.test.ts`, `datahub-queue.test.ts`.
- Sửa một dòng nguồn (đổi cả khoá, số tiền, loại, ngày) ở bảng 100.000 dòng, 6 cột phụ thuộc: ghi 9 ms, worker tính lại 6 cột **43 ms** (trước 2B+: 3,95 s), giao hết sự kiện 0,05 s. Tính lại cả cột 100.000 x 100.000: 2,1–2,7 s mỗi hàm.

**Lệch hoặc bổ sung so với thiết kế**
- Thiết kế nói "mỗi cột nhớ đã tính tới số nào" và đợi theo đó; làm thêm điều kiện đệ quy qua cột nguồn và lấy hàng đợi làm nguồn sự thật (giải thích ở trên). Không đổi hành vi thiết kế mô tả.
- `row.create|update|restore` trả `seq` ngay trong đối tượng dòng (không bọc thêm lớp) để các client cũ không vỡ.

### Stage 2C-1 (danh sách datahub, bảng, grid, sửa dữ liệu, chi tiết dòng, SSE)

Làm theo mục 5.2, 7, 13. Phần 2C-2 (thanh công cụ view), 2C-3 (quản lý cột, công thức), 2C-4 (tìm trùng, chia sẻ, thùng rác, giới hạn Admin) chưa làm; chỗ cắm: `data-slot="view-tools"` trong thanh công cụ của `table-view.tsx`, `TableSession` nhận `query` (lọc, sắp xếp, tìm) khi tạo.

**Thư viện và nền chung**
- Glide Data Grid 6.0.3 (kèm `lodash`, `marked@4`, `react-responsive-carousel`, vì gói khai báo là peer), `sonner` (toast), Radix (dialog, dropdown-menu, tooltip), `@fontsource/be-vietnam-pro`, `@fontsource/roboto`. Phiên bản cố định. Glide khai báo peer React tới 18; chạy được với React 19.3 trong thử nghiệm, nhưng cây truy cập (bảng ẩn cho trình đọc màn hình) không dựng được. Xem "Câu hỏi còn mở".
- Bộ định dạng `vi-VN` dùng chung ở `packages/shared/src/format.ts` (`formatNumber`, `formatCurrency`, `formatPercent`, `formatDate`, `formatDateTime`, `formatRelative`, `formatCount`, hằng `EMPTY = "—"`), có test. Số bỏ nhiễu dấu phẩy động (`0,1 + 0,2` hiện `0,3`), làm tròn nửa ra xa 0 như Excel, không bao giờ hiện `-0`. Ngày chỉ có ngày (`2026-11-18`) hiện nguyên, không đổi múi giờ; mốc thời gian hiện theo giờ Việt Nam. Đọc được cả dạng chuỗi thời gian của Postgres (`2026-11-19 05:14:52.69+07`) mà API đang trả cho `created_at`/`updated_at`.
- Hàm đọc chữ gõ hoặc dán: `parseLocaleNumber` (`156,000,000`, `156.000.000`, `1.234.567,5`, `1,5`, `12.5`; một nhóm đơn như `1.234` là số thập phân, `1,234` là hàng nghìn, khớp với API), `parseLocaleDate`, `parseLocaleDateTime`.
- Font: Be Vietnam Pro (400/500/600/700) tự host; `SoE Number` là chữ số của Roboto qua `unicode-range`, xếp trước. Canvas của grid dùng cùng họ font và đợi font tải xong mới vẽ (`fontsReady`).
- Token mới trong `index.css`: `--ring`, `--selected`, `--calc` (dấu "đang tính"), chín màu nền lựa chọn `--opt-*`. Màu trong canvas lấy từ token qua `lib/theme.ts` (đổi sang `rgb`).
- Thành phần dùng chung mới ở `components/ui`: `skeleton`, `toast` (sonner), `tooltip`, `dropdown` (portal), `states` (rỗng, lỗi có "Thử lại", không có quyền). `Modal` đổi sang Radix Dialog (khoá focus, Esc, nút đóng bằng icon, `dirty` hỏi trước khi đóng); thêm `ConfirmDialog`; `Button` có `loading`, thu nhẹ khi bấm; `Tabs` có `role="tablist"`/`tab`. CSS nền theo CLAUDE.md (không tô khi chạm, `touch-action`, `100dvh`, `viewport-fit=cover`, `prefers-reduced-motion`).

**API thêm (có test phân quyền, OpenAPI, Bruno)**
- `datahub.people.lookup` (GET `/datahub/people`): đổi mã người thành tên (`ids`) hoặc tìm theo tên/email không dấu (`q`). Mọi người có quyền dùng Datahub gọi được; chỉ trả người trong org chart (id, họ tên, email).
- `datahub.relation.labels` (GET `/tables/:table_id/relation-labels`): tên hiển thị của các dòng được liên kết (cột chữ đầu tiên của bảng đích, không có thì `#<mã dòng>`). Người được chia sẻ bảng nguồn thấy tên này (là giá trị trong ô, theo mục 10) nhưng không mở được dòng ở bảng đích.
- `datahub.row.restore_batch` (POST `/tables/:table_id/rows/restore-batch`, tối đa 500): "Hoàn tác" sau khi xoá nhiều dòng. Cần quyền Sửa dữ liệu.

**Cách làm ở giao diện**
- Địa chỉ: `/datahub` (danh sách), `/datahub/:datahubId` (mở bảng đầu), `/datahub/:datahubId/:tableId`. Tham số `view` dành cho 2C-2.
- Danh sách: "Của tôi" và "Được chia sẻ với tôi" (kèm tên chủ và quyền); tạo, đổi tên, xoá vào thùng rác có "Hoàn tác"; hiện `đã dùng / giới hạn`. Tên kiểm tra theo luật mục 2 khi rời ô, lỗi từ server hiện dưới ô.
- Tab bảng: thêm, đổi tên, xoá có "Hoàn tác". **Đổi thứ tự bằng menu "Chuyển sang trái/phải"** (không kéo thả, để làm bằng bàn phím được); vì `position` của server chỉ là số, giao diện ghi lại `0..n-1` theo thứ tự mới.
- **Đọc dòng kiểu cuộn dần, không nhảy:** grid có chỗ cho đủ `total` dòng (đếm một lần ở trang đầu), nạp từng trang 200 dòng bằng con trỏ keyset, nạp tiếp khi cách cuối vùng đã tải dưới 40 dòng. Không có "nhảy tới dòng thứ 80.000" (keyset không cho truy cập ngẫu nhiên); kéo thanh cuộn xuống cuối thì nạp lần lượt các trang trung gian, ô chưa tải hiện trạng thái đang tải. Muốn tới một dòng ở xa thì lọc/sắp xếp/tìm (2C-2). Xem "Câu hỏi còn mở".
- Hiển thị: mọi giá trị qua `displayText` (`lib/datahub/cells.ts`), một chỗ duy nhất cho grid, bản sao chép (Ctrl+C), khung chi tiết, lịch sử. Số, tiền, phần trăm căn phải. Lựa chọn là chip màu, đánh giá là sao vẽ bằng canvas, checkbox của Glide. Cột Người dùng và Người tạo/sửa hiện họ tên (tra theo mã qua `people.lookup`, gom 200 mã một lần, hiện "…" tới khi có). Cột Liên kết hiện tên dòng đích. Cột Đính kèm hiện "N tệp". Cột Mã dòng hiện `#<số dòng>` (xem câu hỏi). Giá trị lỗi công thức (`#DIV/0!`...) chỉ nhận ra ở cột tính toán (ô chữ có nội dung `#N/A` vẫn là chữ), màu `bad`, tooltip giải thích bằng tiếng Việt.
- **"Đang tính":** ô nằm trong `pending` có vòng tròn nhỏ ở góc phải và tooltip "Đang tính lại giá trị này." Trong khi còn ô đang tính ở vùng đang xem, grid hỏi lại các dòng đó cách 2 giây (tối đa 30 lần) phòng khi lỡ tín hiệu SSE.
- **Sửa ô:** chữ, số, tiền, phần trăm, ngày, ngày giờ sửa ngay trong ô (gõ để mở); chọn một/nhiều lựa chọn, đánh giá, người dùng có ô chọn riêng (hiện trong cổng của trang vì Glide cắt khung sửa theo chiều cao ô); checkbox bấm là đổi. Cột công thức, lookup, rollup, số tự tăng, hệ thống chỉ đọc; cột liên kết và đính kèm chỉ xem, cả trong grid lẫn khung chi tiết (cần ô chọn dòng đích và tải file lên; làm ở các phần sau, ghi ở "Câu hỏi còn mở"). Người chỉ có quyền Xem: không có nút thêm/xoá/hoàn tác, ô không mở trình sửa, dán báo "Bạn chỉ có quyền xem bảng này"; server vẫn chặn.
- **Đọc chữ gõ/dán ở máy khách** (`parseCellText`): giúp `dd/mm/yyyy`, `156,000,000`, `1.234,5`, `25%` chạy được và báo đúng ô sai; server vẫn kiểm tra lại mọi kênh. Ở cột Phần trăm, số không có `%` là điểm phần trăm (`12,5` là 12,5%); API vẫn nhận phân số. Dán nhiều ô: một lỗi ở bất kỳ ô nào thì **không ghi gì** và báo dòng, cột đầu tiên sai kèm số ô lỗi còn lại. Một giá trị dán lên vùng đang chọn thì điền cả vùng. Dán xuống dưới dòng cuối thì tạo dòng mới. Dán vào ô công thức/hệ thống thì bỏ qua và báo số ô bỏ qua.
- **Ghi và xung đột:** mọi lần ghi gửi `base` (giá trị đã thấy), nên hai người sửa hai ô khác nhau của một dòng thì gộp; trùng ô thì server trả 409 và giao diện báo `Ô "Tên" ở dòng #3 vừa được người khác sửa. Đã tải giá trị mới, hãy sửa lại.` rồi nạp lại dòng đó, không ghi đè im lặng. Giá trị mới hiện ngay lúc gõ, server trả lời xong thì thay bằng giá trị server (kể cả công thức cùng dòng); lỗi thì trả về giá trị cũ.
- **Hoàn tác / làm lại** (nút và Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y; chỉ trong phiên mở bảng, tối đa 100 bước, mất khi đóng bảng): sửa ô và dán dựa vào `base` nên hoàn tác thất bại (409) nếu ô đã bị người khác sửa tiếp; lỗi thì xoá cả hai ngăn xếp. Thêm dòng hoàn tác bằng xoá, làm lại bằng `restore_batch`. Xoá dòng hoàn tác bằng `restore_batch` và đặt lại dòng đúng vị trí cũ. Đây là hoàn tác phía máy khách trên các lệnh ghi đã có, không đọc lịch sử dòng của server.
- **Xoá dòng:** chọn bằng số dòng bên trái (ô tick hiện khi chỉ vào, cũng bấm được trên cảm ứng), nút "Xoá N dòng" xoá ngay vào thùng rác, không hỏi lại, kèm toast "Hoàn tác" (CLAUDE.md: Hoàn tác thay cho hỏi lại). Phím Delete chỉ xoá nội dung các ô đang chọn.
- **Điền xuống:** kéo núm ở góc ô, hoặc chọn vùng rồi Ctrl+D (điền ngang bằng Ctrl+R để tắt vì trùng tải lại trang). **Sửa hàng loạt:** hộp thoại chọn một cột và một giá trị cho mọi dòng đã chọn.
- **Chi tiết dòng:** khung bên phải (toàn màn hình trên điện thoại): nút "Chi tiết dòng" hoặc Shift+Space. Tab "Dữ liệu": mọi cột, mỗi ô lưu khi rời ô (chữ, số: lỗi hiện ngay dưới ô); tab "Lịch sử thay đổi": ai, lúc nào (tương đối trong 7 ngày, tooltip ngày giờ đầy đủ), qua kênh nào, cũ → mới theo định dạng chung; tải thêm 30 mục một lần.
- **SSE:** `datahub.row.*` và `datahub.formula.recalculated` chỉ là tín hiệu (như thiết kế). Giao diện chờ 250 ms rồi hỏi lại **các dòng đang xem ±10 theo `_id`** và một lần đếm tổng; tổng đổi (người khác thêm/xoá dòng) hoặc có dòng biến mất thì đọc lại từ đầu tối đa 2.000 dòng đã tải. Không bao giờ tải cả bảng. `datahub.structure.changed` làm tải lại định nghĩa bảng và dựng lại phiên làm việc.
- Kích thước: ô 36px, tiêu đề 36px, số dòng ghi ở thanh công cụ: `N dòng`, hoặc `Đã tải X / N dòng` khi chưa tải hết.

**Test**
- `packages/shared/test/format.test.ts`, `apps/web/test/paste.test.ts` (vitest), `apps/api/test/datahub-lookup.test.ts`, `apps/web/e2e/stage2c1.spec.ts` (13 luồng, chạy ở 1280×800 và 375×812; đọc ô của canvas bằng bản sao chép, tìm ô bằng bố cục `data-*` của grid).

- Dữ liệu xấu nhất (`break-ui`) tạo ở tầng dữ liệu, qua API, trong fixture của e2e (`datahub` tên đúng 100 ký tự có `<b>` và `&amp;`, tên cột và tên bảng dài, chủ có tên rất dài, tiền 12.345.678.900 và âm, ghi chú dài, bảng rỗng, 1 dòng, 10.000 dòng); thử tay 100.000 dòng. Không có nút "Demo / Worst case" trong giao diện vì mọi dữ liệu của màn hình này đến từ server; "nút chuyển" chính là mở datahub dữ liệu xấu đã được chia sẻ.
- Đã rà `ui-ux-pro-max` mục 1–3 và 8 (nhãn, lỗi dưới ô và focus về ô lỗi, cỡ chạm 44px trên điện thoại, toast không cướp focus, lối tắt tới nội dung, tương phản bằng token), `break-ui` và bảng "Never Ship" của `mobile-native` (`100dvh`, hover chỉ khi có chuột, ô nhập 16px, vùng an toàn). **Chưa chạy `impeccable audit`** (để Opus khi rà soát) và **chưa thử trên máy thật**: chạm và giữ trong grid canvas, bàn phím ảo che khung chọn, cuộn bằng cảm ứng.

**Lệch hoặc bổ sung so với thiết kế**
- Mục 5.2 (view tự lưu) và 7a chưa có giao diện (2C-2, 2C-4). Mục 7: hoàn tác/làm lại làm ở máy khách chứ không "dựa trên lịch sử dòng" của server (lịch sử dòng chỉ ghi cũ → mới theo cột, không có thao tác đảo ngược an toàn khi dòng đã đổi tiếp).
- Đổi thứ tự bảng bằng menu chứ không kéo thả (đã nêu ở trên).

### Stage 2C-2 (thanh công cụ view, tự lưu, nhảy cuộn, nhóm)

Làm theo mục 5.1–5.4. Phần server đã xong (đọc cửa sổ `offset`/`reverse`, `time_filter`, `row-groups`, `marks`); đây là giao diện và lớp đọc dòng ở máy khách.

**Đọc dòng theo vị trí, không theo con trỏ**
- `RowsStore` (`lib/datahub/rows-store.ts`) viết lại: danh sách `total` vị trí, thưa; mỗi khối 200 dòng là một request theo `offset`. Khối ở nửa sau của danh sách đọc bằng `offset` tính từ cuối + `reverse` để server không phải bỏ qua xa. Chỉ các khối gần màn hình (±30/60 dòng) được đọc, tối đa 2 request cùng lúc, giữ tối đa 40 khối (khoảng 8.000 dòng) trong bộ nhớ, khối xa nhất bị bỏ trước. Request cũ không lặp lại khi người dùng đã kéo đi chỗ khác.
- Kéo thanh cuộn tới đâu cũng chỉ đọc đúng chỗ đó: bảng 100.000 dòng nhảy tới cuối, giữa, 10%… mất 70–120 ms tới khi server trả lời (e2e), đúng cả khi lọc, sắp xếp, nhóm. Trước đây kéo xuống cuối mất 5,8 s.
- Thêm/xoá/khôi phục dòng làm vị trí dịch: giao diện sửa ngay trên dữ liệu đang có rồi đánh dấu mọi khối "cũ" và đọc lại các khối gần màn hình (màn hình giữ dòng cũ tới khi dòng mới về). Dòng mới tạo xếp cuối bảng chỉ khi view không lọc, không sắp, không nhóm, không tìm; còn lại server cho biết vị trí (đọc lại).
- Không còn "Đã tải X / N dòng": luôn là `N dòng`.

**View và tự lưu**
- Cột trong view dùng **key** (đổi tên cột không làm hỏng view). View tạo bằng API hay AI có thể ghi **tên** cột: lúc nạp view, tên được đổi sang key (`normalizeConfig`). Thiết lập trỏ tới cột đã xoá: bỏ qua khi đọc dòng, hiện dải cảnh báo "View này dùng N thiết lập trỏ tới cột đã bị xoá" kèm nút "Xoá khỏi view".
- Mỗi thay đổi hiện ngay và gửi sau 400 ms nghỉ, gộp nhiều thay đổi thành một request, chỉ gửi mục đổi (mục đã bỏ gửi `null`); thay đổi tới trong lúc đang gửi thì gửi tiếp ngay sau đó; server từ chối thì quay về giá trị server và báo lỗi (`ViewAutosave`, có test). Dòng trạng thái "Đang lưu view… / Đã lưu view", thêm "(chỉ cho bạn)" khi người được chia sẻ đổi view chung (server lưu thành bản riêng; menu view có "Về mặc định").
- Địa chỉ giữ view đang chọn qua `?view=<id>`; chọn view gọi `datahub.view.open` (nhớ view cuối). Không có `view` trong địa chỉ: dùng view cuối đã mở, rồi view đầu tiên.
- Tab view: thêm (chủ bảng có thể đánh dấu "View chung"), đổi tên, sao chép, xoá, **chuyển trái/phải bằng menu** (như tab bảng, không kéo thả), "Về mặc định". Mỗi bảng luôn có view chung "Dạng bảng"; thiếu thì giao diện tự tạo view cá nhân.
- Đổi view, bộ lọc, sắp xếp, nhóm, tìm kiếm: tạo **phiên mới** (`TableSession` nhận `SessionQuery`); mất hoàn tác của phiên cũ. Ẩn/hiện/đổi thứ tự/độ rộng/cố định cột, chiều cao dòng, màu **không** tạo phiên mới (không đọc lại dòng). Tìm kiếm chờ 350 ms sau phím cuối; tìm kiếm không lưu vào view (view không có trường này).

**Thanh công cụ** (`view-tools.tsx`, `filter-editor.tsx`; Popover Radix qua cổng, thêm `@radix-ui/react-popover` 1.1.15)
- Thời gian (chỉ khi bảng có cột Ngày/Ngày giờ), Lọc, Sắp xếp, Nhóm, Cột, Dòng, Tô màu, ô Tìm. Nút có số đếm khi đang bật.
- **Lọc:** cây điều kiện lồng nhau (nhóm "tất cả"/"một trong", tối đa 3 tầng). Cột, toán tử, lựa chọn, người đều là danh sách chọn; chỉ chữ, số, ngày là gõ. Điều kiện chưa đủ hoặc sai kiểu **chưa gửi lên server** (không làm hỏng bảng), báo lỗi dưới ô khi rời ô. Phần trăm gõ theo điểm phần trăm (`12,5` = 12,5%) như khi sửa ô. Cột liên kết, đính kèm, mã dòng không lọc được. Một điều kiện không bọc trong nhóm.
- **Sắp xếp:** tối đa 5 cấp, chiều có chữ theo kiểu cột ("Nhỏ → lớn", "Cũ → mới", "Theo thứ tự lựa chọn"), chọn ô trống đầu/cuối (luôn lưu `nulls` rõ). Cột công thức chọn được như cột thường. Cột Nhiều lựa chọn không sắp được.
- **Nhóm:** tối đa 3 cấp; khi có nhóm, dòng được sắp theo cột nhóm trước (ô trống **luôn cuối**, khớp thứ tự danh sách nhóm của server), rồi theo sắp xếp của view. Dòng tổng: mỗi cột chọn Đếm/Tổng/Trung bình/Nhỏ nhất/Lớn nhất (theo kiểu cột). Dòng nhóm vẽ trong canvas: mũi tên mở/đóng, tên giá trị + số dòng, tổng của cột nằm đúng cột (kèm nhãn "Tổng" khi vừa chỗ), tooltip có tên cột đầy đủ. Mở/đóng nhóm bằng bấm vào ô đầu của dòng nhóm hoặc Enter/Space; trạng thái đóng chỉ giữ trong phiên. Quá 1.000 nhóm ở một cấp: chỉ hiện 1.000 nhóm đầu và có dải báo. Không dán/điền qua dòng nhóm; không có dòng "Thêm dòng" cuối bảng khi nhóm (nút "Thêm dòng" trên thanh vẫn dùng được).
- **Cột:** danh sách có ô hiện/ẩn, nút lên/xuống (thay cho kéo thả, bàn phím dùng được) và nút ghim "Cố định đến cột này"; kéo mép tiêu đề đổi độ rộng, kéo tiêu đề đổi chỗ (Glide). Menu của tiêu đề cột (mũi tên ở tiêu đề): sắp xếp, nhóm theo cột, cố định, ẩn. Luôn còn ít nhất một cột hiện.
- **Chiều cao dòng:** Gọn 32 px, Vừa 36 px (mặc định, không lưu), Cao 56 px (chữ xuống tối đa 2 dòng).
- **Tô màu:** tối đa 20 quy tắc, mỗi quy tắc là một bộ lọc đầy đủ + màu (chín màu `--opt-*`); server báo dòng nào khớp (`marks`), dòng khớp nhiều quy tắc lấy màu quy tắc đầu. Quy tắc chưa đủ điều kiện chưa lưu.
- **Thời gian:** theo mục 5.4. Khoảng có sẵn, "N ngày qua", "Một kỳ cụ thể" (tháng, quý, năm tài chính, có ‹ ›), "Từ ngày – đến ngày"; chọn nhiều cột ngày (kể cả Ngày tạo/Ngày sửa của dòng `_created_at`/`_updated_at`); chip phía trên bảng có khoảng ngày cụ thể **do server tính** (`datahub.time_filter.resolve`) và nút ×. Giao diện không tự tính ngày.
- Lọc rỗng: "Không có dòng nào khớp" + nút **Xoá bộ lọc** (bỏ lọc điều kiện, thời gian và từ khoá).

**Test:** `apps/web/test/view-config.test.ts` (query của view, bộ lọc nháp, tên cột, cột ẩn/thứ tự/cố định, tự lưu và bản riêng, bước kỳ, bố cục nhóm), `apps/web/e2e/stage2c2.spec.ts` (10 luồng × 1280 và 375).

**Quyết định của Opus khi rà soát (19/11)**
- Đổi thứ tự tab view bằng menu "Chuyển sang trái/phải" và cố định cột bằng nút ghim "Cố định đến cột này": chấp nhận, khớp quyết định đổi thứ tự tab bảng ở 2C-1; mục 5.1 ghi "hoặc" cho cố định cột.
- Tìm kiếm không lưu theo view (mục 5 không yêu cầu).
- Đóng/mở nhóm chỉ giữ trong phiên; chiều cao dòng Gọn 32 / Vừa 36 / Cao 56 px.

**Nguyên nhân gốc lỗi e2e luồng 100.000 dòng:** Playwright ghi trace vào `apps/web/e2e/results/` trong lúc test chạy; Vite theo dõi cả thư mục đó nên tải lại trang (`[vite] page reload e2e/results/...`), grid biến mất giữa chừng (`.dvn-scroller` null). Không phải lỗi giao diện. Sửa ở gốc: `vite.config.ts` đặt `server.watch.ignored: ["**/e2e/**"]`. Sau sửa: 3 lần `pnpm test:e2e stage2c2` (desktop + phone) đều 20/20 pass, log không còn dòng `page reload`.

**Lệch hoặc bổ sung so với thiết kế**
- Khi có nhóm, ô "Tìm trong bảng" và bộ lọc vẫn tính theo server cho cả số dòng của nhóm.

### Stage 2C-3 (quản lý cột, trình soạn công thức, ô Liên kết và Đính kèm)

Giao diện ở `apps/web/src/pages/datahub/` (`column-editor.tsx`, `column-manager.tsx`, `formula-editor.tsx`, `formula-scope.ts`, `relation-picker.tsx`, `attachment-field.tsx`), logic thuần ở `apps/web/src/lib/datahub/` (`column-config.ts`, `formula-assist.ts`). Máy chủ chỉ thêm ba API đọc; mọi lệnh sửa cột đã có từ 2A/2B.

**API thêm (có test phân quyền, OpenAPI, Bruno)**
- `datahub.relation.search` (GET `/tables/:table_id/relation-search`): tìm dòng của bảng đích để chọn vào ô Liên kết (từ khoá không dấu qua `search`, hoặc số dòng `#12`; phân trang theo `row_no` bằng `after`/`next_after`, tối đa 100 mỗi trang). **Chỉ chủ** datahub (chỉ chủ ghi được ô Liên kết). Nhãn dòng giống `datahub.relation.labels`.
- `datahub.attachment.list` và `datahub.attachment.download_url` (GET `/tables/:table_id/attachments`, `/attachments/:file_id/download-url`): tên, loại, dung lượng và link tải file đang nằm trong ô Đính kèm của một dòng chưa xoá của bảng. Người xem bảng đều đọc được, dù file do người khác tải lên (theo Module 1 mục 4.3: file gắn vào đối tượng thì ai đọc được đối tượng đọc được file; trước đó `file.download.url` chỉ cho người tải lên). File chưa gắn vào ô nào thì không đọc được qua đây. Có ghi audit khi tải.
- **Ô Đính kèm, quyền ghi mã file:** chỉ mã file **mới** của dòng (có trong giá trị mới, không có trong giá trị đang lưu của dòng đó; dòng mới thì mọi mã đều mới) phải là file đã tải xong của chính người ghi (`checkFiles` trong `rows.ts`, chạy sau khi đã đọc dòng cần sửa, áp cho update, create, upsert, batch). Mã đã nằm trong ô thì giữ được: người Sửa thêm file của mình vào ô có file của chủ, chủ gỡ file của người Sửa. Không chép được mã file của người khác (kể cả mã nằm ở dòng khác của cùng bảng); chủ cũng không đưa lại được file của người Sửa vào ô (nó là mã mới với chủ). Khôi phục dòng (`restore`, `restore_batch`) không kiểm vì không thêm mã mới.
- Cột được gọi bằng **mã cột (`key`) hoặc tên**, không phải `id` (uuid): giao diện gửi `key`.

**Quản lý cột**
- Nút "Cột của bảng" (mọi người) mở danh sách cột: chủ có "Sửa", "Xoá", "Thêm cột"; người được chia sẻ thấy danh sách, loại cột và dòng giải thích khoá, không thấy nút nào, không thấy nội dung công thức (server không trả). Nút "Thêm cột" trên thanh công cụ và mục "Sửa cột…", "Xoá cột" ở menu tiêu đề cột chỉ hiện cho chủ. Chạm giới hạn cột (`max_columns` của bảng) thì khoá nút "Thêm cột" và nói rõ.
- Một biểu mẫu cho cả thêm và sửa: tên (kiểm khi rời ô: trống, `[ ]`, dài quá 100, trùng cột khác không phân biệt hoa thường và dấu cách thừa), kiểu (nhóm theo `optgroup`), phần theo kiểu, định dạng hiển thị, mô tả, thuộc tính (bắt buộc, không trùng, mặc định). Lỗi từ máy chủ được dịch (`columnError`) và đặt dưới đúng ô; không có ô thì hiện ở cuối biểu mẫu. Gửi lỗi thì giữ dữ liệu và đưa focus về ô lỗi đầu tiên. Nút Lưu nằm cố định ở đáy hộp thoại để dòng lỗi hiện ra không đẩy nút khỏi tay người dùng.
- Cấu hình theo kiểu: văn bản (độ dài tối đa), số (làm tròn `precision`; hiển thị: số lẻ, dấu chấm hàng nghìn, đơn vị), tiền (đơn vị), phần trăm (số lẻ), đánh giá (số sao 1–10), lựa chọn (tên, màu trong chín màu, thứ tự bằng nút lên/xuống, thêm, xoá; lựa chọn đã lưu giữ nguyên mã nên đổi tên không mất giá trị), đính kèm (số file tối đa), số tự tăng (số bắt đầu), công thức, liên kết, lookup, rollup. Không đưa `date_format` ra giao diện: ngày luôn `dd/mm/yyyy` theo bộ định dạng chung.
- Giá trị mặc định cho các kiểu đọc được bằng `parseCellText` (chữ, số, tiền, phần trăm, ngày, ngày giờ), Có/Không cho checkbox, một lựa chọn bằng danh sách. Không có mặc định cho nhiều lựa chọn, đánh giá, người dùng, liên kết, đính kèm.
- **Đổi kiểu:** chỉ giữa các kiểu ghi được (không công thức, hệ thống, đính kèm). Bấm Lưu thì gọi `type_preview` rồi hiện hộp xác nhận với số ô giữ nguyên, đổi dạng, bị xoá trắng (số do máy chủ đếm) và tới 5 ví dụ ô bị xoá trắng; nút ghi rõ "Đổi kiểu và xoá N ô"; "Giữ lại" không đổi gì. Áp dụng: `type_change` (kèm `accept_data_loss` khi có ô mất), rồi ghi tên, mô tả, thuộc tính, định dạng (vì `type_change` đặt lại định dạng và mặc định).
- **Xoá cột:** vào thùng rác, toast "Hoàn tác" gọi `column.restore`; hộp "Cột của bảng" tự đóng khi xoá (hộp thoại modal chặn bấm vào toast).
- Lookup/Rollup chọn cột Liên kết của bảng này, rồi cột của bảng đích (tải khi chọn); Rollup bỏ Tổng/Trung bình khi cột đích không phải số. Liên kết chọn bảng của **mọi datahub của cùng chủ** (Datahub → Bảng, như trình soạn công thức); `relation.labels` và `relation.search` đọc theo chủ datahub chứa bảng nguồn, không bao giờ đọc bảng của người khác (tạo cột hoặc ghi dòng liên kết tới bảng người khác bị từ chối); không đổi được bảng đích của cột có sẵn.

**Trình soạn công thức (mục 6.3)**
- Ô nhập tự cao theo chữ; lớp chữ trong suốt phía sau gạch chân gợn sóng đúng đoạn máy chủ báo lỗi (`segments`, vị trí tính cho văn bản gửi đi, có `=`), kèm danh sách lỗi bằng lời. Gợi ý nằm trong dòng chảy của biểu mẫu (không nổi) để không bị khung cuộn cắt: gõ `[` gợi ý cột của bảng này, bảng cùng datahub, datahub khác; sau `[Bảng].[` gợi ý cột (tải cột của bảng đích khi cần); sau `[Datahub].[Bảng].[` cũng vậy; gõ tên hàm gợi ý hàm. Lên/xuống chọn, Enter hoặc Tab chèn, Esc đóng; không gợi ý trong chuỗi `"..."`.
- Dòng cú pháp của hàm đang gõ (`activeCall` bỏ qua chuỗi và `[ ]`), tham số đang nhập in đậm; kèm mô tả và ví dụ lấy từ `datahub.formula.functions`.
- Xem trước 5 dòng đầu sau 500 ms, từ `datahub.formula.preview` (lỗi hiện đúng câu giải thích của máy chủ); đổi kiểu kết quả bằng danh sách "Tự nhận biết" hoặc kiểu cụ thể. Giá trị xem trước qua bộ định dạng chung.
- Ba nút: "Chèn hàm" (tìm và nhóm theo loại), "Chèn cột hoặc bảng" (ba danh sách Datahub → Bảng → Cột, hiện đúng chữ sẽ chèn và nghĩa của nó), "Công thức mẫu" (10 mẫu, mỗi chỗ trống là một danh sách tự sinh từ cột và bảng thật, mặc định chọn cột đầu tiên hợp kiểu; "Dùng mẫu này" hoặc "Thay công thức bằng mẫu này").
- `Popover` dùng chung có thêm `fixedSide` (không đổi phía khi nội dung dài ra) và `pointer-events: auto`: mở từ trong hộp thoại modal thì Radix đặt `pointer-events: none` ngoài hộp, nên nút trong popover không bấm được.

**Ô Liên kết và Đính kèm**
- Ô Liên kết sửa được trong grid (Enter hoặc bấm đôi mở ô chọn) và trong khung chi tiết dòng ("Chọn dòng"). Ô chọn tìm ở máy chủ (sau 250 ms), danh sách ảo hoá (mỗi dòng 40px, chỉ vẽ phần nhìn thấy, đọc tiếp trang khi cuộn gần cuối), đang chọn hiện thành chip có nút bỏ; một liên kết thì bấm là xong, nhiều liên kết thì "Xong". Chỉ chủ; người Sửa dữ liệu thấy lý do bằng lời và không có nút.
- Ô Đính kèm: người Sửa dữ liệu tải file (bảng "Tải file lên", chọn nhiều file) theo cơ chế Stage 0 (`file.upload.init` → PUT → `file.upload.complete`), gỡ file khỏi ô, tải về; người Xem chỉ tải về. Ô chỉ đổi sau khi từng file tải xong. Lỗi bằng lời: loại file không nhận, quá lớn, hết dung lượng, vượt số file. Địa chỉ ký của driver local được đổi thành cùng origin (`storageAddress`); PUT **không gửi cookie** (`credentials: "omit"`), nếu có cookie thì API đòi header CSRF và trả 403.
- Dán, gõ, Delete và Sửa hàng loạt bỏ qua ô Liên kết và Đính kèm (`readOnlyReason` có lý do mới: "Chọn dòng liên kết trong ô…", "Tải file lên trong ô…"); `pickerEditable` quyết ô nào có ô chọn.

**Test**
- Máy chủ: `apps/api/test/datahub-column-ui.test.ts` (tìm dòng đích, phân trang, ký tự `%`, người Sửa bị chặn; liên kết sang datahub khác của chủ, bảng của chủ khác bị từ chối; quyền ghi mã file mới (update, create, upsert, restore, mã lạ); file chỉ mở qua bảng, người xem đọc được file của người khác, gỡ khỏi dòng thì đóng; mọi lệnh cấu trúc bị chặn với người Sửa, công thức bị giấu).
- Web: `apps/web/test/column-config.test.ts`, `apps/web/test/formula-assist.test.ts`; e2e `apps/web/e2e/stage2c3.spec.ts` (6 luồng, chỉ desktop; phone dời sang 2E).

**Lệch hoặc bổ sung so với thiết kế**
- Gợi ý và danh sách tham chiếu không có tên bảng/cột của datahub **người khác** chia sẻ (luật 6.4).
- Không có kéo-thả đổi thứ tự cột trong danh sách (thứ tự cột hiển thị do view, mục 5.1; `position` của cột chưa có giao diện đổi).
- Menu tiêu đề cột "Sửa cột…", "Xoá cột" chưa có e2e (tiêu đề vẽ trên canvas); dùng "Cột của bảng" trong test.

## Stage 2C-4 (Tìm dòng trùng, Chia sẻ, Thùng rác, giới hạn Admin)

**Tìm dòng trùng (mục 7a)**
- Server (`apps/api/src/modules/datahub/duplicates.ts`): `datahub.row.duplicates` (xem nhóm) và `datahub.row.duplicates.resolve` (xử lý). Khoá so là giá trị các cột đã chọn, chuẩn hoá bằng `soe_unaccent`, hoa thường, gộp khoảng trắng. Dòng có mọi cột khoá trống không có khoá nên không bao giờ tính là trùng. Tối đa 5 cột khoá. Một số liệu một nơi tính: giao diện chỉ đọc `total_groups`, `total_rows` của server (trừ số nhóm đã xử lý trong phiên ở máy khách để số hiện đúng ngay).
- `resolve` với `all`: mỗi lần tối đa 1.000 nhóm, bỏ qua nhóm trên 2.000 dòng (báo "còn N nhóm lớn chưa xử lý"); giao diện gọi lặp tới khi hết hoặc không xử lý thêm được. Không gộp cột Đính kèm. Dòng bị xoá vào Thùng rác (khôi phục được).
- Giao diện (`duplicates-dialog.tsx`): nút "Tìm dòng trùng" ở thanh công cụ view, chỉ khi `access` là `owner` hoặc `edit_data`; chọn 1 đến 5 cột; mỗi nhóm là một bảng nhỏ chọn dòng giữ (radio), tuỳ chọn "Gộp giá trị vào dòng giữ" (bấm ô của dòng khác để lấy giá trị), hoặc "Xử lý mọi nhóm" (giữ dòng đầu / cuối / nhiều ô nhập nhất, điền ô trống). Nhóm hơn 50 dòng chỉ hiện 50 dòng đầu và chỉ xử lý được bằng "Xử lý mọi nhóm" (nút xoá từng nhóm bị khoá, tránh xoá nhầm dòng không thấy).
- Phân trang "Tải thêm nhóm": trang đầu là `useQuery`, các trang sau thêm bằng nút; offset = số nhóm đang hiện (nhóm đã xử lý biến mất ở server nên không cộng thêm); xử lý xong một nhóm thì ẩn nhóm đó, không tải lại cả danh sách (tránh nhảy offset).

**Chia sẻ (mục 10)**
- Nút "Chia sẻ" ở đầu trang datahub, chỉ chủ thấy (`ShareDialog`, `share-dialog.tsx`). Chọn người bằng ô tìm (`datahub.people.lookup` theo `q`, gõ tên hoặc email) rồi bấm chọn trong danh sách kết quả; không có ô gõ email tự do, nên không chia sẻ được cho người ngoài org chart. Phạm vi: "Cả datahub (kể cả bảng tạo sau)" hoặc "Chỉ bảng: <tên>"; quyền Xem / Sửa dữ liệu. Danh sách "Đang chia sẻ" có đổi quyền ngay trong dòng và "Thu hồi". Chủ không thấy chính mình trong kết quả.
- Người nhận chỉ có Xem thì không thấy "Tìm dòng trùng", "Thùng rác"; người Sửa thấy hai nút này nhưng không thấy "Thêm cột" (cấu trúc là của chủ). Quyền do server kiểm; giao diện chỉ ẩn nút.
- Thu hồi lúc người kia đang mở trang: trang của họ nhận 403/404 ở lần tải kế tiếp và hiện trạng thái "không mở được" (không xử lý thêm).

**Thùng rác (mục 12)**
- Trang `/datahub/thung-rac` (`TrashPage`, `trash.tsx`; liên kết "Thùng rác" ở đầu trang danh sách): datahub và bảng đã xoá của chủ, kèm lúc xoá và "Xoá hẳn <ngày>" (`purge_at`, tooltip có giờ và số ngày giữ). Hộp thoại "Thùng rác của bảng" (nút "Thùng rác" ở thanh công cụ view, cho chủ và người Sửa): dòng đã xoá (tối đa 500 mới nhất, ghi rõ khi bị cắt) và cột đã xoá (chỉ chủ; server chỉ trả cột cho chủ).
- Khôi phục: gọi `*.restore`; server trả `conflict` với `details.reason = "duplicate_name"` khi tên bị dùng, giao diện mở hộp "Tên … đã bị dùng" để đặt tên mới rồi gọi lại với `name`. Lỗi khác hiện dưới nút. Khôi phục cột dùng `key` làm mã cột. `datahub.restore` và `table.restore` ở API web nhận thêm `name` tuỳ chọn.
- Dòng trong thùng rác chỉ hiện `#số dòng` và lúc xoá (server không trả nội dung dòng đã xoá).

**Giới hạn Admin theo người (mục 11)**
- Trang `/quan-tri/datahub-gioi-han` (`DatahubLimitsPage` trong `pages/admin.tsx`, mục menu "Giới hạn Datahub", cần `system:setting:write`). Chọn người (cùng `PersonPicker` của trang Chuyển giao), nhập số datahub / bảng mỗi datahub / cột mỗi bảng; ô trống = dùng mặc định (gửi `null`). Kiểm số nguyên từ 1, trần 1.000 và cột 200 ngay ở form bằng tiếng Việt trước khi hỏi server. "Về mặc định" xoá mọi giới hạn riêng của người đó. Bảng "Đã đặt giới hạn riêng" liệt kê và có nút Sửa. Giới hạn chung vẫn ở Cài đặt hệ thống. `form.table_max_columns` chưa làm (Module 7 chưa code).

**Test**
- Máy chủ: `apps/api/test/datahub-duplicates.test.ts` (6). Web: `apps/web/test/duplicates.test.ts` (5). e2e `apps/web/e2e/stage2c4.spec.ts` (4 luồng, chỉ desktop): chia sẻ Xem + Sửa một bảng, quyền thực tế (403 khi ghi/đổi cấu trúc, bảng ngoài phạm vi đóng), đổi quyền, thu hồi; tìm trùng (từng nhóm, mọi nhóm, tên có `<b>`); thùng rác (dòng, cột, bảng, datahub, trùng tên hỏi tên mới); Admin đổi giới hạn rồi giới hạn có tác dụng và về mặc định. 403/404 sau thu hồi và 409 của khôi phục trùng tên được `Session.allow` trong spec vì là phản hồi dự kiến.

**Lệch hoặc bổ sung so với thiết kế**
- Chia sẻ chỉ tìm người theo `q` (cần gõ ít nhất một ký tự); chưa có danh sách "gợi ý theo team".
- Thùng rác của bảng không hiện nội dung dòng đã xoá; chưa có "xoá hẳn ngay" (chỉ chờ quá hạn).

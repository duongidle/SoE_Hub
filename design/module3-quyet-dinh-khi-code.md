# Module 3 — Quyết định khi code

> Ghi các quyết định nhỏ và mọi chỗ lệch so với `module3-metric-dashboard.md` trong lúc code. Mỗi mục theo bước con.

## Stage 3A-1: engine metric lõi (server)

### Cấu trúc

- `packages/db/src/schema/metrics.ts`, migration `0010_metrics.sql`: `mt_sources` (nguồn dữ liệu), `mt_metrics` (chỉ số), `mt_dashboards`, `mt_charts` (tạo sẵn cho 3C, chưa có API). Mọi bảng thuộc một datahub (`datahub_id`, xoá cascade theo datahub), có cột chuẩn (xoá mềm, `version`), tên không trùng trong datahub khi còn sống (`name_norm`). JSON người dùng viết nằm ở `config`; `table_ids` (uuid[]) liệt kê các bảng định nghĩa đọc, để người chỉ được chia sẻ một bảng chỉ thấy định nghĩa dùng bảng đó.
- `packages/metrics` (thuần, không tự chạy SQL): `schema.ts` (JSON + Zod chặt), `columns.ts` (kiểu giá trị và biểu thức SQL), `time.ts` (nhóm thời gian, khoảng tương đối), `build.ts` (JSON → một câu SQL, chẩn đoán ghép). `apps/api/src/modules/metrics/`: `context.ts` (tìm bảng, quyền, đổi cột Datahub thành cột metric), `engine.ts` (chạy), `ops.ts` (registry).
- Đăng ký `registerOwnedTable` cho bốn bảng `mt_*`; mọi truy vấn có dấu `/*scope*/` sau khi kiểm quyền datahub.

### Phạm vi dữ liệu và quyền

- Câu SQL của chỉ số đọc `dh_rows` qua `TableAccess.scope(alias)` của bảng chính và của từng bảng ghép (không viết luật quyền mới). Người gọi phải có ít nhất quyền Xem trên mọi bảng chỉ số đọc; thiếu thì `not_found` (không lộ sự tồn tại). Leader, Manager, Admin, Guest không được chia sẻ thì không có gì.
- Chỉ chủ datahub tạo/sửa/xoá chỉ số và nguồn (`loadDatahubAccess(..., "owner")`). Người được chia sẻ (Xem hay Sửa dữ liệu) đọc định nghĩa và gọi `metrics.query` trong phạm vi của mình. Luật chia sẻ dashboard "tính bằng quyền chủ" là 3C-2, chưa làm.
- Quyền dùng chuỗi `datahub:datahub:use` (không thêm quyền mới); `aiAllowed: true`.
- Chỉ ghép bảng trong cùng datahub (`cross_datahub` nếu khác). Không tham chiếu datahub khác.

### Chỉ số JSON

- `source` là chuỗi (mã/tên nguồn đã lưu, hoặc mã/tên bảng) hoặc nguồn viết tại chỗ `{table, joins}`. Gọi bằng tên thì cần `datahub_id`.
- `measure`: `count` (không cần cột; có cột thì đếm ô có giá trị; checkbox đếm ô tích; text bỏ ô rỗng), `count_distinct` (text chuẩn hoá: bỏ dấu, không phân biệt hoa thường, bỏ khoảng trắng), `sum`, `avg`, `min`, `max`, `median`, `percentile` (`p` 0–100, viết tắt `p25`, `p75`, `p90`, `p37.5`...), `trimmed_mean` (`trim` mỗi đầu, mặc định 0,1; bỏ `floor(trim × n)` giá trị mỗi đầu), `stddev` (mẫu), `stddev_pop`.
- Phân vị và trung vị là phân vị **nội suy** (`percentile_cont`, giống `PERCENTILE.INC` của Excel). Ép sang `float8` nên số lớn hơn 2^53 mất chính xác ở các chữ số cuối; `sum`, `avg`, `min`, `max` tính bằng `numeric`.
- Cột công thức/lookup/rollup tính như kiểu kết quả của nó (cột công thức số = số). Cột văn bản **không** cộng, không trung bình được: lỗi `bad_measure` kèm các kiểu cột dùng được. Cột nhiều giá trị (nhiều lựa chọn, liên kết, đính kèm) chỉ đếm và lọc, không nhóm, không đếm không trùng.
- Trường chuẩn của dòng dùng được ở bảng chính: `_row_no`, `_created_at`, `_updated_at` (và cột kiểu Ngày tạo/Ngày sửa của bảng).
- Giá trị trả về: số thành số JS (cộng số lớn hơn 2^53 mất chính xác), ngày thành `YYYY-MM-DD`, ngày giờ thành ISO UTC. Máy chủ không làm tròn.
- JSON sai trả `validation_error` với `details.reason` (`invalid_json` kèm `issues`, `unknown_column` kèm `available`, `bad_measure`, `bad_group`, `bad_time`, `bad_join`, `bad_collapse`, `unsupported_column`, `unknown_option`, `join_table_not_found`, `cross_datahub`, `datahub_required`, `name_required`, `metric_required`, `source_required`). Không thêm mã lỗi mới trong `ERROR_CODES`.

### Lọc

- Dùng nguyên cú pháp lọc của Module 0 và bộ dịch `compileFilter` của `@soe/db`: cột gọi bằng tên hoặc mã, lựa chọn gọi bằng tên (không phân biệt hoa thường), `eq null` thành `is_empty`. Cột ở bảng ghép gọi `Bí danh.Tên cột`. Lọc của chỉ số và lọc của lời gọi được AND với nhau.

### Thời gian

- Nhóm: `day`, `week` (bắt đầu thứ Hai), `month`, `quarter`, `year`, theo **giờ Việt Nam** (ngày giờ đổi sang `Asia/Ho_Chi_Minh` trước khi cắt kỳ). Cột Ngày dùng ngày của nó. Mỗi nhóm trả `value` (ngày đầu kỳ `YYYY-MM-DD`) và `label` (`2026-11`, `Q4/2026`, `2026`).
- Quý và năm theo **cài đặt hệ thống có sẵn** `datahub.fiscal_start_month` (mặc định 1), dùng chung với ô Thời gian của Datahub, không thêm cài đặt mới. Năm tài chính mang số năm của tháng bắt đầu (cùng quy ước Module 2).
- Khoảng thời gian (`time.range`): cùng định dạng ô Thời gian của Datahub (`preset`, `period`, `between`; viết tắt bằng chuỗi như `"this_month"`) và thêm `{kind:"last_n_months", n}` (n tháng tính cả tháng này, đến hết tháng này). Khoảng tính một lần theo ngày hôm nay giờ Việt Nam lúc gọi; kết quả trả `diagnostics.range` (ngày thật).
- Phần "nhận ngày giờ thành bộ lọc" tách thành `dateRangeNode` trong `packages/shared/src/time-filter.ts`; ô Thời gian của Datahub (`apps/api/.../datahub/time-filter.ts`) dùng lại hàm đó (đã chạy lại test Datahub).

### Ghép bảng

- Theo cột Liên kết (`link`, ưu tiên) hoặc cặp cột khoá (`on`, tối đa 3 cặp, so khớp sau khi chuẩn hoá: bỏ dấu, không phân biệt hoa thường, bỏ khoảng trắng thừa; khoá rỗng không khớp). Ghép kiểu **left** (Opus đổi 19/11 khi rà 3A-1, làm ở 3A-2): dòng bảng chính không có đối tác vẫn vào số liệu (cột của bảng ghép là rỗng); ghép thêm bảng không bao giờ làm đổi số đo trên cột của bảng chính. Dòng không khớp vẫn được báo ở chẩn đoán (`matched`, `unmatched`) và 0 khớp vẫn là lỗi `join_no_match`. Lọc hay đo trên cột của bảng ghép tự loại các dòng rỗng đó như mọi ô rỗng.
- **Gom trước luôn luôn, không chờ phát hiện trùng.** Mỗi cột của bảng ghép được dùng trong chỉ số/lọc/nhóm được gom về **một** giá trị cho mỗi dòng bảng chính trước khi ghép (mặc định: số cộng, checkbox "có", còn lại nhỏ nhất; đổi bằng `collapse` theo cột: sum, avg, min, max, count, first, last). Lý do: kết quả không phụ thuộc dữ liệu hiện có trùng hay không, nên không bao giờ nhân đôi số, và chỉ có một đường mã. Lệch nhỏ so với thiết kế: thiết kế viết "khoá trùng thì gom trước"; đây gom luôn (khi không trùng, mỗi nhóm một dòng nên kết quả giống ghép thẳng). Cột được gom đổi kiểu theo phép (sum/avg/count ra số).
- Cột kiểu nhiều giá trị và trường chuẩn của dòng không dùng được ở bảng ghép (`unsupported_column`).
- **Chẩn đoán trả về mọi lần** (`diagnostics.joins[]`): `base_total`, `matched`, `unmatched`, `empty_key`, `duplicate_groups`, `duplicate_rows`, `duplicate_sample`, `folded`. Tính trên toàn bảng chính trong phạm vi người gọi, không tính bộ lọc của chỉ số. Ghép liên kết: `duplicate_*` là số dòng bảng chính có hơn một liên kết. `matched = 0` khi bảng chính có dòng → lỗi `join_no_match` kèm chẩn đoán và gợi ý. Danh sách dòng không khớp: `metrics.source.unmatched` (mã dòng + số dòng, phân trang `limit`/`offset`, tối đa 500). Chi phí: thêm một truy vấn chẩn đoán cho mỗi phép ghép (3A-2 sẽ cache).
- Tối đa 5 phép ghép mỗi nguồn; bí danh không trùng nhau.

### API

- Query dùng GET (quy ước registry), tham số JSON gửi dạng chuỗi JSON: `GET /api/v1/metric-query`. Đường dẫn tĩnh `metric-query`, `metric-source-diagnosis`, `metric-source-unmatched` để không đụng đường dẫn có tham số. Danh sách chỉ số/nguồn trả đủ (không phân trang) vì ít.
- Sửa dùng `version` (lệch thì `conflict`). Xoá là xoá mềm; chưa có thao tác khôi phục (làm cùng thùng rác ở 3C).
- Không giới hạn số chỉ số mỗi datahub ở bước này.
- `limit` nhóm mặc định 1000, tối đa 5000; nhiều hơn thì `truncated: true`.

### Để sẵn chỗ cho các bước sau (chưa làm)

- 3A-2: `MetricDefSchema` là `strictObject` để thêm `formula`, so sánh kỳ, luỹ kế, cohort, mục tiêu, outlier bằng `.extend` / thêm khoá; `buildMetricQuery` trả `Built` (SQL + mô tả nhóm), chỗ cắm cache là `runMetric` (khoá = chỉ số + tham số + phạm vi dữ liệu); `statement_timeout`, giới hạn đồng thời và gộp yêu cầu trùng bọc quanh `ctx.db.execute(built.sql)`.
- Stage 4: tham số snapshot (nguồn đọc bảng snapshot thay `dh_rows`) cắm vào `PlanInput`/`MTable.scope`; "team tại thời điểm" thành nguồn cột như `PhysicalSource`.
- Bảng gộp (3B): chỉ là một bảng mới nên dùng được làm nguồn mà không đổi engine.

### Số đo (máy dev, 100.000 dòng, `metrics-perf.test.ts`)

- Tổng doanh thu theo tháng × một cột chọn (198 nhóm): 124 ms (SQL 120 ms), mục tiêu < 1 s.
- Từng phép tổng hợp không nhóm / nhóm theo tháng: count 15/83 ms; count_distinct 235/264 ms; avg 21/97 ms; median 45/108 ms; p90 42/103 ms; trimmed_mean 157/178 ms; stddev 28/102 ms.
- Ghép theo khoá 100.000 × 100.000 dòng, tổng theo năm: 1.655 ms (SQL 930 ms + chẩn đoán). Vượt 1 s; để 3A-2 (cache) và 3D (load test) xử lý, hoặc dùng cột Liên kết / bảng gộp.

### Sửa lại 3A-1: đọc cột qua nguồn cột (Điều chỉnh mục 1, 19/11)

- `ColumnSource` có thêm `cellExpr(col, data, as)` (`as` = `"text"` cho `->>`, `"json"` cho `->`; `data` là biểu thức SQL của object dữ liệu của dòng: `b.data`, `j1.data`). `JsonbSource` sinh đúng `<data>->>'key'` như cũ; `PhysicalSource`/`PersonalSource` vẫn ném lỗi "Stage 4". `readExpr` giữ nguyên (list/get, `fields=` không đổi, không có chỗ gọi nào phải sửa).
- `MColumn.read?` (`packages/metrics/src/columns.ts`): API điền từ `sourceOf(col).cellExpr` trong `toMColumn`; `valueExpr` dùng nó. Không có `read` (test thuần của package) thì đọc JSONB dưới `key` như trước. Package `metrics` không biết dữ liệu nằm ở đâu.
- Cột công thức: vẫn đọc giá trị lưu (`->>`), không dùng chỗ chuyển lỗi ô như `readExpr` (metric bỏ ô lỗi như ô rỗng, như 3A-1).
- Test: `packages/metrics/test/build.test.ts` (`MColumn.read` giả, SQL dùng biểu thức đó); test 3A-1 pass nguyên.

## Stage 3A-2: engine metric nâng cao (server), mục 1–3 (phiên 19/11)

Phần còn lại của 3A-2 (mục 4–9) chưa làm.

### Chỉ số phái sinh (Module 3 mục 5.2)

- `{ name, formula: "=[A] / [B]" }`, không có `source`/`measure`/`cohort`/`cumulative`/`outliers`, không có `time.field` (schema từ chối). `[Tên chỉ số]` là chỉ số đã lưu cùng datahub (tên không phân biệt hoa thường); chỉ một thành phần (`[Bảng].[Cột]` bị từ chối `bad_formula`). Công thức chạy bằng `evaluate` của `@soe/formula` (đủ hàm kiểu Excel); `packages/metrics/src/post.ts`: `parseDerived` đổi `[Tên]` thành khoá `m0, m1...`, `combineDerived` tính theo từng nhóm.
- Chạy: mỗi chỉ số được tham chiếu chạy đầy đủ (mọi tuỳ chọn của nó) với `time.range`, `time.bucket`, `group_by`, `filter` của chỉ số phái sinh / của lời gọi đè lên (mỗi chỉ số giữ `time.field` của mình); rồi gộp theo khoá nhóm. Nhóm mà một chỉ số không có dòng thì chỉ số đó coi là rỗng (0 trong phép tính, như bảng tính). Lỗi công thức (`#DIV/0!`, `#VALUE!`...) nằm ở `rows[].error`, `value = null`; không làm hỏng cả câu trả lời. `count` của dòng = lớn nhất trong các chỉ số.
- Lồng tối đa 5 tầng (`formula_too_deep`), vòng tròn báo `formula_cycle` kèm chuỗi tên (kiểm lúc lưu và lúc chạy), chỉ số không có hoặc người gọi không đọc được các bảng của nó báo `unknown_metric` kèm danh sách chỉ số có thật (`available`). `table_ids` của chỉ số phái sinh = hợp các bảng các chỉ số nó đọc, nên người chỉ được chia sẻ một bảng không thấy và không tính được chỉ số phái sinh đọc bảng khác.
- Chỉ số phái sinh cần `datahub_id` khi gọi tại chỗ (`datahub_required`). So kỳ, mục tiêu dùng được; cộng dồn không (tỉ số cộng dồn vô nghĩa, `bad_cumulative`). Lệch nhỏ so với thiết kế: thiết kế không nói tới cột ngày của chỉ số phái sinh; chốt như trên để một bộ `time` của lời gọi áp được cho các chỉ số dùng cột ngày khác nhau.

### Thời gian (mục 5.3)

- **So sánh** `compare: "previous_period" | "year_ago"` (đặt trong chỉ số hoặc tham số `compare`, `none` tắt cái đã lưu). Cần `time.range` (`bad_compare`). `year_ago`: cùng các ngày lùi 12 tháng. `previous_period`: khoảng gồm cả tháng thì lùi đúng số tháng đó (tháng này → tháng trước, quý → quý trước); khoảng khác lùi bằng độ dài của nó theo ngày (`shiftRange`, `packages/metrics/src/time.ts`). Kỳ trước chạy cùng câu SQL với khoảng ngày dịch; **ngày của dòng được dịch tới kỳ hiện tại trước khi cắt kỳ** (`+ interval`) nên khoá nhóm hai bên khớp nhau (không phải so theo vị trí). Mỗi dòng có `previous`, `change`, `change_pct` (tỉ số 0,25 = +25%; `null` khi kỳ trước bằng 0 hoặc trống); nhóm chỉ có ở kỳ trước vẫn hiện (value null). `diagnostics.compare` ghi ngày thật của kỳ trước. 29/2 lùi một năm rơi vào 28/2.
- **Luỹ kế** `cumulative`: chỉ `count` và `sum`, cần `time.field` + `time.bucket` (`bad_cumulative`); cộng dồn riêng cho từng tổ hợp nhóm còn lại, theo thứ tự thời gian; ép `order = group`, `limit = 5000`, nhiều nhóm hơn thì lỗi `too_many_groups` (cộng dồn trên nhóm bị cắt sẽ sai). Kỳ không có dòng nào không được điền (chưa vẽ đường liên tục: việc của biểu đồ ở 3C). Kết hợp được với `compare` (cộng dồn từng chuỗi rồi mới ghép).
- **Cohort** `cohort: { start, event, bucket (mặc định month), mature_after?, max_offset? }`: nhóm theo kỳ của `start` và số kỳ từ `start` tới `event` (cột `Kỳ sau <start>`, 0 = cùng kỳ), rồi `group_by` nếu có; dùng được mọi phép đo. Dòng không có `event` không nằm trong ma trận; dòng có `event` trước `start` (kỳ âm) bị bỏ. `mature_after: n` chỉ giữ cohort có kỳ bắt đầu cách kỳ hôm nay ít nhất n kỳ. `time.range` (trên `time.field`) vẫn lọc dòng. Trả thêm `cohort_sizes` (số dòng mỗi cohort, kể cả dòng chưa có `event`, cùng điều kiện lọc/trưởng thành) để biến số đếm thành tỉ lệ. Không dùng với compare/cumulative/target. Chỉ số kỳ (`periodIndex`): ngày, tuần từ thứ Hai, tháng, quý/năm theo năm tài chính.

### Mục tiêu và giá trị ngoại lai (mục 5.4)

- **Mục tiêu** `target`: `{ value }` (hằng số) hoặc `{ table, value_field, period_field?, by? }` (bảng cùng datahub, gọi bằng tên hoặc mã; người gọi phải đọc được bảng đó: `not_found`). Bảng mục tiêu đọc bằng chính engine (tổng `value_field` theo kỳ của `period_field` khi chỉ số có `time.bucket`, và theo các cột `by`), rồi ghép theo khoá: kỳ theo ngày đầu kỳ, các cột nhóm theo **nhãn không phân biệt hoa thường và dấu** (hai dòng "POD" và "Pod" cộng chung một mục tiêu). Mỗi nhóm của chỉ số phải có cột tương ứng trong `by` (`bad_target`), có `time.bucket` thì phải có `period_field`. Chỉ số không nhóm theo kỳ mà có `time.range` thì mục tiêu là tổng các kỳ trong khoảng đó. Mỗi dòng có `target`, `achieved` (tỉ số 0,85 = 85%, null khi mục tiêu trống hoặc 0), `gap` (mục tiêu − giá trị, âm khi vượt); nhóm không có dòng mục tiêu thì `null`. Kiểm lúc lưu chỉ số. Mục tiêu thêm bảng mục tiêu vào `table_ids` của chỉ số.
- **Outlier** `outliers: { mode: include | exclude | separate, k (1,5) }`: cần phép đo có `field` là cột số (`bad_outliers`). Q1, Q3 tính trên **toàn bộ dòng sau lọc và khoảng thời gian** (không theo nhóm, không theo kỳ), bằng `percentile_cont` (cùng cách phân vị của 5.1); khoảng `[Q1 − k·IQR, Q3 + k·IQR]`, biên trong khoảng được giữ. `include`: số liệu như thường, báo `diagnostics.outliers` (`q1, q3, iqr, k, lower, upper, n`); `exclude`: bỏ dòng ngoài khoảng; `separate`: số liệu của dòng trong khoảng, thêm `outlier_rows` cho dòng ngoài khoảng. Dưới 4 giá trị thì không có khoảng (`diagnostics.outliers = null`, không loại gì). Ô trống không bị coi là ngoại lai. Thêm một câu SQL (quartile) khi dùng outlier.

### Chỗ cắm và API

- `runDefinition` (engine.ts) là điểm vào đầy đủ (phái sinh, luỹ kế, so kỳ, mục tiêu); `runMetric` vẫn là một chỉ số trên một nguồn (kèm outlier, cohort, `shift`). Bước 4 (cache, gộp yêu cầu trùng, giới hạn đồng thời, `statement_timeout`) bọc quanh `ctx.db.execute` của các câu SQL lá trong `runMetric`/`rowsOf` và quanh `runDefinition`.
- `metrics.query` thêm tham số `compare`, `cumulative`, `target`, `outliers`; trả thêm `metric.formula`. OpenAPI mô tả tự sinh từ registry; request Bruno làm ở mục 7.
- `QueryOverridesSchema` đã có sẵn các khoá này từ commit WIP.

### Test

- `packages/metrics/test/post.test.ts` (unit thuần: `shiftRange`, `parseDerived`, `combineDerived`, `cumulate`, `compareTables`, `attachTarget`, `iqrBounds`, SQL của shift/cohort/outlier). `apps/api/test/metrics-advanced.test.ts` (27 test so với tính tay bằng JavaScript trên cùng dữ liệu; gồm phân quyền: người ngoài, người chỉ được chia sẻ một bảng, bảng mục tiêu không đọc được).

## Stage 3A-2: chịu tải và xoá cache (mục 4–5, phiên Sonnet B, 19/11)

### Một cửa chạy câu SQL: `apps/api/src/modules/metrics/runner.ts`

- Mọi câu SQL lấy dữ liệu của engine (câu gom nhóm, chẩn đoán ghép, tứ phân vị outlier, cỡ cohort, bảng mục tiêu, danh sách dòng không khớp) đi qua **`runSql(ctx, sql, tables)`**; `ctx.db.execute` chỉ còn dùng cho việc tra định nghĩa (`mt_*`, tên bảng). Thứ tự trong `runSql`: cache → gộp yêu cầu trùng đang chạy → xếp hàng 6 câu/người → `statement_timeout`.
- **Khoá cache = câu SQL đúng như gửi cho database (text + tham số) + `scopeKey` của mọi bảng nó đọc** (băm SHA-256). Lệch nhỏ so với dòng đề bài ("khoá của câu trả lời đầy đủ"): cache **theo từng câu SQL lá**, không theo câu trả lời cuối. Lý do: câu SQL đã chứa mọi thứ quyết định kết quả (định nghĩa chỉ số, các chỉ số phái sinh được tham chiếu mỗi cái một câu, `compare`/`cumulative`/`target`/`outliers`/bộ lọc, các ngày mà khoảng tương đối đã đổi ra tức là cả "ngày hôm nay", tháng bắt đầu năm tài chính, biểu thức đọc cột); nên không thể quên một thành phần của khoá. Phần ghép các câu lá (phái sinh, so kỳ, luỹ kế, mục tiêu) chỉ làm trên bảng nhỏ, không đáng cache. Phạm vi của bảng ghép và bảng mục tiêu có trong khoá vì mỗi câu lá khai báo đủ bảng nó đọc.
- **`scopeKey(access)` ở `apps/api/src/modules/datahub/access.ts`** là nơi duy nhất nói "ai thấy dòng nào": hôm nay `<tableId>:<level>`. `MTable.scopeKey` (do `loadMTable` điền) mang nó vào engine; bảng không có `scopeKey` thì không bao giờ vào cache. Stage 4.1 chỉ cần sửa hàm này (thêm người đọc và cột khoá của khoá phân chia).
- Quyền được kiểm trước cache (`resolveSource`/`loadTableAccess` chạy ở mỗi lời gọi): người bị gỡ chia sẻ nhận `not_found` dù cache còn câu trả lời cũ; hai người cùng mức quyền trên cùng bảng dùng chung câu trả lời; khác mức thì tính riêng.
- Câu trả lời đang tính khi bảng đổi (sự kiện xoá cache tới giữa chừng) **không được lưu** (bộ đếm thế hệ theo bảng); lời gọi tới sau sự kiện không nối vào câu đang chạy từ trước. Cache giữ tối đa 2.000 câu (dùng gần nhất giữ lại), TTL 5 phút làm lưới an toàn, `ms` = 0 khi lấy từ cache hoặc nối vào câu đang chạy. Cache nằm trong bộ nhớ từng tiến trình api (không dùng Redis).
- **Giới hạn đồng thời:** 6 câu/người (theo `actor.userId`), phần còn lại xếp hàng FIFO; slot trả lại cả khi lỗi. Pool kết nối vẫn là 10 như cũ; chưa đặt trần toàn hệ thống riêng (3D xem có cần).
- **Giới hạn thời gian:** mỗi câu chạy trong một transaction ngắn với `set_config('statement_timeout', 10000, true)` (chỉ áp cho câu đó, không rò sang kết nối trong pool). Quá thời gian → `validation_error`, `details.reason = "query_too_heavy"` kèm `hint`, thông báo "Truy vấn quá nặng…". Không thêm mã lỗi mới (đã chốt ở 3A-1). Giá trị chỉnh được trong `metricLimits` (chưa đưa lên cài đặt hệ thống).
- Số đo `metricCacheStats()` (hits, joined, executed, entries) có để test và để 3D đo.

### Xoá cache bằng outbox + SSE (mục 5)

- Subscriber `metrics.cache` (worker; `modules/metrics/invalidate.ts`, đăng ký trong `core/subscribers.ts`) nghe: `datahub.row.*`, `datahub.formula.recalculated` (trừ `state = pending`, chưa đổi gì), `datahub.structure.changed`, `datahub.share.changed`, `org.member.changed`. Chỉ số/nguồn đổi không cần sự kiện: định nghĩa nằm trong câu SQL nên khoá đổi theo.
- Cách báo cho api: worker `pg_notify` kênh `soe_metric_cache` (`{tables:[...]}` hoặc `{all:true}`, chia 100 mã bảng mỗi gói vì giới hạn 8.000 byte); `SseHub` nghe thêm kênh này (`subscribeCache`), `buildApp` nối vào `invalidateMetricCache`. Mất kết nối rồi nối lại thì xoá hết cache (thông báo gửi lúc đứt bị mất).
- Chia sẻ đổi → xoá mọi bảng của datahub đó; cây tổ chức đổi (`org.member.changed`) → xoá hết; cấu trúc đổi → bảng đó (hoặc cả datahub khi không có `table_id`); công thức tính lại → bảng của cột.
- Sau khi xoá cache, worker phát tín hiệu SSE **`metrics.data.changed`** (đã đăng ký trong danh mục sự kiện, chỉ mang mã: `datahub_id`, `table_ids`, `reason`) cho chủ + người được chia sẻ của datahub; sự kiện cây tổ chức không có datahub nên gửi cho mọi người giữ quyền `datahub:datahub:use`. Dashboard 3C nghe chủ đề `metrics` để tải lại. Mỗi sự kiện dòng sinh một tín hiệu (ghi hàng loạt = nhiều tín hiệu): client nên gộp (debounce) khi tải lại.
- **Độ trễ:** cache chỉ bị xoá sau khi worker xử lý sự kiện (cùng độ trễ với SSE hiện có); trong khoảng đó một lời gọi có thể nhận số cũ. Chấp nhận: dashboard tải lại ngay khi có tín hiệu.
- **Chỗ cắm Stage 4 (chưa làm):** snapshot thật (câu SQL đọc bảng snapshot, `scopeKey` kèm mã snapshot) và "team tại thời điểm" (nguồn cột). Cả hai đổi câu SQL/`scopeKey` nên cache theo chúng mà không sửa `runner.ts`.
- Test: `apps/api/test/metrics-load.test.ts` (22 test).

### Hiệu năng ghép theo khoá (mục 6)

- **Số đo (máy dev, 100.000 × 100.000 dòng, tổng theo năm, lần gọi đầu không cache; `metrics-perf.test.ts`): trước 1.655 ms (SQL 930 ms), sau ~705 ms (SQL ~425 ms), 3 lần chạy liền 703–707 ms.** Đạt mục tiêu < 1 s, test nay đòi `< 1000` (trước là `< 5000`).
- Nguyên nhân tìm bằng `EXPLAIN ANALYZE` (lặp lại trên bảng thử ngoài test): (1) Postgres **sắp xếp 100.000 khoá text theo collation của locale** (~300 ms mỗi lần) khi chọn merge join / GroupAggregate; (2) khoá của dòng bảng chính viết trong `ON` bị tính lại ở mỗi lần thăm bảng băm và mỗi lần so bằng (~2 lần chi phí). Việc chuẩn hoá khoá (bỏ dấu, chữ thường) chỉ tốn ~60 ms/100.000 dòng, không phải nút thắt.
- Hai sửa, đều ở `packages/metrics/src/build.ts`: **(a)** khoá ghép là biểu thức `... COLLATE "C"` (`keyOf`): khoá chỉ so bằng nhau, không xếp thứ tự cho người đọc; collation tất định so bằng đúng từng byte nên kết quả ghép không đổi, còn sắp xếp thành `memcmp`. Câu chẩn đoán đi từ 713 ms xuống ~300 ms. **(b)** Với phép ghép theo khoá, bảng chính được bọc trong truy vấn con có hàng rào `OFFSET 0` tính khoá **một lần mỗi dòng** (cột `jkN`), phép ghép so `j.k = b.jkN`. Điều kiện phạm vi bảng chính nằm cả trong hàng rào.
- Giá phải trả: với phép ghép theo khoá, bộ lọc và khoảng thời gian áp **sau** hàng rào, nên không đẩy xuống bước quét bảng chính (không dùng được index tự động trên cột lọc) và khoá được tính cho mọi dòng bảng chính (~60 ms/100.000 dòng). Với bảng chính 100.000 dòng đây vẫn rẻ hơn lợi ích; phép ghép theo cột Liên kết (`link`) và truy vấn không ghép không bị đổi. 3D có thể xét lại nếu bảng chính lớn hơn nhiều.
- Không đổi `work_mem` (thử `64MB`: chỉ giảm ~100 ms, bỏ). Không cần index mới.
- Test: `packages/metrics/test/build.test.ts` ("key join statement": hàng rào, `COLLATE "C"`, phạm vi trong hàng rào; truy vấn không ghép giữ nguyên), `apps/api/test/metrics-join.test.ts` pass nguyên (số liệu ghép đúng).

### API và tài liệu (mục 7)

- Mọi tham số mới của `metrics.query` (`compare`, `cumulative`, `target`, `outliers`, chỉ số phái sinh bằng `formula`) đã có trong OpenAPI từ 3A-2 mục 1–3; mục này **viết lại mô tả** của `metrics.query` cho đủ chúng, cache và lỗi `query_too_heavy`; chạy lại `pnpm docs:openapi` (`docs/api/openapi.json`).
- Bruno: thêm `docs/api/bruno/metrics/query-derived.bru`, `query-compare.bru`, `query-cumulative.bru`, `query-target.bru`, `query-outliers.bru` (cùng đường dẫn `GET /api/v1/metric-query`, mỗi file một ví dụ tham số kèm giải thích). Không có endpoint mới ở 3A-2 (kênh cache là nội bộ, không phải REST). Tín hiệu SSE `metrics.data.changed` nằm trong danh mục sự kiện.

### Test (mục 8–9)

- Thêm: `apps/api/test/metrics-load.test.ts` (22 test: scopeKey, cache, phạm vi, mất quyền, tham số và ngày hôm nay trong khoá, câu đang chạy khi bảng đổi, LRU/TTL, gộp yêu cầu, giới hạn 6 câu, timeout, xoá cache theo dòng/công thức tính lại/chia sẻ/cấu trúc/cây tổ chức/nối lại kết nối, tín hiệu SSE); `packages/metrics/test/build.test.ts` (ghép theo khoá). Test phân quyền: `metrics-access.test.ts` pass nguyên; thêm phần phạm vi/mất quyền ở `metrics-load`.
- **Snapshot và "team tại thời điểm": chỉ để chỗ cắm** (Stage 4), chưa làm: xem mục "Chỗ cắm Stage 4" ở phần cache. Khi cắm, `scopeKey` kèm mã snapshot và câu SQL đọc bảng snapshot; không phải sửa `runner.ts`.

### Câu hỏi còn mở của 3A-2 (không chặn)

- Dashboard mở lâu có thể nhận nhiều tín hiệu `metrics.data.changed` khi có ghi hàng loạt (mỗi sự kiện dòng một tín hiệu): 3C nên debounce khi tải lại. Nếu muốn gộp ở server thì đổi subscriber thành gộp theo (datahub, 500 ms): chưa làm.
- Cache nằm trong bộ nhớ từng tiến trình api; chạy nhiều api thì mỗi cái tự tính lần đầu (3D đo). Chưa có trần toàn hệ thống số câu chạy cùng lúc (chỉ 6/người + pool 10 kết nối).
- `statement_timeout` (10 s), 6 câu/người, TTL 5 phút, 2.000 câu cache đang là hằng số trong `metricLimits`; chưa đưa lên cài đặt hệ thống.

## Stage 3B: bảng gộp (Sonnet, 19/11)

### Cấu trúc

- Migration `0011_datahub_merged_tables.sql`: `dh_tables.kind` (`normal` | `merged`); `dh_merges` (một dòng mỗi bảng gộp: `config`, `source_ids` có index GIN, `status` pending/ok/error, `error`, `diagnostics`, `request_seq` / `synced_seq`, `synced_at`, `version`); `dh_merge_rows` (`ident` -> dòng gộp, kèm bảng và dòng nguồn; để mở dòng gốc và để giữ mã dòng gộp qua các lần đồng bộ). Bảng gộp là bảng của datahub, đếm vào giới hạn số bảng, dòng ở `dh_rows` như mọi bảng (không bảng riêng).
- Mã: `datahub/merge-plan.ts` (thuần: cấu hình Zod, kiểu cột ghép được, chuẩn hoá khoá, `planMerge`), `merge-sync.ts` (đọc nguồn, ghi, vòng worker, `requestRescope`, subscriber), `merge-ops.ts` (lệnh). Worker: `startMergeLoop` (cùng nhịp với vòng công thức); test: `drainOutbox` của `dh-helpers` gọi thêm `processPendingMerges`.

### Đọc nguồn qua phạm vi của chủ (Điều chỉnh mục 3)

- Nguồn được nạp bằng `loadTableAccess` với **chủ bảng gộp làm actor**, yêu cầu mức `owner` (bảng do người khác chia sẻ, kể cả khi chủ đọc được, bị từ chối: `source_not_owned` lúc tạo, `no_access` lúc đồng bộ). Dòng đọc qua **`readableRows(access, alias)`** mới thêm ở `datahub/access.ts` ngay cạnh `scopeKey`: `access.scope()` + chưa vào thùng rác. Stage 4.1 (khoá phân chia) chỉ sửa `scope()`, `scopeKey` và `readableRows` ở file đó; bảng gộp không chép dòng chủ không thấy.
- Đường đồng bộ lại khi phạm vi đổi: **`requestRescope(db, event)`** (`merge-sync.ts`) là một cửa duy nhất đổi "cái gì vừa đổi" thành "bảng gộp nào phải đồng bộ lại": dòng hoặc giá trị công thức của nguồn (`datahub.row.*`, `datahub.formula.recalculated` không phải `pending`), cấu trúc (cột, thùng rác, đổi chủ), `datahub.share.changed` (mọi bảng gộp trong datahub đó hoặc có nguồn ở đó), `org.member.changed` (mọi bảng gộp). Hôm nay "đồng bộ lại" là đọc lại cả nguồn qua `readableRows` (phạm vi = cả bảng) rồi so sánh, nên không ghi gì nếu không có gì đổi. 4.1 thêm trigger (đổi cột khoá, đổi cây) ngay trong hàm này.
- Tất cả đi qua một subscriber (`datahub.merge`), nên khi nguồn là bảng template của Deals sau này không phải đổi chỗ nào khác.

### Đồng bộ

- Một transaction mỗi bảng gộp, khoá `pg_try_advisory_xact_lock` (hai worker không chạy cùng một bảng). `request_seq` tăng mỗi yêu cầu; đồng bộ đọc `request_seq` lúc bắt đầu và ghi `synced_seq` lúc xong, nên yêu cầu đến giữa lúc chạy không mất. Vòng worker lấy bảng có `request_seq > synced_seq`.
- So sánh với dòng đang có theo `ident`: thêm, sửa (chỉ khi các ô do gộp quản lý đổi), xoá mềm, khôi phục (dòng nguồn quay lại thì **cùng dòng gộp**, không sinh dòng thứ hai). Mã dòng gộp ổn định: `ident` = khoá chuẩn hoá khi chống trùng (nên người thắng đổi thì dòng gộp vẫn là dòng đó), hoặc `nguồn:dòng` khi không có khoá hay khoá rỗng.
- **Không lịch sử dòng, không nhật ký, không đổi `version` và "Ngày sửa"** (cùng luật với công thức). Phát `datahub.row.created/updated/deleted/restored` (cho SSE, cache metrics, `recordChanges` cho công thức/lookup/rollup đọc bảng gộp) và `datahub.merge.synced` (UI làm mới trạng thái). Công thức cùng dòng tính ngay trong transaction (`RowFormulas`), công thức đọc cả cột do worker tính như bảng thường. Bảng gộp là nguồn của metrics không cần đổi engine: cache bị xoá bằng chính subscriber `metrics.cache` nghe các sự kiện dòng đó.
- Số đo (máy dev, `datahub-merge-perf.test.ts`): 100.000 + 50.000 dòng nguồn, 30.000 khoá trùng, bảng gộp 120.000 dòng: đồng bộ lần đầu ~13 s; sau khi sửa một dòng nguồn đồng bộ ~1,2 s và chỉ ghi 1 dòng. Đọc toàn bộ dòng nguồn vào bộ nhớ theo trang 5.000 (đủ cho cỡ này; nguồn lớn hơn nhiều thì cần đồng bộ từng phần: để 3D/Stage sau).

### Nguồn mất

- Nguồn bị xoá/vào thùng rác, mất quyền chủ (đổi chủ datahub), hoặc là bảng gộp: `status = error`, `error` liệt kê từng nguồn kèm lý do (`deleted`, `no_access`, `merged`). **Cả bảng ngừng cập nhật** (không đồng bộ nửa vời làm mất dòng của nguồn bị mất), giữ dữ liệu lần đồng bộ cuối; nguồn trở lại (khôi phục) thì tự đồng bộ lại. Người được chia sẻ thấy lỗi nhưng không thấy tên nguồn (họ có thể không được chia sẻ nguồn). Lỗi bất ngờ khi đồng bộ: `error` với `sync_failed`, đặt `synced_seq` để không lặp mỗi nhịp.
- Cột nguồn bị xoá hoặc đổi sang nhóm kiểu không khớp: **không phải lỗi**, là cảnh báo (`missing_column`, `type_mismatch`) và ô để trống.

### Ghép cột, kiểu, chống trùng

- Tự ghép theo tên (`normName`: bỏ khoảng trắng đầu cuối, không phân biệt hoa thường); **tên cột lấy từ nguồn ưu tiên cao nhất có cột đó** (nên đổi thứ tự có thể đổi chữ hoa thường của tên; khoá chống trùng so tên không phân biệt hoa thường nên không vỡ). Ghép tay bằng `columns: [{name, from: {bảng: cột}}]`. Cột mới giữ **mã cột cũ khi cùng tên và cùng kiểu** (view, công thức, chỉ số đọc cột đó không đổi) khi cập nhật cấu hình.
- Kiểu ghép được (nhóm): văn bản (text, long_text, email, phone, url), số (number, currency, percent, rating), ngày, ngày giờ, checkbox, người dùng, lựa chọn. Cùng kiểu giữ nguyên; cùng nhóm thành kiểu thường (text, number); **một/nhiều lựa chọn thành văn bản (tên lựa chọn, nhiều thì nối ", ")** vì mã lựa chọn riêng từng bảng. Khác nhóm: `incompatible_types` kèm danh sách kiểu. Đính kèm, liên kết, tự tăng, cột hệ thống không ghép (tự ghép thì bỏ qua, ghép tay thì lỗi). Cột công thức/lookup/rollup ở nguồn ghép theo kiểu kết quả, chép giá trị đã tính (thành cột thường ở bảng gộp, theo dõi tính lại của nguồn).
- Khoá chống trùng 1–5 cột; chuẩn hoá bỏ dấu (đ -> d), chữ thường, gộp khoảng trắng. **Dòng có mọi cột khoá rỗng giữ nguyên, không so trùng** (kèm số `empty_key_rows`). Ba cách: `priority` (nguồn cao hơn, cùng nguồn thì dòng nhỏ số hơn), `latest` (`updated_at` lớn nhất, hoà thì theo ưu tiên), `cell_merge` (dòng ưu tiên cao nhất, ô rỗng lấy giá trị không rỗng đầu tiên theo ưu tiên). Cột `Nguồn` = "Tên datahub – Tên bảng" (tên bảng riêng lẻ lặp lại giữa các datahub, ví dụ "Bảng 1"), `Mã dòng gốc` = mã dòng của dòng thắng. Không chọn khoá: cảnh báo `no_key`.
- Chẩn đoán trả mỗi lần (`datahub.merge.get`, `datahub.merge.preview`): câu đọc được ("Gộp 3 bảng: 1.240 dòng, loại 87 dòng trùng khoá (40 nhóm trùng)."), số dòng đọc/giữ/loại từng nguồn, cảnh báo, 20 nhóm trùng mẫu; `datahub.merge.duplicates` phân trang đủ nhóm (tính lại qua phạm vi của chủ); `datahub.merge.preview` chạy cả kế hoạch không ghi (nặng ngang một lần đồng bộ, giao diện gọi sau 450 ms không gõ).

### Chỉ đọc và quyền

- `assertWritable` ở `applyRowOps` và `restoreRows` (một cửa của mọi ghi dòng: API, import, dán, tìm dòng trùng) từ chối cả **chủ**; người được chia sẻ quyền Sửa bị hạ xuống Xem ở `loadTableAccess` (nên mọi chỗ kiểm `edit_data` đều chặn). Cột: bảng gộp chỉ thêm được cột **công thức/lookup/rollup**; cột dữ liệu chỉ đổi tên, mô tả, định dạng, vị trí; không xoá, không khôi phục, không đổi kiểu (qua `datahub.merge.update`).
- Chỉ chủ datahub tạo, cấu hình (`merge.update`), đồng bộ tay, xem nhóm trùng và dòng gốc. Người được chia sẻ xem `merge.get` ở dạng rút gọn (trạng thái, tổng số dòng; không có cấu hình, tên nguồn, nhóm trùng). Một bảng gộp không làm nguồn của bảng gộp khác (tránh vòng).
- Giao diện: nút "Tạo bảng gộp" ở thanh bảng (tên khác "Thêm bảng" để không đụng bộ chọn của các e2e cũ) (chỉ chủ), thanh trạng thái trên grid, trình cấu hình, danh sách nhóm trùng, liên kết "Mở bảng nguồn" ở khung chi tiết dòng (chỉ chủ; mở bảng nguồn, không nhảy tới dòng vì chưa có địa chỉ tới một dòng). "Nhập dữ liệu" của datahub không liệt kê bảng gộp.

### Test

- `apps/api/test/datahub-merge-plan.test.ts` (11, thuần), `datahub-merge.test.ts` (20: tạo, ghép cột tay và tự ghép, ba cách chống trùng, khoá rỗng, theo nguồn, công thức, chỉ đọc, không vết, quyền, giới hạn bảng, cập nhật cấu hình, nguồn mất/đổi chủ/cột mất, `requestRescope`, metrics), `datahub-merge-perf.test.ts` (100.000 + 50.000 dòng). e2e `apps/web/e2e/stage3b.spec.ts` (7 luồng desktop).
- Lỗi giao diện tìm thấy khi viết e2e, đã sửa: bản xem trước gửi với biểu mẫu cũ (rỗng) vì điều kiện `enabled` đọc state thay vì thân đã debounce; khoá chống trùng lưu theo tên đã chuẩn hoá để không vỡ khi đổi thứ tự nguồn làm đổi chữ hoa thường của tên cột tự ghép.

### Câu hỏi còn mở của 3B (không chặn)

- Nguồn rất lớn (hàng triệu dòng): đồng bộ hiện đọc cả nguồn vào bộ nhớ; chưa có đồng bộ từng phần theo `row_ids` của sự kiện.
- Chủ đổi tên một cột nguồn: cột gộp vẫn trỏ đúng (theo mã cột) nhưng tên cột gộp không đổi theo; chủ đổi tên bằng tay ở bảng gộp (cho phép).

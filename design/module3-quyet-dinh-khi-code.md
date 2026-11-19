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

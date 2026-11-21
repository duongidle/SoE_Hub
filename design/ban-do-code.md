# Bản đồ code

Dương chốt 21/11/2026. File này giúp agent code module mới gọi đúng vào module cũ mà không phải dò lại code. Mỗi module có một mục.

## Quy định dùng

1. **Bản đồ là điểm bắt đầu, không phải danh sách đầy đủ.** Không thấy trong bản đồ thì grep đúng tên cần tìm, rồi mở đúng đoạn đó (`sed -n`). Không đọc lại cả module.
2. **Grep trước khi viết hàm dùng chung mới.** Lỗi hay gặp nhất là tưởng chưa có nên viết hàm mới, trùng hoặc lệch với hàm đã có.
3. **Bản đồ thiếu đâu thì vá đó.** Phải tự dò ra cái bản đồ không có thì ghi thêm vào mục của module đó, trong cùng commit với code.
4. **Bản đồ sửa cùng code.** Đổi chữ ký, hành vi, hoặc chỗ đặt của hàm, lệnh, sự kiện có trong bản đồ thì sửa bản đồ trong cùng commit.
5. **Bản đồ và code lệch nhau thì code đúng.** Bản đồ chủ yếu ghi "muốn làm X thì gọi `Y` ở file Z". Hành vi chi tiết thì đọc ở chính hàm và comment của nó.
6. **Chống loop.** Sửa 2 vòng chưa qua mà lỗi dính tới module cũ thì bước tiếp theo bắt buộc là mở code thật để kiểm giả định lấy từ bản đồ. Không sửa tiếp theo bản đồ. Bản đồ sai thì vá theo quy định 3.
7. **Test kiểm bản đồ** (`apps/api/test/ban-do-code.test.ts`) nằm trong bộ vitest.
   - Mọi cặp `` `đường/dẫn.ts` `tênHàm` `` trong file này phải có thật: file tồn tại và chứa tên đó.
   - Đường dẫn đứng một mình cũng phải tồn tại.
   - Bản đồ lệch với code thì test đỏ ở lần chạy cả bộ của bước con.
8. **Lưới an toàn không dựa vào bản đồ:**
   - Luật quan trọng nhất nằm trong code, không chỉ ở đây. Ví dụ truy vấn `dh_rows` thiếu dấu phạm vi thì chốt chặn `auth/query-guard.ts` báo lỗi ngay.
   - Typecheck, test phân quyền, cả bộ test cuối mỗi bước con.
   - Opus rà diff phần dùng chung và grep nơi gọi.

## Cách viết một mục

- Mỗi mục khoảng 30–60 dòng.
- Agent cuối của stage viết mục cho module đó, lúc code còn trong ngữ cảnh.
- Ghi đường dẫn file kèm tên hàm, đúng dạng `` `apps/api/src/.../file.ts` `tenHam` `` (đường dẫn từ gốc repo, một dấu cách, rồi tên) để test kiểm được. Không ghi số dòng, vì số dòng cũ đi nhanh.
- Mỗi mục gồm:
  - **Chỗ gọi vào:** hàm, lệnh registry, sự kiện outbox mà module khác dùng, kèm một dòng nói làm gì.
  - **Mẫu làm theo:** việc hay làm (thêm lệnh, thêm kiểu cột, thêm job…), kèm file và hàm mẫu.
  - **Bảng chính:** tên bảng và vai trò.
  - **Luật cấm:** điều không được làm, và chỗ trong code chặn nó (nếu có).

## Module 0: Nền tảng

_Chưa viết._

## Module 1: Tài khoản, phân quyền

_Chưa viết._

## Module 2: Datahub

**Chỗ gọi vào (quyền và đọc dòng)**
- Cần quyền một bảng → `apps/api/src/modules/datahub/access.ts` `loadTableAccess` (hoặc `loadDatahubAccess` cho cả datahub). Trả `TableAccess`; mức `owner` / `edit_data` / `view` so bằng `atLeast`.
- Truy vấn `dh_rows` cho một người → `FROM ${acc.rel()}` và `WHERE ${acc.rows(alias)}` trong `apps/api/src/modules/datahub/access.ts` `TableAccess`. `rel()` lót giá trị theo người đọc, `rows()` thêm khoá phân chia.
- Chỉ cần "dòng sống mà người này đọc được" (bảng gộp, chỉ số) → `apps/api/src/modules/datahub/access.ts` `readableRows`.
- Khoá phân chia: điều kiện SQL là `apps/api/src/modules/datahub/access.ts` `keyMatch`; kiểm trong JS là `TableAccess.seesRow`; người đọc (và cấp dưới) lấy từ `apps/api/src/modules/datahub/access.ts` `loadReader`.
- Sửa dòng có được không: `TableAccess.canEditRow` (cờ `can_edit` trả ra cho dòng); cột có cho thành viên Sửa không là `allow_edit` của cột, kiểm trong `apps/api/src/modules/datahub/rows.ts` `applyRowOps`.
- Cột nào người này thấy (bảng template) → `TableAccess.canSeeColumn`.
- Khoá cache theo người đọc → `apps/api/src/modules/datahub/access.ts` `scopeKey`. Không tự ghép khoá.
- Người nhận sự kiện → `apps/api/src/modules/datahub/access.ts` `tableAudience`, `datahubAudience`, `rowAudience`.
- Đọc dòng: `apps/api/src/modules/datahub/rows-read.ts` `listRows`, `getRow`, `rowHistory`; gom nhóm `apps/api/src/modules/datahub/rows-groups.ts` `listGroups`. Dòng ra API: `apps/api/src/modules/datahub/table-schema.ts` `toApiRow`.
- Ghi dòng (tạo/sửa/xoá/upsert, theo lô): `apps/api/src/modules/datahub/rows.ts` `applyRowOps`; khôi phục: `restoreRows`. Bảng gộp chỉ đọc: `assertWritable`.
- Khoá phiên bản, đợi công thức tính xong sau ghi: `apps/api/src/modules/datahub/consistency.ts` `waitConsistent`.

**Giá trị ô, kiểu cột**
- Đổi ô thành dạng lưu, so hai giá trị lưu → `apps/api/src/modules/datahub/cell-values.ts` `valueToStored`, `sameStored` (so xong mới quyết "không đổi", đừng so `===`).
- Cột tính (formula, lookup, rollup) coi như kiểu kết quả → `apps/api/src/modules/datahub/cell-values.ts` `effectiveType`, `isComputedType`; lỗi ô tính nằm ở khoá `!key` (`errKey`).
- Một cột đọc/ghi/lọc/sắp qua nguồn cột, không tự viết SQL `data->>` → `apps/api/src/modules/datahub/column-source.ts` `sourceOf` (`cellExpr`, `fieldSpec`, `readExpr`, `planWrite`). Hai nguồn: `JsonbSource` (trong `data`), `PersonalSource` (mỗi người một giá trị, `dh_person_cells`).
- Thêm kiểu cột mới: thêm tên vào `COLUMN_TYPES` ở `packages/shared/src/datahub.ts`, rồi thêm một định nghĩa vào danh sách `defs` của `apps/api/src/modules/datahub/column-types.ts` `registerColumnType` (mẫu: các kiểu cạnh đó; `columnTypeDef(type)` để tra). Kiểu mới có cột tính thì thêm vào `COMPUTED_TYPES`. Phía web: `apps/web/src/lib/datahub/cells.ts` `displayText`, `parseCellText`.
- Tạo/sửa/xoá cột, đổi kiểu: `apps/api/src/modules/datahub/columns.ts` `createColumn`, `updateColumn`, `changeColumnType`. Đổi tên lựa chọn: `apps/api/src/modules/datahub/option-rename.ts` `optionRenameOperations`.
- Kiểu Người dùng (có thuộc tính hoặc không): đọc id người luôn qua `apps/api/src/modules/datahub/user-values.ts` `userIdsOf` (SQL: `soe_dh_ids`). Cấu hình thuộc tính: `userAttrs`, `hasAttrs`. Hạn mức theo người: `apps/api/src/modules/datahub/people-caps.ts` `checkPeopleCaps`.

**Công thức, tính lại**
- Cú pháp, hàm, đánh giá: `packages/formula/src/parser.ts` `parseFormula`, `packages/formula/src/evaluator.ts` `evaluate`, thêm hàm ở `packages/formula/src/functions/index.ts` `ALL_FUNCTIONS` (kèm `packages/formula/src/catalog.ts` `FUNCTION_CATALOG`).
- Tên cột trong công thức lưu theo khoá, hiển thị theo tên → `packages/formula/src/refs.ts` `toStoredFormula`, `toDisplayFormula`.
- Biên dịch công thức của một cột, chỉ mục chủ sở hữu → `apps/api/src/modules/datahub/computed.ts` `prepareComputed`, `OwnerIndex`.
- Ghi dòng xong, ghi "cột nào có thể đổi, dòng nào" → `apps/api/src/modules/datahub/partial.ts` `recordChanges` (hàng đợi `apps/api/src/modules/datahub/change-queue.ts` `enqueue`). Công thức tính lại theo lô trong `apps/api/src/modules/datahub/recalc.ts` `recalcColumn`, `processPendingColumns`; muốn đánh dấu cột cần tính: `markPending`.
- Giá trị theo người đọc (cột tính đọc sang bảng có khoá phân chia): `apps/api/src/modules/datahub/reader-scope.ts` `refreshReaderScoped`, `overlayRel`; cờ `dh_columns.reader_scoped`; bảng `dh_personal_rows`. Giá trị mỗi người một ô: `dh_person_cells`.
- Đối chiếu số liệu tính lại với tính mới: `apps/api/src/modules/datahub/reconcile.ts` `reconcileColumns`.

**Bảng template, liên kết**
- Bảng template, lớp cột (`basic`/`role`/`team`/`custom`): `apps/api/src/modules/datahub/template-ops.ts` `createTemplateCore`, `addTemplateColumn`; đồng bộ ra bảng của từng người: `apps/api/src/modules/datahub/template-sync.ts` `syncTemplate`, `syncAllTemplates`.
- Tìm cột theo vai trò, không theo tên/khoá → `apps/api/src/modules/datahub/column-roles.ts` `roleDef`, `columnUsage`.
- Cột Relation trỏ sang bảng khác (của chủ, hoặc bảng template của người khác) → `apps/api/src/modules/datahub/link-targets.ts` `resolveLinkTarget`.
- Bảng gộp: `apps/api/src/modules/datahub/merge-sync.ts` `syncMergedTable`; kế hoạch gộp thuần `apps/api/src/modules/datahub/merge-plan.ts` `planMerge`.
- Khoá phân chia, chia sẻ: `apps/api/src/modules/datahub/split-ops.ts` `setShareOptions`, `splitOperations`.

**View, import/export, job, thùng rác, lịch sử**
- View (chia sẻ/cá nhân): `apps/api/src/modules/datahub/collab.ts` `viewOperations`; bộ lọc thời gian `apps/api/src/modules/datahub/time-filter.ts` `timeFilterNode`.
- Việc nền chạy lâu (nhập, xuất): `apps/api/src/modules/datahub/jobs.ts` `registerJobRunner`, `patchJob`, `cancelRequested`; bảng `dh_jobs`. Mẫu thêm job: `apps/api/src/modules/datahub/export-job.ts` (`registerJobRunner("export", ...)`) và `apps/api/src/modules/datahub/import-job.ts`. Job chạy với quyền người yêu cầu (`jobActor`, `callAs`).
- Nhập file: `apps/api/src/modules/datahub/import-read.ts` `openBook`, `apps/api/src/modules/datahub/import-plan.ts` `analyzeSheet`, `buildRow`. Chuyển công thức Excel: `apps/api/src/modules/datahub/excel-formula.ts` `FormulaTranslator`.
- Thùng rác: `apps/api/src/modules/datahub/trash.ts` `registerDatahubTrash` (bảng thêm vào thùng rác thì đăng ký ở đây, `registerTrashTable` của `@soe/db`).
- Lịch sử dòng: bảng `row_history`, ghi trong `apps/api/src/modules/datahub/rows.ts` `applyRowOps`; đọc `apps/api/src/modules/datahub/rows-read.ts` `rowHistory`.
- Hạn mức: `apps/api/src/modules/datahub/limits.ts` `getLimits`, `quotaExceeded`.

**Mẫu làm theo**
- Thêm lệnh/truy vấn: `defineCommand`/`defineQuery` ở `apps/api/src/core/registry.ts`, đặt trong nhóm `*Operations` của file module (mẫu `apps/api/src/modules/datahub/lookup-ops.ts` `lookupOperations`), rồi gom ở `apps/api/src/modules/datahub/index.ts` `datahubOperations`. Sự kiện mới: `apps/api/src/modules/datahub/events.ts` `datahubEvents`.
- Phát cấu trúc đổi: `apps/api/src/modules/datahub/shared.ts` `emitStructure`. Phát dòng đổi: `ROW_EVENTS`.
- Web: dữ liệu qua `apps/web/src/lib/datahub/api.ts`; lưới dùng `apps/web/src/lib/datahub/rows-store.ts` `RowsStore`.

**Bảng chính**: `dh_datahubs`, `dh_tables`, `dh_columns`, `dh_rows` (ô trong `data` jsonb), `dh_views`, `dh_shares`, `dh_personal_rows`, `dh_person_cells`, `dh_change_queue`, `dh_formula_deps`, `dh_jobs`, `dh_templates`, `dh_merges`, `dh_merge_rows`, `row_history`.

**Luật cấm**
- Truy vấn `dh_rows` thiếu `acc.rows()` / `acc.rel()` hoặc dấu `/*scope:system*/` (worker, reconcile, dọn thùng rác) bị chặn bởi `apps/api/src/auth/query-guard.ts` `checkScopedQuery`. Bảng mới cần chốt tương tự thì `registerOwnedTable`.
- Cache hoặc khoá phụ thuộc người đọc phải qua `scopeKey`, không tự ghép.
- Chỉ đọc id người qua `userIdsOf`, không đọc `data[k]` như một chuỗi uuid.
- Chỉ đọc/ghi cột qua `sourceOf`; không viết SQL riêng lên `data->`.
- Lỗi số liệu công thức sửa ở nơi tính (`apps/api/src/modules/datahub/recalc.ts`, `apps/api/src/modules/datahub/computed.ts`, `packages/formula`), không vá ở lưới, xuất file, API hay dashboard.
- Không tính lại theo từng màn hình hay từng lần đọc; ghi dòng đi qua `recordChanges` rồi worker tính.
- Không ghi `dh_rows` ngoài `applyRowOps` (mất lịch sử, hàng đợi tính lại, sự kiện, kiểm quyền).
- Không dùng `scope()` thay `rows()` cho dòng (bỏ qua khoá phân chia).
- Không ghi thẳng vào bảng gộp (chỉ worker).


## Module 3: Chỉ số, dashboard

**Chỗ gọi vào**
- Chạy một chỉ số (định nghĩa JSON, tham số so sánh, mục tiêu...) → `apps/api/src/modules/metrics/engine.ts` `runMetric` (`runDefinition` cho chỉ số đã lưu; `runHistogram`, `runBoxplot`, `runRowIds` cho biểu đồ riêng). Kiểm hợp lệ trước: `validateSpec`, `validateDefinition`.
- Nguồn dữ liệu của chỉ số (một bảng, hoặc nối nhiều bảng) → `apps/api/src/modules/metrics/context.ts` `resolveSource`; cột Datahub thành cột chỉ số: `toMColumn`. Đọc cột luôn qua `apps/api/src/modules/datahub/column-source.ts` `sourceOf` (`cellExpr`), engine không biết cột nằm ở đâu.
- Câu SQL chỉ số do thư viện thuần dựng: `packages/metrics/src/build.ts` `buildMetricQuery`; hậu xử lý (chỉ số suy ra, tích luỹ, so kỳ, mục tiêu): `packages/metrics/src/post.ts` `combineDerived`, `cumulate`, `compareTables`, `attachTarget`; khoảng thời gian: `packages/metrics/src/time.ts` `resolveRange`.
- Mọi câu SQL chỉ số chạy qua một chỗ → `apps/api/src/modules/metrics/runner.ts` `runSql` (cache, gộp yêu cầu trùng, giới hạn đồng thời, hết giờ). Không gọi `ctx.db.execute` cho dữ liệu chỉ số ở nơi khác.
- Cache: khoá = câu SQL + tham số + `scopeKey` của từng bảng đọc (`apps/api/src/modules/datahub/access.ts` `scopeKey`, lấy trong `apps/api/src/modules/metrics/context.ts` `loadMTable`). Xoá cache khi dữ liệu đổi: `apps/api/src/modules/metrics/runner.ts` `invalidateMetricCache`, gọi từ worker qua `apps/api/src/modules/metrics/invalidate.ts` `metricCacheSubscriber`; sự kiện báo dashboard đang mở tải lại: `metricsEvents` (`metrics.data.changed`).
- Bảng gộp là bảng Datahub thường (`kind = merged`), chỉ chỉ số đọc như mọi bảng; phần dựng ở Module 2 `apps/api/src/modules/datahub/merge-sync.ts`. Chẩn đoán nối bảng: `apps/api/src/modules/metrics/engine.ts` `diagnoseJoins`, `unmatchedRows`. Gấp bảng nối về một dòng theo dòng gốc: `apps/api/src/modules/metrics/folds.ts` `ensureFolds`.

**Dashboard, biểu đồ, chia sẻ, Guest**
- Ai xem được dashboard và số tính bằng quyền ai → `apps/api/src/modules/metrics/dashboard-access.ts` `viewDash` (vai trò `owner`/`shared`/`guest`); số luôn tính bằng quyền chủ (`computeCtx`), còn dòng đằng sau con số đọc bằng quyền người xem (`chartRowsOf`).
- Chạy dữ liệu một biểu đồ: `apps/api/src/modules/metrics/chart-run.ts` `runChart` (phân nhánh theo `chart.type`); dữ liệu biểu đồ cho người xem kèm bộ lọc: `apps/api/src/modules/metrics/dashboard-access.ts` `viewChart`, `viewerChart`, `checkViewerFilters`.
- Lưu/sửa dashboard, biểu đồ, bố cục, hạn mức: `apps/api/src/modules/metrics/dashboard-ops.ts` `dashboardOperations`, `parseChart`, `checkChart`; xuất/nhập/CSV: `apps/api/src/modules/metrics/chart-ops.ts` `chartOperations`.
- Guest xem dashboard qua quyền dữ liệu loại `dashboard`, kênh `web`: đăng ký ở `apps/api/src/modules/metrics/index.ts` `registerGrantDataType`, kiểm ở `apps/api/src/modules/guest/index.ts` `guestCanAccess`. Guest không có đường nào tới bảng Datahub gốc.
- Lệnh chỉ số/nguồn/cache: `apps/api/src/modules/metrics/ops.ts` `metricOperations`.

**Mẫu làm theo**
- Thêm phép tổng hợp (agg): thêm tên vào `AGGS` ở `packages/metrics/src/schema.ts`, thêm nhánh SQL trong `packages/metrics/src/build.ts` `buildMetricQuery` (mẫu: các nhánh `stddev`, `median` cạnh đó), và kiểu cột cho phép. Web: `apps/web/src/lib/dashboard/config.ts` `AGG_LABELS`.
- Thêm loại biểu đồ: thêm vào `CHART_TYPES` ở `packages/metrics/src/chart.ts`; nếu cần dựng riêng thì thêm hàm thuần trong `packages/metrics/src/chart-view.ts` (mẫu `buildFunnel`); thêm nhánh `case` trong `apps/api/src/modules/metrics/chart-run.ts` `runChart`. Web: `apps/web/src/lib/dashboard/config.ts` `TYPE_LABELS`, `apps/web/src/lib/dashboard/echart-more.ts` (mẫu `funnelOption`) hoặc `apps/web/src/lib/dashboard/echart-options.ts`, kích thước `apps/web/src/lib/dashboard/layout.ts` `defaultSizeOf`.
- Thêm bộ lọc dashboard: `packages/metrics/src/dash-filter.ts` `overridesFromFilters`, rồi `apps/api/src/modules/metrics/dashboard-access.ts` `checkViewerFilters`.

**Bảng chính**: `mt_sources` (nguồn), `mt_metrics` (chỉ số), `mt_dashboards`, `mt_charts`, `mt_dashboard_shares`, `mt_dashboard_prefs` (bộ lọc riêng của từng người xem). Bảng đăng ký chốt chặn trong `apps/api/src/modules/metrics/index.ts`.

**Luật cấm**
- Không cộng, đếm, trung bình, so kỳ ở client hay trong UI: số do engine trả, web chỉ hiển thị (`apps/web/src/lib/dashboard/chart-data.ts` chỉ đổi hình dạng, không tính lại). Lỗi số liệu sửa ở engine hoặc `packages/metrics`.
- Không chạy SQL chỉ số ngoài `runSql`; không tự dựng khoá cache, luôn `scopeKey`. Bảng không có `scopeKey` thì không cache.
- Không đọc dòng Datahub của chỉ số mà bỏ qua `acc.rows()` / `access.rel()`: `loadMTable` đã đưa sẵn `scope` và `rel`, dùng đúng chúng.
- Số dashboard của người được chia sẻ tính bằng quyền chủ, nhưng xem dòng đằng sau số phải bằng quyền người xem (`chartRowsOf`); đổi hai chỗ này phải rà lại quyền.


## Module 4: Quản lý Deal

_Chưa viết (viết ở bước kiểm thử cuối Stage 4)._

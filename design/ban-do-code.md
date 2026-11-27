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
   - Luật quan trọng nhất nằm trong code, không chỉ ở đây. Ví dụ truy vấn `dh_rows` thiếu dấu phạm vi thì chốt chặn `apps/api/src/auth/query-guard.ts` báo lỗi ngay.
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

### Thêm một lệnh hoặc truy vấn registry
- Muốn thêm lệnh ghi (một transaction, có audit, có thể emit) → `defineCommand` ở `apps/api/src/core/registry.ts`. Muốn thêm truy vấn đọc → `defineQuery`, cùng file.
- Mẫu đầy đủ (input zod, `permission`, `aiAllowed`, `emits`, audit, emit): lệnh `guest.grant.create` ở `apps/api/src/modules/guest/index.ts` `guestOperations`.
- Tên lệnh dạng `<module>.<đối tượng>.<động từ>`. Mỗi lệnh có `http: { method, path }`, REST và OpenAPI sinh từ đây.
- Chuỗi quyền chỉ được dùng chuỗi có trong `PERMISSIONS` ở `packages/shared/src/permissions.ts`. Quyền mới thì khai báo ở đó, rồi thêm vào `ROLE_PERMISSIONS` cùng file.
- `permission: null` là công khai (đăng nhập, xin mã). `aiAllowed: false` thì kênh `mcp` bị từ chối.
- Muốn ghi chi tiết audit → `ctx.audit({ type, id, details })` trong handler. Target thuộc dữ liệu riêng → `registerPrivateAuditTarget` ở `apps/api/src/core/audit-privacy.ts`, audit chỉ giữ tên trường, không giữ giá trị.
- Muốn báo lỗi → `throw new AppError("<mã>", "thông điệp", details)`. Mã nằm ở `ERROR_CODES` trong `packages/shared/src/errors.ts`, không viết chuỗi mã ở nơi khác.
- Muốn emit sự kiện → khai `emits: ["tên"]` trong lệnh, rồi `ctx.emit(tên, { aggregateType, aggregateId, payload })`. Sự kiện phải có trong danh mục: `EventDef` ở `apps/api/src/core/events.ts` (mẫu: `authEvents` ở `apps/api/src/modules/auth/events.ts`).
- `EventDef.audience` quyết định ai nhận tín hiệu SSE. Không có `audience` thì không ai nhận.
- Đăng ký module: thêm lệnh vào `buildRegistry` và sự kiện vào `EventRegistry` ở `apps/api/src/modules/index.ts`. Bảng có thùng rác → `registerTrashTables` cùng file.
- Ghi có version chống ghi đè → `versionedUpdate`, xoá mềm → `softDelete`, khôi phục → `restoreRow`, thùng rác → `registerTrashTable` (tất cả ở `packages/db/src/helpers/versioned.ts`). Bảng mới dùng `standardColumns` ở `packages/db/src/schema/columns.ts`.
- Lịch sử dòng → `recordRowHistory` và `diffRows` ở `packages/db/src/helpers/history.ts`. Audit tự ghi bởi executor (`apps/api/src/core/executor.ts` `OperationExecutor`), lệnh không tự gọi `writeAudit`.
- Đổi lược đồ → file SQL mới ở `packages/db/drizzle/`, không sửa file đã chạy. Có endpoint mới thì thêm request Bruno ở `docs/api/bruno/`.

### Outbox, subscriber, worker, job
- Sự kiện vào bảng `outbox` cùng transaction với lệnh (`enqueueOutbox` ở `packages/db/src/helpers/outbox.ts`).
- Muốn phản ứng với sự kiện → viết một `Subscriber` (`apps/api/src/core/outbox-dispatcher.ts`), thêm vào `defaultSubscribers` ở `apps/api/src/core/subscribers.ts`. Giao ít nhất một lần, nên handler phải idempotent.
- Mẫu subscriber: `createNotificationSubscriber` ở `apps/api/src/modules/notification/index.ts`. Thông báo cho sự kiện mới → `defineNotification` ở `apps/api/src/modules/notification/catalog.ts` (xem "Module 6: Thông báo"); không ghi thẳng bảng `notifications`.
- Dispatcher xử lý từng sự kiện nối tiếp nhau. **Việc nặng (dựng nhiều bảng, quét nhiều dòng) không chạy trong subscriber.** Đã có lỗi thật: dựng template trong dispatcher làm trễ mọi sự kiện sau, kể cả thông báo mã kích hoạt.
- Việc nặng làm một trong hai cách. Vòng riêng, truy vấn chính là hàng đợi, bỏ nhịp nếu lần trước chưa xong: mẫu `startDealDefaultsLoop` ở `apps/api/src/modules/deal/tree-templates.ts`, gắn vào `apps/api/src/worker.ts`. Hoặc job định kỳ: thêm vào `jobs` ở `apps/api/src/jobs/index.ts` (cron, mẫu `system-heartbeat`).
- Vòng thứ hai theo mẫu này: `startRefillLoop` (điền lại cột gửi xuống khi đổi cây; hàng đợi là cột `dh_tables.refill_pending_at`, subscriber chỉ đánh dấu).
- Dispatcher chạy ba làn, mỗi làn một vòng (`startOutboxDispatcher`, `DispatchOptions.lane`, kiểu `Lane`): `interactive` (`auth.*`, `notification.*`, người đang chờ mã kích hoạt), `derived` (`datahub.formula.recalculated`, `datahub.merge.synced`: tính lại ghi hàng chục nghìn sự kiện, chỉ bên nghe đọc) và `bulk` (còn lại, gồm sự kiện khởi động việc tính lại như `row.created`). Một lô `bulk` nặng (thành viên mới được chép bảng mặc định, vài giây) không giữ mã kích hoạt. Gọi `dispatchOutboxOnce` không có `lane` thì lấy tất cả (test).
- Sự kiện chỉ nói "cái này đã đổi, đọc lại" (`datahub.structure.changed`) khai `coalesce: true` ở `EventDef`: `enqueueOutbox` không ghi lần hai khi đã có sự kiện y hệt đang chờ (không bị dispatcher khoá). Dựng một cây mặc định ghi ~450-890 sự kiện, 90% trùng nhau; dispatcher nối tiếp mất 5-7 giây, sự kiện sau đó (mã kích hoạt, tính lại công thức) chờ theo. Sự kiện mang dữ liệu đổi (`row.*`, `formula.recalculated`) không bao giờ gộp.
- **Khoá cột công thức, tránh deadlock** (`apps/api/src/modules/datahub/change-queue.ts`). Mọi transaction có thể ghi vào hàng đợi tính lại (lệnh qua executor, subscriber/vòng của worker, tính lại cột) mở bằng `columnTx(db, fn, { bulk? })`, không `db.transaction` trơn. Trong `columnTx`, `touchColumns` chỉ gom id; cuối transaction (`flushTouches`) khoá **một vòng, sắp theo id** rồi cập nhật. Nhiều lời gọi `touchColumns` rải trong một transaction mà khoá từng vòng thì hai transaction khoá ngược thứ tự sẽ deadlock (đã gặp: `datahub.formula` với dựng cây). Khoá bằng `FOR NO KEY UPDATE`, không `FOR UPDATE`: chèn vào `dh_change_queue` đã giữ `FOR KEY SHARE` trên cột (khoá ngoại), `FOR UPDATE` xung đột với nó. Transaction đã cập nhật cột của chính nó (kết thúc tính lại) gọi `lockColumnsAtFlush` để cột đó vào cùng vòng sắp. Đọc trạng thái cột (`calc.status`) ngay trong transaction thì gọi `flushTouches` trước (xem `reload` ở `columns.ts`). UPDATE nhiều cột không nằm trong `columnTx` thì chọn id `ORDER BY id FOR UPDATE` trước (mẫu `markVolatilePending`). `columnTx` còn chạy lại cả transaction (tối đa 4 lần) khi Postgres chọn nó làm nạn nhân deadlock (mã 40P01): vòng sắp bỏ được vòng do `touchColumns`, nhưng một transaction có thể đã giữ một dòng cột vì lý do khác (bộ đếm số tự động của `row.create`, sửa cấu trúc của đồng bộ template) trước khi tới vòng. Vì thế `fn` truyền vào `columnTx` chỉ ghi trong transaction, không ghi ra ngoài (`ctx.outside`) trước chỗ có thể deadlock. Test: `apps/api/test/datahub-touch-order.test.ts`.
- **Thứ tự tính lại** (`claimNext` ở `recalc.ts`): cột người dùng yêu cầu đi trước việc dựng nền. `columnTx(..., { bulk: true })` (dựng cây mặc định, đồng bộ template, điền lại cột gửi xuống) ghi `dh_columns.calc_bulk = true`; một lần chạm không bulk hay một lần chạm khác biến nó về `false`. Trong mỗi loại, yêu cầu cũ nhất trước. Việc dựng một cây là hàng trăm cột (hàng đợi từng đạt 700 cột chờ, cột của người dùng chờ 46 giây). Việc nền mới (vòng, subscriber dựng nhiều bảng) nhớ truyền `bulk: true`. **`claimNext` không được so sánh mọi cột chờ với mọi đầu vào chưa sẵn sàng**: nó đọc cột chờ theo thứ tự (`calc_bulk, calc_requested_at, id`, chỉ mục `dh_columns_calc_order_idx`) từng lô `CLAIM_BATCH` (`claimBatchQuery`, LIMIT cắt trước khi kiểm), chỉ kiểm sẵn sàng cho lô, rồi `FOR UPDATE SKIP LOCKED` từng cột sẵn sàng theo thứ tự (kiểm lại đầu vào dưới khoá); lô không có cột sẵn sàng thì lấy lô tiếp. Chi phí một lần claim không phụ thuộc số cột chờ hay ước lượng của planner (bản cũ: 1,5 s/claim ở 1.500 cột chờ).
- Vòng mới phải có `stop()` và được gọi trong `shutdown` của `apps/api/src/worker.ts`.
- Job và worker chạy với `systemActor` (`apps/api/src/jobs/index.ts`), không có người dùng.
- Muốn ghi cài đặt hệ thống từ job → `systemSettings`, đọc → `getSetting` (`packages/db/src/helpers/settings.ts`).

### SSE, file, audit
- SSE chỉ mang tín hiệu (tên sự kiện + id đối tượng), không mang dữ liệu: `SseHub` ở `apps/api/src/http/sse.ts`. Worker gửi qua `pg_notify` bởi subscriber `sse.fanout` (`createSseFanout`). Client nhận ở `useLiveUpdates` (`apps/web/src/lib/session.tsx`): thêm một dòng `on(tên sự kiện, [khoá query])` để làm mới.
- File: lệnh `file.upload.init`, `file.upload.complete`, `file.download.url` ở `apps/api/src/modules/system/files.ts` `fileOperations`. Ghi/đọc phía server → `StorageDriver` (`apps/api/src/storage/types.ts`), tạo bằng `createStorage`. Bảng `files` có chủ, nằm trong chốt chặn truy vấn.
- Idempotency-Key do executor xử lý (`packages/db/src/helpers/idempotency.ts`), lệnh không tự làm.
- Khoá kỳ ghi dữ liệu: `assertPeriodOpen` ở `packages/db/src/helpers/period-lock.ts`. Snapshot: `createSnapshot` ở `packages/db/src/helpers/snapshots.ts`.
- Lọc, sắp xếp, phân trang keyset cho danh sách → `listPage` với `FieldMap` (`packages/db/src/query/keyset.ts`, `packages/db/src/query/filter.ts` `compileFilter`). Tham số danh sách: `listParamsShape` ở `packages/shared/src/filter.ts`.
- Định dạng số, ngày, tiền (múi giờ VN) dùng chung server và web → `packages/shared/src/format.ts` `formatCurrency`. Giờ nghiệp vụ → `businessDate` ở `packages/shared/src/time-filter.ts`.

### Khung test (apps/api/test)
- Dựng app và DB test: `makeApp` ở `apps/api/test/helpers.ts`; HTTP dùng header `devHeaders` (`TestActorResolver` ở `apps/api/src/auth/dev.ts`).
- Dựng org mẫu (Admin, Manager A/B, Leader, User, Guest): `seedOrg` ở `apps/api/test/fixtures.ts`. Đăng nhập thật: `login`. Token: `activeToken`.
- Gọi lệnh như một người, qua executor thật (kiểm quyền, audit, sự kiện): `as` ở `apps/api/test/dh-helpers.ts`. Muốn thấy lỗi → `fails`. Chạy hết outbox và hàng đợi tính lại → `drainOutbox`.
- Tạo actor thủ công → `actorOf` cùng file.
- Mỗi file test bắt đầu với hàng đợi tính lại và outbox trống: `test/file-setup.ts` (khai ở `vitest.config.ts`). Việc còn tồn của file trước không làm file sau chậm.
- **Không khẳng định bằng thời gian đồng hồ trong unit test** (máy bận làm test chập chờn). Khẳng định điều không phụ thuộc máy: số dòng quét (`EXPLAIN (ANALYZE, FORMAT JSON)`, xem `datahub-claim-next.test.ts`), số truy vấn, thứ tự, kết quả. Đo giờ chỉ để báo số trong `progress.md`.
- Không chạy hai lệnh vitest song song, chung DB. Test không dùng DB (như `ban-do-code.test.ts`) thì không bị ràng buộc này.

### UI dùng chung
- `apps/web/src/components/ui/form.tsx`: `Button`, `Input`, `Select`, `Field`, `Modal`, `ConfirmDialog`, `Table`, `Tabs`, `Notice`, `PageTitle`.
- Trạng thái trống, lỗi, không quyền → `EmptyState`, `ErrorState`, `NoAccessState` (`apps/web/src/components/ui/states.tsx`). Chờ tải → `Skeleton`. Thông báo ngắn → `notify` (`apps/web/src/components/ui/toast.tsx`).
- Menu thả, popover, tooltip: `Menu` (`dropdown.tsx`), `Popover` (`popover.tsx`), `Tip` (`tooltip.tsx`). Nhãn nhỏ: `Badge`. Khối nội dung: `Card`.
- Gọi API → `api` và `apiList` (`apps/web/src/lib/api.ts`). Lỗi từ server là `ApiError`, lấy thông điệp bằng `errorMessage`. Tạo query string → `qs`.
- Màu, phông, token giao diện → `apps/web/src/lib/theme.ts` `token`. Gộp class → `cn` ở `apps/web/src/lib/utils.ts`.
- Người đang đăng nhập → `useMe`; ẩn nút theo quyền → `can` (`apps/web/src/lib/session.tsx`). Việc này chỉ để giao diện gọn, server mới là nơi chặn quyền.
- Chuẩn giao diện đầy đủ ở `design/chuan-giao-dien.md`.

### Bảng chính
- `outbox`: hàng đợi sự kiện. `audit_log`: nhật ký chỉ ghi thêm. `row_history`: lịch sử dòng. `idempotency_keys`, `files`, `system_settings`, `period_locks`, `snapshots`, `snapshot_rows`.

### Luật cấm
- Không chạy việc nặng trong subscriber outbox (làm trễ mọi sự kiện sau). Dùng vòng hoặc job riêng.
- Không viết chuỗi mã lỗi hay chuỗi quyền ngoài `ERROR_CODES` và `PERMISSIONS`.
- `emit` sự kiện chưa khai trong `emits` hoặc chưa có trong danh mục thì executor ném lỗi. Query không được emit.
- Không đưa dữ liệu dòng vào payload SSE. Chỉ tên sự kiện và id.
- Thay đổi do công thức tính lại không ghi lịch sử, audit hay đổi `version`.
- Không xoá cứng bản ghi nghiệp vụ. Dùng `softDelete`; bảng không bao giờ xoá cứng đăng ký `neverHardDelete`.
- Ghi tay vào `audit_log` ngoài `writeAudit` và executor là không được; audit chỉ ghi thêm.

## Module 1: Tài khoản, phân quyền

### Actor, vai trò, cây tổ chức
- Actor (ai đang gọi, qua kênh nào) ở `packages/shared/src/actor.ts` `Actor`. Handler nhận `ctx.actor` và `ctx.access`.
- Vai trò và quyền: `ROLES`, `ROLE_PERMISSIONS`, `permissionsFor` ở `packages/shared/src/permissions.ts`. Một người có thể có nhiều vai trò.
- Admin là quản trị hệ thống, không có quyền nghiệp vụ (tạo deal, khoá kỳ, snapshot, tạo datahub...). Luật ở `design/quy-dinh-chung.md` mục "Tài khoản và phân quyền".
- Người dùng: bảng `users`; vị trí trong cây: `org_memberships` (bản ghi có `valid_to` rỗng là hiện tại), quyền bổ sung: `user_permissions`.
- Muốn biết vị trí hiện tại của một người (Manager, Leader) → `currentMembership` ở `apps/api/src/modules/org/view.ts`. Lấy tên hiển thị → `namesOf`. Lấy một người → `getPerson`.
- Muốn lấy cấp dưới (cây của Manager, team của Leader) → không tự query `org_memberships`. Gọi `ctx.access.scope("deal")` hoặc `scope("org")` rồi dùng `scopeSql`. Hàm gốc: `computeScope` ở `apps/api/src/auth/access.ts`.
- Muốn đếm người dưới quyền → `countReports` ở `apps/api/src/modules/org/service.ts`. Đổi vai trò hoặc vị trí → `validatePlacement`, `assertNoOrphans`, `writePlacement` cùng file.
- Muốn lấy mọi người có một vai trò (ví dụ Admin để gửi thông báo) → `activeUsersWithRole` ở `apps/api/src/auth/access.ts`.

### Kiểm quyền và phạm vi dữ liệu
- Kiểm quyền thao tác: khai `permission` trong lệnh, `RoleAuthorizer` (`apps/api/src/auth/access.ts`) kiểm tài khoản, quyền theo vai trò và scope của token. Trong handler cần kiểm thêm → `ctx.access.can(...)`.
- Kiểm theo dữ liệu: `ctx.access.scope(kind)` trả `Scope`. Có bốn loại (`ScopeKind`): `deal` (Admin đọc mọi cây, Manager cây mình, Leader team, User mình), `org`, `org_write`, `owner` (chỉ mình).
- Mọi truy vấn bảng có chủ phải kèm điều kiện phạm vi: `scopeSql(cột chủ, scope)` hoặc `ownedBy(cột chủ, userId)`. Truy vấn có chủ ý trên toàn hệ thống (job, công cụ Admin đã kiểm quyền riêng) → `systemScope()`. Tất cả ở `apps/api/src/auth/access.ts`.
- Một cột `owner` cho một dòng thì kiểm một dòng bằng `scopeIncludes(scope, ownerId)`.
- Muốn đăng ký bảng có chủ mới → `registerOwnedTable("tên_bảng")` ở `apps/api/src/auth/query-guard.ts` (mẫu: `apps/api/src/modules/metrics/index.ts`). Bảng mà quyền phụ thuộc người đọc (khoá phân chia của `dh_rows`) → `registerOwnedTable(tên, { rows: true })`.
- Chốt chặn `checkScopedQuery` (`apps/api/src/auth/query-guard.ts`) chạy ở mọi môi trường ngoài production, nên cả bộ test chứng minh luật. Dấu `/*scope*/` do `scopeSql` và `ownedBy` đặt; `/*scope:system*/` do `systemScope()`; `/*scope:rows*/` do `TableAccess.rows()` của Datahub đặt, ngoài ra có vài truy vấn viết tay mang dấu này. Bảng `rows: true` chỉ chấp nhận `scope:rows` hoặc `scope:system`.
- **Chốt chặn chỉ kiểm dấu, không kiểm điều kiện.** Truy vấn viết tay mang `/*scope:rows*/` vẫn qua chốt dù thiếu điều kiện. Vì vậy truy vấn đó phải tự có điều kiện chủ (`d.owner_id = …`) hoặc `readableRows` (mẫu `apps/api/src/modules/datahub/lookup-ops.ts`). Opus rà kỹ mọi chỗ như vậy.
- Insert không bị chốt chặn (chủ do code gán). Lỗi ném ra là `UnscopedQueryError`.
- Admin không đọc dữ liệu Datahub riêng và nhật ký Admin không ghi giá trị dòng: `registerPrivateAuditTarget` (xem Module 0).

### Phiên, token, Guest, chuyển giao
- Đăng nhập web dùng cookie phiên và CSRF: `createSession`, `csrfFor` ở `apps/api/src/auth/sessions.ts`. Gọi API ngoài dùng token tiền tố `soe_pat_` (cá nhân, Admin duyệt) hoặc `soe_svc_` (tài khoản hệ thống). `SessionTokenResolver` biến request thành actor.
- Khoá người hoặc đổi quyền thì thu hồi phiên và token: `revokeUserSessions`, `revokeUserTokens`, cùng file. Token cá nhân không được mang quyền `auth:` hoặc `onboarding:` (`isTokenAllowedPermission` ở `packages/shared/src/permissions.ts`); quyền hiệu lực là giao của quyền tài khoản và scope token (`effectivePermissions`). Vai trò đổi thì `reconcileUserTokens` ở `apps/api/src/modules/org/service.ts` thu hẹp token.
- Mật khẩu: `hashPassword`, `verifyPassword`, `assertPasswordPolicy` ở `apps/api/src/auth/password.ts`. Mã 6 số xin kích hoạt/đặt lại: `issueCode` ở `apps/api/src/modules/auth/codes.ts`.
- Guest mặc định không có quyền. Module cần cho Guest đọc dữ liệu thì đăng ký loại dữ liệu bằng `registerGrantDataType` và gọi `guestCanAccess` trong truy vấn (`apps/api/src/modules/guest/index.ts`). Guest không bao giờ thấy cột cá nhân. Cấp một bảng Datahub kèm cột được thấy (loại `datahub_table`, `options = { table_id, columns }`): `apps/api/src/modules/datahub/guest-access.ts` `guestTableView` đọc cấp, `apps/api/src/modules/datahub/access.ts` `loadTableAccess` với `opts.guest` dựng `TableAccess.guest` (cột, phạm vi team, kênh); chỉ lệnh đọc truyền `guest`. Thêm đường đọc bảng cho Guest thì phải truyền `guest` và đi qua `canSeeColumn`/`TableSchema`. Web (4.7B2): Manager cấp ở `apps/web/src/pages/guest.tsx` `GrantForm` (loại `datahub_table`: chọn datahub, bảng, cột; lỗi `grant_*` dịch ở `GRANT_REASONS`); Guest xem ở `apps/web/src/pages/guest-data.tsx` (`/du-lieu-duoc-cap`, danh sách từ `guest.grant.mine`, lưới dùng lại `LoadedTable` của `table-view.tsx`, không có ô tìm kiếm). Màn import: cột đích kiểu Người dùng/Liên kết ở `apps/web/src/pages/datahub/import-dialog.tsx` (`TARGETABLE`, `LinkByPicker` gửi `link_by`).
- Chuyển giao dữ liệu giữa hai tài khoản (Admin): module có dữ liệu có chủ đăng ký `registerTransferHandler` (`apps/api/src/modules/transfer/index.ts`, mẫu `fileTransferHandler`; Datahub: `apps/api/src/modules/datahub/transfer.ts`).
- Thông báo trong ứng dụng: bảng `notifications` (chủ là người nhận). Mọi thông báo đi qua `notify.send` (xem "Module 6: Thông báo"); loại: `NOTIFICATION_TYPES` ở `apps/api/src/modules/notification/catalog.ts`.
- Cài đặt hệ thống: định nghĩa `SettingDef` (khoá, nhãn, `schema` zod, mặc định), đăng ký `registerSettings(...)` ở `apps/api/src/modules/system/settings-catalog.ts` (mẫu: `registerSettings` trong `apps/api/src/modules/metrics/index.ts`). Đọc → `readSetting`. Ghi bằng lệnh `system.setting.set`, sai kiểu bị `schema` từ chối.
- Module chỉ đăng ký setting qua `import` module đó trong `apps/api/src/modules/index.ts`, nếu không API không thấy setting trong catalog.

### Bảng chính
- `users`, `org_memberships` (lịch sử vị trí), `user_permissions` (quyền bổ sung), `sessions`, `api_tokens`, `service_accounts`, `auth_codes`, `data_grants` (cấp dữ liệu Guest), `notifications`.

### Luật cấm về phân quyền
- Không SELECT, UPDATE, DELETE thẳng bảng có chủ mà thiếu `scopeSql`, `ownedBy` hoặc `systemScope()`. Chốt chặn `apps/api/src/auth/query-guard.ts` `checkScopedQuery` báo lỗi ngay trong dev và test.
- Không dùng `scope()` thường cho `dh_rows`: bỏ qua khoá phân chia. Phải qua `TableAccess.rows()` (`apps/api/src/modules/datahub/access.ts` `TableAccess`). Chốt chặn cũng chặn.
- Không dùng `systemScope()` trong lệnh người dùng để "cho chạy". Chỉ cho job, worker, công cụ Admin đã kiểm quyền riêng.
- Không tự tính cây hay team bằng query `org_memberships` rải rác. Một nơi tính: `computeScope`.
- Không kiểm quyền chỉ ở web. `can` ở web chỉ ẩn nút; server kiểm ở `permission` của lệnh và scope trong handler.
- Admin không có quyền nghiệp vụ ghi: tạo deal, tạo datahub, tạo form, khoá kỳ, snapshot. Hiện Admin chỉ có `deal:deal:read`, `deal:template:manage` và `datahub:datahub:use` (dùng chung của mọi thành viên). Thêm quyền nghiệp vụ khác cho admin trong `ROLE_PERMISSIONS` là đổi quy định chung, phải hỏi Dương.
- Hai Manager không thấy dữ liệu của nhau; Admin đọc Deal mọi cây chỉ-đọc, không đọc Datahub riêng.
- Token và tài khoản hệ thống không được mang quyền ngoài `SERVICE_ACCOUNT_PERMISSIONS` (service) hay `auth:`/`onboarding:` (token cá nhân).
- Lệnh về mật khẩu, phiên, token, kết nối AI đặt `aiAllowed: false` (kênh mcp bị chặn ở executor).
- Người rời đi thì khoá tài khoản (lệnh `org.member.lock`) rồi chuyển giao dữ liệu (`data.transfer.execute`), không xoá.
- Không gửi mã kích hoạt qua email. Mã đi qua thông báo trong ứng dụng, mã hoá trong payload sự kiện (`encrypt` ở `apps/api/src/auth/crypto.ts`).

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
- Giá trị theo người đọc (cột tính đọc sang bảng có khoá phân chia): `apps/api/src/modules/datahub/reader-scope.ts` `refreshReaderScoped`, `overlayRel`; cờ `dh_columns.reader_scoped`; bảng `dh_personal_rows`. Giá trị mỗi người một ô: `dh_person_cells`. Cột công thức đọc cột `storage: person` (cell hoặc range) cũng là `reader_scoped` (`refreshReaderScoped`, cột `src_person`); ô người sửa thì `rows.ts` `applyRowOps` ghi `recordChanges` với `keys` để tính lại đúng dòng. Test: `apps/api/test/datahub-person-formula.test.ts`.
- Hàm người xem `ME()`, `ISME()`, `ATTR()`, `INSCOPE()`, `ATTRSUM()` (Module 2 mục 6.2; `EvalContext.scope()` = id trong phạm vi người xem, `attrSum()`; server `recalc.ts` `buildFormulaEnv` lấy `reader.ids`/`ownerReader.ids`, `user-values.ts` `attrSumOfCell`): hàm ở `packages/formula/src/functions/viewer.ts` (nhóm "Người xem"); ngữ cảnh `EvalContext.me()`, `EvalContext.attr()`; `collectDeps().usesViewer`. Ở server: `recalc.ts` `buildFormulaEnv` (ME = người của lượt tính: `reader.userId`, lượt của chủ là `ix.ownerId`; ATTR đọc `user-values.ts` `attrOfCell`), `row-formulas.ts` bỏ qua công thức dùng ME/ISME (worker tính theo người). Cột dùng ME/ISME là cột phụ thuộc người xem: `computed.ts` `depsOfAst` ghi phụ thuộc giả `~viewer` (`reader-scope.ts` `VIEWER_DEP_KEY`), `refreshReaderScoped` đọc nó, rồi cột đọc cột đó cũng theo (cơ chế `dh_personal_rows` có sẵn). `computed.ts` `checkAttrCalls` kiểm đối số ATTR khi lưu cột. Test: `packages/formula/test/functions.test.ts`, `apps/api/test/datahub-viewer-fns.test.ts`. Không viết cơ chế tính theo người mới, không thêm bảng.
- Nhập dòng có Người/Liên kết: `apps/api/src/modules/datahub/import-refs.ts` `RefResolver` (email, họ tên, `link_by`); email ở ô Người dùng của mọi kênh ghi dòng: `apps/api/src/modules/datahub/rows.ts` `resolveEmails`. Upsert theo cột Duy nhất: op `upsert` ở `applyRowOps`.
- Tính công thức cho MỘT dòng theo người đọc, trong bộ nhớ: `apps/api/src/modules/datahub/recalc.ts` `computeFormulasForRow`.
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
- Công thức `LEFT/RIGHT/MID` trên cột ngày được đổi sang `TEXT(ngày, "định dạng")` khi import, theo định dạng hiển thị của ô (`mm/yyyy`, `dd/mm/yyyy`...): `apps/api/src/modules/datahub/excel-formula.ts` `rewriteDateText`, gọi ở `apps/api/src/modules/datahub/import-job.ts` `decideFormulas`; cảnh báo `displayWarnings` vẫn hiện.
- Thùng rác: `apps/api/src/modules/datahub/trash.ts` `registerDatahubTrash` (bảng thêm vào thùng rác thì đăng ký ở đây, `registerTrashTable` của `@soe/db`).
- Lịch sử dòng: bảng `row_history`, ghi trong `apps/api/src/modules/datahub/rows.ts` `applyRowOps`; đọc `apps/api/src/modules/datahub/rows-read.ts` `rowHistory`.
- Hạn mức: `apps/api/src/modules/datahub/limits.ts` `getLimits`, `quotaExceeded`.

**Mẫu làm theo**
- Thêm lệnh/truy vấn: `defineCommand`/`defineQuery` ở `apps/api/src/core/registry.ts`, đặt trong nhóm `*Operations` của file module (mẫu `apps/api/src/modules/datahub/lookup-ops.ts` `lookupOperations`), rồi gom ở `apps/api/src/modules/datahub/index.ts` `datahubOperations`. Sự kiện mới: `apps/api/src/modules/datahub/events.ts` `datahubEvents`.
- Phát cấu trúc đổi: `apps/api/src/modules/datahub/shared.ts` `emitStructure`. Phát dòng đổi: `ROW_EVENTS`.
- Web: dữ liệu qua `apps/web/src/lib/datahub/api.ts`; lưới dùng `apps/web/src/lib/datahub/rows-store.ts` `RowsStore`.

**Bảng chính**: `dh_datahubs`, `dh_tables`, `dh_columns`, `dh_rows` (ô trong `data` jsonb), `dh_views`, `dh_shares`, `dh_personal_rows`, `dh_person_cells`, `dh_change_queue`, `dh_formula_deps`, `dh_jobs`, `dh_templates`, `dh_merges`, `dh_merge_rows`, `row_history`.

**Người tham gia theo bố trí cột bất kỳ (4.6E)**
- Vai trò `nguoi_tham_gia` là vai trò đa cột (`column-roles.ts` `RoleDef.multi`; chỉ mục `dh_columns_role_uq` bỏ vai trò này, migration 0021): nhiều cột Người dùng cùng giữ. Vai trò mới của Deals: `vai_tro_cua_toi`, `pct_doanh_thu_cua_toi`, `pct_com_cua_toi`, `tinh_deal_cua_toi` (cột công thức dùng `ATTR`/`ISME`/`ME`; bộ mặc định ở `default-templates.ts` `DEALS`).
- Lệnh tiền không đọc `Người tham gia` trực tiếp. `apps/api/src/modules/deal/participants.ts`: `assertComCap`/`assertComTotal(ctx, deals, ..., dealRow)` kiểm trần qua `comCapOf` (cột `tran_com`, rơi về `Tỉ lệ SoE`); `participantsOf` lấy người từ mọi cột `nguoi_tham_gia` và phần chia từng người từ giá trị theo người của các cột vai trò (`dh_personal_rows`; chủ: `dh_rows.data`; cột `storage: person`: `dh_person_cells`); cây cũ chưa có vai trò thì rơi về thuộc tính trong ô. `participantsOf` tính NGAY các cột công thức vai trò cho từng người (cùng các công thức cùng bảng chúng đọc, theo thứ tự phụ thuộc) bằng `apps/api/src/modules/datahub/recalc.ts` `computeFormulasForRow` (đọc dòng với giá trị riêng của người đó, tính trong bộ nhớ, không ghi, không chờ worker). `assertComCap` kiểm tổng `% com` ≤ `Tỉ lệ SoE` (lỗi `com_over_cap`), gọi ở `payment.schedule` và `payment.confirm` ngay sau `participantsOf`. `peopleCell` dựng ô `Người tham gia` của đợt. Dùng ở `payments.ts` (`payment.schedule`, `payment.confirm`). Người tham gia không là thành viên bảng Deals thì lỗi `participant_not_member`.
- Cột người ở nơi khác cũng theo mọi cột vai trò: `forecast.ts` `RoleTable.keys`, `period-guard.ts` (chốt kỳ khoá sửa % doanh thu). Test: `apps/api/test/deal-flexible-layout.test.ts` (ba bố trí).

**Luật cấm**
- Truy vấn `dh_rows` thiếu `acc.rows()` / `acc.rel()` hoặc dấu `/*scope:system*/` (worker, reconcile, dọn thùng rác) bị chặn bởi `apps/api/src/auth/query-guard.ts` `checkScopedQuery`. Chốt chỉ kiểm dấu: truy vấn viết tay mang `/*scope:rows*/` phải tự có điều kiện chủ hoặc `readableRows` (xem Module 1). Bảng mới cần chốt tương tự thì `registerOwnedTable`.
- Cache hoặc khoá phụ thuộc người đọc phải qua `scopeKey`, không tự ghép.
- Chỉ đọc id người qua `userIdsOf`, không đọc `data[k]` như một chuỗi uuid.
- Chỉ đọc/ghi cột qua `sourceOf`; không viết SQL riêng lên `data->`.
- Lỗi số liệu công thức sửa ở nơi tính (`apps/api/src/modules/datahub/recalc.ts`, `apps/api/src/modules/datahub/computed.ts`, `packages/formula`), không vá ở lưới, xuất file, API hay dashboard.
- Không tính lại theo từng màn hình hay từng lần đọc; ghi dòng đi qua `recordChanges` rồi worker tính.
- Dữ liệu người dùng nhập (tạo, sửa, xoá dòng) chỉ ghi qua `apps/api/src/modules/datahub/rows.ts` `applyRowOps`, vì nó lo lịch sử, hàng đợi tính lại, sự kiện và kiểm quyền. Các đường ghi `dh_rows` khác là việc của hệ thống:
  - giá trị công thức: `apps/api/src/modules/datahub/recalc.ts`;
  - bảng gộp: `apps/api/src/modules/datahub/merge-sync.ts`;
  - thùng rác, chuyển giao, đổi cột: `apps/api/src/modules/datahub/trash.ts`, `apps/api/src/modules/datahub/transfer.ts`, `apps/api/src/modules/datahub/columns.ts`;
  - Ngày sửa của cột: `apps/api/src/modules/datahub/field-modified.ts`;
  - tháng Index: `apps/api/src/modules/deal/index-months.ts`.

  Không mở thêm đường ghi riêng cho dữ liệu người dùng.
- Không dùng `scope()` thay `rows()` cho dòng (bỏ qua khoá phân chia).
- Không ghi thẳng vào bảng gộp (chỉ worker).


- Tuỳ chọn cột `notify_on_change` (9B, cột `dh_columns.notify_on_change`, migration 0032): `{ people_column: <mã cột Người dùng> }`, chỉ chủ bảng đặt qua `datahub.column.update` (`updateColumn` trong `columns.ts`). Đọc có nhớ đệm 60 giây theo bảng ở `apps/api/src/modules/datahub/notify-option.ts` (`notifyOptionsOf`, `forgetNotifyOptions`); người nghe: loại `datahub.cell.changed` ở `apps/api/src/modules/notification/catalog.ts` (sự kiện `datahub.row.updated`, gom 10 phút theo người + dòng, người nhận phải xem được dòng qua `rowAudience`). Thêm kiểu cấu hình cột dùng chung thì sửa `DhColumn`, `columnFromDb`, `ColumnOut`/`columnOut`.

## Module 3: Chỉ số, dashboard

**Chỗ gọi vào**
- Chỉ số trỏ cột theo vai trò (`role:<key>` trong `field`, `group_by`, `time.field`, filter) → `packages/metrics/src/columns.ts` `findColumn`; vai trò của bảng do `loadMTable` (`apps/api/src/modules/metrics/context.ts`) điền vào `MTable.roles`.
- Dashboard tính theo quyền người xem (`as_viewer`, mở cho mọi người có chia sẻ datahub) → `DashboardConfigSchema` (`packages/metrics/src/chart.ts`), `viewDash` và `computeCtx` (`apps/api/src/modules/metrics/dashboard-access.ts`); liệt kê qua `metrics.dashboard.shared`.
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
- Guest xem dashboard qua quyền dữ liệu loại `dashboard`, kênh `web`: đăng ký ở `apps/api/src/modules/metrics/index.ts` `registerGrantDataType`, kiểm ở `apps/api/src/modules/guest/index.ts` `guestCanAccess`. Thêm đường đọc nào cho Guest thì phải qua `data_grants` và `guestCanAccess`.
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

_Phần 4.1–4.5. Mỗi bước con sau cập nhật phần của mình trong cùng commit với code._

**Bảng template (mỗi template có bảng chủ và bản sao cho từng thành viên)**
- Tạo template bằng code, không cần request: `apps/api/src/modules/datahub/template-ops.ts` `createTemplateCore`. Thêm cột: `apps/api/src/modules/datahub/template-ops.ts` `addTemplateColumn`. Bảng chủ nhìn như chủ sở hữu: `apps/api/src/modules/datahub/template-ops.ts` `masterAccess`.
- Lệnh registry (`datahub.template.*`) nằm trong `apps/api/src/modules/datahub/template-ops.ts` `templateOperations`. Thêm lệnh theo mẫu `datahub.template.column.create` ở đó.
- Ai sửa được lớp nào: `apps/api/src/modules/datahub/template-ops.ts` `canEditLayer`. Lớp `basic` / `role` / `team` nằm ở bảng chủ; lớp `custom` là cột riêng của một người (`layer_ref` = người đó).
- Đồng bộ chủ → bản sao: `apps/api/src/modules/datahub/template-sync.ts` `syncTemplate`, `syncCopyColumns`; chạy lại cả hệ: `syncAllTemplates`. Người nhận theo phạm vi: `scopeMembers`.
- Cây tổ chức đổi thì template theo: `apps/api/src/modules/datahub/template-ops.ts` `templateSubscriber`.
- Khoá phân chia và chung/riêng của bảng: `apps/api/src/modules/datahub/split-ops.ts` `setShareOptions`. Cờ "Cho phép leader sửa": lệnh `datahub.prefs.get` / `datahub.prefs.set` cùng file; đọc ra cấp dưới sửa được ở `apps/api/src/modules/datahub/access.ts` `loadReader` (`editIds`).
- Sửa được một dòng (`can_edit`) khi người đọc nằm trong cột khoá phân chia của dòng, hoặc người trong cột khoá thuộc `editIds`: `apps/api/src/modules/datahub/access.ts` `canEditRow`. Chủ bảng luôn sửa được.
- Vai trò cột (cột bắt buộc của bộ vai trò `deals`, `payments`, `index`, `com_params`, `ledger`): `apps/api/src/modules/datahub/column-roles.ts` `ROLE_SETS`. Kiểm: `assertRoleOfSet`, `fitsRole`; cột nào đang giữ vai trò: `columnUsage`. Cột có vai trò `required` luôn còn một cột, chỉ chuyển được sang cột khác.
- Hàm dùng chung tìm cột theo vai trò, không theo tên cột. Thêm vai trò mới = thêm vào `ROLE_SETS`.

**Bộ mặc định theo cây (Deals, Index, Probation KPI, Chính sách com, Tham số com)**
- Khai báo bằng dữ liệu: `apps/api/src/modules/deal/default-templates.ts` `BUILTIN_DEFAULT_SET`, kiểu `DefaultTable` / `DefaultColumn`. Mỗi bảng một khối, cột có `role`, `layer`, `autofill`, `split`.
- Thêm bảng mặc định mới (4.4: Đợt thanh toán, Sổ com, Tiền về): thêm một khối vào `BUILTIN_DEFAULT_SET` (kèm `role_set` mới trong `ROLE_SETS` nếu cần). Không viết code dựng riêng cho từng bảng. Công thức là công thức Excel của engine.
- Dựng cho một cây: `apps/api/src/modules/deal/tree-templates.ts` `ensureTreeTemplates` (chạy lại được; bảng đã có tên thì bỏ qua). Cho mọi Manager chưa có cây: `ensureAllTrees`.
- Cây đã tạo không nhận bảng mới của bộ mặc định tự động. Cây đang chạy cần bảng mới thì gọi `ensureTreeTemplates` (bảng trùng tên được bỏ qua), hoặc `ensureAllTrees` chỉ chạy cho Manager chưa có cây nào. **Thêm bảng mặc định mới (Đợt thanh toán, Sổ com, Tiền về ở 4.4) phải có đường đưa nó vào các cây đang chạy**, vì `ensureAllTrees` không tự làm.
- Admin sửa bộ mặc định qua setting `deal.default_templates` (`apps/api/src/modules/deal/tree-templates.ts` `DEAL_SETTINGS`, đăng ký trong `apps/api/src/modules/deal/index.ts`). Sửa chỉ ảnh hưởng cây tạo sau.
- Vòng lặp worker: `apps/api/src/modules/deal/tree-templates.ts` `startDealDefaultsLoop`, nối ở `apps/api/src/worker.ts`. Dựng bảng nặng nên không đặt trong subscriber outbox.
- Datahub "Quản lý Deal" của người dùng: `apps/api/src/modules/datahub/template-sync.ts` `ensureDealDatahub`.

**Kiểu Người dùng có thuộc tính**
- Cấu hình `config.attrs` (`AttrKind`, `UserAttr`): `apps/api/src/modules/datahub/user-values.ts` `userAttrs`, `hasAttrs`. Ô lưu `[{id, attrs}]`.
- Lấy id người từ ô, dù dạng nào: `apps/api/src/modules/datahub/user-values.ts` `userIdsOf`. SQL dùng hàm `soe_dh_ids(cell)` (migration `packages/db/drizzle/0017_datahub_user_ids.sql`). Không tự `->>'id'` trên ô người.
- Ràng buộc `sum_max`, `cap_param` (tham số Tham số com theo ngày) và `cap_role` (trần = giá trị cột vai trò `tran_com` của dòng deal; trần PS/POD nằm trong công thức cột `Trần % com`): `apps/api/src/modules/datahub/people-caps.ts` `checkPeopleCaps`, `capFor`; gọi trong `apps/api/src/modules/datahub/rows.ts` `applyRowOps`.
- Gửi xuống (`autofill`: cột người → cột lưu theo người): `apps/api/src/modules/datahub/pushdown.ts` `pushDownRows`, `pushDownTable`, `refillRows`, `dependentsOf`.

**Status có `meaning`**
- Lựa chọn có `meaning`: open / won / lost / disqualified / converted / cancelled. `apps/api/src/modules/datahub/types.ts` `OPTION_MEANINGS`, `isClosedMeaning`.
- Đọc lựa chọn Status theo `meaning`, không theo tên (Admin đổi tên được). Cột Status tìm theo vai trò `trang_thai`.
- Chuyển giao giữ người cũ ở deal đã đóng: `apps/api/src/modules/datahub/transfer.ts` `datahubTransferHandler`.

**Công thức đọc sang bảng template của người khác**
- Chỉ mục của người sở hữu có cả bảng người khác chia sẻ: `apps/api/src/modules/datahub/computed.ts` `OwnerIndex` (cờ `foreign`; chỉ lớp `basic` và `custom` của chính người đó).
- Dựng nguồn đọc theo người đọc: `apps/api/src/modules/datahub/recalc.ts` `sourceView`. Bảng `foreign` tính bằng quyền chủ (`ownerReader`).

**Job tháng Index**
- `apps/api/src/modules/deal/index-months.ts` `addIndexMonths`; job `deal-index-months` khai ở `apps/api/src/jobs/index.ts` (`jobs`), chạy 00:10 mỗi ngày giờ nghiệp vụ.
- Ghi dòng kiểu hệ thống (không lịch sử, không audit) bằng `apps/api/src/modules/datahub/partial.ts` `recordChanges`. Cần thêm dòng hệ thống vào bảng khác thì theo mẫu này.

**Web**
- Màn Quản lý Deal: `apps/web/src/pages/deal/home.tsx` `DealHomePage`, đọc lệnh `datahub.deal.home` (`apps/web/src/lib/datahub/deal-api.ts` `getDealHome`).
- Trang Template: `apps/web/src/pages/deal/template.tsx` `TemplatePage`; số bảng/cột bị ảnh hưởng: `datahub.template.impact` (`templateImpact`). Vai trò đa cột: `RoleDialog`, `holdersNote` đọc `roles[].columns` / `multi` của `datahub.template.get`. Quyền sửa cột theo lớp phía web: `apps/web/src/lib/datahub/template-ui.ts` `canEditColumnHere`, `canAddColumnHere`.
- Trang Admin bộ mặc định: `apps/web/src/pages/admin.tsx` `DealDefaultsPage`.
- Thêm một màn vào menu Quản lý Deal: sửa `apps/web/src/router.tsx` `router` (đường `/quan-ly-deal/...`), `apps/web/src/pages/shell.tsx` `Shell` (mảng `NAV`, `dealOnly`, quyền ở bảng prefix cùng file).
- Người dùng ở lookup (12B-1): `datahub.people.lookup` (`lookup-ops.ts`) trả `email`, `status`, và `roles`, `team`, `team_id` CHỈ khi người đó nằm trong phạm vi org của người xem (`ctx.access.scope("org")`, như `org.member.get`; ngoài cây là null). `team_id` mới: cả team (trong phạm vi xem, tối đa 200, lọc theo thành viên bảng khi có `table_id`). `datahub.people.teams`: Leader trong phạm vi kèm `member_count`. Guest không có `datahub:datahub:use` nên không gọi được. Export: `user_emails: true` thêm cột "<tên cột> (email)" liền sau cột Người dùng/Người tạo/Người sửa (`export-job.ts` `withEmailColumns`, `cellOf`; không dùng cho Guest được cấp bảng, không có ở xuất tổng hợp). Test: `datahub-lookup.test.ts`, `datahub-export.test.ts`.
- Ô nhiều người trên lưới: `apps/web/src/pages/datahub/grid-cells.tsx` `soeRenderer` (kiểu `persons`); sửa thuộc tính: `apps/web/src/pages/datahub/people-attrs.tsx` `PeopleAttrsEditor`.
- Hộp sửa cột dùng cho cả bảng thường lẫn template: `apps/web/src/pages/datahub/column-editor.tsx` `ColumnEditor` với `ColumnAdapter` (template đưa adapter riêng gọi `datahub.template.column.*`).

**Thanh toán và com theo đợt (4.4)**
- Lệnh `payment.schedule`, `payment.confirm`, `payment.unconfirm`, `commission.adjust`, query `payment.match_candidates`: `apps/api/src/modules/deal/payments.ts` `paymentOperations`, đăng ký ở `apps/api/src/modules/index.ts` `buildRegistry`. Quyền `deal:payment:write` (chỉ Manager). Thêm lệnh thanh toán mới theo mẫu `payment.schedule` ở đó.
- Cách các lệnh tìm bảng và cột: `apps/api/src/modules/deal/payments.ts` `loadTree` (bảng theo `role_set` của cây Manager: `deals`, `payments`, `receipts`, `ledger`), `roleCol` (cột theo vai trò), `write` (luôn qua `applyRowOps`, tự thêm `version`), `readRows`.
- Chấm điểm ghép tiền về (hàm thuần, dễ test): `apps/api/src/modules/deal/payment-match.ts` `scoreCandidates`, trọng số `MATCH_WEIGHTS`.
- Bảng mới trong bộ mặc định: `apps/api/src/modules/deal/default-templates.ts` `BUILTIN_DEFAULT_SET` (Tiền về, Đợt thanh toán, Sổ com). Bảng liên kết vòng dùng `late_columns` (thêm sau khi cả bộ có bảng): `apps/api/src/modules/deal/tree-templates.ts` `addLateColumns`. Cột liên kết khai `config.target_table`, đổi thành id ở `addColumnOf`.
- Đưa bảng mới vào cây đang chạy: `apps/api/src/modules/deal/tree-templates.ts` `ensureMissingTables` (vòng `startDealDefaultsLoop` gọi cả `ensureAllTrees` lẫn hàm này).
- Guard theo `meaning` của lựa chọn, gọi trong `applyRowOps`: `apps/api/src/modules/datahub/status-guard.ts` `guardStatusMeaning` (Won chỉ `opts.system`, Huỷ chỉ chủ bảng), `guardCommitted` (Probation KPI đã commit). Lệnh hệ thống ghi Won bằng `applyRowOps(..., { system: true })`.
- Khoá kỳ cho huỷ xác nhận: `assertPeriodOpen` với `tableId` = bảng Đợt, `scope` = id Manager (4.5 khoá kỳ cùng cách).
- Vai trò cột mới: bộ `receipts`, `kpi`, thêm vai trò vào `payments`, `ledger`, `deals` ở `apps/api/src/modules/datahub/column-roles.ts` `ROLE_SETS`.

**Web thanh toán và com (4.4B)**
- Trang `/quan-ly-deal/thanh-toan`: `apps/web/src/pages/deal/payments.tsx` `PaymentsPage` (ba tab: Đợt thanh toán, Ghép tiền về chỉ Manager, Sổ com). Nút vào ở `apps/web/src/pages/deal/home.tsx` (hiện khi `deal-home` có bảng `role_set = "payments"`). Router: `apps/web/src/router.tsx`.
- Gọi lệnh: `apps/web/src/lib/datahub/payment-api.ts` (`schedulePayments`, `confirmPayments`, `unconfirmPayments`, `adjustCommission`, `matchCandidates`). Giao diện chỉ gửi và hiện kết quả, không tự tính tiền, com, trạng thái.
- Tìm bảng theo `role_set` (lệnh `datahub.deal.home` trả thêm `role_set` của bảng; `usePaymentTables`), tìm cột theo `role` (`useSchema().key("han")`). Ô chọn lưu id lựa chọn: đọc tên bằng `optionName`.
- Lập lịch: `ScheduleDialog` (chọn deal bằng `DealPickerAndSchedule`, hoặc nút "Lập lịch" trong ngăn chi tiết deal). Đợt đã về hiện khoá. Ghép tiền về: `MatchTab`; hàng Tiền về chưa ghép: `UnmatchedReceipts` (đợt chưa liên kết nào); huỷ xác nhận và điều chỉnh com: `InstalmentsTab`, `AdjustDialog`.
- Ngăn chi tiết deal: `DealPaymentsPanel` gắn ở `apps/web/src/pages/datahub/row-panel.tsx` khi `table.role_set === "deals"`.
- Lỗi server hiện bằng `ErrorText`/`errorMessage`, không bắt mã lỗi riêng ở web.
- Hàng đợi điền lại cột gửi xuống khi đổi cây (server): `apps/api/src/modules/datahub/pushdown.ts` `refillSubscriber` (chỉ đánh dấu `dh_tables.refill_pending_at`), `processPendingRefills`, `startRefillLoop` (nối ở `apps/api/src/worker.ts`).
- e2e: `apps/web/e2e/stage4-4.spec.ts`.

**Chốt kỳ (4.5A)**
- Đợt đã về tiền do import (chưa có Tiền về): `period.review` loại `received_unconfirmed`, lệnh `period.confirm_received` ở `apps/api/src/modules/deal/period.ts`, việc làm ở `apps/api/src/modules/deal/payments.ts` `confirmReceivedBatch`, `receivedUnconfirmed`. Mã ngoài của đợt: `payments.ts` `paymentsByExternal` (vai trò `ma_ngoai`).
- Lệnh `period.close`, `period.reopen`, query `period.review`, `period.com`, `period.list`: `apps/api/src/modules/deal/period.ts` `periodOperations`. Dùng chung `loadTree`, `write`, `cellOf` của `apps/api/src/modules/deal/payments.ts`; `openMonthFrom` (kỳ đang mở) và `lockedMonth` cũng ở đó.
- Chốt = hai khoá kỳ (`lockPeriod`: bảng Đợt và bảng Deals, `scope` = id Manager) cộng đổi dòng Sổ com Tạm tính của tháng thành `Com cố định` + `Đã chốt`.
- Chốt chặn ghi, theo vai trò cột, gọi trong `applyRowOps`: `apps/api/src/modules/datahub/period-guard.ts` `guardPeriod` (đợt có ngày tiền về trong kỳ khoá; deal đóng trong kỳ khoá; dòng Sổ com `ledger_closed` / `ledger_adjust`). Lệnh hệ thống (`opts.system`) được miễn.
- Tiền về muộn: cột Đợt `Kỳ ghi nhận` (vai trò `ky_ghi_nhan`), `Kỳ` là công thức đọc nó trước. Điều chỉnh com: cột Sổ com `Kỳ ghi nhận`; `Kỳ` = công thức, `Kỳ của đợt` (`ky_dot`) là lookup.
- Xuất XLSX bảng com: dùng `datahub.export.create` trên bảng Sổ com (`period.com` trả `ledger_table_id`), lọc theo cột `Kỳ`.

**Forecast và snapshot (4.5A)**
- Số liệu forecast và snapshot tính một nơi: `apps/api/src/modules/deal/forecast.ts` `dealFacts` (đọc deal và đợt theo vai trò, quyền hệ thống), `forecastParts` (hai phần đã ký / chưa ký), `quarterOf`. Query `deal.forecast`, `deal.snapshot.list`, `deal.snapshot.compare`, lệnh `deal.snapshot.create`: `apps/api/src/modules/deal/forecast.ts` `forecastOperations`. Quyền `deal:snapshot:create` (Manager). Dashboard 4.6 đọc `deal.forecast`, không tự cộng.
- Snapshot dùng `createSnapshot` (`packages/db/src/helpers/snapshots.ts`), `kind = deal_forecast`, `scope` = id Manager, ghi chú JSON (quý, auto). Job quý: `apps/api/src/modules/deal/forecast.ts` `snapshotAllTrees`, khai ở `apps/api/src/jobs/index.ts` (`deal-quarter-snapshot`, 00:05 ngày 1 tháng 1/4/7/10).

- So sánh phiên bản chính sách com: query `commission.policy.diff` ở `apps/api/src/modules/deal/policy-diff.ts` `policyDiffOperations` (quyền `deal:policy:write`). Bảng `Chính sách com` có bộ vai trò `com_policy`, Deals có vai trò `nguon_lead`, `level_bc`, `performance_bc` (`apps/api/src/modules/datahub/column-roles.ts` `ROLE_SETS`).

- Lọc "deal thuộc kỳ" (bốn cách hiểu, Module 4 mục 11a): tham số `deal_rule` của `time_filter` (`related` / `received` / `closed` / `expected`), kiểu `TimeFilterSchema` ở `packages/shared/src/time-filter.ts`, tính ở `apps/api/src/modules/datahub/time-filter.ts` `timeFilterNode` (cột tìm theo vai trò `ngay_bat_dau`, `ngay_chot`, `ngay_du_kien_chot`, `trang_thai`). `columns` được để `[]` khi có `deal_rule`. Dùng được ở `datahub.row.list`, nhóm, xuất file.

- BANT: cột và quy tắc H-002 là công thức trong bộ mặc định, khai ở `apps/api/src/modules/deal/default-templates.ts` `BANT_COLUMNS` (không có code logic). Hàng chờ "Cần chấm lại hôm nay" là cột công thức `Cần chấm lại` (khác rỗng = cần chấm lại); view "Ưu tiên hôm nay" là filter + sort trên cột `Thứ tự ưu tiên`. Lịch sử mỗi lần chấm là lịch sử dòng (`row_history`) của Deals.

**Web chốt kỳ, so sánh chính sách, kỳ chung, BANT (4.5B)**
- Trang `/quan-ly-deal/chot-ky`: `apps/web/src/pages/deal/period.tsx` `PeriodPage` (tab Chốt kỳ tháng: `ClosePanel`, danh sách cần xử lý `ReviewList`, com theo người `ComByPerson`, xuất XLSX `ComExportDialog` dùng lại `datahub.export.create` lọc cột `Kỳ`, `ReopenDialog`; tab Snapshot dự báo: `SnapshotPanel`, `ComparePanel`). Chỉ Manager (`deal:payment:write`). Nút vào ở `apps/web/src/pages/deal/home.tsx`. Gọi lệnh: `apps/web/src/lib/datahub/period-api.ts`. Giao diện chỉ hiện kết quả server, không tính. 4.7B: `ClosePanel` có `confirmClose` (nút `confirm-and-close`: `confirmReceived` rồi chờ `review.stale` rồi `closePeriod`), loại review `received_unconfirmed`; gọi lệnh `confirmReceived` ở `period-api.ts`.
- Liên kết "Mở dòng" của danh sách cần xử lý dùng `?row=<id>`: `apps/web/src/pages/datahub/table-view.tsx` `OpenTable` mở ngăn chi tiết dòng đó.
- So sánh phiên bản chính sách com: `apps/web/src/pages/deal/policy-diff.tsx` `PolicyDiffDialog`, mở bằng mục "So sánh phiên bản" trong menu "•••" của bảng có bộ vai trò `com_policy` (`table-view.tsx`, quyền `deal:policy:write`).
- Thanh chọn kỳ chung: `apps/web/src/pages/deal/period-bar.tsx` `SharedPeriodBar`; trạng thái và luật nằm ở `apps/web/src/lib/datahub/deal-view.tsx` (`useSharedPeriodState` lưu localStorage, mặc định Quý này; `SharedPeriodContext` do `DealBody` cấp; `periodFilter` chọn bộ lọc theo bộ vai trò: Deals `time_filter.deal_rule`, Index cột `thang`, Probation KPI cột `nam`; `overlayQuery` đặt lên query của view, không ghi vào view). "Không theo kỳ chung" là khoá `own_period` của cấu hình view (`apps/api/src/modules/datahub/collab.ts` `ViewConfigSchema`). Chỉ bảng `deals`, `index`, `kpi` theo kỳ chung; bảng tự tạo chưa theo.
- Nút "Ưu tiên hôm nay", "Cần chấm lại hôm nay": `deal-view.tsx` `quickAvailable`, `overlayQuery` (lọc + sắp, tạm, không lưu), cột tìm theo vai trò `thu_tu_uu_tien`, `can_cham_lai`, `trang_thai`, `ngay_du_kien_chot`. Không có logic chấm điểm ở web.
- e2e: `apps/web/e2e/stage4-5.spec.ts`.

**Cột "của tôi", Index, dashboard Deals (4.6A)**
- Cột Deals/Đợt/Sổ com/Index mới khai ở `apps/api/src/modules/deal/default-templates.ts` (`COM_DU_KIEN`, `COM_CHO_NHAN`, `indexLateColumns`); cột muộn (`late_columns`) cho cột đọc bảng tạo sau. Liên kết Sổ com ghi ở `apps/api/src/modules/deal/payments.ts` `linkLedger`.
- Chỉ số trỏ vai trò: `role:<key>` (`packages/metrics/src/columns.ts` `findColumn`, `MTable.roles` ở `apps/api/src/modules/metrics/context.ts` `loadMTable`).
- Dashboard tính theo người xem: `as_viewer` ở `DashboardConfigSchema`; `apps/api/src/modules/metrics/dashboard-access.ts` `viewDash`, `computeCtx`. Dashboard Deals mặc định: `apps/api/src/modules/deal/default-dashboard.ts` (`ensureDealDashboard` qua lệnh, `ensureDealDashboardForTree` ghi hệ thống). Test: `apps/api/test/deal-com-columns.test.ts`.

**Doanh thu theo người, forecast Leader, dashboard Deals tự dựng (4.6A2)**
- Cột "của tôi" của Sổ com: autofill `present: true` (`apps/api/src/modules/datahub/pushdown.ts` `desiredFor`, `template-ops.ts` `resolveAutofill`), cột `Của tôi` và công thức `Com đã nhận/tạm tính của tôi` ở `default-templates.ts` `LEDGER`.
- Bảng `Doanh thu theo người` (bộ vai trò `revenue`, `column-roles.ts`; `default-templates.ts` `REVENUE`): ghi/xoá ở `apps/api/src/modules/deal/payments.ts` `addRevenueLines`, `revenueLinesOf` (gọi từ `payment.confirm`, `payment.unconfirm`); KPI `Đã đạt` ở `KPI` (`PROGRESS`). Dọn id Sổ com mồ côi: `unlinkLedger`. Test: `apps/api/test/deal-revenue-by-person.test.ts`, `deal-com-columns.test.ts`.
- Forecast cho Leader: `apps/api/src/modules/deal/forecast.ts` `forecastScope` (quyền `deal:forecast:read`, Leader lọc theo `loadReader().ids` và `DealFact.people`). Test: `deal-period.test.ts`.
- Dashboard Deals tự dựng cùng cây: `apps/api/src/modules/deal/default-dashboard.ts` `ensureDealDashboardForTree` (gọi cuối `ensureTreeTemplates`), `DEAL_DASHBOARD_CHARTS`, `DEAL_DASHBOARD_METRICS` (chỉ số cohort CR1/CR2).

**Cycle và cohort chín (4.6B)**
- Query `deal.cycle` (`apps/api/src/modules/deal/cycle.ts` `cycleOperations`): cycle Won 12 tháng theo loại deal (`cycleStats`, `waitDays` mặc định 90 ngày dưới 10 deal), ngày cắt `matureCutoff`. Mọi thành viên của cây đọc (chỉ số ngày). `DealFact.start` (`forecast.ts` `dealFacts`) là Start date. Biểu đồ cohort đánh dấu `options.mature_cohort` (`packages/metrics/src/chart.ts`); web tô nhạt tháng sau `mature_through`. Test: `apps/api/test/deal-cycle.test.ts`.
- Tính lại cột theo người đọc: `apps/api/src/modules/datahub/recalc.ts` `recalcColumn` đọc danh mục của chủ (`OwnerIndex.load`) một lần rồi truyền cho `recalcFormula`/`recalcLink` của chủ và từng thành viên. Không gọi `OwnerIndex.load` trong vòng lặp người đọc.

**Luật cấm**
- Không đọc lựa chọn Status theo tên; dùng `meaning`.
- Không đưa số chính sách com thật vào code, bộ mặc định hay test (bảng chính sách và tham số tạo rỗng; Manager điền).
- Không tìm cột theo tên trong code hệ thống; dùng vai trò.
- Không dựng bảng nặng trong subscriber outbox; dùng vòng lặp hoặc job như `startDealDefaultsLoop`.
- Won không đặt tay (cả Manager): chỉ lệnh thanh toán, qua `opts.system`. Không tự đổi Status bằng `applyRowOps` thường.
- Lệnh thanh toán chỉ ghi cột thường; tổng, trạng thái, kỳ, com là công thức, lookup, rollup (không tự cộng trong lệnh).
- Không viết điều kiện riêng cho một bảng template trong engine; bảng Deal chỉ là bảng thường có vai trò.

**Việc còn nợ của 4.4:** xem `progress.md`.

## Module 5: Kết nối AI (5A1: quyền của kết nối, 5A2: `/mcp`)

**Chỗ gọi vào**
- Bảng ánh xạ một chỗ: `apps/api/src/core/ai-policy.ts` `resolveAiPolicy` gán cho mỗi thao tác menu (`deal`, `datahub`, `notify`, `admin`…, `none` = luôn được, `by_target` = theo datahub đích), mức (`read`/`write`/`full`) và `forbidden` (`hard` hoặc nhóm `org`, `guest_grant`, `transfer`, `settings`, `audit_log`). Mặc định theo tiền tố tên trong `RULES` và theo loại (query là `read`, command là `write`; `FULL` là tập tên cần `full`). `accessOfInput` nâng mức theo input (xoá nhiều dòng một lần).
- Thao tác khai riêng bằng trường `menu`, `access`, `forbidden` của `defineCommand`/`defineQuery` (`apps/api/src/core/types.ts` `OperationDef`); kết quả nằm ở `Operation.ai`. `aiAllowed: false` là cấm cứng.
- Menu theo đối tượng: `apps/api/src/core/ai-gate.ts` `menuOfTarget` tìm datahub đích từ `table_id`, `datahub_id`, `view_id`, `job_id`, `chart_id`, `dashboard_id`, `metric_id`, `source_id` và `table_id`/`source` lồng trong input (metric nội tuyến, nguồn gộp bảng); datahub có `system_key = 'deal'` là menu `deal`, còn lại `datahub`; không tìm được thì đóng.
- Executor giao quyền: `apps/api/src/core/executor.ts` `checkAccess` gọi `checkAiPolicy` (aiAllowed, công tắc khẩn cấp, nhóm cấm), `checkConnection` (trạng thái, giới hạn tốc độ `AiRateLimiter`), authorizer của chủ, rồi `checkMenuAndLevel`. Áp khi `actor.via === "mcp"` hoặc `actor.connectionKind === "personal"` (`isConnectionActor`).
- Chính sách Admin lưu bằng setting hệ thống `ai.killed` và `ai.groups_enabled` (`apps/api/src/modules/system/settings-catalog.ts` `aiKilled`, `aiGroups`).
- Kết nối là hàng `api_tokens` loại `personal` có cột `menus` (`apps/api/src/modules/auth/tokens.ts` `tokenOperations`: `auth.token.create`, `auth.token.narrow`, `auth.token.approve` có `menus` để duyệt bớt). Token `soe_svc_` giữ scope.
- Actor có thêm `connectionKind`, `connectionName` (`packages/shared/src/actor.ts`), do `apps/api/src/auth/sessions.ts` `SessionTokenResolver` đặt. `writeAudit` ghi `connection_name` vào `details`. Nguồn nhập: `apps/api/src/modules/deal/payments.ts` `sourceValue` (cột chọn giữ Tay/AI/API, cột text ghi `AI (tên kết nối)`).

**`/mcp` và tool (5A2)**
- Điểm vào: `apps/api/src/http/mcp.ts` `registerMcp` (POST `/mcp`, JSON-RPC viết tay, không trạng thái; GET/DELETE trả 405). Xác thực chỉ bằng `apps/api/src/auth/sessions.ts` `resolveMcp` của `SessionTokenResolver` (token `soe_pat_`, actor `via: "mcp"`, token chờ duyệt đi qua bắt tay, executor trả `connection_pending` ở mỗi tool). `app.ts` bỏ qua hook nhận diện chung cho đường `/mcp`.
- Tool chung ở `apps/api/src/http/mcp.ts` `genericTools` (`soe_whoami`, `soe_operations`, `soe_describe`, `soe_call`); danh sách tool theo menu kết nối: `tools/list` lọc bằng `need` của `ToolDef`; thao tác nào kết nối thấy: `operationOpen`. Lỗi tool: `toolError` (`{code, message, hint, details}`, `isError: true`).
- Tool chọn lọc ở `apps/api/src/http/mcp-tools.ts` `selectiveTools` (`deals_list`, `deal_get`, `deal_metrics`, `rows_query`, `rows_write`, `metrics_query`). Mỗi tool gọi lệnh registry qua `ctx.call`/`ctx.callRaw` (executor), không có luật quyền riêng.
- `deal_metrics` đọc dashboard hệ thống Deals qua lệnh `deal.dashboard` (`apps/api/src/modules/deal/dashboard-ref.ts` `dealDashboardOperations`) rồi `metrics.dashboard.view` + `metrics.chart.data`.

**Thêm tool chọn lọc (mục 4.8)**
- Thêm một `ToolDef` vào `selectiveTools()` ở `apps/api/src/http/mcp-tools.ts`: `name`, mô tả tiếng Anh ngắn, `inputSchema` viết tay, `annotations` (`readOnlyHint` cho đọc), `need` (menu và mức tối thiểu; `null` = luôn có), `run(ctx, args)`. Mọi thao tác mà tool gọi phải qua được cổng menu của `ai-gate.ts` cho menu trong `need` (thao tác `by_target` cần `table_id`/`datahub_id` trong đầu vào). Cột tìm theo tên hoặc vai trò bằng `pickCol`; kết quả bảng bằng `tableOut` (`{columns, rows, total, next_cursor}`, `_id` và `_version` đứng đầu). Tối đa 30 tool chọn lọc.
- Test: `apps/api/test/mcp.test.ts` (hàm `connect` tạo kết nối và gọi tool qua HTTP).

**Mẫu làm theo**
- Thao tác mới: nếu tên khớp `RULES` thì không cần khai gì; không khớp thì khai `menu` (và `access` nếu khác mặc định), nếu không `aiAllowed` bật sẽ fail ở `apps/api/test/ai-connections.test.ts` (test "mọi thao tác").
- Test kết nối qua executor: `apps/api/test/ai-connections.test.ts` hàm `conn` (token có menu, actor có `connectionId`); `apps/api/test/fixtures.ts` `activeToken` (tham số `menus`) và `setAiPolicy`.

**Luật cấm**
- Không kiểm quyền của kết nối ở handler; chỉ executor. Không tìm menu theo tên thao tác cho thao tác của engine Datahub (dùng `by_target`).
- `aiAllowed: false` cho chốt kỳ, mở lại kỳ, xác nhận tiền về hàng loạt, sửa template, chuyển vai trò cột (thao tác lớn dời, Module 5 mục 12).

**Import qua AI (5B)**
- `apps/api/src/modules/datahub/import-job.ts` `importOperations`: `analyze`, `sheet`, `preview` khai `menu: "datahub"`, `access: "read"`; `start` theo `mapping`: `apps/api/src/core/ai-gate.ts` `menuOfTarget` rẽ sang `importMenu` khi input có `mapping`; `apps/api/src/core/ai-policy.ts` `accessOfInput` nâng `full` khi có sheet `write: "replace"`.

**Web (5B)**
- Người dùng: `apps/web/src/pages/account.tsx` `TokensPage` (tạo kết nối chọn menu và mức qua `CONNECTION_MENUS`, `LEVELS`; lệnh cài `installCommands`; thu hẹp `NarrowForm`; bảng `TokenTable` cột Menu và mức). Thêm menu mới vào `CONNECTION_MENUS` khi module của nó có.
- Admin: `apps/web/src/pages/admin.tsx` `TokenApprovalPage` (Duyệt bớt quyền `ApproveNarrow`, chính sách `AiPolicyCard` ghi `ai.killed`, `ai.groups_enabled` qua `PUT /system/settings/:key`); nhật ký hiện `details.connection_name` ở `ActorCell`.
- e2e: `apps/web/e2e/stage5.spec.ts`.

## Module 6: Thông báo (6A1: cửa vào, loại, nhắc hẹn; 6A2: bản tin, nhắc hạn, thông báo chung)

**Chỗ gọi vào**
- Một cửa vào: `apps/api/src/modules/notification/notify.ts`. `notify.send(db, { type, recipients, render, object?, priority?, actor?, via?, canView?, sourceEventId? })` tạo thông báo và đưa tín hiệu SSE vào outbox. Cửa lọc theo thứ tự: không phải `person` hoặc `Đã khoá` thì bỏ; người gây ra (`actor`) không nhận, trừ loại `selfNotify` (nhắc hẹn); loại không bắt buộc mà người nhận đã tắt thì bỏ; `canView` trả false (mất quyền xem đối tượng) thì bỏ. `render(recipient, by, ctx)` sinh nội dung **riêng cho từng người nhận**; `by` là "Tên" hoặc "Tên (qua <kết nối>)" (tên kết nối đọc từ `actor.connectionId`). `recipients` là id hoặc `{ userId, key, ctx }` (`key` phân biệt nhiều thông báo cùng loại cho một người từ một sự kiện, ví dụ mỗi deal một cái). `sourceEventId` + người nhận (+ `key`) là khoá chống trùng.
- Khai loại: `defineNotification({ type, category, on, recipients, render, priority, mandatory, object, canView, selfNotify })` ở `apps/api/src/modules/notification/catalog.ts`. `on` là tên sự kiện outbox (hoặc mảng); không có `on` thì loại chỉ gửi trực tiếp bằng `notify.send` (job, nhắc hẹn, kết thúc import/export). `recipients(ev, { db, secret })` và `render(ev, người nhận, by, ctx, deps)` nhận `OutboxRow`. Thêm tên loại vào `NOTIFICATION_TYPES` cùng file. Subscriber `createNotificationSubscriber` gọi `deliverEvent`, id chống trùng là `stableId(ev.id, type)`.
- Sự kiện chưa có thì thêm `EventDef` vào `notificationEvents` (`apps/api/src/modules/notification/index.ts`, `audience: () => null` nếu không cần tín hiệu SSE), khai `emits` ở lệnh và `ctx.emit`. Đã thêm: `auth.account.locked` (ghi bằng `enqueueOutbox(ctx.outside)` vì lệnh đăng nhập thất bại bị rollback), `deal.payment.confirmed` (`payment.confirm`, mang tên deal + người tham gia, không mang số tiền), `metrics.dashboard.share.changed`.
- Thông báo theo thay đổi dòng không có sự kiện riêng: đọc `row_history` của đúng giao dịch (`date_trunc('milliseconds', at) = ev.createdAt`, history và outbox cùng giờ giao dịch). Người tham gia deal (cột vai trò `nguoi_tham_gia`: thêm / đổi thuộc tính / bỏ), Probation KPI sửa sau commit (bảng có cột vai trò `trang_thai_commit`; người nhận là người ở `dh_tables.key_columns` của dòng) làm theo cách này: xem `participantChanges` và `kpiEditedAfterCommit` ở `catalog.ts`. **Nội dung không mang giá trị ô**: chỉ tên deal/bảng, không số, không com.
- Import/export xong: `notifyJobEnd` (`catalog.ts`) gọi ở `apps/api/src/modules/datahub/jobs.ts` `runOne` (lỗi gửi thông báo chỉ ghi log).
- Cài đặt người dùng: bảng `notification_settings` (`disabled_types`, `morning_digest`); đọc `readSettings(db, userId)`; lệnh `notification.settings.get/set`; loại bắt buộc không tắt được (lệnh từ chối, cửa vẫn gửi). 6A2 đọc `morning_digest`.
- Dọn: `purgeNotifications` (đã đọc 90 ngày, chưa đọc 180 ngày; `KEEP_READ_DAYS`, `KEEP_UNREAD_DAYS`).

**Nhắc hẹn** (`apps/api/src/modules/notification/reminders.ts`)
- Bảng `reminders` (người, nội dung, `due_at` là lần nhắc kế tiếp, `repeat`, `weekdays` ISO 1–7, `anchor_day`, `until_date`, đối tượng, `status` pending/fired/done). Lệnh `reminder.create/update/delete/list/done/snooze` (menu `notify`, quyền `notification:manage`). Tính lần kế tiếp: `nextOccurrence` (giờ Việt Nam, hằng tháng ngày 31 rơi vào ngày cuối tháng ngắn).
- Job `notification-reminders` mỗi phút: `runDueReminders` gửi qua `notify.send` (priority `important`, `selfNotify`), id chống trùng = nhắc hẹn + thời điểm, rồi dời `due_at` có điều kiện (`due_at` còn đúng lần vừa gửi) nên chạy hai lần không gửi trùng hay bỏ sót.
- Job khác (`apps/api/src/jobs/index.ts`): `notification-purge` 03:40, `notification-ai-expiring` 08:00 (`notifyExpiringConnections`, một lần cho mỗi kết nối).
- MCP: `reminder_create`, `notifications_list` ở `apps/api/src/http/mcp-tools.ts`. Test: `apps/api/test/notify.test.ts`.

**6A2: bản tin, nhắc hạn Deal, thông báo chung**
- Bản tin 08:00 và nhắc hạn 08:30: `apps/api/src/modules/deal/due.ts` `runMorningDigest`, `runDueRules` (job `notification-morning-digest`, `deal-due-rules` ở `apps/api/src/jobs/index.ts`). Đọc bảng Deals/Đợt thanh toán của cây Manager theo **vai trò cột** bằng `roleTable` (`forecast.ts`), quyền xem người nhận qua `visibility` (khoá phân chia: `loadReader`), gửi qua `notify.send` (`canView`). Ngày đọc bằng `dateOfCell` (giờ Việt Nam). Chống trùng: `sourceEventId` = `stableId("deal.due", quy tắc, mốc, ngày)` + dấu chạy theo ngày ở `system_settings` `deal.due_rules.last_run:<manager>` (chạy bù hôm qua).
- Quy tắc nhắc hạn: `DEFAULT_RULES`, lưu ở `system_settings` `deal.due_rules:<manager>` (`rulesOf`); lệnh `deal.due_rules.get` (`deal:deal:read`) và `.set` (`deal:payment:write`, chỉ Manager của cây). Thêm quy tắc mới: thêm vào `RULE_KEYS`, `DEFAULT_RULES`, `rowsDue`, `TEXT` (cùng file).
- "Leading" = vai trò của người trong cột `nguoi_tham_gia` đọc từ cột vai trò đã lưu (`storedRoles`/`personValues` ở `apps/api/src/modules/deal/participants.ts`, hàng loạt; cây không có cột thì `entryRole`), cùng nguồn với lệnh tiền; không so tên cột.
- Thông báo chung: `apps/api/src/modules/notification/announcements.ts` (bảng `announcements`, `announcement_recipients`, migration 0025), lệnh `announcement.send/.recall/.list_sent/.list_received/.read_status` (quyền `notification:announce`; `aiAllowed: false`). Phạm vi kiểm ở `expand`. Đã đọc = thông báo của người đó không còn `read_at` rỗng.
- Test: `apps/api/test/notify-digest-due.test.ts`.

**6B: giao diện** (`apps/web/src/pages/notify/`)
- `inbox.tsx`: `BellButton` (đếm chưa đọc, hộp 20 thông báo, toast khi có thông báo `important` mới: so với danh sách đã thấy, vì SSE chỉ mang tín hiệu) và `NotificationsPage` (`/thong-bao`, lọc nhóm, phân trang keyset). `reminders.tsx`: `RemindersPage` (`/nhac-hen`), `RemindMeButton` (gắn vào `RowPanel`, dùng chung cho deal và dòng datahub), `ReminderForm`. `settings.tsx`: `/tai-khoan/thong-bao` (loại thông báo, bản tin, quy tắc nhắc hạn của Manager). `announcements.tsx`: `/thong-bao-chung`.
- Link thông báo mở thẳng trang đích; trang đích (`DealHomePage`, `DatahubPage`) tự hiện `NoAccessState` khi mất quyền hay đã xoá. `?quick=priority` đọc ở `table-view.tsx`.
- Xác nhận trong ứng dụng: `ConfirmDialog` (`form.tsx`); luật lint `no-alert` bật cho `apps/web`.

**Luật cấm**
- Không `INSERT` thẳng vào `notifications` (trừ `notify.send`). Không đưa giá trị ô hay com của người khác vào nội dung. Không dùng `window` của người gây ra để lọc người nhận ở nơi khác: lọc ở cửa vào.

## Module 7: Dynamic Form (7A1: form, bảng đích, xuất bản, gửi bài, endpoint công khai, nháp; 7A2: bài kiểm tra, chấm, JSON, MCP, nhân bản, chuyển giao)

**Chỗ gọi vào**
- Module: `apps/api/src/modules/form/` (đăng ký ở `apps/api/src/modules/index.ts` qua `formOperations`). `config.ts` = cấu hình `soe-form/1` (zod `FormConfigSchema`, `QuestionSchema`), `flatten`, `visibleBlocks` (server tính lại điều kiện), `evalCondition` (cú pháp lọc Module 0, bỏ phép ngày tương đối), `publicConfig` (bản gửi người điền, bỏ `column_id`, đáp án, điểm, `quiz`). `shared.ts` = `loadOwnForm`, `liveColumns`, `stateOf` (trạng thái người điền thấy: nháp/đang nhận/tạm dừng/đóng/chưa mở; bảng đích bị xoá thì tạm dừng, khôi phục bảng thì tự chạy lại). `ops.ts` = lệnh của chủ form (`form.form.*`, `form.question.*`), `checkPublish` kiểm khi xuất bản. `fill.ts` = người điền (`form.fill.get`, `form.response.submit`, `form.draft.*`, `form.public.*`).
- Muốn ghi một phản hồi → `apps/api/src/modules/form/fill.ts` `submitResponse` (không tự gọi `applyRowOps` ở nơi khác): nó dựng `TableAccess` của CHỦ bảng, gọi `applyRowOps` với actor `via = form` (hoặc `api`/`mcp` khi nộp bằng token), người tạo = người điền hoặc tài khoản "Form công khai" (`PUBLIC_FORM_USER_ID`, `packages/db/src/schema/forms.ts`). Lỗi của bảng (thiếu bắt buộc, trùng cột Duy nhất) được đổi sang `details.question_id` ở `remapError`.
- Muốn thêm kiểu câu hỏi → thêm vào `INPUTS` và `compatibleTypes` (`config.ts`); kiểu ô nhập bằng kiểu cột Module 2.
- Muốn tạo cột từ câu hỏi → `apps/api/src/modules/form/ops.ts` `columnNameFor` (tên làm sạch, trùng thêm ` (2)`) và `createColumnFor` (gọi `createColumn` của Module 2). Cột `Phiên bản form`: `ensureVersionColumn`.
- Tạo bảng cho form: `apps/api/src/modules/datahub/structure.ts` `createTableIn` (lệnh `datahub.table.create` dùng chung). Giới hạn 150 cột: `apps/api/src/modules/datahub/limits.ts` `tableColumnCap`, `FORM_SETTINGS` (`form.table_max_columns`), áp ở `createColumn`, `restoreColumn`, `datahub.table.get`.
- Công khai (không đăng nhập, `permission: null`, `aiAllowed: false`): chống spam ở `fill.ts` `SPAM`, `publicGate` (ô bẫy `website`, token giờ mở `fillToken` ký HMAC, 10 lần/phút mỗi IP trong bộ nhớ `resetSpamState`, giới hạn ngày theo `form_responses`). IP lấy từ `ctx.client` (`apps/api/src/core/types.ts` `HandlerCtx` (trường `client`), đặt ở `executor.ts` `makeCtx`).
- Bảng: `forms` (chủ, bảng đích, trạng thái, mã link, cách mở, người được chọn, tuỳ chọn, bản nháp `draft`, `published_version`), `form_versions`, `form_drafts`, `form_responses` (khoá chống trùng `form_id + attempt_id`), `form_uploads`. Migration `0026_forms.sql`.

**7A2 (bài kiểm tra, chấm, JSON, MCP)**
- Chấm điểm chỉ ở `apps/api/src/modules/form/quiz.ts`: `gradeAnswers` (chấm tự động các câu đang hiện, bỏ câu bị tắt), `rubricPoints` (phiếu tiêu chí), `totals`, `summarize` (thang 100/giữ nguyên, ngưỡng đạt, `pass|fail|pending|none`), `ensureQuizColumns` (cột hệ thống khi xuất bản bài kiểm tra: Điểm, Điểm tối đa, Kết quả, Lần làm, Người chấm là cột Văn bản chứa tên, Ngày chấm), `scoreCells`. Muốn thêm loại đáp án → `autoPoints` + `checkQuiz` (`ops.ts`). Cấu hình: `config.ts` `QuizSchema`, `answer`/`points`/`partial`/`match_accents`/`rubric` ở câu hỏi (đều nằm trong `SERVER_ONLY`, người điền không nhận).
- Móc chấm ở `fill.ts` `submitResponse` (theo bản đã xuất bản của lượt nộp; số lần làm; từ chối token/MCP `quiz_no_ai`; form công khai `quiz_internal_only`). Điểm lưu ở bảng `form_scores` (theo `form_responses.id`, `details` từng câu), ghi cột kết quả cùng lệnh `applyRowOps` tạo dòng.
- Chấm tay, danh sách chờ chấm, bài làm của tôi, phản hồi: `apps/api/src/modules/form/grade.ts` (`form.grade.list/get/submit`, `form.quiz.mine`, `form.response.list`). Người chấm = chủ + `options.graders`. `quizView` là chỗ duy nhất quyết định người làm bài thấy gì (không/điểm/điểm + đáp án khi form đóng). Cập nhật dòng khi chấm: `applyRowOps` bằng quyền chủ, actor là người chấm.
- JSON, nhân bản: `apps/api/src/modules/form/io.ts` (`form.form.export/import/save_json/clone`, `parseFormJson` trả lỗi `issues[{path,message}]`, `matchColumns` ghép câu vào cột theo tên). `ops.ts` `createFormIn` và `createColumnsFor` là chỗ chung tạo form và tạo cột cho câu hỏi.
- MCP: `apps/api/src/http/mcp-tools.ts` `form_get`, `form_save`, `form_responses` (menu `form`).
- Chuyển giao: `apps/api/src/modules/form/transfer.ts` (form đổi chủ cùng datahub). Thông báo (gọi trực tiếp `notify.send`, loại ở `apps/api/src/modules/notification/catalog.ts`): `form.grade.pending`, `form.graded`, `form.question.off` (bắt buộc, theo sự kiện không gộp `datahub.column.deleted` do `datahub.column.delete` phát).
- `forms.table_id` không còn khoá ngoại (migration 0027): xoá cứng bảng khỏi thùng rác không bị form chặn, form tạm dừng "bảng bị xoá", phản hồi giữ nguyên.

**Mẫu làm theo**
- Thêm lệnh của chủ form: một phần tử trong `formManageOperations` (`ops.ts`); chủ = `loadOwnForm`. Menu AI `form` ở `apps/api/src/core/ai-policy.ts` (`/^form\./`), xoá form là mức `full`.
- Test: `apps/api/test/form.test.ts` (gọi công khai bằng `t.c.executor.execute(..., { actor: null, client })`, token mở form `fillToken(t.c.config.AUTH_SECRET, code, Date.now() - 10_000)`).

**Luật cấm**
- Người điền không bao giờ nhận mã bảng, mã cột, tên datahub, đáp án: mọi đường trả cấu hình cho người điền qua `publicConfig`.
- Không ghi dòng của form bằng đường khác `applyRowOps`. Không cấp quyền bảng cho người điền.
- Điều kiện hiện/ẩn chỉ tin server (`visibleBlocks`), không tin trình duyệt.
- Câu chỉ dành cho form nội bộ (`fill_self`, `user`, `relation`): chỉ một chỗ định nghĩa, `ops.ts` `isInternalOnly`/`internalOnlyIssues`; xuất bản, đổi cách mở sang công khai và nộp công khai đều dùng nó. Không viết điều kiện riêng ở nơi khác.

**7B1 (web: danh sách form, trình soạn, chia sẻ/thiết lập/bài kiểm tra, phản hồi, chấm bài)**
- Web: `apps/web/src/pages/form/`. `model.ts` = kiểu cấu hình + helper cây khối (`insertBlock`, `moveBlock`, `dropBlock` cho kéo thả, `visibleIds` = bản trình duyệt của `visibleBlocks` server, `evalCond`) + `FormBrief/FormDetail`. `list.tsx` danh sách + hộp Tạo form (chọn bảng qua `form.form.target_tables`). `editor.tsx` trình soạn (dnd-kit, tự lưu nháp, xuất bản, lỗi xuất bản nhảy tới câu), `props.tsx` thanh thuộc tính (điều kiện, "Khi chọn thì hiện", nối cột, đáp án/điểm, phiếu chấm), `settings.tsx` tab Chia sẻ/Thiết lập/Bài kiểm tra + JSON, `responses.tsx` tab Phản hồi, `grading.tsx` Chấm bài (`/form/cham-bai`) và Bài làm của tôi (`/form/bai-lam?code=`). `renderer.tsx` `FormRenderer` = bộ điền form dùng chung (xem trước, 7B2 trang điền).
- Muốn thêm kiểu câu hỏi ở web → `model.ts` `QUESTION_KINDS` + `renderer.tsx` `QuestionInput` + (nếu có lựa chọn riêng) `props.tsx`.
- Server thêm cho web: `form.form.target_tables` (`ops.ts`, `GET /forms/target-tables`).

**7B2 (mã lựa chọn, trang điền)**
- Lựa chọn lưu **mã**: `config.ts` `optionIdOf` / `canonValue` (giá trị gửi lên -> mã) / `labelValue` (mã -> tên để hiện) / `remapOptionRefs` (đổi tham chiếu khi lựa chọn nhận mã của cột) / `conditionLeaves`. `visibleBlocks` tự đổi tên -> mã nên mọi nơi tính (nộp bài, chấm) thấy mã. Kiểm xuất bản ở `ops.ts` (`condition_option`, `reveal_option`). Luật cấm: không so sánh lựa chọn bằng tên ở chỗ mới, đi qua `optionIdOf`.
- Trang điền `/f/<mã>`: `apps/web/src/pages/form/fill.tsx` (`FillPage`, route trong `apps/web/src/router.tsx`, `apps/web/src/pages/shell.tsx` cho đường `/f/` đứng ngoài Shell). Dùng `FormRenderer`. Công khai: `GET /public/forms/:code`, `POST /public/forms/:code/submit`, tải file `/uploads`; nội bộ: `GET /fill/:code`, `POST /fill/:code/submit`, nháp `PUT/DELETE /fill/:code/draft`. Muốn đổi trang cảm ơn: `fill.tsx` `Filler` (nhánh `done`).

## Module 8: Knowledge, AI Hub (8A: engine Bài đăng, Knowledge, tìm kiếm, MCP review; 8B: skill)

**Chỗ gọi vào**
- Engine chung: `apps/api/src/modules/publish/` (đăng ký ở `apps/api/src/modules/index.ts`). `engine.ts` = cả vòng đời: `saveDraft`, `submit` (chạy kiểm tra, người duyệt tự xuất bản), `decide` (duyệt/trả lại), `unpublish`, `setArchived`, `readPost` (một chỗ quyết người xem thấy bản nào, đếm lượt xem), `listVersions`, `reviewQueue`, `reviewDetail`, `listMine`, `reviewerIds`, `liveFilter` (SQL "bài đã xuất bản người này đọc được"). `kinds.ts` = `registerKind`/`kindOf`. `types.ts` = `PostKind`, `PostIssue {code,message,path,hint}`. `tiptap.ts` = `extractText`, `toMarkdown`, `fromMarkdown`. `secrets.ts` = `findSecrets`, `hasEmail`, `hasPhone`. `ops.ts` = lệnh dùng chung mọi loại: `review.queue|get|decide`, `post.unpublish|archive|restore|versions|version.get|file.url`.
- Knowledge: `apps/api/src/modules/knowledge/`. `kind.ts` = `articleKind` (nội dung, luật kiểm tra lỗi/cảnh báo, tóm tắt, Markdown). `ops.ts` = `knowledge.article.save|submit|get|mine|search|related`, `knowledge.tag.suggest`. `search.ts` = tìm toàn văn (`soe_simple` = `simple` + `unaccent`, cột `posts.tsv`; trigram `<%` cho sai chính tả nhẹ).
- Thêm một loại bài (skill của 8B): viết một `PostKind` (`parse`, `summarize`, `check`, `markdown`, `fileIds`, `perms`, `guestFacet`) rồi `registerKind`; thêm lệnh `<loại>.*` mỏng gọi `saveDraft`/`submit`/`readPost`/`listMine` (mẫu `apps/api/src/modules/knowledge/ops.ts`). Vòng đời, hàng chờ, thông báo, nhật ký, phiên bản không viết lại.
- AI Hub (8B): `apps/api/src/modules/aihub/`. `package.ts` = gói file (`normFiles` đường dẫn an toàn, 50 file, 5 MB; `unpackZip` chặn `..`, kiểm số file/dung lượng khai báo trước khi giải nén, bỏ thư mục gốc duy nhất; `packZip`; `frontmatter` đọc đầu YAML của SKILL.md; `referencedPaths`). `kind.ts` = `skillKind` (nội dung = `files` + name/description/group/tags/clients/version/change_note/replaces; luật mục 4.2 ở `check`; `beforePublish` = hai skill xuất bản không trùng `name`, trừ khi `replaces` trỏ skill đó, khi ấy skill cũ bị lưu trữ). `ops.ts` = `skill.package.save|submit|get|mine|search|download` + tìm skill. Hook mới `PostKind.beforePublish` gọi trong `publishVersion` (`engine.ts`). Tool MCP `skill_search|get|submit` ở `mcp-tools.ts`. Menu `aihub` qua `ai-policy.ts` (`^skill\.`). Cột `posts.download_count` (migration 0029). Bruno `docs/api/bruno/aihub/`.
- Web (8C): `apps/web/src/pages/library/common.tsx` = dùng chung (`IssueList` hiện lỗi/cảnh báo theo `path`, `issuesOf` đọc `details.errors/warnings` của `validation_error`, `RichView` Tiptap chỉ đọc, `Snippet`, `StateBadge`, `EDITOR_EXTENSIONS`). Knowledge `apps/web/src/pages/knowledge/` (`home.tsx` tìm + bài mới/xem nhiều, `read.tsx` đọc + mục lục + liên quan + gỡ/lưu trữ, `editor.tsx` trình soạn Tiptap + Kiểm tra/Gửi duyệt + đính kèm qua `/files`, `mine.tsx` = `MineList` dùng cho cả Bài và Skill của tôi). AI Hub `apps/web/src/pages/aihub/` (`list.tsx`, `detail.tsx` cài/tải zip/lịch sử, `upload.tsx` zip, thư mục, kéo thả). Hàng chờ chung `apps/web/src/pages/review/queue.tsx` (`/duyet`). Menu và quyền: `NAV`, `ROUTE_PERMISSIONS` ở `apps/web/src/pages/shell.tsx` (`a|b` = một trong). e2e: `apps/web/e2e/stage8.spec.ts`.
- Bảng: `posts` (bản sao `live_*` của bản đang xuất bản, `tsv`), `post_versions` (mọi bản, `check_result`). Migration `0028_publish.sql`.
- Menu AI: `apps/api/src/core/ai-policy.ts` (`LIBRARY_OPS`: `review.*`, `post.*` theo loại bài, `libraryMenu` ở `apps/api/src/core/ai-gate.ts` tra `posts.kind`). MCP: `apps/api/src/http/mcp-tools.ts` `knowledgeSearch`, `knowledgeGet`, `knowledgeSubmit`, `reviewQueueTool`, `reviewGetTool`, `reviewDecideTool` (tên tool `knowledge_*`, `review_*`).
- Thông báo: `post.pending|approved|returned` ở `apps/api/src/modules/notification/catalog.ts`, gửi từ `engine.ts`.

**Mẫu làm theo**
- Test: `apps/api/test/knowledge.test.ts` (kết nối MCP bằng `activeToken` + `/mcp`); skill: `apps/api/test/aihub.test.ts` (zip bằng `jszip`).

**Luật cấm**
- Không ghi `posts`/`post_versions` ngoài `engine.ts`. Không đọc nội dung bài bằng SQL riêng: đi qua `readPost` / `liveFilter`.
- Thư viện chung: không lọc theo cây Manager. Quyền duyệt = quyền `*:review` (mọi Manager + quyền bổ sung).
- `review_decide` là mức `full`; không thêm đường duyệt hàng loạt.

## Module 9: Onboarding (9A: lộ trình, công việc, cấp quyền, AI; 9B: checkpoint, đánh giá cuối; 9C: nhắc, thông báo, Theo dõi, lộ trình mẫu; 9D: web)

**Chỗ gọi vào**
- Module: `apps/api/src/modules/onboarding/` (đăng ký ở `apps/api/src/modules/index.ts`: `onboardingOperations`, `onboardingEvents`). `shared.ts` = kiểu đầu vào (`ItemIn`, `StructureIn`), `rights` (ai sửa/xem), `requirePlan`, `guardAi`, tính ngày (`dateOf`, `expand`, `dueAt`) và `syncOccurrences`. `ops.ts` = lệnh `onboarding.plan.{create,save,list,get,clone,assign,stop,delete}`, `onboarding.item.tick`; `writeStructure` ghi cả cây. `grants.ts` `applyGrants(ctx, plan, staffId, "up"|"down")` = tự cấp/hạ quyền form và bảng.
- Bảng: `onb_plans` (trạng thái `draft/active/completed/stopped`, `tree_id` = Manager, `followers`), `onb_stages`, `onb_weeks`, `onb_items` (loại, thứ, lặp, hạn, nhắc trước, form, `share_table`, cột của leader), `onb_occurrences` (ngày thật, `due_at`, `done_at`). Migration `0030_onboarding.sql`.
- Muốn thêm việc cần ngày thật → `syncOccurrences` (không tự INSERT `onb_occurrences` chỗ khác). Muốn cấp quyền khác khi gắn → `applyGrants`, dùng lệnh Datahub (`setShare`, `setShareOptions`, `updateColumn`), không ghi `dh_shares` trực tiếp.
- Câu ẩn "Người điền": `fill_self` ở `apps/api/src/modules/form/config.ts` + `apps/api/src/modules/form/fill.ts` `submitResponse` + `apps/api/src/modules/form/ops.ts` `checkPublish`.
- AI: menu `onboarding` ở `apps/api/src/core/ai-policy.ts`; nhân sự onboard bị chặn bằng `guardAi`; lệnh cấm AI (`aiAllowed: false`): `onboarding.item.tick` (9B thêm xác nhận checkpoint, chốt đánh giá cuối). Quyền `onboarding:path:create` (tạo, sửa, gắn) và `onboarding:path:read` (đọc, tick) ở `packages/shared/src/permissions.ts`.
- Sự kiện: `onboarding.plan.assigned`, `onboarding.plan.ended` (dừng hoặc hoàn thành), `onboarding.item.due` (job nhắc chưa viết).
- Checkpoint (9B): `checkpoints.ts` = đầu vào `CheckpointIn`/`ConditionIn` (bốn dạng `metric`, `weighted`, `vs_items`, `manual`), `writeCheckpoints` (gọi từ `plan.create`/`plan.save`), `copyCheckpoints` (clone, gắn mẫu), `evalCheckpoint`/`statusOf` (tính khi đọc, gọi `runDefinition` của Module 3 bằng quyền chủ form qua `ownerOf`), lệnh `onboarding.progress.get`, `onboarding.checkpoint.confirm`, `onboarding.plan.finish` (hai lệnh sau `aiAllowed:false`). Bảng `onb_checkpoints`; cột `final_result/final_note/finished_by` ở `onb_plans` (migration 0031). Test ca chỉ số: `resetMetricCache()` sau khi thêm dòng (production: worker xoá cache).
- Thông báo và job (9C): `apps/api/src/modules/onboarding/reminders.ts` = `runOnboardingDue` (5 phút: nhắc, quá hạn), `runCheckpointsPassed` (10 phút), `runWeekEnd` (Chủ nhật 20:00); đăng ký ở `apps/api/src/jobs/index.ts`. Loại `onboarding.daily` (gom theo ngày bằng `mergeKey`), `.due`, `.overdue`, `.week_missed` ở `apps/api/src/modules/notification/catalog.ts`. `evaluatePlan(calc, plan)` ở `apps/api/src/modules/onboarding/checkpoints.ts` = tính mọi checkpoint của một lộ trình (cho `progress.get`, job, Theo dõi); `Calc` = `{db, actor}`. Lệnh `onboarding.plan.week_break` (tuần nghỉ). Lộ trình mẫu của Manager/Leader: `apps/api/src/modules/onboarding/sample.ts` (`FORM_SPECS`, `samplePlan` khai báo; `ensureSamplePlan`; vòng `startSamplePlanLoop` ở `apps/api/src/worker.ts`; cột `onb_plans.builtin`). Xuất bản form bằng code: `publishForm` ở `apps/api/src/modules/form/ops.ts`. Trang Theo dõi: `apps/api/src/modules/onboarding/overview.ts` (`onboarding.overview`, dùng `evaluatePlan`, không viết SQL chỉ số riêng).

- Web (9D): `apps/web/src/pages/onboarding/`. `common.tsx` = kiểu (`PlanFull`, `Progress`), `usePlan/useProgress/usePlans`, nhãn, `OnbNav`, `issueAt` (lỗi theo trường từ `details.issues`). `plan-view.tsx` `PlanView({planId, manage})` = Hôm nay / Hành trình / Kết quả (nhân sự và trang nhân sự của Leader; tick, xác nhận tay, tuần nghỉ, dừng, chốt cuối, link chấm mockup). `me.tsx` (`/onboarding`), `follow.tsx` (Theo dõi `/onboarding/theo-doi` + `StaffPage` `/onboarding/nhan-su/$planId`), `plans.tsx` (danh sách, tạo, nhân bản, gắn, xoá), `editor.tsx` (trình sửa, hộp "Tạo form mới"). Menu và quyền route ở `apps/web/src/pages/shell.tsx` (cờ `onboarding`). Mọi số liệu lấy từ `progress.get`/`overview`, web không tự tính checkpoint. E2E: `apps/web/e2e/stage9.spec.ts`.

**Mẫu làm theo**
- Thêm lệnh lộ trình: một phần tử trong `onboardingOperations`, `requirePlan(ctx, id, "view"|"edit")` rồi `guardAi(ctx)` ở đầu. Lệnh chạm bảng/form khai `emits: GRANT_EVENTS`.
- Test: `apps/api/test/onboarding.test.ts` (leader gọi bằng `as(t, id, "web")`, kết nối AI dựng bằng `activeToken` + `actorOf(..., "mcp")`).

**Luật cấm**
- Tuỳ chọn cột "báo khi cột này được sửa" (9B): xem Module 2 và Module 6 (loại `datahub.cell.changed` ở `catalog.ts`). Không viết SQL tổng hợp riêng cho checkpoint: chỉ qua `runDefinition`. Không cấp quyền bảng cho nhân sự bằng đường khác `applyGrants`. Không để AI tick việc, xác nhận checkpoint, chốt đánh giá cuối.
- Lộ trình đang chạy chỉ một cho mỗi nhân sự (chỉ mục duy nhất một phần), kiểm ở `plan.assign`.

## Module 12: Giao diện

- Token (màu, bo góc, bóng, nền quầng): `apps/web/src/index.css`. Chỉ dùng token, không mã màu cứng trong component. Màu theo nghĩa: `ok/info/warn/bad/ai` (+ `-bg`, `-border`, `-dot`).
- Thành phần: `apps/web/src/components/ui/` (`form.tsx` Button/Input/Textarea/Field/Modal/ConfirmDialog/Table/Tabs/PageTitle; `badge.tsx` tone ok/info/warn/bad/ai/primary/muted; `card.tsx`; `states.tsx`; `toast.tsx`; `tooltip.tsx`; `popover.tsx`; `dropdown.tsx`). Ngăn kéo phải: `drawer.tsx` `Drawer({title, open, onClose, dirty?, wide?, footer?})`.
- Thương hiệu: `apps/web/src/components/brand.tsx` (`Brand`, `BRAND_NAME`, `BRAND_SLOGAN`).
- Khung: `apps/web/src/pages/shell.tsx` (`NAV` có icon, `SETTINGS_LINKS`, `SideNav`, `crumbs`). Trang Cài đặt tạm: `apps/web/src/pages/settings.tsx`. Quyết định chi tiết: `design/module12-quyet-dinh-khi-code.md`.
- Select (12A-3): `apps/web/src/components/ui/select.tsx` (`form.tsx` xuất lại `Select`, `SelectChange`). Dùng như `<select>`: `<option>`/`<optgroup>`, `value`/`defaultValue`, `onChange(e)` đọc `e.target.value`. Không có `multiple`. `Popover` có thêm `modal`, `onOpenAutoFocus`; mở popover cần nhận focus từ trong hộp thoại thì dùng `modal` (xem quyết định 12A-3). E2e: `chooseOption`, `openSelect`, `closeSelect`, `expectSelectValue` trong `apps/web/e2e/helpers.ts`; không dùng `selectOption`/`toHaveValue` cho Select.
- Chuông (12A-2): `apps/web/src/pages/notify/inbox.tsx` `BellButton` (popover 3 tab + nút "+" mở Modal tạo). Thành phần dùng chung với trang cũ: `reminders.tsx` `RemindersPanel`/`ReminderForm`, `announcements.tsx` `AnnouncementsPanel`/`ComposeForm`. Menu không còn Nhắc hẹn, Thông báo chung (route giữ).
- Người dùng (12B-1): `apps/web/src/components/ui/person.tsx` (`PersonChip({person, label?})` avatar chữ cái đầu + tên, rê chuột hoặc chạm mở `PersonCard`; `person` chỉ cần {id, full_name}, thẻ tự gọi `lookupPeople({ids})` khi mở; `PersonOption` tên + email dòng 2; `Avatar`), `apps/web/src/components/ui/people-picker.tsx` `PeoplePicker` (`{value: PersonInfo[], onDone(list), onCancel, tableId?, excludeIds?}`) (panel chọn nhiều: gõ tìm, tick, "Chọn cả team", bàn phím; đặt trong Popover `modal` khi nằm trong hộp thoại; mẫu `apps/web/src/pages/datahub/share-dialog.tsx` `AddShare`), `apps/web/src/lib/people.ts` (`PersonInfo`, `disambiguate(people)` → Map id → "Tên (vana.nt)" khi trùng tên, `initialsOf`, `statusLabel`, `roleLabels`). Grid: `LabelCache.shown` (tên đã phân biệt, chỉ để vẽ) và `emails`; copy, tìm, dán vẫn dùng `people` (tên thường); `learnPerson(id, name, email)`.
- Lắp vào màn (12B-2): ô giữ danh sách id người dùng `apps/web/src/components/ui/people-field.tsx` `PeopleField` (`{label, value: string[], onChange, teams?, accept?, excludeIds?, tableId?}`) (mẫu `apps/web/src/pages/form/settings.tsx` `PeopleList`); chia sẻ nhiều người một lần: mẫu `apps/web/src/pages/datahub/dashboard/share-dialog.tsx`; `PeoplePicker` có `teams={false}` và `accept`. Chỗ có id người thì in `PersonChip`, danh sách nhiều người thì `disambiguate` cho `label`. Avatar vẽ chữ cái đầu bằng CSS nên không nằm trong text (e2e `getByText` không dính). Xuất Datahub: `apps/web/src/pages/datahub/export-dialog.tsx` có ô email.
- Cải thiện trải nghiệm (12A-4): URL state `apps/web/src/lib/use-url-state.ts` `useUrlState` (mẫu: `apps/web/src/pages/datahub/list.tsx`, `admin.tsx` AuditLogPage); phím "/" `apps/web/src/lib/search-hotkey.ts` (`searchHotkeyProps` lên ô tìm chính, mẫu `apps/web/src/pages/datahub/view-tools.tsx`); toast hoàn tác `notify.ok(msg, { label, onClick })` (mẫu xoá datahub `apps/web/src/pages/datahub/list.tsx`); `EmptyState cta` và `FilteredEmptyState` (`apps/web/src/components/ui/states.tsx`). Đăng xuất: Shell đặt `closing` trước khi gọi API. Chi tiết: `module12-quyet-dinh-khi-code.md` mục 12A-4.
- Top bar của trang (12B-3): `apps/web/src/lib/page-chrome.tsx` (`useCrumbs(tên)` đặt mắt cuối breadcrumb; `PageChromeContext` do `apps/web/src/pages/shell.tsx` cấp). `PageTitle` (`apps/web/src/components/ui/form.tsx`) trong shell: h1 sr-only, `actions` portal vào `#topbar-actions` (trước chuông; dưới 640px là nút "•••"). Trang mới: dùng `PageTitle` (đừng tự in h1 lớn); tên riêng của trang (datahub, form...) thì `useCrumbs` hoặc truyền làm children của `PageTitle`. Một màn chỉ một nút chính đặc màu.
- Datahub danh sách và trang mở (12C-1), web: `apps/web/src/pages/datahub/list.tsx` (tab `all|mine|shared` trên `?tab=`, `DatahubCard`; câu "Cập nhật…" ở `apps/web/src/lib/datahub/card-text.ts`); `detail.tsx` (`DatahubBody`: nút Nhập dữ liệu/Chia sẻ lên top bar qua `PageTitle actions`; `TableTabs`: công tắc "Dữ liệu | Dashboard" theo đường dẫn, "+" (Thêm bảng, Tạo bảng gộp), `TableList` "Bảng ▾ (n)", `ScrollStrip` cuộn tab); `view-tabs.tsx` `ViewSwitcher` (chọn view + "•••" của view); `view-tools.tsx` `ViewTools` = MỘT thanh công cụ (`lead`, khe `rowSlotRef`, các nút công cụ, `extra`, ô tìm, mật độ, `more`), nút co thành icon theo container query; `table-view.tsx` `ViewBody` ráp thanh + menu "•••" (Nhập, Xuất, Tìm dòng trùng, Thùng rác, Cột của bảng, Thêm cột, So sánh phiên bản), `OpenTable` portal "Thêm dòng", Hoàn tác/Làm lại, thao tác dòng chọn vào khe `rowSlot` (từ 12C-2 Hoàn tác/Làm lại đã chuyển vào "•••", `UndoApi`) (không có khe, như `guest-data.tsx`, thì vẽ dòng riêng), chân bảng số dòng + trạng thái lưu view. View đang mở: `useUrlState({ view })` ở `ViewHost`. Toast: `apps/web/src/components/ui/toast.tsx` (`expand`, tối đa 4, bớt toast thường cũ trước, toast có nút giữ tới hết giờ). E2e: `apps/web/e2e/helpers.ts` `openMore`/`moreAction`/`moreActions`/`expectMore` cho mục trong "•••".
- Datahub panel dòng, grid, hộp thoại, dashboard (12C-2), web: panel dòng `apps/web/src/pages/datahub/row-panel.tsx` `RowPanel` dùng `Drawer` (`apps/web/src/components/ui/drawer.tsx`: `headerExtra`, `subHeader`, `soft`, `width`), nhóm trường "Thông tin" / "Tự động tính", nút dòng trước/sau (`onNavigate`). Grid `apps/web/src/pages/datahub/grid.tsx`: `gridTheme()` đọc token qua `token()`; cột số thứ tự (`markerHandlers`: trái mở panel, phải chọn dòng, Ctrl/Cmd chọn thêm, Shift chọn dải, chạm mở / nhấn giữ chọn; bảng có nhóm giữ ô chọn cũ). Chip lựa chọn `optionChip`/`optionChipVar` ở `apps/web/src/lib/theme.ts` (xanh lá/dương/cam/đỏ/tím theo màu ngữ nghĩa). Thanh công cụ: nút trơn 32px (`ToolButton` ở `apps/web/src/pages/datahub/view-tools.tsx`), nhóm cách nhau `Divider`. Trình sửa cột `apps/web/src/pages/datahub/column-editor.tsx` là `Drawer` 480px, `Section` Cơ bản/Định dạng/Thuộc tính/Nâng cao, công tắc `apps/web/src/components/ui/switch.tsx` `Switch` (checkbox trong suốt đè lên track). Dashboard: nền bento + thẻ ở `apps/web/src/pages/datahub/dashboard/dashboard-area.tsx` và `apps/web/src/pages/datahub/dashboard/grid.tsx`, thanh một dòng = `FilterBar` có `trailing` (`apps/web/src/pages/datahub/dashboard/filter-bar.tsx`), trạng thái rỗng `apps/web/src/pages/datahub/dashboard/empty-dashboard.tsx` `EmptyDashboard`, vùng bấm cột nhỏ `hitArea` ở `apps/web/src/lib/dashboard/echart-options.ts`. E2e: `GridDriver.clickMarker` (chuột phải, `append`) và `openMarker` (chuột trái) ở `apps/web/e2e/grid.ts`. Chi tiết: `module12-quyet-dinh-khi-code.md` mục 12C-2.
- Cài đặt hai cột (12A-2): `apps/web/src/pages/settings.tsx` `SettingsLayout` (shell bọc khi `isSettingsPath(path)`), `SettingsHubPage` (`/cai-dat` chuyển tới mục đầu trên màn rộng). Thêm trang cài đặt mới: thêm vào `SETTINGS_LINKS` và `ROUTE_PERMISSIONS` (shell.tsx), không cần sửa layout.

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
- Mẫu subscriber: `createNotificationSubscriber` ở `apps/api/src/modules/notification/index.ts`. Thông báo cho sự kiện mới → thêm `Notifier` vào bảng `notifiers` cùng file.
- Dispatcher xử lý từng sự kiện nối tiếp nhau. **Việc nặng (dựng nhiều bảng, quét nhiều dòng) không chạy trong subscriber.** Đã có lỗi thật: dựng template trong dispatcher làm trễ mọi sự kiện sau, kể cả thông báo mã kích hoạt.
- Việc nặng làm một trong hai cách. Vòng riêng, truy vấn chính là hàng đợi, bỏ nhịp nếu lần trước chưa xong: mẫu `startDealDefaultsLoop` ở `apps/api/src/modules/deal/tree-templates.ts`, gắn vào `apps/api/src/worker.ts`. Hoặc job định kỳ: thêm vào `jobs` ở `apps/api/src/jobs/index.ts` (cron, mẫu `system-heartbeat`).
- Vòng thứ hai theo mẫu này: `startRefillLoop` (điền lại cột gửi xuống khi đổi cây; hàng đợi là cột `dh_tables.refill_pending_at`, subscriber chỉ đánh dấu).
- Dispatcher chạy ba làn, mỗi làn một vòng (`startOutboxDispatcher`, `DispatchOptions.lane`, kiểu `Lane`): `interactive` (`auth.*`, `notification.*`, người đang chờ mã kích hoạt), `derived` (`datahub.formula.recalculated`, `datahub.merge.synced`: tính lại ghi hàng chục nghìn sự kiện, chỉ bên nghe đọc) và `bulk` (còn lại, gồm sự kiện khởi động việc tính lại như `row.created`). Một lô `bulk` nặng (thành viên mới được chép bảng mặc định, vài giây) không giữ mã kích hoạt. Gọi `dispatchOutboxOnce` không có `lane` thì lấy tất cả (test).
- Sự kiện chỉ nói "cái này đã đổi, đọc lại" (`datahub.structure.changed`) khai `coalesce: true` ở `EventDef`: `enqueueOutbox` không ghi lần hai khi đã có sự kiện y hệt đang chờ (không bị dispatcher khoá). Dựng một cây mặc định ghi ~450-890 sự kiện, 90% trùng nhau; dispatcher nối tiếp mất 5-7 giây, sự kiện sau đó (mã kích hoạt, tính lại công thức) chờ theo. Sự kiện mang dữ liệu đổi (`row.*`, `formula.recalculated`) không bao giờ gộp.
- **Khoá cột công thức, tránh deadlock** (`apps/api/src/modules/datahub/change-queue.ts`). Mọi transaction có thể ghi vào hàng đợi tính lại (lệnh qua executor, subscriber/vòng của worker, tính lại cột) mở bằng `columnTx(db, fn, { bulk? })`, không `db.transaction` trơn. Trong `columnTx`, `touchColumns` chỉ gom id; cuối transaction (`flushTouches`) khoá **một vòng, sắp theo id** rồi cập nhật. Nhiều lời gọi `touchColumns` rải trong một transaction mà khoá từng vòng thì hai transaction khoá ngược thứ tự sẽ deadlock (đã gặp: `datahub.formula` với dựng cây). Khoá bằng `FOR NO KEY UPDATE`, không `FOR UPDATE`: chèn vào `dh_change_queue` đã giữ `FOR KEY SHARE` trên cột (khoá ngoại), `FOR UPDATE` xung đột với nó. Transaction đã cập nhật cột của chính nó (kết thúc tính lại) gọi `lockColumnsAtFlush` để cột đó vào cùng vòng sắp. Đọc trạng thái cột (`calc.status`) ngay trong transaction thì gọi `flushTouches` trước (xem `reload` ở `columns.ts`). UPDATE nhiều cột không nằm trong `columnTx` thì chọn id `ORDER BY id FOR UPDATE` trước (mẫu `markVolatilePending`). Test: `apps/api/test/datahub-touch-order.test.ts`.
- **Thứ tự tính lại** (`claimNext` ở `recalc.ts`): cột người dùng yêu cầu đi trước việc dựng nền. `columnTx(..., { bulk: true })` (dựng cây mặc định, đồng bộ template, điền lại cột gửi xuống) ghi `dh_columns.calc_bulk = true`; một lần chạm không bulk hay một lần chạm khác biến nó về `false`. Trong mỗi loại, yêu cầu cũ nhất trước. Việc dựng một cây là hàng trăm cột (hàng đợi từng đạt 700 cột chờ, cột của người dùng chờ 46 giây). Việc nền mới (vòng, subscriber dựng nhiều bảng) nhớ truyền `bulk: true`.
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
- Guest mặc định không có quyền. Module cần cho Guest đọc dữ liệu thì đăng ký loại dữ liệu bằng `registerGrantDataType` và gọi `guestCanAccess` trong truy vấn (`apps/api/src/modules/guest/index.ts`). Guest không bao giờ thấy cột cá nhân.
- Chuyển giao dữ liệu giữa hai tài khoản (Admin): module có dữ liệu có chủ đăng ký `registerTransferHandler` (`apps/api/src/modules/transfer/index.ts`, mẫu `fileTransferHandler`; Datahub: `apps/api/src/modules/datahub/transfer.ts`).
- Thông báo trong ứng dụng: bảng `notifications` (chủ là người nhận). Tạo thông báo cho sự kiện mới → thêm vào `notifiers` (xem Module 0). Danh sách loại: `NOTIFICATION_TYPES`.
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
- Công thức `LEFT/RIGHT/MID` trên cột ngày được đổi sang `TEXT(ngày, "định dạng")` khi import, theo định dạng hiển thị của ô (`mm/yyyy`, `dd/mm/yyyy`...): `apps/api/src/modules/datahub/excel-formula.ts` `rewriteDateText`, gọi ở `apps/api/src/modules/datahub/import-job.ts` `decideFormulas`; cảnh báo `displayWarnings` vẫn hiện.
- Thùng rác: `apps/api/src/modules/datahub/trash.ts` `registerDatahubTrash` (bảng thêm vào thùng rác thì đăng ký ở đây, `registerTrashTable` của `@soe/db`).
- Lịch sử dòng: bảng `row_history`, ghi trong `apps/api/src/modules/datahub/rows.ts` `applyRowOps`; đọc `apps/api/src/modules/datahub/rows-read.ts` `rowHistory`.
- Hạn mức: `apps/api/src/modules/datahub/limits.ts` `getLimits`, `quotaExceeded`.

**Mẫu làm theo**
- Thêm lệnh/truy vấn: `defineCommand`/`defineQuery` ở `apps/api/src/core/registry.ts`, đặt trong nhóm `*Operations` của file module (mẫu `apps/api/src/modules/datahub/lookup-ops.ts` `lookupOperations`), rồi gom ở `apps/api/src/modules/datahub/index.ts` `datahubOperations`. Sự kiện mới: `apps/api/src/modules/datahub/events.ts` `datahubEvents`.
- Phát cấu trúc đổi: `apps/api/src/modules/datahub/shared.ts` `emitStructure`. Phát dòng đổi: `ROW_EVENTS`.
- Web: dữ liệu qua `apps/web/src/lib/datahub/api.ts`; lưới dùng `apps/web/src/lib/datahub/rows-store.ts` `RowsStore`.

**Bảng chính**: `dh_datahubs`, `dh_tables`, `dh_columns`, `dh_rows` (ô trong `data` jsonb), `dh_views`, `dh_shares`, `dh_personal_rows`, `dh_person_cells`, `dh_change_queue`, `dh_formula_deps`, `dh_jobs`, `dh_templates`, `dh_merges`, `dh_merge_rows`, `row_history`.

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
- Ràng buộc `sum_max` và `cap_param` (Tỉ lệ SoE lấy từ bảng Tham số com theo ngày): `apps/api/src/modules/datahub/people-caps.ts` `checkPeopleCaps`, `capFor`; gọi trong `apps/api/src/modules/datahub/rows.ts` `applyRowOps`.
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
- Trang Template: `apps/web/src/pages/deal/template.tsx` `TemplatePage`; số bảng/cột bị ảnh hưởng: `datahub.template.impact` (`templateImpact`). Quyền sửa cột theo lớp phía web: `apps/web/src/lib/datahub/template-ui.ts` `canEditColumnHere`, `canAddColumnHere`.
- Trang Admin bộ mặc định: `apps/web/src/pages/admin.tsx` `DealDefaultsPage`.
- Thêm một màn vào menu Quản lý Deal: sửa `apps/web/src/router.tsx` `router` (đường `/quan-ly-deal/...`), `apps/web/src/pages/shell.tsx` `Shell` (mảng `NAV`, `dealOnly`, quyền ở bảng prefix cùng file).
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
- Trang `/quan-ly-deal/chot-ky`: `apps/web/src/pages/deal/period.tsx` `PeriodPage` (tab Chốt kỳ tháng: `ClosePanel`, danh sách cần xử lý `ReviewList`, com theo người `ComByPerson`, xuất XLSX `ComExportDialog` dùng lại `datahub.export.create` lọc cột `Kỳ`, `ReopenDialog`; tab Snapshot dự báo: `SnapshotPanel`, `ComparePanel`). Chỉ Manager (`deal:payment:write`). Nút vào ở `apps/web/src/pages/deal/home.tsx`. Gọi lệnh: `apps/web/src/lib/datahub/period-api.ts`. Giao diện chỉ hiện kết quả server, không tính.
- Liên kết "Mở dòng" của danh sách cần xử lý dùng `?row=<id>`: `apps/web/src/pages/datahub/table-view.tsx` `OpenTable` mở ngăn chi tiết dòng đó.
- So sánh phiên bản chính sách com: `apps/web/src/pages/deal/policy-diff.tsx` `PolicyDiffDialog`, mở bằng nút "So sánh phiên bản" trong thanh thao tác của bảng có bộ vai trò `com_policy` (`table-view.tsx`, quyền `deal:policy:write`).
- Thanh chọn kỳ chung: `apps/web/src/pages/deal/period-bar.tsx` `SharedPeriodBar`; trạng thái và luật nằm ở `apps/web/src/lib/datahub/deal-view.tsx` (`useSharedPeriodState` lưu localStorage, mặc định Quý này; `SharedPeriodContext` do `DealBody` cấp; `periodFilter` chọn bộ lọc theo bộ vai trò: Deals `time_filter.deal_rule`, Index cột `thang`, Probation KPI cột `nam`; `overlayQuery` đặt lên query của view, không ghi vào view). "Không theo kỳ chung" là khoá `own_period` của cấu hình view (`apps/api/src/modules/datahub/collab.ts` `ViewConfigSchema`). Chỉ bảng `deals`, `index`, `kpi` theo kỳ chung; bảng tự tạo chưa theo.
- Nút "Ưu tiên hôm nay", "Cần chấm lại hôm nay": `deal-view.tsx` `quickAvailable`, `overlayQuery` (lọc + sắp, tạm, không lưu), cột tìm theo vai trò `thu_tu_uu_tien`, `can_cham_lai`, `trang_thai`, `ngay_du_kien_chot`. Không có logic chấm điểm ở web.
- e2e: `apps/web/e2e/stage4-5.spec.ts`.

**Luật cấm**
- Không đọc lựa chọn Status theo tên; dùng `meaning`.
- Không đưa số chính sách com thật vào code, bộ mặc định hay test (bảng chính sách và tham số tạo rỗng; Manager điền).
- Không tìm cột theo tên trong code hệ thống; dùng vai trò.
- Không dựng bảng nặng trong subscriber outbox; dùng vòng lặp hoặc job như `startDealDefaultsLoop`.
- Won không đặt tay (cả Manager): chỉ lệnh thanh toán, qua `opts.system`. Không tự đổi Status bằng `applyRowOps` thường.
- Lệnh thanh toán chỉ ghi cột thường; tổng, trạng thái, kỳ, com là công thức, lookup, rollup (không tự cộng trong lệnh).
- Không viết điều kiện riêng cho một bảng template trong engine; bảng Deal chỉ là bảng thường có vai trò.

**Việc còn nợ của 4.4:** xem `progress.md`.

# Tiến độ

Cập nhật: 21/11/2026

## Trạng thái

- **Thiết kế:** Module 0–5 và 7 đã chốt. Module 6 bản nháp vòng 2 (21/11, đã ghi mọi ý Dương), chờ Dương chốt. Module 8–11 chưa làm.
- **Code:** Stage 0–3 xong. Stage 4 đang làm: 4.1 xong (20/11); 4.2, 4.3 xong (21/11, Opus rà đạt); bản đồ code Module 0–3 xong (`design/ban-do-code.md`, Opus rà và sửa luật sai, 5999ea3); đang làm 4.4 (thanh toán và com): **4.4A server** (agent 1) → bàn giao → **4.4B web + e2e + cả bộ test** (agent 2). Agent quá ~120 lượt thì dừng ở commit, ghi bàn giao, Opus giao agent mới.
- **Git:** đã push `main` + `dev` tới 154655d (hết bước con 4.1, Dương yêu cầu 20/11).
- **Mốc test** (e817470, 21/11): `pnpm exec vitest run apps packages` 1120 pass, 9 skip (golden + load; 1110 -> 1120 do test mới của 4.3); `pnpm test:e2e --project=desktop` 109/109 (gồm 9 của stage4-3). Không chạy hai lệnh vitest song song (chung DB: chạy chồng làm 5 test hỏng giả).

## Đã xong

- **Stage 0:** monorepo, migration, registry, audit, lịch sử dòng, outbox, worker, SSE, file, OpenAPI.
- **Stage 1:** tài khoản, org chart, vai trò, phiên, mã kích hoạt, token, thông báo, nhật ký, chuyển giao, cài đặt. Quyết định: `design/module1-tai-khoan-phan-quyen.md`.
- **Stage 2** (19/11): Datahub, công thức (106 hàm, golden 3.321/3.322 khớp Excel), tính lại theo phần, grid, view, import/export. Quyết định, số đo: `design/module2-quyet-dinh-khi-code.md`.
- **Stage 3** (20/11): engine metric, bảng gộp, dashboard 22 loại biểu đồ, chia sẻ dashboard, Guest. Quyết định, số đo: `design/module3-quyet-dinh-khi-code.md`.
- **Stage 4, bước con 4.1** (20/11, Opus rà đạt cả 4 phần; Module 4 mục 19a việc 1–21). Chi tiết từng phần: `design/module4-quyet-dinh-khi-code.md` mục 4.1a–4.1d.
  - 4.1a: khoá phân chia, cho phép sửa theo cột, ô Người dùng chỉ nhận thành viên, thêm dòng hàng loạt, SSE lọc theo dòng.
  - 4.1b: Lookup/Rollup/công thức tính theo người đọc, bỏ `PhysicalSource`, bảng gộp từ nguồn có khoá. Load 20 phạm vi: chậm nhất 2,89 s (ngưỡng 3 s). **Triển khai: schema `mfold` thuộc `soe_app`.**
  - 4.1c: hạ tầng bảng template (cờ bảo vệ, lớp cột, vai trò cột, trùng tên, thành viên theo cây/team), Liên kết sang bảng template.
  - 4.1d: giao diện chia sẻ/cột/grid, thu gọn nhóm, xuất tổng hợp, cột "Ngày sửa của cột", đổi tên lựa chọn cập nhật công thức.

## Đang làm: Stage 4 (Module 4, Quản lý Deal), Sonnet code, Opus rà

**Kế hoạch (20/11):** 4.2 server bảng mặc định **xong, Opus rà đạt 21/11** (a2543ed chốt chặn `dh_rows`; 16bb103 kiểu Người dùng có thuộc tính + gửi xuống; 5d6e5db công thức sang bảng template khác chủ; e5d04fa bộ mặc định theo cây + Index tháng + việc để lại từ 4.1; chi tiết `design/module4-quyet-dinh-khi-code.md` mục 4.2); 4.3 giao diện (trang Template, menu Quản lý Deal, màn Deals); 4.4 thanh toán và com; 4.5 chốt kỳ/BANT/forecast/snapshot; 4.6 chỉ số + dashboard Deals; 4.7 API ngoài, nhập lịch sử, Guest; 4.8 kiểm thử cuối.

**4.3 giao diện Quản lý Deal: xong, Opus rà đạt 21/11** (chạy lại cả bộ ở e817470: 1120 pass 9 skip, e2e 109/109; dcf6d0c sửa vòng dựng bộ mặc định chạy chồng lượt). Token: hai agent 38M + 14,6M. Commit: 3386ccd, fd2d337, 7fd73eb (nửa đầu), 132245b (vòng dựng bộ mặc định riêng + `sameStored`), e817470 (thuộc tính cột Người dùng, cột gửi xuống, Manager tạo bảng team, e2e). Quyết định: `design/module4-quyet-dinh-khi-code.md` mục "4.3" và "4.3 nửa sau".
- Có: menu + màn Quản lý Deal, trang Template (bảng, cột, lớp, xem trước "Áp dụng cho N người", vai trò cột, khoá phân chia, Manager tạo bảng cây hoặc team), ô Người dùng có thuộc tính, cột gửi xuống, khoá ô theo `can_edit`/autofill, nhãn lớp cột, trang Admin bộ mặc định.
- **Lỗi gốc đã sửa:** `seedPeople` chập chờn do dispatcher outbox chạy tuần tự, subscriber dựng bộ template mặc định (nhiều giây) chặn thông báo mã kích hoạt sau nó. Giờ là vòng riêng `startDealDefaultsLoop` (worker), seed về 20 lần thử. Opus đọc kỹ: `modules/deal/tree-templates.ts`, `worker.ts`, `core/subscribers.ts`, test trong `deal-defaults.test.ts`.
- **Dời:** nhóm "Quản lý Deal" ở ô chọn nguồn chỉ số (4.6); mục Quản lý của Manager (4.4/4.5); khôi phục cột template chỉ qua nút Hoàn tác. Ô lưới `persons` chưa thử 375px (Stage 12).
- Sau rà Opus: `startDealDefaultsLoop` bỏ nhịp khi lượt trước chưa xong (cờ, không nối chuỗi), có test không chạy chồng/không xếp hàng; `deal-defaults.test.ts` 14 pass (typecheck, lint sạch).
- **Chỗ dở:** không có.

**4.4A server (21/11): phần lớn xong, còn nợ ở dưới.** Chi tiết quyết định: `design/module4-quyet-dinh-khi-code.md` mục "4.4A". Test: `deal-payments.test.ts` (16), `deal-defaults.test.ts` (14), `openapi.test.ts` pass.

**4.4 BÀN GIAO (cho agent 4.4B web, đọc đủ không cần đọc code server)**
- Đã xong: 3 bảng mới (Tiền về, Đợt thanh toán, Sổ com) + `ensureMissingTables` cho cây đang chạy; guard Status (Won hệ thống, Huỷ Manager); Probation KPI khoá sau commit; tháng Index đầu tiên; 4 lệnh + 1 query; Bruno `docs/api/bruno/deal/`; OpenAPI sinh lại; bản đồ code.
- Quyền `deal:payment:write` (chỉ Manager). Mọi lệnh REST `/api/v1`, cần `Idempotency-Key`; ngày `YYYY-MM-DD`; tiền là số; tỉ lệ com là phân số (0,15 = 15%).
- `payment.schedule` POST `/deal/payments/schedule` `{deal_id, payments:[{id?, legal_entity?, tax_code?, contract_no?, seq?, amount (chưa VAT), due, com_split?:[{user_id,pct}]}], remove_ids?}` -> `{deal_id, payments:[{id,seq,amount,due,created}], removed}`. Lỗi: `deal_closed`, `payment_not_of_deal`, `payment_confirmed`, `not_found`, `conflict` (`payment_table_missing`, `role_missing`).
- `payment.confirm` POST `/deal/payments/confirm` `{received_on, receipt:{id? | amount, payer_name?, account_no?, bank?, content?}, allocations:[{payment_id, amount (chưa VAT), amount_received? (gồm VAT), com_split?, shortfall:"split"|"keep"}]}` -> `{receipt_id, payments:[{id, split_off_id}], won_deal_ids, ledger_ids}`. Lỗi: `allocation_sum_mismatch` (tổng amount_received phải bằng số tiền khoản), `payment_already_confirmed`, `deal_closed`, `receipt_amount_required`, `duplicate_payment`.
- `payment.unconfirm` POST `/deal/payments/unconfirm` `{payment_ids}` -> `{payment_ids, reopened_deal_ids, removed_ledger_ids}`. Lỗi: `period_locked` (423), `payment_not_confirmed`, `ledger_not_temporary`.
- `commission.adjust` POST `/deal/commission/adjust` `{payment_id, person_id, amount (có thể âm), reason}` -> `{ledger_id}`.
- `payment.match_candidates` GET `/deal/payments/match?amount&payer_name&account_no&tax_code&content&received_on&limit` -> `[{payment_id, deal_id, deal_name, seq, planned, due, score, strong, reasons[]}]`.
- Bảng của giao diện: đọc/sửa qua `datahub.*` như mọi bảng template (tìm bằng `datahub.template.list`, tên `Tiền về`, `Đợt thanh toán`, `Sổ com`). Giao diện nên gọi lệnh trên thay vì sửa dòng tay cho: lập lịch, xác nhận, huỷ, điều chỉnh. Thành viên thấy bảng Đợt và Sổ com theo khoá phân chia; bảng Tiền về chỉ Manager có dòng (thành viên thấy rỗng).
- Won không chọn tay (lỗi `status_won_system_only`), Huỷ chỉ Manager (`status_cancel_manager_only`), Probation KPI đã commit chỉ Manager sửa kèm `Lý do sửa sau commit` (`plan_committed_manager_only`, `plan_committed_reason_required`).
- **Còn lại (chưa làm, mỗi việc kèm chỗ làm):**
  1. Điền lại cột gửi xuống khi đổi cây tổ chức: dùng `refillRows` (`apps/api/src/modules/datahub/pushdown.ts`); cần vòng riêng như `startDealDefaultsLoop`, không đặt trong subscriber; cần hàng đợi (vd cờ trên `dh_templates`) khi nhận `org.member.changed`.
  2. Công thức theo người cho cột `person` (`Doanh thu tính cho tôi`, `Com dự kiến của tôi`): engine chưa hỗ trợ cột `storage: person` kiểu công thức (`apps/api/src/modules/datahub/template-ops.ts` chặn ở `column.create`); cần thiết kế engine (Module 2) trước.
  3. Cột Index và Probation KPI từ Đợt thanh toán (doanh thu theo ngày tiền về, forecast, Winrate quý; Đã đạt / Còn thiếu / % đạt): thêm công thức vào `apps/api/src/modules/deal/default-templates.ts` (`indexColumns`, `KPI`); cần cột `Loại deal` và `% doanh thu của tôi` đọc được từ Đợt (lookup từ Deals; cột gửi xuống `person` chưa lookup được). Làm cùng việc 2.
  4. Cây dev cũ: Deals vẫn có `Đã thu` / `Ngày tiền về đầu tiên` kiểu thường (xem quyết định 4.4A); dựng lại cây hoặc thêm rollup tay.
  5. `payment.confirm` chưa kiểm tổng `% com` so với `Tỉ lệ SoE` ở lệnh (cột Chia com đợt này có `cap_param` nên `applyRowOps` đã chặn khi có tham số).
- Chỗ dở: không có. Chưa chạy cả bộ vitest và e2e (việc của 4.4B).

Mục tiêu Deals hạ xuống **20.000 deal** (Dương chốt 20/11): load test Stage 4 dùng 20.000 deal, 20 người phạm vi khác nhau, mọi biểu đồ ≤ 3 s; Datahub thường giữ 100.000 dòng.

Các bước sau (Opus chia chi tiết khi tới): thanh toán và com theo đợt (mục 7, 12); chốt kỳ, snapshot, forecast, BANT; chỉ số + dashboard Deals trỏ cột theo vai trò, API ngoài, `data_grants.options` (mục 19 việc 14–16); kiểm thử cuối Stage 4.

## Ghi nhận để sau

- Stage 3: người xem qua chia sẻ dashboard không tự tải lại khi dữ liệu đổi (Stage 4); chữ giữa gauge đè nhãn trục, lọc chéo khó bấm cột < 1 px, thang gauge phần trăm làm tròn ở web (Stage 12).
- 4.1b: đổi cây tổ chức của một người tính lại 3,6 s (đang đánh dấu mọi cột theo người đọc của mọi chủ); thu hẹp khi cần.
- Grid chưa chạy `impeccable audit`, chưa thử trên điện thoại thật (Stage 12).
- Module 2 mục 11 chưa ghi giới hạn 150 cột cho bảng có form (Module 7 mục 1.1a; CLAUDE.md đã ghi). Opus ghi khi rảnh.
- Chưa thử: chuyển cả cây bằng giao diện, link Google Sheet thật, `docker-compose.yml` (máy dev không có Docker), đăng nhập Google thật (`design/ha-tang.md` mục 4). Import cột Liên kết/Người/Đính kèm chưa có.

## Lỗi điện thoại để sau

Không chặn bước con (CLAUDE.md, "Điện thoại là ưu tiên thấp"); gom sửa một đợt, Opus quyết khi nào.

- `stage1.spec.ts` phone "cài đặt hệ thống" từng hết giờ 1 lần; sau f8835de chạy 3 lần liền 16/16 pass. Theo dõi tiếp. Lệnh: `pnpm test:e2e stage1 --project=phone`.

## Câu hỏi còn mở (chờ Dương)

- **Guest xem dashboard (3C-2):** đang dùng cờ `guest_visible` theo từng dashboard (mặc định tắt) để Guest không thấy mọi dashboard của cây. Đúng ý Module 1 mục 5.2 chưa, hay cấp theo từng dashboard ở khung cấp dữ liệu?
- **Nhật ký xem dashboard (3C-2):** ghi một dòng mỗi lần mở dashboard của người khác, không ghi từng biểu đồ. Gọi thẳng `chart.data` không qua `view` thì không có nhật ký.
- **Grid và trình đọc màn hình (2C-1):** Glide không dựng bảng ẩn cho trình đọc màn hình trên React 19. Có bắt buộc không? Nếu có thì phải thêm bảng DOM song song hoặc đổi thư viện.
- **Grid (2C-1):** cột Mã dòng hiện `#<số dòng>`, còn export/API trả uuid; hoàn tác chỉ trong phiên mở bảng.
- **Đối soát công thức (2B+):** ngân sách 1.000.000 dòng/đêm và chờ mặc định 5 s là giá trị tự chọn.
- **Import (2B):** công thức `LEFT(ngày,2)` chỉ được cảnh báo, không tự đổi sang `TEXT(ngày,"mm")`. Có muốn tự đổi không?
- **Module 4 (Opus đề xuất ở 4.6):** công thức theo người cho cột lưu theo người (`Doanh thu tính cho tôi`, `Com dự kiến của tôi`) và các cột Index/Probation đọc Đợt thanh toán: engine Module 2 chưa hỗ trợ, cần thiết kế.
- **Module 4 (4.4A):** cây đã tạo trước 4.4 giữ `Đã thu` là cột thường (engine không đổi cột thường thành rollup); dev dựng lại cây. Bảng Tiền về "chỉ Manager" làm bằng khoá phân chia theo cột `Người xem` luôn trống.
- **Module 4:** màn so sánh phiên bản chính sách com khi AI cập nhật (đề xuất, chưa chốt).
- **Module 6:** vòng 2 chờ Dương chốt; chốt xong cập nhật CLAUDE.md (cột "Cần" Stage 6) theo mục 12 "Thay đổi so với quy định đã chốt".
- **Stage 9 Onboarding:** lúc bắt đầu stage hỏi Dương có kiểm giao diện kỹ như ngoại lệ không; tới lúc đó giữ quy định cũ (kiểm kỹ).
- Danh sách token cần duyệt và tài khoản hệ thống chưa phân trang (giới hạn 500); phân trang ở Stage 5.

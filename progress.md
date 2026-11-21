# Tiến độ

Cập nhật: 21/11/2026

## Trạng thái

- **Thiết kế:** Module 0–7 đã chốt (Module 6 chốt 21/11). Module 8–11 chưa làm.
- **Code:** Stage 0–3 xong. Stage 4 đang làm: 4.1 xong (20/11); 4.2, 4.3, 4.4 xong (21/11, Opus rà đạt); bản đồ code Module 0–3 xong (`design/ban-do-code.md`, Opus rà và sửa luật sai, 5999ea3); tiếp 4.5 (chốt kỳ, BANT, forecast, snapshot).
- **Git:** đã push `main` + `dev` tới 56b1834 (hết 4.4, Dương yêu cầu 21/11).
- **Mốc test** (4.4B): `pnpm exec vitest run apps packages` 1141 pass, 9 skip (c1704f4; sau đó chỉ đổi điều kiện của subscriber refill ở 2630f26, `datahub-user-attrs` 16/16 pass lại); `pnpm test:e2e --project=desktop` 116/116 (2630f26, gồm 7 của stage4-4). Lần chạy e2e đầu (c1704f4) hỏng 2-3 bài ở bước dựng người ("Không thấy mã ... trong hộp thông báo"), mỗi lần bài khác; chạy riêng từng file thì pass; nguyên nhân: subscriber refill đánh dấu mọi sự kiện `org.member.changed`, đã sửa ở 2630f26. Không chạy hai lệnh vitest song song (chung DB).
- **Mốc test, sửa chập chờn sau 4.4 (21/11, b48f898):** vitest cả bộ 1144 pass, 9 skip (88 file pass, 2 skip); `pnpm test:e2e --project=desktop` 116/116 hai lần liên tiếp (8,8 và 8,7 phút). Nguyên nhân gốc e2e: dispatcher outbox một làn bị dựng cây mặc định (450-890 sự kiện, 91% trùng) và dòng sự kiện `formula.recalculated` (23.000+) chiếm, mã kích hoạt và việc khởi động tính lại chờ 5-8 giây. Sửa: gộp `structure.changed` trùng (`enqueueOutbox coalesce`), ba làn dispatcher (`interactive`, `derived`, `bulk`); không phải vòng refill hay `ensureMissingTables`. Nguyên nhân gốc vitest: `org.test.ts` đọc `?limit=500` một trang trong DB dùng chung (655 người, người cuối bị cắt), đổi sang đọc hết trang; lỗi `datahub-reader-scope` của Opus không tái hiện được (3 lần chạy cả bộ pass), chưa rõ nguyên nhân. `stage4-3` sửa test chờ menu. Chi tiết: `design/module4-quyet-dinh-khi-code.md` mục 4.4B.

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

**4.4 thanh toán và com: xong, Opus rà đạt 21/11** (sửa chập chờn: gộp sự kiện trùng ở outbox, dispatcher ba làn interactive/derived/bulk, b48f898; e2e 116/116 hai lần, vitest 1144 pass 9 skip. Lỗi `datahub-reader-scope` Opus gặp một lần chưa tái hiện được: theo dõi, gặp lại thì sửa). 4.4A server (b809b2d, 66ee9ed, d0fa5b0); 4.4B: sửa test TODAY/NOW chập chờn, hàng đợi điền lại cột gửi xuống khi đổi cây, trang `/quan-ly-deal/thanh-toan` (đợt, lập lịch, ghép tiền về, huỷ xác nhận, điều chỉnh com, Sổ com), ngăn chi tiết deal, e2e `stage4-4`. Quyết định: `design/module4-quyet-dinh-khi-code.md` mục "4.4A", "4.4B". Lệnh server: Bruno `docs/api/bruno/deal/`, OpenAPI.

- **4.5 xong, Opus rà đạt 21/11.** Sửa chập chờn sau 4.5: deadlock `dh_columns` (`columnTx` khoá một vòng đã sắp, chạy lại khi 40P01) và hàng đợi tính lại ưu tiên việc người dùng (`calc_bulk`); ở 9137d74 vitest 1163 pass 9 skip ×2, e2e 124 pass 3 skip ×2. Token 4.5: A 20,4M, B 16,8M, sửa chập chờn ~25M. **Đang làm 4.6 (21/11):** 4.6A server → bàn giao → 4.6B web + e2e + cả bộ. Công thức dùng cột lưu theo người: đã chốt ở Module 4 mục 3.4 ("vẫn tính sẵn và lưu"); Opus quyết cách làm: cột công thức đọc cột `storage: person` thành cột theo người đọc (`reader_scoped`, `dh_personal_rows`), dùng lại cơ chế Module 2 mục 10. 4.5A server (bc2e6ea..dd3d4bc) + 4.5B web (16c7179): màn Chốt kỳ (`/quan-ly-deal/chot-ky`: cần xử lý, com theo người, chốt, xuất XLSX, mở lại, danh sách kỳ), snapshot (chụp, danh sách, so sánh), so sánh phiên bản chính sách com, thanh kỳ chung (Deals/Index/KPI, `own_period` trong view), nút "Ưu tiên hôm nay"/"Cần chấm lại hôm nay" (nút lọc sẵn, không phải view hệ thống), e2e `stage4-5.spec.ts` (8 bài), Bruno `deal_rule`. Quyết định: `design/module4-quyet-dinh-khi-code.md` mục 4.5A, 4.5B; bản đồ: `design/ban-do-code.md`. Chưa làm: forecast vẽ (4.6), kỳ chung cho bảng tự tạo, dashboard theo kỳ (4.6); cây dev cũ cần dựng lại (vai trò mới).
- **Mốc test 4.5 (mã 16c7179):** `pnpm exec vitest run apps packages` 1159 pass, 9 skip; `stage4-5` 8/8; cả bộ e2e desktop 119 pass, 3 skip, 1 fail lần đầu (`stage2d` nhập xlsx: 4.5A thêm cảnh báo "Đã tự đổi sang TEXT" nên `import-warning` có hai phần tử, test cũ bắt một; đã sửa test ở `stage2d.spec.ts`, `stage2d` chạy lại 5/5 pass; không phải chập chờn). Opus nên chạy lại cả bộ e2e một lần sau sửa.
- **Mốc test, sửa chập chờn sau 4.5 (21/11, mã 9137d74):** vitest cả bộ 1163 pass, 9 skip, hai lần liên tiếp; `pnpm test:e2e --project=desktop` 124 pass, 3 skip, 0 fail, hai lần liên tiếp (9,1 phút mỗi lần). Nguyên nhân gốc: (1) deadlock `dh_columns`: một transaction gọi `touchColumns` nhiều vòng nên hai transaction khoá ngược thứ tự (nhật ký Postgres), thêm khoá `FOR UPDATE` xung đột `FOR KEY SHARE` của khoá ngoại hàng đợi; còn một deadlock giữa `row.create` (bộ đếm số tự động) và đồng bộ template; (2) hàng đợi tính lại một hàng: dựng cây thành viên mới xếp 460-720 cột, cột của người dùng chờ tới 46 giây. Sửa: `columnTx` (khoá một vòng sắp id, `FOR NO KEY UPDATE`, chạy lại khi 40P01), cột `calc_bulk` + `claimNext` ưu tiên cột người dùng (migration 0019). Test tái hiện: `datahub-touch-order.test.ts`. Chi tiết: `design/module4-quyet-dinh-khi-code.md` mục 4.5B; luật: `design/ban-do-code.md` Module 0. Lưu ý: trước sửa `stage2e:316` hỏng 3/6 lần e2e (nguyên nhân chính xác chưa chứng minh riêng; sau sửa 0/4 hỏng); một lần `stage1:62` hỏng khi máy đang chạy lệnh khác song song (lỗi 401 console sau đăng xuất, không lặp lại).
- Dương chốt 21/11: ô dán UNC chỉ dùng chấm điểm gợi ý (giữ); com chia một lần cho cả deal, mọi đợt cùng tỉ lệ (đã ghi Module 4 mục 4.5, 7.2).
- **Còn nợ (đã ghi trong 4.4A):** công thức theo người cho cột `person` (`Doanh thu tính cho tôi`, `Com dự kiến của tôi`) cần thiết kế engine Module 2; cột Index/Probation KPI đọc Đợt thanh toán (làm cùng việc đó, 4.6); cây dev cũ giữ `Đã thu` kiểu thường (dựng lại cây); `payment.confirm` chưa kiểm tổng `% com` so với `Tỉ lệ SoE` ở lệnh (cột đã có `cap_param`). Chốt kỳ là 4.5.

Mục tiêu Deals hạ xuống **20.000 deal** (Dương chốt 20/11): load test Stage 4 dùng 20.000 deal, 20 người phạm vi khác nhau, mọi biểu đồ ≤ 3 s; Datahub thường giữ 100.000 dòng.

Các bước sau (Opus chia chi tiết khi tới): thanh toán và com theo đợt (mục 7, 12); chốt kỳ, snapshot, forecast, BANT; chỉ số + dashboard Deals trỏ cột theo vai trò, API ngoài, `data_grants.options` (mục 19 việc 14–16); kiểm thử cuối Stage 4.

- **4.6 BÀN GIAO (4.6A server + 4.6A2 server xong, 21/11; mã test: commit kế tiếp của dòng này):** XONG 4.6A: công thức đọc cột lưu theo người (`reader_scoped`), cột Deals "của tôi"/team, Index doanh thu/forecast/Winrate quý, chỉ số `role:<key>`, dashboard `as_viewer`. XONG 4.6A2 (chi tiết `design/module4-quyet-dinh-khi-code.md` mục 4.6A2): (1) `Com đã nhận/tạm tính của tôi` chỉ cộng dòng của mình (autofill `present`, cột ẩn `Của tôi` ở Sổ com), thêm cột Leader `Com đã nhận của team`, `Com tạm tính của team`; (2) bảng mới `Doanh thu theo người` (ghi ở `payment.confirm`, xoá ở `unconfirm`), Probation KPI `Đã đạt`, `Còn thiếu`, `% đạt`, `KPI quý này`, `Đã đạt quý này`, `% đạt quý này`; (3) `deal.forecast` mở cho Leader (quyền mới `deal:forecast:read`, phạm vi team); (4) dashboard Deals tự dựng cùng cây (`ensureDealDashboardForTree`), thêm thẻ Forecast đã ký/chưa ký quý này và biểu đồ CR1, CR2 theo cohort; (5) dọn id Sổ com mồ côi; test Guest, Winrate quý, forecast; OpenAPI sinh lại (không lệnh mới, không Bruno mới).
  Test (commit trước dòng này): `apps/api/test/datahub` 405 pass 4 skip; `deal*`+`metrics*`+`permissions`+`org`+`tokens` pass (lần chạy gộp có 1 timeout 20s ở `deal-defaults` "transfer", chạy lại riêng pass: nghi chậm khi chạy gộp, chưa tìm nguyên nhân); lint, typecheck sạch. Không chạy cả bộ, không e2e.
  Web cần (4.6B): hiện bảng `Doanh thu theo người` (đã có trong `datahub.template.list`, bảng chung), cột ẩn `Của tôi`; cột Probation KPI mới; dashboard "Deals" trong `metrics.dashboard.shared` (thẻ forecast, CR cohort; chỉ số cohort là chỉ số đã lưu `Cohort nhận/gặp khách/Won`); Leader gọi `deal.forecast` (quyền mới) cho forecast team, nút/menu theo `deal:forecast:read`; ô chọn nguồn chỉ số không chặn bảng Deals; nhóm chọn "Vai trò" ở ô chọn cột chỉ số (`apps/web` chọn cột của chỉ số/biểu đồ).
  CÒN: Winrate theo cycle có mốc chín (module4 10.2): truy vấn `deal.cycle` (trung vị/TB/P75/P90/không chờ, mặc định 90 ngày nếu < 10 deal Won 12 tháng) + biểu đồ cohort đặt `time.range` đến ngày cắt, tô nhạt cohort chưa chín; Index của team chưa đọc từ bảng `Doanh thu theo người`; cây dev cũ phải dựng lại (cột Sổ com/Deals mới không tự thêm vào bảng đã có; bảng mới và dashboard thì tự thêm). Chưa chạy: lint cả repo bằng `pnpm lint` (chỉ eslint `apps/api`), đo tải.

## Ghi nhận để sau

- 4.5: việc tính lại nền (dựng cây, đồng bộ template) luôn xếp sau việc người dùng, chưa có chống đói. `columnTx` chạy lại cả transaction khi deadlock: hàm truyền vào không ghi ra ngoài transaction. Cây dev cũ thiếu cột mới (BANT, `Kỳ ghi nhận`, vai trò mới): 4.8 làm "bù cột còn thiếu cho cây đang chạy".

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
- **Module 4 (4.4A):** cây đã tạo trước 4.4 giữ `Đã thu` là cột thường (engine không đổi cột thường thành rollup); dev dựng lại cây. Bảng Tiền về "chỉ Manager" làm bằng khoá phân chia theo cột `Người xem` luôn trống.
- **Stage 9 Onboarding:** lúc bắt đầu stage hỏi Dương có kiểm giao diện kỹ như ngoại lệ không; tới lúc đó giữ quy định cũ (kiểm kỹ).
- Danh sách token cần duyệt và tài khoản hệ thống chưa phân trang (giới hạn 500); phân trang ở Stage 5.

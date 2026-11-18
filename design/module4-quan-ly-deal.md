# Module 4 — Quản lý Deal

> Trạng thái: **Bản nháp vòng 2, chờ Dương chốt** · 18/11/2026
> Không ghi số của chính sách thật vào file này (repo public); số nằm trong `examples/` và trong dữ liệu chính sách của hệ thống.
> Phụ thuộc: [Module 0](module0-nen-tang.md) (registry, lịch sử dòng, khoá kỳ, snapshot, outbox), [Module 1](module1-tai-khoan-phan-quyen.md) (cây tổ chức, phạm vi deal, Guest, chuyển giao), [Module 2](module2-datahub.md) (engine bảng, nguồn cột, công thức, liên kết, view), [Module 3](module3-metric-dashboard.md) (chỉ số, dashboard, snapshot trong chỉ số).
> Để module sau: tool MCP (Module 5); nhắc hạn, nhắc chấm BANT (Module 6); gắn việc vào deal (Module 10).

Nguồn: `examples/Quản lý Deal SoE (Dương TVD).xlsx` (sheet **Deals** là template mẫu, **Data Validation** là danh sách lựa chọn, **Index** là bảng theo tháng), `examples/bpm-dataset-soe.md` (BPM `[SoE] Deal Management`, Dataset `SOE`), `examples/chinh_sach_base_crm_ver_2.0_01062026_.pdf` (mục 4 Commission), workspace Base Inc (KPI, Goal, quy tắc BANT H-002).

---

## 1. Khái niệm

### 1.1 Quản lý Deal là một datahub được bảo vệ

Quản lý Deal và Datahub là **cùng một engine, cùng một nguồn dữ liệu**, chỉ khác cách hiển thị.

| Menu | Người dùng thấy | Được làm |
|---|---|---|
| **Datahub** | Mọi datahub của mình, **gồm cả datahub "Quản lý Deal"** (bảng mặc định + bảng tự tạo) | Tạo datahub mới |
| **Quản lý Deal** | Chỉ datahub "Quản lý Deal": bảng mặc định, bảng tự tạo, dashboard | Tạo bảng mới. Không thấy các datahub khác |

- Mỗi Manager, Leader, User có một datahub "Quản lý Deal", tự sinh khi tài khoản được tạo. Admin và Guest không có.
- Dashboard, view, công thức, liên kết, import/export, API chạy trên datahub này như mọi datahub.
- Datahub "Quản lý Deal" **không tính** vào giới hạn số datahub. Bảng tự tạo trong nó tính vào giới hạn số bảng (Module 2 mục 11).

### 1.2 Bảng mặc định

| Bảng | User | Leader | Manager | Dữ liệu |
|---|---|---|---|---|
| **Deals** | ✓ | ✓ | ✓ | Dùng chung, một bản ghi mỗi deal, áp phạm vi (mục 2) |
| **Index** | ✓ | ✓ | ✓ | Của riêng từng người, mỗi dòng một tháng (mục 5) |
| **Probation KPI** (tên tạm) | ✓ | ✓ | ✓ | Dùng chung, một dòng mỗi người mỗi năm, áp phạm vi (mục 6) |
| **Thanh toán** | – | – | ✓ | Khung ở mục 7, chi tiết chốt sau khi Dương bàn với Manager |

Manager cần quản lý thêm việc gì thì **thêm một bảng mặc định** cho vai trò Manager, nối với Deals bằng cột liên kết, lookup, rollup. Engine đã có sẵn những thứ này, nên không phải viết tính năng riêng cho từng bài toán.

### 1.3 Bảo vệ

- Không xoá, không đổi tên datahub "Quản lý Deal" và các bảng mặc định.
- Cột mặc định (từ template) không đổi tên, không xoá, không đổi kiểu từ trang bảng. Chỉ đổi được qua **template** (mục 3).
- Bảng tự tạo trong "Quản lý Deal" là bảng thường: của riêng người tạo, xoá và sửa tự do, chia sẻ như Module 2.

### 1.4 Một deal ứng với một loại dịch vụ

Khách mua POD và PS là **hai deal**, liên kết với nhau. Cách này khớp với file mẫu (mỗi dòng có một `Loại deal`) và với BPM (mỗi phiếu có một `Loại dịch vụ`).

## 2. Dữ liệu dùng chung và phạm vi

- **Deals:** một bản ghi mỗi deal trong bảng `deals` (cột cơ bản là cột thật của Postgres). Bảng Deals trong datahub của mỗi người là **cùng tập bản ghi đó, đã áp phạm vi**: User thấy deal mình tham gia, Leader thấy của mình và team, Manager thấy cả cây, Admin xem mọi cây ở chế độ chỉ đọc (Module 1 mục 4.1).
- **Probation KPI:** một bản ghi mỗi (người, năm), phạm vi giống Deals.
- **Index, Thanh toán, bảng tự tạo:** của riêng chủ datahub, theo luật riêng tư của Datahub (Module 1 mục 4.2).
- Mỗi deal thuộc **một cây** (đặt lúc tạo). Team của deal để báo cáo = team của người Leading **tại Start date**.
- Deal không bao giờ bị xoá cứng (`neverHardDelete`); Manager chỉ đánh dấu `Huỷ`.

## 3. Template cột

### 3.1 Bốn lớp cột

| Lớp | Ai sửa | Áp dụng cho | Ví dụ |
|---|---|---|---|
| **Cơ bản** | Admin, Manager | Mọi người | Các cột của sheet Deals |
| **Theo vai trò** | Admin, Manager | Mọi người có vai trò đó | Leader: `Com của team`. Manager: `Com của deal` |
| **Theo team** | Leader | Thành viên team của Leader đó | Một cột Leader muốn cả team điền |
| **Tuỳ chỉnh** | Từng người | Chỉ người đó | `Thời gian showcase`, cột công thức riêng |

- Template áp dụng cho mọi bảng mặc định (Deals, Index, Probation KPI, Thanh toán).
- **Sửa template thì áp dụng ngay cho mọi người trong phạm vi.** Ví dụ tháng 12 Manager thêm một cột vào lớp Cơ bản của Deals: mọi người thấy cột đó ngay. Cột tuỳ chỉnh của từng người **không bị ảnh hưởng**.
- Cột template mới trùng tên với cột tuỳ chỉnh của ai đó: cột tuỳ chỉnh được đổi tên thành `<tên> (riêng)` và người đó nhận thông báo. Dữ liệu và công thức giữ nguyên (công thức trỏ theo mã cột).
- Bỏ một cột template: cột bị ẩn và lưu trữ, dữ liệu và lịch sử giữ nguyên, khôi phục được. Không xoá hẳn.
- Đổi kiểu cột template: theo luồng đổi kiểu của Module 2 (xem trước, báo giá trị không chuyển được).
- Template dùng chung cả hệ thống (hiện chỉ có một team SoE). Mọi lần sửa ghi nhật ký và báo cho mọi Manager. Khi có cây thứ hai cần template khác thì thêm phạm vi theo cây.

### 3.2 Thuộc tính của một cột template

| Thuộc tính | Lựa chọn |
|---|---|
| Cách lưu giá trị | **Một giá trị chung mỗi deal** (ví dụ `Status`), hoặc **mỗi người một giá trị** (ví dụ ghi chú riêng của từng người) |
| Ai sửa | Người Leading / mọi người tham gia / Leader / chỉ Manager / chỉ hệ thống (công thức) |
| Hiển thị mặc định | Hiện hoặc ẩn trong view mặc định |

Cột công thức có thể tính **theo người xem** (ví dụ `% Com cá nhân`, `Com`): giá trị vẫn tính sẵn và lưu cho từng người (đúng luật Module 2 mục 6.5), mỗi deal chỉ có vài người thấy nên số bản ghi nhỏ.

## 4. Bảng Deals

### 4.1 Cột cơ bản (theo sheet Deals)

| # | Cột | Kiểu | Ghi chú |
|---|---|---|---|
| 1 | Tên công ty | Văn bản | Bắt buộc |
| 2 | Loại deal | Một lựa chọn | `POD bán mới`, `POD CSM`, `POD Express`, `PS kèm POD`, `PS không kèm POD`, `Data` (Data Validation) |
| 3 | Không tính vào báo cáo | Nhiều lựa chọn | `Số deal`, `Doanh thu`. Chọn `Số deal` thì không đếm deal; chọn `Doanh thu` thì không cộng doanh thu (đúng cách sheet Index lọc) |
| 4 | Start date | Ngày | Ngày nhận deal. Bắt buộc |
| 5 | Closing date | Ngày | Deal đang mở: ngày dự kiến chốt (forecast dùng). Deal đã đóng: ngày đóng |
| 6 | Ghi chú | Văn bản dài | |
| 7 | Sale | Văn bản | Email hoặc tên sale (sale không phải người dùng SoE Hub) |
| 8 | Status | Một lựa chọn | Mục 4.4 |
| 9 | Doanh thu | Tiền | Deal mở: doanh thu dự kiến. Won: giá trị hợp đồng chưa VAT |
| 10 | Nguồn lead | Một lựa chọn | `ML` (Marketing Lead), `SH` (Sale Hunt) |
| 11 | Level BC | Một lựa chọn | `Level 0` đến `Level 9` (Data Validation có 1–9; chính sách có thêm Level 0) |
| 12 | Performance BC | Một lựa chọn | `Under KPI`, `KPI`, `Goal`, `Out performance` |
| 13 | %Com team | Công thức | Tra chính sách com (mục 9) theo Loại deal, Nguồn lead, Level BC, Performance BC |
| 14 | % Com cá nhân | Công thức, theo người xem | % com của người xem trong deal, do Manager chia (mục 4.5) |
| 15 | Com | Công thức, theo người xem | Doanh thu × %Com team × % Com cá nhân. Luôn ghi **Tạm tính** |

Thêm vào lớp Cơ bản vì hệ thống cần:

| # | Cột | Lý do |
|---|---|---|
| 16 | Mã deal | Tự sinh `D-000123`. Gọi đúng một deal qua API, MCP, liên kết |
| 17 | Người tham gia | Leading / Associate / Advisor và tỉ lệ. Quyết định ai thấy deal, doanh thu và com chia cho ai |
| 18 | Mức ưu tiên (BANT) | Brief yêu cầu. Bốn cột B, A, N, T ẩn mặc định, chấm trong ngăn chi tiết deal (mục 8) |
| 19 | Mã số thuế | Nhận ra cùng khách: gợi ý `PS kèm POD`, khớp phiếu BPM, chống trùng |
| 20 | Nhóm dịch vụ | Công thức, ẩn: `POD` / `PS` / `Khác` theo Data Validation; `Software` / `Non-software` cho bảng luỹ kế |

Không đưa vào template ban đầu (Manager thêm khi cần, hoặc mỗi người tự thêm): Link CRM, Văn phòng, Đơn vị kinh doanh, Giai đoạn, Việc tiếp theo, Lý do thắng/thua, Thời gian showcase.

### 4.2 Cột theo vai trò (mặc định)

| Vai trò | Cột thêm |
|---|---|
| User | Không thêm (đã có `Com` của mình) |
| Leader | `Com của team`: tổng com tạm tính của các thành viên team trong deal |
| Manager | `Com của deal`: tổng com SoE của deal. `Tổng % com đã chia`: cảnh báo khi khác 100%. Khi có bảng Thanh toán: `Số lần tiền về`, `Com đã chia`, `Com còn lại`, `Đủ com` (rollup từ Thanh toán) |

### 4.3 Quyền sửa mặc định

| Cột | Leading | Associate, Advisor | Leader | Manager |
|---|---|---|---|---|
| Cột 1–12, 18, 19 | Sửa (trừ Loại deal) | Xem | Xem; sửa nếu thành viên cho phép | Sửa |
| Loại deal, Người tham gia, `Huỷ` | Xem | Xem | Xem | Sửa |
| Cột công thức | — | — | — | — |
| Cột tuỳ chỉnh của mình | Sửa | Sửa | Sửa | Sửa |

"Thành viên cho phép" = tuỳ chọn "Cho phép leader sửa deal của tôi" (Module 1 mục 4.1). Admin, Manager đổi quyền từng cột trong template.

### 4.4 Status

| Status | Mở/đóng | Ghi chú |
|---|---|---|
| Processing | Mở | Mặc định |
| Pending | Mở | Tạm dừng. Sheet Index có đếm `Pending` dù Data Validation chưa có |
| Won | Đóng | Bắt buộc Closing date và Doanh thu |
| Lost | Đóng | Đã gặp khách nhưng không chốt |
| Disqualified | Đóng | **Dừng trước khi gặp được khách** |
| Convert to POD | Đóng | Chỉ POD Express. Liên kết sang deal POD mới |
| Huỷ | Đóng | Chỉ Manager. Không vào chỉ số nào |

Kiểm chứng `Disqualified`: trong `Raw PODPS`, deal Disqualified chỉ dừng ở `Tiếp nhận khách hàng` hoặc `Lost`, không có deal nào ở `Post Meeting` hay `Negotiation`.

Ánh xạ từ BPM: `Completed` → Won, `Khách không chốt` → Lost, `Đã chuyển Sale POD` → Convert to POD, `Bị từ chối ở đề xuất` → Disqualified.

### 4.5 Người tham gia

- Ít nhất một `Leading`; được nhiều Leading (BPM cho nhiều `Lead SoE` chia `% Rev`).
- Mỗi người có hai tỉ lệ: **% doanh thu** và **% com**. Tỉ lệ **do Manager chia**. Mặc định khi tạo: Leading đầu tiên 100% / 100%; Associate, Advisor 0% / 0% (chỉ tính workload).
- Ràng buộc: tổng mỗi loại tỉ lệ ≤ 100%, kiểm tra ở mọi kênh.
- Doanh thu của một người = Doanh thu × % doanh thu. Đếm deal (nhận, thắng, winrate) của một người: chỉ deal họ là Leading. Của team: đếm không trùng.
- Workload: mọi vai trò, trọng số mặc định Leading 1, Associate 0,5, Advisor 0,3; Manager chỉnh cho cây mình.
- Người tham gia phải cùng cây với deal. Đổi người lưu lịch sử và phát sự kiện `deal.participant.changed`.

### 4.6 Nhận xét về sheet Index gốc

Sheet Index lọc POD bằng `"POD*"`, nên cột POD **đã gồm cả POD Express**. Trong khi đó `Tổng Revenue` = POD + PS + POD Express, và luỹ kế `Software` = POD + POD Express: doanh thu và số deal POD Express **bị cộng hai lần**. SoE Hub tính nhóm `POD` = `POD bán mới` + `POD CSM`, còn POD Express để riêng.

## 5. Bảng Index

- Mỗi dòng một tháng. Worker thêm dòng tháng mới vào ngày 1. Dòng đầu là tháng có deal sớm nhất.
- Cột mặc định = các cột của sheet Index, là **cột công thức trên bảng Deals**, đã sửa lỗi ở mục 4.6:
  - Theo nhóm POD, PS, POD Express, Tổng: Nhận, Disqualified, Pending, Qualified, Lost, Won, Winrate (theo quý như file mẫu), PS kèm POD, POD Express chuyển thành POD.
  - Doanh thu: POD, POD Express, PS, PS kèm POD, PS không kèm POD, Tổng, Tổng theo quý.
  - Forecast: POD, PS, Tổng (deal Processing có Closing date trong tháng, như file mẫu).
  - Thêm: CR1, CR2 của tháng (mục 10).
- Mốc thời gian như file mẫu: Nhận, Disqualified, Pending theo Start date; Won, Lost, doanh thu, forecast theo Closing date.
- Index của User đếm deal mình là Leading, doanh thu theo % doanh thu của mình. Index của Leader và Manager có thêm nhóm cột cho team / cây (lớp Theo vai trò).
- Mỗi người thêm cột tuỳ chỉnh được, ví dụ `Số showcase trong tháng` = đếm theo cột `Thời gian showcase` tự tạo ở Deals.
- Bảng luỹ kế (sheet Cumulative Index) không thành bảng riêng: là các thẻ số trên dashboard mặc định.

## 6. Bảng Probation KPI

Lưu **số đã commit từ đầu năm**, nằm cạnh Deals trong Quản lý Deal. Mỗi người mỗi năm một dòng.

| Cột | Ghi chú |
|---|---|
| Người, Năm | |
| KPI Software, KPI Non-software | Như sheet Plan của file mẫu |
| KPI tổng | Công thức |
| Hệ số Goal, Goal | Mặc định 1,5 (Goal = KPI × 3/2, như workspace Base Inc) |
| % Q1, % Q2, % Q3, % Q4 | Tỉ lệ doanh thu theo quý, tổng 100% |
| Deal size, CR1, CR2, Cycle (ngày) cam kết | CR1 mặc định 90% |
| Trạng thái | `Nháp` / `Đã commit` |
| Ngày commit | |
| Công thức có sẵn | KPI và Goal từng quý; số deal cần thắng = doanh thu ÷ deal size; lead cần nhận = deal ÷ (CR1 × CR2); **Đã đạt**, **Còn thiếu**, **% đạt** của năm và quý hiện tại (cộng từ Deals) |

- Người dùng tự nhập kế hoạch của mình rồi bấm **Commit**. Sau khi commit, chỉ Manager sửa được, phải ghi lý do; mọi lần sửa có lịch sử.
- Leader xem của team, Manager xem của cả cây.
- Doanh thu tính KPI: Software = POD bán mới + POD CSM + POD Express; Non-software = PS kèm POD + PS không kèm POD. `Data` không tính KPI (file mẫu không có Data trong Index).

## 7. Bảng Thanh toán của Manager (khung, chi tiết sau)

Bài toán: Manager cần biết mỗi deal com bao nhiêu, **đã chia mấy lần** (tiền về lần nào thì chia lần đó), tổng com đã đủ chưa. Trong `Raw PODPS`, mọi deal chia đợt đều chỉ ghi `Lần thanh toán = 1`, tức là đợt sau không ai theo dõi.

Khung đề xuất: mỗi dòng là một lần tiền về, liên kết tới một deal.

| Cột (nháp) | Ghi chú |
|---|---|
| Deal | Liên kết tới Deals |
| Đợt, Pháp nhân, Loại doanh thu (POD/PS/Data) | Theo "Bảng chia thanh toán – ver 2" của BPM |
| Số tiền dự kiến, Hạn | |
| Ngày tiền về, Số tiền về (chưa VAT) | |
| Com đợt này | Công thức theo chính sách hiệu lực ngày tiền về |
| Đã chia com, Ngày chia | |

Ở Deals, cột của Manager (`Số lần tiền về`, `Com đã chia`, `Com còn lại`, `Đủ com`) là rollup từ bảng này.

Nguyên tắc nên giữ khi làm chi tiết: tháng com đã chốt thì không sửa dòng cũ; sai sót thì thêm dòng điều chỉnh vào tháng đang mở.

Cần chốt với Manager: nguồn tiền về (đề xuất lấy từ BPM, bước "Theo dõi thanh toán"); com POD tính theo hợp đồng hay theo tiền về; Level BC và Performance BC lấy từ đâu; thu hồi com khi khách trả lại tiền; com cho POD Express và Data.

## 8. BANT và hàng chờ "Cần chấm lại hôm nay"

Bốn cột B, A, N, T, mỗi cột: `Có bằng chứng` / `Chưa rõ` / `Âm`. Mức ưu tiên theo quy tắc H-002:

1. Có một chữ `Âm` (Need mơ hồ, chỉ "tham khảo" tính là `Âm`) → **P3 – Ưu tiên thấp**.
2. Need `Chưa rõ`, hoặc cả Budget, Authority, Timeline đều `Chưa rõ` → **Chưa đủ dữ liệu**.
3. Need và Authority `Có bằng chứng`, thêm ít nhất một trong Budget, Timeline → **P1 – Ưu tiên cao**.
4. Còn lại → **P2 – Ưu tiên trung bình**.

- Deal PS và Data mặc định `Không đánh giá`.
- Người dùng ghi đè được mức tự tính. Quy tắc là công thức trong template, Admin/Manager sửa khi có tiêu chí mới.
- Mỗi lần chấm lưu một bản lịch sử điểm.
- **Hàng chờ "Cần chấm lại hôm nay":** deal đang mở chưa chấm lần nào; hoặc lần chấm cuối quá 7 ngày; hoặc Closing date trong 14 ngày tới và lần chấm cuối quá 3 ngày; hoặc Status, Closing date, Doanh thu đổi sau lần chấm cuối. Chấm xong thì rời hàng chờ.
- View hệ thống "Ưu tiên hôm nay": deal đang mở, sắp theo Mức ưu tiên rồi Closing date.

## 9. Commission

- **POD:** Com sale = Doanh thu × tỉ lệ tra theo (Nguồn lead, Level BC, Performance BC); Com SoE = Com sale × tỉ lệ SoE. Nên `%Com team` = tỉ lệ tra được × tỉ lệ SoE.
- **PS:** `%Com team` = tỉ lệ PS POD; chính thức tính trên tiền PS thực nhận từng đợt (bảng Thanh toán). Ở 4A giả định khách trả đủ.
- **POD Express, Data:** chưa có chính sách, cột hiện "Chưa có chính sách".
- **Chính sách com có phiên bản**, ngày hiệu lực; Manager tạo phiên bản mới, không ghi đè phiên bản cũ; phiên bản đã kích hoạt không sửa được. Gồm bảng tỉ lệ BC-ML, BC-SH (Level × Performance → doanh thu tối thiểu, tỉ lệ), tỉ lệ SoE, tỉ lệ PS POD, và công thức từng loại deal. Deal dùng phiên bản hiệu lực tại Closing date. Phiên bản đầu dựng từ các sheet BC Policy và PDF.
- Thiếu đầu vào (ví dụ chưa có Level BC) thì `Com` để trống kèm lý do, không đoán.
- Ai thấy com: chính người đó, Leader của họ, Manager của cây, Admin (chỉ đọc). Guest không bao giờ thấy.

## 10. Chỉ số

### 10.1 CR1, CR2

- **CR1** = deal gặp được khách ÷ deal nhận = (Nhận − Disqualified) ÷ Nhận. Chính là "Tỷ lệ pass qualify" của file mẫu.
- **CR2** = Won ÷ (Nhận − Disqualified). Deal còn mở vẫn nằm trong mẫu số. Chính là "Winrate" của file mẫu.
- Won = Nhận × CR1 × CR2. Hiện chỉ có CR1, CR2; không làm CR3, CR4.
- Kế hoạch (Probation KPI) dùng CR1 mặc định 90% cho đến khi có đủ dữ liệu thật (mặc định 20 deal trong 12 tháng gần nhất), sau đó đề xuất số thực tế; người dùng vẫn sửa được.

### 10.2 Winrate theo cycle (có tuỳ chọn)

- Nhóm deal theo tháng (hoặc quý) nhận deal (cohort). CR1, CR2 của cohort tính trên mọi deal của cohort, kể cả deal đóng muộn.
- Cohort được coi là **đã chín** khi đã qua một mốc cycle tính từ cuối cohort. **Mốc là tuỳ chọn:** `Trung vị`, `Trung bình`, `P75`, `P90`, hoặc `Không chờ`. Cycle tính theo loại deal, trên deal Won 12 tháng gần nhất; ít hơn 10 deal thì dùng mặc định 90 ngày.
- Mỗi người chọn mốc trên dashboard của mình; Manager đặt mốc mặc định cho cây. Biểu đồ luôn ghi đang dùng mốc nào.
- Cohort chưa chín vẫn hiện, tô nhạt, ghi "tạm tính, còn N deal mở".
- Gợi ý trong giao diện: mốc trung vị cho số thấp hơn thực tế, vì khoảng một nửa số deal sẽ thắng của cohort chưa kịp đóng.
- Winrate theo quý như sheet Index vẫn có (Won đóng trong quý ÷ Qualified nhận trong quý).

### 10.3 Chỉ số khác

| Chỉ số | Cách tính |
|---|---|
| Doanh thu | Tổng Doanh thu × % doanh thu, deal Won, theo Closing date |
| Deal size | Tuỳ chọn trung vị / trung bình / trung bình cắt đuôi; outlier theo IQR |
| Deal cycle | Closing date − Start date của deal Won; tuỳ chọn trung vị / trung bình, kèm P75 |
| Tỉ lệ PS kèm POD | PS kèm POD Won ÷ POD Won |
| Tỉ lệ chuyển POD | Convert to POD ÷ (POD Express nhận − Disqualified) |
| Workload | Tổng trọng số deal đang mở theo vai trò |
| Lý do xin thêm lead | KPI còn thiếu của quý so với forecast → số lead cần thêm = phần thiếu ÷ deal size ÷ (CR1 × CR2), hạn nhận = cuối quý − cycle |

## 11. Forecast và snapshot

- Forecast như file mẫu: tổng Doanh thu của deal Processing có Closing date trong kỳ, theo loại deal. Đặt cạnh KPI còn thiếu của quý.
- Snapshot tự động 00:05 ngày đầu mỗi quý cho deal đang mở; Manager chụp thêm được.
- Cuối quý so với snapshot đầu quý: mỗi deal trong snapshot rơi vào Won trong quý, trượt sang quý sau, Lost/Disqualified, hoặc vẫn mở. Độ chính xác = doanh thu Won thực tế ÷ forecast lúc chụp.

## 12. Khoá kỳ

Cột kỳ của Deals là **Closing date** (theo tháng). Manager khoá kỳ cho cây mình. Kỳ đã khoá: không sửa Doanh thu, Status, Closing date, Loại deal, người tham gia và tỉ lệ của deal đóng trong kỳ. Cột tuỳ chỉnh, ghi chú, BANT vẫn sửa được. Kỳ com của bảng Thanh toán tính riêng (mục 7).

## 13. Dashboard Deals mặc định

Dashboard hệ thống, khoá, đầu danh sách; nhân bản để tuỳ chỉnh. Số theo phạm vi người xem.

**Tối thiểu phải trả lời ngay khi mở:**

1. KPI hiện tại **đã đạt chưa**: đã đạt / KPI / Goal của năm và quý hiện tại (lấy từ Probation KPI).
2. **Còn thiếu bao nhiêu** để đạt KPI và Goal.
3. **Winrate hiện tại (CR2)**, kèm CR1.

Sau đó: doanh thu theo loại deal theo tháng; phễu Nhận → Gặp khách (CR1) → Won (CR2); bảng cohort winrate; forecast quý so với KPI còn thiếu; deal size và cycle (box plot, outlier); ma trận BANT và số deal cần chấm lại; Leader/Manager có thêm workload và doanh thu, winrate theo người.

## 14. Hệ thống ngoài và nhập lịch sử

- API `deal.upsert` theo `source` + `external_id`, kèm người tham gia `{ email, role, revenue_share, com_share }`. Tài khoản hệ thống chỉ ghi vào cây được cấp.
- Ánh xạ BPM (dùng khi nối): Tên Doanh nghiệp → Tên công ty; Loại dịch vụ + Gói dịch vụ + kết quả "Tra cứu POD trong nhóm khách hàng" → Loại deal (bảng ánh xạ do Admin/Manager sửa, vì `POD Showcase` chưa phân biệt `POD bán mới` với `POD CSM`); Deal size ước tính / Total Revenue (non VAT) → Doanh thu; Ngày dự kiến chốt / Closing Date → Closing date; Mã số thuế; Danh sách SoE tham gia deal (`Lead SoE` → Leading, `Support SoE` → Associate, `% Com`, `% Rev`); outcome → Status (mục 4.4).
- **Nhập lịch sử** (Manager, cho cây mình): luồng import của Module 2 với mẫu ánh xạ có sẵn cho sheet `Raw PODPS` và sheet `Deals` của file mẫu. Cột không có trong template thì nhập thành cột tuỳ chỉnh của Manager.

## 15. Phân quyền và tích hợp

- Tạo deal, phân deal, chia tỉ lệ, `Huỷ`, chính sách com, khoá kỳ, snapshot: Manager (cây mình).
- Sửa template (lớp Cơ bản, Theo vai trò): Admin, Manager. Lớp Theo team: Leader.
- Guest: đăng ký loại dữ liệu "Deals" với khung cấp dữ liệu Module 1 mục 5.2: chỉ cột lớp Cơ bản kiểu "giá trị chung", không bao giờ cột tuỳ chỉnh, cột theo người và com.
- Chuyển giao: deal mở chuyển vai trò sang người đích, deal đóng giữ người cũ; datahub "Quản lý Deal" của người nguồn: bảng tự tạo chuyển sang người đích; Probation KPI giữ tên người nguồn.
- Form (Module 7) không ghi vào Deals.

## 16. Giao diện tối thiểu (Stage 4)

- Menu Quản lý Deal: Deals, Index, Probation KPI, bảng tự tạo, Dashboard; Manager thấy thêm bảng của Manager và mục Quản lý (phân deal, chính sách com, khoá kỳ, snapshot, nhập lịch sử).
- Deals: grid Module 2, view hệ thống (Ưu tiên hôm nay, Đang mở, Cần chấm lại), ngăn chi tiết deal (người tham gia, BANT, lịch sử).
- Trình sửa template: bốn lớp, thuộc tính cột, xem trước ảnh hưởng ("áp dụng cho 18 người").
- Datahub: datahub "Quản lý Deal" hiện trong danh sách với biểu tượng khoá.

## 17. Kiểm thử

- Unit: quy tắc BANT, hàng chờ, CR1/CR2 cohort với từng mốc tuỳ chọn, chia doanh thu và com theo tỉ lệ, com theo phiên bản chính sách, ràng buộc Status, lớp template và xử lý trùng tên.
- Ma trận quyền: vai trò × cột × kênh; template; cột theo team của Leader; Guest không thấy cột tuỳ chỉnh và com; khoá kỳ; bảo vệ datahub/bảng/cột mặc định.
- **Golden test:** sheet Deals của file mẫu không có dòng dữ liệu nên Index trong file toàn số 0. Thay bằng: import `Raw PODPS` vào Deals, so Index của SoE Hub với một script tham chiếu đọc thẳng `examples/` trên máy, dùng đúng logic COUNTIFS/SUMIFS của sheet Index (có và không có sửa lỗi mục 4.6). Không commit dữ liệu; máy không có file thì bỏ qua.
- Test com dùng bảng tỉ lệ tự dựng, không dùng số của chính sách thật.
- Load test 100.000 deal: Deals, Index, dashboard mặc định.

## 18. Thay đổi so với quy định đã chốt

| Quy định cũ | Đổi thành | Ảnh hưởng |
|---|---|---|
| Template Deals: chỉ Admin (Module 1 mục 3.1, 3.2) | **Admin và Manager** | Module 1, CLAUDE.md |
| Ba loại cột: hệ thống / chung / cá nhân | **Bốn lớp**: Cơ bản, Theo vai trò (Admin, Manager), Theo team (Leader), Tuỳ chỉnh. "Cột chung Manager đẩy cho cả cây" = cột template kiểu "giá trị chung" | Module 1, Module 2 mục 3, CLAUDE.md |
| Brief: datahub Deals không cho tạo thêm bảng | Datahub "Quản lý Deal" **được tạo thêm bảng**; datahub, bảng và cột mặc định được bảo vệ | Module 2 |
| Datahub là của riêng, Leader/Manager không xem | Giữ nguyên cho bảng tự tạo và Index. **Ngoại lệ:** Deals và Probation KPI theo phạm vi deal (Leader xem team, Manager xem cây) | Module 1 mục 4 |
| Golden test so số với Excel (Module 0 mục 21) | So với script tham chiếu trên `Raw PODPS` (mục 17) | Module 0, Stage 2B |

## 19. Kiểm tra với Module 2 khi code Stage 4

Đối chiếu lại Module 2 và code Stage 2; chỗ nào chưa có thì bổ sung vào Module 2, có rồi thì thôi:

1. Datahub, bảng, cột có cờ **được bảo vệ** (không xoá, không đổi tên, không đổi kiểu từ giao diện thường).
2. Một **bảng hệ thống dùng chung** (Deals, Probation KPI) xuất hiện trong datahub của từng người, đã áp phạm vi.
3. Cột theo **lớp template** và hai cách lưu giá trị (chung mỗi deal / mỗi người một giá trị), khớp với "ba nguồn cột" của Module 2 mục 3.
4. Công thức **theo người xem** (`% Com cá nhân`, `Com`, đếm deal mình là Leading), tính sẵn và lưu theo người.
5. Cột liên kết, lookup, rollup và công thức từ bảng riêng (Index, Thanh toán, bảng tự tạo) sang Deals, Probation KPI; luật "cùng chủ" của công thức phải coi các bảng này là của chủ datahub.
6. Giới hạn bảng và cột áp đúng cho datahub "Quản lý Deal".

# Module 4 — Quản lý Deal

> Trạng thái: **Đã chốt** · 19/11/2026 (bản nháp vòng 2 ngày 18/11, Dương chốt nguyên bản). Mục 7 (bảng Thanh toán) mới là khung, chi tiết chốt sau khi Dương bàn với Manager.
> Không ghi số của chính sách thật vào file này (repo public); số nằm trong `examples/` và trong dữ liệu chính sách của hệ thống.
> Phụ thuộc: [Module 0](module0-nen-tang.md) (registry, lịch sử dòng, khoá kỳ, snapshot, outbox), [Module 1](module1-tai-khoan-phan-quyen.md) (cây tổ chức, phạm vi deal, Guest, chuyển giao), [Module 2](module2-datahub.md) (engine bảng, nguồn cột, công thức, liên kết, view), [Module 3](module3-metric-dashboard.md) (chỉ số, dashboard, snapshot trong chỉ số).
> Đổi bởi [Module 7](module7-dynamic-form.md) (chốt 19/11/2026): datahub "Quản lý Deal" không làm đích và không làm nguồn dữ liệu của Form (mở rộng mục 15).
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
| **Chính sách com**, **Tham số com** | Xem | Xem | Xem, sửa | Bảng hệ thống dùng chung (mục 9). **Chỉ Manager** thêm, sửa, cập nhật; mọi người khác chỉ xem, không sửa, không xoá. Admin xem |
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

### 3.2 Cột template và cột riêng phải luôn phân biệt được

Manager, Leader, Admin cũng có cột riêng như mọi người. Không phải cột nào họ tạo cũng vào template.

- **Thêm cột thì mặc định là cột riêng** (lớp Tuỳ chỉnh), với cả Manager. Muốn đưa vào template phải chọn rõ "Thêm vào template", chọn lớp (Cơ bản / Theo vai trò / Theo team), rồi xác nhận ở màn hình xem trước: "Cột này sẽ hiện cho 18 người".
- **Đưa cột riêng vào template** ("Đưa vào template") được: hệ thống chép định nghĩa cột (tên, kiểu, công thức, lựa chọn) thành cột template. Cột cách lưu "giá trị chung" thì hỏi có chép giá trị người đó đã nhập sang không. Cột riêng cũ bị ẩn, không mất.
- **Nhìn là biết:** tiêu đề cột template có nhãn lớp (`Mẫu`, `Mẫu · Manager`, `Mẫu · Team Khuê`), cột riêng có nhãn `Riêng`. Menu của cột và ngăn sửa cột ghi rõ "Sửa ở đây áp dụng cho N người" hoặc "Chỉ mình bạn thấy".
- Trình sửa template là một trang riêng, liệt kê mọi cột template theo lớp. Không sửa template "lẫn" trong lúc đang làm việc trên bảng.

### 3.3 Cột mặc định là cột thường được sinh sẵn

Cột mặc định không có logic viết cứng trong code. Nó là cột thường của engine, chỉ khác là được template sinh sẵn.

- Mọi cột tính toán (`%Com team`, `% Com cá nhân`, `Com`, `Nhóm dịch vụ`, `Mức ưu tiên (BANT)`, `Com của team`, `Com của deal`, các cột của Index và Probation KPI) đều là **cột công thức** viết bằng engine công thức. Sau này đổi cách tính chỉ cần sửa công thức, không cần sửa code.
- Công thức chỉ dùng **hàm kiểu Excel** của Module 2 (SUMIFS, XLOOKUP, MAXIFS, IFS…). Không thêm hàm riêng cho Quản lý Deal. Ví dụ `Com` = `[Doanh thu] * [%Com team] * [% Com cá nhân]`; `%Com team` tra bảng chính sách bằng `SUMIFS` và `MAXIFS` (mục 9).
- Cột không phải công thức là **cột tự điền**, có kiểu như mọi cột: Người tham gia (kiểu Người dùng, mục 4.5), Status, Doanh thu…
- **Mã deal** cũng là cột công thức, tự ra giá trị khi có dòng mới (mục 4.1).
- Ngày tạo, Người tạo, Ngày sửa, Người sửa là **cột hệ thống của mọi bảng ở mọi datahub** (Module 2 mục 4), không thuộc template. Ẩn được như mọi cột.
- User sửa công thức và kiểu của **cột tuỳ chỉnh của mình** bình thường. User chỉ không sửa được cột mặc định.

**Ai sửa công thức và kiểu của cột mặc định**

| Người sửa | Phạm vi áp dụng | Sửa được |
|---|---|---|
| Admin, Manager | Mọi người dùng template đó | Công thức, kiểu, lựa chọn, định dạng, quyền sửa |
| Leader | **Chỉ team của Leader đó** (bản sửa riêng của team đè lên template) | Công thức, kiểu kết quả và định dạng của **cột công thức**; lựa chọn, định dạng của cột nhập tay |
| User | — | Không sửa công thức hay kiểu của cột mặc định; chỉ đổi hiển thị trong view của mình (ẩn, độ rộng, thứ tự). Cột tuỳ chỉnh của mình thì sửa tự do |

- Leader không đổi được kiểu của cột nhập tay kiểu "giá trị chung". Lý do: giá trị đó là của chung một deal, Manager và Admin cũng nhìn cùng giá trị. Nếu mỗi team một kiểu thì dữ liệu chung bị vỡ.
- Bản sửa của Leader hiện nhãn `Team sửa`. Manager xem được danh sách mọi bản sửa của các team, và bấm "Về template" được.
- Mọi lần sửa công thức, kiểu của cột mặc định đều có lịch sử. Worker tính lại cả cột (Module 2 mục 6.5).

### 3.4 Thuộc tính của một cột template

| Thuộc tính | Lựa chọn |
|---|---|
| Cách lưu giá trị | **Một giá trị chung mỗi deal** (ví dụ `Status`), hoặc **mỗi người một giá trị** (ví dụ ghi chú riêng của từng người) |
| Ai sửa | Người Leading / mọi người tham gia / Leader / chỉ Manager / chỉ hệ thống (công thức) |
| Hiển thị mặc định | Hiện hoặc ẩn trong view mặc định |

Cột cách lưu "mỗi người một giá trị" (ví dụ `Vai trò của tôi`, `% Com cá nhân`) và cột công thức dùng chúng (ví dụ `Com`) có giá trị riêng cho từng người, vẫn tính sẵn và lưu (Module 2 mục 6.5). Mỗi deal chỉ vài người thấy nên số bản ghi nhỏ.

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
| 14 | % Com cá nhân | Phần trăm, tự điền, mỗi người một giá trị | Lấy từ tỉ lệ com Manager chia cho người đó ở cột Người tham gia; chưa chia thì 0 (mục 4.5) |
| 15 | Com | Công thức | `[Doanh thu] * [%Com team] * [% Com cá nhân]`. Luôn ghi **Tạm tính** |

Thêm vào lớp Cơ bản vì hệ thống cần:

| # | Cột | Lý do |
|---|---|---|
| 16 | Mã deal | Công thức, tự ra khi có dòng mới: `="D-"&TEXT(ROW_NO(), "000000")`. Tạm thời chưa bắt Manager quản lý theo mã; sau này đổi cách đặt mã thì sửa công thức. Sửa công thức thì mã của **mọi** deal đổi theo, nên trình sửa cảnh báo trước. API, liên kết và lịch sử dùng `id` của dòng, không dùng mã này, nên đổi mã không làm hỏng dữ liệu |
| 17 | Thành viên deal | Tự điền từ cột `Người tham gia` của Manager: tên và vai trò của từng người, **không có tỉ lệ**. Để ai cũng biết deal có những ai |
| 17a | Vai trò của tôi | Nhãn `Leading` / `Associate` / `Advisor`, tự điền, mỗi người một giá trị (mục 4.5) |
| 17b | % doanh thu của tôi | Phần trăm, tự điền, mỗi người một giá trị |
| 18 | Mức ưu tiên (BANT) | Brief yêu cầu. Bốn cột B, A, N, T ẩn mặc định, chấm trong ngăn chi tiết deal (mục 8) |
| 19 | Mã số thuế | Nhận ra cùng khách: gợi ý `PS kèm POD`, khớp phiếu BPM, chống trùng |
| 20 | Nhóm dịch vụ | Công thức, ẩn: `POD` / `PS` / `Khác` theo Data Validation; `Software` / `Non-software` cho bảng luỹ kế |

Không đưa vào template ban đầu (Manager thêm khi cần, hoặc mỗi người tự thêm): Link CRM, Văn phòng, Đơn vị kinh doanh, Giai đoạn, Việc tiếp theo, Lý do thắng/thua, Thời gian showcase.

### 4.2 Cột theo vai trò (mặc định)

| Vai trò | Cột thêm |
|---|---|
| User | Không thêm (đã có `Com` của mình) |
| Leader | `% com của team` (tự điền: tổng % com của thành viên team mình trong deal), `Com của team` = `[Doanh thu] * [%Com team] * [% com của team]` |
| Manager | **`Người tham gia`**: chia deal cho ai, vai trò gì, bao nhiêu % doanh thu, % com (mục 4.5). `Tổng % com đã chia` (tự điền: tổng % com của mọi người tham gia; cảnh báo khi chưa đủ 100%), `Com của deal` = `[Doanh thu] * [%Com team] * [Tổng % com đã chia]`. Khi có bảng Thanh toán: `Số lần tiền về`, `Com đã chia`, `Com còn lại`, `Đủ com` (rollup từ Thanh toán) |

### 4.3 Quyền sửa mặc định

| Cột | Leading | Associate, Advisor | Leader | Manager |
|---|---|---|---|---|
| Cột 1–12, 18, 19 | Sửa (trừ Loại deal) | Xem | Xem; sửa nếu thành viên cho phép | Sửa |
| Loại deal, `Huỷ` | Xem | Xem | Xem | Sửa |
| Người tham gia (cột của Manager) | — | — | — | Sửa |
| Cột tự điền từ Người tham gia (14, 17, 17a, 17b, cột % của team) | Xem | Xem | Xem | Xem (sửa qua Người tham gia) |
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

- Cột `Người tham gia` nằm ở **bảng Deals của Manager** (lớp Theo vai trò: Manager), kiểu **Người dùng** (chọn nhiều người trong hệ thống). Mỗi người được chọn kèm ba ô: **Vai trò** (nhãn `Leading` / `Associate` / `Advisor`), **% doanh thu**, **% com**. Giống bảng "Danh sách SoE tham gia deal" của BPM. Manager điền, hoặc API bắn vào.
- Đây là **nguồn duy nhất** của việc chia deal. Bảng của người khác chỉ nhận dữ liệu từ cột này, không ai khác sửa được.
- Chọn ai thì deal hiện trong bảng Deals của người đó. Hệ thống **gửi dữ liệu xuống**: tự điền các cột mỗi-người-một-giá-trị của họ: `Vai trò của tôi`, `% doanh thu của tôi`, `% Com cá nhân`; với Leader thêm `% com của team`; với Manager thêm `Tổng % com đã chia`. Từ đó mọi cột `Com` chỉ là công thức nhân thường. Chọn cách gửi xuống thay vì để mỗi người tự lookup, vì lookup "phần của tôi" cần một hàm biết ai đang xem, mà ta đã thống nhất không thêm hàm riêng.
- **% com mặc định 0** (chưa chia). Deal vẫn hiện, `Com` bằng 0 cho đến khi Manager chia.
- % doanh thu mặc định: deal chỉ có một Leading thì Leading 100%; còn lại 0 cho đến khi Manager chia. Associate, Advisor mặc định 0 (chỉ tính workload).
- Được nhiều Leading (BPM cho nhiều `Lead SoE` chia `% Rev`). Kiểu `Người dùng có thuộc tính` là tính năng chung của Datahub, bảng khác cũng dùng được (ví dụ giao việc có tỉ lệ).
- Ràng buộc: tổng mỗi loại tỉ lệ ≤ 100%, kiểm tra ở mọi kênh.
- Doanh thu của một người = `[Doanh thu] * [% doanh thu của tôi]`. Đếm deal (nhận, thắng, winrate) của một người: `COUNTIFS(... [Vai trò của tôi], "Leading")`. Của team: đếm không trùng.
- Dashboard và cột của Manager cảnh báo deal Won chưa chia đủ tỉ lệ.
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
- **Chính sách com là bảng hệ thống dùng chung** (công thức được tham chiếu bảng hệ thống, theo CLAUDE.md), không phải logic trong code. Hiện trong Quản lý Deal của mọi người; **chỉ Manager** thêm, sửa, cập nhật; người khác chỉ xem:
  - Bảng `Chính sách com`: Hiệu lực từ, Nguồn lead (ML/SH), Level, Performance, Doanh thu tối thiểu, Tỉ lệ. Dựng từ các sheet BC-ML, BC-SH.
  - Bảng `Tham số com`: Hiệu lực từ, Tên tham số (tỉ lệ SoE trên com sale, tỉ lệ PS POD…), Giá trị.
- **Có phiên bản theo ngày hiệu lực:** Manager thêm một bộ dòng mới với `Hiệu lực từ` mới, không sửa dòng cũ. Dòng đã có hiệu lực bị khoá.
- `%Com team` là công thức thường, tra đúng phiên bản theo Closing date. Ví dụ phần POD: `SUMIFS([Chính sách com].[Tỉ lệ], [Chính sách com].[Hiệu lực từ], MAXIFS([Chính sách com].[Hiệu lực từ], [Chính sách com].[Hiệu lực từ], "<="&[Closing date]), [Chính sách com].[Nguồn lead], [Nguồn lead], [Chính sách com].[Level], [Level BC], [Chính sách com].[Performance], [Performance BC])` nhân với tỉ lệ SoE tra cùng cách. Template dựng sẵn công thức này; Manager sửa khi chính sách đổi cách tính.
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

## 11a. Lọc theo thời gian

Mọi bảng đều có ô Thời gian của Module 2 mục 5.4. Quản lý Deal có thêm một **thanh chọn kỳ dùng chung** ở đầu trang.

- Đổi kỳ ở một chỗ thì Deals, Index, Probation KPI và dashboard cùng theo. Mặc định là **Quý này**.
- Một bảng có thể tách khỏi kỳ chung ("Không theo kỳ chung") và giữ khoảng riêng. Lựa chọn này tự lưu vào view.
- Kỳ chỉ thu hẹp dữ liệu, không bao giờ mở rộng quyền xem.

**Deals: chọn cách hiểu "deal thuộc kỳ"**

| Cách | Điều kiện |
|---|---|
| **Liên quan đến kỳ** (mặc định) | Start date ≤ cuối kỳ, và deal đang mở hoặc Closing date ≥ đầu kỳ. Gồm deal nhận trong kỳ, deal đóng trong kỳ và deal còn chạy trong kỳ |
| Nhận trong kỳ | Start date trong kỳ |
| Đóng trong kỳ | Deal đã đóng, Closing date trong kỳ |
| Dự kiến chốt trong kỳ | Deal đang mở, Closing date trong kỳ (giống forecast) |

**Các bảng khác**

| Bảng | Lọc theo |
|---|---|
| Index | Cột Thời gian (dòng tháng) |
| Probation KPI | Năm chứa kỳ |
| Bảng tự tạo | Cột ngày người dùng chọn cho kỳ chung, hoặc không theo |
| Dashboard | Kỳ chung là khoảng thời gian trong bộ lọc chung của dashboard. Biểu đồ có kỳ riêng (ví dụ xu hướng 12 tháng) chọn "bỏ qua bộ lọc chung" (Module 3 mục 8) |

Thẻ KPI theo kỳ: chọn quý thì hiện KPI quý; chọn năm thì hiện KPI năm; chọn tháng thì hiện tiến độ của quý chứa tháng đó (KPI chỉ commit theo năm và quý).

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
- Trình sửa template (trang riêng): bốn lớp, thuộc tính cột, xem trước ảnh hưởng ("áp dụng cho 18 người"), danh sách bản sửa của các team. Nhãn `Mẫu` / `Riêng` / `Team sửa` trên tiêu đề cột.
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
| Cột hệ thống của Deals là cột cố định trong code | Cột mặc định là **cột thường do template sinh sẵn**; cột tính toán là công thức, Admin/Manager sửa cho mọi người, Leader sửa cho team, User không sửa (mục 3.3) | Module 2, CLAUDE.md |
| Golden test so số với Excel (Module 0 mục 21) | So với script tham chiếu trên `Raw PODPS` (mục 17) | Module 0, Stage 2B |

## 19. Kiểm tra với Module 2 khi code Stage 4

Đối chiếu lại Module 2 và code Stage 2; chỗ nào chưa có thì bổ sung vào Module 2, có rồi thì thôi:

1. Datahub, bảng, cột có cờ **được bảo vệ** (không xoá, không đổi tên, không đổi kiểu từ giao diện thường).
2. Một **bảng hệ thống dùng chung** (Deals, Probation KPI) xuất hiện trong datahub của từng người, đã áp phạm vi.
3. Cột theo **lớp template** và hai cách lưu giá trị (chung mỗi deal / mỗi người một giá trị), khớp với "ba nguồn cột" của Module 2 mục 3.
4. Cột **mỗi người một giá trị** (`Vai trò của tôi`, `% Com cá nhân`) và công thức dùng chúng (`Com`) tính sẵn, lưu theo từng người.
5. Cột mặc định là cột thường do template sinh sẵn (mục 3.3): cột tính toán là công thức chỉ dùng hàm kiểu Excel, không có hàm riêng. Công thức ở bảng của một người (Index, bảng tự tạo) đọc cột mỗi-người-một-giá-trị của Deals theo **chủ bảng** (ví dụ `[Deals].[Vai trò của tôi]` là vai trò của chủ Index).
6. Kiểu **Người dùng có thuộc tính** (mỗi người chọn kèm vài ô: nhãn, phần trăm), và cơ chế tự điền cột mỗi-người-một-giá-trị từ cột đó (mục 4.5).
7. Cột hệ thống Ngày tạo, Người tạo, Ngày sửa, Người sửa có ở mọi bảng, ẩn được.
8. Bản sửa riêng của team (Leader) đè lên định nghĩa cột template; cột riêng được "Đưa vào template".
9. Cột liên kết, lookup, rollup và công thức từ bảng riêng (Index, Thanh toán, bảng tự tạo) sang Deals, Probation KPI; luật "cùng chủ" của công thức phải coi các bảng này là của chủ datahub.
10. Giới hạn bảng và cột áp đúng cho datahub "Quản lý Deal".

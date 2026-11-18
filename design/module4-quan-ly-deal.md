# Module 4 — Quản lý Deal

> Trạng thái: **Bản nháp, chờ Dương chốt** · 18/11/2026
> Không ghi số của chính sách thật vào file này (repo public); số nằm trong `examples/` và trong dữ liệu chính sách của hệ thống.
> Phụ thuộc: [Module 0](module0-nen-tang.md) (registry, lịch sử dòng, khoá kỳ, snapshot, outbox, thùng rác), [Module 1](module1-tai-khoan-phan-quyen.md) (cây tổ chức, phạm vi deal, cấp dữ liệu Guest, chuyển giao), [Module 2](module2-datahub.md) (engine bảng, ba nguồn cột, công thức, view), [Module 3](module3-metric-dashboard.md) (chỉ số, biểu đồ, dashboard hệ thống, snapshot trong chỉ số).
> Để module sau: tool MCP cho deal (Module 5); nhắc hạn việc tiếp theo, nhắc chấm BANT (Module 6); gắn việc vào deal (Module 10).

Nguồn đã đọc khi viết: file `examples/Quản lý Deal SoE (Dương TVD).xlsx` (Raw PODPS, Data Validation, Index, Cumulative Index, Plan, các sheet BC Policy), `examples/chinh_sach_base_crm_ver_2.0_01062026_.pdf` (mục 4 Commission), workspace Base Inc (định nghĩa CR1, CR2, KPI, Goal, winrate, quy tắc BANT H-002), quy trình BPM `[SoE] Deal Management` và thư mục Dataset `SOE` (Danh mục dịch vụ, Sổ đề xuất, Danh mục khách hàng). Không chép số liệu thật vào thiết kế này.

---

## 1. Phạm vi và cách chia bản

Quản lý Deal làm theo hai bản. Bản 4A đủ để team SoE dùng hằng ngày. Bản 4B là phần quản lý tiền và com của Manager, **chỉ làm khi đủ dữ liệu** (mục 12).

| Bản | Nội dung | Khi nào |
|---|---|---|
| **4A** (Stage 4) | Bảng Deals trên lõi Datahub, người tham gia, ba loại cột, template mặc định, BANT, kế hoạch KPI, chỉ số và dashboard mặc định, forecast + snapshot đầu quý, com **tạm tính**, chính sách com có phiên bản, khoá kỳ, nhập lịch sử, API cho hệ thống ngoài, cấp dữ liệu Guest, chuyển giao | Ngay sau Stage 3 |
| **4B** (chừa chỗ) | Lịch thanh toán nhiều đợt, tiền thực nhận, com chính thức theo dòng tiền, chốt kỳ com, đối soát, điều chỉnh | Khi chốt được nguồn dữ liệu thanh toán (mục 12.4) |
| Sau nữa | Kế hoạch deal của Manager, yêu cầu xin lead, đồng bộ hai chiều với BPM | Thiết kế riêng |

Code 4A phải chừa sẵn chỗ cho 4B (mục 13), để 4B chỉ thêm, không sửa lõi.

## 2. Khái niệm

| Khái niệm | Ý nghĩa |
|---|---|
| Deal | Một cơ hội bán **một dòng dịch vụ** cho một khách hàng. Một bản ghi duy nhất, dù nhiều người tham gia |
| Dòng dịch vụ | `POD Showcase`, `POD Express`, `PS`, `Data` (theo BPM và Dataset hiện tại) |
| Họ dịch vụ | `Software` (POD Showcase, POD Express) hoặc `Non-software` (PS, Data). Lấy từ danh mục dịch vụ |
| Người tham gia | Người SoE gắn với deal, có vai trò `Leading` / `Associate` / `Advisor` và hai tỉ lệ: % doanh thu, % com |
| Deal liên quan | Liên kết giữa hai deal: PS kèm POD → deal POD; POD Express → deal POD được chuyển sang |

**Một deal là một dòng dịch vụ.** Khách mua POD và PS là hai deal liên kết với nhau. Cách này khớp với file deal mẫu (POD và PS là các dòng riêng) và với BPM (mỗi phiếu có một `Loại dịch vụ`). Nhờ vậy doanh thu theo loại, winrate theo loại, cycle theo loại đều tính thẳng trên một cột.

## 3. Cách lưu

- Bảng `deals`: **một dòng cho mỗi deal**, cột hệ thống là cột thật của Postgres (có kiểu, có index). Đăng ký với engine Datahub như một bảng hệ thống, nên view, lọc, sắp xếp, công thức, lịch sử dòng, export, SSE dùng lại nguyên của Module 2.
- Cột chung: JSONB `data` của dòng deal (một giá trị mỗi deal).
- Cột cá nhân: bảng `deal_personal_values(deal_id, user_id, data jsonb)`, mỗi người một giá trị.
- `deal_participants(deal_id, user_id, role, revenue_share, com_share, valid_from, valid_to)`: lưu cả lịch sử đổi người.
- `deal_bant_scores`: lịch sử chấm BANT (mục 7).
- Mỗi deal thuộc **một cây** (`manager_id`), đặt lúc tạo. Team của deal để báo cáo = team của người Leading **tại ngày nhận deal** (Module 1 mục 2.3).
- Mã dễ đọc `D-000123` (Module 0 mục 5).
- Deal không bao giờ bị xoá cứng: bảng đăng ký `neverHardDelete`. Manager chỉ đánh dấu `Huỷ`.
- Trang "Deals" của mỗi người là **bảng chung đã áp phạm vi**, không phải một datahub riêng của từng người. Không tính vào giới hạn datahub.

## 4. Template cột hệ thống

Admin quản lý template (thêm cột, sửa lựa chọn, quyền sửa từng cột). Không ai đổi tên hay xoá cột hệ thống. Dấu `*` là bắt buộc.

### 4.1 Định danh và khách hàng

| Cột | Kiểu | Ghi chú |
|---|---|---|
| Mã deal | Mã dòng | `D-000123`, tự sinh |
| Tên công ty * | Văn bản | |
| Mã số thuế | Văn bản | Dùng để nhận ra cùng khách |
| Mã nhóm khách hàng | Văn bản | Như BPM/Dataset; dùng cho "PS kèm POD" |
| Link CRM | URL | |
| Văn phòng Base | Một lựa chọn | Hà Nội, Đà Nẵng, Hồ Chí Minh |
| Đơn vị kinh doanh | Một lựa chọn | Danh sách RC/PKD, Admin sửa |
| Sale phụ trách | Email | Sale không phải người dùng SoE Hub |
| Nguồn lead | Một lựa chọn | `ML` (Marketing Lead), `SH` (Sale Hunt). Quyết định bảng tỉ lệ com |
| Level BC | Một lựa chọn | Level 0–9, của sale tại lúc chốt |
| Performance BC | Một lựa chọn | Dưới KPI, KPI, Goal, Out performance |

### 4.2 Dịch vụ

| Cột | Kiểu | Ghi chú |
|---|---|---|
| Dòng dịch vụ * | Một lựa chọn | POD Showcase, POD Express, PS, Data |
| Gói dịch vụ | Liên kết tới danh mục dịch vụ | Ví dụ `PS 3.0 · Combo · Advanced` |
| Họ dịch vụ | Lookup | Software / Non-software, lấy từ danh mục |
| PS kèm POD | Checkbox | **Tự gợi ý**: deal PS có cùng mã nhóm KH (hoặc MST) với một deal POD đã thắng. Người dùng sửa được |
| Deal liên quan | Liên kết deal | PS kèm POD → deal POD; Express → POD |
| Số năm hợp đồng | Số | |

**Danh mục dịch vụ** là bảng hệ thống dùng chung (giống Dataset `SOE - Danh mục dịch vụ`): tên gói, mã gói, họ, dòng, thế hệ (PS 1.0 / 3.0), hình thức (Combo / Lẻ), module, hạng, đang bán. Admin quản lý, vì đây là dữ liệu tham chiếu cho cả hệ thống như template.

### 4.3 Tiến trình

| Cột | Kiểu | Ghi chú |
|---|---|---|
| Trạng thái * | Một lựa chọn | Mục 5 |
| Giai đoạn | Một lựa chọn | Phân công SoE → Gặp khách → Đàm phán / Follow up → Thanh toán → Đóng (theo BPM). Admin sửa lựa chọn |
| Ngày nhận * | Ngày | Ngày SoE nhận deal. Mốc cho lead nhận và cohort |
| Ngày dự kiến chốt | Ngày | Dùng cho forecast |
| Ngày đóng | Ngày | Bắt buộc khi deal đóng. Mốc cho thắng, thua, doanh thu, khoá kỳ |
| Lý do thắng | Văn bản | |
| Nhóm lý do thua / loại | Một lựa chọn | Admin sửa danh sách |
| Lý do chi tiết | Văn bản dài | |
| Việc tiếp theo | Văn bản | |
| Hạn việc tiếp theo | Ngày | Module 6 nhắc hạn |
| Ghi chú | Văn bản dài | |

### 4.4 Tiền và forecast

| Cột | Kiểu | Ghi chú |
|---|---|---|
| Doanh thu dự kiến | Tiền | Khi deal còn mở |
| Doanh thu | Tiền | Giá trị hợp đồng chưa VAT, bắt buộc khi `Thắng` |
| Nhóm forecast | Một lựa chọn | `Chắc chắn`, `Có thể`, `Pipeline` (mặc định). Người Leading chọn |
| Nhóm deal size | Công thức | `<100 triệu`, `>100 triệu`, `>300 triệu`, `>500 triệu`, `>1 tỷ` (như file mẫu) |
| Cycle (ngày) | Công thức | Ngày đóng − Ngày nhận |

### 4.5 BANT và báo cáo

| Cột | Kiểu | Ghi chú |
|---|---|---|
| Budget, Authority, Need, Timeline | Một lựa chọn mỗi cột | `Có bằng chứng` / `Chưa rõ` / `Âm` |
| Mức ưu tiên (BANT) | Tự tính, ghi đè được | Mục 7 |
| Ngày chấm BANT | Ngày giờ | Tự ghi khi chấm |
| Không tính vào báo cáo | Checkbox | Kèm lý do. Deal này không vào chỉ số nào (thay cột cùng tên trong file mẫu) |
| Com tạm tính của tôi | Tự tính theo từng người | Mục 9 |

### 4.6 Người tham gia, nguồn, chuẩn

- Người tham gia (hiện tóm tắt), Vai trò của tôi, % doanh thu của tôi.
- Nguồn dữ liệu (`Tay`, `Import`, tên tài khoản hệ thống), Mã ngoài (`external_id`).
- Các cột chuẩn: ngày tạo, người tạo, ngày sửa, người sửa.

### 4.7 Quyền sửa từng cột (mặc định)

| Nhóm cột | Leading | Associate, Advisor | Leader | Manager |
|---|---|---|---|---|
| Định danh, dịch vụ | Sửa (trừ Dòng dịch vụ) | Xem | Xem (sửa nếu được cho phép) | Sửa |
| Tiến trình, tiền, BANT | Sửa | Xem | Xem (sửa nếu được cho phép) | Sửa |
| Người tham gia, Dòng dịch vụ, `Huỷ` | Xem | Xem | Xem | Sửa |
| Cột cá nhân của mình | Sửa | Sửa | — | — |

"Được cho phép" = User bật "Cho phép leader sửa deal của tôi" (Module 1 mục 4.1). Admin chỉnh bảng này trong template, theo từng cột.

## 5. Trạng thái

| Trạng thái | Mở/đóng | Ghi chú |
|---|---|---|
| Đang xử lý | Mở | Mặc định khi tạo |
| Tạm dừng | Mở | Khách hoãn, vẫn trong pipeline |
| Thắng | Đóng | Bắt buộc Ngày đóng, Doanh thu |
| Thua | Đóng | Bắt buộc Ngày đóng, nhóm lý do |
| Bị loại | Đóng | Không qualify. Không vào mẫu số winrate |
| Chuyển POD | Đóng | Chỉ POD Express. Bắt buộc liên kết sang deal POD mới |
| Huỷ | Đóng | Chỉ Manager. Không vào chỉ số nào, vẫn còn lịch sử |

Ánh xạ khi nhận từ BPM: `Completed` → Thắng, `Khách không chốt` → Thua, `Đã chuyển Sale POD` → Chuyển POD, `Bị từ chối ở đề xuất` → Bị loại.

## 6. Người tham gia

- Mỗi deal có ít nhất một `Leading`. Được nhiều Leading (BPM cho nhiều "Lead SoE" chia % Rev).
- Mặc định: Leading đầu tiên 100% doanh thu, 100% com. `Associate` và `Advisor` mặc định **0% doanh thu, 0% com**: chỉ tính workload (đúng brief). Manager sửa tỉ lệ khi có thoả thuận (chính sách PS cho phép CO Associate chia com ở gói Advanced).
- Ràng buộc: tổng % doanh thu ≤ 100%, tổng % com ≤ 100%. Server kiểm tra ở mọi kênh.
- **Doanh thu** của một người = Doanh thu × % doanh thu của họ. Tổng của team không bao giờ vượt doanh thu deal.
- **Đếm deal** (lead nhận, thắng, winrate, cycle) của một người: chỉ các deal họ là Leading. Của team: đếm **không trùng** deal.
- **Workload**: mọi vai trò. Trọng số mặc định Leading 1, Associate 0,5, Advisor 0,3; Manager chỉnh cho cây mình.
- Người tham gia phải thuộc cùng cây với deal (bản 4A).
- Chỉ Manager (và hệ thống ngoài) thêm/bớt người tham gia. Đổi người ghi lịch sử (`valid_from`, `valid_to`) và phát sự kiện `deal.participant.changed`.

## 7. BANT và "Cần chấm lại hôm nay"

Áp dụng quy tắc H-002 Dương đang dùng (không dùng điểm số):

1. Có một chữ `Âm` (Need mơ hồ, chỉ "tham khảo" tính là `Âm`) → **P3 – Ưu tiên thấp**.
2. Need `Chưa rõ`, hoặc cả Budget, Authority, Timeline đều `Chưa rõ` → **Chưa đủ dữ liệu**.
3. Need và Authority `Có bằng chứng`, thêm ít nhất một trong Budget, Timeline → **P1 – Ưu tiên cao**.
4. Còn lại → **P2 – Ưu tiên trung bình**.

- PS và Data mặc định `Không đánh giá` (sắp theo hạn việc tiếp theo).
- Mức tự tính được người dùng **ghi đè**; ô ghi đè có dấu riêng và giữ đến lần chấm sau.
- Quy tắc là một công thức hệ thống trong template, Admin sửa được khi Manager đưa tiêu chí mới.
- Mỗi lần chấm lưu một bản `deal_bant_scores(deal_id, user_id, b, a, n, t, priority, overridden, at)`. Biểu đồ xem điểm thay đổi theo thời gian.

**Hàng chờ "Cần chấm lại hôm nay"** (thay cho chấm lại toàn bộ mỗi ngày). Deal đang mở vào hàng chờ khi một trong các điều kiện sau đúng:

- Chưa chấm lần nào.
- Lần chấm cuối quá **7 ngày** (cài được).
- Ngày dự kiến chốt trong 14 ngày tới và lần chấm cuối quá 3 ngày.
- Giai đoạn, ngày dự kiến chốt hoặc doanh thu dự kiến vừa đổi sau lần chấm cuối.

Chấm xong thì deal rời hàng chờ. Hàng chờ là một view hệ thống của Deals, kèm số đếm trên menu.

**View hệ thống "Ưu tiên hôm nay"**: deal đang mở, sắp theo Mức ưu tiên (thứ tự lựa chọn) rồi Hạn việc tiếp theo (ô trống cuối). Các view hệ thống khác: Đang mở, Sắp chốt 30 ngày, Đã đóng quý này, Cần chấm lại.

## 8. Chỉ số

Mọi chỉ số là chỉ số hệ thống của Module 3 (JSON), dùng chung cho dashboard, API, MCP. Deal `Huỷ` và `Không tính vào báo cáo` không vào chỉ số nào.

### 8.1 Chỉ số nền

| Chỉ số | Cách tính | Mốc thời gian |
|---|---|---|
| Lead nhận | Đếm deal | Ngày nhận |
| Bị loại | Đếm deal `Bị loại` | Ngày nhận |
| Qualified | Lead nhận − Bị loại | Ngày nhận |
| Tỉ lệ pass qualify | Qualified ÷ Lead nhận | Ngày nhận |
| Thắng, Thua | Đếm deal | Ngày đóng |
| Doanh thu | Tổng Doanh thu × % doanh thu, deal `Thắng` | Ngày đóng |
| Deal size | **Trung vị** doanh thu deal thắng; kèm trung bình và trung bình cắt đuôi | Ngày đóng |
| Deal cycle | **Trung vị** (Ngày đóng − Ngày nhận) của deal thắng; kèm P75 | Ngày đóng |
| Tỉ lệ chuyển POD | Chuyển POD ÷ (POD Express nhận − Bị loại) | Ngày nhận |
| Tỉ lệ PS kèm POD | PS kèm POD thắng ÷ POD thắng | Ngày đóng |

Tách theo dòng dịch vụ và họ dịch vụ, giống sheet Index và Cumulative Index. Deal size và cycle dùng trung vị vì dữ liệu lệch mạnh (deal vài triệu đến vài tỷ; cycle có deal hơn một năm). Outlier đánh dấu theo IQR (Module 3 mục 5.4).

### 8.2 CR1, CR2 và winrate

Hiện chỉ có CR1 và CR2 (theo workspace Base Inc). Không làm CR3, CR4.

- **CR1** = lead dùng được ÷ lead xin công ty. Hệ thống **chưa có dữ liệu "lead xin"**, nên CR1 là **tham số kế hoạch** (chung cả team, mặc định 90%), dùng để tính số lead cần xin (mục 8.3). Khi có chức năng yêu cầu xin lead (mục 13) thì CR1 thành chỉ số đo được.
- **CR2 = winrate** = Thắng ÷ (Lead nhận − Bị loại). Deal còn mở **vẫn nằm trong mẫu số**.

**Winrate theo cohort** (chỉ số chính, giải bài toán "winrate phụ thuộc cycle"):

- Nhóm deal theo **tháng (hoặc quý) nhận deal**. Winrate của cohort = deal thắng (bất kể đóng lúc nào) ÷ deal qualified của cohort đó.
- Một cohort chỉ được coi là **đã chín** khi đã qua **P75 của deal cycle** tính từ cuối cohort. P75 tính theo dòng dịch vụ, trên deal thắng 12 tháng gần nhất; ít hơn 10 deal thì dùng mặc định 90 ngày.
- Cohort chưa chín vẫn hiện nhưng tô nhạt, ghi "tạm tính, còn N deal mở".
- Winrate một kỳ = gộp các cohort đã chín trong kỳ.

Vì sao P75 mà không phải trung vị: lấy mốc trung vị thì theo định nghĩa còn khoảng một nửa số deal sẽ thắng của cohort chưa kịp đóng, winrate luôn bị thấp. P75 vẫn để cohort sớm có số, nhưng sai ít hơn. Manager chọn được trung vị / P75 / P90 trong cài đặt cây.

**Winrate theo kỳ đóng** (chỉ số phụ, như file mẫu): Thắng ÷ (Thắng + Thua) đóng trong kỳ. Dễ hiểu, nhưng ghi rõ trên biểu đồ là không dùng để so người có cycle dài với người có cycle ngắn.

### 8.3 Kế hoạch, KPI, Goal

Bảng `deal_kpi_plans`, mỗi người mỗi năm một bản:

| Trường | Ghi chú |
|---|---|
| KPI doanh thu | Tách theo họ dịch vụ: Software, Non-software (như sheet Plan) |
| Hệ số Goal | Mặc định 1,5 (Goal = KPI × 3/2) |
| % doanh thu theo quý | Bốn số, tổng 100% |
| Deal size kế hoạch, CR1, CR2, cycle kế hoạch | Mặc định lấy số thực tế 12 tháng gần nhất, sửa được |

- Người dùng tự nhập kế hoạch của mình; Leader, Manager xem. Manager sửa và **khoá** kế hoạch của người trong cây.
- Hệ thống tính: Goal; số deal cần thắng = doanh thu ÷ deal size; lead cần nhận = deal ÷ CR2, **nhận sớm hơn một cycle**; lead cần xin = lead cần nhận ÷ CR1.
- **Thẻ "Lý do xin thêm lead"** (trả lời câu hỏi trong brief): KPI còn lại của quý so với pipeline có trọng số → phần thiếu → số lead cần thêm và hạn phải nhận (cuối quý − cycle). Kèm workload hiện tại so với trung vị của team.

### 8.4 Workload

Tổng trọng số các deal đang mở theo vai trò (mục 6), theo người, theo tuần. Leader và Manager xem so sánh trong team; User xem của mình.

## 9. Commission

### 9.1 Cách tính hiện tại (từ file mẫu và chính sách)

| Dòng | Com của SoE |
|---|---|
| POD Showcase | Com sale = Doanh thu × tỉ lệ tra theo (Nguồn lead ML/SH, Level BC, Performance BC). Com SoE = Com sale × **20%**. Chia cho người tham gia theo % com |
| PS | Tỉ lệ PS POD (theo chính sách hiện hành) × doanh thu PS **thực nhận** trong tháng (chưa VAT). Nhiều đợt thì mỗi đợt = % thanh toán × tổng giá trị PS. Chia theo thoả thuận (Quick Start, Lite: Leading 100%) |
| POD Express, Data | Chưa có chính sách. Hiện "Chưa có chính sách" |

### 9.2 Chính sách com có phiên bản

- Bảng hệ thống `commission_policies` + `commission_policy_versions(effective_from, status, created_by)`.
- Một phiên bản gồm: bảng tỉ lệ BC-ML, bảng tỉ lệ BC-SH (Level × Performance → doanh thu tối thiểu, tỉ lệ), tỉ lệ SoE trên com sale, tỉ lệ PS POD, và **công thức cho từng dòng dịch vụ** viết bằng engine công thức, gọi tham số bằng hàm riêng, ví dụ `=[Doanh thu] * POLICY_RATE("BC", [Nguồn lead], [Level BC], [Performance BC]) * POLICY("ti_le_soe") * [% com]`.
- Manager tạo phiên bản mới (nhân bản phiên bản cũ rồi sửa), đặt ngày hiệu lực, kích hoạt. Phiên bản đã kích hoạt **không sửa được**. Áp dụng toàn hệ thống; mọi Manager được báo khi có phiên bản mới; ghi nhật ký.
- Deal dùng phiên bản có hiệu lực tại **Ngày đóng** (4A). Ở 4B là ngày tiền về.
- Phiên bản đầu tiên dựng từ các sheet BC Policy và PDF chính sách, rồi Dương chỉnh sau khi bàn với Manager.

### 9.3 Com tạm tính (4A)

- Cột `Com tạm tính của tôi` tính cho từng người tham gia, khi deal `Thắng`.
- PS ở 4A giả định khách trả đủ (chưa có dữ liệu đợt thanh toán). Mọi chỗ hiện số đều ghi **"Tạm tính"**.
- Thiếu đầu vào (ví dụ chưa có Level BC) thì ô để trống và hiện lý do, không đoán.
- Ai thấy: chính người đó, Leader của họ, Manager của cây, Admin (chỉ đọc). Guest không bao giờ thấy.

## 10. Forecast và snapshot

- **Forecast quý** = deal đang mở có Ngày dự kiến chốt trong quý, tổng Doanh thu dự kiến × % doanh thu, tách theo Nhóm forecast. Hiện cạnh: đã thắng trong quý, KPI và Goal của quý, phần còn thiếu, độ phủ pipeline (pipeline ÷ phần còn thiếu).
- **Snapshot tự động** lúc 00:05 ngày đầu mỗi quý cho toàn bộ deal đang mở (Module 0 mục 10). Manager chụp thêm bất cứ lúc nào.
- **Cuối quý so với snapshot đầu quý**: mỗi deal trong snapshot rơi vào một nhóm: thắng trong quý, trượt sang quý sau, thua/loại, vẫn mở. Độ chính xác = doanh thu thắng thực tế ÷ forecast `Chắc chắn` lúc chụp. Waterfall: pipeline đầu quý + mới vào − thua − thắng = cuối quý.

## 11. Khoá kỳ

- Cột kỳ của Deals: **Ngày đóng** (theo tháng). Manager khoá kỳ cho cây mình (Module 0 mục 11).
- Kỳ đã khoá: không sửa Doanh thu, Trạng thái, Ngày đóng, người tham gia và tỉ lệ của deal đóng trong kỳ, mọi kênh. Cột cá nhân, ghi chú, BANT vẫn sửa được (không ảnh hưởng số).
- Ở 4B, kỳ com tách riêng theo tháng tiền về (mục 12.3).

## 12. Thanh toán và com chính thức (4B — đề xuất, chưa làm)

### 12.1 Bài toán của Manager

- Một hợp đồng trả nhiều đợt; com PS (và có thể cả POD) tính theo tiền **thực nhận** từng tháng.
- Hiện không ai theo dõi đợt sau: trong dữ liệu Raw PODPS, mọi dòng có chia đợt đều chỉ ghi `Lần thanh toán = 1`.
- BPM mới đã có "Bảng chia thanh toán – ver 2" (pháp nhân, doanh thu POD/PS/Data, lần thanh toán, thời hạn) và bước "Theo dõi thanh toán". Dataset "Sổ đề xuất" ghi trạng thái và giá trị hợp đồng.

### 12.2 Dữ liệu đề xuất

| Bảng | Nội dung |
|---|---|
| `deal_payment_schedules` | Đợt dự kiến: deal, đợt số, pháp nhân, loại doanh thu (POD/PS/Data), % hợp đồng, số tiền dự kiến, hạn |
| `deal_payments` | Tiền thực nhận: đợt, ngày nhận, số tiền chưa VAT, nguồn (BPM, kế toán, nhập tay), người xác nhận |
| `commission_entries` | Một dòng cho mỗi (đợt nhận tiền × người): phiên bản chính sách, tiền làm căn cứ, tỉ lệ, % com, số com, tháng com, trạng thái `Tạm tính` → `Đã chốt` → `Đã chi` |
| `commission_periods` | Tháng com, trạng thái mở/đã chốt, người chốt |

### 12.3 Luật đề xuất

- Tiền về → sinh `commission_entries` tạm tính theo chính sách hiệu lực ngày tiền về.
- Manager **chốt kỳ com** theo tháng: dòng của tháng đó không sửa được nữa.
- Sai sót sau khi chốt **không sửa dòng cũ**, mà thêm dòng điều chỉnh (âm hoặc dương) vào tháng đang mở, có lý do. Lịch sử com luôn cộng lại đúng.
- Màn hình Manager: đợt sắp đến hạn, đợt quá hạn, tiền đã về theo tháng, com theo người theo tháng, xuất file đối soát.
- User xem com của mình theo tháng và từng đợt.

### 12.4 Cần chốt trước khi làm 4B

1. Nguồn tiền thực nhận: BPM (bước "Theo dõi thanh toán" bắn webhook), kế toán gửi file, hay Manager nhập tay. Đề xuất: **lấy từ BPM**, không bắt ai gõ lại lần hai ở SoE Hub.
2. Com POD tính theo hợp đồng (lúc thắng) hay theo tiền về như PS.
3. Level BC và Performance BC của sale lấy từ đâu (SoE thường không biết performance của sale trong tháng).
4. Khách trả lại tiền hoặc huỷ hợp đồng thì com bị thu hồi thế nào.
5. Com cho POD Express và Data.

## 13. Chừa chỗ cho phần sau

- Menu `Quản lý Deal` có sẵn mục **Quản lý** (chỉ Manager): Nhập và phân deal, Chính sách com, Khoá kỳ, Snapshot. Các mục chưa làm (Thanh toán & Com, Kế hoạch deal, Yêu cầu xin lead) có chỗ trong cấu trúc menu, ẩn bằng cờ tính năng.
- Tên thao tác giữ sẵn: `deal.payment.*`, `deal.commission.*`, `deal.plan.*`, `deal.lead_request.*`.
- Sự kiện phát ngay từ 4A để 4B, Automation, thông báo dùng: `deal.deal.created`, `deal.deal.assigned`, `deal.status.changed`, `deal.deal.won`, `deal.participant.changed`, `deal.bant.scored`, `deal.period.locked`.
- Chỉ số doanh thu nhận tham số "cơ sở": `hợp đồng` (4A) hoặc `tiền về` (4B), để dashboard đổi cơ sở mà không phải viết lại chỉ số.
- Khoá kỳ đã là cơ chế chung, nên kỳ com ở 4B chỉ là thêm một cột kỳ.

## 14. Hệ thống ngoài và nhập lịch sử

- **API upsert** `deal.upsert` theo `source` + `external_id`, kèm danh sách người tham gia `{ email, role, revenue_share, com_share }`. Tài khoản hệ thống chỉ ghi được vào cây được cấp (Module 1 mục 7).
- Bảng ánh xạ cho BPM `[SoE] Deal Management` (dùng khi nối): Tên doanh nghiệp, MST, Mã nhóm KH, Link CRM, Văn phòng, Đơn vị kinh doanh, Loại dịch vụ, Gói dịch vụ, Deal size ước tính → Doanh thu dự kiến, Ngày dự kiến chốt, Total Revenue (non VAT) → Doanh thu, Closing Date → Ngày đóng, Won Reason, "Danh sách SoE tham gia deal" (SoE, Role, % Com, % Rev) → người tham gia (`Lead SoE` → Leading, `Support SoE` → Associate), outcome → Trạng thái (mục 5).
- **Nhập lịch sử** (Manager, cho cây mình): dùng luồng import của Module 2 với mẫu ánh xạ có sẵn cho định dạng sheet `Raw PODPS` (SoE → người dùng theo username/email, `SoE Associate` → Associate, `Trạng thái deal` → Trạng thái, `Ngày tiếp nhận` → Ngày nhận, `Closing Day` → Ngày đóng, `Total Revenue (Non VAT)` → Doanh thu…). Cột không có chỗ trong template thì tạo thành cột chung. Cột thanh toán của file cũ đưa vào cột chung, chờ 4B.

## 15. Phân quyền và tích hợp với module trước

- Phạm vi xem/sửa đúng Module 1 mục 4.1. Admin xem mọi cây, chỉ đọc.
- **Cột chung**: Manager đẩy cho cả cây, Leader đẩy cho team (deal có Leading thuộc team). Chọn cách điền: `Người tham gia điền` hoặc `Quản lý điền`. Một giá trị mỗi deal. Công thức của cột chung chỉ dùng cột của Deals và bảng hệ thống.
- **Cột cá nhân**: mỗi người tự tạo trên trang Deals của mình; Leader của họ xem được. Công thức được dùng datahub riêng của người đó (có cảnh báo như Module 1 mục 4.2).
- Giới hạn cột: hệ thống theo template; cột chung tối đa 30 mỗi cây; cột cá nhân tối đa 50 mỗi người. Admin chỉnh.
- **Guest**: đăng ký loại dữ liệu "Deals" với khung cấp dữ liệu của Module 1 mục 5.2: chỉ cột hệ thống + cột chung, không bao giờ cột cá nhân và com.
- **Chuyển giao**: đăng ký `transferHandler` cho deal theo Module 1 mục 8 (deal mở chuyển vai trò, deal đóng giữ người cũ).
- Form (Module 7) không ghi vào Deals.

## 16. Dashboard Deals mặc định

Dashboard hệ thống, khoá, đầu danh sách; người dùng nhân bản để tuỳ chỉnh (Module 3 mục 8). Cùng một dashboard, số theo phạm vi người xem.

| Khu | Biểu đồ |
|---|---|
| Tổng quan | Thẻ: Doanh thu quý (bullet KPI/Goal), Winrate cohort, Deal cycle trung vị, Deal size trung vị, Lead nhận tháng này, Deal đang mở |
| Doanh thu | Cột chồng theo tháng, tách dòng dịch vụ; tỉ trọng Software / Non-software |
| Phễu | Lead nhận → Qualified → Thắng (CR2), theo dòng dịch vụ |
| Index | Bảng pivot tháng × chỉ số (thay sheet Index), bảng luỹ kế (thay Cumulative Index) |
| Winrate | Bảng tam giác cohort; đường winrate theo kỳ đóng |
| Forecast | Cột theo quý: đã thắng + Chắc chắn + Có thể + Pipeline, đường KPI/Goal; waterfall so snapshot |
| Phân bố | Box plot deal size, histogram cycle, outlier |
| Ưu tiên | Ma trận BANT; top deal sắp chốt; số deal cần chấm lại |
| Team (Leader, Manager) | Workload theo người; doanh thu và winrate theo người |

## 17. Giao diện tối thiểu (Stage 4)

- Trang Deals (grid của Module 2), view hệ thống, chi tiết deal (người tham gia, BANT, lịch sử, deal liên quan).
- Ô chấm BANT nhanh trong hàng chờ "Cần chấm lại".
- Kế hoạch & KPI; Forecast; Dashboard Deals.
- Manager: tạo/phân deal, người tham gia và tỉ lệ, đẩy cột chung, chính sách com (phiên bản), khoá kỳ, snapshot, nhập lịch sử.
- Leader: đẩy cột chung cho team.
- Admin: template Deals (cột, lựa chọn, quyền sửa từng cột), danh mục dịch vụ.

## 18. Kiểm thử

- Unit: quy tắc BANT, hàng chờ chấm lại, winrate cohort và mốc "đã chín", chia doanh thu theo %, com tạm tính theo phiên bản chính sách, ràng buộc trạng thái.
- Ma trận quyền: vai trò × cột × kênh, cột chung của Leader, cột cá nhân, Guest không thấy cột cá nhân và com, khoá kỳ.
- **Golden test:** sheet `Deals` của file mẫu **không có dòng dữ liệu**, nên Index và Cumulative Index trong file đều bằng 0, không so số được với Excel. Thay bằng: import `Raw PODPS` vào Deals, tính chỉ số bằng SoE Hub, so với một script tham chiếu độc lập đọc thẳng file `examples/` trên máy (dùng đúng logic COUNTIFS/SUMIFS của sheet Index). Không commit dữ liệu hay kết quả; máy không có file thì bỏ qua.
- Test com dùng bảng tỉ lệ tự dựng, không dùng số của chính sách thật.
- Load test 100.000 deal: trang Deals, hàng chờ, dashboard mặc định (Module 0 mục 1, Module 3 mục 6.1).

## 19. Thay đổi so với quy định cũ

- Không đổi quy định đã chốt nào.
- Làm rõ: "chính sách com có phiên bản" ở bản 4A dùng cho com **tạm tính**; com chính thức theo tiền về và "chốt kỳ com" chuyển sang 4B (CLAUDE.md đang ghi "khoá kỳ / chốt kỳ com là việc của Manager": vẫn đúng, chỉ chia thời điểm làm).
- Module 0 mục 21 (golden test so với Excel) được điều chỉnh như mục 18, vì file mẫu không có dữ liệu ở sheet Deals.

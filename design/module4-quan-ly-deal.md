# Module 4 — Quản lý Deal

> Trạng thái: **Đã chốt** · 19/11/2026 (bản nháp vòng 2 ngày 18/11, Dương chốt nguyên bản).
> **Sửa 19/11/2026 lần 2, Dương chốt toàn bộ cùng ngày (sau khi hỏi Manager):** nguyên tắc dữ liệu là công thức, chức năng thuộc module (mục 1.5); Người tham gia lên lớp Cơ bản; bảng Tiền về; thanh toán và com theo đợt, deal chỉ Won khi tiền về, Sổ com, chốt kỳ gộp khoá kỳ với chốt com, ghép tiền về (mục 7 viết lại); Closing date do hệ thống điền, thêm Ngày dự kiến chốt, bỏ cột `Không tính vào báo cáo`, % com tính trên com sale (mục 4, 5, 9, 10, 11, 12); chuyển vai trò cột khi kỳ đã chốt, vai trò trong dashboard (mục 3.7, 13).
> Không ghi số của chính sách thật vào file này (repo public); số nằm trong `examples/` và trong dữ liệu chính sách của hệ thống.
> Phụ thuộc: [Module 0](module0-nen-tang.md) (registry, lịch sử dòng, khoá kỳ, snapshot, outbox), [Module 1](module1-tai-khoan-phan-quyen.md) (cây tổ chức, phạm vi deal, Guest, chuyển giao), [Module 2](module2-datahub.md) (engine bảng, nguồn cột, công thức, liên kết, view), [Module 3](module3-metric-dashboard.md) (chỉ số, dashboard, snapshot trong chỉ số).
> Đổi bởi [Module 7](module7-dynamic-form.md) (chốt 19/11/2026): datahub "Quản lý Deal" không làm đích và không làm nguồn dữ liệu của Form (mở rộng mục 15).
> **Sửa 19/11/2026 (Dương chốt):** bảng template (chung/riêng, khoá phân chia), quyền sửa ô do người tạo bảng cấp, vai trò cột, template theo cây và theo team, trang Template; bỏ bảng `deals` có cột thật (mục 1.2, 1.3, 2, 3.1, 3.4, 3.5–3.8, 16, 18, 19).
> Để module sau: tool MCP (Module 5); nhắc hạn, nhắc chấm BANT (Module 6); gắn việc vào deal (Module 10).

Nguồn: `examples/Quản lý Deal SoE (Dương TVD).xlsx` (sheet **Deals** là template mẫu, **Data Validation** là danh sách lựa chọn, **Index** là bảng theo tháng), `examples/bpm-dataset-soe.md` (BPM `[SoE] Deal Management`, Dataset `SOE`), `examples/chinh_sach_base_crm_ver_2.0_01062026_.pdf` (mục 4 Commission), workspace Base Inc (KPI, Goal, quy tắc BANT H-002).

---

## 1. Khái niệm

### 1.1 Quản lý Deal là một datahub được bảo vệ

Quản lý Deal chạy trên **engine Datahub** (bảng, cột, công thức, view, khoá phân chia như mọi bảng), nhưng là **chức năng riêng**, có menu riêng (sửa 19/11/2026, Dương chốt).

| Menu | Người dùng thấy | Được làm |
|---|---|---|
| **Quản lý Deal** | Datahub "Quản lý Deal": bảng mặc định, bảng tự tạo, dashboard | Tạo bảng mới |
| **Datahub** | Các datahub thường của mình. **Không** hiện datahub "Quản lý Deal" | Tạo datahub mới |

- **Không hiện trong Datahub nhưng vẫn tham chiếu được.** Bảng của datahub "Quản lý Deal" (Deals, Index, Sổ com, bảng tự tạo…) vẫn là bảng của chính người đó, nên datahub thường của họ dùng được như mọi bảng của mình: công thức (`[Deals].[Doanh thu]`), cột Liên kết/Lookup/Rollup, nguồn bảng gộp và chỉ số (Module 3 mục 4.1). Trình soạn công thức và các ô chọn bảng liệt kê chúng trong nhóm riêng "Quản lý Deal". Dữ liệu đọc sang vẫn theo khoá phân chia của người đọc. Ngoại lệ đã chốt: không làm đích, không làm nguồn của Form (Module 7 mục 1.1).
- Danh sách datahub (`datahub.list`, trang Datahub, tool `datahub_list` của Module 5) loại datahub "Quản lý Deal".
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
| **Đợt thanh toán** | Xem | Xem | ✓ | Bảng chung, mỗi đợt thanh toán của hợp đồng một dòng, khoá phân chia theo người tham gia deal (mục 7) |
| **Sổ com** | Xem | Xem | ✓ | Bảng chung, mỗi người mỗi đợt một dòng com, khoá phân chia theo người nhận (mục 7) |
| **Tiền về** | – | – | ✓ | Mỗi khoản tiền vào tài khoản (mỗi UNC) một dòng, liên kết tới một hoặc nhiều đợt (mục 7.3a). Chỉ Manager |

Mọi bảng mặc định ở trên là **bảng template** do hệ thống sinh sẵn (mục 3.5), không có code riêng cho từng bảng. Manager hoặc Leader cần quản lý thêm việc gì thì **tạo một bảng template** ở trang Template (mục 3.8), nối với Deals bằng cột liên kết, lookup, rollup. Không cần đụng code.

### 1.3 Bảo vệ

- Không xoá, không đổi tên datahub "Quản lý Deal".
- Bảng template và cột template không xoá, không đổi tên, không đổi kiểu **từ trang bảng**. Chỉ người có quyền sửa template đổi được, ở **trang Template** (mục 3.8). Bỏ bảng hoặc cột template là lưu trữ, không xoá hẳn.
- Bảng tự tạo trong "Quản lý Deal" là bảng thường: của riêng người tạo, xoá và sửa tự do, chia sẻ như Module 2.

### 1.4 Một deal ứng với một loại dịch vụ

Khách mua POD và PS là **hai deal**, liên kết với nhau. Cách này khớp với file mẫu (mỗi dòng có một `Loại deal`) và với BPM (mỗi phiếu có một `Loại dịch vụ`).

### 1.5 Dữ liệu là công thức, chức năng thuộc module

Nguyên tắc (Dương chốt 19/11/2026), để bảo trì và nâng cấp module đơn giản:

- **Dữ liệu** (giá trị của một ô suy ra được từ ô khác) luôn là **công thức, lookup, rollup** của engine Datahub. Ví dụ: Doanh thu, Closing date, Tỉ lệ com sale, Đã thu, Thanh toán, mọi cột của Index. Sửa ở trang Template, không sửa code.
- **Chức năng** (thao tác tạo dòng, đổi trạng thái theo sự kiện, đóng băng, kiểm tra nghiệp vụ) là **command của module Quản lý Deal** trong registry, gom một chỗ (`apps/api/src/modules/deals/`), tìm cột theo vai trò (mục 3.7). Danh sách đầy đủ:

| Chức năng | Mục |
|---|---|
| Lập lịch thanh toán, xác nhận tiền về (kèm đặt `Won`, sinh Sổ com), huỷ xác nhận, ghép tiền về | 7.4, 7.5 |
| Chốt kỳ, mở lại kỳ, điều chỉnh com | 12, 7.4 |
| Commit Probation KPI | 6 |
| Sinh dòng tháng của Index (job ngày 1) | 5 |
| Snapshot pipeline đầu quý | 11 |
| Lịch sử chấm BANT, hàng chờ "Cần chấm lại hôm nay" | 8 |
| Khoá dòng chính sách đã có hiệu lực | 9 |
| Ràng buộc: tổng % com ≤ `Tỉ lệ SoE`, tổng % doanh thu ≤ 100%, `Won` không chọn tay, người tham gia cùng cây | 4.4, 4.5 |
| Chặn chuyển vai trò cột làm đổi số kỳ đã chốt | 3.7 |

- Cơ chế dùng chung của engine (tự điền từ `Người tham gia`, khoá phân chia, kiểu cột "Ngày sửa của cột") không thuộc danh sách này: chúng ở Module 2, bảng nào cũng dùng được.
- Thêm việc mới: nếu là giá trị suy ra được thì làm công thức; chỉ thành command khi công thức không làm được (tạo dòng, đóng băng, phản ứng theo sự kiện).

## 2. Dữ liệu dùng chung và phạm vi

- **Deals:** một bản ghi mỗi deal, lưu ở `dh_rows` như mọi bảng của Datahub. **Không có bảng `deals` riêng, không có cột thật của Postgres** (sửa 19/11). Deals là bảng template chung, **khoá phân chia bật**, khoá là `Người tham gia` (mục 3.5, Module 2 mục 10). Phạm vi dưới đây là kết quả của luật khoá phân chia chung, không phải luật riêng của Deals. Manager tắt được khoá phân chia của Deals (có cảnh báo): khi đó mọi người trong cây thấy mọi deal. Bảng Deals trong datahub của mỗi người là **cùng tập bản ghi đó, đã áp phạm vi**: User thấy deal mình tham gia, Leader thấy của mình và team, Manager thấy cả cây, Admin xem mọi cây ở chế độ chỉ đọc (Module 1 mục 4.1).
- **Probation KPI:** một bản ghi mỗi (người, năm), phạm vi giống Deals.
- **Đợt thanh toán, Sổ com:** bảng chung của cây, phạm vi theo khoá phân chia (mục 7).
- **Index, bảng tự tạo:** của riêng chủ datahub, theo luật riêng tư của Datahub (Module 1 mục 4.2).
- Mỗi deal thuộc **một cây** (đặt lúc tạo). Team của deal để báo cáo = team của người Leading **tại Start date**.
- Deal không bao giờ bị xoá cứng (`neverHardDelete`); Manager chỉ đánh dấu `Huỷ`.

## 3. Template cột

### 3.1 Bốn lớp cột

| Lớp | Ai sửa | Áp dụng cho | Ví dụ |
|---|---|---|---|
| **Cơ bản** | Admin, Manager (cây mình) | Mọi người trong phạm vi của bảng | Các cột của sheet Deals |
| **Theo vai trò** | Admin, Manager | Mọi người có vai trò đó | Leader: `Com của team`. Manager: `Com của deal` |
| **Theo team** | Leader, nếu bảng cho phép (mục 3.8) | Thành viên team của Leader đó | Một cột Leader muốn cả team điền |
| **Tuỳ chỉnh** | Từng người | Chỉ người đó | `Thời gian showcase`, cột công thức riêng |

- Template áp dụng cho mọi bảng template: bảng mặc định (Deals, Index, Probation KPI, Đợt thanh toán, Sổ com, Chính sách com, Tham số com) và bảng template Manager, Leader tạo thêm (mục 3.5).
- **Sửa template thì áp dụng ngay cho mọi người trong phạm vi.** Ví dụ tháng 12 Manager thêm một cột vào lớp Cơ bản của Deals: mọi người thấy cột đó ngay. Cột tuỳ chỉnh của từng người **không bị ảnh hưởng**.
- Cột template mới trùng tên với cột tuỳ chỉnh của ai đó: cột tuỳ chỉnh được đổi tên thành `<tên> (riêng)` và người đó nhận thông báo. Dữ liệu và công thức giữ nguyên (công thức trỏ theo mã cột).
- Bỏ một cột template: cột bị ẩn và lưu trữ, dữ liệu và lịch sử giữ nguyên, khôi phục được. Không xoá hẳn.
- Đổi kiểu cột template: theo luồng đổi kiểu của Module 2 (xem trước, báo giá trị không chuyển được).
- **Template theo cây** (sửa 19/11). Hệ thống có một **bộ mặc định**. Khi có cây mới, cây đó được sinh một bộ template từ bộ mặc định. Admin sửa bộ mặc định và template của mọi cây. Manager sửa template của cây mình. Sửa bộ mặc định chỉ ảnh hưởng cây tạo sau. Cột có vai trò (mục 3.7) có ở mọi cây.
- Mọi lần sửa đều ghi nhật ký. Manager của cây nhận thông báo; Leader sửa thì Manager của Leader đó nhận thông báo.

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
| Ai sửa ô | Do người tạo bảng cấp (mục 3.6). Cột công thức: chỉ hệ thống |
| Vai trò cột | Không có, hoặc một vai trò trong bộ cố định (mục 3.7) |
| Hiển thị mặc định | Hiện hoặc ẩn trong view mặc định |

Cột cách lưu "mỗi người một giá trị" (ví dụ `Vai trò của tôi`, `% Com cá nhân`) và cột công thức dùng chúng (ví dụ `Com`) có giá trị riêng cho từng người, vẫn tính sẵn và lưu (Module 2 mục 6.5). Mỗi deal chỉ vài người thấy nên số bản ghi nhỏ.

### 3.5 Bảng template

Bảng template là bảng **có sẵn cột**, do người có quyền dựng ở trang Template, rồi sinh vào datahub "Quản lý Deal" của mọi người trong phạm vi. Khác bảng tự tạo ở một điểm: người nhận **chỉ thêm được cột riêng**, không sửa, không đổi tên, không xoá bảng hay cột sẵn có. Bảng template là bảng thường của engine Datahub, chỉ bị giới hạn quyền tuỳ chỉnh. Không có code riêng cho từng bảng.

**Phạm vi theo người tạo**

| Người tạo | Áp dụng cho |
|---|---|
| Admin | Bộ mặc định (sinh cho cây mới) |
| Manager | Mọi người trong cây của Manager |
| Leader | Thành viên team của Leader. Template gắn với **team**, không gắn với người: đổi Leader thì template ở lại cho Leader mới |

- Người đổi team: bảng template của team cũ bị ẩn và lưu trữ, dữ liệu giữ nguyên; bảng của team mới hiện ra. Về lại team cũ thì hiện lại.
- Bảng template trùng tên với bảng tự tạo của ai đó: bảng tự tạo đổi thành `<tên> (riêng)`, người đó nhận thông báo.
- Bỏ bảng template: lưu trữ, không xoá hẳn, khôi phục được.
- Bảng template không tính vào giới hạn số bảng của người nhận. Admin đặt giới hạn số bảng template mỗi cây và mỗi team (mặc định 20).

**Hai kiểu, chọn khi tạo, không đổi sau**

| Kiểu | Dữ liệu | Ví dụ |
|---|---|---|
| **Bảng chung** | Một bộ dòng. Các cột **khoá phân chia** quyết định dòng hiện ở bảng của ai | Deals (khoá = `Người tham gia`), Probation KPI (khoá = người được đánh giá), bảng Leader tạo cho team |
| **Bảng riêng** | Mỗi người một bảng cùng cấu trúc, dữ liệu riêng tư theo luật Datahub. Người tạo bảng không xem dữ liệu | Index |

**Bảng chung**

Bảng chung dùng đúng cơ chế chia sẻ của Module 2 mục 10, không có luật riêng:

- **Thành viên** tự sinh theo phạm vi: cả cây với bảng của Manager, cả team với bảng của Leader (Manager của cây được thêm với quyền Xem). Người mới vào cây hay team tự được thêm, người rời đi tự bị gỡ. Người tạo bảng thêm người khác như chia sẻ thường. Mặc định: thành viên có quyền Sửa với Deals và Probation KPI; bảng do Manager, Leader tạo thì người tạo chọn.
- **Khoá phân chia** bật hay tắt do người tạo bảng chọn (Module 2 mục 10): 1–5 cột khoá kiểu Người dùng, một cột khoá chính. Deals bật sẵn với một khoá `Người tham gia`, vì % doanh thu và % com phải cộng không quá 100% trong cùng một cột.
- Ô Người dùng (kể cả `Người tham gia`) chỉ nhận thành viên của bảng.
- Bảng template không tự sinh cột "của tôi" nào. Riêng Deals giữ các cột tự điền từ `Người tham gia` đã chốt ở mục 4.1 và 4.5.
- Admin xem chỉ đọc mọi bảng chung trong datahub "Quản lý Deal" như Deals.
- Xoá dòng: xoá mềm theo Module 2. Deals giữ luật riêng: không xoá cứng, chỉ Manager đánh dấu `Huỷ`.

### 3.6 Quyền sửa ô trong bảng template

- Theo Module 2 mục 10: một người sửa được ô khi có quyền **Sửa** trong danh sách thành viên **và** cột được **cho phép sửa**. Người tạo bảng đặt cho phép hay không cho từng cột, mặc định không cho phép. Không có lựa chọn chi tiết hơn (theo nhãn, theo cột khoá).
- Mọi người thấy dòng có cùng quyền với cột được cho phép. Không phân biệt Leading với Associate (Dương chốt 19/11/2026).
- Người tạo bảng luôn sửa được. Cột không cho phép thì chỉ người tạo bảng sửa.
- Cột công thức không ai sửa ô; chỉ sửa công thức ở trang Template.
- **Cột riêng** (lớp Tuỳ chỉnh) của mỗi người: chỉ người đó thấy và sửa. Không ai cấp, không ai khác xem.

### 3.7 Vai trò cột

Một số chức năng cần biết cột nào mang nghĩa gì. Thay vì viết cứng cột, cột được gắn **vai trò**, và chức năng tìm cột theo vai trò, không theo tên hay mã cố định.

| Vai trò (bảng Deals) | Kiểu cần có | Chức năng dùng |
|---|---|---|
| `ngày chốt` (Closing date) | Ngày | Khoá kỳ, forecast, Index, snapshot |
| `ngày bắt đầu` (Start date) | Ngày | Team của deal, cohort CR1/CR2 |
| `doanh thu` | Tiền | Index, forecast, com |
| `trạng thái` (Status) | Một lựa chọn; mỗi lựa chọn gắn nghĩa mở / thắng / thua / huỷ | Khoá kỳ, forecast, BANT, Index |
| `loại deal` | Một lựa chọn | Com, Index |
| `người tham gia` | Người dùng có thuộc tính (khoá phân chia) | Phạm vi xem, chia doanh thu và com |
| `mã deal` | Công thức ra chữ | API ngoài, liên kết |
| `ngày dự kiến chốt` | Ngày | Forecast, snapshot |
| `doanh thu được tính` | Tiền, mỗi người một giá trị | Dashboard hệ thống, Index, KPI (phần doanh thu tính cho người xem: User phần của mình, Leader phần của team, Manager tổng đã chia) |
| `giá trị hợp đồng`, `đã thu` | Tiền | Thanh toán, forecast |

Vai trò của bảng Đợt thanh toán và Sổ com: mục 7.6.

- Bộ vai trò là cố định, do chức năng khai báo khi cần. **Người dùng không tạo vai trò mới**: vai trò chỉ có nghĩa khi có code đọc nó; nhu cầu của người dùng (công thức, chỉ số, bộ lọc, dashboard) đã chọn cột trực tiếp được. Khi một tính năng mới cần vai trò mới, code khai báo kèm: kiểu cột cần có, bảng template dùng nó, cột mặc định được gắn trong bộ mặc định. Cây đang chạy được gắn tự động nếu có cột cùng tên và đúng kiểu; không có thì Manager nhận thông báo vào chọn.
- Bảng template do Manager, Leader tạo không có vai trò bắt buộc, trừ khoá phân chia của bảng chung.
- **Chuyển vai trò sang cột khác:** qua màn xem trước liệt kê chức năng, chỉ số, dashboard đang dùng vai trò và số deal có giá trị khác giữa cột cũ và cột mới. Nếu việc chuyển làm đổi số của **deal thuộc kỳ đã chốt** (mục 12) thì không cho chuyển, báo "5 deal thuộc kỳ tháng 10 đã chốt, mở lại kỳ trước". Lý do: chuyển vai trò là đường vòng đổi số của kỳ đã chốt mà không sửa ô nào. Manager mở lại kỳ, chuyển, rồi chốt lại; cả ba bước có nhật ký. Không làm vai trò có phiên bản theo kỳ (phức tạp, phục vụ tình huống hiếm).
- **Vai trò và quyền xem:** vai trò chỉ chọn **cột nào**, khoá phân chia chọn **dòng nào**. Không có bộ lọc riêng cho vai trò: khoá phân chia tắt thì chỉ số theo vai trò gom mọi dòng của bảng, bật thì gom đúng các dòng người xem thấy. Ví dụ Manager thấy tổng 10 tỉ, User thấy phần của mình 300tr.
- **Đổi tên cột, sửa công thức, đổi định dạng, đổi tên lựa chọn:** được, kèm cảnh báo liệt kê nơi đang dùng ("Khoá kỳ, forecast, Dashboard X dùng cột này"). Lựa chọn của `trạng thái` gắn nghĩa theo mã, nên đổi tên lựa chọn không làm vỡ chức năng.
- **Đổi kiểu, bỏ cột:** chỉ được khi cột vẫn đúng kiểu vai trò cần. Nếu không, phải chuyển vai trò sang một cột khác đúng kiểu trước. **Không bao giờ để một vai trò không có cột.**
- Chỉ người sửa được template của bảng đó mới gắn hoặc chuyển vai trò.
- API ngoài và nhập lịch sử ánh xạ theo vai trò hoặc mã cột, không theo tên cột.

### 3.8 Trang Template

**Một trang, nhiều lối vào**

- Menu Quản lý Deal → **Template**: Manager và Leader thấy.
- Nút ở đầu trang datahub "Quản lý Deal".
- Menu của cột template → **Sửa trong template**: mở đúng cột đó.
- Cài đặt → Datahub → **Template Quản lý Deal**: lối vào của Admin (Admin không có datahub "Quản lý Deal", mục 1.1).

**Bố cục**

- Trái: danh sách bảng nhóm theo phạm vi (Bộ mặc định / Cây của tôi / Team X), mỗi bảng có nhãn ai sửa.
- Phải: danh sách cột của bảng theo lớp, dùng lại phần quản lý cột của Module 2. Không có grid dữ liệu (template không có dữ liệu).
- Leader thấy bảng do Manager tạo ở chế độ chỉ xem, kèm lý do vì sao không sửa được.

**Chức năng**

- Tạo bảng template: tên, kiểu (chung / riêng), quyền mặc định của thành viên, khoá phân chia bật/tắt với 1–5 cột khoá kiểu Người dùng và cột khoá chính (mục 3.5).
- Đổi tên bảng, bỏ bảng (lưu trữ), khôi phục.
- Thêm, sửa, đổi tên, bỏ cột; thuộc tính cột (mục 3.4); quyền sửa ô (mục 3.6); vai trò cột (mục 3.7).
- **Quyền theo bảng nằm ngay trên trang này**, không tách ra Cài đặt: mỗi bảng có tuỳ chọn "Leader được thêm cột team: có / không", Admin và Manager đặt. Mặc định **tắt** với Deals, Chính sách com, Tham số com, Đợt thanh toán, Sổ com; **bật** với Index, Probation KPI. Leader không bao giờ đổi tên, bỏ, đổi kiểu cột của lớp khác; với bảng chung chỉ thêm cột lớp Theo team và sửa công thức cho team (mục 3.3).
- Mọi thay đổi đi qua màn xem trước "Áp dụng cho N người" rồi mới xác nhận.

## 4. Bảng Deals

### 4.1 Cột cơ bản (theo sheet Deals)

| # | Cột | Kiểu | Ghi chú |
|---|---|---|---|
| 1 | Tên công ty | Văn bản | Bắt buộc |
| 2 | Loại deal | Một lựa chọn | `POD bán mới`, `POD CSM`, `POD Express`, `PS kèm POD`, `PS không kèm POD`, `Data` (Data Validation) |
| 3 | Start date | Ngày | Ngày nhận deal. Bắt buộc |
| 4 | Ngày dự kiến chốt | Ngày | Deal đang mở: ngày dự kiến tiền về đợt đầu. Forecast dùng. Nhập tay (BPM: `Ngày dự kiến chốt`) |
| 5 | Closing date | Công thức | `IF([Ngày đóng (sửa tay)]<>"", [Ngày đóng (sửa tay)], IF([Status]="Won", [Ngày tiền về đầu tiên], IF(OR([Status]="Lost", [Status]="Disqualified", [Status]="Convert to POD", [Status]="Huỷ"), [Ngày đổi Status], "")))`. Deal mở để trống. Công thức so tên lựa chọn; đổi tên lựa chọn thì công thức được cập nhật theo (Module 2 mục 6) |
| 5a | Ngày đóng (sửa tay) | Ngày | Manager nhập khi biết ngày chính xác hơn; để trống thì dùng ngày tự tính |
| 5b | Ngày tiền về đầu tiên | Rollup | MIN `Ngày tiền về` của các đợt. Ẩn mặc định |
| 5c | Ngày đổi Status | Ngày sửa của cột (Module 2 mục 4) | Theo dõi cột Status. Ẩn mặc định |
| 6 | Ghi chú | Văn bản dài | |
| 7 | Sale | Văn bản | Email hoặc tên sale (sale không phải người dùng SoE Hub) |
| 8 | Status | Một lựa chọn | Mục 4.4 |
| 9a | Doanh thu dự kiến | Tiền | Nhập tay khi deal mở (BPM: Revenue (Forecast)). Forecast dùng |
| 9 | Doanh thu | Công thức | `IF([Status]="Won", [Đã thu], [Doanh thu dự kiến])`. Một cột không thể vừa nhập tay vừa là rollup, nên tách: deal mở là số dự kiến, deal Won là **tổng tiền đã về** (chưa VAT) |
| 10 | Nguồn lead | Một lựa chọn | `ML` (Marketing Lead), `SH` (Sale Hunt). Đọc từ phiếu request |
| 11 | Level BC | Một lựa chọn | `Level 0` đến `Level 9`. Đọc từ phiếu request |
| 12 | Performance BC | Một lựa chọn | `Under KPI`, `KPI`, `Goal`, `Out performance`. Đọc từ phiếu request |
| 13 | Tỉ lệ com sale | Công thức | Tra chính sách com (mục 9) theo Loại deal, Nguồn lead, Level BC, Performance BC, bản hiệu lực tại Closing date (deal mở: Ngày dự kiến chốt) |
| 14 | % Com cá nhân | Phần trăm, tự điền, mỗi người một giá trị | **% trên com của sale** Manager chia cho người đó ở `Người tham gia` (ví dụ com sale 100tr, A 15% = 15tr). Là mặc định cho các đợt chưa về; mỗi đợt chia riêng được (mục 7). Chưa chia thì 0 |
| 15 | Com dự kiến của tôi | Công thức | `[Giá trị hợp đồng] * [Tỉ lệ com sale] * [% Com cá nhân]`, deal chưa có lịch dùng `[Doanh thu]`. Luôn ghi **Tạm tính** |

Thêm vào lớp Cơ bản vì hệ thống cần:

| # | Cột | Lý do |
|---|---|---|
| 16 | Mã deal | Công thức, tự ra khi có dòng mới: `="D-"&TEXT(ROW_NO(), "000000")`. Tạm thời chưa bắt Manager quản lý theo mã; sau này đổi cách đặt mã thì sửa công thức. Sửa công thức thì mã của **mọi** deal đổi theo, nên trình sửa cảnh báo trước. API, liên kết và lịch sử dùng `id` của dòng, không dùng mã này, nên đổi mã không làm hỏng dữ liệu |
| 17 | **Người tham gia** | Người dùng có thuộc tính (mục 4.5). **Lớp Cơ bản: mọi người thấy, chỉ Manager sửa** (sửa 19/11 lần 2). Mọi người tham gia thấy tên, vai trò, % doanh thu, % com của nhau, để biết deal chia cho mình và người khác bao nhiêu. Thay cho cột `Thành viên deal` cũ |
| 17e | Tổng % com đã chia | Tự điền, giá trị chung. Cảnh báo khi khác mức trần `Tỉ lệ SoE` |
| 17f | Số đợt, Số đợt đã về | Rollup từ Đợt thanh toán |
| 17a | Vai trò của tôi (cột hỗ trợ tính) | Nhãn `Leading` / `Associate` / `Advisor`, tự điền, mỗi người một giá trị (mục 4.5) |
| 17b | % doanh thu của tôi | Phần trăm, tự điền, mỗi người một giá trị |
| 17c | Tính vào số deal của tôi | Có/không, tự điền, mỗi người một giá trị (mục 4.5) |
| 17d | Doanh thu tính cho tôi | Công thức, mỗi người một giá trị: `[Doanh thu] * [% doanh thu tính cho tôi]`. Vai trò `doanh thu được tính`. `% doanh thu tính cho tôi` là % của mình (User), tổng % của team (Leader), tổng % đã chia (Manager) |
| 18 | Mức ưu tiên (BANT) | Brief yêu cầu. Bốn cột B, A, N, T ẩn mặc định, chấm trong ngăn chi tiết deal (mục 8) |
| 19 | Mã số thuế | Nhận ra cùng khách: gợi ý `PS kèm POD`, khớp phiếu BPM, chống trùng, ghép tiền về |
| 20 | Nhóm dịch vụ | Công thức, ẩn: `POD` / `PS` / `Khác` theo Data Validation; `Software` / `Non-software` cho bảng luỹ kế |
| 21 | Giá trị hợp đồng | Rollup: tổng `Số tiền dự kiến` của các đợt (chưa VAT) |
| 22 | Đã thu, Còn lại | Rollup: tổng `Số tiền về`; `Giá trị hợp đồng − Đã thu` |
| 23 | Thanh toán | Công thức: `Chưa có lịch` / `Chờ tiền về` / `Đang thu` / `Đã thu đủ` |
| 24 | Com đã nhận của tôi, Com tạm tính của tôi, Com chờ nhận của tôi | Rollup từ Sổ com theo người đọc (dòng `Đã chốt` + `Điều chỉnh`; dòng `Tạm tính`); chờ nhận = các đợt chưa về × Tỉ lệ com sale × % Com cá nhân |

- **Cột "của tôi" (14, 17a–17d) là cột hỗ trợ tính, ẩn mặc định.** Người dùng nhìn `Người tham gia`. Các cột này có mặt để công thức (Index, com dự kiến, doanh thu tính cho tôi) lấy "phần của tôi" bằng hàm Excel thường, không cần hàm biết ai đang xem (mục 4.5). Ai cần thì bật hiện trong view của mình.
- **Số tiền com chỉ thấy của mình:** mỗi người thấy % com của mọi người tham gia nhưng chỉ thấy **số tiền** com của chính mình (`Com dự kiến của tôi`, các cột com của tôi, Sổ com theo khoá phân chia). `Com của deal` (tổng tiền) chỉ Manager thấy.
- **Bỏ cột `Không tính vào báo cáo`** của sheet cũ. Cột này dùng cho Associate, Advisor chọn không tính doanh thu hoặc số deal, tức là lựa chọn của **từng người tham gia**, không phải của deal. Thay bằng hai thuộc tính trong `Người tham gia`: `% doanh thu` (0 là không tính doanh thu) và `Tính vào số deal` (mục 4.5). Một nguồn duy nhất, không có chỗ hai giá trị nói ngược nhau.
- Không đưa vào template ban đầu (Manager thêm khi cần, hoặc mỗi người tự thêm): Link CRM, Văn phòng, Đơn vị kinh doanh, Giai đoạn, Việc tiếp theo, Lý do thắng/thua, Thời gian showcase.

### 4.2 Cột theo vai trò (mặc định)

| Vai trò | Cột thêm |
|---|---|
| User | Không thêm (đã có các cột com và doanh thu "của tôi") |
| Leader | `% com của team` (tự điền: tổng % com của thành viên team mình trong deal), `% doanh thu của team`, `Com đã nhận của team`, `Com chờ nhận của team` (rollup Sổ com và Đợt như cột "của tôi") |
| Manager | `Com của deal` (rollup mọi dòng Sổ com của deal). `Người tham gia`, `Tổng % com đã chia`, `Số đợt` đã chuyển sang lớp Cơ bản (mục 4.1) |

### 4.3 Quyền sửa mặc định

Theo mục 3.6: thành viên có quyền Sửa; cột được cho phép thì mọi người thấy deal sửa được, cột không cho phép thì chỉ Manager (người tạo bảng) sửa.

| Cột | Cho phép sửa | Ghi chú |
|---|---|---|
| Tên công ty, Start date, Ngày dự kiến chốt, Ghi chú, Sale, Doanh thu dự kiến, Nguồn lead, Level BC, Performance BC, BANT, Mã số thuế | Có | Mọi người tham gia deal sửa như nhau. Leader sửa deal của team khi thành viên bật "Cho phép leader sửa deal của tôi" |
| Status | Có, trừ `Won` và `Huỷ` | `Won` chỉ do xác nhận tiền về đặt (mục 4.4). `Huỷ` chỉ Manager |
| Loại deal, Ngày đóng (sửa tay) | Không | Manager. Closing date là công thức, Manager ghi đè qua `Ngày đóng (sửa tay)` |
| Người tham gia | Không | Manager |
| Cột tự điền từ Người tham gia (14, 17a–17c, 17e, cột % của team) | Không | Sửa qua Người tham gia |
| Cột rollup, cột công thức | — | Không ai sửa ô |
| Cột tuỳ chỉnh của mình | — | Chỉ chủ cột |

Admin, Manager đổi cho phép sửa từng cột ở trang Template. Kỳ đã chốt khoá thêm một số cột (mục 12).

### 4.4 Status

| Status | Mở/đóng | Ghi chú |
|---|---|---|
| Processing | Mở | Mặc định. Gồm cả deal đã ký hợp đồng, đã có lịch thanh toán nhưng chưa có tiền về |
| Pending | Mở | Tạm dừng. Sheet Index có đếm `Pending` dù Data Validation chưa có |
| Won | Đóng | **Chỉ khi tiền về**: hệ thống đặt khi đợt thanh toán đầu tiên được xác nhận (mục 7). Không chọn tay. Huỷ xác nhận đợt duy nhất đã về (trước khi chốt kỳ) thì deal về lại Processing |
| Lost | Đóng | Đã gặp khách nhưng không chốt |
| Disqualified | Đóng | **Dừng trước khi gặp được khách** |
| Convert to POD | Đóng | Chỉ POD Express. Liên kết sang deal POD mới |
| Huỷ | Đóng | Chỉ Manager. Không vào chỉ số nào |

Kiểm chứng `Disqualified`: trong `Raw PODPS`, deal Disqualified chỉ dừng ở `Tiếp nhận khách hàng` hoặc `Lost`, không có deal nào ở `Post Meeting` hay `Negotiation`.

Ánh xạ từ BPM: `Completed` → Won, `Khách không chốt` → Lost, `Đã chuyển Sale POD` → Convert to POD, `Bị từ chối ở đề xuất` → Disqualified. Nhập lịch sử và API ngoài được ghi `Won` kèm ngày tiền về (mục 14), vì dữ liệu cũ không có lịch đợt.

### 4.5 Người tham gia

- Cột `Người tham gia` nằm ở **lớp Cơ bản** của Deals (mọi người tham gia thấy, chỉ Manager sửa; sửa 19/11 lần 2, trước đây chỉ ở bảng của Manager), kiểu **Người dùng** (chọn nhiều người trong hệ thống). Mỗi người được chọn kèm bốn ô: **Vai trò** (nhãn `Leading` / `Associate` / `Advisor`), **% doanh thu**, **% com** (phần trăm **trên com của sale**), **Tính vào số deal** (có/không). Giống bảng "Danh sách SoE tham gia deal" của BPM. Manager điền (tay hoặc nhờ AI đọc phiếu request), hoặc API bắn vào.
- Đây là **nguồn duy nhất** của việc chia deal. Bảng của người khác chỉ nhận dữ liệu từ cột này, không ai khác sửa được.
- Chọn ai thì deal hiện trong bảng Deals của người đó. Hệ thống **gửi dữ liệu xuống**: tự điền các cột mỗi-người-một-giá-trị của họ: `Vai trò của tôi`, `% doanh thu của tôi`, `% Com cá nhân`, `Tính vào số deal của tôi`; với Leader thêm `% com của team`, `% doanh thu của team`; với Manager thêm `Tổng % com đã chia`. Chọn cách gửi xuống thay vì để mỗi người tự lookup, vì lookup "phần của tôi" cần một hàm biết ai đang xem, mà ta đã thống nhất không thêm hàm riêng.
- **% com** là mặc định cho các đợt chưa về. Mỗi đợt có cột `Chia com đợt này` riêng (mục 7.2), điền sẵn từ đây lúc xác nhận tiền về. Đổi % com ở deal không đổi com của đợt đã về.
- **% com mặc định 0** (chưa chia). Deal vẫn hiện, com bằng 0 cho đến khi Manager chia.
- **Ràng buộc com:** tổng % com của một deal và của một đợt **không vượt `Tỉ lệ SoE`** (bảng Tham số com, ví dụ 20%), kiểm ở mọi kênh. Thấp hơn mức trần thì màn chốt kỳ cảnh báo "còn 5% chưa chia".
- % doanh thu mặc định: deal chỉ có một Leading thì Leading 100%; còn lại 0 cho đến khi Manager chia. Associate, Advisor mặc định 0 (chỉ tính workload). Tổng % doanh thu ≤ 100%.
- **Tính vào số deal** mặc định: Leading có, Associate và Advisor không. Thay cho cột `Không tính vào báo cáo` cũ.
- Được nhiều Leading (BPM cho nhiều `Lead SoE` chia `% Rev`). Kiểu `Người dùng có thuộc tính` là tính năng chung của Datahub, bảng khác cũng dùng được (ví dụ giao việc có tỉ lệ, `Chia com đợt này`).
- Doanh thu của một người = tổng tiền về của các đợt × `% doanh thu của tôi`, theo ngày tiền về (mục 5, 10.3). Đếm deal (nhận, thắng, winrate) của một người: deal có `Tính vào số deal của tôi` = có. Của team: đếm không trùng.
- Dashboard và cột của Manager cảnh báo deal có tiền về mà chưa chia com.
- Workload: mọi vai trò, trọng số mặc định Leading 1, Associate 0,5, Advisor 0,3; Manager chỉnh cho cây mình.
- Người tham gia phải cùng cây với deal. Đổi người lưu lịch sử và phát sự kiện `deal.participant.changed`.

### 4.6 Nhận xét về sheet Index gốc

Sheet Index lọc POD bằng `"POD*"`, nên cột POD **đã gồm cả POD Express**. Trong khi đó `Tổng Revenue` = POD + PS + POD Express, và luỹ kế `Software` = POD + POD Express: doanh thu và số deal POD Express **bị cộng hai lần**. SoE Hub tính nhóm `POD` = `POD bán mới` + `POD CSM`, còn POD Express để riêng.

## 5. Bảng Index

- Mỗi dòng một tháng. Worker thêm dòng tháng mới vào ngày 1. Dòng đầu là tháng có deal sớm nhất.
- Cột mặc định = các cột của sheet Index, là **cột công thức trên bảng Deals**, đã sửa lỗi ở mục 4.6:
  - Theo nhóm POD, PS, POD Express, Tổng: Nhận, Disqualified, Pending, Qualified, Lost, Won, Winrate (theo quý như file mẫu), PS kèm POD, POD Express chuyển thành POD.
  - Doanh thu: POD, POD Express, PS, PS kèm POD, PS không kèm POD, Tổng, Tổng theo quý.
  - Forecast: POD, PS, Tổng, tách hai phần (mục 11): đợt chưa về có hạn trong tháng của deal đã có lịch, và doanh thu dự kiến của deal chưa có lịch có Ngày dự kiến chốt trong tháng.
  - Thêm: CR1, CR2 của tháng (mục 10).
- Mốc thời gian: Nhận, Disqualified, Pending theo Start date; Won, Lost theo Closing date; **doanh thu theo ngày tiền về** của từng đợt (cộng từ bảng Đợt thanh toán). Một hợp đồng 120tr trả 3 đợt ở ba tháng thì mỗi tháng nhận phần tiền về của tháng đó, như sheet cũ (mỗi lần tiền về một dòng). Đổi sang tính theo giá trị hợp đồng ở ngày Won sau này chỉ là sửa công thức template.
- **So với sheet cũ:** sheet cũ ghi mỗi lần tiền về một dòng, nhưng dòng đợt 2, đợt 3 được đánh dấu `Không tính vào báo cáo: Số deal` (Manager xác nhận 19/11/2026), nên số deal Won và CR2 của sheet cũ đã đúng. SoE Hub đếm mỗi deal một lần bằng cấu trúc (một deal, nhiều đợt), không cần đánh dấu tay; số không đổi khi chuyển. Deal size của sheet cũ thì có thể tính trên từng dòng đợt; SoE Hub tính trên cả deal.
- Index của User đếm deal có `Tính vào số deal của tôi`, doanh thu theo % doanh thu của mình. Index của Leader và Manager có thêm nhóm cột cho team / cây (lớp Theo vai trò).
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
| Công thức có sẵn | KPI và Goal từng quý; số deal cần thắng = doanh thu ÷ deal size; lead cần nhận = deal ÷ (CR1 × CR2); **Đã đạt**, **Còn thiếu**, **% đạt** của năm và quý hiện tại (cộng doanh thu từ Đợt thanh toán theo ngày tiền về, như Index) |

- Người dùng tự nhập kế hoạch của mình rồi bấm **Commit**. Sau khi commit, chỉ Manager sửa được, phải ghi lý do; mọi lần sửa có lịch sử.
- Leader xem của team, Manager xem của cả cây.
- Doanh thu tính KPI: Software = POD bán mới + POD CSM + POD Express; Non-software = PS kèm POD + PS không kèm POD. `Data` không tính KPI (file mẫu không có Data trong Index).

## 7. Thanh toán và commission theo đợt

### 7.1 Bài toán (Dương hỏi Manager, 19/11/2026)

- Một deal có thể có nhiều hợp đồng, nhiều pháp nhân; mỗi hợp đồng một hoặc nhiều đợt thanh toán. Số đợt, số tiền, ngày của từng đợt được sale thống nhất với khách từ đầu, nằm trong hợp đồng.
- **Deal chỉ Won khi tiền về.** Có lịch thanh toán không có nghĩa là tiền đã về. Com cũng chỉ có khi tiền về, mỗi lần tiền về chia com một lần, nhận theo tháng.
- Hiện tại: mỗi lần tiền về là một dòng trong sheet (deal 3 đợt thành 3 dòng); team Data mở từng phiếu request, tính com; cuối kỳ Manager mở lại từng phiếu, nhẩm lại tỉ lệ và số tiền. Khó nhất là tiền về từ pháp nhân có tên khác tên deal, Manager phải dò xem là deal nào, đợt nào.
- Mục tiêu: Manager ghép tiền về nhanh và đúng, không phải nhẩm com; nhân sự SoE thấy trực tiếp deal đã thu bao nhiêu, còn bao nhiêu, com đã nhận, com chờ nhận; cuối tháng chốt kỳ, qua tháng không sửa số đã nhận.
- Nhập liệu: hiện tại Manager điền tay hoặc nhờ AI đọc phiếu request và workflow rồi điền (qua kết nối AI của Manager, Module 5). Sau này request đẩy dữ liệu qua API (Manager tạo kết nối API). Cả ba kênh gọi cùng các command ở mục 7.4.

**Cách giải:** ghép tiền với deal **lúc lập lịch** (lúc thông tin hợp đồng còn đủ), không phải lúc tiền về. Dữ liệu nằm ở hai bảng template trên engine Datahub; tính toán là công thức thường; hệ thống chỉ thêm bốn command công thức không làm được (mục 7.4), tìm cột theo vai trò (mục 7.6).

### 7.2 Bảng Đợt thanh toán

Bảng template chung của cây (Manager tạo). Mỗi đợt thanh toán của hợp đồng một dòng, lập lúc ký hợp đồng (deal vẫn Processing). Khớp "Bảng chia đợt thanh toán" và "Bảng chia thanh toán – ver 2" của BPM. Mỗi deal một loại dịch vụ (mục 1.4) nên mỗi đợt chỉ có một số tiền.

| Cột | Ghi chú |
|---|---|
| Deal | Liên kết tới Deals |
| Pháp nhân, Mã số thuế, Số hợp đồng, Đợt số | Theo hợp đồng, **không phải** tên công ty của deal. Nhập lúc lập lịch |
| Số tiền dự kiến (chưa VAT), Hạn | Nhập lúc lập lịch |
| Ngày tiền về, Số tiền về (chưa VAT), Số tiền nhận (gồm VAT) | Ghi khi xác nhận tiền về (mục 7.4) |
| Tiền về | Liên kết tới dòng của bảng Tiền về (mục 7.3a) đã trả cho đợt này. Ghi khi ghép |
| Chia com đợt này | Người dùng có thuộc tính (người, % com trên com sale). Điền sẵn từ `Người tham gia` của deal lúc xác nhận tiền về; Manager sửa nếu đợt này chia khác. Tổng ≤ `Tỉ lệ SoE` |
| Trạng thái | Công thức: `Chưa đến hạn` / `Sắp đến hạn` (7 ngày) / `Quá hạn` / `Đã về` / `Về thiếu` |
| Kỳ | Tháng của ngày tiền về. Tháng đó đã chốt thì lấy kỳ đang mở, kèm nhãn `Về muộn` |
| Người tham gia | Tự điền từ deal (gửi xuống như mục 4.5), là **khoá phân chia**: SoE chỉ thấy đợt của deal mình, Leader của team, Manager cả cây |
| Nguồn nhập | `Tay` / `AI (tên kết nối)` / `API`; `Đã kiểm` (Manager đánh dấu) cho dòng không nhập tay |

- Quyền: Manager ghi. Thành viên quyền Xem. Cột `Chia com đợt này` chỉ Manager.
- View hệ thống: **Chờ tiền về** (chưa về, xếp theo hạn, quá hạn lên đầu), **Đã về tháng này**, **Do AI nhập chưa kiểm**.

### 7.3a Bảng Tiền về

Bảng template của cây, chỉ Manager (không có thành viên). Mỗi khoản tiền vào tài khoản công ty (mỗi UNC) một dòng. Gộp ba thứ vào một chỗ: hàng **Tiền về chưa ghép** là các dòng chưa liên kết đợt nào; **một khoản trả cho nhiều đợt** là một dòng liên kết nhiều đợt; **ghi nhớ người trả** là lịch sử các dòng đã ghép, không lưu riêng. Manager nhìn thấy và sửa được lần ghép sai (trước khi chốt kỳ).

| Cột | Loại |
|---|---|
| Ngày nhận, Số tiền (gồm VAT), Tên đơn vị trả, Số tài khoản, Ngân hàng, Nội dung chuyển khoản | Nhập (tay, AI dán UNC, API) |
| Đợt | Liên kết nhiều dòng tới Đợt thanh toán; ghi bởi command xác nhận tiền về. Phần tiền của từng đợt nằm ở `Số tiền nhận` của đợt; tổng các đợt phải bằng `Số tiền` |
| Đã phân bổ, Còn lại | Công thức/rollup |
| Trạng thái | Công thức: `Chưa ghép` / `Ghép một phần` / `Đã ghép` |
| Nguồn nhập, Đã kiểm | Như bảng Đợt |

- Kỳ đã chốt thì dòng Tiền về đã ghép vào đợt của kỳ đó bị khoá cùng đợt.
- Vai trò cột: `ngày nhận`, `số tiền nhận`, `người trả`, `số tài khoản`, `nội dung`, `đợt`.

### 7.3 Bảng Sổ com

Bảng template chung của cây. Mỗi người, mỗi đợt một dòng. **Khoá phân chia theo cột Người**: mỗi người thấy com của mình, Leader của team, Manager cả cây (Module 4 mục 9: Guest không bao giờ thấy).

| Cột | Ghi chú |
|---|---|
| Người, Đợt (liên kết), Deal, Kỳ | |
| Số tiền về, Tỉ lệ com sale, Com sale, % com, Com | `Com sale = Số tiền về × Tỉ lệ com sale`; `Com = Com sale × % com`. Hiện cả các số để Manager đối chiếu bằng mắt, không phải nhẩm |
| Trạng thái | `Tạm tính` / `Đã chốt` / `Điều chỉnh` |
| Lý do | Bắt buộc với dòng `Điều chỉnh` |

- Dòng `Tạm tính` là công thức, tự tính lại khi số tiền, % chia hoặc đầu vào chính sách đổi. Dòng `Đã chốt` là **giá trị cứng**, không phải công thức, không ai sửa. Lý do có bảng này thay vì chỉ dùng công thức trên Đợt: số đã chốt phải đứng yên (công thức luôn tính lại), và cộng theo người, theo team không bị trùng vì mỗi người có dòng riêng.
- Không ai thêm dòng tay ngoài dòng `Điều chỉnh` (Manager).
- Không có thu hồi com (Manager xác nhận không có trường hợp khách trả lại tiền). Dòng điều chỉnh chỉ dùng để sửa sai do nhập liệu sau khi kỳ đã chốt; có thể âm.

### 7.4 Bốn command

Là command trong registry (giao diện, REST, MCP, API ngoài gọi chung), có `Idempotency-Key`, ghi nhật ký. Chỉ Manager của cây (và kết nối AI/API của Manager).

1. **Lập lịch thanh toán** `payment.schedule`: một lần gọi cho cả lịch của deal (deal + danh sách đợt), để AI đọc một phiếu gọi một lần. Sửa lịch (thêm, bớt, đổi đợt chưa về) cũng qua command này. Không xoá đợt đã về.
2. **Xác nhận tiền về** `payment.confirm`: một hoặc nhiều đợt. Ghi ngày, số tiền, thông tin người trả. Nếu là đợt đầu của deal: deal → `Won` (Closing date tự ra bằng công thức, mục 4.1). Sinh dòng Sổ com `Tạm tính` cho từng người theo `Chia com đợt này`. Về thiếu thì hỏi tách phần còn lại thành đợt mới (giữ hạn). Một khoản tiền trả cho nhiều đợt hoặc nhiều deal: chia một khoản vào nhiều đợt, tổng phải bằng số tiền về. **Huỷ xác nhận** được khi kỳ chưa chốt (xoá dòng Sổ com tạm tính; đợt duy nhất thì deal về Processing).
3. **Chốt kỳ** `period.close` (mục 12): đóng băng Đợt, Sổ com và deal đóng của tháng.
4. **Điều chỉnh** `commission.adjust`: thêm dòng `Điều chỉnh` vào kỳ đang mở, có lý do.

AI dùng kết nối của Manager được ghi thẳng (không xin duyệt từng lần) vì mọi thứ vẫn `Tạm tính` cho tới khi Manager chốt kỳ; dòng do AI nhập phải được đánh dấu `Đã kiểm` ở màn chốt kỳ (mục 12).

### 7.5 Ghép tiền về

Giả định thông tin tiền về có dạng **UNC**: tên đơn vị trả, số tài khoản, ngân hàng, số tiền (gồm VAT), ngày, nội dung chuyển khoản. Thường **không có mã số thuế**. Sẽ chỉnh luật khi có mẫu thật.

- Công cụ **Ghép tiền về**: Manager nhập những gì thông báo có, hoặc dán nguyên thông báo cho AI. Query `payment.match_candidates` xếp hạng các đợt chưa về trong cây, mỗi gợi ý kèm lý do (ví dụ "Deal ABC – đợt 2: khớp số tài khoản đã ghép trước, 108tr = 100tr + VAT 8%, hạn còn 2 ngày"). Chấm điểm bằng luật cố định ở server, hệ thống không tiêu thụ AI.

| Dấu hiệu | Cách so |
|---|---|
| Số tài khoản, tên người trả đã ghép trước | Khớp với các dòng đã ghép của bảng Tiền về. Mạnh nhất |
| Mã số thuế | Khớp đúng (khi thông báo có) |
| Số hợp đồng | Có trong nội dung chuyển khoản |
| Tên pháp nhân | So gần đúng với pháp nhân của đợt và tên công ty của deal, sau khi bỏ dấu, bỏ `Công ty`, `TNHH`, `CP`, `Cổ phần`… |
| Số tiền | Bằng số tiền đợt, hoặc số tiền đợt cộng VAT (0%, 5%, 8%, 10%), cho lệch nhỏ (tham số) |
| Hạn | Càng gần hạn càng cao điểm |

- **Ghi nhớ:** mỗi dòng Tiền về đã ghép cho biết `tên người trả, số tài khoản → khách hàng (mã số thuế / deal)`; không có bảng ghi nhớ riêng. Lần sau tiền về từ pháp nhân đó, gợi ý đúng đứng đầu. Chỉ lần đầu phải dò.
- AI chỉ tự xác nhận khi có **đúng một** đợt khớp mạnh (ghi nhớ hoặc mã số thuế, và số tiền). Còn lại AI đưa danh sách gợi ý cho Manager chọn.
- Không tìm được đợt: dòng Tiền về để trạng thái `Chưa ghép` (hàng **Tiền về chưa ghép**) để không bị quên; màn chốt kỳ báo còn bao nhiêu khoản.
- Sau này API của request đẩy kèm mã đợt (`source` + `external_id`), gần như không còn phải ghép.

### 7.6 Vai trò cột của Đợt thanh toán và Sổ com

Bốn command tìm cột theo vai trò (mục 3.7), nên Manager sửa tên, định dạng, công thức mà không phải sửa code.

| Bảng | Vai trò |
|---|---|
| Đợt thanh toán | `deal` (liên kết), `số tiền dự kiến`, `hạn`, `ngày tiền về`, `số tiền về`, `chia com đợt`, `kỳ`, `pháp nhân`, `mã số thuế`, `số hợp đồng` |
| Sổ com | `người`, `đợt`, `kỳ`, `com`, `trạng thái com` |

### 7.7 Đi thử một deal

Sale tạo request ngày D; Manager chia A 15%, B 5% com sale; 3 đợt: D+7, D+21, D+35.

| Lúc | Manager | Hệ thống |
|---|---|---|
| D | Tạo deal (tay hoặc "AI, tạo deal từ phiếu X, A 15%, B 5%"); Level BC, Performance BC, nguồn lead đọc từ phiếu | Deal hiện ở bảng của A, B và Leader của họ; Com dự kiến của tôi |
| Ký hợp đồng | Lập lịch 3 đợt (hoặc "AI, lập lịch từ phiếu X") | Deal `Chờ tiền về`; forecast có số và ngày |
| D+7 | Nhận thông báo tiền về → Ghép tiền về → xác nhận | Deal `Won`, Closing date = D+7, tra chính sách tại D+7; Sổ com: A 15%, B 5% tạm tính |
| D+21, D+35 | Ghép, xác nhận | Thêm dòng Sổ com; deal `Đã thu đủ` |
| Cuối tháng | Chốt kỳ (mục 12) | Sổ com của tháng thành số cứng; đợt về sau ngày chốt vào tháng sau |

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

- **Com tính trên từng lần tiền về** (mục 7), không trên doanh thu dự kiến. Với mỗi đợt: `Com sale = Số tiền về × Tỉ lệ com sale`; com của một SoE = `Com sale × % com của người đó trong đợt`. Ví dụ com sale 100tr, A 15%, B 5%: A 15tr, B 5tr.
- **POD:** `Tỉ lệ com sale` tra theo (Nguồn lead, Level BC, Performance BC).
- **PS:** `Tỉ lệ com sale` = tỉ lệ PS POD (bảng Tham số com).
- **`Tỉ lệ SoE`** (Tham số com, ví dụ 20%) **không nhân vào công thức**. Nó là **mức trần**: tổng % com của các SoE trong một deal, một đợt không vượt nó (mục 4.5). Manager chia trực tiếp % trên com sale, đúng con số đang ghi trên phiếu.
- **Phiên bản chính sách:** mọi đợt của deal tra bản có hiệu lực tại **Closing date** (= ngày tiền về đợt đầu). Deal mở (com dự kiến) tra theo Ngày dự kiến chốt.
- **POD Express, Data:** chưa có chính sách, cột hiện "Chưa có chính sách".
- **Chính sách com là bảng hệ thống dùng chung** (công thức được tham chiếu bảng hệ thống, theo CLAUDE.md), không phải logic trong code. Hiện trong Quản lý Deal của mọi người; **chỉ Manager** thêm, sửa, cập nhật; người khác chỉ xem:
  - Bảng `Chính sách com`: Hiệu lực từ, Nguồn lead (ML/SH), Level, Performance, Doanh thu tối thiểu, Tỉ lệ. Dựng từ các sheet BC-ML, BC-SH.
  - Bảng `Tham số com`: Hiệu lực từ, Tên tham số (tỉ lệ SoE trên com sale, tỉ lệ PS POD…), Giá trị.
- **Có phiên bản theo ngày hiệu lực:** Manager thêm một bộ dòng mới với `Hiệu lực từ` mới, không sửa dòng cũ. Dòng đã có hiệu lực bị khoá.
- `Tỉ lệ com sale` là công thức thường trên Deals, tra đúng phiên bản theo Closing date (deal mở: Ngày dự kiến chốt). Sổ com đọc nó khi sinh dòng. Ví dụ phần POD: `SUMIFS([Chính sách com].[Tỉ lệ], [Chính sách com].[Hiệu lực từ], MAXIFS([Chính sách com].[Hiệu lực từ], [Chính sách com].[Hiệu lực từ], "<="&[Closing date]), [Chính sách com].[Nguồn lead], [Nguồn lead], [Chính sách com].[Level], [Level BC], [Chính sách com].[Performance], [Performance BC])` (dùng `IF([Closing date]="", [Ngày dự kiến chốt], [Closing date])` làm ngày tra). Không nhân tỉ lệ SoE. Template dựng sẵn công thức này; Manager sửa khi chính sách đổi cách tính.
- Thiếu đầu vào (ví dụ chưa có Level BC) thì `Tỉ lệ com sale` và com để trống kèm lý do, không đoán; màn chốt kỳ liệt kê các deal này.
- Ai thấy com (sửa 19/11 lần 2): **% com** của mọi người tham gia: mọi người tham gia deal. **Số tiền com** của một người: chính người đó, Leader của họ, Manager của cây, Admin (chỉ đọc). Guest: không thấy số tiền com; % com và % doanh thu trong `Người tham gia` chỉ khi Manager cấp rõ (mục 15).

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
| Doanh thu | Tổng `Số tiền về` của các đợt × % doanh thu, theo **ngày tiền về** (bảng Đợt thanh toán) |
| Com | Tổng Sổ com theo Kỳ: đã chốt, tạm tính; com chờ nhận theo đợt chưa về |
| Deal size | Tuỳ chọn trung vị / trung bình / trung bình cắt đuôi; outlier theo IQR |
| Deal cycle | Closing date − Start date của deal Won, tức là **tới lúc tiền về đợt đầu** (dài hơn cách Manager đang nhẩm tới lúc ký; biểu đồ ghi rõ); tuỳ chọn trung vị / trung bình, kèm P75. Cycle của deal Lost, Disqualified tính được nhờ Closing date tự điền |
| Tỉ lệ PS kèm POD | PS kèm POD Won ÷ POD Won |
| Tỉ lệ chuyển POD | Convert to POD ÷ (POD Express nhận − Disqualified) |
| Workload | Tổng trọng số deal đang mở theo vai trò |
| Lý do xin thêm lead | KPI còn thiếu của quý so với forecast → số lead cần thêm = phần thiếu ÷ deal size ÷ (CR1 × CR2), hạn nhận = cuối quý − cycle |

## 11. Forecast và snapshot

- Forecast theo loại deal, đặt cạnh KPI còn thiếu của quý, tách hai phần:
  - **Đã ký, chờ tiền về** (khá chắc): tổng `Số tiền dự kiến` của các đợt chưa về có hạn trong kỳ.
  - **Chưa ký** (ước lượng, như file mẫu): `Doanh thu dự kiến` của deal Processing chưa có lịch, có Ngày dự kiến chốt trong kỳ.
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
| Dự kiến chốt trong kỳ | Deal đang mở, Ngày dự kiến chốt trong kỳ hoặc có đợt chưa về hạn trong kỳ (giống forecast) |

**Các bảng khác**

| Bảng | Lọc theo |
|---|---|
| Index | Cột Thời gian (dòng tháng) |
| Probation KPI | Năm chứa kỳ |
| Bảng tự tạo | Cột ngày người dùng chọn cho kỳ chung, hoặc không theo |
| Dashboard | Kỳ chung là khoảng thời gian trong bộ lọc chung của dashboard. Biểu đồ có kỳ riêng (ví dụ xu hướng 12 tháng) chọn "bỏ qua bộ lọc chung" (Module 3 mục 8) |

Thẻ KPI theo kỳ: chọn quý thì hiện KPI quý; chọn năm thì hiện KPI năm; chọn tháng thì hiện tiến độ của quý chứa tháng đó (KPI chỉ commit theo năm và quý).

## 12. Chốt kỳ

**Khoá kỳ và chốt kỳ com gộp làm một** (sửa 19/11 lần 2): kỳ theo tháng, Manager chốt cho cây mình, thường cuối tháng. Lý do gộp: khoá deal theo Closing date chỉ giữ được đợt tiền về đầu; đợt 2, đợt 3 về ở tháng khác thì không được giữ.

**Một lần chốt đóng băng ba thứ của tháng:**

- Dòng Đợt thanh toán có `Kỳ` là tháng đó: khoá ngày tiền về, số tiền, chia com, không huỷ xác nhận được.
- Dòng Sổ com của kỳ: từ công thức thành **giá trị cứng**, trạng thái `Đã chốt`.
- Deal đóng trong tháng (Closing date): khoá Status, Ngày đóng (sửa tay), Loại deal (Closing date là công thức nên đứng yên khi đầu vào bị khoá). Cột tuỳ chỉnh, ghi chú, BANT vẫn sửa được. Người tham gia và % com của deal vẫn sửa được, vì chỉ ảnh hưởng các đợt chưa về; % doanh thu thì khoá (đổi doanh thu của tháng đã chốt).

**Màn "Chốt kỳ tháng N"**

- **Cần xử lý trước khi chốt:** đợt quá hạn chưa xác nhận; khoản trong **Tiền về chưa ghép**; đợt đã về mà tổng % com khác mức trần `Tỉ lệ SoE`; deal có tiền về mà thiếu Level BC / Performance BC (com trống); **dòng do AI hoặc API nhập chưa `Đã kiểm`**; deal Processing quá hạn đợt đầu lâu (tham số, mặc định 30 ngày). Không bắt buộc xử lý hết mới chốt được, nhưng phải xác nhận "Chốt dù còn N mục".
- **Com theo người:** bảng tổng com của kỳ theo người (đã gồm điều chỉnh); bấm vào một người thấy từng dòng Sổ com.
- Bấm **Chốt** → xuất XLSX bảng com cho kế toán (thay bảng team Data gửi mỗi kỳ).
- Nhắc chốt kỳ và nhắc đợt sắp đến hạn: Module 6.

**Sau khi chốt**

- Tiền về có ngày thuộc tháng đã chốt (xác nhận muộn) → `Kỳ` là kỳ đang mở, nhãn `Về muộn`. Không bắt mở lại kỳ.
- Sai sót phát hiện sau → dòng **Điều chỉnh** vào kỳ đang mở (mục 7.4). Dòng đã chốt không bao giờ sửa.
- **Mở lại kỳ:** Manager được, ghi nhật ký, không cần người thứ hai duyệt; dùng để sửa Status, Closing date hoặc chuyển vai trò cột (mục 3.7). Mở lại **không** làm Sổ com đã chốt tính lại: dòng `Đã chốt` vẫn đứng yên, chênh lệch đi qua dòng điều chỉnh. Tiền com đã trả không có cách nào đổi ngầm.

## 13. Dashboard Deals mặc định

Dashboard hệ thống, khoá, đầu danh sách; nhân bản để tuỳ chỉnh. Số theo phạm vi người xem.

**Tối thiểu phải trả lời ngay khi mở:**

1. KPI hiện tại **đã đạt chưa**: đã đạt / KPI / Goal của năm và quý hiện tại (lấy từ Probation KPI).
2. **Còn thiếu bao nhiêu** để đạt KPI và Goal.
3. **Winrate hiện tại (CR2)**, kèm CR1.

Sau đó: doanh thu theo loại deal theo tháng; phễu Nhận → Gặp khách (CR1) → Won (CR2); bảng cohort winrate; forecast quý (đã ký chờ tiền về / chưa ký) so với KPI còn thiếu; com tháng này (tạm tính), com đã nhận, com chờ nhận; đợt sắp đến hạn và quá hạn; deal size và cycle (box plot, outlier); ma trận BANT và số deal cần chấm lại; Leader/Manager có thêm workload và doanh thu, winrate, com theo người.

**Ai sửa, nhân bản, vai trò** (Dương chốt 19/11/2026)

- User, Leader chỉ xem dashboard hệ thống. **Manager sửa cho cây mình** (thêm, bỏ, đổi biểu đồ, đổi chỉ số dùng vai trò hay cột nào), qua màn xem trước "Áp dụng cho N người", có nút **Về bản mặc định**. Admin giữ bản mặc định (sinh cho cây mới), như template (mục 3.1). Đổi **cột nào là "Doanh thu"** không làm trên dashboard mà ở trang Template (mục 3.7), vì nó ảnh hưởng cả chốt kỳ, forecast.
- Chỉ số của dashboard hệ thống trỏ cột **theo vai trò** (`"field": {"role": "doanh_thu"}`, mở rộng nhỏ của Module 3), nên Manager chuyển vai trò sang cột khác thì dashboard tự tính theo cột mới.
- **Nhân bản** thành dashboard riêng: bản sao **giữ nguyên chỗ trỏ theo vai trò**, đổi vai trò sau đó bản sao tự theo. Khi chọn cột cho biểu đồ, danh sách có nhóm **Vai trò** đứng trên nhóm cột, mỗi dòng ghi rõ đang trỏ vào đâu (`Doanh thu → cột "Doanh thu"`). Người dùng chọn được vai trò, không gắn, chuyển hay xoá được. Nhóm Vai trò chỉ hiện khi nguồn là bảng template có vai trò.
- Số luôn theo phạm vi người xem: vai trò chọn cột, khoá phân chia chọn dòng (mục 3.7). KPI, còn thiếu, doanh thu theo người dùng `doanh thu được tính` (phần của người xem, không cộng trùng deal chia nhiều người); quy mô pipeline, deal size, forecast dùng `doanh thu` (giá trị cả deal).

## 14. Hệ thống ngoài và nhập lịch sử

- API `deal.upsert` theo `source` + `external_id`, kèm người tham gia `{ email, role, revenue_share, com_share, count_deal }` (`com_share` là % trên com sale). Tài khoản hệ thống chỉ ghi vào cây được cấp.
- Thanh toán: `payment.schedule` (lịch đợt, mỗi đợt có `external_id`), `payment.confirm` (theo `external_id` của đợt, hoặc theo thông tin UNC rồi ghép như mục 7.5), `payment.match_candidates`. Hiện tại Manager gọi qua giao diện hoặc AI; sau này request của Base đẩy qua kết nối API do Manager tạo (Module 5).
- Ánh xạ BPM (dùng khi nối): Tên Doanh nghiệp → Tên công ty; Loại dịch vụ + Gói dịch vụ + kết quả "Tra cứu POD trong nhóm khách hàng" → Loại deal (bảng ánh xạ do Admin/Manager sửa, vì `POD Showcase` chưa phân biệt `POD bán mới` với `POD CSM`); Deal size ước tính / Revenue (Forecast) → Doanh thu (deal mở); Ngày dự kiến chốt → Ngày dự kiến chốt; Bảng chia đợt thanh toán / Bảng chia thanh toán – ver 2 → Đợt thanh toán; Mã số thuế; Danh sách SoE tham gia deal (`Lead SoE` → Leading, `Support SoE` → Associate, `% Com`, `% Rev`); outcome → Status (mục 4.4).
- **Nhập lịch sử** (Manager, cho cây mình): luồng import của Module 2 với mẫu ánh xạ có sẵn cho sheet `Raw PODPS` và sheet `Deals` của file mẫu. Cột không có trong template thì nhập thành cột tuỳ chỉnh của Manager. Sheet cũ ghi mỗi lần tiền về một dòng: trình nhập gộp các dòng cùng deal (cùng mã số thuế + tên + loại deal, Manager xác nhận) thành một deal kèm các đợt đã về (mục 5). Dấu hiệu chính: dòng có `Không tính vào báo cáo: Số deal` cùng mã số thuế/tên/loại deal với một dòng khác là đợt sau của deal đó. Màn đối chiếu trước khi xác nhận: số deal Won và winrate theo từng quý của sheet cũ so với SoE Hub (phải bằng nhau; lệch thì liệt kê deal gây lệch). Kỳ cũ nhập vào ở trạng thái đã chốt.

## 15. Phân quyền và tích hợp

- Tạo deal, phân deal, chia tỉ lệ, `Huỷ`, chính sách com, lập lịch thanh toán, xác nhận và ghép tiền về, chia com theo đợt, chốt kỳ, mở lại kỳ, điều chỉnh com, snapshot: Manager (cây mình), trực tiếp hoặc qua kết nối AI/API của Manager (Module 5).
- Sửa template (lớp Cơ bản, Theo vai trò): Admin, Manager. Lớp Theo team: Leader.
- Guest: đăng ký loại dữ liệu "Deals" với khung cấp dữ liệu Module 1 mục 5.2: chỉ cột lớp Cơ bản kiểu "giá trị chung", không bao giờ cột tuỳ chỉnh, cột theo người ("của tôi") và số tiền com. `Người tham gia` mặc định chỉ hiện tên và vai trò; Manager cấp thêm **tỉ lệ** (% doanh thu, % com) cho Guest cụ thể khi cần, ví dụ bộ phận Data (Dương chốt 19/11/2026).
- Chuyển giao: deal mở chuyển vai trò sang người đích, deal đóng giữ người cũ; datahub "Quản lý Deal" của người nguồn: bảng tự tạo chuyển sang người đích; Probation KPI giữ tên người nguồn.
- Form (Module 7) không ghi vào Deals.

## 16. Giao diện tối thiểu (Stage 4)

- Menu Quản lý Deal: Deals, Index, Probation KPI, bảng tự tạo, Dashboard; Manager thấy thêm bảng của Manager và mục Quản lý (phân deal, chính sách com, chốt kỳ, snapshot, nhập lịch sử).
- Thanh toán: bảng Đợt thanh toán với view Chờ tiền về / Đã về tháng này / Do AI nhập chưa kiểm; hộp thoại lập lịch cho một deal; công cụ **Ghép tiền về** (nhập hoặc dán thông tin UNC, danh sách gợi ý kèm lý do, chia một khoản vào nhiều đợt, hàng Tiền về chưa ghép); màn **Chốt kỳ tháng N** (mục 12). Sổ com với view Com của tôi theo kỳ.
- Deals: grid Module 2, view hệ thống (Ưu tiên hôm nay, Đang mở, Cần chấm lại), ngăn chi tiết deal (người tham gia, BANT, **các đợt thanh toán của deal** kèm trạng thái và com của tôi từng đợt, lịch sử). Một deal luôn là một dòng; đợt thanh toán không bao giờ thành dòng deal mới.
- Trang Template (mục 3.8): lối vào, danh sách bảng theo phạm vi, tạo bảng template, bốn lớp, thuộc tính cột, quyền sửa ô, vai trò cột, quyền Leader theo bảng, xem trước ảnh hưởng ("áp dụng cho 18 người"), danh sách bản sửa của các team. Nhãn `Mẫu` / `Riêng` / `Team sửa` trên tiêu đề cột.
- Datahub: datahub "Quản lý Deal" **không** hiện trong danh sách Datahub; trình soạn công thức và ô chọn bảng (liên kết, bảng gộp, nguồn chỉ số) có nhóm "Quản lý Deal" (mục 1.1).

## 17. Kiểm thử

- Unit: quy tắc BANT, hàng chờ, CR1/CR2 cohort với từng mốc tuỳ chọn, chia doanh thu và com theo tỉ lệ, com theo phiên bản chính sách, ràng buộc Status, lớp template và xử lý trùng tên.
- Thanh toán: xác nhận đợt đầu → Won + Closing date; huỷ xác nhận trước chốt; về thiếu tách đợt; một khoản chia nhiều đợt; % com theo đợt khác deal; trần `Tỉ lệ SoE`; chốt kỳ đóng băng (đổi chính sách, đổi % sau chốt không đổi dòng đã chốt); về muộn vào kỳ đang mở; điều chỉnh âm; mở lại kỳ không tính lại Sổ com; idempotency (gọi xác nhận hai lần không sinh com hai lần); chấm điểm ghép (ghi nhớ số tài khoản, VAT, tên pháp nhân bỏ dấu); khoá phân chia của Đợt và Sổ com (A không thấy com của B, Leader thấy team, SSE không lộ).
- Ma trận quyền: vai trò × cột × kênh; template; cột theo team của Leader; Guest không thấy cột tuỳ chỉnh và com; chốt kỳ; chuyển vai trò khi kỳ đã chốt bị chặn; bảo vệ datahub/bảng/cột mặc định.
- **Golden test:** sheet Deals của file mẫu không có dòng dữ liệu nên Index trong file toàn số 0. Thay bằng: import `Raw PODPS` vào Deals, so Index của SoE Hub với một script tham chiếu đọc thẳng `examples/` trên máy, dùng đúng logic COUNTIFS/SUMIFS của sheet Index (có và không có sửa lỗi mục 4.6). Không commit dữ liệu; máy không có file thì bỏ qua.
- Test com dùng bảng tỉ lệ tự dựng, không dùng số của chính sách thật.
- Load test 100.000 deal: Deals, Index, dashboard mặc định.

## 18. Thay đổi so với quy định đã chốt

| Quy định cũ | Đổi thành | Ảnh hưởng |
|---|---|---|
| Template Deals: chỉ Admin (Module 1 mục 3.1, 3.2) | **Admin và Manager** | Module 1, CLAUDE.md |
| Ba loại cột: hệ thống / chung / cá nhân | **Bốn lớp**: Cơ bản, Theo vai trò (Admin, Manager), Theo team (Leader), Tuỳ chỉnh. "Cột chung Manager đẩy cho cả cây" = cột template kiểu "giá trị chung" | Module 1, Module 2 mục 3, CLAUDE.md |
| Datahub "Quản lý Deal" hiện cả trong menu Datahub (mục 1.1 bản 19/11) | Chỉ hiện ở menu Quản lý Deal; datahub thường vẫn tham chiếu bảng của nó bằng công thức, liên kết, bảng gộp, chỉ số (mục 1.1; sửa 19/11) | CLAUDE.md, Module 5 (menu theo đối tượng) |
| Brief: datahub Deals không cho tạo thêm bảng | Datahub "Quản lý Deal" **được tạo thêm bảng**; datahub, bảng và cột mặc định được bảo vệ | Module 2 |
| Datahub là của riêng, Leader/Manager không xem | Giữ nguyên cho bảng tự tạo và Index. **Ngoại lệ:** Deals và Probation KPI theo phạm vi deal (Leader xem team, Manager xem cây) | Module 1 mục 4 |
| Cột hệ thống của Deals là cột cố định trong code | Cột mặc định là **cột thường do template sinh sẵn**; cột tính toán là công thức, Admin/Manager sửa cho mọi người, Leader sửa cho team, User không sửa (mục 3.3) | Module 2, CLAUDE.md |
| Deals là bảng `deals` riêng, cột cơ bản là cột thật của Postgres (mục 2 cũ); Module 2 có nguồn cột "cột thật của bảng hệ thống" | Mọi bảng mặc định lưu ở `dh_rows`, là **bảng template**; chức năng lõi tìm cột theo **vai trò cột** (mục 3.5, 3.7) | Module 2 mục 3 (còn hai nguồn cột), code `column-source.ts` (bỏ `PhysicalSource`), CLAUDE.md |
| Template dùng chung cả hệ thống (mục 3.1 cũ) | **Theo cây**, sinh từ bộ mặc định; Leader tạo template cho team | CLAUDE.md |
| Chỉ có các bảng mặc định cố định | Manager, Leader **tạo bảng template** (chung có khoá phân chia, hoặc riêng) | Module 2, CLAUDE.md |
| Quyền sửa ô theo danh sách cố định (mục 3.4 cũ) | **Người tạo bảng cấp** quyền sửa từng cột | — |
| Leader thêm cột team vào mọi bảng mặc định | Bật/tắt theo bảng; tắt mặc định với Deals, Chính sách com, Tham số com, Thanh toán | CLAUDE.md |
| Phạm vi xem deal là luật riêng của Deals (Module 1 mục 4.1); Leading sửa, Associate/Advisor chỉ xem (mục 4.3 cũ) | Một cơ chế chia sẻ cho mọi bảng: thành viên Xem/Sửa, **khoá phân chia** bật/tắt (thấy dòng có tên mình hoặc người mình quản lý), cho phép sửa theo cột; mọi người tham gia có cùng quyền; Manager tắt được khoá phân chia của Deals | Module 1 mục 4.1, Module 2 mục 4, 10, code 2C-4 (chia sẻ), CLAUDE.md |
| Ô Người dùng chọn được mọi người trong hệ thống | Chỉ nhận thành viên của bảng | Module 2 mục 4, code 2C-3 |
| Golden test so số với Excel (Module 0 mục 21) | So với script tham chiếu trên `Raw PODPS` (mục 17) | Module 0, Stage 2B |
| Khoá kỳ theo Closing date, chỉ khoá deal (mục 12 cũ); kỳ com tính riêng ở bảng Thanh toán | **Chốt kỳ** gộp: một lần chốt đóng băng Đợt thanh toán, Sổ com và deal đóng của tháng; mở lại kỳ không tính lại com đã chốt (mục 12) | Module 0 (khoá kỳ), CLAUDE.md |
| Bảng Thanh toán riêng của Manager, mỗi dòng một lần tiền về (mục 7 cũ, khung) | Hai bảng chung **Đợt thanh toán** và **Sổ com**, khoá phân chia; bốn command; ghép tiền về (mục 7) | Module 2 mục 10 (khoá phân chia), CLAUDE.md |
| Won do người chọn; Closing date nhập tay, deal mở dùng làm ngày dự kiến | **Won chỉ khi tiền về đợt đầu**; Closing date hệ thống điền; thêm Ngày dự kiến chốt (mục 4.1, 4.4) | CLAUDE.md |
| `%Com team` = tỉ lệ tra × tỉ lệ SoE; % com cá nhân cộng tới 100% | `Tỉ lệ com sale`; % com là **% trên com sale**, tổng ≤ `Tỉ lệ SoE` (trần) (mục 9) | — |
| `Người tham gia` chỉ ở bảng của Manager; người khác thấy `Thành viên deal` không có tỉ lệ; com chỉ người đó, Leader, Manager thấy | `Người tham gia` ở lớp Cơ bản: người tham gia thấy % của nhau, số tiền com chỉ của mình; Guest được cấp tỉ lệ khi Manager chọn (mục 4.1, 9, 15) | CLAUDE.md, Module 1 mục 5.2 |
| Cột `Không tính vào báo cáo` | Bỏ; thay bằng % doanh thu và `Tính vào số deal` trong Người tham gia (mục 4.5) | — |
| Doanh thu Index, KPI theo Closing date | Theo ngày tiền về của từng đợt (mục 5) | Module 3 (chỉ số mặc định) |

## 19. Kiểm tra với Module 2 khi code Stage 4

Đối chiếu lại Module 2 và code Stage 2; chỗ nào chưa có thì bổ sung vào Module 2, có rồi thì thôi:

1. Datahub, bảng, cột có cờ **được bảo vệ** (không xoá, không đổi tên, không đổi kiểu từ giao diện thường).
2. **Bảng template chung** (Deals, Probation KPI, bảng Manager/Leader tạo) lưu ở `dh_rows`, xuất hiện trong datahub của từng người, lọc dòng theo **khoá phân chia** và phạm vi (mục 3.5). Bỏ `PhysicalSource` khỏi `apps/api/src/modules/datahub/column-source.ts`.
3. Cột theo **lớp template** và hai cách lưu giá trị (chung mỗi deal / mỗi người một giá trị), khớp với "hai nguồn cột" của Module 2 mục 3.
4. Cột **mỗi người một giá trị** (`Vai trò của tôi`, `% Com cá nhân`) và công thức dùng chúng (`Com`) tính sẵn, lưu theo từng người.
5. Cột mặc định là cột thường do template sinh sẵn (mục 3.3): cột tính toán là công thức chỉ dùng hàm kiểu Excel, không có hàm riêng. Công thức ở bảng của một người (Index, bảng tự tạo) đọc cột mỗi-người-một-giá-trị của Deals theo **chủ bảng** (ví dụ `[Deals].[Vai trò của tôi]` là vai trò của chủ Index).
6. Kiểu **Người dùng có thuộc tính** (mỗi người chọn kèm vài ô: nhãn, phần trăm), và cơ chế tự điền cột mỗi-người-một-giá-trị từ cột đó (mục 4.5).
7. Cột hệ thống Ngày tạo, Người tạo, Ngày sửa, Người sửa có ở mọi bảng, ẩn được.
8. Bản sửa riêng của team (Leader) đè lên định nghĩa cột template; cột riêng được "Đưa vào template".
9. Cột liên kết, lookup, rollup và công thức từ bảng riêng (Index, bảng tự tạo) và bảng chung (Đợt thanh toán, Sổ com) sang Deals, Probation KPI; luật "cùng chủ" của công thức phải coi các bảng này là của chủ datahub.
10. Giới hạn bảng và cột áp đúng cho datahub "Quản lý Deal".
11. **Vai trò cột** (mục 3.7): lưu ở định nghĩa cột; khoá kỳ, forecast, snapshot, BANT, Index, API ngoài đọc cột theo vai trò; chặn đổi kiểu/bỏ cột làm vai trò mất cột.
12. Bảng template riêng (Index) sinh cho mọi người trong phạm vi; ẩn/hiện khi đổi team.
13. Phần Module 2 phải sửa do các quyết định 19/11 làm ở **bước con 4.1** (mục 19a), trước mọi phần khác của Stage 4.
14. Chỉ số trỏ cột **theo vai trò** (`"field": {"role": ...}`, mục 13) trong engine metric của Module 3: phân giải vai trò → cột lúc tính, theo cây của bảng; danh sách "đang dùng" của màn xem trước chuyển vai trò đọc được các chỉ số này. Làm cùng dashboard hệ thống, không sửa Stage 3.
15. Thanh toán (mục 7): bốn command và query ghép là code Module 4 trên engine Datahub (ghi dòng qua `rows`, sinh dòng Sổ com, đổi công thức thành giá trị khi chốt). Kiểm `Người dùng có thuộc tính` dùng được cho `Chia com đợt này`, và cột tự điền `Người tham gia` của Đợt làm khoá phân chia được (gửi xuống từ Deals như mục 4.5).
16. Cấp dữ liệu cho Guest (Module 1 mục 5.2): bảng `data_grants` (Stage 1) chưa có chỗ cho tuỳ chọn riêng của từng loại dữ liệu. Thêm cột `options jsonb` (migration nhỏ), loại dữ liệu `deals` đăng ký tuỳ chọn `show_shares` (tỉ lệ trong Người tham gia, mặc định tắt) và áp khi đọc. Khung Stage 1 giữ nguyên.

## 19a. Bước con 4.1: bổ sung Module 2 (code đã xong ở Stage 2)

Các quyết định ngày 19/11/2026 (bảng template, chia sẻ thống nhất, vai trò cột) đổi phần Module 2 đã code. Bước con 4.1 làm hết danh sách này **trước** khi dựng Deals. Tên file là chỗ cần sửa chính, chưa phải danh sách đủ; Sonnet tự rà thêm nơi gọi.

**A. Khoá phân chia và quyền (server)**

1. Schema + migration (`packages/db/src/schema/datahub.ts`): cấu hình bảng `key_split` (bật/tắt), danh sách cột khoá (1–5), cột khoá chính; thuộc tính cột `allow_edit`. Mặc định: bảng thường `allow_edit` bật (giữ hành vi 2C-4), bảng template tắt.
2. `access.ts`: `TableAccess.scope()` thêm điều kiện dòng khi khoá phân chia bật: tên người đọc **hoặc người họ quản lý** (cây tổ chức hiện tại, Module 1) ở bất kỳ cột khoá nào; chủ bảng thấy mọi dòng. Mọi truy vấn dòng phải đi qua điều kiện này: `rows-read.ts` (danh sách, một dòng, lịch sử dòng), `rows-groups.ts` (nhóm, dòng tổng), `duplicates.ts`, `trash.ts` (chỉ thấy và khôi phục dòng mình thấy), `export-job.ts`, `lookup-ops.ts` (`relation.search`, `relation.labels` khi bảng đích có khoá phân chia), `attachment-ops.ts` (không tải được file của dòng không thấy), `consistency.ts`.
3. Ghi (`rows.ts`, `row-ops.ts`): sửa ô, sửa hàng loạt, dán, điền xuống, xoá, `row.restore_batch` đều kiểm: quyền Sửa, cột `allow_edit`, dòng nằm trong phạm vi thấy, luật sửa dòng của cấp dưới (Manager được; Leader khi người đó bật "Cho phép leader sửa", Module 1 mục 4.1). Thêm dòng: tự điền người thêm vào cột khoá chính.
4. **SSE** (`events.ts`, `tableAudience`): đang gửi sự kiện dòng cho mọi người có quyền xem bảng. Khi khoá phân chia bật phải lọc theo người thấy dòng, nếu không sẽ **lộ dữ liệu**. Sửa cột khoá làm dòng vào hoặc ra khỏi phạm vi của ai thì gửi sự kiện thêm/bỏ dòng cho người đó.
5. Index: tự tạo/bỏ index GIN cho mỗi cột khoá (cùng chỗ tạo index cho cột Liên kết, `structure.ts`).
6. Cấu trúc (`columns.ts`, `structure.ts`): cột khoá phải là kiểu Người dùng, không đổi kiểu, không xoá khi còn là khoá (bỏ khỏi khoá trước); tối đa 5 khoá; tắt khoá phân chia thì giữ cấu hình cột khoá để bật lại.
7. **Ô Người dùng chỉ nhận thành viên**: `cell-values.ts` kiểm ở mọi kênh (web, API, MCP, import, form); `datahub.people.lookup` chỉ gợi ý chủ bảng và thành viên; `import-plan.ts` báo lỗi theo dòng; mã lỗi mới trong `errors.ts`. Dữ liệu đã có tag người ngoài danh sách: không xoá, hiện "không còn quyền".
8. Gỡ thành viên (`collab.ts`): trả số dòng đang tag người đó để giao diện cảnh báo; tag giữ nguyên, ô hiện "không còn quyền".
9. Chuyển giao (`transfer.ts`): người đích nhận luôn tư cách thành viên và tag của người nguồn ở các bảng có khoá phân chia (deal đóng giữ người cũ theo luật đã chốt).
10. **Lookup, Rollup, công thức đọc sang bảng có khoá phân chia tính theo từng người đọc** (Module 2 mục 10, Dương chốt 19/11): lưu theo nguồn cột cá nhân, mỗi thành viên một giá trị chỉ tính trên dòng họ thấy; `recalc.ts`, `partial.ts` tính lại theo phần cho thành viên bị ảnh hưởng khi dòng nguồn hoặc cột khoá đổi. Load test: 20 thành viên × bảng 100.000 dòng, ghi số đo.
11. Bỏ `PhysicalSource` và nguồn `physical` trong `column-source.ts` (Module 2 mục 3 còn hai nguồn cột).

11a. **Thêm dòng hàng loạt** (Module 2 mục 10): tuỳ chọn bảng `members_bulk_create` (bảng thường bật, bảng template tắt). Tắt thì thành viên không chủ sở hữu bị chặn: `import-job.ts`/`datahub.import.start` (2D đang cho người có quyền Sửa import), `rows.ts` khi một lần ghi tạo hơn một dòng mới (API/MCP hàng loạt, upsert sinh dòng mới), và dán trong grid sinh dòng mới (web chặn trước, server vẫn kiểm). Mã lỗi riêng; giao diện ẩn nút Nhập dữ liệu và báo khi dán vượt số dòng đang có.


**B. Hạ tầng bảng template (engine Module 2, Module 4 dùng)**

12. Cờ bảo vệ bảng và cột template: không đổi tên, không xoá, không đổi kiểu từ trang bảng; người nhận chỉ thêm cột riêng.
13. Lớp cột (Cơ bản, Theo vai trò, Theo team, Tuỳ chỉnh) trên định nghĩa cột; cột Tuỳ chỉnh trên bảng chung chỉ người tạo cột thấy (dùng nguồn cột cá nhân).
14. Vai trò cột (mục 3.7) trên định nghĩa cột; chặn đổi kiểu hoặc bỏ cột làm vai trò mất cột.
15. Bảng hoặc cột template trùng tên với bảng/cột tự tạo: đổi cái tự tạo thành `<tên> (riêng)` và gửi thông báo.
16. Thành viên tự sinh theo cây/team cho bảng template chung; cập nhật khi đổi cây tổ chức (nghe sự kiện của Module 1).

**C. Giao diện**

17. Hộp thoại Chia sẻ (2C-4): bật/tắt khoá phân chia, chọn cột khoá và cột khoá chính, tuỳ chọn "Thành viên được thêm dòng hàng loạt", cảnh báo khi gỡ thành viên đang được tag.
18. Ngăn sửa cột (2C-3): tuỳ chọn "Cho phép sửa"; khi chọn cột khoá chỉ liệt kê cột kiểu Người dùng.
19. Grid: ô của cột không cho phép sửa hiện chỉ đọc; ô Người dùng chỉ gợi ý thành viên; người đã bị gỡ hiện "không còn quyền".
19a. **View nhóm thu gọn** (Module 2 mục 5.1, Dương chốt 19/11/2026): nút "Thu gọn tất cả / Mở tất cả" trong grid khi đang nhóm (`apps/web/src/lib/datahub/session.ts` đang giữ `closed` trong bộ nhớ, chưa lưu); lưu trạng thái thu gọn vào `config` của view (bản riêng khi người được chia sẻ đổi, như mọi thay đổi view). Nhóm đổi giá trị thì nhóm mới mở hay đóng theo chế độ "thu gọn tất cả".
19b. **Xuất dạng tổng hợp**: `export-job.ts` nhận tuỳ chọn `groups_only`; đọc nhóm và ô tổng bằng đúng truy vấn của `rows-groups.ts` (một nơi tính, không tính lại ở export), áp phạm vi người xuất; XLSX ghi cột nhóm + Số dòng + cột tổng, nhóm lồng thụt lề hoặc thêm cột cấp. Hộp thoại xuất có lựa chọn "Dòng nhóm / Mọi dòng" khi view đang nhóm. Test: số trong file bằng số dòng tổng trên grid, kể cả khi khoá phân chia bật.
19c. **Kiểu cột "Ngày sửa của cột…"** (Module 2 mục 4): chọn 1–5 cột theo dõi; ghi thời điểm khi người, API, form, command đổi giá trị cột đó (ghi do công thức tính lại không tính, cùng luật nhật ký); chỉ đọc. Tạo trên bảng đã có dữ liệu thì điền lại từ `row_history`. Deals dùng cho `Ngày đổi Status` (Module 4 mục 4.1).
19d. **Đổi tên lựa chọn có công thức so chữ** (Module 2 mục 6): khi đổi tên lựa chọn của một cột, server tìm công thức có so sánh cột đó với chữ trùng tên cũ (`[Status]="Won"`, `COUNTIFS([Status], "Won")`…); hộp thoại liệt kê và mặc định "Cập nhật cả các công thức này". Không cập nhật thì công thức không lỗi mà ra sai im lặng, nên phải cảnh báo.

**D. Kiểm thử**

20. Test phân quyền: thành viên × khoá phân chia bật/tắt × có/không cấp dưới × cột cho phép/không × kênh (REST, SSE, nhóm và dòng tổng, export, tìm dòng trùng, thùng rác, liên kết, tải file, import, dán sinh dòng mới, API hàng loạt × tuỳ chọn thêm hàng loạt).
21. Chạy lại test datahub cũ (`pnpm exec vitest run apps/api/test/datahub-*`) và e2e `stage2c3`, `stage2c4` vì phần này chạm `access.ts`, chia sẻ và ô Người dùng (phần dùng chung, Opus phải tự chạy lại khi rà).

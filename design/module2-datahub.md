# Module 2 — Datahub

> Trạng thái: **Đã chốt** · 18/11/2026
> Phụ thuộc: [Module 0](module0-nen-tang.md) (registry, lịch sử dòng, bộ lọc, keyset, outbox, thùng rác), [Module 1](module1-tai-khoan-phan-quyen.md) (chủ sở hữu, chia sẻ, phạm vi dữ liệu).
> Để module sau: Dashboard (Module 3); bảng Deals và ba nguồn cột (Module 4); MCP (Module 5); Form ghi vào bảng (Module 7).

Datahub là linh hồn của hệ thống: mọi dữ liệu người dùng tự định nghĩa đều nằm ở đây, mọi API gọi đến hay mang đi đều là "Datahub A – Bảng 1 của User X".

## 1. Khái niệm

| Khái niệm | Tương đương | Ghi chú |
|---|---|---|
| Datahub | Một file Google Sheets / một Base trong Lark | Thuộc về một người |
| Bảng | Một sheet | Một datahub có nhiều bảng |
| Cột | Field có kiểu | Công thức áp cho cả cột |
| Dòng | Record | Có `id` riêng, không đổi |
| View | View của Lark Base | Cách nhìn một bảng: lọc, sắp xếp, nhóm, ẩn/cố định cột, độ rộng cột. **Tự lưu** |

Quản lý Deal là chức năng riêng chạy trên engine này, **không** tính vào giới hạn datahub.

## 2. Tên

- **Tên datahub không trùng** trong các datahub của cùng một chủ.
- **Tên bảng không trùng** trong cùng một datahub.
- **Tên cột không trùng** trong cùng một bảng.
- So trùng không phân biệt hoa thường, bỏ khoảng trắng thừa ở đầu và cuối (`Doanh thu` trùng `doanh thu `).
- Tên không được chứa `[` và `]`, vì hai ký tự này dùng trong cú pháp công thức. Độ dài 1–100 ký tự.
- Datahub được người khác chia sẻ cho mình có thể trùng tên với datahub của mình. Danh sách hiển thị kèm tên chủ. Không có nhập nhằng trong công thức, vì công thức không được dùng datahub của người khác.

Lý do: khi viết công thức `[Datahub B].[Thanh toán].[Số tiền]`, mỗi tên phải chỉ đúng một đối tượng, giống tên file trong một thư mục.

## 3. Cách lưu

- Mọi dòng của mọi bảng nằm chung bảng `dh_rows`. Các trường của một dòng:
  - `id`: UUIDv7.
  - `row_no`: số thứ tự dễ đọc theo bảng, ví dụ `#1024`.
  - `data`: giá trị lưu trong JSONB, theo **mã cột cố định** (không theo tên). Đổi tên cột không ảnh hưởng dữ liệu hay công thức.
  - Các cột chuẩn của Module 0.
- **Kết quả công thức được tính sẵn và lưu vào database** cùng dòng (mục 6.5). Mở bảng, lọc, sắp xếp, xuất file, gọi API đều đọc giá trị đã lưu.
- Cột chữ được gom vào một trường tìm kiếm, có index trigram và không phân biệt dấu.
- Cột hay bị lọc hoặc sắp xếp trên bảng lớn được tự tạo index (Module 0 mục 6.2).
- **Xuất bằng một câu SQL:** mỗi bảng có một view tự sinh trong schema `dh_views`, tên cột đúng tên người dùng đặt. Ví dụ: `SELECT * FROM dh_views."linh.nguyen – Theo dõi lead – Bảng 1";`. Đổi cấu trúc bảng thì worker sinh lại view. Chỉ tài khoản database quản trị đọc được schema này.
- **Ba nguồn cột** (để Module 4 dùng): cột lưu trong `data` (mặc định); cột thật của bảng hệ thống; giá trị riêng theo từng người (cột cá nhân). Engine đọc, ghi, lọc, sắp xếp, tính công thức như nhau với cả ba nguồn.

## 4. Kiểu cột

| Nhóm | Kiểu |
|---|---|
| Cơ bản | Văn bản, Văn bản dài, Số, Tiền (VND), Phần trăm, Ngày, Ngày giờ, Checkbox, Đánh giá (sao) |
| Lựa chọn | Một lựa chọn, Nhiều lựa chọn. Mỗi lựa chọn có màu và **thứ tự** do người dùng sắp |
| Liên hệ | Người dùng, Email, Điện thoại, URL |
| File | Đính kèm |
| Liên kết | Liên kết dòng (sang bảng khác của cùng chủ), Lookup (kéo một cột qua liên kết), Rollup (tổng hợp qua liên kết) |
| Tính toán | Công thức, Số tự tăng |
| Hệ thống | Mã dòng, Ngày tạo, Người tạo, Ngày sửa, Người sửa |

- Thuộc tính cột: bắt buộc, duy nhất, giá trị mặc định, mô tả, định dạng hiển thị (số chữ số thập phân, dấu phân cách, đơn vị).
- Server kiểm tra giá trị theo kiểu ở **mọi kênh** (web, API, MCP, import, form).
- Đổi kiểu cột: hệ thống chuyển đổi giá trị nếu được. Giá trị nào không chuyển được thì báo trước khi làm, và lưu lại trong lịch sử để khôi phục.

## 5. View (theo kiểu Lark Base)

### 5.1 Chức năng

- Các view là các tab trên đầu bảng. Thêm, đổi tên, sao chép, xoá, kéo đổi thứ tự.
- Thanh công cụ: **Lọc**, **Sắp xếp**, **Nhóm**, **Ẩn cột**, **Chiều cao dòng**, **Tô màu theo điều kiện**.
- **Độ rộng cột:** kéo mép tiêu đề.
- **Cố định cột:** kéo vạch cố định, hoặc chọn "Cố định đến cột này". Các cột bên trái đứng yên khi cuộn ngang.
- Kéo tiêu đề để đổi thứ tự cột trong view.
- **Lọc theo điều kiện:** nhiều điều kiện, chọn "thoả tất cả" hoặc "thoả một trong", có nhóm lồng nhau. Dùng cú pháp lọc của Module 0, có toán tử ngày tương đối (tháng này, quý trước, 30 ngày qua…).
- **Sắp xếp nhiều cấp:** ví dụ theo Ưu tiên, rồi theo Hạn việc tiếp theo, rồi theo Doanh thu.
- Nhóm theo một hoặc nhiều cột, có dòng tổng của mỗi nhóm (đếm, tổng, trung bình…).
- Bản đầu chỉ có **dạng bảng**. Kanban và Lịch làm ở giai đoạn làm đẹp.

### 5.2 Tự lưu

Mọi thay đổi trên view được lưu ngay, không có nút "Lưu": lọc, sắp xếp, nhóm, ẩn cột, độ rộng, cố định, thứ tự cột, tô màu. Lần sau mở lại thấy đúng như lúc rời đi.

| Ai đổi view | Lưu vào đâu |
|---|---|
| Chủ bảng, trên view chung | View chung, mọi người thấy |
| Người khác (được chia sẻ), trên view chung | **Bản riêng của người đó**, đè lên view chung. Không ảnh hưởng ai. Có nút "Về mặc định" |
| Bất kỳ ai, trên view cá nhân | View cá nhân của người đó |

Bảng cũng nhớ view cuối cùng mỗi người đã mở.

### 5.3 Sắp xếp theo điều kiện

Đây là nền cho việc sắp xếp deal theo BANT (Module 4 dùng lại):

- **Theo thứ tự lựa chọn:** cột Một lựa chọn sắp theo thứ tự người dùng đã xếp các lựa chọn, không theo chữ cái. Ví dụ `P1 – Ưu tiên cao` → `P2` → `P3` → `Chưa đủ dữ liệu` → `Không đánh giá`.
- **Theo cột công thức:** muốn sắp theo một quy tắc phức tạp thì tạo cột công thức (có thể ẩn) rồi sắp theo cột đó. Ví dụ điểm ưu tiên kết hợp BANT, hạn chốt và doanh thu.
- **Vị trí ô trống:** chọn ô trống nằm đầu hay cuối.
- Sắp xếp nhiều cấp kết hợp được với cả hai kiểu trên.

Ví dụ view "Ưu tiên hôm nay" của Deals: lọc deal đang theo dõi, sắp theo `Mức ưu tiên (BANT)` (thứ tự lựa chọn) rồi theo `Hạn việc tiếp theo` (tăng dần, ô trống cuối).

## 6. Công thức

### 6.1 Cú pháp

```
=IF([Doanh thu] > 1000000000, "Trên 1 tỷ", "Dưới 1 tỷ")              ← cùng bảng
=XLOOKUP([Mã KH], [Khách hàng].[Mã], [Khách hàng].[Tên])            ← bảng khác, cùng datahub
=SUMIFS([Datahub B].[Thanh toán].[Số tiền],
        [Datahub B].[Thanh toán].[Mã deal], [Mã deal])              ← datahub khác, cùng chủ
```

- `[Cột]` là giá trị của dòng hiện tại. `[Bảng].[Cột]` và `[Datahub].[Bảng].[Cột]` là cả cột của bảng đó, dùng trong các hàm tra cứu và tổng hợp.
- Khi lưu, tên được đổi thành mã. Đổi tên thì công thức tự hiện tên mới.
- Không có tham chiếu ô kiểu `A1`, không có công thức theo từng ô.

### 6.2 Hàm (khoảng 100)

| Nhóm | Hàm |
|---|---|
| Logic | IF, IFS, SWITCH, AND, OR, NOT, XOR, IFERROR, IFNA, ISBLANK, ISNUMBER, ISTEXT, ISERROR |
| Toán | SUM, PRODUCT, SUMPRODUCT, ROUND, ROUNDUP, ROUNDDOWN, INT, ABS, MOD, POWER, SQRT, CEILING, FLOOR, LOG, EXP |
| Thống kê | COUNT, COUNTA, COUNTBLANK, COUNTIF, COUNTIFS, SUMIF, SUMIFS, AVERAGE, AVERAGEIF, AVERAGEIFS, MIN, MAX, MINIFS, MAXIFS, MEDIAN, PERCENTILE, QUARTILE, STDEV, MODE, RANK, LARGE, SMALL, COUNTUNIQUE |
| Chuỗi | CONCAT, TEXTJOIN, LEFT, RIGHT, MID, LEN, LOWER, UPPER, PROPER, TRIM, SUBSTITUTE, REPLACE, FIND, SEARCH, TEXT, VALUE, REGEXMATCH, REGEXEXTRACT, REGEXREPLACE |
| Ngày | TODAY, NOW, DATE, DATEVALUE, YEAR, MONTH, DAY, QUARTER, WEEKDAY, WEEKNUM, EOMONTH, EDATE, DATEDIF, DAYS, NETWORKDAYS, WORKDAY |
| Tra cứu | XLOOKUP, VLOOKUP, INDEX, MATCH, XMATCH, FILTER, UNIQUE, SORT |
| Thông tin dòng | ROW_ID, ROW_NO, CREATED_TIME, MODIFIED_TIME |

- Mọi công thức trong file deal mẫu (COUNTIFS, SUMIFS, DATEDIF, IFS, EOMONTH, ROUNDUP…) phải chạy được. Golden test kiểm việc này.
- Toán tử: `+ - * / ^ &`, so sánh `= <> < <= > >=`, điều kiện dạng chuỗi kiểu Excel (`">="&[Ngày]`, `"POD*"` có ký tự đại diện).

### 6.3 Trình soạn công thức

- Gõ `[` thì gợi ý datahub, bảng, cột. Gõ tên hàm thì gợi ý hàm và hiện cú pháp, tham số đang nhập được tô đậm.
- Mỗi hàm có mô tả tiếng Việt ngắn và một ví dụ.
- **Xem trước kết quả trên 5 dòng đầu** ngay khi gõ.
- Lỗi tô đỏ đúng chỗ, kèm câu giải thích dễ hiểu.
- Kiểu kết quả (số, tiền, ngày, chữ…) được tự nhận biết, người dùng đổi được định dạng hiển thị.
- **Thư viện công thức mẫu**: phân loại deal size, số ngày cycle, quý của ngày chốt, com theo bảng tra, tra cứu từ bảng khác, đếm theo điều kiện… Bấm là chèn, sửa tên cột cho phù hợp.

Engine công thức (`packages/formula`) chạy được cả trong trình duyệt (xem trước) và ở server (tính thật). Kết quả của server là kết quả chính thức.

### 6.4 Luật phân quyền

- Công thức chỉ được tham chiếu bảng thuộc datahub **cùng chủ** với bảng chứa công thức. Kiểm tra khi lưu và mỗi lần tính.
- Bảng hay datahub được người khác chia sẻ **không** dùng được trong công thức.
- Vi phạm thì báo `#PERM!`.

### 6.5 Lưu và tính lại

Giá trị công thức **luôn được tính sẵn và lưu trong database**, không tính lúc mở bảng.

| Khi nào | Ai tính | Bao lâu |
|---|---|---|
| Sửa một dòng, công thức chỉ dùng cột cùng dòng | API, ngay trong lúc lưu dòng | Tức thì |
| Bảng nguồn ở bảng/datahub khác thay đổi | Worker tính lại các cột phụ thuộc rồi lưu | Vài giây. Ô đang chờ hiện biểu tượng "đang tính" |
| Tạo hoặc sửa công thức | Worker tính lại cả cột | Có thanh tiến độ |
| Công thức có `TODAY()` | Worker tính lại lúc 00:05 mỗi ngày (giờ Việt Nam), kéo theo mọi cột phụ thuộc | Vài giây đến vài phút |
| Công thức có `NOW()` | Worker tính lại **mỗi giờ** | — |

Ghi chú về hàm theo thời gian:

- Trong vài phút đầu ngày, trước khi job 00:05 chạy xong, ô có `TODAY()` còn giữ giá trị hôm qua. Ô đó hiện biểu tượng "đang tính" cho đến khi xong.
- Lọc theo ngày tương đối ("tháng này", "30 ngày qua", "quá hạn") **không** dùng giá trị lưu sẵn mà tính ngay lúc truy vấn, nên luôn đúng theo giờ hiện tại. Phần lớn nhu cầu kiểu "deal nào quá hạn" nên dùng bộ lọc, không cần cột công thức `TODAY()`.
- Server khởi động lại sau khi bỏ lỡ lịch 00:05 thì job chạy bù ngay khi worker lên.

- Mỗi lần tính lại, giá trị mới được **ghi đè vào database**. Ô có giá trị không đổi thì bỏ qua, không ghi.
- Ghi do tính lại **không** tạo bản ghi trong lịch sử dòng, không ghi nhật ký, không đổi `version` và "Ngày sửa" của dòng. Lịch sử chỉ ghi dữ liệu do người, API hay form nhập vào, vì giá trị công thức luôn tính lại được từ dữ liệu đó. Nếu không làm vậy, riêng cột `TODAY()` trên 10.000 deal sẽ sinh 10.000 bản lịch sử mỗi ngày.
- Bảng đang mở vẫn nhận tín hiệu SSE khi ô công thức đổi giá trị.
- Vòng lặp (A dùng B, B dùng A) bị chặn ngay khi lưu công thức.
- Lỗi hiện giống Excel: `#DIV/0!`, `#N/A`, `#VALUE!`, `#REF!` (cột/bảng bị xoá), `#CYCLE!`, `#PERM!`.

### 6.6 Bảng lớn

- Hàm tra cứu và tổng hợp có điều kiện bằng (`XLOOKUP`, `SUMIFS`, `COUNTIFS`… với điều kiện `=`) được dịch thành **một câu SQL gom nhóm cho cả cột**, không lặp từng dòng. Mục tiêu: 100.000 × 100.000 dòng tính xong trong vài giây.
- Điều kiện không dịch được sang SQL (regex, so sánh chuỗi phức tạp) chỉ dùng được khi bảng nguồn ≤ 20.000 dòng. Vượt ngưỡng thì báo lúc lưu công thức.

## 7. Sửa dữ liệu

- Sửa ngay trên ô, di chuyển bằng bàn phím như bảng tính.
- **Dán cả vùng từ Excel/Sheets**; tự chuyển kiểu (ngày `dd/mm/yyyy`, số `156,000,000`).
- Kéo để điền xuống; sửa hàng loạt các dòng đã chọn.
- Hoàn tác/làm lại (dựa trên lịch sử dòng).
- Mở chi tiết một dòng: đủ mọi cột và lịch sử thay đổi.
- **Gộp sửa:** hai người sửa hai ô khác nhau của cùng một dòng thì server gộp. Chỉ báo xung đột khi cùng một ô đã bị người khác sửa sau lúc mình đọc.
- Bảng đang mở tự cập nhật khi người khác sửa (tín hiệu SSE).

## 7a. Tìm dòng trùng

Công cụ dọn bảng đã có dữ liệu trùng (ví dụ sau khi import từ Google Sheet cũ). Bổ sung ngày 18/11/2026, làm ở phần 2C.

- Chọn một hoặc vài cột làm khoá, ví dụ `MST`, hoặc `Tên công ty` + `Ngày nhận`.
- So khớp có chuẩn hoá: bỏ dấu, không phân biệt hoa thường, bỏ khoảng trắng thừa ("Công ty Thuận Phát " trùng "cong ty thuan phat").
- Hiện các nhóm trùng, mỗi nhóm liệt kê các dòng.
- Với mỗi nhóm, người dùng chọn: giữ một dòng và xoá các dòng còn lại, hoặc **gộp** (chọn giá trị từng ô từ các dòng, rồi xoá các dòng thừa). Có thao tác áp một cách xử lý cho mọi nhóm.
- Dòng bị xoá vào thùng rác; việc gộp ghi lịch sử dòng như sửa tay.
- Chỉ chủ và người có quyền "Sửa dữ liệu" dùng được. Có API tương ứng.

Cách chặn trùng từ gốc vẫn là: cột **Duy nhất**, import kiểu **cập nhật theo cột khoá**, và không chép cùng một thứ ra nhiều bảng (dùng cột liên kết). Chống trùng khi gộp nhiều bảng: Bảng gộp ở [Module 3](module3-metric-dashboard.md) mục 4.

## 8. Import

### 8.1 Các bước

1. Chọn nguồn: file `.xlsx`, `.csv`, dán trực tiếp, hoặc link Google Sheets đang để "ai có link đều xem được". Không kết nối Google bằng OAuth.
2. Chọn sheet (được chọn nhiều sheet một lần, mỗi sheet thành một bảng) và dòng tiêu đề.
3. Xem trước. Ghép mỗi cột vào cột có sẵn hoặc tạo cột mới. Hệ thống tự đoán kiểu.
4. Chọn cách nhập: **thêm mới**, **cập nhật theo cột khoá**, **thay toàn bộ**.
5. Xem báo cáo trước khi chạy: số dòng hợp lệ, dòng lỗi và lý do.
6. Chạy nền, có thanh tiến độ; chịu được 100.000 dòng.

### 8.2 Import công thức

Với cột có công thức trong file gốc, người dùng chọn: **chỉ lấy giá trị** (mặc định) hoặc **lấy công thức**.

Chọn lấy công thức thì cột đó thành cột công thức, nếu dịch được. Điều kiện dịch được:

- Công thức giống nhau trên mọi dòng, chỉ khác số dòng (`=P2*20%` ở dòng 2, `=P3*20%` ở dòng 3 → `=[Doanh thu]*20%`).
- Mọi tham chiếu trỏ tới cột có trong lần import: cùng sheet → cùng bảng; sheet khác cùng file → bảng import cùng lúc; tham chiếu bảng Excel kiểu `Deals[Start date]` → `[Deals].[Start date]`.
- Mọi hàm đều có trong danh sách hàm.

Không dịch được thì cột đó nhập **giá trị**, và báo cáo ghi rõ lý do từng cột:

| Lý do | Ví dụ |
|---|---|
| Công thức khác nhau giữa các dòng | Dòng 2 `=A2+B2`, dòng 3 `=A3*2` |
| Tham chiếu bảng không tồn tại | Trỏ tới sheet `Index` không được chọn import |
| Tham chiếu dữ liệu không tồn tại | Trỏ tới cột/ô không có trong lần import |
| Tham chiếu ô cố định | `$D$7` (một ô tham số, không phải một cột) |
| Hàm không hỗ trợ | `INDIRECT`, `OFFSET`, `ARRAYFORMULA`, `QUERY` |
| Công thức lỗi trong file gốc | `#REF!` |

Ví dụ thực tế: sheet `Index` của file deal mẫu, mỗi dòng là một tháng với `COUNTIFS(Deals[Start date], ">="&$A2, …)`, dịch được thành cột công thức `=COUNTIFS([Deals].[Start date], ">="&[Thời gian], …)` nếu import cùng lúc với sheet `Deals`. Còn sheet `Plan` dùng ô tham số `$D$7` thì báo không dịch được.

## 9. Export

- Định dạng: CSV, XLSX, JSON. Xuất theo view đang lọc hoặc toàn bộ bảng; XLSX xuất được cả datahub (mỗi bảng một sheet).
- File xuất chứa **giá trị** đã tính. XLSX có thêm một sheet `Công thức` liệt kê công thức của từng cột công thức, để người nhận biết số được tính thế nào.
- File có watermark (người xuất, thời điểm); việc xuất ghi nhật ký.
- Xuất được qua giao diện, API, và SQL (view ở mục 3).

## 10. Chia sẻ

| Cách chia sẻ | Người nhận thấy |
|---|---|
| Cả datahub | Mọi bảng, kể cả bảng tạo sau này |
| Từng bảng | Datahub hiện trong mục "Được chia sẻ với tôi", **chỉ thấy các bảng được chia sẻ**, không thấy bảng khác |

- Quyền: **Xem** hoặc **Sửa dữ liệu**. Chỉ chủ sửa được cấu trúc (bảng, cột, công thức, view chung).
- Bảng được chia sẻ có cột Liên kết/Lookup/công thức lấy từ bảng không được chia sẻ: người nhận thấy **giá trị** trong bảng được chia sẻ, nhưng không mở được dòng ở bảng kia.
- Người nhận không dùng bảng được chia sẻ trong công thức của mình.
- Leader, Manager, Admin **không** thấy datahub của người khác nếu không được chia sẻ (Module 1 mục 4.2).

## 11. Giới hạn

Admin cài trong Cài đặt giới hạn, mặc định cho mọi người và chỉnh riêng được cho từng người:

| Giới hạn | Mặc định | Trần |
|---|---|---|
| Datahub mỗi người | 5 | Admin đặt |
| Bảng mỗi datahub | 10 | Admin đặt |
| Cột mỗi bảng | **70** | **200** |
| Dòng | Không giới hạn | — |
| Dung lượng file | Theo Module 0 | — |

## 12. API

- REST đầy đủ cho datahub, bảng, cột, dòng, view, chia sẻ, import, export.
- Dòng: tạo/sửa/xoá đơn lẻ; hàng loạt tối đa 500 dòng mỗi lần; upsert theo cột khoá; lọc bằng cú pháp Module 0; chọn cột bằng `fields=`; lịch sử một dòng.
- Tham chiếu cột qua API bằng mã cột hoặc tên cột (tên được dịch sang mã).
- Thùng rác 7 ngày cho dòng, bảng, datahub; khôi phục qua giao diện và API.

## 13. Giao diện tối thiểu (Stage 2)

- Danh sách datahub: của tôi, được chia sẻ với tôi.
- Trang datahub: tab bảng, tab view, grid ảo hoá, thanh công cụ view, chi tiết dòng, lịch sử dòng.
- Quản lý cột: thêm/sửa/xoá, kiểu, thuộc tính, trình soạn công thức có gợi ý và xem trước, thư viện công thức mẫu.
- Import (các bước ở mục 8), export, chia sẻ, thùng rác.
- Admin: cài đặt giới hạn.

## Quyết định khi code

### Stage 2A (lưu trữ và API lõi)

Phạm vi 2A: schema, cấu trúc, dòng, view, chia sẻ, giới hạn, thùng rác, SSE, chuyển giao, view SQL, index tự động. Chưa có công thức, relation, lookup, rollup (2B), chưa có giao diện (2C), chưa có import/export (2D).

**Lưu trữ**
- Bảng: `dh_datahubs`, `dh_tables`, `dh_columns`, `dh_rows`, `dh_views`, `dh_view_overrides`, `dh_table_state`, `dh_shares`, `dh_user_limits`, `dh_index_requests` (migration `0004`). Code ở `packages/db/src/schema/datahub.ts` và `apps/api/src/modules/datahub/`.
- Giá trị ô nằm trong `dh_rows.data` (jsonb), khoá là **mã cột**, không phải tên cột. Mã cột dạng `c_xxxxxxxx` (ngẫu nhiên, không sinh từ tên, có ràng buộc `^[a-z][a-z0-9_]{0,40}$`). Đổi tên cột không đụng vào dữ liệu.
- API nhận cột bằng mã hoặc tên; server dịch tên sang mã. Trường chuẩn dùng tiền tố `_`: `_row_no`, `_created_at`, `_updated_at`, `_created_by`, `_updated_by`, `_id`, `_version`.
- Ô rỗng thì khoá bị bỏ khỏi `data` (không lưu `null`).
- Cột Một lựa chọn lưu **mã lựa chọn** `o_xxxxxxxx`; Nhiều lựa chọn lưu mảng mã. Đổi tên lựa chọn không đụng dữ liệu. API nhận mã hoặc tên (không phân biệt hoa thường, bỏ dấu); `labels=true` khi đọc thì trả tên. Thứ tự trong mảng `options` là thứ tự sắp xếp. Tên lựa chọn không trùng trong cột, tối đa 200 lựa chọn.
- `dh_rows.search` gom chữ của mọi ô kiểu chữ để tìm toàn bảng; có index trigram trên `soe_unaccent(lower(search))`. Tìm kiếm tách tối đa 8 từ, từ nào cũng phải khớp.
- `row_no` tăng theo bảng, không dùng lại. Cột Số tự tăng giữ bộ đếm trong `config.seq`.
- Tên (datahub, bảng, cột) không trùng không phân biệt hoa thường và dấu cách thừa: cột `name_norm` sinh tự động, có unique index chỉ tính bản ghi chưa xoá. Tên tối đa 100 ký tự, không có `[` `]`.
- Kiểu cột có sẵn trong 2A: chữ, chữ dài, số, tiền, phần trăm, ngày, ngày giờ, checkbox, đánh giá, một lựa chọn, nhiều lựa chọn, người dùng, email, điện thoại, link, đính kèm, số tự tăng, và các cột hệ thống (mã dòng, thời gian tạo/sửa, người tạo/sửa). `formula`, `relation`, `lookup`, `rollup` đã giữ tên nhưng tạo cột sẽ bị từ chối (`available: false`) cho đến 2B. Kiểu cột là một registry (`registerColumnType`), 2B cắm thêm vào.
- Đổi kiểu cột có API xem trước (`datahub.column.type_preview`: đếm ô đổi được, ô mất) rồi mới đổi (`datahub.column.type_change`).

**Ghi dòng**
- Mọi thao tác ghi đi qua một chỗ (`applyRowOps` trong `rows.ts`): tạo, sửa, xoá, upsert, batch. Gọi đơn lẻ là batch một phần tử. Batch tối đa 500, chạy một giao dịch; lỗi nhiều ô được gom lại báo một lần (`issues` có số dòng, tên cột, lý do).
- Sửa dòng **gộp theo từng ô**: client gửi `base` (giá trị đã đọc). Chỉ khi chính ô đó bị người khác đổi sau đó mới trả 409 `conflict` kèm giá trị hiện tại; sửa hai ô khác nhau thì gộp. Không có `base` thì bắt buộc gửi `version`.
- Sửa mà không đổi gì thì kết quả `unchanged`: không tăng `version`, không ghi lịch sử.
- Upsert theo khoá: cột khoá phải là cột `unique`; cột `unique` có unique index thật (loại `uniq`, tạo ngay khi bật, không tính vào ngân sách 8 index tự động). Bỏ `unique` hoặc xoá cột thì index bị bỏ.
- Xoá dòng là xoá mềm (`deleted_at`); khôi phục bằng `datahub.row.restore`. Lịch sử dòng (`row_history`) giữ mãi, kể cả sau khi dòng bị dọn khỏi thùng rác. Lịch sử đọc bằng `datahub.row.history` (phân trang theo `version` giảm dần).

**Đọc dòng**
- `datahub.row.list`: lọc bằng cú pháp chung của Module 0, sắp xếp nhiều cấp (`sort` dạng JSON hoặc `cột:asc:last,...`), `fields`, `search`, `labels`. Mặc định `limit` 50, tối đa 500 (`MAX_PAGE_LIMIT`).
- Phân trang **keyset** (con trỏ `next_cursor`), không dùng offset. Luôn thêm `row_no` vào cuối thứ tự sắp để ổn định. Cột Một lựa chọn sắp theo thứ tự lựa chọn, không theo chữ. `include_total=true` mới đếm tổng (đếm tốn thời gian trên bảng lớn).
- Lọc, sắp xếp, tìm kiếm đều chạy ở server bằng SQL trên jsonb; client không bao giờ tải cả bảng.

**Index tự động** (Module 0 mục 6.2)
- Mỗi lần đọc, nếu bảng có **từ 5.000 dòng** (`DH_AUTO_INDEX_MIN_ROWS`) và có lọc hoặc sắp xếp theo một cột, server ghi một yêu cầu vào `dh_index_requests` (mỗi bộ bảng-cột-loại một dòng, `ON CONFLICT DO NOTHING`). Việc ghi này làm "cố gắng hết sức": lỗi thì bỏ qua, không làm hỏng lần đọc.
- Loại index theo kiểu cột: `num`, `text`, `date`, `ts`, `bool`, `uuid`; lọc `contains` hoặc `starts_with` trên cột chữ thì dùng `trgm` (GIN trigram, đã bỏ dấu và chữ thường). Cột ảo (mã dòng, thời gian tạo/sửa...) đã có cột thật nên không cần index.
- Worker chạy job `datahub-autoindex` mỗi phút, xử lý tối đa 50 yêu cầu mỗi lượt. **Tối đa 8 index tự động mỗi bảng** (`DH_AUTO_INDEX_MAX_PER_TABLE`); yêu cầu vượt ngân sách bị đánh dấu `skipped` kèm ghi chú. Lỗi thì `failed`, ghi lý do (cắt 300 ký tự).
- Index là **index biểu thức một phần**: chỉ trên một bảng và dòng chưa xoá (`WHERE table_id = ... AND deleted_at IS NULL`). Tên: `dh_ix_<12 ký tự đầu của id bảng>_<mã cột>_<loại>`.
- Vai trò `soe_app` không có quyền DDL, nên việc tạo/xoá index và view đi qua hàm `SECURITY DEFINER` (`soe_dh_ensure_index`, `soe_dh_drop_indexes`, `soe_dh_regenerate_view`, `soe_dh_sync_views`, migration `0005`). Hàm chỉ dựng SQL từ mã cột đã kiểm tra mẫu và loại cố định. Hàm `soe_date`, `soe_ts` bọc việc ép kiểu ngày để dùng được trong index (IMMUTABLE).
- Khi xoá hẳn cột (dọn thùng rác) thì giá trị bị gỡ khỏi `data` và các index của cột bị bỏ.

**View SQL xuất** (mục 3)
- Mỗi bảng có một view trong schema `dh_views`, tên `<phần trước @ của email chủ> – <datahub> – <bảng>`. Cột view mang tên cột người dùng đặt; giá trị đã đổi sang dạng đọc được (lựa chọn thành tên, người dùng thành họ tên, số thành `numeric`/`bigint`, ngày thành `date`/`timestamptz`). Luôn có `id` và `row_no`.
- **Tên dài:** Postgres giới hạn định danh 63 byte. Tên được cắt theo byte nhưng không cắt giữa ký tự tiếng Việt (`soe_dh_ident`). Hai bảng cắt ra cùng tên thì bảng sau thêm đuôi ` #` + 6 ký tự đầu của id. Tên cột trùng sau khi cắt (hoặc trùng `id`, `row_no`) thì thêm `_2`, `_3`...
- Bảng hoặc datahub nằm trong thùng rác thì không có view. Chỉ chủ schema đọc được `dh_views`; vai trò ứng dụng không đọc.
- View dựng lại ở worker khi nhận sự kiện `datahub.structure.changed`; thêm job `datahub-views-sync` mỗi đêm 03:20 dựng lại mọi view và xoá view mồ côi.

**Giới hạn, thùng rác, chia sẻ**
- Giới hạn mặc định nằm trong cài đặt hệ thống: `datahub.max_datahubs` (5), `datahub.max_tables` (10), `datahub.max_columns` (70, tối đa 200). Chỉnh riêng từng người trong `dh_user_limits` (`datahub.limit.user.set`); giá trị trống là dùng mặc định. Cột không bao giờ vượt trần 200 dù cài đặt hay chỉnh riêng. Vượt giới hạn trả mã `quota_exceeded`.
- Thùng rác dùng chung cài đặt `trash.retention_days` (mặc định 7) của Module 0; job dọn hằng đêm xoá hẳn theo thứ tự dòng, cột, bảng, datahub. Khoá ngoại xoá dây chuyền view, chia sẻ, yêu cầu index.
- Chia sẻ: `view` hoặc `edit_data`; theo cả datahub (`table_id` trống) hoặc từng bảng. Mỗi cặp (datahub, người) hoặc (bảng, người) chỉ có một dòng. Quyền sửa cấu trúc chỉ của chủ.

**SSE (sự kiện)**
- `datahub.row.created|updated|deleted|restored`: mang `table_id`, `row_ids` (tối đa 500), `columns` (mã các cột đổi, để 2B tính lại phần phụ thuộc). Không mang giá trị.
- `datahub.structure.changed`: mang `datahub_id`, `table_id`, `change` (datahub/bảng/cột tạo, sửa, xoá, khôi phục, đổi chủ, đổi kiểu cột). Worker dùng nó để dựng lại view SQL.
- `datahub.share.changed`: người được chia sẻ nhận cả khi vừa bị gỡ.
- Chỉ người nhìn thấy bảng (chủ và người được chia sẻ) nhận tín hiệu.

**Chuyển giao dữ liệu** (Module 1 mục 8)
- Datahub của tài khoản nguồn (cả datahub trong thùng rác) đổi chủ sang tài khoản đích. Tên trùng với datahub của đích thì thêm ` (chuyển giao)`, rồi ` (chuyển giao 2)`... để không mất và không bị từ chối. Chia sẻ mà đích đã có sẵn trên datahub đó bị xoá vì thừa. View SQL dựng lại vì tên view chứa tên chủ.

**Lệch hoặc bổ sung so với thiết kế**
- Thiết kế chưa nói con số cụ thể của ngân sách index; code chốt 8 mỗi bảng, ngưỡng 5.000 dòng.
- Index `uniq` (cột `unique`) tạo ngay, không qua job và không tính vào ngân sách 8.
- Chỉnh giới hạn riêng từng người (`datahub.limit.user.list|set`) dùng quyền cài đặt hệ thống `system:setting:read|write`.
- Không có lệch nào với quy định đã chốt trong CLAUDE.md.

**Đo tốc độ (bảng 100.000 dòng, máy dev, `apps/api/test/datahub-perf.test.ts`)**
- Trung vị 7 lần, trang đầu 50 dòng: trước index 23–81 ms, sau index 3–44 ms; tìm kiếm trigram 4–5 ms; trang keyset kế tiếp 2,7 ms mỗi trang. Mọi tình huống dưới 300 ms. Số cụ thể ở `progress.md`.

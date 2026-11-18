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

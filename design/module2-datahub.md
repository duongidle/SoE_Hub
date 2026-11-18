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

### 5.4 Lọc theo thời gian

Bổ sung ngày 18/11/2026 theo yêu cầu của Dương, làm ở phần 2C.

- Mỗi bảng có ô **Thời gian** cố định trên thanh công cụ, cạnh nút Lọc. Không cần mở hộp lọc điều kiện.
- Chọn cột ngày để lọc: mọi cột Ngày, Ngày giờ, kể cả Ngày tạo, Ngày sửa. Mặc định là cột ngày đầu tiên của bảng. Bảng không có cột ngày thì ẩn ô này.
- Chọn được nhiều cột ngày cùng lúc, nghĩa là "một trong các cột rơi vào khoảng". Ví dụ ngày nhận **hoặc** ngày chốt.
- Khoảng có sẵn: Hôm nay, Tuần này, Tuần trước, Tháng này, Tháng trước, Quý này, Quý trước, Năm nay, Năm trước, N ngày qua, Từ ngày – đến ngày.
- Chọn được một kỳ cụ thể (tháng, quý hoặc năm), có nút ‹ › để lùi hoặc tiến một kỳ.
- Khoảng tương đối tự trôi theo ngày hiện tại ("Tháng này" sang tháng sau là tháng mới). Kỳ cụ thể đứng yên.
- Kết hợp **và** với bộ lọc điều kiện. Khoảng đang lọc hiện thành chip trên đầu bảng, bấm × để bỏ. Số dòng và dòng tổng của nhóm tính theo khoảng đang lọc.
- Tự lưu vào view như mọi thiết lập khác (mục 5.2), trong `config.time_filter`.
- Server dịch thành cú pháp lọc của Module 0: `between` và toán tử ngày tương đối, theo giờ Việt Nam, tuần bắt đầu thứ Hai, quý theo cài đặt năm tài chính.
- API và MCP gửi `time_filter` cùng `filter`, hoặc dùng thẳng toán tử ngày trong `filter`.
- Cột ngày hay bị lọc được tự tạo index như mục 3.
- Dashboard đã có khoảng thời gian trong bộ lọc chung (Module 3 mục 8). Quản lý Deal có thanh chọn kỳ dùng chung (Module 4 mục 11a).

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

### 6.7 Tính lại theo phần, nhật ký thay đổi, đợi tính xong

*Chốt 18/11/2026, thay quyết định "tính lại cả cột khi nguồn đổi" của 2B. Lý do: chuẩn bị cho Automation (đọc đúng dòng đổi, không đọc số cũ) và để sửa một dòng nguồn không phải tính lại 100.000 dòng.*

**Tính lại theo phần.** Khi nguồn đổi, worker chỉ tính lại những dòng có thể bị ảnh hưởng:

| Loại phụ thuộc | Cách tìm dòng bị ảnh hưởng |
|---|---|
| Công thức chỉ dùng cột cùng dòng | Như 2B: tính ngay trong lúc lưu dòng |
| Liên kết, lookup, rollup | Tra ngược bằng **index GIN trên `dh_rows`** cho từng cột Liên kết (chỉ trên dòng của bảng đó, tạo khi thêm cột, bỏ khi xoá cột). Không có bảng nối riêng: ô Liên kết trong `dh_rows` là nguồn duy nhất |
| Hàm gom nhóm điều kiện bằng (`SUMIFS`, `COUNTIFS`, `XLOOKUP`…), phía dòng hiện tại là một cột | Lấy **khoá cũ và khoá mới** của các dòng nguồn vừa đổi (kể cả thêm, xoá, khôi phục); chỉ tính lại các nhóm đó và chỉ cập nhật dòng có khoá thuộc các nhóm đó |
| Chuỗi phụ thuộc (B đọc A) | Danh sách thay đổi của A là đầu vào thay đổi của B |
| Điều kiện có toán tử/ký tự đại diện, phía dòng hiện tại là biểu thức, duyệt từng dòng, tạo/sửa công thức, `TODAY()`/`NOW()`, đổi kiểu cột, import lớn | Tính cả cột |

- Phần bị ảnh hưởng vượt khoảng 20% số dòng của bảng thì tính cả cột (rẻ hơn).
- Hàm tổng cả cột không điều kiện tính một lần nhưng mọi dòng đổi theo; con số chung của cả bảng nên đặt ở Metric (Module 3). Thư viện công thức mẫu (2C) hướng dẫn tạo cột trung gian `[Mã]&"-"&[Năm]` thay cho biểu thức ở phía dòng hiện tại.
- Thay đổi chờ tính được **cộng dồn** vào một hàng đợi (một bảng dùng chung cho cả hệ thống, tính xong thì xoá); một cột chỉ chạy một lần cho cả đợt.
- Worker tính **song song** nhiều cột độc lập (mặc định 2, Admin chỉnh trong cài đặt, tối đa 4); cột phụ thuộc nhau vẫn theo thứ tự.
- Ô có giá trị không đổi thì không ghi và không phát sự kiện, dù tính theo phần hay cả cột.

**Nhật ký thay đổi.** Mỗi lần tính lại phát sự kiện kèm danh sách `dòng, cột, giá trị cũ → mới` (giá trị hoặc mã lỗi). Nhiều dòng thì chia thành nhiều sự kiện, mỗi sự kiện tối đa 500 dòng; không có trường hợp "tải lại cả bảng" không kèm danh sách. Đây là sự kiện cho bên nghe (Automation, SSE, cột phụ thuộc), **không** phải lịch sử dòng: luật "thay đổi do công thức không sinh log" giữ nguyên. SSE của grid dùng chung nguồn này.

**Đợi tính xong.** Mỗi lần ghi dữ liệu nguồn nhận một **số thứ tự thay đổi** tăng dần trên toàn hệ thống (trả về trong kết quả ghi). Mỗi cột tính toán nhớ đã tính tới số nào. Ai cần số chắc chắn mới thì đợi tới số đó rồi mới đọc, có giới hạn thời gian chờ:
- API/MCP đọc dòng: tuỳ chọn `consistent_after=<số>` (hoặc `consistent=true` = số mới nhất lúc gọi); hết thời gian chờ thì trả giá trị hiện có kèm cờ `stale` và các cột chưa xong.
- Automation (sau này) đợi các cột nó đọc tính xong trước khi xét điều kiện.
- Trạng thái "đang tính" hiện được **theo ô**: dòng nằm trong hàng đợi của cột đó.

**Lưới an toàn.**
- Test so sánh: nhiều nghìn lần sửa ngẫu nhiên, sau mỗi lần kết quả tính theo phần phải giống hệt tính cả cột.
- Job đối soát hằng đêm: tính lại cả cột cho một phần các bảng, so với giá trị đang lưu. Lệch thì ghi giá trị đúng và **báo lỗi cho Admin** (số ô lệch, cột nào). Lệch là bug phải sửa tận gốc; job không dùng để che bug.

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

### Stage 2B (công thức và cột tính toán)

Phạm vi 2B: engine công thức (`packages/formula`), các cột `formula`, `relation`, `lookup`, `rollup`, tính lại, API xem trước và danh mục hàm. Chưa có giao diện trình soạn (2C), chưa import công thức (2D), chưa có Bảng gộp (Stage 3).

**Engine (`packages/formula`)**
- TypeScript thuần, không phụ thuộc Node, chạy ở trình duyệt (xem trước) và server (giá trị chính thức). Gồm lexer, parser (có vị trí ký tự cho từng lỗi), suy kiểu tĩnh, danh mục hàm, bộ chạy, phân tích phụ thuộc.
- **Dạng lưu**: `config.expr` bỏ dấu `=` đầu, tham chiếu đổi thành mã: `{c_ab12cd34}` (ô cùng dòng), `{<uuid bảng>.c_ab12cd34}` (cả cột của một bảng, kể cả bảng này). Hiển thị lại theo tên hiện tại (đổi tên cột/bảng/datahub không làm hỏng công thức); mã trỏ tới thứ đã xoá hiện `[#REF!]`. Cách bố cục của người gõ (xuống dòng, khoảng trắng) được giữ. Vị trí lỗi cú pháp, tên hàm, số đối số tính trên chính văn bản người gõ.
- **Ngày là số** như Excel (ngày 1899-12-30 = 0, giờ Việt Nam), kiểu kết quả được suy tĩnh nên cột ngày lưu lại `YYYY-MM-DD`. Chữ dạng `dd/mm/yyyy` hoặc `yyyy-mm-dd` được ép thành ngày khi tính toán (như Excel, file mẫu cần: `DATEDIF(TODAY(),"31/12/2025","D")`).
- **Kiểu kết quả** (`config.result_type`): `number`, `percent`, `text`, `date`, `datetime`, `checkbox`. Tự suy; người dùng ghi đè được khi lưu. Hai nhánh khác kiểu thì kết quả là chữ (`mixed`), nhưng chuỗi rỗng `""` không quyết định kiểu (`IFERROR(a/b, "")` vẫn là cột số, ô lỗi thành ô trống). Không có `currency`, `rating`, lựa chọn làm kiểu kết quả: dùng `display` (đơn vị, số lẻ) cho tiền. *Quy tắc hai nhánh khác kiểu: Dương đồng ý 18/11/2026.*
- **106 hàm** (design nói khoảng 100): đủ các hàm của mục 6.2, thêm `CONCATENATE`, `REPT`, `EXACT`, `LN`, `SIGN`, `TRUNC`, `HOUR`, `MINUTE`. Mỗi hàm có nhóm, cú pháp, mô tả tiếng Việt, một ví dụ và kết quả ví dụ (`FUNCTION_CATALOG`, test kiểm mọi ví dụ parse được).
- Tra cứu theo **cột** vì không có ô: `VLOOKUP(giá_trị, cột_tìm, cột_kết_quả, [gần_đúng])`, `INDEX(cột, n)`, `MATCH(giá_trị, cột, [kiểu])`. Toán tử áp lên cả cột chạy từng phần tử (như công thức mảng), nên `SUMPRODUCT(([Bảng].[Loại]="x")*[Bảng].[Tiền])` và `FILTER` hoạt động. Hàm trả danh sách (`FILTER`, `UNIQUE`, `SORT`) mà là kết quả cuối thì được nối bằng ", ".
- **Điều kiện kiểu Excel** (`COUNTIFS`...): `"="`, `">="`, `"<>"`, ký tự đại diện `*` `?` `~`; chữ không phân biệt hoa thường, **có phân biệt dấu**; chữ dạng số bằng số đó; ô điều kiện trống tính là 0 (như Excel); lỗi thì lỗi. `XLOOKUP` với kiểu khớp mặc định coi `*` là chữ thường.
- Lỗi: `#DIV/0!`, `#N/A`, `#VALUE!`, `#REF!`, `#CYCLE!`, `#PERM!`, thêm `#NAME?` (tên hàm lạ) và `#NUM!`.

**Lưu giá trị**
- Giá trị lưu ở `data[mã cột]`. **Lỗi của ô lưu riêng ở khoá `!<mã cột>`** (giá trị bị xoá), để lọc và sắp xếp theo số/ngày không bao giờ gặp chữ `#DIV/0!`. API trả mã lỗi thay cho giá trị (cả khi chọn `fields=`); view SQL xuất hiện ô lỗi là NULL.
- Cột tính toán lọc, sắp xếp, đánh index theo kiểu kết quả của nó. Không có `unique`, `required`, giá trị mặc định. Không vào ô tìm kiếm toàn bảng.
- Trạng thái tính nằm ở **cột** (`dh_columns.calc_status`: `ready` / `pending` / `running`, `calc_done`, `calc_total`, `calc_at`, `calc_volatile`), API cột trả `calc`. "Đang tính" hiện cho cả cột, không theo từng ô. Bảng phụ thuộc `dh_formula_deps` (cột tính toán đọc gì: `cell` = cột cùng dòng, `range` = cả cột của một bảng) phục vụ kiểm tra vòng lặp và tính lại.
- Người không phải chủ datahub (được chia sẻ) chỉ thấy giá trị và kiểu kết quả; văn bản công thức và tên bảng đích không hiện (khỏi lộ tên bảng họ không được xem). *Dương đồng ý 18/11/2026.*

**Tính lại**
- **Công thức chỉ đọc cột cùng dòng**: API tính trong giao dịch lưu dòng (`row-formulas.ts`), theo thứ tự phụ thuộc, nên giá trị có ngay. Không vào lịch sử dòng (kể cả khi xoá dòng); tên cột công thức đổi giá trị được thêm vào `columns` của sự kiện dòng để cột ở bảng khác tính tiếp.
- **Công thức đọc bảng khác, lookup, rollup**: worker tính. Bộ nghe outbox `datahub.formula` đánh dấu `pending` các cột bị ảnh hưởng (đổi dòng nguồn, thêm/xoá/khôi phục dòng, cột/bảng/datahub xoá hoặc khôi phục, đổi chủ, đổi kiểu cột); vòng lặp trong worker (`startRecalcLoop`, chu kỳ `WORKER_OUTBOX_POLL_MS`) nhận từng cột đang chờ, tính **cả cột**, ghi từng lô 2.000 dòng, báo tiến độ. Nhiều thay đổi liên tiếp được gộp (một cột `pending` chỉ tính một lần). Cột A đang chờ mà cột B đọc A cũng đang chờ thì B đợi A xong (đúng thứ tự phụ thuộc). Dòng mới tạo có ô công thức liên bảng trống cho đến khi worker tính xong (vài giây).
- Mỗi lần ghi chỉ thay **hai khoá của cột đó** (`data - [khoá, !khoá] || {...}`) trên dữ liệu hiện tại của dòng, nên không đè sửa tay đồng thời; ô không đổi giá trị thì bỏ qua; **không** lịch sử dòng, không nhật ký, không đổi `version` và `updated_at`. Cuối mỗi lần tính phát `datahub.formula.recalculated` (`state: pending|done`, số dòng đổi, tối đa 500 mã dòng hoặc null) tới người nhìn thấy bảng, và là thứ kích hoạt cột phụ thuộc (khi có dòng đổi).
- **`TODAY()`**: job `datahub-formula-today` 00:05 giờ Việt Nam; **`NOW()`**: job `datahub-formula-now` mỗi giờ. Cả hai gọi `markVolatilePending`: đánh dấu cột có `calc_at` cũ hơn mốc đáng ra đã tính (00:05 gần nhất / đầu giờ gần nhất). Worker khởi động cũng gọi nó (**chạy bù**) và đưa các cột còn `running` do sập máy về `pending`. `calc_at` là thời điểm dùng để tính, không phải giờ ghi.
- Lỗi khi tính một cột: ghi log, nhả cột (`ready`), không chặn các cột khác.

**Kiểm tra khi lưu cột** (`computed.ts`, dùng chung với API xem trước)
- Chỉ **chủ** datahub tạo/sửa cột tính toán. Tên bảng/datahub chỉ tìm trong **datahub chưa xoá do chính chủ sở hữu**; datahub người khác (kể cả đã chia sẻ) không tìm thấy, thông báo nhắc `#PERM!`. Lúc tính, bảng không còn cùng chủ (ví dụ sau chuyển giao) cho `#PERM!`, bảng/cột đã xoá cho `#REF!`.
- **Vòng lặp** bị chặn bằng tìm đường đi trong đồ thị phụ thuộc của cả bộ datahub của chủ, kể cả cạnh lookup/rollup; thông báo nêu đường đi `[Bảng].[Cột] → ...`. Công thức tự đọc chính cột mình cũng là vòng.
- **Ngưỡng 20.000 dòng**: lời gọi không gom nhóm được bằng SQL (điều kiện `>=`, ký tự đại diện, regex, `MATCH` gần đúng, `FILTER`... trên cột của bảng khác) phải duyệt từng dòng nên bảng nguồn > 20.000 dòng bị từ chối ngay khi lưu (`details.code = scan_too_large`); lúc tính, bảng đã phình quá ngưỡng cho `#VALUE!`.
- **Gom nhóm SQL** (mục 6.6): `COUNTIFS`, `COUNTIF`, `SUMIFS`, `SUMIF`, `AVERAGEIFS`, `AVERAGEIF`, `MINIFS`, `MAXIFS` với điều kiện bằng; `XLOOKUP` (khớp đúng, tìm từ đầu), `VLOOKUP` (không gần đúng), `INDEX(…, MATCH(…, 0))`; và `SUM`/`COUNT`/`COUNTA`/`AVERAGE`/`MIN`/`MAX` cả một cột. Điều kiện là chữ có toán tử/ký tự đại diện, hoặc vùng điều kiện nằm trong biểu thức thì không gom nhóm (đi đường duyệt từng dòng). Mỗi lời gọi gom nhóm = **một câu `GROUP BY` cho cả cột** (`buildPlan`), kết quả nạp vào bảng băm để từng dòng tra; giá trị điều kiện của một dòng mà hoá ra có toán tử/ký tự đại diện (đến từ ô) thì dòng đó quay về đường duyệt (nếu bảng nhỏ) hoặc `#VALUE!`. Khoá nhóm dùng chung hàm `equalityKey` với đường duyệt nên hai đường cho kết quả giống nhau (test `datahub-formulas-grouped.test.ts` so 22 cặp công thức). Chỉ gom nhóm theo cột lưu trong `data` kiểu chữ, số, ngày, ngày giờ, checkbox, một lựa chọn, người dùng.
- **Lỗi trong cột nguồn truyền đi như Excel** (cùng quy tắc ở SQL gom nhóm và ở đường duyệt từng dòng, có test tương đương): nếu một dòng **khớp điều kiện** có ô giá trị (cột cộng/trung bình/min/max, cột kết quả của lookup) đang lỗi thì kết quả là lỗi đó (lỗi của dòng có `row_no` nhỏ nhất); dòng không khớp không ảnh hưởng. SQL gom nhóm mang theo cờ lỗi và mã lỗi đầu tiên theo `row_no` của mỗi nhóm. Lỗi nằm ở cột **điều kiện** thì dòng đó chỉ không khớp điều kiện bằng. `COUNT` không đếm ô lỗi, `COUNTA` có đếm; rollup count/counta/countunique cũng vậy, các rollup còn lại (sum, avg, min, max, concat) trả lỗi đầu tiên. `XLOOKUP`/`VLOOKUP`/`INDEX…MATCH` trả về ô đang lỗi thì trả lỗi đó. `LEFT`/`MID`... trên ngày lấy chữ số của số ngày (đúng Excel, xem golden test).

**Cột liên kết**
- `relation`: giá trị ô là **mảng mã dòng** của bảng đích (một dòng hay nhiều tuỳ `multiple`). Bảng đích phải thuộc datahub của cùng chủ; mã dòng phải là dòng chưa xoá của bảng đích (kiểm tra mỗi lần ghi). **Chỉ chủ** datahub ghi được ô liên kết (người được chia sẻ quyền Sửa không ghi được: tránh biết/ghi mã dòng của bảng họ không xem được). *Ngoại lệ của quyền Sửa dữ liệu, Dương đồng ý 18/11/2026.* Không đổi được bảng đích của cột có sẵn.
- `lookup` (`{relation, target_column}`): giá trị cột đích của dòng được liên kết; liên kết một dòng thì kiểu của cột đích, liên kết nhiều dòng thì chữ nối bằng ", ". `rollup` (`{relation, target_column, fn}`, `fn` = sum, count, counta, avg, min, max, countunique, concat): sum/avg cần cột số, min/max cột số hoặc ngày. Lookup/rollup do worker tính.

**API**
- `datahub.formula.functions` (GET `/datahub/formula-functions`): danh mục hàm + mã lỗi.
- `datahub.formula.preview` (POST `/tables/:table_id/formula/preview`, chỉ chủ): `ok`, `errors[{message,start,end}]`, `formula` (tên hiện tại), `result_type`, `volatile`, `reads` (cột/bảng đọc, số lời gọi gom nhóm, bảng phải duyệt), `rows` (5 dòng đầu: giá trị hoặc mã lỗi + câu giải thích). Công thức sai trả `ok: false` chứ không lỗi HTTP. Dùng đúng mã kiểm tra của lúc lưu.
- `datahub.column.create|update` nhận `config.formula` (công thức), `config.result_type` (tuỳ chọn); `GET table` và cột trả `config.formula` (có `=`), `calc`.

**Lệch hoặc bổ sung so với thiết kế**
- Thiết kế nói "ô đang chờ hiện biểu tượng đang tính": làm ở mức **cột** (`calc.status`), không theo ô. Mục 6.7 chuyển sang theo ô (bước 2B+).
- Thiết kế nói "hàm khoảng 100": 106 hàm. `VLOOKUP`, `INDEX`, `MATCH` theo cột, không theo vùng ô.
- Cột tính toán tính lại **cả cột** khi nguồn đổi (có gộp), không tính riêng những dòng bị ảnh hưởng. Đủ nhanh ở 100.000 dòng (số đo bên dưới); nếu sau này cần thì thêm tính theo dòng. **Đã thay bằng mục 6.7 (chốt 18/11/2026), làm ở bước 2B+.**
- Không có lệch nào với quy định đã chốt trong CLAUDE.md.

**Golden test** (`apps/api/test/formula-golden.test.ts`, đọc thẳng file mẫu, bỏ qua khi máy không có file)
- 3.322 công thức của 6 sheet (`Raw PODPS`, `Index`, `Cumulative Index`, `Plan 2024 -2025`, `Phân tích PS`, `BC-ML Com Policy`) đều parse và chạy; 3.321 khớp giá trị Excel đã lưu trong file, 1 công thức `TODAY()` chỉ kiểm parse và chạy. Hàm file dùng: COUNTIFS, SUMIFS, DATEDIF, IFS, IFERROR, IF, EOMONTH, EDATE, ROUNDUP, ROUNDDOWN, ROUND, MOD, LEFT, SUM, TODAY.
- Adapter chỉ có trong test (A1/bảng Excel sang tham chiếu của engine, lấy giá trị đã lưu từ XML của file). Việc dịch công thức Excel khi import là của 2D.
- Hai điểm của file mẫu: (1) giá trị đã lưu cho `IFERROR(IF(MOD(LEFT($A3,2),3)=0, ...` (324 công thức) dựa vào chữ hiển thị `MM/yyyy` của ô ngày, trong khi Excel và engine lấy `LEFT` của số ngày; adapter viết lại thành `TEXT(ngày,"mm")` để kiểm phần còn lại. Khi import (2D) cần cảnh báo kiểu công thức này. (2) File lưu lỗi dưới dạng chữ (`t="str"` "#DIV/0!"); adapter coi đó là lỗi.
- Sheet `Deals` không có dòng dữ liệu nên Index đều bằng 0; test thứ hai kiểm `COUNTIFS`/`SUMIFS` kiểu Index trên dòng deal tự tạo (không lấy từ file).

**Đo tốc độ** (`apps/api/test/datahub-formulas-perf.test.ts`, 100.000 dòng nguồn x 100.000 dòng đích, máy dev)
- Tính lại cả cột 100.000 dòng: SUMIFS 1,76 s, COUNTIFS hai điều kiện 2,33 s, XLOOKUP 2,08 s, AVERAGEIFS 1,97 s, MAXIFS trên ngày 2,34 s, SUMIFS/COUNTIFS gộp 2,52 s. Sửa một dòng nguồn thì 6 cột phụ thuộc tính lại trong 3,95 s.


### Stage 2B+ (tính lại theo phần, sự kiện, đợi tính xong, đối soát)

Làm theo mục 6.7. Ghi lại chi tiết khi code; không đổi quy định đã chốt.

**Hàng đợi và tính theo phần** (`change-queue.ts`, `partial.ts`, `recalc.ts`; migration `0007`)
- Một bảng `dh_change_queue` cho cả hệ thống, một dòng mỗi lần ghi cho mỗi cột bị ảnh hưởng. `mode`: `rows` (dòng của chính bảng), `linked` (dòng của bảng đích Liên kết, tra ngược bằng index GIN rồi mới ra dòng của bảng này), `keys` (khoá nhóm cũ và mới của dòng nguồn), `full` (cả cột). Ghi vào hàng đợi nằm **trong giao dịch ghi dòng**, nên ghi đã commit thì chắc chắn có mục trong hàng đợi.
- `touchColumns` khoá các cột theo thứ tự id rồi đặt `pending` + `calc_requested_at`; nhờ vậy mục ghi trong lúc cột đang chạy không bao giờ mất (cột chạy xong thấy `calc_requested_at` mới hơn mốc nhận việc thì quay lại `pending`).
- Worker nhận **cả đợt** của một cột, tính chỉ các dòng được nêu, rồi trong MỘT giao dịch: xoá đúng các mục đã đọc, nhả cột, ghi `calc_seq`, xếp mục cho cột đọc cột này (chuỗi, mang theo `cũ → mới`) và phát sự kiện `done`. Vượt `PARTIAL_MAX_RATIO` = 20% số dòng của bảng, hoặc có mục `full`, hoặc quá `CHAIN_LIMIT` = 5.000 thay đổi thì tính cả cột.
- Nhóm khoá chỉ theo cột kiểu chữ/số/ngày (`keyFamily`); khoá kiểu khác (lựa chọn, ngày giờ, checkbox) tính cả cột. Hàm SQL `soe_eqk` là bản SQL của `equalityKey`.
- Công thức chỉ đọc cột cùng dòng vẫn do API tính trong giao dịch ghi (như 2B), không qua hàng đợi.

**Sự kiện và song song**
- `datahub.formula.recalculated`: `pending` (khi đánh dấu), `changed` (mỗi lô tối đa `EVENT_ROWS` = 500 phần tử `row_id, column, old, new`; giá trị hoặc `{error: "#DIV/0!"}`; ô không đổi thì không có phần tử), `done` (tổng số dòng đổi, không có danh sách vì danh sách đã đi qua các sự kiện `changed`). Lô `changed` được ghi vào outbox trong **cùng giao dịch** với lô ghi giá trị. Không có sự kiện "tải lại cả bảng".
- SSE dùng chung sự kiện này nhưng chỉ phát **tín hiệu** (không có giá trị, như mọi tín hiệu SSE: `core/subscribers.ts`); người nghe cần giá trị (Automation) đọc outbox. Người nhận SSE = người nhìn thấy bảng.
- Song song: `processPendingColumns` chạy `datahub.recalc_parallel` làn (mặc định 2, 1–4, Admin chỉnh trong Cài đặt hệ thống; trang Cài đặt đọc từ catalog nên không cần giao diện riêng). Một làn chỉ nhận cột mà các cột nó đọc đã `ready` (`claimNext`), nên chuỗi A→B giữ thứ tự dù nhiều làn.

**Số thứ tự thay đổi và đợi tính xong** (`consistency.ts`, `rows-read.ts`, `row-ops.ts`)
- Sequence `dh_change_seq`. Mọi lệnh ghi dòng trả **`seq`**: `row.create|update|restore` (trường `seq` cạnh các trường của dòng), `row.delete` và `row.upsert` (`seq`), `row.batch` (`seq` ở ngoài và trong từng phần tử `results`; cả lô một số). `calc_seq` của cột (`calc.seq` trong API cột) = số cao nhất cột đã tính tới.
- **"Xong tới số S"** của một cột tính toán = không còn mục hàng đợi `seq <= S` ở cột đó **và ở mọi cột nó đọc, kể cả gián tiếp** (đệ quy qua `dh_formula_deps`; chuỗi A→B: mục của B chỉ xuất hiện lúc A xong, nên chỉ xét B thì sai). Cột `pending`/`running` mà không có mục nào (làm mới `TODAY()`/`NOW()`) tính là chưa xong với mọi S. Lấy hàng đợi làm nguồn sự thật thay vì so `calc_seq >= S`, vì cột không bị lần ghi S đụng tới thì `calc_seq` không bao giờ lên tới S.
- `datahub.row.list` và `datahub.row.get` nhận `consistent_after=<số>` và `consistent=true` (= `currentChangeSeq` lúc gọi; cả hai thì lấy số lớn hơn). Đợi bằng vòng hỏi cách 25 ms tăng dần tới 250 ms. **Thời gian chờ tối đa mặc định 5.000 ms**, cài đặt `datahub.consistent_wait_ms` (0–60.000, Admin chỉnh). Hết giờ thì vẫn trả giá trị hiện có.
- Kết quả có `consistency: { seq, stale, columns }` chỉ khi người gọi xin tuỳ chọn: ở danh sách là trường cạnh `data`/`next_cursor` (cơ chế `listExtra` của registry, có trong OpenAPI), ở `row.get` là trường của dòng. `columns` là mã các cột chưa xong. Quyền không đổi: người không đọc được bảng nhận `not_found` dù có dùng tuỳ chọn; mã cột trả ra chứ không phải công thức.
- **"Đang tính" theo ô**: mỗi dòng trả về có trường `pending` (mảng mã cột) khi có ô đang tính; không có thì không có trường. Cách tính: cột có mục `full`, cột đang làm mới không có mục, hoặc cột có cột nguồn đang chờ → **mọi dòng** của trang (chưa biết dòng nào đổi); còn lại chỉ các dòng mà hàng đợi nêu (`rows`) hoặc suy ra được (`linked` qua GIN giới hạn trong các dòng của trang, `keys` qua `soe_eqk` giới hạn trong các dòng của trang). Khi có `fields=`, chỉ xét các cột được chọn. Mỗi lần đọc thêm 1–2 truy vấn nhẹ trên `dh_columns`/`dh_change_queue`.
- Thay đổi không qua `applyRowOps` (đổi cấu trúc, xoá/khôi phục cột hoặc bảng, chuyển giao; import ở 2D sẽ theo cách này) đánh dấu cột bằng `markPending` (mục `full` kèm số mới) nên cũng được đợi bằng `consistent=true`, nhưng không trả `seq` (không có lệnh ghi dòng nào để trả).

**Đối soát hằng đêm** (`reconcile.ts`, job `datahub-reconcile` 03:45 giờ Việt Nam; migration `0008` thêm `dh_columns.reconciled_at`)
- Lấy các cột tính toán **đang nghỉ** (`ready`, không có mục hàng đợi, không `TODAY()`/`NOW()` vì chúng đổi hợp lệ theo giờ), thứ tự `reconciled_at` cũ nhất trước (chưa từng đối soát = đầu tiên), tới khi hết **ngân sách 1.000.000 dòng** (tổng số dòng của bảng chứa cột; cột đầu tiên luôn được lấy dù lớn hơn ngân sách). Nhận việc giống worker rồi gọi `recalcColumn` tính **cả cột**; số ô `recalcColumn` phải ghi đổi = số ô lệch. Ghi đúng giá trị là lúc đó đã xong (không đổi `version`, không lịch sử).
- Nếu trong lúc đối soát cột bị ghi (`calc_requested_at` sau mốc nhận việc) thì **không phán xét** (giá trị vẫn được sửa vì tính từ dữ liệu hiện tại, nhưng chênh lệch có thể do lần ghi đó).
- Lệch: `logger.error`, một bản ghi audit `datahub.reconcile` (mã bảng, mã cột, số ô; không giá trị) và sự kiện `datahub.reconcile.mismatch` → thông báo trong ứng dụng cho **mọi Admin** đang hoạt động (số ô, tên cột; không giá trị, không tên bảng, không công thức). Kết quả tính lại của cột đó đi tiếp theo đường thường (sự kiện `changed`, cột phụ thuộc).

**Test và số đo**
- `datahub-partial.test.ts` (chỉ dòng bị ảnh hưởng được tính: làm hỏng tay một ô ở dòng không liên quan, nó phải còn hỏng), `datahub-partial-equivalence.test.ts` (2.500 lần sửa ngẫu nhiên, tính theo phần giống hệt tính cả cột; đổi bằng biến `DH_EQUIV_EDITS`), `datahub-events.test.ts`, `datahub-consistency.test.ts`, `datahub-reconcile.test.ts`, `datahub-queue.test.ts`.
- Sửa một dòng nguồn (đổi cả khoá, số tiền, loại, ngày) ở bảng 100.000 dòng, 6 cột phụ thuộc: ghi 9 ms, worker tính lại 6 cột **43 ms** (trước 2B+: 3,95 s), giao hết sự kiện 0,05 s. Tính lại cả cột 100.000 x 100.000: 2,1–2,7 s mỗi hàm.

**Lệch hoặc bổ sung so với thiết kế**
- Thiết kế nói "mỗi cột nhớ đã tính tới số nào" và đợi theo đó; làm thêm điều kiện đệ quy qua cột nguồn và lấy hàng đợi làm nguồn sự thật (giải thích ở trên). Không đổi hành vi thiết kế mô tả.
- `row.create|update|restore` trả `seq` ngay trong đối tượng dòng (không bọc thêm lớp) để các client cũ không vỡ.

### Stage 2C-1 (danh sách datahub, bảng, grid, sửa dữ liệu, chi tiết dòng, SSE)

Làm theo mục 5.2, 7, 13. Phần 2C-2 (thanh công cụ view), 2C-3 (quản lý cột, công thức), 2C-4 (tìm trùng, chia sẻ, thùng rác, giới hạn Admin) chưa làm; chỗ cắm: `data-slot="view-tools"` trong thanh công cụ của `table-view.tsx`, `TableSession` nhận `query` (lọc, sắp xếp, tìm) khi tạo.

**Thư viện và nền chung**
- Glide Data Grid 6.0.3 (kèm `lodash`, `marked@4`, `react-responsive-carousel`, vì gói khai báo là peer), `sonner` (toast), Radix (dialog, dropdown-menu, tooltip), `@fontsource/be-vietnam-pro`, `@fontsource/roboto`. Phiên bản cố định. Glide khai báo peer React tới 18; chạy được với React 19.3 trong thử nghiệm, nhưng cây truy cập (bảng ẩn cho trình đọc màn hình) không dựng được. Xem "Câu hỏi còn mở".
- Bộ định dạng `vi-VN` dùng chung ở `packages/shared/src/format.ts` (`formatNumber`, `formatCurrency`, `formatPercent`, `formatDate`, `formatDateTime`, `formatRelative`, `formatCount`, hằng `EMPTY = "—"`), có test. Số bỏ nhiễu dấu phẩy động (`0,1 + 0,2` hiện `0,3`), làm tròn nửa ra xa 0 như Excel, không bao giờ hiện `-0`. Ngày chỉ có ngày (`2026-11-18`) hiện nguyên, không đổi múi giờ; mốc thời gian hiện theo giờ Việt Nam. Đọc được cả dạng chuỗi thời gian của Postgres (`2026-11-19 05:14:52.69+07`) mà API đang trả cho `created_at`/`updated_at`.
- Hàm đọc chữ gõ hoặc dán: `parseLocaleNumber` (`156,000,000`, `156.000.000`, `1.234.567,5`, `1,5`, `12.5`; một nhóm đơn như `1.234` là số thập phân, `1,234` là hàng nghìn, khớp với API), `parseLocaleDate`, `parseLocaleDateTime`.
- Font: Be Vietnam Pro (400/500/600/700) tự host; `SoE Number` là chữ số của Roboto qua `unicode-range`, xếp trước. Canvas của grid dùng cùng họ font và đợi font tải xong mới vẽ (`fontsReady`).
- Token mới trong `index.css`: `--ring`, `--selected`, `--calc` (dấu "đang tính"), chín màu nền lựa chọn `--opt-*`. Màu trong canvas lấy từ token qua `lib/theme.ts` (đổi sang `rgb`).
- Thành phần dùng chung mới ở `components/ui`: `skeleton`, `toast` (sonner), `tooltip`, `dropdown` (portal), `states` (rỗng, lỗi có "Thử lại", không có quyền). `Modal` đổi sang Radix Dialog (khoá focus, Esc, nút đóng bằng icon, `dirty` hỏi trước khi đóng); thêm `ConfirmDialog`; `Button` có `loading`, thu nhẹ khi bấm; `Tabs` có `role="tablist"`/`tab`. CSS nền theo CLAUDE.md (không tô khi chạm, `touch-action`, `100dvh`, `viewport-fit=cover`, `prefers-reduced-motion`).

**API thêm (có test phân quyền, OpenAPI, Bruno)**
- `datahub.people.lookup` (GET `/datahub/people`): đổi mã người thành tên (`ids`) hoặc tìm theo tên/email không dấu (`q`). Mọi người có quyền dùng Datahub gọi được; chỉ trả người trong org chart (id, họ tên, email).
- `datahub.relation.labels` (GET `/tables/:table_id/relation-labels`): tên hiển thị của các dòng được liên kết (cột chữ đầu tiên của bảng đích, không có thì `#<mã dòng>`). Người được chia sẻ bảng nguồn thấy tên này (là giá trị trong ô, theo mục 10) nhưng không mở được dòng ở bảng đích.
- `datahub.row.restore_batch` (POST `/tables/:table_id/rows/restore-batch`, tối đa 500): "Hoàn tác" sau khi xoá nhiều dòng. Cần quyền Sửa dữ liệu.

**Cách làm ở giao diện**
- Địa chỉ: `/datahub` (danh sách), `/datahub/:datahubId` (mở bảng đầu), `/datahub/:datahubId/:tableId`. Tham số `view` dành cho 2C-2.
- Danh sách: "Của tôi" và "Được chia sẻ với tôi" (kèm tên chủ và quyền); tạo, đổi tên, xoá vào thùng rác có "Hoàn tác"; hiện `đã dùng / giới hạn`. Tên kiểm tra theo luật mục 2 khi rời ô, lỗi từ server hiện dưới ô.
- Tab bảng: thêm, đổi tên, xoá có "Hoàn tác". **Đổi thứ tự bằng menu "Chuyển sang trái/phải"** (không kéo thả, để làm bằng bàn phím được); vì `position` của server chỉ là số, giao diện ghi lại `0..n-1` theo thứ tự mới.
- **Đọc dòng kiểu cuộn dần, không nhảy:** grid có chỗ cho đủ `total` dòng (đếm một lần ở trang đầu), nạp từng trang 200 dòng bằng con trỏ keyset, nạp tiếp khi cách cuối vùng đã tải dưới 40 dòng. Không có "nhảy tới dòng thứ 80.000" (keyset không cho truy cập ngẫu nhiên); kéo thanh cuộn xuống cuối thì nạp lần lượt các trang trung gian, ô chưa tải hiện trạng thái đang tải. Muốn tới một dòng ở xa thì lọc/sắp xếp/tìm (2C-2). Xem "Câu hỏi còn mở".
- Hiển thị: mọi giá trị qua `displayText` (`lib/datahub/cells.ts`), một chỗ duy nhất cho grid, bản sao chép (Ctrl+C), khung chi tiết, lịch sử. Số, tiền, phần trăm căn phải. Lựa chọn là chip màu, đánh giá là sao vẽ bằng canvas, checkbox của Glide. Cột Người dùng và Người tạo/sửa hiện họ tên (tra theo mã qua `people.lookup`, gom 200 mã một lần, hiện "…" tới khi có). Cột Liên kết hiện tên dòng đích. Cột Đính kèm hiện "N tệp". Cột Mã dòng hiện `#<số dòng>` (xem câu hỏi). Giá trị lỗi công thức (`#DIV/0!`...) chỉ nhận ra ở cột tính toán (ô chữ có nội dung `#N/A` vẫn là chữ), màu `bad`, tooltip giải thích bằng tiếng Việt.
- **"Đang tính":** ô nằm trong `pending` có vòng tròn nhỏ ở góc phải và tooltip "Đang tính lại giá trị này." Trong khi còn ô đang tính ở vùng đang xem, grid hỏi lại các dòng đó cách 2 giây (tối đa 30 lần) phòng khi lỡ tín hiệu SSE.
- **Sửa ô:** chữ, số, tiền, phần trăm, ngày, ngày giờ sửa ngay trong ô (gõ để mở); chọn một/nhiều lựa chọn, đánh giá, người dùng có ô chọn riêng (hiện trong cổng của trang vì Glide cắt khung sửa theo chiều cao ô); checkbox bấm là đổi. Cột công thức, lookup, rollup, số tự tăng, hệ thống chỉ đọc; cột liên kết và đính kèm chỉ xem, cả trong grid lẫn khung chi tiết (cần ô chọn dòng đích và tải file lên; làm ở các phần sau, ghi ở "Câu hỏi còn mở"). Người chỉ có quyền Xem: không có nút thêm/xoá/hoàn tác, ô không mở trình sửa, dán báo "Bạn chỉ có quyền xem bảng này"; server vẫn chặn.
- **Đọc chữ gõ/dán ở máy khách** (`parseCellText`): giúp `dd/mm/yyyy`, `156,000,000`, `1.234,5`, `25%` chạy được và báo đúng ô sai; server vẫn kiểm tra lại mọi kênh. Ở cột Phần trăm, số không có `%` là điểm phần trăm (`12,5` là 12,5%); API vẫn nhận phân số. Dán nhiều ô: một lỗi ở bất kỳ ô nào thì **không ghi gì** và báo dòng, cột đầu tiên sai kèm số ô lỗi còn lại. Một giá trị dán lên vùng đang chọn thì điền cả vùng. Dán xuống dưới dòng cuối thì tạo dòng mới. Dán vào ô công thức/hệ thống thì bỏ qua và báo số ô bỏ qua.
- **Ghi và xung đột:** mọi lần ghi gửi `base` (giá trị đã thấy), nên hai người sửa hai ô khác nhau của một dòng thì gộp; trùng ô thì server trả 409 và giao diện báo `Ô "Tên" ở dòng #3 vừa được người khác sửa. Đã tải giá trị mới, hãy sửa lại.` rồi nạp lại dòng đó, không ghi đè im lặng. Giá trị mới hiện ngay lúc gõ, server trả lời xong thì thay bằng giá trị server (kể cả công thức cùng dòng); lỗi thì trả về giá trị cũ.
- **Hoàn tác / làm lại** (nút và Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y; chỉ trong phiên mở bảng, tối đa 100 bước, mất khi đóng bảng): sửa ô và dán dựa vào `base` nên hoàn tác thất bại (409) nếu ô đã bị người khác sửa tiếp; lỗi thì xoá cả hai ngăn xếp. Thêm dòng hoàn tác bằng xoá, làm lại bằng `restore_batch`. Xoá dòng hoàn tác bằng `restore_batch` và đặt lại dòng đúng vị trí cũ. Đây là hoàn tác phía máy khách trên các lệnh ghi đã có, không đọc lịch sử dòng của server.
- **Xoá dòng:** chọn bằng số dòng bên trái (ô tick hiện khi chỉ vào, cũng bấm được trên cảm ứng), nút "Xoá N dòng" xoá ngay vào thùng rác, không hỏi lại, kèm toast "Hoàn tác" (CLAUDE.md: Hoàn tác thay cho hỏi lại). Phím Delete chỉ xoá nội dung các ô đang chọn.
- **Điền xuống:** kéo núm ở góc ô, hoặc chọn vùng rồi Ctrl+D (điền ngang bằng Ctrl+R để tắt vì trùng tải lại trang). **Sửa hàng loạt:** hộp thoại chọn một cột và một giá trị cho mọi dòng đã chọn.
- **Chi tiết dòng:** khung bên phải (toàn màn hình trên điện thoại): nút "Chi tiết dòng" hoặc Shift+Space. Tab "Dữ liệu": mọi cột, mỗi ô lưu khi rời ô (chữ, số: lỗi hiện ngay dưới ô); tab "Lịch sử thay đổi": ai, lúc nào (tương đối trong 7 ngày, tooltip ngày giờ đầy đủ), qua kênh nào, cũ → mới theo định dạng chung; tải thêm 30 mục một lần.
- **SSE:** `datahub.row.*` và `datahub.formula.recalculated` chỉ là tín hiệu (như thiết kế). Giao diện chờ 250 ms rồi hỏi lại **các dòng đang xem ±10 theo `_id`** và một lần đếm tổng; tổng đổi (người khác thêm/xoá dòng) hoặc có dòng biến mất thì đọc lại từ đầu tối đa 2.000 dòng đã tải. Không bao giờ tải cả bảng. `datahub.structure.changed` làm tải lại định nghĩa bảng và dựng lại phiên làm việc.
- Kích thước: ô 36px, tiêu đề 36px, số dòng ghi ở thanh công cụ: `N dòng`, hoặc `Đã tải X / N dòng` khi chưa tải hết.

**Test**
- `packages/shared/test/format.test.ts`, `apps/web/test/paste.test.ts` (vitest), `apps/api/test/datahub-lookup.test.ts`, `apps/web/e2e/stage2c1.spec.ts` (13 luồng, chạy ở 1280×800 và 375×812; đọc ô của canvas bằng bản sao chép, tìm ô bằng bố cục `data-*` của grid).

- Dữ liệu xấu nhất (`break-ui`) tạo ở tầng dữ liệu, qua API, trong fixture của e2e (`datahub` tên đúng 100 ký tự có `<b>` và `&amp;`, tên cột và tên bảng dài, chủ có tên rất dài, tiền 12.345.678.900 và âm, ghi chú dài, bảng rỗng, 1 dòng, 10.000 dòng); thử tay 100.000 dòng. Không có nút "Demo / Worst case" trong giao diện vì mọi dữ liệu của màn hình này đến từ server; "nút chuyển" chính là mở datahub dữ liệu xấu đã được chia sẻ.
- Đã rà `ui-ux-pro-max` mục 1–3 và 8 (nhãn, lỗi dưới ô và focus về ô lỗi, cỡ chạm 44px trên điện thoại, toast không cướp focus, lối tắt tới nội dung, tương phản bằng token), `break-ui` và bảng "Never Ship" của `mobile-native` (`100dvh`, hover chỉ khi có chuột, ô nhập 16px, vùng an toàn). **Chưa chạy `impeccable audit`** (để Opus khi rà soát) và **chưa thử trên máy thật**: chạm và giữ trong grid canvas, bàn phím ảo che khung chọn, cuộn bằng cảm ứng.

**Lệch hoặc bổ sung so với thiết kế**
- Mục 5.2 (view tự lưu) và 7a chưa có giao diện (2C-2, 2C-4). Mục 7: hoàn tác/làm lại làm ở máy khách chứ không "dựa trên lịch sử dòng" của server (lịch sử dòng chỉ ghi cũ → mới theo cột, không có thao tác đảo ngược an toàn khi dòng đã đổi tiếp).
- Đổi thứ tự bảng bằng menu chứ không kéo thả (đã nêu ở trên).

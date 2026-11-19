# Module 7 — Dynamic Form

> Trạng thái: **Đã chốt** · 19/11/2026 (sau nhiều vòng phản biện trong ngày, xem mục 13)
> Phụ thuộc: [Module 0](module0-nen-tang.md) (registry, actor, file, endpoint công khai), [Module 1](module1-tai-khoan-phan-quyen.md) (chủ sở hữu, đối tượng chia sẻ), [Module 2](module2-datahub.md) (bảng, kiểu cột, kiểm tra giá trị, lịch sử dòng), [Module 3](module3-metric-dashboard.md) (biểu đồ tóm tắt phản hồi), [Module 4](module4-quan-ly-deal.md) (Form không ghi vào Quản lý Deal), [Module 5](module5-ket-noi-ai.md) (menu Form, tool `form_get`, `form_save`, `form_responses`), [Module 6](module6-thong-bao.md) (loại thông báo của Form).
> Để module sau: gắn bài test vào lộ trình, ai chấm bài của nhân sự onboard, số lần thi lại theo lộ trình (Module 9).

Nguồn: brief mục 7; `examples/Lộ trình onboard Dương.xlsx` (sheet **Đánh giá thử việc**: bài test ngưỡng ≥ 80/100, trượt được thi lại một lần, bảng chấm mockup theo tiêu chí có trọng số và điểm sàn; sheet **Bài thu hoạch on-job**: nhiều câu tự luận dài cho mỗi buổi; sheet **QnA**).

Một engine cho ba việc: **form quảng bá, khảo sát** (trang công khai đẹp như landing page), **bài kiểm tra** (chấm điểm), **phiếu chấm** (người chấm điền theo tiêu chí).

---

## 1. Form và bảng

### 1.1 Mỗi form ghi vào tối đa một bảng

- Form có câu cần lưu thì gắn với **một bảng Datahub của chính chủ form** (form chỉ để tra cứu thì không cần bảng, mục 2.3a). Mỗi lần gửi là **một dòng** của bảng đó.
- Ô nhập của form **là cột của bảng**: thêm một câu hỏi thì chọn cột có sẵn hoặc tạo cột mới ngay trong trình soạn. Kiểu cột quyết định kiểu ô nhập. Cách này giống Lark Form và có hai cái lợi: dữ liệu đã có kiểu chuẩn ngay từ lúc nhập, và xem, lọc, vẽ biểu đồ phản hồi bằng chính Datahub, không phải làm lại.
- Tạo form mới thì chọn: **tạo bảng mới** (mặc định, tên bảng = tên form, đặt trong datahub chủ chọn) hoặc **dùng bảng có sẵn**.
- Không chọn được làm đích:
  - Mọi bảng trong datahub **"Quản lý Deal"**. *Dương chốt 19/11/2026:* đây là datahub đặc thù của hệ thống, chỉ có bản chất là datahub, không coi như datahub thông thường; nó **không làm đích và không làm nguồn dữ liệu** của form (mục 2.5).
  - Bảng được người khác chia sẻ cho mình (form công khai không được ghi vào dữ liệu của người khác).
  - Bảng gộp (Module 3, chỉ đọc).
- Cột công thức, lookup, rollup, số tự tăng và cột hệ thống **không** làm ô nhập được. Chúng vẫn tự tính sau khi dòng được tạo.

### 1.1a Giới hạn cột của bảng có form

*Dương chốt 19/11/2026.*

- Bảng đang có ít nhất một form ghi vào được mở giới hạn lên **150 cột** (thay cho mức mặc định 70 của Module 2 mục 11). Bài test dài, bảng lựa chọn nhiều tiêu chí và các cột kết quả của bài kiểm tra cần chỗ này.
- Con số nằm trong **Cài đặt hệ thống** (`form.table_max_columns`, mặc định 150), Admin chỉnh được, không vượt **trần 200** của Module 2.
- Giới hạn áp dụng = số lớn hơn giữa giới hạn cột riêng của chủ bảng (Module 2) và cài đặt này, không bao giờ quá 200.
- Trình soạn hiện "Còn N câu hỏi được thêm" khi còn dưới 10 cột.
- Bảng không còn form nào ghi vào (form bị xoá hoặc chuyển sang bảng khác) thì quay về giới hạn thường. Cột đang có giữ nguyên, chỉ không thêm được cột mới cho tới khi xuống dưới giới hạn.

### 1.2 Khối không phải cột

Tiêu đề, đoạn chữ (Tiptap), ảnh, video nhúng (YouTube), đường kẻ, ngắt trang. Chỉ nằm trong cấu hình form, không tạo cột.

### 1.3 Khi bảng đổi cấu trúc

| Bảng đổi | Form xử lý |
|---|---|
| Đổi tên cột | Nhãn câu hỏi giữ nguyên (nhãn và tên cột tách riêng) |
| Đổi kiểu cột | Ô nhập đổi theo kiểu mới; trình soạn báo nếu cấu hình cũ không còn hợp (ví dụ đáp án đúng của câu lựa chọn) |
| Xoá cột | Câu hỏi bị tắt, form vẫn nhận phản hồi các câu còn lại; chủ nhận thông báo |
| Xoá bảng | Form **tạm dừng nhận phản hồi**; khôi phục bảng thì chạy lại |

## 2. Trình soạn

### 2.1 Bố cục

- Kéo thả bằng dnd-kit: thêm khối từ thanh bên trái, kéo đổi thứ tự, kéo vào **hàng nhiều cột** (tối đa 3 cột mỗi hàng; dưới 768px tự xếp thành 1 cột).
- **Trang:** ngắt trang tạo form nhiều bước có thanh tiến độ, nút Quay lại / Tiếp.
- **Giao diện như landing page:** ảnh bìa, logo, tiêu đề, mô tả có định dạng, màu nhấn chọn từ bảng màu có sẵn (không nhập mã màu tự do, để luôn đủ tương phản), độ rộng (hẹp / vừa / rộng). Font cố định Be Vietnam Pro.
- **Trang cảm ơn:** nội dung tuỳ chỉnh, hoặc chuyển tới một URL, nút "Gửi phản hồi khác".
- Mọi khối kéo thả đều có cách làm thay bằng nút "Lên / Xuống" và bàn phím (chuẩn giao diện).
- Xem trước ở bề ngang điện thoại và máy tính ngay trong trình soạn.

### 2.2 Tự lưu và xuất bản

- Trình soạn **tự lưu** mọi thay đổi vào **bản nháp** của form, không có nút "Lưu".
- Người điền chỉ thấy **bản đã xuất bản**. Bấm **"Xuất bản"** để đưa bản nháp ra ngoài; có nút "Bỏ thay đổi" để quay về bản đang chạy.
- Lý do tách: form đang nhận phản hồi mà sửa dở (xoá một câu, đổi đáp án) thì người đang điền thấy form chạy chập chờn, bài test bị chấm sai.
- Mỗi lần xuất bản lưu một **phiên bản**. Mỗi phản hồi ghi phiên bản đã dùng; bài test chấm theo đáp án của đúng phiên bản đó.
- Cột mới tạo trong trình soạn được tạo trong bảng **ngay** (để chọn kiểu, lựa chọn), kể cả trước khi xuất bản.
- Có thay đổi chưa xuất bản thì trình soạn hiện thanh "Có thay đổi chưa xuất bản" kèm nút Xuất bản. Xem trước luôn là bản nháp, có ghi rõ. Form chưa xuất bản lần nào chỉ có một nút "Xuất bản".

**Phiên bản là của form, không phải của cột.** Xuất bản lại **không bao giờ** tạo cột mới. Cột chỉ được tạo khi thêm một câu hỏi mới.

| Sửa trên câu hỏi đã xuất bản | Kết quả |
|---|---|
| Nhãn, mô tả, gợi ý, bắt buộc, điều kiện, vị trí | Cùng cột. Chỉ đổi cấu hình form |
| Đáp án đúng, số điểm | Cùng cột. Đáp án nằm trong phiên bản form: bài nộp **sau** khi xuất bản chấm theo đáp án mới; bài nộp **trước** giữ điểm cũ, muốn chấm lại thì bấm "Chấm lại theo đáp án mới" (mục 6.4) |
| Đổi tên lựa chọn | Cùng cột, cùng mã lựa chọn (Module 2): câu trả lời cũ hiện tên mới |
| Thêm lựa chọn | Thêm lựa chọn vào cột |
| Bỏ lựa chọn khỏi form | Lựa chọn chỉ bị ẩn trên form, **vẫn còn trong cột**, nên câu trả lời cũ không mất. Form hiện một phần các lựa chọn của cột |
| Đổi kiểu câu hỏi | Là đổi kiểu cột: theo luồng của Module 2 (xem trước, báo giá trị không chuyển được), cảnh báo ảnh hưởng tới phản hồi cũ |
| Xoá câu hỏi | Câu hỏi rời form. Cột và dữ liệu cũ **giữ nguyên** trong bảng; chủ tự xoá cột nếu muốn |

- Viết lại câu hỏi thành một ý khác hẳn (ví dụ "Bạn hài lòng không?" thành "Bạn có giới thiệu cho người khác không?") thì câu trả lời cũ và mới nằm chung một cột nhưng khác nghĩa. Hệ thống không tự đoán được việc này. Trình soạn có thao tác **"Tách thành câu hỏi mới"**: tạo cột mới cho câu này, cột cũ rời form và giữ dữ liệu. Mặc định vẫn là cùng cột.
- Bảng có cột hệ thống **Phiên bản form** để lọc phản hồi theo phiên bản khi cần.

### 2.3 Ô nhập

| Kiểu cột (Module 2) | Ô nhập trên form |
|---|---|
| Văn bản, Văn bản dài | Ô một dòng, ô nhiều dòng; giới hạn độ dài |
| Số, Tiền, Phần trăm | Ô số (bàn phím số trên điện thoại); nhỏ nhất, lớn nhất |
| Ngày, Ngày giờ | Ô ngày `dd/mm/yyyy` (như Module 1, không dùng ô ngày của trình duyệt) |
| Checkbox | Một ô tích, ví dụ "Tôi đồng ý…" |
| Đánh giá | Sao 1–5 hoặc 1–10 |
| Một lựa chọn | Nút chọn (≤ 6 lựa chọn) hoặc danh sách thả xuống; tuỳ chọn "Khác: …" |
| Nhiều lựa chọn | Ô tích; giới hạn số lựa chọn |
| Email, Điện thoại, URL | Ô đúng loại (`type="email"`, `inputmode="tel"`…); có thể giới hạn tên miền email |
| Đính kèm | Tải file (giới hạn ở mục 5.4) |
| Người dùng | Chọn người trong hệ thống. **Chỉ form nội bộ** |
| Liên kết dòng | Chọn dòng của bảng đích. **Chỉ form nội bộ**, chỉ người điền là chủ bảng (cùng luật ô Liên kết của Module 2) |

Thêm hai dạng chỉ có trên form:

- **Thang điểm** (ví dụ 1–5 có nhãn hai đầu "Rất kém" / "Rất tốt") → cột Số.
- **Bảng lựa chọn** (mỗi dòng là một tiêu chí, chọn một mức cho từng dòng) → mỗi dòng là một cột Một lựa chọn. Đây là dạng của phiếu chấm mockup.

Mỗi câu hỏi có: nhãn, mô tả, bắt buộc, giá trị mặc định, gợi ý. Server kiểm tra giá trị theo kiểu cột như mọi kênh (Module 2 mục 4).

### 2.3a Nối câu hỏi với cột

*Dương chốt 19/11/2026.*

- Bấm **"Nối cột"** trên một câu hỏi thì có hai lựa chọn:
  - **Chọn cột chưa nối:** chỉ liệt kê cột của bảng đích **chưa nối với câu hỏi nào khác của form này** và **có kiểu hợp** với câu hỏi (câu trắc nghiệm một đáp án chỉ thấy cột Một lựa chọn…). Cột đã nối với form khác cùng bảng vẫn chọn được (nhiều form ghi chung một bảng).
  - **Tạo cột mới:** tên cột **lấy theo nội dung câu hỏi** lúc đó, ví dụ câu "Nhu cầu của bạn" tạo cột `Nhu cầu của bạn`. Người dùng sửa được tên trước khi bấm tạo.
- Tên cột chỉ lấy theo câu hỏi **lần đầu**. Sau đó đổi nội dung câu hỏi **không** đổi tên cột (nhãn và tên cột tách riêng, mục 1.3), để không làm lệch tên cột mà công thức, view, dashboard đang thấy. Ngăn thuộc tính có nút "Đặt tên cột theo câu hỏi" khi muốn đồng bộ lại.
- Tên lấy từ câu hỏi được làm sạch theo luật tên của Module 2: bỏ `[` `]`, cắt còn 100 ký tự ở ranh giới từ; trùng tên cột có sẵn (không phân biệt hoa thường) thì thêm ` (2)`, ` (3)`…; câu hỏi chưa có nội dung thì đặt `Câu hỏi <số thứ tự>`.
- Câu lựa chọn: tạo cột mới thì chép các lựa chọn của câu hỏi sang cột. Nối vào cột có sẵn mà câu hỏi có lựa chọn cột chưa có thì hỏi "Thêm 2 lựa chọn vào cột?" trước khi nối.
- Bảng lựa chọn: mỗi dòng tiêu chí tạo một cột, tên `<câu hỏi> – <tiêu chí>`.
- Câu hỏi chưa nối cột thì chưa xuất bản được, trừ câu đánh dấu **"Chỉ dùng cho nguồn dữ liệu, không lưu"** (mục 2.5). Bấm Xuất bản khi còn câu chưa nối thì hiện "Còn 3 câu chưa nối cột" kèm nút **"Tạo cột mới cho 3 câu"** (đặt tên theo đúng luật trên).
- Form không có câu nào cần lưu (chỉ hiển thị, tra cứu) thì **không cần bảng đích**.

### 2.3b Ràng buộc của bảng

*Dương chốt 19/11/2026.* Form ghi vào bảng nên phải tôn trọng ràng buộc của cột (Module 2 mục 4). Ba lỗi hay gặp khi dùng form gắn bảng:

- **Cột Bắt buộc:** cột bắt buộc của bảng mà form không có câu nối vào, hoặc có nhưng câu đó có thể bị điều kiện ẩn, thì mọi lượt gửi sẽ lỗi. Trình soạn **chặn xuất bản** và nói rõ: "Cột Email là bắt buộc trong bảng nhưng form chưa có câu này". Câu nối với cột bắt buộc tự thành câu bắt buộc.
- **Cột Duy nhất:** trùng giá trị thì báo ngay dưới ô bằng câu dễ hiểu do chủ đặt (mặc định "Email này đã được dùng để gửi form"), giữ nguyên mọi câu trả lời khác. Với form công khai, **chỉ kiểm tra trùng khi gửi**, không kiểm tra lúc rời ô: kiểm lúc rời ô thì người lạ gõ thử từng email là biết email nào đã có trong bảng. Form nội bộ kiểm lúc rời ô được.
- **Giá trị mặc định:** cột có giá trị mặc định mà không có trong form thì dòng tạo từ form vẫn nhận giá trị đó, giống nhập tay ở bảng. Ngăn thuộc tính của form liệt kê "Cột sẽ tự điền: Trạng thái = Mới".

**Điền sẵn qua link** (*Dương chốt 19/11/2026*):

- Câu đang hiện: link mang giá trị điền sẵn, ví dụ `/f/<mã>?cong_ty=Thuận%20Phát`. Người điền **sửa được**. Dùng cho khảo sát sau showcase đã điền sẵn tên công ty.
- **Trường ẩn:** người điền không thấy, không sửa; giá trị lấy từ link (`?nguon=facebook`) và **luôn được ghi vào cột** khi gửi (Airtable từng bỏ sót giá trị của trường ẩn, phải tránh).
- Mỗi câu có một **mã tham số** ngắn do chủ đặt (mặc định sinh từ nhãn, không dấu). Tham số lạ bị bỏ qua. Giá trị điền sẵn vẫn qua kiểm tra kiểu như nhập tay; sai kiểu thì bỏ, không chặn form.
- Trình soạn có ô "Tạo link điền sẵn": chọn câu, nhập giá trị, sao chép link.

### 2.4 Điều kiện

- Câu hỏi, **nhóm câu hỏi** hoặc trang **hiện khi** điều kiện trên câu trả lời trước đó đúng: ví dụ "Hiện câu 5 khi câu 3 là `Có`". Điều kiện dùng cú pháp lọc của Module 0 (`eq`, `in`, `gt`, `contains`, `is_empty`…), có "thoả tất cả" / "thoả một trong".
- **Nhóm câu hỏi** là một khối chứa nhiều câu, ẩn hiện cùng lúc. Ví dụ câu "Kinh nghiệm ngành" (Một lựa chọn): chọn `Vận tải` thì hiện nhóm 5 câu về vận tải, chọn `Bán lẻ` thì hiện nhóm câu về bán lẻ. Câu Nhiều lựa chọn dùng "có chứa" để hiện nhiều nhóm cùng lúc.
- Đặt điều kiện nhanh từ câu lựa chọn: mỗi lựa chọn có ô "Khi chọn thì hiện…" để chọn nhóm hoặc câu, không phải tự viết điều kiện.
- **Nhảy trang** theo câu trả lời: "Câu 2 là `Không` thì sang trang Cảm ơn".
- Server tính lại điều kiện khi nhận bài: câu bị ẩn thì bỏ giá trị và không bắt buộc. Không tin trình duyệt. Đổi lựa chọn làm một nhóm bị ẩn thì câu trả lời trong nhóm đó bị bỏ khi gửi (trình duyệt vẫn giữ tạm để người điền đổi ý chọn lại không phải nhập lại).
- Mỗi câu của mỗi nhánh là một cột riêng. Dòng của nhánh Vận tải để trống các cột Bán lẻ; đó là đúng, không phải thiếu dữ liệu.
- Trình soạn chặn điều kiện trỏ tới câu đứng sau hoặc tạo vòng, và có chế độ xem trước "đi thử từng nhánh".

### 2.5 Component Nguồn dữ liệu

*Dương chốt 19/11/2026.* Form vẫn là một engine. Thêm một component **Nguồn dữ liệu** để kéo dữ liệu ra hiển thị trên form, ví dụ: sale chọn ngành và khoảng thời gian, form hiện danh sách khách hàng đã triển khai Base thuộc ngành đó; hoặc người điền gõ từ khoá, form hiện bài Knowledge phù hợp.

**Ba loại nguồn**

| Nguồn | Cấu hình | Chạy bằng quyền của |
|---|---|---|
| **Datahub** | Một bảng trong datahub của chủ form (không gồm datahub "Quản lý Deal", mục 1.1); điều kiện cố định; điều kiện theo câu hỏi; cột hiển thị; sắp xếp | Chủ form |
| **API nội bộ** | Chọn một API trong **danh sách Admin cho phép**; truyền tham số từ câu hỏi. Không cần key | Chủ form |
| **API bên ngoài** | URL `https`, phương thức `GET`/`POST`, tham số và thân yêu cầu có chèn câu trả lời; tuỳ chọn **gắn key**; chỉ ra chỗ lấy danh sách kết quả trong JSON trả về và các trường hiển thị | — |

- **Điều kiện theo câu hỏi** dùng toán tử so sánh của bộ lọc Module 0: một câu trên form nối với một cột bằng `bằng`, `trong danh sách`, `chứa`, `lớn hơn`, `trong khoảng`… Ví dụ câu "Ngành" `bằng` cột Ngành; câu "Từ ngày – đến ngày" `trong khoảng` cột Thời gian triển khai. Câu tham số để trống thì bỏ điều kiện đó, hoặc chặn tra cứu nếu chủ đặt câu là bắt buộc.
- **Điều kiện cố định** chủ đặt khi lập form, người dùng form không thấy, không đổi được. Ví dụ `Trạng thái = Đã triển khai`.
- Câu chỉ dùng làm tham số không cần nối cột: đánh dấu "Chỉ dùng cho nguồn dữ liệu, không lưu".

**Hai cách dùng kết quả**

1. **Hiển thị:** bằng các khối gắn với nguồn (mục 2.6). Tối đa 50 kết quả mỗi lần (chủ đổi được, trần 500), có "Xem thêm".
2. **Làm lựa chọn cho một câu hỏi:** ví dụ câu "Ngành" lấy danh sách lựa chọn từ các giá trị của cột Ngành; câu "Chọn khách" lấy từ kết quả tra cứu. Câu này nối với cột **Văn bản** và lưu giá trị đã chọn dạng chữ (không phải liên kết dòng, không tự thêm lựa chọn vào cột Một lựa chọn, để người lạ không làm phình danh sách lựa chọn của bảng).
3. **Tự điền câu khác** từ kết quả được chọn (mục 2.7).

**Khi nào chạy:** tự chạy khi câu tham số đổi (chờ người dùng ngừng gõ 0,4 giây), hoặc chỉ chạy khi bấm nút "Tra cứu". Chủ chọn. Nút "Tra cứu" chỉ chạy nguồn và hiện kết quả, **không ghi gì**; nút "Gửi" mới ghi vào bảng đích. Hai nút luôn khác nhãn và khác vị trí. Form chỉ để tra cứu thì không có nút Gửi.

**Quyền.** Theo đúng quyền của form (mục 3): form công khai thì ai có link cũng mở và tra cứu được; form nội bộ thì người có tài khoản; form chia sẻ cho ai thì chỉ người đó. Nguồn Datahub và API nội bộ chạy bằng quyền **chủ form**, nên người dùng form không cần quyền xem bảng; chủ mất quyền thì nguồn báo lỗi. Trình soạn ghi rõ phần dữ liệu sẽ lộ ra: "Người mở form xem được các dòng có Trạng thái = Đã triển khai, cột: Tên công ty, Ngành, Thời gian triển khai".

**API nội bộ.**
- Admin quản lý **danh sách API nội bộ dùng cho form** trong Cài đặt: mỗi mục là một query trong registry, kèm tên hiển thị và tham số. Chỉ query (đọc) được đưa vào danh sách; command (ghi) không bao giờ được, để mở form không làm thay đổi dữ liệu.
- Ban đầu danh sách chỉ có các API của Knowledge (tìm bài, đọc bài); Module 8 đăng ký chúng. Trước Stage 8 danh sách trống.

**API bên ngoài.**
- **Gắn key:** khai báo key gửi ở header (ví dụ `Authorization: Bearer …`, `X-API-Key`) hoặc tham số URL. Key lưu mã hoá ở server, **không bao giờ gửi ra trình duyệt**, không có trong JSON xuất ra, chỉ hiện dạng che (`••••1a2b`); chủ thay key, không xem lại được. Nhân bản form thì phải nhập lại key. Key chỉ nhập trên web, không nhập qua kết nối AI (để key không nằm trong đoạn chat).
- **Mọi lời gọi đi qua server** của SoE Hub (trình duyệt không gọi thẳng), vì key phải giấu và trình duyệt bị chặn gọi sang tên miền khác.
- Chặn gọi vào địa chỉ nội bộ (`localhost`, IP riêng, IP của chính server, kể cả khi bị chuyển hướng tới), để form không bị dùng làm đường dò vào mạng nội bộ của server.
- Hết giờ sau 10 giây, kết quả tối đa 1 MB, chỉ nhận JSON. Cùng một yêu cầu trong 60 giây dùng lại kết quả cũ.
- Giới hạn mỗi người mở form (theo tài khoản, hoặc IP với form công khai) 30 lần tra cứu mỗi phút, mọi loại nguồn.
- API lỗi nhiều lần liên tiếp thì chủ form nhận thông báo (Module 6). Form vẫn gửi được, chỉ component đó báo lỗi.
- Admin có công tắc tắt API bên ngoài cho toàn hệ thống (Cài đặt).

**Nhật ký.** Đổi cấu hình nguồn, gắn hoặc thay key ghi nhật ký. Mỗi lần tra cứu chỉ đếm số lần và lỗi (thống kê trong tab Phản hồi), không ghi từng lần vào nhật ký, vì form công khai có thể có rất nhiều lượt.

**AI.** JSON của form chứa cấu hình nguồn (không có key), nên AI dựng được form có nguồn dữ liệu qua `form_save`.


### 2.6 Hiển thị kết quả của nguồn

*Dương chốt 19/11/2026.*

**Nguồn ẩn, khối gắn vào nguồn.** Nguồn dữ liệu là component không hiện ra, có tên (ví dụ "Khách hàng"). Các khối hiển thị **gắn vào** nguồn; một nguồn nuôi được nhiều khối cùng lúc (một câu tóm tắt, một danh sách thẻ…).

**Khối tự dựng, chèn trường của nguồn.**

- Chủ dựng một khối như mọi khối trên form (nền, viền, bo góc, khoảng cách; bên trong có tiêu đề, chữ, ảnh, nhãn, nút), rồi chèn trường của nguồn vào component cần dữ liệu, kiểu trộn thư: `Hạng: {Khách hàng.Hạng thành viên}`. Chữ cố định giữ nguyên, phần trong `{}` thay bằng dữ liệu. Một component chèn được nhiều trường.
- Đoạn chữ ngoài khối cũng chèn được câu trả lời và số liệu của nguồn: "Có {Khách hàng.số kết quả} khách ngành {Ngành} triển khai từ 2024".
- Kiểu dáng chỉ chọn từ bộ có sẵn: màu theo token, khoảng cách bội số 4px, cỡ chữ theo thang của hệ thống (chuẩn giao diện trong CLAUDE.md). Dựng tự do nhưng không ra màu lệch, cỡ chữ lạ.
- Có vài **mẫu dựng sẵn** làm bằng chính cơ chế này: thẻ khách hàng, dòng bài Knowledge (tiêu đề + 2 dòng tóm tắt, tô đậm từ khoá), bảng. Chọn mẫu rồi sửa.

**Hai cách gắn khối với nguồn**

| Cách | Hiện | Hợp với |
|---|---|---|
| **Lặp** | Mỗi kết quả một khối, xếp danh sách hoặc lưới (1–3 cột; điện thoại 1 cột). Kiểu bảng: dưới 768px tự thành thẻ | Tra khách theo ngành |
| **Một kết quả** | Một khối. Đúng 1 kết quả thì hiện ngay; nhiều hơn 1 thì hiện danh sách gọn "Tìm thấy 3 khách, chọn một khách", chọn xong mới hiện khối | Tra hạng thành viên theo số điện thoại, mã khách |

**Định dạng và ảnh**

- Giá trị định dạng theo kiểu dữ liệu, qua bộ hàm định dạng dùng chung (`vi-VN`): nguồn Datahub lấy kiểu cột; API ngoài thì chủ chọn kiểu cho từng trường (Chữ, Số, Tiền, Phần trăm, Ngày, Ảnh, Link, Nhãn), không chọn thì là Chữ.
- **Nhãn** tự lấy màu của lựa chọn trong Datahub (hạng Vàng, Bạc… đã đặt màu ở cột thì hiện đúng màu). Chữ dài tối đa 2 dòng; số, tiền, ngày không bao giờ bị cắt.
- **Ẩn khi trống:** mỗi component có tuỳ chọn ẩn khi trường trống (khách chưa có hạng thì ẩn cả dòng "Hạng: …"); không chọn thì hiện "—".
- **Ảnh:** component Ảnh nhận trường Đính kèm (ảnh đầu tiên hoặc dải ảnh, bấm để phóng to), trường URL, hoặc trường kiểu Ảnh của API ngoài. File của SoE Hub vẫn riêng tư: server cấp link xem có hạn ngắn theo quyền chủ form, chỉ cho ảnh thuộc trường đã gắn vào form. Ảnh của API ngoài tải **qua server** (cùng lớp chặn địa chỉ nội bộ của mục 2.5, tối đa 5 MB, chỉ nhận kiểu ảnh, có cache) để trang ngoài không theo dõi được người mở form và không phải nới CSP. Ảnh lỗi hoặc trống: ảnh dự phòng (chữ cái đầu) hoặc ẩn, chủ chọn; ảnh luôn cắt vừa khung (`object-fit: cover`), có chữ thay thế.

**Đổi kiểu dáng theo giá trị**

- Khối có **biến thể theo giá trị** của một trường: chọn một trường (thường là Một lựa chọn, ví dụ Hạng thành viên), mỗi giá trị một biến thể (màu nền, màu viền, màu chữ, ảnh nền từ token). Ví dụ Kim cương nền tím, Vàng nền vàng, không khớp giá trị nào thì dùng kiểu mặc định của khối.
- Màu chữ của mỗi biến thể được kiểm tra tương phản (≥ 4,5:1 với nền); không đạt thì trình soạn báo và không cho lưu biến thể đó.
- Một khối chỉ đổi theo **một** trường ở bản đầu (đủ cho thẻ hạng, nhãn trạng thái). Điều kiện nhiều trường để sau.

**Trạng thái** (mỗi khối gắn nguồn đều có): chưa nhập điều kiện ("Chọn ngành để xem khách hàng", chủ sửa câu này); đang tải (khung xương đúng hình khối đã dựng); có kết quả; không có kết quả (câu do chủ đặt, có thể kèm nút); lỗi (kèm Thử lại).

**Chi tiết khi bấm:** bấm một khối mở ngăn chi tiết (bên phải trên máy tính, trượt từ dưới lên trên điện thoại) với các trường chủ chọn. Bài Knowledge hiện nội dung ngay trong ngăn này (form công khai không mở được trang Knowledge).

**Trình soạn** xem trước bằng dữ liệu thật của nguồn, đổi qua lại vài kết quả mẫu và từng biến thể.

**Chưa làm:** thẻ số, biểu đồ tổng hợp trên kết quả của nguồn (Dương chốt 19/11/2026: chưa cần). Đoạn chữ vẫn chèn được số kết quả.

### 2.7 Tự điền từ kết quả được chọn

*Dương chốt 19/11/2026.* Ví dụ form "Yêu cầu tham quan khách hàng": sale tra cứu theo ngành, bấm **"Chọn"** trên thẻ Lana Logistic, các câu Tên khách, Gói đang dùng, Người liên hệ tự điền; sale nhập thêm ngày muốn tham quan rồi Gửi.

- Khối gắn nguồn có nút **"Chọn"** (bật trong thiết lập khối). Cách gắn "Một kết quả" khi có nhiều kết quả dùng chính bước chọn này.
- Mỗi câu muốn tự điền khai báo trường lấy từ kết quả: câu "Tên khách" ← `{Khách hàng.Tên khách hàng}`. Câu đó vẫn nối cột và lưu như câu thường.
- Mỗi câu tự điền chọn **Khoá** (người dùng không sửa) hoặc **Cho sửa**.
- Chọn lại kết quả khác thì các câu tự điền đổi theo; câu người dùng đã sửa tay thì giữ nguyên. Bỏ chọn thì xoá các câu tự điền chưa sửa tay.
- **Server không tin giá trị của câu khoá do trình duyệt gửi lên.** Với nguồn Datahub, trình duyệt gửi mã kết quả đã chọn; server đọc lại đúng dòng đó (vẫn trong điều kiện của nguồn) và tự điền các câu khoá; mã không thuộc kết quả hợp lệ thì từ chối. Với API nội bộ và API bên ngoài, server chạy lại nguồn với cùng tham số và lấy kết quả có cùng mã (chủ chỉ ra trường làm mã khi cấu hình nguồn); không có trường mã thì câu chỉ khoá trên giao diện và trình soạn ghi rõ điều đó.
- Có cột hệ thống tuỳ chọn **Mã kết quả đã chọn** để sau này đối chiếu phản hồi với dòng nguồn.

### 2.8 Danh sách tự sinh ở mọi chỗ chọn

*Dương chốt 19/11/2026.* Chỗ nào chọn thứ hệ thống đã biết thì phải có **danh sách tự sinh, đầy đủ** để chọn, không bắt gõ tay. Gõ tay chỉ là cách phụ, và khi gõ luôn có gợi ý (như trình soạn công thức của Module 2).

| Chỗ chọn | Danh sách lấy từ |
|---|---|
| Nối câu hỏi với cột (2.3a) | Cột chưa nối của bảng đích, đúng kiểu |
| Bảng đích, bảng nguồn | Datahub và bảng của chủ form (đã loại "Quản lý Deal", bảng được chia sẻ, bảng gộp) |
| Trường của nguồn Datahub: cột hiển thị, cột điều kiện, cột sắp xếp, trường chèn vào khối, trường tự điền | Mọi cột của bảng nguồn, kèm kiểu và biểu tượng kiểu |
| Trường của API nội bộ: tham số, trường kết quả | Schema của query trong registry (tên, kiểu, mô tả) |
| Trường của API bên ngoài | Bấm **"Gọi thử"** với giá trị mẫu: server gọi API, đọc JSON trả về, tự tìm danh sách kết quả và liệt kê mọi trường (cả trường lồng nhau, dạng `khach_hang.ten`), tự đoán kiểu (số, ngày, link, ảnh); chủ sửa kiểu nếu đoán sai. Danh sách được lưu cùng cấu hình; API đổi cấu trúc thì "Gọi thử" lại |
| Toán tử của điều kiện | Chỉ các toán tử hợp với kiểu của cột hoặc câu hỏi (ngày có `trong khoảng`, chữ có `chứa`…) |
| Giá trị so sánh của điều kiện, biến thể theo giá trị | Lựa chọn của cột hoặc câu hỏi (kèm màu); cột chữ thì gợi ý các giá trị đang có trong bảng |
| Câu hỏi làm tham số, câu hiện theo điều kiện, câu tự điền | Mọi câu hỏi của form, theo thứ tự trên form, kèm số trang |
| Chèn trường vào chữ (`{…}`) | Gõ `{` thì hiện danh sách: trường của các nguồn trên form, câu trả lời, số kết quả |
| Người được điền form | Người, team, vai trò trong org chart; Guest theo mục 3.1 |
| Người chấm bài | Người có quyền dùng form |
| API nội bộ cho form (Admin) | Mọi query trong registry còn được phép, kèm mô tả |

- Danh sách dài thì có ô tìm (không dấu, không phân biệt hoa thường) và nhóm theo loại.
- Thứ đã chọn mà sau đó bị xoá hoặc đổi tên (cột, trường, câu hỏi) thì hiện tên mới, hoặc báo đỏ "Cột đã bị xoá" và chặn xuất bản; không bao giờ để chuỗi chết lặng lẽ.

## 3. Chia sẻ và người điền

### 3.1 Ba cách mở form

| Cách | Ai điền | Đăng nhập |
|---|---|---|
| **Công khai** | Ai có link | Không |
| **Mọi tài khoản** | Mọi người dùng SoE Hub, **không gồm Guest** | Có |
| **Chọn người** | Người, team, vai trò được chọn; chọn được **từng Guest** hoặc **mọi Guest mẫu Sale** (*Dương chốt 19/11/2026*), ví dụ để sale dùng form tra cứu khách hàng | Có |

- Link dạng `https://<domain>/f/<mã ngẫu nhiên 10 ký tự>`, không đoán được. Chủ **đổi link** được (link cũ chết ngay).
- Form nội bộ tự ghi người điền vào cột hệ thống Người tạo của dòng. Form công khai: Người tạo là tài khoản hệ thống "Form công khai".
- **Nhúng vào trang khác** (iframe, ví dụ landing page của Base): tuỳ chọn của form công khai, mặc định tắt. Bật thì server cho phép nhúng (`frame-ancestors`) chỉ với các tên miền chủ khai báo.

### 3.2 Tuỳ chọn

| Tuỳ chọn | Ghi chú |
|---|---|
| Mỗi người một phản hồi | Chỉ form nội bộ |
| Cho sửa sau khi gửi | Chỉ form nội bộ, đến khi form đóng |
| Mở lúc, đóng lúc | Theo giờ Việt Nam |
| Số phản hồi tối đa | Đủ thì tự đóng |
| Trạng thái | `Nháp` / `Đang nhận` / `Tạm dừng` / `Đã đóng`. Form đóng hiện câu chủ đặt ("Form đã đóng ngày 30/11") |

### 3.3 Người điền thấy gì

- Chỉ thấy form. Gửi form **không** cho người điền quyền gì trên bảng.
- Cấu hình form gửi ra trình duyệt **không có** mã bảng, mã cột, tên datahub, đáp án đúng, cấu hình và key của nguồn dữ liệu. Câu hỏi và nguồn dữ liệu chỉ có mã riêng của form; trình duyệt gọi server bằng mã đó kèm câu trả lời làm tham số.

## 4. Lưu nháp khi đang điền

Brief yêu cầu người điền lưu được bài đang làm dở.

- **Form nội bộ:** nháp lưu ở server theo (người, form), tự lưu sau mỗi câu. Mở lại trên máy khác vẫn tiếp tục được.
- **Form công khai:** nháp lưu trong trình duyệt. Thêm nút **"Lưu và làm tiếp sau"**: server lưu nháp, trả một **link tiếp tục** có mã bí mật (hạn 30 ngày) để mở lại trên máy khác.
- Nháp nằm ở bảng riêng (`form_drafts`), **không** tạo dòng trong bảng đích: dòng chỉ xuất hiện khi gửi thật, để số liệu không lẫn bài dở.
- Form xuất bản phiên bản mới khi người điền đang làm dở: giữ câu trả lời của các câu còn tồn tại, bỏ câu đã xoá, báo "Form vừa được cập nhật".
- Form dài có thanh tiến độ (chuẩn giao diện).

## 5. Gửi bài

### 5.1 Đường ghi

- Gửi bài là một command trong registry (`form.response.submit`), ghi dòng qua **cùng đường ghi dòng của Module 2** (`applyRowOps`), nên kiểm tra kiểu, cột Duy nhất, công thức cùng dòng, hàng đợi tính lại, sự kiện đều chạy như mọi lần ghi.
- Ghi bằng form **có** lịch sử dòng (dữ liệu do form nhập, đúng quy định đã chốt). Actor có `via = form`; với form công khai, nhật ký ghi IP và mã form.
- Phản hồi trùng do bấm hai lần: mỗi lượt điền có mã riêng làm `Idempotency-Key`.
- **Nộp qua API, MCP** (*Dương chốt 19/11/2026*): form thường (khảo sát, đăng ký) nộp được qua token hoặc kết nối có menu Form mức Sửa, để hệ thống ngoài đẩy phản hồi vào. Người sở hữu token phải là người được điền form đó (form công khai: ai có token đều được). Đi cùng đường ghi, cùng kiểm tra, `via = api` hoặc `mcp`. Bài kiểm tra thì không (mục 6.5).

### 5.2 Sửa phản hồi

- Chủ bảng sửa dòng trong Datahub như mọi dòng (có lịch sử).
- Người điền form nội bộ có "Cho sửa sau khi gửi" thì sửa lại qua form; ghi đè đúng dòng của họ.

### 5.3 Chống spam form công khai

*Dương chốt 19/11/2026.* Không dùng dịch vụ captcha bên ngoài (hạn chế phụ thuộc như Module 1):

- Ô bẫy ẩn (honeypot) và thời gian điền tối thiểu (gửi dưới 3 giây sau khi mở là bot).
- Giới hạn mỗi IP 10 lần gửi/phút; mỗi form 1.000 phản hồi/ngày (chủ chỉnh, Admin đặt trần).
- Vượt ngưỡng thì từ chối kèm câu "Bạn gửi quá nhanh, thử lại sau ít phút", ghi nhật ký, báo chủ form một lần.
- Nếu thực tế bị spam nặng thì thêm captcha tự host (dạng proof-of-work, không cần tài khoản ngoài) ở bản sau.

### 5.4 File trên form công khai

- Tối đa 10 MB mỗi file, 5 file mỗi câu, chỉ các loại cho phép (Module 0 mục 15). Chủ đặt thấp hơn được.
- File tính vào dung lượng của **chủ form**. Hết dung lượng thì câu tải file báo lỗi rõ, phần còn lại vẫn gửi được nếu câu đó không bắt buộc.
- Link tải lên có hạn và chỉ dùng cho đúng lượt điền đó.

## 6. Bài kiểm tra

Bật chế độ **Bài kiểm tra** cho một form. Chỉ dùng được với form nội bộ (bài test cần biết ai làm).

### 6.1 Chấm tự động

| Loại câu | Đáp án |
|---|---|
| Một lựa chọn | Một lựa chọn đúng |
| Nhiều lựa chọn | Tập lựa chọn đúng. Mặc định đúng hết mới có điểm; tuỳ chọn chấm từng phần |
| Số | Bằng một số, hoặc nằm trong khoảng |
| Văn bản ngắn | Danh sách đáp án chấp nhận; so khớp bỏ dấu cách thừa, không phân biệt hoa thường; tuỳ chọn có phân biệt dấu |

- Mỗi câu có số điểm. Tổng điểm quy về thang 100 (hoặc giữ nguyên, chủ chọn).
- **Chấm ở server.** Đáp án không bao giờ gửi ra trình duyệt người làm bài.

### 6.2 Chấm tay

- Câu tự luận, câu tải file: có điểm tối đa, **người chấm** cho điểm và nhận xét.
- **Phiếu chấm theo tiêu chí** (như bảng chấm mockup): mỗi tiêu chí có thang điểm (ví dụ 1–5), **trọng số**, **điểm sàn**. Điểm = tổng (điểm × trọng số). Một tiêu chí dưới điểm sàn thì **không đạt** dù tổng đủ.
- Bài có câu chấm tay thì trạng thái `Chờ chấm` cho tới khi chấm xong. Người chấm: chủ form và người chủ chỉ định (Module 9 chỉ định leader trực tiếp cho bài onboard).
- Màn **Chấm bài**: danh sách bài chờ chấm, mở từng bài, chấm từng câu, chuyển bài kế tiếp bằng bàn phím.

### 6.3 Thiết lập bài

| Thiết lập | Ghi chú |
|---|---|
| Ngưỡng đạt | Điểm hoặc %, ví dụ ≥ 80/100 |
| Số lần làm | Mặc định 1; ví dụ 2 = được thi lại một lần. Mỗi lần là một dòng riêng, cột Lần làm ghi 1, 2… |
| Thời gian làm | Tuỳ chọn. Server ghi giờ bắt đầu; hết giờ thì nộp những gì đã lưu nháp |
| Xáo trộn | Thứ tự câu, thứ tự lựa chọn |
| Người làm bài thấy | Không thấy gì / chỉ điểm và Đạt-Không đạt / điểm và đáp án đúng **sau khi form đóng** |

### 6.4 Lưu kết quả

- Bật chế độ Bài kiểm tra thì bảng đích có thêm các cột do hệ thống quản lý: **Điểm**, **Điểm tối đa**, **Kết quả** (`Đạt` / `Không đạt` / `Chờ chấm`), **Lần làm**, **Thời gian làm**, **Người chấm**, **Ngày chấm**.
- Điểm từng câu và nhận xét lưu ở bảng `form_scores` (theo dòng phản hồi), hiện trong chi tiết dòng và màn Chấm bài.
- Chấm tay, chấm lại ghi lịch sử dòng như sửa tay. Đổi đáp án của phiên bản đã có bài thì **không** tự chấm lại; chủ bấm "Chấm lại theo đáp án mới" và xem trước số bài đổi kết quả.

### 6.5 AI không làm bài

- Nộp bài kiểm tra **không** gọi được qua kết nối AI hay token (`aiAllowed: false`). Chỉ nộp qua web có phiên đăng nhập.
- Giới hạn đã chốt ở Module 0 mục 16 vẫn đúng: hệ thống không phân biệt được người thật với AI điều khiển trình duyệt của chính người đó.
- AI vẫn **tạo và sửa** bài kiểm tra được (qua `form_save`), và đọc kết quả qua bảng nếu có quyền.

## 7. Phản hồi

- Tab **Phản hồi** của form: số phản hồi, biểu đồ tóm tắt từng câu (dùng engine chỉ số của Module 3), danh sách phản hồi, link mở bảng đích trong Datahub.
- Xem, lọc, xuất dùng chính bảng Datahub (view, export của Module 2).
- Thông báo (Module 6): có phản hồi mới → chủ form, gom theo giờ, mặc định bật; bài chờ chấm → người chấm; đã chấm xong → người làm bài (khi được phép xem điểm).

## 8. JSON

- Cấu hình form là một tài liệu JSON có phiên bản schema (`soe-form/1`): khối, câu hỏi (kèm kiểu cột muốn tạo nếu chưa có), điều kiện, giao diện, thiết lập bài kiểm tra.
- **Xuất / nhập** trên giao diện và API. Nhập thì chọn: tạo bảng mới theo JSON, hoặc ghép câu hỏi vào cột có sẵn theo tên (báo câu nào không ghép được và vì sao).
- JSON xuất ra có đáp án chỉ khi người xuất là chủ form.
- Lỗi khi nhập trả có cấu trúc (đường dẫn trong JSON, lý do), để AI tự sửa (Module 5 mục 4.4).

## 9. Quyền

- Tạo form: Manager, Leader, User (`form:form:create`). Admin và Guest không tạo (Admin không có quyền nghiệp vụ).
- Không giới hạn số form (brief). Phản hồi tính vào số dòng của bảng (không giới hạn) và file tính vào dung lượng của chủ.
- Chỉ chủ sửa form. Muốn người khác xem phản hồi thì chia sẻ bảng đích (Module 2 mục 10).
- Xoá form: form vào thùng rác (7 ngày như mọi thứ khác), link ngừng nhận phản hồi; bảng đích và phản hồi đã có **giữ nguyên**.
- **Nhân bản form** (cho Module 9: nhân bản lộ trình kèm bài test): tạo form mới; chọn ghi vào bảng mới cùng cấu trúc (mặc định) hoặc bảng có sẵn.
- Chuyển giao (Module 1 mục 8): form đổi chủ cùng datahub.
- MCP (Module 5, menu Form): `form_get`, `form_save`, `form_responses`; nộp form thường qua `soe_call`; nộp bài kiểm tra bị cấm (mục 6.5).

## 10. Giao diện tối thiểu (Stage 7)

- Danh sách form của tôi: tên, trạng thái, số phản hồi, phản hồi mới nhất; tạo, nhân bản, xoá (thùng rác).
- Trình soạn: thanh khối bên trái, khung form ở giữa, thanh thuộc tính bên phải; xem trước điện thoại / máy tính; trạng thái "Đã lưu nháp"; nút Xuất bản; tab Chia sẻ, Thiết lập, Bài kiểm tra.
- Trang điền công khai `/f/<mã>`: đạt mọi mục "Bề ngang và điện thoại" trong CLAUDE.md, thử ở 375px với bàn phím ảo mở; trạng thái đang gửi, lỗi, form đóng, link tiếp tục.
- Tab Phản hồi, màn Chấm bài.
- Thẩm mỹ đầu tư thêm ở Stage 12 (form công khai là một trong ba chỗ được làm đẹp hơn).

## 11. Kiểm thử

- Unit: chấm tự động mọi loại câu, chấm từng phần, trọng số và điểm sàn của phiếu chấm, thang 100, ngưỡng đạt, số lần làm, hết giờ, điều kiện hiện/ẩn và nhảy trang (server tính lại), ghép phiên bản khi đang làm dở.
- Quyền: không chọn được bảng của "Quản lý Deal", bảng được chia sẻ, bảng gộp; người điền không đọc được bảng; JSON công khai không có đáp án, mã bảng, mã cột; nộp bài kiểm tra qua token/MCP bị từ chối.
- Chống spam: honeypot, gửi quá nhanh, vượt giới hạn IP và giới hạn ngày.
- Hiển thị nguồn: Lặp và Một kết quả (0, 1, 3, 51 kết quả), ẩn khi trống, biến thể theo giá trị và kiểm tra tương phản, ảnh riêng tư qua link có hạn, ảnh ngoài qua server, bảng thành thẻ ở 375px; dữ liệu xấu nhất (tên rất dài, số rất lớn, ảnh lỗi).
- Nguồn dữ liệu: điều kiện cố định không bị tham số ghi đè; chỉ trả cột đã chọn; chủ mất quyền thì báo lỗi; API nội bộ ngoài danh sách Admin hoặc là command bị từ chối; API ngoài gọi vào `localhost`, IP riêng, chuyển hướng vào IP riêng đều bị chặn; key không có trong mọi phản hồi gửi trình duyệt và JSON xuất; hết giờ, quá 1 MB, giới hạn 30 lần/phút.
- Đường ghi: phản hồi tạo đúng một dòng, có lịch sử dòng `via = form`, công thức của bảng tính sau khi gửi, gửi hai lần cùng mã chỉ tạo một dòng.
- Giao diện: luồng tạo form → xuất bản → điền công khai trên 375px → xem phản hồi; bài test → làm bài → chấm tay → người làm xem điểm; dữ liệu xấu nhất theo `break-ui` (form 200 câu, lựa chọn rất dài, 10.000 phản hồi).

## 11a. Để bản sau

- **Thẻ số, biểu đồ tổng hợp trên kết quả của nguồn** (mục 2.6).
- **Đổi kiểu dáng khối theo nhiều trường** (bản đầu một trường, mục 2.6).
- **Câu bảng chi tiết** (một lần gửi nhập nhiều dòng con, ví dụ danh sách người tham dự; Lark ghi sang bảng liên kết). Cần ghi nhiều dòng sang bảng con và đụng luật ô Liên kết của Module 2; bài test, bài thu hoạch hiện tại không cần.

## 12. Thay đổi so với quy định đã chốt

| Quy định cũ | Đổi thành | Ảnh hưởng |
|---|---|---|
| `via` của actor: web, api, mcp, worker, automation (Module 0 mục 3.4) | Thêm `form` | Module 0, code Stage 0 |
| Form không ghi vào Deals (Module 4 mục 15) | Form không ghi vào và không đọc từ **mọi bảng** của datahub "Quản lý Deal" | Module 4, CLAUDE.md |
| Bảng chỉ có cột do người tạo | Bật Bài kiểm tra thì hệ thống thêm các cột kết quả và tự quản lý chúng (mục 6.4); bảng có form thêm cột Phiên bản form (mục 2.2) | Module 2 |
| Endpoint không cần đăng nhập chỉ gồm đăng nhập, quên mật khẩu, OAuth, form công khai (Module 0 mục 16) | Giữ nguyên, nhưng "form công khai" nay gồm cả lời gọi nguồn dữ liệu của form đó; server SoE Hub gọi ra API bên ngoài thay người dùng form | Module 0 |
| Cột mỗi bảng mặc định 70, trần 200 (Module 2 mục 11) | Bảng có form: **150** (cài đặt `form.table_max_columns`), trần 200 giữ nguyên (mục 1.1a) | Module 2, CLAUDE.md |

## 13. Quyết định của Dương

Đã chốt 19/11/2026: một form ghi vào tối đa một bảng, mỗi câu hỏi một cột (1.1, 2.3a); 150 cột cho bảng có form (1.1a); bản nháp và xuất bản, phiên bản không sinh cột mới (2.2); ràng buộc cột và điền sẵn qua link (2.3b); nhóm câu theo điều kiện (2.4); component Nguồn dữ liệu (2.5), hiển thị kết quả kể cả biến thể theo giá trị (2.6), tự điền từ kết quả (2.7); datahub "Quản lý Deal" không làm đích, không làm nguồn (1.1); chống spam không captcha (5.3); form thường nộp được qua API (5.1); thẻ số, biểu đồ trên kết quả chưa làm.; Guest dùng form nội bộ khi được chọn đích danh (3.1); danh sách tự sinh ở mọi chỗ chọn (2.8).

Phần nối với Module 5 (menu Form, tool MCP) khớp Module 5 đã chốt 19/11 (nộp bài kiểm tra và nhập key nguồn dữ liệu thuộc nhóm cấm cứng, Module 5 mục 3.3). Phần nối với Module 6 (loại thông báo) theo bản nháp; đổi theo khi Module 6 được chốt.

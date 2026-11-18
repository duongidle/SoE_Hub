# Module 7 — Dynamic Form

> Trạng thái: **Bản nháp vòng 1, chờ Dương phản biện** · 19/11/2026
> Phụ thuộc: [Module 0](module0-nen-tang.md) (registry, actor, file, endpoint công khai), [Module 1](module1-tai-khoan-phan-quyen.md) (chủ sở hữu, đối tượng chia sẻ), [Module 2](module2-datahub.md) (bảng, kiểu cột, kiểm tra giá trị, lịch sử dòng), [Module 3](module3-metric-dashboard.md) (biểu đồ tóm tắt phản hồi), [Module 4](module4-quan-ly-deal.md) (Form không ghi vào Quản lý Deal), [Module 5](module5-ket-noi-ai.md) (menu Form, tool `form_get`, `form_save`, `form_responses`), [Module 6](module6-thong-bao.md) (loại thông báo của Form).
> Để module sau: gắn bài test vào lộ trình, ai chấm bài của nhân sự onboard, số lần thi lại theo lộ trình (Module 9).

Nguồn: brief mục 7; `examples/Lộ trình onboard Dương.xlsx` (sheet **Đánh giá thử việc**: bài test ngưỡng ≥ 80/100, trượt được thi lại một lần, bảng chấm mockup theo tiêu chí có trọng số và điểm sàn; sheet **Bài thu hoạch on-job**: nhiều câu tự luận dài cho mỗi buổi; sheet **QnA**).

Một engine cho ba việc: **form quảng bá, khảo sát** (trang công khai đẹp như landing page), **bài kiểm tra** (chấm điểm), **phiếu chấm** (người chấm điền theo tiêu chí).

---

## 1. Form và bảng

### 1.1 Mỗi form ghi vào đúng một bảng

- Form gắn với **một bảng Datahub của chính chủ form**. Mỗi lần gửi là **một dòng** của bảng đó.
- Ô nhập của form **là cột của bảng**: thêm một câu hỏi thì chọn cột có sẵn hoặc tạo cột mới ngay trong trình soạn. Kiểu cột quyết định kiểu ô nhập. Cách này giống Lark Form và có hai cái lợi: dữ liệu đã có kiểu chuẩn ngay từ lúc nhập, và xem, lọc, vẽ biểu đồ phản hồi bằng chính Datahub, không phải làm lại.
- Tạo form mới thì chọn: **tạo bảng mới** (mặc định, tên bảng = tên form, đặt trong datahub chủ chọn) hoặc **dùng bảng có sẵn**.
- Không chọn được làm đích:
  - Mọi bảng trong datahub **"Quản lý Deal"** (brief mục 7; Module 4 mục 15 nói Deals, ở đây mở rộng ra cả datahub cho đơn giản và an toàn).
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
| Đáp án đúng, số điểm | Cùng cột. Đáp án nằm trong phiên bản form; bài cũ giữ điểm cũ, "Chấm lại theo đáp án mới" là thao tác riêng (mục 6.4) |
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

**Trường ẩn:** lấy giá trị từ tham số trên link (`?nguon=facebook`), ghi vào cột; dùng để biết phản hồi đến từ kênh nào.

### 2.4 Điều kiện

- Câu hỏi hoặc trang **hiện khi** điều kiện trên câu trả lời trước đó đúng: ví dụ "Hiện câu 5 khi câu 3 là `Có`". Điều kiện dùng cú pháp lọc của Module 0 (`eq`, `in`, `gt`, `contains`, `is_empty`…), có "thoả tất cả" / "thoả một trong".
- **Nhảy trang** theo câu trả lời: "Câu 2 là `Không` thì sang trang Cảm ơn".
- Server tính lại điều kiện khi nhận bài: câu bị ẩn thì bỏ giá trị và không bắt buộc. Không tin trình duyệt.
- Trình soạn chặn điều kiện trỏ tới câu đứng sau hoặc tạo vòng.

## 3. Chia sẻ và người điền

### 3.1 Ba cách mở form

| Cách | Ai điền | Đăng nhập |
|---|---|---|
| **Công khai** | Ai có link | Không |
| **Mọi tài khoản** | Mọi người dùng SoE Hub (không gồm Guest) | Có |
| **Chọn người** | Người, team, vai trò được chọn | Có |

- Link dạng `https://<domain>/f/<mã ngẫu nhiên 10 ký tự>`, không đoán được. Chủ **đổi link** được (link cũ chết ngay).
- Form nội bộ tự ghi người điền vào cột hệ thống Người tạo của dòng. Form công khai: Người tạo là tài khoản hệ thống "Form công khai".

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
- Cấu hình form gửi ra trình duyệt **không có** mã bảng, mã cột, tên datahub, đáp án đúng. Câu hỏi chỉ có mã riêng của form.

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

### 5.2 Sửa phản hồi

- Chủ bảng sửa dòng trong Datahub như mọi dòng (có lịch sử).
- Người điền form nội bộ có "Cho sửa sau khi gửi" thì sửa lại qua form; ghi đè đúng dòng của họ.

### 5.3 Chống spam form công khai

Không dùng dịch vụ captcha bên ngoài (hạn chế phụ thuộc như Module 1):

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
- **Nhân bản form** (cho Module 9: nhân bản lộ trình kèm bài test): tạo form mới; chọn ghi vào bảng mới cùng cấu trúc (mặc định) hoặc bảng có sẵn.
- Chuyển giao (Module 1 mục 8): form đổi chủ cùng datahub.
- MCP (Module 5, menu Form): `form_get`, `form_save`, `form_responses`; nộp bài kiểm tra bị cấm (mục 6.5).

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
- Đường ghi: phản hồi tạo đúng một dòng, có lịch sử dòng `via = form`, công thức của bảng tính sau khi gửi, gửi hai lần cùng mã chỉ tạo một dòng.
- Giao diện: luồng tạo form → xuất bản → điền công khai trên 375px → xem phản hồi; bài test → làm bài → chấm tay → người làm xem điểm; dữ liệu xấu nhất theo `break-ui` (form 200 câu, lựa chọn rất dài, 10.000 phản hồi).

## 12. Thay đổi so với quy định đã chốt

| Quy định cũ | Đổi thành | Ảnh hưởng |
|---|---|---|
| `via` của actor: web, api, mcp, worker, automation (Module 0 mục 3.4) | Thêm `form` | Module 0, code Stage 0 |
| Form không ghi vào Deals (Module 4 mục 15) | Form không ghi vào **mọi bảng** của datahub "Quản lý Deal" | Module 4 |
| Bảng chỉ có cột do người tạo | Bật Bài kiểm tra thì hệ thống thêm các cột kết quả và tự quản lý chúng (mục 6.4); bảng có form thêm cột Phiên bản form (mục 2.2) | Module 2 |
| Cột mỗi bảng mặc định 70, trần 200 (Module 2 mục 11) | Bảng có form: **150** (cài đặt `form.table_max_columns`), trần 200 giữ nguyên (mục 1.1a) | Module 2, CLAUDE.md |

## 13. Câu hỏi cho Dương

Đã chốt 19/11/2026: một form ghi vào một bảng, mỗi câu hỏi một cột (mục 1.1); tách bản nháp và xuất bản, phiên bản không sinh cột mới (mục 2.2); giới hạn 150 cột cho bảng có form (mục 1.1a). Còn:

1. Chặn cả datahub "Quản lý Deal" làm đích, không chỉ bảng Deals (mục 1.1)?
2. Form công khai chống spam bằng ô bẫy + giới hạn tốc độ, chưa dùng captcha (mục 5.3)?
3. Bài kiểm tra chỉ cho form nội bộ, và AI không nộp bài được (mục 6, 6.5)? Khảo sát thường thì có cho nộp qua API không? Tớ đề xuất có, để hệ thống ngoài đẩy phản hồi vào.

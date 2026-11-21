# Module 6 — Thông báo, nhắc hẹn, nhắc hạn

> Trạng thái: **Đã chốt** · 21/11/2026 (vòng 1: 19/11, vòng 2 và chốt: 21/11)
> Phụ thuộc: [Module 0](module0-nen-tang.md) (outbox, pg-boss, SSE, file), [Module 1](module1-tai-khoan-phan-quyen.md) (mục 9 thông báo tối thiểu, phạm vi dữ liệu), [Module 2](module2-datahub.md) (cột ngày, bộ lọc, view), [Module 4](module4-quan-ly-deal.md) (Deals, Đợt thanh toán, vai trò cột, template theo lớp, hàng chờ BANT), [Module 5](module5-ket-noi-ai.md) (menu Thông báo cho AI, thao tác lớn).
> Để module sau: loại thông báo của Form, Knowledge, AI Hub, Onboarding, Workspace do module đó đăng ký (mục 3.3). Chiến dịch nhắc trên bảng bất kỳ, gửi qua email, chat ngoài: để Automation.

Bốn việc:

- **Thông báo:** hệ thống báo cho đúng người khi có chuyện liên quan đến họ.
- **Nhắc hẹn:** người dùng tự đặt "nhắc tôi lúc…".
- **Nhắc hạn Deal:** quy tắc tự nhắc theo một cột ngày của Deals hoặc Đợt thanh toán.
- **Thông báo chung:** Admin, Manager, Leader gửi cho cả cây hoặc team. SoE Hub thay Lark nên phải có kênh này.

---

## 0. Module độc lập

Thông báo là một module riêng, mọi module khác và Automation **gọi** nó, không tự làm. Mục đích: sau này sửa, thêm kênh, thêm tính năng chỉ đụng một chỗ.

- **Một cửa vào:** `notify.send({ type, recipients, render, object, priority, … })` cho thông báo tức thời, và `defineNotification` (mục 3.1) cho loại gắn với sự kiện outbox. Không module nào ghi thẳng vào bảng `notifications`. Code Stage 1 đang tự ghi thông báo mã kích hoạt: chuyển sang đi qua cửa này.
- Mọi luật nằm ở cửa vào, người gọi không phải lo: kiểm quyền người nhận (mục 5.4), cài đặt tắt/bật, giờ yên lặng, gom, giới hạn, đẩy, SSE, chống gửi trùng.
- **Chèn giá trị cột vào nội dung** (nhắc hạn, sau này component Thông báo của Automation): cửa vào kiểm từng người nhận có quyền xem dòng và cột được chèn không. Không có quyền thì phần đó thay bằng "—", không lộ giá trị. Luật này áp cho mọi người gọi, kể cả Automation.
- Phần chạy theo lịch (mốc theo cột ngày, chống gửi trùng, chạy bù) là một engine dùng chung: nhắc hạn Deal dùng ở Stage 6, Automation dùng lại sau.

## 1. Kênh gửi

| Kênh | Khi nào thấy | Ghi chú |
|---|---|---|
| **Trong ứng dụng** | Chuông + hộp thông báo, cập nhật tức thì qua SSE | Luôn có, mọi thông báo đều lưu ở đây |
| **Đẩy trên trình duyệt** (Web Push) | Kể cả khi đã đóng tab | Người dùng tự bật trên từng thiết bị. iPhone phải "Thêm vào màn hình chính" trước |

- Không có email (giữ quyết định ở `ha-tang.md`: hệ thống không gửi email). Không có kênh chat ngoài (Lark, Slack…) ở module này; khi cần thì làm bằng Automation.
- Lý do cần Web Push: nhắc hẹn lúc 14:00 mà người dùng không mở SoE Hub thì nhắc vô ích. Web Push không cần tài khoản dịch vụ ngoài: server tự sinh khoá VAPID, trình duyệt tự lo đường gửi.
- **Nội dung đẩy tối thiểu:** chỉ tiêu đề và link mở, không chứa số tiền, com, giá trị ô, mã xác thực. Bấm vào thì mở SoE Hub, đăng nhập rồi mới thấy chi tiết. Lý do: nội dung đẩy đi qua máy chủ của Google/Apple và hiện trên màn hình khoá.
- **Toast:** nhắc hẹn, nhắc hạn, loại `important` và thông báo chung quan trọng hiện thêm toast khi người dùng đang mở ứng dụng. Thông báo thường chỉ làm chuông nhảy số, không bật toast (tránh làm phiền).
- **Không dùng hộp thoại của trình duyệt** (`alert`, `confirm`, `prompt`) ở bất kỳ đâu trong hệ thống: báo dùng toast, hỏi xác nhận dùng hộp thoại trong ứng dụng (`design/chuan-giao-dien.md`, mục "Trạng thái thành phần").

## 2. Thông báo

### 2.1 Dữ liệu

Mở rộng bảng `notifications` của Module 1:

| Trường | Ghi chú |
|---|---|
| `type` | Mã loại, theo danh mục (mục 3) |
| `category` | Nhóm để lọc: Deal, Datahub, Kết nối AI, Tài khoản, Nhắc hẹn, Thông báo chung… |
| `priority` | `normal` / `important`. `important` bỏ qua giờ yên lặng (mục 5.2) |
| `title`, `body` | Sinh **riêng cho từng người nhận** (mục 5.4) |
| `link` | Đường dẫn trong ứng dụng, ví dụ deal, dòng, trang duyệt |
| `object_type`, `object_id` | Đối tượng liên quan, để tắt thông báo theo đối tượng và để gom |
| `actor_id`, `via` | Ai gây ra, qua kênh nào (web, API, AI kèm tên kết nối) |
| `group_key`, `group_count` | Gom thông báo (mục 5.3) |
| `read_at`, `push_sent_at` | |

### 2.2 Vòng đời

- Đánh dấu đã đọc khi bấm vào; có "Đánh dấu tất cả đã đọc".
- Giữ thông báo đã đọc 90 ngày, chưa đọc 180 ngày (Admin chỉnh). Job dọn hằng đêm. Thông báo chứa mã xác thực vẫn tự ẩn mã sau 6 giờ (Module 1).
- Đối tượng bị xoá hoặc người nhận mất quyền xem: thông báo vẫn còn nhưng link mở ra trang "Không còn quyền xem" hoặc "Đã bị xoá", không lỗi trắng trang.

## 3. Danh mục loại thông báo

### 3.1 Mỗi loại khai báo một lần

```ts
defineNotification({
  type: "deal.participant.added",
  category: "deal",
  on: "deal.participant.changed",        // sự kiện outbox kích hoạt
  recipients: (ev) => [...],             // ai nhận
  render: (ev, recipient) => ({ title, body, link }),
  priority: "normal",
  mandatory: false,                      // true: không tắt được
  push: "default_on",                    // default_on | default_off | never
})
```

Giống registry: module nào sở hữu sự kiện thì khai báo loại thông báo của mình. Thông báo đi qua outbox nên không mất (Module 0 mục 13), mỗi sự kiện chỉ tạo một thông báo cho mỗi người (đã có `source_event_id`).

### 3.2 Danh sách cho Module 1–5

| Loại | Người nhận | Bắt buộc |
|---|---|---|
| Mã kích hoạt, mã đặt lại mật khẩu (đã có) | Người duyệt theo Module 1 mục 6.4 | ✓ |
| Kết nối AI chờ duyệt | Mọi Admin | ✓ |
| Kết nối AI được duyệt / bị từ chối / bị thu hồi / sắp hết hạn | Chủ kết nối | ✓ |
| Tài khoản bị khoá 15 phút do sai mật khẩu | Chính người đó | ✓ |
| Được chia sẻ datahub, bảng, dashboard | Người được chia sẻ | |
| Import xong / có dòng lỗi; export lớn xong | Người chạy | |
| Job đối soát công thức thấy lệch (Module 2 mục 6.7) | Mọi Admin | ✓ |
| Cột tuỳ chỉnh bị đổi tên vì trùng cột template (Module 4 mục 3.1) | Chủ cột | ✓ |
| Template Deals thay đổi | Mọi Manager | |
| Được thêm vào deal, đổi vai trò hoặc tỉ lệ, bị bỏ khỏi deal | Người đó | ✓ |
| Deal mình là Leading bị người khác đổi Status, Doanh thu dự kiến, Ngày dự kiến chốt | Người Leading | |
| Tiền về được xác nhận cho đợt của deal mình (deal chuyển Won ở đợt đầu) | Người tham gia deal | |
| Deal Won chưa chia đủ tỉ lệ | Manager của cây | |
| Kỳ bị khoá / mở lại | Mọi người có deal trong kỳ đó | |
| Chính sách com có phiên bản mới | Mọi người trong cây | |
| Probation KPI của mình bị Manager sửa sau khi commit | Người đó | ✓ |
| Quy tắc nhắc hạn bị tạm dừng vì cột bị xoá hoặc đổi kiểu (mục 6.3) | Người đặt quy tắc | ✓ |

Không báo khi người khác sửa ô thường của deal (ghi chú, cột tuỳ chỉnh): quá nhiều, ai cần thì xem lịch sử dòng.

### 3.3 Module sau đăng ký thêm

| Module | Loại dự kiến |
|---|---|
| Form (M7) | Có phản hồi mới (gom theo giờ) |
| Knowledge, AI Hub (M8) | Bài/skill chờ duyệt → người duyệt; được duyệt / bị trả lại kèm lý do → tác giả |
| Onboarding (M9) | Việc, checklist được tick → **leader trực tiếp, bắt buộc** (brief yêu cầu "thông báo đầy đủ"); việc quá hạn |
| Workspace (M10) | Được giao việc, việc sắp đến hạn, quá hạn, có phản hồi |
| Feedback (M11) | Feedback mới → Admin; được phản hồi → người gửi |
| Automation | Component Thông báo: gọi `notify.send` với bảng, người nhận, mẫu nội dung do người dựng automation chọn (mục 0) |

## 4. Nhắc hẹn

Người dùng tự đặt: "Nhắc tôi gọi lại Thuận Phát lúc 14:00 thứ Năm".

| Trường | Ghi chú |
|---|---|
| Nội dung | Bắt buộc, tối đa 500 ký tự |
| Thời điểm | Ngày giờ theo giờ Việt Nam |
| Lặp lại | Không / hằng ngày / hằng tuần (chọn thứ) / hằng tháng; có ngày kết thúc. Không có kiểu "ngày làm việc" (Dương bỏ 21/11) |
| Gắn với | Tuỳ chọn: một deal, một dòng datahub, sau này một việc (M10). Bấm thông báo thì mở đúng đối tượng |

- **Chỉ nhắc chính mình** (Dương chốt 21/11). Nhắc người khác là giao việc, thuộc Workspace (M10), để có hạn, phản hồi, theo dõi.
- Tạo từ: nút "Nhắc tôi" ở chi tiết deal, chi tiết dòng, trang Nhắc hẹn; và từ AI qua MCP ("nhắc tớ chiều mai 3h gọi khách X").
- Khi đến giờ: thông báo `important`, có toast nếu đang mở ứng dụng, có đẩy nếu đã bật. Ba nút: **Xong**, **Nhắc lại sau 1 giờ**, **Sáng mai 08:30**.
- Đặt giờ trong quá khứ thì báo lỗi ngay ở ô nhập. Gắn với đối tượng mà sau đó mất quyền xem thì vẫn nhắc nội dung, link báo không còn quyền.
- Giới hạn 200 nhắc hẹn đang chờ mỗi người (Admin chỉnh).

## 5. Quy tắc gửi

### 5.1 Cài đặt → Thông báo

Mỗi người tự chỉnh ở trang **Cài đặt → Thông báo**, gồm:

- Bảng loại thông báo (theo nhóm) × kênh (Trong ứng dụng / Đẩy). Loại bắt buộc hiện nhưng khoá, ghi "Không tắt được".
- Giờ yên lặng (mục 5.2), bản tin buổi sáng (mục 5.5).
- **Nhắc hạn Deal** (mục 6): quy tắc của mình, và quy tắc của cây/team đang áp cho mình (tắt được phần nhận của mình nếu quy tắc không bắt buộc).
- Thiết bị nhận đẩy (mục 8).
- Danh sách đối tượng đã tắt thông báo, bật lại được. Tắt theo đối tượng: "Tắt thông báo deal này" trong chi tiết deal.

Không bao giờ báo cho chính người gây ra (sửa deal của mình thì không tự nhận thông báo). Nhắc hẹn, nhắc hạn là ngoại lệ.

### 5.2 Giờ yên lặng

- Mặc định 21:00–07:30 mỗi ngày và cả ngày Chủ nhật (Dương chốt 21/11). Mỗi người chỉnh khung giờ, chọn ngày yên lặng, hoặc tắt.
- Trong giờ yên lặng: thông báo vẫn lưu và chuông vẫn nhảy số, nhưng **không đẩy**. Nhắc hẹn, nhắc hạn và loại `important` vẫn đẩy (người dùng tự đặt giờ thì tôn trọng giờ đó).

### 5.3 Gom

- Cùng `group_key` (loại + đối tượng) trong 10 phút và người nhận chưa đọc: cập nhật thông báo cũ thay vì tạo mới. Ví dụ "Linh và 2 người khác đã chia sẻ 3 bảng với bạn". Chỉ đẩy lần đầu của nhóm.
- Một người nhận quá 20 thông báo không bắt buộc trong một giờ: phần vượt không đẩy, chỉ nằm trong hộp thông báo.

### 5.4 Quyền và nội dung

- Lúc tạo, kiểm tra người nhận **còn quyền xem** đối tượng. Không còn thì bỏ, không gửi.
- Nội dung sinh riêng theo quyền của từng người nhận. Ví dụ thông báo "deal Won" gửi cho Leader có doanh thu, không có com của thành viên nếu Leader không được xem; thông báo cho Admin về datahub không chứa giá trị ô (giữ luật nhật ký của Module 1). Giá trị cột chèn vào mẫu theo luật ở mục 0.
- Người đang `Chưa kích hoạt`: thông báo vẫn lưu, thấy khi kích hoạt, không đẩy. Người `Đã khoá`: không tạo thông báo.
- Thông báo do AI gây ra ghi rõ kênh: "Dương (qua Claude Desktop) đã đổi Status của deal Thuận Phát".

### 5.5 Bản tin buổi sáng

Mặc định **bật**, 08:00 mọi ngày (Dương chốt 21/11). Mỗi người **chọn giờ gửi và chọn ngày nhận** (tick từng thứ trong tuần), hoặc tắt. Hệ thống không có khái niệm ngày làm việc. Bản tin rơi vào giờ yên lặng (mặc định Chủ nhật) thì chỉ nằm trong chuông, không đẩy. Nội dung gom những việc cần làm hôm nay:

- Số deal trong hàng chờ "Cần chấm lại hôm nay" (Module 4 mục 8).
- Deal đang mở có **Ngày dự kiến chốt** trong 7 ngày tới, và deal đã quá Ngày dự kiến chốt mà vẫn mở.
- Đợt thanh toán chưa về có **Hạn** trong 7 ngày tới hoặc đã quá hạn.
- Nhắc hẹn trong ngày.
- Sau này: việc đến hạn hôm nay (M10), việc onboard hôm nay (M9).

Hai mục ngày đọc cột theo **vai trò cột** (`ngày dự kiến chốt`, `hạn`; Module 4 mục 3.7, 7.6), không theo tên cột: Manager chuyển vai trò sang cột khác thì bản tin đi theo. Không có gì thì không gửi. Bấm vào thì mở view "Ưu tiên hôm nay" của Deals. Đây là câu trả lời cho brief "mỗi ngày vào biết deal nào phải làm".

## 6. Nhắc hạn Deal

Nhắc hạn là **thông báo lõi** của Quản lý Deal, đặt ở Cài đặt → Thông báo (Dương chốt 21/11). Chiến dịch nhắc tự dựng trên bảng bất kỳ là việc của Automation (mục 6.6).

### 6.1 Một quy tắc gồm

| Thành phần | Ghi chú |
|---|---|
| Bảng | Deals hoặc Đợt thanh toán (bảng template của Module 4). Bảng template Manager/Leader tạo thêm có cột ngày cũng chọn được |
| Cột ngày | **Người đặt tự chọn** từ danh sách cột Ngày / Ngày giờ của bảng mà họ xem được, kể cả cột công thức, cột Theo team, cột tuỳ chỉnh của mình. Lưu theo mã cột hoặc vai trò cột (mục 6.3), không theo tên |
| Điều kiện | Bộ lọc như view (Module 2), ví dụ Status đang mở, Trạng thái đợt khác `Đã về` |
| Mốc nhắc | Trước N ngày, đúng ngày, quá hạn N ngày; tối đa 5 mốc. Cột Ngày nhắc lúc 08:30; cột Ngày giờ nhắc theo phút/giờ trước đó |
| Người nhận | Chọn từ: chính mình; người trong cột Người dùng của dòng; người tham gia deal theo vai trò (Leading, mọi người tham gia); Leader, Manager của họ. **Mỗi mốc có thể thêm người nhận riêng**, ví dụ quá 7 ngày thêm Leader |
| Nội dung | Mẫu chèn cột, chọn cột từ danh sách (không gõ tay), ví dụ `{Tên công ty} dự kiến chốt {Ngày dự kiến chốt}` |
| Bắt buộc | Chỉ quy tắc của cây/team: bật thì người nhận không tắt được |

Có nút **Xem trước**: "Hôm nay quy tắc này nhắc 4 dòng, cho 3 người".

### 6.2 Ai đặt quy tắc ở đâu

Quy tắc đi theo **lớp template** như cột (Module 4 mục 3.1), để Manager đặt một lần cho cả cây.

| Lớp | Ai đặt | Người nhận được phép |
|---|---|---|
| Cơ bản / Theo vai trò | Admin, Manager | Người tham gia deal theo vai trò, Leader, Manager trong cây |
| Theo team | Leader | Thành viên team có trong dòng, và Leader |
| Tuỳ chỉnh | Từng người | Chính mình |

Cột chọn được giới hạn theo lớp: quy tắc lớp Cơ bản chỉ dùng cột lớp Cơ bản / Theo vai trò (cột tuỳ chỉnh của một người không có ở người khác). Quy tắc lớp Tuỳ chỉnh dùng được mọi cột người đó xem được.

### 6.3 Cột bị đổi tên, đổi kiểu, xoá

- **Đổi tên:** không ảnh hưởng vì quy tắc lưu mã cột. Trang cài đặt và mẫu nội dung hiện tên mới.
- **Trỏ theo vai trò cột:** quy tắc có sẵn (mục 6.4) trỏ tới vai trò (`ngày dự kiến chốt`, `hạn`), không trỏ cột cụ thể. Manager chuyển vai trò sang cột khác thì quy tắc tự đi theo. Người đặt quy tắc mới được chọn "theo vai trò" hoặc "cột cụ thể".
- **Cột vào thùng rác, bị xoá, đổi sang kiểu không phải ngày**, hoặc người đặt mất quyền xem cột: quy tắc **tạm dừng**, báo người đặt (bắt buộc), trang cài đặt hiện "Cột Closing date đã bị xoá, chọn cột khác". Khôi phục cột thì quy tắc chạy lại. Cột dùng trong điều kiện hay mẫu nội dung bị xoá cũng xử lý như vậy.
- Không bao giờ âm thầm bỏ qua: quy tắc không chạy được thì phải hiện lý do.

### 6.4 Quy tắc có sẵn

Lớp Cơ bản, dựng cùng bộ template mặc định của cây. Manager sửa mốc, người nhận, hoặc tắt.

| Bảng · cột (theo vai trò) | Điều kiện | Mốc → người nhận |
|---|---|---|
| Deals · `ngày dự kiến chốt` | Deal đang mở | Trước 3 ngày, quá 1 ngày → Leading |
| Đợt thanh toán · `hạn` | Đợt chưa về | Trước 3 ngày, đúng ngày, quá 1 ngày → Leading; quá 7 ngày → Leading + Leader |

Không dựa vào Closing date: cột này là công thức, deal mở để trống (Module 4 mục 4.1).

### 6.5 Cách chạy

- Cột Ngày: job lúc 08:30 mỗi ngày, mỗi quy tắc chạy **một câu SQL** trên cột ngày (có index tự động của Module 2) cộng bộ lọc, không duyệt từng dòng. Cột công thức đọc giá trị đã lưu.
- Cột Ngày giờ: job mỗi 5 phút, lấy dòng có mốc rơi vào 5 phút vừa qua.
- Mỗi (quy tắc, dòng, mốc, ngày) chỉ gửi một lần (bảng ghi đã gửi có khoá duy nhất), nên chạy lại hay chạy bù không gửi trùng.
- Worker dừng rồi chạy lại: chạy bù các mốc trong 24 giờ qua; mốc cũ hơn gom thành một thông báo "Bạn có N nhắc hạn bị trễ".
- Một quy tắc khớp quá 50 dòng cho một người một lần: gửi một thông báo gom ("12 deal quá ngày dự kiến chốt") kèm link mở view đã lọc, không gửi 50 thông báo.
- Quy tắc chạy bằng quyền của người đặt; người nhận vẫn qua kiểm tra quyền ở mục 5.4.
- Giới hạn 20 quy tắc lớp Tuỳ chỉnh mỗi người (Admin chỉnh).

### 6.6 Ranh giới với Automation

- **Nhắc hạn Deal** (module này): nhắc lõi của hệ thống, chỉ trên bảng template Deal, đặt ở Cài đặt → Thông báo, chỉ tạo thông báo.
- **Automation** (sau): chiến dịch tạo nhắc/thông báo trên **bảng datahub bất kỳ**, có component Thông báo cho chọn datahub, người nhận, nội dung; component này gọi `notify.send` (mục 0).
- Hai bên dùng chung engine chạy lịch, chống gửi trùng, chạy bù. Nhắc hạn Deal không chuyển thành Automation.

## 7. Thông báo chung

Gửi tay cho nhiều người: "Chính sách com mới từ 1/12", "Họp team 9h mai". SoE Hub thay Lark nên cần kênh này (Dương 21/11).

| Ai gửi | Gửi được cho |
|---|---|
| Admin | Mọi người, hoặc cây/team bất kỳ |
| Manager | Cả cây mình, hoặc team trong cây |
| Leader | Team mình |

Mỗi lần gửi có thể thêm người lẻ nằm trong phạm vi của người gửi.

- **Nội dung:** tiêu đề (bắt buộc, tối đa 120 ký tự), nội dung chữ có định dạng đơn giản (đậm, danh sách, link; tối đa 5.000 ký tự), đính kèm tối đa 5 file (Module 0, file thường).
- **Quan trọng:** người gửi bật thì gửi `important`: đẩy kể cả giờ yên lặng, có toast, ghim đầu hộp thông báo tới khi người nhận đọc.
- **Hẹn giờ gửi:** chọn ngày giờ; hủy được trước giờ gửi.
- **Ai đã đọc:** người gửi thấy "Đã đọc 12/18" và danh sách người chưa đọc.
- **Sửa, thu hồi:** sửa được, người nhận thấy nhãn "Đã sửa". Thu hồi thì thông báo biến mất khỏi hộp của người nhận.
- Người nhận không tắt được thông báo chung (loại bắt buộc). Chống lạm dụng: mỗi người tối đa 10 thông báo chung mỗi ngày (Admin chỉnh).
- Người nhận chốt lúc gửi: người vào team sau không nhận; người rời team vẫn giữ bản đã nhận.
- Trang **Thông báo chung**: tab Đã gửi (của mình) và Đã nhận, để xem lại sau 90 ngày dọn hộp thông báo (thông báo chung giữ 1 năm, Admin chỉnh).
- Qua AI: là **thao tác lớn** (Module 5). AI soạn nháp, người gửi bấm gửi trên web.

## 8. Web Push

- Khoá VAPID sinh bằng lệnh `notify:vapid` khi cài đặt, lưu trong `.env` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`). Không phải đăng ký dịch vụ nào.
- Bảng `push_subscriptions` (người, endpoint, khoá, thiết bị, lần gửi thành công cuối). Trình duyệt báo hết hạn (`404`/`410`) thì xoá.
- Web cần **web app manifest** và service worker tối thiểu (chỉ để nhận đẩy và mở link, không cache dữ liệu offline).
- Trang Cài đặt → Thông báo có nút "Bật thông báo trên thiết bị này", danh sách thiết bị đã bật, nút gửi thử.
- Đăng xuất thì gỡ đăng ký đẩy của thiết bị đó. Đổi mật khẩu, bị khoá thì gỡ mọi thiết bị.
- Làm ngay ở Stage 6 (Dương chốt 21/11).

## 9. API và MCP

- Thông báo: danh sách (lọc theo nhóm, chưa đọc), đếm chưa đọc, đánh dấu đã đọc (một, nhiều, tất cả).
- Cài đặt thông báo của mình: theo loại × kênh, giờ yên lặng, bản tin buổi sáng, tắt theo đối tượng.
- Nhắc hẹn: tạo, sửa, xoá, xong, hoãn, danh sách.
- Quy tắc nhắc hạn: tạo, sửa, bật/tắt, xoá, xem trước, danh sách quy tắc đang áp cho mình.
- Thông báo chung: tạo nháp, gửi/hẹn giờ, sửa, thu hồi, xem ai đã đọc, danh sách đã gửi/đã nhận.
- Đăng ký đẩy: thêm, gỡ, gửi thử. **Không** dùng được qua kết nối AI (là việc của thiết bị).
- MCP (Module 5, menu Thông báo): tool chọn lọc `reminder_create` và `notifications_list`; phần còn lại qua `soe_call`.

## 10. Giao diện tối thiểu (Stage 6)

- Chuông + hộp thông báo: tab Tất cả / Chưa đọc, nhóm theo hôm nay / trước đó, thông báo chung quan trọng ghim đầu, bấm mở đúng chỗ, đánh dấu tất cả đã đọc. Hộp chỉ tải 20 thông báo gần nhất, có link "Xem tất cả".
- Trang Thông báo: đầy đủ, lọc theo nhóm, phân trang keyset.
- Trang Nhắc hẹn: sắp tới, đã xong; tạo nhanh.
- Nút "Nhắc tôi" trong chi tiết deal và chi tiết dòng.
- Cài đặt → Thông báo: các phần ở mục 5.1. Phần Nhắc hạn Deal: danh sách quy tắc theo lớp, tạo/sửa có chọn bảng, cột, điều kiện, mốc, người nhận, xem trước; quy tắc tạm dừng hiện lý do.
- Trang Thông báo chung: soạn, chọn người nhận theo cây/team, hẹn giờ, xem ai đã đọc.
- Toast dùng chung (`apps/web/src/components/ui`) và hộp thoại xác nhận trong ứng dụng; thay 2 chỗ `window.confirm` hiện có ở `apps/web/src/pages/admin.tsx` (chuyển giao dữ liệu, chuyển cây). Bật luật lint `no-alert` cho web.
- Admin: thời hạn giữ thông báo, giới hạn nhắc hẹn, quy tắc, thông báo chung.
- Theo ngoại lệ ở CLAUDE.md: giao diện Stage 6 đủ dùng, không rà chuẩn giao diện (Stage 12).

## 11. Kiểm thử

- Unit: chọn người nhận và kiểm tra quyền từng loại; giờ yên lặng (kể cả qua nửa đêm, Chủ nhật, ngày yên lặng tự chọn); gom 10 phút; giới hạn 20/giờ; lặp lại của nhắc hẹn (cuối tháng, ngày 31); mốc nhắc hạn theo giờ Việt Nam sát nửa đêm.
- Nhắc hạn: đổi tên cột vẫn chạy; chuyển vai trò cột thì quy tắc theo vai trò đi theo; xoá cột thì quy tắc tạm dừng và có thông báo cho người đặt; khôi phục thì chạy lại.
- Không gửi trùng: chạy job nhắc hạn hai lần, worker dừng giữa chừng rồi chạy bù.
- Quyền: người nhận mất quyền xem thì không nhận; nội dung gửi Leader không chứa com của thành viên; giá trị cột chèn vào mẫu thành "—" với người không xem được cột; Admin không thấy giá trị ô datahub; Leader không gửi thông báo chung ra ngoài team.
- Thông báo chung: hẹn giờ, thu hồi, đếm đã đọc, người vào team sau không nhận.
- Web Push với trình duyệt thật trên máy dev (Chrome); iPhone cần domain thật, ghi vào `progress.md` để thử trên VPS.
- Tải: quy tắc nhắc hạn trên 20.000 deal chạy dưới 1 giây mỗi quy tắc.

## 12. Thay đổi so với quy định đã chốt

| Quy định cũ | Đổi thành | Ảnh hưởng |
|---|---|---|
| Bảng `notifications` tối thiểu (Module 1 mục 9), module tự ghi | Thêm `category`, `priority`, `link`, đối tượng, người gây ra, gom, đã đẩy; mọi module gửi qua `notify.send` / `defineNotification` | Module 1, code Stage 1 (thông báo mã kích hoạt) |
| Không có kênh ngoài ứng dụng | Thêm **Web Push** (không email, không dịch vụ trả phí) | `ha-tang.md` (biến VAPID, không phải mua gì) |
| Chuẩn giao diện chưa cấm hộp thoại trình duyệt | Cấm `alert`/`confirm`/`prompt`; báo bằng toast, xác nhận bằng hộp thoại trong ứng dụng; lint `no-alert` | `chuan-giao-dien.md`; sửa 2 chỗ ở `admin.tsx` trong Stage 6 |
| Stage 6 chỉ cần Module 1 (bảng Stage code) | Cần Module 1, 2 (cột ngày, bộ lọc), 4 (Deals, Đợt thanh toán, vai trò cột, lớp template) | CLAUDE.md bảng Stage code. Thứ tự code không đổi vì Stage 6 vẫn sau Stage 4 |

## 13. Câu hỏi còn mở

Không còn. Đã chốt với Dương 21/11: Web Push ở Stage 6; nhắc hẹn chỉ nhắc mình; bản tin 08:00 bật mặc định, người dùng chọn giờ và ngày nhận; nhắc hạn chỉ cho Deal, cột do người đặt chọn, đặt ở Cài đặt → Thông báo; giờ yên lặng 21:00–07:30 và Chủ nhật, người dùng chỉnh được; toast thay hộp thoại trình duyệt; module độc lập, một cửa vào; có thông báo chung. Không làm chat (Dương 21/11): thông báo chung chỉ một chiều.

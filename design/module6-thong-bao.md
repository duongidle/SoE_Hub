# Module 6 — Thông báo, nhắc hẹn, nhắc hạn

> Trạng thái: **Bản nháp vòng 1, chờ Dương phản biện** · 19/11/2026
> Phụ thuộc: [Module 0](module0-nen-tang.md) (outbox, pg-boss, SSE), [Module 1](module1-tai-khoan-phan-quyen.md) (mục 9 thông báo tối thiểu, phạm vi dữ liệu), [Module 2](module2-datahub.md) (cột ngày, bộ lọc, view), [Module 4](module4-quan-ly-deal.md) (deal, hàng chờ BANT, template theo lớp), [Module 5](module5-ket-noi-ai.md) (menu Thông báo cho AI).
> Để module sau: loại thông báo của Form, Knowledge, AI Hub, Onboarding, Workspace do module đó đăng ký (mục 3.3). Gửi qua email, chat ngoài: để Automation.

Ba việc:

- **Thông báo:** hệ thống báo cho đúng người khi có chuyện liên quan đến họ.
- **Nhắc hẹn:** người dùng tự đặt "nhắc tôi lúc…".
- **Nhắc hạn:** quy tắc tự nhắc theo một cột ngày (Closing date, hạn việc…).

---

## 1. Kênh gửi

| Kênh | Khi nào thấy | Ghi chú |
|---|---|---|
| **Trong ứng dụng** | Chuông + hộp thông báo, cập nhật tức thì qua SSE | Luôn có, mọi thông báo đều lưu ở đây |
| **Đẩy trên trình duyệt** (Web Push) | Kể cả khi đã đóng tab | Người dùng tự bật trên từng thiết bị. iPhone phải "Thêm vào màn hình chính" trước |

- Không có email (giữ quyết định ở `ha-tang.md`: hệ thống không gửi email). Không có kênh chat ngoài (Lark, Slack…) ở module này; khi cần thì làm bằng Automation.
- Lý do cần Web Push: nhắc hẹn lúc 14:00 mà người dùng không mở SoE Hub thì nhắc vô ích. Web Push không cần tài khoản dịch vụ ngoài: server tự sinh khoá VAPID, trình duyệt tự lo đường gửi.
- **Nội dung đẩy tối thiểu:** chỉ tiêu đề và link mở, không chứa số tiền, com, giá trị ô, mã xác thực. Bấm vào thì mở SoE Hub, đăng nhập rồi mới thấy chi tiết. Lý do: nội dung đẩy đi qua máy chủ của Google/Apple và hiện trên màn hình khoá.
- Thông báo **nhắc hẹn và nhắc hạn** hiện thêm một toast khi người dùng đang mở ứng dụng. Thông báo thường chỉ làm chuông nhảy số, không bật toast (tránh làm phiền).

## 2. Thông báo

### 2.1 Dữ liệu

Mở rộng bảng `notifications` của Module 1:

| Trường | Ghi chú |
|---|---|
| `type` | Mã loại, theo danh mục (mục 3) |
| `category` | Nhóm để lọc: Deal, Datahub, Kết nối AI, Tài khoản, Nhắc hẹn… |
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
| Deal mình là Leading bị người khác đổi Status, Doanh thu, Closing date | Người Leading | |
| Deal Won chưa chia đủ tỉ lệ | Manager của cây | |
| Kỳ bị khoá / mở lại | Mọi người có deal trong kỳ đó | |
| Chính sách com có phiên bản mới | Mọi người trong cây | |
| Probation KPI của mình bị Manager sửa sau khi commit | Người đó | ✓ |

Không báo khi người khác sửa ô thường của deal (ghi chú, cột tuỳ chỉnh): quá nhiều, ai cần thì xem lịch sử dòng.

### 3.3 Module sau đăng ký thêm

| Module | Loại dự kiến |
|---|---|
| Form (M7) | Có phản hồi mới (gom theo giờ) |
| Knowledge, AI Hub (M8) | Bài/skill chờ duyệt → người duyệt; được duyệt / bị trả lại kèm lý do → tác giả |
| Onboarding (M9) | Việc, checklist được tick → **leader trực tiếp, bắt buộc** (brief yêu cầu "thông báo đầy đủ"); việc quá hạn |
| Workspace (M10) | Được giao việc, việc sắp đến hạn, quá hạn, có phản hồi |
| Feedback (M11) | Feedback mới → Admin; được phản hồi → người gửi |

## 4. Nhắc hẹn

Người dùng tự đặt: "Nhắc tôi gọi lại Thuận Phát lúc 14:00 thứ Năm".

| Trường | Ghi chú |
|---|---|
| Nội dung | Bắt buộc, tối đa 500 ký tự |
| Thời điểm | Ngày giờ theo giờ Việt Nam |
| Lặp lại | Không / hằng ngày / ngày làm việc (thứ Hai–thứ Sáu) / hằng tuần / hằng tháng; có ngày kết thúc |
| Gắn với | Tuỳ chọn: một deal, một dòng datahub, sau này một việc (M10). Bấm thông báo thì mở đúng đối tượng |

- **Chỉ nhắc chính mình.** Nhắc người khác là giao việc, thuộc Workspace (M10), để có hạn, phản hồi, theo dõi. Nếu cho nhắc người khác ở đây thì sẽ có hai cách giao việc chồng nhau.
- Tạo từ: nút "Nhắc tôi" ở chi tiết deal, chi tiết dòng, trang Nhắc hẹn; và từ AI qua MCP ("nhắc tớ chiều mai 3h gọi khách X").
- Khi đến giờ: thông báo `important`, có toast nếu đang mở ứng dụng, có đẩy nếu đã bật. Ba nút: **Xong**, **Nhắc lại sau 1 giờ**, **Sáng mai 08:30**.
- Đặt giờ trong quá khứ thì báo lỗi ngay ở ô nhập. Gắn với đối tượng mà sau đó mất quyền xem thì vẫn nhắc nội dung, link báo không còn quyền.
- Giới hạn 200 nhắc hẹn đang chờ mỗi người (Admin chỉnh).

## 5. Quy tắc gửi

### 5.1 Ai được tắt gì

- Trang **Cài đặt → Thông báo**: bảng loại thông báo (theo nhóm) × kênh (Trong ứng dụng / Đẩy). Loại bắt buộc hiện nhưng khoá, ghi "Không tắt được".
- Tắt theo đối tượng: "Tắt thông báo deal này" trong chi tiết deal.
- Không bao giờ báo cho chính người gây ra (sửa deal của mình thì không tự nhận thông báo). Nhắc hẹn, nhắc hạn là ngoại lệ.

### 5.2 Giờ yên lặng

- Mặc định 21:00–07:30 mỗi ngày, cả ngày Chủ nhật. Mỗi người chỉnh hoặc tắt.
- Trong giờ yên lặng: thông báo vẫn lưu và chuông vẫn nhảy số, nhưng **không đẩy**. Nhắc hẹn, nhắc hạn và loại `important` vẫn đẩy (người dùng tự đặt giờ thì tôn trọng giờ đó).

### 5.3 Gom

- Cùng `group_key` (loại + đối tượng) trong 10 phút và người nhận chưa đọc: cập nhật thông báo cũ thay vì tạo mới. Ví dụ "Linh và 2 người khác đã chia sẻ 3 bảng với bạn". Chỉ đẩy lần đầu của nhóm.
- Một người nhận quá 20 thông báo không bắt buộc trong một giờ: phần vượt không đẩy, chỉ nằm trong hộp thông báo.

### 5.4 Quyền và nội dung

- Lúc tạo, kiểm tra người nhận **còn quyền xem** đối tượng. Không còn thì bỏ, không gửi.
- Nội dung sinh riêng theo quyền của từng người nhận. Ví dụ thông báo "deal Won" gửi cho Leader có doanh thu, không có com của thành viên nếu Leader không được xem; thông báo cho Admin về datahub không chứa giá trị ô (giữ luật nhật ký của Module 1).
- Người đang `Chưa kích hoạt`: thông báo vẫn lưu, thấy khi kích hoạt, không đẩy. Người `Đã khoá`: không tạo thông báo.
- Thông báo do AI gây ra ghi rõ kênh: "Dương (qua Claude Desktop) đã đổi Status của deal Thuận Phát".

### 5.5 Bản tin buổi sáng

Một thông báo mỗi ngày làm việc lúc 08:00 (người dùng đổi giờ hoặc tắt; mặc định **bật**), gom những việc cần làm hôm nay:

- Số deal trong hàng chờ "Cần chấm lại hôm nay" (Module 4 mục 8).
- Deal đang mở có Closing date trong 7 ngày tới, và deal đã quá Closing date mà vẫn mở.
- Nhắc hẹn trong ngày.
- Sau này: việc đến hạn hôm nay (M10), việc onboard hôm nay (M9).

Không có gì thì không gửi. Bấm vào thì mở view "Ưu tiên hôm nay" của Deals. Đây là câu trả lời cho brief "mỗi ngày vào biết deal nào phải làm".

## 6. Nhắc hạn

Quy tắc tự nhắc dựa trên **một cột ngày** của một bảng.

### 6.1 Một quy tắc gồm

| Thành phần | Ví dụ |
|---|---|
| Bảng và cột ngày | Deals · Closing date |
| Điều kiện | Bộ lọc Module 0, ví dụ Status đang mở |
| Mốc nhắc | Trước 3 ngày, đúng ngày, quá hạn 1 ngày; tối đa 5 mốc. Cột Ngày nhắc lúc 08:30; cột Ngày giờ nhắc theo phút/giờ trước đó |
| Người nhận | Chủ quy tắc; hoặc người trong một cột Người dùng của dòng (ví dụ người Leading) |
| Nội dung | Mẫu có chèn cột, ví dụ `{Tên công ty} chốt ngày {Closing date}` |

### 6.2 Ai đặt quy tắc ở đâu

| Bảng | Ai đặt | Người nhận được phép |
|---|---|---|
| Bảng datahub của mình | Chủ | Chính mình (người được chia sẻ không bị nhắc theo quy tắc của người khác) |
| Deals, lớp Tuỳ chỉnh | Từng người | Chính mình |
| Deals, lớp Theo team | Leader | Thành viên team có trong deal, và Leader |
| Deals, lớp Cơ bản / Theo vai trò | Admin, Manager | Người tham gia deal theo vai trò, Leader, Manager |

Quy tắc của Deals đi theo **lớp template** như cột (Module 4 mục 3.1), để Manager đặt một lần cho cả cây.

### 6.3 Quy tắc có sẵn

| Bảng | Quy tắc | Gửi cho |
|---|---|---|
| Deals | Deal đang mở đã quá Closing date 1 ngày: "Cập nhật Status hoặc dời Closing date" | Người Leading |
| Deals | Deal đang mở, Closing date trong 3 ngày tới | Người Leading |

Cả hai nằm ở lớp Cơ bản, Manager tắt hoặc sửa được.

### 6.4 Cách chạy

- Cột Ngày: job lúc 08:30 mỗi ngày, mỗi quy tắc chạy **một câu SQL** trên cột ngày (có index tự động của Module 2) cộng bộ lọc, không duyệt từng dòng.
- Cột Ngày giờ: job mỗi 5 phút, lấy dòng có mốc rơi vào 5 phút vừa qua.
- Mỗi (quy tắc, dòng, mốc, ngày) chỉ gửi một lần (bảng ghi đã gửi có khoá duy nhất), nên chạy lại hay chạy bù không gửi trùng.
- Worker dừng rồi chạy lại: chạy bù các mốc trong 24 giờ qua; mốc cũ hơn gom thành một thông báo "Bạn có N nhắc hạn bị trễ".
- Một quy tắc khớp quá 50 dòng một lần: gửi một thông báo gom ("12 deal quá Closing date") kèm link mở view đã lọc, không gửi 50 thông báo.
- Quy tắc chạy bằng quyền của chủ quy tắc; người nhận vẫn qua kiểm tra quyền ở mục 5.4.
- Giới hạn 20 quy tắc mỗi người (Admin chỉnh).

### 6.5 Ranh giới với Automation

Nhắc hạn **chỉ tạo thông báo**, không sửa dữ liệu, không gọi command. Khi thiết kế Automation, quy tắc nhắc hạn trở thành một Automation có sẵn (trigger theo lịch trên cột ngày + điều kiện + hành động "gửi thông báo"); dữ liệu quy tắc giữ cấu trúc để chuyển đổi được.

## 7. Web Push

- Khoá VAPID sinh bằng lệnh `notify:vapid` khi cài đặt, lưu trong `.env` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`). Không phải đăng ký dịch vụ nào.
- Bảng `push_subscriptions` (người, endpoint, khoá, thiết bị, lần gửi thành công cuối). Trình duyệt báo hết hạn (`404`/`410`) thì xoá.
- Web cần **web app manifest** và service worker tối thiểu (chỉ để nhận đẩy và mở link, không cache dữ liệu offline).
- Trang Cài đặt → Thông báo có nút "Bật thông báo trên thiết bị này", danh sách thiết bị đã bật, nút gửi thử.
- Đăng xuất thì gỡ đăng ký đẩy của thiết bị đó. Đổi mật khẩu, bị khoá thì gỡ mọi thiết bị.

## 8. API và MCP

- Thông báo: danh sách (lọc theo nhóm, chưa đọc), đếm chưa đọc, đánh dấu đã đọc (một, nhiều, tất cả).
- Cài đặt thông báo của mình: theo loại × kênh, giờ yên lặng, bản tin buổi sáng, tắt theo đối tượng.
- Nhắc hẹn: tạo, sửa, xoá, xong, hoãn, danh sách.
- Quy tắc nhắc hạn: tạo, sửa, bật/tắt, xoá, xem trước ("hôm nay quy tắc này sẽ nhắc 4 dòng").
- Đăng ký đẩy: thêm, gỡ, gửi thử. **Không** dùng được qua kết nối AI (là việc của thiết bị).
- MCP (Module 5, menu Thông báo): tool chọn lọc `reminder_create` và `notifications_list`; phần còn lại qua `soe_call`.

## 9. Giao diện tối thiểu (Stage 6)

- Chuông + hộp thông báo: tab Tất cả / Chưa đọc, nhóm theo hôm nay / trước đó, bấm mở đúng chỗ, đánh dấu tất cả đã đọc. Hộp chỉ tải 20 thông báo gần nhất, có link "Xem tất cả".
- Trang Thông báo: đầy đủ, lọc theo nhóm, phân trang keyset.
- Trang Nhắc hẹn: sắp tới, đã xong; tạo nhanh.
- Nút "Nhắc tôi" trong chi tiết deal và chi tiết dòng.
- Nút **Nhắc hạn** trên thanh công cụ của bảng: danh sách quy tắc của bảng, tạo/sửa có xem trước.
- Cài đặt → Thông báo: bảng loại × kênh, giờ yên lặng, bản tin buổi sáng, thiết bị nhận đẩy.
- Admin: cài đặt thời hạn giữ thông báo, giới hạn nhắc hẹn và quy tắc.

## 10. Kiểm thử

- Unit: chọn người nhận và kiểm tra quyền từng loại; giờ yên lặng (kể cả qua nửa đêm, Chủ nhật); gom 10 phút; giới hạn 20/giờ; lặp lại của nhắc hẹn (cuối tháng, ngày 31, ngày làm việc); mốc nhắc hạn theo giờ Việt Nam sát nửa đêm.
- Không gửi trùng: chạy job nhắc hạn hai lần, worker dừng giữa chừng rồi chạy bù.
- Quyền: người nhận mất quyền xem thì không nhận; nội dung gửi Leader không chứa com của thành viên; Admin không thấy giá trị ô datahub.
- Web Push với trình duyệt thật trên máy dev (Chrome); iPhone cần domain thật, ghi vào `progress.md` để thử trên VPS.
- Tải: quy tắc nhắc hạn trên 20.000 deal chạy dưới 1 giây mỗi quy tắc.

## 11. Thay đổi so với quy định đã chốt

| Quy định cũ | Đổi thành | Ảnh hưởng |
|---|---|---|
| Bảng `notifications` tối thiểu (Module 1 mục 9) | Thêm `category`, `priority`, `link`, đối tượng, người gây ra, gom, đã đẩy | Module 1, code Stage 1 |
| Không có kênh ngoài ứng dụng | Thêm **Web Push** (không email, không dịch vụ trả phí) | `ha-tang.md` (biến VAPID, không phải mua gì) |
| Stage 6 chỉ cần Module 1 (bảng Stage code) | Cần Module 1, 2 (cột ngày, bộ lọc), 4 (Deals, lớp template, hàng chờ BANT) | CLAUDE.md bảng Stage code. Thứ tự code không đổi vì Stage 6 vẫn sau Stage 4 |

## 12. Câu hỏi cho Dương

1. Làm Web Push ngay ở Stage 6 (mục 1, 7)? Không làm thì nhắc hẹn chỉ thấy khi đang mở SoE Hub.
2. Nhắc hẹn chỉ nhắc chính mình, nhắc người khác thì giao việc ở Workspace (mục 4)?
3. Bản tin buổi sáng 08:00 bật mặc định (mục 5.5)?
4. Nhắc hạn đặt được trên mọi bảng datahub, không chỉ Deals (mục 6)? Đây là một phần nhỏ của Automation làm trước, giới hạn ở việc gửi thông báo.
5. Giờ yên lặng mặc định 21:00–07:30 và cả Chủ nhật (mục 5.2)?

# Module 6: quyết định khi code

## 6A1 (22/11/2026)

- **Quyền mới `notification:manage`** (cài đặt thông báo, nhắc hẹn) cho mọi người đã đăng nhập; `notification:read` giữ cho xem. Lệnh `reminder.*` vào menu `notify` bằng luật tên (`ai-policy.ts` RULES).
- **Id chống trùng** là `stableId(ev.id, type)` (và thêm `key` khi một sự kiện sinh nhiều thông báo cùng loại cho một người), không dùng thẳng `ev.id`: một sự kiện có thể sinh nhiều loại cho cùng người (đổi vai trò và bị bỏ).
- **Thay đổi người tham gia deal và Probation KPI** nhận biết bằng `row_history` của đúng giao dịch, không thêm sự kiện mới vào `rows.ts` (phần dùng chung). So `old` và `new` của các cột vai trò `nguoi_tham_gia`; nhiều cột cùng vai trò gộp theo người. "Đổi vai trò hoặc tỉ lệ" nhận biết khi thuộc tính của người đó khác trước (không nói giá trị).
- **Probation KPI sửa sau commit:** người nhận là người trong `dh_tables.key_columns` của dòng; coi là "đã commit" khi trạng thái cũ (hoặc hiện tại nếu không đổi) có nghĩa `committed`; chỉ sửa cột `ly_do_sua` thì không báo.
- **Tiền về xác nhận:** thêm sự kiện `deal.payment.confirmed` từ `payment.confirm`, mang tên deal và người tham gia, không mang số tiền. Một thông báo mỗi deal.
- **Nhắc lặp:** `due_at` luôn là lần nhắc kế tiếp. Bấm Xong ở nhắc lặp không dừng chuỗi (muốn dừng thì xoá); hoãn một nhắc lặp tạo bản sao một lần. Nhắc đã nhắc xong (không lặp) có trạng thái `fired` đến khi bấm Xong; `fired` không tính vào giới hạn 200 (chỉ `pending`). Chạy trễ nhiều ngày: gửi một thông báo, lần kế tiếp tính sau bây giờ.
- **Gắn đối tượng:** nhắc hẹn lưu `object_type` (`deal` | `row`) và id dòng; link dựng lúc gửi từ dòng (route tự kiểm quyền khi mở), không kiểm quyền xem lúc tạo.
- **Kết nối AI sắp hết hạn:** job 08:00 hằng ngày báo kết nối `active` còn dưới 7 ngày, một lần cho mỗi kết nối.
- **Chưa làm (để 6A2/6B):** cờ `morning_digest` đã có, bản tin chưa đọc nó; giao diện chuông và trang Nhắc hẹn; kiểm quyền xem dòng khi dựng link nhắc hẹn; các loại "Kỳ bị khoá", "Template đổi", "Chính sách com mới", "Deal Won chưa chia đủ" (dời theo mục 14).

## Opus rà 6A1 (22/11/2026)

- Nhắc hẹn: nhắc không lặp sau khi gửi ở trạng thái `fired` tới khi bấm Xong, không tính vào giới hạn 200; nhắc lặp bấm Xong thì chuỗi vẫn chạy (dừng = xoá); snooze nhắc lặp tạo bản sao một lần: đồng ý.
- Nhắc gắn dòng không kiểm quyền lúc tạo, route mở link tự kiểm: chấp nhận (nhắc chỉ cho chính mình, nội dung do người đó viết).
- Subscriber thông báo chạy thêm truy vấn cho mỗi `datahub.row.created/updated`: 6A2 thêm lối thoát sớm theo `role_set` của bảng (chỉ bảng Deals, Probation KPI mới đọc tiếp; nhớ đệm theo bảng) và đo một lần import 5.000 dòng vào bảng thường (ghi số vào `progress.md`).
- Mốc typecheck: apps/api 15 lỗi có sẵn (`http/app.ts`, `auth/google.ts`), không phải 0.

## 6A2 (22/11/2026)

- **Subscriber thoát sớm:** `roleSetOfTable` (nhớ đệm 60 giây theo bảng): người tham gia chỉ đọc khi bảng `role_set = deals`, Probation KPI chỉ khi `kpi`. Bảng Đợt thanh toán (cũng có cột vai trò `nguoi_tham_gia`) không còn báo "được thêm vào deal" (đã có ở Deals).
- **Đọc bảng của cây:** bản tin và nhắc hạn đọc bảng gốc của template cây Manager (`roleTable`, quyền hệ thống) rồi lọc theo người nhận như khoá phân chia (Manager thấy hết; người khác thấy dòng có người mình hoặc người mình quản lý trong cột khoá). Không gọi lệnh bằng quyền từng người (một câu SQL cho cả cây).
- **Deal đang mở** = Status không thuộc lựa chọn có `meaning` khác `open` (như forecast); **đợt chưa về** = cột `ngay_tien_ve` trống.
- **Leading:** thuộc tính `vai_tro` = Leading (không phân biệt hoa thường) hoặc cột người tham gia tên "Leading". Deal không có Leading thì không ai nhận mốc `leading` (chưa có quy tắc dự phòng).
- **Người nhận mốc `leader`/`manager`:** Leader hiện tại của người Leading (org hiện tại); Manager của cây. `participants` = mọi người trong các cột người tham gia.
- **Cấu hình theo cây:** `system_settings` (không thêm bảng); quy tắc chưa lưu dùng mặc định. Mốc `on` luôn 0 ngày. Quy tắc nhắc hạn là loại `mandatory`.
- **Chạy bù:** dấu chạy theo ngày mỗi cây; lỡ thì lần sau chạy từ hôm qua. Nội dung ghi ngày hạn, không ghi "N ngày" cố định nên thông báo bù vẫn đúng. Bảng "đã gửi" là khoá duy nhất `notifications(source_event_id, user_id)` (không tạo bảng riêng); thông báo gom có `key = all`.
- **Bản tin:** dùng `morning_digest` (mặc định bật); người không thuộc cây chỉ có phần nhắc hẹn trong ngày. Link bản tin tới `/quan-ly-deal/<bảng Deals>?quick=priority` (6B nối đúng tham số mở view "Ưu tiên hôm nay").
- **Thông báo chung:** quyền mới `notification:announce` (Admin, Manager, Leader); người nhận = người đang hoạt động (kể cả Guest nằm trong cây), trừ người gửi; số người nhận chốt lúc gửi (`announcement_recipients`); thu hồi xoá thông báo khỏi hộp nhưng giữ bản ghi; "đã đọc" tính theo thông báo của người nhận còn `read_at` rỗng (thông báo đã bị dọn thì tính đã đọc). Chưa có giới hạn 10 thông báo/ngày (mục 7), đính kèm, hẹn giờ, sửa (dời).

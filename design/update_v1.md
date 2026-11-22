# Update v1 — việc dời sau phiên bản đầu

> Tạo 22/11/2026 (Dương yêu cầu). Gom những phần **đã có trong thiết kế đã chốt nhưng dời** để Stage chạy nhanh. Làm sau khi app hoàn thiện phiên bản đầu (xong Stage 12), thành đợt update đầu tiên.
> Quy định: mỗi lần rà phạm vi mà dời một phần thiết kế, ghi vào đây (module, mục thiết kế gốc, lý do dời, lúc nào cần). Làm xong thì xoá dòng. Lỗi nhỏ, nợ kỹ thuật ngắn hạn vẫn ở `progress.md` "Còn nợ".

## Module 4 — Quản lý Deal

| Việc | Thiết kế gốc | Lý do dời / khi nào cần |
|---|---|---|
| Bảng ánh xạ BPM, lệnh `deal.upsert` riêng | Module 4 mục 7.1, 14 | Làm khi nối BPM thật (4.7, Dương 22/11) |
| Bù cột cho cây đang chạy (cột mới, `Mã ngoài`, cột team thành công thức) | Module 4, 4.7 | Chỉ cần cho cây tạo trước 4.7; làm trước khi nhập dữ liệu thật |
| Sinh lại snapshot drizzle cho migration 0021, 0022, 0023 (viết tay) | — | Khi `drizzle-kit` chạy được; kiểm `db:generate` không sinh diff thừa |

## Module 5 — Kết nối AI (Dương chốt 22/11, Module 5 mục 12)

| Việc | Thiết kế gốc | Lý do dời / khi nào cần |
|---|---|---|
| OAuth 2.1 + PKCE + `resource`, Client ID Metadata Document, DCR, trang cho phép `/oauth/authorize` (375px), xoay refresh token; danh sách nguồn client cho phép | mục 2.3, 2.4, 6 | claude.ai, Claude Desktop, ChatGPT cần domain thật: làm khi lên VPS |
| Key API của cây (Manager tạo, Admin duyệt; Admin tạo thì Manager nhận), `docs/api/he-thong-ngoai.md` | mục 2.5, 8 | Làm cùng lúc nối BPM |
| Thao tác lớn qua AI: xem trước + mã xác nhận, "Kiểm khi chốt qua AI"; tới lúc đó chốt kỳ, mở lại kỳ, xác nhận đợt import, sửa template cây/team, chuyển vai trò cột cấm AI | mục 3.4 | Việc nên để người bấm trên web; làm khi Manager cần |
| Mở rộng quyền kết nối "phần mở rộng chờ duyệt, phần cũ vẫn chạy" (hiện: tạo kết nối mới) | mục 2.2 | Khi người dùng thấy phiền |
| Chính sách AI: mức cao nhất toàn hệ thống, hạn tối đa riêng | mục 6 | Khi Admin cần |
| Giới hạn 5.000 dòng ghi/giờ | mục 5 | Khi có lạm dụng |
| Phân trang danh sách token và tài khoản hệ thống | mục 7 | Khi quá vài trăm token |
| Tool chọn lọc còn lại: `soe_find`, `datahub_list`, `datahub_create`, `table_schema`, `table_alter`, `formula_check`, `deal_update`, `deal_bant_score`, `deals_rescore_queue`, `payment_schedule`, `payment_match`, `payment_confirm`, `dashboard_get`, `dashboard_save` (hiện đi qua `soe_call`) | mục 4.2 | Thêm theo nhật ký dùng (mục 4.8) |
| Chỗ dở 5A2: `metrics_query` đợi `consistent`; `deals_list` `period_mode: expected` tính đợt chưa về hạn như forecast; thử Codex thật | mục 4.3, 4.6 | Khi dùng thật thấy cần |
| Ma trận quyền đầy đủ theo kênh MCP × mức × nhóm cấm | mục 9 | Kiểm thử Stage 12 hoặc trước khi lên production |

## Module 6 — Thông báo (Dương chốt 22/11, Module 6 mục 14)

| Việc | Thiết kế gốc | Lý do dời / khi nào cần |
|---|---|---|
| Web Push (VAPID, manifest, service worker, `push_subscriptions`, thiết bị, gửi thử) và giờ yên lặng | mục 1, 5.2, 8 | Chưa có người dùng thật trước VPS; iPhone cần domain thật. Làm khi lên VPS |
| Nhắc hạn tự dựng: quy tắc theo lớp (Cơ bản/Theo vai trò/Team/Tuỳ chỉnh), điều kiện lọc, người nhận riêng từng mốc, mẫu chèn cột, xem trước, cột Ngày giờ (job 5 phút), tạm dừng khi cột bị xoá, gom quá 50 dòng | mục 6.1–6.3, 6.5 | Hiện chỉ 2 quy tắc có sẵn + bản tin buổi sáng; làm khi Manager/Leader cần quy tắc riêng (hoặc gộp vào Automation) |
| Thông báo chung: đính kèm, hẹn giờ gửi, sửa sau khi gửi (nhãn "Đã sửa"), giới hạn 10/ngày, giữ 1 năm riêng | mục 7 | Khi dùng thật thấy cần |
| Gom thông báo 10 phút, giới hạn 20 thông báo/giờ, tắt thông báo theo đối tượng | mục 5.1, 5.3 | Khi lượng thông báo nhiều |
| Bản tin buổi sáng: chọn giờ, chọn ngày nhận (hiện cố định 08:00, chỉ bật/tắt) | mục 5.5 | Khi người dùng cần |
| Loại thông báo: deal mình Leading bị người khác sửa, template Deals đổi, chính sách com mới, kỳ khoá/mở, deal Won chưa chia đủ tỉ lệ | mục 3.2 | Thêm bằng `defineNotification` khi cần |
| Admin chỉnh thời hạn giữ thông báo, giới hạn nhắc hẹn/quy tắc | mục 10 | Hiện là hằng số |
| Phân trang `announcement.list_*` (hiện chỉ `limit`); nút Xem trước của 2 quy tắc nhắc hạn | mục 6.1, 7 | Khi danh sách dài / Manager cần |

# Kết nối AI với SoE Hub

Hướng dẫn cho người dùng. Thiết kế chi tiết: `design/module5-ket-noi-ai.md` (mục 12 là phạm vi đang làm).

AI (Claude Code, Codex) và script nối vào SoE Hub bằng một **kết nối**: token cá nhân kèm danh sách menu và mức. Server trả kết quả đã tính sẵn nên tốn ít token. Kết nối không bao giờ rộng hơn quyền của chính cậu, và không chạm được Onboarding.

## 1. Tạo kết nối

1. Vào **Cài đặt → Kết nối AI**, đặt tên (ví dụ "Claude Code máy công ty"), chọn menu, mức và hạn (mặc định 90 ngày, tối đa 365).
2. Menu hiện có: Quản lý Deal, Datahub, Thông báo và nhắc hẹn. Mức: **Xem** (đọc), **Sửa** (đọc và ghi), **Toàn quyền** (thêm xoá nhiều, đổi kiểu cột, thay toàn bộ dữ liệu khi nhập).
3. Token chỉ hiện **một lần**, kèm lệnh cài điền sẵn. Sao chép ngay.
4. Kết nối ở trạng thái **Chờ duyệt** tới khi Admin duyệt. Admin có thể duyệt ít quyền hơn cậu xin.
5. Muốn bớt quyền: nút **Thu hẹp** (hiệu lực ngay). Muốn thêm quyền: tạo kết nối mới. Thu hồi bất cứ lúc nào.

## 2. Cài vào AI

Thay `<domain>` bằng địa chỉ SoE Hub của công ty và `<token>` bằng token vừa tạo.

- **Claude Code:** `claude mcp add --transport http soe https://<domain>/mcp --header "Authorization: Bearer <token>"`
- **Codex:** thêm vào `~/.codex/config.toml` (chưa kiểm trên máy thật):
  ```
  [mcp_servers.soe]
  url = "https://<domain>/mcp"
  http_headers = { Authorization = "Bearer <token>" }
  ```
- **REST / script:** `curl -H "Authorization: Bearer <token>" https://<domain>/api/v1/datahubs`. Danh sách thao tác: `docs/api/openapi.json`, request mẫu: `docs/api/bruno/`.

Rồi nói với AI, ví dụ "deal nào của tớ sắp đến hạn chốt", "winrate quý này của tớ", "tạo bảng theo dõi lead".

## 3. Nhóm cấm

Có 5 nhóm thao tác AI **không** được làm mặc định: Tổ chức, Cấp dữ liệu Guest, Chuyển giao dữ liệu, Cài đặt hệ thống, Nhật ký. Admin bật từng nhóm ở **Quản trị → Kết nối AI → Chính sách**. Một số thao tác (đăng nhập, token, Onboarding) cấm hẳn, Admin cũng không bật được. Chốt kỳ, mở lại kỳ, xác nhận tiền về hàng loạt, sửa template chưa mở cho AI.

Admin có công tắc **Tạm tắt mọi kết nối AI** cho tình huống khẩn cấp; bật thì mọi kết nối bị từ chối, web không ảnh hưởng.

## 4. Lỗi thường gặp

| Lỗi | Ý nghĩa | Cách xử lý |
| --- | --- | --- |
| `connection_pending` | Kết nối chưa được Admin duyệt | Báo Admin duyệt |
| `401` | Token sai, hết hạn, bị thu hồi hoặc bị từ chối | Tạo kết nối mới |
| `429` | Quá 120 lần gọi hoặc 30 lần ghi mỗi phút của một kết nối | Chờ số giây trong lỗi |
| "chưa có menu ..." | Kết nối không có menu của thao tác này | Tạo kết nối mới có menu đó |
| "chỉ có mức Xem/Sửa ..." | Thao tác cần mức cao hơn | Tạo kết nối mới có mức cao hơn |
| `ai_not_allowed` | Thao tác cấm AI, nhóm chưa bật, hoặc Admin đang tắt khẩn cấp | Hỏi Admin |

Nhập dữ liệu (import) qua AI dùng menu của bảng đích: nhập vào bảng Deals cần menu Quản lý Deal; nhập vào Datahub cần Datahub mức Sửa; chế độ thay toàn bộ cần Toàn quyền.

## 5. Chưa có (làm khi lên VPS)

Claude Desktop, claude.ai và ChatGPT nối bằng đăng nhập OAuth (Settings → Connectors → dán `https://<domain>/mcp`, đăng nhập SoE Hub, chờ Admin duyệt). Phần này cần địa chỉ công khai có HTTPS nên làm khi triển khai lên VPS; tới lúc đó dùng token như trên.

# Bộ request Bruno của SoE Hub

Mở thư mục này bằng [Bruno](https://www.usebruno.com/), chọn môi trường `dev`.

Xác thực: mọi request cần đăng nhập gửi `Authorization: Bearer {{token}}`.

1. Đăng nhập web, vào **Tài khoản → Token cá nhân**, tạo token với các scope cần thử.
2. Nhờ một Admin duyệt token (token chờ duyệt chưa dùng được).
3. Dán token vào biến bí mật `token` của môi trường `dev` (Bruno không lưu biến bí mật vào file).

Thao tác tài khoản (`auth:*`: đổi mật khẩu, thiết bị, token) và `onboarding:*` không dùng được bằng token; dùng giao diện web.
Request `auth/login` đăng nhập bằng cookie; khi gọi lệnh ghi bằng cookie phải gửi thêm header `X-CSRF-Token: {{csrf}}`.

Thêm request cho thao tác mới: `pnpm docs:bruno` (chỉ thêm file còn thiếu, không ghi đè), rồi sửa ví dụ cho hợp lý.

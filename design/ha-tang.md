# Thiết kế hạ tầng

> Trạng thái: **Đã chốt** · 18/11/2026 · Kiến trúc ứng dụng: xem [module0-nen-tang.md](module0-nen-tang.md).

## 1. Checklist cần chuẩn bị

| # | Hạng mục | Yêu cầu tối thiểu | Khuyến nghị | Ghi chú |
|---|---|---|---|---|
| 1 | VPS | 2 vCPU · 4 GB RAM · 60 GB SSD · Ubuntu 24.04 LTS · IPv4 public | 4 vCPU · 8 GB RAM · 80–100 GB SSD | Đặt ở Việt Nam hoặc Singapore để tải nhanh. Cho phép SSH bằng key. Giá tham khảo 200–500k VND/tháng, kiểm lại lúc mua |
| 2 | Domain | Một tên miền hoặc subdomain trỏ về VPS (bản ghi A) | Subdomain riêng, ví dụ `hub.<domain>` | Bắt buộc: HTTPS, OAuth Google, connector Claude đều cần domain |
| 3 | Lưu file | Bucket S3-compatible | Cloudflare R2 | Gói miễn phí đủ giai đoạn đầu. Hoặc chạy MinIO ngay trên VPS (khi đó backup file phải đẩy ra ngoài) |
| 4 | Lưu backup | Một nơi lưu **khác máy với VPS** | Cloudflare R2 (bucket riêng) hoặc Backblaze B2 | Backup nằm trên chính VPS thì mất VPS là mất hết |
| 5 | Google Cloud project | Một project, loại OAuth **External** | — | Dùng cho đăng nhập Google (phụ). Hướng dẫn ở mục 4 |
| 6 | Theo dõi uptime | Dịch vụ ping `/health` mỗi 1–5 phút | UptimeRobot hoặc Better Stack (gói miễn phí) | Báo khi hệ thống chết |
| 7 | Theo dõi lỗi | Không bắt buộc ngay | Sentry (gói miễn phí) hoặc GlitchTip tự host | Gom lỗi runtime |
| 8 | Email gửi đi | **Không cần** | — | Quên mật khẩu đi qua thông báo trong ứng dụng. Chỉ thêm nếu sau này cần thông báo qua email |

## 2. Sơ đồ triển khai

```
Internet ──► Caddy (443, TLS tự động) ──┬──► api (Node)  ──┐
                                         │   (REST, MCP,    │
                                         │    web tĩnh,     ├──► PostgreSQL 17 (không mở ra ngoài)
                                         │    form công khai)│
                                         └──► worker (Node) ─┘
                                                   │
                                                   └──► S3 (R2 / MinIO): file
Backup hằng đêm ──► bucket backup (khác máy)
```

Tất cả chạy bằng Docker Compose trên một VPS. Chỉ mở cổng 80, 443 và SSH.

## 3. Backup và khôi phục

| Thứ | Cách | Tần suất | Giữ |
|---|---|---|---|
| Database | `pg_dump` nén + mã hoá, đẩy lên bucket backup | Hằng đêm | 30 bản ngày + 12 bản tháng |
| File | Đồng bộ bucket file sang bucket backup (nếu dùng MinIO trên VPS) | Hằng đêm | Theo bucket |
| Cấu hình | File `.env` lưu ở nơi an toàn ngoài VPS (password manager) | Khi đổi | — |

Mỗi quý thử khôi phục một lần lên máy dev. Backup chưa từng khôi phục thử thì chưa coi là có backup.

## 4. Đăng nhập Google (External)

1. Vào Google Cloud Console bằng một tài khoản Google, tạo project (ví dụ `soe-hub`).
2. Mục **OAuth consent screen**: chọn **External**; điền tên app, email hỗ trợ, domain của hệ thống; chỉ chọn quyền `openid`, `email`, `profile`.
3. Chuyển trạng thái sang **In production**. Với ba quyền cơ bản này, thường không phải qua thẩm định của Google.
4. Mục **Credentials** → tạo **OAuth client ID** loại *Web application*. Redirect URI: `https://<domain>/api/auth/callback/google`.
5. Đưa `Client ID` và `Client secret` vào `.env` của server.

Server chỉ chấp nhận email đã có tài khoản trong SoE Hub, nên một người lạ có tài khoản Google cũng không vào được.

## 5. Kết nối AI

- Không cần đăng ký gì với Anthropic hay OpenAI.
- Endpoint `/mcp` phải truy cập được từ internet, vì connector của Claude Desktop/claude.ai gọi từ server của Anthropic.
- Nếu muốn siết: tường lửa chỉ cho dải IP của Anthropic vào `/mcp`. Nhưng khi đó Claude Code và Codex (gọi từ máy user) cũng bị chặn, nên mặc định **không** bật.

## 6. Bảo mật máy chủ

- SSH chỉ bằng key, tắt đăng nhập root bằng mật khẩu.
- Tường lửa (ufw) chỉ mở 22, 80, 443.
- Bật cập nhật bảo mật tự động của Ubuntu.
- Postgres chỉ nghe trong mạng nội bộ Docker.
- Secret chỉ nằm trong `.env` trên server và trong password manager, không nằm trong git.

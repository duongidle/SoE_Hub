# Kết nối AI với SoE Hub

Hướng dẫn cho người dùng (thiết kế chi tiết ở `design/module5-ket-noi-ai.md`). Tách từ `CLAUDE.md` ngày 20/11/2026.


SoE Hub cung cấp sẵn bộ công cụ cho AI qua MCP. AI không cần mở trình duyệt hay viết script; server trả kết quả đã tính sẵn nên tốn ít token. AI chỉ làm được những gì kết nối đó được cấp quyền, và không bao giờ chạm được Onboarding.

Cài một lần:

- **Claude Desktop / claude.ai:** Settings → Connectors → Add custom connector → dán `https://<domain>/mcp`. Trình duyệt mở trang đăng nhập SoE Hub → đăng nhập → bấm cho phép → chờ admin duyệt kết nối.
- **Claude Code:** lấy token trong Cài đặt của SoE Hub, rồi chạy:
  `claude mcp add --transport http soe-hub https://<domain>/mcp --header "Authorization: Bearer <token>"`
- **Codex:** `codex mcp add soe-hub --url https://<domain>/mcp --bearer-token-env-var SOE_HUB_TOKEN` (token đặt trong biến môi trường `SOE_HUB_TOKEN`), hoặc dùng OAuth bằng `codex mcp login soe-hub`.

Sau đó chỉ cần nói với AI, ví dụ "tạo datahub theo dõi lead tháng 12", "deal nào của tớ sắp đến hạn chốt", "winrate quý này của tớ bao nhiêu".

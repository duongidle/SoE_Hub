# CLAUDE.md — SoE Hub

SoE Hub là nơi làm việc chung cho team SoE của Base: quản lý deal và chỉ số, Datahub, dashboard, form, onboarding, knowledge, AI Hub, giao việc. Hệ thống được dựng theo mong muốn của team SoE và yêu cầu của ban lãnh đạo.

Quy mô: 15–20 người dùng thường xuyên, nhiều người dùng thỉnh thoảng (sale, bộ phận Data). Bảng Deals > 10.000 dòng và còn tăng.

## Bản đồ thư mục

| Đường dẫn | Nội dung |
|---|---|
| `promt.md` | Brief gốc của Dương. Chỉ đọc |
| `examples/` | File mẫu chứa **dữ liệu thật của Base** (deal, com, onboarding, chính sách). Chỉ đọc. **Không bao giờ commit** (đã nằm trong `.gitignore`) |
| `design/` | Thiết kế đã chốt: `moduleX-<ten>.md`, `ha-tang.md` |
| `progress.md` | Trạng thái và tiến độ hiện tại |
| `CLAUDE.md` | File này |

## Quy trình làm việc

1. **Chưa code khi Dương chưa bảo code.** Không tạo scaffold, package, file code nào khi chưa có lệnh.
2. **Thiết kế từng module theo vòng:** Claude phân tích và đề xuất trong chat → Dương phản biện → chốt → Claude ghi `design/moduleX-<ten>.md`. Chỉ ghi file khi module đã chốt. Ghi trạng thái `Đã chốt` và ngày ở đầu file.
3. **Engine trước, giao diện sau.** Giao diện bản đầu chỉ cần đủ dùng, đủ xem; có một giai đoạn làm đẹp riêng về sau.
4. **Phản biện thật.** Ý tưởng hay giả định yếu thì nói thẳng, kèm lý do và phương án tốt hơn. Không đồng ý cho xong.
5. **Sau mỗi bước nhỏ hoàn thành:** cập nhật `progress.md` (đã xong gì, đang làm gì, việc tiếp theo, câu hỏi còn mở), rồi **commit**.
6. **Push và merge chỉ làm khi Dương yêu cầu.** Làm việc trên nhánh `dev` (hoặc nhánh tính năng tách từ `dev`); `main` chỉ nhận merge khi Dương bảo.
7. Một quyết định thiết kế mới được chốt trong chat thì ghi vào đúng file thiết kế của module đó, và vào mục "Quy định đã chốt" bên dưới nếu nó ảnh hưởng nhiều module.

Repo: `https://github.com/duongidle/SoE_Hub`.

## Thứ tự module

| # | File | Nội dung | Trạng thái |
|---|---|---|---|
| 0 | `module0-nen-tang.md` + `ha-tang.md` | Kiến trúc, stack, quy ước, audit, khoá kỳ, sự kiện, hạ tầng | Đã chốt |
| 1 | `module1-tai-khoan-phan-quyen.md` | Tài khoản, vai trò, cây tổ chức, cấp dữ liệu, token | Chưa |
| 2 | `module2-datahub.md` | Lưu trữ, kiểu cột, công thức, lịch sử, import/export | Chưa |
| 3 | `module3-metric-dashboard.md` | Định nghĩa chỉ số, biểu đồ | Chưa |
| 4 | `module4-quan-ly-deal.md` | Template Deals, người tham gia, chính sách/com, forecast, BANT | Chưa |
| 5 | `module5-ket-noi-ai.md` | REST, MCP, quản lý kết nối AI | Chưa |
| 6 | `module6-thong-bao.md` | Thông báo, nhắc hẹn, nhắc hạn | Chưa |
| 7 | `module7-dynamic-form.md` | Form kéo thả, bài test, khảo sát | Chưa |
| 8 | `module8-knowledge-aihub.md` | Knowledge, AI Hub, engine đăng → kiểm tra → duyệt | Chưa |
| 9 | `module9-onboarding.md` | Lộ trình onboard, checklist, bài test | Chưa |
| 10 | `module10-workspace.md` | Giao việc | Chưa |
| 11 | `module11-cai-dat-feedback.md` | Cài đặt, feedback | Chưa |
| — | Automation | Module lõi, **chưa thiết kế, chưa làm**. Kiến trúc phải để sẵn chỗ (Module 0 mục 19) | Hoãn |

Module 0–5 là engine.

## Quy định đã chốt (ảnh hưởng nhiều module)

### Kiến trúc và kỹ thuật
- Stack: TypeScript monorepo (pnpm), Node 22 + Fastify, PostgreSQL 17 + Drizzle, pg-boss, better-auth, MCP SDK (Streamable HTTP), React + Vite + TanStack + shadcn/ui, Glide Data Grid, ECharts, dnd-kit, Tiptap, S3 (R2/MinIO), Docker Compose + Caddy trên một VPS.
- Modular monolith; mọi thao tác là command/query trong registry; REST, MCP, UI, worker, Automation đều gọi qua registry; **kiểm tra quyền chỉ ở server**.
- Mọi dòng dữ liệu có lịch sử thay đổi từ ngày đầu; audit log chỉ ghi thêm; trang nhật ký hệ thống **chỉ Admin xem**.
- Bảng lớn: lọc/sắp xếp/tìm kiếm ở server, grid ảo hoá chỉ vẽ và tải phần đang nhìn thấy, phân trang keyset. Mục tiêu: 100.000 deal vẫn mượt.
- API có `version` chống ghi đè, `Idempotency-Key`, `source` + `external_id` cho hệ thống ngoài.
- Bàn giao kèm OpenAPI, bộ request Bruno, hướng dẫn kết nối.

### Tài khoản và phân quyền
- Vai trò: Admin, Manager, Leader, User, Guest. Một người có thể có nhiều vai trò.
- Cây tổ chức: mỗi User có đúng một Leader (hoặc thuộc thẳng Manager); trên Leader là Manager; một Manager có nhiều Leader. **Hai Manager không thấy dữ liệu của nhau.** Admin thấy tất cả.
- Guest mặc định không có quyền gì. Manager cấp từng phần dữ liệu (ví dụ bộ phận Data đọc Deals qua API/export, chỉ cột hệ thống + cột chung). Guest không bao giờ thấy cột cá nhân. Sale chỉ được cấp Knowledge.
- Đăng nhập chính bằng email + mật khẩu; Google OAuth (External) là phương án phụ, chỉ cho email đã có tài khoản; tài khoản Google được đặt mật khẩu riêng.
- Quên mật khẩu: không dùng email; mã xác thực gửi qua thông báo trong ứng dụng cho leader trực tiếp, manager và admin.
- Không bắt buộc 2FA.
- Admin có chức năng chuyển giao dữ liệu: chọn tài khoản nguồn và tài khoản đích.

### Datahub và công thức
- Mô hình Airtable/Lark Base: cột có kiểu, công thức áp cho cả cột. Datahub là linh hồn của hệ thống.
- Công thức đầy đủ các nhóm hàm thường dùng như Excel/Google Sheets, có ví dụ mẫu và gợi ý biến khi gõ.
- Công thức được tham chiếu **mọi bảng của mọi Datahub thuộc cùng một tài khoản** (Datahub A bảng 1 → Datahub A bảng 2 hoặc Datahub B bảng 1), cộng với bảng hệ thống dùng chung (ví dụ bảng chính sách). **Không bao giờ** tham chiếu Datahub của tài khoản khác. Kiểm tra khi lưu công thức và khi tính.
- Chỉ số tổng hợp theo thời gian (kiểu sheet Index) nằm ở lớp Metric, khai báo bằng JSON.
- Import từ Google Sheet/Excel là chức năng bắt buộc.
- Dashboard ghép nhiều bảng: khoá không khớp thì báo rõ số dòng ghép được, không vẽ biểu đồ rỗng; ưu tiên cột liên kết (relation/lookup).
- Xoá mềm, khôi phục trong 7 ngày (admin chỉnh được).

### Deal
- Engine lưu **một bản ghi cho mỗi deal**, kèm danh sách người tham gia (Leading / Associate / Advisor) và tỉ lệ chia. Doanh thu cộng cho vai trò được tính doanh thu; workload cộng cho tất cả.
- Quản lý Deal là chức năng riêng chạy trên lõi Datahub (vẫn tạo được cột tuỳ chỉnh).
- Hiển thị theo quyền: User thấy deal mình tham gia; Leader thấy deal của mình và team; Manager tạo deal, phân deal, thấy mọi deal trong cây của mình.
- Nguồn deal hiện tại: Manager nhập tay và phân tay. Sau này có hệ thống ngoài bắn API vào (kèm người được chia và tỉ lệ), nên mọi chỗ liên quan phải có API sẵn.
- Ba loại cột: **hệ thống** (template, admin quản lý, phân quyền sửa theo từng cột); **chung** (Manager đẩy cho toàn bộ, Leader đẩy cho team, một giá trị mỗi deal); **cá nhân** (mỗi người một giá trị, leader của họ xem được). Template mặc định có nhiều cột, bám theo file deal mẫu.
- Deal không bao giờ bị xoá cứng; Manager chỉ đánh dấu "Huỷ".
- Khoá kỳ / chốt kỳ com là việc của Manager.
- Chính sách com có phiên bản và ngày hiệu lực; Manager tạo phiên bản mới, không ghi đè phiên bản cũ. Làm trước phiên bản đầu tiên, sẽ chỉnh sau khi Dương bàn với Manager.
- BANT: hàng chờ "Cần chấm lại hôm nay" thay cho chấm lại toàn bộ mỗi ngày; lưu lịch sử điểm.
- Forecast so với snapshot pipeline đầu quý.

### AI
- Kết nối AI: user tạo kết nối, admin duyệt; scope theo menu; quyền thực tế = giao của quyền user, scope kết nối, chính sách AI chung. **Onboarding cấm AI cứng.**
- Hỗ trợ OAuth (Claude Desktop, claude.ai, ChatGPT, Codex) và token cá nhân (Claude Code, Codex, script).
- Hệ thống **không tiêu thụ AI**. Kiểm tra skill/knowledge bằng luật cố định ở server; sai chuẩn thì trả lỗi có cấu trúc để AI của người đăng tự sửa. Knowledge và AI Hub dùng chung engine đăng → kiểm tra → duyệt → xuất bản.

### Phạm vi
- Workspace (giao việc) làm gọn: giao việc, hạn, nhắc, phản hồi, gắn vào deal. Không thay thế công cụ cá nhân.

## Lưu ý

- `examples/` chứa dữ liệu thật của Base. Không đưa vào git, không đưa nội dung ra dịch vụ ngoài.
- Repo GitHub đang để **public**. Không commit dữ liệu thật, secret hay `.env`.
- Hạ tầng, chi phí và việc đứng tên server do Dương lo; thiết kế chỉ cần ghi rõ yêu cầu.
- Golden test dùng số liệu từ file deal mẫu chỉ chạy trên máy, dữ liệu mẫu không commit.

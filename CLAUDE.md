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

### Bắt đầu mỗi phiên

**Đọc `CLAUDE.md` và `progress.md` trước khi làm bất cứ việc gì**, đặc biệt trước khi code. Khi code một stage, đọc thêm file thiết kế của module thuộc stage đó. Không cần đọc lại phiên cũ.

### Thiết kế

1. **Thiết kế từng module theo vòng:** Claude phân tích và đề xuất trong chat → Dương phản biện → chốt → Claude ghi `design/moduleX-<ten>.md`, kèm trạng thái `Đã chốt` và ngày ở đầu file.
2. **Phản biện thật.** Ý tưởng hay giả định yếu thì nói thẳng, kèm lý do và phương án tốt hơn. Không đồng ý cho xong.
3. Một quyết định mới được chốt trong chat thì ghi vào đúng file thiết kế của module đó, và vào mục "Quy định đã chốt" bên dưới nếu nó ảnh hưởng nhiều module.

### Code

1. **Chỉ code module đã có file thiết kế `Đã chốt`.** Với module đó, code tự do theo thứ tự stage ở mục "Stage code"; không cần chờ lệnh riêng. Module chưa chốt thiết kế thì không code.
2. **Engine trước, giao diện sau.** Giao diện của mỗi stage chỉ cần đủ dùng, đủ xem; có stage làm đẹp riêng ở cuối.
3. **Tự quyết chi tiết nhỏ.** Khi code, các chi tiết nhỏ (đặt tên, cấu trúc file, thư viện phụ, cách xử lý lỗi, giá trị mặc định hợp lý) thì Claude tự phản biện, tự ra quy định và ghi lại vào file thiết kế của module (mục "Quyết định khi code"). Chỉ hỏi Dương khi điều cần hỏi quyết định một chức năng quan trọng, đổi một quy định đã chốt, hoặc chạm dữ liệu thật / thao tác khó hoàn tác.
4. **Làm liền từ đầu đến cuối.** Không dừng giữa chừng để hỏi những việc nhỏ. Gặp chỗ cần Dương quyết thì ghi vào `progress.md` mục "Câu hỏi còn mở", chọn phương án an toàn tạm thời, làm tiếp phần còn lại, và báo ở cuối.
5. Mỗi stage chỉ coi là xong khi đạt "Định nghĩa xong" ở mục "Stage code".

### Tiến độ và commit

Mục đích: hết quota giữa chừng thì phiên mới đọc `progress.md` là làm tiếp được ngay, không phải đọc lại phiên cũ.

1. **Cập nhật `progress.md` liên tục, không đợi xong việc lớn:**
   - Trước khi bắt đầu một việc dài: ghi kế hoạch các bước vào "Đang làm".
   - Sau mỗi bước nhỏ xong (một file thiết kế, một nhóm chức năng, một bộ test pass): đánh dấu xong, ghi bước tiếp theo.
   - Khi phiên đã dài hoặc đã làm nhiều việc: cập nhật ngay, không đợi đến cuối.
2. **"Bước tiếp theo" phải đủ cụ thể để làm tiếp không cần hỏi:** file nào, hàm/chức năng nào, đang dở ở đâu, lệnh test nào đang fail.
3. **Giữ `progress.md` ngắn** (dưới khoảng 80 dòng) để đọc rẻ: chỉ ghi trạng thái hiện tại, danh sách xong theo stage, bước tiếp theo, câu hỏi còn mở. Lịch sử chi tiết đã có trong git log.
4. **Commit ngay sau mỗi lần cập nhật `progress.md`**, kèm phần code/thiết kế vừa xong.
5. **Push và merge chỉ làm khi Dương yêu cầu.** Làm việc trên nhánh `dev` (hoặc nhánh tính năng tách từ `dev`); `main` chỉ nhận merge khi Dương bảo.

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

## Stage code

Thứ tự thiết kế và thứ tự code khớp nhau: module sau chỉ dựa vào module trước, nên code được lần lượt. Thiết kế luôn đi trước code ít nhất một module, nghĩa là code Stage N trong lúc thiết kế module N+1.

| Stage | Module | Cần module trước | Nội dung code | Kết quả dùng được |
|---|---|---|---|---|
| 0 | M0 | — | Monorepo, Docker dev, Postgres + migration, command/query registry, actor, mã lỗi, audit log, `row_history`, outbox, worker pg-boss, lưu file, SSE, sinh OpenAPI, khung test | Server chạy, có `/health`, `/api/docs`; chưa có chức năng nghiệp vụ |
| 1 | M1 | 0 | Tài khoản, vai trò, cây tổ chức, đăng nhập (mật khẩu + Google), session, token, engine phân quyền, quên mật khẩu, hộp thông báo tối thiểu (M6 mở rộng sau), trang nhật ký của Admin, chuyển giao dữ liệu | Đăng nhập, quản lý người dùng, admin xem log |
| 2 | M2 | 1 | Datahub, bảng, kiểu cột, engine công thức, lọc/sắp xếp/view, grid ảo hoá, import/export, thùng rác, lịch sử dòng | Dùng Datahub thay Google Sheet |
| 3 | M3 | 2 | Engine metric, các loại biểu đồ, dashboard tuỳ chỉnh | Vẽ dashboard từ Datahub |
| 4 | M4 | 2, 3 | Template Deals, người tham gia, ba loại cột, chính sách com có phiên bản, khoá kỳ, snapshot, forecast, BANT, dashboard Deals mặc định, API cho hệ thống ngoài | **Mốc Engine v1: team SoE chạy thử quản lý deal** |
| 5 | M5 | 1, 4 | MCP server, OAuth + DCR, token cá nhân, kết nối AI chờ duyệt, scope theo menu, hướng dẫn kết nối, bộ Bruno đầy đủ | Claude/Codex điều khiển được hệ thống |
| 6 | M6 | 1 | Thông báo đầy đủ, nhắc hẹn, nhắc hạn, quy tắc gửi | |
| 7 | M7 | 2 | Dynamic Form: builder kéo thả, renderer công khai, lưu nháp, chấm điểm, JSON import/export | |
| 8 | M8 | 1, 6 | Engine đăng → kiểm tra → duyệt → xuất bản; Knowledge; AI Hub | |
| 9 | M9 | 6, 7 | Onboarding: lộ trình, checklist, bài test, theo dõi, template mẫu | |
| 10 | M10 | 4, 6 | Workspace giao việc | |
| 11 | M11 | các module trên | Cài đặt còn lại, feedback | |
| 12 | — | tất cả | Làm đẹp giao diện | |
| — | Automation | 0, 2, 6 | Chưa thiết kế | |

**Định nghĩa xong của mỗi stage:**
1. Chức năng đúng theo file thiết kế; mọi lệch hoặc bổ sung đã ghi vào mục "Quyết định khi code" của file đó.
2. Test unit và test phân quyền của stage đều pass; test của các stage trước không bị hỏng.
3. Mọi endpoint mới có trong OpenAPI và có request mẫu trong `docs/api/bruno/`.
4. Có giao diện tối thiểu để dùng và kiểm tra bằng mắt.
5. `progress.md` đã cập nhật, đã commit.

REST API được sinh từ registry ngay từ Stage 0, nên mỗi stage tự có API của nó; Stage 5 chỉ thêm MCP và phần quản lý kết nối AI.

## Kết nối AI với SoE Hub (thiết kế, chi tiết ở Module 5)

SoE Hub cung cấp sẵn bộ công cụ cho AI qua MCP. AI không cần mở trình duyệt hay viết script; server trả kết quả đã tính sẵn nên tốn ít token. AI chỉ làm được những gì kết nối đó được cấp quyền, và không bao giờ chạm được Onboarding.

Cài một lần:

- **Claude Desktop / claude.ai:** Settings → Connectors → Add custom connector → dán `https://<domain>/mcp`. Trình duyệt mở trang đăng nhập SoE Hub → đăng nhập → bấm cho phép → chờ admin duyệt kết nối.
- **Claude Code:** lấy token trong Cài đặt của SoE Hub, rồi chạy:
  `claude mcp add --transport http soe-hub https://<domain>/mcp --header "Authorization: Bearer <token>"`
- **Codex:** `codex mcp add soe-hub --url https://<domain>/mcp --bearer-token-env-var SOE_HUB_TOKEN` (token đặt trong biến môi trường `SOE_HUB_TOKEN`), hoặc dùng OAuth bằng `codex mcp login soe-hub`.

Sau đó chỉ cần nói với AI, ví dụ "tạo datahub theo dõi lead tháng 12", "deal nào của tớ sắp đến hạn chốt", "winrate quý này của tớ bao nhiêu".

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
- **Admin là quản trị hệ thống**: cài đặt, giới hạn, nhật ký, duyệt kết nối AI/token, chuyển giao dữ liệu. Admin **không** có quyền nghiệp vụ: không tạo/phân deal, không sửa chính sách com, không khoá kỳ, không snapshot, không đẩy cột, không tạo lộ trình onboard, không tạo datahub/form, không đăng bài/skill. Muốn có thì phải mang thêm vai trò khác.
- Cây tổ chức: mỗi User có đúng một Leader (hoặc thuộc thẳng Manager); trên Leader là Manager; một Manager có nhiều Leader. **Hai Manager không thấy dữ liệu của nhau.** Đổi team có lưu lịch sử: quyền xem theo cây hiện tại, báo cáo theo kỳ theo cây tại thời điểm đó.
- **Deal khác Datahub về quyền xem:** Leader xem Quản lý Deal của team, Manager xem của cả cây. **Datahub là của riêng từng người**, Leader/Manager không xem được, trừ khi chủ chia sẻ (xem hoặc sửa).
- Sửa deal: Manager luôn sửa được deal trong cây. Leader mặc định chỉ đọc; User bật tuỳ chọn "cho phép leader sửa" trong Quản lý Deal thì Leader sửa được.
- Quyền bổ sung: Admin hoặc Manager cấp thêm một quyền trong danh sách cho phép cho một người cụ thể. Không có công cụ tự tạo vai trò.
- Guest mặc định không có quyền gì. Manager cấp từng phần dữ liệu (ví dụ bộ phận Data đọc Deals qua API/export, chỉ cột hệ thống + cột chung). Guest không bao giờ thấy cột cá nhân. Sale chỉ được cấp Knowledge.
- Tài khoản theo **danh sách org chart** (email, vai trò, thông tin cá nhân, vị trí trong cây) trong Cài đặt; không có thao tác "tạo tài khoản". Email trong danh sách đăng ký/đăng nhập thì nhận đúng vai trò. Chỉ email đuôi **@base.vn** được đăng ký (kiểm tra ở server). Tuỳ chọn của Admin (mặc định tắt): email @base.vn ngoài danh sách thì thành Guest "Sale" (chỉ đọc Knowledge).
- Đăng nhập Google lần đầu bắt buộc đặt mật khẩu, sau đó đăng nhập được bằng email + mật khẩu.
- Quên mật khẩu: không dùng email; mã xác thực gửi qua thông báo trong ứng dụng cho leader trực tiếp, manager và admin.
- Không bắt buộc 2FA.
- Chuyển giao dữ liệu (Admin): chọn tài khoản nguồn và đích; deal đã đóng giữ nguyên người cũ.

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

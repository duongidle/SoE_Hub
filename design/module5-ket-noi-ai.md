# Module 5 — Kết nối AI

> Trạng thái: **Bản nháp vòng 1, chờ Dương phản biện** · 19/11/2026
> Phụ thuộc: [Module 0](module0-nen-tang.md) (registry, actor, audit, mục 17 khung kết nối AI), [Module 1](module1-tai-khoan-phan-quyen.md) (token cá nhân, tài khoản hệ thống, ba lớp quyền), [Module 2](module2-datahub.md) (dòng, công thức, mục 6.7 đợi tính xong), [Module 3](module3-metric-dashboard.md) (`metrics.query`), [Module 4](module4-quan-ly-deal.md) (deal, chỉ số Deals).
> Để module sau: thông báo khi có kết nối chờ duyệt (Module 6, Stage 5 dùng hộp thông báo của Module 1); tool của Form, Knowledge, AI Hub, Workspace do module đó thêm (mục 4.4).

Mục tiêu: AI của người dùng (Claude Desktop, claude.ai, Claude Code, Codex, ChatGPT) làm được mọi việc người đó làm được, trừ Onboarding và quản trị, tốn ít token, và Admin biết chính xác AI nào đang vào hệ thống, được vào menu nào.

---

## 1. Chọn kênh

| Kênh | Dùng cho | Xác thực |
|---|---|---|
| **MCP** tại `/mcp` (Streamable HTTP) | AI: Claude Desktop, claude.ai, Claude Code, Codex, ChatGPT | OAuth hoặc token cá nhân |
| **REST** `/api/v1` | Script, Postman/Bruno, hệ thống ngoài | Token cá nhân, token tài khoản hệ thống |

Cả hai sinh từ cùng registry (Module 0 mục 3.3), nên không có thao tác nào chỉ chạy ở một kênh. Tư vấn cho câu hỏi ở brief mục 18: **dùng MCP cho AI**, không bắt AI đọc OpenAPI rồi tự gọi REST. Lý do: MCP cho AI biết sẵn công cụ nào dùng được, client tự lo đăng nhập OAuth, và người dùng không phải dán token vào chat.

## 2. Kết nối

### 2.1 Khái niệm

**Kết nối** là một quyền truy cập đã được cấp cho một client cụ thể của một người. Mọi credential dùng được ở `/mcp` hoặc `/api` (trừ tài khoản hệ thống) đều thuộc một kết nối.

| Trường | Ghi chú |
|---|---|
| Người dùng | Chủ kết nối. Quyền của kết nối không bao giờ rộng hơn quyền của người này |
| Loại | `OAuth` (connector) hoặc `Token` (token cá nhân của Module 1) |
| Client | Tên client và nguồn: miền của `client_id` hoặc redirect URI (`claude.ai`, `chatgpt.com`, `localhost`) |
| Tên | Người dùng đặt, ví dụ "Claude Desktop máy công ty" |
| Menu và mức | Mục 3 |
| Trạng thái | `Chờ duyệt` / `Đang hoạt động` / `Bị từ chối` / `Đã thu hồi` / `Hết hạn` |
| Hạn | Token: như Module 1 (mặc định 90 ngày, tối đa 1 năm). OAuth: hết hạn khi không dùng 30 ngày, tối đa 1 năm phải kết nối lại |
| Dùng lần cuối | Thời điểm, IP, client |

- **Token cá nhân của Module 1 trở thành một loại kết nối.** Scope đang là chuỗi quyền được thay bằng menu và mức (mục 3). Token cũ ở dev được chuyển đổi bằng migration; chưa có người dùng thật nên không phải giữ tương thích.
- Tài khoản hệ thống (Module 1 mục 7) **không** phải kết nối AI: Admin cấp, scope riêng, không vào `/mcp`.

### 2.2 Admin duyệt

Mọi kết nối mới đều chờ Admin duyệt (giữ luật của Module 1 cho token).

- Admin thấy: người yêu cầu, client và nguồn, menu và mức xin, IP lúc tạo.
- Admin **duyệt**, **duyệt với ít quyền hơn** (bỏ bớt menu, hạ mức), hoặc **từ chối** kèm lý do.
- Người dùng tự thu hẹp kết nối của mình thì có hiệu lực ngay. **Mở rộng** (thêm menu, nâng mức) thì kết nối quay lại `Chờ duyệt` cho phần mở rộng; phần cũ vẫn chạy.
- Giữ luật Module 1: Admin không tự duyệt kết nối của mình khi còn Admin khác.
- Thông báo: có kết nối chờ duyệt → mọi Admin; có kết quả → chủ kết nối; kết nối sắp hết hạn (trước 7 ngày) → chủ.

### 2.3 Chỉ AI được phép mới kết nối được

Brief muốn "AI khác kể cả có tài liệu API cũng không kết nối được". Ba lớp:

1. **Không có credential thì không có gì.** `/mcp` và `/api` không có thao tác nào chạy được khi chưa xác thực (Module 0 mục 16).
2. **Danh sách nguồn client cho phép** (Admin sửa). Mặc định: `claude.ai`, `claude.com`, `chatgpt.com`, `localhost` (Claude Code, Codex chạy trên máy). Client OAuth từ nguồn khác bị từ chối ngay ở bước đăng ký.
3. **Mỗi kết nối được Admin duyệt từng cái một.**

Giới hạn cần nói rõ: nguồn `claude.ai`, `chatgpt.com` xác minh được (client chứng minh sở hữu miền). Nguồn `localhost` thì **không** phân biệt được Claude Code với một script tự viết chạy trên máy người dùng. Vì vậy bước duyệt từng kết nối và nhật ký mới là chốt chặn thật, danh sách nguồn chỉ là lớp lọc đầu.

### 2.4 OAuth

- SoE Hub là authorization server, theo đặc tả xác thực của MCP: OAuth 2.1, bắt buộc PKCE `S256`, `resource` (RFC 8707) để token chỉ dùng được cho `/mcp` của SoE Hub.
- Endpoint: `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`, `/oauth/register`, `/oauth/authorize`, `/oauth/token`, `/oauth/revoke`. Gọi `/mcp` không có token trả `401` kèm `WWW-Authenticate: Bearer resource_metadata=…` để client tự tìm đường đăng nhập.
- Đăng ký client: hỗ trợ **Client ID Metadata Document** (client_id là một URL https, bản đặc tả MCP 2025-11) và **Dynamic Client Registration** (RFC 7591) cho client cũ. Kiểm lại client nào dùng cách nào khi code.
- Access token 1 giờ, refresh token 30 ngày, xoay vòng mỗi lần dùng (refresh token cũ dùng lại thì thu hồi cả kết nối). Server chỉ lưu bản băm.
- **Trang cho phép** (`/oauth/authorize`): đăng nhập SoE Hub nếu chưa → thấy tên client, nguồn, chọn menu và mức (mặc định theo mục 3.3) → bấm "Cho phép". Nút phụ "Huỷ".
- **Kết nối chờ duyệt vẫn hoàn tất OAuth.** Client nhận token ngay (nếu bắt client chờ Admin trong cửa sổ đăng nhập thì sẽ hết thời gian). Mọi tool gọi lúc đang chờ trả lỗi `connection_pending`: "Kết nối đang chờ Admin duyệt. Báo Admin của bạn rồi thử lại." Admin duyệt xong thì dùng được ngay, không phải kết nối lại.
- Callback được phép theo nguồn ở mục 2.3, ví dụ `https://claude.ai/api/mcp/auth_callback`, `https://claude.com/api/mcp/auth_callback` (Module 0 mục 17), callback của ChatGPT, và `http://localhost:*` / `http://127.0.0.1:*`.

## 3. Phạm vi theo menu

### 3.1 Menu và mức

Mỗi kết nối chọn menu và mức cho từng menu:

| Mức | Được làm |
|---|---|
| **Xem** | Mọi query |
| **Sửa** | Thêm query và command tạo, sửa (kể cả xoá mềm từng dòng có khôi phục được) |
| **Sửa và xoá** | Thêm command xoá datahub, bảng, cột, xoá nhiều dòng một lần, import "thay toàn bộ" |

| Menu | Gồm | AI dùng được |
|---|---|---|
| Quản lý Deal | Deals, Index, Probation KPI, bảng tự tạo, dashboard Deals, chính sách com | ✓ |
| Datahub | Datahub, bảng, cột, dòng, view, công thức, import/export, dashboard, chỉ số, bảng gộp | ✓ |
| Form | Module 7 | ✓ |
| Knowledge | Module 8 | ✓ |
| AI Hub | Module 8 | ✓ |
| Workspace | Module 10 | ✓ |
| Thông báo và nhắc hẹn | Module 6 | ✓ |
| Feedback | Module 11 | ✓ |
| **Onboarding** | Module 9 | **Cấm cứng**, không có trong danh sách chọn |
| **Tài khoản và quản trị** | Mật khẩu, phiên, token, kết nối AI, org chart, vai trò, quyền bổ sung, cấp dữ liệu Guest, chuyển giao, cài đặt hệ thống, nhật ký | **Cấm cứng** |

- Cấm cứng quản trị vì: AI không được tự duyệt kết nối của chính nó, không được nâng quyền hay chuyển giao dữ liệu. Admin vẫn làm những việc này trên web.
- Ngoại lệ đọc: `soe_whoami` (mục 4.2) luôn dùng được, để AI biết mình đang là ai và được gì.

### 3.2 Cách tính quyền thực tế

Quyền thực tế = **giao** của bốn thứ (cụ thể hoá Module 0 mục 3.4):

1. Quyền của người dùng lúc gọi (vai trò hiện tại, phạm vi dữ liệu, chủ sở hữu, chia sẻ).
2. Menu và mức của kết nối.
3. Chính sách AI chung của Admin (mục 6).
4. Cờ `aiAllowed` của thao tác trong registry (`onboarding.*` luôn `false`).

Cài đặt trong code: mỗi thao tác trong registry khai báo thêm `menu` và `access` (`read` / `write` / `delete`). Executor từ chối khi `access` vượt mức của kết nối với menu đó. Thao tác thiếu khai báo thì không gọi được qua kết nối (mặc định đóng), test bắt lỗi này lúc khởi động.

Người dùng mất vai trò hoặc bị khoá: quyền kết nối thu hẹp theo ngay ở lần gọi kế tiếp; bị khoá thì mọi kết nối bị thu hồi (giữ luật Module 1).

### 3.3 Mặc định khi tạo kết nối

Quản lý Deal và Datahub mức **Sửa**; Thông báo mức **Sửa**; các menu khác mức **Xem**; không menu nào mức **Sửa và xoá**. Người dùng đổi trước khi bấm "Cho phép".

## 4. Bộ công cụ MCP

### 4.1 Vì sao không đưa mọi thao tác thành tool

Registry sẽ có vài trăm thao tác. Mỗi tool tốn token mô tả trong ngữ cảnh của AI ở **mọi** lượt chat, kể cả khi không dùng. Vài trăm tool thì AI vừa tốn token vừa dễ chọn nhầm.

Cách làm: **bộ tool chọn lọc + ba tool cho phần còn lại**.

- **Tool chọn lọc** (khoảng 20–30 khi đủ các module): việc hay làm, đầu vào đơn giản, kết quả gọn. Một thao tác trong registry thành tool chọn lọc bằng khai báo `mcp: { tool, description }`.
- **Ba tool cho phần còn lại**: `soe_operations` (liệt kê thao tác theo menu, mỗi thao tác một dòng mô tả), `soe_describe` (schema đầu vào của một thao tác), `soe_call` (gọi một thao tác theo tên). Mọi thao tác có `aiAllowed` đều tới được qua đây, **không phải viết thêm gì**.
- `tools/list` chỉ trả tool thuộc menu kết nối được cấp. Kết nối chỉ có Quản lý Deal thì không thấy tool Form.

### 4.2 Tool chọn lọc ở Stage 5

| Tool | Menu, mức | Việc |
|---|---|---|
| `soe_whoami` | luôn có | Tôi là ai, vai trò, menu và mức của kết nối, hôm nay, quý hiện tại |
| `soe_find` | theo menu | Tìm theo tên: datahub, bảng, cột, deal, người. Trả id để gọi tiếp |
| `deals_list` | Quản lý Deal, Xem | Lọc deal bằng tham số dễ dùng (status, loại deal, kỳ, `của tôi` / `team`, chữ tìm), chọn cột, sắp xếp |
| `deal_get` | Quản lý Deal, Xem | Một deal: mọi cột được xem, người tham gia, BANT, lịch sử gần nhất |
| `deal_update` | Quản lý Deal, Sửa | Sửa ô theo tên cột; tôn trọng quyền từng cột của template |
| `deal_bant_score` | Quản lý Deal, Sửa | Chấm B, A, N, T cho một deal |
| `deals_rescore_queue` | Quản lý Deal, Xem | Hàng chờ "Cần chấm lại hôm nay" |
| `deal_metrics` | Quản lý Deal, Xem | Chỉ số Deals có sẵn (doanh thu, CR1, CR2, winrate theo cycle, forecast, KPI đã đạt / còn thiếu, workload) theo kỳ và phạm vi. Trả lời "winrate quý này của tớ" bằng một lần gọi |
| `datahub_list` | Datahub, Xem | Datahub, bảng, số dòng, cột (tên, kiểu) |
| `datahub_create` | Datahub, Sửa | Tạo datahub kèm bảng và cột trong **một** lần gọi (JSON) |
| `table_schema` | Datahub, Xem | Cột, kiểu, lựa chọn; công thức nếu là chủ |
| `table_alter` | Datahub, Sửa | Thêm, sửa nhiều cột một lần; xoá cột cần mức Sửa và xoá |
| `rows_query` | Datahub, Xem | Lọc (cú pháp Module 0 + `time_filter`), sắp xếp, `fields`, phân trang |
| `rows_write` | Datahub, Sửa | Tạo, sửa, upsert, xoá tối đa 500 dòng một lần |
| `formula_check` | Datahub, Xem | Kiểm tra và xem trước công thức (`datahub.formula.preview`) |
| `metrics_query` | Datahub, Xem | Chỉ số bất kỳ bằng JSON (Module 3 mục 10) |
| `dashboard_get`, `dashboard_save` | Datahub, Xem / Sửa | Đọc và ghi cấu hình dashboard bằng JSON |

`deals_list`, `deal_get`, `deal_update` chạy trên bảng Deals đã áp phạm vi (Module 4 mục 2), giống hệt grid.

### 4.3 Quy ước để tốn ít token

- **Mô tả tool viết bằng tiếng Anh, ngắn.** Chữ tiếng Việt có dấu tốn token gấp khoảng 2–3 lần, mà mô tả tool nằm trong ngữ cảnh ở mọi lượt. Dữ liệu và thông báo lỗi vẫn là tiếng Việt.
- **Kết quả dạng bảng:** `{"columns": [...], "rows": [[...], ...], "total": 1284, "next_cursor": "..."}`, không lặp tên trường ở từng dòng.
- Giá trị trả **dạng máy đọc**, không theo định dạng hiển thị: ngày `2026-11-19`, tiền là số nguyên VND, phần trăm `0.25`, lựa chọn trả **tên** (không trả mã `o_…`), người trả họ tên kèm email. Định dạng `vi-VN` chỉ là việc của giao diện.
- Mặc định 50 dòng, tối đa 500; luôn có `total` (khi tính được nhanh) để AI biết còn bao nhiêu.
- Có `fields` để chọn cột. Không gửi cột hệ thống trừ khi xin.
- Số liệu tổng hợp tính ở server (`deal_metrics`, `metrics_query`), AI không phải kéo dòng thô về tự cộng.
- Mỗi kết quả có cả `structuredContent` (JSON) và một bản chữ gọn.

### 4.4 Lỗi để AI tự sửa

Lỗi trả `isError: true` kèm `{code, message, hint, details}` tiếng Việt, đủ để AI tự sửa mà không phải hỏi người dùng:

- Sai tên cột: liệt kê tên cột đúng gần nhất.
- Sai giá trị lựa chọn: liệt kê các lựa chọn hợp lệ.
- Không đủ quyền: nói thiếu quyền của người dùng hay thiếu mức của kết nối ("Kết nối này chỉ có mức Xem cho Datahub. Vào Cài đặt → Kết nối AI để xin thêm").
- `409 conflict`: kèm giá trị hiện tại để AI đọc lại rồi sửa.

### 4.5 Đọc ngay sau khi ghi

AI hay sửa xong là hỏi lại số ngay ("sửa doanh thu rồi cho tớ winrate"). Công thức liên bảng do worker tính mất vài giây (Module 2 mục 6.7).

- Tool ghi trả về số thứ tự thay đổi `seq`.
- Tool đọc qua MCP mặc định `consistent=true`: đợi các cột cần đọc tính tới số mới nhất, tối đa 5 giây; quá thì trả giá trị hiện có kèm `stale: true` và danh sách cột chưa xong. REST giữ mặc định của Module 2 (không đợi).

### 4.6 Gợi ý cho client về thao tác nguy hiểm

Mỗi tool khai báo `annotations` của MCP từ registry: query → `readOnlyHint`; xoá → `destructiveHint`; ghi có `Idempotency-Key` → `idempotentHint`. Claude và ChatGPT dựa vào đây để hỏi người dùng trước khi chạy thao tác ghi hoặc xoá.

### 4.7 Module sau thêm tool thế nào

- Mọi thao tác mới có `aiAllowed`, `menu`, `access` thì tự dùng được qua `soe_call` từ ngày đầu.
- Module nào có việc hay làm qua AI thì thêm tool chọn lọc: Form (`form_get`, `form_save` bằng JSON, `form_responses`), Knowledge và AI Hub (`knowledge_search`, `knowledge_get`, `knowledge_submit`, `skill_search`, `skill_get`, `skill_submit`; lỗi kiểm tra trả có cấu trúc để AI tự sửa), Workspace (`tasks_list`, `task_save`), Thông báo (`reminder_create`, `notifications_list`).
- Giới hạn tổng **30 tool chọn lọc**. Muốn vượt thì bỏ bớt tool ít dùng (đo bằng nhật ký) trước khi thêm.

## 5. Bảo vệ

- **Tốc độ** (mặc định, Admin chỉnh): mỗi kết nối 120 lần gọi/phút, 30 lần ghi/phút, 5.000 dòng ghi/giờ. Quá thì `429` kèm thời gian chờ.
- **Xoá luôn là xoá mềm**, khôi phục trong thùng rác. Deal không bao giờ bị xoá (Module 4). Thao tác xoá cần mức "Sửa và xoá".
- **Nhật ký:** mọi lần gọi qua kết nối ghi audit với `via = mcp` hoặc `api`, tên kết nối, tên tool (Module 0 mục 9.2). Thông báo do thao tác của AI gây ra ghi rõ "qua Claude Desktop (kết nối của Dương)".
- **Prompt injection:** dữ liệu trong bảng (ghi chú deal, bài Knowledge) có thể chứa câu lừa AI làm việc khác. Server không chặn được việc AI làm theo nội dung đó. Giới hạn thiệt hại bằng: mức của kết nối, cấm cứng quản trị và Onboarding, xoá mềm, giới hạn tốc độ. Hướng dẫn kết nối khuyên dùng mức Xem cho kết nối dùng hằng ngày.
- **Dữ liệu riêng giữ nguyên luật:** AI của Admin không đọc được datahub của người khác, AI của Guest chỉ thấy phần được cấp.

## 6. Chính sách AI của Admin

Trang Admin → Kết nối AI → Chính sách:

| Cài đặt | Mặc định |
|---|---|
| Cho phép kết nối AI | Bật. Tắt = mọi kết nối ngừng ngay (công tắc khẩn cấp), mở lại thì chạy tiếp, không phải duyệt lại |
| Menu AI được dùng trong toàn hệ thống | Mọi menu ở mục 3.1 trừ hai menu cấm cứng |
| Mức cao nhất trong toàn hệ thống | Sửa và xoá |
| Nguồn client cho phép | Mục 2.3 |
| Giới hạn tốc độ | Mục 5 |
| Hạn tối đa của kết nối | 1 năm |
| Ai được tạo kết nối | Mọi vai trò trừ Guest mẫu Sale. Guest mẫu Data được tạo kết nối Token để lấy dữ liệu đã cấp qua API |

## 7. Giao diện tối thiểu (Stage 5)

**Người dùng: Cài đặt → Kết nối AI**

- Danh sách kết nối của mình: tên, client, menu và mức, trạng thái, dùng lần cuối. Thu hồi, đổi tên, thu hẹp hoặc xin thêm quyền.
- "Tạo token" (cho Claude Code, Codex, script): chọn menu, mức, hạn → token hiện một lần, kèm lệnh cài đã điền sẵn domain và token.
- **Hướng dẫn kết nối** ngay trên trang: từng tab Claude Desktop / claude.ai, Claude Code, Codex, ChatGPT, REST. Lệnh có nút sao chép, domain điền sẵn.

**Admin: Kết nối AI**

- Chờ duyệt: duyệt, duyệt với ít quyền hơn, từ chối.
- Mọi kết nối: lọc theo người, client, trạng thái; thu hồi.
- Chính sách (mục 6).
- Nhật ký lọc theo kết nối hiện **tên kết nối** thay cho mã (bổ sung cho trang nhật ký của Module 1).
- Phân trang danh sách token và tài khoản hệ thống (việc còn nợ từ Stage 1).

**Trang cho phép OAuth** (`/oauth/authorize`): như mục 2.4. Phải dùng tốt ở 375px (claude.ai trên điện thoại mở trang này).

## 8. Tài liệu bàn giao

- `docs/api/ket-noi-ai.md`: cài cho từng client, giải thích menu và mức, xử lý lỗi thường gặp (`connection_pending`, `401`, `429`).
- `docs/api/he-thong-ngoai.md`: tài khoản hệ thống, `deal.upsert` theo `source` + `external_id`, `Idempotency-Key`, `version`.
- Bộ Bruno **đầy đủ** mọi endpoint (kể cả OAuth), có môi trường dev và production.
- Danh sách tool MCP sinh tự động từ registry (tên, mô tả, menu, mức), để kiểm tra tool nào lộ ra.

## 9. Kiểm thử

- Ma trận quyền mở rộng thêm chiều **kênh MCP** và **mức kết nối**: vai trò × thao tác × menu/mức × kênh.
- Thao tác thiếu `menu`/`access` làm test khởi động fail. Mọi `onboarding.*` và thao tác quản trị không gọi được qua `soe_call`.
- Luồng OAuth đầy đủ với client giả: đăng ký (cả hai cách), PKCE, `resource`, xoay refresh token, dùng lại refresh token cũ thì thu hồi cả kết nối, chờ duyệt, duyệt với ít quyền hơn, mở rộng quyền quay lại chờ duyệt, công tắc khẩn cấp.
- Kết nối thật bằng **Claude Code** (token và OAuth) và **MCP Inspector** chạy trên máy dev. Claude Desktop/claude.ai cần domain thật nên ghi vào `progress.md` để thử trên VPS.
- Đo token: kích thước `tools/list` của kết nối đủ menu, và kết quả của `deals_list` 50 dòng. Ghi số vào `progress.md`, làm mốc cho các module sau.
- Đọc ngay sau khi ghi: sửa dòng nguồn qua `rows_write` rồi `rows_query` ngay phải ra số mới (hoặc `stale` khi quá 5 giây).

## 10. Thay đổi so với quy định đã chốt

| Quy định cũ | Đổi thành | Ảnh hưởng |
|---|---|---|
| Scope token là danh sách chuỗi quyền (Module 1 Stage 1) | Scope là **menu và mức**; token cá nhân là một loại kết nối | Module 1, code Stage 1 (`api_tokens`, trang token, trang duyệt) |
| "Tool MCP được sinh từ command registry" (Module 0 mục 17) hiểu là mọi thao tác thành tool | Tool chọn lọc + `soe_operations` / `soe_describe` / `soe_call`; mọi thao tác vẫn tới được | Module 0 |
| AI làm được mọi thứ trừ Onboarding (brief) | Thêm cấm cứng nhóm **Tài khoản và quản trị** | CLAUDE.md mục AI |
| Mỗi stage phải có OpenAPI và Bruno | Từ Stage 6 thêm: thao tác mới khai báo `menu`, `access`; việc hay làm có tool chọn lọc | CLAUDE.md "Định nghĩa xong" |

## 11. Câu hỏi cho Dương

1. Bộ tool chọn lọc + `soe_call` (mục 4.1), hay cậu muốn mọi thao tác đều thành tool?
2. Cấm cứng nhóm quản trị với AI (mục 3.1), kể cả AI của Admin chỉ đọc nhật ký?
3. Ba mức Xem / Sửa / Sửa và xoá, mặc định không có mức xoá (mục 3.3)?
4. Kết nối chờ duyệt vẫn hoàn tất OAuth và báo lỗi `connection_pending` khi gọi (mục 2.4)?
5. Guest mẫu Data được tạo kết nối Token để kéo dữ liệu đã cấp (mục 6)?

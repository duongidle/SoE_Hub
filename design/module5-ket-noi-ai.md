# Module 5 — Kết nối AI

> Trạng thái: **Đã chốt** · 19/11/2026 (bản nháp vòng 1 sáng 19/11, vòng 2 khớp với Module 2, 4 sửa ngày 19/11 và Module 7 đã chốt; Dương chốt vòng 2, quyết định ở mục 11).
> Phụ thuộc: [Module 0](module0-nen-tang.md) (registry, actor, audit, mục 17 khung kết nối AI), [Module 1](module1-tai-khoan-phan-quyen.md) (token cá nhân, tài khoản hệ thống, ba lớp quyền), [Module 2](module2-datahub.md) (dòng, công thức, mục 6.7 đợi tính xong, mục 10 chia sẻ và khoá phân chia), [Module 3](module3-metric-dashboard.md) (`metrics.query`), [Module 4](module4-quan-ly-deal.md) (Quản lý Deal, vai trò cột, thanh toán, chốt kỳ), [Module 7](module7-dynamic-form.md) (Form qua API/MCP).
> Để module sau: thông báo khi có kết nối chờ duyệt (Module 6; Stage 5 dùng hộp thông báo của Module 1); tool của Form, Knowledge, AI Hub, Workspace do module đó thêm (mục 4.7).

Mục tiêu: AI của người dùng (Claude Desktop, claude.ai, Claude Code, Codex, ChatGPT) làm được mọi việc người đó làm được, trừ Onboarding và nhóm cấm (mục 3.3), tốn ít token, và Admin biết chính xác AI nào đang vào hệ thống, được vào menu nào.

---

## 1. Kênh

| Kênh | Dùng cho | Xác thực |
|---|---|---|
| **MCP** tại `/mcp` (Streamable HTTP) | AI: Claude Desktop, claude.ai, Claude Code, Codex, ChatGPT | OAuth hoặc token của kết nối |
| **REST** `/api/v1` | Script, Postman/Bruno, hệ thống ngoài; AI có công cụ gọi HTTP (Claude Code, Codex) | Token của kết nối, key API của cây, token tài khoản hệ thống |

- Cả hai sinh từ cùng registry (Module 0 mục 3.3), nên không có thao tác nào chỉ chạy ở một kênh.
- **Dùng MCP cho AI** là đường chính: AI biết sẵn công cụ, client tự lo OAuth, người dùng không dán token vào chat.
- **AI gọi thẳng REST** (Dương đồng ý 19/11): được, bằng **token của kết nối**. Quyền giống hệt khi đi qua MCP (cùng menu, mức, nhóm cấm), nhật ký ghi `via = api` kèm tên kết nối. Không cần thiết khi đã có `soe_call` (mục 4.1), nhưng hữu ích cho script AI tự viết.
- **Không bao giờ dùng phiên đăng nhập web** (cookie) cho AI hay script. Lý do: cookie mang toàn bộ quyền của người dùng, bỏ qua menu và mức của kết nối, nhật ký ghi là `web` nên không phân biệt được người với AI, và người dùng phải dán cookie vào chat. Thao tác ghi bằng cookie cần CSRF token (Module 1 mục 6.5) nên khó dùng ngoài trình duyệt; đọc bằng cookie thì server không chặn được hoàn toàn (giống giới hạn ở Module 0 mục 16), nên đây là quy ước: tài liệu và trang Kết nối AI không bao giờ hướng dẫn cách này.
- OAuth access token chỉ dùng cho `/mcp` (`resource`, mục 2.4); muốn gọi REST thì tạo token.

## 2. Kết nối

### 2.1 Khái niệm

**Kết nối** là một quyền truy cập đã được cấp cho một client cụ thể. Mọi credential dùng được ở `/mcp` hoặc `/api`, trừ tài khoản hệ thống, đều thuộc một kết nối.

| Trường | Ghi chú |
|---|---|
| Chủ | Một người (kết nối cá nhân) hoặc một cây (key API của cây, mục 2.5). Quyền của kết nối không bao giờ rộng hơn quyền của chủ |
| Loại | `OAuth` (connector) / `Token` (token cá nhân của Module 1) / `Key của cây` |
| Client | Tên client và nguồn: miền của `client_id` hoặc redirect URI (`claude.ai`, `chatgpt.com`, `localhost`) |
| Tên | Người dùng đặt, ví dụ "Claude Desktop máy công ty", "Request BPM" |
| Menu và mức | Mục 3 |
| Trạng thái | `Chờ duyệt` / `Đang hoạt động` / `Bị từ chối` / `Đã thu hồi` / `Hết hạn` |
| Hạn | Token: như Module 1 (mặc định 90 ngày, tối đa 1 năm). OAuth: hết hạn khi không dùng 30 ngày, tối đa 1 năm phải kết nối lại |
| Dùng lần cuối | Thời điểm, IP, client |

- **Token cá nhân của Module 1 trở thành một loại kết nối.** Scope dạng chuỗi quyền được thay bằng menu và mức (mục 3). Token cũ ở dev chuyển đổi bằng migration; chưa có người dùng thật nên không giữ tương thích.
- Tài khoản hệ thống (Module 1 mục 7) **không** phải kết nối: Admin cấp, scope riêng, không vào `/mcp`. Giữ cho tích hợp ở mức hệ thống (không thuộc cây nào).
- **Ai tạo được kết nối:** mọi vai trò trừ Guest mẫu Sale. Guest mẫu Data tạo được loại `Token` (Dương đồng ý 19/11), chỉ đọc đúng phần Manager đã cấp (Module 1 mục 5.2, Module 4 mục 15), để chạy script kéo dữ liệu hằng ngày thay cho export tay.

### 2.2 Admin duyệt

Mọi kết nối mới đều chờ Admin duyệt (giữ luật của Module 1 cho token).

- Admin thấy: chủ, client và nguồn, menu và mức xin, IP lúc tạo.
- Admin **duyệt**, **duyệt với ít quyền hơn** (bỏ bớt menu, hạ mức), hoặc **từ chối** kèm lý do.
- Chủ tự thu hẹp kết nối thì có hiệu lực ngay. **Mở rộng** (thêm menu, nâng mức) thì phần mở rộng quay lại `Chờ duyệt`; phần cũ vẫn chạy.
- Admin không tự duyệt kết nối của mình khi còn Admin khác (Module 1).
- Thông báo: có kết nối chờ duyệt → mọi Admin; có kết quả → chủ; sắp hết hạn (trước 7 ngày) → chủ (Module 6).

### 2.3 Chỉ AI được phép mới kết nối được

Brief muốn "AI khác kể cả có tài liệu API cũng không kết nối được". Ba lớp:

1. **Không có credential thì không có gì.** `/mcp` và `/api` không có thao tác nào chạy được khi chưa xác thực (Module 0 mục 16).
2. **Danh sách nguồn client cho phép** (Admin sửa). Mặc định: `claude.ai`, `claude.com`, `chatgpt.com`, `localhost` (Claude Code, Codex chạy trên máy). Client OAuth từ nguồn khác bị từ chối ngay ở bước đăng ký.
3. **Mỗi kết nối được Admin duyệt từng cái một.**

Giới hạn: nguồn `claude.ai`, `chatgpt.com` xác minh được (client chứng minh sở hữu miền). Nguồn `localhost` thì **không** phân biệt được Claude Code với một script tự viết. Vì vậy bước duyệt từng kết nối và nhật ký mới là chốt chặn thật, danh sách nguồn chỉ là lớp lọc đầu.

### 2.4 OAuth

- SoE Hub là authorization server, theo đặc tả xác thực của MCP: OAuth 2.1, bắt buộc PKCE `S256`, `resource` (RFC 8707) để token chỉ dùng được cho `/mcp` của SoE Hub.
- Endpoint: `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`, `/oauth/register`, `/oauth/authorize`, `/oauth/token`, `/oauth/revoke`. Gọi `/mcp` không có token trả `401` kèm `WWW-Authenticate: Bearer resource_metadata=…` để client tự tìm đường đăng nhập.
- Đăng ký client: hỗ trợ **Client ID Metadata Document** (client_id là một URL https, đặc tả MCP 2025-11) và **Dynamic Client Registration** (RFC 7591) cho client cũ. Kiểm lại client nào dùng cách nào khi code.
- Access token 1 giờ, refresh token 30 ngày, xoay vòng mỗi lần dùng (refresh token cũ dùng lại thì thu hồi cả kết nối). Server chỉ lưu bản băm.
- **Trang cho phép** (`/oauth/authorize`): đăng nhập SoE Hub nếu chưa → thấy tên client, nguồn, chọn menu và mức (mặc định theo mục 3.5) → bấm "Cho phép". Nút phụ "Huỷ".
- **Kết nối chờ duyệt vẫn hoàn tất OAuth** (Dương đồng ý 19/11). Client nhận token ngay (bắt client chờ Admin trong cửa sổ đăng nhập thì sẽ hết giờ). Mọi tool gọi lúc đang chờ trả lỗi `connection_pending`: "Kết nối đang chờ Admin duyệt. Báo Admin của bạn rồi thử lại." Admin duyệt xong thì dùng được ngay, không phải kết nối lại.
- Callback được phép theo nguồn ở mục 2.3, ví dụ `https://claude.ai/api/mcp/auth_callback`, `https://claude.com/api/mcp/auth_callback` (Module 0 mục 17), callback của ChatGPT, và `http://localhost:*` / `http://127.0.0.1:*`.

### 2.5 Key API của cây

Cho hệ thống request của Base đẩy deal và lịch thanh toán vào (Module 4 mục 7.1, 14).

- **Manager tự tạo** ở Cài đặt → Kết nối AI, như tạo token: chọn menu, mức, hạn. Admin duyệt như mọi kết nối. Không cần cấp vai trò Admin cho Manager.
- **Admin tạo** cho một cây thì không cần Admin duyệt (Dương chốt 19/11). Nhưng key mang quyền nghiệp vụ của Manager, mà Admin không có quyền nghiệp vụ (CLAUDE.md), nên key do Admin tạo chạy khi **một Manager của cây bấm nhận** (thay cho bước duyệt, một lần bấm). Manager nhận thông báo; chưa nhận thì gọi trả `connection_pending`. Lý do: không để Admin dùng key tự tạo mà ghi deal, chốt kỳ.
- **Chủ là cây, không phải người.** Quyền = quyền nghiệp vụ của vai trò Manager trên đúng cây đó (giao với menu và mức). Nhật ký ghi tên key ("Request BPM"), kèm người tạo.
- Đổi Manager của cây thì key ở lại, Manager mới quản lý tiếp. Manager nghỉ hoặc bị khoá **không** làm key ngừng chạy (khác token cá nhân: bị khoá thì mọi kết nối của người đó bị thu hồi).
- Lý do không dùng token cá nhân của Manager: tích hợp sẽ chết khi Manager rời đi, và nhật ký ghi mọi dòng tự động là "Manager X nhập".
- Không vào `/mcp` (dùng cho hệ thống, không cho AI).

## 3. Phạm vi theo menu

### 3.1 Menu

| Menu | Gồm | AI dùng được |
|---|---|---|
| Quản lý Deal | Mọi bảng của datahub "Quản lý Deal" (Deals, Index, Probation KPI, Đợt thanh toán, Tiền về, Sổ com, Chính sách com, Tham số com, bảng tự tạo), dashboard Deals, trang Template, thanh toán (lập lịch, ghép, xác nhận tiền về, điều chỉnh com), chốt kỳ, snapshot | ✓ |
| Datahub | Datahub thường: bảng, cột, dòng, view, công thức, import/export, dashboard, chỉ số, bảng gộp, chia sẻ | ✓ |
| Form | Module 7 | ✓ |
| Knowledge | Module 8 | ✓ |
| AI Hub | Module 8 | ✓ |
| Workspace | Module 10 | ✓ |
| Thông báo và nhắc hẹn | Module 6 | ✓ |
| Feedback | Module 11 | ✓ |
| **Onboarding** | Module 9 | **Cấm cứng**, không có trong danh sách chọn |
| **Tài khoản và quản trị** | Mục 3.3 | Theo nhóm cấm |

**Menu xác định theo đối tượng, không theo tên thao tác.** Datahub và Quản lý Deal dùng chung thao tác của engine (`datahub.row.*`, `datahub.column.*`…). Executor xác định menu theo **datahub đích** của lần gọi: datahub "Quản lý Deal" thuộc menu Quản lý Deal, mọi datahub khác thuộc menu Datahub. Nếu không làm vậy, kết nối chỉ có menu Datahub sẽ đọc được Deals qua `rows_query`.

- Bảng Datahub thường có công thức, lookup đọc sang Deals (Module 4 mục 1.1): kết quả nằm trong bảng của chính người đó nên đọc theo menu Datahub. Đây là dữ liệu người dùng chủ động kéo sang, không phải lỗ hổng.
- `datahub_list` (mục 4.2) không liệt kê datahub "Quản lý Deal", như trang Datahub.

### 3.2 Ba mức

| Mức | Được làm |
|---|---|
| **Xem** | Mọi query |
| **Sửa** | Thêm query và command tạo, sửa: thêm, sửa, xoá mềm từng dòng; tạo datahub, bảng, cột; chia sẻ; lập lịch, ghép, xác nhận tiền về, điều chỉnh com |
| **Toàn quyền** | Thêm: xoá datahub, bảng, cột; xoá nhiều dòng một lần; import "thay toàn bộ"; **thao tác lớn** (mục 3.4) |

Dương đồng ý ba mức (19/11). Mức thứ ba trước gọi "Sửa và xoá", đổi tên vì nay gồm cả thao tác lớn.

### 3.3 Nhóm cấm AI

Không phải thao tác nào cũng mở cho AI. Hai lớp (Dương chốt 19/11: phải có nhóm cấm, Admin bật tắt được):

**Cấm cứng** (không bật được, kể cả Admin). Đây là những việc giúp AI tự nâng quyền hoặc che dấu vết:

- Mọi `onboarding.*`.
- Tạo, duyệt, mở rộng, thu hồi token và kết nối; đổi chính sách AI (mục 6). AI không được tự duyệt kết nối của chính nó.
- Đổi mật khẩu, phiên, thiết bị; đăng ký đẩy thông báo (Module 6 mục 8).
- Nộp bài kiểm tra (Module 7 mục 6.5); nhập key API của nguồn dữ liệu form (Module 7 mục 2.5).

**Cấm mặc định, Admin bật được theo nhóm** (trang Chính sách, mục 6):

| Nhóm | Gồm |
|---|---|
| Tổ chức | Org chart, vai trò, quyền bổ sung |
| Cấp dữ liệu Guest | Module 1 mục 5.2 |
| Chuyển giao dữ liệu | Module 1 mục 8 |
| Cài đặt hệ thống | Giới hạn, cài đặt chung |
| Nhật ký | Đọc nhật ký hệ thống (chỉ đọc) |

Bật nhóm nào thì thao tác trong nhóm vẫn chỉ chạy được cho người có quyền đó trên web (Admin, Manager), qua kết nối có mức đủ. Bật hay tắt đều ghi nhật ký.

**Chia sẻ không nằm trong nhóm cấm** (Dương chốt 19/11). AI đổi chia sẻ, khoá phân chia, cho phép sửa cột như người dùng, server kiểm quyền như mọi kênh. Việc không hợp lệ (tag người không phải thành viên của bảng, thêm người ngoài danh sách org chart) thì không được ghi, trả lỗi kèm lý do (mục 4.4).

### 3.4 Thao tác lớn: xem trước rồi xác nhận

Dương muốn AI làm được cả việc lớn để tiện cho Manager (chốt 19/11). Gồm: **chốt kỳ**, **mở lại kỳ**, **sửa template cho cả cây hoặc team** (thêm, sửa, bỏ cột/bảng template, quyền sửa ô, quyền Leader), **chuyển vai trò cột**.

Một cơ chế chung trong registry (`confirm: true` trên thao tác), web và AI dùng cùng một đường:

1. **Xem trước:** gọi thao tác với `preview: true`. Kết quả giống màn hình web: với chốt kỳ là các mục cần xử lý, com theo người, số dòng do AI/API nhập chưa kiểm (Module 4 mục 12); với template là "áp dụng cho 18 người", nơi đang dùng cột, deal thuộc kỳ đã chốt bị chặn (Module 4 mục 3.7). Kèm **mã xác nhận** hết hạn sau 10 phút.
2. **Xác nhận:** gọi lại với mã đó. Số liệu đổi sau lúc xem trước (mã gắn với bản băm của trạng thái đã xem) thì mã hết hiệu lực, phải xem trước lại.

- Tool có `destructiveHint` (mục 4.6), nên Claude và ChatGPT hỏi người dùng trước khi chạy bước xác nhận. Mô tả tool yêu cầu AI đưa nội dung xem trước cho người dùng đọc.
- Cần mức **Toàn quyền**; kết nối mới không có sẵn mức này.
- **AI không tự đánh dấu "Đã kiểm" từng dòng.** Manager xác nhận chốt kỳ sau khi xem danh sách dòng chưa kiểm thì chính lần xác nhận đó là bước kiểm: các dòng được ghi `Kiểm khi chốt qua AI (tên kết nối)`, phân biệt với dòng Manager kiểm trên web.
- Làm xong qua AI → Manager nhận thông báo tóm tắt kèm link sang màn hình web tương ứng.
- Câu lừa trong dữ liệu (ghi chú deal, nội dung UNC) không chốt kỳ được vì vẫn phải qua xem trước, mã xác nhận và bước hỏi người dùng của client.

### 3.5 Cách tính quyền thực tế

Quyền thực tế = **giao** của năm thứ (cụ thể hoá Module 0 mục 3.4):

1. Quyền của chủ lúc gọi: vai trò hiện tại, phạm vi dữ liệu, chủ sở hữu, chia sẻ, khoá phân chia, cho phép sửa theo cột (Module 2 mục 10).
2. Menu và mức của kết nối.
3. Chính sách AI của Admin (mục 6), gồm nhóm cấm đã bật.
4. Cờ `aiAllowed` và nhóm cấm của thao tác trong registry.
5. Tuỳ chọn của bảng, ví dụ "Thành viên được thêm dòng hàng loạt" (tắt ở mọi bảng template, kể cả Deals).

Cài đặt trong code: mỗi thao tác khai báo `access` (`read` / `write` / `full`), nhóm cấm (nếu có), và **menu** (cố định, hoặc hàm tìm menu theo đối tượng đích cho thao tác của engine Datahub, mục 3.1). Thao tác thiếu khai báo thì không gọi được qua kết nối (mặc định đóng); test bắt lỗi này lúc khởi động.

Người dùng mất vai trò: quyền kết nối thu hẹp theo ngay ở lần gọi kế tiếp. Bị khoá: mọi kết nối cá nhân bị thu hồi (Module 1); key của cây không bị ảnh hưởng (mục 2.5).

Mặc định khi tạo kết nối: Quản lý Deal, Datahub, Thông báo mức **Sửa**; các menu khác mức **Xem**; không menu nào mức **Toàn quyền**. Người dùng đổi trước khi bấm "Cho phép".

## 4. Bộ công cụ MCP

### 4.1 Tool chọn lọc + ba tool chung

Registry sẽ có vài trăm thao tác. Mô tả của mỗi tool nằm trong ngữ cảnh của AI ở **mọi** lượt chat, kể cả khi không dùng: vài trăm tool thì vừa tốn token vừa dễ chọn nhầm. Dương đồng ý cách sau (19/11):

- **Tool chọn lọc** (khoảng 20–30 khi đủ các module): việc hay làm, đầu vào đơn giản, kết quả gọn. Khai báo bằng `mcp: { tool, description }` trên thao tác.
- **Ba tool chung**: `soe_operations` (liệt kê thao tác theo menu, mỗi thao tác một dòng), `soe_describe` (schema đầu vào của một thao tác), `soe_call` (gọi một thao tác theo tên). Mọi thao tác AI được phép đều tới được qua đây, **không phải viết thêm gì**.
- `tools/list` chỉ trả tool thuộc menu kết nối được cấp và không thuộc nhóm cấm.

### 4.2 Tool chọn lọc ở Stage 5

| Tool | Menu, mức | Việc |
|---|---|---|
| `soe_whoami` | luôn có | Tôi là ai, vai trò, cây/team, menu và mức của kết nối, hôm nay, quý hiện tại, kỳ đang mở |
| `soe_find` | theo menu | Tìm theo tên: datahub, bảng, cột, deal, người. Trả id để gọi tiếp. Tìm người theo một bảng thì chỉ trả thành viên của bảng đó |
| `deals_list` | Quản lý Deal, Xem | Lọc deal bằng tham số dễ dùng (trạng thái, loại deal, kỳ, `của tôi` / `team`, chữ tìm), chọn cột, sắp xếp |
| `deal_get` | Quản lý Deal, Xem | Một deal: mọi cột được xem, `Người tham gia`, BANT, các đợt thanh toán và com của tôi từng đợt, lịch sử gần nhất |
| `deal_update` | Quản lý Deal, Sửa | Sửa ô theo tên cột |
| `deal_bant_score` | Quản lý Deal, Sửa | Chấm B, A, N, T cho một deal |
| `deals_rescore_queue` | Quản lý Deal, Xem | Hàng chờ "Cần chấm lại hôm nay" |
| `deal_metrics` | Quản lý Deal, Xem | Chỉ số Deals theo kỳ và phạm vi (mục 4.3). "Winrate quý này của tớ" một lần gọi |
| `payment_schedule` | Quản lý Deal, Sửa | Lập hoặc sửa lịch thanh toán cả deal một lần (`payment.schedule`) |
| `payment_match` | Quản lý Deal, Xem | Gợi ý đợt cho một khoản tiền về, kèm lý do (`payment.match_candidates`) |
| `payment_confirm` | Quản lý Deal, Sửa | Xác nhận tiền về một hoặc nhiều đợt (`payment.confirm`) |
| `datahub_list` | Datahub, Xem | Datahub thường, bảng, số dòng, cột (tên, kiểu) |
| `datahub_create` | Datahub, Sửa | Tạo datahub kèm bảng và cột trong **một** lần gọi (JSON) |
| `table_schema` | theo menu, Xem | Cột, kiểu, lựa chọn; công thức nếu là chủ; vai trò cột, lớp cột, cột mình được sửa; bảng template hay không, khoá phân chia, thành viên, tuỳ chọn thêm dòng hàng loạt |
| `table_alter` | theo menu, Sửa | Thêm, sửa nhiều cột một lần; xoá cột cần Toàn quyền. Bảng template: người nhận chỉ thêm cột riêng |
| `rows_query` | theo menu, Xem | Lọc (cú pháp Module 0 + `time_filter`), sắp xếp, `fields`, phân trang |
| `rows_write` | theo menu, Sửa | Tạo, sửa, upsert, xoá tối đa 500 dòng một lần (mục 4.4) |
| `formula_check` | Datahub, Xem | Kiểm tra và xem trước công thức (`datahub.formula.preview`) |
| `metrics_query` | theo menu, Xem | Chỉ số bất kỳ bằng JSON (Module 3 mục 10), kể cả trỏ cột theo vai trò |
| `dashboard_get`, `dashboard_save` | theo menu, Xem / Sửa | Đọc và ghi cấu hình dashboard bằng JSON |

Chốt kỳ, mở lại kỳ, điều chỉnh com, sửa template, chuyển vai trò cột đi qua `soe_call` (ít dùng, cơ chế xem trước ở mục 3.4).

**Tool Deals chạy trên bảng Deals của người gọi**, giống hệt grid: dòng theo khoá phân chia (Module 2 mục 10); sửa ô khi có quyền Sửa **và** cột được cho phép sửa (Module 4 mục 3.6). Không có luật riêng trong tool.

**Tham số dễ dùng tìm cột theo vai trò cột** (Module 4 mục 3.7), không theo tên, vì Manager đổi tên cột được: `trạng thái` → cột có vai trò `trạng thái`, lọc theo nghĩa lựa chọn (mở / thắng / thua / huỷ); `kỳ` dùng bốn cách hiểu "deal thuộc kỳ" của Module 4 mục 11a, mặc định "Liên quan đến kỳ". `deal_update` nhận tên cột hoặc vai trò.

### 4.3 `deal_metrics` đọc đúng chỉ số của dashboard hệ thống

Không định nghĩa lại chỉ số. `deal_metrics` gọi đúng các chỉ số của dashboard hệ thống Deals của cây người gọi (Module 4 mục 13, trỏ cột theo vai trò), qua `metrics.query`. Một số chỉ có một nơi tính, nên AI và dashboard luôn ra cùng con số.

Gồm: KPI đã đạt / còn thiếu, doanh thu (theo ngày tiền về, phần `doanh thu được tính` của người xem), CR1, CR2, winrate theo cycle (mốc mặc định của cây hoặc tham số), forecast hai phần (đã ký chờ tiền về / chưa ký), com (tạm tính, đã chốt, chờ nhận), deal size, cycle, workload.

### 4.4 Quy ước để tốn ít token

- **Mô tả tool viết bằng tiếng Anh, ngắn.** Chữ tiếng Việt có dấu tốn token gấp khoảng 2–3 lần, mà mô tả tool nằm trong ngữ cảnh ở mọi lượt. Dữ liệu và thông báo lỗi vẫn là tiếng Việt.
- **Kết quả dạng bảng:** `{"columns": [...], "rows": [[...], ...], "total": 1284, "next_cursor": "..."}`, không lặp tên trường ở từng dòng.
- Giá trị **dạng máy đọc**: ngày `2026-11-19`, tiền là số nguyên VND, phần trăm `0.25`, lựa chọn trả **tên** (không trả mã `o_…`), người trả họ tên kèm email. Định dạng `vi-VN` chỉ là việc của giao diện.
- `Người tham gia`: mỗi người `{email, name, role, revenue_share, com_share, count_deal}`. Tool không tự che: đọc qua cùng lớp che của engine (Guest chưa được cấp tỉ lệ chỉ thấy tên và vai trò; số tiền com chỉ của mình, Leader của team, Manager của cây; Module 4 mục 9, 15).
- Mặc định 50 dòng, tối đa 500; có `total` khi tính được nhanh.
- Có `fields` để chọn cột. Không gửi cột hệ thống và cột hỗ trợ tính đang ẩn ("của tôi", Module 4 mục 4.1) trừ khi xin.
- Số liệu tổng hợp tính ở server (`deal_metrics`, `metrics_query`), AI không kéo dòng thô về tự cộng.
- Mỗi kết quả có cả `structuredContent` (JSON) và một bản chữ gọn.

### 4.5 Lỗi để AI tự sửa

Lỗi trả `isError: true` kèm `{code, message, hint, details}` tiếng Việt, đủ để AI tự sửa mà không phải hỏi người dùng:

- Sai tên cột: liệt kê tên cột đúng gần nhất.
- Sai giá trị lựa chọn: liệt kê lựa chọn hợp lệ.
- Ô Người dùng nhận người không phải thành viên của bảng: không ghi, liệt kê thành viên có tên gần nhất, nhắc chủ bảng thêm người đó vào chia sẻ nếu cần.
- Thêm nhiều dòng mới vào bảng tắt "Thành viên được thêm dòng hàng loạt": báo rõ, gợi ý tạo từng dòng.
- Không đủ quyền: nói thiếu quyền của người dùng, thiếu mức của kết nối ("Kết nối này chỉ có mức Xem cho Datahub. Vào Cài đặt → Kết nối AI để xin thêm"), hay thao tác thuộc nhóm cấm ("Admin chưa bật nhóm Tổ chức cho AI").
- Kỳ đã chốt: báo kỳ nào, gợi ý dòng điều chỉnh (Module 4 mục 12).
- `409 conflict`: kèm giá trị hiện tại để AI đọc lại rồi sửa.

**`rows_write` ghi được gì thì ghi** (Dương chốt 19/11): lỗi tách theo **từng dòng**. Dòng có ô sai thì bỏ qua cả dòng (không ghi nửa dòng), các dòng khác vẫn ghi; kết quả liệt kê dòng bị bỏ và lý do. REST và `soe_call` giữ kiểu cả lô cùng thành công hoặc cùng thất bại (Module 2, một giao dịch), trừ khi gửi `partial: true`.

### 4.6 Đọc ngay sau khi ghi

AI hay sửa xong là hỏi lại số ngay ("sửa doanh thu rồi cho tớ winrate", "xác nhận tiền về rồi cho tớ com tháng này"). Công thức liên bảng do worker tính mất vài giây (Module 2 mục 6.7).

- Mọi tool ghi trả số thứ tự thay đổi `seq`, kể cả `payment_confirm` (sinh dòng Sổ com, chuyển deal sang Won).
- Tool đọc qua MCP mặc định `consistent=true`: đợi các cột cần đọc tính tới số mới nhất, tối đa 5 giây; quá thì trả giá trị hiện có kèm `stale: true` và danh sách cột chưa xong. REST giữ mặc định của Module 2 (không đợi).

### 4.7 Gợi ý cho client về thao tác nguy hiểm

Mỗi tool khai báo `annotations` của MCP từ registry: query → `readOnlyHint`; xoá và thao tác lớn → `destructiveHint`; ghi có `Idempotency-Key` → `idempotentHint`. Claude và ChatGPT dựa vào đây để hỏi người dùng trước khi chạy.

### 4.8 Module sau thêm tool thế nào

- Thao tác mới khai báo `aiAllowed`, menu, `access` (và nhóm cấm nếu có) thì tự dùng được qua `soe_call` từ ngày đầu.
- Module có việc hay làm qua AI thì thêm tool chọn lọc: Form (`form_get`, `form_save` bằng JSON, `form_responses`; nộp form thường qua `soe_call` với mức Sửa, Module 7 mục 5.1), Knowledge và AI Hub (`knowledge_search`, `knowledge_get`, `knowledge_submit`, `skill_search`, `skill_get`, `skill_submit`; lỗi kiểm tra trả có cấu trúc), Workspace (`tasks_list`, `task_save`), Thông báo (`reminder_create`, `notifications_list`).
- Giới hạn tổng **30 tool chọn lọc**. Muốn vượt thì bỏ bớt tool ít dùng (đo bằng nhật ký) trước khi thêm.

## 5. Bảo vệ

- **Tốc độ** (mặc định, Admin chỉnh): mỗi kết nối 120 lần gọi/phút, 30 lần ghi/phút, 5.000 dòng ghi/giờ. Quá thì `429` kèm thời gian chờ.
- **Xoá luôn là xoá mềm**, khôi phục trong thùng rác. Deal không bao giờ bị xoá (Module 4). Dòng Sổ com `Đã chốt` không ai sửa, kể cả qua AI.
- **Nhật ký:** mọi lần gọi qua kết nối ghi audit với `via = mcp` hoặc `api`, tên kết nối, tên tool (Module 0 mục 9.2). Thông báo do AI gây ra ghi rõ "qua Claude Desktop (kết nối của Dương)".
- **Nguồn nhập** của bảng có cột này (Đợt thanh toán, Tiền về, Module 4 mục 7): ghi qua `/mcp` → `AI (tên kết nối)`; qua `/api` bằng token → `API (tên kết nối)`; key của cây → `API (tên key)`. Đi vào view "Do AI nhập chưa kiểm" và màn chốt kỳ.
- **Prompt injection:** dữ liệu trong bảng (ghi chú deal, UNC, bài Knowledge) có thể chứa câu lừa AI. Server không chặn được việc AI làm theo nội dung đó. Giới hạn thiệt hại bằng: mức của kết nối, nhóm cấm, xem trước + mã xác nhận cho thao tác lớn, xoá mềm, giới hạn tốc độ, nhật ký. Hướng dẫn kết nối khuyên dùng mức Xem cho kết nối dùng hằng ngày.
- **Dữ liệu riêng giữ nguyên luật:** AI của Admin không đọc datahub của người khác (Quản lý Deal thì xem chỉ đọc như trên web); AI của Guest chỉ thấy phần được cấp.

## 6. Chính sách AI của Admin

Trang Admin → Kết nối AI → Chính sách:

| Cài đặt | Mặc định |
|---|---|
| Cho phép kết nối AI | Bật. Tắt = mọi kết nối ngừng ngay (công tắc khẩn cấp), mở lại thì chạy tiếp, không phải duyệt lại. Key của cây và tài khoản hệ thống không bị tắt theo (có công tắc riêng) |
| Menu AI được dùng trong toàn hệ thống | Mọi menu ở mục 3.1 trừ Onboarding |
| Mức cao nhất trong toàn hệ thống | Toàn quyền |
| Nhóm cấm đã bật cho AI | Không nhóm nào (mục 3.3) |
| Nguồn client cho phép | Mục 2.3 |
| Giới hạn tốc độ | Mục 5 |
| Hạn tối đa của kết nối | 1 năm |
| Ai được tạo kết nối | Mọi vai trò trừ Guest mẫu Sale; Guest mẫu Data chỉ loại Token (mục 2.1) |

## 7. Giao diện tối thiểu (Stage 5)

**Người dùng: Cài đặt → Kết nối AI**

- Danh sách kết nối của mình: tên, client, menu và mức, trạng thái, dùng lần cuối. Thu hồi, đổi tên, thu hẹp hoặc xin thêm quyền.
- "Tạo token" (Claude Code, Codex, script): chọn menu, mức, hạn → token hiện một lần, kèm lệnh cài đã điền sẵn domain và token.
- Manager: "Tạo key API của cây" (mục 2.5), danh sách key của cây.
- **Hướng dẫn kết nối** ngay trên trang: tab Claude Desktop / claude.ai, Claude Code, Codex, ChatGPT, REST. Lệnh có nút sao chép, domain điền sẵn.

**Admin: Kết nối AI**

- Chờ duyệt: duyệt, duyệt với ít quyền hơn, từ chối.
- Mọi kết nối (kể cả key của cây): lọc theo chủ, client, trạng thái; thu hồi.
- Chính sách (mục 6), gồm bật tắt nhóm cấm.
- Nhật ký lọc theo kết nối hiện **tên kết nối** thay cho mã (bổ sung trang nhật ký của Module 1).
- Phân trang danh sách token và tài khoản hệ thống (việc còn nợ từ Stage 1).

**Trang cho phép OAuth** (`/oauth/authorize`): như mục 2.4. Phải dùng tốt ở 375px (claude.ai trên điện thoại mở trang này).

## 8. Tài liệu bàn giao

- `docs/api/ket-noi-ai.md`: cài cho từng client, menu và mức, nhóm cấm, thao tác lớn (xem trước, xác nhận), xử lý lỗi thường gặp (`connection_pending`, `401`, `429`).
- `docs/api/he-thong-ngoai.md`: key của cây, tài khoản hệ thống, `deal.upsert` và `payment.*` theo `source` + `external_id`, `Idempotency-Key`, `version`.
- Bộ Bruno **đầy đủ** mọi endpoint (kể cả OAuth), có môi trường dev và production.
- Danh sách tool MCP và thao tác AI được phép sinh tự động từ registry (tên, mô tả, menu, mức, nhóm cấm), để kiểm tra cái gì lộ ra.

## 9. Kiểm thử

- Ma trận quyền mở rộng thêm chiều **kênh MCP**, **mức kết nối**, **nhóm cấm**: vai trò × thao tác × menu/mức × kênh.
- Thao tác thiếu menu/`access` làm test khởi động fail. Mọi `onboarding.*` và thao tác cấm cứng không gọi được qua `soe_call` hay REST bằng token, kể cả khi Admin bật mọi nhóm.
- Menu theo đối tượng: kết nối chỉ có Datahub không đọc, ghi được bảng nào của "Quản lý Deal" qua `rows_query`, `rows_write`, `metrics_query`, `soe_call`; công thức ở datahub thường đọc sang Deals vẫn đúng.
- Khoá phân chia qua MCP: User A không thấy deal, đợt, dòng Sổ com của User B; Leader thấy của team; số `deal_metrics` bằng số dashboard hệ thống cho từng vai trò.
- `rows_write` từng phần: lô 10 dòng có 2 dòng tag người ngoài thành viên → ghi 8, báo 2 kèm lý do; không có dòng nào ghi nửa.
- Thao tác lớn: không có mã thì chỉ xem trước; mã hết hạn; số liệu đổi sau xem trước thì mã bị từ chối; thiếu mức Toàn quyền bị từ chối; dòng chưa kiểm được ghi "Kiểm khi chốt qua AI".
- Luồng OAuth với client giả: đăng ký (cả hai cách), PKCE, `resource`, xoay refresh token, dùng lại refresh token cũ thì thu hồi cả kết nối, chờ duyệt, duyệt với ít quyền hơn, mở rộng quay lại chờ duyệt, công tắc khẩn cấp.
- Key của cây: Manager bị khoá thì key vẫn chạy; đổi Manager thì Manager mới thấy và thu hồi được; key chỉ ghi vào cây của nó.
- Kết nối thật bằng **Claude Code** (token và OAuth) và **MCP Inspector** trên máy dev. Claude Desktop/claude.ai cần domain thật nên ghi vào `progress.md` để thử trên VPS.
- Đo token: kích thước `tools/list` của kết nối đủ menu, kết quả `deals_list` 50 dòng. Ghi số vào `progress.md`, làm mốc cho các module sau.
- Đọc ngay sau khi ghi: `rows_write` rồi `rows_query` ngay phải ra số mới (hoặc `stale` khi quá 5 giây); `payment_confirm` rồi `deal_metrics` ra com mới.

## 10. Thay đổi so với quy định đã chốt

| Quy định cũ | Đổi thành | Ảnh hưởng |
|---|---|---|
| Scope token là danh sách chuỗi quyền (Module 1 Stage 1) | Scope là **menu và mức**; token cá nhân là một loại kết nối | Module 1, code Stage 1 (`api_tokens`, trang token, trang duyệt) |
| "Tool MCP được sinh từ command registry" (Module 0 mục 17) hiểu là mọi thao tác thành tool | Tool chọn lọc + `soe_operations` / `soe_describe` / `soe_call`; mọi thao tác được phép vẫn tới được | Module 0 |
| AI làm được mọi thứ trừ Onboarding (brief) | Thêm **nhóm cấm**: cấm cứng (token, kết nối, chính sách AI, mật khẩu, phiên) và cấm mặc định Admin bật được (tổ chức, cấp dữ liệu Guest, chuyển giao, cài đặt, nhật ký) | CLAUDE.md mục AI |
| Registry: `aiAllowed` | Thêm menu (cố định hoặc theo đối tượng đích), `access`, nhóm cấm, `confirm` cho thao tác lớn | Module 0 mục 3.3 |
| Tài khoản hệ thống ghi vào cây được cấp; "kết nối API do Manager tạo" (Module 4 mục 7.1, 14) | **Key API của cây** do Manager tạo, Admin duyệt; Admin tạo thì Manager của cây nhận (mục 2.5) | Module 4 mục 7.1, 14 |
| Chốt kỳ, sửa template, chuyển vai trò cột qua màn xem trước trên web (Module 4 mục 3.7, 3.8, 12) | Cùng một cơ chế xem trước + mã xác nhận cho web và AI, cần mức Toàn quyền; AI không tự đánh "Đã kiểm" (mục 3.4) | Module 4 mục 12, 15 |
| Batch dòng một giao dịch (Module 2) | `rows_write` của MCP ghi từng phần theo dòng; REST giữ cả lô, trừ `partial: true` | Module 2 |
| Mỗi stage phải có OpenAPI và Bruno | Từ Stage 6 thêm: thao tác mới khai báo menu, `access`, nhóm cấm; việc hay làm có tool chọn lọc | CLAUDE.md "Định nghĩa xong" |

## 11. Quyết định của Dương

Đã chốt 19/11/2026: MCP là kênh chính, tool chọn lọc + `soe_operations` / `soe_describe` / `soe_call` (4.1); AI gọi REST bằng token của kết nối, không bằng phiên web (1); ba mức Xem / Sửa / Toàn quyền (3.2); nhóm cấm AI gồm cấm cứng và cấm mặc định Admin bật được (3.3); AI đổi chia sẻ như người dùng, việc không hợp lệ thì không ghi và báo lý do (3.3, 4.5); menu theo đối tượng, Quản lý Deal tách khỏi Datahub (3.1); kết nối chờ duyệt vẫn hoàn tất OAuth (2.4); Guest mẫu Data tạo được token (2.1); key API của cây, Admin tạo thì không cần Admin duyệt (2.5); thao tác lớn qua AI bằng xem trước + mã xác nhận, cần Toàn quyền, AI không tự đánh "Đã kiểm" (3.4); `rows_write` ghi từng phần theo dòng (4.5).

Tự quyết khi chốt (chờ Dương phản biện nếu muốn khác): key do Admin tạo cần một Manager của cây bấm nhận, vì Admin không có quyền nghiệp vụ (2.5).

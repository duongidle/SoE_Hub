# Module 0 — Nền tảng

> Trạng thái: **Đã chốt** · 18/11/2026
> Phạm vi: kiến trúc, tech stack, quy ước dữ liệu và API, lịch sử/audit, khoá kỳ, sự kiện, job, file, bảo mật nền, hiệu năng, tài liệu API.
> Hạ tầng triển khai: xem [ha-tang.md](ha-tang.md).

Module này là nền móng cho mọi module khác. Nó định nghĩa những gì mọi module phải dùng chung, để sau này thêm module mới (kể cả **Automation**, chưa thiết kế) mà không phải sửa lại lõi.

---

## 1. Quy mô và mục tiêu hiệu năng

| Hạng mục | Giá trị thiết kế |
|---|---|
| Người dùng thường xuyên | 15–20 |
| Người dùng thỉnh thoảng | Vài trăm (sale, bộ phận Data, guest) |
| Bảng Deals | > 10.000 dòng hiện tại, thiết kế cho 100.000+ |
| Datahub khác | Không giới hạn số dòng, thiết kế cho 100.000 dòng/bảng |

Mục tiêu (đo ở p95, trên VPS 2 vCPU/4GB, dữ liệu 100.000 deal):

- Lọc/sắp xếp/tìm kiếm một bảng: < 300 ms phía server.
- Mở trang bảng lần đầu: < 1,5 s đến khi thấy dữ liệu.
- Cuộn bảng: mượt 60 fps, không giật khi cuộn nhanh.
- Một biểu đồ dashboard: < 1 s.

Trước khi phát hành, chạy load test với 100.000 deal giả lập. Không đạt mục tiêu thì chưa phát hành.

## 2. Tech stack

| Lớp | Chọn | Lý do |
|---|---|---|
| Ngôn ngữ | TypeScript toàn bộ, monorepo pnpm | Một bộ schema (Zod) dùng chung cho API, MCP, form JSON, công thức |
| Runtime | Node.js 22 LTS | Ổn định, hệ sinh thái lớn |
| Web server | Fastify | Nhanh, có sẵn rate-limit, helmet, sinh OpenAPI từ schema |
| Database | PostgreSQL 17 | JSONB cho cột tuỳ chỉnh; `pg_trgm` + `unaccent` cho tìm kiếm tiếng Việt; `pgvector` khi cần tìm kiếm ngữ nghĩa |
| ORM | Drizzle | Gần SQL, migration rõ ràng, query động cho Datahub viết bằng SQL builder |
| Job/lịch | pg-boss (chạy trên Postgres) | Không cần Redis, ít thứ phải vận hành |
| Auth | better-auth (kiểm lại phiên bản khi code) | Session cookie, Google OAuth, API key, OAuth provider cho MCP |
| MCP | `@modelcontextprotocol/sdk`, Streamable HTTP, OAuth 2.1 + DCR | Chuẩn mà Claude Desktop, claude.ai, Claude Code, Codex, ChatGPT đều dùng được |
| Frontend | React + Vite, TanStack Router + Query, shadcn/ui (Tailwind) | SPA nội bộ, nhanh, dễ làm đẹp ở giai đoạn sau |
| Bảng dữ liệu | Glide Data Grid | Vẽ bằng canvas, chỉ vẽ ô đang hiển thị, chịu hàng trăm nghìn dòng |
| Biểu đồ | Apache ECharts | Nhiều loại biểu đồ, hiệu năng tốt |
| Kéo thả | dnd-kit | Form builder, sắp xếp |
| Soạn thảo | Tiptap | Bài viết Knowledge, mô tả, text trong form |
| Lưu file | S3-compatible (Cloudflare R2 hoặc MinIO) | File riêng tư, link tải có hạn |
| Triển khai | Docker Compose + Caddy (TLS tự động) | Một VPS là đủ |

Đã cân nhắc và loại: NocoDB/Baserow (phải vật lộn với luật riêng của Deals, cây phân quyền và MCP), Supabase (tự host nặng, logic dồn vào RLS khó test), Python/Django (mất lợi thế dùng chung schema và engine công thức giữa server và trình duyệt).

## 3. Kiến trúc

### 3.1 Modular monolith

Một codebase, chạy hai tiến trình:

- `api`: phục vụ web, REST API, MCP, form công khai.
- `worker`: chạy job nền (tính lại công thức, snapshot, nhắc hẹn, dọn thùng rác, import file lớn, phát sự kiện).

Hai tiến trình dùng chung code và database. Muốn chịu tải hơn thì chạy thêm bản `api`, không phải tách hệ thống.

### 3.2 Các lớp

```
 Web UI ─┐
 REST  ──┼──►  Command / Query registry  ──►  Service của từng module  ──►  Repository  ──►  PostgreSQL
 MCP   ──┤          (kiểm tra quyền,              (logic nghiệp vụ)
 Worker ─┘           validate, audit)                    │
 (Automation sau này)                                     └──► Outbox (sự kiện)
```

Luật:

1. **Route không chứa logic.** REST, MCP, UI và worker đều gọi cùng một command/query. Một thao tác chỉ có một chỗ cài đặt.
2. **Mọi kiểm tra quyền chạy ở server, trong lớp command/query.** Ẩn nút trên giao diện chỉ là tiện lợi, không phải bảo mật.
3. **Module không đọc bảng của module khác.** Muốn dữ liệu của module khác thì gọi query của nó hoặc nghe sự kiện của nó.

### 3.3 Command / Query registry

Mỗi thao tác của hệ thống được khai báo một lần:

```ts
defineCommand({
  name: "datahub.row.update",          // tên ổn định, dùng cho API, MCP, audit, automation
  input: RowUpdateSchema,               // Zod
  permission: "datahub:write",          // quyền cần có
  aiAllowed: true,                      // AI có được gọi không (onboarding.* = false cứng)
  audit: "write",                       // mức ghi log
  emits: ["datahub.row.updated"],       // sự kiện phát ra
  handler: async (ctx, input) => { ... }
})
```

Lợi ích: REST endpoint và MCP tool được sinh từ registry. Automation (sau này) chỉ cần gọi command theo tên. Audit log ghi đúng tên thao tác. Admin tắt một nhóm command cho AI chỉ bằng cấu hình.

### 3.4 Actor

Mọi command chạy với một `actor`:

| Trường | Ý nghĩa |
|---|---|
| `userId` | Người thực hiện (hoặc tài khoản hệ thống) |
| `via` | `web` / `api` / `mcp` / `worker` / `automation` |
| `connectionId` | Kết nối AI hoặc token đã dùng (nếu có) |
| `scopes` | Scope của token/kết nối |
| `ip`, `userAgent` | Phục vụ audit |

Quyền thực tế = giao của (quyền của user, scope của kết nối, chính sách chung admin đặt cho AI). Chi tiết ở Module 1 và Module 5.

## 4. Cấu trúc monorepo

```
apps/
  api/            Fastify: REST, MCP, auth, form công khai; entry worker cũng ở đây
  web/            React SPA
packages/
  shared/         Schema Zod, kiểu dữ liệu, hằng số, mã lỗi
  formula/        Parser + evaluator công thức (chạy cả server và trình duyệt)
  metrics/        Định nghĩa và engine tính chỉ số
  db/             Schema Drizzle, migration, seed
docs/
  api/            Hướng dẫn kết nối, bộ request Bruno
design/           Thiết kế từng module
```

## 5. Quy ước dữ liệu

- **ID:** UUIDv7 cho mọi bản ghi (sắp xếp được theo thời gian, không đoán được). Deal có thêm mã dễ đọc `D-000123`.
- **Cột chuẩn ở mọi bảng nghiệp vụ:** `id`, `created_at`, `created_by`, `updated_at`, `updated_by`, `version`, `deleted_at`, `deleted_by`.
- **Thời gian:** thời điểm lưu UTC (`timestamptz`), hiển thị giờ Việt Nam. Trường chỉ có ngày lưu kiểu `date`.
- **Tiền:** số nguyên VND (`bigint`), không dùng số thực.
- **Phần trăm, tỉ lệ:** `numeric`, lưu dạng 0,25 cho 25%.
- **Quý:** mặc định theo năm dương lịch; admin đổi được trong cài đặt nếu công ty dùng năm tài chính khác.
- **Tiếng Việt:** tìm kiếm không phân biệt dấu và hoa thường (`unaccent` + `lower`).

## 6. Bảng lớn và tốc độ tải

### 6.1 Nguyên tắc

1. **Không bao giờ gửi cả bảng về trình duyệt.** Lọc, sắp xếp, tìm kiếm, đếm, tổng hợp đều chạy ở server.
2. **Chỉ vẽ phần đang nhìn thấy.** Glide Data Grid vẽ bằng canvas và chỉ vẽ các ô trong khung nhìn. 100.000 dòng cuộn vẫn mượt.
3. **Chỉ tải phần đang nhìn thấy, đón trước phần sắp tới.** Khi cuộn, grid xin server đúng khoảng dòng cần hiển thị cộng một vùng đệm, và tải trước khoảng kế tiếp. Người dùng thấy thanh cuộn đầy đủ ngay từ đầu (biết tổng số dòng), không có kiểu "cuộn đến cuối mới tải thêm".

   Đây là cách làm hiện đại thay cho "lazy load" kiểu cũ (danh sách dài dần, nút "xem thêm"). Bản chất vẫn là tải theo phần, nhưng người dùng không cảm nhận được.

4. **Cache và cập nhật lạc quan.** TanStack Query giữ dữ liệu đã tải. Sửa ô thì hiện ngay, server xác nhận sau, lỗi thì hoàn lại.
5. **Đồng bộ khi người khác sửa.** Server đẩy tín hiệu qua SSE (Server-Sent Events) khi dòng thay đổi. Grid đang mở chỉ tải lại các dòng đó.

### 6.2 Database

- Cột hệ thống của Deals là **cột thật** trong Postgres (có kiểu, có index). Cột tuỳ chỉnh lưu trong JSONB. Quyết định chi tiết ở Module 2 và Module 4.
- Cột tuỳ chỉnh hay bị lọc được tạo **expression index** tự động khi số dòng vượt ngưỡng.
- Tìm kiếm toàn văn: `pg_trgm` + `unaccent`.
- Phân trang theo **keyset** (theo khoá sắp xếp + id), không dùng `OFFSET` lớn.
- Giá trị công thức theo dòng được **tính khi ghi và lưu lại**, không tính lại mỗi lần đọc. Đổi công thức thì worker tính lại cả cột.
- Tổng hợp cho dashboard đọc từ query có index; khi cần thì dùng bảng tổng hợp làm sẵn, cập nhật theo sự kiện.

### 6.3 Bộ lọc

Mọi bảng hỗ trợ cùng một cú pháp lọc (dùng chung cho UI, API, MCP):

```json
{
  "and": [
    { "field": "status", "op": "in", "value": ["Processing", "Won"] },
    { "field": "closing_date", "op": "between", "value": ["2026-10-01", "2026-12-31"] },
    { "or": [
      { "field": "company_name", "op": "contains", "value": "thuan" },
      { "field": "revenue", "op": "gte", "value": 500000000 }
    ]}
  ]
}
```

Toán tử: `eq`, `neq`, `in`, `nin`, `gt`, `gte`, `lt`, `lte`, `between`, `contains`, `starts_with`, `is_empty`, `is_not_empty`, cùng các toán tử ngày tương đối (`this_month`, `last_quarter`, `last_n_days`…). Người dùng lưu được bộ lọc thành "view".

## 7. Quy ước API

- Tiền tố `/api/v1`, dữ liệu JSON, tên trường `snake_case`.
- Danh sách: `?filter=` (JSON như mục 6.3), `?sort=`, `?fields=` (chọn cột, giúp AI tốn ít token), `?limit=` (tối đa 500), `?cursor=`.
- Kết quả danh sách: `{ data: [...], next_cursor, total }`.
- Lỗi: `{ error: { code, message, details } }`. `code` cố định, có danh sách trong `packages/shared`.
- **Chống ghi đè:** mỗi bản ghi có `version`. Lệnh sửa phải gửi kèm `version` đang có; lệch thì trả `409 conflict`.
- **Gửi lại an toàn:** header `Idempotency-Key` cho mọi lệnh tạo. Gửi lại cùng khoá trong 24h thì nhận lại kết quả cũ, không tạo trùng.
- **Hệ thống ngoài bắn dữ liệu vào** (ví dụ hệ thống chia deal): cặp `source` + `external_id` để upsert; tài khoản hệ thống (service account) do admin cấp, có scope riêng.
- **Thao tác hàng loạt:** endpoint `batch` cho tạo/sửa/xoá nhiều dòng trong một giao dịch.
- Giới hạn tốc độ theo token và theo user.

## 8. Xác thực (khung; chi tiết ở Module 1)

- **Đăng nhập chính:** email + mật khẩu (tài khoản do hệ thống cấp).
- **Đăng nhập phụ:** Google (OAuth, loại External). Server chỉ chấp nhận email đã có tài khoản trong hệ thống. Không tự tạo tài khoản mới khi đăng nhập Google.
- Tài khoản đăng nhập bằng Google được **đặt mật khẩu** để sau này đăng nhập bằng email + mật khẩu mà không cần Google.
- **Quên mật khẩu không dùng email:**
  1. User bấm "Quên mật khẩu", nhập email.
  2. Hệ thống tạo yêu cầu đặt lại, gửi **thông báo trong ứng dụng** kèm mã xác thực cho leader trực tiếp, manager và admin của user đó.
  3. Người nhận kiểm tra đúng người rồi chuyển mã cho user qua kênh riêng (gặp trực tiếp, chat).
  4. User nhập mã + mật khẩu mới.

  Mã có 6 số, dùng một lần, hết hạn sau 30 phút. Mỗi email tối đa 3 yêu cầu/giờ. Thông báo ghi rõ "Dương Trần yêu cầu đặt lại mật khẩu lúc …", để người nhận biết khi có người giả mạo. Tài khoản admin quên mật khẩu thì gửi cho admin khác; nếu chỉ có một admin thì đặt lại bằng lệnh trên server.
- **Không bắt buộc 2FA.**
- Session lưu trong database, cookie `httpOnly` + `Secure` + `SameSite=Lax`. Đổi mật khẩu thì đăng xuất mọi phiên khác.
- Các loại token: token cá nhân (API, Claude Code, Codex), OAuth access token (connector Claude Desktop, claude.ai, ChatGPT), token tài khoản hệ thống.

## 9. Lịch sử, audit và nhật ký hệ thống

### 9.1 Lịch sử dòng (`row_history`)

Mỗi lần tạo/sửa/xoá/khôi phục một dòng dữ liệu (Datahub, Deals) ghi một bản:

| Trường | Ý nghĩa |
|---|---|
| `row_id`, `table_id` | Dòng nào |
| `version` | Phiên bản sau thay đổi |
| `changes` | Danh sách `{ field, old, new }` |
| `actor` | Ai, qua kênh nào, kết nối nào |
| `at` | Thời điểm |

Dùng cho: xem lịch sử một deal, xem dữ liệu tại ngày X, hoàn tác, đối soát com. Lưu vĩnh viễn.

### 9.2 Audit log (`audit_log`)

Ghi mọi thao tác ghi, cộng các thao tác nhạy cảm:

- Đăng nhập thành công, thất bại, đăng xuất, đặt lại mật khẩu.
- **Bị từ chối quyền** (ai cố làm gì mà không có quyền).
- Export, đọc hàng loạt, mọi lệnh qua API/MCP.
- Thay đổi phân quyền, kết nối AI, cài đặt hệ thống, chính sách, khoá/mở kỳ.

Bảng chỉ cho ghi thêm: tài khoản database của ứng dụng không có quyền `UPDATE`/`DELETE` trên bảng này.

### 9.3 Trang nhật ký hệ thống (chỉ Admin)

- **Chỉ Admin xem được.** Manager không xem được.
- Mỗi dòng: thời điểm (đến giây), tác nhân (người + kênh `web`/`api`/`mcp`/`worker` + tên kết nối AI nếu có), thao tác (tên command, ví dụ `datahub.row.update`), đối tượng (bảng/dòng/người bị tác động), kết quả (thành công / bị từ chối / lỗi), chi tiết (giá trị cũ → mới), IP, thiết bị.
- Lọc theo: khoảng thời gian, người, kênh, kết nối AI, loại thao tác, kết quả, đối tượng.
- Bấm vào một dòng để xem chi tiết đầy đủ.
- Admin xuất được nhật ký ra file (việc xuất cũng được ghi log).
- Giữ tối thiểu 2 năm; admin cài được thời hạn.

## 10. Snapshot

Ảnh chụp có tên của một tập dữ liệu tại một thời điểm, ví dụ "Pipeline đầu Q1/2027".

- Tự chạy đầu mỗi quý cho pipeline deal (lịch cài được). Manager chụp thêm bất cứ lúc nào.
- Forecast cuối quý so với snapshot đầu quý để biết dự báo đúng hay sai.
- Snapshot là bản sao chỉ đọc, không dựng lại từ lịch sử nên đọc nhanh.

## 11. Khoá kỳ

Cơ chế chung, **chỉ Manager dùng** (với dữ liệu thuộc cây của mình).

- Một bảng khai báo "cột kỳ" thì khoá kỳ áp dụng được. Ví dụ: Deals dùng ngày ghi nhận doanh thu.
- Khi kỳ đã khoá, mọi thao tác ghi vào dòng thuộc kỳ đó đều bị từ chối, kể cả đổi ngày để dời dòng ra khỏi kỳ. Áp dụng cho mọi kênh: web, API, MCP, hệ thống ngoài.
- Manager mở lại kỳ thì phải ghi lý do; việc khoá/mở đều vào audit log.

## 12. Xoá mềm và thùng rác

- Xoá là đánh dấu `deleted_at`, dữ liệu vào thùng rác.
- Khôi phục được trong **7 ngày** (admin chỉnh được). Quá hạn thì worker xoá hẳn mỗi đêm.
- **Deal không bao giờ bị xoá cứng.** User và AI không xoá được deal. Manager chỉ đánh dấu "Huỷ"; deal huỷ không tính vào chỉ số nhưng vẫn còn trong lịch sử.
- Xoá Datahub hoặc bảng thì cả bảng vào thùng rác, khôi phục nguyên vẹn.

## 13. Sự kiện (outbox)

- Mọi thay đổi quan trọng ghi một sự kiện vào bảng `outbox` **trong cùng giao dịch** với dữ liệu. Dữ liệu đã lưu thì sự kiện chắc chắn tồn tại, không mất.
- Worker đọc outbox và chuyển cho các bên nghe: thông báo, tính lại công thức phụ thuộc, cập nhật bảng tổng hợp, SSE cho grid đang mở; sau này là **Automation** và webhook ra ngoài.
- Tên sự kiện: `<module>.<đối tượng>.<động từ quá khứ>`, ví dụ `deal.assigned`, `datahub.row.updated`, `onboarding.item.checked`.
- Sự kiện có schema cố định, được đánh phiên bản.

## 14. Job và lịch

pg-boss trên Postgres. Các job ban đầu: tính lại công thức, snapshot theo lịch, nhắc hẹn/nhắc hạn, dọn thùng rác, xử lý import, gửi thông báo, dọn session hết hạn. Job lỗi được thử lại có giới hạn và hiện trong trang nhật ký của admin.

## 15. File

- Lưu trên S3 riêng tư, không có link công khai.
- Muốn tải thì gọi API (kiểm tra quyền), nhận link ký số có hạn 5 phút.
- Giới hạn dung lượng mỗi file và tổng dung lượng mỗi user (admin cài). Chỉ nhận các loại file trong danh sách cho phép.

## 16. Bảo mật nền

- Chỉ HTTPS (HSTS). Cookie như mục 8. CSRF token cho thao tác ghi qua cookie. CSP chặt.
- Mật khẩu băm argon2id. Đăng nhập sai nhiều lần thì khoá tạm thời.
- Endpoint không cần đăng nhập chỉ gồm: đăng nhập, quên mật khẩu, OAuth, form công khai. Mọi trang có `noindex`.
- Postgres và MinIO (nếu dùng) không mở ra internet.
- Secret nằm trong biến môi trường, không nằm trong repo.
- File export gắn tên người xuất và thời điểm.
- **Giới hạn đã chốt:** người không có tài khoản không lấy được gì. Người có tài khoản chỉ lấy được phần mình có quyền. Hệ thống không phân biệt được người thật với AI điều khiển trình duyệt của chính user đó, nên dựa vào audit log và giới hạn tốc độ để phát hiện bất thường. Kênh AI chính thức (API/MCP) thì kiểm soát hoàn toàn.

## 17. Kết nối AI (khung; chi tiết ở Module 5)

- MCP server tại `/mcp`, giao thức Streamable HTTP.
- Hai cách xác thực, cùng đi qua bước "kết nối AI chờ admin duyệt":
  - **OAuth 2.1 + Dynamic Client Registration:** cho Claude Desktop, claude.ai, ChatGPT, Codex (`codex mcp login`). Cho phép callback `https://claude.ai/api/mcp/auth_callback` và `https://claude.com/api/mcp/auth_callback`.
  - **Token cá nhân (Bearer):** cho Claude Code, Codex, script.
- Request từ connector của Claude Desktop/claude.ai đến từ server của Anthropic, nên endpoint `/mcp` phải mở ra internet.
- Tool MCP được sinh từ command registry; mọi command `onboarding.*` có `aiAllowed: false` cứng.
- Tool trả số liệu đã tổng hợp và chỉ các cột cần thiết, để AI của user tốn ít token.

## 18. Tài liệu API và hướng dẫn kết nối

Bàn giao khi hệ thống xong:

1. **OpenAPI 3.1** sinh tự động từ registry, xem tại `/api/docs` (giao diện Scalar). Phải đăng nhập mới xem được.
2. **Bộ request Bruno** trong `docs/api/bruno/`, đủ mọi endpoint, có biến môi trường, dùng để test.
3. **Hướng dẫn kết nối** trong `docs/api/`: Claude Desktop/claude.ai (custom connector), Claude Code, Codex, gọi REST bằng token, hệ thống ngoài bắn dữ liệu vào.
4. Danh sách mã lỗi và danh sách sự kiện.

## 19. Chuẩn bị cho Automation (chưa thiết kế)

Automation là module lõi sẽ làm sau. Module 0 chuẩn bị sẵn:

- **Trigger:** mọi sự kiện trong outbox (mục 13) và lịch của pg-boss (mục 14).
- **Action:** mọi command trong registry (mục 3.3), gọi theo tên với input có schema.
- **Actor:** `via = automation`, kèm id của automation, để audit và phân quyền như mọi kênh khác.
- **Điều kiện:** dùng chung engine công thức (`packages/formula`) và cú pháp lọc (mục 6.3).

Không thêm code Automation nào cho đến khi module đó được thiết kế.

## 20. Vận hành

- Môi trường: `dev` (Docker trên máy) và `production`. Thêm `staging` khi có nhu cầu.
- Migration chỉ đi tiến; mỗi migration chạy được nhiều lần không hỏng.
- Log có cấu trúc (pino), endpoint `/health`.
- Theo dõi uptime và lỗi bằng dịch vụ miễn phí (chi tiết ở [ha-tang.md](ha-tang.md)).
- Backup: xem [ha-tang.md](ha-tang.md).

## 21. Kiểm thử

- **Unit test** cho engine công thức, metric, phân quyền.
- **Golden test:** dựng lại sheet Index và Cumulative Index từ file deal mẫu, so từng số với kết quả Excel. Lệch là fail.
- **Ma trận phân quyền:** test tự động cho từng vai trò × từng thao tác × từng kênh (web/API/MCP).
- **Load test** 100.000 deal trước khi phát hành (mục 1).

## 22. Để các module sau quyết định

- Cấu trúc lưu cột của Datahub, kiểu cột, cú pháp công thức → Module 2.
- Vai trò, cây tổ chức, cấp dữ liệu cho Guest → Module 1.
- Scope và trang quản lý kết nối AI → Module 5.
- Kênh thông báo (trong ứng dụng, SSE; email nếu cần sau này) → Module 6.

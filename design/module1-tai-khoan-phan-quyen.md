# Module 1 — Tài khoản & phân quyền

> Trạng thái: **Đã chốt** · 18/11/2026
> Phụ thuộc: [Module 0](module0-nen-tang.md) (registry, actor, audit, outbox, SSE).
> Đổi bởi [Module 4](module4-quan-ly-deal.md) mục 18 (chốt 19/11/2026): template Deals do **Admin và Manager** sửa (không chỉ Admin); "ba loại cột" thành bốn lớp cột; bảng Deals và Probation KPI trong datahub "Quản lý Deal" xem theo phạm vi deal. Khi hai file lệch nhau, Module 4 thắng.
> Các phần để module sau: scope chi tiết và trang duyệt kết nối AI, OAuth cho MCP (Module 5); thông báo đầy đủ (Module 6); chia sẻ datahub chi tiết (Module 2); hồ sơ nghiệp vụ như Level BC, KPI (Module 4).

## 1. Ba lớp quyền

Mọi câu hỏi "người này có được làm việc này không" đi qua ba lớp, kết quả là **giao** của cả ba:

1. **Quyền chức năng:** vai trò (và quyền bổ sung) cho phép làm gì.
2. **Phạm vi dữ liệu:** thấy dữ liệu của ai.
3. **Quyền trên đối tượng:** ai là chủ, được chia sẻ cho ai.

Khi đi qua token hoặc kết nối AI, giao thêm với scope của token/kết nối (Module 0 mục 3.4).

## 2. Người dùng và org chart

### 2.1 Org chart là nguồn duy nhất

Không có thao tác "tạo tài khoản". Mỗi người là một dòng trong **danh sách org chart** (Cài đặt):

| Trường | Ghi chú |
|---|---|
| Email | Bắt buộc, duy nhất, viết thường. Phải đúng tên miền cho phép (mặc định `base.vn`) |
| Họ tên, chức danh, số điện thoại, ảnh | Thông tin cá nhân |
| Vai trò | Một hoặc nhiều: Admin, Manager, Leader, User, Guest |
| Manager (cây) | Người đó thuộc cây của Manager nào |
| Cấp trên trực tiếp | Một Leader trong cùng cây, hoặc để trống (thuộc thẳng Manager) |
| Mẫu Guest | Với Guest: `Sale` hoặc `Data` |
| Trạng thái | `Chưa kích hoạt` / `Đang hoạt động` / `Đã khoá` |

- Thêm một dòng vào org chart là tạo người dùng ở trạng thái **Chưa kích hoạt**. Người này đã có `id`, nên Manager đã phân deal cho họ được trước khi họ đăng ký.
- Xoá khỏi org chart = **khoá** tài khoản (không xoá dữ liệu).
- Đổi vai trò có hiệu lực ngay. Token nào có scope vượt quyền mới thì bị thu hẹp hoặc thu hồi.

### 2.2 Ai sửa org chart

| Thao tác | Admin | Manager |
|---|---|---|
| Thêm/sửa/khoá người | Toàn bộ | Trong cây mình |
| Gán vai trò Leader, User, Guest | ✓ | Trong cây mình |
| Gán vai trò Manager, Admin | ✓ | – |
| Sắp xếp cây (cấp trên trực tiếp) | ✓ | Trong cây mình |

Admin đầu tiên được tạo bằng lệnh trên server khi cài đặt (mục 6.6).

### 2.3 Cây tổ chức

```
Admin (ngoài cây)

Cây của Manager A                  Cây của Manager B
├─ Leader Khuê                     ├─ Leader …
│  ├─ User Dương                   │  └─ …
│  └─ User Linh                    └─ User thuộc thẳng Manager B
└─ User thuộc thẳng Manager A
```

- Mỗi User có đúng một cấp trên: một Leader hoặc thuộc thẳng Manager. Leader thuộc một Manager. Không có nhiều cấp leader.
- Hai cây tách biệt: **hai Manager không thấy dữ liệu của nhau**.
- **Lịch sử thành viên:** bảng `org_memberships(user_id, manager_id, leader_id, valid_from, valid_to)`.
  - Quyền xem dùng cây **hiện tại**.
  - Báo cáo theo kỳ dùng cây **tại thời điểm đó** (doanh thu Q4 của team Khuê vẫn gồm deal Q4 của Dương dù Dương đã chuyển team).

### 2.4 Kết hợp vai trò

- Guest không kết hợp với vai trò khác.
- Leader và Manager vẫn có deal và datahub riêng như một User.
- Một người mang nhiều vai trò thì có hợp các quyền.

## 3. Quyền chức năng

### 3.1 Admin là quản trị hệ thống

Admin quản lý: cài đặt và giới hạn hệ thống, org chart, nhật ký hệ thống, duyệt token/kết nối AI, tài khoản hệ thống, chuyển giao dữ liệu, template Deals.

Admin **không có quyền nghiệp vụ**: không tạo/phân deal, không sửa chính sách com, không khoá kỳ, không snapshot, không đẩy cột, không tạo lộ trình onboard, không tạo datahub/form, không đăng bài/skill, không cấp dữ liệu cho Guest. Muốn làm thì phải mang thêm vai trò khác.

Admin **được xem** Quản lý Deal của mọi cây (chỉ đọc) để rà dữ liệu.

### 3.2 Bảng quyền

| Chức năng | Admin | Manager | Leader | User | Guest |
|---|---|---|---|---|---|
| Sửa org chart | Toàn bộ | Cây mình | – | – | – |
| Cài đặt, giới hạn hệ thống, template Deals | ✓ | – | – | – | – |
| Nhật ký hệ thống | ✓ | – | – | – | – |
| Duyệt token, kết nối AI; tài khoản hệ thống | ✓ | – | – | – | – |
| Chuyển giao dữ liệu | ✓ | – | – | – | – |
| Xem Quản lý Deal | Mọi cây (chỉ đọc) | Cây mình | Team mình + của mình | Deal mình tham gia | Theo cấp dữ liệu |
| Tạo/phân deal, chính sách com, khoá kỳ, snapshot | – | Cây mình | – | – | – |
| Đẩy cột chung xuống Deals | – | Cả cây | Team mình | – | – |
| Cấp dữ liệu cho Guest | – | Dữ liệu cây mình | – | – | – |
| Chọn người duyệt Knowledge / AI Hub | ✓ | ✓ | – | – | – |
| Tạo lộ trình onboard | – | ✓ | ✓ | – | – |
| Tạo datahub, form; đăng bài, đăng skill | – | ✓ | ✓ | ✓ | – |
| Đọc Knowledge | ✓ | ✓ | ✓ | ✓ | Theo mẫu Guest |

### 3.3 Quyền bổ sung

Cấp thêm một quyền cụ thể cho một người, chọn từ danh mục có sẵn. Không có công cụ tự tạo vai trò.

| Quyền bổ sung | Ai cấp |
|---|---|
| Duyệt Knowledge | Admin, Manager |
| Duyệt AI Hub | Admin, Manager |
| Tạo lộ trình onboard (cho User) | Manager |
| Xuất dữ liệu deal của team (cho Leader) | Manager |

Danh mục mở rộng được trong code; mỗi mục ghi rõ ai được cấp.

### 3.4 Chuỗi quyền trong registry

Quyền là chuỗi `<miền>:<đối tượng>:<hành động>`, ví dụ `system:audit:read`, `org:member:write`, `deal:deal:assign`. Vai trò ánh xạ sang tập chuỗi quyền trong code (`packages/shared`). Chuỗi đã có từ Stage 0 gán như sau: `system:audit:read`, `system:setting:write` → chỉ Admin; `system:whoami`, `system:setting:read`, `file:read|write`, `docs:read`, `events:subscribe` → mọi người đã đăng nhập (Guest không có `docs:read`).

## 4. Phạm vi dữ liệu

### 4.1 Quản lý Deal

> Sửa 19/11/2026: phạm vi dưới đây giờ là kết quả của cơ chế **khoá phân chia** chung cho mọi bảng (Module 2 mục 10, Module 4 mục 3.5), không còn là luật riêng của Deals. Quyền sửa từng cột theo "cho phép sửa" (Module 4 mục 4.3); mọi người tham gia deal có cùng quyền. Manager tắt được khoá phân chia của Deals.

| Vai trò | Thấy | Sửa |
|---|---|---|
| User | Deal mình tham gia | Cột theo luật 3 loại cột (Module 4) |
| Leader | Deal của mình + của team | Của mình. Deal của team: **chỉ đọc**, trừ khi thành viên bật "Cho phép leader sửa deal của tôi"; cột chung loại "quản lý điền" |
| Manager | Mọi deal trong cây | **Luôn sửa được** mọi deal trong cây |
| Admin | Mọi deal (chỉ đọc) | Không |
| Guest | Theo cấp dữ liệu | Không |

Tuỳ chọn "Cho phép leader sửa deal của tôi" nằm trong Quản lý Deal của từng User, mặc định tắt. Bật lên thì Leader sửa được những cột mà chính User đó sửa được, không hơn.

### 4.2 Datahub là của riêng

- Datahub chỉ chủ sở hữu thấy. Leader, Manager, Admin **không** xem được.
- Chủ chia sẻ cho người khác với quyền xem hoặc sửa (chi tiết ở Module 2).
- Bảng được chia sẻ không dùng được trong công thức của người nhận (luật công thức: cùng chủ sở hữu).
- Cột cá nhân trên Deals dùng công thức kéo từ datahub riêng thì Leader vẫn thấy **kết quả** của cột đó. Khi tạo loại công thức này, hệ thống cảnh báo chủ cột.

### 4.3 Các đối tượng khác

Form, dashboard tuỳ chỉnh, file: mặc định của riêng chủ sở hữu, chia sẻ được. Module tương ứng quy định chi tiết. File gắn vào một đối tượng (deal, bài viết…) thì ai có quyền xem đối tượng đó được tải file.

## 5. Guest

### 5.1 Mẫu Guest

| Mẫu | Mặc định được gì |
|---|---|
| Sale | Đọc Knowledge (các bài đánh dấu cho sale) |
| Data | Không có gì cho đến khi được cấp dữ liệu |

### 5.2 Cấp dữ liệu

Chỉ Manager cấp, chỉ với dữ liệu trong cây mình.

| Trường | Ví dụ |
|---|---|
| Người nhận | Guest "Phòng Data" |
| Dữ liệu | Deals (Module 4), bảng tổng hợp, dashboard |
| Phạm vi | Cả cây, hoặc một team |
| Cột | Cột hệ thống + cột chung. **Không bao giờ có cột cá nhân** |
| Tỉ lệ người tham gia (chỉ Deals) | Bật/tắt, mặc định tắt. Bật thì Guest thấy % doanh thu, % com trong `Người tham gia`; tắt thì chỉ thấy tên và vai trò. Không bao giờ thấy số tiền com (Module 4 mục 15, Dương chốt 19/11/2026) |
| Kênh | Xem trên web / tải file / API |
| Hết hạn | Không bắt buộc |

Stage 1 làm khung cấp dữ liệu (bảng, quyền, kiểm tra); loại dữ liệu cụ thể do module sở hữu dữ liệu đăng ký (Deals ở Stage 4).

## 6. Đăng ký và đăng nhập

### 6.1 Luật tên miền

- Chỉ email đuôi **@base.vn** được đăng ký (cài đặt `auth.allowed_domains`, mặc định `["base.vn"]`, chỉ Admin sửa). Kiểm tra ở server, mọi kênh.
- Tuỳ chọn `auth.auto_guest_sale` (mặc định **tắt**, Admin bật): email @base.vn **ngoài** org chart đăng ký được và thành Guest mẫu `Sale`. Tắt thì email ngoài org chart bị từ chối với thông báo "Email chưa có trong danh sách. Liên hệ quản lý của bạn."

### 6.2 Đăng ký lần đầu (kích hoạt bằng mã)

Hệ thống không gửi email, nên không tự xác minh được chủ email. Mã kích hoạt giải quyết việc này:

1. Người dùng vào **Đăng ký**, nhập email.
2. Server kiểm tra: đúng tên miền; có trong org chart ở trạng thái `Chưa kích hoạt`, hoặc `auto_guest_sale` đang bật.
3. Server tạo mã 6 số, gửi **thông báo trong ứng dụng** cho người duyệt (mục 6.4). Thông báo ghi: "Linh Nguyễn (linh.nguyen@base.vn) yêu cầu kích hoạt tài khoản lúc 09:12 18/11. Mã: 482913".
4. Người dùng liên hệ một người duyệt để xin mã (gặp trực tiếp, chat).
5. Người dùng nhập mã, đặt mật khẩu. Tài khoản chuyển sang `Đang hoạt động`.

### 6.3 Quên mật khẩu

Cùng luồng với 6.2: nhập email → mã gửi cho người duyệt → xin mã → nhập mã và mật khẩu mới. Mọi phiên khác bị đăng xuất.

### 6.4 Mã xác thực và người nhận

| Người yêu cầu | Người nhận mã |
|---|---|
| User | Leader trực tiếp, Manager của cây, mọi Admin |
| Leader | Manager của cây, mọi Admin |
| Manager | Mọi Admin |
| Admin | Các Admin khác; nếu chỉ có một Admin thì dùng lệnh trên server (6.6) |
| Guest (kể cả Guest tự đăng ký) | Mọi Admin |

- Mã 6 số, dùng một lần, **hiệu lực 6 giờ**.
- Nhập sai 5 lần thì mã bị huỷ.
- Mỗi email tối đa 3 yêu cầu mỗi giờ. Yêu cầu mới huỷ mã cũ.
- Mọi yêu cầu, lần nhập sai, lần dùng mã đều ghi nhật ký.

(Mục này thay thời hạn 30 phút ghi ở Module 0 mục 8.)

### 6.5 Mật khẩu và phiên

- Mật khẩu **tối thiểu 6 ký tự**, không bắt buộc chữ hoa, số, ký tự đặc biệt. Tối đa 128 ký tự.
- Chặn khoảng 1.000 mật khẩu phổ biến nhất (`123456`, `base123`…).
- Băm bằng argon2id. Không bắt đổi định kỳ.
- Đăng nhập sai 5 lần liên tiếp thì khoá tài khoản 15 phút.
- Phiên: không hoạt động 7 ngày thì hết hạn; tối đa 30 ngày phải đăng nhập lại.
- Người dùng xem và đăng xuất từng thiết bị. Admin thu hồi được mọi phiên của một người.
- Đổi mật khẩu: nhập mật khẩu cũ; đổi xong đăng xuất mọi phiên khác.
- Cookie `httpOnly`, `Secure`, `SameSite=Lax`; thao tác ghi qua cookie cần CSRF token (double-submit).

### 6.6 Lệnh trên server

- `admin:create --email <email>`: tạo Admin đầu tiên, in mã kích hoạt ra màn hình.
- `auth:reset-code --email <email>`: in mã đặt lại mật khẩu (dùng khi Admin duy nhất quên mật khẩu).

Mọi lần chạy lệnh đều ghi nhật ký với `via = worker` và tên lệnh.

### 6.7 Đăng nhập Google (phụ, mặc định tắt)

Hệ thống sẽ được bàn giao nên hạn chế phụ thuộc Google:

- Cài đặt `auth.google_enabled`, mặc định **tắt**. Admin bật khi đã cấu hình Google Cloud ([ha-tang.md](ha-tang.md) mục 4).
- Khi bật: email Google phải đúng tên miền và có trong org chart (hoặc thoả `auto_guest_sale`). Google đã chứng minh chủ email nên **bỏ qua bước xin mã**.
- Đăng nhập Google lần đầu **bắt buộc đặt mật khẩu**, để sau này đăng nhập được bằng email + mật khẩu khi tắt Google.

## 7. Token và tài khoản hệ thống

| Loại | Ai tạo | Dùng cho | Stage |
|---|---|---|---|
| Token cá nhân | Người dùng, trong Cài đặt | Claude Code, Codex, script | 1 |
| Tài khoản hệ thống | Admin | Hệ thống ngoài bắn dữ liệu vào | 1 |
| Token OAuth | Luồng connector | Claude Desktop, claude.ai, ChatGPT | 5 |

**Token cá nhân**
- Có tên, scope (không rộng hơn quyền của chủ), hạn dùng (mặc định 90 ngày, tối đa 1 năm).
- **Mọi token cá nhân cần Admin duyệt** trước khi dùng được (không phân biệt được token dùng cho AI hay script).
- Chỉ hiện một lần lúc tạo; server lưu bản băm. Tiền tố `soe_pat_` để dễ nhận ra khi bị lộ.
- Chủ hoặc Admin thu hồi bất cứ lúc nào. Khoá tài khoản thì mọi token bị thu hồi.

**Tài khoản hệ thống**
- Không phải người, không đăng nhập web.
- Admin tạo, cấp scope và giới hạn trong một hoặc vài cây.
- Có token riêng (tiền tố `soe_svc_`). Mọi thao tác ghi tên tài khoản hệ thống trong nhật ký.
- Tài khoản hệ thống nội bộ `SYSTEM_USER_ID` (worker dùng từ Stage 0) là một dòng trong bảng người dùng, không đăng nhập được, không xoá được.

Trang duyệt kết nối AI và scope theo menu: Module 5.

## 8. Chuyển giao dữ liệu (Admin)

Admin chọn tài khoản nguồn, tài khoản đích → xem trước danh sách sẽ chuyển → xác nhận.

| Dữ liệu | Cách chuyển |
|---|---|
| Datahub, dashboard, form, file | Đổi chủ sở hữu sang người đích |
| Deal đang mở | Vai trò tham gia của người nguồn chuyển sang người đích |
| Deal đã đóng (Won/Lost/Huỷ) | **Giữ nguyên người nguồn**; doanh thu và com đã ghi nhận không đổi |
| Cột cá nhân trên deal | Tuỳ chọn: chuyển giá trị sang người đích, hoặc giữ làm lưu trữ |
| Việc được giao, lộ trình onboard đang theo dõi | Chuyển sang người đích |
| Bài viết, skill đã đăng | Tác giả giữ tên người nguồn; quyền sửa chuyển sang người đích |

- Sau khi chuyển, tài khoản nguồn bị khoá.
- Admin cũng chuyển được cả một cây sang Manager khác.
- Khung kỹ thuật: mỗi module đăng ký một `transferHandler` (xem trước + thực hiện). Stage 1 làm khung và handler cho dữ liệu đã có (file, token); module sau tự thêm handler của mình.
- Toàn bộ chạy trong một giao dịch, ghi nhật ký từng đối tượng.

## 9. Thông báo tối thiểu

Stage 1 cần thông báo cho mã kích hoạt và mã đặt lại mật khẩu. Làm phần lõi, Module 6 mở rộng:

- Bảng `notifications(id, user_id, type, title, body, data, read_at, created_at)`.
- API: danh sách, đếm chưa đọc, đánh dấu đã đọc.
- Tạo thông báo qua outbox; đẩy tín hiệu qua SSE để chuông cập nhật ngay.
- Thông báo chứa mã xác thực tự ẩn mã sau 6 giờ.

## 10. Cách cài trong code

- `Authorizer` thật thay bản dev của Stage 0: kiểm tra quyền chức năng (vai trò + quyền bổ sung + scope token).
- **Phạm vi dữ liệu thành điều kiện SQL:** mỗi request tính một lần tập người mà actor được thấy theo từng loại dữ liệu (deal: theo cây/team; datahub: chỉ mình + được chia sẻ). Cây nhỏ nên tính nhanh, cache theo request.
- Mọi truy vấn vào dữ liệu có chủ **bắt buộc** đi qua bộ truy vấn có phạm vi. Có test tự động bắt truy vấn thẳng bảng.
- Không dùng Row Level Security của Postgres ở bản đầu.
- SSE: chỉ gửi tín hiệu về đối tượng mà người nhận có quyền xem.
- Thêm khoá ngoại từ các cột `*_by`, `owner_id`, `actor_user_id` của Stage 0 tới bảng người dùng.
- **Nhật ký và dữ liệu riêng:** với dòng datahub (dữ liệu riêng), nhật ký Admin chỉ ghi thao tác, đối tượng và tên cột bị sửa, **không ghi giá trị**. Giá trị cũ → mới vẫn nằm trong lịch sử dòng, chỉ chủ và người được chia sẻ xem. Với deal và mọi dữ liệu khác, nhật ký ghi đủ giá trị.
- Ma trận test phân quyền: vai trò × thao tác × kênh (web, API) × phạm vi (của mình, team, cây khác).

## 11. Giao diện tối thiểu (Stage 1)

- Đăng nhập, Đăng ký (nhập email → nhập mã + đặt mật khẩu), Quên mật khẩu, Đổi mật khẩu.
- Org chart: bảng danh sách, thêm/sửa/khoá, gán vai trò, chọn cấp trên; xem dạng cây.
- Quyền bổ sung, cấp dữ liệu cho Guest (khung).
- Thiết bị đang đăng nhập; token cá nhân; Admin duyệt token; tài khoản hệ thống.
- Nhật ký hệ thống (Admin): lọc, xem chi tiết, xuất file.
- Chuyển giao dữ liệu (Admin).
- Chuông thông báo + hộp thông báo.
- Cài đặt hệ thống (Admin): tên miền cho phép, `auto_guest_sale`, `google_enabled`, số ngày giữ thùng rác.

## Quyết định khi code

Ghi trong lúc code Stage 1 (18/11/2026). Các phần đã chốt ở trên không đổi; mục này chỉ thêm chi tiết và ghi lệch.

### Xác thực
- **Tự viết thay vì better-auth.** Luồng mã kích hoạt qua thông báo, org chart làm nguồn duy nhất và không gửi email không khớp mô hình của better-auth. Dùng `hash-wasm` (argon2id), `@fastify/cookie`, `arctic` (Google). Ba gói nhỏ, ít phụ thuộc, dễ bàn giao.
- **Phiên:** cookie `httpOnly` chứa mã phiên ngẫu nhiên, DB chỉ lưu bản băm. Hết hạn 7 ngày không dùng, tối đa 30 ngày (`SESSION_IDLE_DAYS`, `SESSION_ABSOLUTE_DAYS`).
- **CSRF:** `HMAC(AUTH_SECRET, session id)` gửi qua cookie `soe_csrf` (đọc được bằng JavaScript) và header `X-CSRF-Token`; server so với giá trị tính lại từ phiên. Chỉ áp cho yêu cầu ghi đi bằng cookie; token Bearer không cần.
- **`AUTH_SECRET` bắt buộc trong production** (từ 32 ký tự, không bắt đầu bằng `dev-only`): thiếu thì api và worker không khởi động. Mã xác thực được băm bằng khoá này; mã đưa vào thông báo qua outbox được mã hoá AES-GCM, chỉ worker giải mã khi tạo thông báo.
- **Mã xác thực:** 6 số, hiệu lực 6 giờ. Lệnh công khai (`auth.login`, `auth.code.request`, `auth.code.verify`, `auth.config`) bỏ qua `Idempotency-Key`. Bộ đếm sai mật khẩu và sai mã ghi bằng `ctx.outside` (kết nối riêng) để không bị rollback cùng lệnh lỗi.
- Tài khoản bị khoá 15 phút trả `423 account_locked`.
- **Google:** `GOOGLE_REDIRECT_URI` là biến tuỳ chọn, mặc định `PUBLIC_URL/api/auth/callback/google`. Chưa chạy thử với Google thật (cần Google Cloud của Base).
- `X-Dev-Actor` chỉ còn khi `NODE_ENV=test`; development và production không có đường tắt nào.

### Quyền
- Tên quyền thêm cho Module 1: `auth:self`, `notification:read`, `org:member:read|write`, `org:role:elevated`, `org:permission:grant`, `guest:grant:manage`, `auth:token:approve`, `auth:session:manage`, `auth:service_account:manage`, `data:transfer`. Quyền nghiệp vụ của module sau đã khai báo sẵn trong `packages/shared/src/permissions.ts` (ví dụ `knowledge:article:read`, `review:reviewer:choose`) để vai trò đầy đủ ngay từ bây giờ.
- Quyền bổ sung chỉ cấp được cho người có một trong các vai trò hợp lệ của quyền đó (`eligibleRoles`).
- **Token không mang quyền `auth:*` và `onboarding:*`** (token không đổi được mật khẩu, thiết bị, và AI bị cấm khỏi Onboarding). Tài khoản hệ thống chỉ được các quyền trong `SERVICE_ACCOUNT_PERMISSIONS`.
- **Admin không tự duyệt token của mình khi còn Admin khác.** Còn một Admin duy nhất thì tự duyệt được.
- **Chuyển giao token = thu hồi.** Token là credential của một người nên không trao cho người khác; người nhận tự tạo token mới.
- **Leader hoặc Manager còn người dưới quyền thì không gỡ được vai trò đó** (tránh người "mồ côi"); phải chuyển người đi trước.
- Tài khoản hệ thống `SYSTEM_USER_ID` có mọi quyền nhưng không đăng nhập được. Migration tạo dòng giữ chỗ cho các actor cũ của Stage 0 để thêm được khoá ngoại.
- Guest tự đăng ký (`auto_guest_sale` bật) chỉ tạo dòng `users` khi nhập đúng mã.

### Truy vấn có phạm vi
- Truy vấn bảng có chủ phải đi qua `scopeSql`, `ownedBy` hoặc `systemScope`; các hàm này chèn marker `/*scope*/` vào SQL. `query-guard.ts` chặn truy vấn thẳng `files` và `notifications` khi không phải production (dev, test), nên test bắt được truy vấn quên phạm vi. Production tắt kiểm tra này để khỏi tốn hiệu năng.
- SSE chỉ gửi tín hiệu cho người trong `audience` của sự kiện (`users` hoặc cây), không gửi mọi sự kiện cho mọi người.

### Giao diện (web)
- **Chặn route ở `pages/shell.tsx`:** chưa đăng nhập thì mọi trang bảo vệ chuyển về `/dang-nhap?next=<đường dẫn>`; sau khi đăng nhập quay lại đúng trang (`next` chỉ nhận đường dẫn nội bộ). Người `must_set_password` bị giữ ở `/dat-mat-khau`.
- **Menu và trang theo danh sách quyền do `GET /auth/me` trả**, không bao giờ theo tên vai trò. Mở thẳng đường dẫn thiếu quyền thì hiện trang "Không có quyền"; API vẫn tự trả 403. Shell chỉ dựng trang khi trang đó đúng là trang đang hiển thị (router vẫn giữ trang cũ một lúc khi chuyển), nên trang bảo vệ không bao giờ gọi API khi chưa được phép.
- Đăng xuất: ẩn trang trước, rồi mới xoá cache, để không có truy vấn nào chạy bằng phiên đã chết.
- **Chuông** dùng `GET /notifications/unread-count`, cập nhật khi SSE báo `notification.notification.created`; bấm chuông mở hộp thông báo.
- Lỗi API hiện bằng tiếng Việt: lỗi cụ thể giữ thông điệp của server; mã chung (`forbidden`, `conflict`, `rate_limited`, `account_locked`...) có câu mặc định ở `components/ui/form.tsx`.
- **Nhật ký:** phân trang keyset phía server (nút Trang trước/sau, giữ chồng con trỏ), `total` chỉ tính ở trang đầu; xuất CSV gọi API bằng cookie rồi tải về từ trình duyệt. Chi tiết mở ngăn bên phải, bảng cũ → mới đọc từ `details.changes`. Lọc "kết nối AI" theo mã kết nối (uuid); danh sách kết nối có tên làm ở Module 5.
- Danh sách token cần duyệt và tài khoản hệ thống chưa phân trang (tối đa 500 token mới nhất): số lượng nhỏ, Stage 5 phân trang khi có kết nối AI.
- Chuyển giao: nút xác nhận dùng hộp xác nhận của trình duyệt; xem trước bị coi là cũ nếu đổi tài khoản sau đó. Trang Cấp dữ liệu Guest chỉ là khung: khi chưa có loại dữ liệu nào đăng ký thì hiện trạng thái trống và khoá nút cấp.
- Cài đặt: giới hạn số (ví dụ sàn 730 ngày của nhật ký) lấy từ danh mục cài đặt và báo bằng tiếng Việt ngay ở trình duyệt; server vẫn kiểm tra lại.

### Sửa lỗi API tìm thấy khi chạy giao diện thật
- `GET /org/members` trả `roles` dạng chuỗi (do cột lọc dùng `array_to_string`); nay trả mảng như `GET /org/members/:id`.
- `GET /system/settings` trả `value` dạng chuỗi JSON (`"true"`, `"14"`); nay trả đúng giá trị JSON (boolean, số, mảng).

### Nhật ký: bớt nhiễu, dòng ẩn danh, ngày giờ
- Truy vấn chỉ ghi nhật ký khi khai báo `audit: "always"`. Truy vấn bị từ chối vì **chưa đăng nhập** (ví dụ `auth.me` lúc mở trang) không ghi; lệnh ghi bị từ chối vẫn ghi. Đọc chuông, cài đặt, danh mục, SSE không ghi.
- Dòng không có actor (đăng nhập, xin/nhập mã, `http.authenticate`) luôn có **kênh** (`web` nếu trình duyệt gửi `sec-fetch-site`, ngược lại `api`), IP và user agent, lấy từ yêu cầu (`ExecuteOptions.client`). Giao diện ghi "Chưa đăng nhập", email đã thử (không bao giờ mật khẩu hay mã) và IP; nếu dòng gắn với một người thì email là liên kết sang Org chart (`/to-chuc?q=<email>`).
- Điện thoại: nhật ký hiện dạng thẻ thay cho bảng; các bảng khác cuộn ngang trong khung của chúng, trang không bao giờ tràn ngang (e2e kiểm ở mọi ảnh chụp).
- Ngày giờ hiện và nhập theo `dd/mm/yyyy hh:mm` (24 giờ, giờ Việt Nam): hiển thị bằng `fmtTime`, ô nhập là ô chữ `DateTimeInput` (không dùng ô ngày của trình duyệt vì nó theo ngôn ngữ trình duyệt, ra `mm/dd/yyyy`).

### Vai trò Postgres theo môi trường
- Vai trò chạy ứng dụng thuộc cả cụm Postgres, nên đặt tên theo môi trường: biến `APP_DB_ROLE` (mặc định `soe_app` cho dev và production), `soe_app_test` cho `pnpm test`, `soe_app_e2e` cho e2e. Migration viết sẵn với `soe_app`; khi tên khác, `runMigrations` chạy trên bản sao thư mục migration đã đổi tên vai trò. Chạy test không còn đổi mật khẩu vai trò của database dev.

### Kiểm thử giao diện
- Bộ Playwright ở `apps/web/e2e`, chạy bằng `pnpm test:e2e`: tạo database rỗng `soe_hub_e2e`, chạy migration, bật api (cổng 3100), worker, web (cổng 5273), chạy cùng các luồng ở hai bề ngang (1440×900 và 390×844). Mỗi phiên trình duyệt kiểm tra không có lỗi console và không có request lỗi (trừ 401/403/423 khai báo trước). Mỗi lần chạy xoá ảnh chụp cũ để thư mục chỉ chứa lần chạy mới nhất.

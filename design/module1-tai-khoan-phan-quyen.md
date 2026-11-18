# Module 1 — Tài khoản & phân quyền

> Trạng thái: **Đã chốt** · 18/11/2026
> Phụ thuộc: [Module 0](module0-nen-tang.md) (registry, actor, audit, outbox, SSE).
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

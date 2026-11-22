# Quy định chung đã chốt (ảnh hưởng nhiều module)

Tách từ `CLAUDE.md` ngày 20/11/2026 để `CLAUDE.md` nhẹ hơn. **Khi nào đọc:** khi thiết kế một module; khi code hoặc rà một việc chạm phân quyền, chia sẻ, Datahub/công thức, Deal, AI; khi thấy file thiết kế của module mâu thuẫn hoặc chưa rõ. Quyết định mới ảnh hưởng nhiều module thì ghi vào đây (và file thiết kế của module đó).


## Kiến trúc và kỹ thuật

- Stack: TypeScript monorepo (pnpm), Node 22 + Fastify, PostgreSQL 17 + Drizzle, pg-boss, better-auth, MCP SDK (Streamable HTTP), React + Vite + TanStack + shadcn/ui, Glide Data Grid, ECharts, dnd-kit, Tiptap, S3 (R2/MinIO), Docker Compose + Caddy trên một VPS.
- Modular monolith; mọi thao tác là command/query trong registry; REST, MCP, UI, worker, Automation đều gọi qua registry; **kiểm tra quyền chỉ ở server**.
- Mọi dòng dữ liệu có lịch sử thay đổi từ ngày đầu; audit log chỉ ghi thêm; trang nhật ký hệ thống **chỉ Admin xem**.
- Bảng lớn: lọc/sắp xếp/tìm kiếm ở server, grid ảo hoá chỉ vẽ và tải phần đang nhìn thấy, phân trang keyset. Mục tiêu: 20.000 deal vẫn mượt (Dương hạ từ 100.000 ngày 20/11/2026); bảng Datahub khác 100.000 dòng.
- API có `version` chống ghi đè, `Idempotency-Key`, `source` + `external_id` cho hệ thống ngoài.
- Bàn giao kèm OpenAPI, bộ request Bruno, hướng dẫn kết nối.

## Tài khoản và phân quyền

- Vai trò: Admin, Manager, Leader, User, Guest. Một người có thể có nhiều vai trò.
- **Admin là quản trị hệ thống**: cài đặt, giới hạn, nhật ký, duyệt kết nối AI/token, chuyển giao dữ liệu. Admin **không** có quyền nghiệp vụ: không tạo/phân deal, không sửa chính sách com, không khoá kỳ, không snapshot, không đẩy cột, không tạo lộ trình onboard, không tạo datahub/form, không đăng bài/skill. Muốn có thì phải mang thêm vai trò khác.
- Cây tổ chức: mỗi User có đúng một Leader (hoặc thuộc thẳng Manager); trên Leader là Manager; một Manager có nhiều Leader. **Hai Manager không thấy dữ liệu của nhau.** Đổi team có lưu lịch sử: quyền xem theo cây hiện tại, báo cáo theo kỳ theo cây tại thời điểm đó.
- **Datahub là của riêng từng người**, Leader/Manager không xem được, trừ khi chủ chia sẻ. **Một cơ chế chia sẻ cho mọi bảng** (Dương chốt 19/11/2026, Module 2 mục 10): thành viên Xem/Sửa; **khoá phân chia** bật/tắt (bật thì thành viên chỉ thấy dòng có tên mình **hoặc người mình quản lý** ở 1–5 cột khoá kiểu Người dùng); cho phép sửa theo từng cột; ô Người dùng chỉ nhận thành viên của bảng; tuỳ chọn "Thành viên được thêm dòng hàng loạt" (import, dán sinh dòng mới, API/MCP nhiều dòng; chủ luôn được; mặc định bật với bảng thường, tắt với bảng template). Deals, Probation KPI là bảng template chung, thành viên tự sinh theo cây/team, khoá phân chia bật sẵn: nên Leader xem deal của team, Manager xem cả cây. Manager tắt được khoá phân chia của Deals.
- Sửa deal: Manager luôn sửa được deal trong cây. Leader mặc định chỉ đọc; User bật tuỳ chọn "cho phép leader sửa" trong Quản lý Deal thì Leader sửa được.
- Quyền bổ sung: Admin hoặc Manager cấp thêm một quyền trong danh sách cho phép cho một người cụ thể. Không có công cụ tự tạo vai trò.
- Guest mặc định không có quyền gì. Manager cấp từng phần dữ liệu (ví dụ bộ phận Data đọc Deals qua API/export, chỉ cột hệ thống + cột chung). Guest không bao giờ thấy cột cá nhân. Sale chỉ được cấp Knowledge.
- Tài khoản theo **danh sách org chart** (email, vai trò, thông tin cá nhân, vị trí trong cây) trong Cài đặt; không có thao tác "tạo tài khoản". Email trong danh sách đăng ký/đăng nhập thì nhận đúng vai trò. Chỉ email đuôi **@base.vn** được đăng ký (kiểm tra ở server). Tuỳ chọn của Admin (mặc định tắt): email @base.vn ngoài danh sách thì thành Guest "Sale" (chỉ đọc Knowledge).
- **Đăng ký lần đầu và quên mật khẩu dùng chung luồng mã:** không dùng email; mã 6 số gửi qua thông báo trong ứng dụng cho leader trực tiếp, manager và admin; người dùng tự liên hệ xin mã; mã hiệu lực 6 giờ.
- Google là phương án phụ, **mặc định tắt** (hệ thống sẽ được bàn giao, hạn chế phụ thuộc Google). Khi bật: bỏ qua bước xin mã; đăng nhập Google lần đầu bắt buộc đặt mật khẩu.
- Mật khẩu tối thiểu 6 ký tự, không bắt buộc ký tự đặc biệt; chặn mật khẩu phổ biến; sai 5 lần khoá 15 phút.
- Admin **xem được** Quản lý Deal của mọi cây (chỉ đọc) để rà dữ liệu. Datahub riêng thì Admin cũng không xem; nhật ký Admin không ghi giá trị của dòng datahub.
- Không bắt buộc 2FA.
- Chuyển giao dữ liệu (Admin): chọn tài khoản nguồn và đích; deal đã đóng giữ nguyên người cũ.

## Datahub và công thức

- Mô hình Airtable/Lark Base: cột có kiểu, công thức áp cho cả cột. Datahub là linh hồn của hệ thống.
- Công thức đầy đủ các nhóm hàm thường dùng như Excel/Google Sheets, có ví dụ mẫu và gợi ý biến khi gõ.
- Công thức được tham chiếu **mọi bảng của mọi Datahub thuộc cùng một tài khoản** (Datahub A bảng 1 → Datahub A bảng 2 hoặc Datahub B bảng 1), cộng với bảng hệ thống dùng chung (ví dụ bảng chính sách). **Không bao giờ** tham chiếu Datahub của tài khoản khác. Kiểm tra khi lưu công thức và khi tính.
- Chỉ số tổng hợp theo thời gian (kiểu sheet Index) nằm ở lớp Metric, khai báo bằng JSON.
- Tên datahub không trùng (theo chủ), tên bảng không trùng (trong datahub), tên cột không trùng (trong bảng); không phân biệt hoa thường; không chứa `[` `]`.
- Giá trị công thức luôn được tính sẵn và **lưu trong database** (không tính lúc mở bảng); export chứa giá trị, XLSX kèm sheet liệt kê công thức.
- **Thay đổi do công thức tạo ra không sinh log:** ghi do tính lại không tạo lịch sử dòng, không vào audit log, không đổi `version` và "Ngày sửa". Lịch sử và nhật ký chỉ ghi dữ liệu do người, API, form, hệ thống ngoài nhập vào. Áp dụng cho mọi bảng chạy trên engine Datahub, kể cả Deals.
- **Tính lại theo phần** (Module 2 mục 6.7): nguồn đổi thì chỉ tính lại dòng bị ảnh hưởng (tra ngược ô Liên kết bằng index GIN, gom nhóm theo khoá cũ/mới); mỗi lần tính lại phát sự kiện `dòng, cột, cũ → mới`; mỗi lần ghi có số thứ tự thay đổi để người đọc (API, MCP, Automation) đợi tính xong rồi mới đọc.
- View theo kiểu Lark Base, **tự lưu** mọi thay đổi (lọc, sắp xếp nhiều cấp, nhóm, ẩn/cố định cột, độ rộng). Người được chia sẻ đổi view chung thì lưu thành bản riêng của họ. Sắp xếp theo thứ tự lựa chọn và theo cột công thức (nền cho sắp deal theo BANT).
- Chia sẻ cả datahub hoặc từng bảng; quyền Xem hoặc Sửa dữ liệu; khoá phân chia và cho phép sửa theo cột (mục Tài khoản và phân quyền); chỉ chủ sửa cấu trúc. Ngoại lệ: ô **Liên kết dòng** chỉ chủ ghi được (người được chia sẻ không xem được bảng đích). Người được chia sẻ thấy giá trị cột công thức, **không thấy nội dung công thức**.
- Cột mỗi bảng mặc định 70, trần 200, Admin chỉnh. Bảng có form ghi vào: 150 (cài đặt `form.table_max_columns`), không vượt trần 200 (Module 7 mục 1.1a).
- Import từ Google Sheet/Excel là chức năng bắt buộc; có tuỳ chọn import công thức (dịch được thì thành cột công thức, không thì nhập giá trị và báo lý do).
- Dashboard ghép nhiều bảng: khoá không khớp thì báo rõ số dòng ghép được, không vẽ biểu đồ rỗng; ưu tiên cột liên kết (relation/lookup).
- Xoá mềm, khôi phục trong 7 ngày (admin chỉnh được).

## Deal

- Engine lưu **một bản ghi cho mỗi deal**, kèm danh sách người tham gia (Leading / Associate / Advisor) và tỉ lệ chia. Doanh thu cộng cho vai trò được tính doanh thu; workload cộng cho tất cả.
- Quản lý Deal là **một datahub được bảo vệ** ("Quản lý Deal") của mỗi Manager, Leader, User: chạy trên engine Datahub nhưng là **chức năng riêng**, chỉ hiện ở menu Quản lý Deal, **không hiện trong menu Datahub** (Dương chốt 19/11/2026). Datahub thường của người đó vẫn tham chiếu được bảng của nó (công thức, liên kết, bảng gộp, chỉ số). Không xoá, không đổi tên datahub, bảng mặc định và cột mặc định; **được tạo thêm bảng**. Không tính vào giới hạn số datahub (Module 4 mục 1).
- Người tham gia deal thấy cột `Người tham gia` gồm vai trò, % doanh thu, % com của nhau; **số tiền com chỉ thấy của mình** (Leader thấy của team, Manager của cây). Guest mặc định không thấy tỉ lệ, Manager cấp riêng khi cần (ví dụ bộ phận Data); Guest không bao giờ thấy số tiền com (Dương chốt 19/11/2026).
- Hiển thị theo quyền (kết quả của khoá phân chia): User thấy deal mình tham gia; Leader thấy deal của mình và team; Manager tạo deal, phân deal, thấy mọi deal trong cây của mình. Mọi người tham gia deal có cùng quyền sửa với cột được cho phép (không phân biệt Leading/Associate).
- Nguồn deal hiện tại: Manager nhập tay và phân tay. Sau này có hệ thống ngoài bắn API vào (kèm người được chia và tỉ lệ), nên mọi chỗ liên quan phải có API sẵn.
- Template cột có **bốn lớp**: Cơ bản và Theo vai trò (**Admin và Manager** sửa, Manager cho cây mình), Theo team (Leader sửa cho team, nếu bảng cho phép), Tuỳ chỉnh (từng người). Cột template có hai cách lưu: một giá trị chung mỗi deal, hoặc mỗi người một giá trị. Sửa template áp dụng ngay cho mọi người trong phạm vi. Thêm cột mặc định là cột riêng; đưa vào template phải chọn rõ. Template mặc định bám theo sheet Deals của file mẫu (Module 4 mục 3, 4).
- Datahub "Quản lý Deal" là **datahub đặc thù của hệ thống**, chỉ có bản chất là datahub; không coi như datahub thông thường. Nó không làm đích, không làm nguồn dữ liệu của Form (Dương chốt 19/11/2026; Module 7). Module sau muốn dùng nó như nguồn chung thì phải nêu rõ và hỏi Dương.
- **Cột mặc định là cột thường do template sinh sẵn**, không có logic viết cứng: cột tính toán là công thức chỉ dùng hàm kiểu Excel, không thêm hàm riêng cho Quản lý Deal.
- **Bảng template** (Dương chốt 19/11/2026, Module 4 mục 3.5–3.8): mọi bảng mặc định (Deals, Index, Probation KPI, Thanh toán, Chính sách com, Tham số com) là bảng template lưu ở `dh_rows` như mọi bảng, **không có bảng `deals` riêng hay cột thật của Postgres**. Manager tạo bảng template cho cả cây, Leader tạo cho team (gắn với team, không gắn với người). Template theo cây, sinh từ bộ mặc định của hệ thống (Admin sửa). Người nhận chỉ thêm được cột riêng. Hai kiểu: **bảng chung** (một bộ dòng, cột **khoá phân chia** kiểu Người dùng quyết định dòng hiện ở bảng của ai; ví dụ Deals khoá = Người tham gia) và **bảng riêng** (mỗi người một bảng, như Index). Người tạo bảng đặt quyền thành viên, khoá phân chia và cho phép sửa từng cột như mọi bảng. Sửa ở một **trang Template** duy nhất; quyền "Leader được thêm cột team" đặt theo bảng ngay trên trang đó.
- **Vai trò cột**: chức năng lõi (khoá kỳ, forecast, snapshot, BANT, Index, API ngoài) tìm cột theo vai trò (`ngày chốt`, `doanh thu`, `trạng thái`…), không theo tên hay mã cố định. Đổi tên/công thức/định dạng được, kèm cảnh báo nơi đang dùng; đổi kiểu hoặc bỏ cột chỉ được khi vai trò vẫn có cột đúng kiểu.
- Deal không bao giờ bị xoá cứng; Manager chỉ đánh dấu "Huỷ".
- **Thanh toán và com theo đợt** (Dương chốt 19/11/2026, Module 4 mục 7, 12): deal **chỉ Won khi tiền về đợt đầu** (hệ thống đặt Won và Closing date); lịch thanh toán lập lúc ký hợp đồng ở bảng chung **Đợt thanh toán**; mỗi lần tiền về sinh dòng **Sổ com** cho từng người theo % chia của đợt đó (% trên com sale, tổng ≤ tỉ lệ SoE); tỉ lệ com sale tra chính sách tại Closing date; doanh thu tính theo ngày tiền về. Ghép tiền về bằng gợi ý theo luật cố định và ghi nhớ người trả.
- **Chốt kỳ** (Manager, theo tháng) gộp khoá kỳ và chốt com: đóng băng Đợt, Sổ com (thành giá trị cứng) và deal đóng của tháng. Sai sót sau chốt chỉ sửa bằng dòng điều chỉnh ở kỳ đang mở; mở lại kỳ không tính lại com đã chốt. Chuyển vai trò cột làm đổi số kỳ đã chốt thì bị chặn.
- Chính sách com có phiên bản và ngày hiệu lực; Manager tạo phiên bản mới, không ghi đè phiên bản cũ. Làm trước phiên bản đầu tiên, sẽ chỉnh sau khi Dương bàn với Manager.
- BANT: hàng chờ "Cần chấm lại hôm nay" thay cho chấm lại toàn bộ mỗi ngày; lưu lịch sử điểm.
- Forecast so với snapshot pipeline đầu quý.

## AI

- Kết nối AI: user tạo kết nối, admin duyệt; scope là **menu và mức** (Xem / Sửa / Toàn quyền); menu tính theo **đối tượng đích** (bảng của datahub "Quản lý Deal" thuộc menu Quản lý Deal); quyền thực tế = giao của quyền user, scope kết nối, chính sách AI chung, nhóm cấm (Module 5).
- **Nhóm cấm AI:** cấm cứng (Onboarding phía nhân sự: tick việc, xác nhận checkpoint, chốt đánh giá cuối; nhân sự onboard không dùng AI với Onboarding; Leader/Manager được dùng AI để tạo, sửa, đọc lộ trình — Module 9 mục 10, Dương 22/11/2026; tạo/duyệt/thu hồi token và kết nối; chính sách AI; mật khẩu, phiên; nộp bài kiểm tra) và cấm mặc định Admin bật được theo nhóm (tổ chức, cấp dữ liệu Guest, chuyển giao, cài đặt hệ thống, nhật ký). Chia sẻ bảng không bị cấm: việc không hợp lệ thì không ghi, trả lỗi kèm lý do.
- Hỗ trợ OAuth (Claude Desktop, claude.ai, ChatGPT, Codex) và token (Claude Code, Codex, script). AI gọi REST được bằng token của kết nối, **không bao giờ** bằng phiên đăng nhập web.
- MCP: bộ tool chọn lọc (tối đa 30) + `soe_operations` / `soe_describe` / `soe_call` cho mọi thao tác còn lại.
- **Thao tác lớn** (chốt kỳ, mở lại kỳ, sửa template cả cây/team, chuyển vai trò cột): xem trước rồi xác nhận bằng mã, một đường cho web và AI; qua AI cần mức Toàn quyền; AI không tự đánh "Đã kiểm".
- **Key API của cây** cho hệ thống ngoài: Manager tạo, Admin duyệt (Admin tạo thì Manager của cây bấm nhận); thuộc cây, không thuộc người.
- Hệ thống **không tiêu thụ AI**. Kiểm tra skill/knowledge bằng luật cố định ở server; sai chuẩn thì trả lỗi có cấu trúc để AI của người đăng tự sửa. Knowledge và AI Hub dùng chung engine đăng → kiểm tra → duyệt → xuất bản.

## Phạm vi

- Workspace (giao việc) làm gọn: giao việc, hạn, nhắc, phản hồi, gắn vào deal. Không thay thế công cụ cá nhân.

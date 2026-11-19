# CLAUDE.md — SoE Hub

SoE Hub là nơi làm việc chung cho team SoE của Base: quản lý deal và chỉ số, Datahub, dashboard, form, onboarding, knowledge, AI Hub, giao việc. Hệ thống được dựng theo mong muốn của team SoE và yêu cầu của ban lãnh đạo.

Quy mô: 15–20 người dùng thường xuyên, nhiều người dùng thỉnh thoảng (sale, bộ phận Data). Bảng Deals > 10.000 dòng và còn tăng.

## Bản đồ thư mục

| Đường dẫn     | Nội dung                                                                                                                                                                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `promt.md`    | Brief gốc của Dương. Chỉ đọc                                                                                                                                                                                                                          |
| `examples/`   | File mẫu chứa **dữ liệu thật của Base** (deal, com, onboarding, chính sách). **Mọi agent được đọc tự do, lúc nào cũng được** (Dương cho phép 18/11/2026). Không sửa. **Không bao giờ commit** file hay dữ liệu lấy từ đây (đã nằm trong `.gitignore`) |
| `design/`     | Thiết kế đã chốt: `moduleX-<ten>.md`, `ha-tang.md`, `chuan-giao-dien.md` (chuẩn giao diện, đọc khi làm giao diện), `moduleX-quyet-dinh-khi-code.md` (quyết định khi code, tách ra khi dài; tra khi cần) |
| `progress.md` | Trạng thái và tiến độ hiện tại                                                                                                                                                                                                                        |
| `CLAUDE.md`   | File này                                                                                                                                                                                                                                              |

## Quy trình làm việc

### Bắt đầu mỗi phiên

**`CLAUDE.md` được Claude Code nạp sẵn vào mọi phiên, kể cả agent con, nên không gọi Read lại lúc bắt đầu.** Chỉ đọc lại bằng Read khi hội thoại đã bị tóm tắt, hoặc khi không thấy nội dung `CLAUDE.md` trong ngữ cảnh. Việc đầu tiên của mọi phiên là đọc `progress.md`. Áp dụng cho mọi agent: Opus, Sonnet và mọi agent được giao việc; không được dựa vào trí nhớ hay bản tóm tắt của file này. Khi code một stage, đọc thêm file thiết kế của module thuộc stage đó; file `moduleX-quyet-dinh-khi-code.md` (nếu có) chỉ tra khi cần biết bước trước đã làm thế nào. Không cần đọc lại phiên cũ.

### Thiết kế

0. **Trước khi thiết kế một module mới, đọc lại toàn bộ các file thiết kế đã có trong `design/`** (mọi module trước đó, `ha-tang.md`, kể cả mục "Quyết định khi code"), không dựa vào trí nhớ hay bản tóm tắt. Đề xuất mới phải khớp với những gì đã chốt; chỗ nào cần đổi quy định cũ thì nói rõ là đổi, lý do, và ảnh hưởng tới module nào. _Lý do:_ các module dùng chung engine (Datahub, phân quyền, công thức, nhật ký), một đề xuất lệch với quy định cũ sẽ gây mâu thuẫn khi code.
1. **Thiết kế từng module theo vòng:** Claude phân tích và đề xuất trong chat → Dương phản biện → chốt → Claude ghi `design/moduleX-<ten>.md`, kèm trạng thái `Đã chốt` và ngày ở đầu file.
2. **Phản biện thật.** Ý tưởng hay giả định yếu thì nói thẳng, kèm lý do và phương án tốt hơn. Không đồng ý cho xong.
3. Một quyết định mới được chốt trong chat thì ghi vào đúng file thiết kế của module đó, và vào mục "Quy định đã chốt" bên dưới nếu nó ảnh hưởng nhiều module.

### Code

1. **Chỉ code module đã có file thiết kế `Đã chốt`.** Với module đó, code tự do theo thứ tự stage ở mục "Stage code"; không cần chờ lệnh riêng. Module chưa chốt thiết kế thì không code.
2. **Engine trước, giao diện sau.** Giao diện của mỗi stage chỉ cần đủ dùng, đủ xem; có stage làm đẹp riêng ở cuối. Khi code vẫn làm theo `design/chuan-giao-dien.md` (dùng token, thành phần chung, wording), nhưng **không rà soát chuẩn giao diện** ở các stage 2–11 (Dương chốt 19/11/2026): Stage 12 làm lại giao diện hoàn chỉnh và rà toàn bộ chuẩn giao diện (font, cỡ chữ, màu, tương phản, khoảng cách, vùng chạm, chuyển động, bộ skill giao diện). **Ngoại lệ: Dynamic Form (Stage 7, cả builder lẫn form công khai) và Onboarding (Stage 9) phải kỹ từ đầu**: rà đủ `design/chuan-giao-dien.md`, bộ skill giao diện và `break-ui` ở lần kiểm thử cuối stage của chúng, kiểm 375px đầy đủ (Dương chốt 19/11/2026).
3. **Tự quyết chi tiết nhỏ.** Khi code, các chi tiết nhỏ (đặt tên, cấu trúc file, thư viện phụ, cách xử lý lỗi, giá trị mặc định hợp lý) thì Claude tự phản biện, tự ra quy định và ghi lại vào mục "Quyết định khi code" của module (Module 2: file `design/module2-quyet-dinh-khi-code.md`; module khác: cuối file thiết kế, tách ra file riêng như Module 2 khi mục này dài quá khoảng 100 dòng). Chỉ hỏi Dương khi điều cần hỏi quyết định một chức năng quan trọng, đổi một quy định đã chốt, hoặc chạm dữ liệu thật / thao tác khó hoàn tác.
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

| #   | File                                 | Nội dung                                                                             | Trạng thái |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------ | ---------- |
| 0   | `module0-nen-tang.md` + `ha-tang.md` | Kiến trúc, stack, quy ước, audit, khoá kỳ, sự kiện, hạ tầng                          | Đã chốt    |
| 1   | `module1-tai-khoan-phan-quyen.md`    | Tài khoản, vai trò, cây tổ chức, cấp dữ liệu, token                                  | Đã chốt    |
| 2   | `module2-datahub.md`                 | Lưu trữ, kiểu cột, công thức, lịch sử, import/export                                 | Đã chốt    |
| 3   | `module3-metric-dashboard.md`        | Định nghĩa chỉ số, biểu đồ, bảng gộp                                                 | Đã chốt    |
| 4   | `module4-quan-ly-deal.md`            | Template Deals, người tham gia, chính sách/com, forecast, BANT                       | Đã chốt    |
| 5   | `module5-ket-noi-ai.md`              | REST, MCP, quản lý kết nối AI                                                        | Đã chốt    |
| 6   | `module6-thong-bao.md`               | Thông báo, nhắc hẹn, nhắc hạn                                                        | Chưa       |
| 7   | `module7-dynamic-form.md`            | Form kéo thả, bài test, khảo sát                                                     | Đã chốt    |
| 8   | `module8-knowledge-aihub.md`         | Knowledge, AI Hub, engine đăng → kiểm tra → duyệt                                    | Chưa       |
| 9   | `module9-onboarding.md`              | Lộ trình onboard, checklist, bài test                                                | Chưa       |
| 10  | `module10-workspace.md`              | Giao việc                                                                            | Chưa       |
| 11  | `module11-cai-dat-feedback.md`       | Cài đặt, feedback                                                                    | Chưa       |
| —   | Automation                           | Module lõi, **chưa thiết kế, chưa làm**. Kiến trúc phải để sẵn chỗ (Module 0 mục 19) | Hoãn       |

Module 0–5 là engine.

## Stage code

Thứ tự thiết kế và thứ tự code khớp nhau: module sau chỉ dựa vào module trước, nên code được lần lượt. Thiết kế luôn đi trước code ít nhất một module, nghĩa là code Stage N trong lúc thiết kế module N+1.

| Stage | Module     | Cần module trước | Nội dung code                                                                                                                                                                                            | Kết quả dùng được                                                   | Trạng thái |
| ----- | ---------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------- |
| 0     | M0         | —                | Monorepo, Docker dev, Postgres + migration, command/query registry, actor, mã lỗi, audit log, `row_history`, outbox, worker pg-boss, lưu file, SSE, sinh OpenAPI, khung test                             | Server chạy, có `/health`, `/api/docs`; chưa có chức năng nghiệp vụ | Đã xong    |
| 1     | M1         | 0                | Tài khoản, vai trò, cây tổ chức, đăng nhập (mật khẩu + Google), session, token, engine phân quyền, quên mật khẩu, hộp thông báo tối thiểu (M6 mở rộng sau), trang nhật ký của Admin, chuyển giao dữ liệu | Đăng nhập, quản lý người dùng, admin xem log                        | Đã xong    |
| 2     | M2         | 1                | Datahub, bảng, kiểu cột, engine công thức, lọc/sắp xếp/view, grid ảo hoá, import/export, thùng rác, lịch sử dòng                                                                                         | Dùng Datahub thay Google Sheet/Lark Base                            | Đã xong |
| 3     | M3         | 2                | Engine metric, các loại biểu đồ, dashboard tuỳ chỉnh                                                                                                                                                     | Vẽ dashboard từ Datahub                                             | Đang làm (3C-2 xong, chờ Opus rà; tiếp 3D) |
| 4     | M4         | 2, 3             | **4.1: sửa lại code Stage 2 theo quyết định 19/11 (Module 4 mục 19a)**; template Deals (bốn lớp cột), người tham gia, chính sách com có phiên bản, khoá kỳ, snapshot, forecast, BANT, dashboard Deals mặc định, API cho hệ thống ngoài                                            | **Mốc Engine v1: team SoE chạy thử quản lý deal**                   |            |
| 5     | M5         | 1, 4             | MCP server, OAuth + DCR, token cá nhân, key API của cây, kết nối AI chờ duyệt, menu và mức, nhóm cấm AI, thao tác lớn (xem trước + mã xác nhận), hướng dẫn kết nối, bộ Bruno đầy đủ                                                                                        | Claude/Codex điều khiển được hệ thống                               |            |
| 6     | M6         | 1                | Thông báo đầy đủ, nhắc hẹn, nhắc hạn, quy tắc gửi                                                                                                                                                        |                                                                     |            |
| 7     | M7         | 2, 3, 5, 6       | Dynamic Form: builder kéo thả, renderer công khai, lưu nháp, chấm điểm, nguồn dữ liệu, JSON import/export                                                                                                               |                                                                     |            |
| 8     | M8         | 1, 6             | Engine đăng → kiểm tra → duyệt → xuất bản; Knowledge; AI Hub                                                                                                                                             |                                                                     |            |
| 9     | M9         | 6, 7             | Onboarding: lộ trình, checklist, bài test, theo dõi, template mẫu                                                                                                                                        |                                                                     |            |
| 10    | M10        | 4, 6             | Workspace giao việc                                                                                                                                                                                      |                                                                     |            |
| 11    | M11        | các module trên  | Cài đặt còn lại, feedback                                                                                                                                                                                |                                                                     |            |
| 12    | —          | tất cả           | Làm lại giao diện hoàn chỉnh; rà toàn bộ `design/chuan-giao-dien.md` và bộ skill giao diện cho mọi màn                                                                                                  |                                                                     |            |
| —     | Automation | 0, 2, 6          | Chưa thiết kế                                                                                                                                                                                            |                                                                     |            |

**Bước con của stage:** stage lớn được chia bước con để giao việc. Danh sách bước con và trạng thái từng bước nằm ở `progress.md` (mục "Đang làm"); cột "Trạng thái" ở bảng trên ghi bước đang làm. Xong một bước con thì cập nhật cả hai chỗ. Stage 2 có 9 bước: 2A (schema, API cấu trúc/dòng), 2B (công thức), 2B+ (tính lại theo phần), 2C-1 (grid), 2C-2 (view), 2C-3 (quản lý cột, trình soạn công thức), 2C-4 (tìm dòng trùng, chia sẻ, thùng rác, giới hạn), 2D (import/export, import công thức, load test), 2E (kiểm thử đầy đủ cả stage). Stage 3 có 7 bước: 3A-1, 3A-2, 3B, 3C-1, 3C-2, 3D, 3E. Stage 4 bắt đầu bằng bước con **4.1: bổ sung Module 2** theo các quyết định 19/11/2026 (khoá phân chia, cho phép sửa theo cột, ô Người dùng chỉ nhận thành viên, SSE lọc theo dòng, hạ tầng bảng template, bỏ `PhysicalSource`); danh sách ở Module 4 mục 19a. **Mọi stage có giao diện đều kết thúc bằng một bước con kiểm thử riêng** (như 2E), không gộp vào bước con có code, để `progress.md` ghi rõ đang dừng ở phần code hay phần kiểm thử.

**Định nghĩa xong của mỗi stage:**

1. Chức năng đúng theo file thiết kế; mọi lệch hoặc bổ sung đã ghi vào mục "Quyết định khi code" của module đó.
2. Test unit và test phân quyền của stage đều pass; test của các stage trước không bị hỏng.
3. Mọi endpoint mới có trong OpenAPI và có request mẫu trong `docs/api/bruno/`. Từ Stage 6: thao tác mới khai báo menu, `access`, nhóm cấm AI (Module 5 mục 3.5); việc hay làm qua AI có tool chọn lọc.
4. Có giao diện tối thiểu để dùng được mọi chức năng của stage (chuẩn giao diện rà ở Stage 12).
5. **Đã qua lần kiểm thử cuối stage** (mục "Kiểm thử theo cấp" bên dưới; với stage có giao diện): chỉ kiểm **lỗi chức năng**. Chạy api + worker + web thật, mở trên trình duyệt thật (Playwright có chụp màn hình, hoặc Claude in Chrome), đi hết các luồng chính của stage với từng vai trò liên quan, kiểm tra không có lỗi console/network. Với bảng/grid: kiểm mọi chức năng hiển thị và thao tác (tải dữ liệu khi cuộn, sửa ô, kéo thả và đổi độ rộng cột, lọc, sắp xếp, nhóm, view…) chạy đúng. Thử dữ liệu xấu nhất về **chức năng và số liệu** (danh sách rỗng, 10.000 dòng, số rất lớn, số âm, giá trị trống, tên có `<b>` hiện đúng là chữ, không cắt số/tiền/ngày). Không rà chuẩn giao diện (font, cỡ chữ, màu, tương phản, khoảng cách, bộ skill giao diện): việc của Stage 12. Lỗi tìm thấy phải sửa xong mới coi là xong. Ghi kết quả kiểm thử (luồng đã đi, lỗi đã sửa) vào `progress.md`.
6. `progress.md` đã cập nhật; cột "Trạng thái" của stage trong bảng "Stage code" ở `CLAUDE.md` đã ghi "Đã xong" (Opus ghi sau khi rà soát đạt); đã commit.

**Kiểm thử theo cấp** (Dương chốt 19/11/2026, để giảm quota; kiểm thử nặng chỉ chạy một lần mỗi stage):

| Lúc nào | Ai | Chạy gì |
| ------- | -- | ------- |
| Mỗi bước con | Sonnet | Test nhanh: `typecheck`, `lint`, unit test của phần vừa sửa (`pnpm exec vitest run <thư mục/file>`), e2e của đúng spec bước đó, chỉ ở desktop. Không chạy cả bộ e2e, không chạy 375px, không chạy bộ skill giao diện hay `break-ui`. Ghi lệnh đã chạy và kết quả vào `progress.md`. |
| Rà bước con | Opus | Đọc diff và kết quả test Sonnet ghi lại, so với thiết kế. Chỉ chạy lại test khi thấy nghi. **Bắt buộc coi là nghi** (phải tự chạy lại) khi có một trong hai dấu hiệu: (1) Sonnet ghi kiểu "lần trước fail, chạy lại thì pass" hoặc có test chập chờn; (2) bước con chạm phần dùng chung (ví dụ `apps/web/src/components/ui`, `RowsStore`, registry, engine công thức, phân quyền). |
| Bước con kiểm thử cuối stage (ví dụ 2E) | Sonnet chạy, Opus điều phối | **Sonnet** kiểm thử chức năng đầy đủ một lần: `pnpm test` toàn bộ, toàn bộ e2e (desktop; điện thoại chỉ các luồng chính, theo "Điện thoại là ưu tiên thấp"), đi luồng thật trên trình duyệt (chụp màn hình), dữ liệu xấu nhất về chức năng, "Định nghĩa xong" điểm 2–5; không dò chuẩn giao diện, không chạy bộ skill giao diện; ghi kết quả, lỗi tìm thấy và ảnh chụp vào `progress.md`, sửa lỗi, chạy lại spec liên quan. **Opus** chia việc kiểm thử cho Sonnet (luồng nào, vai trò nào, dữ liệu xấu nhất nào), đọc kết quả và ảnh chụp, tự đi tay vài luồng chính khi cần, hỗ trợ Sonnet tìm nguyên nhân gốc khi kẹt, và quyết định stage đã đạt hay chưa. |

**Cách kiểm thử cuối stage để tiết kiệm token** (Dương chốt 19/11/2026; áp dụng mọi stage **trừ Stage 7 Dynamic Form và Stage 12 giao diện**, hai stage này cần chú ý giao diện nên kiểm kỹ như quy định riêng của chúng):

- Chụp màn hình chỉ cho các màn hình chủ chốt; màn hình còn lại để Stage 12 xử lý một lần.
- Ưu tiên kiểm bằng code: assert trong Playwright, kiểm console và network bằng script. Ảnh chụp lưu ra file làm bằng chứng, chỉ mở xem khi assert fail hoặc khi cần nhìn bố cục.
- Đọc log chỉ phần lỗi.
- Chia kiểm thử thành vài phiên ngắn (ví dụ: chạy toàn bộ test và sửa lỗi; rồi đi luồng thật các màn hình chủ chốt theo vai trò + dữ liệu xấu nhất), mỗi phiên bắt đầu với ngữ cảnh gọn.
- Không rà chuẩn giao diện, không chạy bộ skill giao diện hay `break-ui` (Stage 12).

**Test chập chờn là lỗi.** Test lúc pass lúc fail (kể cả e2e hết giờ) không được chạy lại cho tới khi pass rồi báo pass. Phải tìm nguyên nhân và sửa: đợi đúng điều kiện thay cho chờ cố định, dữ liệu test tách riêng từng test, không phụ thuộc thứ tự chạy. Chỉ được nới thời gian chờ khi đã đo và ghi lý do. Chưa sửa xong thì ghi vào `progress.md` mục "Câu hỏi còn mở" (tên test, lệnh, tần suất fail), và bước con chưa coi là xong. Không tắt hay `skip` test để né (Dương chốt 19/11/2026). Test chập chờn lộ ra trong bước con nào thì chặn bước con đó, dù test thuộc stage cũ. Ngoại lệ: lỗi giao diện ở bề ngang điện thoại (xem dưới).

**Điện thoại là ưu tiên thấp** (Dương chốt 19/11/2026; người dùng ít dùng điện thoại). Test giao diện ở 375px giữ ít: mỗi spec chỉ vài luồng chính, không nhân đôi mọi luồng desktop. Lỗi giao diện chỉ xảy ra ở điện thoại (kể cả test chập chờn ở 375px) **không chặn** bước con hay stage: ghi vào `progress.md` mục "Lỗi điện thoại để sau" (spec, lệnh, mô tả ngắn) rồi làm tiếp; gom lại sửa ở một đợt sau, Opus quyết khi nào. Không áp dụng cho trang công khai (form công khai, onboarding): các trang đó vẫn phải chạy đủ ở 375px như `design/chuan-giao-dien.md` quy định. Lỗi chức năng hay số liệu lộ ra ở điện thoại thì vẫn là lỗi thường, phải sửa.

Lỗi chức năng phải bắt ở bước con và cuối stage; lỗi chuẩn giao diện dồn về Stage 12.

## Phân vai khi code

| Stage    | Ai code                                                   | Ai kiểm soát |
| -------- | --------------------------------------------------------- | ------------ |
| 0–1      | Opus (đã làm)                                             | Opus         |
| 2 trở đi | **Sonnet** code, test nhanh, kiểm thử đầy đủ cuối stage    | **Opus**     |

Thiết kế module vẫn do Opus đề xuất và Dương chốt. Từ Stage 2, Opus là người kiểm soát:

0. **Opus không tự sửa code hay test**, kể cả sửa nhỏ phát hiện khi rà soát (Dương nhắc 18/11/2026). Opus chỉ chạy lệnh để kiểm tra (git, test, lint, typecheck), ghi lỗi và giao Sonnet sửa. Opus vẫn tự viết thiết kế, `CLAUDE.md` và ghi chú điều phối trong `progress.md`.
1. Đọc thiết kế, chia stage thành các việc nhỏ có tiêu chí nghiệm thu rõ ràng (file nào, chức năng gì, test nào phải có, luồng giao diện nào phải chạy được), rồi giao từng việc cho Sonnet.
   **Mỗi prompt giao cho Sonnet phải ghi rõ:** (a) `CLAUDE.md` đã được nạp sẵn, không Read lại trừ khi hội thoại bị tóm tắt hoặc không thấy nó trong ngữ cảnh; đọc `progress.md` và file thiết kế liên quan (thêm `design/chuan-giao-dien.md` nếu việc có giao diện); chỉ chạy test nhanh theo mục "Kiểm thử theo cấp"; (b) **sau mỗi bước nhỏ** (một nhóm chức năng, một bộ test pass, một file tài liệu) thì cập nhật `progress.md` (đánh dấu xong, ghi bước tiếp theo cụ thể) và **commit ngay**, không đợi xong cả việc, để hết quota giữa chừng không mất gì; (c) không push.
2. Rà soát kết quả của Sonnet theo mục "Kiểm thử theo cấp": bước con thì đọc diff và kết quả test, cuối stage thì điều phối và đọc kết quả kiểm thử đầy đủ của Sonnet; đánh giá so với thiết kế và tiêu chí.
3. Phản biện và yêu cầu sửa khi chưa đạt; chỉ đánh dấu xong khi đạt "Định nghĩa xong".
4. Sonnet không được tự đổi quy định đã chốt; chỗ nào thiết kế chưa rõ thì hỏi Opus, Opus tự quyết chi tiết nhỏ và chỉ hỏi Dương việc quan trọng.
5. **Sửa quá 5 vòng chưa xong thì dừng, báo Opus.** Một vòng là một lần sửa rồi chạy lại test hoặc kiểm thử mà cùng một lỗi vẫn còn (lỗi đổi dạng nhưng cùng chỗ vẫn tính là cùng lỗi). Đến vòng thứ 5 chưa sửa được, Sonnet dừng sửa và báo Opus:
   - lỗi là gì, cách tái hiện, lệnh test đang fail;
   - 5 cách đã thử và vì sao từng cách không ăn;
   - giả thuyết hiện tại về nguyên nhân, file và hàm liên quan.

   Opus và Sonnet cùng phân tích; **Opus tìm nguyên nhân gốc và hướng dẫn sửa tận gốc** rồi mới cho Sonnet sửa tiếp. Nguyên nhân gốc đòi đổi quy định đã chốt thì Opus hỏi Dương.

6. **Sửa tận gốc, không chắp vá.** Một số liệu chỉ có một nơi tính (engine/command ở server); UI, export, API, MCP, dashboard chỉ đọc kết quả đó, không tự tính lại. Lỗi số liệu phải sửa ở nơi tính, không sửa ở chỗ hiển thị. Cấm các cách chữa cháy làm số đúng ở một màn hình nhưng sai ở chỗ khác:
   - thêm điều kiện riêng cho một màn hình, một bảng, một người dùng;
   - gán cứng giá trị, làm tròn hoặc định dạng lại để "khớp số";
   - sửa test cho khớp kết quả sai, bỏ qua hoặc tắt test;
   - bắt lỗi rồi nuốt lỗi (`try/catch` im lặng, giá trị mặc định che lỗi).

   Sửa xong phải có test tái hiện đúng lỗi đó, và kiểm tra lại mọi nơi dùng chung giá trị ấy (grid, export, API, dashboard, MCP), không chỉ chỗ phát hiện lỗi.

REST API được sinh từ registry ngay từ Stage 0, nên mỗi stage tự có API của nó; Stage 5 chỉ thêm MCP và phần quản lý kết nối AI.

## Chuẩn giao diện

Toàn bộ quy định giao diện (bộ skill và lệnh cài, hệ thống thiết kế, trạng thái thành phần, form, bảng và số liệu, tương phản, điện thoại, chuyển động, wording, dữ liệu xấu nhất) nằm ở **`design/chuan-giao-dien.md`**. Agent nào code hoặc rà soát giao diện phải đọc file đó trước khi làm; việc chỉ đụng server thì không cần đọc.

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

### Datahub và công thức

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

### Deal

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

### AI

- Kết nối AI: user tạo kết nối, admin duyệt; scope là **menu và mức** (Xem / Sửa / Toàn quyền); menu tính theo **đối tượng đích** (bảng của datahub "Quản lý Deal" thuộc menu Quản lý Deal); quyền thực tế = giao của quyền user, scope kết nối, chính sách AI chung, nhóm cấm (Module 5).
- **Nhóm cấm AI:** cấm cứng (Onboarding; tạo/duyệt/thu hồi token và kết nối; chính sách AI; mật khẩu, phiên; nộp bài kiểm tra) và cấm mặc định Admin bật được theo nhóm (tổ chức, cấp dữ liệu Guest, chuyển giao, cài đặt hệ thống, nhật ký). Chia sẻ bảng không bị cấm: việc không hợp lệ thì không ghi, trả lỗi kèm lý do.
- Hỗ trợ OAuth (Claude Desktop, claude.ai, ChatGPT, Codex) và token (Claude Code, Codex, script). AI gọi REST được bằng token của kết nối, **không bao giờ** bằng phiên đăng nhập web.
- MCP: bộ tool chọn lọc (tối đa 30) + `soe_operations` / `soe_describe` / `soe_call` cho mọi thao tác còn lại.
- **Thao tác lớn** (chốt kỳ, mở lại kỳ, sửa template cả cây/team, chuyển vai trò cột): xem trước rồi xác nhận bằng mã, một đường cho web và AI; qua AI cần mức Toàn quyền; AI không tự đánh "Đã kiểm".
- **Key API của cây** cho hệ thống ngoài: Manager tạo, Admin duyệt (Admin tạo thì Manager của cây bấm nhận); thuộc cây, không thuộc người.
- Hệ thống **không tiêu thụ AI**. Kiểm tra skill/knowledge bằng luật cố định ở server; sai chuẩn thì trả lỗi có cấu trúc để AI của người đăng tự sửa. Knowledge và AI Hub dùng chung engine đăng → kiểm tra → duyệt → xuất bản.

### Phạm vi

- Workspace (giao việc) làm gọn: giao việc, hạn, nhắc, phản hồi, gắn vào deal. Không thay thế công cụ cá nhân.

## Lưu ý

- `examples/` chứa dữ liệu thật của Base. Đọc tự do, nhưng không đưa vào git (kể cả fixture hay snapshot test chứa số liệu lấy từ đó), không đưa nội dung ra dịch vụ ngoài.
- Golden test đọc thẳng file trong `examples/` trên máy để so số với Excel; máy không có file thì test tự bỏ qua (Dương đồng ý 18/11/2026).
- Repo GitHub đang để **public**. Không commit dữ liệu thật, secret hay `.env`.
- Hạ tầng, chi phí và việc đứng tên server do Dương lo; thiết kế chỉ cần ghi rõ yêu cầu.
- Golden test dùng số liệu từ file deal mẫu chỉ chạy trên máy, dữ liệu mẫu không commit.

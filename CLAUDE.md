# CLAUDE.md — SoE Hub

SoE Hub là nơi làm việc chung cho team SoE của Base: quản lý deal và chỉ số, Datahub, dashboard, form, onboarding, knowledge, AI Hub, giao việc. Hệ thống được dựng theo mong muốn của team SoE và yêu cầu của ban lãnh đạo.

Quy mô: 15–20 người dùng thường xuyên, nhiều người dùng thỉnh thoảng (sale, bộ phận Data). Bảng Deals > 10.000 dòng, thiết kế cho 20.000 deal (Dương hạ từ 100.000 ngày 20/11/2026); bảng Datahub khác 100.000 dòng.

## Bản đồ thư mục

| Đường dẫn | Nội dung |
| --- | --- |
| `promt.md` | Brief gốc của Dương. Chỉ đọc |
| `examples/` | **Dữ liệu thật của Base** (deal, com, onboarding, chính sách). Mọi agent đọc tự do (Dương cho phép 18/11/2026). Không sửa. **Không bao giờ commit** file hay dữ liệu lấy từ đây (kể cả fixture, snapshot test), không đưa ra dịch vụ ngoài |
| `design/moduleX-<ten>.md` | Thiết kế đã chốt của từng module; `moduleX-quyet-dinh-khi-code.md`: quyết định khi code (tra khi cần) |
| `design/quy-dinh-chung.md` | Quy định đã chốt ảnh hưởng nhiều module (kiến trúc, phân quyền, Datahub, Deal, AI). Đọc khi thiết kế, hoặc khi code/rà việc chạm phân quyền, chia sẻ, công thức, Deal, AI |
| `design/kiem-thu.md` | Chi tiết kiểm thử cuối stage, test chập chờn, điện thoại |
| `design/chuan-giao-dien.md` | Chuẩn giao diện. Đọc khi code hoặc rà giao diện; việc chỉ đụng server thì không cần |
| `design/ha-tang.md` | Hạ tầng triển khai |
| `docs/` | OpenAPI, bộ Bruno (`docs/api/bruno/`), hướng dẫn kết nối AI (`docs/ket-noi-ai.md`) |
| `progress.md` | Trạng thái và tiến độ hiện tại |

## Quy trình làm việc

### Bắt đầu mỗi phiên

`CLAUDE.md` được nạp sẵn vào mọi phiên, kể cả agent con: không Read lại, trừ khi hội thoại đã bị tóm tắt hoặc không thấy nó trong ngữ cảnh. Việc đầu tiên của mọi agent là đọc `progress.md`; không dựa vào trí nhớ hay bản tóm tắt. Khi code một stage, đọc thêm file thiết kế của module đó. Không cần đọc lại phiên cũ.

### Thiết kế

0. **Trước khi thiết kế một module mới, đọc lại toàn bộ `design/`** (mọi module trước, `quy-dinh-chung.md`, `ha-tang.md`, kể cả quyết định khi code). Đề xuất mới phải khớp với những gì đã chốt; chỗ nào đổi quy định cũ thì nói rõ là đổi, lý do, ảnh hưởng tới module nào. _Lý do:_ các module dùng chung engine (Datahub, phân quyền, công thức, nhật ký).
1. **Thiết kế theo vòng:** Claude đề xuất trong chat → Dương phản biện → chốt → Claude ghi `design/moduleX-<ten>.md`, kèm `Đã chốt` và ngày ở đầu file.
2. **Phản biện thật.** Ý tưởng hay giả định yếu thì nói thẳng, kèm lý do và phương án tốt hơn.
3. Quyết định mới chốt trong chat thì ghi vào file thiết kế của module đó, và vào `design/quy-dinh-chung.md` nếu ảnh hưởng nhiều module.
4. **Mặc định lấy từ file mẫu, không tự chế.** Template, cột, danh sách lựa chọn, lộ trình mẫu… mặc định bắt đầu từ file mẫu trong `examples/`, giữ nguyên tên và giá trị, ghi rõ nguồn (file, sheet, cột). Cái hệ thống cần thêm để ở danh sách riêng "Thêm vì hệ thống cần", kèm lý do. Không có file mẫu thì hỏi Dương. _Lý do:_ 18/11/2026 Dương gạt bản nháp Module 4 vì template Deals tự chế.

### Code

1. **Chỉ code module đã có thiết kế `Đã chốt`**, theo thứ tự stage; không cần chờ lệnh riêng.
2. **Engine trước, giao diện sau.** Giao diện mỗi stage đủ dùng, đủ xem; vẫn theo `design/chuan-giao-dien.md` (token, thành phần chung, wording) nhưng **không rà chuẩn giao diện** ở Stage 2–11: Stage 12 làm lại giao diện và rà toàn bộ. **Ngoại lệ: Dynamic Form (Stage 7, builder và form công khai) và Onboarding (Stage 9)** rà đủ chuẩn giao diện, bộ skill giao diện, `break-ui` và 375px ở kiểm thử cuối stage (Dương chốt 19/11/2026).
3. **Tự quyết chi tiết nhỏ** (đặt tên, cấu trúc file, thư viện phụ, xử lý lỗi, giá trị mặc định) và ghi vào mục "Quyết định khi code" của module (file `moduleX-quyet-dinh-khi-code.md` khi dài quá khoảng 100 dòng). Chỉ hỏi Dương khi việc quyết định chức năng quan trọng, đổi quy định đã chốt, hoặc chạm dữ liệu thật / thao tác khó hoàn tác.
4. **Làm liền từ đầu đến cuối.** Gặp chỗ cần Dương quyết thì ghi vào `progress.md` mục "Câu hỏi còn mở", chọn phương án an toàn tạm thời, làm tiếp, báo ở cuối.

### Tiến độ và commit

Mục đích: hết quota giữa chừng thì phiên mới đọc `progress.md` là làm tiếp được ngay.

1. Cập nhật `progress.md` liên tục: ghi kế hoạch trước việc dài; sau mỗi bước nhỏ (một nhóm chức năng, một bộ test pass, một file tài liệu) đánh dấu xong và ghi bước tiếp theo đủ cụ thể (file, hàm, đang dở ở đâu, lệnh test nào fail).
2. Giữ `progress.md` dưới khoảng 80 dòng: trạng thái, xong theo stage, bước tiếp, câu hỏi mở. Lịch sử đã có trong git log.
3. **Commit ngay sau mỗi lần cập nhật `progress.md`**, kèm phần vừa xong.
4. **Push và merge chỉ khi Dương yêu cầu.** Làm trên `dev` (hoặc nhánh tách từ `dev`). Repo `https://github.com/duongidle/SoE_Hub` đang **public**: không commit dữ liệu thật, secret hay `.env`.

## Module và stage

Module sau chỉ dựa vào module trước nên code lần lượt; thiết kế đi trước code ít nhất một module. Module 0–5 là engine.

| Stage | Module (file trong `design/`) | Cần | Nội dung code | Thiết kế | Code |
| --- | --- | --- | --- | --- | --- |
| 0 | M0 `module0-nen-tang.md` + `ha-tang.md` | — | Monorepo, migration, registry, actor, mã lỗi, audit, `row_history`, outbox, worker, file, SSE, OpenAPI, khung test | Đã chốt | Đã xong |
| 1 | M1 `module1-tai-khoan-phan-quyen.md` | 0 | Tài khoản, vai trò, cây tổ chức, đăng nhập, phiên, token, phân quyền, thông báo tối thiểu, nhật ký Admin, chuyển giao | Đã chốt | Đã xong |
| 2 | M2 `module2-datahub.md` | 1 | Datahub, kiểu cột, công thức, view, grid ảo hoá, import/export, thùng rác, lịch sử dòng | Đã chốt | Đã xong |
| 3 | M3 `module3-metric-dashboard.md` | 2 | Engine metric, biểu đồ, dashboard, bảng gộp | Đã chốt | Đã xong |
| 4 | M4 `module4-quan-ly-deal.md` | 2, 3 | 4.1 sửa Stage 2 (mục 19a); template Deals, người tham gia, thanh toán và com theo đợt, chốt kỳ, snapshot, forecast, BANT, dashboard Deals, API ngoài. **Mốc Engine v1** | Đã chốt | Đang làm (4.1 xong; tiếp: Deals/Template) |
| 5 | M5 `module5-ket-noi-ai.md` | 1, 4 | MCP, OAuth + DCR, token, key API của cây, kết nối AI chờ duyệt, nhóm cấm AI, thao tác lớn, Bruno đầy đủ | Đã chốt | |
| 6 | M6 `module6-thong-bao.md` | 1 | Thông báo đầy đủ, nhắc hẹn, nhắc hạn | Nháp | |
| 7 | M7 `module7-dynamic-form.md` | 2, 3, 5, 6 | Builder kéo thả, form công khai, nháp, chấm điểm, nguồn dữ liệu, JSON | Đã chốt | |
| 8 | M8 `module8-knowledge-aihub.md` | 1, 6 | Đăng → kiểm tra → duyệt → xuất bản; Knowledge; AI Hub | Chưa | |
| 9 | M9 `module9-onboarding.md` | 6, 7 | Lộ trình, checklist, bài test, theo dõi | Chưa | |
| 10 | M10 `module10-workspace.md` | 4, 6 | Giao việc | Chưa | |
| 11 | M11 `module11-cai-dat-feedback.md` | trên | Cài đặt còn lại, feedback | Chưa | |
| 12 | — | tất cả | Làm lại giao diện, rà toàn bộ chuẩn giao diện | — | |
| — | Automation | 0, 2, 6 | Module lõi, hoãn; kiến trúc để sẵn chỗ (Module 0 mục 19) | Hoãn | |

**Bước con:** stage lớn chia bước con để giao việc; danh sách và trạng thái ở `progress.md` mục "Đang làm", cột "Code" ở bảng trên ghi bước đang làm. Xong một bước con thì cập nhật cả hai chỗ. **Mọi stage có giao diện kết thúc bằng một bước con kiểm thử riêng** (như 2E), không gộp với bước có code.

**Định nghĩa xong của mỗi stage:**

1. Chức năng đúng thiết kế; mọi lệch hoặc bổ sung đã ghi vào "Quyết định khi code".
2. Test unit và test phân quyền của stage pass; test các stage trước không hỏng.
3. Mọi endpoint mới có trong OpenAPI và có request mẫu trong `docs/api/bruno/`. Từ Stage 6: thao tác mới khai báo menu, `access`, nhóm cấm AI (Module 5 mục 3.5); việc hay làm qua AI có tool chọn lọc.
4. Có giao diện tối thiểu dùng được mọi chức năng của stage.
5. Đã qua kiểm thử cuối stage (`design/kiem-thu.md`): chỉ kiểm lỗi chức năng và số liệu; lỗi tìm thấy đã sửa; kết quả ghi vào `progress.md`.
6. `progress.md` cập nhật; cột "Code" ghi "Đã xong" (Opus ghi sau khi rà đạt); đã commit.

**Kiểm thử theo cấp** (Dương chốt 19/11/2026, sửa 20/11/2026; kiểm thử nặng chỉ chạy một lần mỗi stage):

| Lúc nào | Ai | Chạy gì |
| --- | --- | --- |
| Mỗi bước con | Sonnet | `typecheck`, `lint`, unit test của phần vừa sửa (`pnpm exec vitest run <thư mục/file>`), e2e desktop của **đúng spec bước đó**. Chạm phần dùng chung (`apps/web/src/components/ui`, `RowsStore`, registry, engine công thức, phân quyền, `access.ts`, `rows.ts`) thì chạy thêm unit test của các module dùng phần đó; **không** chạy cả bộ e2e. Không chạy 375px, bộ skill giao diện, `break-ui`. Không chạy hai lệnh vitest song song (chung DB). Ghi vào `progress.md`: lệnh, **mã commit đã chạy test**, số pass/fail/skip (skip đổi so với mốc thì ghi lý do). |
| Rà bước con | Opus | Đọc diff và kết quả test Sonnet ghi, so với thiết kế. **Không chạy lại test Sonnet đã chạy** (Dương chốt 20/11/2026). Chỉ chạy lại khi: (1) có test chập chờn hoặc "fail rồi chạy lại pass"; (2) có commit sửa code sau mã commit đã chạy test (chỉ chạy phần bị ảnh hưởng); (3) số liệu vô lý (thiếu mã commit, số test giảm, skip tăng không giải thích). Chạm phần dùng chung thì **đọc kỹ diff ở chỗ đó** (lộ quyền, sai phạm vi dòng thường không bị test bắt). |
| Kiểm thử cuối stage | Sonnet chạy, Opus điều phối | Toàn bộ `pnpm test` và cả bộ e2e, đi luồng thật theo vai trò, dữ liệu xấu nhất. Chi tiết: `design/kiem-thu.md`. |

**Test chập chờn là lỗi**: tìm nguyên nhân và sửa, không chạy lại tới khi pass, không `skip` (`design/kiem-thu.md` mục 3). **Điện thoại là ưu tiên thấp**: lỗi giao diện chỉ ở 375px không chặn bước con, ghi vào `progress.md` "Lỗi điện thoại để sau"; trừ trang công khai (`design/kiem-thu.md` mục 4).

## Phân vai khi code

Stage 0–1 Opus đã code. Từ Stage 2: **Sonnet** code, test nhanh, kiểm thử cuối stage; **Opus** kiểm soát. Thiết kế module do Opus đề xuất, Dương chốt.

0. **Opus không tự sửa code hay test**, kể cả sửa nhỏ khi rà (Dương nhắc 18/11/2026). Opus chỉ chạy lệnh kiểm tra, ghi lỗi và giao Sonnet sửa. Opus tự viết thiết kế, `CLAUDE.md` và ghi chú điều phối trong `progress.md`.
1. Opus chia stage thành việc nhỏ có tiêu chí nghiệm thu rõ (file, chức năng, test phải có, luồng giao diện phải chạy), rồi giao Sonnet. **Mỗi prompt giao Sonnet ghi rõ:** (a) `CLAUDE.md` đã nạp sẵn, không Read lại; đọc `progress.md` và file thiết kế liên quan (thêm `design/chuan-giao-dien.md` nếu có giao diện, `design/quy-dinh-chung.md` nếu chạm phân quyền/chia sẻ/Deal/AI); chỉ chạy test theo "Kiểm thử theo cấp"; (b) sau mỗi bước nhỏ cập nhật `progress.md` và **commit ngay**; (c) không push.
2. Opus rà theo "Kiểm thử theo cấp", phản biện và yêu cầu sửa khi chưa đạt; chỉ đánh dấu xong khi đạt "Định nghĩa xong".
3. Sonnet không tự đổi quy định đã chốt; chỗ thiết kế chưa rõ thì hỏi Opus. Opus tự quyết chi tiết nhỏ, chỉ hỏi Dương việc quan trọng.
4. **Sửa quá 5 vòng chưa xong thì dừng, báo Opus.** Một vòng là một lần sửa rồi chạy lại mà cùng lỗi vẫn còn (đổi dạng nhưng cùng chỗ vẫn tính). Báo: lỗi, cách tái hiện, lệnh fail; 5 cách đã thử và vì sao không ăn; giả thuyết nguyên nhân, file, hàm. Opus tìm nguyên nhân gốc và hướng dẫn sửa tận gốc; đòi đổi quy định đã chốt thì Opus hỏi Dương.
5. **Sửa tận gốc, không chắp vá.** Một số liệu chỉ có một nơi tính (engine/command ở server); UI, export, API, MCP, dashboard chỉ đọc kết quả đó. Lỗi số liệu sửa ở nơi tính. Cấm: điều kiện riêng cho một màn hình/bảng/người; gán cứng, làm tròn hay định dạng lại để "khớp số"; sửa test cho khớp kết quả sai, bỏ qua hoặc tắt test; nuốt lỗi (`try/catch` im lặng, giá trị mặc định che lỗi). Sửa xong phải có test tái hiện đúng lỗi, và kiểm lại mọi nơi dùng chung giá trị ấy (grid, export, API, dashboard, MCP).

REST API sinh từ registry từ Stage 0, nên mỗi stage tự có API; Stage 5 chỉ thêm MCP và quản lý kết nối AI.

## Lưu ý

- Golden test đọc thẳng file trong `examples/` trên máy để so số với Excel; máy không có file thì test tự bỏ qua (Dương đồng ý 18/11/2026).
- Hạ tầng, chi phí và việc đứng tên server do Dương lo; thiết kế chỉ cần ghi rõ yêu cầu.

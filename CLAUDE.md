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
| `design/update_v1.md` | Phần thiết kế đã chốt nhưng dời khi rà phạm vi stage; làm thành update đầu tiên sau phiên bản đầu (Dương chốt 22/11/2026). Mỗi lần dời thì ghi vào đây |
| `design/stage12.md` | Việc giao diện Dương nêu khi dùng thử, gom để Stage 12 làm một lượt. Mỗi lần dời việc giao diện sang Stage 12 thì ghi vào đây |
| `design/kinh-nghiem-quyet-dinh.md` | Kinh nghiệm ra quyết định (tiết kiệm token, gọn, linh hoạt): đọc trước khi thiết kế module và trước khi giao mỗi bước con |
| `design/kiem-thu.md` | Chi tiết kiểm thử cuối stage, test chập chờn, điện thoại |
| `design/chua-ro-nguyen-nhan.md` | Lỗi chưa tái hiện, chưa rõ nguyên nhân: đã gác (Dương 28/11/2026), không xử lý tiếp. Thấy lại thì ghi thêm vào đây |
| `design/chuan-giao-dien.md` | Chuẩn giao diện. Đọc khi code hoặc rà giao diện; việc chỉ đụng server thì không cần |
| `design/ha-tang.md` | Hạ tầng triển khai |
| `docs/` | OpenAPI, bộ Bruno (`docs/api/bruno/`), hướng dẫn kết nối AI (`docs/ket-noi-ai.md`) |
| `design/ban-do-code.md` | Bản đồ code từng module: chỗ gọi vào, mẫu làm theo, luật cấm. Agent đọc đúng mục module cần, thay cho dò code |
| `progress.md` | Trạng thái và tiến độ hiện tại |

## Quy trình làm việc

### Bắt đầu mỗi phiên

**Máy mới, chưa cài gì** (không có `node_modules`, `pnpm` hay Postgres): cài theo `README.md` mục "Cài máy mới từ đầu" trước, rồi mới làm việc.

`CLAUDE.md` được nạp sẵn vào mọi phiên, kể cả agent con: không Read lại, trừ khi hội thoại đã bị tóm tắt hoặc không thấy nó trong ngữ cảnh. Việc đầu tiên của mọi agent là đọc `progress.md`; không dựa vào trí nhớ hay bản tóm tắt. Khi code một stage, đọc thêm file thiết kế của module đó. Không cần đọc lại phiên cũ.

### Thiết kế

0. **Trước khi thiết kế một module mới, đọc lại toàn bộ `design/`** (mọi module trước, `quy-dinh-chung.md`, `ha-tang.md`, kể cả quyết định khi code). Đề xuất mới phải khớp với những gì đã chốt; chỗ nào đổi quy định cũ thì nói rõ là đổi, lý do, ảnh hưởng tới module nào. _Lý do:_ các module dùng chung engine (Datahub, phân quyền, công thức, nhật ký).
1. **Thiết kế theo vòng:** Claude đề xuất trong chat → Dương phản biện → chốt → Claude ghi `design/moduleX-<ten>.md`, kèm `Đã chốt` và ngày ở đầu file.
2. **Phản biện thật.** Ý tưởng hay giả định yếu thì nói thẳng, kèm lý do và phương án tốt hơn.
3. Quyết định mới chốt trong chat thì ghi vào file thiết kế của module đó, và vào `design/quy-dinh-chung.md` nếu ảnh hưởng nhiều module.
4. **Mặc định lấy từ file mẫu, không tự chế.** Template, cột, danh sách lựa chọn, lộ trình mẫu… mặc định bắt đầu từ file mẫu trong `examples/`, giữ nguyên tên và giá trị, ghi rõ nguồn (file, sheet, cột). Cái hệ thống cần thêm để ở danh sách riêng "Thêm vì hệ thống cần", kèm lý do. Không có file mẫu thì hỏi Dương. _Lý do:_ 18/11/2026 Dương gạt bản nháp Module 4 vì template Deals tự chế.
5. **Rà thiết kế trước khi code** (Dương chốt 22/11/2026): trước khi chốt thiết kế module và trước khi giao mỗi bước con, Opus đọc `design/kinh-nghiem-quyet-dinh.md`, áp từng nguyên tắc lên phạm vi, rồi đưa Dương đề xuất giữ, cắt, gộp hay dời, kèm ước token. Dương chốt rồi mới giao.

### Code

1. **Chỉ code module đã có thiết kế `Đã chốt`**, theo thứ tự stage; không cần chờ lệnh riêng.
2. **Engine trước, giao diện sau.** Giao diện mỗi stage đủ dùng, đủ xem; vẫn theo `design/chuan-giao-dien.md` (token, thành phần chung, wording) nhưng **không rà chuẩn giao diện** ở Stage 2–11: Stage 12 làm lại giao diện và rà toàn bộ. Không còn ngoại lệ (Dương đổi 22/11/2026): Dynamic Form (Stage 7) và Onboarding (Stage 9) chỉ cần chức năng chắc chắn chạy và các màn chính hiển thị ổn định ở máy tính và 375px (Module 7 mục 14, Module 9 mục 7).
3. **Tự quyết chi tiết nhỏ** (đặt tên, cấu trúc file, thư viện phụ, xử lý lỗi, giá trị mặc định; Sonnet chỉ phần không đổi kết quả người dùng thấy, xem "Phân vai khi code" mục 3) và ghi vào mục "Quyết định khi code" của module (file `moduleX-quyet-dinh-khi-code.md` khi dài quá khoảng 100 dòng). Chỉ hỏi Dương khi việc quyết định chức năng quan trọng, đổi quy định đã chốt, hoặc chạm dữ liệu thật / thao tác khó hoàn tác.
4. **Làm liền từ đầu đến cuối.** Sonnet gặp chỗ chưa có quyết định thì dừng báo Opus ("Phân vai khi code" mục 3). Opus gặp việc cần Dương quyết thì ghi vào `progress.md` mục "Câu hỏi còn mở", chọn phương án an toàn tạm thời nếu việc đó không chặn phần còn lại, làm tiếp, báo ở cuối.

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
| 4 | M4 `module4-quan-ly-deal.md` | 2, 3 | 4.1 sửa Stage 2 (mục 19a); template Deals, người tham gia, thanh toán và com theo đợt, chốt kỳ, snapshot, forecast, BANT, dashboard Deals, API ngoài. **Mốc Engine v1** | Đã chốt | Đã xong |
| 5 | M5 `module5-ket-noi-ai.md` | 1, 4 | MCP, OAuth + DCR, token, key API của cây, kết nối AI chờ duyệt, nhóm cấm AI, thao tác lớn, Bruno đầy đủ | Đã chốt | Đã xong (bản rút gọn mục 12) |
| 6 | M6 `module6-thong-bao.md` | 1, 2, 4 | Thông báo đầy đủ (một cửa vào `notify`), Web Push, nhắc hẹn, nhắc hạn Deal, bản tin buổi sáng, thông báo chung | Đã chốt | Đã xong (bản rút gọn mục 14) |
| 7 | M7 `module7-dynamic-form.md` | 2, 3, 5, 6 | Builder kéo thả, form công khai, nháp, chấm điểm, nguồn dữ liệu, JSON | Đã chốt | Đã xong (bản rút gọn mục 14) |
| 8 | M8 `module8-knowledge-aihub.md` | 1, 5, 6 | Đăng → kiểm tra → duyệt → xuất bản; Knowledge; AI Hub | Đã chốt | Đã xong |
| 9 | M9 `module9-onboarding.md` | 1, 2, 3, 5, 6, 7 | Lộ trình, checkpoint bằng engine chỉ số, bài test và form, theo dõi chung | Đã chốt | Đã xong |
| 10 | M10 `module10-workspace.md` | 4, 6 | Giao việc | Chưa | |
| 11 | M11 `module11-cai-dat-feedback.md` | 0, 1, 5, 6, 12 | Feedback (nút "?", hộp Admin), trang Phân quyền bổ sung. **Code trước Stage 10** (Dương 28/11) | Đã chốt | |
| 12 | M12 `module12-giao-dien.md` | tất cả | Làm lại giao diện theo concept Luminous Bento, rà toàn bộ chuẩn giao diện | Đã chốt | Đã xong |
| — | Automation | 0, 2, 6 | Module lõi, hoãn; kiến trúc để sẵn chỗ (Module 0 mục 19) | Hoãn | |

**Bước con:** stage lớn chia bước con để giao việc. **Chia bước con to** (Dương chốt 20/11/2026): mỗi bước con là một khối chức năng trọn vẹn, làm bằng hai agent Sonnet (mục "Phân vai khi code"), không chia nhỏ theo từng màn hay từng lệnh; mỗi lần giao là một lần Sonnet đọc lại từ đầu. danh sách và trạng thái ở `progress.md` mục "Đang làm", cột "Code" ở bảng trên ghi bước đang làm. Xong một bước con thì cập nhật cả hai chỗ. **Mọi stage có giao diện kết thúc bằng một bước con kiểm thử riêng** (như 2E), không gộp với bước có code.

**Định nghĩa xong của mỗi stage:**

1. Chức năng đúng thiết kế; mọi lệch hoặc bổ sung đã ghi vào "Quyết định khi code".
2. Test unit và test phân quyền của stage pass; test các stage trước không hỏng.
3. Mọi endpoint mới có trong OpenAPI (tự sinh ở mỗi bước con) và có request mẫu trong `docs/api/bruno/` (gom làm một lần ở bước kiểm thử cuối stage, Dương chốt 22/11/2026). Từ Stage 6: thao tác mới khai báo menu, `access`, nhóm cấm AI (Module 5 mục 3.5); việc hay làm qua AI có tool chọn lọc.
4. Có giao diện tối thiểu dùng được mọi chức năng của stage.
5. Đã qua kiểm thử cuối stage (`design/kiem-thu.md`): chỉ kiểm lỗi chức năng và số liệu; lỗi tìm thấy đã sửa; kết quả ghi vào `progress.md`.
6. Mục của module trong `design/ban-do-code.md` đủ và đúng. Mỗi bước con cập nhật phần của mình trong cùng commit với code, lúc code còn trong ngữ cảnh, không dồn tới cuối stage.
7. `progress.md` cập nhật; cột "Code" ghi "Đã xong" (Opus ghi sau khi rà đạt); đã commit.

**Kiểm thử theo cấp** (Dương chốt 19/11/2026, sửa 20/11 và 22/11/2026; kiểm thử nặng chỉ chạy một lần mỗi stage). Lý do giảm ngày 22/11: Stage 4 mỗi bước con mất tới 200 phút, phần lớn là chờ test và chạy cả bộ để thử từng giả thuyết. Giữ những lớp kiểm rẻ mà bắt lỗi nặng (quyền, tiền com, hồi quy engine), bỏ lớp trùng.

| Lúc nào | Ai | Chạy gì |
| --- | --- | --- |
| Mỗi bước con | Sonnet | `typecheck`, `lint`, unit test của phần vừa sửa (`pnpm exec vitest run <thư mục/file>`), e2e desktop của **đúng spec bước đó** (áp cho từng phần nhỏ trong bước con). Chạm phần dùng chung (`apps/web/src/components/ui`, `RowsStore`, registry, engine công thức, phân quyền, `access.ts`, `rows.ts`) thì chạy thêm unit test của các module dùng phần đó; **không** chạy cả bộ e2e. Không chạy 375px, bộ skill giao diện, `break-ui`. Không chạy hai lệnh vitest song song (chung DB). Chạy cả bộ bằng một lệnh chạy hết rồi in tổng kết; không viết vòng chờ hỏi file kết quả (mỗi lượt hỏi đọc lại cả ngữ cảnh). Lệnh test cả bộ chạy foreground với `timeout` đủ dài (Bash `timeout` 900000 ms), không bật chạy nền: chạy nền là thứ khiến agent viết vòng chờ. Ghi vào `progress.md`: lệnh, **mã commit đã chạy test**, số pass/fail/skip (skip đổi so với mốc thì ghi lý do). |
| Kết thúc mỗi bước con | Sonnet | Một lần: toàn bộ `pnpm exec vitest run apps packages` (khoảng 3 phút), và e2e desktop của **các spec liên quan** tới phần đã sửa (spec của bước con, spec của màn hoặc module bị chạm). **Không** chạy cả bộ e2e: để tới kiểm thử cuối stage (Dương chốt 22/11/2026, thay quy định 20/11). Ghi mã commit và số pass/fail/skip vào `progress.md`. |
| Rà bước con | Opus | Đọc diff và kết quả test Sonnet ghi, so với thiết kế. **Không chạy lại test Sonnet đã chạy** (Dương chốt 20/11/2026). Chỉ chạy lại khi: (1) có test chập chờn hoặc "fail rồi chạy lại pass": chạy lại đúng phần đó; (2) có commit sửa **code** sau mã commit đã chạy test: chỉ chạy phần bị ảnh hưởng (commit chỉ sửa tài liệu hay `progress.md` thì không chạy); (3) số liệu vô lý (thiếu mã commit, số test giảm, skip tăng không giải thích). Chạm phần dùng chung thì **đọc kỹ diff ở chỗ đó** (lộ quyền, sai phạm vi dòng thường không bị test bắt) và grep nơi gọi của hàm dùng chung bị đổi để kiểm Sonnet không sót. |
| Kiểm thử cuối stage | Sonnet chạy, Opus điều phối | Toàn bộ `pnpm test` và cả bộ e2e, đi luồng thật theo vai trò, dữ liệu xấu nhất. Chi tiết: `design/kiem-thu.md`. |

**Sửa chỉ giao diện test tối giản** (Dương chốt 28/11/2026, siết cùng ngày): chỉ `typecheck`, `lint` và tự xem ảnh chụp. Không chạy e2e, trừ khi đổi selector hay hành vi mà một spec chắc chắn dùng: khi đó chạy đúng spec đó một lần. Không chạy vitest trừ khi đổi logic. E2e còn lại dồn tới lần kiểm thử cuối stage kế tiếp.

**Việc nhỏ test nhanh** (Dương chốt 27/11/2026): việc nhỏ (sửa một lỗi, một chỗ, ước dưới khoảng 10M token) chỉ chạy `typecheck`, `lint`, unit test của file/module vừa sửa và test tái hiện lỗi; e2e chỉ đúng spec của màn bị chạm, nếu có. Không chạy cả bộ vitest hay e2e: bước con hoặc kiểm thử cuối stage kế tiếp sẽ chạy. Ghi lệnh và mã commit vào `progress.md` như thường.

**Test chập chờn là lỗi**: tìm nguyên nhân và sửa, không chạy lại tới khi pass, không `skip` (`design/kiem-thu.md` mục 3). Tái hiện bằng **chạy lặp đúng chỗ** (nhóm file chạy trước file lỗi, `--repeat-each`), không chạy cả bộ để thử từng giả thuyết. Sửa xong chạy cả bộ **một lần** để xác nhận (Dương chốt 22/11/2026). **Điện thoại là ưu tiên thấp**: lỗi giao diện chỉ ở 375px không chặn bước con, ghi vào `progress.md` "Lỗi điện thoại để sau"; trừ trang công khai (`design/kiem-thu.md` mục 4).

## Phân vai khi code

Stage 0–1 Opus đã code. Từ Stage 2: **Sonnet** code, test nhanh, kiểm thử cuối stage; **Opus** kiểm soát. Thiết kế module do Opus đề xuất, Dương chốt.

0. **Opus không tự sửa code hay test**, kể cả sửa nhỏ khi rà (Dương nhắc 18/11/2026). Opus chỉ chạy lệnh kiểm tra, ghi lỗi và giao Sonnet sửa. Opus tự viết thiết kế, `CLAUDE.md` và ghi chú điều phối trong `progress.md`.
1. **Opus điều khiển, Sonnet không tự đọc lại từ đầu** (Dương chốt 20/11/2026). Opus đọc thiết kế và **tra cứu nhẹ** code (grep tên hàm/bảng/lệnh, chữ ký hàm, vài dòng quanh đó, một chỗ mẫu tương tự) để chỉ đúng file và hàm cần sửa, **không đọc toàn bộ code** (token Opus đắt hơn); phần đọc sâu để viết code là của Sonnet. Rồi giao Sonnet đúng phần cần làm. Mỗi bước con có tiêu chí nghiệm thu rõ (chức năng, test phải có, luồng giao diện phải chạy). **Mỗi prompt giao Sonnet ghi rõ:**
   - (a) **Đọc gì:** `CLAUDE.md` đã nạp sẵn, không Read lại; `progress.md`; **đúng các mục** của file thiết kế cần cho việc (ví dụ "Module 4 mục 3.5–3.8, 4.5"), không đọc cả file; `design/chuan-giao-dien.md` chỉ khi có giao diện, `design/quy-dinh-chung.md` chỉ khi chạm phân quyền/chia sẻ/Deal/AI.
   - (b) **Sửa ở đâu:** file, hàm, bảng/migration cần đụng và chỗ tương tự đã có để làm theo (ví dụ "theo mẫu `template-ops.ts` `createTemplate`"), để Sonnet không phải dò code. Danh sách là **điểm bắt đầu, không phải giới hạn**: Sonnet đọc thêm khi cần. Đổi chữ ký hoặc hành vi của hàm/kiểu dùng chung thì Sonnet **bắt buộc grep mọi nơi gọi** và kiểm từng chỗ. Sửa lỗi thì lần theo tự do tới nguyên nhân gốc.
   - (c) **Chạy test gì:** đúng lệnh test, và **chỉ in dòng tổng kết và dòng lỗi** (ví dụ `pnpm exec vitest run <file> 2>&1 | grep -E "Test Files|Tests |FAIL|Error" | head -40`; e2e lọc `passed|failed|flaky|✘`). Chỉ mở output đầy đủ của đúng test đang fail.
   - (d) Sau mỗi bước nhỏ cập nhật `progress.md` và **commit ngay**; không push.

   **Mỗi bước con hai agent Sonnet** (Dương chốt 21/11/2026). Lý do: token chủ yếu là đọc lại ngữ cảnh, nên một agent chạy dài đắt dần. Ví dụ 4.2 một agent hết 61M; tách đôi ước khoảng 35–40M.
   - Ranh giới do Opus chọn lúc lập kế hoạch và ghi vào `progress.md`. Bước có giao diện tách nửa A (server: lệnh, migration, unit test, OpenAPI, Bruno) và nửa B (web, e2e). Bước chỉ có server tách sau phần chạm engine dùng chung.
   - Agent A kết thúc bằng bản bàn giao trong `progress.md` (đã xong, phần còn lại kèm file/hàm, lệnh và dữ liệu trả về, chỗ dở), đủ để agent B không đọc lại code của nửa A.
   - Agent B chạy cả bộ test cuối bước con.
   - Trong một nửa, Opus giữ cùng agent và chỉnh hướng hay yêu cầu sửa bằng SendMessage.
   - Hết quota giữa chừng thì phiên sau tạo agent mới làm tiếp từ `progress.md`, không cố chạy tiếp agent cũ.
   - Mọi agent đọc file theo đoạn cần thiết (grep, `sed -n`), không đọc cả file lớn; không đọc file sinh tự động (`packages/db/drizzle/meta/`, OpenAPI sinh ra).
   - **Bản đồ code** (Dương chốt 21/11/2026): prompt giao việc chỉ đúng mục của `design/ban-do-code.md` cần đọc, thay cho việc dò code. Quy định dùng và sửa bản đồ ghi ở đầu file đó.
2. Opus rà theo "Kiểm thử theo cấp", phản biện và yêu cầu sửa khi chưa đạt; chỉ đánh dấu xong khi đạt "Định nghĩa xong".
3. **Sonnet dừng và báo Opus, Opus quyết** (Dương chốt 22/11/2026, học từ Kinh Bang). Lý do: Sonnet tự chọn ở chỗ thiết kế trống từng ra số sai, ví dụ "Com của tôi" của Leader cộng cả team (4.6A).
   - **Sonnet tự quyết** chỉ chi tiết kỹ thuật không đổi kết quả người dùng thấy: đặt tên, cấu trúc file, helper nội bộ, thư viện phụ, câu chữ thông báo lỗi.
   - **Sonnet dừng và báo Opus**, không tự chọn, khi gặp một trong các trường hợp:
     - quyết định mà thiết kế, `progress.md`, file quyết định khi code và bản đồ chưa có, và nó đổi số liệu, quyền, luồng dùng, hay dữ liệu lưu;
     - test hỏng mà nguyên nhân chưa rõ;
     - muốn sửa test, ngưỡng hay thời gian chờ để test qua;
     - phải đổi quy định đã chốt, hoặc đổi hành vi của phần dùng chung theo cách thiết kế chưa nói.
   - **Cách dừng:** commit phần đã xong (nếu typecheck sạch), ghi câu hỏi vào báo lại. Câu hỏi kèm: các phương án, phương án Sonnet nghiêng về và vì sao, ảnh hưởng của từng phương án. Rồi kết thúc lượt. Còn việc độc lập với câu hỏi thì làm tiếp trước khi dừng.
   - **Opus quyết** rồi trả lời bằng SendMessage cho chính agent đó (agent giữ ngữ cảnh). Quyết định ghi vào file quyết định khi code của module.
   - **Opus chỉ hỏi Dương** việc quan trọng: chức năng hay cách tính tiền mà người dùng thấy và thiết kế chưa nói, đổi quy định đã chốt, chạm dữ liệu thật hay thao tác khó hoàn tác, chi phí và hạ tầng. Việc còn lại Opus tự quyết và ghi lại.
   - Prompt giao việc chép nguyên mục này.
4. **Sửa quá 5 vòng chưa xong thì dừng, báo Opus.** Một vòng là một lần sửa rồi chạy lại mà cùng lỗi vẫn còn (đổi dạng nhưng cùng chỗ vẫn tính). Báo: lỗi, cách tái hiện, lệnh fail; 5 cách đã thử và vì sao không ăn; giả thuyết nguyên nhân, file, hàm. Opus tìm nguyên nhân gốc và hướng dẫn sửa tận gốc; đòi đổi quy định đã chốt thì Opus hỏi Dương.
5. **Sửa tận gốc, không chắp vá.** Một số liệu chỉ có một nơi tính (engine/command ở server); UI, export, API, MCP, dashboard chỉ đọc kết quả đó. Lỗi số liệu sửa ở nơi tính. Cấm: điều kiện riêng cho một màn hình/bảng/người; gán cứng, làm tròn hay định dạng lại để "khớp số"; sửa test cho khớp kết quả sai, bỏ qua hoặc tắt test; nuốt lỗi (`try/catch` im lặng, giá trị mặc định che lỗi). Sửa xong phải có test tái hiện đúng lỗi, và kiểm lại mọi nơi dùng chung giá trị ấy (grid, export, API, dashboard, MCP).

REST API sinh từ registry từ Stage 0, nên mỗi stage tự có API; Stage 5 chỉ thêm MCP và quản lý kết nối AI.

## Lưu ý

- Golden test đọc thẳng file trong `examples/` trên máy để so số với Excel; máy không có file thì test tự bỏ qua (Dương đồng ý 18/11/2026).
- Hạ tầng, chi phí và việc đứng tên server do Dương lo; thiết kế chỉ cần ghi rõ yêu cầu.

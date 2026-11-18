# CLAUDE.md — SoE Hub

SoE Hub là nơi làm việc chung cho team SoE của Base: quản lý deal và chỉ số, Datahub, dashboard, form, onboarding, knowledge, AI Hub, giao việc. Hệ thống được dựng theo mong muốn của team SoE và yêu cầu của ban lãnh đạo.

Quy mô: 15–20 người dùng thường xuyên, nhiều người dùng thỉnh thoảng (sale, bộ phận Data). Bảng Deals > 10.000 dòng và còn tăng.

## Bản đồ thư mục

| Đường dẫn     | Nội dung                                                                                                                                                                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `promt.md`    | Brief gốc của Dương. Chỉ đọc                                                                                                                                                                                                                          |
| `examples/`   | File mẫu chứa **dữ liệu thật của Base** (deal, com, onboarding, chính sách). **Mọi agent được đọc tự do, lúc nào cũng được** (Dương cho phép 18/11/2026). Không sửa. **Không bao giờ commit** file hay dữ liệu lấy từ đây (đã nằm trong `.gitignore`) |
| `design/`     | Thiết kế đã chốt: `moduleX-<ten>.md`, `ha-tang.md`                                                                                                                                                                                                    |
| `progress.md` | Trạng thái và tiến độ hiện tại                                                                                                                                                                                                                        |
| `CLAUDE.md`   | File này                                                                                                                                                                                                                                              |

## Quy trình làm việc

### Bắt đầu mỗi phiên

**Đọc `CLAUDE.md` trước khi làm bất cứ việc gì, rồi đọc `progress.md`.** Áp dụng cho mọi agent: Opus, Sonnet và mọi agent được giao việc; không được dựa vào trí nhớ hay bản tóm tắt của file này. Khi code một stage, đọc thêm file thiết kế của module thuộc stage đó. Không cần đọc lại phiên cũ.

### Thiết kế

0. **Trước khi thiết kế một module mới, đọc lại toàn bộ các file thiết kế đã có trong `design/`** (mọi module trước đó, `ha-tang.md`, kể cả mục "Quyết định khi code"), không dựa vào trí nhớ hay bản tóm tắt. Đề xuất mới phải khớp với những gì đã chốt; chỗ nào cần đổi quy định cũ thì nói rõ là đổi, lý do, và ảnh hưởng tới module nào. _Lý do:_ các module dùng chung engine (Datahub, phân quyền, công thức, nhật ký), một đề xuất lệch với quy định cũ sẽ gây mâu thuẫn khi code.
1. **Thiết kế từng module theo vòng:** Claude phân tích và đề xuất trong chat → Dương phản biện → chốt → Claude ghi `design/moduleX-<ten>.md`, kèm trạng thái `Đã chốt` và ngày ở đầu file.
2. **Phản biện thật.** Ý tưởng hay giả định yếu thì nói thẳng, kèm lý do và phương án tốt hơn. Không đồng ý cho xong.
3. Một quyết định mới được chốt trong chat thì ghi vào đúng file thiết kế của module đó, và vào mục "Quy định đã chốt" bên dưới nếu nó ảnh hưởng nhiều module.

### Code

1. **Chỉ code module đã có file thiết kế `Đã chốt`.** Với module đó, code tự do theo thứ tự stage ở mục "Stage code"; không cần chờ lệnh riêng. Module chưa chốt thiết kế thì không code.
2. **Engine trước, giao diện sau.** Giao diện của mỗi stage chỉ cần đủ dùng, đủ xem; có stage làm đẹp riêng ở cuối. "Đủ dùng" vẫn phải đạt mục "Chuẩn giao diện" bên dưới ngay từ stage đó; Stage 12 chỉ lo thẩm mỹ và chuyển động, không phải chỗ sửa font, độ tương phản, wording.
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

| #   | File                                 | Nội dung                                                                             | Trạng thái |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------ | ---------- |
| 0   | `module0-nen-tang.md` + `ha-tang.md` | Kiến trúc, stack, quy ước, audit, khoá kỳ, sự kiện, hạ tầng                          | Đã chốt    |
| 1   | `module1-tai-khoan-phan-quyen.md`    | Tài khoản, vai trò, cây tổ chức, cấp dữ liệu, token                                  | Đã chốt    |
| 2   | `module2-datahub.md`                 | Lưu trữ, kiểu cột, công thức, lịch sử, import/export                                 | Đã chốt    |
| 3   | `module3-metric-dashboard.md`        | Định nghĩa chỉ số, biểu đồ, bảng gộp                                                 | Đã chốt    |
| 4   | `module4-quan-ly-deal.md`            | Template Deals, người tham gia, chính sách/com, forecast, BANT                       | Chưa       |
| 5   | `module5-ket-noi-ai.md`              | REST, MCP, quản lý kết nối AI                                                        | Chưa       |
| 6   | `module6-thong-bao.md`               | Thông báo, nhắc hẹn, nhắc hạn                                                        | Chưa       |
| 7   | `module7-dynamic-form.md`            | Form kéo thả, bài test, khảo sát                                                     | Chưa       |
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
| 2     | M2         | 1                | Datahub, bảng, kiểu cột, engine công thức, lọc/sắp xếp/view, grid ảo hoá, import/export, thùng rác, lịch sử dòng                                                                                         | Dùng Datahub thay Google Sheet                                      |            |
| 3     | M3         | 2                | Engine metric, các loại biểu đồ, dashboard tuỳ chỉnh                                                                                                                                                     | Vẽ dashboard từ Datahub                                             |            |
| 4     | M4         | 2, 3             | Template Deals, người tham gia, ba loại cột, chính sách com có phiên bản, khoá kỳ, snapshot, forecast, BANT, dashboard Deals mặc định, API cho hệ thống ngoài                                            | **Mốc Engine v1: team SoE chạy thử quản lý deal**                   |            |
| 5     | M5         | 1, 4             | MCP server, OAuth + DCR, token cá nhân, kết nối AI chờ duyệt, scope theo menu, hướng dẫn kết nối, bộ Bruno đầy đủ                                                                                        | Claude/Codex điều khiển được hệ thống                               |            |
| 6     | M6         | 1                | Thông báo đầy đủ, nhắc hẹn, nhắc hạn, quy tắc gửi                                                                                                                                                        |                                                                     |            |
| 7     | M7         | 2                | Dynamic Form: builder kéo thả, renderer công khai, lưu nháp, chấm điểm, JSON import/export                                                                                                               |                                                                     |            |
| 8     | M8         | 1, 6             | Engine đăng → kiểm tra → duyệt → xuất bản; Knowledge; AI Hub                                                                                                                                             |                                                                     |            |
| 9     | M9         | 6, 7             | Onboarding: lộ trình, checklist, bài test, theo dõi, template mẫu                                                                                                                                        |                                                                     |            |
| 10    | M10        | 4, 6             | Workspace giao việc                                                                                                                                                                                      |                                                                     |            |
| 11    | M11        | các module trên  | Cài đặt còn lại, feedback                                                                                                                                                                                |                                                                     |            |
| 12    | —          | tất cả           | Làm đẹp giao diện                                                                                                                                                                                        |                                                                     |            |
| —     | Automation | 0, 2, 6          | Chưa thiết kế                                                                                                                                                                                            |                                                                     |            |

**Định nghĩa xong của mỗi stage:**

1. Chức năng đúng theo file thiết kế; mọi lệch hoặc bổ sung đã ghi vào mục "Quyết định khi code" của file đó.
2. Test unit và test phân quyền của stage đều pass; test của các stage trước không bị hỏng.
3. Mọi endpoint mới có trong OpenAPI và có request mẫu trong `docs/api/bruno/`.
4. Có giao diện tối thiểu để dùng, đạt mục "Chuẩn giao diện".
5. **Đã kiểm thử giao diện thực tế** (với stage có giao diện): chạy api + worker + web thật, mở trên trình duyệt thật (Playwright có chụp màn hình, hoặc Claude in Chrome), đi hết các luồng chính của stage với từng vai trò liên quan, kiểm tra không có lỗi console/network, kiểm tra ở bề ngang desktop (1280px) và điện thoại (375px; bắt buộc với trang công khai như form), dò hết danh sách kiểm tra ở mục "Chuẩn giao diện", chạy phần bắt buộc của từng skill trong bảng "Dùng skill nào, lúc nào", và thử dữ liệu xấu nhất theo quy trình `break-ui` (tên rất dài, số rất lớn, danh sách rỗng, 10.000 dòng). Lỗi tìm thấy phải sửa xong mới coi là xong. Ghi kết quả kiểm thử (luồng đã đi, lỗi đã sửa) vào `progress.md`.
6. `progress.md` đã cập nhật, đã commit.

## Phân vai khi code

| Stage    | Ai code                                                   | Ai kiểm soát |
| -------- | --------------------------------------------------------- | ------------ |
| 0–1      | Opus (đã làm)                                             | Opus         |
| 2 trở đi | **Sonnet** code và tự kiểm thử (test + giao diện thực tế) | **Opus**     |

Thiết kế module vẫn do Opus đề xuất và Dương chốt. Từ Stage 2, Opus là người kiểm soát:

0. **Opus không tự sửa code hay test**, kể cả sửa nhỏ phát hiện khi rà soát (Dương nhắc 18/11/2026). Opus chỉ chạy lệnh để kiểm tra (git, test, lint, typecheck), ghi lỗi và giao Sonnet sửa. Opus vẫn tự viết thiết kế, `CLAUDE.md` và ghi chú điều phối trong `progress.md`.
1. Đọc thiết kế, chia stage thành các việc nhỏ có tiêu chí nghiệm thu rõ ràng (file nào, chức năng gì, test nào phải có, luồng giao diện nào phải chạy được), rồi giao từng việc cho Sonnet.
   **Mỗi prompt giao cho Sonnet phải ghi rõ:** (a) đọc `CLAUDE.md` trước khi làm bất cứ việc gì, rồi `progress.md` và file thiết kế liên quan; (b) **sau mỗi bước nhỏ** (một nhóm chức năng, một bộ test pass, một file tài liệu) thì cập nhật `progress.md` (đánh dấu xong, ghi bước tiếp theo cụ thể) và **commit ngay**, không đợi xong cả việc, để hết quota giữa chừng không mất gì; (c) không push.
2. Rà soát kết quả của Sonnet: đọc diff, chạy test, kiểm tra giao diện; đánh giá so với thiết kế và tiêu chí.
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

Theo `promt.md` mục 17: trực quan, dễ thao tác là ưu tiên; font thống nhất, tương phản, sizing chuẩn production; wording gọn, không giọng AI. Áp dụng cho mọi stage có giao diện, không đợi Stage 12.

SoE Hub là công cụ làm việc (bảng, dashboard, form): ưu tiên dễ quét, nhất quán, quen tay. Không trang trí lạ mắt. Chỉ Knowledge, AI Hub và form công khai được đầu tư thẩm mỹ nhiều hơn ở Stage 12.

Mục này gồm hai phần: **quy định** từ mục "Hệ thống thiết kế" trở xuống (luôn áp dụng), và **bộ skill giao diện** để làm và kiểm thử theo quy trình của chúng. Hai bên mâu thuẫn thì quy định trong `CLAUDE.md` thắng.

### Bộ skill giao diện (bắt buộc cài)

Agent nào làm hoặc rà soát giao diện (Sonnet code, Opus kiểm soát) phải có đủ 6 skill dưới đây. Đầu phiên, kiểm tra `~/.claude/skills/<tên>/SKILL.md`; thiếu skill nào thì chạy lệnh cài bên dưới trước khi làm giao diện. Lệnh cài đúng phiên bản đã dùng cho dự án, chỉ cài skill còn thiếu, không ghi đè skill đã có. Cài xong thì đọc thẳng file `SKILL.md` là dùng được ngay; lệnh gọi skill (`/tên-skill`) chỉ có từ phiên sau. Máy không có mạng hoặc cài lỗi thì ghi vào `progress.md`, làm theo quy định trong file này, và báo Opus.

```bash
set -e
DEST="${DEST:-$HOME/.claude/skills}"; TMP="$(mktemp -d)"; mkdir -p "$DEST"
get() { git init -q "$TMP/$3" && git -C "$TMP/$3" fetch -q --depth 1 "https://github.com/$1" "$2" && git -C "$TMP/$3" checkout -q FETCH_HEAD; }
get emilkowalski/skills                  c8a79627b59d72d764d6ab6f2c87c09a48169833 emil
get pbakaus/impeccable                   687bc381bc9091bf252c0a05303640561014a425 imp
get nextlevelbuilder/ui-ux-pro-max-skill 0da327f37b436c173ce51177678b65ca92e6f3f7 uux
for s in emil-design-eng break-ui mobile-native; do [ -d "$DEST/$s" ] || cp -R "$TMP/emil/skills/$s" "$DEST/"; done
[ -d "$DEST/impeccable" ] || cp -R "$TMP/imp/.claude/skills/impeccable" "$DEST/"
for s in ui-ux-pro-max ui-styling; do [ -d "$DEST/$s" ] || cp -R "$TMP/uux/.claude/skills/$s" "$DEST/"; done
rm -rf "$TMP"
```

Không chép skill vào repo (repo public, skill có giấy phép riêng). Muốn nâng phiên bản thì Opus đổi mã commit ở trên, đọc lại thay đổi của skill, rồi commit `CLAUDE.md`.

**Dùng skill nào, lúc nào:**

| Skill             | Khi nào                                                    | Phần bắt buộc làm                                                                                                    |
| ----------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `ui-ux-pro-max`   | Mọi trang, mọi thành phần                                  | Trước khi báo xong: rà `references/quick-reference.md` mục 1–3 và 8 (accessibility, tương tác, hiệu năng, form)      |
| `ui-styling`      | Dựng thành phần shadcn/Tailwind                            | Theo mẫu thành phần và theming của skill, nhưng màu/font lấy theo quy định bên dưới                                  |
| `break-ui`        | Mỗi màn hình có dữ liệu, trước khi báo xong                | Đủ quy trình: lập bảng mọi giá trị hiển thị → bộ dữ liệu xấu nhất → nút chuyển dữ liệu (chỉ ở dev) → báo lỗi → sửa   |
| `mobile-native`   | Trang dùng trên điện thoại (form công khai, onboarding…)   | Rà bảng "Never Ship" và phần "Baseline"                                                                              |
| `impeccable`      | Rà soát và Stage 12                                         | Chạy `audit` cho màn mới; `harden` (lỗi, dữ liệu biên), `clarify` (wording) khi rà; `polish` ở Stage 12              |
| `emil-design-eng` | Khi làm chuyển động, hiệu ứng bấm, popover, toast           | Dùng khung quyết định "có nên animate không" trước khi viết hiệu ứng                                                 |

Giới hạn khi dùng skill trong dự án này:

- Không chạy lệnh skill tạo file thiết kế riêng trong repo (`ui-ux-pro-max --persist`, `impeccable init` / `document` tạo `PRODUCT.md`, `DESIGN.md`) và không bật hook của `impeccable`, trừ khi Opus quyết. Token thiết kế chỉ nằm ở `apps/web/src/index.css`.
- Gợi ý của skill về màu, font, phong cách chỉ là tham khảo; đã chốt ở đây thì theo đây (ví dụ font Be Vietnam Pro + chữ số Roboto).
- Không đưa dữ liệu thật trong `examples/` vào câu truy vấn hay bộ dữ liệu thử của skill.

### Hệ thống thiết kế

- **Màu:** chỉ dùng token trong `apps/web/src/index.css` (background, foreground, muted, border, primary, ok, warn, bad…). Không viết mã màu cứng trong component; cần màu mới thì thêm token. Màu nhấn (primary) chỉ cho nút chính, mục đang chọn, trạng thái; không dùng để trang trí. Mỗi màn chỉ một nút chính.
- **Font:** Be Vietnam Pro cho toàn bộ chữ, tự host bằng gói `@fontsource/be-vietnam-pro` (không gọi Google Fonts), các độ đậm 400 / 500 / 600 / 700, `font-display: swap`.
- **Chữ số trong ô dữ liệu:** Be Vietnam Pro không có số đều độ rộng (đã kiểm tra bản 5.3.0: không có `tnum`, số 1 hẹp hơn số 0). Nên ô số trong grid, bảng, thẻ chỉ số, trục biểu đồ dùng họ font `SoE Number`: `@font-face` lấy chữ số của Roboto (`@fontsource/roboto`, chữ số mặc định đều độ rộng, chạy được cả trong grid vẽ bằng canvas) với `unicode-range: U+0030-0039`, xếp trước Be Vietnam Pro. Số luôn căn phải.
- **Cỡ chữ:** thang cố định 12 / 14 / 16 / 20 / 24 / 30 px. Chữ thân trong app 14px, line-height 1.5; không chữ nào dưới 12px. Tiêu đề phân cấp bằng cỡ và độ đậm (600–700), nhãn 500, thân 400. Ô nhập tối thiểu 16px trên điện thoại.
- **Khoảng cách:** bội số 4px (4, 8, 12, 16, 24, 32, 48). Không dùng giá trị tuỳ tiện như `mt-[13px]`. Nhóm liên quan thì gần, phần khác nhau thì xa; khoảng trên tiêu đề lớn hơn khoảng dưới.
- **Icon:** chỉ `lucide-react`, một độ dày nét, cỡ 16 hoặc 20px. Không dùng emoji hay ký tự Unicode thay icon. Icon trang trí cạnh chữ thì `aria-hidden`; nút chỉ có icon phải có `aria-label` và tooltip.
- **Thành phần dùng chung** đặt ở `apps/web/src/components/ui` (kiểu shadcn). Không tự viết lại nút, ô nhập, hộp thoại, bảng ở từng trang. Cùng một hành động ("Lưu") phải trông giống nhau ở mọi nơi.
- **Không làm:** chữ gradient, hiệu ứng kính mờ để trang trí, viền màu dày bên trái thẻ, thẻ lồng thẻ, nhãn nhỏ phía trên tiêu đề, đánh số 01/02/03 cho mục, bóng đổ cứng không mờ.

### Trạng thái thành phần

- Mọi thành phần tương tác có đủ: bình thường, hover, focus, đang bấm, vô hiệu, đang tải, lỗi.
- Hover chỉ đặt trong `@media (hover: hover) and (pointer: fine)` (Tailwind 4 tự làm với `hover:`). Không có chức năng nào chỉ hiện khi hover; trên cảm ứng phải bấm được.
- Mọi màn có dữ liệu có đủ 4 trạng thái:
  - **Đang tải:** khung xương (skeleton) cùng bố cục với nội dung thật, không để màn trắng, không đặt spinner giữa nội dung.
  - **Rỗng:** nói rõ chưa có gì và có nút cho việc nên làm tiếp ("Tạo bảng đầu tiên"). Kết quả lọc rỗng thì có nút "Xoá bộ lọc".
  - **Lỗi:** nói chuyện gì xảy ra và cách xử lý (có nút "Thử lại"). Không hiện mã lỗi kỹ thuật, stack trace, JSON thô, `undefined`, `NaN`; mã lỗi server được dịch sang câu tiếng Việt.
  - **Không có quyền:** nói rõ là không có quyền, không hiện trang trống.
- Nút đang gửi thì khoá và hiện trạng thái chờ, không cho bấm hai lần. Thao tác xoá hoặc khó hoàn tác phải xác nhận, nút nguy hiểm màu `bad` và đặt tách khỏi nút chính; nếu được thì có "Hoàn tác" thay cho hỏi lại.
- Thao tác xong báo ngắn bằng toast ("Đã lưu"), tự tắt sau 3–5 giây, không cướp focus.
- Hộp thoại có nút đóng, Esc đóng được; đang có thay đổi chưa lưu thì hỏi trước khi đóng. Không dùng hộp thoại khi làm trực tiếp trên trang được. Dropdown, popover hiển thị qua portal để không bị cắt bởi khung cuộn.

### Form và ô nhập

- Mỗi ô có nhãn hiện rõ (không dùng placeholder làm nhãn); ô bắt buộc có dấu `*`; ô phức tạp có dòng gợi ý bên dưới.
- Kiểm tra khi rời ô, không kiểm tra theo từng phím. Lỗi hiện ngay dưới ô, nói rõ sai gì và sửa thế nào ("Email phải có đuôi @base.vn"), không chỉ "Không hợp lệ".
- Gửi thất bại thì giữ nguyên dữ liệu đã nhập và đưa focus về ô lỗi đầu tiên.
- Dùng đúng loại ô để điện thoại bật đúng bàn phím: `type="email"`, `inputmode="numeric"` cho mã, `inputmode="decimal"` cho số tiền; `autocomplete` đúng cho đăng nhập; cho phép dán và trình quản lý mật khẩu; ô mật khẩu có nút hiện/ẩn.
- Form dài (bài test, khảo sát) tự lưu nháp và có thanh tiến độ.

### Bảng, số liệu, biểu đồ

- Định dạng số và ngày theo `vi-VN`, qua **một bộ hàm định dạng dùng chung** (không định dạng tay ở từng trang):
  - Số `1.234.567`; thập phân dấu phẩy `12,5`; tiền `1.234.567 ₫`; phần trăm `12,5%`; số âm có dấu trừ.
  - Ngày `dd/mm/yyyy`; ngày giờ `dd/mm/yyyy HH:mm`; múi giờ `Asia/Ho_Chi_Minh`. Thời gian tương đối ("5 phút trước") chỉ dùng trong 7 ngày, sau đó hiện ngày cụ thể.
  - Giá trị trống hiện "—", không hiện `null`, `0` giả, ô trắng gây hiểu nhầm.
  - Cùng một giá trị phải hiện giống nhau ở mọi chỗ (grid, dashboard, export, thông báo).
- **Không bao giờ cắt bớt số, tiền, ngày.** Chữ dài: tên cần nhận diện thì xuống dòng (tối đa 2 dòng); thông tin phụ thì cắt cuối kèm tooltip xem đầy đủ; tên file, email dài thì cắt giữa.
- Danh sách trên 50 dòng thì ảo hoá hoặc phân trang. Lọc, sắp xếp, tìm kiếm chạy ở server (đã chốt ở phần Datahub).
- Cột sắp xếp được có chỉ báo chiều sắp xếp. Quay lại trang trước giữ nguyên bộ lọc, vị trí cuộn; mọi màn chính có URL riêng để gửi link được.
- Biểu đồ: đúng loại (xu hướng → đường, so sánh → cột, tỉ trọng → tròn, tối đa 5 phần; nhiều hơn thì dùng cột). Luôn có chú giải, tooltip hiện số chính xác, trục có đơn vị và kỳ (ngày/tuần/tháng). Không phân biệt chuỗi chỉ bằng cặp đỏ/xanh lá. Đường lưới nhạt. Không có dữ liệu thì hiện trạng thái rỗng, không vẽ khung trục trống.

### Dễ đọc, dễ thao tác

- Độ tương phản WCAG AA: chữ thường ≥ 4.5:1 (kể cả placeholder và chữ phụ), chữ lớn, icon có nghĩa và viền thành phần ≥ 3:1.
- Không truyền tin chỉ bằng màu: trạng thái (thắng, thua, quá hạn…) luôn có chữ hoặc icon đi kèm.
- Dùng được bằng bàn phím: thấy rõ ô đang focus (không xoá focus ring), Tab đúng thứ tự nhìn thấy, Enter gửi form, kéo thả có cách làm thay bằng nút hoặc bàn phím.
- Vùng bấm: desktop ≥ 24×24px, điện thoại ≥ 44×44px, các vùng bấm cách nhau ≥ 8px.
- Tiêu đề trang theo thứ tự h1 → h2 → h3, không nhảy cấp. Mục điều hướng đang chọn được làm nổi; điều hướng có cả icon và chữ, giữ cùng vị trí ở mọi trang.
- Phóng to trình duyệt 200% không vỡ bố cục; không khoá zoom.

### Bề ngang và điện thoại

- Desktop 1280px là màn chính; các mốc 375 / 768 / 1024 / 1440. Desktop ≥ 1024px dùng thanh bên, nhỏ hơn thì thu gọn.
- 375px không được tràn ngang cả trang; bảng rộng thì cuộn trong bảng. Đoạn văn dài (Knowledge) giới hạn 65–75 ký tự mỗi dòng.
- Thẻ meta: `width=device-width, initial-scale=1, viewport-fit=cover`. Không dùng `user-scalable=no` hay `maximum-scale=1`.
- CSS nền cho điện thoại: `-webkit-tap-highlight-color: transparent` ở `html`; nút và link có `touch-action: manipulation` và `user-select: none` (không đặt `user-select: none` lên nội dung); ô nhập 16px.
- Chiều cao toàn màn hình dùng `100dvh` cho khung app, không dùng `100vh`. Thanh cố định ở đỉnh/đáy có `env(safe-area-inset-*)`. Khung cuộn bên trong có `overscroll-behavior: contain`.
- Trang công khai (form) phải thử thêm trên điện thoại thật hoặc ít nhất 375px với bàn phím ảo mở; điều gì chỉ xác minh được trên máy thật thì ghi vào `progress.md`.

### Chuyển động

- Chuyển động chỉ để báo trạng thái hoặc phản hồi thao tác, không trang trí. Không có hiệu ứng khi tải trang; không hiệu ứng cho thao tác bằng phím tắt hay thao tác lặp hàng trăm lần mỗi ngày.
- Thời lượng: phản hồi khi bấm 100–160ms, tooltip 125–200ms, dropdown 150–250ms, hộp thoại 200–300ms. Dùng `ease-out` (`cubic-bezier(0.23, 1, 0.32, 1)`) khi xuất hiện; không dùng `ease-in`. Đóng nhanh hơn mở.
- Chỉ animate `transform` và `opacity`; không animate width/height/top/left. Không xuất hiện từ `scale(0)` (bắt đầu từ 0.95 + mờ). Nút có `:active` thu nhẹ `scale(0.97)`.
- Tôn trọng `prefers-reduced-motion`. Chuyển động không được chặn thao tác của người dùng.

### Wording

- Tiếng Việt, ngắn, rõ. Mỗi câu một ý, dùng từ thường ngày.
- Nút bắt đầu bằng động từ và nói đúng việc: "Lưu", "Tạo bảng", "Xoá 3 dòng". Không dùng "OK", "Submit", "Xác nhận" chung chung.
- Không "Vui lòng…", không "Hệ thống đã…", không câu giải thích dài, không emoji, không câu cảm thán. Không giọng AI kiểu "Tuyệt vời!", "Hãy cùng…", "Dưới đây là…".
- Thông báo thành công ngắn: "Đã lưu", "Đã xoá 3 dòng". Lỗi nói nguyên nhân và cách sửa.
- Số lượng ghi đúng: "0 dòng", "1 dòng", "1.284 dòng"; "Hiển thị 40 / 1.284".
- Thuật ngữ thống nhất toàn app: Datahub, bảng, cột, dòng, view, deal, chỉ số, dashboard. Một khái niệm chỉ một tên.

### Kiểm thử bằng dữ liệu xấu nhất

Trước khi báo xong một màn hình, thay dữ liệu mẫu bằng dữ liệu xấu nhất **ở tầng dữ liệu** (fixture, seed, API), không sửa markup để tạo lỗi. Dùng giá trị thực tế hoặc đúng giới hạn của schema, không gõ chuỗi vô nghĩa. Bộ tối thiểu:

- Tên: `Đặng Thị Ngọc Hân` (dấu chồng, dễ bị cắt nếu line-height chặt), `Nguyễn Trần Bảo Khánh Linh Phương` (rất dài), `Vy` (rất ngắn), thiếu tên.
- Email dài liền không có khoảng trắng: `bartholomew.fitzgerald@northwind-holdings.example.com`.
- Tên bảng, cột, deal dài đúng giới hạn schema; có ký tự `<b>`, `&amp;`, xuống dòng (phải hiện đúng là chữ).
- Số: `0`, `1`, `1284`, `12.345.678.900`, số âm, phép tính dễ lệch làm tròn (`0,1 + 0,2` phải ra `0,3`), giá trị trống.
- Danh sách: 0 dòng, 1 dòng, đúng 1 trang và 1 trang + 1, 10.000 dòng.
- Ngày: hôm nay, tương lai, 3 năm trước, sát nửa đêm (đúng ngày theo giờ Việt Nam).
- Trạng thái: mọi giá trị trạng thái cùng lúc, đang tải, lỗi API, không có quyền, người đang xem có trong danh sách.
- Bề ngang: khung chứa thật (ví dụ thanh bên), 375px, 1440px, phóng to 200%.

Lỗi hay gặp và cách sửa: chữ tràn khỏi ô trong flex/grid → `min-width: 0` (grid dùng `minmax(0, 1fr)`); email/URL tràn → `overflow-wrap: anywhere`; avatar, icon, nút cuối hàng bị bóp → `flex-shrink: 0`; nhãn trạng thái xuống dòng → `white-space: nowrap`; chữ có dấu bị cắt đầu/đuôi → nới line-height, bỏ `overflow: hidden` trên khối chữ; ảnh vỡ → ảnh dự phòng (chữ cái đầu) và `object-fit: cover`.

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
- View theo kiểu Lark Base, **tự lưu** mọi thay đổi (lọc, sắp xếp nhiều cấp, nhóm, ẩn/cố định cột, độ rộng). Người được chia sẻ đổi view chung thì lưu thành bản riêng của họ. Sắp xếp theo thứ tự lựa chọn và theo cột công thức (nền cho sắp deal theo BANT).
- Chia sẻ cả datahub hoặc từng bảng; quyền Xem hoặc Sửa dữ liệu; chỉ chủ sửa cấu trúc.
- Cột mỗi bảng mặc định 70, trần 200, Admin chỉnh.
- Import từ Google Sheet/Excel là chức năng bắt buộc; có tuỳ chọn import công thức (dịch được thì thành cột công thức, không thì nhập giá trị và báo lý do).
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

- `examples/` chứa dữ liệu thật của Base. Đọc tự do, nhưng không đưa vào git (kể cả fixture hay snapshot test chứa số liệu lấy từ đó), không đưa nội dung ra dịch vụ ngoài.
- Golden test đọc thẳng file trong `examples/` trên máy để so số với Excel; máy không có file thì test tự bỏ qua (Dương đồng ý 18/11/2026).
- Repo GitHub đang để **public**. Không commit dữ liệu thật, secret hay `.env`.
- Hạ tầng, chi phí và việc đứng tên server do Dương lo; thiết kế chỉ cần ghi rõ yêu cầu.
- Golden test dùng số liệu từ file deal mẫu chỉ chạy trên máy, dữ liệu mẫu không commit.

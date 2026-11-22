# Tiến độ

Cập nhật: 22/11/2026

## Trạng thái

- **Thiết kế:** Module 0–7 đã chốt (Module 6 chốt 21/11). Module 8–11 chưa làm.
- **Code:** Stage 0–6 xong (Stage 4: 4.8 bản cơ bản; Stage 5, 6: bản rút gọn, `design/module5-ket-noi-ai.md` mục 12, `design/module6-thong-bao.md` mục 14; Opus rà đạt 22/11). Mốc test sau cùng: vitest cả bộ 1290 pass 10 skip (mã 111990c); sau sửa Leading (8335423) test Deal + notify 108 pass 1 skip. Đang làm: Stage 7 bản rút gọn (Dương chốt 22/11, `design/module7-dynamic-form.md` mục 14): 7A1 xong (Opus rà đạt), 7A2 xong (chờ Opus rà) → 7B1 → 7B2. Việc dời của thiết kế: `design/update_v1.md`.
- **Git:** đã push `main` + `dev` tới 56b1834 (hết 4.4, Dương yêu cầu 21/11). Sau đó chưa push.
- **Mốc test** (không chạy hai lệnh vitest song song, chung DB): mốc 4.7B (mã c9c807e) vitest 1235 pass 9 skip 0 fail; mốc trước (4.6E, mã 9695a8b) vitest 1218 pass 9 skip; e2e desktop 116–124 pass.

## Đã xong

- **Stage 0–3:** nền tảng, tài khoản/phân quyền, Datahub (106 hàm, golden khớp Excel), metric + dashboard + Guest. Quyết định: `design/module{0..3}-*.md`, `design/module{2,3}-quyet-dinh-khi-code.md`.
- **4.1** (20/11) sửa Stage 2: khoá phân chia, tính theo người đọc, bảng template, giao diện chia sẻ (`module4-quyet-dinh-khi-code.md` 4.1a–d).
- **4.2** bộ bảng mặc định theo cây, kiểu Người dùng có thuộc tính. **4.3** giao diện Quản lý Deal + trang Template. **4.4** thanh toán và com theo đợt (4.4A server, 4.4B web). **4.5** chốt kỳ, BANT, forecast, snapshot (+ sửa chập chờn: `columnTx`, hàng đợi ưu tiên). **4.6** chỉ số, dashboard Deals, `deal.cycle`, hiệu năng hàng đợi (4.6A–D). Quyết định chi tiết: `design/module4-quyet-dinh-khi-code.md` 4.2–4.6D; bản đồ: `design/ban-do-code.md`.
- **4.6E** (22/11) hàm người xem ME/ISME/ATTR, bộ mặc định bỏ phần cứng, vai trò đa cột `nguoi_tham_gia`; phần còn lại làm ở 4.7A (INSCOPE/ATTRSUM, lệnh tiền tính ngay, trần % com ở lệnh).

## Stage 5 và 6 bản rút gọn (xong 22/11; 6B chờ Opus rà)

Phạm vi: `design/module5-ket-noi-ai.md` mục 12, `design/module6-thong-bao.md` mục 14; quyết định: `design/module5-quyet-dinh-khi-code.md`, `design/module6-quyet-dinh-khi-code.md`; bản đồ: `design/ban-do-code.md` "Module 5", "Module 6"; hướng dẫn người dùng: `docs/ket-noi-ai.md`.

**Stage 5:** token cá nhân = kết nối (menu + mức, Admin duyệt/duyệt bớt, thu hẹp, thu hồi); executor giao quyền ở `ai-gate.ts`; `/mcp` không trạng thái (4 tool chung + 6 tool chọn lọc); import mở cho AI; web Cài đặt/Quản trị → Kết nối AI; Bruno `docs/api/bruno/mcp/`. Thử thật Claude Code đúng; `tools/list` đủ menu khoảng 2.006 token.
**Stage 6:** một cửa `notify.send` + `defineNotification` (`notification/notify.ts`, `catalog.ts`, 19 loại), nhắc hẹn (`reminders.ts`, `reminder.*`), bản tin 08:00 và nhắc hạn Deal 08:30 (`deal/due.ts`, `deal.due_rules.get/set`), thông báo chung (`announcements.ts`, `announcement.*`, không gửi Guest), subscriber thoát sớm theo `role_set`, MCP `reminder_create`/`notifications_list`; web `apps/web/src/pages/notify/` (chuông + hộp 20 thông báo + toast, `/thong-bao`, `/nhac-hen`, `/tai-khoan/thong-bao`, `/thong-bao-chung`, nút "Nhắc tôi" ở `RowPanel`); `window.confirm` đã thay bằng `ConfirmDialog`, lint `no-alert` bật cho web. Migration 0024, 0025. Bruno `notification/`, `deal/due-rules-*`.
**Dời** (`design/update_v1.md`, file quyết định): giới hạn 10 thông báo chung/ngày; phân trang `announcement.list_*`; "Xem trước" quy tắc nhắc hạn; các loại Kỳ khoá/Template đổi/Chính sách com mới/Deal Won chưa chia đủ/Leading đổi; nhãn tiếng Việt cho từng loại ở Cài đặt (đang hiện mã); kiểm quyền xem dòng lúc tạo nhắc hẹn gắn dòng.
**Sửa sau Opus rà 6B:** Leading của nhắc hạn đọc vai trò đã lưu theo người (`storedRoles`), test `notify-due-layout.test.ts` (bố cục 4 cột). Chạy `notify-digest-due` (2 lần), `notify`, `notify-due-layout`, `deal-flexible-layout`, `deal-payments`, `ban-do-code`: pass; typecheck api 15, lint sạch. Chưa chạy lại cả bộ vitest sau sửa này.
**Test 6B:** typecheck api 15, web 31 (bằng mốc), lint sạch (thêm `no-alert`). e2e desktop (`node apps/web/e2e/run.mjs e2e/stage6.spec.ts e2e/stage1.spec.ts e2e/stage5.spec.ts e2e/stage4-5.spec.ts --project=desktop`, mã 111990c): 30 pass, 0 fail (stage6 3 test: nhắc hẹn qua worker thật, thông báo chung gửi/đọc/thu hồi, Cài đặt thông báo). **Cả bộ vitest** (`DH_EQUIV_EDITS=2500 pnpm exec vitest run apps packages`, mã 111990c): 1290 pass, 10 skip, 0 fail (mốc 6A2: 1289/10). Không cả bộ e2e, không 375px. Test e2e cũ sửa theo giao diện mới: `readCode` (helpers.ts) tìm `notification-item` và chờ thẻ tải xong; stage1 chuyển giao bấm hộp thoại. Khi sửa thấy `stage1` "Manager/Leader đăng ký" chập chờn 3 trong 8 lần: nguyên nhân là `readCode` nhìn một lần ngay sau `goto` (danh sách chưa tải) và chuông gọi lại 401 sau đăng xuất (retry mặc định); đã sửa cả hai, 4 lần chạy lại pass.


## 4.8 Kiểm thử cuối Stage 4 (bản cơ bản)

**Xong 22/11** (code dưới mã commit ghi trong git log "4.8"). e2e desktop cả bộ một lần: 126 pass, 2 fail (`stage4-4` ngăn chi tiết deal, `stage4-7` 4.7B1 Chốt kỳ; cả hai hết giờ `toBeVisible`). Hai fail xảy ra đúng lúc load test 20.000 deal chạy song song trên cùng máy (nghẽn CPU); chạy riêng hai spec 3 lần: 14/14 pass mỗi lần, nên coi là nhiễu do chạy song song, không sửa code. Lần sau không chạy load test trong lúc e2e. Không chạy vitest cả bộ (4.7B2 đã chạy, 1235 pass, không có code đổi).
**Load test** `apps/api/test/deal-perf.test.ts` (20.000 Deals, 40.000 đợt, người tham gia như deal mẫu, dòng nhân bản bằng SQL từ một deal tạo bằng lệnh thật): `datahub.deal.home` 4 ms; list Deals lọc Start date + sắp xếp, 50 dòng 31 ms; `metrics.query` tổng `role:doanh_thu` 29 ms; `metrics.dashboard.view` 68 ms, mỗi `metrics.chart.data` của dashboard Deals 20-21 ms; `period.review` 2026-07 472 ms; `payment.confirm` một đợt 70 ms. Tất cả xa ngưỡng 3 s, test chỉ `expect` < 3 s. Chưa có `dh_personal_rows` cho dòng nhân bản (cột theo người xem tính lúc đọc cho 20.000 dòng chưa đo).
Lỗi đã sửa: không có lỗi code.

## Còn nợ / ghi nhận để sau

- Phần thiết kế đã chốt nhưng dời (M4, M5, M6): `design/update_v1.md`, làm sau phiên bản đầu.
- **4.8 bản cơ bản (Dương chốt 22/11):** vitest cả bộ một lần (`DH_EQUIV_EDITS=2500`), e2e cả bộ một lần, load test 20.000 deal (chỉ ghi số, sửa khi vượt rõ 3 s), chỉ sửa lỗi thật. Dời: Bruno sang Stage 5; bù cột còn thiếu cho cây đang chạy (cột mới, `Mã ngoài`, cột team thành công thức); 375px sang Stage 12.
- 4.6: Manager đặt mốc cohort mặc định cho cây; Index của team chưa đọc từ `Doanh thu theo người`; ô lọc theo cột của biểu đồ chưa có nhóm Vai trò.
- 4.5: việc tính lại nền xếp sau việc người dùng, chưa chống đói. 4.1b: đổi cây của một người tính lại 3,6 s.
- 4.7A: Guest cấp bảng, nhiều team cùng cấp thì cột theo người đọc để trống; created_by/updated_by (id người) vẫn có trong dòng Guest đọc; `com_split` gửi tay chưa kiểm trần; khoá ghép nhiều cột cho upsert chưa có (dùng một cột Duy nhất dạng `nguồn:mã`).
- Cột phụ thuộc người xem tính lúc đọc (Dương 22/11: hoãn; dùng `dh_personal_rows`). Xem lại khi thấy chậm.
- Stage 3: người xem qua chia sẻ dashboard không tự tải lại khi dữ liệu đổi; chữ giữa gauge, lọc chéo cột < 1 px (Stage 12).
- Grid chưa `impeccable audit`, chưa thử điện thoại thật (Stage 12). Module 2 mục 11 chưa ghi giới hạn 150 cột cho bảng có form.
- Chưa thử: chuyển cả cây bằng giao diện, Google Sheet thật, `docker-compose.yml`, đăng nhập Google thật (`design/ha-tang.md` mục 4).


## Lỗi điện thoại để sau

Không chặn bước con; gom sửa một đợt. `stage1.spec.ts` phone "cài đặt hệ thống" từng hết giờ 1 lần (`pnpm test:e2e stage1 --project=phone`), theo dõi.

## Câu hỏi còn mở (chờ Dương)

- Guest xem dashboard (3C-2): cờ `guest_visible` theo dashboard đúng ý Module 1 mục 5.2 chưa, hay cấp theo từng dashboard ở khung cấp dữ liệu? Nhật ký xem dashboard chỉ ghi lần mở `view`.
- Grid và trình đọc màn hình (2C-1): có bắt buộc bảng DOM song song không. Cột Mã dòng `#<số>` vs uuid ở export/API.
- Đối soát công thức (2B+): ngân sách 1.000.000 dòng/đêm, chờ 5 s là giá trị tự chọn.
- Module 4 (4.4A): cây đã tạo trước 4.4 giữ `Đã thu` là cột thường; bảng Tiền về "chỉ Manager" làm bằng khoá phân chia theo cột `Người xem` luôn trống.
- Stage 9 Onboarding: hỏi Dương có kiểm giao diện kỹ như ngoại lệ không. (Danh sách token chưa phân trang: dời, xem "Còn nợ".)


## Stage 7 (bản rút gọn): 7A1, 7A2 xong 22/11, chờ Opus rà 7A2; tiếp 7B1

**7A1** (server: form, bảng đích, xuất bản, gửi bài, công khai + chống spam, nháp) đã Opus rà đạt. **7A2** (mã 1c27f46): migration 0027 (`form_scores`, bỏ khoá ngoại `forms.table_id`); `apps/api/src/modules/form/quiz.ts` (chấm), `grade.ts` (chấm tay, danh sách chờ chấm, bài của tôi, phản hồi), `io.ts` (JSON, nhân bản), `transfer.ts` (chuyển giao); MCP `form_get`/`form_save`/`form_responses`; thông báo `form.grade.pending`, `form.graded`, `form.question.off` (sự kiện mới `datahub.column.deleted`). Quyết định: `design/module7-quyet-dinh-khi-code.md` "7A2"; bản đồ: `design/ban-do-code.md` "Module 7". OpenAPI sinh lại, Bruno `docs/api/bruno/form/` (thêm 9 file).
**Test 7A2:** `apps/api/test/form-quiz.test.ts` 15 pass (+ form.test.ts 20 pass). Typecheck api 15, web 31 (bằng mốc), lint sạch. Cả bộ vitest (`DH_EQUIV_EDITS=2500`, mã 1c27f46): 1326 pass, 10 skip, 0 fail (mốc 1290 + 36 test mới: form-quiz 15, form 20 đã có, mcp).
**Bàn giao 7B1/7B2 (lệnh web, tất cả `/api/v1`):**
- Trình soạn: câu hỏi mang thêm (chỉ trong nháp) `answer`, `points`, `partial`, `match_accents`, `rubric[{id,label,min,max,weight,floor?}]`; form có `quiz {enabled, scale "100"|"raw", pass {type points|percent, value}|null, max_attempts, show none|score|score_answers}`; người chấm chỉ định: `form.form.update` `options.graders` (mảng id người). Đáp án: một lựa chọn = mã/tên lựa chọn; nhiều = mảng; số = số hoặc `{min,max}`; văn bản ngắn = mảng chuỗi. Lỗi xuất bản bài kiểm tra: `details.issues[].code` = `quiz_public`, `quiz_no_points`, `quiz_answer_invalid`, `quiz_rubric`, `quiz_pass`, `quiz_input`. Bật bài kiểm tra mà form công khai: `form.form.update` lỗi `reason: quiz_public`.
- Danh sách form: `form.form.list`; Phản hồi: `form.response.list {form_id, limit, cursor, search}` trả `items[{row_id, created_at, created_by, answers{id câu: giá trị}, quiz{score,max,result,attempt}|null}]` + `questions[]` ở phần ngoài (`listExtra`); link sang bảng đích: `table_id` của `form.form.get`.
- Chấm bài: `form.grade.list {form_id?, status pending|all}` (item: `response_id`, `form_name`, `user_name`, `attempt`, `result`, `score`, `max`), `form.grade.get {response_id}` (từng câu: `answer`, `expected`, `points`, `max`, `manual`, `graded`, `rubric`, `criteria`, `comment`), `form.grade.submit {response_id, items[{question_id, points | criteria{id tiêu chí: điểm}, comment}], comment}`; lỗi `reason: not_grader`. Thông báo chờ chấm đang trỏ `link: /form/cham-bai?response=<id>`, đã chấm trỏ `/form/bai-lam` (web đặt đúng đường dẫn khi làm giao diện).
- Bài làm của tôi: `form.fill.get` có `quiz {max_attempts, attempts_used, show}` và `already_submitted` (hết lượt); `form.response.submit` trả `quiz` (theo "người làm bài thấy", null nếu `none`); `form.quiz.mine {code}` trả các lần làm (điểm, kết quả, và đáp án khi form đã đóng + `score_answers`). Lỗi nộp: `attempts_exhausted`, `quiz_no_ai` (chỉ khi token/MCP), `quiz_internal_only`.
- JSON/nhân bản: `form.form.export {form_id | code, source}`, `form.form.import {datahub_id | table_id, json, name?}`, `form.form.save_json`, `form.form.clone {form_id, datahub_id? | table_id?, name?}`; lỗi JSON `details.issues[{path,message}]`; `unmatched[]` của import/clone/save_json.
- Cột kết quả của bảng đích (Điểm, Điểm tối đa, Kết quả, Lần làm, Người chấm, Ngày chấm) do hệ thống ghi, khoá chỉnh tay (`allow_edit: false`).
**Dở/ghi nhận:** chưa chặn hai lần nộp đồng thời của cùng người (có thể vượt số lần một lượt); thời gian làm bài, xáo trộn, chấm lại theo đáp án mới đã dời (mục 14).

**7B1 (đang làm, 22/11):** xong việc 0 (khoá gửi bài), 1–4 (web `apps/web/src/pages/form/`: danh sách, trình soạn, chia sẻ/thiết lập/bài kiểm tra, phản hồi, chấm bài); còn việc 5 (e2e `apps/web/e2e/stage7.spec.ts`).

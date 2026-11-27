# Module 7: quyết định khi code

## 7A1 (22/11/2026, Sonnet)

- **Cấu hình `soe-form/1`:** `title`, `description`, `appearance` (tự do), `blocks[]`. Khối: `heading`, `text`, `image`, `divider`, `page_break`, `group` (`blocks`, `show_if`), `question`. Câu hỏi: `id` (mã riêng của form), `input` (kiểu cột hoặc `scale`), `label`, `description`, `hint`, `required`, `default`, `column_id` (KHÓA cột, chỉ ở server), `param` (mã tham số link), `hidden` (trường ẩn), `show_if` (cú pháp lọc Module 0, `field` = id câu), `options[{id,label}]`, `reveal` (`{mã lựa chọn: [id khối]}` cho "Khi chọn thì hiện"), `scale`, `unique_message`. Đối tượng `looseObject`: thêm trường mới (đáp án, điểm của 7A2) không bị cắt.
- **Điều kiện** chỉ nhìn lại câu đứng trước (vị trí đọc, nhóm đứng trước con). Câu ẩn coi như trống với khối sau. Trường ẩn (`hidden: true`) bỏ qua điều kiện, luôn ghi. `reveal` khớp theo mã lựa chọn hoặc tên lựa chọn.
- **Mã lựa chọn:** khi tạo cột từ câu hỏi, cột tự cấp mã `o_xxxx`; mã trong câu hỏi và khoá `reveal` được viết lại theo mã của cột (khớp theo tên). Giá trị ô lựa chọn gửi lên là mã hoặc tên (cột Module 2 nhận cả hai).
- **Trạng thái người điền thấy (`stateOf`):** suy ra từ trạng thái chủ chọn + ngày mở/đóng + số phản hồi tối đa + bảng còn sống. Không lưu "tạm dừng do xoá bảng", nên khôi phục bảng thì form chạy lại. Đủ số phản hồi tối đa thì ghi `closed` luôn.
- **Phiên bản form:** cột Số tên `Phiên bản form`, tạo khi tạo form có bảng và khi xuất bản, tìm theo tên.
- **Câu bị tắt (cột đã xoá):** không vào bản gửi người điền, không chặn xuất bản, không bắt buộc. Chủ chưa nhận thông báo (dời).
- **Chống bấm hai lần:** `attempt_id` duy nhất theo form (`form_responses`), áp cho cả công khai (không có Idempotency-Key). Gửi lại cùng mã trả `replayed: true`. Form nội bộ vẫn nhận `Idempotency-Key` của executor.
- **Kênh ghi:** nộp bằng token/MCP ghi `via = api`/`mcp` (thiết kế 5.1), web và công khai ghi `form`.
- **Công khai:** REST ở `/api/v1/public/forms/:code` (`form.public.get`, `.submit`, `.upload_init`, `.upload_complete`). Trang `/f/<mã>` là việc của web (7B2). Token giờ mở ký HMAC bằng `AUTH_SECRET`: server không tin giờ do trình duyệt gửi. Hằng số spam ở `SPAM` (`fill.ts`), đếm IP trong bộ nhớ một tiến trình (đủ cho một API; nhiều tiến trình thì đếm riêng từng tiến trình).
- **Người điền không có quyền bảng:** `submitResponse` dựng quyền của CHỦ bảng để gọi `applyRowOps`, người tạo dòng là người điền (hoặc "Form công khai").
- **Giới hạn 150 cột:** áp khi bảng có form chưa xoá; `datahub.table.get` trả `max_columns` theo đó.
- **Dời trong 7A1:** thông báo chủ khi cột bị xoá, báo chủ một lần khi bị spam (chỉ ghi nhật ký), chuyển giao form khi đổi chủ datahub, link tiếp tục cho form công khai (đã dời ở mục 14), bảng đích bị xoá cứng thì form mồ côi (khoá ngoại chặn xoá bảng có form; job dọn thùng rác sẽ báo lỗi cho tới khi xoá form: kiểm ở 7A2).

## Opus rà 7A1 (22/11/2026)

- Đạt. Cấu hình công khai lọc `column_id`, đáp án, điểm, `quiz`; gửi bài chỉ ghi cột của câu đang hiện và đã nối.
- Giao 7A2: chuyển giao form theo datahub (mục 9, Module 1 mục 8); kiểm job xoá cứng thùng rác với bảng có form (khoá ngoại); thông báo chủ form khi cột nối câu bị xoá (mục 1.3, bắt buộc).
- Báo chủ form khi bị spam: chỉ ghi nhật ký, không thông báo (dời, `update_v1.md`).

## 7A2 (22/11/2026, Sonnet)

- **Cấu hình bài kiểm tra:** `quiz { enabled, scale: "100"|"raw", pass {type: points|percent, value}|null, max_attempts (mặc định 1), show: none|score|score_answers }` ở cấp form; câu hỏi có `answer`, `points`, `partial` (nhiều lựa chọn), `match_accents` (văn bản ngắn), `rubric[{id,label,min,max,weight,floor}]`. Đáp án: một lựa chọn = mã hoặc tên lựa chọn; nhiều lựa chọn = danh sách; số = số hoặc `{min,max}` (áp cho number, currency, percent, rating, scale); văn bản ngắn = danh sách chuỗi (mặc định bỏ dấu và hoa thường, `match_accents` thì phân biệt dấu). Câu tự luận (`long_text`, `attachment`) có `points` là câu chấm tay; một câu chọn/số/văn bản có điểm mà không có `answer` cũng là chấm tay.
- **Nhiều lựa chọn chấm từng phần:** `max(0, đúng − sai) / số đáp án đúng × điểm`; không bật thì đúng hết mới có điểm.
- **Phiếu chấm:** điểm câu = Σ(điểm tiêu chí / thang trên × trọng số) / Σ trọng số × điểm câu. Một tiêu chí dưới điểm sàn thì cả bài "Không đạt" dù tổng đủ (cờ `floor_failed`).
- **Thang 100:** điểm hiển thị = điểm / tổng tối đa × 100, tối đa hiển thị 100; ngưỡng "điểm" so với số hiển thị, ngưỡng "%" so với tỷ lệ thật. Không đặt ngưỡng thì Kết quả để trống (trừ `Chờ chấm`, và `Không đạt` khi dưới điểm sàn).
- **Câu ẩn bởi điều kiện hoặc bị tắt** không tính điểm và không vào điểm tối đa.
- **Số lần làm** đếm theo `form_responses.user_id`; bài kiểm tra bỏ qua "mỗi người một phản hồi". Chưa chặn hai lần nộp đồng thời của cùng một người (hiếm, chỉ có thể vượt số lần một lượt).
- **Cột "Người chấm" là cột Văn bản chứa tên người chấm** (cột Người dùng đòi người đó là thành viên bảng, mà người chấm chủ chỉ định thường không phải). Cột tìm theo tên + kiểu; đổi tên cột thì hệ thống ngừng ghi cột đó (điểm vẫn ở `form_scores`).
- **Cột kết quả tạo khi xuất bản** bài kiểm tra (`ensureQuizColumns`), giống cột Phiên bản form.
- **Người chấm** = chủ + `options.graders` (kiểm là tài khoản người đang hoạt động). Chấm một phần được (lưu từng câu), bài vẫn `Chờ chấm` tới khi chấm hết; chấm lại được. Người làm bài chỉ nhận thông báo "đã chấm xong" khi `show` khác `none`.
- **Người làm bài thấy gì** (`quizView`): `none` thì không có gì (chỉ biết số lần đã làm); `score` thì điểm, Đạt/Không đạt/Chờ chấm; `score_answers` thì thêm điểm từng câu, nhận xét, đáp án đúng của đúng phiên bản đã chấm, chỉ khi form đang `closed`.
- **Đáp án đúng cho người chấm** (`form.grade.get.expected`) có, vì chấm cần.
- **JSON:** câu hỏi mang `column_name` thay `column_id` (mã cột không ra khỏi server); xuất bởi chủ (`form_id`) có đáp án và điểm, xuất bởi người điền (`code`) là bản đã lọc. Nhập `datahub_id` = bảng mới, mỗi câu một cột; nhập `table_id` = ghép theo tên cột + kiểu hợp + chưa bị câu khác dùng + đủ lựa chọn, còn lại vào `unmatched` kèm lý do (`no_column`, `type_mismatch`, `column_taken`, `option_missing`). Lỗi JSON: `details.issues[{path,message}]`.
- **Nhân bản** chép nháp cả đáp án; bảng mới nằm trong datahub của bảng cũ; không chép link, phản hồi, trạng thái (luôn nháp).
- **Chuyển giao:** tất cả form (kể cả trong thùng rác) của người nguồn đổi chủ cùng lúc với datahub (`form/transfer.ts`).
- **Xoá cứng bảng khỏi thùng rác:** bỏ khoá ngoại `forms.table_id` (migration 0027) thay vì đặt NULL, để form tự tạm dừng "bảng bị xoá", giữ phản hồi.
- **Thông báo chủ form khi cột bị xoá:** sự kiện mới `datahub.column.deleted` (không gộp như `datahub.structure.changed`, mang tên và mã cột), chỉ phát từ lệnh `datahub.column.delete` (xoá do đồng bộ template không liên quan form). Bắt buộc, gửi cả cho chính chủ.
- **MCP:** `form_save` có `form_id` thì thay nháp (`form.form.save_json`, câu mới tự tạo cột), không có thì tạo mới (`form.form.import`); `publish: true` xuất bản ngay.
- **Dời:** thời gian làm bài, xáo trộn, chấm lại theo đáp án mới (đã ghi ở mục 14).

## Opus rà 7A2 (22/11/2026)

- Đạt: cột "Người chấm" kiểu Văn bản; sự kiện mới `datahub.column.deleted` chỉ từ lệnh xoá cột; bỏ khoá ngoại `forms.table_id` (form tự tạm dừng khi bảng bị xoá cứng); không đặt ngưỡng thì Kết quả để trống.
- Giao 7B1 sửa: hai lần nộp đồng thời của cùng người vượt số lần làm. Khoá theo (form, người) trong giao dịch gửi bài (`pg_advisory_xact_lock`) trước khi đếm lần làm / "mỗi người một phản hồi"; test hai lần nộp song song chỉ một lần qua khi giới hạn 1.

## 7B1 (22/11/2026, Sonnet)

- **Khoá gửi bài:** `pg_advisory_xact_lock(hashtext(form), hashtext(người))` trong `submitResponse` trước khi đếm lần làm / "mỗi người một phản hồi" (Opus rà 7A2).
- **Server thêm:** `form.form.target_tables` (bảng ghi vào được, loại bảng Deal/gộp/template/đã xoá) để hộp Tạo form "dùng bảng có sẵn" không phải đoán; thông báo "đã chấm xong" trỏ `/form/bai-lam?code=<mã>`.
- **Khoá trong cấu hình (web đặt):** heading/text dùng `text`; image `url`, `alt`; group `title`; `appearance` = `cover`, `logo` (URL), `accent` (khoá bảng màu `ACCENTS`), `width` (`narrow|medium|wide`), `thank_you {text, redirect_url, again}`.
- **Giá trị câu lựa chọn trong điều kiện, đáp án và câu trả lời là TÊN lựa chọn** (không phải mã), vì server chỉ viết lại mã ở `options` và `reveal`, không viết lại `show_if`/`answer`. Đổi tên lựa chọn thì điều kiện/đáp án đang dùng tên cũ phải sửa lại.
- **Kéo thả:** một `SortableContext` cho mọi khối; thả lên đầu nhóm = vào nhóm, thả cạnh con = vào nhóm đó, nhóm không vào nhóm. Thêm khối: bấm ở thanh trái (không kéo từ thanh trái). Nút Lên/Xuống chỉ đổi trong cùng danh sách.
- **Trình soạn lưu nháp:** gửi cả cấu hình sau 600 ms, không dùng `version` (một người soạn). Sau lệnh server đổi nháp (nối cột, tạo cột, nhập JSON, bỏ thay đổi) web xả nháp chờ rồi tải lại nháp từ server.
- **Dời trong 7B1:** đổi kiểu câu đã tạo (xoá và tạo lại), chọn từng Guest trong "Chọn người" (chỉ có mẫu Sale/Data), bảng lựa chọn, ảnh bìa/logo chỉ nhận URL (chưa tải ảnh lên), "Đặt tên cột theo câu hỏi", chấm lại.

## Opus rà 7B1 (22/11/2026)

- Đạt: khoá đồng thời gửi bài; lệnh `form.form.target_tables`; link "đã chấm xong" tới `/form/bai-lam?code=`; thêm khối bằng bấm, kéo thả chỉ đổi thứ tự; dnd-kit.
- **Sửa ở 7B2:** điều kiện (`show_if`), đáp án (`answer`) và giá trị câu lựa chọn phải lưu **mã lựa chọn**, không lưu tên. Lý do: mục 2.2 "đổi tên lựa chọn: cùng mã, câu trả lời cũ hiện tên mới" và mục 2.8 "không bao giờ để chuỗi chết lặng lẽ": lưu tên thì đổi tên lựa chọn làm điều kiện ngừng chạy và chấm sai mọi bài sau đó mà không ai biết. Server chấm và tính điều kiện theo mã; web hiện tên; xuất bản báo lỗi khi điều kiện/đáp án trỏ lựa chọn không còn.
- Môi trường: link hỏng trong `node_modules/.pnpm/node_modules` sửa bằng `rm -rf node_modules/.pnpm/node_modules && pnpm install --frozen-lockfile --prefer-offline --force` (không vá tay). Sau đó `pnpm typecheck` sạch: **mốc mới apps/api 0 lỗi, apps/web 0 lỗi** (15 + 31 lỗi cũ do môi trường).

## 7B2 (22/11/2026, Sonnet)

- **Mã lựa chọn (thay quyết định "TÊN lựa chọn" của 7B1):** `show_if`, `reveal`, `answer` và giá trị gửi bài của câu lựa chọn là **mã** (`o_…`). Server `visibleBlocks` đổi giá trị gửi lên (mã hoặc tên, không phân biệt hoa thường) và giá trị điều kiện của câu lựa chọn sang mã trước khi tính; hàm: `config.ts` `optionIdOf`, `canonValue`, `labelValue` (mã -> tên để hiển thị). Điền sẵn qua link nhận tên, trang điền đổi sang mã, server cũng chịu tên (API, form cũ). Cột đích lưu mã (cột chọn nhận cả mã lẫn tên).
- **Viết lại tham chiếu khi lựa chọn nhận mã của cột** (tạo cột, nối cột, nhập/nhân bản JSON): `config.ts` `remapOptionRefs` đổi khoá `reveal`, `answer`, giá trị điều kiện của mọi khối đọc câu đó; ghép theo mã cũ rồi theo tên. Thay `remapReveal` cũ.
- **Xuất bản báo lỗi có cấu trúc:** `condition_option` (điều kiện trỏ lựa chọn không còn), `reveal_option`, `quiz_answer_invalid` (đáp án không phải lựa chọn của câu), cộng `option_missing` có sẵn (lựa chọn đã bị xoá khỏi cột).
- **Hiển thị cho người:** `correct_answers` (người làm bài thấy khi form đóng) và `expected` của `form.grade.get` trả TÊN lựa chọn; `answers` của danh sách Phản hồi đã là tên (đọc bảng với `labels`).
- **Trang điền `/f/<mã>`** (`pages/form/fill.tsx`): đứng riêng ngoài khung Shell (`shell.tsx` trả `<Outlet/>` trần cho đường `/f/`). Đã đăng nhập thì thử cửa nội bộ `GET /fill/:code`, `not_found` thì thử cửa công khai; chưa đăng nhập thì cửa công khai, không thấy thì hiện "Không tìm thấy form" kèm link đăng nhập (form nội bộ cũng trả không tìm thấy cho người chưa đăng nhập). Nháp: công khai ở `localStorage` (khoá `soe-form-draft:<mã>`, bọc try/catch), nội bộ `PUT /fill/:code/draft` sau 600 ms mỗi lần đổi. Điền sẵn: `?<param>=<giá trị>`; trường ẩn luôn lấy từ link, đè lên nháp. Lỗi theo câu hiện dưới câu và có thêm dải báo; hết giờ/đóng (`reason: form_*`) chuyển sang trang đóng; `rate_limited` hiện câu báo và giữ câu trả lời. Gửi lại ("Gửi phản hồi khác") tải lại form để lấy mã lượt mới; không hiện nút này ở bài kiểm tra.
- **Tải file:** chỉ form công khai (`form.public.upload_*`); form nội bộ chưa có lệnh tải file nên ô Đính kèm hiện ghi chú (dời, `update_v1.md`).
- **Sửa test cũ theo mã:** `form-quiz.test.ts` kỳ vọng `answer` của JSON/nhân bản là mã (`o_…`) thay vì tên.


## Câu chỉ dành cho form nội bộ (27/11/2026, sửa lỗi bảo mật)

- Một hàm luật: ops.ts isInternalOnly/internalOnlyIssues (fill_self, input user, input relation). Gọi ở checkPublish khi access public, form.form.update khi đổi sang public (kiểm nháp và bản đã xuất bản; reason internal_only_public) và submitResponse (form công khai: bỏ giá trị trình duyệt gửi cho các câu này, không ghi vào dòng).

# Module 8: quyết định khi code

## 8A (22/11/2026, Sonnet)
- **Quyền:** Manager nhận `knowledge:article:review` và `aihub:skill:review` ngay trong vai trò (mục 1 "mọi Manager duyệt"). Thêm `aihub:skill:read` cho mọi người đăng nhập trừ Guest. Admin không có quyền đăng; Admin đọc Knowledge.
- **Trạng thái bài:** `posts.status` = draft | pending | returned | published; lưu trữ là `archived_at` (độc lập, khôi phục không đổi trạng thái). Bản của bài: draft | pending | returned | published | superseded | withdrawn. Một bài có tối đa một bản đang sửa (draft/pending/returned) cạnh bản đang xuất bản.
- **Sửa bài đang chờ duyệt:** quay về nháp (rút lại), không chặn.
- **Gỡ xuất bản:** bản đang xuất bản thành `withdrawn`; nếu chưa có bản đang sửa thì tạo bản nháp mới sao từ đó. Không gửi thông báo cho tác giả.
- **Gửi lỗi thì không lưu gì:** `knowledge.article.submit` kèm nội dung lưu nháp rồi gửi trong một giao dịch; kiểm tra lỗi thì cả hai bị huỷ. Muốn giữ nháp thì gọi `save` trước.
- **Menu AI theo loại bài:** lệnh `review.*` và `post.*` khai menu `knowledge`; lúc gọi `libraryMenu` (ai-gate) đổi sang `aihub` nếu bài là skill. Không nêu loại mà là kết nối AI thì hàng chờ chỉ trả bài Knowledge. `review.decide`, `post.unpublish` là mức `full`.
- **Tìm kiếm:** cấu hình text search `soe_simple` (migration 0028). Điểm = `ts_rank_cd` + 0,5 × `word_similarity` tiêu đề. Phân trang bằng con trỏ là số thứ tự (offset), đủ cho thư viện nhỏ. Đoạn trích trả HTML đã thoát, từ khoá trong `<b>`.
- **Nội dung gửi qua AI:** `body` nhận Markdown (đổi sang Tiptap bằng `fromMarkdown`: đề mục, đoạn, danh sách, trích dẫn, code, đậm/nghiêng/link) hoặc tài liệu Tiptap. Thẻ chuyển chữ thường, tối đa 10 thẻ, mỗi thẻ 30 ký tự.
- **Tải file đính kèm:** `post.file.url` (không dùng `file.download.url` vì file riêng của chủ).
- **Dời:** lệnh xoá bài; thông báo khi gỡ xuất bản; test riêng từng luật, sai chính tả, từng bộ lọc (Dương 22/11: test gọn).

## Opus rà 8A (22/11/2026)

- Đạt. Đồng ý các quyết định nhỏ: sửa bài đang chờ duyệt thì về nháp; `submit` lỗi không lưu gì; gỡ xuất bản không báo tác giả; chưa có xoá bài (chỉ lưu trữ). Test tối giản theo Dương.

## 8B (22/11/2026, Sonnet)
- **Lưu file của gói:** mọi file nằm trong `content` của bản (chữ `utf8`, ảnh `base64`), không dùng bảng `files` Module 0. Lý do: `PostKind.parse` chạy đồng bộ, không có storage; gói tối đa 5 MB; quyền đọc file đi theo quyền đọc bài, không cần luật riêng. `fileIds` của skill luôn rỗng. Nếu sau này gói lớn hơn thì chuyển sang storage.
- **Tải zip:** `skill.package.download` trả `content_base64` (JSON), không phải luồng nhị phân; web tạo Blob. Chỉ tải qua lệnh này mới tăng `download_count` (`skill_get` của AI không tăng). Không cho AI gọi (`aiAllowed: false`).
- **`name`/`description`:** đọc từ đầu YAML của SKILL.md ở `parse`, bộ đọc tự viết (khoá: giá trị, nháy, khối `>`/`|`), không thêm thư viện yaml. Đầu YAML sai thì `name` rỗng và `check` báo `frontmatter_invalid`.
- **Zip:** bỏ `__MACOSX/`, `.DS_Store`; nếu mọi file nằm trong một thư mục gốc duy nhất và không có `SKILL.md` ở gốc thì bỏ thư mục đó. JSZip tự gọt `..`, nên kiểm trên `unsafeOriginalName`.
- **Trùng tên:** `check` chỉ cảnh báo `similar_skill` (trùng tên hoặc tên/mô tả giống ≥ 0,6). Chặn thật ở lúc xuất bản (`beforePublish`): trùng `name` với skill khác đang xuất bản thì `conflict` `skill_name_taken` (người duyệt trả lại). `replaces` = "phiên bản mới của skill X": xuất bản thì skill X bị lưu trữ. Chưa kiểm "cùng tác giả hoặc người duyệt đồng ý": người duyệt bấm duyệt là đồng ý.
- **Cờ bắt buộc:** nhóm (`group_required`) và phiên bản dạng `1.0.0` (mặc định `1.0.0`). `clients` có thể trống.
- **Tham chiếu trong SKILL.md:** liên kết markdown tương đối và `references|scripts|assets/...` trong dấu huyền; thiếu file thì `reference_missing`.
- **Dời:** cảnh báo "tên người cụ thể" (chỉ dò email); giao diện chọn skill để đặt `replaces`.

## Opus rà 8B (22/11/2026)

- Đạt. Đồng ý: file gói lưu trong nội dung bản (chữ utf8, ảnh base64; gói tối đa 5 MB, quyền đọc theo bài); tải zip trả base64 trong JSON; bộ đọc YAML tự viết; `group` bắt buộc; `replaces` lưu trữ skill cũ khi bản mới được duyệt (người duyệt quyết). Cảnh báo "tên người cụ thể" chỉ dò email: chấp nhận.

## 8C (web, 22/11/2026)

- **Tiptap 2.27 (ghim đúng phiên bản):** `@tiptap/react`, `starter-kit`, `pm`, `link`, `image`, `table` (+ row, cell, header). Đề mục chỉ H2, H3. Khối "ghi chú" = blockquote. Ảnh trong bài chèn bằng địa chỉ `https://`, chưa tải ảnh lên (dời).
- **Trang đọc và duyệt vẽ nội dung bằng Tiptap chỉ đọc** (không `dangerouslySetInnerHTML`); đoạn trích tìm kiếm tách ra thành `<b>` bằng React (`Snippet`), không chèn HTML.
- **Endpoint danh sách** (`list: true`) trả mảng qua `api()`; lệnh `{items}` thường (`knowledge.tag.suggest`, `post.versions`, `related`) trả đối tượng.
- **SKILL.md và file chữ của skill hiện dạng văn bản thô** (`<pre>`), không render Markdown: không có bộ lọc HTML an toàn, tránh XSS từ nội dung người đăng.
- **Xem file chữ của skill** gọi `skill.package.get?path=` mỗi lần bấm (mỗi lần tính một lượt xem; chấp nhận, dời nếu cần).
- **Tải lên skill:** zip đọc thành `zip_base64`; thư mục (chọn hoặc kéo thả, `webkitGetAsEntry`) đọc thành `files`, bỏ tên thư mục gốc, ảnh `base64`, còn lại `utf8`. "Phiên bản mới của skill" = danh sách tối đa 50 skill đã xuất bản mới nhất (chưa tìm theo tên).
- **`/duyet`:** quyền vào = duyệt Knowledge hoặc AI Hub (`a|b` trong `NAV`/`ROUTE_PERMISSIONS` của `shell.tsx` nghĩa là một trong). Nút Duyệt tắt khi bản còn lỗi chặn. Lý do trả lại nhập trong `ConfirmDialog`. Bản đang xuất bản xem riêng, không so khác biệt. `skill_name_taken` hiện câu hướng dẫn riêng.
- **Dời:** ảnh tải lên trong bài, mục lục cuộn theo đề mục khi bài rất dài (đã có bấm để cuộn), phân trang danh sách (đang lấy tối đa 50-100), tìm skill để chọn `replaces`, "Cho sale" cảnh báo hiển thị riêng cạnh trường.

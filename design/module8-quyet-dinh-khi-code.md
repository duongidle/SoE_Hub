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

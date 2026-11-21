# Kiểm tra thiết kế trước khi code

Dương chốt ngày 22/11/2026, rút từ Stage 4. Ở Stage 4, các bước con 4.2–4.6 mỗi bước tốn 50–80M token. Riêng bước 4.7 được rà phạm vi theo cách dưới đây trước khi giao, và ước tính giảm còn khoảng 25–30M. Phần lớn chi phí của Stage 4 sinh ra từ những tính năng làm riêng hoặc viết cứng, trong khi Datahub chung đã làm được hoặc chỉ cần sửa nhỏ.

## Khi nào chạy

- **Trước khi chốt thiết kế một module.** Opus chạy bảng kiểm trên bản đề xuất.
- **Trước khi giao một bước con.** Opus lấy phạm vi bước con trong thiết kế, chạy bảng kiểm, rồi đề xuất với Dương: việc nào cắt, việc nào gộp vào phần chung, việc nào dời. Mỗi việc kèm ước token. Dương chốt xong mới giao Sonnet.
- Kết quả ghi vào `progress.md` (phạm vi đã chốt) và file thiết kế của module (nếu đổi quy định).

## Bảng kiểm

Mỗi tính năng trong phạm vi, hỏi lần lượt:

1. **Datahub thường đã làm được chưa?** Nghĩa là cột, công thức, lookup/rollup, khoá phân chia, chia sẻ, import, upsert theo cột khoá, cấp cho Guest kèm chọn cột, hàm người xem.
   - Nếu được: dùng luôn, không viết lệnh hay luật riêng.
   - Nếu thiếu một chút: sửa phần chung của Datahub để mọi bảng đều hưởng, không làm riêng cho module.
   - Ví dụ 4.7: bỏ lệnh `deal.upsert` riêng, dùng upsert dòng chung. Bỏ "nhập lịch sử" riêng, dùng import thường cộng chốt kỳ.
2. **Có đang viết cứng cấu trúc cột không?**
   - Chức năng của hệ thống tìm cột theo **vai trò cột**, không theo tên.
   - Giá trị "của tôi", "của team" viết bằng công thức người xem (`ME`, `ISME`, `ATTR`, `INSCOPE`, `ATTRSUM`), không để hệ thống tự điền cố định.
   - Kiểm: nếu Manager đổi cách bố trí cột (tách hoặc gộp cột, đổi tên), có phải sửa code không? Có thì thiết kế lại.
3. **Có luật đặc thù cho một bảng hay một module không?** Hỏi: chuyện đó có thật sự xảy ra không, và cơ chế chung đã đủ chưa. Ví dụ 4.7: bỏ luật "Guest không bao giờ thấy cột com", vì cơ chế chọn cột chung đã đủ.
4. **Cần ngay hay để tới lúc dùng thật?** Thứ chỉ cần khi nối hệ thống khác, hoặc khi có dữ liệu thật, thì dời lại và ghi lý do. Ví dụ: bảng ánh xạ BPM, bù cột cho cây đang chạy.
5. **Tính năng có cần người dùng tự cấu hình không?**
   - Không cần: viết thẳng trong code của module, đừng đẩy vào engine Datahub.
   - Cần: dùng Datahub (dữ liệu là công thức, chức năng thuộc module).
6. **Số gắn với một người có đúng bất kể ai đọc không?** Doanh thu, KPI, com của người A phải ra cùng một số dù A, Leader hay Manager mở. Ví dụ 4.6: KPI tính theo người đọc ra số sai, phải thêm bảng Doanh thu theo người.
7. **Giá phải trả đã nói chưa?** Có những yêu cầu kéo engine vào chỗ khó:
   - mỗi người xem một số khác nhau;
   - tính sẵn và lưu;
   - đồng bộ nhiều bản;
   - nhiều việc chạy song song.

   Trước khi chốt những yêu cầu này, nói rõ cho Dương: phải làm thêm phần nào của engine, rủi ro lỗi chập chờn, ước token. Ở Stage 4, tổ hợp "mỗi người một số" cộng "tính sẵn" là nguồn chính của deadlock và test chậm.
8. **Dữ liệu cũ và số đã chốt.** Coi import là import thường. Cột công thức không nhận import. Muốn giữ số thật thì dùng cột giá trị cứng cộng công thức đọc nó (mẫu: `Com cố định` của Sổ com).
9. **Có đo trước khi khẳng định không?** Không đề xuất đổi kiến trúc hay hứa con số (thời gian test, hiệu năng, token) khi chưa có số đo. Ví dụ 4.6: Opus nói "vitest 3–4 phút" mà không đo, thực tế là 9–11 phút.
10. **Kiểm thử vừa đủ.** Theo "Kiểm thử theo cấp" trong `CLAUDE.md`. Không thêm lớp kiểm trùng.

## Cách trình bày cho Dương

Mỗi tính năng một dòng, gồm:
- quyết định: giữ, cắt, gộp vào chung, hoặc dời;
- lý do ngắn;
- ước token.

Cuối cùng ghi tổng token trước và sau khi rà. Chỉ hỏi Dương những dòng đổi chức năng người dùng thấy; còn lại Opus tự quyết và ghi lại.

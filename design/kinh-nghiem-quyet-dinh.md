# Kinh nghiệm ra quyết định

Dương chốt ngày 22/11/2026, rút từ Stage 4. Áp cho mọi module, không riêng Datahub.

File này ghi cách đi tới những quyết định vừa tiết kiệm token, vừa giữ hệ thống gọn và linh hoạt. Đọc trước khi thiết kế một module, và trước khi giao mỗi bước con.

**Bối cảnh.** Ở Stage 4, các bước con 4.2–4.6 mỗi bước tốn 50–80M token và vài giờ. Bước 4.7 được thảo luận phạm vi trước khi giao, và ước tính giảm còn khoảng 25–30M. Phần lớn chi phí không đến từ độ khó của nghiệp vụ, mà đến từ những quyết định thiết kế chưa được hỏi kỹ.

## Nguyên tắc

1. **Dựng trên cái chung đã có, đừng làm riêng.** Trước mỗi tính năng, hỏi: đây có phải một trường hợp của cơ chế chung đã có không (phần dùng chung, module trước, thư viện)?
   - Nếu có: dùng luôn.
   - Nếu thiếu một chút: mở rộng phần chung để chỗ khác cũng hưởng.

   Ví dụ 4.7: bỏ lệnh nhập deal riêng và luồng nhập lịch sử riêng, dùng cơ chế ghi dòng và import chung.
2. **Không viết cứng thứ mà nghiệp vụ có thể đổi.** Thứ người dùng hoặc quản lý có thể muốn đổi thì phải là cấu hình hoặc dữ liệu, code chỉ giữ phần cơ chế. Thuộc loại này: cách bố trí dữ liệu, quy tắc tính, ngưỡng, ánh xạ, danh sách lựa chọn, vai trò.
   - Câu kiểm: "Nếu người dùng đổi cách làm X, có phải gọi người vào sửa code không?" Có thì thiết kế lại.
   - Ví dụ 4.6E: cột "của tôi" chuyển từ hệ thống tự điền sang công thức `ME()`. Manager tách cột người tham gia thành 2 hay 4 cột mà không phải sửa code.
3. **Nghi ngờ luật đặc thù.** Mỗi luật chỉ áp cho một trường hợp, hỏi: chuyện đó có thật sự xảy ra không, và cơ chế chung đã đủ chưa. Luật đặc thù vừa tốn công làm vừa tốn công giữ. Ví dụ 4.7: bỏ luật "Guest không bao giờ thấy cột com", vì cơ chế chọn cột chung đã đủ.
4. **Làm cái cần bây giờ, dời cái chỉ cần khi nối thật hoặc khi có dữ liệu thật.** Ghi lý do dời và lúc nào cần làm lại. Ví dụ: bảng ánh xạ BPM, bù cột cho cây đang chạy, Bruno gom về Stage 5.
5. **Thiết kế theo quy mô thật, rồi để dư.** Hỏi Dương số liệu thật trước khi tối ưu. Ví dụ: Dương có khoảng 2.000 deal ban đầu, so với mục tiêu thiết kế 20.000. Với quy mô đó, cách lưu hiện có đã đủ, không cần đổi sang tính lúc đọc.
6. **Nói giá phải trả trước khi chốt.** Có những yêu cầu nhân độ phức tạp lên:
   - mỗi người thấy một số khác nhau;
   - tính sẵn và lưu;
   - đồng bộ nhiều bản;
   - nhiều việc chạy song song;
   - phải đúng ở mọi quy mô.

   Trước khi chốt, nói rõ phần phải làm thêm, rủi ro lỗi, ước token và ước thời gian. Đưa phương án rẻ hơn, kèm cái mất đi nếu chọn nó.
7. **Hiểu đúng hình dung của Dương trước khi đề xuất.** Giải thích bằng ví dụ cụ thể (bảng mẫu với vài dòng số thật), không bằng thuật ngữ. Nhiều lần trong Stage 4, chỉ cần đặt bảng ví dụ cạnh nhau là quyết định đã rõ.
8. **Đo trước khi khẳng định.**
   - Không hứa con số (thời gian, hiệu năng, token) khi chưa đo.
   - Không đề xuất đổi kiến trúc chỉ dựa trên phỏng đoán.
   - Sai thì đính chính ngay. Ví dụ 4.6: Opus nói "vitest 3–4 phút" mà không đo, thực tế là 9–11 phút, rồi suýt kết luận sai về hiệu năng.
9. **Không đổi thứ đang chạy chỉ vì nó chưa đẹp.** Cách hiện có đã chạy và đã có test, thì chỉ đổi khi có vấn đề thật hoặc số đo. Ghi phương án tốt hơn vào "Ghi nhận để sau". Ví dụ: tính lúc đọc cho cột theo người xem.
10. **Số gắn với một người phải đúng bất kể ai xem.** Doanh thu, KPI, com của A phải ra cùng một số dù A, Leader hay Manager mở. Ví dụ 4.6: KPI tính theo người đọc ra số sai.
11. **Kiểm thử vừa đủ.** Giữ lớp kiểm rẻ mà bắt được lỗi nặng (quyền, tiền, hồi quy phần dùng chung). Bỏ lớp trùng. Lỗi chập chờn thì tái hiện bằng chạy lặp đúng chỗ, không chạy cả bộ để thử từng giả thuyết. Chi tiết: `CLAUDE.md`, "Kiểm thử theo cấp".

## Cách làm trước mỗi bước con

1. Lấy phạm vi bước con từ thiết kế.
2. Mỗi tính năng một dòng, áp các nguyên tắc trên, ghi quyết định: giữ, cắt, gộp vào phần chung, hay dời. Kèm lý do ngắn và ước token.
3. Ghi tổng token trước và sau khi rà.
4. Đưa Dương những dòng đổi chức năng người dùng thấy. Dòng còn lại Opus tự quyết.
5. Dương chốt rồi ghi phạm vi vào `progress.md`, đổi quy định nào thì ghi vào thiết kế, rồi mới giao Sonnet.

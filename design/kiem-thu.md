# Kiểm thử

Tách từ `CLAUDE.md` ngày 20/11/2026. Phần tóm tắt (ai chạy gì ở bước con) nằm ở `CLAUDE.md` mục "Kiểm thử theo cấp". **Đọc file này khi làm hoặc điều phối bước con kiểm thử cuối stage, hoặc khi gặp test chập chờn / lỗi chỉ ở điện thoại.**

## 1. Kiểm thử cuối stage (bước con riêng, ví dụ 2E)

**Sonnet** kiểm thử chức năng đầy đủ một lần:

- `DH_EQUIV_EDITS=2500 pnpm test` toàn bộ (bài `datahub-partial-equivalence` mặc định chỉ 500 lần sửa ngẫu nhiên; cuối stage chạy đủ 2.500, thêm ~2,5 phút), toàn bộ e2e desktop; điện thoại chỉ các luồng chính (mục 4).
- Chạy api + worker + web thật, mở trên trình duyệt thật (Playwright có chụp màn hình, hoặc Claude in Chrome), đi hết các luồng chính của stage với từng vai trò liên quan; không có lỗi console/network.
- Bảng/grid: kiểm mọi chức năng hiển thị và thao tác (tải dữ liệu khi cuộn, sửa ô, kéo thả và đổi độ rộng cột, lọc, sắp xếp, nhóm, view…).
- Dữ liệu xấu nhất về **chức năng và số liệu**: danh sách rỗng, 10.000 dòng, số rất lớn, số âm, giá trị trống, tên có `<b>` hiện đúng là chữ, không cắt số/tiền/ngày.
- Kiểm "Định nghĩa xong" điểm 2–5 (`CLAUDE.md`).
- Ghi kết quả (luồng đã đi, lỗi tìm thấy, ảnh chụp) vào `progress.md`, sửa lỗi, chạy lại spec liên quan.

**Opus** chia việc kiểm thử (luồng nào, vai trò nào, dữ liệu xấu nhất nào), đọc kết quả và ảnh chụp, tự đi tay vài luồng chính khi cần, giúp Sonnet tìm nguyên nhân gốc khi kẹt, và quyết định stage đạt hay chưa.

## 2. Tiết kiệm token khi kiểm thử cuối stage

Dương chốt 19/11/2026; áp dụng mọi stage **trừ Stage 7 Dynamic Form và Stage 12 giao diện** (hai stage này kiểm kỹ giao diện theo quy định riêng).

- Chụp màn hình chỉ cho các màn hình chủ chốt; màn còn lại để Stage 12.
- Ưu tiên kiểm bằng code: assert trong Playwright, kiểm console và network bằng script. Ảnh chụp lưu ra file làm bằng chứng, chỉ mở xem khi assert fail hoặc cần nhìn bố cục.
- Đọc log chỉ phần lỗi.
- Chia thành vài phiên ngắn (ví dụ: chạy toàn bộ test và sửa lỗi; rồi đi luồng thật các màn chủ chốt theo vai trò + dữ liệu xấu nhất), mỗi phiên bắt đầu với ngữ cảnh gọn.
- Không rà chuẩn giao diện, không chạy bộ skill giao diện hay `break-ui` (Stage 12).

## 3. Test chập chờn là lỗi

Dương chốt 19/11/2026. Test lúc pass lúc fail (kể cả e2e hết giờ) không được chạy lại cho tới khi pass rồi báo pass. Tìm nguyên nhân và sửa: đợi đúng điều kiện thay cho chờ cố định, dữ liệu test tách riêng từng test, không phụ thuộc thứ tự chạy. Chỉ nới thời gian chờ khi đã đo và ghi lý do. Chưa sửa xong thì ghi vào `progress.md` mục "Câu hỏi còn mở" (tên test, lệnh, tần suất fail), và bước con chưa coi là xong. Không tắt hay `skip` test để né. Test chập chờn lộ ra trong bước con nào thì chặn bước con đó, dù test thuộc stage cũ. Ngoại lệ: lỗi giao diện chỉ ở điện thoại (mục 4).

## 4. Điện thoại là ưu tiên thấp

**Thu hẹp thêm (Dương chốt 28/11/2026):** điện thoại không phải trọng tâm, không tốn token cho nó. Chỉ **trang điền form** (form công khai và form nội bộ, kể cả bài kiểm tra) phải hiển thị đẹp và chạy đủ ở 375px, vì mọi người hay điền form bằng điện thoại; e2e điện thoại chỉ giữ luồng điền form. Các màn khác ở điện thoại: không viết thêm test, lỗi không nghiêm trọng (bố cục xấu, phải cuộn ngang, nút hơi chật) không sửa, chỉ ghi "Lỗi điện thoại để sau" khi tình cờ thấy. Lỗi nghiêm trọng (mất dữ liệu, sai số, không đăng nhập được) vẫn sửa. Quy định này thay phần "Không áp dụng cho trang công khai (… onboarding)" bên dưới cho Onboarding.

Dương chốt 19/11/2026; người dùng ít dùng điện thoại.

- Test 375px giữ ít: mỗi spec chỉ vài luồng chính, không nhân đôi mọi luồng desktop.
- Lỗi giao diện chỉ xảy ra ở điện thoại (kể cả test chập chờn ở 375px) **không chặn** bước con hay stage: ghi vào `progress.md` mục "Lỗi điện thoại để sau" (spec, lệnh, mô tả ngắn) rồi làm tiếp; Opus quyết khi nào gom lại sửa.
- Không áp dụng cho trang công khai (form công khai, onboarding): các trang đó phải chạy đủ ở 375px như `design/chuan-giao-dien.md`.
- Lỗi chức năng hay số liệu lộ ra ở điện thoại vẫn là lỗi thường, phải sửa.

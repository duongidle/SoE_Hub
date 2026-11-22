# Module 9 — Onboarding

> Trạng thái: **Đã chốt** · 22/11/2026 (Opus đề xuất, Dương phản biện và chốt trong chat cùng ngày).
> Phụ thuộc: [Module 1](module1-tai-khoan-phan-quyen.md) (cây tổ chức, leader trực tiếp, chuyển giao), [Module 2](module2-datahub.md) (bảng, chia sẻ, khoá phân chia, cho phép sửa theo cột, view), [Module 3](module3-metric-dashboard.md) (engine chỉ số), [Module 5](module5-ket-noi-ai.md) (menu Onboarding, nhóm cấm), [Module 6](module6-thong-bao.md) (`notify.send`, job nhắc), [Module 7](module7-dynamic-form.md) (form nội bộ, bài kiểm tra, điền sẵn qua link).
> Để module sau: Workspace (M10) nghe sự kiện của Onboarding nếu cần (mục 9).

Nguồn: brief mục Onboarding; `examples/Lộ trình onboard Dương.xlsx` (sheet **Master plan**: 4 tháng, 18 tuần, lịch thứ Hai–thứ Bảy, cột Checkpoint và Check-in checkpoint; **Đánh giá thử việc**: 3 bài test ≥80/100 thi lại 1 lần, bảng chấm mockup có trọng số và điểm sàn, 32 buổi on-job, đủ bài thu hoạch, 90 câu Q&A; **Bài thu hoạch on-job**: 4 câu tự luận mỗi buổi; **QnA**: ngày, ứng dụng, câu hỏi, trả lời); sheet chấm mockup của Dương (Google Sheet: Thành viên, Phản hồi 7 tiêu chí 1–5 + Điểm mạnh + Cần cải thiện + Tính vào trung bình, Tổng hợp theo trọng số, Cấu hình ngưỡng trung bình 4 / từng tiêu chí 3 / mốc giờ bắt đầu tính).

**Nguyên tắc (Dương 22/11):** tận dụng engine lõi (Form, Datahub, chỉ số, thông báo), không dựng engine mới. Lộ trình phải linh hoạt: mỗi người một lộ trình khác nhau, không có checkpoint nào viết cứng. Không làm thành game: làm thành **hành trình** có checkpoint để nhân sự biết tiến độ và việc cần làm.

---

## 1. Lộ trình

- Một khái niệm duy nhất: **lộ trình**. Mỗi nhân sự có **một lộ trình đang chạy** tại một thời điểm.
- Tạo lộ trình: **từ đầu**, hoặc **nhân bản** một lộ trình có sẵn (của mình, được chia sẻ, hoặc lộ trình mẫu) rồi sửa.
- **Lộ trình mẫu** = lộ trình chưa gắn người, đánh dấu "Mẫu". Hệ thống tạo sẵn cho mọi Manager và Leader một lộ trình mẫu dựng từ file của Dương (brief).
- Cấu trúc tự do: **Giai đoạn** (ví dụ "Tháng 1 - Nền tảng") → **Tuần** (tên, mục tiêu; ví dụ "W1 - Làm quen và học phần mềm cơ bản") → **Việc**. Số giai đoạn, tuần, việc, bài test, checkpoint đều do người tạo đặt.
- **Việc**: tên, mô tả, loại (Session / Session với CS / Session với Sale / Test / Mockup / Review 1-1 / On-job / Tự học / Nghỉ / Khác), ngày tương đối (tuần N, thứ X), giờ hạn tuỳ chọn, form gắn kèm tuỳ chọn, link tuỳ chọn.
- **Việc lặp**: lặp mỗi ngày làm việc (thứ Hai–thứ Bảy) hoặc mỗi tuần trong một khoảng tuần, có giờ hạn, gắn form. Dùng cho báo cáo cuối ngày (mục 4).
- **Gắn cho nhân sự**: chọn người, **ngày bắt đầu** (thứ Hai), người theo dõi. Hệ thống tính ngày thật cho mọi việc. Lộ trình đã gắn vẫn sửa được (thêm/bớt tuần, dời ngày, đánh dấu tuần nghỉ, đổi chỉ tiêu); sửa không ảnh hưởng lộ trình gốc đã nhân bản ra nó.
- Kết thúc: Hoàn thành (sau khi chốt đánh giá cuối) hoặc Dừng (kèm lý do).

## 2. Form gắn với lộ trình

- Bài test, phiếu chấm, bài thu hoạch, Q&A, báo cáo ngày đều là **form nội bộ của Dynamic Form** (Module 7), thuộc **người tạo lộ trình**, ghi vào bảng Datahub của người đó.
- Một form dùng cho **nhiều lộ trình** của cùng người tạo: kết quả mọi nhân sự nằm chung một bảng, lọc theo người (Dương chốt dùng chung; muốn tách thì lọc và lưu view như Lark Base).
- Trong trình sửa lộ trình, ô chọn form có nút **"Tạo form mới"**: tạo sẵn form đúng loại (bài kiểm tra / phiếu chấm / form thường), mở trình soạn, xuất bản xong quay lại lộ trình với form đã gắn.
- **Nhân bản lộ trình** kéo theo form **của chính mình**: form mình sở hữu được sao (bảng mới cùng cấu trúc, `form.form.clone`). Nhân bản lộ trình của người khác: chép cấu trúc lộ trình, form của người khác bị bỏ gắn và trình sửa báo "Chọn hoặc tạo form của bạn" (chưa nhân bản được form/bảng của người khác cho tới khi có nhân bản chung ở update v1). Lộ trình mẫu được tạo sẵn cho từng người kèm form của chính họ nên nhân bản đủ.
- Đề bài test dài: leader nhờ AI dựng bằng `form_save` (Module 7), hoặc nhập JSON. Nhập đề từ Excel: để sau (`update_v1.md`).
- **Câu ẩn "Người điền"** (thêm vào Module 7): câu ẩn kiểu Người dùng tự điền người đang đăng nhập, ghi vào cột Người dùng. Form do Onboarding tạo luôn có câu này.
- **Gắn lộ trình cho nhân sự** thì Onboarding tự:
  - thêm người đó vào "Chọn người" của mọi form gắn trong lộ trình;
  - chia sẻ các bảng **thu hoạch, Q&A, báo cáo ngày** cho người đó: quyền Sửa, **khoá phân chia theo cột "Người điền"**, cho phép sửa các cột câu trả lời (không sửa cột của leader). Đúng cơ chế chia sẻ bảng Datahub: nhân sự mở bảng, chỉ thấy dòng của mình, xem lại và sửa sau khi gửi.
  - Kết thúc hoặc dừng lộ trình: giữ chia sẻ ở quyền Xem.

## 3. Checkpoint

Checkpoint **hoàn toàn tự đặt**, không có checkpoint viết cứng (lộ trình chỉ có test, có mockup HRM+, hay không có mockup đều được).

- Checkpoint gắn với một tuần (hoặc nhóm "Đánh giá cuối"), có tên và một hoặc vài **điều kiện** (đạt khi mọi điều kiện đạt):

| Dạng điều kiện | Ví dụ |
|---|---|
| **Chỉ số trên bảng của một form**: đếm / tổng / trung bình / cao nhất / thấp nhất của một cột, lọc theo người (cột Người điền hoặc Người được chấm = nhân sự), khoảng thời gian (tuần của checkpoint, từ đầu lộ trình, hoặc từ một mốc giờ), điều kiện thêm (ví dụ Tính vào trung bình = bật, Buổi = …), so với ngưỡng | Q&A tuần 1 ≥ 10 câu; Test Work+ Basic: điểm cao nhất ≥ 80 |
| **Nhiều cột có trọng số** (phiếu chấm): trung bình từng cột, trung bình trọng số ≥ ngưỡng, từng cột ≥ ngưỡng sàn | Mockup: trung bình trọng số ≥ 4, từng tiêu chí ≥ 3 (sheet chấm mockup) |
| **So với số việc trong lộ trình** | Số bài thu hoạch ≥ số việc On-job đã qua |
| **Leader xác nhận tay** | Mockup done; Nhận deal làm SoE Associate |

- Tính bằng **engine chỉ số Module 3** (một nơi tính), tính lại khi bảng nguồn đổi. Hiện giá trị thật so với ngưỡng (ví dụ "Q&A 7/10", "3,96 / 4").
- Phiếu chấm mockup: link chấm do Onboarding tạo cho từng buổi, điền sẵn ẩn **"Người được chấm"** và **"Buổi"**; một form phiếu chấm dùng cho mọi buổi, mọi người. Cột "Tính vào trung bình" (Checkbox) leader bật/tắt trên lưới.
- Trạng thái: Chưa tới / Đang chạy / Đạt / Chưa đạt (hết tuần mà chưa đạt) / Đạt muộn.

## 4. Công việc trong quy trình onboard

- Mọi việc của lộ trình (mục 1) là **công việc trong quy trình onboard** (Dương đổi tên 22/11): tên tuỳ ý; một lần hoặc lặp (mỗi ngày làm việc, mỗi tuần, trong một khoảng tuần); **hạn riêng** từng việc (ví dụ 18:00 mỗi ngày, thứ Sáu 12:00); **giờ nhắc riêng** (ví dụ trước hạn 1 giờ); form gắn kèm tuỳ chọn.
- Chưa xong lúc nhắc → nhắc nhân sự; quá hạn → báo nhân sự và leader.
- Ví dụ: báo cáo cuối ngày 4 câu do leader đặt (form), hạn 18:00, nhắc 17:00; checkpoint đếm số ngày đã nộp (dạng chỉ số).

## 5. Chữa bài thu hoạch và Q&A

- Bảng thu hoạch và Q&A có hai cột của leader: **"Nhận xét của leader"** (Văn bản dài) và **"Đánh giá"** (Một lựa chọn: Đúng / Cần sửa / Sai). Cho phép sửa theo cột: chỉ chủ bảng (leader) sửa hai cột này; nhân sự sửa cột câu trả lời.
- Leader đổi hai cột này → người điền dòng đó nhận thông báo, bằng **tuỳ chọn chung của cột Datahub** (Dương chốt 22/11, làm ở Stage 9): trên một cột bất kỳ, chủ bảng bật "Khi cột này được sửa, báo cho người ở cột [cột Người dùng]". Mọi bảng dùng được (ví dụ báo sale khi Manager sửa ghi chú deal). Đi qua `notify.send` (kiểm quyền xem dòng, không báo cho chính người sửa, không chép giá trị ô vào nội dung đẩy); không báo khi thay đổi do công thức tính lại; gom theo dòng trong 10 phút.
- "Đánh giá" đếm được, nên làm được checkpoint kiểu "không còn câu nào ở trạng thái Cần sửa". Lọc "Cần sửa" thành view để nhân sự biết câu nào phải làm lại.
- Bình luận theo dòng cho Datahub: để sau (`update_v1.md`).

## 6. Đánh giá cuối (thử việc)

- Không có màn riêng. Leader đánh dấu một nhóm checkpoint là **"Đánh giá cuối"** (tự chọn hạng mục; mẫu theo sheet "Đánh giá thử việc": các bài test, mockup, on-job, thu hoạch, Q&A).
- Trang của nhân sự hiện nhóm này thành **thẻ tổng kết** từng hạng mục Đạt / Chưa đạt, kèm nút **"Leader chốt: Đạt / Không đạt + ghi chú"**. Chốt xong lộ trình chuyển Hoàn thành.
- Trang Theo dõi chung có cột "Kết quả cuối".

## 7. Giao diện

**Nhân sự onboard** (menu Onboarding chỉ hiện khi có lộ trình đang chạy hoặc đã xong):
- **Hôm nay**: việc hôm nay, tick xong, link mở form / bài test.
- **Hành trình**: dải giai đoạn → tuần, mỗi tuần một trạng thái (xong, đang làm, chưa tới, trễ) và checkpoint của tuần; bấm vào tuần xem việc và checkpoint.
- **Kết quả của tôi**: mọi checkpoint với giá trị so ngưỡng, thẻ Đánh giá cuối (không hiện ghi chú riêng của leader trước khi chốt), link mở bảng thu hoạch / Q&A / báo cáo ngày của mình.

**Leader, Manager, người theo dõi:**
- **Theo dõi onboarding**: một bảng, mỗi dòng một nhân sự: lộ trình, tuần hiện tại / tổng tuần, tiến độ %, checkpoint đạt / tổng, cột theo nhóm checkpoint (theo loại việc của nguồn: Test, Mockup, On-job, Q&A, Báo cáo ngày, Khác), việc trễ, kết quả cuối; ô tô màu; lọc team, lộ trình; bấm vào dòng mở trang nhân sự.
- **Trang nhân sự**: như nhân sự thấy, thêm sửa lộ trình, xác nhận tay checkpoint, chốt đánh giá cuối.
- **Danh sách lộ trình**: của tôi, mẫu, đang theo dõi; tạo, nhân bản, gắn, dừng.
- **Trình sửa lộ trình**: bảng giai đoạn / tuần / việc / checkpoint (không kéo thả lịch kiểu calendar).

**Kiểm thử giao diện (Dương 22/11):** đơn giản như Stage 7, không rà chuẩn giao diện, không `break-ui`; chức năng chắc chắn chạy, màn Hôm nay / Hành trình / Kết quả của tôi hiển thị ổn ở 375px. Làm đẹp ở Stage 12. (Bỏ ngoại lệ Stage 9 trong CLAUDE.md.)

## 8. Quyền

| Việc | Ai |
|---|---|
| Tạo lộ trình, nhân bản | Manager, Leader; User được cấp quyền bổ sung "Tạo lộ trình onboard" (Module 1 mục 3.3) |
| Sửa một lộ trình, gắn, dừng, xác nhận checkpoint, chốt đánh giá cuối | **Leader trực tiếp** của nhân sự và **Manager** của cây (brief); người tạo lộ trình mẫu sửa lộ trình mẫu của mình |
| Xem | Manager: mọi lộ trình trong cây; Leader: lộ trình của team và lộ trình mình theo dõi; người theo dõi; nhân sự: lộ trình của mình |
| Leader khác | Nhân bản lộ trình mình thấy về làm của mình (brief) |

Admin không tạo lộ trình (không có quyền nghiệp vụ).

## 9. Thông báo và sự kiện

- Nhân sự tick xong việc, checkpoint đạt → **leader trực tiếp** (bắt buộc, gom theo ngày).
- Việc quá hạn; checkpoint chưa đạt cuối tuần → nhân sự và leader.
- Nhắc việc có giờ hạn (báo cáo ngày 17:00), nhắc ngày có bài test → nhân sự.
- Leader đổi "Nhận xét" / "Đánh giá" ở bảng thu hoạch, Q&A → người điền.
- Sự kiện outbox: `onboarding.plan.assigned`, `onboarding.item.due`, `onboarding.plan.ended` (để Workspace M10 nghe nếu cần; không làm sẵn gì ở Workspace).

## 10. AI

- **Chỉ Leader và Manager** dùng AI với Onboarding (Dương chốt 22/11): tạo, sửa, nhân bản lộ trình; đọc tiến độ, trang Theo dõi.
- **Nhân sự onboard không dùng AI với Onboarding** (không đọc, không ghi). Server chặn theo vai trò của chủ kết nối.
- **AI của ai cũng không được**: tick việc, xác nhận checkpoint, chốt đánh giá cuối, làm bài test (bài test đã cấm ở Module 7 mục 6.5).
- Dựng đề bài test bằng AI đi qua `form_save` (Module 7).

## 11. Kiểm thử (tối giản: "test đủ dùng", Dương 22/11)

- Unit: tính ngày thật từ ngày bắt đầu, việc lặp; checkpoint dạng chỉ số (đếm Q&A theo tuần, điểm cao nhất bài test, phiếu chấm trọng số + ngưỡng từng tiêu chí với số của sheet chấm mockup: 3,96 < 4 chưa đạt, mọi tiêu chí ≥ 3); so với số việc On-job; gắn lộ trình tự chia sẻ bảng với khoá phân chia (nhân sự chỉ thấy dòng của mình, không sửa cột Nhận xét); quyền (Leader khác chỉ nhân bản; nhân sự không dùng AI; AI không tick); báo cáo ngày quá hạn báo nhân sự và leader.
- e2e: leader tạo lộ trình có test + Q&A → gắn cho nhân sự → nhân sự thấy Hôm nay, làm bài, gửi Q&A → checkpoint đạt → trang Theo dõi hiện đúng; màn Hành trình ổn ở 375px.

## 12. Thay đổi so với quy định đã chốt

| Quy định cũ | Đổi thành | Ảnh hưởng |
|---|---|---|
| Module 5 mục 3.3: mọi `onboarding.*` là cấm cứng AI; `registry.ts` chặn `onboarding.*` có `aiAllowed` | Leader, Manager dùng AI cho lộ trình (tạo, sửa, đọc); vẫn cấm cứng: tick việc, xác nhận checkpoint, chốt đánh giá cuối; nhân sự onboard không dùng AI với Onboarding | Module 5, `quy-dinh-chung.md` mục AI, `apps/api/src/core/registry.ts` |
| CLAUDE.md: Stage 9 là ngoại lệ rà đủ chuẩn giao diện, `break-ui` | Kiểm thử giao diện đơn giản như Stage 7 | CLAUDE.md |
| Module 7: form không có câu ẩn tự điền người đang đăng nhập | Thêm câu ẩn "Người điền" (kiểu Người dùng) | Module 7 |
| Module 6 mục 3.2: không báo khi người khác sửa ô thường | Thêm tuỳ chọn cột "báo cho người ở cột X khi cột này được sửa" (chủ bảng tự bật, mặc định tắt) | Module 2, Module 6 |
| CLAUDE.md bảng Stage: M9 cần 6, 7 | Cần 1, 2, 3, 5, 6, 7 | CLAUDE.md |

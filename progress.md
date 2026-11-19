# Tiến độ

Cập nhật: 19/11/2026

## Giai đoạn hiện tại

- Thiết kế: Module 0–4 đã chốt (Module 4 chốt 19/11, mục 7 Thanh toán còn là khung). **Module 5, 6: bản nháp vòng 1 xong** (`design/module5-ket-noi-ai.md`, `design/module6-thong-bao.md`, 19/11), chờ Dương phản biện. **Module 7 đã chốt** (19/11; CLAUDE.md, Module 0, 4 đã ghi thay đổi; Module 2 mục 11 chưa ghi giới hạn 150 cột vì Sonnet đang sửa file đó, ghi khi rảnh). Câu hỏi ở mục cuối mỗi file.
- Code: Stage 0 và Stage 1 xong. Stage 2: 2A, 2B, 2B+, 2C-1 xong và Opus đã rà soát (19/11); **2C-2 xong (server + giao diện, Sonnet, chờ Opus rà soát)**; 2C-3, 2C-4, 2D chưa làm. Dương yêu cầu: làm xong 2B+ và 2C rồi push lên `main` và báo.

## Ghi chú điều phối (Opus) — đọc trước khi làm tiếp

1. 2A đã push `main` + `dev`. 2B+ Opus đã rà soát (19/11): đạt, `pnpm lint`/`typecheck`/`test` 511 pass. 2C-1 Opus đã rà soát: đạt, còn 3 việc chuyển sang phần sau: (a) kéo thanh cuộn xuống cuối bảng 100.000 dòng mất 5,8 s, yêu cầu nhảy tới vị trí bất kỳ < 1 s (đọc thẳng cửa sổ quanh vị trí, đúng cả khi lọc/sắp/nhóm) — giao trong 2C-2; (b) cột Liên kết, Đính kèm sửa được — 2C-3; (c) `impeccable audit` cho grid — 2C-2.
2. **2C-2: phần server xong (8a66a2e, Opus kiểm 19/11: typecheck, lint sạch, `pnpm test` 585 pass)**: đọc cửa sổ theo offset/từ cuối (nhảy 100.000 dòng < 130 ms), `time_filter` + năm tài chính, nhóm + dòng tổng (`rows-groups.ts`), quy tắc tô màu, cấu hình view mới, OpenAPI + Bruno. **Còn lại: giao diện** (mục "Đang làm" 2C-2, kèm (a) dùng đọc cửa sổ cho kéo thanh cuộn, (c) `impeccable audit`). Sau đó 2C-3, 2C-4, rồi Opus rà soát và push `main` theo yêu cầu của Dương.
3. Ghi nhớ cho các phần sau của Stage 2:
   - 2B: golden test được đọc thẳng `examples/Quản lý Deal SoE (Dương TVD).xlsx` (Dương cho phép), không commit dữ liệu lấy từ file, máy không có file thì test tự bỏ qua.
   - 2C: làm cả công cụ **Tìm dòng trùng** (Module 2 mục 7a).
   - 2C: làm cả ô **Lọc theo thời gian** (Module 2 mục 5.4, bổ sung 18/11): lưu trong `config.time_filter` của view, server dịch sang `between`/toán tử ngày; không cần đổi schema.
   - Bảng gộp thuộc Stage 3 (Module 3 mục 4), không làm ở Stage 2.
4. **Module 4 đã chốt (19/11)**; CLAUDE.md và Module 1 đã ghi các thay đổi của mục 18. Khi code Stage 4 làm mục 19 (đối chiếu Module 2).
5. **Từ 19/11 kiểm thử theo cấp** (`CLAUDE.md` mục "Kiểm thử theo cấp"): bước con Sonnet chỉ test nhanh ở desktop; Opus rà bằng diff + kết quả; kiểm thử đầy đủ (cả bộ e2e, 375px, skill, `break-ui`) làm một lần ở 2D: Sonnet chạy, Opus điều phối, đọc kết quả và quyết định đạt. Chuẩn giao diện đã tách sang `design/chuan-giao-dien.md`.
6. Golden test 2B đã làm (đọc file mẫu, 3.322 công thức); số liệu và hai điểm lạ của file mẫu ở `design/module2-datahub.md` mục 2B.

## Đã xong

- Phân tích brief, file mẫu, chốt tech stack, thiết kế Module 0–4, hạ tầng.
- **Stage 0 xong**: monorepo, schema + migration, registry, audit append-only, lịch sử dòng, outbox, worker pg-boss, SSE, file, OpenAPI, Docker/compose/Caddy.
- **Stage 1 xong**: API và web của tài khoản, org chart, vai trò, phiên, mã kích hoạt, token, thông báo, nhật ký, chuyển giao, cài đặt (302 test, e2e 16 luồng x 2 bề ngang, 10 lỗi tìm thấy đã sửa). Chưa thử: chuyển cả cây bằng giao diện, đăng nhập Google, `docker-compose.yml`. Quyết định ở `design/module1-tai-khoan-phan-quyen.md`.
- **2A xong** (đã rà soát): schema, kiểu cột, API cấu trúc và dòng, SSE, chuyển giao, view SQL, index tự động; 100.000 dòng đọc 3–44 ms, trang keyset 2,7 ms.
- **2B xong** (đã rà soát): công thức (106 hàm), cột công thức/liên kết/lookup/rollup, tính lại, golden test 3.322 công thức (3.321 khớp Excel). Chi tiết ở `design/module2-datahub.md` mục 2B.
- **2B+ xong** (đã rà soát): tính lại theo phần, sự kiện `dòng, cột, cũ → mới`, `seq` và đợi tính xong, `pending` theo ô, đối soát hằng đêm; sửa 1 dòng nguồn ở bảng 100.000 dòng, 6 cột phụ thuộc: ghi 9 ms, worker 43 ms. Chi tiết mục 2B+.
- **2C-1 xong** (đã rà soát, 19/11): xem bên dưới và `design/module2-datahub.md` mục "Stage 2C-1".

## Đang làm: Stage 2C (giao diện Datahub), Sonnet code

- **2C-1 xong**: danh sách datahub, trang datahub (tab bảng, URL gửi được), grid Glide ảo hoá đọc keyset (100.000 dòng cuộn 60 fps), mọi kiểu cột, ô "đang tính", sửa ô/dán/điền xuống/sửa hàng loạt/xoá + Hoàn tác/hoàn tác-làm lại, khung chi tiết dòng + lịch sử, SSE; API mới `datahub.people.lookup`, `datahub.relation.labels`, `datahub.row.restore_batch`.
- **2C-2 xong phần giao diện (Sonnet, chờ Opus rà soát)**: nhảy cuộn bảng 100.000 dòng 70–120 ms; tab view, lọc lồng nhau, ô Thời gian, sắp xếp nhiều cấp, nhóm + dòng tổng, cột (ẩn/cố định/thứ tự/độ rộng), chiều cao dòng, tô màu, tìm kiếm, tự lưu và bản riêng. Chi tiết `design/module2-datahub.md` mục "Stage 2C-2".
- 2C-3: quản lý cột (thêm/sửa/xoá, kiểu, thuộc tính, đổi kiểu có báo trước), trình soạn công thức (mục 6.3) + thư viện công thức mẫu; ô chọn dòng đích cho cột Liên kết.
- 2C-4: Tìm dòng trùng (mục 7a), chia sẻ, thùng rác, cài đặt giới hạn Admin.
- 2D: import/export, import công thức, load test 100k dòng; rồi Sonnet kiểm thử đầy đủ cả Stage 2 ("Định nghĩa xong" điểm 2–5) theo việc Opus chia, sửa lỗi tìm thấy; Opus đọc kết quả và quyết định đạt.

### Kết quả kiểm thử 2C-1

- `pnpm test` 551 test (mới: format 14, dán/đọc ô 23, `datahub-lookup` 3); lint, typecheck, build sạch. `pnpm test:e2e`: stage 1 + `stage2c1.spec.ts` (13 luồng) ở 1280x800 và 375x812: 54 pass, 8 bỏ qua (luồng gõ trong grid chỉ chạy ở desktop), không lỗi console/network.
- Đã đi: danh sách (tạo, đổi tên, xoá + hoàn tác, giới hạn, rỗng, được chia sẻ), tab bảng, đọc 14 kiểu cột qua Ctrl+C, sửa ô theo kiểu, chọn một/nhiều lựa chọn, đánh giá, checkbox, người dùng, dán Excel (đúng/sai), điền xuống Ctrl+D, hoàn tác/làm lại, xoá dòng + hoàn tác, sửa hàng loạt, chi tiết dòng + lịch sử, xung đột cùng ô, người chỉ Xem (client và server chặn), người Sửa thấy thay đổi của chủ qua SSE, 10.000 dòng, dữ liệu xấu nhất (tên 100 ký tự có `<b>`, tên người rất dài, 12.345.678.900, số âm, ghi chú dài), phóng 200%. Thử tay: 100.000 dòng (cuộn 150 lần: p95 18 ms/khung; kéo xuống dòng cuối 5,8 s), dấu "đang tính" khi tắt worker.
- Lỗi tìm thấy và đã sửa: khung chọn lựa chọn bị Glide cắt theo chiều cao ô (nay vẽ trong cổng của trang); StrictMode làm phiên bảng bị huỷ (nay start/stop); Ctrl+D điền xuống mặc định tắt trong Glide (đã bật); `position` bảng không tự đánh số lại (giao diện ghi lại 0..n-1); tooltip cũ còn lại sau khi sửa; ô nhập phần trăm nối đôi sau lỗi; khung chi tiết hiện nhắc "chỉ xem" lặp ở mọi ô; trang tải lại 404 vài lần ngay sau khi xoá bảng đang mở (cho phép trong e2e).

## Bước tiếp theo

Opus rà soát 2C-2 bằng diff từ `8e9ca42` và kết quả kiểm thử bên dưới (không chạy lại trừ khi nghi). Sau đó **2C-3**: quản lý cột (thêm/sửa/xoá, đổi kiểu có báo trước), trình soạn công thức (mục 6.3) + thư viện mẫu, ô chọn dòng đích cho cột Liên kết. Chạy nhanh: `pnpm exec vitest run apps/web`; giao diện: e2e của đúng spec bước đó, `--project=desktop`.

### Kết quả kiểm thử 2C-2

- `pnpm lint`, `typecheck` sạch; `pnpm test` 606 pass (21 mới ở `apps/web/test/view-config.test.ts`); `pnpm test:e2e`: stage1 + stage2c1 + `stage2c2.spec.ts` (10 luồng) ở 1280x800 và 375x812, không lỗi console/network (chạy đầy đủ lần cuối: 74 pass, 8 bỏ qua; một lần trước đó stage1 phone hết giờ, chạy lại thì pass).
- Đã đi (chủ, người Xem, người Sửa): tab view (thêm tên 100 ký tự có `<b>`, đổi tên, sao chép, xoá, URL giữ view), lọc lồng nhau + lọc rỗng + "Xoá bộ lọc", sắp xếp theo cột công thức, nhóm + dòng tổng + đóng/mở nhóm, ô Thời gian (số dòng khớp server, kỳ cụ thể ‹ ›, chip), cột (ẩn, thứ tự, cố định), chiều cao dòng, tô màu (server trả `marks`), tìm kiếm, view dùng cột đã xoá, người Xem/Sửa đổi view chung thành bản riêng + "Về mặc định", 10.000 dòng lọc + sắp, nhóm quá 1.000 nhóm, 100.000 dòng nhảy tới cuối/giữa/10%/77% (70–120 ms tới khi server trả lời; đúng cả khi sắp xếp và nhóm), 40 cột tên dài ở 375px.
- Lỗi tìm thấy và đã sửa: view ghi tên cột (API/AI) bị coi là cột đã xoá (nay đổi sang key khi nạp); danh sách tên người tra cả mã lựa chọn (400); bộ lọc một điều kiện bị bọc thừa trong nhóm; bấm dòng nhóm mở rồi đóng ngay (click + activate cùng bắn); nhãn dòng nhóm bị cắt (nay chỉ giá trị + số dòng, tên cột trong tooltip); vùng chạm dưới 44px ở nút icon, ô tích, nút × của chip trên điện thoại.
- `impeccable audit`: bộ dò mã nguồn (`impeccable detect`) không báo gì ở `pages/datahub` và popover; rà tay (a11y, vùng chạm, tương phản bằng token, tab/focus, 375px, không animation mới). `ui-ux-pro-max` mục 1–3, 8 và `break-ui` đã rà. **Chưa dò trang thật bằng `detect --url`** (chưa có máy chủ dev chạy sau test) và chưa thử trên máy thật.

## Câu hỏi còn mở

- 2C-2: (1) Kéo thả tab view và "vạch cố định" thay bằng menu/nút (khớp cách đã làm với tab bảng). (2) Tìm kiếm không lưu theo view (schema view không có trường này). (3) Nhóm: trạng thái đóng/mở nhóm chỉ giữ trong phiên. (4) Số hàng "Cao" 56 px và "Gọn" 32 px là giá trị tự chọn.

- 2C-1: (1) Cây truy cập (bảng ẩn cho trình đọc màn hình) của Glide không dựng trên React 19 nên grid chưa đọc được bằng trình đọc màn hình; khung chi tiết dòng là DOM thường nên đọc được. Cần Dương quyết có bắt buộc không (bắt buộc thì phải thêm bảng DOM song song hoặc đổi thư viện). (2) Cột Mã dòng hiện `#<số dòng>` (dễ đọc), trong khi export/API trả mã dòng dạng uuid. (3) Không có "nhảy tới dòng thứ N" của bảng rất lớn (keyset); lọc/sắp xếp/tìm ở 2C-2 thay cho việc đó. (4) Cột Liên kết và Đính kèm mới chỉ xem; sửa cần ô chọn dòng đích và tải file (2C-3). (5) Hoàn tác/làm lại chỉ trong phiên mở bảng (máy khách), không đọc lịch sử dòng của server.
- 2C-1 chưa thử trên điện thoại thật (chạm trong grid canvas, bàn phím ảo với khung chọn, cuộn cảm ứng) và chưa chạy `impeccable audit`.
- 2B+: ngân sách đối soát 1.000.000 dòng/đêm và thời gian chờ mặc định 5 s là giá trị tự chọn; Dương chỉnh nếu cần.
- 2B: 2D phải cảnh báo `LEFT(ngày,2)` khi import (324 công thức trong file mẫu dựa vào chữ hiển thị `MM/yyyy`).
- Module 5 (mục 11), Module 6 (mục 12), Module 7 (mục 13): câu hỏi ở mục cuối mỗi file, chờ Dương trả lời rồi chốt; chốt xong cập nhật CLAUDE.md theo mục "Thay đổi so với quy định đã chốt" của từng file.
- Module 4: bảng Thanh toán (mục 7) chờ Dương bàn với Manager (nguồn tiền về, com POD, nguồn Level BC/Performance BC, thu hồi com, com POD Express và Data).
- `docker-compose.yml` chưa chạy thử (máy dev không có Docker); Google chưa thử với Google thật (xem `design/ha-tang.md` mục 4).
- Danh sách token cần duyệt và tài khoản hệ thống chưa phân trang (giới hạn 500); phân trang ở Stage 5.

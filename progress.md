# Tiến độ

Cập nhật: 19/11/2026

## Giai đoạn hiện tại

- Thiết kế: Module 0–4 đã chốt (Module 4 chốt 19/11, mục 7 Thanh toán còn là khung). **Module 5, 6: bản nháp vòng 1 xong** (`design/module5-ket-noi-ai.md`, `design/module6-thong-bao.md`, 19/11), chờ Dương phản biện. **Module 7 đã chốt** (19/11; CLAUDE.md, Module 0, 4 đã ghi thay đổi; Module 2 mục 11 chưa ghi giới hạn 150 cột vì Sonnet đang sửa file đó, ghi khi rảnh). Câu hỏi ở mục cuối mỗi file.
- Code: Stage 0 và Stage 1 xong. Stage 2: 2A, 2B, 2B+, 2C-1 xong và Opus đã rà soát (19/11); **2C-2 đang làm dở (Sonnet, hết quota giữa chừng)**; 2C-3, 2C-4, 2D chưa làm. Dương yêu cầu: làm xong 2B+ và 2C rồi push lên `main` và báo.

## Ghi chú điều phối (Opus) — đọc trước khi làm tiếp

1. 2A đã push `main` + `dev`. 2B+ Opus đã rà soát (19/11): đạt, `pnpm lint`/`typecheck`/`test` 511 pass. 2C-1 Opus đã rà soát: đạt, còn 3 việc chuyển sang phần sau: (a) kéo thanh cuộn xuống cuối bảng 100.000 dòng mất 5,8 s, yêu cầu nhảy tới vị trí bất kỳ < 1 s (đọc thẳng cửa sổ quanh vị trí, đúng cả khi lọc/sắp/nhóm) — giao trong 2C-2; (b) cột Liên kết, Đính kèm sửa được — 2C-3; (c) `impeccable audit` cho grid — 2C-2.
2. **2C-2 đang dở (19/11, Sonnet hết quota).** Phần đã có, CHƯA chạy test, commit dạng WIP `2C-2 (dở)`: `packages/shared/src/time-filter.ts` + test, `apps/api/src/modules/datahub/time-filter.ts`, `rows-groups.ts` (nhóm + dòng tổng), sửa `rows-read.ts`, `row-ops.ts`, `collab.ts`, `limits.ts`, `index.ts`, `packages/db/src/query/keyset.ts`, `packages/shared/src/filter.ts`, test `datahub-view-query.test.ts`, `datahub-perf.test.ts`. Chưa có giao diện thanh công cụ. Phiên sau: đọc diff commit WIP, chạy `pnpm typecheck` và `pnpm exec vitest run packages/shared apps/api/test/datahub-view-query apps/api/test/datahub-perf`, sửa cho pass, rồi làm tiếp đủ việc 2C-2 (mục "Đang làm" bên dưới, kèm (a), (c) ở điểm 1). Sau đó 2C-3, 2C-4, rồi Opus rà soát và push `main` theo yêu cầu của Dương.
3. Ghi nhớ cho các phần sau của Stage 2:
   - 2B: golden test được đọc thẳng `examples/Quản lý Deal SoE (Dương TVD).xlsx` (Dương cho phép), không commit dữ liệu lấy từ file, máy không có file thì test tự bỏ qua.
   - 2C: làm cả công cụ **Tìm dòng trùng** (Module 2 mục 7a).
   - 2C: làm cả ô **Lọc theo thời gian** (Module 2 mục 5.4, bổ sung 18/11): lưu trong `config.time_filter` của view, server dịch sang `between`/toán tử ngày; không cần đổi schema.
   - Bảng gộp thuộc Stage 3 (Module 3 mục 4), không làm ở Stage 2.
4. **Module 4 đã chốt (19/11)**; CLAUDE.md và Module 1 đã ghi các thay đổi của mục 18. Khi code Stage 4 làm mục 19 (đối chiếu Module 2).
5. Golden test 2B đã làm (đọc file mẫu, 3.322 công thức); số liệu và hai điểm lạ của file mẫu ở `design/module2-datahub.md` mục 2B.

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
- **2C-2 (đang dở, xem điều phối điểm 2)**: sửa nhảy cuộn < 1 s; thanh công cụ view (tab view, lọc lồng nhau, ô Thời gian mục 5.4, sắp xếp nhiều cấp, nhóm + dòng tổng, ẩn/cố định/kéo thứ tự/độ rộng cột, chiều cao dòng, tô màu theo điều kiện), tự lưu theo mục 5.2.
- 2C-3: quản lý cột (thêm/sửa/xoá, kiểu, thuộc tính, đổi kiểu có báo trước), trình soạn công thức (mục 6.3) + thư viện công thức mẫu; ô chọn dòng đích cho cột Liên kết.
- 2C-4: Tìm dòng trùng (mục 7a), chia sẻ, thùng rác, cài đặt giới hạn Admin; kiểm thử giao diện cả 2C theo "Định nghĩa xong" điểm 5.
- 2D: import/export, import công thức, load test 100k dòng, e2e cả stage.

### Kết quả kiểm thử 2C-1

- `pnpm test` 551 test (mới: format 14, dán/đọc ô 23, `datahub-lookup` 3); lint, typecheck, build sạch. `pnpm test:e2e`: stage 1 + `stage2c1.spec.ts` (13 luồng) ở 1280x800 và 375x812: 54 pass, 8 bỏ qua (luồng gõ trong grid chỉ chạy ở desktop), không lỗi console/network.
- Đã đi: danh sách (tạo, đổi tên, xoá + hoàn tác, giới hạn, rỗng, được chia sẻ), tab bảng, đọc 14 kiểu cột qua Ctrl+C, sửa ô theo kiểu, chọn một/nhiều lựa chọn, đánh giá, checkbox, người dùng, dán Excel (đúng/sai), điền xuống Ctrl+D, hoàn tác/làm lại, xoá dòng + hoàn tác, sửa hàng loạt, chi tiết dòng + lịch sử, xung đột cùng ô, người chỉ Xem (client và server chặn), người Sửa thấy thay đổi của chủ qua SSE, 10.000 dòng, dữ liệu xấu nhất (tên 100 ký tự có `<b>`, tên người rất dài, 12.345.678.900, số âm, ghi chú dài), phóng 200%. Thử tay: 100.000 dòng (cuộn 150 lần: p95 18 ms/khung; kéo xuống dòng cuối 5,8 s), dấu "đang tính" khi tắt worker.
- Lỗi tìm thấy và đã sửa: khung chọn lựa chọn bị Glide cắt theo chiều cao ô (nay vẽ trong cổng của trang); StrictMode làm phiên bảng bị huỷ (nay start/stop); Ctrl+D điền xuống mặc định tắt trong Glide (đã bật); `position` bảng không tự đánh số lại (giao diện ghi lại 0..n-1); tooltip cũ còn lại sau khi sửa; ô nhập phần trăm nối đôi sau lỗi; khung chi tiết hiện nhắc "chỉ xem" lặp ở mọi ô; trang tải lại 404 vài lần ngay sau khi xoá bảng đang mở (cho phép trong e2e).

## Bước tiếp theo

**Làm tiếp 2C-2** từ commit WIP (điều phối điểm 2): dùng `data-slot="view-tools"` trong `apps/web/src/pages/datahub/table-view.tsx` làm thanh công cụ view; `TableSession` (`apps/web/src/lib/datahub/session.ts`) nhận `query` (`filter`, `sort`, `search`) khi tạo, đổi view thì tạo phiên mới; lưu view qua `datahub.view.update` (API đã có), đọc `datahub.view.list`. Chạy test nhanh: `pnpm exec vitest run apps/web packages/shared apps/api/test/datahub-lookup`; giao diện: `pnpm test:e2e stage2c1`.

## Câu hỏi còn mở

- 2C-1: (1) Cây truy cập (bảng ẩn cho trình đọc màn hình) của Glide không dựng trên React 19 nên grid chưa đọc được bằng trình đọc màn hình; khung chi tiết dòng là DOM thường nên đọc được. Cần Dương quyết có bắt buộc không (bắt buộc thì phải thêm bảng DOM song song hoặc đổi thư viện). (2) Cột Mã dòng hiện `#<số dòng>` (dễ đọc), trong khi export/API trả mã dòng dạng uuid. (3) Không có "nhảy tới dòng thứ N" của bảng rất lớn (keyset); lọc/sắp xếp/tìm ở 2C-2 thay cho việc đó. (4) Cột Liên kết và Đính kèm mới chỉ xem; sửa cần ô chọn dòng đích và tải file (2C-3). (5) Hoàn tác/làm lại chỉ trong phiên mở bảng (máy khách), không đọc lịch sử dòng của server.
- 2C-1 chưa thử trên điện thoại thật (chạm trong grid canvas, bàn phím ảo với khung chọn, cuộn cảm ứng) và chưa chạy `impeccable audit`.
- 2B+: ngân sách đối soát 1.000.000 dòng/đêm và thời gian chờ mặc định 5 s là giá trị tự chọn; Dương chỉnh nếu cần.
- 2B: 2D phải cảnh báo `LEFT(ngày,2)` khi import (324 công thức trong file mẫu dựa vào chữ hiển thị `MM/yyyy`).
- Module 5 (mục 11), Module 6 (mục 12), Module 7 (mục 13): câu hỏi ở mục cuối mỗi file, chờ Dương trả lời rồi chốt; chốt xong cập nhật CLAUDE.md theo mục "Thay đổi so với quy định đã chốt" của từng file.
- Module 4: bảng Thanh toán (mục 7) chờ Dương bàn với Manager (nguồn tiền về, com POD, nguồn Level BC/Performance BC, thu hồi com, com POD Express và Data).
- `docker-compose.yml` chưa chạy thử (máy dev không có Docker); Google chưa thử với Google thật (xem `design/ha-tang.md` mục 4).
- Danh sách token cần duyệt và tài khoản hệ thống chưa phân trang (giới hạn 500); phân trang ở Stage 5.

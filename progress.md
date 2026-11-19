# Tiến độ

Cập nhật: 19/11/2026

## Giai đoạn hiện tại

- Thiết kế: Module 0–4 đã chốt (Module 4 chốt 19/11, mục 7 Thanh toán còn là khung). **Module 5, 6: bản nháp vòng 1 xong** (`design/module5-ket-noi-ai.md`, `design/module6-thong-bao.md`, 19/11), chờ Dương phản biện. **Module 7 đã chốt** (19/11; CLAUDE.md, Module 0, 4 đã ghi thay đổi; Module 2 mục 11 chưa ghi giới hạn 150 cột vì Sonnet đang sửa file đó, ghi khi rảnh). Câu hỏi ở mục cuối mỗi file.
- Code: Stage 0 và Stage 1 xong. Stage 2: 2A, 2B, 2B+, 2C-1, 2C-2 xong và Opus đã rà soát (19/11); **2C-3, 2C-4 xong, Opus đã rà (19/11)**; tiếp 2D, rồi 2E. Dương yêu cầu: làm xong 2B+ và 2C rồi push lên `main` và báo.

## Ghi chú điều phối (Opus) — đọc trước khi làm tiếp

1. 2A đã push `main` + `dev`. 2B+ Opus đã rà soát (19/11): đạt, `pnpm lint`/`typecheck`/`test` 511 pass. 2C-1 Opus đã rà soát: đạt, còn 3 việc chuyển sang phần sau: (a) kéo thanh cuộn xuống cuối bảng 100.000 dòng mất 5,8 s, yêu cầu nhảy tới vị trí bất kỳ < 1 s (đọc thẳng cửa sổ quanh vị trí, đúng cả khi lọc/sắp/nhóm) — giao trong 2C-2; (b) cột Liên kết, Đính kèm sửa được — 2C-3; (c) `impeccable audit` cho grid — 2C-2.
2. **2C-2, 2C-3 xong, Opus đã rà (19/11)**. 2C-3: rà lần 1 tìm 3 lỗi (quyền ghi mã file ở ô Đính kèm, hồi quy bộ chọn e2e 2C-2, liên kết chỉ cùng datahub), đã sửa (106488a, 05b9202); Opus chạy lại 216 test API Datahub pass. 2C-4 Opus rà 19/11: đạt (đọc diff, đối chiếu thiết kế mục 7a/10/11; tự chạy lại typecheck, eslint, 11 unit pass; không bắt buộc chạy lại e2e vì không đụng `components/ui`, engine hay phân quyền, server chỉ sửa lint). **Tiếp: 2D (Sonnet).** Sau đó 2E, rồi Opus rà và push `main` theo yêu cầu của Dương. Nguyên tắc thêm: bước con đụng thành phần dùng chung thì chạy lại e2e desktop của mọi spec dùng thành phần đó.
3. Ghi nhớ cho các phần sau của Stage 2:
   - 2B: golden test được đọc thẳng `examples/Quản lý Deal SoE (Dương TVD).xlsx` (Dương cho phép), không commit dữ liệu lấy từ file, máy không có file thì test tự bỏ qua.
   - 2C: làm cả công cụ **Tìm dòng trùng** (Module 2 mục 7a).
   - 2C: làm cả ô **Lọc theo thời gian** (Module 2 mục 5.4, bổ sung 18/11): lưu trong `config.time_filter` của view, server dịch sang `between`/toán tử ngày; không cần đổi schema.
   - Bảng gộp thuộc Stage 3 (Module 3 mục 4), không làm ở Stage 2.
4. **Module 4 đã chốt (19/11)**; CLAUDE.md và Module 1 đã ghi các thay đổi của mục 18. Khi code Stage 4 làm mục 19 (đối chiếu Module 2).
5. **Từ 19/11 kiểm thử theo cấp** (`CLAUDE.md` mục "Kiểm thử theo cấp"): bước con Sonnet chỉ test nhanh ở desktop; Opus rà bằng diff + kết quả; kiểm thử đầy đủ (cả bộ e2e, 375px, skill, `break-ui`) làm một lần ở bước con riêng **2E**: Sonnet chạy, Opus điều phối, đọc kết quả và quyết định đạt. Chuẩn giao diện đã tách sang `design/chuan-giao-dien.md`.
6. Golden test 2B đã làm (đọc file mẫu, 3.322 công thức); số liệu và hai điểm lạ của file mẫu ở `design/module2-quyet-dinh-khi-code.md` mục 2B.

## Đã xong

- Phân tích brief, file mẫu, chốt tech stack, thiết kế Module 0–4, hạ tầng.
- **Stage 0 xong**: monorepo, schema + migration, registry, audit append-only, lịch sử dòng, outbox, worker pg-boss, SSE, file, OpenAPI, Docker/compose/Caddy.
- **Stage 1 xong**: API và web của tài khoản, org chart, vai trò, phiên, mã kích hoạt, token, thông báo, nhật ký, chuyển giao, cài đặt (302 test, e2e 16 luồng x 2 bề ngang, 10 lỗi tìm thấy đã sửa). Chưa thử: chuyển cả cây bằng giao diện, đăng nhập Google, `docker-compose.yml`. Quyết định ở `design/module1-tai-khoan-phan-quyen.md`.
- **2A xong** (đã rà soát): schema, kiểu cột, API cấu trúc và dòng, SSE, chuyển giao, view SQL, index tự động; 100.000 dòng đọc 3–44 ms, trang keyset 2,7 ms.
- **2B xong** (đã rà soát): công thức (106 hàm), cột công thức/liên kết/lookup/rollup, tính lại, golden test 3.322 công thức (3.321 khớp Excel). Chi tiết ở `design/module2-quyet-dinh-khi-code.md` mục 2B.
- **2B+ xong** (đã rà soát): tính lại theo phần, sự kiện `dòng, cột, cũ → mới`, `seq` và đợi tính xong, `pending` theo ô, đối soát hằng đêm; sửa 1 dòng nguồn ở bảng 100.000 dòng, 6 cột phụ thuộc: ghi 9 ms, worker 43 ms. Chi tiết mục 2B+.
- **2C-1 xong** (đã rà soát, 19/11; kết quả kiểm thử xem git log `2C-1 xong`): xem `design/module2-quyet-dinh-khi-code.md` mục "Stage 2C-1".

## Đang làm: Stage 2C (giao diện Datahub), Sonnet code

- **2C-1 xong**: danh sách datahub, trang datahub (tab bảng, URL gửi được), grid Glide ảo hoá đọc keyset (100.000 dòng cuộn 60 fps), mọi kiểu cột, ô "đang tính", sửa ô/dán/điền xuống/sửa hàng loạt/xoá + Hoàn tác/hoàn tác-làm lại, khung chi tiết dòng + lịch sử, SSE; API mới `datahub.people.lookup`, `datahub.relation.labels`, `datahub.row.restore_batch`.
- **2C-2 xong, Opus đã rà (19/11)**: nhảy cuộn bảng 100.000 dòng 70–120 ms; tab view, lọc lồng nhau, ô Thời gian, sắp xếp nhiều cấp, nhóm + dòng tổng, cột, chiều cao dòng, tô màu, tìm kiếm, tự lưu và bản riêng. Chi tiết `design/module2-quyet-dinh-khi-code.md` mục "Stage 2C-2".
- **2C-3 xong, sửa lại theo rà soát của Opus (3 việc, 19/11), chờ Opus rà lại**: quản lý cột (thêm/sửa/xoá có Hoàn tác, mọi kiểu, đổi kiểu báo trước), trình soạn công thức (gợi ý, cú pháp, lỗi gạch chân, xem trước, mẫu, chèn tham chiếu), Liên kết/Lookup/Rollup, ô chọn dòng đích ảo hoá, ô Đính kèm tải lên/tải về, phân quyền người Xem/Sửa. API mới `datahub.relation.search`, `datahub.attachment.list`, `datahub.attachment.download_url`. Chi tiết `design/module2-quyet-dinh-khi-code.md` mục "Stage 2C-3".
- **2C-4 xong, Opus đã rà (19/11)**: Tìm dòng trùng, Chia sẻ, Thùng rác, giới hạn Admin theo người, e2e `stage2c4`. Chi tiết `design/module2-quyet-dinh-khi-code.md` mục "Stage 2C-4".
- **2D (Sonnet, đang làm)**: kế hoạch (đánh dấu [x] khi xong):
  - [x] 1 Hạ tầng việc nền: bảng `dh_jobs` (migration 0009), `storage.put/read`, vòng lặp worker nhận việc, lệnh `datahub.job.*` (`modules/datahub/jobs.ts`)
  - [x] 2 Export CSV/XLSX/JSON (theo bảng/view/datahub, nền) + test + phân quyền (`export-job.ts`, `apps/api/test/datahub-export.test.ts` 9 pass)
  - [x] 3 Import: đọc xlsx/csv/dán/link Google Sheet (`import-read.ts` đọc xlsx riêng), `datahub.import.analyze|sheet|preview|start` (`import-job.ts`, `import-plan.ts`), chạy nền; `datahub-import.test.ts` 16 pass
  - [x] 4 Import công thức (`excel-formula.ts`; lý do từng cột; cảnh báo `LEFT(ngày,2)`); golden trên file mẫu `datahub-import-golden.test.ts` (Index: 34 cột công thức, 7 giữ giá trị kèm lý do)
  - [x] 5 Giao diện: hộp thoại Import 5 bước (`import-dialog.tsx`), hộp thoại Export (`export-dialog.tsx`), nút ở danh sách datahub/trang datahub/bảng
  - [x] 6 e2e `stage2d.spec.ts` 5/5 pass x3 (desktop), Bruno, OpenAPI
  - [ ] 7 Load test 100.000 dòng, ghi "Stage 2D" vào quyết định khi code
- 2E: Sonnet kiểm thử **chức năng** cả Stage 2 ("Định nghĩa xong" điểm 2–5; không rà chuẩn giao diện, để Stage 12) theo việc Opus chia, sửa lỗi tìm thấy; Opus đọc kết quả và quyết định đạt.

## Bước tiếp theo

**2D đang làm: bước 7**: load test 100.000 dòng (import + export) bằng `apps/api/test/datahub-import-export-perf.test.ts` (tạo file này), ghi số đo và mục "Stage 2D" vào `design/module2-quyet-dinh-khi-code.md`; chạy lại `pnpm exec vitest run apps/api/test/datahub-*` phần đụng tới. Rồi 2E.

2C-4 xong và đã rà (xem git log). Chưa làm: xoá hẳn ngay, gợi ý người theo team (`Lệch hoặc bổ sung` mục 2C-4); `form.table_max_columns` chờ Module 7.

### Việc cho kiểm thử cuối Stage 2 (dời từ 2C-2)

- (Dời sang Stage 12) `impeccable detect --url` cho grid + thanh công cụ view.
- Theo dõi lỗi hết giờ `stage1.spec.ts` phone "cài đặt hệ thống" (thấy 1 lần, chạy lại thì pass; có thể cùng nguyên nhân Vite tải lại trang, đã sửa ở `vite.config.ts`).

### Kết quả kiểm thử 2C-2, 2C-3

Chi tiết (luồng đã đi, lỗi đã sửa, số test) ở git log (`2C-2`, `2C-3`) và `design/module2-quyet-dinh-khi-code.md`. Còn mở từ 2C-3: `stage2c3.spec.ts` luồng 2 chập chờn 1 lần (không tái hiện sau 10 lần chạy; đã đổi sang `expect.poll`). Nếu thấy lại thì ghi log máy chủ.

## Lỗi điện thoại để sau

Không chặn bước con (CLAUDE.md, "Điện thoại là ưu tiên thấp"); gom sửa một đợt, Opus quyết khi nào.

- `stage1.spec.ts` phone "cài đặt hệ thống" hết giờ 1 lần, chạy lại pass; nghi cùng nguyên nhân Vite tải lại trang (đã sửa ở f8835de), chưa xác minh. Lệnh: `pnpm test:e2e stage1 --project=phone`. Sau f8835de: 3 lần liền 16/16 pass (19/11, chạy trong 2C-3), chưa thấy fail lại.

## Câu hỏi còn mở

- **Test chập chờn cần sửa (quy định 19/11):** (1) Ca Opus chạy lại sau 2C-2: `stage2c2.spec.ts:366` (luồng 100.000 dòng) fail 2/2 lần, `.dvn-scroller` null. Nguyên nhân: Vite tải lại trang khi Playwright ghi trace vào `apps/web/e2e/results/`; đã sửa ở `vite.config.ts` (f8835de), sau đó 3/3 lần pass. **Đã xong.** (2) Ca `stage1` điện thoại chuyển sang mục "Lỗi điện thoại để sau".
- 2C-1: (1) Cây truy cập (bảng ẩn cho trình đọc màn hình) của Glide không dựng trên React 19 nên grid chưa đọc được bằng trình đọc màn hình; khung chi tiết dòng là DOM thường nên đọc được. Cần Dương quyết có bắt buộc không (bắt buộc thì phải thêm bảng DOM song song hoặc đổi thư viện). (2) Cột Mã dòng hiện `#<số dòng>` (dễ đọc), trong khi export/API trả mã dòng dạng uuid. (3) Không có "nhảy tới dòng thứ N" của bảng rất lớn (keyset); lọc/sắp xếp/tìm ở 2C-2 thay cho việc đó. (4) Cột Liên kết và Đính kèm mới chỉ xem; sửa cần ô chọn dòng đích và tải file (2C-3). (5) Hoàn tác/làm lại chỉ trong phiên mở bảng (máy khách), không đọc lịch sử dòng của server.
- 2C-1 chưa thử trên điện thoại thật (chạm trong grid canvas, bàn phím ảo với khung chọn, cuộn cảm ứng) và chưa chạy `impeccable audit`.
- 2B+: ngân sách đối soát 1.000.000 dòng/đêm và thời gian chờ mặc định 5 s là giá trị tự chọn; Dương chỉnh nếu cần.
- 2B: 2D phải cảnh báo `LEFT(ngày,2)` khi import (324 công thức trong file mẫu dựa vào chữ hiển thị `MM/yyyy`).
- Module 5 (mục 11), Module 6 (mục 12), Module 7 (mục 13): câu hỏi ở mục cuối mỗi file, chờ Dương trả lời rồi chốt; chốt xong cập nhật CLAUDE.md theo mục "Thay đổi so với quy định đã chốt" của từng file.
- Module 4: bảng Thanh toán (mục 7) chờ Dương bàn với Manager (nguồn tiền về, com POD, nguồn Level BC/Performance BC, thu hồi com, com POD Express và Data).
- `docker-compose.yml` chưa chạy thử (máy dev không có Docker); Google chưa thử với Google thật (xem `design/ha-tang.md` mục 4).
- Danh sách token cần duyệt và tài khoản hệ thống chưa phân trang (giới hạn 500); phân trang ở Stage 5.

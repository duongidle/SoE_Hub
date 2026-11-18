# Tiến độ

Cập nhật: 19/11/2026

## Giai đoạn hiện tại

- Thiết kế: Module 0–4 đã chốt (Module 4 chốt 19/11, mục 7 Thanh toán còn là khung). **Module 5, 6: bản nháp vòng 1 xong** (`design/module5-ket-noi-ai.md`, `design/module6-thong-bao.md`, 19/11), chờ Dương phản biện. **Module 7 đã chốt** (19/11; CLAUDE.md, Module 0, 4 đã ghi thay đổi; Module 2 mục 11 chưa ghi giới hạn 150 cột vì Sonnet đang sửa file đó, ghi khi rảnh). Câu hỏi ở mục cuối mỗi file.
- Code: Stage 0 và Stage 1 xong. Stage 2: 2A xong và đã rà soát; **2B và 2B+ code xong, chờ Opus rà soát**; 2C, 2D chưa làm.

## Ghi chú điều phối (Opus) — đọc trước khi làm tiếp

1. 2A đã rà soát, đã push `main` + `dev`. **2B và 2B+ code xong (19/11), chờ Opus rà soát**, báo Dương, chờ Dương bảo mới làm 2C. Nếu phiên bị ngắt: xem `git status`, `git log`, danh sách bước 2B bên dưới.
3. Ghi nhớ cho các phần sau của Stage 2:
   - 2B: golden test được đọc thẳng `examples/Quản lý Deal SoE (Dương TVD).xlsx` (Dương cho phép), không commit dữ liệu lấy từ file, máy không có file thì test tự bỏ qua.
   - 2C: làm cả công cụ **Tìm dòng trùng** (Module 2 mục 7a).
   - 2C: làm cả ô **Lọc theo thời gian** (Module 2 mục 5.4, bổ sung 18/11): lưu trong `config.time_filter` của view, server dịch sang `between`/toán tử ngày; không cần đổi schema.
   - Bảng gộp thuộc Stage 3 (Module 3 mục 4), không làm ở Stage 2.
4. **Module 4 đã chốt (19/11)**; CLAUDE.md và Module 1 đã ghi các thay đổi của mục 18. Khi code Stage 4 làm mục 19 (đối chiếu Module 2).
5. Golden test 2B đã làm (đọc file mẫu, 3.322 công thức); số liệu và hai điểm lạ của file mẫu ở `design/module2-datahub.md` mục 2B.

## Đã xong

- Phân tích brief, file mẫu, chốt tech stack, thiết kế Module 0, hạ tầng, Module 1, Module 2.
- **Stage 0 xong**: monorepo, schema + migration, registry, audit append-only, lịch sử dòng, outbox, worker pg-boss, SSE, file, OpenAPI, Docker/compose/Caddy.
- **Stage 1 xong**:
  - API: tài khoản, org chart, vai trò, quyền bổ sung, phiên + CSRF, mã kích hoạt/quên mật khẩu, Google (tắt mặc định), token cá nhân + duyệt, tài khoản hệ thống, thông báo, cấp dữ liệu Guest (khung), chuyển giao, nhật ký + xuất CSV, cài đặt, CLI `admin:create` / `auth:reset-code`. Bruno + OpenAPI đủ.
  - Web: shell chặn route theo đăng nhập và quyền, chuông SSE, menu theo quyền; đăng nhập/đăng ký/quên mật khẩu/đặt mật khẩu; org chart; tài khoản, token, thông báo; Admin: duyệt token, tài khoản hệ thống, nhật ký, chuyển giao, cài đặt; Manager: cấp dữ liệu Guest (trống).
  - Cấu hình: `AUTH_SECRET` (bắt buộc ở production, có test), `GOOGLE_*`, `SESSION_*` trong `.env.example` và `docker-compose.yml`; README có cách tạo Admin đầu tiên, đặt lại mật khẩu Admin duy nhất, chạy test, chạy test giao diện.
  - "Quyết định khi code" của Module 1 đã ghi vào `design/module1-tai-khoan-phan-quyen.md`.

### Kết quả kiểm thử Stage 1 (tóm tắt, chi tiết trong git log)

- 302 test pass; `pnpm test:e2e` 16 luồng x 2 bề ngang = 32 pass, không lỗi console/network; 10 lỗi tìm thấy khi chạy giao diện thật đã sửa. Chưa thử: chuyển cả cây bằng giao diện, đăng nhập Google, `docker-compose.yml`.

## Đang làm: Stage 2 (Module 2 – Datahub), do Sonnet code, Opus rà soát

Kế hoạch Stage 2:
- **2A – Lưu trữ và API lõi** (xong, đã rà soát).
- **2B – Engine công thức, cột tính toán, tính lại, golden test** (code xong, chờ Opus rà soát).
- **2B+ – Tính lại theo phần, nhật ký thay đổi, đợi tính xong** (Module 2 mục 6.7): **xong 19/11, chờ Opus rà soát**. Cả 5 bước đã xong và commit; quyết định ghi ở `design/module2-datahub.md` mục "Stage 2B+".
- 2C – Giao diện grid, view kiểu Lark tự lưu, trình soạn công thức, chia sẻ/thùng rác/giới hạn.
- 2D – Import/export, import công thức, load test 100k dòng, e2e cả stage.

2A: 6 bước đã xong (schema, kiểu cột, API cấu trúc, API dòng, SSE/chuyển giao/view SQL/index tự động, test và tài liệu).

### Kết quả kiểm thử 2A (tóm tắt)

- 396 test pass; test tốc độ 100.000 dòng (`datahub-perf.test.ts`): trước index 23–81 ms, sau index tự động 3–44 ms, trang keyset 2,7 ms; nạp 100.000 dòng 3,4 s. 4 lỗi test phụ thuộc thứ tự đã sửa.

## Đang làm: Stage 2C (giao diện Datahub), Sonnet code (bắt đầu 19/11)

Kế hoạch 2C (4 phần, mỗi phần commit riêng):
- **2C-1** (đang làm): trang danh sách datahub, trang datahub (tab bảng), grid ảo hoá, sửa ô, chi tiết dòng + lịch sử, SSE, ô "đang tính".
- 2C-2: thanh công cụ view (tab view, lọc lồng nhau, ô Thời gian mục 5.4, sắp xếp nhiều cấp, nhóm + dòng tổng, ẩn/cố định/kéo thứ tự/độ rộng cột, chiều cao dòng, tô màu theo điều kiện), tự lưu theo bảng mục 5.2.
- 2C-3: quản lý cột (thêm/sửa/xoá, kiểu, thuộc tính, đổi kiểu có báo trước), trình soạn công thức (mục 6.3) + thư viện công thức mẫu.
- 2C-4: Tìm dòng trùng (mục 7a, API + giao diện), chia sẻ, thùng rác, cài đặt giới hạn Admin; kiểm thử giao diện cả 2C theo "Định nghĩa xong" điểm 5.

Các bước 2C-1 (đánh dấu khi xong):
- [x] 1. Thư viện (Glide, fontsource, sonner, radix), định dạng vi-VN dùng chung (`packages/shared/src/format.ts`), thành phần ui (skeleton, toast, tooltip, dropdown, states, Modal radix); API mới `datahub.people.lookup`, `datahub.relation.labels`, `datahub.row.restore_batch`
- [x] 2. Trang danh sách datahub + trang datahub (tab bảng) + menu + URL (code ở `apps/web/src/pages/datahub/` và `apps/web/src/lib/datahub/`)
- [x] 3. Grid ảo hoá (Glide) đọc keyset, mọi kiểu cột, "đang tính", lỗi công thức (code xong, đang kiểm thử trình duyệt)
- [ ] 4. Sửa ô, thêm/xoá dòng, dán vùng, điền xuống, sửa hàng loạt, hoàn tác/làm lại
- [ ] 5. Chi tiết dòng + lịch sử, SSE
- [ ] 6. Test (vitest, e2e), kiểm thử giao diện, quyết định khi code

## Bước tiếp theo

**Opus rà soát 2B+** (diff từ commit `49d3b7b` trở đi), rồi chờ Dương bảo làm **2C** (giao diện grid: dùng `pending` theo ô, `consistency`, SSE `datahub.formula.recalculated`; view tự lưu; trình soạn công thức; Tìm dòng trùng; chia sẻ/thùng rác/giới hạn). Lệnh test nhanh: `pnpm exec vitest run apps/api/test/datahub-partial apps/api/test/datahub-events apps/api/test/datahub-consistency apps/api/test/datahub-reconcile`.

2B xong cả 7 bước (mỗi bước một commit trên `dev`): 1-2 `packages/formula` (parser, 106 hàm); 3-4 cột formula/relation/lookup/rollup + tính lại (`apps/api/src/modules/datahub/computed.ts`, `recalc.ts`, `row-formulas.ts`, migration `0006`); 5 gom nhóm SQL + test tốc độ; 6 golden test; 7 API `datahub.formula.functions|preview`, OpenAPI, Bruno, README, quyết định khi code (`design/module2-datahub.md` mục 2B).

Việc kế: 2C dùng `datahub.formula.preview` và `datahub.formula.functions` cho trình soạn công thức. 2D: import công thức (dịch tham chiếu Excel sang tên, cảnh báo `LEFT(ngày,2)`).

### Kết quả kiểm thử 2B

- `pnpm test`: 33 file, 475 test pass (chạy hai lần); `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm docs:openapi`, `pnpm docs:bruno` sạch. Chạy thử `node apps/api/dist/worker.js` trên DB rỗng: worker khởi động, lên lịch 2 job mới.
- Mới so với 2A: 79 test (formula 26, `datahub-formulas` 43, gom nhóm 1, tốc độ 7, golden 2). 2B chưa có giao diện nên không có test trình duyệt.
- Tốc độ 100.000 x 100.000 dòng, tính lại cả cột: SUMIFS 1,92 s; COUNTIFS 2 điều kiện 2,32 s; XLOOKUP 1,87 s; AVERAGEIFS 1,92 s; MAXIFS ngày 2,48 s; gộp 2,51 s; sửa 1 dòng nguồn rồi 6 cột phụ thuộc tính lại 4,08 s (sau khi thêm xử lý lỗi nguồn).
- Golden test: 3.322/3.322 công thức file mẫu parse và chạy, 3.321 khớp Excel (1 công thức `TODAY()` chỉ kiểm chạy).
- Sau rà soát của Opus: lỗi ở cột nguồn nay truyền đi như Excel (SQL gom nhóm và duyệt từng dòng giống nhau, test tương đương mở rộng, test rollup, test sửa nguồn thì lỗi phụ thuộc hết).
- Lỗi tìm thấy khi test và đã sửa: (1) cột kẹt `running` vì mốc claim mất phần micro giây; (2) vị trí lỗi tên hàm tính trên văn bản đã đổi sang mã; (3) `IFERROR(a/b, "")` bị suy thành cột chữ; (4) `XLOOKUP` với giá trị thay thế suy sai kiểu; (5) chữ ngày `dd/mm/yyyy` chưa ép thành số khi tính; (6) dọn thùng rác chưa xoá khoá lỗi `!<mã cột>`; (7) `DATEDIF "MD"` ra số âm.

### Kết quả kiểm thử 2B+

- `pnpm test`: 39 file, 511 test pass, chạy 2 lần; lint, typecheck, build sạch. Mới so với 2B: 36 test (`datahub-partial` + `-equivalence` 2.500 lần sửa ngẫu nhiên, `-events` 7, `-consistency` 10, `-reconcile` 3, `-queue`).
- Tốc độ (bảng 100.000 dòng, 6 cột phụ thuộc, sửa 1 dòng nguồn đổi cả khoá/số/loại/ngày): ghi 9 ms, worker 43 ms (trước 3,95 s). Tính lại cả cột 100.000 x 100.000: 2,1–2,7 s.
- Lỗi tìm thấy khi làm và đã sửa: (1) test đối soát để lại cột `TODAY()` trong DB test dùng chung làm hỏng test TODAY/NOW ở lần chạy thứ hai (phụ thuộc thứ tự); test nay xoá cột. (2) Chờ "xong tới số S" chỉ xét cột của chính nó sẽ sai với chuỗi A→B; nay đệ quy qua `dh_formula_deps`.
- Chưa có giao diện (2C); `pending`/`consistency` mới ở API.

## Câu hỏi còn mở

- 2B+: ngân sách đối soát 1.000.000 dòng/đêm và thời gian chờ mặc định 5 s là giá trị tự chọn (ghi ở "Quyết định khi code"); Dương chỉnh nếu cần. `row.create|update|restore` trả `seq` ngay trong đối tượng dòng.

- 2B: Dương đã đồng ý (b), (c), (d); (a) thay bằng mục 6.7 (2B+). 2D phải cảnh báo `LEFT(ngày,2)` khi import (324 công thức trong file mẫu dựa vào chữ hiển thị `MM/yyyy`).
- Module 5 (mục 11), Module 6 (mục 12): câu hỏi ở mục cuối mỗi file, chờ Dương trả lời rồi chốt. Chốt xong: cập nhật CLAUDE.md (bảng module, mục AI, "Định nghĩa xong", bảng Stage code) theo mục "Thay đổi so với quy định đã chốt" của từng file.
- Module 4: bảng Thanh toán (mục 7) chờ Dương bàn với Manager (nguồn tiền về, com POD theo hợp đồng hay tiền về, nguồn Level BC/Performance BC, thu hồi com, com POD Express và Data).
- `docker-compose.yml` chưa chạy thử (máy dev không có Docker): phải chạy thử trên VPS trước khi dùng thật. Biến `AUTH_SECRET` giờ bắt buộc trong compose.
- Đăng nhập Google chưa thử với Google thật; cần tạo Google Cloud client (xem `design/ha-tang.md` mục 4) rồi thử một lần trước khi bật.
- Danh sách token cần duyệt và tài khoản hệ thống chưa phân trang (giới hạn 500); phân trang ở Stage 5 khi có kết nối AI.

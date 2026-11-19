# Tiến độ

Cập nhật: 19/11/2026

## Giai đoạn hiện tại

- Thiết kế: Module 0–4 đã chốt (Module 4 chốt 19/11, mục 7 Thanh toán còn là khung). **Module 5, 6: bản nháp vòng 1 xong** (`design/module5-ket-noi-ai.md`, `design/module6-thong-bao.md`, 19/11), chờ Dương phản biện. **Module 7 đã chốt** (19/11; CLAUDE.md, Module 0, 4 đã ghi thay đổi; Module 2 mục 11 chưa ghi giới hạn 150 cột vì Sonnet đang sửa file đó, ghi khi rảnh). Câu hỏi ở mục cuối mỗi file.
- Code: Stage 0 và Stage 1 xong. Stage 2: 2A, 2B, 2B+, 2C-1, 2C-2 xong và Opus đã rà soát (19/11); **2C-3, 2C-4 xong, Opus đã rà (19/11)**; **Stage 2 xong (Opus quyết đạt 19/11)**. Đã push `main` + `dev` tới a07d60c (hết 2C-4, Dương yêu cầu 19/11).

## Ghi chú điều phối (Opus) — đọc trước khi làm tiếp

1. 2A đã push `main` + `dev`. 2B+ Opus đã rà soát (19/11): đạt, `pnpm lint`/`typecheck`/`test` 511 pass. 2C-1 Opus đã rà soát: đạt, còn 3 việc chuyển sang phần sau: (a) kéo thanh cuộn xuống cuối bảng 100.000 dòng mất 5,8 s, yêu cầu nhảy tới vị trí bất kỳ < 1 s (đọc thẳng cửa sổ quanh vị trí, đúng cả khi lọc/sắp/nhóm) — giao trong 2C-2; (b) cột Liên kết, Đính kèm sửa được — 2C-3; (c) `impeccable audit` cho grid — 2C-2.
2. **2C-2, 2C-3 xong, Opus đã rà (19/11)**. 2C-3: rà lần 1 tìm 3 lỗi (quyền ghi mã file ở ô Đính kèm, hồi quy bộ chọn e2e 2C-2, liên kết chỉ cùng datahub), đã sửa (106488a, 05b9202); Opus chạy lại 216 test API Datahub pass. 2C-4 Opus rà 19/11: đạt (đọc diff, đối chiếu thiết kế mục 7a/10/11; tự chạy lại typecheck, eslint, 11 unit pass; không bắt buộc chạy lại e2e vì không đụng `components/ui`, engine hay phân quyền, server chỉ sửa lint). 2D Opus rà 19/11: đạt (đụng worker/registry/storage nên Opus tự chạy lại: typecheck, eslint sạch; `vitest run apps packages` 688 pass; e2e stage2d 5/5; link Google Sheet chỉ gọi docs.google.com và kiểm host trả về; việc nền chạy bằng quyền người yêu cầu). 2E Opus quyết đạt 19/11: 2E-1 (`pnpm test` 688/688, e2e desktop 56/56, phone 25/26), 2E-2 (spec `stage2e` 6 luồng, 1 lỗi số liệu `formatNumber` sửa ở 4a8a06a, Opus đọc diff + chạy lại 21 unit `packages/shared`), lỗi bảng bị ép ở 375px sửa ở d2c1f96 (Dương dặn test nhanh). Chưa push phần 2D, 2E (chờ Dương). Nguyên tắc thêm: bước con đụng thành phần dùng chung thì chạy lại e2e desktop của mọi spec dùng thành phần đó.
3. Ghi nhớ cho các phần sau của Stage 2:
   - 2B: golden test được đọc thẳng `examples/Quản lý Deal SoE (Dương TVD).xlsx` (Dương cho phép), không commit dữ liệu lấy từ file, máy không có file thì test tự bỏ qua.
   - 2C: làm cả công cụ **Tìm dòng trùng** (Module 2 mục 7a).
   - 2C: làm cả ô **Lọc theo thời gian** (Module 2 mục 5.4, bổ sung 18/11): lưu trong `config.time_filter` của view, server dịch sang `between`/toán tử ngày; không cần đổi schema.
   - Bảng gộp thuộc Stage 3 (Module 3 mục 4), không làm ở Stage 2.
4. **Module 4 đã chốt (19/11)**; CLAUDE.md và Module 1 đã ghi các thay đổi của mục 18. Khi code Stage 4 làm mục 19 (đối chiếu Module 2). **Sửa 19/11 (Dương chốt):** bảng template, khoá phân chia, vai trò cột, template theo cây/team, trang Template (Module 4 mục 3.5–3.8); bỏ cột thật của Postgres cho Deals (Module 2 mục 3 còn hai nguồn cột). Stage 4 bỏ `PhysicalSource` trong `column-source.ts`; không ảnh hưởng 2D/2E. **Chia sẻ thống nhất** (khoá phân chia, cho phép sửa theo cột, ô Người dùng chỉ nhận thành viên; Module 2 mục 10) code ở **bước con 4.1 của Stage 4** (danh sách 21 việc ở Module 4 mục 19a), không chen vào 2E.
5. **Từ 19/11 kiểm thử theo cấp** (`CLAUDE.md` mục "Kiểm thử theo cấp"): bước con Sonnet chỉ test nhanh ở desktop; Opus rà bằng diff + kết quả; kiểm thử đầy đủ (cả bộ e2e, 375px, skill, `break-ui`) làm một lần ở bước con riêng **2E** (không chạy skill giao diện, `break-ui`: Stage 12): Sonnet chạy, Opus điều phối, đọc kết quả và quyết định đạt. Chuẩn giao diện đã tách sang `design/chuan-giao-dien.md`.
7. **Cách làm 2E (Dương dặn 19/11):** chụp màn hình chỉ cho các màn hình chủ chốt, còn lại để Stage 12 xử lý một lần. Ưu tiên kiểm bằng code: assert trong Playwright, kiểm console và network bằng script. Ảnh chụp lưu ra file làm bằng chứng, chỉ mở xem khi assert fail hoặc khi cần nhìn bố cục. Đọc log chỉ phần lỗi. Không rà chuẩn giao diện, không chạy bộ skill giao diện hay `break-ui` (Stage 12). Chia 2E thành phiên: **2E-1** chạy toàn bộ test (`pnpm test`, cả bộ e2e desktop, luồng chính ở điện thoại) và sửa lỗi; **2E-2** đi luồng thật các màn hình chủ chốt với từng vai trò + dữ liệu xấu nhất về chức năng/số liệu, kiểm điểm 3 (OpenAPI + Bruno đủ).
6. Golden test 2B đã làm (đọc file mẫu, 3.322 công thức); số liệu và hai điểm lạ của file mẫu ở `design/module2-quyet-dinh-khi-code.md` mục 2B.

## Đã xong

- Phân tích brief, file mẫu, chốt tech stack, thiết kế Module 0–4, hạ tầng.
- **Stage 0 xong**: monorepo, schema + migration, registry, audit append-only, lịch sử dòng, outbox, worker pg-boss, SSE, file, OpenAPI, Docker/compose/Caddy.
- **Stage 1 xong**: API và web của tài khoản, org chart, vai trò, phiên, mã kích hoạt, token, thông báo, nhật ký, chuyển giao, cài đặt (302 test, e2e 16 luồng x 2 bề ngang, 10 lỗi tìm thấy đã sửa). Chưa thử: chuyển cả cây bằng giao diện, đăng nhập Google, `docker-compose.yml`. Quyết định ở `design/module1-tai-khoan-phan-quyen.md`.
- **2A xong** (đã rà soát): schema, kiểu cột, API cấu trúc và dòng, SSE, chuyển giao, view SQL, index tự động; 100.000 dòng đọc 3–44 ms, trang keyset 2,7 ms.
- **2B xong** (đã rà soát): công thức (106 hàm), cột công thức/liên kết/lookup/rollup, tính lại, golden test 3.322 công thức (3.321 khớp Excel). Chi tiết ở `design/module2-quyet-dinh-khi-code.md` mục 2B.
- **2B+ xong** (đã rà soát): tính lại theo phần, sự kiện `dòng, cột, cũ → mới`, `seq` và đợi tính xong, `pending` theo ô, đối soát hằng đêm; sửa 1 dòng nguồn ở bảng 100.000 dòng, 6 cột phụ thuộc: ghi 9 ms, worker 43 ms. Chi tiết mục 2B+.
- **Stage 2 xong** (19/11): 2A, 2B, 2B+, 2C-1..2C-4, 2D (import/export, 100.000 dòng: import 12 s, export 8 s), 2E (kiểm thử cuối stage). Quyết định và số đo ở `design/module2-quyet-dinh-khi-code.md`; kết quả kiểm thử ở git log `2E-1`, `2E-2`. Chưa thử: link Google Sheet thật; import cột Liên kết/Người/Đính kèm chưa có.

## Đang làm: Stage 3 (Module 3, Metric + Dashboard), Sonnet code, Opus rà

Bước con (mỗi bước một phiên Sonnet; test nhanh theo "Kiểm thử theo cấp"; quyết định ghi ở `design/module3-quyet-dinh-khi-code.md`):

- **3A-1 engine metric lõi (server)**: schema (nguồn dữ liệu, chỉ số, biểu đồ, dashboard), `packages/metrics`: JSON chỉ số → một câu SQL gom nhóm áp phạm vi dữ liệu; mọi phép tổng hợp mục 5.1; nhóm thời gian (giờ VN, tuần từ thứ Hai, quý theo năm tài chính), khoảng tương đối; phân nhóm theo cột; lọc dùng cú pháp lọc của Module 0; ghép bảng theo cột liên kết/cột khoá có chẩn đoán và gom bảng nhiều dòng trước (mục 3); `metrics.query`; CRUD chỉ số + nguồn; test unit + phân quyền.
- **3A-2 engine metric nâng cao (server)**: chỉ số phái sinh bằng engine công thức (`[Tên chỉ số]`), so kỳ trước/cùng kỳ năm trước, luỹ kế, cohort, mục tiêu (hằng số/bảng mục tiêu, % đạt), outlier IQR; chịu tải mục 6.1 (cache theo chỉ số + tham số + phạm vi, gộp yêu cầu trùng, 6 câu/người, `statement_timeout` 10 s); outbox xoá cache + SSE. Snapshot và "team tại thời điểm" chỉ để chỗ cắm (Stage 4).
- **3B bảng gộp**: loại bảng chỉ đọc, ≤10 nguồn cùng chủ, ghép cột, cột Nguồn + Mã dòng gốc, chống trùng 3 cách, chẩn đoán, worker đồng bộ theo outbox, không lịch sử/nhật ký, nguồn mất thì báo lỗi giữ dữ liệu cũ; giao diện trình tạo bảng gộp; e2e.
- **3C-1 dashboard + biểu đồ cơ bản (giao diện)**: tab Dashboard trong datahub, nhiều dashboard (mới, đổi tên, nhân bản, đổi thứ tự, xoá vào thùng rác, giới hạn 30 biểu đồ/20 dashboard), lưới kéo thả + đổi kích thước tự lưu, khung cấu hình biểu đồ, thư viện chỉ số/nguồn đã lưu ("Lưu thành..."), loại: Thẻ KPI, cột/thanh (nhóm, chồng, 100%), đường/vùng, kết hợp hai trục, tròn/donut, bảng, pivot, ô ghi chú; tuỳ chọn hiển thị chung; e2e.
- **3C-2 biểu đồ còn lại + tương tác**: bullet, đồng hồ, phễu, box plot, histogram, scatter, ma trận 2×2/heatmap, waterfall, xếp hạng, cohort tam giác; bộ lọc chung (bản riêng + "Về mặc định"), lọc chéo, xem các dòng (theo quyền), xuất CSV/PNG, JSON xuất/nhập dashboard, chia sẻ dashboard (tính bằng quyền chủ, nhật ký, Guest được cấp); e2e.
- **3D load test**: 100.000 dòng, 20 người cùng mở dashboard 30 biểu đồ, không cache sẵn; đạt khi mọi biểu đồ xong trong 3 s, không lỗi; tối ưu nếu chưa đạt (mục 6.1 điểm 5).
- **3E kiểm thử cuối stage**: theo "Cách kiểm thử cuối stage để tiết kiệm token" (CLAUDE.md), chia 3E-1 (toàn bộ test) và 3E-2 (luồng chủ chốt theo vai trò + dữ liệu xấu nhất).

Để Stage 4 (ghi rõ trong quyết định khi code): snapshot thật, team theo cây tại thời điểm của deal, dashboard hệ thống Deals, winrate theo cycle.

## Bước tiếp theo

**3A-1 xong, Opus rà 19/11: đạt** (commit 41a4b69..8186456; chi tiết `design/module3-quyet-dinh-khi-code.md` mục 3A-1). Đụng phần dùng chung (`packages/shared/src/time-filter.ts`, quyền đọc dòng) nên Opus tự chạy lại: typecheck, lint sạch; `vitest run packages/metrics packages/shared apps/api/test/metrics apps/api/test/datahub` 31 file, 364 test pass. Hiệu năng 100.000 dòng: 15–264 ms mỗi chỉ số; ghép theo khoá 100k×100k 1.655 ms (vượt 1 s, xử lý ở 3A-2/3D).
**Opus quyết khi rà:** ghép bảng đổi từ inner sang **left** (dòng bảng chính không có đối tác vẫn vào số liệu, cột bảng ghép là rỗng; ghép thêm bảng không bao giờ làm đổi số của bảng chính; chẩn đoán vẫn báo dòng không khớp, 0 khớp vẫn báo lỗi). Làm đầu 3A-2.

**3A-2 đang làm (19/11, phiên Sonnet A xong):** [x] 0 ghép left (4b15996); [x] Điều chỉnh mục 1 (8396bf0: metrics đọc cột qua `ColumnSource.cellExpr` / `MColumn.read`); [x] 1 phái sinh, [x] 2 thời gian (so kỳ trước/cùng kỳ, luỹ kế, cohort), [x] 3 mục tiêu + outlier IQR (52f7185 và commit sau; chi tiết `design/module3-quyet-dinh-khi-code.md` mục "3A-2 mục 1–3"). Test: `pnpm -r typecheck`, `pnpm lint` sạch; `vitest run packages/metrics apps/api/test/metrics-engine metrics-join metrics-access metrics-advanced` pass (33 unit + 94 + 27 test DB); `apps/api/test/datahub*` 327 pass sau điều chỉnh mục 1. **Chưa làm:** [ ] 4 chịu tải (cache khoá từ `access.ts`, gộp yêu cầu trùng, 6 câu/người, `statement_timeout` 10 s: bọc `ctx.db.execute` trong `runMetric`/`rowsOf` và `runDefinition` ở `apps/api/src/modules/metrics/engine.ts`); [ ] 5 xoá cache bằng outbox + SSE; [ ] 6 hiệu năng ghép 100k×100k (1.655 ms, mục tiêu < 1 s); [ ] 7 API/OpenAPI/Bruno (`docs/api/bruno/`, thêm request cho `compare`, `cumulative`, `target`, `outliers`, chỉ số phái sinh); [ ] 8-9 test + quyết định. **Làm tiếp:** phiên Sonnet B bắt đầu từ mục 4, đọc mục "Điều chỉnh Stage 3" ngay dưới (mục 2: khoá phạm vi cache lấy từ **một hàm duy nhất** trong `access.ts`, ví dụ `scopeKey(access)`; xoá cache cả khi đổi chia sẻ bảng nguồn và khi cây tổ chức đổi). Lưu ý cho mục 4: chỉ số phái sinh/so kỳ/mục tiêu chạy nhiều câu SQL lá (mỗi lá là một `runMetric`, hoặc `rowsOf` cho bảng mục tiêu); khoá cache của câu trả lời đầy đủ phải gồm cả định nghĩa chỉ số (kể cả các chỉ số được tham chiếu), tham số, phạm vi dữ liệu của mọi bảng nó đọc, và ngày hôm nay (khoảng tương đối).

## Điều chỉnh Stage 3 so với Module 3 đã đọc (Dương chốt 19/11)

Module 3 vừa sửa sau khi Sonnet đọc (commit 36d3e03), vì Dương chốt **khoá phân chia** (Module 2 mục 10): bảng có thể chỉ cho mỗi người thấy dòng có tên mình hoặc cấp dưới, và có cột lưu giá trị riêng theo từng người đọc. Hai thứ này về code ở Stage 4.1, nhưng Stage 3 phải làm sẵn chỗ cắm để khi đó không phải viết lại. Sonnet đọc mục này trước khi làm tiếp bất kỳ bước nào của Stage 3. **Đọc Module 3 tiết kiệm:** phiên đã đọc Module 3 thì không đọc lại cả file, chỉ xem phần khác bằng `git diff 8186456 -- design/module3-metric-dashboard.md`; phiên chưa đọc thì đọc file mới nhất một lần duy nhất trong phiên, không đọc lại.

1. **Sửa phần đã làm ở 3A-1:** `packages/metrics/src/columns.ts` đang đọc thẳng `dh_rows.data`. Đổi sang đọc qua nguồn cột: API dựng `MColumn` kèm biểu thức đọc lấy từ `sourceOf(col).readExpr` (`apps/api/src/modules/datahub/column-source.ts`). *Lý do:* Stage 4 thêm cột giá trị theo từng người (Lookup/Rollup tính theo người đọc, cột "của tôi" của Deals); đọc thẳng `data` thì các cột đó ra rỗng. Hôm nay mọi cột là JSONB nên số liệu không đổi: test 3A-1 phải pass nguyên.
2. **3A-2 cache:** khoá phạm vi lấy từ **một hàm duy nhất** trong `access.ts` (ví dụ `scopeKey(access)`, hôm nay theo bảng + mức quyền), metrics không tự dựng. Xoá cache cả khi đổi chia sẻ của bảng nguồn và khi cây tổ chức đổi. *Lý do:* khi khoá phân chia bật, mỗi người một phạm vi; dùng chung khoá cache theo bảng sẽ cho người này thấy số của người khác. Stage 4.1 chỉ cần sửa hàm đó.
3. **3B bảng gộp:** đọc dòng nguồn qua `scope()` của chủ bảng gộp (không đọc thẳng `dh_rows`), và có đường đồng bộ lại khi dòng vào/ra khỏi phạm vi. *Lý do:* nguồn có thể là bảng có khoá phân chia (Deals); bảng gộp không được chép dòng chủ không thấy (Module 3 mục 4.1).
4. **3C-2 xem các dòng, xuất CSV:** dùng phạm vi của **người nhận**, không phải của chủ dashboard; hiện "Bạn thấy 12/40 dòng tạo nên con số này". *Lý do:* số tính theo quyền chủ, nhưng dòng thô thì người nhận chỉ được thấy phần của mình (Module 3 mục 9).
5. Để Stage 4: chỉ số và dashboard mặc định của Deals trỏ cột theo **vai trò cột** (Module 4 mục 3.7), không theo tên.

## Việc đã xếp cho Stage 4 (sửa lại code Stage 2)

**Bước con 4.1 làm đầu tiên của Stage 4**, trước khi dựng Deals. Danh sách đủ (21 việc, kèm file cần sửa) ở `design/module4-quan-ly-deal.md` mục 19a. Tóm tắt:
- Khoá phân chia (lọc dòng theo người, kể cả cấp dưới), áp cho mọi chỗ đọc dòng và **SSE** (đang gửi cả dòng không được thấy).
- Cho phép sửa theo cột; ô Người dùng chỉ nhận thành viên; gỡ thành viên đang được tag.
- Tuỳ chọn "Thành viên được thêm dòng hàng loạt": chặn import, dán sinh dòng mới, API nhiều dòng (2D đang cho import).
- Lookup/Rollup sang bảng có khoá phân chia tính theo từng người đọc.
- Hạ tầng bảng template (cờ bảo vệ, lớp cột, vai trò cột); bỏ `PhysicalSource`.


## Lỗi điện thoại để sau

Không chặn bước con (CLAUDE.md, "Điện thoại là ưu tiên thấp"); gom sửa một đợt, Opus quyết khi nào.

- (Đã sửa 19/11) `stage2c2.spec.ts:188` phone: gom 6 nút thanh công cụ vào menu "…" (aria-label "Thêm thao tác") dưới `sm`, grid `min-h-[60dvh] sm:min-h-0`. Test: `pnpm -r typecheck`, `pnpm lint`, `pnpm test:e2e stage2c1 stage2c2 stage2c3 stage2c4 stage2d --project=phone` (17 pass, 23 skip có sẵn), `pnpm test:e2e stage2e --project=desktop` (6/6 pass).

- `stage1.spec.ts` phone "cài đặt hệ thống" hết giờ 1 lần, chạy lại pass; nghi cùng nguyên nhân Vite tải lại trang (đã sửa ở f8835de), chưa xác minh. Lệnh: `pnpm test:e2e stage1 --project=phone`. Sau f8835de: 3 lần liền 16/16 pass (19/11, chạy trong 2C-3), chưa thấy fail lại.

## Câu hỏi còn mở

- **Test chập chờn cần sửa (quy định 19/11):** (1) Ca Opus chạy lại sau 2C-2: `stage2c2.spec.ts:366` (luồng 100.000 dòng) fail 2/2 lần, `.dvn-scroller` null. Nguyên nhân: Vite tải lại trang khi Playwright ghi trace vào `apps/web/e2e/results/`; đã sửa ở `vite.config.ts` (f8835de), sau đó 3/3 lần pass. **Đã xong.** (2) Ca `stage1` điện thoại chuyển sang mục "Lỗi điện thoại để sau".
- 2C-1: (1) Cây truy cập (bảng ẩn cho trình đọc màn hình) của Glide không dựng trên React 19 nên grid chưa đọc được bằng trình đọc màn hình; khung chi tiết dòng là DOM thường nên đọc được. Cần Dương quyết có bắt buộc không (bắt buộc thì phải thêm bảng DOM song song hoặc đổi thư viện). (2) Cột Mã dòng hiện `#<số dòng>` (dễ đọc), trong khi export/API trả mã dòng dạng uuid. (3) Không có "nhảy tới dòng thứ N" của bảng rất lớn (keyset); lọc/sắp xếp/tìm ở 2C-2 thay cho việc đó. (4) Cột Liên kết và Đính kèm mới chỉ xem; sửa cần ô chọn dòng đích và tải file (2C-3). (5) Hoàn tác/làm lại chỉ trong phiên mở bảng (máy khách), không đọc lịch sử dòng của server.
- 2C-1 chưa thử trên điện thoại thật (chạm trong grid canvas, bàn phím ảo với khung chọn, cuộn cảm ứng) và chưa chạy `impeccable audit`.
- 2B+: ngân sách đối soát 1.000.000 dòng/đêm và thời gian chờ mặc định 5 s là giá trị tự chọn; Dương chỉnh nếu cần.
- 2B: cảnh báo `LEFT(ngày,2)` khi import đã làm ở 2D (báo ở bước Kiểm tra, không tự sửa công thức). Dương xem có muốn tự đổi sang `TEXT(ngày,"mm")` không.
- Module 5 (mục 11), Module 6 (mục 12), Module 7 (mục 13): câu hỏi ở mục cuối mỗi file, chờ Dương trả lời rồi chốt; chốt xong cập nhật CLAUDE.md theo mục "Thay đổi so với quy định đã chốt" của từng file.
- Stage 9 Onboarding: lúc bắt đầu stage hỏi Dương có tính là ngoại lệ (kiểm giao diện kỹ) với cách kiểm thử tiết kiệm token không; tới lúc đó giữ quy định cũ trong CLAUDE.md (kiểm kỹ).
- Module 4: bảng Thanh toán (mục 7) chờ Dương bàn với Manager (nguồn tiền về, com POD, nguồn Level BC/Performance BC, thu hồi com, com POD Express và Data).
- `docker-compose.yml` chưa chạy thử (máy dev không có Docker); Google chưa thử với Google thật (xem `design/ha-tang.md` mục 4).
- Danh sách token cần duyệt và tài khoản hệ thống chưa phân trang (giới hạn 500); phân trang ở Stage 5.

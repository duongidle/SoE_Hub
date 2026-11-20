# Tiến độ

Cập nhật: 19/11/2026

## Giai đoạn hiện tại

- Thiết kế: Module 0–4 đã chốt (Module 4 chốt 19/11; **sửa lần 2 cùng ngày, Dương chốt**; còn mở: mẫu thông báo tiền về thật để chỉnh luật ghép (đang giả định UNC), màn so sánh phiên bản chính sách khi AI cập nhật (đề xuất, chưa chốt); thanh toán và com theo đợt, Won khi tiền về, Sổ com, chốt kỳ gộp, ghép tiền về, vai trò cột trong dashboard; xem đầu file Module 4 và mục 18). **Module 5 đã chốt** (19/11; CLAUDE.md, Module 0, 1, 4, 7 đã ghi thay đổi). **Module 6: bản nháp vòng 1**, chờ Dương phản biện. Quản lý Deal không hiện trong menu Datahub (Module 4 mục 1.1, Dương chốt 19/11). **Module 7 đã chốt** (19/11; CLAUDE.md, Module 0, 4 đã ghi thay đổi; Module 2 mục 11 chưa ghi giới hạn 150 cột vì Sonnet đang sửa file đó, ghi khi rảnh). Câu hỏi ở mục cuối mỗi file.
- Code: Stage 0 và Stage 1 xong. Stage 2: 2A, 2B, 2B+, 2C-1, 2C-2 xong và Opus đã rà soát (19/11); **2C-3, 2C-4 xong, Opus đã rà (19/11)**; **Stage 2 xong (Opus quyết đạt 19/11)**. **Stage 3 xong (Opus quyết đạt 20/11)**. Đã push `main` + `dev` tới bd2597e (hết Stage 3, Dương yêu cầu 20/11).

## Ghi chú điều phối (Opus) — đọc trước khi làm tiếp

1. 2A đã push `main` + `dev`. 2B+ Opus đã rà soát (19/11): đạt, `pnpm lint`/`typecheck`/`test` 511 pass. 2C-1 Opus đã rà soát: đạt, còn 3 việc chuyển sang phần sau: (a) kéo thanh cuộn xuống cuối bảng 100.000 dòng mất 5,8 s, yêu cầu nhảy tới vị trí bất kỳ < 1 s (đọc thẳng cửa sổ quanh vị trí, đúng cả khi lọc/sắp/nhóm) — giao trong 2C-2; (b) cột Liên kết, Đính kèm sửa được — 2C-3; (c) `impeccable audit` cho grid — 2C-2.
2. **2C-2, 2C-3 xong, Opus đã rà (19/11)**. 2C-3: rà lần 1 tìm 3 lỗi (quyền ghi mã file ở ô Đính kèm, hồi quy bộ chọn e2e 2C-2, liên kết chỉ cùng datahub), đã sửa (106488a, 05b9202); Opus chạy lại 216 test API Datahub pass. 2C-4 Opus rà 19/11: đạt (đọc diff, đối chiếu thiết kế mục 7a/10/11; tự chạy lại typecheck, eslint, 11 unit pass; không bắt buộc chạy lại e2e vì không đụng `components/ui`, engine hay phân quyền, server chỉ sửa lint). 2D Opus rà 19/11: đạt (đụng worker/registry/storage nên Opus tự chạy lại: typecheck, eslint sạch; `vitest run apps packages` 688 pass; e2e stage2d 5/5; link Google Sheet chỉ gọi docs.google.com và kiểm host trả về; việc nền chạy bằng quyền người yêu cầu). 2E Opus quyết đạt 19/11: 2E-1 (`pnpm test` 688/688, e2e desktop 56/56, phone 25/26), 2E-2 (spec `stage2e` 6 luồng, 1 lỗi số liệu `formatNumber` sửa ở 4a8a06a, Opus đọc diff + chạy lại 21 unit `packages/shared`), lỗi bảng bị ép ở 375px sửa ở d2c1f96 (Dương dặn test nhanh). Chưa push phần 2D, 2E (chờ Dương). Nguyên tắc thêm: bước con đụng thành phần dùng chung thì chạy lại e2e desktop của mọi spec dùng thành phần đó.
3. Ghi nhớ cho các phần sau của Stage 2:
   - 2B: golden test được đọc thẳng `examples/Quản lý Deal SoE (Dương TVD).xlsx` (Dương cho phép), không commit dữ liệu lấy từ file, máy không có file thì test tự bỏ qua.
   - 2C: làm cả công cụ **Tìm dòng trùng** (Module 2 mục 7a).
   - 2C: làm cả ô **Lọc theo thời gian** (Module 2 mục 5.4, bổ sung 18/11): lưu trong `config.time_filter` của view, server dịch sang `between`/toán tử ngày; không cần đổi schema.
   - Bảng gộp thuộc Stage 3 (Module 3 mục 4), không làm ở Stage 2.
4. **Module 4 đã chốt (19/11)**; CLAUDE.md và Module 1 đã ghi các thay đổi của mục 18. Khi code Stage 4 làm mục 19 (đối chiếu Module 2). **Sửa 19/11 (Dương chốt):** bảng template, khoá phân chia, vai trò cột, template theo cây/team, trang Template (Module 4 mục 3.5–3.8); bỏ cột thật của Postgres cho Deals (Module 2 mục 3 còn hai nguồn cột). Stage 4 bỏ `PhysicalSource` trong `column-source.ts`; không ảnh hưởng 2D/2E. **Chia sẻ thống nhất** (khoá phân chia, cho phép sửa theo cột, ô Người dùng chỉ nhận thành viên; Module 2 mục 10) code ở **bước con 4.1 của Stage 4** (danh sách 25 việc ở Module 4 mục 19a), không chen vào 2E.
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
- **Stage 3 xong** (20/11, Opus quyết đạt): 3A-1, 3A-2 (engine metric, cache), 3B (bảng gộp), 3C-1, 3C-2 (dashboard, 22 loại biểu đồ, bộ lọc chung/lọc chéo, xem dòng, CSV/PNG, JSON, chia sẻ dashboard, Guest), 3D (load: 20 người lạnh max 900 ms), 3E (kiểm thử cuối: `pnpm test` 981 pass, e2e desktop 93/93, spec `stage3e` theo vai trò + dữ liệu xấu nhất + 3 luồng phone; 3 lỗi hiển thị số đã sửa; 38 op `metrics.*` đủ OpenAPI + Bruno). Rà lần 1 3C-2 trả lại lỗi người được chia sẻ dò được dữ liệu thô qua bộ lọc (sửa `checkViewerFilters`). Quyết định, số đo: `design/module3-quyet-dinh-khi-code.md`.
- **Stage 2 xong** (19/11): 2A, 2B, 2B+, 2C-1..2C-4, 2D (import/export, 100.000 dòng: import 12 s, export 8 s), 2E (kiểm thử cuối stage). Quyết định và số đo ở `design/module2-quyet-dinh-khi-code.md`; kết quả kiểm thử ở git log `2E-1`, `2E-2`. Chưa thử: link Google Sheet thật; import cột Liên kết/Người/Đính kèm chưa có.

## Đang làm: Stage 4 (Module 4, Quản lý Deal), Sonnet code, Opus rà

Bước con 4.1 (Module 4 mục 19a, 25 việc) chia 4 phiên, làm lần lượt (cùng đụng `access.ts`/`rows.ts`):
- **4.1a khoá phân chia + quyền (server)**: **xong, Opus rà đạt 20/11** (cd31b2c, 5a9ae66; Opus tự chạy lại: typecheck, lint sạch, vitest 1008 pass, e2e desktop 93/93; SSE chỉ gửi tín hiệu nên `key_users` không ra trình duyệt). Để sau: `loadSource` bảng gộp vẫn đòi chủ bảng nguồn (4.1b quyết); Liên kết sang bảng template (4.1c); giữ người cũ ở deal đóng khi chuyển giao (khi có Deals); cột "duy nhất" báo trùng với dòng ẩn (chấp nhận). Việc 1–9, 11a + test phân quyền (việc 20 phần server). Migration 0013; `access.ts` (`rows()`, `loadReader`, `scopeKey`, `rowAudience`); lệnh mới `datahub.table.share_options.set`, `datahub.prefs.get/set`, `datahub.share.tagged`; test `apps/api/test/datahub-split-lock.test.ts` (27 pass). Test nhanh đã chạy: `pnpm -r typecheck`, `pnpm exec eslint .` sạch; `pnpm exec vitest run apps packages` 1008 pass, 5 skip có sẵn; `pnpm test:e2e stage2c3 stage2c4 --project=desktop` 10/10. Sửa test cũ vì luật mới (ô Người dùng chỉ nhận thành viên): `datahub-query`, `datahub-columns`, `datahub-export` phải chia sẻ bảng cho người được tag. Quyết định + việc còn lại: `design/module4-quyet-dinh-khi-code.md` mục 4.1a. Bước tiếp: 4.1b (việc 10, 11).
- **4.1b tính theo người đọc** *(code + load xong; 3D phạm vi riêng CHƯA đạt 3 s: 20 phạm vi nguội cùng lúc max 8,1 s, đã 3 vòng tối ưu, chờ Opus quyết, số đo ở `design/module4-quyet-dinh-khi-code.md` mục 4.1b; còn: chạy `vitest run apps packages` + e2e desktop và Opus rà)*: việc 10 (Lookup/Rollup/công thức sang bảng có khoá phân chia, mỗi thành viên một giá trị, tính lại theo phần), việc 11 (bỏ `PhysicalSource`), load test 20 thành viên × 100.000 dòng; **đo lại load 3D với phạm vi riêng từng người** (mục dưới).
- **4.1c hạ tầng bảng template**: việc 12–16.
- **4.1d giao diện + việc nhỏ**: việc 17–19, 19a–19d; e2e.
**Làm tiếp nếu phiên bị ngắt (Opus ghi 20/11, lúc sắp hết quota):** 4.1b do Sonnet đang làm, mới bắt đầu (chưa commit: migration `0014_datahub_reader_scoped.sql`, sửa `access.ts`, `table-schema.ts`, `types.ts`, `schema/datahub.ts`). Phiên mới: (1) `git status` + `git log` xem 4.1b đã commit tới đâu; phần chưa commit thì Sonnet đọc diff, làm tiếp hoặc bỏ nếu dở dang khó hiểu. (2) Đề bài 4.1b đủ ở dòng "4.1b" trên + quyết định Opus: bảng gộp giữ luật "chỉ chủ" với nguồn thường; nguồn có khoá phân chia thì thành viên dùng được, đọc qua `rows()` của chủ bảng gộp, đồng bộ lại khi phạm vi đổi. Load 3D phạm vi riêng: 20 người khác phạm vi, dashboard 30 biểu đồ, bảng 100.000 dòng, mỗi biểu đồ ≤ 3 s; quá 3 vòng tối ưu chưa đạt thì dừng báo Opus. (3) Opus rà 4.1b: đụng engine công thức và `access.ts` nên tự chạy lại `pnpm -r typecheck`, `pnpm lint`, `pnpm exec vitest run`, `pnpm test:e2e --project=desktop` (mốc trước 4.1b: 1008 unit, e2e 93/93); đọc số đo load. (4) Sau đó 4.1c, 4.1d theo danh sách trên. `main` đang ở bd2597e (hết Stage 3); `dev` chưa push từ ce0753f.

Các bước sau 4.1 (Opus chia chi tiết khi tới): bảng template + trang Template + Deals/Index/Probation KPI; thanh toán và com theo đợt (mục 7, 12); chốt kỳ, snapshot, forecast, BANT; chỉ số theo vai trò cột + dashboard Deals + API ngoài + `data_grants.options` (mục 19 việc 14–16); kiểm thử cuối Stage 4.

**Ghi nhận còn lại của Stage 3** (để Stage 4 / Stage 12): người xem qua chia sẻ dashboard không tự tải lại khi dữ liệu đổi; chữ giữa gauge đè nhãn trục (Stage 12); lọc chéo khó bấm cột < 1 px cạnh cột rất lớn; thang gauge phần trăm làm tròn ở web (chỉ thang hiển thị).

## Việc đã xếp cho Stage 4 (sửa lại code Stage 2)

**Bước con 4.1 làm đầu tiên của Stage 4**, trước khi dựng Deals. Danh sách đủ (25 việc, kèm file cần sửa) ở `design/module4-quan-ly-deal.md` mục 19a. Tóm tắt:
- Khoá phân chia (lọc dòng theo người, kể cả cấp dưới), áp cho mọi chỗ đọc dòng và **SSE** (đang gửi cả dòng không được thấy).
- Cho phép sửa theo cột; ô Người dùng chỉ nhận thành viên; gỡ thành viên đang được tag.
- Tuỳ chọn "Thành viên được thêm dòng hàng loạt": chặn import, dán sinh dòng mới, API nhiều dòng (2D đang cho import).
- Lookup/Rollup sang bảng có khoá phân chia tính theo từng người đọc.
- Hạ tầng bảng template (cờ bảo vệ, lớp cột, vai trò cột); bỏ `PhysicalSource`.
- View nhóm: thu gọn tất cả, lưu vào view; xuất dạng tổng hợp (việc 19a, 19b; Module 2 mục 5.1).
- Kiểu cột "Ngày sửa của cột"; đổi tên lựa chọn cập nhật công thức so chữ (việc 19c, 19d).
- **Đo lại load 3D sau 4.1 (Opus 20/11, bắt buộc):** khoá phân chia làm mỗi người một phạm vi, nên ca "20 bộ lọc khác nhau" của 3D (max 8,8 s) thành ca thật. Đo 20 người, phạm vi khác nhau, dashboard 30 biểu đồ trên Deals 100.000 dòng; đạt khi mọi biểu đồ xong trong 3 s. Chưa đạt thì tối ưu ở gốc (box plot đang self-join; ghép bảng tính lại khoá chuẩn hoá mỗi câu). Cache đang nằm trong bộ nhớ từng tiến trình api.
- Từ Stage 3: kiểm `loadSource` (đòi `owner` trên nguồn) khi nguồn là bảng template có khoá phân chia, sửa ở `requestRescope`/`readableRows` (Module 3 mục 4.1); chỉ số và dashboard mặc định của Deals trỏ cột theo **vai trò cột** (Module 4 mục 3.7); khoá cache chỉ sửa ở `scopeKey(access)`.
- Sau 4.1, Stage 4 thêm: thanh toán và com theo đợt (Module 4 mục 7, 12: bốn command, ghép tiền về, chốt kỳ), chỉ số trỏ cột theo vai trò (Module 4 mục 19 việc 14–15).


## Lỗi điện thoại để sau

Không chặn bước con (CLAUDE.md, "Điện thoại là ưu tiên thấp"); gom sửa một đợt, Opus quyết khi nào.

- (Đã sửa 19/11) `stage2c2.spec.ts:188` phone: gom 6 nút thanh công cụ vào menu "…" (aria-label "Thêm thao tác") dưới `sm`, grid `min-h-[60dvh] sm:min-h-0`. Test: `pnpm -r typecheck`, `pnpm lint`, `pnpm test:e2e stage2c1 stage2c2 stage2c3 stage2c4 stage2d --project=phone` (17 pass, 23 skip có sẵn), `pnpm test:e2e stage2e --project=desktop` (6/6 pass).

- `stage1.spec.ts` phone "cài đặt hệ thống" hết giờ 1 lần, chạy lại pass; nghi cùng nguyên nhân Vite tải lại trang (đã sửa ở f8835de), chưa xác minh. Lệnh: `pnpm test:e2e stage1 --project=phone`. Sau f8835de: 3 lần liền 16/16 pass (19/11, chạy trong 2C-3), chưa thấy fail lại.

## Câu hỏi còn mở

- **3C-2 (Guest xem dashboard):** loại dữ liệu `dashboard` cấp theo cây, nên em thêm cờ `guest_visible` (mặc định tắt, chủ bật cho từng dashboard) để Guest không thấy mọi dashboard của cả cây. Dương xem có đúng ý Module 1 mục 5.2 không, hay muốn cấp theo từng dashboard ở khung cấp dữ liệu.
- **3C-2 (nhật ký xem):** `metrics.dashboard.view` ghi nhật ký mỗi lần mở dashboard của người khác; không ghi từng `metrics.chart.data` (30 dòng mỗi lần mở). Ai gọi thẳng `chart.data` mà không qua `view` thì không có dòng nhật ký (`chart.rows/csv` vẫn ghi).

- **Test chập chờn cần sửa (quy định 19/11):** (1) Ca Opus chạy lại sau 2C-2: `stage2c2.spec.ts:366` (luồng 100.000 dòng) fail 2/2 lần, `.dvn-scroller` null. Nguyên nhân: Vite tải lại trang khi Playwright ghi trace vào `apps/web/e2e/results/`; đã sửa ở `vite.config.ts` (f8835de), sau đó 3/3 lần pass. **Đã xong.** (2) Ca `stage1` điện thoại chuyển sang mục "Lỗi điện thoại để sau".
- 2C-1: (1) Cây truy cập (bảng ẩn cho trình đọc màn hình) của Glide không dựng trên React 19 nên grid chưa đọc được bằng trình đọc màn hình; khung chi tiết dòng là DOM thường nên đọc được. Cần Dương quyết có bắt buộc không (bắt buộc thì phải thêm bảng DOM song song hoặc đổi thư viện). (2) Cột Mã dòng hiện `#<số dòng>` (dễ đọc), trong khi export/API trả mã dòng dạng uuid. (3) Không có "nhảy tới dòng thứ N" của bảng rất lớn (keyset); lọc/sắp xếp/tìm ở 2C-2 thay cho việc đó. (4) Cột Liên kết và Đính kèm mới chỉ xem; sửa cần ô chọn dòng đích và tải file (2C-3). (5) Hoàn tác/làm lại chỉ trong phiên mở bảng (máy khách), không đọc lịch sử dòng của server.
- 2C-1 chưa thử trên điện thoại thật (chạm trong grid canvas, bàn phím ảo với khung chọn, cuộn cảm ứng) và chưa chạy `impeccable audit`.
- 2B+: ngân sách đối soát 1.000.000 dòng/đêm và thời gian chờ mặc định 5 s là giá trị tự chọn; Dương chỉnh nếu cần.
- 2B: cảnh báo `LEFT(ngày,2)` khi import đã làm ở 2D (báo ở bước Kiểm tra, không tự sửa công thức). Dương xem có muốn tự đổi sang `TEXT(ngày,"mm")` không.
- Module 6 (mục 12): câu hỏi ở mục cuối mỗi file, chờ Dương trả lời rồi chốt; chốt xong cập nhật CLAUDE.md theo mục "Thay đổi so với quy định đã chốt" của từng file.
- Stage 9 Onboarding: lúc bắt đầu stage hỏi Dương có tính là ngoại lệ (kiểm giao diện kỹ) với cách kiểm thử tiết kiệm token không; tới lúc đó giữ quy định cũ trong CLAUDE.md (kiểm kỹ).
- Module 4: bảng Thanh toán (mục 7) chờ Dương bàn với Manager (nguồn tiền về, com POD, nguồn Level BC/Performance BC, thu hồi com, com POD Express và Data).
- `docker-compose.yml` chưa chạy thử (máy dev không có Docker); Google chưa thử với Google thật (xem `design/ha-tang.md` mục 4).
- Danh sách token cần duyệt và tài khoản hệ thống chưa phân trang (giới hạn 500); phân trang ở Stage 5.

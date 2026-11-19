# Tiến độ

Cập nhật: 19/11/2026

## Giai đoạn hiện tại

- Thiết kế: Module 0–4 đã chốt (Module 4 chốt 19/11, mục 7 Thanh toán còn là khung). **Module 5, 6: bản nháp vòng 1 xong** (`design/module5-ket-noi-ai.md`, `design/module6-thong-bao.md`, 19/11), chờ Dương phản biện. **Module 7 đã chốt** (19/11; CLAUDE.md, Module 0, 4 đã ghi thay đổi; Module 2 mục 11 chưa ghi giới hạn 150 cột vì Sonnet đang sửa file đó, ghi khi rảnh). Câu hỏi ở mục cuối mỗi file.
- Code: Stage 0 và Stage 1 xong. Stage 2: 2A, 2B, 2B+, 2C-1, 2C-2 xong và Opus đã rà soát (19/11); **2C-3 xong (Sonnet, chờ Opus rà soát)**; 2C-4, 2D, 2E chưa làm. Dương yêu cầu: làm xong 2B+ và 2C rồi push lên `main` và báo.

## Ghi chú điều phối (Opus) — đọc trước khi làm tiếp

1. 2A đã push `main` + `dev`. 2B+ Opus đã rà soát (19/11): đạt, `pnpm lint`/`typecheck`/`test` 511 pass. 2C-1 Opus đã rà soát: đạt, còn 3 việc chuyển sang phần sau: (a) kéo thanh cuộn xuống cuối bảng 100.000 dòng mất 5,8 s, yêu cầu nhảy tới vị trí bất kỳ < 1 s (đọc thẳng cửa sổ quanh vị trí, đúng cả khi lọc/sắp/nhóm) — giao trong 2C-2; (b) cột Liên kết, Đính kèm sửa được — 2C-3; (c) `impeccable audit` cho grid — 2C-2.
2. **2C-2, 2C-3 xong, Opus đã rà (19/11)**. 2C-3: rà lần 1 tìm 3 lỗi (quyền ghi mã file ở ô Đính kèm, hồi quy bộ chọn e2e 2C-2, liên kết chỉ cùng datahub), đã sửa (106488a, 05b9202); Opus chạy lại 216 test API Datahub pass. **Tiếp: 2C-4 (Sonnet).** Sau đó 2D, 2E, rồi Opus rà và push `main` theo yêu cầu của Dương. Nguyên tắc thêm: bước con đụng thành phần dùng chung thì chạy lại e2e desktop của mọi spec dùng thành phần đó.
   - **Chỗ dừng (19/11, ~12h, Opus còn ~6% quota):** đã push `main` + `dev` tại 42f253f (Dương yêu cầu; gồm tới 2C-3). **2C-4 đang dở (Sonnet, phiên mới)**: lúc dừng mới có phần Tìm dòng trùng ở server chưa commit (`apps/api/src/modules/datahub/duplicates.ts`, `apps/api/test/datahub-duplicates.test.ts`, sửa `datahub/index.ts`). Phiên sau: xem `git status`/`git log` từ 42f253f để biết Sonnet làm tới đâu, chạy `pnpm exec vitest run apps/api/test/datahub-duplicates` rồi làm tiếp 2C-4 theo mục "Đang làm" (tìm dòng trùng mục 7a, chia sẻ mục 10, thùng rác, giới hạn Admin mục 11; e2e `stage2c4.spec.ts` desktop). Chuẩn giao diện không rà (Stage 12). Sau 2C-4: Opus rà (chỉ unit phần sửa + e2e spec liên quan, mỗi spec 1 lần), rồi 2D, 2E.
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
- **2C-4 đang làm (Sonnet)**: Tìm dòng trùng, chia sẻ, thùng rác, giới hạn Admin. Kế hoạch: (1) server tìm trùng [xong: `datahub.row.duplicates`, `datahub.row.duplicates.resolve`, `duplicates.ts`, test `datahub-duplicates`]; (2) giao diện tìm trùng; (3) giao diện chia sẻ; (4) giao diện thùng rác; (5) trang giới hạn Admin theo người (cài đặt chung đã có trong trang Cài đặt hệ thống); (6) e2e `stage2c4.spec.ts`; (7) ghi quyết định. Server chia sẻ/thùng rác/giới hạn đã có từ 2A, chỉ thiếu giao diện.
- 2D: import/export, import công thức, load test 100k dòng.
- 2E: Sonnet kiểm thử **chức năng** cả Stage 2 ("Định nghĩa xong" điểm 2–5; không rà chuẩn giao diện, để Stage 12) theo việc Opus chia, sửa lỗi tìm thấy; Opus đọc kết quả và quyết định đạt.

## Bước tiếp theo

**Làm tiếp 2C-4 (Sonnet).** Đã commit: (1) server Tìm dòng trùng xong và test pass (`apps/api/src/modules/datahub/duplicates.ts`: `datahub.row.duplicates`, `datahub.row.duplicates.resolve`; `apps/api/test/datahub-duplicates.test.ts` 6 test pass; OpenAPI + Bruno đã sinh); (2) `apps/web/src/lib/datahub/duplicates.ts` + `apps/web/test/duplicates.test.ts` (5 test pass) + `findDuplicates`/`resolveDuplicates` trong `lib/datahub/api.ts`; (3) `apps/web/src/pages/datahub/duplicates-dialog.tsx` viết xong nhưng **chưa gắn, chưa typecheck/lint, chưa chạy**.
Việc còn lại, theo thứ tự:

1. Gắn `DuplicatesDialog` vào `table-view.tsx` (slot `extra` của `ViewTools`, nút "Tìm dòng trùng" cạnh "Cột của bảng", chỉ khi `table.access` là `owner` hoặc `edit_data`); chạy `pnpm -r typecheck` và `pnpm exec eslint .`, sửa lỗi dialog (nút "Tải thêm nhóm" đang tính offset lộn xộn: nên dùng offset = số nhóm đã tải, bỏ `removedIds`).
2. Giao diện Chia sẻ (server `datahub.share.list/set/remove` đã có): nút "Chia sẻ" ở header `detail.tsx` cho chủ; hộp thoại chọn người bằng `lookupPeople` (danh sách tự sinh, không gõ email), chọn cả datahub hoặc từng bảng, quyền Xem/Sửa, đổi quyền, thu hồi.
3. Giao diện Thùng rác (server `datahub.trash.list` + các lệnh `*.restore` đã có): trang `/datahub/thung-rac` (datahub, bảng) và hộp thoại trong bảng (cột, dòng; `datahub.trash.list` với `table_id`), nút Khôi phục (tên trùng thì hỏi tên mới), hiện hạn xoá hẳn `purge_at`; thêm route ở `router.tsx` và liên kết từ `list.tsx`.
4. Trang Admin giới hạn theo người (`datahub.limit.user.list/set`, route mới `/quan-tri/datahub-gioi-han` ở `router.tsx`, đặt trong `pages/admin.tsx`); giới hạn chung và hạn thùng rác đã có sẵn ở trang Cài đặt hệ thống. `form.table_max_columns` chưa ghi vì Module 7 chưa code.
5. e2e `apps/web/e2e/stage2c4.spec.ts` (desktop): chia sẻ Xem và Sửa rồi kiểm quyền thực tế; tìm trùng và xử lý (từng nhóm, mọi nhóm); xoá rồi khôi phục từ thùng rác; Admin đổi giới hạn và giới hạn có tác dụng. Chạy `pnpm test:e2e stage2c4 --project=desktop`, rồi `stage2c1 stage2c2 stage2c3` vì đụng `table-view.tsx`.
6. Ghi mục "Stage 2C-4" cuối `design/module2-quyet-dinh-khi-code.md` (quyết định: khoá so chuẩn hoá bằng `soe_unaccent`, dòng khoá trống hết không tính trùng, `all` giới hạn 1000 nhóm mỗi lần và bỏ qua nhóm trên 2000 dòng, không gộp cột Đính kèm), cập nhật lệnh/kết quả test vào progress.md, commit. Không push.

### Việc cho kiểm thử cuối Stage 2 (dời từ 2C-2)

- (Dời sang Stage 12) `impeccable detect --url` cho grid + thanh công cụ view.
- Theo dõi lỗi hết giờ `stage1.spec.ts` phone "cài đặt hệ thống" (thấy 1 lần, chạy lại thì pass; có thể cùng nguyên nhân Vite tải lại trang, đã sửa ở `vite.config.ts`).

### Kết quả kiểm thử 2C-2

- `pnpm lint`, `typecheck` sạch; `pnpm test` 606 pass (21 mới ở `apps/web/test/view-config.test.ts`); `pnpm test:e2e`: stage1 + stage2c1 + `stage2c2.spec.ts` (10 luồng) ở 1280x800 và 375x812, không lỗi console/network (chạy đầy đủ lần cuối: 74 pass, 8 bỏ qua; một lần trước đó stage1 phone hết giờ, chạy lại thì pass).
- Đã đi (chủ, người Xem, người Sửa): tab view (thêm tên 100 ký tự có `<b>`, đổi tên, sao chép, xoá, URL giữ view), lọc lồng nhau + lọc rỗng + "Xoá bộ lọc", sắp xếp theo cột công thức, nhóm + dòng tổng + đóng/mở nhóm, ô Thời gian (số dòng khớp server, kỳ cụ thể ‹ ›, chip), cột (ẩn, thứ tự, cố định), chiều cao dòng, tô màu (server trả `marks`), tìm kiếm, view dùng cột đã xoá, người Xem/Sửa đổi view chung thành bản riêng + "Về mặc định", 10.000 dòng lọc + sắp, nhóm quá 1.000 nhóm, 100.000 dòng nhảy tới cuối/giữa/10%/77% (70–120 ms tới khi server trả lời; đúng cả khi sắp xếp và nhóm), 40 cột tên dài ở 375px.
- Lỗi tìm thấy và đã sửa: view ghi tên cột (API/AI) bị coi là cột đã xoá (nay đổi sang key khi nạp); danh sách tên người tra cả mã lựa chọn (400); bộ lọc một điều kiện bị bọc thừa trong nhóm; bấm dòng nhóm mở rồi đóng ngay (click + activate cùng bắn); nhãn dòng nhóm bị cắt (nay chỉ giá trị + số dòng, tên cột trong tooltip); vùng chạm dưới 44px ở nút icon, ô tích, nút × của chip trên điện thoại.
- `impeccable audit`: bộ dò mã nguồn (`impeccable detect`) không báo gì ở `pages/datahub` và popover; rà tay (a11y, vùng chạm, tương phản bằng token, tab/focus, 375px, không animation mới). `ui-ux-pro-max` mục 1–3, 8 và `break-ui` đã rà. **Chưa dò trang thật bằng `detect --url`** (chưa có máy chủ dev chạy sau test) và chưa thử trên máy thật.

### Kết quả kiểm thử 2C-3

- **Sửa theo rà soát Opus (19/11):** (1) `checkRefs` đòi mọi mã file trong ô là file của người ghi: nay `checkFiles` chỉ kiểm mã mới của dòng; test `datahub-column-ui` có ca người Sửa thêm file vào ô của chủ, chủ gỡ file của người Sửa, chép mã lạ (kể cả mã ở dòng khác), create, upsert, restore_batch. (2) `stage2c2` `openTool` khớp nhầm nút "Cột của bảng": regex nay loại trừ; nguyên tắc mới: bước con đụng thành phần dùng chung thì chạy lại e2e desktop của mọi spec dùng nó. (3) Liên kết chọn bảng của mọi datahub của cùng chủ (server `relation.labels`/`relation.search` theo `owner_id`; giao diện Datahub → Bảng; e2e tạo cột liên kết sang datahub khác); test phân quyền: bảng của chủ khác bị từ chối, chủ khác không đọc được. Test sau sửa: eslint, typecheck sạch; vitest 102 pass (datahub-column-ui, datahub-lookup, datahub-rows, apps/web); `pnpm test:e2e stage2c1 stage2c2 stage2c3 --project=desktop` 31/31 pass, 2 lần liền (2,8 và 2,7 phút).
- Lệnh đã chạy: `pnpm exec eslint .` (sạch), `pnpm -r typecheck` (sạch), `pnpm exec vitest run apps/web apps/api/test/datahub-column-ui.test.ts apps/api/test/openapi.test.ts apps/api/test/datahub-lookup.test.ts apps/api/test/datahub-columns.test.ts apps/api/test/datahub-access.test.ts` (9 file, 140 test pass; mới: `column-config` 20, `formula-assist` 19, `datahub-column-ui` 3), `pnpm test:e2e stage2c3 --project=desktop` 6/6 pass, chạy liên tiếp 4 lần cuối đều 6/6. Chưa chạy `pnpm test` toàn bộ, chưa chạy 375px (theo quy trình; dời sang 2E).
- Đã đi: thêm cột (lỗi tên trống, `[ ]`, trùng không phân biệt hoa thường, lỗi độ dài tối đa, mô tả, bắt buộc), cột Một lựa chọn (trùng tên lựa chọn, màu, thứ tự, đổi tên lựa chọn), đổi kiểu Văn bản sang Số có hộp báo trước ("Giữ lại" không đổi gì; "Đổi kiểu và xoá 1 ô"), xoá + Hoàn tác, công thức (gợi ý hàm và cột, cú pháp in đậm, lỗi gạch chân và bằng lời, lưu bị từ chối, xem trước 5 dòng, chèn tham chiếu, công thức mẫu, sửa công thức, vòng lặp bị từ chối), Liên kết/Lookup/Rollup (chọn từ danh sách, chọn dòng đích trong khung chi tiết và trong ô của grid, bảng đích 1.203 dòng chỉ vẽ dưới 20 dòng, worker tính lookup), Đính kèm (loại file không nhận, tải lên, hiện tên và dung lượng, tải về đúng nội dung, gỡ), người Xem và người Sửa (server trả 403 cho mọi lệnh cấu trúc, công thức không hiện, người Sửa tải file lên được và không chọn được liên kết, người Xem chỉ tải về).
- Lỗi tìm thấy và đã sửa: (1) lỗi hiện ra khi rời ô làm nút Lưu của hộp thoại dài trượt khỏi con trỏ nên bấm không được, nay nút cố định ở đáy hộp; (2) ô tên bị tự focus bằng bộ hẹn giờ 50 ms nên chữ gõ ngay sau khi mở hộp thoại lọt vào ô tên, nay dùng `autoFocus`; (3) nút trong popover mở từ hộp thoại modal không bấm được (`pointer-events: none`), nay `Popover` đặt `pointer-events: auto`; (4) lệnh cột nhận mã cột hoặc tên, giao diện gửi `id` nên 404, nay gửi `key`; (5) tải file lên bị 403 vì PUT gửi kèm cookie phiên mà không có CSRF, nay `credentials: "omit"` và đổi địa chỉ ký về cùng origin; (6) hộp "Cột của bảng" chặn bấm vào toast "Hoàn tác", nay đóng khi xoá.
- **Chập chờn, chưa tìm ra nguyên nhân:** `stage2c3.spec.ts` luồng 2 ("cột Một lựa chọn") fail 1 lần ở `colByName("Giai đoạn")` sau khi sửa lựa chọn (cột không thấy dù toast "Đã lưu cột" đã hiện), không tái hiện lại trong 10 lần chạy sau (4 lần riêng luồng, 6 lần cả file). Nghi: test đợi theo toast, mà toast của bước trước còn trên màn hình nên đọc trạng thái máy chủ quá sớm. Đã đổi các chỗ đó sang `expect.poll` theo trạng thái máy chủ (hàm `created`, `optionsOf`). Nếu còn thấy thì ghi lại log máy chủ. Chưa kết luận được là lỗi test hay lỗi ứng dụng.
- Ca `stage1.spec.ts` điện thoại (nhiệm vụ Opus thêm giữa chừng): chạy `pnpm test:e2e stage1 --project=phone` 3 lần liền, cả 3 lần 16/16 pass (34,8 s, 32,7 s, 33,8 s). Chạy trước khi Opus huỷ việc này.

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

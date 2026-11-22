# Tiến độ

Cập nhật: 22/11/2026

## Trạng thái

- **Thiết kế:** Module 0–7 đã chốt (Module 6 chốt 21/11). Module 8–11 chưa làm.
- **Code:** Stage 0–7 xong (Stage 4: 4.8 bản cơ bản; Stage 5, 6, 7: bản rút gọn). **Stage 8 (Knowledge + AI Hub) xong 8A, 8B (Opus rà đạt) và 8C (xong 22/11, chờ Opus rà).** Mốc test: vitest cả bộ 1343 pass 10 skip (mã dbe0ec0), e2e desktop stage8+stage6 5 pass (mã f6de013). Typecheck 0 lỗi, lint sạch. Việc dời: `design/update_v1.md`.
- **Git:** đã push `main` + `dev` tới 56b1834 (hết 4.4, Dương yêu cầu 21/11). Sau đó chưa push.
- **Mốc test** (không chạy hai lệnh vitest song song, chung DB): mốc 4.7B (mã c9c807e) vitest 1235 pass 9 skip 0 fail; mốc trước (4.6E, mã 9695a8b) vitest 1218 pass 9 skip; e2e desktop 116–124 pass.

## Đã xong

- **Stage 0–3:** nền tảng, tài khoản/phân quyền, Datahub (106 hàm, golden khớp Excel), metric + dashboard + Guest. Quyết định: `design/module{0..3}-*.md`, `design/module{2,3}-quyet-dinh-khi-code.md`.
- **4.1** (20/11) sửa Stage 2: khoá phân chia, tính theo người đọc, bảng template, giao diện chia sẻ (`module4-quyet-dinh-khi-code.md` 4.1a–d).
- **4.2** bộ bảng mặc định theo cây, kiểu Người dùng có thuộc tính. **4.3** giao diện Quản lý Deal + trang Template. **4.4** thanh toán và com theo đợt (4.4A server, 4.4B web). **4.5** chốt kỳ, BANT, forecast, snapshot (+ sửa chập chờn: `columnTx`, hàng đợi ưu tiên). **4.6** chỉ số, dashboard Deals, `deal.cycle`, hiệu năng hàng đợi (4.6A–D). Quyết định chi tiết: `design/module4-quyet-dinh-khi-code.md` 4.2–4.6D; bản đồ: `design/ban-do-code.md`.
- **4.6E** (22/11) hàm người xem ME/ISME/ATTR, bộ mặc định bỏ phần cứng, vai trò đa cột `nguoi_tham_gia`; phần còn lại làm ở 4.7A (INSCOPE/ATTRSUM, lệnh tiền tính ngay, trần % com ở lệnh).

## Còn nợ / ghi nhận để sau

- Phần thiết kế đã chốt nhưng dời (M4, M5, M6): `design/update_v1.md`, làm sau phiên bản đầu.
- **4.8 bản cơ bản (Dương chốt 22/11):** vitest cả bộ một lần (`DH_EQUIV_EDITS=2500`), e2e cả bộ một lần, load test 20.000 deal (chỉ ghi số, sửa khi vượt rõ 3 s), chỉ sửa lỗi thật. Dời: Bruno sang Stage 5; bù cột còn thiếu cho cây đang chạy (cột mới, `Mã ngoài`, cột team thành công thức); 375px sang Stage 12.
- 4.6: Manager đặt mốc cohort mặc định cho cây; Index của team chưa đọc từ `Doanh thu theo người`; ô lọc theo cột của biểu đồ chưa có nhóm Vai trò.
- 4.5: việc tính lại nền xếp sau việc người dùng, chưa chống đói. 4.1b: đổi cây của một người tính lại 3,6 s.
- 4.7A: Guest cấp bảng, nhiều team cùng cấp thì cột theo người đọc để trống; created_by/updated_by (id người) vẫn có trong dòng Guest đọc; `com_split` gửi tay chưa kiểm trần; khoá ghép nhiều cột cho upsert chưa có (dùng một cột Duy nhất dạng `nguồn:mã`).
- Cột phụ thuộc người xem tính lúc đọc (Dương 22/11: hoãn; dùng `dh_personal_rows`). Xem lại khi thấy chậm.
- Stage 3: người xem qua chia sẻ dashboard không tự tải lại khi dữ liệu đổi; chữ giữa gauge, lọc chéo cột < 1 px (Stage 12).
- Grid chưa `impeccable audit`, chưa thử điện thoại thật (Stage 12). Module 2 mục 11 chưa ghi giới hạn 150 cột cho bảng có form.
- Chưa thử: chuyển cả cây bằng giao diện, Google Sheet thật, `docker-compose.yml`, đăng nhập Google thật (`design/ha-tang.md` mục 4).


## Lỗi điện thoại để sau

Không chặn bước con; gom sửa một đợt. `stage1.spec.ts` phone "cài đặt hệ thống" từng hết giờ 1 lần (`pnpm test:e2e stage1 --project=phone`), theo dõi.

## Câu hỏi còn mở (chờ Dương)

- Guest xem dashboard (3C-2): cờ `guest_visible` theo dashboard đúng ý Module 1 mục 5.2 chưa, hay cấp theo từng dashboard ở khung cấp dữ liệu? Nhật ký xem dashboard chỉ ghi lần mở `view`.
- Grid và trình đọc màn hình (2C-1): có bắt buộc bảng DOM song song không. Cột Mã dòng `#<số>` vs uuid ở export/API.
- Đối soát công thức (2B+): ngân sách 1.000.000 dòng/đêm, chờ 5 s là giá trị tự chọn.
- Module 4 (4.4A): cây đã tạo trước 4.4 giữ `Đã thu` là cột thường; bảng Tiền về "chỉ Manager" làm bằng khoá phân chia theo cột `Người xem` luôn trống.
- Stage 9 Onboarding: hỏi Dương có kiểm giao diện kỹ như ngoại lệ không. (Danh sách token chưa phân trang: dời, xem "Còn nợ".)

## Stage 5, 6, 7 (bản rút gọn, xong 22/11, Opus rà đạt)

Phạm vi: `design/module5-ket-noi-ai.md` mục 12, `module6-thong-bao.md` mục 14, `module7-dynamic-form.md` mục 14; quyết định `design/module{5,6,7}-quyet-dinh-khi-code.md`; bản đồ `design/ban-do-code.md`.
- **Stage 5:** token cá nhân = kết nối (menu + mức, Admin duyệt/thu hẹp/thu hồi), `ai-gate.ts`, `/mcp` không trạng thái, web Kết nối AI, Bruno `mcp/`, `docs/ket-noi-ai.md`.
- **Stage 6:** một cửa `notify.send` (19 loại), nhắc hẹn, bản tin 08:00, nhắc hạn Deal 08:30, thông báo chung; web `pages/notify/`; migration 0024, 0025. Dời: giới hạn 10 thông báo chung/ngày, phân trang, nhãn tiếng Việt từng loại, vài loại thông báo (xem `update_v1.md`).
- **Stage 7:** form + bảng đích, xuất bản/phiên bản, gửi bài, nháp, bài kiểm tra + chấm, MCP `form_*`; web `pages/form/` (trình soạn dnd-kit, trang điền `/f/<mã>` công khai). Dời: ô tải file form nội bộ, nút thông báo phản hồi mới.
- Test cuối: vitest 1328 pass 10 skip; e2e desktop 28 pass; không cả bộ e2e, không `break-ui`.

## Stage 8: Knowledge + AI Hub (8C xong 22/11, chờ Opus rà)

Phạm vi `design/module8-knowledge-aihub.md`; quyết định `design/module8-quyet-dinh-khi-code.md` (8A, 8B, 8C); bản đồ `design/ban-do-code.md` "Module 8"; migration 0028 (`posts`, `post_versions`), 0029 (`download_count`). Test tối giản theo ý Dương (đơn giản, nhanh, đủ).
- **8A:** engine Bài đăng `apps/api/src/modules/publish/`, Knowledge `modules/knowledge/`, tìm kiếm không dấu, MCP `knowledge_*`, `review_*`; `knowledge.test.ts` 9 ca. Dời: lệnh xoá bài, thông báo khi gỡ xuất bản.
- **8B:** skill `modules/aihub/` (zip/thư mục, luật mục 4.2, `beforePublish`, tải zip base64), MCP `skill_*`; `aihub.test.ts` 5 ca; Bruno `aihub/`. Vitest cả bộ 1343 pass.
- **8C (web):** Knowledge (`pages/knowledge/`: trang chủ, đọc + mục lục, soạn Tiptap, Bài của tôi), AI Hub (`pages/aihub/`: danh sách, trang skill, tải lên zip/thư mục/kéo thả, Skill của tôi), hàng chờ chung `/duyet` (`pages/review/queue.tsx`: cảnh báo ở đầu, bản đang xuất bản xem riêng, Duyệt/Trả lại), dùng chung `pages/library/common.tsx`; menu Knowledge, AI Hub, Duyệt bài trong `shell.tsx`. Tiptap 2.27 thêm vào `apps/web`. e2e `apps/web/e2e/stage8.spec.ts` 2 luồng (bài: soạn, duyệt, tìm không dấu, đọc; skill: zip có đường dẫn cá nhân, cảnh báo ở đầu màn duyệt, duyệt, tải zip): `node apps/web/e2e/run.mjs e2e/stage8.spec.ts e2e/stage6.spec.ts --project=desktop` 5 pass 0 fail (mã f6de013). Không chạy lại vitest (8C chỉ sửa web; ca bản đồ `ban-do-code` 2 pass).
- **Dời / chưa làm:** ảnh tải lên trong bài (đang chèn bằng link), phân trang danh sách, tìm skill để chọn `replaces` (đang là danh sách 50 skill mới nhất), render Markdown của SKILL.md (đang văn bản thô), cảnh báo "tên người cụ thể", e2e 375px, rà chuẩn giao diện (Stage 12).
- **Bước tiếp:** Opus rà 8C rồi ghi "Đã xong" cột Code Stage 8; sau đó thiết kế Module 9 (Onboarding) hoặc 10.

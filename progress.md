# Tiến độ

Cập nhật: 22/11/2026

## Trạng thái

- **Thiết kế:** Module 0–7 đã chốt (Module 6 chốt 21/11). Module 8–11 chưa làm.
- **Code:** Stage 0–3 xong. Stage 4 xong 22/11 (4.8 bản cơ bản, Opus rà đạt). Tiếp: Stage 5 bản rút gọn (Dương chốt 22/11, `design/module5-ket-noi-ai.md` mục 12): 5A1 registry + kết nối + executor → 5A2 `/mcp` + tool (xong) → 5B giao diện, tài liệu, kiểm thử cuối stage. 5B xong, chờ Opus rà; sau đó Stage 6.
- **Git:** đã push `main` + `dev` tới 56b1834 (hết 4.4, Dương yêu cầu 21/11). Sau đó chưa push.
- **Mốc test** (không chạy hai lệnh vitest song song, chung DB): mốc 4.7B (mã c9c807e) vitest 1235 pass 9 skip 0 fail; mốc trước (4.6E, mã 9695a8b) vitest 1218 pass 9 skip; e2e desktop 116–124 pass.

## Đã xong

- **Stage 0–3:** nền tảng, tài khoản/phân quyền, Datahub (106 hàm, golden khớp Excel), metric + dashboard + Guest. Quyết định: `design/module{0..3}-*.md`, `design/module{2,3}-quyet-dinh-khi-code.md`.
- **4.1** (20/11) sửa Stage 2: khoá phân chia, tính theo người đọc, bảng template, giao diện chia sẻ (`module4-quyet-dinh-khi-code.md` 4.1a–d).
- **4.2** bộ bảng mặc định theo cây, kiểu Người dùng có thuộc tính. **4.3** giao diện Quản lý Deal + trang Template. **4.4** thanh toán và com theo đợt (4.4A server, 4.4B web). **4.5** chốt kỳ, BANT, forecast, snapshot (+ sửa chập chờn: `columnTx`, hàng đợi ưu tiên). **4.6** chỉ số, dashboard Deals, `deal.cycle`, hiệu năng hàng đợi (4.6A–D). Quyết định chi tiết: `design/module4-quyet-dinh-khi-code.md` 4.2–4.6D; bản đồ: `design/ban-do-code.md`.
- **4.6E** (22/11) hàm người xem ME/ISME/ATTR, bộ mặc định bỏ phần cứng, vai trò đa cột `nguoi_tham_gia`; phần còn lại làm ở 4.7A (INSCOPE/ATTRSUM, lệnh tiền tính ngay, trần % com ở lệnh).

## Đang làm: Stage 5 bản rút gọn (5A1, 5A2, 5B xong 22/11, chờ Opus rà 5B)

Phạm vi: `design/module5-ket-noi-ai.md` mục 12; quyết định: `design/module5-quyet-dinh-khi-code.md` (5A1, 5A2, 5B); bản đồ: `design/ban-do-code.md` "Module 5"; hướng dẫn người dùng: `docs/ket-noi-ai.md`.

**Tóm tắt Stage 5:** token cá nhân = kết nối (menu + mức, Admin duyệt/duyệt bớt, thu hẹp, thu hồi); executor giao quyền ở `ai-gate.ts`; `/mcp` không trạng thái (4 tool chung + 6 tool chọn lọc, `deal.dashboard`); import mở cho AI (analyze/sheet/preview mức Xem menu Datahub, start theo bảng đích, thay toàn bộ cần Toàn quyền); web: Cài đặt → Kết nối AI (tạo, lệnh cài sao chép, thu hẹp, thu hồi), Quản trị → Kết nối AI (duyệt bớt, công tắc khẩn cấp, 5 nhóm cấm), nhật ký hiện tên kết nối; Bruno `docs/api/bruno/mcp/`, `deal/dashboard.bru`. Thử thật Claude Code (22/11) đúng; đo token: `tools/list` đủ menu khoảng 2.006 token, `deals_list` 50 dòng khoảng 3.418 token.

**5B:** typecheck api 0 lỗi mới, web 31 (bằng mốc), lint sạch. Test mã 5f4705a: `ai-connections`, `mcp`, `openapi`, `datahub-import`, `ban-do-code` pass. e2e (`node apps/web/e2e/run.mjs e2e/stage5.spec.ts e2e/stage1.spec.ts --project=desktop`): 19 pass, 0 fail. Vitest cả bộ (`DH_EQUIV_EDITS=2500`): 1260 pass, 10 skip, 1 fail: `deal-period.test.ts` BANT "rule H-002" hết 20 s khi chạy cả bộ; chạy riêng file 2 lần: 13/13 pass. Không liên quan 5B (không đụng deal/BANT); nghi nghẽn khi cả bộ chạy, Opus quyết có điều tra (chạy lặp nhóm file trước nó) hay không. Không chạy cả bộ e2e, không 375px (theo phạm vi).

## 4.8 Kiểm thử cuối Stage 4 (bản cơ bản)

**Xong 22/11** (code dưới mã commit ghi trong git log "4.8"). e2e desktop cả bộ một lần: 126 pass, 2 fail (`stage4-4` ngăn chi tiết deal, `stage4-7` 4.7B1 Chốt kỳ; cả hai hết giờ `toBeVisible`). Hai fail xảy ra đúng lúc load test 20.000 deal chạy song song trên cùng máy (nghẽn CPU); chạy riêng hai spec 3 lần: 14/14 pass mỗi lần, nên coi là nhiễu do chạy song song, không sửa code. Lần sau không chạy load test trong lúc e2e. Không chạy vitest cả bộ (4.7B2 đã chạy, 1235 pass, không có code đổi).
**Load test** `apps/api/test/deal-perf.test.ts` (20.000 Deals, 40.000 đợt, người tham gia như deal mẫu, dòng nhân bản bằng SQL từ một deal tạo bằng lệnh thật): `datahub.deal.home` 4 ms; list Deals lọc Start date + sắp xếp, 50 dòng 31 ms; `metrics.query` tổng `role:doanh_thu` 29 ms; `metrics.dashboard.view` 68 ms, mỗi `metrics.chart.data` của dashboard Deals 20-21 ms; `period.review` 2026-07 472 ms; `payment.confirm` một đợt 70 ms. Tất cả xa ngưỡng 3 s, test chỉ `expect` < 3 s. Chưa có `dh_personal_rows` cho dòng nhân bản (cột theo người xem tính lúc đọc cho 20.000 dòng chưa đo).
Lỗi đã sửa: không có lỗi code.

## Còn nợ / ghi nhận để sau

- Dời từ 4.8: sinh lại snapshot drizzle cho migration 0021, 0022 (viết tay) khi `drizzle-kit` chạy được, kiểm `db:generate` không sinh diff thừa.
- **4.8 bản cơ bản (Dương chốt 22/11):** vitest cả bộ một lần (`DH_EQUIV_EDITS=2500`), e2e cả bộ một lần, load test 20.000 deal (chỉ ghi số, sửa khi vượt rõ 3 s), chỉ sửa lỗi thật. Dời: Bruno sang Stage 5; bù cột còn thiếu cho cây đang chạy (cột mới, `Mã ngoài`, cột team thành công thức); 375px sang Stage 12.
- 4.6: Manager đặt mốc cohort mặc định cho cây; Index của team chưa đọc từ `Doanh thu theo người`; ô lọc theo cột của biểu đồ chưa có nhóm Vai trò.
- 4.5: việc tính lại nền xếp sau việc người dùng, chưa chống đói. 4.1b: đổi cây của một người tính lại 3,6 s.
- 4.7A: Guest cấp bảng, nhiều team cùng cấp thì cột theo người đọc để trống; created_by/updated_by (id người) vẫn có trong dòng Guest đọc; `com_split` gửi tay chưa kiểm trần; khoá ghép nhiều cột cho upsert chưa có (dùng một cột Duy nhất dạng `nguồn:mã`).
- Cột phụ thuộc người xem tính lúc đọc (Dương 22/11: hoãn; dùng `dh_personal_rows`). Xem lại khi thấy chậm.
- Stage 3: người xem qua chia sẻ dashboard không tự tải lại khi dữ liệu đổi; chữ giữa gauge, lọc chéo cột < 1 px (Stage 12).
- Grid chưa `impeccable audit`, chưa thử điện thoại thật (Stage 12). Module 2 mục 11 chưa ghi giới hạn 150 cột cho bảng có form.
- Chưa thử: chuyển cả cây bằng giao diện, Google Sheet thật, `docker-compose.yml`, đăng nhập Google thật (`design/ha-tang.md` mục 4).

- **Stage 5 dời (mục 12):** OAuth + DCR cho claude.ai/Claude Desktop/ChatGPT (làm khi lên VPS); key API của cây (cùng BPM); thao tác lớn qua AI (chốt kỳ, mở lại kỳ, xác nhận tiền về hàng loạt, sửa template); phân trang danh sách token (500). Chỗ dở 5A2: `metrics_query` không đợi `consistent`; `deals_list` `period_mode: expected` chưa tính đợt chưa về hạn như forecast; `soe_call` kiểm đầu vào trước quyền nên thao tác cấm cứng với đầu vào sai trả `validation_error`; chưa có `datahub_list`, `table_schema`, `soe_find`; Codex chưa thử thật; giới hạn 120 gọi/30 ghi mỗi phút theo kết nối.

## Lỗi điện thoại để sau

Không chặn bước con; gom sửa một đợt. `stage1.spec.ts` phone "cài đặt hệ thống" từng hết giờ 1 lần (`pnpm test:e2e stage1 --project=phone`), theo dõi.

## Câu hỏi còn mở (chờ Dương)

- Guest xem dashboard (3C-2): cờ `guest_visible` theo dashboard đúng ý Module 1 mục 5.2 chưa, hay cấp theo từng dashboard ở khung cấp dữ liệu? Nhật ký xem dashboard chỉ ghi lần mở `view`.
- Grid và trình đọc màn hình (2C-1): có bắt buộc bảng DOM song song không. Cột Mã dòng `#<số>` vs uuid ở export/API.
- Đối soát công thức (2B+): ngân sách 1.000.000 dòng/đêm, chờ 5 s là giá trị tự chọn.
- Module 4 (4.4A): cây đã tạo trước 4.4 giữ `Đã thu` là cột thường; bảng Tiền về "chỉ Manager" làm bằng khoá phân chia theo cột `Người xem` luôn trống.
- Stage 9 Onboarding: hỏi Dương có kiểm giao diện kỹ như ngoại lệ không. (Danh sách token chưa phân trang: dời, xem "Còn nợ".)


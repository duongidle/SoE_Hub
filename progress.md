# Tiến độ

Cập nhật: 22/11/2026

## Trạng thái

- **Thiết kế:** Module 0–7 đã chốt (Module 6 chốt 21/11). Module 8–11 chưa làm.
- **Code:** Stage 0–3 xong. Stage 4 xong 22/11 (4.8 bản cơ bản, Opus rà đạt). Tiếp: Stage 5 bản rút gọn (Dương chốt 22/11, `design/module5-ket-noi-ai.md` mục 12): 5A1 registry + kết nối + executor → 5A2 `/mcp` + 7 tool → 5B giao diện, tài liệu, kiểm thử cuối stage. Đang làm: 5A2.
- **Git:** đã push `main` + `dev` tới 56b1834 (hết 4.4, Dương yêu cầu 21/11). Sau đó chưa push.
- **Mốc test** (không chạy hai lệnh vitest song song, chung DB): mốc 4.7B (mã c9c807e) vitest 1235 pass 9 skip 0 fail; mốc trước (4.6E, mã 9695a8b) vitest 1218 pass 9 skip; e2e desktop 116–124 pass.

## Đã xong

- **Stage 0–3:** nền tảng, tài khoản/phân quyền, Datahub (106 hàm, golden khớp Excel), metric + dashboard + Guest. Quyết định: `design/module{0..3}-*.md`, `design/module{2,3}-quyet-dinh-khi-code.md`.
- **4.1** (20/11) sửa Stage 2: khoá phân chia, tính theo người đọc, bảng template, giao diện chia sẻ (`module4-quyet-dinh-khi-code.md` 4.1a–d).
- **4.2** bộ bảng mặc định theo cây, kiểu Người dùng có thuộc tính. **4.3** giao diện Quản lý Deal + trang Template. **4.4** thanh toán và com theo đợt (4.4A server, 4.4B web). **4.5** chốt kỳ, BANT, forecast, snapshot (+ sửa chập chờn: `columnTx`, hàng đợi ưu tiên). **4.6** chỉ số, dashboard Deals, `deal.cycle`, hiệu năng hàng đợi (4.6A–D). Quyết định chi tiết: `design/module4-quyet-dinh-khi-code.md` 4.2–4.6D; bản đồ: `design/ban-do-code.md`.
- **4.6E** (22/11) hàm người xem ME/ISME/ATTR, bộ mặc định bỏ phần cứng, vai trò đa cột `nguoi_tham_gia`; phần còn lại làm ở 4.7A (INSCOPE/ATTRSUM, lệnh tiền tính ngay, trần % com ở lệnh).

## Đang làm: Stage 5 bản rút gọn (5A1 xong 22/11, tiếp 5A2)

Stage 4 (4.1–4.8) xong, lịch sử ở git log và `design/module4-quyet-dinh-khi-code.md`. Phạm vi Stage 5: `design/module5-ket-noi-ai.md` mục 12; quyết định 5A1: `design/module5-quyet-dinh-khi-code.md`; bản đồ: `design/ban-do-code.md` "Module 5".

### 5A1 BÀN GIAO cho 5A2 (`/mcp` + 7 tool)

**Đã xong:** (1) mọi thao tác có `Operation.ai {menu, access, forbidden?}` (`core/ai-policy.ts`, mặc định theo tên, test "mọi thao tác" trong `ai-connections.test.ts`); (2) token cá nhân = kết nối: cột `api_tokens.menus` (migration 0023), `auth.token.create {name, menus?, expires_in_days}`, `auth.token.narrow {id, menus}` (PATCH `/auth/tokens/:id`), `auth.token.approve {id, note?, menus?}` duyệt bớt; Guest Sale 403, Guest Data ép mức Xem; (3) executor giao quyền (`core/executor.ts` `checkAccess`, `core/ai-gate.ts`); (4) test `apps/api/test/ai-connections.test.ts` 11 ca; (5) `deal-perf` chạy riêng bằng `SOE_PERF=1 pnpm exec vitest run apps/api/test/deal-perf.test.ts`.
**Cách `/mcp` dùng executor:** dựng actor `{userId, via: "mcp", connectionId: <id token>, connectionKind: "personal", connectionName: <tên token>, ...}` rồi `executor.execute(name, input, {actor, requestId})`. Executor tự tải kết nối theo `connectionId` mỗi lần gọi (trạng thái, menu, hạn), kiểm chính sách, quyền chủ, menu+mức, tốc độ. Lỗi: `ai_not_allowed` (cấm cứng, nhóm tắt, công tắc khẩn cấp), `connection_pending` 401, `unauthenticated` (thu hồi, hết hạn), `forbidden` (thiếu menu/mức, câu tiếng Việt kèm `details {reason, menu, held, needed}`), `rate_limited` 429 (`details.retry_after_seconds`). Hàm: `core/ai-gate.ts` `loadConnection`, `menuOfTarget`, `AiRateLimiter`; `core/ai-policy.ts` `MENU_LABELS`, `DEFAULT_CONNECTION_MENUS`, `AI_MENUS`. Chính sách Admin: setting `ai.killed`, `ai.groups_enabled` (ghi bằng `system.setting.set`, test dùng `setAiPolicy` ở `test/fixtures.ts`).
**Test 5A1:** vitest cả bộ (`DH_EQUIV_EDITS=2500 pnpm exec vitest run apps packages`, mã 2ab065f): 1245 pass, 10 skip (9 cũ + `deal-perf`), 1 fail là `ban-do-code.test.ts` (bản đồ ghi sai hai tên hàm), đã sửa ở commit sau, chạy lại 2/2 pass. typecheck api 15, web 31 (bằng mốc), lint sạch.
**Chỗ dở / cho 5A2:** (a) `SessionTokenResolver` (`auth/sessions.ts`) ném `connection_pending` cho token chờ duyệt: `/mcp` cần đường riêng để token `pending` vẫn bắt tay được rồi trả `connection_pending` ở tool (mục 2.4); (b) `datahub.datahub.list` chưa lọc bỏ datahub Quản lý Deal (tool `datahub_list` nếu có phải lọc); (c) `datahub.import.*` và thao tác lớn đang `aiAllowed: false` (xem quyết định); (d) nguồn nhập cột chọn giữ `AI`/`API`, tên kết nối ở nhật ký (câu hỏi cho Opus ở file quyết định); (e) web trang token (`apps/web/src/pages/account.tsx`) vẫn gửi `scopes` (server bỏ qua, dùng menu mặc định), giao diện thật làm ở 5B; (f) `docs/api/bruno` đã cập nhật `token-create`, `token-approve`, `token-narrow`.

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

## Lỗi điện thoại để sau

Không chặn bước con; gom sửa một đợt. `stage1.spec.ts` phone "cài đặt hệ thống" từng hết giờ 1 lần (`pnpm test:e2e stage1 --project=phone`), theo dõi.

## Câu hỏi còn mở (chờ Dương)

- Guest xem dashboard (3C-2): cờ `guest_visible` theo dashboard đúng ý Module 1 mục 5.2 chưa, hay cấp theo từng dashboard ở khung cấp dữ liệu? Nhật ký xem dashboard chỉ ghi lần mở `view`.
- Grid và trình đọc màn hình (2C-1): có bắt buộc bảng DOM song song không. Cột Mã dòng `#<số>` vs uuid ở export/API.
- Đối soát công thức (2B+): ngân sách 1.000.000 dòng/đêm, chờ 5 s là giá trị tự chọn.
- Module 4 (4.4A): cây đã tạo trước 4.4 giữ `Đã thu` là cột thường; bảng Tiền về "chỉ Manager" làm bằng khoá phân chia theo cột `Người xem` luôn trống.
- Stage 9 Onboarding: hỏi Dương có kiểm giao diện kỹ như ngoại lệ không. Danh sách token cần duyệt chưa phân trang (500), làm ở Stage 5.


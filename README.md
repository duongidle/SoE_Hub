# SoE Hub

Nơi làm việc chung của team SoE (Base): deal, chỉ số, Datahub, dashboard, form, onboarding, knowledge, AI Hub, giao việc.
Thiết kế nằm trong `design/`, quy ước làm việc trong `CLAUDE.md`, tiến độ trong `progress.md`.

Trạng thái code: **Stage 1 (tài khoản và phân quyền)** đã xong: đăng nhập, org chart, phân quyền, token, nhật ký, chuyển giao dữ liệu. Chưa có chức năng nghiệp vụ (Datahub, Deal... từ Stage 2).

## Cài máy mới từ đầu

Dành cho máy chưa có công cụ lập trình nào, làm bằng tab **Code** của Claude Desktop (Claude Code). Người dùng chỉ cần bảo Claude: *"Clone https://github.com/duongidle/SoE_Hub, nhánh dev, vào thư mục này rồi cài máy theo README mục Cài máy mới từ đầu"*. Claude làm lần lượt, báo lại bước nào lỗi:

1. **Công cụ:**
   - macOS: Git (`xcode-select --install` nếu chưa có), Homebrew (https://brew.sh), rồi `brew install node pnpm postgresql@17 && brew services start postgresql@17`.
   - Windows: `winget install Git.Git OpenJS.NodeJS pnpm.pnpm PostgreSQL.PostgreSQL.17`. Nên dùng Mac nếu có, Windows hay lỗi vặt với Postgres và đường dẫn.
   - Các lệnh cài hỏi mật khẩu máy thì **người dùng tự gõ**, không đưa mật khẩu cho Claude.
2. **Code:** `git clone https://github.com/duongidle/SoE_Hub.git . && git checkout dev`. Làm trên `dev`, không làm trên `main`.
3. **Cài và dựng:** làm đúng mục "Chạy trên máy dev" bên dưới (`pnpm install`, `cp .env.example .env`, sửa URL Postgres theo user máy, `pnpm db:setup`). Máy dev **không cần secret nào**: `.env.example` đủ chạy, `AUTH_SECRET` chỉ bắt buộc ở production.
4. **Trình duyệt cho e2e:** `pnpm --filter @soe/web exec playwright install chromium`.
5. **Kiểm tra:** `pnpm typecheck` và `pnpm exec vitest run apps packages`. Golden test tự bỏ qua khi máy không có thư mục `examples/` (dữ liệu thật, không nằm trong repo); xin Dương nếu cần so số với Excel.
6. **Đẩy code lên:** Dương thêm tài khoản GitHub của người đó làm collaborator, rồi đăng nhập bằng `gh auth login` (`brew install gh`). Chỉ push khi Dương yêu cầu (CLAUDE.md).

Xong thì đọc `progress.md` để làm tiếp.

## Yêu cầu

- Node.js 22 trở lên (đã thử trên Node 24).
- pnpm 12 (`brew install pnpm`).
- PostgreSQL 17 chạy trên máy, có sẵn `pg_trgm` và `unaccent` (`brew install postgresql@17 && brew services start postgresql@17`).
- Docker chỉ cần cho production. Dev không cần.

## Chạy trên máy dev

```bash
pnpm install
cp .env.example .env          # sửa DATABASE_MIGRATE_URL / DATABASE_ADMIN_URL cho khớp user Postgres của máy
pnpm db:setup                 # tạo database soe_hub và chạy migration (chạy lại được nhiều lần)
pnpm dev                      # api :3000, worker, web :5173
```

Trên macOS với Homebrew, user Postgres mặc định là tên user máy, nên các URL có dạng `postgres://<tên-user>@localhost:5432/soe_hub`.
Nếu lệnh `psql` không có trong PATH: `export PATH=/opt/homebrew/opt/postgresql@17/bin:$PATH`.

Chạy riêng từng phần: `pnpm dev:api`, `pnpm dev:worker`, `pnpm dev:web`.

Kiểm tra:

| Địa chỉ | Nội dung |
|---|---|
| http://localhost:5173 | Trang khung (web dev, tự chuyển `/api` và `/health` sang api) |
| http://localhost:3000/health | Tình trạng api, database, worker |
| http://localhost:3000/api/docs | Tài liệu API (OpenAPI 3.1, giao diện Scalar) |
| http://localhost:3000/api/openapi.json | Tệp OpenAPI |

### Tạo Admin đầu tiên

Hệ thống không có thao tác "tạo tài khoản": mỗi người là một dòng trong org chart. Admin đầu tiên được tạo bằng lệnh trên server:

```bash
pnpm cli admin:create --email ten@base.vn --name "Họ tên"
```

Lệnh in ra mã kích hoạt 6 số (hiệu lực 6 giờ). Mở trang **Đăng ký** (`/dang-ky`), nhập email, bấm **Tôi đã có mã**, nhập mã và đặt mật khẩu. Sau đó Admin thêm Manager, Leader, User trong **Org chart**. Người mới vào trang Đăng ký, bấm **Xin mã**; mã hiện trong chuông thông báo của leader trực tiếp, manager và Admin, người dùng xin mã từ họ.

Trên Docker: `docker compose exec api node dist/cli.js admin:create --email ten@base.vn`.

### Quên mật khẩu của Admin duy nhất

Khi còn Admin khác, họ cấp mã qua chuông như mọi người. Nếu chỉ có một Admin và quên mật khẩu, chạy trên server:

```bash
pnpm cli auth:reset-code --email ten@base.vn
```

Rồi mở trang **Quên mật khẩu** (`/quen-mat-khau`), bấm **Tôi đã có mã**, nhập mã và mật khẩu mới. Mọi lần chạy lệnh đều được ghi vào nhật ký hệ thống.

### Biến môi trường về đăng nhập

| Biến | Ý nghĩa |
|---|---|
| `AUTH_SECRET` | Khoá bí mật cho CSRF, băm mã và mã hoá mã trong outbox. **Bắt buộc trong production** (ngẫu nhiên, từ 32 ký tự, ví dụ `openssl rand -hex 32`); thiếu thì api và worker không khởi động và báo lỗi rõ. Đổi khoá thì mọi người bị đăng xuất |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Đăng nhập Google (tuỳ chọn, mặc định tắt). Để trống nếu không dùng. Muốn bật: điền ba biến rồi Admin bật "Cho phép đăng nhập Google" trong Cài đặt hệ thống. `GOOGLE_REDIRECT_URI` mặc định là `PUBLIC_URL/api/auth/callback/google` |
| `SESSION_IDLE_DAYS`, `SESSION_ABSOLUTE_DAYS` | Phiên hết hạn sau 7 ngày không dùng, tối đa 30 ngày |

Ví dụ gọi API bằng token cá nhân (tạo ở **Tài khoản > Token cá nhân**, Admin duyệt xong mới dùng được):

```bash
curl -H "Authorization: Bearer soe_pat_..." localhost:3000/api/v1/system/whoami
```

## Lệnh thường dùng

| Lệnh | Việc |
|---|---|
| `pnpm test` | Chạy toàn bộ test unit và tích hợp (cần Postgres; tự tạo database `soe_hub_test`) |
| `pnpm test:e2e` | Test giao diện trên trình duyệt thật (xem mục dưới) |
| `pnpm typecheck` | Kiểm tra kiểu TypeScript mọi package |
| `pnpm lint` | ESLint |
| `pnpm build` | Build web và bundle api/worker/migrate |
| `pnpm db:generate` | Sinh migration từ schema Drizzle (sau khi sửa `packages/db/src/schema`) |
| `pnpm db:migrate` | Chạy migration |
| `pnpm docs:openapi` | Xuất OpenAPI ra `docs/api/openapi.json` (bản bàn giao; test báo nếu file cũ) |

Test dùng user Postgres của máy (cần quyền superuser, mặc định của Homebrew). Đổi bằng biến `TEST_ADMIN_URL`.

### Test giao diện (Playwright)

```bash
pnpm --filter @soe/web exec playwright install chromium   # một lần
pnpm test:e2e
```

Lệnh tạo lại database rỗng `soe_hub_e2e`, chạy migration, bật api (cổng 3100), worker và web (cổng 5273), rồi chạy các luồng của Stage 1 ở hai bề ngang: desktop 1440×900 và điện thoại 390×844. Mỗi luồng kiểm tra không có lỗi console và không có request lỗi (trừ 401/403/423 được chờ trước). Ảnh chụp màn hình nằm ở `apps/web/e2e/screenshots/` (không commit). Chạy một phần: `pnpm test:e2e --project=desktop -g "token"`. Dùng cùng user Postgres như `pnpm test` (đổi bằng `E2E_ADMIN_URL`). Test và e2e dùng vai trò Postgres riêng (`soe_app_test`, `soe_app_e2e`) nên không đụng database dev.

## Datahub (Stage 2A, 2B)

2A có phần lưu trữ và API lõi của Datahub: datahub, bảng, cột có kiểu, dòng (tạo, sửa gộp theo ô, xoá mềm, batch, upsert), lọc, sắp xếp, tìm kiếm, phân trang keyset, view, chia sẻ, giới hạn, thùng rác, lịch sử dòng, view SQL xuất (`dh_views`) và index tự động. Chưa có giao diện (2C), import/export (2D).

**2B: công thức và cột tính toán.** Cột `formula`, `relation`, `lookup`, `rollup`. Engine công thức ở `packages/formula` (TypeScript thuần, chạy cả server lẫn trình duyệt): 106 hàm, tham chiếu `[Cột]`, `[Bảng].[Cột]`, `[Datahub].[Bảng].[Cột]`, lỗi kiểu Excel (`#DIV/0!`, `#N/A`, `#VALUE!`, `#REF!`, `#CYCLE!`, `#PERM!`). Công thức lưu theo mã cột, hiện theo tên hiện tại. Giá trị được tính sẵn và lưu trong database:

- Công thức chỉ đọc cột cùng dòng: API tính ngay trong giao dịch lưu dòng.
- Công thức đọc bảng khác, lookup, rollup: worker tính cả cột (có tiến độ, `calc.status` của cột là `pending` / `running` / `ready`). Tra cứu và tổng hợp có điều kiện bằng (`SUMIFS`, `COUNTIFS`, `XLOOKUP`...) được gom thành một câu SQL cho cả cột. Điều kiện khác (`>=`, ký tự đại diện...) duyệt từng dòng nên chỉ cho bảng nguồn tối đa 20.000 dòng.
- `TODAY()` tính lại 00:05 giờ Việt Nam, `NOW()` mỗi giờ (worker chạy bù khi khởi động lại).
- Tính lại không ghi lịch sử dòng, nhật ký, `version` hay "Ngày sửa".
- Công thức chỉ đọc datahub **cùng chủ**; bảng được người khác chia sẻ không dùng được.
- API: `GET /datahub/formula-functions` (danh mục hàm), `POST /tables/:id/formula/preview` (kiểm tra và xem trước 5 dòng).
- Worker (`apps/api/src/worker.ts`) chạy vòng tính lại; trong test dùng `drainOutbox` (`apps/api/test/dh-helpers.ts`).
- Golden test đọc thẳng `examples/Quản lý Deal SoE (Dương TVD).xlsx` (tự bỏ qua khi thiếu file, không commit dữ liệu từ file):

```bash
npx vitest run apps/api/test/formula-golden.test.ts --reporter=verbose
npx vitest run apps/api/test/datahub-formulas-perf.test.ts --reporter=verbose   # 100.000 x 100.000 dòng
```

- Code: `apps/api/src/modules/datahub/`, schema `packages/db/src/schema/datahub.ts`.
- API: các thao tác `datahub.*` có trong `docs/api/openapi.json` và `/api/docs`; request mẫu ở `docs/api/bruno/datahub/`.
- Quyết định khi code: `design/module2-quyet-dinh-khi-code.md`.
- Test tốc độ 100.000 dòng (nạp dữ liệu, đo trước và sau index tự động, in số `[perf]`):

```bash
npx vitest run apps/api/test/datahub-perf.test.ts --reporter=verbose
```

## Cấu trúc

```
apps/api        Fastify: registry, REST, OpenAPI, SSE, file; src/worker.ts là tiến trình worker
apps/web        React + Vite + TanStack Router/Query + Tailwind; e2e/ là test Playwright
packages/shared Mã lỗi, actor, cú pháp bộ lọc (Zod), dùng chung server và trình duyệt
packages/db     Schema Drizzle, migration, helper (audit, lịch sử dòng, outbox, khoá kỳ, lọc, keyset...)
packages/formula Engine công thức (parser, 106 hàm, điều kiện kiểu Excel); packages/metrics chỗ trống, làm ở Stage 3
docs/api/bruno  Bộ request Bruno (mở thư mục này bằng Bruno, chọn môi trường dev)
design/         Thiết kế từng module
```

Thêm một thao tác mới: khai báo bằng `defineCommand` / `defineQuery` (xem `apps/api/src/modules/system/`), thêm vào `apps/api/src/modules/index.ts`.
REST, OpenAPI và (sau này) MCP đều sinh từ registry. Nhớ thêm request vào `docs/api/bruno/` và chạy `pnpm docs:openapi`; test `openapi.test.ts` sẽ báo nếu thiếu.

## Production (một VPS)

```bash
cp .env.example .env     # điền SITE_ADDRESS, POSTGRES_PASSWORD, APP_DB_PASSWORD, AUTH_SECRET, STORAGE_DRIVER=s3 và S3_*
docker compose up -d --build
```

Compose chạy `postgres` (không mở ra ngoài), `migrate` (chạy một lần), `api`, `worker`, `caddy` (TLS tự động, cổng 80/443). Chi tiết hạ tầng: `design/ha-tang.md`.
Tệp `docker-compose.yml` chưa được chạy thử trên máy dev vì máy không có Docker; các bản build api/worker/migrate đã được chạy thử bằng `node dist/*.js`.

# Lỗi chưa rõ nguyên nhân

Tạo 28/11/2026 theo ý Dương. Ghi những lỗi đã thấy nhưng **chưa tái hiện được, chưa biết nguyên nhân**. Đã **gác lại**: không giao agent tìm tiếp, không chặn bước con hay stage (ngoại lệ của `design/kiem-thu.md` mục 3). Chỉ mở lại khi lỗi lặp lại thường xuyên hơn, có log mới chỉ ra nguyên nhân, hoặc Dương yêu cầu.

Mỗi mục ghi: tên test hoặc chỗ lỗi, lệnh, tần suất, đã thử gì, hướng nghi ngờ. Thấy lại thì thêm ngày và mã commit vào mục đó, không tạo mục mới.

## 1. `deal-defaults` hết giờ trong cả bộ vitest

- Test: `apps/api/test/deal-defaults.test.ts` "fills the months after the last one..."
- Lệnh: `DH_EQUIV_EDITS=2500 pnpm test` (cả bộ).
- Thấy: 28/11/2026 ở 12G-1, hết 20 s một lần (lượt cả bộ đầu; lượt sau pass). Tần suất khoảng 1/2 lượt cả bộ.
- Đã thử: chạy riêng 3 lần (1,3–1,5 s); chạy cùng 52 file đứng trước nó; 12G-2 chạy riêng 5 lần và cùng `apps/api/test/deal*` + `datahub-f*` 2 lần: đều pass.
- Nghi: `drainOutbox` / `addIndexMonths` phải chờ khi nhiều file cùng chạy và chung DB.

## 2. `stage1` "Leader đăng ký: mã hiện ở chuông" (e2e desktop)

- Lệnh: `pnpm test:e2e e2e/stage1.spec.ts --project=desktop` (lỗi lộ ra khi chạy cùng cụm `stage1*`).
- Thấy: 28/11/2026 ở 12G-2, 1 lần trong 4 lượt: `/notifications` trả 401 lúc đang ở `/dang-nhap`. Chạy lại cả file thì pass.
- Liên quan: lỗi cùng chỗ đăng ký/đăng xuất đã sửa một lần ở 12A-4 (401 khi đăng xuất, `module12-quyet-dinh-khi-code.md` mục 12A-4).
- Nghi: chuông còn một cuộc gọi đang bay lúc phiên hết.

## 3. `stage1` phone "cài đặt hệ thống"

- Lệnh: `pnpm test:e2e e2e/stage1.spec.ts --project=phone`.
- Thấy: hết giờ 1 lần. Lỗi chỉ ở điện thoại, không phải trang điền form nên ưu tiên thấp (`kiem-thu.md` mục 4).

## 4. `metrics-perf` chậm khi máy bận

- Test: join 100k dòng, từng chạy 1246 ms khi máy bận; chạy riêng thì pass.
- Nghi: máy bận làm chậm, không phải hồi quy engine. Chưa đo lại.

## 5. `stage2c1` test dán vùng Excel (e2e desktop)

- Lệnh: `pnpm test:e2e e2e/stage2c1.spec.ts --project=desktop`.
- Thấy: 28/11/2026 ở 12H-13 (mã 6d2438c), fail 1 lần; chạy lại 3 lần đều pass.
- Đã thử: chạy lại cả file 3 lần. Chưa tái hiện.
- Nghi: dán phụ thuộc clipboard/focus của canvas lúc lưới vừa đổi bề rộng cột số thứ tự (48 → 72px).

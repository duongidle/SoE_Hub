# Bản đồ code

Dương chốt 21/11/2026. File này giúp agent code module mới gọi đúng vào module cũ mà không phải dò lại code. Mỗi module có một mục.

## Quy định dùng

1. **Bản đồ là điểm bắt đầu, không phải danh sách đầy đủ.** Không thấy trong bản đồ thì grep đúng tên cần tìm, rồi mở đúng đoạn đó (`sed -n`). Không đọc lại cả module.
2. **Grep trước khi viết hàm dùng chung mới.** Lỗi hay gặp nhất là tưởng chưa có nên viết hàm mới, trùng hoặc lệch với hàm đã có.
3. **Bản đồ thiếu đâu thì vá đó.** Phải tự dò ra cái bản đồ không có thì ghi thêm vào mục của module đó, trong cùng commit với code.
4. **Bản đồ sửa cùng code.** Đổi chữ ký, hành vi, hoặc chỗ đặt của hàm, lệnh, sự kiện có trong bản đồ thì sửa bản đồ trong cùng commit.
5. **Bản đồ và code lệch nhau thì code đúng.** Bản đồ chủ yếu ghi "muốn làm X thì gọi `Y` ở file Z". Hành vi chi tiết thì đọc ở chính hàm và comment của nó.
6. **Chống loop.** Sửa 2 vòng chưa qua mà lỗi dính tới module cũ thì bước tiếp theo bắt buộc là mở code thật để kiểm giả định lấy từ bản đồ. Không sửa tiếp theo bản đồ. Bản đồ sai thì vá theo quy định 3.
7. **Test kiểm bản đồ** (`apps/api/test/ban-do-code.test.ts`) nằm trong bộ vitest.
   - Mọi cặp `` `đường/dẫn.ts` `tênHàm` `` trong file này phải có thật: file tồn tại và chứa tên đó.
   - Đường dẫn đứng một mình cũng phải tồn tại.
   - Bản đồ lệch với code thì test đỏ ở lần chạy cả bộ của bước con.
8. **Lưới an toàn không dựa vào bản đồ:**
   - Luật quan trọng nhất nằm trong code, không chỉ ở đây. Ví dụ truy vấn `dh_rows` thiếu dấu phạm vi thì chốt chặn `auth/query-guard.ts` báo lỗi ngay.
   - Typecheck, test phân quyền, cả bộ test cuối mỗi bước con.
   - Opus rà diff phần dùng chung và grep nơi gọi.

## Cách viết một mục

- Mỗi mục khoảng 30–60 dòng.
- Agent cuối của stage viết mục cho module đó, lúc code còn trong ngữ cảnh.
- Ghi đường dẫn file kèm tên hàm, đúng dạng `` `apps/api/src/.../file.ts` `tenHam` `` (đường dẫn từ gốc repo, một dấu cách, rồi tên) để test kiểm được. Không ghi số dòng, vì số dòng cũ đi nhanh.
- Mỗi mục gồm:
  - **Chỗ gọi vào:** hàm, lệnh registry, sự kiện outbox mà module khác dùng, kèm một dòng nói làm gì.
  - **Mẫu làm theo:** việc hay làm (thêm lệnh, thêm kiểu cột, thêm job…), kèm file và hàm mẫu.
  - **Bảng chính:** tên bảng và vai trò.
  - **Luật cấm:** điều không được làm, và chỗ trong code chặn nó (nếu có).

## Module 0: Nền tảng

_Chưa viết._

## Module 1: Tài khoản, phân quyền

_Chưa viết._

## Module 2: Datahub

_Chưa viết._

## Module 3: Chỉ số, dashboard

_Chưa viết._

## Module 4: Quản lý Deal

_Chưa viết (viết ở bước kiểm thử cuối Stage 4)._

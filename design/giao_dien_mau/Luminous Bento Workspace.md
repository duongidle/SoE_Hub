# Hệ thống Thiết kế Giao diện: **Luminous Bento Workspace**

> **Tên phong cách:** **Luminous Bento Workspace** _(Không gian làm việc Bento Sáng & Đa tầng)_
> **Ứng dụng tham chiếu:** **SoE Hub** — Hệ thống điều hành & quản trị tri thức nội bộ (~20–50 nhân sự)
> **Cảm hứng cốt lõi:** Sự kỷ luật, đa tầng của **Linear** + Tính trực quan dữ liệu của **Lark Base** + Nhịp màu phân loại của **monday.com**

---

## 1. Tinh thần & Triết lý Thiết kế (Design Philosophy)

**Luminous Bento Workspace** được tạo ra để giải quyết bài toán cốt lõi của phần mềm nội bộ hiện đại: _làm việc với lượng dữ liệu lớn 6–8 tiếng mỗi ngày mà không mỏi mắt, nhưng vẫn phải "nịnh mắt", có chiều sâu không gian và mang lại cảm giác tương tác cao cấp ngay từ cái nhìn đầu tiên._

Phong cách này đứng trên **3 trụ cột**:

1. **Không gian có chiều sâu vật lý (Layered Depth):** Thay vì trải mọi thứ lên một mặt phẳng trắng xóa gây nhàm chán, giao diện chia thành 3 lớp độ cao rõ ràng: _Nền không gian ánh sáng dịu (Canvas)_ → _Khung ứng dụng nổi (App Shell)_ → _Các thẻ dữ liệu sắc nét (Bento Cards & Silk Tables)_.
2. **Màu sắc có mục đích (Semantic Rhythm):** Màu sắc không dùng để trang trí ngẫu nhiên. Nền và khung giữ sắc trung tính lạnh; màu rực rỡ chỉ xuất hiện ở **trạng thái nghiệp vụ, nhóm dữ liệu, biểu đồ và hành động chính** để mắt người dùng quét thông tin trong tích tắc.
3. **Công thái học & Tối ưu diện tích (Data-First Ergonomics):** Hợp nhất các thanh điều hướng và thanh công cụ thành các dải 1 dòng (`44px–48px`), ghim cố định các điểm neo quan trọng (Dashboard, nút Tạo mới) và nhường trên **85% diện tích màn hình** cho dữ liệu thực tế.

---

## 2. Cấu tạo Chi tiết của Phong cách (Anatomy)

### 2.1. Hệ thống Bề mặt & Phân tầng Không gian (Elevation & Surfaces)

| Tầng không gian                                     | Vai trò                                                        | Mã màu / Hiệu ứng chuẩn                                                                     | Bo góc & Viền                                                                                         |
| :-------------------------------------------------- | :------------------------------------------------------------- | :------------------------------------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------- |
| **Tầng 0: Nền không gian (Mesh Canvas)**            | Làm bệ phóng tạo cảm giác thoáng đãng, không đục xám           | `#F4F5FA` kết hợp các quầng sáng pastel cực nhẹ (`#A5B4FC` 25%, `#A7F3D0` 20%)              | Không viền                                                                                            |
| **Tầng 1: Khung ứng dụng nổi (Floating App Shell)** | Bao bọc toàn bộ workspace, tách biệt ứng dụng khỏi trình duyệt | `#FFFFFF` (hoặc `#FAF9FE` cho Sidebar)                                                      | Bo góc `20px`, viền ánh sáng `1px solid rgba(226, 232, 240, 0.9)`, bóng đổ đa tầng mềm                |
| **Tầng 2: Thanh điều hướng (Sidebar & Top Bar)**    | Định hướng phân hệ và ngữ cảnh hiện tại                        | Sidebar `#FAF9FE`; Top Bar kính mờ `rgba(255,255,255,0.85)` + `backdrop-filter: blur(12px)` | Đường phân cách mảnh `1px solid #ECEEF5`                                                              |
| **Tầng 3: Thẻ dữ liệu & Bảng (Cards & Tables)**     | Nơi hiển thị KPI, biểu đồ, bảng dữ liệu và thẻ câu hỏi         | `#FFFFFF` nổi trên nền vùng làm việc `#F8F9FC`                                              | Bo góc `14px–16px`, viền `1px solid #E2E8F0`, đổ bóng siêu mảnh `0 4px 20px -4px rgba(30,27,58,0.05)` |

### 2.2. Bảng màu Chuẩn (Color Tokens)

- **Màu chữ (Typography Colors):**
  - **Chữ chính (Primary Ink):** `#1E1B3A` _(Xanh than pha tím sâu — đủ đậm để đọc rõ nhưng mềm mại và sang hơn đen thuần `#000000`)_.
  - **Chữ phụ (Secondary / Muted Ink):** `#646A82` _(Xám xanh trung tính — dùng cho nhãn cột, mô tả ngắn, breadcrumb, metadata)_.
  - **Chữ mờ (Placeholder / Disabled):** `#94A3B8`.
- **Màu nhận diện thương hiệu (Brand Accent):**
  - **Indigo Chính (Primary Action & Active State):** `#4F46E5` (Hover: `#4338CA`).
  - **Indigo Nhạt (Active Pill / Hover Tint):** `#EEF0FF` (Viền nhấn: `#C7D2FE`).
- **Màu Ngữ nghĩa & Trạng thái (Semantic Status Palette — Chuẩn tương phản WCAG AA):**
  - **Hoàn thành / Đang nhận / Đã ký:** Nền `#ECFDF5`, Chữ `#047857`, Viền `#A7F3D0`, Chấm trạng thái `#10B981`.
  - **Đang xử lý / Tạm tính / Request:** Nền `#EFF6FF`, Chữ `#1D4ED8`, Viền `#BFDBFE`, Chấm trạng thái `#3B82F6`.
  - **Chờ duyệt / Sắp hạn / Service:** Nền `#FFFBEB`, Chữ `#B45309`, Viền `#FDE68A`, Chấm trạng thái `#F59E0B`.
  - **Quá hạn / Lỗi / Bắt buộc:** Nền `#FFF1F2`, Chữ `#BE123C`, Viền `#FECDD3`, Chấm trạng thái `#F43F5E`.
  - **Nhóm đặc thù / AI / Wework:** Nền `#F5F3FF`, Chữ `#6D28D9`, Viền `#DDD6FE`, Chấm trạng thái `#8B5CF6`.

### 2.3. Hệ thống Chữ & Số liệu (Typography & Hierarchy)

- **Phông chữ cho văn bản (Text & UI):** `Be Vietnam Pro` — tối ưu hiển thị dấu tiếng Việt cho tiêu đề, điều hướng, mô tả và nội dung bảng.
- **Phông chữ cho số liệu (Numbers & Data):** `Inter` — dùng cho toàn bộ con số, tiền tệ, phần trăm, chỉ số KPI và bộ đếm theo quy chuẩn typography có sẵn của hệ thống.

### 2.4. Cấu trúc Bố cục Từng Phân hệ (Component Patterns)

1. **Left Sidebar Phẳng & Thu gọn (`220px` ↔ `64px`):**
   - Toàn bộ các phân hệ (_Tổng quan, Datahub, Quản lý Deal, Form, Onboarding, Knowledge, AI Hub..._) nằm trên **một danh sách phẳng đồng cấp**, không chia nhóm accordion lồng nhau gây rối.
   - Mục đang mở có nền `#EEF0FF`, chữ `#4F46E5` đậm và **vạch nhấn dọc `3px` bo tròn ở cạnh trái**.
   - Đáy sidebar chỉ giữ tối đa **Cài đặt** và **Đăng xuất** dưới một đường kẻ mảnh.
2. **Top Navigator Bar Đơn tuyến (`48px`):**
   - Hợp nhất **Breadcrumb cỡ chữ đồng đều (`14px`)** ở bên trái với **Nút hành động chính**, **Chuông thông báo (kèm badge số)** và **Hồ sơ tài khoản** ở bên phải. Tuyệt đối không tách thành 2–3 tầng header chồng lên nhau.
3. **Dải Tab & Thanh Công Cụ 1 Dòng (Lark-style Single-Line Toolbar):**
   - **Ghim cố định bên trái:** Các tab quan trọng nhất như **Dashboard** và nút **`+` (Tạo mới)** luôn được ghim cứng ở đầu dải tab bên trái, tách biệt bằng đường kẻ dọc mảnh trước khi tới danh sách bảng có thể cuộn ngang.
   - **Thanh công cụ dữ liệu 1 hàng:** Gom _Chế độ xem_, _Nút thêm dòng_, _Thời gian_, _Lọc_, _Sắp xếp_, _Nhóm_, _Ẩn/Hiện cột_ ở bên trái; _1 ô tìm kiếm duy nhất_, _Độ cao dòng_ và menu _`•••` (chứa các tác vụ ít dùng như Xuất, Nhập, Tìm trùng, Thùng rác)_ ở bên phải.
4. **Tìm kiếm & Bộ lọc Thống nhất (Unified Search & 1-Tap Filter):**
   - Chỉ sử dụng **1 ô tìm kiếm thông minh duy nhất** hỗ trợ tìm đồng thời tiêu đề, nội dung tiếng Việt có dấu/không dấu và `#thẻ`.
   - Thay thế các ô nhập thẻ/dropdown dài bằng **Tab phân loại bấm 1 chạm** kết hợp dải **Pill thẻ phổ biến**.
5. **Biểu mẫu & Trình thiết kế WYSIWYG (Ergonomic Form):**
   - **Trang thiết kế:** Dùng 1 thanh điều hướng 4 bước (_Thiết kế · Thiết lập · Chia sẻ · Phản hồi_), vùng giữa mô phỏng tờ biểu mẫu thật (WYSIWYG), chèn câu hỏi bằng lưới 2 cột phân màu ngay tại chỗ, và cột phải dùng **Toggle Switch** hiện đại.
   - **Trang người dùng điền (Public Form):** Có thanh tiến độ kính mờ ghim trên đỉnh, thẻ bìa gradient nhẹ, bản đồ số câu hỏi nhảy nhanh bên phải và phím tắt bàn phím (`A`–`D`).

---

## 3. Điều gì làm nên "Cái Hồn" của Phong cách này? (Signature DNA)

Nếu tóm gọn trong 5 yếu tố tạo nên sự khác biệt khiến giao diện vừa **chuyên nghiệp** vừa **wow**:

1. **Sự tương phản giữa Khung tĩnh và Dữ liệu động:** Khung ngoài nhẹ nhàng, trắng sáng và kỷ luật; nhưng bên trong lại bừng sáng nhờ các thẻ KPI có biểu đồ mini (Sparkline, Donut ring), chấm trạng thái phát sáng nhẹ (_Pulse dot_) và dải bìa gradient tiết chế.
2. **Vi chi tiết ánh sáng (Micro-lighting):** Viền thẻ `1px` sắc nét kết hợp nền kính mờ (`backdrop-blur`) ở thanh điều hướng trên và thanh dẫn sáng dọc `3px` khi di chuột qua từng dòng dữ liệu.
3. **Tính công thái học cao (Zero-Clutter):** Giấu các chức năng phụ ít dùng vào menu `•••` hoặc ngăn kéo trượt bên phải (_Slide-over Drawer_), giữ cho bề mặt chính luôn thoáng đãng.
4. **Tương tác trực tiếp tại chỗ (Direct Manipulation):** Bấm đổi trạng thái ngay trên bảng, kéo thả sắp xếp thứ tự ưu tiên Dashboard trên trang Tổng quan, nhấp vào cột biểu đồ để lọc chéo số liệu, hoặc bấm `A/B/C/D` để chọn đáp án.
5. **Nhịp màu nhất quán xuyên suốt:** Một nhóm dữ liệu (ví dụ: _Wework_ màu tím, _Request_ màu xanh dương, _Service_ màu hổ phách) giữ nguyên mã màu đó từ bảng Datahub, sang biểu đồ Dashboard cho đến thẻ bài viết Knowledge.

---

## 4. Quy định Bắt buộc & Điều Cấm Kỵ (Strict Rules)

### Những điều BẮT BUỘC (Must-Haves)

- [x] **Tỷ lệ diện tích dữ liệu $\ge 85\%$:** Chiều cao Top Bar tối đa `48px–54px`; chiều rộng Sidebar mở `220px`, thu gọn `64px`.
- [x] **Mỗi màn hình chỉ có tối đa 1 nút Primary đặc màu `#4F46E5`:** Các hành động phụ dùng nền trắng `#FFFFFF` + viền `#E2E8F0`.
- [x] **Chỉ 1 ô Search chính trên mỗi vùng làm việc:** Không lặp lại ô tìm kiếm ở cả header lẫn thanh lọc.
- [x] **Ghim cố định điểm neo điều hướng:** Nút _Dashboard_ và _Tạo mới_ luôn nằm bên trái danh sách tab, không bao giờ bị trôi khi cuộn ngang.
- [x] **Dùng `tabular-nums` cho mọi cột số, tiền tệ và bộ đếm.**
- [x] **Ngăn kéo chi tiết (Slide-over Drawer) thay cho Popup chật chội:** Khi xem chi tiết một dòng dữ liệu, đọc bài viết Knowledge hay chỉnh thuộc tính câu hỏi, mở panel trượt từ cạnh phải (`420px–560px`) để người dùng không mất ngữ cảnh bảng phía sau.

### Những điều CẤM KỴ (Anti-Patterns)

- **KHÔNG** dùng nền xám đục tối phủ toàn bộ vùng làm việc hoặc Sidebar màu đen/xanh đậm nặng nề.
- **KHÔNG** dùng bóng đổ đen đậm (`box-shadow` với độ mờ lớn và alpha $> 0.15$). Bóng đổ phải có ánh tím than nhẹ (`rgba(30, 27, 58, 0.06)`).
- **KHÔNG** dùng gradient rải tràn lan lên nút bấm, thẻ KPI hay nền bảng. Gradient chỉ được phép dùng ở **quầng sáng nền ngoài (Mesh Canvas)**, **thanh tiến độ mảnh `3px`** hoặc **dải bìa đầu Form (`72px`)**.
- **KHÔNG** xếp 2–3 hàng nút công cụ hoặc nhiều ô dropdown tìm kiếm chồng lên nhau.
- **KHÔNG** dùng chữ đen thuần `#000000` (luôn dùng `#1E1B3A`).

---

## 5. Hướng dẫn Kỹ thuật để Dựng Phong cách này (Implementation Blueprint)

### Bước 1: Thiết lập CSS Variables & Font chuẩn

Nhúng bộ font (`Be Vietnam Pro`, `Inter`) và khai báo bộ biến gốc trong file CSS chính của dự án:

```css
:root {
  /* Surfaces */
  --bg-canvas: #f4f5fa;
  --bg-workspace: #f8f9fc;
  --bg-sidebar: #faf9fe;
  --bg-surface: #ffffff;

  /* Borders & Dividers */
  --border-subtle: #eceef5;
  --border-card: #e2e8f0;
  --border-focus: #4f46e5;

  /* Typography */
  --text-primary: #1e1b3a;
  --text-secondary: #646a82;
  --text-muted: #94a3b8;

  /* Brand Accent */
  --accent-primary: #4f46e5;
  --accent-hover: #4338ca;
  --accent-soft: #eef0ff;

  /* Radii & Elevation */
  --radius-shell: 20px;
  --radius-card: 16px;
  --radius-control: 10px;
  --shadow-shell:
    0 20px 50px -12px rgba(30, 27, 58, 0.08), 0 0 0 1px rgba(226, 232, 240, 0.9);
  --shadow-card:
    0 4px 20px -4px rgba(30, 27, 58, 0.05), 0 1px 3px rgba(30, 27, 58, 0.03);
}

body {
  font-family:
    "Inter",
    -apple-system,
    BlinkMacSystemFont,
    sans-serif;
  color: var(--text-primary);
  background:
    radial-gradient(
      circle at 12% 8%,
      rgba(165, 180, 252, 0.3),
      transparent 36%
    ),
    radial-gradient(
      circle at 88% 12%,
      rgba(167, 243, 208, 0.24),
      transparent 38%
    ),
    var(--bg-canvas);
}

.font-display {
  font-family: "Be Vietnam Pro";
}
.tabular {
  font-variant-numeric: tabular-nums;
}
```

### Bước 2: Khung Bố cục Gốc (App Shell Skeleton)

Áp dụng cấu trúc khung 3 phần cố định cho mọi trang trong ứng dụng nội bộ:

```html
<div class="h-screen p-2.5 sm:p-3.5 flex">
  <!-- Khung ứng dụng nổi (Floating App Shell) -->
  <div
    class="flex-1 bg-white rounded-[20px] shadow-(--shadow-shell) flex overflow-hidden"
  >
    <!-- 1. Left Sidebar Phẳng (220px) -->
    <aside
      class="w-[220px] bg-[#FAF9FE] border-r border-[#ECEEF5] flex flex-col justify-between shrink-0"
    >
      <!-- Logo + Danh sách phân hệ đồng cấp -->
      <!-- Mục active: bg-[#EEF0FF] text-[#4F46E5] font-semibold + vạch trái 3px -->
    </aside>

    <!-- 2. Cột Nội dung Chính -->
    <div class="flex-1 flex flex-col min-w-0 bg-[#F8F9FC]">
      <!-- Top Navigator Bar (48px) -->
      <header
        class="h-[48px] bg-white/85 backdrop-blur-md border-b border-[#ECEEF5] px-5 flex items-center justify-between shrink-0"
      >
        <!-- Trái: Breadcrumb đồng đều 14px -->
        <!-- Phải: Nút Primary (#4F46E5) + Thông báo + Avatar User -->
      </header>

      <!-- Vùng làm việc chính (Cuộn độc lập) -->
      <main class="flex-1 overflow-y-auto p-5 space-y-5">
        <!-- Dải Tab ghim trái + Thanh công cụ 1 dòng + Bento Cards / Bảng dữ liệu -->
      </main>
    </div>
  </div>
</div>
```

### Bước 3: Quy tắc Mở rộng cho Các Trang Mới

Khi đội ngũ phát triển thêm bất kỳ màn hình mới nào cho **SoE Hub**, chỉ cần lắp ghép theo công thức:

1. **Trang danh sách / dữ liệu lớn:** Dùng _Dải Tab ghim trái_ + _Thanh công cụ 1 dòng_ + _Bảng dữ liệu dòng cao `44px`–`48px`_ + _Ngăn kéo chi tiết trượt phải_.
2. **Trang báo cáo / phân tích:** Dùng _Thanh chọn kỳ 1 hàng_ + _Hàng thẻ KPI có biểu đồ mini (4 cột)_ + _Lưới biểu đồ tương tác lọc chéo (2 cột)_.
3. **Trang khám phá / thư viện:** Dùng _1 ô Search thông minh duy nhất_ + _Dải Tab phân loại 1 chạm_ + _Lưới thẻ 2–3 cột có dải màu phân nhóm_.

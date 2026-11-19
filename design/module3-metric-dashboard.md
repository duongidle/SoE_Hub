# Module 3 — Metric & Dashboard

> Trạng thái: **Đã chốt** · 18/11/2026
> Phụ thuộc: [Module 0](module0-nen-tang.md) (registry, cú pháp lọc, outbox, SSE), [Module 1](module1-tai-khoan-phan-quyen.md) (phạm vi dữ liệu, cấp dữ liệu Guest), [Module 2](module2-datahub.md) (bảng, cột, công thức, chia sẻ).
> **Sửa 19/11/2026** (theo khoá phân chia của Module 2 mục 10): bảng gộp (mục 4.1), cache và "xem các dòng" (mục 6, 9). Phần đã code ở 3A-1 xử lý ở bước con 4.1 (Module 4 mục 19a).
> Để module sau: các chỉ số và dashboard mặc định của Deals, công thức winrate theo cycle, forecast (Module 4); tool MCP (Module 5).

## 1. Các lớp

```
Bảng (Datahub / Deals / Bảng gộp) ──► Nguồn dữ liệu ──► Chỉ số ──► Biểu đồ ──► Dashboard
                                      (ghép bảng)       (cách tính)  (cách vẽ)   (bố cục + bộ lọc chung)
```

- Định nghĩa một chỉ số **một lần**, dùng ở nhiều nơi (dashboard, MCP, Module 4). Mọi nơi ra cùng một con số.
- Người dùng **không phải tạo nguồn dữ liệu hay chỉ số trước**. Họ chỉ thấy: Dashboard → Thêm biểu đồ → chọn bảng, cột, cách tính. Nguồn và chỉ số được tạo ngầm cho từng biểu đồ; người dùng bấm "Lưu thành nguồn dữ liệu" / "Lưu thành chỉ số" khi muốn dùng lại.

## 2. Luồng người dùng

1. Vào datahub → tab **Dashboard**. Lần đầu có sẵn một dashboard trống.
2. **+ Thêm biểu đồ** → chọn loại.
3. Khung cấu hình bên phải:
   - **Nguồn dữ liệu:** chọn bảng; **+ Ghép bảng** nếu cần (mục 3).
   - **Trục / chiều:** chọn cột, cách nhóm thời gian.
   - **Giá trị:** chọn cột và cách tính, hoặc chọn một chỉ số đã lưu.
   - **Lọc** riêng cho biểu đồ (không bắt buộc).
   - **Hiển thị:** nhãn số, tag, đường mục tiêu, màu, định dạng.
4. Biểu đồ hiện ngay khi đang chọn. Kéo thả để sắp chỗ, kéo góc để đổi kích thước.
5. Mọi thay đổi **tự lưu**, không có nút "Lưu".

**Nhiều dashboard:**

- Một datahub có nhiều dashboard, hiện thành danh sách (cột trái hoặc tab trên).
- **+ Dashboard mới**, đổi tên, **nhân bản**, kéo đổi thứ tự, xoá (thùng rác 7 ngày), chia sẻ.
- Chỉ số và nguồn dữ liệu đã lưu dùng chung cho mọi dashboard trong datahub.
- Dashboard chỉ dùng dữ liệu trong cùng datahub. Muốn tổng hợp từ nhiều datahub thì dùng **công thức xuyên datahub** (Module 2) hoặc **Bảng gộp** (mục 4) trong một datahub tổng hợp.

## 3. Nguồn dữ liệu và ghép bảng

- Mặc định là một bảng.
- Ghép nhiều bảng trong cùng datahub theo **cột liên kết** (ưu tiên) hoặc **cột khoá** (chọn cột ở hai bảng).
- **Chẩn đoán luôn hiện**, không bao giờ vẽ biểu đồ rỗng mà không nói gì:
  - "Ghép được 87/120 dòng. 33 dòng không có khoá khớp." + nút xem 33 dòng đó.
  - "0/120 dòng ghép được." → biểu đồ hiện lỗi kèm cách sửa.
  - "Khoá `Mã deal` ở bảng Thanh toán bị trùng 14 giá trị. Ghép thẳng sẽ nhân đôi số liệu." → hệ thống **gom bảng nhiều dòng trước** (ví dụ tổng tiền thanh toán theo từng deal), rồi mới ghép.

## 4. Bảng gộp

Một loại bảng mới, **chỉ đọc**, dòng được hệ thống tự đồng bộ từ nhiều bảng nguồn. Dùng khi cần xếp chồng dòng của nhiều bảng (kể cả ở nhiều datahub) thành một bảng chung, có chống trùng.

### 4.1 Cấu hình

- **Nguồn:** tối đa 10 bảng, thuộc các datahub **cùng chủ** với bảng gộp (cùng luật với công thức). Bảng được người khác chia sẻ không làm nguồn được.
- Bảng template nằm trong datahub "Quản lý Deal" của chủ (Deals, Probation KPI…) làm nguồn được như bảng của chủ (Module 4 mục 19.9). Nếu bảng đó bật khoá phân chia, bảng gộp chỉ đồng bộ các dòng chủ bảng gộp thấy. Dòng vào hoặc ra khỏi phạm vi (do sửa cột khoá, đổi cây tổ chức) thì đồng bộ lại.
- **Ghép cột:** cột cùng tên tự khớp; cột khác tên ghép tay; kiểu phải tương thích. Cột nguồn không ghép thì bỏ qua.
- Có sẵn cột **Nguồn** (dòng đến từ bảng nào) và cột **Mã dòng gốc**.
- Đếm vào giới hạn số bảng của datahub (Module 2 mục 11).

### 4.2 Chống trùng

- Chọn **cột khoá** (một hoặc nhiều cột). So khớp có chuẩn hoá: bỏ dấu, không phân biệt hoa thường, bỏ khoảng trắng thừa.
- Khi một khoá có ở nhiều dòng, chọn một trong ba cách:
  - Giữ dòng của **nguồn ưu tiên cao hơn** (người dùng xếp thứ tự nguồn).
  - Giữ dòng **sửa gần nhất**.
  - **Gộp từng ô:** mỗi cột lấy giá trị không rỗng đầu tiên theo thứ tự ưu tiên.
- **Chẩn đoán luôn hiện**, ví dụ "Gộp 3 bảng: 1.240 dòng, loại 87 dòng trùng khoá", kèm nút xem các nhóm trùng.
- Không chọn khoá thì cảnh báo: "Chưa có khoá chống trùng, số liệu có thể bị đếm hai lần."

### 4.3 Hoạt động

- Dùng như bảng thường: view, lọc, sắp xếp, công thức ở bảng khác đọc từ nó, dashboard, export, API đọc.
- **Không sửa trực tiếp**. Muốn sửa thì sửa ở bảng nguồn; mở một dòng có liên kết về dòng gốc.
- Nguồn thay đổi thì worker cập nhật bảng gộp trong vài giây (theo sự kiện outbox).
- Đây là dữ liệu do hệ thống tạo: **không sinh lịch sử dòng, không ghi nhật ký** (cùng luật với công thức).
- Nguồn bị xoá hoặc mất quyền thì bảng gộp báo lỗi rõ, giữ dữ liệu lần đồng bộ cuối.

## 5. Chỉ số (Metric)

Khai báo bằng JSON. Người dùng tạo qua giao diện; AI và API tạo bằng JSON.

```json
{
  "name": "POD Won",
  "source": "deals",
  "measure": { "agg": "count" },
  "filter": { "and": [
    { "field": "deal_type", "op": "starts_with", "value": "POD" },
    { "field": "status", "op": "eq", "value": "Won" }
  ]},
  "time": { "field": "closing_date" }
}
```

```json
{ "name": "Winrate POD", "formula": "=[POD Won] / [POD Qualified]", "format": "percent" }
```

### 5.1 Phép tổng hợp

Đếm, **đếm không trùng**, tổng, trung bình, nhỏ nhất, lớn nhất, **trung vị**, **phân vị** (P25/P75/P90…), **trung bình cắt đuôi**, độ lệch chuẩn.

- Đếm không trùng là lưới an toàn cho bảng chưa sạch: "Số khách = đếm không trùng MST" thay cho "đếm số dòng".
- Trung vị, phân vị, cắt đuôi dùng cho dữ liệu chênh lệch lớn (deal vài chục triệu đến vài tỷ).

### 5.2 Chỉ số phái sinh

Viết bằng engine công thức của Module 2, tham chiếu chỉ số khác bằng `[Tên chỉ số]`. Ví dụ winrate, tỉ lệ pass qualify, % KPI.

### 5.3 Thời gian

- Nhóm theo ngày / tuần (bắt đầu thứ Hai) / tháng / quý / năm, theo giờ Việt Nam; quý theo cài đặt năm tài chính.
- Khoảng tương đối: tháng này, quý trước, 12 tháng gần nhất…
- **So sánh:** với kỳ trước, với cùng kỳ năm trước.
- **Luỹ kế:** cộng dồn theo thời gian.
- **Cohort:** nhóm theo kỳ bắt đầu (ví dụ tháng nhận deal), kèm điều kiện "chỉ tính cohort đủ trưởng thành". Công thức winrate theo cycle cụ thể chốt ở Module 4.

### 5.4 Phân nhóm, mục tiêu, snapshot, outlier

- **Phân nhóm** theo bất kỳ cột nào. Với Deals, "team" tính theo cây **tại thời điểm** của deal (Module 1 mục 2.3).
- **Mục tiêu:** gắn đường mục tiêu là hằng số hoặc lấy từ bảng mục tiêu (ví dụ KPI theo quý của từng người); tính % đạt và phần còn thiếu.
- **Snapshot:** chỉ số chạy được trên dữ liệu của một snapshot thay vì dữ liệu hiện tại (nền cho so forecast đầu quý với kết quả cuối quý).
- **Outlier:** tự đánh dấu dòng nằm ngoài khoảng IQR (Q1 − 1,5·IQR; Q3 + 1,5·IQR). Người dùng chọn: tính cả, loại ra, hoặc tính riêng.

## 6. Tính toán và tốc độ

- Mỗi chỉ số được dịch thành **một câu SQL gom nhóm** chạy trên Postgres, áp sẵn phạm vi dữ liệu. Không kéo dòng thô về trình duyệt.
- Kết quả cache theo (chỉ số, tham số, phạm vi dữ liệu). **Phạm vi dữ liệu lấy từ một hàm duy nhất của `access.ts`** (khoá phạm vi của người đọc), không tự dựng trong metrics; khi bảng nguồn bật khoá phân chia (Module 2 mục 10), khoá phạm vi khác nhau theo người. Cache cũng phải xoá khi đổi cài đặt chia sẻ hoặc khoá phân chia của bảng nguồn, và khi cây tổ chức đổi. Bảng nguồn thay đổi → sự kiện outbox xoá cache → dashboard đang mở tự cập nhật qua SSE.
- Mục tiêu: một biểu đồ trên 100.000 dòng dưới 1 giây. Các biểu đồ tải song song, có khung chờ; một biểu đồ chậm không làm treo biểu đồ khác.

### 6.1 Chịu tải

Câu SQL của chỉ số chạy trong tiến trình `api` (không qua worker). Các lớp bảo vệ:

1. **Cache:** cùng chỉ số + tham số + phạm vi dữ liệu thì dùng lại kết quả cho đến khi dữ liệu nguồn đổi. Ví dụ 10 người cùng team mở dashboard Deals: Leader và mỗi User có phạm vi khác nhau nên tính riêng, nhưng mỗi người mở lại hay chuyển tab thì lấy từ cache.
2. **Gộp yêu cầu trùng:** nhiều người cùng lúc hỏi đúng một câu (cùng khoá cache) thì chỉ chạy SQL một lần, các yêu cầu còn lại chờ kết quả đó.
3. **Giới hạn đồng thời:** mỗi người tối đa 6 câu chỉ số chạy cùng lúc (phần còn lại xếp hàng); toàn hệ thống dùng một pool kết nối có giới hạn, nên lúc đông chỉ chậm đi chứ không sập.
4. **Giới hạn thời gian:** mỗi câu chỉ số tối đa 10 giây (`statement_timeout`); quá thì biểu đồ báo "Truy vấn quá nặng" kèm gợi ý thu hẹp khoảng thời gian hoặc bộ lọc.
5. **Bảng tổng hợp làm sẵn:** nếu load test cho thấy chỉ số nào của Deals chậm, chuyển chỉ số đó sang đọc từ bảng tổng hợp theo tháng, cập nhật theo sự kiện.

**Load test bắt buộc trước khi phát hành Stage 3:** 100.000 dòng, 20 người mở cùng lúc một dashboard 30 biểu đồ, không có cache sẵn. Đạt khi mọi biểu đồ hiện xong trong 3 giây và không có lỗi.

## 7. Loại biểu đồ

| Nhóm | Loại | Ví dụ |
|---|---|---|
| Số | **Thẻ KPI**: số lớn + so kỳ trước + sparkline + thanh % mục tiêu | Doanh thu quý, winrate, số deal đang mở |
| So sánh | Cột / thanh: nhóm, chồng, chồng 100% | Doanh thu theo loại deal theo tháng |
| Xu hướng | Đường, vùng | Winrate 12 tháng |
| Kết hợp | Cột + đường, hai trục | Doanh thu (cột) và winrate (đường) |
| Mục tiêu | **Bullet** (thực tế trên nền KPI / Goal / Out performance), đồng hồ % | % KPI quý so với các mốc com |
| Phễu | Phễu chuyển đổi | Lead → Qualified → Won (CR1→CR4) |
| Phân bố | Box plot, histogram | Deal size có outlier, deal cycle |
| Tương quan | Scatter | Deal size và cycle, tô màu theo trạng thái |
| Ma trận | Ma trận 2×2 / ma trận ưu tiên, heatmap | Ma trận BANT; người × tháng |
| Dòng chảy | Waterfall | Pipeline đầu quý + mới vào − thua − thắng = cuối quý |
| Xếp hạng | Bảng xếp hạng | Top deal theo doanh thu |
| Bảng | Bảng, bảng pivot (tô màu, tổng dòng/cột) | Thay sheet Index |
| Cohort | Bảng tam giác cohort | Winrate theo tháng nhận deal |
| Tỉ trọng | Tròn / donut (tối đa 8 phần, phần còn lại gộp "Khác") | Cơ cấu doanh thu |
| Khác | Ô ghi chú | Chú thích, hướng dẫn đọc |

**Tuỳ chọn hiển thị chung:**

- Bật/tắt **nhãn số** trên biểu đồ.
- **Tag:** hiện tag của dòng (ví dụ tag deal) trên điểm/cột; lọc theo tag.
- Chú thích, đường mục tiêu, trục log cho dữ liệu chênh lệch lớn.
- Tiền gọn kiểu "1,2 tỷ", "350 tr"; phần trăm; ngày `dd/mm/yyyy`.
- Bảng màu thống nhất, đọc được ở chế độ sáng và tối.

## 8. Dashboard

- Lưới kéo thả, đổi kích thước; tự lưu.
- **Bộ lọc chung** áp cho mọi biểu đồ: khoảng thời gian, người/team, loại, tag… Người xem chỉnh bộ lọc thì lưu thành bản riêng của họ, có nút "Về mặc định". Từng biểu đồ có thể bỏ qua bộ lọc chung.
- **Lọc chéo (làm ngay bản đầu):** bấm một cột/điểm/phần của biểu đồ → các biểu đồ khác trong dashboard lọc theo giá trị đó. Thanh trên cùng hiện các lọc chéo đang áp, bấm × để bỏ. Biểu đồ được chọn "không nhận lọc chéo" thì đứng yên.
- **Xem các dòng:** bấm vào một con số để xem các dòng tạo nên nó (theo quyền, mục 9).
- **Dashboard hệ thống** (dashboard mặc định của Deals): khoá, không xoá, không sửa, luôn đầu danh sách; người dùng **nhân bản** để tuỳ chỉnh. Nội dung chốt ở Module 4.
- Xuất từng biểu đồ ra CSV hoặc PNG. PDF cả dashboard để sau.
- Cấu hình dashboard xuất/nhập bằng JSON (AI dựng dashboard qua MCP).
- Giới hạn: 30 biểu đồ mỗi dashboard, 20 dashboard mỗi datahub; Admin chỉnh được.

## 9. Phân quyền

- Dashboard, chỉ số, nguồn dữ liệu, bảng gộp thuộc chủ datahub. Chỉ chủ sửa.
- **Chia sẻ dashboard = người nhận xem được số.** Số được tính bằng **quyền của chủ dashboard**, người nhận không cần quyền xem bảng nguồn.
- Người nhận được: xem biểu đồ, đổi bộ lọc chung (bản riêng), lọc chéo, xuất PNG.
- Người nhận **không** được "xem các dòng" và không xuất CSV dữ liệu, **trừ khi** họ có quyền xem bảng nguồn. Khi bảng nguồn có khoá phân chia, "xem các dòng" và CSV chỉ trả các dòng **người nhận** thấy, kèm dòng báo "Bạn thấy 12/40 dòng tạo nên con số này" (số vẫn tính theo quyền chủ). Lý do: chia sẻ dashboard không được biến thành chia sẻ cả bảng dữ liệu thô.
- Quyền của chủ thay đổi (bị chuyển giao, mất quyền xem) thì dashboard tính theo quyền **hiện tại** của chủ.
- Dashboard Deals: User thấy số của mình, Leader của team, Manager của cả cây, Admin của mọi cây (chỉ đọc). Dashboard Deals tuỳ chỉnh được chia sẻ thì người nhận thấy số theo phạm vi của chủ.
- **Trỏ cột theo vai trò** (Module 4 mục 3.7, 13; code ở Stage 4, Stage 3 không làm): trên bảng template có vai trò cột, chỉ số được trỏ `"field": {"role": "doanh_thu"}` thay cho mã cột; engine phân giải vai trò → cột lúc tính. Dashboard hệ thống Deals dùng cách này; bản nhân bản giữ nguyên. Ô chọn cột có nhóm Vai trò ghi rõ đang trỏ vào cột nào.
- Guest được cấp dashboard (Module 1 mục 5.2): tính theo phạm vi của lần cấp.
- Việc chia sẻ, bỏ chia sẻ, xem dashboard được chia sẻ đều ghi nhật ký.

## 10. API và AI

- `metrics.query`: truyền chỉ số, khoảng thời gian, phân nhóm, bộ lọc → nhận một bảng số nhỏ. AI hỏi "winrate quý này" nhận về một con số, không kéo dòng thô.
- CRUD chỉ số, nguồn dữ liệu, bảng gộp, biểu đồ, dashboard bằng JSON. OpenAPI + Bruno.

## 11. Giao diện tối thiểu (Stage 3)

- Danh sách dashboard của datahub; trang dashboard có lưới kéo thả, bộ lọc chung, lọc chéo.
- Khung cấu hình biểu đồ; thư viện chỉ số và nguồn dữ liệu đã lưu.
- Trình tạo bảng gộp: chọn nguồn, ghép cột, cột khoá, cách xử lý trùng, chẩn đoán.
- Chia sẻ dashboard.

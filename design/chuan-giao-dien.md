# Chuẩn giao diện — SoE Hub

Trạng thái: Đã chốt (tách từ `CLAUDE.md` ngày 19/11/2026). Concept và token màu của Stage 12: `module12-giao-dien.md` (27/11/2026), file đó ghi rõ điểm nào đổi so với file này. Đọc file này khi làm hoặc rà soát giao diện; việc chỉ đụng server thì không cần đọc.

Theo `promt.md` mục 17: trực quan, dễ thao tác là ưu tiên; font thống nhất, tương phản, sizing chuẩn production; wording gọn, không giọng AI. Áp dụng cho mọi stage có giao diện, không đợi Stage 12.

SoE Hub là công cụ làm việc (bảng, dashboard, form): ưu tiên dễ quét, nhất quán, quen tay. Không trang trí lạ mắt. Chỉ Knowledge, AI Hub và form công khai được đầu tư thẩm mỹ nhiều hơn ở Stage 12.

Quy định ở file này áp dụng ngay khi code (Sonnet làm đúng từ đầu). Việc **kiểm tra** theo danh sách, chạy skill và `break-ui` chỉ làm ở **Stage 12** (làm lại giao diện hoàn chỉnh), không làm ở bước con hay kiểm thử cuối các stage 2–11 (Dương chốt 19/11/2026; `CLAUDE.md` mục "Code" điểm 2). Ngoại lệ: Dynamic Form (Stage 7, cả builder lẫn form công khai) và Onboarding (Stage 9) rà đủ file này, bộ skill và `break-ui` ngay ở kiểm thử cuối stage của chúng, kể cả 375px.

File này gồm hai phần: **quy định** từ mục "Hệ thống thiết kế" trở xuống (luôn áp dụng), và **bộ skill giao diện** để làm và kiểm thử theo quy trình của chúng. Hai bên mâu thuẫn thì quy định trong file này thắng.

## Bộ skill giao diện (bắt buộc cài)

Agent nào làm hoặc rà soát giao diện (Sonnet code, Opus kiểm soát) phải có đủ 6 skill dưới đây. Đầu phiên, kiểm tra `~/.claude/skills/<tên>/SKILL.md`; thiếu skill nào thì chạy lệnh cài bên dưới trước khi làm giao diện. Lệnh cài đúng phiên bản đã dùng cho dự án, chỉ cài skill còn thiếu, không ghi đè skill đã có. Cài xong thì đọc thẳng file `SKILL.md` là dùng được ngay; lệnh gọi skill (`/tên-skill`) chỉ có từ phiên sau. Máy không có mạng hoặc cài lỗi thì ghi vào `progress.md`, làm theo quy định trong file này, và báo Opus.

```bash
set -e
DEST="${DEST:-$HOME/.claude/skills}"; TMP="$(mktemp -d)"; mkdir -p "$DEST"
get() { git init -q "$TMP/$3" && git -C "$TMP/$3" fetch -q --depth 1 "https://github.com/$1" "$2" && git -C "$TMP/$3" checkout -q FETCH_HEAD; }
get emilkowalski/skills                  c8a79627b59d72d764d6ab6f2c87c09a48169833 emil
get pbakaus/impeccable                   687bc381bc9091bf252c0a05303640561014a425 imp
get nextlevelbuilder/ui-ux-pro-max-skill 0da327f37b436c173ce51177678b65ca92e6f3f7 uux
for s in emil-design-eng break-ui mobile-native; do [ -d "$DEST/$s" ] || cp -R "$TMP/emil/skills/$s" "$DEST/"; done
[ -d "$DEST/impeccable" ] || cp -R "$TMP/imp/.claude/skills/impeccable" "$DEST/"
for s in ui-ux-pro-max ui-styling; do [ -d "$DEST/$s" ] || cp -R "$TMP/uux/.claude/skills/$s" "$DEST/"; done
rm -rf "$TMP"
```

Không chép skill vào repo (repo public, skill có giấy phép riêng). Muốn nâng phiên bản thì Opus đổi mã commit ở trên, đọc lại thay đổi của skill, rồi commit file này.

**Dùng skill nào, lúc nào** (cột "Phần bắt buộc" chạy ở Stage 12; `ui-styling` và `emil-design-eng` thì dùng ngay khi code):

| Skill             | Khi nào                                                  | Phần bắt buộc làm                                                                                                  |
| ----------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `ui-ux-pro-max`   | Mọi trang, mọi thành phần                                | Rà `references/quick-reference.md` mục 1–3 và 8 (accessibility, tương tác, hiệu năng, form)    |
| `ui-styling`      | Dựng thành phần shadcn/Tailwind                          | Theo mẫu thành phần và theming của skill, nhưng màu/font lấy theo quy định bên dưới                                |
| `break-ui`        | Mỗi màn hình có dữ liệu                                  | Đủ quy trình: lập bảng mọi giá trị hiển thị → bộ dữ liệu xấu nhất → nút chuyển dữ liệu (chỉ ở dev) → báo lỗi → sửa |
| `mobile-native`   | Trang dùng trên điện thoại (form công khai, onboarding…) | Rà bảng "Never Ship" và phần "Baseline"                                                                            |
| `impeccable`      | Rà soát và Stage 12                                      | Chạy `audit` cho màn mới; `harden` (lỗi, dữ liệu biên), `clarify` (wording) khi rà; `polish` ở Stage 12            |
| `emil-design-eng` | Khi làm chuyển động, hiệu ứng bấm, popover, toast        | Dùng khung quyết định "có nên animate không" trước khi viết hiệu ứng                                               |

Giới hạn khi dùng skill trong dự án này:

- Không chạy lệnh skill tạo file thiết kế riêng trong repo (`ui-ux-pro-max --persist`, `impeccable init` / `document` tạo `PRODUCT.md`, `DESIGN.md`) và không bật hook của `impeccable`, trừ khi Opus quyết. Token thiết kế chỉ nằm ở `apps/web/src/index.css`.
- Gợi ý của skill về màu, font, phong cách chỉ là tham khảo; đã chốt ở đây thì theo đây (ví dụ font Be Vietnam Pro + chữ số Roboto).
- Không đưa dữ liệu thật trong `examples/` vào câu truy vấn hay bộ dữ liệu thử của skill.

## Hệ thống thiết kế

- **Màu:** chỉ dùng token trong `apps/web/src/index.css` (background, foreground, muted, border, primary, ok, warn, bad…). Không viết mã màu cứng trong component; cần màu mới thì thêm token. Màu nhấn (primary) chỉ cho nút chính, mục đang chọn, trạng thái; không dùng để trang trí. Mỗi màn chỉ một nút chính.
- **Font:** Be Vietnam Pro cho toàn bộ chữ, tự host bằng gói `@fontsource/be-vietnam-pro` (không gọi Google Fonts), các độ đậm 400 / 500 / 600 / 700, `font-display: swap`.
- **Chữ số trong ô dữ liệu:** Be Vietnam Pro không có số đều độ rộng (đã kiểm tra bản 5.3.0: không có `tnum`, số 1 hẹp hơn số 0). Nên ô số trong grid, bảng, thẻ chỉ số, trục biểu đồ dùng họ font `SoE Number`: `@font-face` lấy chữ số của Roboto (`@fontsource/roboto`, chữ số mặc định đều độ rộng, chạy được cả trong grid vẽ bằng canvas) với `unicode-range: U+0030-0039`, xếp trước Be Vietnam Pro. Số luôn căn phải.
- **Cỡ chữ:** thang cố định 12 / 14 / 16 / 20 / 24 / 30 px. Chữ thân trong app 14px, line-height 1.5; không chữ nào dưới 12px. Tiêu đề phân cấp bằng cỡ và độ đậm (600–700), nhãn 500, thân 400. Ô nhập tối thiểu 16px trên điện thoại.
- **Khoảng cách:** bội số 4px (4, 8, 12, 16, 24, 32, 48). Không dùng giá trị tuỳ tiện như `mt-[13px]`. Nhóm liên quan thì gần, phần khác nhau thì xa; khoảng trên tiêu đề lớn hơn khoảng dưới.
- **Icon:** chỉ `lucide-react`, một độ dày nét, cỡ 16 hoặc 20px. Không dùng emoji hay ký tự Unicode thay icon. Icon trang trí cạnh chữ thì `aria-hidden`; nút chỉ có icon phải có `aria-label` và tooltip.
- **Thành phần dùng chung** đặt ở `apps/web/src/components/ui` (kiểu shadcn). Không tự viết lại nút, ô nhập, hộp thoại, bảng ở từng trang. Cùng một hành động ("Lưu") phải trông giống nhau ở mọi nơi.
- **Không làm:** chữ gradient, hiệu ứng kính mờ để trang trí, viền màu dày bên trái thẻ, thẻ lồng thẻ, nhãn nhỏ phía trên tiêu đề, đánh số 01/02/03 cho mục, bóng đổ cứng không mờ.

## Trạng thái thành phần

- Mọi thành phần tương tác có đủ: bình thường, hover, focus, đang bấm, vô hiệu, đang tải, lỗi.
- Hover chỉ đặt trong `@media (hover: hover) and (pointer: fine)` (Tailwind 4 tự làm với `hover:`). Không có chức năng nào chỉ hiện khi hover; trên cảm ứng phải bấm được.
- Mọi màn có dữ liệu có đủ 4 trạng thái:
  - **Đang tải:** khung xương (skeleton) cùng bố cục với nội dung thật, không để màn trắng, không đặt spinner giữa nội dung.
  - **Rỗng:** nói rõ chưa có gì và có nút cho việc nên làm tiếp ("Tạo bảng đầu tiên"). Kết quả lọc rỗng thì có nút "Xoá bộ lọc".
  - **Lỗi:** nói chuyện gì xảy ra và cách xử lý (có nút "Thử lại"). Không hiện mã lỗi kỹ thuật, stack trace, JSON thô, `undefined`, `NaN`; mã lỗi server được dịch sang câu tiếng Việt.
  - **Không có quyền:** nói rõ là không có quyền, không hiện trang trống.
- Nút đang gửi thì khoá và hiện trạng thái chờ, không cho bấm hai lần. Thao tác xoá hoặc khó hoàn tác phải xác nhận, nút nguy hiểm màu `bad` và đặt tách khỏi nút chính; nếu được thì có "Hoàn tác" thay cho hỏi lại.
- Thao tác xong báo ngắn bằng toast ("Đã lưu"), tự tắt sau 3–5 giây, không cướp focus.
- **Không dùng hộp thoại của trình duyệt** (`alert`, `confirm`, `prompt`): báo kết quả, cảnh báo, lỗi bằng toast; hỏi xác nhận bằng hộp thoại trong ứng dụng (hoặc làm luôn kèm "Hoàn tác"). Lint `no-alert` chặn từ code (Dương chốt 21/11/2026).
- Hộp thoại có nút đóng, Esc đóng được; đang có thay đổi chưa lưu thì hỏi trước khi đóng. Không dùng hộp thoại khi làm trực tiếp trên trang được. Dropdown, popover hiển thị qua portal để không bị cắt bởi khung cuộn.

## Form và ô nhập

- Mỗi ô có nhãn hiện rõ (không dùng placeholder làm nhãn); ô bắt buộc có dấu `*`; ô phức tạp có dòng gợi ý bên dưới.
- **Chọn thay vì gõ:** chỗ nào chọn thứ hệ thống đã biết (datahub, bảng, cột, trường của nguồn dữ liệu, câu hỏi, lựa chọn, toán tử, người, team) thì phải có danh sách tự sinh, đầy đủ để chọn; không bắt gõ tay. Gõ tay chỉ là cách phụ và luôn có gợi ý khi gõ. Thứ đã chọn bị xoá hay đổi tên thì báo rõ, không để chuỗi chết (Dương chốt 19/11/2026).
- Kiểm tra khi rời ô, không kiểm tra theo từng phím. Lỗi hiện ngay dưới ô, nói rõ sai gì và sửa thế nào ("Email phải có đuôi @base.vn"), không chỉ "Không hợp lệ".
- Gửi thất bại thì giữ nguyên dữ liệu đã nhập và đưa focus về ô lỗi đầu tiên.
- Dùng đúng loại ô để điện thoại bật đúng bàn phím: `type="email"`, `inputmode="numeric"` cho mã, `inputmode="decimal"` cho số tiền; `autocomplete` đúng cho đăng nhập; cho phép dán và trình quản lý mật khẩu; ô mật khẩu có nút hiện/ẩn.
- Form dài (bài test, khảo sát) tự lưu nháp và có thanh tiến độ.

## Bảng, số liệu, biểu đồ

- Định dạng số và ngày theo `vi-VN`, qua **một bộ hàm định dạng dùng chung** (không định dạng tay ở từng trang):
  - Số `1.234.567`; thập phân dấu phẩy `12,5`; tiền `1.234.567 ₫`; phần trăm `12,5%`; số âm có dấu trừ.
  - Ngày `dd/mm/yyyy`; ngày giờ `dd/mm/yyyy HH:mm`; múi giờ `Asia/Ho_Chi_Minh`. Thời gian tương đối ("5 phút trước") chỉ dùng trong 7 ngày, sau đó hiện ngày cụ thể.
  - Giá trị trống hiện "—", không hiện `null`, `0` giả, ô trắng gây hiểu nhầm.
  - Cùng một giá trị phải hiện giống nhau ở mọi chỗ (grid, dashboard, export, thông báo).
- **Không bao giờ cắt bớt số, tiền, ngày.** Chữ dài: tên cần nhận diện thì xuống dòng (tối đa 2 dòng); thông tin phụ thì cắt cuối kèm tooltip xem đầy đủ; tên file, email dài thì cắt giữa.
- Danh sách trên 50 dòng thì ảo hoá hoặc phân trang. Lọc, sắp xếp, tìm kiếm chạy ở server (đã chốt ở phần Datahub).
- Cột sắp xếp được có chỉ báo chiều sắp xếp. Quay lại trang trước giữ nguyên bộ lọc, vị trí cuộn; mọi màn chính có URL riêng để gửi link được.
- Biểu đồ: đúng loại (xu hướng → đường, so sánh → cột, tỉ trọng → tròn, tối đa 5 phần; nhiều hơn thì dùng cột). Luôn có chú giải, tooltip hiện số chính xác, trục có đơn vị và kỳ (ngày/tuần/tháng). Không phân biệt chuỗi chỉ bằng cặp đỏ/xanh lá. Đường lưới nhạt. Không có dữ liệu thì hiện trạng thái rỗng, không vẽ khung trục trống.

## Hiển thị người dùng (Dương chốt 23/11/2026, làm ở Stage 12)

Dữ liệu luôn lưu id tài khoản nên không nhầm; rủi ro là hiển thị chỉ có tên, hai người trùng tên khó nhận ra. Mọi nơi hiện người dùng (ô Datahub kiểu Người dùng, câu "Người điền" của form, lộ trình, deal, thông báo, chia sẻ) dùng **một component "thẻ người" dùng chung** trong `components/ui`, không tự in `full_name`:

- **Mặc định:** avatar (ảnh, chưa có thì chữ cái đầu) + tên.
- **Di chuột / chạm:** thẻ chi tiết gồm email, team (Leader), vai trò, trạng thái (đang làm / đã nghỉ). Chỉ hiện thông tin người xem có quyền thấy.
- **Trùng tên trong cùng danh sách hay bảng đang xem:** tự thêm phần đầu email để phân biệt, ví dụ "Nguyễn Văn A (vana.nt)". Không trùng thì chỉ hiện tên.
- **Ô chọn người** (gắn lộ trình, chia sẻ, chia com, cột Người dùng): luôn hiện email ở dòng thứ hai, kể cả khi không trùng tên. Đây là chỗ chọn nhầm gây sai dữ liệu thật.
- **Export:** tuỳ chọn thêm cột email cạnh cột người dùng.
- Server không đổi dữ liệu; chỉ trả thêm email, team cho phần hiển thị theo quyền xem thông tin người dùng hiện có.

## Dễ đọc, dễ thao tác

- Độ tương phản WCAG AA: chữ thường ≥ 4.5:1 (kể cả placeholder và chữ phụ), chữ lớn, icon có nghĩa và viền thành phần ≥ 3:1.
- Không truyền tin chỉ bằng màu: trạng thái (thắng, thua, quá hạn…) luôn có chữ hoặc icon đi kèm.
- Dùng được bằng bàn phím: thấy rõ ô đang focus (không xoá focus ring), Tab đúng thứ tự nhìn thấy, Enter gửi form, kéo thả có cách làm thay bằng nút hoặc bàn phím.
- Vùng bấm: desktop ≥ 24×24px, điện thoại ≥ 44×44px, các vùng bấm cách nhau ≥ 8px.
- Tiêu đề trang theo thứ tự h1 → h2 → h3, không nhảy cấp. Mục điều hướng đang chọn được làm nổi; điều hướng có cả icon và chữ, giữ cùng vị trí ở mọi trang.
- Phóng to trình duyệt 200% không vỡ bố cục; không khoá zoom.

## Bề ngang và điện thoại

- Desktop 1280px là màn chính; các mốc 375 / 768 / 1024 / 1440. Desktop ≥ 1024px dùng thanh bên, nhỏ hơn thì thu gọn.
- **Mức kiểm thử ở 375px:** trang công khai (form, onboarding) và trang danh sách (danh sách datahub, form, deal…) phải chạy đủ luồng chính ở 375px. Grid và màn làm việc dày dữ liệu dùng chủ yếu trên desktop chỉ cần kiểm bố cục không vỡ, không tràn ngang, mở được ở 375px; không cần e2e đầy đủ trên điện thoại (Dương chốt 19/11/2026). Lỗi giao diện chỉ ở điện thoại của các trang không công khai được gom lại sửa sau, không chặn bước con (CLAUDE.md, "Điện thoại là ưu tiên thấp").
- 375px không được tràn ngang cả trang; bảng rộng thì cuộn trong bảng. Đoạn văn dài (Knowledge) giới hạn 65–75 ký tự mỗi dòng.
- Thẻ meta: `width=device-width, initial-scale=1, viewport-fit=cover`. Không dùng `user-scalable=no` hay `maximum-scale=1`.
- CSS nền cho điện thoại: `-webkit-tap-highlight-color: transparent` ở `html`; nút và link có `touch-action: manipulation` và `user-select: none` (không đặt `user-select: none` lên nội dung); ô nhập 16px.
- Chiều cao toàn màn hình dùng `100dvh` cho khung app, không dùng `100vh`. Thanh cố định ở đỉnh/đáy có `env(safe-area-inset-*)`. Khung cuộn bên trong chỉ cuộn dọc thì chỉ chặn trục dọc (`.contain-scroll-y` = `overscroll-behavior-y: contain`), để trục ngang vẫn nhường cho cử chỉ vuốt hai ngón quay lại trang của trình duyệt; chỉ vùng cuộn ngang thật (bảng rộng, grid) mới chặn cả hai trục (`.contain-scroll`).
- Trang công khai (form) phải thử thêm trên điện thoại thật hoặc ít nhất 375px với bàn phím ảo mở; điều gì chỉ xác minh được trên máy thật thì ghi vào `progress.md`.

## Chuyển động

- Chuyển động chỉ để báo trạng thái hoặc phản hồi thao tác, không trang trí. Không có hiệu ứng khi tải trang; không hiệu ứng cho thao tác bằng phím tắt hay thao tác lặp hàng trăm lần mỗi ngày.
- Thời lượng: phản hồi khi bấm 100–160ms, tooltip 125–200ms, dropdown 150–250ms, hộp thoại 200–300ms. Dùng `ease-out` (`cubic-bezier(0.23, 1, 0.32, 1)`) khi xuất hiện; không dùng `ease-in`. Đóng nhanh hơn mở.
- Chỉ animate `transform` và `opacity`; không animate width/height/top/left. Không xuất hiện từ `scale(0)` (bắt đầu từ 0.95 + mờ). Nút có `:active` thu nhẹ `scale(0.97)`.
- Tôn trọng `prefers-reduced-motion`. Chuyển động không được chặn thao tác của người dùng.

## Wording

- Tiếng Việt, ngắn, rõ. Mỗi câu một ý, dùng từ thường ngày.
- Nút bắt đầu bằng động từ và nói đúng việc: "Lưu", "Tạo bảng", "Xoá 3 dòng". Không dùng "OK", "Submit", "Xác nhận" chung chung.
- Không "Vui lòng…", không "Hệ thống đã…", không câu giải thích dài, không emoji, không câu cảm thán. Không giọng AI kiểu "Tuyệt vời!", "Hãy cùng…", "Dưới đây là…".
- Thông báo thành công ngắn: "Đã lưu", "Đã xoá 3 dòng". Lỗi nói nguyên nhân và cách sửa.
- Số lượng ghi đúng: "0 dòng", "1 dòng", "1.284 dòng"; "Hiển thị 40 / 1.284".
- Thuật ngữ thống nhất toàn app: Datahub, bảng, cột, dòng, view, deal, chỉ số, dashboard. Một khái niệm chỉ một tên.

## Kiểm thử bằng dữ liệu xấu nhất

Ở lần kiểm thử cuối stage, với mỗi màn hình có dữ liệu, thay dữ liệu mẫu bằng dữ liệu xấu nhất **ở tầng dữ liệu** (fixture, seed, API), không sửa markup để tạo lỗi. Dùng giá trị thực tế hoặc đúng giới hạn của schema, không gõ chuỗi vô nghĩa. Bộ tối thiểu:

- Tên: `Đặng Thị Ngọc Hân` (dấu chồng, dễ bị cắt nếu line-height chặt), `Nguyễn Trần Bảo Khánh Linh Phương` (rất dài), `Vy` (rất ngắn), thiếu tên.
- Email dài liền không có khoảng trắng: `bartholomew.fitzgerald@northwind-holdings.example.com`.
- Tên bảng, cột, deal dài đúng giới hạn schema; có ký tự `<b>`, `&amp;`, xuống dòng (phải hiện đúng là chữ).
- Số: `0`, `1`, `1284`, `12.345.678.900`, số âm, phép tính dễ lệch làm tròn (`0,1 + 0,2` phải ra `0,3`), giá trị trống.
- Danh sách: 0 dòng, 1 dòng, đúng 1 trang và 1 trang + 1, 10.000 dòng.
- Ngày: hôm nay, tương lai, 3 năm trước, sát nửa đêm (đúng ngày theo giờ Việt Nam).
- Trạng thái: mọi giá trị trạng thái cùng lúc, đang tải, lỗi API, không có quyền, người đang xem có trong danh sách.
- Bề ngang: khung chứa thật (ví dụ thanh bên), 375px, 1440px, phóng to 200%.

Lỗi hay gặp và cách sửa: chữ tràn khỏi ô trong flex/grid → `min-width: 0` (grid dùng `minmax(0, 1fr)`); email/URL tràn → `overflow-wrap: anywhere`; avatar, icon, nút cuối hàng bị bóp → `flex-shrink: 0`; nhãn trạng thái xuống dòng → `white-space: nowrap`; chữ có dấu bị cắt đầu/đuôi → nới line-height, bỏ `overflow: hidden` trên khối chữ; ảnh vỡ → ảnh dự phòng (chữ cái đầu) và `object-fit: cover`.

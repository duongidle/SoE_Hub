# Module 12: quyết định khi code

## 12A-1 (27/11/2026)

- **Token:** `apps/web/src/index.css`. Màu theo nghĩa có bốn biến mỗi màu: `--ok` (chữ), `--ok-bg`, `--ok-border`, `--ok-dot`; tương tự `info`, `warn`, `bad`, `ai`. `--ok/--warn/--bad` đổi sang màu chữ AA (#047857, #B45309, #BE123C) nên `text-bad` cũ vẫn đạt tương phản. Thêm `--workspace`, `--sidebar`, `--faint`, `--border-soft`, `--primary-hover/-soft/-border`, `--glow-1/2`.
- **Bo góc:** đổi luôn thang Tailwind (`rounded-md` 10px, `rounded-lg` 12px, `rounded-xl` 16px, `rounded-2xl` 20px) để cả app theo concept mà không sửa từng file. Thêm `rounded-control/card/frame`. Card giữ class `rounded-xl` vì e2e stage1 chọn `div.rounded-xl`.
- **Bóng:** `shadow-sm/md/lg` ánh tím than; thêm `shadow-card`, `shadow-frame`.
- **Grid canvas:** đọc màu qua `lib/theme.ts` `token()` (getComputedStyle), nhận hex bình thường, không đổi.
- **Shell:** khung nổi `h-dvh`, trang cuộn trong vùng nội dung (không cuộn document); top bar kính mờ sticky trong vùng cuộn. Sidebar thu gọn nhớ ở localStorage `soe.sidebar.collapsed`. Dưới 1024px: sidebar thành ngăn kéo trái (Radix Dialog), nút "Mở menu", nav tên "Menu điện thoại"; trên desktop nav tên "Menu chính" (helper e2e giữ nguyên). Nút "Đăng xuất" chỉ nằm ở đáy sidebar desktop; dưới 1024px là nút biểu tượng ở top bar.
- **Breadcrumb:** suy từ đường dẫn (`crumbs` trong shell.tsx); trang chưa tự đặt được breadcrumb.
- **Trang /cai-dat tạm:** `pages/settings.tsx` (`SettingsHubPage`), danh sách link theo quyền từ `SETTINGS_LINKS` (shell.tsx). Link có `aria-label` = tên để e2e khớp exact.
- **e2e helper:** `Session.menuLink/clickMenu/hasMenu` với mục quản trị tự đi qua "Cài đặt" rồi tìm link trong `main`.
- **Drawer:** `components/ui/drawer.tsx`, 420px (560px với `wide`), đầy màn dưới 640px, hỏi khi `dirty`, có `footer`.

## 12A-2 (27/11/2026)

- **Chuông là popover rộng (28rem), không dùng Drawer:** ba tab (Thông báo, Nhắc hẹn, Thông báo chung) đều là danh sách ngắn; popover giữ nguyên `getByRole("dialog", { name: "Thông báo" })` của e2e. Form tạo (nhắc hẹn, thông báo chung) mở bằng Modal ở ngoài popover (popover đóng trước), tạo xong chuông mở lại đúng tab.
- **Tab Nhắc hẹn** chỉ hiện với `notification:manage`. **Tab Thông báo chung**: ai cũng thấy "Đã nhận"; `notification:announce` thấy thêm "Đã gửi". Nút "+" chỉ hiện khi có ít nhất một quyền; mỗi mục theo quyền riêng.
- **Tái dùng:** `RemindersPanel` (`showNew` tắt nút "Nhắc mới" khi nằm trong chuông), `AnnouncementsPanel` (tab điều khiển từ ngoài), `ComposeForm` (chỉ form, không Card). Trang `/nhac-hen` và `/thong-bao-chung` vẫn có, dùng cùng các thành phần.
- **Bộ lọc "Tất cả/Chưa đọc" của chuông** đổi thành nút "Chỉ chưa đọc" trong tab Thông báo (tránh hai dải tab lồng nhau).
- **Cài đặt hai cột:** `SettingsLayout` (`pages/settings.tsx`) bọc mọi trang cài đặt ngay trong `shell.tsx` (`isSettingsPath`, `settingsLinkFor` chọn mục khớp dài nhất; `/tai-khoan/*` thuộc Cài đặt). Nhóm "Cá nhân" = mục không đòi quyền; "Quản trị" = còn lại. `/cai-dat`: màn rộng (>=768px) chuyển thẳng sang mục đầu tiên (Tài khoản của tôi); điện thoại hiện danh sách, chọn thì vào trang con có link quay lại "Cài đặt". Nav tên "Menu cài đặt"; link có `aria-label` = tên.
- **e2e helper `menuLink`:** sau khi bấm "Cài đặt" ở sidebar, tìm link trong nav "Menu cài đặt" (không còn kiểm URL `/cai-dat$` vì desktop chuyển trang).
- **Sửa theo:** `crumbs` chọn mục cài đặt dài nhất (trước đó `/tai-khoan/thong-bao` ra nhầm "Tài khoản của tôi"); mục Cài đặt ở sidebar sáng khi đang ở trang cài đặt bất kỳ.
- **Button secondary:** đã là nền trắng (`bg-card`) + viền từ 12A-1, chỉ hover mới tím nhạt; không sửa.

## 12A-3 (27/11/2026)

- **Select mới** (`components/ui/select.tsx`, `form.tsx` xuất lại để ~52 file giữ import): nút kích hoạt `role="combobox"` (kiểu Input, `data-value` giữ giá trị), danh sách `role="listbox"` trong `Popover` qua portal. Đọc `<option>`/`<optgroup>` qua `React.Children` (cả trong fragment, mảng); giá trị số đổi thành chuỗi; option `disabled` bị bỏ qua khi di chuyển và không chọn được. `onChange` nhận `{ target: { value, name }, currentTarget: { value, name } }` (kiểu `SelectChange`), không phải `ChangeEvent`: một chỗ (`admin.tsx` `set`) khai kiểu lại. Có `name` thì thêm `<input type="hidden">` cùng tên (chưa chỗ nào dùng). Không hỗ trợ `multiple`/`size` (không nơi nào dùng).
- **Ô tìm** hiện khi hơn 8 lựa chọn (bỏ dấu, không phân biệt hoa thường); ít hơn thì gõ chữ để nhảy tới lựa chọn bắt đầu bằng chữ đó. Phím: lên/xuống, Home/End, Enter chọn, Esc đóng và trả focus về nút, nút cũng mở được bằng mũi tên. Focus vào ô tìm (hoặc danh sách) qua `onOpenAutoFocus`; mục sáng nối bằng `aria-activedescendant`.
- **Panel modal** (`Popover` thêm `modal` và `onOpenAutoFocus`): Select mở từ trong hộp thoại (Radix Dialog) bị bẫy focus của hộp thoại kéo ngược về nút nên không nhận được bàn phím. Nguyên nhân gốc: `react-popover` 1.1.15 kéo `react-focus-scope` 1.1.7, còn `react-dialog` 1.3.1 dùng 1.3.1; hai bản có hai ngăn xếp riêng nên popover không tạm dừng được bẫy của hộp thoại. Nâng `@radix-ui/react-popover` lên 1.3.1 (cùng bản phụ thuộc với dialog) và dùng `modal`. Hệ quả: khi danh sách mở, phần trang sau nó bị `aria-hidden`; bấm ra ngoài chỉ đóng danh sách.
- **Tên truy cập:** panel đặt tên cố định "Danh sách lựa chọn" và danh sách không mang `aria-label` của nút, để `getByLabel("Kết quả")` của e2e không khớp thêm phần tử khi đang mở.
- **E2e:** `chooseOption(trigger, "giá trị" | { label } | { index })` (chuỗi khớp `data-value` trước, rồi nhãn); `openSelect(trigger)` trả danh sách, `closeSelect(list)`; `expectSelectValue(trigger, v)` thay `toHaveValue` của select. `openSelect` giữ nút bằng handle vì khi danh sách mở, locator `getByRole` trong hộp thoại không còn khớp (trang `aria-hidden`). Chỗ cũ dùng `locator("option")`, `locator("select")` đã đổi theo (stage1, 2c1, 3b, 4-1d, 4-3, 9).

## 12A-4 (27/11/2026)

Cải thiện trải nghiệm thuần giao diện (Dương cho phép, `module12-giao-dien.md` mục 1). Mỗi cái kèm chỗ đã lắp để 12C–12F gắn tiếp.

- **Tab và bộ lọc trên URL:** `lib/use-url-state.ts` `useUrlState(DEFAULTS)` trả `[giá trị, set(patch)]` trên search params; `DEFAULTS` là hằng ở module (liệt kê khoá trang sở hữu, giá trị mặc định không ghi lên URL); `navigate({ replace: true })` nên gõ không đẩy lịch sử; khoá khác của URL giữ nguyên. Router parse "?n=12" thành số: `readParams` đưa về chuỗi. Cuộn: `scrollRestoration: true` + `scrollToTopSelectors` ở `router.tsx`; hộp cuộn của Shell mang `data-scroll-restoration-id="shell-main"` (quay lại thì giữ chỗ cuộn, trang mới mở ở đầu). **Đã lắp:** tab Của tôi/Được chia sẻ ở `/datahub` (`?tab=shared`), bộ lọc đã áp của Nhật ký `/quan-tri/nhat-ky` (`from, to, actor, via, connection, command, result, target`; nháp trong form, bấm Lọc mới ghi lên URL). Test: `apps/web/test/url-state.test.ts`.
- **Phím "/":** `lib/search-hotkey.ts`. `useSearchHotkey()` gắn một lần trong Shell (nghe ở pha capture); ô tìm chính của trang nhận `{...searchHotkeyProps}` (`data-page-search` + Esc rời ô). Bỏ qua khi đang gõ (input, textarea, select, contenteditable, role textbox/combobox/searchbox, kể cả ô đang sửa của grid), khi có phím Ctrl/Meta/Alt, hoặc khi đang mở hộp thoại. Chặn luôn phím để grid không bắt đầu sửa ô bằng "/". **Đã lắp:** ô "Tìm trong bảng" (`datahub/view-tools.tsx`).
- **Toast "Hoàn tác":** `notify.ok(msg, { label, onClick })` có từ trước (8 giây); 12A-4 dùng nó để **bỏ hộp xác nhận** ở xoá datahub (`datahub/list.tsx`: xoá ngay, toast "Đã xoá datahub … · Hoàn tác" gọi `restoreDatahub`). Xoá bảng trong datahub (`detail.tsx`) vẫn còn hộp xác nhận, cùng cách làm được khi gắn tiếp. Xoá hẳn hoặc khó hoàn tác thì giữ hộp xác nhận.
- **Trạng thái rỗng:** `EmptyState` nhận `cta={{ label, onClick, icon? }}` (nơi gọi chỉ truyền khi người dùng có quyền làm); `FilteredEmptyState({ onClear })` là biến thể "Không có kết quả phù hợp" + nút "Xoá bộ lọc". **Đã lắp:** `cta` ở datahub của tôi rỗng; `FilteredEmptyState` ở Nhật ký (lọc ra không dòng). Chữ cũ "Không có dòng nhật ký nào khớp bộ lọc." đã đổi.
- **Test chập chờn stage1 (nguyên nhân gốc):** khi đăng xuất, trang cũ vẫn gọi API với phiên đã chết. Cụ thể (1) truy vấn Onboarding ở Shell gọi `scope=mine` rồi mới `scope=following` nên đăng xuất xen giữa thì cái thứ hai ra 401 (nay gọi song song); (2) giữa lúc máy chủ xoá phiên và lúc giao diện chuyển trang, refetch khi focus cửa sổ và luồng SSE của trang cũ bắn 401 (nay Shell đặt `closing` trước khi gọi `/auth/logout`: các màn đăng nhập rời đi, SSE đóng, mọi truy vấn huỷ). Lỗi 401 này test bắt đúng (kiểm console/network), không sửa test. Chưa tái hiện được đúng dạng "chờ nút Đăng xuất" ghi ở 12A-2/3; sau sửa chạy 9 lần liên tiếp stage1 desktop 16/16 (trước sửa 2 lần lỗi trong 8).
- **Viền focus ô nhập (Dương phản ánh):** `:focus-visible` toàn cục ở `index.css` ngoài `@layer` thắng `outline-none` của utilities nên ô nhập có ba lớp. Đưa vào `@layer base`; Input, Textarea, nút Select, ô tìm Select, ô công thức chỉ còn viền 1px primary (#4F46E5, tương phản 6.3:1 với nền trắng) + `ring-2 ring-primary/10` (Dương chỉnh nhạt thêm). Nút, link, ô khác không đặt `outline-none` giữ outline 2px. E2e kiểm `outline-style: none`, ảnh `12a4/focus.png`.

## Overscroll ngang (28/11/2026)

Dương báo: trên Mac, vuốt hai ngón để quay lại trang chỉ chạy khi chuột ở nền ngoài khung app. Nguyên nhân: `.contain-scroll` đặt `overscroll-behavior: contain` cả hai trục trên vùng cuộn chính của Shell và mọi khung cuộn dọc, nên trình duyệt không nhận cử chỉ quay lại. Sửa: thêm `.contain-scroll-y` (`overscroll-behavior-y: contain`, trục x để auto) cho mọi khung chỉ cuộn dọc (Shell main và sidebar, drawer, popover, dropdown, hộp thoại form, các danh sách chọn, panel dòng, panel cấu hình biểu đồ, ô ghi chú). Giữ `.contain-scroll` (cả hai trục) chỉ ở vùng cuộn ngang thật: `dashboard/data-views.tsx` (2 chỗ) và `dashboard/rows-dialog.tsx` (bảng rộng). Grid Datahub tự đặt `overscrollX/Y = 0`.

## 12B (28/11/2026)

- **12B-1, quyền xem thông tin người (Sonnet tự chọn theo quy định có sẵn, Opus rà):** `email` trong `datahub.people.lookup` đã trả cho mọi thành viên từ trước (để chọn người chia sẻ), giữ nguyên. `roles`, `team`, `team_id` là dữ kiện org chart nên theo đúng phạm vi `org` của `org.member.get` (Admin tất cả, người khác cây của mình): ngoài cây thì null, thẻ không hiện dòng đó. `status` ai cũng thấy (đã lộ qua tra theo `ids`). Guest không có `datahub:datahub:use` nên không gọi được. Không nới quyền nào.
- **Team:** mã team = mã Leader (Leader là thành viên team của chính họ; người chưa có Leader, dưới thẳng Manager, không có team). `datahub.people.teams` liệt kê, `lookup({team_id})` lấy thành viên đang làm trong cây người xem, tối đa 200, có `table_id` thì chỉ thành viên bảng.
- **Trạng thái:** server trả mã (`active`/`locked`/`inactive`); web gọi "Đang làm", "Đã nghỉ", "Chưa kích hoạt" (`statusLabel`).
- **Phân biệt trùng tên:** `disambiguate` lấy phần trước @ của email; trùng cả phần đó thì cả email; không có email thì giữ tên. Phạm vi "cùng danh sách" = người đã biết của bảng (`LabelCache`). Grid vẽ tên phân biệt; copy/dán/tìm vẫn dùng tên thường để không đổi dữ liệu sao chép.
- **Thẻ người:** hover chuột 250ms mở, rời 200ms đóng; chạm/Enter mở; không chiếm focus. Chưa có ảnh nên avatar là chữ cái đầu của hai từ cuối. `components/ui/person.tsx` gọi `lookupPeople` của datahub (một API duy nhất trả người), chưa có API riêng ngoài datahub.
- **Chia sẻ datahub:** `AddShare` chuyển sang `PeoplePicker`: chọn nhiều người một lần, cùng phạm vi và quyền, gửi lần lượt; người lỗi giữ lại trong danh sách kèm lỗi. E2e `stage2c4` sửa theo (nút "Chọn người", `people-picker`) và thêm một test.
- **Export:** `user_emails` thêm cột email cho Người dùng, Người tạo, Người sửa (xuất tổng hợp thì không). UI nút chọn thuộc 12B-2.
- **12B-2, `PeopleField` (`components/ui/people-field.tsx`):** ô giữ danh sách id người (form, thông báo chung, lộ trình): nút mở `PeoplePicker` trong Popover `modal`, các người đã chọn hiện bằng thẻ người có nút bỏ, trùng tên thì phân biệt. `PeoplePicker` thêm `teams={false}` (ô Leader: chọn cả team không phải đáp án) và `accept` (lọc người ô không được nhận). Đây thay `PeoplePicker` cũ của `form/settings.tsx` (trùng tên, đã đổi thành `PeopleList`).
- **12B-2, Avatar vẽ chữ cái đầu bằng CSS** (`data-initials` + `::before`), không nằm trong text: chép hay tìm tên (và e2e `getByText`) không dính chữ cái đầu.
- **12B-2, ranh giới giữ nguyên luật nghiệp vụ:** gắn lộ trình giữ ô Nhân sự là một `Select` (một người, luật chỉ vai trò User trong cây; server chỉ nhận `staff_id`), tên có phân biệt trùng; ô Người theo dõi thành nhiều người (server nhận mảng `followers`) lọc client theo vai trò Leader/Manager khi biết vai trò. Thông báo chung: người lẻ dùng `PeopleField`; hai nhóm "Cả cây của"/"Team của" giữ checkbox. Cột Người dùng nhiều người: nút "Thêm người" mở `PeoplePicker` (chỉ thành viên bảng qua `tableId`) và nút "Thêm (n)" mới thêm vào danh sách; dùng chung cho grid và panel dòng.
- **12B-2, chỗ chưa dùng thẻ người:** chỉ thay chỗ có sẵn id người: danh sách thành viên và cây org, giới hạn người dùng, nhật ký (người thực hiện), chủ datahub, lộ trình/theo dõi onboarding, thanh toán/chốt kỳ Deal, panel dòng Datahub (người và lịch sử). Không có id nên giữ chữ: chủ dashboard chia sẻ, người gửi thông báo, Guest cấp dữ liệu, token tài khoản, người chấm bài, tiêu đề hộp thoại, chào ở trang chủ/shell. `Select` (tên + email trong nhãn) giữ cho chọn một người.
- **12B-2, hộp xuất Datahub:** ô tick "Thêm cột email cạnh cột người dùng" (ẩn với Guest và khi xuất dòng nhóm); Bruno `export-create.bru` thêm `user_emails`.

## 12B-3 Không chồng tiêu đề (28/11)

- Một chỗ: `apps/web/src/lib/page-chrome.tsx` (`PageChromeContext`, `useCrumbs(name)`). Shell cấp context; ngoài shell (không có context) `PageTitle` vẽ như cũ.
- `PageTitle` có context và children là chuỗi: h1 luôn `sr-only` (kể cả khi khác breadcrumb), chuỗi đó thành mắt cuối của breadcrumb khi khác mắt cuối của menu. Trang Cài đặt không thêm mắt (đã có nhãn). Nếu breadcrumb gốc chỉ là tên thương hiệu (đường dẫn menu không biết) thì tiêu đề thay luôn.
- Nút `actions` portal vào `#topbar-actions` (hàng trước chuông). Không đổi tên nút. Dưới 640px khung này ẩn, nút "•••" (hiện khi có actions) mở thành bảng dưới top bar, bấm nút hay link trong bảng thì đóng. Dùng portal vào node luôn gắn nên trạng thái trang không mất khi bảng đóng.
- Giữ nguyên thanh công cụ riêng của trang Datahub mở (Nhập dữ liệu, Chia sẻ) và trang Deal: chỉ h1 thành sr-only; Datahub mở đưa tên datahub vào breadcrumb.
- Tiêu đề trang nội dung (bài Knowledge, skill AI Hub, "Xin chào") giữ hiện vì là nội dung, không trùng breadcrumb.

## 12C-1 Datahub: danh sách và trang mở (28/11)

### Bảng đối chiếu thao tác (lập trước khi đổi; không thao tác nào mất)

Danh sách Datahub (`list.tsx`):

| # | Thao tác | Chỗ cũ | Chỗ mới |
| --- | --- | --- | --- |
| 1 | Tạo datahub | nút trên top bar | giữ (top bar, nút chính) |
| 2 | Nhập dữ liệu (tạo datahub từ file) | nút trên top bar | giữ (top bar) |
| 3 | Thùng rác datahub | link trên top bar | giữ (top bar) |
| 4 | Xem Của tôi / Được chia sẻ | 2 tab | 3 tab: **Tất cả** (mới, đứng đầu), Của tôi, Được chia sẻ với tôi; tab trên URL `?tab=` (mặc định `all`) |
| 5 | Mở datahub | bấm thẻ | giữ |
| 6 | Đổi tên / Xoá datahub (Hoàn tác) | menu "..." của thẻ (chỉ của tôi) | giữ |
| 7 | Chủ + quyền của datahub được chia sẻ | dòng "Chủ" trên thẻ | giữ, hiện cả ở tab Tất cả (hai datahub trùng tên phân biệt bằng chủ) |
| 8 | Dùng bao nhiêu / giới hạn | dòng chữ dưới tab (tab Của tôi) | giữ (tab Tất cả và Của tôi) |

Trang datahub mở (`detail.tsx`, `view-tabs.tsx`, `view-tools.tsx`, `table-view.tsx`):

| # | Thao tác | Chỗ cũ | Chỗ mới |
| --- | --- | --- | --- |
| 9 | Về danh sách datahub | link "Datahub" đầu trang | nút mũi tên bên trái dải tab bảng (`aria-label` giữ) |
| 10 | Nhập dữ liệu (vào bảng của datahub) | nút ở dải đầu trang | top bar (nút phụ) |
| 11 | Chia sẻ datahub | nút ở dải đầu trang | top bar (nút phụ) |
| 12 | Xem chủ + quyền (người được chia sẻ) | dòng đầu trang | bên phải dải tab bảng |
| 13 | Chọn bảng | tab bảng | tab bảng, cuộn ngang |
| 14 | Đổi tên, chuyển trái/phải, xoá bảng | menu "..." của tab đang mở | giữ |
| 15 | Dashboard | tab sau các bảng | công tắc phân đoạn "Dữ liệu \| Dashboard" ghim trái đầu trang (chế độ = đường dẫn `/datahub/:id` hoặc `/dashboard`, theo quyết định 28/11 trong module12-giao-dien); chế độ Dashboard ẩn dải tab bảng và thanh công cụ dữ liệu |
| 16 | Thêm bảng | nút "Thêm bảng" | nút "+" ghim trái dải tab bảng (menu), mục "Thêm bảng" |
| 17 | Tạo bảng gộp | nút "Tạo bảng gộp" | nút "+" → mục "Tạo bảng gộp" |
| 18 | Chọn view | tab view | nút chọn view (menu) đầu thanh công cụ |
| 19 | Thêm view | nút "Thêm view" | menu chọn view → "Thêm view" |
| 20 | Đổi tên / sao chép / về mặc định / chuyển / xoá view | menu "..." của tab view | nút "..." cạnh nút chọn view |
| 21 | Ghi chú "đang xem bản riêng" | dưới tab view | dưới thanh công cụ |
| 22 | Thời gian | thanh công cụ | giữ |
| 23 | Lọc | thanh công cụ | giữ (hiện số điều kiện) |
| 24 | Sắp xếp | thanh công cụ | giữ (hiện số cột) |
| 25 | Nhóm | thanh công cụ | giữ (hiện số cấp) |
| 26 | Cột (ẩn, thứ tự, cố định) | nút "Cột" | nút "Ẩn cột" (hiện số cột ẩn) |
| 27 | Tô màu | thanh công cụ | giữ (hiện số quy tắc) |
| 28 | Chiều cao dòng (mật độ) | nút "Dòng: ..." | nút icon bên phải, cạnh ô tìm |
| 29 | Tìm trong bảng (phím "/") | ô tìm | giữ, bên phải |
| 30 | Chip lọc thời gian, cảnh báo thiết lập trỏ cột đã xoá | dưới thanh | giữ |
| 31 | Theo kỳ chung; Ưu tiên / Cần kiểm lại (bảng Deal) | thanh công cụ | giữ, bên phải cạnh ô tìm |
| 32 | Cột của bảng | nút | "..." |
| 33 | Xuất | nút | "..." |
| 34 | Nhập (vào bảng đang mở) | nút | "..." |
| 35 | Tìm dòng trùng | nút | "..." |
| 36 | Thùng rác của bảng | nút | "..." |
| 37 | So sánh phiên bản (bảng chính sách com) | nút | "..." |
| 38 | Thêm cột | nút | "..." |
| 39 | Thêm dòng | nút ở dòng công cụ thứ 3 | nút chính duy nhất, đầu thanh công cụ (sau nút chọn view) |
| 40 | Hoàn tác, Làm lại | nút | giữ, nút icon cạnh Thêm dòng |
| 41 | Sửa n dòng, Xoá n dòng | nút khi chọn dòng | giữ, cùng dòng công cụ |
| 42 | Chi tiết dòng | nút khi chọn dòng | giữ, cùng dòng công cụ |
| 43 | Thu gọn / Mở tất cả nhóm | nút khi có nhóm | giữ, cùng dòng công cụ |
| 44 | Nhãn "Chỉ xem" | dòng công cụ | giữ |
| 45 | Số dòng, "Đang lưu...", "Đã lưu view" | góc phải dòng công cụ + dòng riêng | một dòng chân dưới bảng |
| 46 | Cảnh báo quá 1.000 nhóm | trên bảng | giữ |
| 47 | Bảng gộp: thanh trạng thái (`MergeBar`) | trên cùng | giữ |

47 thao tác, không mất cái nào. Đổi chỗ: 9–12, 15–20, 26, 28, 32–39, 45 (28 thao tác); còn lại giữ chỗ hoặc chỉ đổi dáng.

### Quyết định khi code 12C-1

- **Một thanh công cụ.** `ViewTools` giữ dòng duy nhất (cho phép xuống dòng khi quá hẹp, không cuộn ngang trang). Trái: nút chọn view (+ "•••" của view), "Thêm dòng" (nút chính duy nhất; `OpenTable` portal vào khe `rowSlotRef` vì phiên dòng nằm dưới `ViewBody`), Hoàn tác, Làm lại, thao tác dòng đang chọn, rồi Thời gian, Lọc, Sắp xếp, Nhóm, Ẩn cột, Tô màu. Phải: Theo kỳ chung / Ưu tiên / Cần kiểm lại (bảng Deal), ô tìm (phím "/"), mật độ dòng (chỉ icon), "•••".
- **Nút công cụ.** Hiện số đang áp ("Lọc 2": `aria-label` có số) và tô primary nhạt khi áp. Nhãn chữ chỉ hiện khi vùng thanh rộng từ 72rem (container query); hẹp hơn chỉ icon, tên ở `title` và `aria-label`. Nút "Cột" đổi tên "Ẩn cột" theo đề bài (spec `openTool` đổi theo). "Thu gọn/Mở tất cả" nhóm thành nút icon.
- **Menu "•••"** (`aria-label="Thêm thao tác"`, thay cả popover cũ của điện thoại): Nhập, Xuất, Tìm dòng trùng, Thùng rác | Cột của bảng, Thêm cột, So sánh phiên bản; mỗi mục vẫn theo quyền như cũ.
- **Dashboard (theo yêu cầu Opus 28/11):** công tắc phân đoạn "Dữ liệu | Dashboard" ghim trái, chế độ là đường dẫn (`/datahub/:id` hay `/dashboard`; link gửi được, không thêm hook). Chế độ Dashboard ẩn dải tab bảng và thanh công cụ dữ liệu; chỉ chủ datahub thấy công tắc. `data-testid="dashboard-tab"` giữ trên mục Dashboard.
- **Dải tab bảng:** "+" ghim trái (menu Thêm bảng, Tạo bảng gộp), nút "Bảng ▾ (n)" mở danh sách mọi bảng (ô tìm khi hơn 6 bảng, icon, số dòng, dấu bảng đang mở, chip Gộp / quyền của người được chia sẻ); tab đang mở tự cuộn vào tầm nhìn; hai mép có bóng mờ + mũi tên khi còn tab khuất; tên dài cắt kèm tooltip. Chưa làm: kéo thả đổi thứ tự trong danh sách (đã có "Chuyển sang trái/phải" ở menu tab). Điện thoại: nút "Bảng" bị cắt mép phải khi tab hẹp, lề phải cuộn ngang được, trang không tràn.
- **Danh sách datahub:** mặc định tab Tất cả (URL không có `tab=`). Khi Tất cả rỗng và Của tôi rỗng cùng chữ "Bạn chưa có datahub nào". Thẻ: icon, tên, mô tả (hoặc "Chưa có mô tả"), số bảng, số dòng, "Cập nhật vừa xong/5 phút trước/ngày dd/mm/yyyy"; datahub được chia sẻ có dòng Chủ + quyền. Tab Được chia sẻ rỗng có nút "Xem datahub của tôi".
- **URL:** view đang mở `?view=` qua `useUrlState`; bảng nằm ở đường dẫn.
- **Toast:** Sonner `expand` (xếp dọc, không chồng), tối đa 4; khi đầy bỏ toast thường cũ nhất trước.
- **Lối tắt thêm (rẻ):** phím "/" ô tìm (đã có), mũi tên về danh sách datahub cạnh dải tab, danh sách bảng có tìm.
- **Spec sửa vì nút đổi chỗ** (không sửa để che lỗi): mục vào "•••" (`stage2c1`, `2c3`, `2c4`, `2d`, `2e`, `3b`, `4-1d`, `4-7` — hai spec cuối chưa chạy), tab view thành nút chọn view (`2c2`), tab Dashboard không còn là tab đầu (`2c1` `nth(2)`), tab mặc định đổi sang Tất cả (`2c1`, `2e`: hai datahub trùng tên cùng hiện ở Tất cả).

## 12C-2 Datahub: panel dòng, grid, hộp thoại, dashboard (28/11)

- **Panel dòng** là `Drawer` 560px, lớp phủ nhạt không mờ (`soft`) để còn thấy bảng; tiêu đề giữ "Dòng #n" (tên hộp thoại cho trình đọc màn hình và e2e). Trường chia hai nhóm: "Thông tin" và "Tự động tính" (cột công thức, tra cứu, tổng hợp, tự điền, số tự tăng, cột hệ thống); không có nhóm cột do người dùng đặt nên không thêm. Nút mũi tên lên/xuống đi tới dòng trước/sau trong thứ tự đang xem (chỉ dòng đã tải). Ô người đơn dùng `PersonChip` như cũ; ô nhiều người có thuộc tính giữ chữ (e2e đọc chữ).
- **Grid:** theme canvas theo token (đầu cột nền `--workspace`, chữ `--muted-foreground`, đường kẻ `--border-soft`, chọn `--primary-soft`, bo 6). Khung grid bo 16px có viền mảnh. Chip lựa chọn theo màu ngữ nghĩa cho 5 màu (xanh lá, xanh dương, cam, đỏ, tím = ok/info/warn/bad/ai); vàng, ngọc, hồng, xám giữ nền nhạt của người dùng chọn. Số căn phải đã có (font "SoE Number" có chữ số đều).
- **Cột số thứ tự (Dương 28/11):** ô "số" thay ô "số + hộp chọn". Bấm trái mở panel; bấm phải chọn dòng (Ctrl/Cmd chọn thêm, Shift chọn dải); chạm mở, nhấn giữ 0,5 giây chọn. Hành động chạy sau mouseup bằng timer 0 vì grid tự đọc lại vùng chọn khi nhả chuột. Bảng có nhóm giữ ô chọn cũ (không có số). Grid chưa có menu chuột phải cho dòng nên không hiện menu; việc có sẵn nằm ở nút "Sửa n dòng / Xoá n dòng" trên thanh công cụ. Hệ quả: nút "Chi tiết dòng" thành icon (vẫn có `aria-label`).
- **Thanh công cụ gọn (Dương 28/11):** mọi nút trơn không viền cao 32px (desktop), nhóm bằng vạch mảnh: [chọn view] [Thêm dòng, thao tác dòng chọn] [Lọc, Sắp xếp, Nhóm, Ẩn cột, Tô màu, Thời gian] … [ô tìm, mật độ, •••]. Hoàn tác/Làm lại vào "•••" (`UndoApi` do `OpenTable` đẩy lên `ViewBody`; Ctrl+Z vẫn dùng). Nút đang áp: nền primary nhạt + số. Chữ nút hiện khi vùng thanh ≥ 64rem (hết cuối 1440px). "Sửa n dòng / Xoá n dòng" dưới 64rem chỉ còn icon + số để thanh không xuống dòng và đẩy grid xuống giữa lúc bấm đúp (lỗi này làm `stage4-1d` hỏng từ 12C-1: bấm lần một hiện nút "Chi tiết dòng" làm thanh gãy dòng, lần hai trượt ô).
- **Hộp thoại:** chân hộp thoại một kiểu (vạch mảnh trên, Huỷ trái, nút chính phải) cho nhập, xuất, trùng, gộp, thùng rác, chia sẻ. **Trình sửa cột** (Dương 28/11) thành `Drawer` 480px, lề 20px, bốn mục Cơ bản / Định dạng / Thuộc tính / Nâng cao, công tắc gạt (`Switch`: checkbox trong suốt đè track; tên và `check()` của e2e giữ nguyên), Lưu/Huỷ ghim đáy (nút `form="column-form"`). "Không cho trùng" và "Giá trị mặc định" chuyển sang Nâng cao. Trình sửa công thức giữ popover (không đổi); hộp xác nhận đổi kiểu và tác động công thức giữ `Modal`.
- **Dashboard:** nền chấm lưới trên `--workspace` trong khung bo; hàng tab dashboard dạng viên thuốc, "Dashboard mới" là nút "+", Nhập JSON và Thùng rác là nút icon; bộ lọc chung bỏ nhãn trên ô (giữ `aria-label`) thành MỘT dòng cùng "n biểu đồ" và "Thêm biểu đồ" (nút chính); bỏ dòng gợi ý dài. Thẻ biểu đồ trắng bo 16px, viền mảnh, tiêu đề + tên bảng nguồn nhỏ (chỉ khi nguồn là id bảng) + "•••". Palette biểu đồ đổi sang indigo/lục/hổ phách/dương/tím/hồng. **Không làm nút "Sửa bố cục":** chủ dashboard kéo thẻ trực tiếp bằng tay nắm ở thẻ (e2e `stage3c1` dựa vào đó); thêm công tắc sửa/xem là đổi hành vi, để Dương quyết nếu muốn. Dashboard rỗng gợi ý 4 mẫu đọc từ cột của bảng đầu có dữ liệu (Số dòng, Số dòng theo cột chọn, Số dòng theo cột ngày, Tổng cột số); bấm mở bảng cấu hình với **loại biểu đồ** đã chọn; bảng/cột vẫn chọn trong đó (cơ chế sẵn có chưa nhận cấu hình điền sẵn, không thêm API).
- **Sửa lỗi:** (1) KPI luôn hiện cỡ chữ trang (14px): `FitText` xoá style inline khi đo rồi `setSize` cùng giá trị nên React không vẽ lại; nay khôi phục style, cỡ lớn tới 44px. (2) Gauge: số giữa tràn và đè nhãn trục; nay số dài rút gọn (12,6 tỷ), cỡ 20px, đặt giữa, 5 nhãn trục. (3) Lọc chéo cột < 1px: `barMinHeight/barMinWidth: 4` cho chuỗi cột không có số 0 (số 0 vẫn phẳng); chỉ đổi hình vẽ. Chỉ biểu đồ cột/thanh nhiều chuỗi (`cartesianOption`); ranking, histogram chưa đổi.
- **Sửa nhỏ:** nút "Thêm dòng đầu tiên" ở bảng rỗng thành nút phụ; thẻ datahub bỏ chữ "Chưa có mô tả"; thanh bảng ở 375px xuống hai dòng (tab bảng cả dòng) nên "Bảng ▾" không bị cắt.
- **Spec sửa vì chỗ đổi:** `stage2c1` (Hoàn tác/Làm lại vào "•••", chọn dòng bằng chuột phải qua `clickMarker`, mở panel bằng `openMarker`), `stage4-1d` (chờ thanh công cụ trước khi bấm ô theo toạ độ), `stage4-7` (ô Vai trò là combobox, không còn `option` khi đóng: lỗi từ 12A, không do 12C).
- **Chưa làm / để sau:** menu chuột phải cho dòng; trình sửa công thức dạng ngăn kéo; ảnh 375px.

## 12D-1 Tổng quan và tuỳ chọn theo người (28/11)

- **Bảng `user_prefs`** (migration 0037): `(user_id, key)` khoá chính, `value jsonb`, `updated_at`. Đăng ký bảng có chủ (`registerOwnedTable`), mọi truy vấn qua `ownedBy`/dấu `/*scope*/`. Module server mới `apps/api/src/modules/home/index.ts`; tên lệnh `home.*`, quyền `system:whoami` (mọi người đăng nhập, chỉ thấy và ghi dòng của chính mình), `aiAllowed: false` và không có luật menu AI nên kết nối AI không gọi được (tuỳ chọn giao diện, AI không cần).
- **Khoá:** `home.dashboard_tabs` (mảng id dashboard của mình, tối đa 20, đúng thứ tự; ghi bằng `home.prefs.set`, mỗi id phải là dashboard của datahub mình sở hữu, nếu không `validation_error` `pin_not_own`; trùng id bị gộp) và `recent` (tối đa 20 mục `{type, id, at}`, chỉ máy chủ ghi, `home.prefs.get/set` từ chối khoá này). Đọc `home.tabs.list` và `home.recent.list` trả kèm tên và **lọc mục không còn mở được** bằng đúng hàm quyền của từng module (datahub `loadDatahubAccess`, form `loadOwnForm`, dashboard `viewDash`, bài Knowledge `loadPost`+`canReadLive`/tác giả/người duyệt); không lọc thì mất quyền vẫn lộ tên.
- **Ghi "mở gần đây" ở máy chủ, khi đọc chi tiết** (chọn cách này sau khi thử lệnh "ghi mở" riêng từ web: mỗi lần điều hướng nhanh làm POST đó bị trình duyệt cắt, Playwright báo `requestfailed ERR_ABORTED` ở cả stage1, stage3c1; sửa bộ kiểm lỗi chung của e2e cho riêng nó bị từ chối, nên bỏ lệnh đó): `noteOpened(ctx, type, id)` ở `apps/api/src/modules/home/recent.ts`, gọi trong lệnh đọc chi tiết sau khi đã kiểm quyền: `datahub.datahub.get`, `form.form.get`, `metrics.dashboard.get` và `metrics.dashboard.view`, `knowledge.article.get`. Không thêm yêu cầu nào từ trang. Chỉ ghi khi kênh là `web` (AI hoặc API đọc không tính là người mở). Cùng mục đang đứng đầu danh sách trong 60 giây thì không ghi lại (trang đọc lại dữ liệu thường xuyên). Ghi bằng MỘT câu SQL (`INSERT ... ON CONFLICT DO UPDATE`, đẩy mục mới lên đầu, bỏ bản cũ của cùng mục, cắt 20) nên hai tab không ghi đè nhau. `metrics.dashboard.view` có tham số `recent=0` cho phần xem trước (tab ghim ở Tổng quan không tính là mở). Mở dashboard trong datahub ghi cả datahub lẫn dashboard (hai lệnh đọc), chấp nhận. Chưa ghi: bài AI Hub, Quản lý Deal.
- **Lệnh khác:** `home.dashboards.mine` (dashboard của mình ở mọi datahub mình sở hữu, để chọn ghim). Danh sách đầy đủ: Bruno `docs/api/bruno/home/`.
- **Trang Tổng quan** (`apps/web/src/pages/home.tsx`, khu tab `home-tabs.tsx`, cột phải `home-side.tsx`): h1 `sr-only` giữ "Xin chào, tên" (spec cũ dựa vào), một dòng chào theo giờ Việt Nam. Khu dashboard là một thẻ: tab "Được chia sẻ" (danh sách y như `/dashboard`, bấm mở ngay trong khu, địa chỉ `?tab=shared&open=<id>`) rồi các tab ghim, nút "Ghim dashboard" (popover liệt kê dashboard của mình chưa ghim; ở điện thoại chỉ icon). Tab mở mặc định: tab ghim đầu tiên, nếu chưa ghim thì "Được chia sẻ"; tab đang mở trên URL `?tab=`. Tab ghim dùng lại `DashboardView mode="viewer"` (cùng component 12C) trong khung nền chấm lưới, thêm hai prop `header` (tắt dòng "Của ... số liệu tính theo quyền họ", vì đây là dashboard của chính mình) và `recent` (false = gọi `view?recent=0`, không ghi "gần đây" khi chỉ xem trước). Sửa dashboard thì bấm "Mở dashboard" (sang trang datahub). Đổi thứ tự: kéo chuột (`@dnd-kit`, chỉ `MouseSensor` để thanh tab còn cuộn được bằng cảm ứng) hoặc menu "•••" của tab đang mở ("Chuyển sang trái/phải", "Bỏ ghim") cho bàn phím và điện thoại; ghi lên server ngay (hiện ngay bằng cache, lỗi thì tải lại và báo). Tab đang mở luôn cuộn vào tầm nhìn.
- **Cột phải:** "Onboarding của tôi" (chỉ khi có lộ trình đang chạy của chính mình: tuần x/y, thanh tiến độ 3px, số việc hôm nay còn, mốc kế tiếp, link "Mở hành trình"); "Mở gần đây" (6 mục, icon theo loại, "x phút trước"); "Nhắc hẹn sắp tới" (4 mục + "Tạo" mở Modal `ReminderForm`); "Thông báo chung" (mới nhất + "Xem tất cả"). Rỗng thì có chữ và nút/liên kết việc nên làm. Thẻ nhắc hẹn và thông báo chung ẩn với người không có `notification:manage`.
- **Bỏ "Dashboard chia sẻ" khỏi menu** (route `/dashboard`, `/dashboard/:id` giữ cho link cũ; breadcrumb "Tổng quan > Dashboard được chia sẻ"). **Thẻ tình trạng hệ thống** sang Cài đặt nhóm Quản trị: trang `/quan-tri/he-thong` ("Tình trạng hệ thống", quyền `system:setting:write`); bỏ route `/he-thong`.
- **Kiểm ảnh 12C (làm ở 12D-1):** KPI dashboard 44px đúng. Gauge: nhãn trục không đè số giữa, đúng. Thanh công cụ Datahub ở 1280px (khung nội dung ~990px) **chỉ hiện icon** vì nhãn chỉ hiện từ 64rem: sửa tận gốc ở `view-tools.tsx`: nhãn hiện từ 56rem (nút `!px-2.5` cố định) và ô tìm gấp thành icon kính lúp ở khoảng 58–72rem (mở rộng đè lên bên trái khi có focus hoặc có chữ, `placeholder` ẩn khi gấp), từ 72rem là ô đầy đủ 240px; thanh nằm đúng MỘT dòng. Bảng có cột ngày (thêm nút "Thời gian") ở 1280px có thể xuống hai dòng: chấp nhận.
- **Spec đổi:** `stage3c2` (đi tới danh sách chia sẻ qua tab "Được chia sẻ" của Tổng quan, không còn link menu). Spec mới `stage12d1` (4 luồng: lời chào và trạng thái rỗng, ghim và đổi thứ tự và đổi trình duyệt, mở gần đây, thẻ hệ thống ở Cài đặt).
- **Bàn giao cho 12D-2:** dashboard bento = `<div class="rounded-card border border-border-soft bg-workspace p-4 [background-image:radial-gradient(var(--border)_1px,transparent_1px)] [background-size:20px_20px]">` bọc `<DashboardView dashboardId=... mode="viewer" header={false} recent={false}>` (mẫu `PinnedPane` trong `home-tabs.tsx`; dashboard của Deals có `period`/`mature` như `apps/web/src/pages/deal/dashboard.tsx`). `mode="owner"` cần truyền `dh` (mẫu `DashboardArea`).

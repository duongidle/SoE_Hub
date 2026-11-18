Pain hiện tại:

- Tổng hợp chỉ số, dữ liệu, deal
- Tổng hợp kiến thức
- Kết nối claude

Idea:

- 1 HUB lớn để SoE tương tác với nhau
- Dùng API để tối ưu token cho claude cá nhân của user
- Có bảo mật
- Có function cho các session share cho sale
- Mục tiêu là 1 nhân sự nắm được nghiệp vụ nhanh chóng mà không cần tự research
- AI đóng góp vào việc push kiến thức lên, phân loại
- Bài học deal, cho AI tự học deal
- Sharing skill AI
- Check deal trước khi nhận com
  Check chỉ số hàng tháng (theo phân quyền)
  Kiến thức:
- Skil AI
- Use case (chia sẻ cho cả sale)
  Onboard:
- Làm thành 1 game
  Kết nối claude:
- Kết nối claude để xem chỉ số, tra cứu, share skill
  Dành cho sale:
- Sale newbie mới vào thấy 1 kho kiến thức chất lượng
  Account:
- Có phân quyền cho từng chức năng
- Khả năng mở rộng bộ chỉ số
- Chỉ số
  - Mỗi ngày vào biết deal nào mang lại doanh thu nhiều, deal nào phải về, lead
  - Xem được tỉ lệ Revenue, Winrate, Deal won
  - Xem được forecast
  - Ma trận ưu tiên: BANT chấm bằng tay, gắn tag cho deal, mỗi ngày đều phải vào tự chấm lại deal
  - Lead phải xem được Cr1 -> Cr4, Lead POD nhận/tháng, Lead PODe nhận
  - Trả lời được câu hỏi lý do gì để tôi được xin thêm deal
  - Achivement: KPI và Goal, Doanh thu chia theo từng loại (bao gồm PS w POD), %KPI theo quý, Winrate - Cycle (winrate phụ thuộc vào cycle vì deal có cycle quá dài thì winrate phải tính theo trung vị), Deal Cycle, Deal Size, xử lý được chỉ số cho cả các nhân sự nhận deal có outlier lớn (Thông thường nhận deal trong khoảng vài chục triệu đến vài tỉ, không đều)
  - Forecast: xem được pipeline đang mở, xem được KPI còn lại cần đạt, chia forecast theo từng quý. Một trong các mục đích của forecast là để xem cuối quý mình forecast có đúng không
  - Xem và đánh giá được workload
  - Cần có phương án chia deal Associate và Advisor vì nó không tính vào deal chính nhưng mà chỉ tính vào workload, không tính vào doanh thu
  - Có custom field tuỳ chỉnh để mọi người tự custom chỉ số muốn xem

1. Danh mục các file example:

Quản lý Deal SoE.xlsx: Mẫu chung để quản lý 1 deal của 1 nhân sự SoE, gồm:

- Data Validation, Deals, Index, Cumulative Index: Để quản lý deal cho 1 nhân sự SoE
- Các sheet BC Policy: Chính sách policy của sale, dùng để tính ra commission cho nhân sự SoE, trong đó ML là Marketing Lead và SH là Sale Hunt. Đây là phần cấp quản lý sẽ dùng để tính ra commission thực tế của SoE. Công thức tính cơ bản là Commission SoE = Commission sale _ 20%, Commission Sale = Policy _ Revenue. Chi tiết xem các file chính sách.
- Lưu ý chính sách là biến số có thể thay đổi, chỉ sử dụng làm cơ sở cho các công thức tính mặc định, không dùng làm hằng số cố định. Người dùng cấp quản trị có quyền chỉnh sửa công thức tính này, với các tham số tuỳ chỉnh dựa vào chính sách tại thời điểm đó.

Các file pdf: Chính sách tính đến thời điểm hiện tại của bộ phận SoE

Lộ trình Onboard Dương.xlsx: File mẫu quy trình onboard của 1 nhân sự mới bao gồm chi tiết việc cần làm, checkpoint, 1 sheet để điền bài thu hoạch onjob và 1 sheet để tự viết QnA

Có thể tham khảo thêm thư mục Base Inc - chính là workspace làm việc hiện tại của tôi - về các phần như kiến thức phần mềm, quản lý công việc, 1 nhân sự đang làm việc tại SoE team.

2. Các lưu ý:

- Mỗi nhân sự SoE có 1 cách thức làm việc và quản lý công việc khác nhau, chỉ gần giống nhau ở phần quản lý số liệu (ví dụ tôi dùng clickup nhưng nhân sự khác có thể dùng ticktick, và hiện tại mỗi nhân sự đang quản lý công việc bằng 1 ggsheet custom riêng).
- Khung xương làm việc giống nhau: Quản lý số liệu - Xem biểu đồ - Thống kê/forecast - Kiểm tra commission
- Cấp quản lý trở lên có quyền tuỳ chỉnh các thông tin liên quan đến chính sách/công thức tính toán (chi tiết ở phần phân quyền)
- Phần mềm hỗ trợ quản lý theo khung xương chung, tạo 1 nền tảng làm việc thống nhất (thay vì hiện tại mỗi nhân sự phải tự quản lý bằng những cách khác nhau như excel, ggsheets)
- Tạo kết nối giữa quản lý và cấp nhân sự, quản lý có thể theo dõi theo thời gian thực trạng thái của các nhân sự
- Tạo nền tảng chia sẻ kiến thức, thông tin giữa các nhân sự với nhau
- Thực hiện các chức năng ngoài phòng ban (Hub chia sẻ kiến thức cho bộ phận kinh doanh)
- Thực hiện được hành động onboard cho 1 nhân sự mới
- Đảm bảo bảo mật (các bộ phận khác không có tài khoản không truy cập được, không thể can thiệp vào hệ thống bằng bất cứ cách nào như dùng AI chạy scripts trình duyệt. Chỉ có 1 cách duy nhất là được cấp API key để gọi dữ liệu hệ thống 2 chiều và mcp để AI điều khiển với điều kiện AI phải được cấp quyền MCP)
- Các phần còn thiếu mà tôi chưa liệt kê được
- API đầy đủ
- dữ liệu dạng json đảm bảo dễ dùng để có thể thao tác qua json luôn

3. Chức năng Phân quyền và bảo mật

- 3 cấp user: Manager, Leader, User, Guests
- Manager chiếm quyền điều khiển cao nhất, Leader dưới quyền manager, User là nhân sự SoE thông thường và Guest là tài khoản khách - chỉ xem
- Có API để đưa dữ liệu ra hoặc đưa dữ liệu vào, API cần key để gọi, có MCP cấp quyền cho AI điều khiển
- Tất cả các trường hợp không có quyền truy cập hợp lệ vào hệ thống sẽ không cào được dữ liệu ra bằng bất cứ cách nào (như dùng AI để gọi scripts)
- User xem được deal của chính mình, được upload knowledge và skill AI nhưng không có quyền duyệt xuất bản
- Manager xem được tất cả mọi thứ của tất cả mọi user, có quyền duyệt xuất bản các nội dung đăng tải lên, có quyền đăng tải bỏ qua bước duyệt
- Leader xem được tất cả mọi thứ của các user dưới quyền (ví dụ Khuê Võ được phân quyền leader và là leader của Dương Trần và Linh Nguyễn sẽ xem được deal và chỉ số của cả Dương Trần và Linh Nguyễn)
- User có quyền xem, cập nhật các chỉ số trạng thái của chính mình và dùng các chức năng khác trên hệ thống
- Guest được cấp quyền tối thiểu để truy cập vào và lấy ra các dữ liệu được cho phép (thông qua tải trực tiếp hoặc API) hoặc để xem chức năng Knowledge
- Thêm 1 phân quyền Admin là quản lý hệ thống, cho phép cài đặt các giới hạn hệ thống và xem được toàn bộ những gì Manager xem được
- 1 user có thể có nhiều hơn 1 phân quyền (ví dụ manager có thể cho phép thêm phân quyền admin để mang cả 2 phân quyền manager và admin)
- Các phần còn thiếu mà tôi chưa liệt kê được
- Người dùng được đổi mật khẩu/quên mật khẩu

4. Chức năng Datahub

- Hệ thống tổ chức cho người dùng quản lý dữ liệu bằng Datahub.
- 1 user có quyền tạo nhiều Datahub
- Quản lý hệ thống (Admin) có quyền cài đặt giới hạn được tạo datahub của user
- Mặc định ban đầu 1 user được tạo tối đa 5 datahub
- Mặc định ban đầu có 1 datahub bắt buộc khi tạo tài khoản mới là Deals để quản lý Deal, datahub Deals này không xoá được, không đổi tên hay sửa được, không xoá bớt cột được, các cột ban đầu sinh ra mặc định, không đổi tên cột được, chỉ có thể tạo thêm cột custom field mới
- Các datahub khác có thể tuỳ chỉnh như 1 bảng google sheet, không bị giới hạn như bảng mặc định Deals
- Tất cả Datahub có thể xem được trong menu Datahub
- Trong mỗi datahub, người dùng có thể dùng chức năng Dashboard -> Tạo biểu đồ tuỳ chỉnh từ các cột dữ liệu trong bảng Datahub
- 1 datahub có thể có nhiều bảng như 1 file google sheet có nhiều sheet.
- Số bảng được tạo trong datahub cũng có giới hạn, mặc định là 10 bảng cho mỗi datahub, Admin có thể mở ra thêm giới hạn cho từng tài khoản
- Datahub quản lý deal sẽ không cho phép tạo thêm bảng mới
- Datahub sinh ra để không cần đến custom field. Người dùng chỉ đơn giản là tạo 1 cột mới và cột đó sẽ hiển thị/lưu dữ liệu người dùng nhập vào hoặc tự tính (công thức) và hiển thị/lưu dữ liệu người dùng đã tạo
- Bản chất hệ thống hoạt động trên datahub, bất kỳ 1 API nào gọi đến hoặc mang đi đều là call dữ liệu từ/tới Datahub A - Bảng 1 của User X ra
- Datahub phải cho API gọi 2 chiều và phải luôn cung cấp đủ tính năng 2 chiều (cập nhật/sửa/xoá/tạo mới)
- Sau này nếu muốn xuất dữ liệu của 1 user (ví dụ xuất toàn bộ danh sách deal và chỉ số hiện tại của Linh Nguyễn) thì phải xuất đơn giản, có thể từ giao diện, từ API hoặc bằng 1 lệnh SQL ngắn gọn
- Datahub không giới hạn số dòng
- Mỗi dòng trong datahub có 1 id riêng để sau này dễ truy vấn
- Datahub nhằm đảm bảo khả năng mở rộng, nếu sau này có update thêm 1 loại chỉ số mới hoặc thay đổi bảng chỉ số theo dõi thì chỉ đơn giản là thay đổi form và công thức cột của datahub
- Admin có quyền thay đổi template mặc định của datahub deals
- Datahub chính là module lõi của hệ thống và là cơ sở để phát triển toàn bộ các tính năng sau này
- Các phần còn thiếu mà tôi chưa liệt kê được

5. Chức năng Dashboard

- Mỗi datahub có thể vẽ ra Dashboard, Dashboard này có thể lấy dữ liệu từ một bảng hoặc nhiều bảng trong cùng datahub (yêu cầu người dùng phải chọn unique key giữa các bảng - không có unique hoặc unique không khớp sẽ vẽ ra biểu đồ rỗng)
- Riêng với Quản lý deal thì dashboard sẽ mặc định, người dùng có thể tạo thêm dashboard tuỳ chỉnh riêng nhưng không thay thế dashboard mặc định
- Dashboard có sẵn các loại biểu đồ để chọn, option hiển thị các tag trên biểu đồ
- Cứ Freestyle các loại biểu đồ nhé claude, tôi chưa có ý tưởng về các loại biểu đồ
- Các phần còn thiếu mà tôi chưa liệt kê được

6. Chức năng Quản lý deal

- Xem và cập nhật được danh sách deal hiện tại
- Xem được chỉ số, báo cáo, forecast (dashboard deal)
- Có thể tạo cột mới có nhiều kiểu định dạng dữ liệu, trong đó có kiểu công thức cho phép cài công thức từ các cột có sẵn trong bảng
- Trang xem deal là datahub mặc định ban đầu cho tất cả user, không xoá được, tên là Deals, không đổi tên được, không xoá bớt cột được, không đổi tên cột được, các cột ban đầu sinh ra mặc định, chỉ có thể tạo thêm cột
- Trang xem chỉ số gọi là Dashboard Deals, trang này vẽ ra chỉ số từ datahub Deals hiện tại của đúng user đó, có tạo được các biểu đồ tuỳ chỉnh (cho phép chọn các dữ liệu sẽ truyền vào) ngoài các biểu đồ mặc định có sẵn bắt buộc
- Tất cả các trang nằm gọn trong menu chức năng Quản lý Deal
- Hiểu đơn giản là Quản lý Deals sẽ có 1 bảng thống kê deal riêng, bảng này bản chất là datahub nhưng nó là bảng mặc định và đặc thù, dashboard của nó cũng là dashboard mặc định đặc thù
- sau này sẽ phát triển thêm các chức năng dành cho quản lý trong phần Quản lý Deal, ví dụ lên plan deal, ... cứ chừa chỗ lại để sau này thêm vào sau
- Các phần còn thiếu mà tôi chưa liệt kê được

7. Chức năng Dynamic Form

- Cho phép tạo form dựa vào cách kéo thả các đối tượng (giống hệt lark form).
- Bản chất chức năng là để tạo các form quảng bá - giới thiệu - khảo sát
- Các trường trên form được link với Bảng trong Datahub (user cần chọn trong quá trình làm form)
- Form hỗ trợ chia cột, thao tác đơn giản, làm như landing page, form tạo ra có thể truy cập từ điện thoại hoặc máy tính, giao diện form làm xong giống 1 landing page
- Form có tuỳ chọn chia sẻ công khai hoặc chọn tài khoản
- Đầy đủ các chức năng text style các thứ, kéo thả mượt mà, tự động lưu
- 1 user được tạo không giới hạn số form
- Dynamic Form phải được xây dựng để có thể làm ra được cả 1 bài test/1 bài khảo sát dài/1 bài kiểm tra dài
- Dynamic Form cho người đuợc khảo sát lưu dữ liệu khi họ đang điền dở
- Dynamic Form phải có thể cấu hình dạng json để export/import/AI bên ngoài setup
- Dynamic Form không thể kết nối hoặc chọn datahub deal mặc định làm nơi chứa dữ liệu
- Các phần còn thiếu mà tôi chưa liệt kê được

8. Onboarding

- Onboarding là chức năng để nhân sự mới làm quen với Base và nắm vững kiến thức phần mới, nghiệp vụ trước khi trở thành chính thức
- Onboarding phải có lộ trình từng bước/lịch biểu chi tiết các việc cần làm, các bài test
- Onboarding quản lý việc onboard cho nhân sự mới theo các template onboard vì mỗi nhân sự sẽ có 1 lộ trình onboard khác nhau. Nguyên tắc là Leader và Manager sẽ tạo lộ trình onboard và gắn lộ trình onboard cho tài khoản nhân sự. Chỉ nhân sự có lộ trình onboard mới nhìn thấy menu/giao diện onboard và truy cập được vào onboard. Leader và manager ai cũng có quyền tạo lộ trình onboard. Không giới hạn lộ trình onboard được tạo. Manager và Leader Truy cập menu Onboarding sẽ thấy các lộ trình onboard đã tạo, các nhân sự hiện tại đang được gắn và các nhân sự đang được theo dõi. Manager có thể thấy mọi lộ trình onboard. Các user và leader sẽ thấy menu onboarding và lộ trình onboard nếu được gắn là người theo dõi. Chỉ leader trực tiếp và manager trong lộ trình onboard được sửa lộ trình onboard đó. Các leader khác nếu thấy lộ trình hay có thể nhân bản làm lộ trình mình đang theo dõi làm lộ trình mới riêng và custom lại.
- Template onboard ngoài lịch hôm nay cần làm gì và các checklist trong ngày, còn cần các bài test. Các bài test sẽ được thiết kế bằng Dynamic Form, gắn vào lộ trình onboard
- Các việc hoàn thành hay chưa và checklist khi được tick cần được thông báo cho leader trực tiếp (nghĩa là chức năng này cần phải đảm bảo thông báo đầy đủ)
- Tạo sẵn 1 template mẫu trong menu onboarding dựa vào template lộ trình onboard của Dương cho mọi tài khoản Manager và Leader
- Các phần còn thiếu mà tôi chưa liệt kê được

11. Knowledge

- 1 thư viện để lưu trữ các kiến thức về phần mềm và nghiệp vụ.
- Ban đầu nơi đây sẽ trống rỗng nhưng mọi người sẽ đăng tải dần lên dạng bài viết (khi đăng lên sẽ cần chờ phê duyệt, danh sách người được quyền phê duyệt sẽ được manager/admin lựa chọn trong cài đặt phân quyền)
- Có sẵn đầy đủ công cụ tìm kiếm
- Nội dung hiển thị đẹp, hiện đại, trực quan, hấp dẫn
- Có bộ lọc Knowledge ứng dụng Base hoặc Knowledge nghiệp vụ
- Tôi chưa có ý tưởng cụ thể, cứ freestyle
- Các phần còn thiếu mà tôi chưa liệt kê được

13. AI Hub

- Nơi lưu trữ, tìm kiếm các skill AI do nội bộ đăng lên (khi đăng lên sẽ cần chờ phê duyệt, danh sách người được quyền phê duyệt sẽ được manager/admin lựa chọn trong cài đặt phân quyền)
- AI của user (ví dụ claude desktop) có thể truy cập vào để đăng skill lên. Khi đăng skill lên hệ thống sẽ yêu cầu AI kiểm tra xem skill trước khi đăng lên đã đủ chuẩn hay chưa. Nếu đủ chuẩn đáp ứng thì mới được đăng lên
- Tôi chưa thiết kế ra được chuẩn nhưng đại loại là không được trùng với skill đã có, không được quá cá nhân hoá như là skill có hard các đường dẫn của máy user. Skill mà khi cài vào sẽ đáp ứng được cho nhiều máy của nhiều user khác thì là chuẩn. Có thể tự research skill tạo skill để biết chuẩn.
- Tôi chưa có ý tưởng cụ thể, cứ freestyle
- Các phần còn thiếu mà tôi chưa liệt kê được

15. Chuông thông báo

- Chức năng thông báo, nhắc hẹn, nhắc hạn
- Các phần còn thiếu mà tôi chưa liệt kê được

14. Workspace

- Quản lý có thể phân việc cho nhân viên, như 1 ứng dụng tasks thông thường nhưng chuyên nghiệp, trực quan, dễ dùng, đầy đủ chức năng
- nhân viên có đủ chức năng và cơ chế để được nhắc việc, phản hồi công việc
- Các phần còn thiếu mà tôi chưa liệt kê được

15. Dấu hỏi

- Bấm vào để điền feedback ứng dụng/yêu cầu tính năng
- Các phần còn thiếu mà tôi chưa liệt kê được

16. Cài đặt

- Đổi mật khẩu
- Các setting cần thiết để AI của user được phép kết nối với ứng dụng
- Admin có thêm các thiết lập giới hạn và xem/phản hồi feedback/yêu cầu tính năng
- Các phần còn thiếu mà tôi chưa liệt kê được

17. Giao diện

- Trực quan, dễ thao tác là ưu tiên
- Đọc skill giao diện để nắm các chuẩn giao diện cần thiết/tối thiểu phải có
- Font chữ thống nhất, tương phản, sizing và các tiêu chuẩn thiết kế chuẩn production
- Cách dùng từ ngữ/wording/câu cú gãy gọn, dễ hiểu, không thêm các câu dài dòng giọng AI
- Văn phong trong ứng dụng phải chuẩn production

18. Khả năng kết nối với AI

- User hiện tại thường hay sử dụng claude desktop hoặc claude code.
- Các ứng dụng này sẽ có thể kết nối với SoE Hub qua bộ API hoặc bằng phương thức (có thể MCP hoặc không cần) tuỳ cách bạn thiết kế. Tư vấn lại cho tôi về lựa chọn này
- Mục tiêu là AI của người dùng kết nối vào để làm được các thao tác như điều chỉnh số liệu, tạo Datahub, tạo Dynamic Form, ... Trừ onboarding
- Nếu được tôi muốn admin quản lý được AI nào đang được quyền kết nối với SoE Hub, để những AI khác kể cả có tài liệu API cũng không kết nối được.
- Nếu được tôi muốn admin quản lý được AI được phép kết nối với các menu nào, ví dụ không cho kết nối với onboarding thì AI không được kết nối với Onboarding để làm những thứ như tạo template hoặc làm bài thi hoặc tự điền checklist
- Tôi chưa có ý tưởng cụ thể, cứ freestyle
- Các phần còn thiếu mà tôi chưa liệt kê được

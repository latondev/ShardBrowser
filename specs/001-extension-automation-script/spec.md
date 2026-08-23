# Feature Specification: Extension Automation Script for ShardBrowser

**Feature Branch**: `001-extension-automation-script`

**Created**: 2026-08-23

**Status**: Draft

**Input**: User description: "Tôi cần xây dựng bộ automation script đặt trong thư mục `Testing/flow/` để tự động hóa tương tác giữa **ShardBrowser** và Chrome Extension."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Khởi động Profile và kết nối extension (Priority: P1)

Người dùng cần khởi động một Profile trên ShardBrowser và tự động nạp extension từ thư mục chỉ định, sau đó kết nối script automation tới phiên trình duyệt đang chạy.

**Why this priority**: Đây là bước nền tảng, không thể thực hiện bất kỳ thao tác nào khác nếu không có kết nối.

**Independent Test**: Có thể kiểm tra bằng cách chạy script và xác nhận rằng trình duyệt mở ra với extension đã được tải và script kết nối thành công qua CDP.

**Acceptance Scenarios**:

1. **Given** thư mục extension tồn tại và ShardBrowser đã cài đặt, **When** script chạy, **Then** trình duyệt mở với extension được tải và script báo kết nối thành công.
2. **Given** thư mục extension không tồn tại, **When** script chạy, **Then** script báo lỗi và dừng với thông báo rõ ràng.

---

### User Story 2 - Điều hướng và kích hoạt extension (Priority: P2)

Người dùng cần điều hướng trình duyệt đến trang web đích và mở giao diện extension (popup, side panel hoặc injected UI).

**Why this priority**: Sau khi kết nối, cần điều hướng đến trang cần tương tác và kích hoạt extension để chuẩn bị cho các thao tác tiếp theo.

**Independent Test**: Có thể kiểm tra bằng cách chạy script, xác nhận trình duyệt chuyển đến URL đích và extension hiển thị.

**Acceptance Scenarios**:

1. **Given** trình duyệt đã kết nối và extension đã tải, **When** script điều hướng đến URL đích, **Then** trang web tải thành công và extension có thể được mở.
2. **Given** URL không hợp lệ, **When** script điều hướng, **Then** script báo lỗi timeout và tiếp tục xử lý ngoại lệ.

---

### User Story 3 - Thao tác Form tự động (Priority: P3)

Người dùng cần nhập dữ liệu vào form của extension (startIndex, prompt, chọn dropdown/checkbox) và click nút khởi chạy.

**Why this priority**: Đây là chức năng chính của automation, nhưng phụ thuộc vào các bước trước.

**Independent Test**: Có thể kiểm tra bằng cách chạy script với dữ liệu đầu vào mẫu và xác nhận form được điền và click thành công.

**Acceptance Scenarios**:

1. **Given** extension đang mở, **When** script nhập startIndex=1 và prompt="Test prompt", chọn option mặc định, click Start, **Then** form được gửi và extension bắt đầu xử lý.
2. **Given** thiếu một trường bắt buộc, **When** script click Start, **Then** extension hiển thị lỗi và script ghi log lỗi.

---

### User Story 4 - Theo dõi log và xử lý ngoại lệ (Priority: P4)

Người dùng cần theo dõi log trạng thái thực thi từ extension/console và xử lý các ngoại lệ (timeout, selector not found, mất kết nối).

**Why this priority**: Quan trọng để đảm bảo script chạy ổn định và cung cấp thông tin debug.

**Independent Test**: Có thể kiểm tra bằng cách mô phỏng các lỗi (ví dụ selector sai) và xác nhận script ghi log và xử lý graceful.

**Acceptance Scenarios**:

1. **Given** script đang chạy, **When** xảy ra lỗi timeout, **Then** script ghi log lỗi và dừng an toàn.
2. **Given** script đang chạy, **When** kết nối CDP bị ngắt, **Then** script ghi log và thoát với mã lỗi.

---

### Edge Cases

- ShardBrowser chưa được cài đặt hoặc đường dẫn sai.
- Extension chưa được build hoặc thiếu file manifest.
- Trang web đích không tải được do network.
- Extension UI thay đổi selector sau khi cập nhật.
- Nhiều instance script chạy cùng lúc gây xung đột port.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Script MUST khởi động một Profile của ShardBrowser với extension được nạp từ đường dẫn `F:\ToolAllvideo\Extension\flow-automation-auto-flow`.
- **FR-002**: Script MUST kết nối tới trình duyệt qua remote debugging port / CDP.
- **FR-003**: Script MUST điều hướng đến trang web đích (URL được cấu hình).
- **FR-004**: Script MUST mở giao diện extension (popup/side panel/injected UI).
- **FR-005**: Script MUST nhập tham số `startIndex` và `prompt` từ file cấu hình hoặc tham số dòng lệnh.
- **FR-006**: Script MUST chọn các tùy chọn dropdown/checkbox theo cấu hình.
- **FR-007**: Script MUST click nút khởi chạy (Start/Run Flow).
- **FR-008**: Script MUST ghi log tất cả các bước thực thi và lỗi.
- **FR-009**: Script MUST xử lý timeout (mặc định 30 giây) và báo lỗi rõ ràng.
- **FR-010**: Script MUST xử lý trường hợp không tìm thấy selector và ghi log.
- **FR-011**: Script MUST hỗ trợ cấu hình đầu vào qua file JSON.
- **FR-012**: Script MUST có thể chạy độc lập bằng lệnh npm/node.

### Key Entities

- **TestConfig**: Cấu hình đầu vào bao gồm `startIndex`, `prompt`, `url`, `options` (dropdown/checkbox).
- **BrowserSession**: Đại diện cho phiên trình duyệt đang chạy, chứa thông tin kết nối CDP.
- **ExtensionUI**: Đại diện cho giao diện extension và các selector cần tương tác.
- **LogEntry**: Ghi lại trạng thái, thời gian, loại log (info, error, debug).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Script khởi động và kết nối thành công trong vòng 10 giây.
- **SC-002**: Thao tác điều hướng và mở extension hoàn thành trong vòng 5 giây.
- **SC-003**: Toàn bộ quy trình (khởi động + điền form + click) hoàn thành dưới 30 giây.
- **SC-004**: Script ghi log đầy đủ cho mọi bước thực thi với mức độ chi tiết có thể cấu hình.
- **SC-005**: Tỷ lệ thành công của các lần chạy tự động đạt 95% trong điều kiện mạng ổn định.
- **SC-006**: Người dùng có thể cấu hình đầu vào chỉ bằng file JSON mà không cần sửa script.

## Assumptions

- ShardBrowser đã được cài đặt và có thể chạy từ dòng lệnh.
- Extension đã được build sẵn và có file manifest hợp lệ.
- Trang web đích có thể truy cập được.
- Script chạy trong môi trường Node.js với Puppeteer/Playwright hoặc CDP client.
- User có quyền truy cập vào thư mục extension và ghi log.
- Port debugging mặc định của ShardBrowser là 9222 (hoặc được cấu hình).
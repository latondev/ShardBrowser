# DataDome Anti-Bot Mechanism - Technical Research Notes

## 1. Tổng quan

DataDome là một nền tảng Bot Management / Anti-Bot dùng để phát hiện,
phân loại và xử lý traffic tự động (bot traffic) trước khi request tới
hệ thống ứng dụng.

Mục tiêu chính:

-   Phân biệt người dùng thật và automation.
-   Giảm scraping trái phép.
-   Bảo vệ login, payment, API, inventory và nội dung nhạy cảm.
-   Giảm fraud và abuse.

DataDome không dựa vào một tín hiệu duy nhất. Nó kết hợp nhiều lớp:

-   Network fingerprint.
-   TLS fingerprint.
-   HTTP fingerprint.
-   Browser fingerprint.
-   Device fingerprint.
-   Behavioral signals.
-   Reputation data.
-   Machine learning detection.

------------------------------------------------------------------------

# 2. Kiến trúc tổng thể

Luồng tổng quát:

    User / Bot
        |
        v
    Browser / Application
        |
        v
    CDN / Reverse Proxy / Load Balancer
        |
        v
    DataDome Detection Layer
        |
        +----------------+
        |                |
      Allow          Challenge
        |                |
        v                v
    Application     Device Check
                        |
                        v
                     CAPTCHA
                        |
                        v
                      Block

DataDome thường được đặt ở lớp trước ứng dụng để đánh giá request trước
khi backend xử lý.

------------------------------------------------------------------------

# 3. Server-side Detection

## 3.1 IP Reputation

DataDome phân tích các yếu tố liên quan đến mạng:

-   IP reputation.
-   ASN.
-   Datacenter IP.
-   Proxy.
-   Residential proxy.
-   Traffic history.

Quan trọng:

    Proxy != Bot

Một proxy chỉ là một tín hiệu. Quyết định thường dựa trên nhiều tín hiệu
kết hợp.

------------------------------------------------------------------------

# 4. TLS Fingerprinting

Trước khi gửi HTTP request, client thực hiện TLS handshake.

Ví dụ:

    Client
     |
     | ClientHello
     |
     v
    Server

TLS fingerprint có thể dựa trên:

-   TLS version.
-   Cipher suites.
-   Extensions.
-   Supported groups.
-   Signature algorithms.
-   Extension order.

Các kỹ thuật phổ biến:

-   JA3 fingerprint.
-   JA4 fingerprint.

Ý tưởng:

Một browser thật thường có TLS behavior nhất quán.

Ví dụ:

    User-Agent:
    Chrome Windows

    TLS:
    không giống Chrome

Có thể tạo ra sự bất thường.

------------------------------------------------------------------------

# 5. HTTP Fingerprinting

DataDome có thể phân tích:

-   HTTP headers.
-   Header order.
-   User-Agent.
-   Client hints.
-   Request pattern.

Ví dụ browser thật:

    User-Agent
    Accept
    Accept-Language
    Sec-Fetch-*
    Sec-CH-UA
    Encoding

Một HTTP client đơn giản có thể thiếu nhiều thành phần.

Điểm quan trọng:

Không phải kiểm tra một header.

Mà là kiểm tra tính nhất quán:

    Browser identity
            |
            +-- HTTP
            +-- TLS
            +-- JavaScript
            +-- Behavior

------------------------------------------------------------------------

# 6. JavaScript Tag

DataDome sử dụng JavaScript Tag chạy trong browser.

Vai trò:

-   Thu thập browser signals.
-   Kiểm tra môi trường client.
-   Bổ sung dữ liệu cho detection engine.

Các nhóm tín hiệu:

## Browser

-   Browser properties.
-   Web APIs.
-   Built-in functions.

## Device

-   Operating system.
-   GPU information.
-   Environment characteristics.

## Behavior

-   Mouse movement.
-   Keyboard interaction.
-   Navigation behavior.

------------------------------------------------------------------------

# 7. Browser Fingerprinting

Anti-bot hiện đại không chỉ kiểm tra:

    navigator.webdriver

Mà kiểm tra nhiều lớp:

    Browser
     |
     +-- Navigator properties
     |
     +-- JavaScript APIs
     |
     +-- Prototype behavior
     |
     +-- Web APIs
     |
     +-- GPU
     |
     +-- Execution environment

Mục tiêu:

Xác định môi trường có giống browser thật hay không.

------------------------------------------------------------------------

# 8. Behavioral Detection

Behavioral detection phân tích cách client tương tác.

Ví dụ:

Người dùng:

    Open page
    (wait)
    Scroll
    (click)
    Read content
    Navigate

Automation:

    GET page1
    GET page2
    GET page3
    GET page4
    trong thời gian rất ngắn

Các tín hiệu:

-   Request frequency.
-   Navigation sequence.
-   Login attempts.
-   Timing pattern.
-   Interaction pattern.

------------------------------------------------------------------------

# 9. datadome Cookie

Cookie:

    datadome=xxxxx

Vai trò:

-   Session identifier.
-   Client continuity.
-   Detection context.

Không nên hiểu:

    Có cookie = human
    Không cookie = bot

Mà nên hiểu:

    Cookie
    +
    Browser signals
    +
    Network signals
    +
    History
    =
    Decision

Cookie chỉ là một phần trong hệ thống.

------------------------------------------------------------------------

# 10. Device Check

Device Check là bước kiểm tra tự động.

Luồng:

    Suspicious request

            |
            v

    Device Check

            |
            v

    Environment verification

            |
            +---- Allow
            |
            +---- CAPTCHA
            |
            +---- Block

Device Check có thể:

-   Kiểm tra browser environment.
-   Thu thập device signals.
-   Thực hiện các checkpoint.

Nó thường xuất hiện khi hệ thống chưa đủ chắc chắn để allow hoặc block.

------------------------------------------------------------------------

# 11. CAPTCHA

CAPTCHA không phải detection engine.

Luồng đúng:

    Detection Engine

            |
            v

    Risk cao

            |
            v

    CAPTCHA

CAPTCHA là một response action.

------------------------------------------------------------------------

# 12. Decision Engine

DataDome không công khai công thức scoring.

Có thể mô hình hóa:

    Request

     |
     v

    Feature Extraction

     |
     +-- Network
     +-- TLS
     +-- HTTP
     +-- Browser
     +-- Device
     +-- Behavior
     +-- Reputation

     |
     v

    Detection Models

     |
     v

    Policy Engine

     |
     +-- Allow
     +-- Device Check
     +-- CAPTCHA
     +-- Block

------------------------------------------------------------------------

# 13. Khái niệm quan trọng: Consistency

Anti-bot hiện đại tập trung vào tính nhất quán.

Ví dụ:

Khai báo:

    Chrome Windows

Nhưng:

    TLS không giống Chrome
    Browser API bất thường
    Device không phù hợp
    Behavior bất thường

=\> độ tin cậy giảm.

------------------------------------------------------------------------

# 14. Quan sát DataDome bằng Chrome DevTools

Mở:

    F12
     -> Network
     -> Reload

Tìm:

    datadome
    tags.js
    api-js
    captcha-delivery

Các thành phần:

## tags.js

Browser-side collection.

## api-js

Gửi browser signals.

## datadome cookie

Client/session continuity và một đầu vào cho cả server-side detection lẫn
client-side detection. Cookie không phải bằng chứng độc lập rằng client là
human.

## captcha delivery

Challenge interface.

------------------------------------------------------------------------

# 15. Protection API và luồng server-side chi tiết

Với custom integration, một component ở phía server như CDN, load balancer
hoặc application server gửi metadata của request tới Protection API của
DataDome. API trả về quyết định allow hoặc challenge; backend không nên xử lý
request trước khi quyết định này được áp dụng.

Luồng tổng quát:

    Client request
        |
        v
    CDN / Load Balancer / Backend module
        |
        +--> POST /validate-request/ tới DataDome
        |
        +<-- quyết định + enriched headers
        |
        +--> 200: forward tới origin
        |
        +--> khác 200: trả challenge/block, không gọi origin

Các quy tắc integration cần lưu ý:

-   `X-DataDomeResponse: 200` biểu thị allow; status khác 200 cần được xử lý
    theo challenge/block response mà DataDome trả về.
-   Nếu header quyết định bị thiếu do lỗi dịch vụ, integration có thể dùng
    fail-open theo tài liệu API để duy trì service continuity. Đây là trade-off
    giữa availability và protection, cần được ghi log và giám sát.
-   `X-DataDome-request-headers` là danh sách header cần chuyển tiếp vào
    origin; `X-DataDome-headers` là danh sách header cần chuyển tiếp cho client.
    Không được gửi các pointer headers này trực tiếp cho end user.
-   `ClientID` có thứ tự ưu tiên: `X-DataDome-ClientID` trước, sau đó mới tới
    giá trị cookie `datadome`.
-   JA3/JA4 là dữ liệu được DataDome khuyến nghị thu thập khi integration có
    khả năng cung cấp, không nên mô tả là tín hiệu duy nhất hoặc bắt buộc trong
    mọi triển khai.

Tham khảo: [Protection API](https://docs.datadome.co/reference/validate-request).

------------------------------------------------------------------------

# 16. Cookie và dữ liệu lưu phía client

| Tên | Loại | Vai trò |
|---|---|---|
| `datadome` | Cookie | Được dùng trong server-side và client-side detection; dữ liệu được mã hóa và không chứa PII theo tài liệu công khai. |
| `dd_testcookie` | Cookie tạm thời | Kiểm tra context có thể lưu cookie hay không; không được lưu lâu dài. |
| `ddSession` | Local Storage | Bản sao của `datadome` khi bật `sessionByHeader`. |
| `ddOriginalReferrer` | Session Storage | Lưu referrer để khôi phục sau Device Check hoặc CAPTCHA. |

Không nên tự ý thêm `HttpOnly`, đổi `Domain`/`Path`, chặn hoặc xóa các dữ liệu
này trong lúc challenge đang hoạt động; các thay đổi đó có thể làm hỏng session
continuity hoặc việc hiển thị/replay challenge.

Tham khảo: [Cookies and stored data](https://docs.datadome.co/docs/cookie-session-storage).

------------------------------------------------------------------------

# 17. Device Check, Slider và Block

Device Check là một client-side verification không yêu cầu người dùng tương
tác. Nó phù hợp với trường hợp request đáng ngờ nhưng bằng chứng chưa đủ mạnh
để block hoặc hiển thị CAPTCHA ngay.

Device Check có thể kiểm tra các nhóm dữ liệu kỹ thuật như:

-   Screen và touch capabilities.
-   Browser type/version, plugins và media capabilities.
-   CPU/GPU.
-   Tính nhất quán của JavaScript functions, execution timing và rendering.

Điểm cần phân biệt:

-   JavaScript Tag có thể thu thập behavioral signals như mouse movement và
    keystrokes.
-   Device Check không dựa trên user interaction để phân tích behavior; nó
    tập trung vào client/device fingerprinting và automated checks.
-   Kết quả Device Check có thể là allow, chuyển tiếp sang Slider, hoặc block.

Do đó, sơ đồ `risk cao -> CAPTCHA -> block` trong phần trước chỉ là mô hình
đơn giản hóa. Response thực tế phụ thuộc detection model, endpoint và policy.

Tham khảo: [Device Check](https://docs.datadome.co/docs/device-check),
[Response pages](https://docs.datadome.co/docs/response-pages).

------------------------------------------------------------------------

# 18. Endpoint và policy

DataDome không chỉ đánh giá một request theo domain chung. Endpoint được phân
loại theo:

-   Traffic source: web browser, mobile app hoặc API.
-   Traffic usage: general, login, account creation, cart, payment, forms và
    RSS.
-   Detection: bật/tắt detection model.
-   Protection: allow, challenge/block hoặc sampling.

Các endpoint nhạy cảm như Login, Account Creation và Payment có thể dùng model
hoặc response policy khác General. Vì vậy khi phân tích false positive cần ghi
nhận ít nhất: endpoint, traffic source, traffic usage, response type, status
code và kết quả challenge.

Tham khảo: [Protection & Endpoints](https://docs.datadome.co/docs/endpoints).

------------------------------------------------------------------------

# 19. Mức độ bằng chứng của các nhận định

Nên gắn nhãn cho từng kết luận trong nghiên cứu:

| Nhãn | Ý nghĩa |
|---|---|
| Public documentation | Được DataDome mô tả trực tiếp trong tài liệu chính thức. |
| Observed behavior | Quan sát từ DevTools, log hoặc response trong một môi trường cụ thể. |
| Hypothesis | Suy luận chưa được xác nhận; không nên dùng làm rule cố định. |

Các nhận định như `event.isTrusted === false` luôn gây hard block, DataDome
luôn dùng `MutationObserver`, thời gian audio cố định, mouse Bézier hoặc một
profile có “trust score” cao nhất nên được xếp vào `Observed behavior` hoặc
`Hypothesis`, không ghi như đặc tính chính thức của DataDome.

Không nên suy ra rằng một header, cookie, User-Agent, IP proxy hoặc thao tác
chuột đơn lẻ sẽ quyết định kết quả. Tín hiệu quan trọng là correlation và
consistency giữa nhiều lớp.

------------------------------------------------------------------------

# 20. Checklist kiểm thử phòng thủ

-   Xác nhận server-side module áp dụng trên tất cả endpoint cần bảo vệ.
-   Xác nhận JavaScript Tag được tải đủ sớm trên các trang có request XHR/fetch
    được bảo vệ.
-   Kiểm tra `ajaxListenerPath`, CORS, credentials và việc replay request sau
    challenge.
-   Kiểm tra cookie `datadome` không bị middleware, privacy tool hoặc code ứng
    dụng sửa sai thuộc tính.
-   Ghi nhận response flow: allow, Device Check, Slider/CAPTCHA, block và
    discarded.
-   Kiểm tra fail-open có alert/metric riêng, tránh biến lỗi tích hợp thành
    lỗ hổng không được phát hiện.
-   Review các IP/partner hợp lệ bị bắt nhầm trước khi điều chỉnh allowlist.
-   Không dùng một quan sát từ một browser/profile làm kết luận phổ quát.

------------------------------------------------------------------------

# 21. Các lớp bảo vệ tổng hợp

                     REQUEST

                        |
                        v

                 Network Layer

                        |
                        v

                  TLS Layer

                        |
                        v

                 HTTP Layer

                        |
                        v

              Browser JavaScript Layer

                        |
                        v

               Behavioral Layer

                        |
                        v

              Machine Learning Models

                        |
                        v

                 Final Decision

------------------------------------------------------------------------

# 22. Kết luận nghiên cứu

Các điểm cần ghi nhớ:

1.  DataDome không có một "chìa khóa" duy nhất.
2.  Cookie không đại diện cho toàn bộ identity.
3.  User-Agent không đủ để xác định browser.
4.  Detection hiện đại dựa vào correlation nhiều tín hiệu.
5.  Tính nhất quán giữa các lớp là yếu tố quan trọng.
6.  Device Check, Slider/CAPTCHA và Block là các response khác nhau tùy policy;
    CAPTCHA không phải lúc nào cũng là bước cuối.
7.  Integration server-side phải xử lý decision header, enriched headers và
    fail-open một cách có kiểm soát.
8.  Các kết luận từ reverse engineering cần được tách khỏi tài liệu chính thức
    và kiểm chứng lại theo từng phiên bản, endpoint và môi trường.

------------------------------------------------------------------------

# Tài liệu tham khảo

-   DataDome Documentation:
    -   [Protection API](https://docs.datadome.co/reference/validate-request).
    -   [JavaScript Tag](https://docs.datadome.co/docs/javascript-tag).
    -   [Device Check](https://docs.datadome.co/docs/device-check).
    -   [Cookies and stored data](https://docs.datadome.co/docs/cookie-session-storage).
    -   [Protection & Endpoints](https://docs.datadome.co/docs/endpoints).
    -   [Response pages](https://docs.datadome.co/docs/response-pages).

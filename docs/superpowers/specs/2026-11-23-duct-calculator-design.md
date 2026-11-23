# Thiết kế: Phần mềm thiết kế phụ kiện ống gió SISCOM

Ngày: 2026-11-23 · Trạng thái: chờ anh Nam duyệt

## 1. Mục đích

SISCOM phát hành một công cụ miễn phí cho cộng đồng HVAC: nhập kích thước
phụ kiện ống gió chữ nhật, xem ngay mô hình 3D và ba hình chiếu có kích
thước, biết khối lượng tôn, và xuất bản vẽ dùng được trong AutoCAD.

Công cụ chạy ở ba nơi: trang web siscom.vn, app Android, app iOS.

## 2. Mục tiêu, ngoài phạm vi, điều phải tránh

**Mục tiêu**

- Dùng được trên điện thoại cũng tốt như trên máy tính.
- Nhiều người dùng miễn phí mà SISCOM không tốn chi phí máy chủ.
- Kích thước, diện tích và khối lượng tính ra phải đúng; bản vẽ DXF mở
  được trong AutoCAD với đúng tỉ lệ 1:1.
- Thêm một loại phụ kiện mới chỉ cần viết một tệp mô tả, không sửa các
  phần khác.

**Ngoài phạm vi của bản đầu** (làm ở các giai đoạn sau)

- Xuất khối 3D Solid (DXF 3D, ACIS .sat).
- Chế độ lắp ghép nhiều phụ kiện thành tuyến ống.
- Bản khai triển tôn để cắt.
- Bích, mí ghép, gân tăng cứng (bản đầu tính theo thân tôn trơn).
- Đăng nhập, đồng bộ giữa các máy.

**Điều phải tránh**

- Sao chép mã nguồn, hình ảnh hay tên gọi của trang tham khảo DU_DuctLab.
- App chỉ là trang web bọc lại (Apple sẽ từ chối): app phải chạy được khi
  không có mạng và lưu, chia sẻ được tệp.
- Thu thập dữ liệu cá nhân của người dùng.

## 3. Các cách đã cân nhắc

| Cách | Đánh đổi |
|---|---|
| **1. Một bộ mã web, đóng gói thành app bằng Capacitor** | Viết một lần cho cả ba nơi. Phải làm offline và lưu tệp tử tế để qua kiểm duyệt của Apple. |
| 2. Web riêng, app React Native riêng | App mượt hơn, nhưng 3D và bản vẽ phải viết hai lần. |
| 3. Flutter cho tất cả | App tốt, nhưng bản web nặng, 3D trên web yếu, khó nhúng vào siscom.vn. |

Anh Nam đã chọn **cách 1**.

## 4. Kiến trúc

Ứng dụng tĩnh, chạy hoàn toàn trên máy người dùng, không có máy chủ.

- **Công nghệ** (em chọn): TypeScript, React, Vite, Three.js cho 3D,
  Vitest cho kiểm thử. PWA để chạy offline. Capacitor để đóng gói app.
- **Lõi hình học** (TypeScript thuần, không phụ thuộc giao diện): mỗi loại
  phụ kiện là một tệp khai báo danh sách thông số (tên, mặc định, giới
  hạn), quy tắc kiểm tra hợp lệ, và hàm dựng ra mô hình gồm các tấm tôn
  cùng các đường kích thước.
- **Mọi kết quả đều sinh từ một mô hình đó**: lưới 3D, ba hình chiếu, tệp
  DXF, diện tích và khối lượng. Nhờ vậy 3D, bản vẽ và con số luôn khớp
  nhau.
- **Lưu trữ**: thư viện phụ kiện lưu trên máy người dùng; có lưu và mở
  tệp JSON để chuyển giữa các máy.

## 5. Bản đầu (giai đoạn 1) gồm những gì

- Bốn loại phụ kiện (em chọn, anh đổi được): ống thẳng, co 90° có bán
  kính, côn thu, tê.
- Bảng thông số có nút tăng giảm, báo lỗi khi kích thước không dựng được.
- Mô hình 3D: xoay, thu phóng, các góc nhìn chuẩn, bật tắt kích thước.
- Ba hình chiếu: đứng, cạnh, bằng, có kích thước.
- Độ dày tôn, khối lượng riêng (mặc định 7850 kg/m³), ra diện tích tôn và
  khối lượng.
- Đơn vị mm, cm, m, inch. Giao diện tiếng Việt và tiếng Anh.
- Xuất: DXF 2D (ba hình chiếu), CSV bảng khối lượng, JSON thông số.
- Thư viện: lưu, đặt tên, mở lại, xóa phụ kiện đã thiết kế.
- Bố cục điện thoại: 3D ở trên, thông số ở dưới, hình chiếu và xuất tệp
  trong các thẻ riêng.

## 6. Lộ trình

1. **Web bản đầu** như mục 5, đẩy lên repo, có bản chạy thử để anh xem.
2. **Mở rộng**: thêm loại phụ kiện (côn lệch, chạc ba, chuyển hướng bốn
   miệng, chân rẽ), xuất 3D Solid cho AutoCAD.
3. **App**: đóng gói Capacitor, biểu tượng, ảnh giới thiệu, nộp lên Google
   Play và App Store bằng tài khoản SISCOM.
4. **Lắp ghép** nhiều phụ kiện thành tuyến ống và bảng tổng khối lượng.

## 7. Kiểm tra chất lượng

- Kiểm thử tự động cho lõi hình học: diện tích và khối lượng so với phép
  tính tay của từng loại phụ kiện.
- Kiểm thử tệp DXF: đọc lại tệp xuất ra, so kích thước với thông số nhập.
- Xem thật trên trình duyệt ở cỡ màn hình máy tính và điện thoại trước khi
  báo xong.

## 8. Còn để ngỏ

- Tên sản phẩm và nhận diện (màu, logo): tạm dùng "SISCOM Duct", anh
  cung cấp logo sau.
- Địa chỉ chính thức trên siscom.vn: quyết định khi bản đầu chạy ổn.
- Tên repo đang là `duct-caculator` (thiếu chữ "l"); đổi lúc này là dễ
  nhất nếu anh muốn.

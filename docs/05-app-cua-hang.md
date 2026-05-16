# Đặc Tả App Cửa Hàng (Store App — POS)

**Địa chỉ truy cập**: `pos.domain.com`  
**Đối tượng**: Nhân viên bán hàng, quản lý cửa hàng, nhân viên sale (dùng điện thoại)

---

## 1. Xác Thực

- Đăng nhập bằng **email và mật khẩu**.
- Phiên đăng nhập **lưu dài hạn** cho đến khi người dùng logout.

---

## 2. Cấu Trúc Giao Diện

### 2.1 Layout Desktop

```
┌─────────────────────────────────────────────────┐
│            TOP HEADER (100% ngang, 48px)        │  ← Màu: #748DAE
├──────────┬──────────────────────────────────────┤
│          │                                      │
│ SIDEBAR  │         NỘI DUNG CHÍNH               │
│ (trái,   │                                      │
│ dọc)     │                                      │
│          │                                      │
└──────────┴──────────────────────────────────────┘
```

- **Top Header**: `100%` chiều ngang, cao `48px`, màu nền `#748DAE`.
  - Có nút **tạo nhanh khách hàng** trên header.
- **Sidebar**: phân cấp, dọc bên trái, có icon + tiêu đề, có thể **mở rộng/thu gọn**.
- **Ngôn ngữ**: Tiếng Việt có dấu toàn bộ.

### 2.2 Dialog Panel

- Mở từ **bên phải** màn hình.
- Kích thước: **cao 100%, ngang 50%**.

### 2.3 Giao Diện Mobile

- Tối ưu cho trình duyệt điện thoại (nhân viên sale sử dụng chính).
- Ưu tiên bố cục đơn giản, thao tác nhanh.

---

## 3. Cấu Trúc Menu

### 3.1 Tạo Đơn Bán Hàng (POS)

**Mục đích**: Màn hình chính để tạo đơn bán hàng tại quầy.

**Layout màn hình 2 cột**:

```
┌────────────────────────────────────┬──────────────────┐
│           CỘT TRÁI (78%)           │  CỘT PHẢI (22%)  │
│                                    │                  │
│  [Ô tìm kiếm sản phẩm]            │ [Tìm kiếm KH]   │
│  ┌──────────────────────────────┐  │                  │
│  │ Kết quả gợi ý sản phẩm      │  │  Họ và tên       │
│  │ (hiện lên để chọn)          │  │  Số điện thoại   │
│  └──────────────────────────────┘  │  Địa chỉ         │
│                                    │  Số dư gốc       │
│  ┌──────────────────────────────┐  │  Dư nợ hiện tại  │
│  │         GIỎ HÀNG             │  │                  │
│  │  - Sản phẩm 1                │  │  [Thông tin      │
│  │  - Sản phẩm 2                │  │   thanh toán]    │
│  │  ...                         │  │                  │
│  │  Tổng tiền: xxx.xxx đ        │  │  [NÚT TẠO ĐƠN]  │
│  └──────────────────────────────┘  │                  │
└────────────────────────────────────┴──────────────────┘
```

**Cột trái (78%)**:
- Ô tìm kiếm sản phẩm (gõ để tìm theo tên, mã, barcode).
- Kết quả tìm kiếm hiển thị dưới dạng dropdown/popup để chọn nhanh.
- Giỏ hàng: danh sách sản phẩm đã thêm, số lượng, đơn giá, thành tiền.
- Tổng tiền, tổng giảm giá, thành tiền cuối.

**Cột phải (22%)**:
- Ô tìm kiếm khách hàng (gõ tên hoặc số điện thoại).
- Thông tin khách hàng: Họ tên, số điện thoại, địa chỉ, số dư nợ gốc, dư nợ hiện tại.
- Thông tin thanh toán: hình thức thanh toán, số tiền thu, chiết khấu,...
- Nút **Tạo đơn hàng**.

**Top Header (khu vực nút nhanh)**:
- Nút **Tạo nhanh khách hàng** để thêm khách mới ngay lập tức mà không rời màn hình POS.

**Tính năng**:
- Cảnh báo khi số lượng bán vượt tồn kho.
- Áp dụng bảng giá riêng của khách hàng tự động.
- Áp dụng chương trình khuyến mãi (nếu đủ điều kiện).
- Ghi nhận điểm thưởng sau khi bán hàng thành công.
- Hỗ trợ bán nợ: ghi nhận công nợ nếu khách chưa thanh toán đủ.
- Hỗ trợ trả trước lấy hàng sau.
- Giữ hàng khi khách đặt trước chưa giao.

---

### 3.2 Quản Lý Đơn Hàng

**Mục đích**: Theo dõi, xử lý và cập nhật trạng thái đơn hàng của cửa hàng.

**Màn hình chính**:
- Dashboard tổng quan đơn hàng của cửa hàng.
- Danh sách đơn hàng.
  - Tiêu đề trang.
  - Ô tìm kiếm (có biểu tượng kính lúp).
  - Bộ lọc (trạng thái, khách hàng, ngày tạo, nhân viên,...).

**Dialog Panel (50% ngang, 100% cao)**:
- Xem chi tiết đơn hàng.
- Chỉnh sửa đơn hàng.
- **Thay đổi trạng thái** đơn hàng (đang xử lý → đã giao → hoàn thành,...).
- **Trả hàng & hoàn tiền**: xử lý yêu cầu trả hàng, hoàn tiền hoặc trừ công nợ.

---

### 3.3 Phiếu Thu

**Mục đích**: Ghi nhận các khoản thu tiền từ khách hàng (thanh toán công nợ, trả trước).

**Màn hình chính**:
- Danh sách phiếu thu.
  - Tiêu đề trang.
  - Ô tìm kiếm (có biểu tượng kính lúp).
  - Bộ lọc (ngày, khách hàng, nhân viên thu,...).

**Dialog Panel (50% ngang, 100% cao)**:
- **Tạo phiếu thu mới**:
  - Chọn khách hàng.
  - Chọn đơn hàng cần thanh toán (một hoặc nhiều đơn).
  - Nhập số tiền thu.
  - Hạch toán chiết khấu thanh toán (nếu có).
  - Tạo chứng từ trả chiết khấu.
- Xem chi tiết phiếu thu đã tạo.

**Tính năng**:
- Khách hàng có thể thanh toán nhiều đơn cùng lúc.
- Ghi nhận chiết khấu thanh toán cho khách (giảm công nợ).
- Hỗ trợ thanh toán trước khi nhận hàng.

---

### 3.4 Sản Phẩm

**Mục đích**: Tìm kiếm và quản lý sản phẩm tại cửa hàng.

**Màn hình chính**:
- Danh sách sản phẩm.
  - Tiêu đề trang.
  - Ô tìm kiếm (có biểu tượng kính lúp).
  - Bộ lọc (danh mục, tồn kho, trạng thái,...).

**Dialog Panel (50% ngang, 100% cao)**:
- Tạo sản phẩm mới.
- Xem chi tiết sản phẩm (hình ảnh, giá, tồn kho, điểm thưởng,...).
- Chỉnh sửa thông tin sản phẩm.

---

### 3.5 Khách Hàng

**Mục đích**: Quản lý danh sách khách hàng và cập nhật giá riêng.

**Màn hình chính**:
- Dashboard tổng quan khách hàng của cửa hàng.
- Danh sách khách hàng.
  - Tiêu đề trang.
  - Ô tìm kiếm (có biểu tượng kính lúp).
  - Bộ lọc (nhân viên phụ trách, công nợ,...).

**Dialog Panel (50% ngang, 100% cao)**:
- **Xem thông tin cơ bản**: họ tên, số điện thoại, địa chỉ, nhân viên phụ trách.
- **Xem các chỉ số** (theo quyền hạn của nhân viên):
  - Doanh thu, lợi nhuận theo tháng / quý / năm.
  - Công nợ hiện tại, tuổi nợ.
- **Chỉnh sửa thông tin** khách hàng.
- **Cập nhật bảng giá** cho khách hàng (thiết lập giá riêng từ cửa hàng).

---

### 3.6 Mua Hàng

**Mục đích**: Ghi nhận hàng hóa mua từ nhà cung cấp tại cửa hàng.

**Màn hình chính**:
- Dashboard tổng quan mua hàng.
- Danh sách chứng từ mua hàng.
  - Tiêu đề trang.
  - Ô tìm kiếm (có biểu tượng kính lúp).
  - Bộ lọc (nhà cung cấp, ngày, trạng thái,...).

**Dialog Panel (50% ngang, 100% cao) — Purchase Order Panel**:
- Xem chi tiết chứng từ mua hàng.
- Chỉnh sửa chứng từ.
- **Hạch toán chiết khấu từ nhà cung cấp**:
  - Chiết khấu thanh toán → giảm công nợ phải trả.
  - Chiết khấu thương mại → giảm giá vốn hàng mua.
- **Ghi nhận chi phí mua hàng** (vận chuyển, bốc xếp,...) → cộng vào giá vốn.

**Quy trình**:
- Ghi nhận trực tiếp qua chứng từ đã mua (không qua PO nhiều bước).
- Cập nhật tự động giá vốn bình quân di động sau mỗi lần nhập hàng.
- Cập nhật tồn kho sau khi xác nhận chứng từ.

---

### 3.7 Thiết Đặt

**Mục đích**: Cài đặt thông tin ứng dụng và xem thông tin hệ thống.

**Nội dung**:
- Thông tin ứng dụng (tên app, tên cửa hàng).
- Phiên bản hiện tại của ứng dụng.
- Thông tin người dùng đang đăng nhập.
- Cài đặt cửa hàng (nếu là quản lý cửa hàng).

---

## 4. App Nhân Viên Sale (Mobile-First)

**Đối tượng**: Nhân viên kinh doanh ngoài thị trường.  
**Nền tảng chính**: Trình duyệt điện thoại.

### 4.1 Tính Năng

- **Quản lý danh sách khách hàng của mình** (khách được phân công phụ trách).
- **Xem chỉ số khách hàng**:
  - Doanh thu theo tháng.
  - Công nợ hiện tại.
  - Lịch sử mua hàng gần nhất.
- **Tạo đơn hàng** hoặc ghi nhận yêu cầu khách hàng.
- Truy cập nhanh thông tin sản phẩm, giá.

### 4.2 Yêu Cầu Giao Diện Mobile

- Ưu tiên tốc độ tải trang nhanh.
- Điều hướng bằng menu bottom navigation hoặc hamburger menu.
- Danh sách cuộn (infinite scroll hoặc phân trang).
- Ô tìm kiếm nổi bật, dễ thao tác trên màn hình nhỏ.
- Thông tin chỉ số hiển thị dạng card gọn, dễ đọc.

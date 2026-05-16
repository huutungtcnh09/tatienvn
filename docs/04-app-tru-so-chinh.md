# Đặc Tả App Trụ Sở Chính (Head Office App)

**Địa chỉ truy cập**: `admin.domain.com`  
**Đối tượng**: Ban lãnh đạo, quản lý cấp cao, kế toán, marketing

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
│ (trái,   │   [Dashboard + Danh sách / Báo cáo]  │
│ dọc)     │                                      │
│          │                                      │
└──────────┴──────────────────────────────────────┘
```

- **Top Header**: `100%` chiều ngang, cao `48px`, màu nền `#748DAE`.
- **Sidebar**: phân cấp, dọc bên trái, có icon + tiêu đề, có thể **mở rộng/thu gọn**.
- **Ngôn ngữ**: Tiếng Việt có dấu toàn bộ.

### 2.2 Dialog Panel

- Mở từ **bên phải** màn hình.
- Kích thước: **cao 100%, ngang 50%**.
- Dùng để: tạo mới, xem chi tiết, chỉnh sửa, báo cáo & phân tích.

### 2.3 Giao Diện Mobile

- Tối ưu responsive cho màn hình nhỏ.

---

## 3. Cấu Trúc Menu Chính

### 3.1 Người Dùng & Phân Quyền

**Mục đích**: Quản lý tài khoản người dùng và vai trò trong hệ thống.

**Màn hình chính**:
- Dashboard tổng quan người dùng.
- Danh sách người dùng.
  - Tiêu đề trang.
  - Ô tìm kiếm (có biểu tượng kính lúp).
  - Bộ lọc (theo vai trò, trạng thái, cửa hàng,...).

**Dialog Panel (50% ngang, 100% cao)**:
- Xem chi tiết người dùng.
- Tạo người dùng mới.
- Chỉnh sửa thông tin, vai trò, quyền hạn.

**Các tính năng**:
- Gán/thu hồi vai trò cho người dùng.
- Một người dùng có thể có nhiều vai trò.
- Kích hoạt / vô hiệu hóa tài khoản.

---

### 3.2 Cửa Hàng & Kho

**Mục đích**: Quản lý danh sách cửa hàng và kho hàng.

**Màn hình chính**:
- Dashboard tổng quan cửa hàng / kho.
- Danh sách cửa hàng và kho.
  - Tiêu đề trang.
  - Ô tìm kiếm (có biểu tượng kính lúp).
  - Bộ lọc (loại: cửa hàng / kho, trạng thái,...).

**Dialog Panel (50% ngang, 100% cao)**:
- Tạo cửa hàng / kho mới.
- Xem chi tiết.
- Chỉnh sửa thông tin.

---

### 3.3 Khách Hàng

**Mục đích**: Quản lý thông tin khách hàng, công nợ và hiệu suất kinh doanh.

**Màn hình chính**:
- Dashboard tổng quan khách hàng (số lượng, tổng công nợ, tổng doanh thu,...).
- Danh sách khách hàng.
  - Tiêu đề trang.
  - Ô tìm kiếm (có biểu tượng kính lúp).
  - Bộ lọc (nhân viên phụ trách, tuổi nợ, cửa hàng,...).

**Dialog Panel (50% ngang, 100% cao)**:
- Tạo khách hàng mới.
- Xem chi tiết: thông tin cơ bản, nhật ký giao dịch, số dư nợ.
- Chỉnh sửa thông tin.
- Báo cáo & phân tích:
  - Doanh thu, lợi nhuận theo tháng / quý / năm / từ đầu năm.
  - Lịch sử thanh toán.
  - Tuổi nợ.
  - Lịch sử bảng giá.

**Tính năng đặc biệt**:
- Nhập số dư nợ đầu kỳ (chuyển đổi từ hệ thống cũ).
- Xem nhật ký giao dịch để truy vết nhanh.

---

### 3.4 Sản Phẩm & Ngành Hàng

**Mục đích**: Quản lý danh mục sản phẩm và ngành hàng.

**Màn hình chính**:
- Dashboard tổng quan sản phẩm (tổng số, cảnh báo tồn kho thấp, xu hướng,...).
- Danh sách sản phẩm và ngành hàng.
  - Tiêu đề trang.
  - Ô tìm kiếm (có biểu tượng kính lúp).
  - Bộ lọc (danh mục, tồn kho, trạng thái,...).

**Dialog Panel (50% ngang, 100% cao)**:
- Tạo sản phẩm mới.
- Xem chi tiết sản phẩm.
- Chỉnh sửa thông tin.
- Báo cáo & phân tích chi tiết:
  - Xu hướng tồn kho theo thời gian.
  - Doanh thu, lợi nhuận từng sản phẩm.
  - Dự báo nhu cầu nhập hàng.

**Thông tin sản phẩm**:
- Hình ảnh.
- Danh mục (ngành hàng).
- Đơn vị tính.
- Giá thấp nhất / giá cao nhất.
- Giá đặc biệt (dùng cho khuyến mãi).
- Điểm thưởng.
- Giá vốn hiện tại (bình quân di động).

---

### 3.5 Doanh Thu & Lợi Nhuận

**Mục đích**: Phân tích tài chính tổng quan và chuyên sâu.

**Màn hình chính**:
- **Dashboard tổng quan**:
  - Doanh thu, lợi nhuận theo ngày / tháng / quý / năm.
  - So sánh kỳ hiện tại với kỳ trước.
  - Biểu đồ xu hướng.
- **Phân tích chuyên sâu**:
  - Theo từng cửa hàng.
  - Theo từng nhân viên kinh doanh.
  - Theo từng sản phẩm / ngành hàng.
  - Dòng tiền (cash flow).
  - Tồn kho.

**Chỉ số nhân viên kinh doanh**:
- Doanh thu mang về theo nhân viên phụ trách khách hàng.
- Lợi nhuận theo nhân viên.
- Các chỉ tiêu KPI đánh giá nhân viên.

---

### 3.6 Quản Lý Đơn Hàng

**Mục đích**: Theo dõi và quản lý tất cả đơn hàng từ mọi cửa hàng.

**Màn hình chính**:
- Dashboard tổng quan đơn hàng.
- Danh sách đơn hàng.
  - Tiêu đề trang.
  - Ô tìm kiếm (có biểu tượng kính lúp).
  - Bộ lọc (cửa hàng, trạng thái, khách hàng, nhân viên, ngày,...).

---

### 3.7 Quản Lý Mua Hàng

**Mục đích**: Theo dõi tất cả chứng từ mua hàng từ các cửa hàng.

**Màn hình chính**:
- Dashboard tổng quan mua hàng.
- Danh sách chứng từ mua hàng.
  - Tiêu đề trang.
  - Ô tìm kiếm (có biểu tượng kính lúp).
  - Bộ lọc (cửa hàng, nhà cung cấp, ngày, trạng thái,...).

---

### 3.8 Marketing Facebook

**Mục đích**: Tích hợp và quản lý hoạt động marketing trên Facebook.

> Chi tiết tính năng sẽ được bổ sung trong giai đoạn thiết kế tiếp theo.

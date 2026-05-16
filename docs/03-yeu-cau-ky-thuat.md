# Yêu Cầu Kỹ Thuật

## 1. Stack Công Nghệ

| Thành phần | Công nghệ | Ghi chú |
|---|---|---|
| **Frontend** | React + Vite | SPA, build tối ưu |
| **Backend** | Node.js | REST API |
| **Cơ sở dữ liệu** | MySQL | Relational DB |
| **Giao diện** | Thiết kế hiện đại | Responsive Desktop & Mobile |
| **Ngôn ngữ giao diện** | Tiếng Việt có dấu | Toàn bộ |

---

## 2. Cấu Trúc Subdomain

```
domain.com              ← Corporate Website
admin.domain.com        ← Head Office App
pos.domain.com          ← Store App (POS)
```

---

## 3. Xác Thực & Phân Quyền

### 3.1 Đăng Nhập

- Đăng nhập bằng **email và mật khẩu**.
- Phiên đăng nhập **lưu dài hạn** (persistent session) cho đến khi người dùng chủ động logout.
- Áp dụng cho cả Head Office App và Store App.

### 3.2 Phân Quyền

- Một người dùng có thể được **gán nhiều vai trò** cùng lúc.
- Phân quyền theo vai trò (RBAC — Role-Based Access Control).
- Kiểm soát truy cập đến từng module, màn hình và hành động.

---

## 4. Cấu Trúc Cơ Sở Dữ Liệu

### 4.1 Bảng Partner (Đối Tác Dùng Chung)

Một bảng `partner` dùng chung cho **khách hàng**, **nhà cung cấp** và **đối tác vận chuyển**:

```
partner
├── id
├── name               -- Tên
├── phone
├── email
├── address
├── is_customer        -- Cờ: có là khách hàng không
├── is_supplier        -- Cờ: có là nhà cung cấp không
├── is_carrier         -- Cờ: có là đối tác vận chuyển không
├── assigned_user_id   -- Nhân viên phụ trách (nếu là khách hàng)
├── opening_balance    -- Số dư nợ đầu kỳ (dùng khi chuyển từ hệ thống cũ)
└── ...
```

> Một người/tổ chức có thể đồng thời là khách hàng + nhà cung cấp + đối tác.

### 4.2 Nhật Ký Giao Dịch Khách Hàng

```
partner_transaction_log
├── id
├── partner_id         -- Liên kết khách hàng
├── transaction_type   -- Loại giao dịch (bán hàng, thu tiền, trả hàng, ...)
├── reference_id       -- ID chứng từ liên quan
├── amount
├── created_at
└── note
```

> Mục đích: Truy vết nhanh toàn bộ lịch sử giao dịch của một khách hàng.

### 4.3 Bảng Giá Theo Khách Hàng

```
customer_price_list
├── id
├── customer_id        -- Liên kết khách hàng
├── product_id         -- Liên kết sản phẩm
├── price              -- Giá áp dụng
├── status             -- active / inactive
├── created_by         -- Người tạo (cửa hàng hoặc trụ sở)
├── store_id           -- Cửa hàng tạo (nếu có)
└── created_at

customer_price_list_history  -- Lịch sử thay đổi bảng giá
├── id
├── price_list_id
├── old_price
├── new_price
├── changed_by
└── changed_at
```

### 4.4 Sản Phẩm

```
product
├── id
├── name
├── category_id        -- Danh mục (bảng riêng)
├── unit               -- Đơn vị tính
├── min_price          -- Giá thấp nhất (sàn)
├── max_price          -- Giá cao nhất (trần)
├── special_price      -- Giá đặc biệt (dùng cho khuyến mãi)
├── reward_points      -- Điểm thưởng
├── images             -- Hình ảnh (JSON array hoặc bảng riêng)
├── cost_price         -- Giá vốn hiện tại (bình quân di động)
└── ...
```

### 4.5 Tồn Kho

```
inventory
├── id
├── product_id
├── store_id           -- Cửa hàng hoặc kho
├── quantity           -- Số lượng tồn
├── reserved_quantity  -- Số lượng đã giữ (đặt trước, chưa giao)
└── updated_at
```

### 4.6 Số Dư Đầu Kỳ

- Hỗ trợ nhập **số dư nợ đầu kỳ** cho từng khách hàng khi chuyển đổi từ hệ thống cũ.
- Trường `opening_balance` trong bảng `partner`.

---

## 5. Tính Năng Kỹ Thuật Quan Trọng

### 5.1 Tính Giá Vốn Bình Quân Di Động

- Mỗi lần nhập hàng, **giá vốn bình quân** được cập nhật lại theo công thức:

$$
\text{Giá vốn mới} = \frac{(\text{Tồn kho hiện tại} \times \text{Giá vốn cũ}) + (\text{Số lượng nhập} \times \text{Giá nhập})}{\text{Tồn kho hiện tại} + \text{Số lượng nhập}}
$$

### 5.2 Cảnh Báo Vượt Tồn Kho

- Khi bán hàng, hệ thống kiểm tra `quantity - reserved_quantity`.
- Hiện cảnh báo nếu số lượng bán vượt số lượng có thể bán.

### 5.3 Dự Báo Xu Hướng Tồn Kho

- Phân tích tốc độ tiêu thụ trung bình của sản phẩm theo thời gian.
- Dự báo số ngày còn tồn kho có thể bán.
- Gợi ý thời điểm cần nhập thêm hàng.

### 5.4 Chức Năng Giữ Hàng (Reserve)

- Khi khách đặt trước nhưng chưa giao hàng.
- Hàng được đánh dấu là "đã giữ" (`reserved_quantity`), không hiển thị là tồn kho có thể bán.

### 5.5 Chiết Khấu Thanh Toán

- **Phía bán**: Chiết khấu cho khách hàng, hạch toán khi tạo phiếu thu hoặc tạo chứng từ trả chiết khấu trong phần Quản lý phiếu thu.
- **Phía mua**: Nhà cung cấp chiết khấu thanh toán → giảm công nợ phải trả; chiết khấu thương mại → giảm giá vốn hàng mua.

### 5.6 Chương Trình Khuyến Mãi

- Cấu hình quy tắc: mua X tặng Y.
- Sản phẩm tặng không tính doanh thu nhưng tính giá vốn.
- Trường `special_price` dùng khi áp dụng khuyến mãi giảm giá.

---

## 6. Yêu Cầu Giao Diện Chung

### 6.1 Layout Desktop (Dùng Chung Cho Cả Hai App)

```
┌─────────────────────────────────────────────────┐
│            TOP HEADER (100% ngang, 48px)        │  ← Màu: #748DAE
├──────────┬──────────────────────────────────────┤
│          │                                      │
│ SIDEBAR  │         NỘI DUNG CHÍNH               │
│ (dọc,    │                                      │
│ trái)    │                                      │
│          │                                      │
└──────────┴──────────────────────────────────────┘
```

- **Top Header**: chiều ngang 100%, cao 48px, màu nền `#748DAE`.
- **Sidebar**: phân cấp dọc bên trái, có icon và tiêu đề, **có thể mở rộng hoặc thu gọn**.
- **Ngôn ngữ**: Tiếng Việt có dấu toàn bộ.

### 6.2 Dialog Panel (Chi Tiết / Tạo Mới / Chỉnh Sửa)

- Xuất hiện từ bên phải.
- Kích thước: **cao 100%, ngang 50%** màn hình.
- Dùng để: xem chi tiết, tạo mới, chỉnh sửa, xem báo cáo.

### 6.3 Phần Nội Dung Chính (Danh Sách)

Cấu trúc chuẩn: **Dashboard + Danh sách**
- Tiêu đề trang.
- Ô tìm kiếm có biểu tượng kính lúp.
- Bộ lọc (filter) linh hoạt.
- Danh sách bản ghi.

### 6.4 Giao Diện Mobile

- Tối ưu cho màn hình nhỏ (responsive design).
- Store App ưu tiên mobile (nhân viên sale dùng trên điện thoại).

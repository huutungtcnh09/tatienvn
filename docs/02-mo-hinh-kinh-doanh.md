# Đặc Tả Mô Hình Kinh Doanh

## 1. Tổng Quan

Doanh nghiệp kinh doanh hàng hóa và dịch vụ với mô hình **đa cửa hàng** và **một kho trung tâm**. Hệ thống hỗ trợ toàn bộ vòng đời nghiệp vụ từ mua hàng → nhập kho → bán hàng → thu tiền → báo cáo.

### Sơ Đồ Tổng Quan Nghiệp Vụ

```
NHÀ CUNG CẤP
     │
     │ Bán chứng từ mua hàng
     ▼
[MUA HÀNG] ──────────────────────────────────────────────────────────
     │ Nhập kho                                                      │
     │ Cập nhật giá vốn bình quân di động                           │ Công nợ
     │ Ghi nhận chi phí (vận chuyển, bốc xếp → tăng giá vốn)       │ phải trả
     ▼                                                               │
  [TỒN KHO]                                                    [PHẢI TRẢ NCC]
     │                                                               │
     │ Xuất hàng khi bán                                            │ Thanh toán NCC
     ▼                                                               │
[BÁN HÀNG] ──────────────────────────────────────────────────────────
     │
     ├── Tiền ngay  → Thu tiền ngay
     ├── Bán nợ     → [CÔNG NỢ KHÁCH HÀNG] → Phiếu thu → Thu tiền
     └── Trả trước  → Thu tiền trước → Giao hàng sau
```

---

## 2. Mô Hình Bán Hàng

### 2.1 Cơ Cấu Tổ Chức

- Nhiều cửa hàng hoạt động đồng thời.
- Một kho trung tâm.
- Nhiều danh mục hàng hóa (có bảng danh mục riêng).
- Mỗi khách hàng có một **nhân viên phụ trách** (nhân viên sale).

### 2.2 Hình Thức Bán Hàng

| Hình thức | Mô tả | Ảnh hưởng tồn kho | Ảnh hưởng công nợ |
|---|---|---|---|
| **Tiền ngay** | Thu tiền tại thời điểm tạo đơn | Xuất kho ngay | Không có công nợ |
| **Bán nợ** | Giao hàng trước, thu tiền sau | Xuất kho ngay | Tăng công nợ phải thu |
| **Trả trước lấy hàng sau** | Khách trả tiền trước, nhận hàng sau | Chưa xuất kho | Ghi nhận tiền nhận trước |
| **Giữ hàng (đặt trước)** | Khách đặt, chưa giao, hàng được giữ | Tăng `reserved_quantity` | Chưa tính công nợ |

### 2.3 Luồng Xử Lý Đơn Hàng

```
[TẠO ĐƠN]
     │
     ├── Tiền ngay ──────► [THANH TOÁN] ──► [HOÀN THÀNH]
     │                          │
     │                          └── Có chiết khấu? ──► Tạo chứng từ chiết khấu
     │
     ├── Bán nợ ──────────► [CHỜ THANH TOÁN] ──► [PHIẾU THU] ──► [HOÀN THÀNH]
     │                                                │
     │                                                └── Chiết khấu TT ──► Ghi nhận
     │
     ├── Trả trước ──────► [ĐÃ THU TIỀN / CHỜ GIAO HÀNG] ──► [GIAO HÀNG] ──► [HOÀN THÀNH]
     │
     └── Đặt trước ──────► [GIỮ HÀNG] ──► [XÁC NHẬN ĐƠN] ──► (tiếp tục luồng trên)
```

### 2.4 Trạng Thái Đơn Hàng

```
draft (nháp)
  │
  ▼
confirmed (đã xác nhận)
  │           │
  │           └──► cancelled (đã hủy)
  ▼
processing (đang xử lý)
  │
  ▼
delivered (đã giao hàng)
  │           │
  │           └──► returned (trả hàng) ──► refunded (đã hoàn tiền)
  ▼
completed (hoàn thành)
```

### 2.5 Công Nợ Khách Hàng

#### 2.5.1 Nguyên Tắc

- Công nợ phát sinh khi bán nợ hoặc khách chưa thanh toán đủ.
- Khách hàng có thể thanh toán **một lần cho nhiều đơn hàng** trong cùng một phiếu thu.
- **Nhật ký giao dịch** ghi lại toàn bộ lịch sử để truy vết nhanh.
- Hỗ trợ nhập **số dư nợ đầu kỳ** khi chuyển từ hệ thống cũ.

#### 2.5.2 Tuổi Nợ (Debt Aging)

Phân nhóm công nợ theo thời gian quá hạn:

| Nhóm | Khoản thời gian | Mức độ |
|---|---|---|
| Hiện hành | Chưa đến hạn | Bình thường |
| Nhóm 1 | 1 – 30 ngày | Cần theo dõi |
| Nhóm 2 | 31 – 60 ngày | Cần nhắc thu |
| Nhóm 3 | 61 – 90 ngày | Cảnh báo |
| Nhóm 4 | > 90 ngày | Rủi ro cao |

#### 2.5.3 Các Sự Kiện Làm Thay Đổi Công Nợ

| Sự kiện | Tác động |
|---|---|
| Tạo đơn bán nợ | **Tăng** công nợ phải thu |
| Thu tiền (phiếu thu) | **Giảm** công nợ phải thu |
| Chiết khấu thanh toán | **Giảm** công nợ phải thu (ghi nhận riêng) |
| Trả hàng hoàn tiền | **Giảm** công nợ hoặc hoàn tiền mặt |
| Nhập số dư đầu kỳ | Thiết lập công nợ ban đầu |

### 2.6 Thanh Toán & Chiết Khấu Cho Khách

#### 2.6.1 Chiết Khấu Thanh Toán

Áp dụng khi khách hàng thanh toán sớm hoặc theo thỏa thuận. Có 2 cách hạch toán:

| Cách | Mô tả |
|---|---|
| **Tạo phiếu thu có chiết khấu** | Khi thu tiền, nhập thêm số tiền chiết khấu → giảm công nợ |
| **Chứng từ trả chiết khấu riêng** | Tạo chứng từ độc lập trong mục Quản lý phiếu thu |

#### 2.6.2 Hình Thức Thanh Toán

- Tiền mặt
- Chuyển khoản ngân hàng
- Thẻ tín dụng / debit
- Kết hợp nhiều hình thức trong một lần thanh toán

### 2.7 Trả Hàng & Hoàn Tiền

```
[YÊU CẦU TRẢ HÀNG]
     │
     ▼
[KIỂM TRA ĐIỀU KIỆN]
     │
     ├── Đơn tiền ngay ──► Hoàn tiền mặt hoặc chuyển khoản
     │
     ├── Đơn bán nợ chưa thu ──► Giảm công nợ phải thu
     │
     └── Đơn bán nợ đã thu ──► Hoàn tiền hoặc ghi nhận trả trước
     │
     ▼
[NHẬP KHO TRẢ LẠI] ──► Cập nhật tồn kho
     │
     ▼
[HOÀN TẤT] ──► Ghi nhật ký giao dịch
```

### 2.8 Tích Điểm Đổi Quà

#### 2.8.1 Tích Điểm

- Mỗi sản phẩm có cấu hình **điểm thưởng** riêng (`reward_points`).
- Điểm được cộng vào tài khoản khách sau khi đơn hàng **hoàn thành**.
- Trả hàng sẽ **trừ lại** điểm đã cộng.

#### 2.8.2 Đổi Điểm

- Khách dùng điểm để đổi quà tặng hoặc giảm giá đơn hàng.
- Quy đổi: X điểm = Y đồng (cấu hình theo chương trình).
- Lịch sử tích / đổi điểm được lưu đầy đủ.

### 2.9 Chương Trình Khuyến Mãi

#### 2.9.1 Các Loại Khuyến Mãi Được Hỗ Trợ

| Loại | Mô tả | Ví dụ |
|---|---|---|
| **Mua X tặng Y (sản phẩm khác)** | Mua đủ số lượng sp A → tặng sp B | Mua 10 sp A → tặng 1 sp B |
| **Mua X tặng Y (cùng sản phẩm)** | Mua đủ số lượng → tặng thêm cùng sp | Mua 30 sp A → tặng 1 sp A |
| **Giảm giá trực tiếp** | Áp dụng `special_price` thay cho giá thường | Giá KM: 90.000đ thay vì 100.000đ |

#### 2.9.2 Nguyên Tắc Hạch Toán Khuyến Mãi

- Sản phẩm tặng: **không tính doanh thu**, nhưng **tính giá vốn**.
- Giảm giá trực tiếp: ghi nhận doanh thu theo giá sau giảm.
- Hệ thống tự động kiểm tra điều kiện KM khi thêm sản phẩm vào giỏ hàng.

#### 2.9.3 Cấu Trúc Quy Tắc Khuyến Mãi

```
promotion
├── id
├── name                   -- Tên chương trình
├── type                   -- buy_x_get_y | direct_discount
├── start_date
├── end_date
├── is_active
├── trigger_product_id     -- Sản phẩm kích hoạt KM
├── trigger_quantity       -- Số lượng cần mua để kích hoạt
├── reward_product_id      -- Sản phẩm tặng (hoặc NULL nếu giảm giá)
├── reward_quantity        -- Số lượng tặng
└── applies_to_stores      -- Áp dụng cho cửa hàng nào (all / chỉ định)
```

### 2.10 Bảng Giá Theo Khách Hàng

- Mỗi khách hàng có thể có bảng giá **riêng biệt** cho từng sản phẩm.
- Khi tạo đơn, hệ thống **tự động áp giá** theo bảng giá của khách (ưu tiên hơn giá mặc định).
- Cả **cửa hàng** và **trụ sở** đều có thể tạo/cập nhật bảng giá cho khách.
- Mỗi lần thay đổi giá đều được **lưu lịch sử** (ai thay đổi, thời điểm, giá cũ → giá mới).

---

## 3. Mô Hình Mua Hàng

### 3.1 Quy Trình Hiện Tại

```
[NHẬN HÀNG TỪ NCC]
     │
     ▼
[TẠO CHỨNG TỪ MUA HÀNG tại cửa hàng]
     │
     ├── Nhập thông tin: NCC, sản phẩm, số lượng, đơn giá
     ├── Ghi nhận chi phí mua hàng (vận chuyển, bốc xếp, ...)
     └── Hạch toán chiết khấu từ NCC (nếu có)
     │
     ▼
[XÁC NHẬN CHỨNG TỪ]
     │
     ├── Cập nhật tồn kho (tăng)
     ├── Cập nhật giá vốn bình quân di động
     └── Ghi nhận công nợ phải trả NCC
     │
     ▼
[THANH TOÁN CHO NCC] ──► Giảm công nợ phải trả
```

> **Lưu ý**: Hiện tại chưa áp dụng quy trình nhiều bước (không có PO → GRN → Invoice). Toàn bộ thực hiện qua 1 chứng từ trong Store App.

### 3.2 Chiết Khấu Từ Nhà Cung Cấp

| Loại | Thời điểm áp dụng | Tác động kế toán |
|---|---|---|
| **Chiết khấu thương mại** | Thỏa thuận khi ký hợp đồng | Giảm **giá vốn** hàng mua |
| **Chiết khấu thanh toán** | Khi thanh toán sớm / đúng hạn | Giảm **công nợ** phải trả NCC |

### 3.3 Chi Phí Mua Hàng (Landed Cost)

Chi phí phát sinh khi nhập hàng được **phân bổ vào giá vốn**:

| Loại chi phí | Cách phân bổ |
|---|---|
| Vận chuyển | Phân bổ theo số lượng hoặc giá trị hàng |
| Bốc xếp | Phân bổ theo số lượng |
| Chi phí khác | Cấu hình linh hoạt |

**Công thức:**

$$
\text{Giá vốn thực} = \text{Giá mua} - \text{Chiết khấu TM} + \frac{\text{Chi phí phân bổ}}{\text{Số lượng sản phẩm}}
$$

### 3.4 Tính Giá Vốn Bình Quân Di Động

Mỗi lần nhập hàng, giá vốn bình quân được cập nhật lại:

$$
\text{Giá vốn mới} = \frac{(\text{Tồn kho hiện tại} \times \text{Giá vốn cũ}) + (\text{Số lượng nhập} \times \text{Giá nhập thực})}{\text{Tồn kho hiện tại} + \text{Số lượng nhập}}
$$

---

## 4. Quản Lý Sản Phẩm & Tồn Kho

### 4.1 Thông Tin Sản Phẩm

| Trường | Kiểu dữ liệu | Mô tả |
|---|---|---|
| Tên sản phẩm | Chuỗi | |
| Mã sản phẩm / SKU | Chuỗi | Mã định danh |
| Hình ảnh | Mảng URL | Một hoặc nhiều ảnh |
| Danh mục | Liên kết | Bảng `category` riêng |
| Đơn vị tính | Chuỗi | cái, hộp, kg, lít, ... |
| Giá thấp nhất | Số | Ngưỡng giá sàn (không bán dưới mức này) |
| Giá cao nhất | Số | Ngưỡng giá trần |
| Giá đặc biệt | Số | Dùng riêng cho khuyến mãi |
| Điểm thưởng | Số nguyên | Điểm cộng cho khách khi mua |
| Giá vốn hiện tại | Số | Bình quân di động, cập nhật tự động |
| Trạng thái | Enum | active / inactive |

### 4.2 Danh Mục Sản Phẩm (Category)

- Cấu trúc **phân cấp nhiều tầng** (cha → con).
- Ví dụ: `Thực phẩm` → `Đồ uống` → `Nước ngọt có ga`.
- Mỗi sản phẩm thuộc một danh mục lá.

### 4.3 Quản Lý Tồn Kho

#### 4.3.1 Cấu Trúc Tồn Kho

| Trường | Mô tả |
|---|---|
| `quantity` | Tổng số lượng thực tế trong kho / cửa hàng |
| `reserved_quantity` | Số lượng đã giữ (đặt trước chưa giao) |
| `available_quantity` | = `quantity` - `reserved_quantity` (có thể bán) |

#### 4.3.2 Các Sự Kiện Thay Đổi Tồn Kho

| Sự kiện | Thay đổi |
|---|---|
| Nhập hàng từ NCC | Tăng `quantity` |
| Bán hàng (xác nhận đơn) | Giảm `quantity` |
| Đặt hàng giữ chỗ | Tăng `reserved_quantity` |
| Hủy đặt giữ chỗ | Giảm `reserved_quantity` |
| Trả hàng (khách trả lại) | Tăng `quantity` |

#### 4.3.3 Cảnh Báo Vượt Tồn Kho

- Khi số lượng bán > `available_quantity` → hệ thống hiển thị **cảnh báo**.
- Cấu hình: có thể cho phép bán âm (cảnh báo nhưng không chặn) hoặc chặn hoàn toàn.

#### 4.3.4 Dự Báo Xu Hướng Tồn Kho

- Tính tốc độ tiêu thụ trung bình: `avg_daily_sales = tổng bán / số ngày`.
- Dự báo: `days_remaining = available_quantity / avg_daily_sales`.
- Cảnh báo khi `days_remaining < ngưỡng cấu hình` (ví dụ: < 7 ngày).

---

## 5. Mô Hình Đối Tác (Partner)

### 5.1 Bảng Partner Dùng Chung

Một đối tác có thể đồng thời đóng **nhiều vai trò**:

```
                    ┌─────────────┐
                    │   partner   │
                    └──────┬──────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
     is_customer      is_supplier      is_carrier
          │                │                │
    [Khách hàng]    [Nhà cung cấp]   [Đối tác vận chuyển]
```

### 5.2 Thông Tin Đối Tác

| Nhóm thông tin | Các trường |
|---|---|
| **Cơ bản** | Tên, mã, điện thoại, email, địa chỉ |
| **Tài chính** | Số dư nợ đầu kỳ, hạn mức tín dụng |
| **Phụ trách** | Nhân viên phụ trách (nếu là khách hàng) |
| **Phân loại** | is_customer, is_supplier, is_carrier |

### 5.3 Nhật Ký Giao Dịch

Ghi lại toàn bộ giao dịch liên quan đến đối tác:

| Loại giao dịch | Mô tả |
|---|---|
| `sale_order` | Tạo đơn bán hàng |
| `payment_receipt` | Thu tiền từ khách |
| `discount_voucher` | Trả chiết khấu cho khách |
| `return_order` | Trả hàng hoàn tiền |
| `purchase_order` | Mua hàng từ NCC |
| `payment_to_supplier` | Thanh toán cho NCC |
| `opening_balance` | Nhập số dư đầu kỳ |

---

## 6. Mô Hình Người Dùng & Phân Quyền

### 6.1 Vai Trò Trong Hệ Thống

| Vai trò | Nơi hoạt động | Quyền hạn chính |
|---|---|---|
| **Super Admin** | Head Office | Toàn quyền hệ thống |
| **Quản lý công ty** | Head Office | Xem báo cáo toàn công ty, quản lý cấu hình |
| **Kế toán** | Head Office | Quản lý công nợ, phiếu thu, báo cáo tài chính |
| **Marketing** | Head Office | Quản lý khuyến mãi, bảng giá, Facebook Ads |
| **Quản lý cửa hàng** | Store App | Toàn quyền trong phạm vi cửa hàng |
| **Nhân viên bán hàng** | Store App | Tạo đơn hàng, xem khách hàng phụ trách |
| **Nhân viên Sale (mobile)** | Store App (mobile) | Xem danh sách KH, chỉ số, tạo đơn |

### 6.2 Nguyên Tắc Phân Quyền

- Một người dùng có thể **gán đồng thời nhiều vai trò**.
- Phân quyền theo **RBAC** (Role-Based Access Control).
- Kiểm soát truy cập đến từng module, màn hình, hành động (xem / tạo / sửa / xóa).
- Dữ liệu cửa hàng: nhân viên chỉ xem dữ liệu của **cửa hàng được gán**.

---

## 7. Báo Cáo & Phân Tích

### 7.1 Khoảng Thời Gian Báo Cáo

Tất cả báo cáo đều hỗ trợ các khoảng thời gian linh hoạt:

| Khoảng thời gian | Mô tả |
|---|---|
| Hôm nay | Ngày hiện tại |
| Tháng này | Từ đầu tháng đến nay |
| Quý này | Từ đầu quý đến nay |
| Năm nay | Từ 01/01 năm hiện tại đến nay |
| Từ đầu năm đến nay | Giống Năm nay |
| Tùy chỉnh | Chọn khoảng ngày bất kỳ |

### 7.2 Chỉ Số Khách Hàng

| Chỉ số | Mô tả |
|---|---|
| Doanh thu | Tổng giá trị đơn hàng hoàn thành |
| Lợi nhuận gộp | Doanh thu - Giá vốn |
| Tổng đã thanh toán | Tổng tiền đã thu được |
| Công nợ hiện tại | Số tiền khách còn nợ |
| Tuổi nợ | Phân nhóm nợ theo thời gian |
| Tần suất mua hàng | Số đơn hàng / tháng |
| Giá trị đơn trung bình | Doanh thu / số đơn |

### 7.3 Chỉ Số Theo Cửa Hàng

| Chỉ số | Mô tả |
|---|---|
| Doanh thu | Tổng bán trong kỳ |
| Lợi nhuận gộp | Doanh thu - Giá vốn |
| Giá vốn hàng bán | Tổng COGS |
| Dòng tiền vào | Tiền thu được |
| Dòng tiền ra | Tiền trả cho NCC |
| Tồn kho cuối kỳ | Giá trị tồn kho |
| Số đơn hàng | Tổng đơn trong kỳ |

### 7.4 Chỉ Số Nhân Viên Kinh Doanh (KPI)

| Chỉ tiêu | Mô tả |
|---|---|
| Doanh thu phụ trách | Tổng doanh thu từ KH được phân công |
| Lợi nhuận phụ trách | Tổng lợi nhuận từ KH được phân công |
| Số khách hàng active | Số KH có mua hàng trong kỳ |
| Tỷ lệ thu hồi công nợ | Tiền thu / tiền cần thu |
| Số đơn hàng mới | Đơn hàng tạo trong kỳ |



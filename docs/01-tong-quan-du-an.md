# Tổng Quan Dự Án — Hệ Sinh Thái Quản Trị Doanh Nghiệp

## 1. Mục Tiêu Dự Án

Xây dựng hệ sinh thái quản trị doanh nghiệp thống nhất, phục vụ toàn bộ hoạt động quản lý và vận hành, bao gồm:

| Ứng dụng | Đối tượng sử dụng | Địa chỉ truy cập |
|---|---|---|
| **Head Office App** – App quản trị trụ sở chính | Ban lãnh đạo, quản lý cấp cao, kế toán, marketing | `admin.domain.com` |
| **Store App** – App vận hành cửa hàng | Nhân viên bán hàng, quản lý cửa hàng | `pos.domain.com` |
| **Corporate Website** – Website thông tin doanh nghiệp | Khách hàng, đối tác bên ngoài | `domain.com` |

---

## 2. Phạm Vi Hệ Thống

```
domain.com                  ← Website thông tin công ty
admin.domain.com            ← App quản trị tập trung (Head Office)
pos.domain.com              ← App vận hành cửa hàng (Store POS)
```

### 2.1 Head Office App (`admin.domain.com`)

- Quản trị tập trung toàn công ty từ một nơi duy nhất.
- Tổng hợp dữ liệu từ tất cả cửa hàng, kho, nhân viên.
- Phân quyền người dùng ở cấp độ công ty.
- Phân tích doanh thu, lợi nhuận, tồn kho, dòng tiền theo từng cửa hàng.
- Quản lý danh mục sản phẩm, bảng giá, khách hàng, nhà cung cấp.
- Theo dõi hiệu suất nhân viên kinh doanh.

### 2.2 Store App (`pos.domain.com`)

- Vận hành bán hàng tại quầy (POS).
- Mua hàng từ nhà cung cấp, nhập kho.
- Chăm sóc khách hàng tại cửa hàng.
- Quản lý đơn hàng, phiếu thu, công nợ khách hàng.
- Cập nhật bảng giá riêng cho từng khách hàng.

### 2.3 Corporate Website (`domain.com`)

- Giới thiệu thông tin doanh nghiệp.
- Trưng bày sản phẩm, dịch vụ.
- Kênh liên hệ và tương tác với khách hàng bên ngoài.

---

## 3. Nguyên Tắc Thiết Kế Hệ Thống

- **Dữ liệu thống nhất**: Tất cả ứng dụng chia sẻ cùng một cơ sở dữ liệu trung tâm.
- **Phân quyền linh hoạt**: Một người dùng có thể được gán nhiều vai trò khác nhau.
- **Đa cửa hàng**: Hỗ trợ nhiều cửa hàng đồng thời, theo dõi riêng biệt từng cửa hàng.
- **Đối tác đa vai trò**: Một đối tác có thể đồng thời là khách hàng, nhà cung cấp và đối tác vận chuyển (dùng bảng `partner` chung).
- **Khả năng mở rộng**: Kiến trúc hỗ trợ thêm cửa hàng, thêm người dùng mà không thay đổi cấu trúc lõi.
- **Giao diện Tiếng Việt có dấu** toàn bộ.

---

## 4. Công Nghệ Sử Dụng

| Thành phần | Công nghệ |
|---|---|
| Frontend | React + Vite |
| Backend | Node.js |
| Cơ sở dữ liệu | MySQL |
| Giao diện | Hiện đại, responsive (Desktop & Mobile) |

Chi tiết xem tại: [03-yeu-cau-ky-thuat.md](./03-yeu-cau-ky-thuat.md)

---

## 5. Danh Sách Tài Liệu Đặc Tả

| File | Nội dung |
|---|---|
| `01-tong-quan-du-an.md` | Tổng quan, mục tiêu, phạm vi hệ thống |
| `02-mo-hinh-kinh-doanh.md` | Đặc điểm mô hình bán hàng, mua hàng |
| `03-yeu-cau-ky-thuat.md` | Yêu cầu kỹ thuật, cấu trúc dữ liệu, tính năng hệ thống |
| `04-app-tru-so-chinh.md` | Đặc tả chi tiết Head Office App |
| `05-app-cua-hang.md` | Đặc tả chi tiết Store App (POS) |

# Tài Liệu Đặc Tả Dự Án — Hệ Sinh Thái Quản Trị Doanh Nghiệp

> Tài liệu đặc tả dự án xây dựng bằng **Tiếng Việt có dấu**.  
> Cập nhật lần cuối: 28/03/2026

---

## Danh Sách Tài Liệu

| # | File | Mô tả |
|---|---|---|
| 1 | [01-tong-quan-du-an.md](./01-tong-quan-du-an.md) | Mục tiêu, phạm vi, tổng quan hệ thống 3 ứng dụng |
| 2 | [02-mo-hinh-kinh-doanh.md](./02-mo-hinh-kinh-doanh.md) | Mô hình bán hàng, mua hàng, công nợ, khuyến mãi |
| 3 | [03-yeu-cau-ky-thuat.md](./03-yeu-cau-ky-thuat.md) | Stack công nghệ, cấu trúc DB, yêu cầu giao diện chung |
| 4 | [04-app-tru-so-chinh.md](./04-app-tru-so-chinh.md) | Đặc tả chi tiết Head Office App (`admin.domain.com`) |
| 5 | [05-app-cua-hang.md](./05-app-cua-hang.md) | Đặc tả chi tiết Store App / POS (`pos.domain.com`) |

---

## Tóm Tắt Nhanh

### Hệ Thống Gồm 3 Ứng Dụng

```
domain.com           → Website thông tin doanh nghiệp
admin.domain.com     → App quản trị trụ sở chính (Head Office)
pos.domain.com       → App vận hành cửa hàng (Store POS)
```

### Công Nghệ

- **Frontend**: React + Vite
- **Backend**: Node.js
- **Database**: MySQL

### Màu Giao Diện Chung

- Top Header: `#748DAE`
- Kích thước Header: `100%` ngang × `48px` cao
- Dialog Panel: `100%` cao × `50%` ngang (mở từ bên phải)

### Điểm Nổi Bật Của Dự Án

- Mô hình **đa cửa hàng** với kho tập trung.
- Bảng `partner` **dùng chung** cho khách hàng, nhà cung cấp, đối tác vận chuyển.
- Tính giá vốn theo **bình quân di động**.
- **Bảng giá riêng** cho từng khách hàng, có lịch sử cập nhật.
- **Nhật ký giao dịch** khách hàng để truy vết nhanh.
- Hỗ trợ **nhập số dư đầu kỳ** khi chuyển từ hệ thống cũ.
- **Phân quyền linh hoạt**: một người có nhiều vai trò.
- Giao diện **Tiếng Việt có dấu** toàn bộ, tối ưu cả Desktop và Mobile.

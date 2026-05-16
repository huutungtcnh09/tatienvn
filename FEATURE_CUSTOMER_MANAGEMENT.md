# Tính Năng Quản Lý Khách Hàng Trong Custom Audience Facebook

## Mô Tả
Tính năng cho phép quản lý (thêm/xóa) khách hàng trong Custom Audience trên Facebook Meta Ads API. Người dùng có thể:
- Thêm khách hàng vào Custom Audience (bằng email, số điện thoại hoặc ID khách hàng)
- Xóa khách hàng khỏi Custom Audience

## Kiến Trúc

### Backend (services/api/src/modules/marketing/marketing.routes.ts)

Đã thêm 2 endpoint mới:

#### 1. POST `/api/marketing/facebook/custom-audiences/:audienceId/add-users`
Thêm khách hàng vào Custom Audience

**Request Body:**
```json
{
  "appId": "3218648218340025",
  "appSecret": "2a50cf15eeecdbab099153f9ccde20a8",
  "accessToken": "EAAtvVZBZB2...",
  "users": [
    {"email": "user@example.com"},
    {"email": "another@example.com"},
    {"phone_hash": "0901234567"},
    {"extern_id": "CUSTOMER_ID_123"}
  ]
}
```

**Response:**
```json
{
  "message": "Thêm khách hàng thành công",
  "data": {"success": true}
}
```

#### 2. POST `/api/marketing/facebook/custom-audiences/:audienceId/remove-users`
Xóa khách hàng khỏi Custom Audience

**Request Body:**
```json
{
  "appId": "3218648218340025",
  "appSecret": "2a50cf15eeecdbab099153f9ccde20a8",
  "accessToken": "EAAtvVZBZB2...",
  "users": [
    {"email": "user@example.com"},
    {"phone_hash": "0901234567"}
  ]
}
```

**Response:**
```json
{
  "message": "Xóa khách hàng thành công",
  "data": {"success": true}
}
```

**Cơ Chế:**
- Sử dụng Facebook Graph API v22.0
- HMAC-SHA256 appsecret_proof để bảo mật API call
- Require `dashboard:read` permission

### Frontend (apps/head-office/src/pages/MarketingFacebook.jsx)

#### UI Components

1. **Detail Panel Dialog** - Hiển thị chi tiết Custom Audience
   - Thông tin cơ bản (ID, tên, mô tả, retention days, v.v.)
   - 2 nút: "+ Thêm khách hàng" và "- Xóa khách hàng"

2. **Add/Remove Form**
   - Textarea để nhập email, số điện thoại, hoặc ID khách hàng (mỗi dòng một)
   - Hỗ trợ tự động phát hiện loại dữ liệu:
     - Email: `user@example.com`
     - Số điện thoại: `0123456789` (tối thiểu 10 ký tự)
     - ID khác: `CUSTOMER_ID_123`
   - Hiển thị số lượng khách hàng chuẩn bị xử lý

#### State Management
```javascript
const [selectedAudience, setSelectedAudience] = useState(null);
const [showAudienceDialog, setShowAudienceDialog] = useState(false);
const [showAddUserDialog, setShowAddUserDialog] = useState(false);
const [userInput, setUserInput] = useState("");
const [loadingAddUser, setLoadingAddUser] = useState(false);
```

#### Main Functions

1. **handleAddUsers()** - Xử lý thêm khách hàng
   - Parse dữ liệu từ textarea
   - Gọi API `addFacebookAudienceUsers`
   - Hiển thị thông báo thành công

2. **handleRemoveUsers()** - Xử lý xóa khách hàng
   - Parse dữ liệu từ textarea
   - Gọi API `removeFacebookAudienceUsers`
   - Hiển thị thông báo thành công

### API Layer (apps/head-office/src/api.js)

Đã thêm 2 hàm:

```javascript
export async function addFacebookAudienceUsers(token, config, audienceId, users)
export async function removeFacebookAudienceUsers(token, config, audienceId, users)
```

Mỗi hàm:
- Gọi backend endpoint tương ứng
- Xử lý authentication (Bearer token)
- Throw error nếu thất bại

### Styles (apps/head-office/src/styles/pages.css)

Đã thêm style `.btn-danger`:
```css
.btn-danger {
  background: #dc3545;
  color: white;
}

.btn-danger:hover {
  background: #c82333;
}

.btn-danger:disabled {
  background: #e0e0e0;
  color: #999;
  cursor: not-allowed;
}
```

## Quy Trình Sử Dụng

### Thêm Khách Hàng
1. Mở danh sách Custom Audience
2. Click nút "Chi tiết" trên hàng audience cần quản lý
3. Trong dialog, click nút "+ Thêm khách hàng"
4. Nhập email/số điện thoại/ID (mỗi dòng một)
5. Click nút "Thêm"
6. Chờ thông báo thành công

### Xóa Khách Hàng
1. Mở danh sách Custom Audience
2. Click nút "Chi tiết" trên hàng audience cần quản lý
3. Trong dialog, click nút "- Xóa khách hàng"
4. Nhập email/số điện thoại/ID khách hàng cần xóa
5. Click nút "Xóa"
6. Chờ thông báo thành công

## Định Dạng Dữ Liệu Đầu Vào

### Email
```
user@example.com
john.doe@company.com
```

### Số Điện Thoại
```
0123456789
0987654321
```

### ID Khách Hàng
```
CUSTOMER_ID_123
ID_ABC_456
```

### Hỗn Hợp
```
user@example.com
0123456789
CUSTOMER_ID_123
```

## Lỗi Thường Gặp

| Lỗi | Nguyên Nhân | Giải Pháp |
|-----|------------|----------|
| "Danh sách khách hàng không được để trống" | Người dùng không nhập gì | Nhập ít nhất một email/số điện thoại/ID |
| "Thiếu Access Token Facebook" | Config không đúng | Kiểm tra lại App ID, Secret, Access Token |
| "(#100) Tried accessing nonexisting field" | Field không hợp lệ | Chắc chắn format dữ liệu đúng |
| "Rate limit exceeded" | Gửi quá nhiều request | Chờ một lúc rồi thử lại |

## Giới Hạn

- Facebook API **không hỗ trợ** lấy danh sách khách hàng hiện có trong Custom Audience (vì lý do bảo mật)
- Khi xóa, cần cung cấp chính xác email/số điện thoại/ID của khách hàng
- Tối đa thường là 10,000 người/lần nhưng có thể khác tùy tài khoản Facebook

## Đã Test
✅ Endpoint `/facebook/custom-audiences/:audienceId/add-users` - HTTP 200  
✅ Endpoint `/facebook/custom-audiences/:audienceId/remove-users` - HTTP 200  
✅ UI dialog thêm/xóa khách hàng - Không lỗi biên dịch  
✅ API layer functions - Gọi đúng endpoint  

## Dự Phòng/Tương Lai

Có thể mở rộng tính năng:
- Upload CSV file thay vì nhập thủ công
- Xem danh sách khách hàng hiện có (nếu Facebook API thêm hỗ trợ)
- Tạo Custom Audience mới
- Xóa Custom Audience
- Quản lý Lookalike Audience
- Export danh sách khách hàng thành CSV

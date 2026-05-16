# Phân Tích Xử Lý Chiết Khấu (Rebate/Discount) - APP_KD

## 1. DANH SÁCH FILE CHỨA LOGIC REBATE

### API & Logic Chính:
- **[services/api/src/modules/purchases/purchases.routes.ts](services/api/src/modules/purchases/purchases.routes.ts)** (3,400+ dòng)
  - Tất cả endpoint xử lý chiết khấu
  - Logic phân bổ chiết khấu cho items
  - Tính toán COGS adjustment & inventory adjustment
  - Recompute moving average cost

### Prisma Schema & Models:
- **[services/api/prisma/schema.prisma](services/api/prisma/schema.prisma)** (dòng 601-780)
  - Model `PurchaseOrder`
  - Model `PurchaseOrderItem`
  - Model `PurchaseRebate`
  - Model `PurchaseRebateBatch`
  - Model `PurchaseRebateBatchAllocation`
  - Model `PurchaseRebateAllocation`

### Test Case:
- **[scripts/purchase-rebate-batch-regression.ps1](scripts/purchase-rebate-batch-regression.ps1)**
  - Test tạo rebate batch, phân bổ cho nhiều PO
  - Test delete batch và rollback

- **[scripts/purchase-rebate-diagnose.ps1](scripts/purchase-rebate-diagnose.ps1)**
  - Diagnostic tool để verify rebate calculations
  - So sánh expected vs API values
  - Check netFinalAmount, unitFinalCost

---

## 2. SCHEMA CỦA CÁC BẢNG LIÊN QUAN

### Model: PurchaseOrder
```prisma
model PurchaseOrder {
  id                        String     @id @default(cuid())
  referenceId               String     @unique
  supplierId                String
  storeId                   String?
  invoiceNo                 String?
  documentDate              DateTime?  @db.Date
  amount                    Decimal    @db.Decimal(18, 2)        # Gross amount (before rebate)
  paidAmount                Decimal    @default(0) @db.Decimal(18, 2)
  landedCost                Decimal    @default(0) @db.Decimal(18, 2)  # Vận chuyển, bốc vác
  rebateAmount              Decimal    @default(0) @db.Decimal(18, 2)  # Tổng chiết khấu
  rebateCogsAdjustment      Decimal    @default(0) @db.Decimal(18, 2)  # COGS adjustment (sold portion)
  rebateInventoryAdjustment Decimal    @default(0) @db.Decimal(18, 2)  # Inventory adjustment (unsold)
  rebatePurchasedQty        Int        @default(0)
  rebateSoldQty             Int        @default(0)
  voidedAt                  DateTime?
  voidReason                String?
  createdAt                 DateTime   @default(now())
  updatedAt                 DateTime   @updatedAt

  // Relations
  items                     PurchaseOrderItem[]
  rebates                   PurchaseRebate[]
  rebateAllocations         PurchaseRebateAllocation[]
  rebateBatchAllocations    PurchaseRebateBatchAllocation[]
}
```

### Model: PurchaseOrderItem
```prisma
model PurchaseOrderItem {
  id                  String  @id @default(cuid())
  purchaseOrderId     String
  productId           String
  quantity            Int
  unitCost            Decimal @db.Decimal(18, 2)
  lineAmount          Decimal @db.Decimal(18, 2)     # quantity * unitCost
  allocatedLandedCost Decimal @default(0) @db.Decimal(18, 2)  # Phần landed cost được phân bổ
  netAmount           Decimal @db.Decimal(18, 2)     # lineAmount + allocatedLandedCost
  unitNetCost         Decimal @db.Decimal(18, 2)     # netAmount / quantity
  
  // Metadata (từ note field):
  rebateAllocatedAmount Float?  # Phần chiết khấu được phân bổ cho item này
  netFinalAmount        Float?  # netAmount - rebateAllocatedAmount
  unitFinalCost         Float?  # netFinalAmount / quantity
}
```

### Model: PurchaseRebate (Rebate đơn lẻ)
```prisma
model PurchaseRebate {
  id                        String  @id @default(cuid())
  purchaseOrderId           String
  supplierId                String
  rebateBatchId             String?     # Link tới batch nếu là phần chiết khấu từ batch
  label                     String      # Ví dụ: "Chiết khấu thương mại"
  amount                    Decimal @db.Decimal(18, 2)
  note                      String?
  
  // Sold vs Unsold tracking
  purchasedQty              Int     @default(0)  # Tổng số lượng mua
  soldQty                   Int     @default(0)  # Số lượng đã bán
  soldRatio                 Decimal @default(0) @db.Decimal(9, 6)  # Ratio bán/mua
  
  // Adjustments
  cogsAdjustmentAmount      Decimal @default(0) @db.Decimal(18, 2)  # Phần COGS
  inventoryAdjustmentAmount Decimal @default(0) @db.Decimal(18, 2)  # Phần inventory
  
  createdAt                 DateTime @default(now())
  updatedAt                 DateTime @updatedAt

  // Relations
  purchaseOrder             PurchaseOrder
  rebateBatch               PurchaseRebateBatch?
  allocations               PurchaseRebateAllocation[]
}
```

### Model: PurchaseRebateBatch (Chiết khấu tổng)
```prisma
model PurchaseRebateBatch {
  id            String  @id @default(cuid())
  referenceId   String  @unique    # VD: PRB-1704067200000
  supplierId    String
  label         String
  totalAmount   Decimal @db.Decimal(18, 2)  # Tổng số tiền
  note          String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  // Relations
  supplier                 Partner
  childRebates             PurchaseRebate[]
  allocations              PurchaseRebateBatchAllocation[]
}
```

### Model: PurchaseRebateBatchAllocation
```prisma
model PurchaseRebateBatchAllocation {
  id              String  @id @default(cuid())
  rebateBatchId   String
  purchaseOrderId String
  allocatedAmount Decimal @db.Decimal(18, 2)  # Số tiền được phân bổ cho PO này
  createdAt       DateTime @default(now())

  // Relations
  rebateBatch     PurchaseRebateBatch  @relation(..., onDelete: Cascade)
  purchaseOrder   PurchaseOrder        @relation(..., onDelete: Cascade)

  @@unique([rebateBatchId, purchaseOrderId])
}
```

### Model: PurchaseRebateAllocation (Tracking từng allocation)
```prisma
model PurchaseRebateAllocation {
  id                  String   @id @default(cuid())
  purchaseRebateId    String
  purchaseOrderId     String
  allocatedAmount     Decimal  @db.Decimal(18, 2)
  allocationDate      DateTime @default(now())
  status              String   @default("CONFIRMED")
  createdAt           DateTime @default(now())

  // Relations
  purchaseRebate      PurchaseRebate  @relation(..., onDelete: Cascade)
  purchaseOrder       PurchaseOrder   @relation(..., onDelete: Cascade)

  @@unique([purchaseRebateId, purchaseOrderId])
}
```

---

## 3. CÁCH HIỆN TẠI XỬ LÝ PHÂN BỔ CHIẾT KHẤU

### 3.1 Cấu Trúc Dữ Liệu Metadata

Hệ thống lưu trữ metadata từng item trong note field của `PurchaseOrder` bằng cách append JSON:

```
Ghi nhan mua hang
##PURCHASE_META##{
  "items": [
    {
      "productId": "...",
      "quantity": 100,
      "unitCost": 1000,
      "lineAmount": 100000,
      "allocatedLandedCost": 5000,
      "netAmount": 105000,
      "unitNetCost": 1050,
      "rebateAllocatedAmount": 10000,     ← Phần chiết khấu
      "netFinalAmount": 95000,            ← Sau chiết khấu
      "unitFinalCost": 950                ← unitFinal/qty
    }
  ],
  "rebates": [
    {
      "label": "Chiết khấu thương mại",
      "amount": 10000,
      "purchasedQty": 100,
      "soldQty": 50,
      "soldRatio": 0.5,
      "cogsAdjustmentAmount": 5000,       ← 10000 * 0.5
      "inventoryAdjustmentAmount": 5000   ← 10000 * 0.5
    }
  ],
  "rebateInventoryCostAdjustments": [
    {
      "productId": "prod1",
      "qtyAtAdjustment": 50,              ← Số lượng tồn kho lúc điều chỉnh
      "perUnitAdjustment": 100,           ← Giảm 100 đ/cái
      "totalAdjustment": 5000,
      "previousCostPrice": 1050,
      "newCostPrice": 950
    }
  ]
}
```

### 3.2 Quy Trình Ghi Nhận Chiết Khấu (POST /purchases/:referenceId/rebates)

1. **Xác thực đầu vào**:
   - PO phải tồn tại, không bị void, có items
   - Chiết khấu không được vượt quá phần còn lại của PO (amount - paidAmount)

2. **Tính toán phân bổ chiết khấu cho từng item**:
   ```typescript
   // Phân bổ dựa trên netAmount của từng item
   totalRebateAmount = sum(rebates)
   totalNetAmount = sum(items.netAmount)
   
   forEach item:
     itemRatio = item.netAmount / totalNetAmount
     itemShare = totalRebateAmount * itemRatio
     // Last item lấy phần còn lại để tránh rounding error
   ```

3. **Tính Sold vs Unsold Ratio**:
   ```typescript
   // Dựa trên tồn kho hiện tại
   purchasedQty = sum(item.quantity)
   soldQty = purchasedQty - currentInventoryQty
   soldRatio = soldValue / purchasedValue  // Dùng giá trị, không phải qty
   ```

4. **Tách chiết khấu thành 2 phần**:
   - **COGS Adjustment**: `rebateAmount * soldRatio`
     → Giảm Cost of Goods Sold (hàng đã bán)
   - **Inventory Adjustment**: `rebateAmount * (1 - soldRatio)`
     → Giảm giá vốn sản phẩm tồn kho

5. **Cập nhật Product Cost Price**:
   ```typescript
   // Cho từng sản phẩm có tồn kho
   newCostPrice = currentCostPrice - (inventoryAdjustmentAmount / currentInventoryQty)
   ```

6. **Sync Database**:
   - Xóa toàn bộ PurchaseRebate cũ (nếu có)
   - Tạo mới PurchaseRebate với amounts từ công thức trên
   - Tạo PurchaseRebateAllocation entries
   - Update Partner netBalance (for accounting)

### 3.3 Quy Trình Phân Bổ Chiết Khấu Tổng (POST /purchases/rebate-batches)

Tương tự nhưng phân bổ 1 batch cho nhiều PO:

```
Batch Total: 50,000đ
├─ PO-A: 30,000đ
├─ PO-B: 20,000đ
└─ → Mỗi PO áp dụng logic tính toán bên trên riêng lẻ
```

Một PO có thể nhận rebate từ:
- Riêng lẻ: POST `:referenceId/rebates`
- Từ batch: POST `/rebate-batches` → tự động tạo child rebates
- Cả hai cùng lúc (rebates array sẽ chứa cả)

### 3.4 Delete & Rollback

**Khi xóa chiết khấu** → Rollback inventory cost price:
```typescript
// Rollback = Cộng lại phần đã giảm
rollbackDelta = adjustment.previousCostPrice - adjustment.newCostPrice
newCostPrice = product.costPrice + rollbackDelta
```

**Khi xóa batch** → Rollback tất cả PO liên quan trong transaction

---

## 4. VẤN ĐỀ & LIMITATION HIỆN TẠI

### 4.1 Vấn Đề Thiết Kế

#### 🔴 **Metadata lưu trong Note Field (Anti-pattern)**
- Metadata được serialize JSON và append vào note field với marker `##PURCHASE_META##`
- **Vấn đề**:
  - Dễ bị corrupt nếu note được update ngoài logic này
  - Khó query/sort/filter dựa trên rebate data
  - Size field VARCHAR tăng khi có nhiều rebates
  - Khó maintain/debug (JSON ẩn trong string)

**Khuyến cáo**: Tạo bảng `PurchaseItemMeta` riêng hoặc store JSON structure trong JSONB column

#### 🔴 **Rounding Errors**
- Dùng `Math.round(...+ Number.EPSILON) * 100 / 100` cho rounding
- Phân bổ cho item cuối cùng = `totalAmount - sumPreviousItems` (để fix error)
- **Vấn đề**:
  - Vẫn có thể accumulate error với nhiều items/rebates
  - Không consistent áp dụng "last item takes remainder" cho tất cả allocation

#### 🔴 **Moving Average Cost Recomputation**
```typescript
// Hiện tại phải lặp qua từng rebate adjustment trong PO note
// để recalculate cost price
```
- **Vấn đề**: Khi có nhiều rebates adjustment, việc parse note & recalculate rất phức tạp
- Không có audit trail cho cost price changes

### 4.2 Limitation Hiện Tại

#### ⚠️ **Tidak hỗ trợ Partial Rebate Application**
- Khi ghi nhận chiết khấu, LUÔN áp dụng toàn bộ cho tất cả PO
- Không thể chọn áp dụng rebate cho specific product/store subset

#### ⚠️ **Inventory Adjustment Dựa Trên Tồn Kho Lúc Apply**
```typescript
// Inventory quantity được lấy lúc apply rebate
currentInventoryQty = await tx.inventory.findMany(...)
```
- **Vấn đề**: Nếu apply rebate sau khi hàng được bán, giá vốn không adjust chính xác
- Không có time-series tracking của cost price changes

#### ⚠️ **Batch Rebate Không Hỗ Trợ Partial Allocation**
- Khi delete batch, LUÔN delete toàn bộ allocation
- Không thể delete 1 PO khỏi batch, giữ lại các PO khác

#### ⚠️ **Không Validate Rebate Amount vs Product Stock**
- Chiết khấu có thể lớn hơn tổng giá vốn tồn kho
- → Giá vốn có thể âm (được clamp thành 0)

**Ví dụ**:
```
Product: 100 units @ 1000đ = 100,000đ tồn
Rebate: 150,000đ (lớn hơn tồn kho)
→ Cost price = max(1000 - 1500, 0) = 0 ❌ Logic sai
```

### 4.3 Performance Concerns

#### ⚠️ **Transaction Complexity**
- `syncPurchaseRebateState()` làm N queries cho từng product (await trong loop)
- Không dùng batch query
- **Impact**: Chậm với PO có nhiều items (20+ items × N rebate adjustments)

#### ⚠️ **Metadata Size**
- Mỗi khi apply rebate, toàn bộ note field được update (thay vì incremental)
- Với 100+ rebate transactions, note field có thể > 1MB

#### ⚠️ **No Index on Rebate Queries**
```prisma
// Hiện tại chỉ có index [purchaseOrderId, createdAt]
// Không thể fast query: "Rebates >= 50,000đ from supplier X in period Y"
```

### 4.4 Test Coverage Issues

#### ⚠️ **Rebate Diagnose Script Limited**
- `purchase-rebate-diagnose.ps1` chỉ check total amounts
- Không verify:
  - Cost price changes theo sản phẩm
  - Exact allocation per item
  - Rounding error accumulation
  - Time-series correctness

#### ⚠️ **Missing Edge Case Tests**
- [ ] Rebate > total PO amount
- [ ] Rebate with 0 inventory (unsold product)
- [ ] Multiple batch rebates on same PO
- [ ] Rebate after partial PO void
- [ ] Rebate with currency rounding (VND vs other)

---

## 5. RECOMMENDATIONS

### Priority 1: Critical Issues
1. **Replace Metadata in Note Field**
   - Create `PurchaseItemRebateAllocation` table
   - OR use PostgreSQL JSONB column (if migrate from MySQL)

2. **Add Rebate Audit Trail**
   - Track each rebate application: who, when, old→new cost
   - Link to `RbacAuditLog`

### Priority 2: Data Integrity
1. **Validate Rebate Amount vs Available Cost**
   - Reject rebate if result in negative cost price

2. **Add Partial Batch Rebate Support**
   - Allow delete specific allocation from batch

### Priority 3: Performance
1. **Batch product updates** in `computePurchaseRebateTotals()`
   - Reduce N+1 query issue

2. **Add summary table** for rebate KPIs
   - Instead of parsing note field

---

## 6. API ENDPOINTS SUMMARY

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/purchases` | POST | Create PO |
| `/purchases/:referenceId/rebates` | POST | Add single rebate |
| `/purchases/:referenceId/rebates/:rebateIndex` | PATCH | Update rebate |
| `/purchases/:referenceId/rebates/:rebateIndex` | DELETE | Remove rebate |
| `/purchases/rebate-batches` | POST | Create batch rebate (multi-PO) |
| `/purchases/rebate-batches/:batchReferenceId` | DELETE | Delete batch & rollback |
| `/purchases/:referenceId` | GET | Fetch PO with rebate details |

---

## 7. FILE LOCATIONS QUICK REFERENCE

```
services/api/
├── prisma/
│   ├── schema.prisma              ← Models at line 601-780
│   └── migrations/                ← Past rebate schema changes
├── src/modules/purchases/
│   └── purchases.routes.ts        ← All rebate endpoints (3400+ lines)
└── runtime/
    └── rbac-audit.ndjson          ← Audit logs (if captured)

scripts/
├── purchase-rebate-batch-regression.ps1    ← Batch test
└── purchase-rebate-diagnose.ps1            ← Diagnostic tool
```

---

**Generated**: 2026-04-29  
**Schema Version**: Current  
**Test Status**: ✅ Batch regression passing

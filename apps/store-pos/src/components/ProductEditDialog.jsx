import { useRef, useState } from "react";
import { formatMoneyInput as formatCurrencyInput, formatCurrency } from "../utils/currency";

const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024;

export default function ProductEditDialog({
  product,
  categories = [],
  form,
  errors = {},
  message = "",
  creating = false,
  onClose,
  onSubmit,
  onChange,
  parseMoneyInput,
  onUploadImage = async () => null
}) {
  if (!product) return null;

  const fileInputRef = useRef(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");

  const gallery = Array.isArray(form.imageGallery) ? form.imageGallery : [];
  const imagePreview = gallery.find(g => g.isDefault)?.url || gallery[0]?.url || form.imageUrl?.trim() || product.imageUrl || "";
  const statusLabel = form.isActive ? "Đang kinh doanh" : "Ngừng kinh doanh";

  const renderFieldClassName = (field) => (errors[field] ? "form-control form-control--invalid" : "form-control");
  const renderFieldMessage = (field, hint) => {
    if (errors[field]) {
      return <div className="field-error">{errors[field]}</div>;
    }
    return hint ? <div className="field-hint">{hint}</div> : null;
  };

  const handlePickImageClick = () => {
    if (uploadingImage) return;
    fileInputRef.current?.click();
  };

  const handleImageFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setUploadMessage("Vui lòng chọn tệp ảnh hợp lệ (png, jpg, webp...).");
      event.target.value = "";
      return;
    }

    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      setUploadMessage("Ảnh vượt quá 5MB. Vui lòng chọn ảnh nhỏ hơn.");
      event.target.value = "";
      return;
    }

    try {
      setUploadingImage(true);
      setUploadMessage("");
      const currentGallery = Array.isArray(form.imageGallery) ? form.imageGallery : [];
      const uploaded = await onUploadImage(file, {
        makeDefault: currentGallery.length === 0,
        showOnCorporate: true
      });
      const nextGallery = Array.isArray(uploaded?.imageGallery) ? uploaded.imageGallery : currentGallery;
      const nextImageUrl = uploaded?.imageUrl || nextGallery.find((item) => item?.isDefault)?.url || nextGallery[0]?.url || "";
      onChange("imageGallery", nextGallery);
      onChange("imageUrl", nextImageUrl);
      setUploadMessage("Đã tải ảnh từ máy lên thành công.");
    } catch (error) {
      setUploadMessage(error?.message || "Tải ảnh thất bại.");
    } finally {
      setUploadingImage(false);
      event.target.value = "";
    }
  };

  return (
    <div className="dialog-overlay dialog-overlay--stack" onClick={onClose}>
      <div className="dialog-panel dialog-panel--product-edit" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <div>
            <h2>Sửa sản phẩm</h2>
            <p className="product-edit-header-note">
              Cập nhật thông tin cơ bản, giá bán và trạng thái kinh doanh
            </p>
          </div>
          <button className="close-btn" type="button" onClick={onClose} aria-label="Đóng">x</button>
        </div>
        <div className="dialog-body">
          <section className="product-edit-hero detail-card">
            <div className="product-edit-hero__media">
              {imagePreview ? (
                <img className="product-edit-thumb" src={imagePreview} alt={form.name || product.name} />
              ) : (
                <div className="product-edit-thumb product-edit-thumb--placeholder">IMG</div>
              )}
            </div>
            <div className="product-edit-hero__content">
              <div>
                <span className="product-edit-eyebrow">Mã {form.sku || product.sku}</span>
                <h3>{form.name || product.name}</h3>
                <p>{form.productType === "SERVICE" ? "Dịch vụ" : "Hàng hóa"} · {form.unit || "Chưa có đơn vị"}</p>
              </div>
              <div className="product-edit-chip-row">
                <span className="product-edit-chip">{statusLabel}</span>
                <span className="product-edit-chip">Giá bán {formatCurrency(Number(form.defaultPrice || 0))}</span>
              </div>
            </div>
          </section>

          {message ? <div className="form-banner form-banner--error">{message}</div> : null}

          <div className="detail-card">
            <h3>Thông tin cơ bản</h3>
            <div className="product-edit-inline-grid">
              <div className="product-edit-inline-row">
                <label className="product-edit-inline-label">SKU</label>
                <div className="product-edit-inline-control">
                  <input className={renderFieldClassName("sku")} value={form.sku} onChange={(e) => onChange("sku", e.target.value)} />
                  {renderFieldMessage("sku", "Tối thiểu 2 ký tự, nên ngắn gọn và dễ tìm.")}
                </div>
              </div>
              <div className="product-edit-inline-row">
                <label className="product-edit-inline-label">Tên sản phẩm</label>
                <div className="product-edit-inline-control">
                  <input className={renderFieldClassName("name")} value={form.name} onChange={(e) => onChange("name", e.target.value)} />
                  {renderFieldMessage("name")}
                </div>
              </div>
              <div className="product-edit-inline-row">
                <label className="product-edit-inline-label">Loại sản phẩm</label>
                <div className="product-edit-inline-control">
                  <select className={renderFieldClassName("productType")} value={form.productType} onChange={(e) => onChange("productType", e.target.value)}>
                    <option value="GOODS">Hàng hóa</option>
                    <option value="SERVICE">Dịch vụ</option>
                  </select>
                  {renderFieldMessage("productType")}
                </div>
              </div>
              <div className="product-edit-inline-row">
                <label className="product-edit-inline-label">Danh mục</label>
                <div className="product-edit-inline-control">
                  <select className={renderFieldClassName("categoryId")} value={form.categoryId} onChange={(e) => onChange("categoryId", e.target.value)}>
                    <option value="">Chọn danh mục</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </select>
                  {renderFieldMessage("categoryId")}
                </div>
              </div>
              <div className="product-edit-inline-row">
                <label className="product-edit-inline-label">Đơn vị</label>
                <div className="product-edit-inline-control">
                  <input className={renderFieldClassName("unit")} value={form.unit} onChange={(e) => onChange("unit", e.target.value)} />
                  {renderFieldMessage("unit")}
                </div>
              </div>
              <div className="product-edit-inline-row">
                <label className="product-edit-inline-label">Ảnh sản phẩm</label>
                <div className="product-edit-inline-control product-edit-image-control">
                  {gallery.length > 0 ? (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                      {gallery.map((img, idx) => (
                        <div key={idx} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                          <img src={img.url} alt={`Ảnh ${idx + 1}`} style={{ width: 64, height: 64, borderRadius: 8, objectFit: "cover", border: img.isDefault ? "2px solid #3b82f6" : "1px solid #e2e8f0" }} />
                          <div style={{ display: "flex", gap: 3 }}>
                            {!img.isDefault ? (
                              <button type="button" style={{ fontSize: 11, padding: "1px 5px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 4, cursor: "pointer", color: "#2563eb" }}
                                onClick={() => onChange("imageGallery", gallery.map((g, i) => ({ ...g, isDefault: i === idx })))}>
                                Mặc định
                              </button>
                            ) : (
                              <span style={{ fontSize: 11, color: "#2563eb", fontWeight: 600 }}>✓ Mặc định</span>
                            )}
                            <button type="button" style={{ fontSize: 11, padding: "1px 5px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 4, cursor: "pointer", color: "#dc2626" }}
                              onClick={() => {
                                const next = gallery.filter((_, i) => i !== idx);
                                if (next.length > 0 && !next.some(g => g.isDefault)) next[0] = { ...next[0], isDefault: true };
                                onChange("imageGallery", next);
                                onChange("imageUrl", next.find((item) => item.isDefault)?.url || next[0]?.url || "");
                              }}>
                              Xóa
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="product-edit-image-actions">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={handlePickImageClick}
                      disabled={uploadingImage}
                    >
                      {uploadingImage ? "Đang tải ảnh..." : "Đính kèm thêm ảnh"}
                    </button>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="product-edit-file-input"
                    onChange={handleImageFileChange}
                  />
                  {uploadMessage ? <div className="field-hint">{uploadMessage}</div> : null}
                </div>
              </div>
            </div>
          </div>

          <div className="detail-card">
            <h3>Giá và điểm thưởng</h3>
            <div className="product-edit-inline-grid">
              <div className="product-edit-inline-row">
                <label className="product-edit-inline-label">Giá bán</label>
                <div className="product-edit-inline-control">
                  <input
                    className={`${renderFieldClassName("defaultPrice")} form-control--right`}
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    value={formatCurrencyInput(form.defaultPrice)}
                    onChange={(e) => onChange("defaultPrice", parseMoneyInput(e.target.value))}
                  />
                  {renderFieldMessage("defaultPrice")}
                </div>
              </div>
              <div className="product-edit-inline-row">
                <label className="product-edit-inline-label">Giá cấp 2</label>
                <div className="product-edit-inline-control">
                  <input
                    className={`${renderFieldClassName("level2Price")} form-control--right`}
                    type="text"
                    inputMode="numeric"
                    placeholder="Để trống nếu chưa áp dụng"
                    value={formatCurrencyInput(form.level2Price)}
                    onChange={(e) => onChange("level2Price", parseMoneyInput(e.target.value))}
                  />
                  {renderFieldMessage("level2Price", "Áp dụng cho khách hàng thuộc nhóm giá cấp 2.")}
                </div>
              </div>
              <div className="product-edit-inline-row">
                <label className="product-edit-inline-label">Giá cấp 2 đặc biệt</label>
                <div className="product-edit-inline-control">
                  <input
                    className={`${renderFieldClassName("level2SpecialPrice")} form-control--right`}
                    type="text"
                    inputMode="numeric"
                    placeholder="Để trống nếu chưa áp dụng"
                    value={formatCurrencyInput(form.level2SpecialPrice)}
                    onChange={(e) => onChange("level2SpecialPrice", parseMoneyInput(e.target.value))}
                  />
                  {renderFieldMessage("level2SpecialPrice", "Dành cho khách hàng ưu tiên trong nhóm cấp 2.")}
                </div>
              </div>
              <div className="product-edit-inline-row">
                <label className="product-edit-inline-label">Giá khuyến mại</label>
                <div className="product-edit-inline-control">
                  <input
                    className={`${renderFieldClassName("promoPrice")} form-control--right`}
                    type="text"
                    inputMode="numeric"
                    placeholder="Để trống nếu chưa áp dụng"
                    value={formatCurrencyInput(form.promoPrice)}
                    onChange={(e) => onChange("promoPrice", parseMoneyInput(e.target.value))}
                  />
                  {renderFieldMessage("promoPrice", "Giá ưu đãi theo chiến dịch bán hàng hiện hành.")}
                </div>
              </div>
              <div className="product-edit-inline-row">
                <label className="product-edit-inline-label">Điểm thưởng</label>
                <div className="product-edit-inline-control">
                  <input
                    className={renderFieldClassName("rewardPoints")}
                    type="number"
                    min="0"
                    value={form.rewardPoints}
                    onChange={(e) => onChange("rewardPoints", e.target.value)}
                  />
                  {renderFieldMessage("rewardPoints")}
                </div>
              </div>
              <div className="product-edit-inline-row">
                <label className="product-edit-inline-label">Điểm đổi quà</label>
                <div className="product-edit-inline-control">
                  <input
                    className={renderFieldClassName("giftPointsCost")}
                    type="number"
                    min="0"
                    value={form.giftPointsCost}
                    onChange={(e) => onChange("giftPointsCost", e.target.value)}
                  />
                  {renderFieldMessage("giftPointsCost", "Số điểm bị trừ khi khách dùng điểm để nhận quà.")}
                </div>
              </div>
            </div>
          </div>

          <div className="detail-card">
            <h3>Trạng thái</h3>
            <label className="checkbox-row product-edit-checkbox-row">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => onChange("isActive", e.target.checked)}
              />
              Đang kinh doanh
            </label>
          </div>
        </div>
        <div className="dialog-footer">
          <button type="button" className="btn-cancel" onClick={onClose} disabled={creating}>Hủy</button>
          <button type="button" className="btn-primary" onClick={onSubmit} disabled={creating}>
            {creating ? "Đang lưu..." : "Lưu cập nhật"}
          </button>
        </div>
      </div>
    </div>
  );
}
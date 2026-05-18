import { useEffect, useMemo, useState } from "react";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://localhost:4000").replace(/\/$/, "");
const PAGE_SIZE = 12;

function toSlug(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function getProductLink(product) {
  if (!product?.id) return "/san-pham";
  const slug = product.slug || `${toSlug(product.name) || "san-pham"}-${product.id}`;
  return `/san-pham/${slug}`;
}

function getProductIdFromPath(pathname) {
  const match = /^\/san-pham\/([^/]+)$/.exec(pathname || "");
  if (!match) return "";
  const slug = decodeURIComponent(match[1]);
  const idx = slug.lastIndexOf("-");
  if (idx < 0) return "";
  return slug.slice(idx + 1);
}

async function fetchPublicProducts({ search }) {
  const url = new URL(`${API_BASE_URL}/api/public/products`);
  url.searchParams.set("page", "1");
  url.searchParams.set("pageSize", "60");
  if (search) url.searchParams.set("search", search);
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.message || "Không tải được danh sách sản phẩm");
  }
  return Array.isArray(payload?.data?.data) ? payload.data.data : [];
}

async function fetchPublicProductsPaged({ search, page, pageSize }) {
  const url = new URL(`${API_BASE_URL}/api/public/products`);
  url.searchParams.set("page", String(page));
  url.searchParams.set("pageSize", String(pageSize));
  if (search) url.searchParams.set("search", search);
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.message || "Không tải được danh sách sản phẩm");
  }
  const data = payload?.data || {};
  return {
    data: Array.isArray(data?.data) ? data.data : [],
    total: Number(data?.total || 0),
    page: Number(data?.page || page),
    pageSize: Number(data?.pageSize || pageSize),
    totalPages: Number(data?.totalPages || 1)
  };
}

async function fetchPublicProductById(id) {
  const response = await fetch(`${API_BASE_URL}/api/public/products/${id}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.message || "Không tải được chi tiết sản phẩm");
  }
  return payload?.data || null;
}

async function submitConsultationRequest(payload) {
  const response = await fetch(`${API_BASE_URL}/api/public/products/consultations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || "Không gửi được yêu cầu tư vấn");
  }
  return data;
}

function ProductCard({ product }) {
  const gallery = Array.isArray(product?.corporateImageUrls)
    ? product.corporateImageUrls
    : (Array.isArray(product?.imageGallery) ? product.imageGallery.map((item) => item?.url).filter(Boolean) : []);
  const imageUrl = gallery[0] || product?.imageUrl || "https://placehold.co/720x520/f4f0e8/455560?text=San+pham";
  return (
    <article className="product-card">
      <a className="product-thumb-wrap" href={getProductLink(product)}>
        <img className="product-thumb" src={imageUrl} alt={product?.name || "Sản phẩm"} loading="lazy" />
      </a>
      <div className="product-content">
        <p className="product-category">{product?.category?.name || "Chưa phân loại"}</p>
        <h3>
          <a href={getProductLink(product)}>{product?.name || "Sản phẩm"}</a>
        </h3>
        <p className="product-sku">Mã hàng: {product?.sku || "-"}</p>
        <div className="product-actions">
          <a className="btn-outline" href={getProductLink(product)}>Xem chi tiết</a>
          <a className="btn-primary" href={getProductLink(product)}>Tư vấn</a>
        </div>
      </div>
    </article>
  );
}

function ConsultDialog({ product, consultForm, consultSubmitting, consultMessage, onConsultChange, onConsultSubmit, onClose }) {
  // Đóng khi click backdrop
  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };
  // Đóng khi nhấn Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onClick={handleBackdropClick} role="dialog" aria-modal="true" aria-label="Tư vấn nhận báo giá">
      <div className="dialog-panel">
        <div className="dialog-header">
          <div>
            <h2>Nhận báo giá và tư vấn</h2>
            <p className="dialog-sub">{product?.name || "Sản phẩm"}</p>
          </div>
          <button className="dialog-close" type="button" onClick={onClose} aria-label="Đóng">
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <line x1="4" y1="4" x2="16" y2="16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              <line x1="16" y1="4" x2="4" y2="16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
        <p className="dialog-desc">Để lại thông tin, đội ngũ sẽ liên hệ tư vấn và báo giá theo nhu cầu thực tế.</p>
        {consultMessage ? (
          <p className="dialog-message">{consultMessage}</p>
        ) : (
          <form className="consult-form" onSubmit={onConsultSubmit}>
            <label>
              Họ và tên
              <input value={consultForm.fullName} onChange={(e) => onConsultChange("fullName", e.target.value)} required autoFocus />
            </label>
            <label>
              Số điện thoại
              <input value={consultForm.phone} onChange={(e) => onConsultChange("phone", e.target.value)} required />
            </label>
            <label>
              Email
              <input type="email" value={consultForm.email} onChange={(e) => onConsultChange("email", e.target.value)} />
            </label>
            <label>
              Địa chỉ
              <input value={consultForm.address} onChange={(e) => onConsultChange("address", e.target.value)} placeholder="Tỉnh/thành phố, quận/huyện..." />
            </label>
            <label className="consult-form-full">
              Ghi chú
              <textarea rows={3} value={consultForm.note} onChange={(e) => onConsultChange("note", e.target.value)} />
            </label>
            <div className="consult-form-full consult-actions">
              <button type="submit" className="btn-primary" disabled={consultSubmitting}>
                {consultSubmitting ? "Đang gửi..." : "Gửi yêu cầu tư vấn"}
              </button>
              <button type="button" className="btn-outline" onClick={onClose}>Hủy</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function ProductDetail({ product, consultForm, consultSubmitting, consultMessage, onConsultChange, onConsultSubmit }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  if (!product) return null;

  const gallery = Array.isArray(product?.corporateImageUrls) && product.corporateImageUrls.length > 0
    ? product.corporateImageUrls
    : (Array.isArray(product?.imageGallery) ? product.imageGallery.map((item) => item?.url).filter(Boolean) : []);
  const fallbackImage = product.imageUrl || "https://placehold.co/1100x640/f4f0e8/455560?text=San+pham";
  const images = gallery.length > 0 ? gallery : [fallbackImage];
  const primaryImage = images[activeIndex] || fallbackImage;

  useEffect(() => {
    setActiveIndex(0);
  }, [product?.id]);

  const goTo = (idx) => setActiveIndex((idx + images.length) % images.length);
  const goPrev = () => goTo(activeIndex - 1);
  const goNext = () => goTo(activeIndex + 1);

  useEffect(() => {
    if (images.length < 2) return;
    const handler = (e) => {
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [activeIndex, images.length]);

  return (
    <>
    <section className="product-detail-layout">
      <div className="product-detail-media">
        <div className="product-detail-main-img-wrap">
          <img src={primaryImage} alt={product.name || "Sản phẩm"} />
          {images.length > 1 && (
            <>
              <button type="button" className="gallery-arrow gallery-arrow--prev" onClick={goPrev} aria-label="Ảnh trước">
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><polyline points="13 4 7 10 13 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              <button type="button" className="gallery-arrow gallery-arrow--next" onClick={goNext} aria-label="Ảnh sau">
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><polyline points="7 4 13 10 7 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              <span className="gallery-counter">{activeIndex + 1} / {images.length}</span>
            </>
          )}
        </div>
        {images.length > 1 ? (
          <div className="product-detail-thumbs">
            {images.map((url, idx) => (
              <button
                key={url}
                type="button"
                className={`product-detail-thumb-btn ${activeIndex === idx ? "active" : ""}`}
                onClick={() => setActiveIndex(idx)}
                aria-label={`Xem ảnh ${idx + 1}`}
                aria-current={activeIndex === idx ? "true" : undefined}
              >
                <img src={url} alt={`${product.name || "Sản phẩm"} – ảnh ${idx + 1}`} loading="lazy" />
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="product-detail-main">
        <p className="product-category">{product.category?.name || "Chưa phân loại"}</p>
        <h1>{product.name || "Chi tiết sản phẩm"}</h1>
        <p className="product-sku">Mã hàng: {product.sku || "-"} · Đơn vị: {product.unit || "-"}</p>

        <div className="detail-sections">
          <article>
            <h3>Thành phần</h3>
            <p>{product.ingredients || "Liên hệ để được gửi thông tin thành phần chi tiết."}</p>
          </article>
          <article>
            <h3>Công dụng</h3>
            <p>{product.benefits || "Liên hệ đội ngũ tư vấn để được hướng dẫn theo nhu cầu."}</p>
          </article>
          <article>
            <h3>Hướng dẫn sử dụng</h3>
            <p>{product.usageGuide || "Đội ngũ kỹ thuật sẽ gửi quy trình sử dụng phù hợp."}</p>
          </article>
        </div>

        <div className="product-actions product-actions--detail">
          <button className="btn-primary" type="button" onClick={() => setDialogOpen(true)}>Tư vấn nhận báo giá</button>
          <a className="btn-outline" href="/san-pham">Xem thêm sản phẩm</a>
        </div>
      </div>
    </section>

    {dialogOpen ? (
      <ConsultDialog
        product={product}
        consultForm={consultForm}
        consultSubmitting={consultSubmitting}
        consultMessage={consultMessage}
        onConsultChange={onConsultChange}
        onConsultSubmit={onConsultSubmit}
        onClose={() => setDialogOpen(false)}
      />
    ) : null}
    </>
  );
}

function HomePage({ onNavigate }) {
  return (
    <div className="home-page">
      <section className="home-hero">
        <div className="home-hero-inner">
          <p className="home-hero-tag">Doanh nghiệp thủy sản &amp; Phân phối thức ăn chăn nuôi</p>
          <h1>CÔNG TY TNHH MTV<br />NUÔI TRỒNG THỦY SẢN<br />TÁ TIẾN</h1>
          <p className="home-hero-desc">Đơn vị hoạt động đa lĩnh vực, tập trung vào chuỗi giá trị nông nghiệp - thủy sản tại khu vực miền Trung và Tây Nguyên, đồng hành cùng khách hàng bằng chất lượng và uy tín pháp lý rõ ràng.</p>
          <div className="home-hero-meta">
            <span>MST: 6101311429</span>
            <span>Người đại diện: NGUYỄN HỮU TIẾN</span>
            <span>Số 544 Hùng Vương, Xã Đăk Hà, Tỉnh Quảng Ngãi</span>
          </div>
          <div className="home-hero-actions">
            <a className="btn-primary" href="/san-pham" onClick={(e) => { e.preventDefault(); onNavigate("/san-pham"); }}>Xem sản phẩm</a>
            <a className="btn-outline" href="/gioi-thieu" onClick={(e) => { e.preventDefault(); onNavigate("/gioi-thieu"); }}>Về chúng tôi</a>
          </div>
        </div>
      </section>

      <section className="home-services">
        <h2>Ngành nghề hoạt động</h2>
        <p className="home-services-sub">Công ty cung cấp sản phẩm và dịch vụ theo hướng bền vững, hỗ trợ phát triển sản xuất cho hộ gia đình và doanh nghiệp.</p>
        <div className="home-services-grid">
          <article className="home-service-card">
            <div className="home-service-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            </div>
            <h3>Phân phối thức ăn</h3>
            <p>Phân phối thức ăn gia súc, gia cầm, thủy sản từ các thương hiệu PROCONCO, VIETHOA và WOOSUNG.</p>
          </article>
          <article className="home-service-card">
            <div className="home-service-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
            </div>
            <h3>Sản xuất giống cá</h3>
            <p>Cung cấp giống cá Rô phi, Diêu hồng, Trắm, Chép với quy trình nuôi trồng và kiểm soát chất lượng.</p>
          </article>
          <article className="home-service-card">
            <div className="home-service-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 5v3h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
            </div>
            <h3>Vận tải hàng hóa</h3>
            <p>Dịch vụ vận chuyển hàng hóa phục vụ chuỗi cung ứng nông nghiệp và thủy sản theo nhu cầu thực tế.</p>
          </article>
          <article className="home-service-card">
            <div className="home-service-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/></svg>
            </div>
            <h3>Đại lý thuốc</h3>
            <p>Phân phối thuốc thú y và thủy sản chính hãng, hỗ trợ kỹ thuật sử dụng an toàn và hiệu quả.</p>
          </article>
        </div>
      </section>

      <section className="home-about">
        <div className="home-about-inner">
          <div className="home-about-text">
            <h2>Giới thiệu ngắn</h2>
            <p>TÁ TIẾN định hướng trở thành đối tác tin cậy trong lĩnh vực cung ứng vật tư và dịch vụ liên quan đến nông nghiệp - thủy sản. Doanh nghiệp chú trọng pháp lý minh bạch, vận hành ổn định và chăm sóc khách hàng lâu dài.</p>
            <a className="btn-outline" href="/gioi-thieu" onClick={(e) => { e.preventDefault(); onNavigate("/gioi-thieu"); }}>Xem thêm về chúng tôi</a>
          </div>
          <div className="home-legal-card">
            <h3>Thông tin pháp lý</h3>
            <ul>
              <li><span>Tên doanh nghiệp</span><strong>CÔNG TY TNHH MTV NUÔI TRỒNG THỦY SẢN TÁ TIẾN</strong></li>
              <li><span>Mã số thuế</span><strong>6101311429</strong></li>
              <li><span>Người đại diện</span><strong>NGUYỄN HỮU TIẾN</strong></li>
              <li><span>Địa chỉ</span><strong>Số 544 Hùng Vương, Xã Đăk Hà, Tỉnh Quảng Ngãi, Việt Nam</strong></li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}

function AboutPage() {
  return (
    <div className="policy-page">
      <h1>Giới thiệu doanh nghiệp</h1>

      <section>
        <p>CÔNG TY TNHH MTV NUÔI TRỒNG THỦY SẢN TÁ TIẾN được xây dựng trên định hướng phát triển bền vững trong lĩnh vực nông nghiệp - thủy sản, đồng thời mở rộng năng lực phân phối và dịch vụ hậu cần phục vụ thị trường địa phương.</p>
      </section>

      <section>
        <h2>Sứ mệnh</h2>
        <p>Cung cấp sản phẩm và dịch vụ đáng tin cậy, hỗ trợ người chăn nuôi và nuôi trồng thủy sản nâng cao năng suất, tối ưu chi phí và đảm bảo chất lượng đầu ra.</p>
      </section>

      <section>
        <h2>Tầm nhìn</h2>
        <p>Trở thành doanh nghiệp được khách hàng tin chọn tại khu vực, vận hành minh bạch, tuân thủ pháp luật và liên tục cải tiến giá trị phục vụ.</p>
      </section>

      <section>
        <h2>Lĩnh vực hoạt động</h2>
        <ul>
          <li>Phân phối thức ăn gia súc - gia cầm - thủy sản: PROCONCO, VIETHOA, WOOSUNG.</li>
          <li>Sản xuất giống cá: Rô phi, Diêu hồng, Trắm, Chép.</li>
          <li>Vận tải hàng hóa: hỗ trợ giao nhận cho đối tác và khách hàng.</li>
          <li>Đại lý thuốc thú y và thủy sản: cung cấp sản phẩm đúng nguồn gốc, đúng hướng dẫn.</li>
        </ul>
      </section>

      <section>
        <h2>Thông tin pháp lý</h2>
        <p>
          <strong>Tên công ty:</strong> CÔNG TY TNHH MTV NUÔI TRỒNG THỦY SẢN TÁ TIẾN<br />
          <strong>Mã số thuế:</strong> 6101311429<br />
          <strong>Người đại diện:</strong> NGUYỄN HỮU TIẾN<br />
          <strong>Địa chỉ hiện tại:</strong> Số 544 Hùng Vương, Xã Đăk Hà, Tỉnh Quảng Ngãi, Việt Nam<br />
          <strong>Địa chỉ cũ:</strong> Số 544 Hùng Vương, Huyện Đăk Hà, Tỉnh Kon Tum, Việt Nam
        </p>
      </section>
    </div>
  );
}

function PrivacyPage() {
  return (
    <div className="policy-page">
      <h1>Chính sách bảo mật</h1>
      <p className="policy-updated">Cập nhật lần cuối: 01/05/2026</p>

      <section>
        <h2>1. Thông tin chúng tôi thu thập</h2>
        <p>Khi bạn điền vào biểu mẫu tư vấn trên website, chúng tôi thu thập các thông tin sau: họ và tên, số điện thoại, địa chỉ email, tên công ty và nội dung ghi chú kèm theo. Chúng tôi không thu thập thông tin cá nhân khi bạn chỉ duyệt danh mục sản phẩm.</p>
      </section>

      <section>
        <h2>2. Mục đích sử dụng thông tin</h2>
        <p>Thông tin được thu thập nhằm mục đích liên hệ tư vấn và báo giá theo yêu cầu của bạn. Chúng tôi không sử dụng thông tin này cho mục đích marketing không được yêu cầu hoặc chia sẻ cho bên thứ ba ngoài phạm vi cung cấp dịch vụ trực tiếp.</p>
      </section>

      <section>
        <h2>3. Lưu trữ và bảo mật</h2>
        <p>Thông tin yêu cầu tư vấn được lưu trữ an toàn trên hệ thống nội bộ của công ty. Chúng tôi áp dụng các biện pháp kỹ thuật và tổ chức phù hợp để bảo vệ dữ liệu khỏi truy cập trái phép, mất mát hoặc tiết lộ ngoài ý muốn.</p>
      </section>

      <section>
        <h2>4. Quyền của bạn</h2>
        <p>Bạn có quyền yêu cầu xem, chỉnh sửa hoặc xóa thông tin cá nhân đã cung cấp bằng cách liên hệ trực tiếp với chúng tôi qua các kênh được nêu tại phần thông tin công ty ở cuối trang.</p>
      </section>

      <section>
        <h2>5. Cookie và dữ liệu trình duyệt</h2>
        <p>Website này không sử dụng cookie theo dõi hay công cụ phân tích bên thứ ba. Chúng tôi không theo dõi hành vi duyệt web của bạn.</p>
      </section>

      <section>
        <h2>6. Liên hệ</h2>
        <p>Mọi thắc mắc về chính sách bảo mật vui lòng liên hệ:<br />
        <strong>Công ty TNHH MTV Nuôi Trồng Thủy Sản Tá Tiến</strong><br />
        Địa chỉ: 544 Hùng Vương, Xã Đăk Hà, Tỉnh Quảng Ngãi, Việt Nam<br />
        MST: 6101311429
        </p>
      </section>
    </div>
  );
}

function setMetaTag(selector, attrs, content) {
  if (!content) return;
  let tag = document.head.querySelector(selector);
  if (!tag) {
    tag = document.createElement("meta");
    Object.entries(attrs).forEach(([key, value]) => {
      tag.setAttribute(key, value);
    });
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

function getArticleSlugFromPath(pathname) {
  const match = /^\/tin-tuc\/([^/]+)$/.exec(pathname || "");
  return match ? decodeURIComponent(match[1]) : "";
}

function getArticleLink(article) {
  if (!article?.slug) return "/tin-tuc";
  return `/tin-tuc/${article.slug}`;
}

function resolveMediaUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw) || raw.startsWith("data:")) return raw;
  if (raw.startsWith("/")) return `${API_BASE_URL}${raw}`;
  return `${API_BASE_URL}/${raw.replace(/^\/+/, "")}`;
}

async function fetchPublicArticles({ search, category, page, pageSize }) {
  const url = new URL(`${API_BASE_URL}/api/public/articles`);
  url.searchParams.set("page", String(page));
  url.searchParams.set("pageSize", String(pageSize));
  if (search) url.searchParams.set("search", search);
  if (category) url.searchParams.set("category", category);
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.message || "Không tải được bài viết");
  const data = payload?.data || {};
  return {
    data: Array.isArray(data?.data) ? data.data : [],
    total: Number(data?.total || 0),
    totalPages: Number(data?.totalPages || 1)
  };
}

async function fetchPublicArticleBySlug(slug) {
  const response = await fetch(`${API_BASE_URL}/api/public/articles/${encodeURIComponent(slug)}`);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.message || "Không tải được bài viết");
  return payload?.data || null;
}

const ARTICLE_CATEGORY_LABELS = {
  news: "Tin tức",
  knowledge: "Kiến thức",
  promotion: "Khuyến mại",
  guide: "Hướng dẫn"
};

function ArticleCard({ article, onNavigate }) {
  const cover = resolveMediaUrl(article.coverImage) || "https://placehold.co/720x400/f4f0e8/455560?text=Bai+Viet";
  const publishedAt = article.publishedAt ? new Date(article.publishedAt).toLocaleDateString("vi-VN") : "";
  return (
    <article className="article-card">
      <a className="article-thumb-wrap" href={getArticleLink(article)} onClick={(e) => { e.preventDefault(); onNavigate(getArticleLink(article)); }}>
        <img className="article-thumb" src={cover} alt={article.title} loading="lazy" />
      </a>
      <div className="article-content">
        <div className="article-meta">
          <span className="article-category">{ARTICLE_CATEGORY_LABELS[article.category] || article.category}</span>
          {publishedAt && <span className="article-date">{publishedAt}</span>}
        </div>
        <h3><a href={getArticleLink(article)} onClick={(e) => { e.preventDefault(); onNavigate(getArticleLink(article)); }}>{article.title}</a></h3>
        {article.seoDesc && <p className="article-excerpt">{article.seoDesc}</p>}
        <a className="btn-outline article-read-more" href={getArticleLink(article)} onClick={(e) => { e.preventDefault(); onNavigate(getArticleLink(article)); }}>Đọc thêm</a>
      </div>
    </article>
  );
}

function ArticleDetailPage({ slug, onNavigate }) {
  const [article, setArticle] = useState(null);
  const [loadingArticle, setLoadingArticle] = useState(true);
  const [errorArticle, setErrorArticle] = useState("");
  const [relatedArticles, setRelatedArticles] = useState([]);
  const [loadingRelated, setLoadingRelated] = useState(false);

  useEffect(() => {
    setLoadingArticle(true);
    setErrorArticle("");
    fetchPublicArticleBySlug(slug)
      .then(setArticle)
      .catch((e) => setErrorArticle(e.message))
      .finally(() => setLoadingArticle(false));
  }, [slug]);

  useEffect(() => {
    if (!article?.slug) {
      setRelatedArticles([]);
      return;
    }

    let cancelled = false;
    setLoadingRelated(true);

    const loadRelatedArticles = async () => {
      try {
        const sameCategory = await fetchPublicArticles({
          search: "",
          category: article.category || "",
          page: 1,
          pageSize: 12
        });

        const related = (sameCategory?.data || []).filter((item) => item?.slug && item.slug !== article.slug);

        if (!cancelled) {
          setRelatedArticles(related.slice(0, 6));
        }
      } catch (_e) {
        if (!cancelled) {
          setRelatedArticles([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingRelated(false);
        }
      }
    };

    loadRelatedArticles();
    return () => {
      cancelled = true;
    };
  }, [article?.slug, article?.category]);

  function renderContent(text) {
    const escaped = (text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return escaped.split(/\n\n+/).map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`).join("");
  }

  if (loadingArticle) return <p className="status-text">Đang tải bài viết...</p>;
  if (errorArticle || !article) return <p className="status-text">Không tìm thấy bài viết.</p>;

  const publishedAt = article.publishedAt ? new Date(article.publishedAt).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
  const coverImage = resolveMediaUrl(article.coverImage) || "https://placehold.co/1100x620/f4f0e8/455560?text=Bai+Viet";

  return (
    <article className="article-detail">
      <nav className="article-breadcrumb">
        <a href="/" onClick={(e) => { e.preventDefault(); onNavigate("/"); }}>Trang chủ</a>
        <span> / </span>
        <a href="/tin-tuc" onClick={(e) => { e.preventDefault(); onNavigate("/tin-tuc"); }}>Tin tức & Kiến thức</a>
        <span> / </span>
        <span>{article.title}</span>
      </nav>
      <img className="article-detail-cover" src={coverImage} alt={article.title} />
      <div className="article-detail-header">
        <div className="article-meta">
          <span className="article-category">{ARTICLE_CATEGORY_LABELS[article.category] || article.category}</span>
          {publishedAt && <span className="article-date">{publishedAt}</span>}
        </div>
        <h1 className="article-detail-title">{article.title}</h1>
        {article.seoDesc && <p className="article-detail-desc">{article.seoDesc}</p>}
      </div>
      <div
        className="article-detail-body"
        dangerouslySetInnerHTML={{ __html: renderContent(article.content) }}
      />

      <section className="article-related-section">
        <h2>Bài viết liên quan</h2>
        {loadingRelated ? (
          <p className="article-related-empty">Đang tải bài viết liên quan...</p>
        ) : relatedArticles.length === 0 ? (
          <p className="article-related-empty">Chưa có bài viết cùng danh mục.</p>
        ) : (
          <ul className="article-related-list">
            {relatedArticles.map((item) => {
              return (
                <li key={item.id || item.slug} className="article-related-item">
                  <a
                    href={getArticleLink(item)}
                    className="article-related-link"
                    onClick={(e) => {
                      e.preventDefault();
                      onNavigate(getArticleLink(item));
                    }}
                  >
                    {item.title}
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="article-detail-back">
        <a href="/tin-tuc" className="btn-outline" onClick={(e) => { e.preventDefault(); onNavigate("/tin-tuc"); }}>← Quay lại danh sách</a>
      </div>
    </article>
  );
}

export default function App() {
  const [maintenance, setMaintenance] = useState({ checked: false, active: false, message: "" });
  const [search, setSearch] = useState("");
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [pathname, setPathname] = useState(() => window.location.pathname || "/");
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [consultForm, setConsultForm] = useState({
    fullName: "",
    phone: "",
    email: "",
    address: "",
    note: ""
  });
  const [consultSubmitting, setConsultSubmitting] = useState(false);
  const [consultMessage, setConsultMessage] = useState("");

  // Articles state
  const [articles, setArticles] = useState([]);
  const [articlesLoading, setArticlesLoading] = useState(false);
  const [articlesError, setArticlesError] = useState("");
  const [articlesPage, setArticlesPage] = useState(1);
  const [articlesTotalPages, setArticlesTotalPages] = useState(1);
  const productIdFromPath = useMemo(() => getProductIdFromPath(pathname), [pathname]);
  const articleSlugFromPath = useMemo(() => getArticleSlugFromPath(pathname), [pathname]);
  const isDetailPage = Boolean(productIdFromPath);
  const isArticleListPage = pathname === "/tin-tuc" || pathname.startsWith("/tin-tuc?");
  const isArticleDetailPage = Boolean(articleSlugFromPath);
  const isPolicyPage = pathname === "/chinh-sach-bao-mat";
  const isAboutPage = pathname === "/gioi-thieu";
  const isHomePage = pathname === "/" || pathname === "";

  const handleConsultChange = (field, value) => {
    setConsultForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleConsultSubmit = async (event) => {
    event.preventDefault();
    if (!selectedProduct?.id) return;
    setConsultSubmitting(true);
    setConsultMessage("");
    try {
      await submitConsultationRequest({
        productId: selectedProduct.id,
        productName: selectedProduct.name || "",
        fullName: consultForm.fullName,
        phone: consultForm.phone,
        email: consultForm.email,
        address: consultForm.address,
        note: consultForm.note,
        sourcePath: pathname
      });
      setConsultMessage("Yêu cầu đã được ghi nhận. Chúng tôi sẽ liên hệ sớm.");
      setConsultForm({
        fullName: consultForm.fullName,
        phone: consultForm.phone,
        email: "",
        address: "",
        note: ""
      });
    } catch (err) {
      setConsultMessage(err instanceof Error ? err.message : "Không gửi được yêu cầu tư vấn");
    } finally {
      setConsultSubmitting(false);
    }
  };

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/system/maintenance`)
      .then((r) => r.json())
      .then((body) => {
        const d = body?.data || {};
        setMaintenance({ checked: true, active: Boolean(d.active), message: String(d.message || "") });
      })
      .catch(() => setMaintenance({ checked: true, active: false, message: "" }));
  }, []);

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname || "/");
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    setPage(1);
  }, [search]);

  useEffect(() => {
    if (isDetailPage || isPolicyPage || isHomePage || isAboutPage || isArticleListPage || isArticleDetailPage) return;
    let cancelled = false;
    setLoading(true);
    setError("");

    fetchPublicProductsPaged({ search, page, pageSize: PAGE_SIZE })
      .then((result) => {
        if (cancelled) return;
        setProducts(result.data);
        setTotal(result.total);
        setTotalPages(result.totalPages);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Không tải được dữ liệu sản phẩm");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isPolicyPage, isAboutPage, isHomePage, isDetailPage, isArticleListPage, isArticleDetailPage, page, search]);

  useEffect(() => {
    if (!isArticleListPage) return;
    let cancelled = false;
    setArticlesLoading(true);
    setArticlesError("");
    fetchPublicArticles({ search: "", category: "", page: articlesPage, pageSize: 12 })
      .then((result) => {
        if (cancelled) return;
        setArticles(result.data);
        setArticlesTotalPages(result.totalPages);
      })
      .catch((err) => {
        if (cancelled) return;
        setArticlesError(err instanceof Error ? err.message : "Không tải được bài viết");
      })
      .finally(() => { if (!cancelled) setArticlesLoading(false); });
    return () => { cancelled = true; };
  }, [isArticleListPage, articlesPage]);

  useEffect(() => {
    if (!isDetailPage) {
      setSelectedProduct(null);
      setConsultMessage("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");

    fetchPublicProductById(productIdFromPath)
      .then((data) => {
        if (cancelled) return;
        setSelectedProduct(data);
        setConsultMessage("");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Không tải được chi tiết sản phẩm");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isDetailPage, productIdFromPath]);

  useEffect(() => {
    if (isHomePage) {
      document.title = "TÁ TIẾN | Nuôi trồng thủy sản & Phân phối thức ăn chăn nuôi";
      setMetaTag('meta[name="description"]', { name: "description" }, "Công ty TNHH MTV Nuôi Trồng Thủy Sản Tá Tiến — phân phối thức ăn chăn nuôi, sản xuất giống cá, vận tải hàng hóa và đại lý thuốc thú y.");
      return;
    }
    if (isPolicyPage) {
      document.title = "Chính sách bảo mật | TÁ TIẾN";
      setMetaTag('meta[name="description"]', { name: "description" }, "Chính sách bảo mật của Công ty TNHH MTV Nuôi Trồng Thủy Sản Tá Tiến.");
      return;
    }
    if (isAboutPage) {
      document.title = "Giới thiệu | TÁ TIẾN";
      setMetaTag('meta[name="description"]', { name: "description" }, "Giới thiệu về Công ty TNHH MTV Nuôi Trồng Thủy Sản Tá Tiến — sứ mệnh, tầm nhìn và lĩnh vực hoạt động.");
      return;
    }
    if (isArticleDetailPage) {
      document.title = "Chi tiết bài viết | TÁ TIẾN";
      setMetaTag('meta[name="description"]', { name: "description" }, "Thông tin bài viết, tin tức và kiến thức mới nhất từ Tá Tiến.");
      setMetaTag('meta[property="og:title"]', { property: "og:title" }, "Chi tiết bài viết | TÁ TIẾN");
      setMetaTag('meta[property="og:description"]', { property: "og:description" }, "Thông tin bài viết, tin tức và kiến thức mới nhất từ Tá Tiến.");
      setMetaTag('meta[property="og:type"]', { property: "og:type" }, "article");
      return;
    }
    if (isArticleListPage) {
      document.title = "Tin tức & Kiến thức | TÁ TIẾN";
      setMetaTag('meta[name="description"]', { name: "description" }, "Cập nhật tin tức, kiến thức và hướng dẫn mới nhất từ Tá Tiến.");
      setMetaTag('meta[property="og:title"]', { property: "og:title" }, "Tin tức & Kiến thức | TÁ TIẾN");
      setMetaTag('meta[property="og:description"]', { property: "og:description" }, "Cập nhật tin tức, kiến thức và hướng dẫn mới nhất từ Tá Tiến.");
      setMetaTag('meta[property="og:type"]', { property: "og:type" }, "website");
      return;
    }
    if (isDetailPage && selectedProduct) {
      const title = `${selectedProduct.name || "Sản phẩm"} | TÁ TIẾN`;
      document.title = title;
      const description = selectedProduct.benefits
        || selectedProduct.ingredients
        || `Thông tin chi tiết và tư vấn báo giá cho sản phẩm ${selectedProduct.name || ""}.`;
      setMetaTag('meta[name="description"]', { name: "description" }, description);
      setMetaTag('meta[property="og:title"]', { property: "og:title" }, title);
      setMetaTag('meta[property="og:description"]', { property: "og:description" }, description);
      setMetaTag('meta[property="og:type"]', { property: "og:type" }, "product");
    } else {
      const title = "Danh mục sản phẩm doanh nghiệp | TÁ TIẾN";
      document.title = title;
      const description = "Danh mục sản phẩm doanh nghiệp với trang chi tiết riêng và nút tư vấn nhận báo giá.";
      setMetaTag('meta[name="description"]', { name: "description" }, description);
      setMetaTag('meta[property="og:title"]', { property: "og:title" }, title);
      setMetaTag('meta[property="og:description"]', { property: "og:description" }, description);
      setMetaTag('meta[property="og:type"]', { property: "og:type" }, "website");
    }
  }, [isHomePage, isPolicyPage, isAboutPage, isDetailPage, isArticleListPage, isArticleDetailPage, selectedProduct]);

  return (
    <div className="site">
      {maintenance.checked && maintenance.active ? (
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2rem", textAlign: "center", background: "#f9f7f3" }}>
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#c0914a" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginBottom: "1.5rem" }}>
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="0.5" fill="#c0914a"/>
          </svg>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.75rem", color: "#2d3540" }}>Tạm ngừng dịch vụ</h1>
          <p style={{ maxWidth: 420, color: "#556", lineHeight: 1.7 }}>{maintenance.message || "Website đang tạm thời bảo trì. Vui lòng quay lại sau."}</p>
        </div>
      ) : (
      <>
      <header>
        <a className="logo" href="/" aria-label="Logo TÁ TIẾN">
          <span className="logo-mark">TÁ TIẾN</span>
        </a>
        {!isPolicyPage && !isAboutPage && !isHomePage && !isDetailPage && !isArticleListPage && !isArticleDetailPage ? (
          <div className="header-search">
            <svg className="search-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.6"/>
              <line x1="12.5" y1="12.5" x2="17" y2="17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Tìm theo tên hoặc mã SKU"
              aria-label="Tìm kiếm sản phẩm"
            />
          </div>
        ) : null}
        <nav>
          <a href="/" onClick={(e) => { e.preventDefault(); window.history.pushState({}, "", "/"); setPathname("/"); window.scrollTo(0, 0); }}>Trang chủ</a>
          <a href="/gioi-thieu" onClick={(e) => { e.preventDefault(); window.history.pushState({}, "", "/gioi-thieu"); setPathname("/gioi-thieu"); window.scrollTo(0, 0); }}>Giới thiệu</a>
          <a href="/san-pham">Sản phẩm</a>
          <a href="/tin-tuc" onClick={(e) => { e.preventDefault(); window.history.pushState({}, "", "/tin-tuc"); setPathname("/tin-tuc"); window.scrollTo(0, 0); }}>Tin tức & Kiến thức</a>
        </nav>
      </header>

      <main>
        {!isPolicyPage && !isAboutPage && !isHomePage ? (
          <>
        {error ? <p className="status-text">{error}</p> : null}
        {loading ? <p className="status-text">Đang tải dữ liệu...</p> : null}
          </>
        ) : null}

        {!loading && !isDetailPage && !isPolicyPage && !isHomePage && !isAboutPage && !isArticleListPage && !isArticleDetailPage ? (
          <>
            <section className="product-grid">
              {products.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
              {!products.length ? <p className="status-text">Không có sản phẩm phù hợp.</p> : null}
            </section>
            {products.length ? (
              <section className="pager-row">
                <button className="btn-outline" type="button" onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={page <= 1}>
                  Trang trước
                </button>
                <span className="pager-text">Trang {page} / {totalPages} · {total} sản phẩm</span>
                <button className="btn-outline" type="button" onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))} disabled={page >= totalPages}>
                  Trang sau
                </button>
              </section>
            ) : null}
          </>
        ) : null}

        {!loading && isDetailPage && !isPolicyPage ? (
          selectedProduct ? (
            <ProductDetail
              product={selectedProduct}
              consultForm={consultForm}
              consultSubmitting={consultSubmitting}
              consultMessage={consultMessage}
              onConsultChange={handleConsultChange}
              onConsultSubmit={handleConsultSubmit}
            />
          ) : <p className="status-text">Không tìm thấy sản phẩm.</p>
        ) : null}

        {isHomePage ? <HomePage onNavigate={(path) => { window.history.pushState({}, "", path); setPathname(path); window.scrollTo(0, 0); }} /> : null}
        {isAboutPage ? <AboutPage /> : null}
        {isPolicyPage ? <PrivacyPage /> : null}

        {isArticleDetailPage ? (
          <ArticleDetailPage slug={articleSlugFromPath} onNavigate={(path) => { window.history.pushState({}, "", path); setPathname(path); window.scrollTo(0, 0); }} />
        ) : null}

        {isArticleListPage && !isArticleDetailPage ? (
          <section className="articles-section">
            <div className="articles-header">
              <h1>Tin tức &amp; Kiến thức</h1>
              <p>Cập nhật thông tin, kinh nghiệm và hướng dẫn từ đội ngũ chuyên gia.</p>
            </div>
            {articlesError && <p className="status-text">{articlesError}</p>}
            {articlesLoading ? <p className="status-text">Đang tải...</p> : (
              articles.length === 0 ? <p className="status-text">Chưa có bài viết nào.</p> : (
                <div className="articles-grid">
                  {articles.map((article) => (
                    <ArticleCard key={article.id} article={article} onNavigate={(path) => { window.history.pushState({}, "", path); setPathname(path); window.scrollTo(0, 0); }} />
                  ))}
                </div>
              )
            )}
            {articlesTotalPages > 1 && (
              <section className="pager-row">
                <button className="btn-outline" type="button" onClick={() => setArticlesPage((p) => Math.max(1, p - 1))} disabled={articlesPage <= 1}>Trang trước</button>
                <span className="pager-text">Trang {articlesPage} / {articlesTotalPages}</span>
                <button className="btn-outline" type="button" onClick={() => setArticlesPage((p) => Math.min(articlesTotalPages, p + 1))} disabled={articlesPage >= articlesTotalPages}>Trang sau</button>
              </section>
            )}
          </section>
        ) : null}
      </main>

      <footer className="site-footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <span className="logo-mark footer-logo-mark">TÁ TIẾN</span>
          </div>
          <div className="footer-info">
            <p className="footer-company">CÔNG TY TNHH MTV NUÔI TRỒNG THỦY SẢN TÁ TIẾN</p>
            <p>MST: 6101311429</p>
            <p>Địa chỉ: 544 Hùng Vương, Xã Đăk Hà, Tỉnh Quảng Ngãi, Việt Nam</p>
          </div>
          <div className="footer-links">
            <a href="/chinh-sach-bao-mat" onClick={(e) => { e.preventDefault(); window.history.pushState({}, "", "/chinh-sach-bao-mat"); setPathname("/chinh-sach-bao-mat"); window.scrollTo(0, 0); }}>Chính sách bảo mật</a>
          </div>
        </div>
        <div className="footer-copy">
          © {new Date().getFullYear()} Tá Tiến. Bảo lưu mọi quyền.
        </div>
      </footer>
      </>
      )}
    </div>
  );
}

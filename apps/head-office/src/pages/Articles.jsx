import { useEffect, useRef, useState } from "react";
import * as api from "../api";
import "../styles/pages.css";

const MAX_ARTICLE_COVER_SIZE = 5 * 1024 * 1024;
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://localhost:4000").replace(/\/$/, "");

const CATEGORIES = [
  { value: "news", label: "Tin tức" },
  { value: "knowledge", label: "Kiến thức" },
  { value: "promotion", label: "Khuyến mại" },
  { value: "guide", label: "Hướng dẫn" }
];

const STATUS_LABELS = {
  DRAFT: "Bản nháp",
  PUBLISHED: "Đã đăng",
  HIDDEN: "Đã ẩn"
};

const STATUS_COLORS = {
  DRAFT: "#94a3b8",
  PUBLISHED: "#22c55e",
  HIDDEN: "#f59e0b"
};

const DEFAULT_FORM = {
  title: "",
  slug: "",
  content: "",
  coverImage: "",
  category: "news",
  status: "DRAFT",
  seoDesc: ""
};

function toSlug(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

function formatDateTime(value) {
  if (!value) return "-";
  const dt = new Date(value);
  if (isNaN(dt.getTime())) return "-";
  return dt.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function resolveAssetUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw) || raw.startsWith("data:")) return raw;
  if (raw.startsWith("/")) return `${API_BASE_URL}${raw}`;
  return `${API_BASE_URL}/${raw.replace(/^\/+/, "")}`;
}

export default function Articles({ token }) {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filters
  const [filterStatus, setFilterStatus] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [search, setSearch] = useState("");

  // Editor state
  const [showEditor, setShowEditor] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [preview, setPreview] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const coverFileInputRef = useRef(null);

  // Delete
  const [deletingId, setDeletingId] = useState(null);

  async function loadArticles() {
    setLoading(true);
    setError("");
    try {
      const result = await api.getArticles(token, {
        status: filterStatus || undefined,
        category: filterCategory || undefined,
        search: search || undefined,
        pageSize: 100
      });
      setArticles(Array.isArray(result?.data) ? result.data : (Array.isArray(result) ? result : []));
    } catch (e) {
      setError(e.message || "Lỗi tải bài viết");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token) loadArticles();
  }, [token, filterStatus, filterCategory]);

  function handleSearchKeyDown(e) {
    if (e.key === "Enter") loadArticles();
  }

  function openCreateEditor() {
    setEditingId(null);
    setForm(DEFAULT_FORM);
    setFormError("");
    setUploadMessage("");
    setPreview(false);
    setShowEditor(true);
  }

  async function openEditEditor(article) {
    setFormError("");
    setUploadMessage("");
    setPreview(false);
    setEditingId(article.id);
    setForm({
      title: article.title || "",
      slug: article.slug || "",
      content: article.content || "",
      coverImage: article.coverImage || "",
      category: article.category || "news",
      status: article.status || "DRAFT",
      seoDesc: article.seoDesc || ""
    });
    setShowEditor(true);
    // Tải nội dung đầy đủ (có content)
    try {
      const full = await api.getArticleById(token, article.id);
      setForm({
        title: full.title || "",
        slug: full.slug || "",
        content: full.content || "",
        coverImage: full.coverImage || "",
        category: full.category || "news",
        status: full.status || "DRAFT",
        seoDesc: full.seoDesc || ""
      });
    } catch (_) {}
  }

  function handleFormChange(field, value) {
    setUploadMessage("");
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      // Tự sinh slug khi title thay đổi và slug chưa được sửa tay
      if (field === "title" && !editingId) {
        next.slug = toSlug(value);
      }
      return next;
    });
  }

  const handlePickCoverImage = () => {
    if (uploadingCover) return;
    coverFileInputRef.current?.click();
  };

  const handleCoverFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setUploadMessage("Vui lòng chọn tệp ảnh hợp lệ (png, jpg, webp...).");
      event.target.value = "";
      return;
    }

    if (file.size > MAX_ARTICLE_COVER_SIZE) {
      setUploadMessage("Ảnh vượt quá 5MB. Vui lòng chọn ảnh nhỏ hơn.");
      event.target.value = "";
      return;
    }

    try {
      setUploadingCover(true);
      setUploadMessage("");
      const uploaded = await api.uploadArticleCover(token, file);
      const uploadedUrl = uploaded?.imageUrl || uploaded?.url || "";
      if (!uploadedUrl) {
        throw new Error("Không nhận được URL ảnh sau khi upload.");
      }
      setForm((prev) => ({ ...prev, coverImage: uploadedUrl }));
      setUploadMessage("Đã tải ảnh bìa lên server thành công.");
    } catch (e) {
      setUploadMessage(e?.message || "Tải ảnh bìa thất bại.");
    } finally {
      setUploadingCover(false);
      event.target.value = "";
    }
  };

  async function handleSave() {
    if (!form.title.trim()) {
      setFormError("Vui lòng nhập tiêu đề bài viết.");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      const payload = {
        title: form.title.trim(),
        slug: form.slug.trim() || toSlug(form.title),
        content: form.content,
        coverImage: form.coverImage.trim() || null,
        category: form.category,
        status: form.status,
        seoDesc: form.seoDesc.trim() || null
      };
      if (editingId) {
        await api.updateArticle(token, editingId, payload);
      } else {
        await api.createArticle(token, payload);
      }
      setShowEditor(false);
      await loadArticles();
    } catch (e) {
      setFormError(e.message || "Lỗi lưu bài viết");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(article, newStatus) {
    try {
      await api.patchArticleStatus(token, article.id, newStatus);
      setArticles((prev) => prev.map((a) => a.id === article.id ? { ...a, status: newStatus } : a));
    } catch (e) {
      alert(e.message || "Lỗi đổi trạng thái");
    }
  }

  async function handleDelete(id) {
    if (!window.confirm("Bạn chắc chắn muốn xóa bài viết này?")) return;
    setDeletingId(id);
    try {
      await api.deleteArticle(token, id);
      setArticles((prev) => prev.filter((a) => a.id !== id));
    } catch (e) {
      alert(e.message || "Xóa thất bại");
    } finally {
      setDeletingId(null);
    }
  }

  // Render content as simple HTML (linebreaks → paragraphs)
  function renderContent(text) {
    const escaped = (text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const html = escaped.split(/\n\n+/).map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`).join("");
    return html;
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h2 style={{ margin: 0 }}>Quản lý bài viết</h2>
          <p style={{ color: "#64748b", marginTop: 4, marginBottom: 0, fontSize: 14 }}>
            Viết và quản lý tin tức, kiến thức, hướng dẫn cho website.
          </p>
        </div>
        <div className="page-header-actions">
          <button className="btn-primary" onClick={openCreateEditor}>+ Viết bài mới</button>
        </div>
      </div>

      {/* Filters */}
      <div className="articles-toolbar">
        <input
          className="search-input articles-search-input"
          type="text"
          placeholder="Tìm kiếm tiêu đề..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={handleSearchKeyDown}
        />
        <select className="filter-select articles-filter-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">Tất cả trạng thái</option>
          <option value="DRAFT">Bản nháp</option>
          <option value="PUBLISHED">Đã đăng</option>
          <option value="HIDDEN">Đã ẩn</option>
        </select>
        <select className="filter-select articles-filter-select" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
          <option value="">Tất cả danh mục</option>
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        <button className="btn-cancel" onClick={loadArticles}>Tìm</button>
      </div>

      {error && <p className="articles-feedback articles-feedback--error">{error}</p>}

      {loading ? (
        <p className="articles-feedback">Đang tải...</p>
      ) : articles.length === 0 ? (
        <div className="articles-empty-state">
          <p className="articles-empty-title">Chưa có bài viết nào.</p>
          <button className="btn-primary" onClick={openCreateEditor} style={{ marginTop: 12 }}>+ Viết bài đầu tiên</button>
        </div>
      ) : (
        <div className="table-container articles-table-container">
          <table className="data-table articles-table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>ID</th>
                <th>Tiêu đề</th>
                <th style={{ width: 120 }}>Danh mục</th>
                <th style={{ width: 110 }}>Trạng thái</th>
                <th style={{ width: 155 }}>Ngày đăng</th>
                <th style={{ width: 155 }}>Cập nhật</th>
                <th style={{ width: 180 }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {articles.map((article) => (
                <tr key={article.id}>
                  <td className="font-mono" style={{ color: "#94a3b8", fontSize: 12 }}>{article.id}</td>
                  <td className="articles-title-cell">
                    <div className="articles-title-text">{article.title}</div>
                    <div className="articles-slug-text">{article.slug}</div>
                    {article.seoDesc && <div className="articles-seo-text">{article.seoDesc}</div>}
                  </td>
                  <td>{CATEGORIES.find((c) => c.value === article.category)?.label || article.category}</td>
                  <td>
                    <span style={{
                      display: "inline-block",
                      padding: "2px 10px",
                      borderRadius: 20,
                      fontSize: 12,
                      fontWeight: 600,
                      background: `${STATUS_COLORS[article.status]}22`,
                      color: STATUS_COLORS[article.status]
                    }}>
                      {STATUS_LABELS[article.status] || article.status}
                    </span>
                  </td>
                  <td style={{ fontSize: 13 }}>{formatDateTime(article.publishedAt)}</td>
                  <td style={{ fontSize: 13 }}>{formatDateTime(article.updatedAt)}</td>
                  <td>
                    <div className="articles-actions">
                      <button className="btn-small" onClick={() => openEditEditor(article)}>Sửa</button>
                      {article.status !== "PUBLISHED" && (
                        <button className="btn-small" style={{ background: "#dcfce7", color: "#16a34a" }}
                          onClick={() => handleStatusChange(article, "PUBLISHED")}>Đăng</button>
                      )}
                      {article.status === "PUBLISHED" && (
                        <button className="btn-small" style={{ background: "#fef9c3", color: "#92400e" }}
                          onClick={() => handleStatusChange(article, "HIDDEN")}>Ẩn</button>
                      )}
                      {article.status === "HIDDEN" && (
                        <button className="btn-small" style={{ background: "#f1f5f9", color: "#475569" }}
                          onClick={() => handleStatusChange(article, "DRAFT")}>Nháp</button>
                      )}
                      <button className="btn-small" style={{ background: "#fee2e2", color: "#dc2626" }}
                        onClick={() => handleDelete(article.id)}
                        disabled={deletingId === article.id}>
                        {deletingId === article.id ? "..." : "Xóa"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Editor Dialog */}
      {showEditor && (
        <div className="dialog-overlay dialog-overlay--centered" style={{ zIndex: 200 }} onClick={(e) => { if (e.target === e.currentTarget) setShowEditor(false); }}>
          <div className="dialog-panel dialog-panel--lg articles-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header" style={{ flexShrink: 0 }}>
              <div>
                <h2>{editingId ? "Sửa bài viết" : "Viết bài mới"}</h2>
                <p className="dialog-subtitle">Soạn nội dung, xem trước và quản lý trạng thái công khai của bài viết.</p>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  type="button"
                  className="btn-cancel"
                  style={{ padding: "5px 12px", fontSize: 13 }}
                  onClick={() => setPreview((v) => !v)}>
                  {preview ? "← Soạn thảo" : "Xem trước"}
                </button>
                <button type="button" className="close-btn" onClick={() => setShowEditor(false)} aria-label="Đóng">✕</button>
              </div>
            </div>

            <div className="dialog-body articles-dialog-body">
              {formError && <p className="articles-feedback articles-feedback--error">{formError}</p>}

              {preview ? (
                <div className="article-preview">
                  {form.coverImage && (
                    <img src={resolveAssetUrl(form.coverImage)} alt="cover" className="article-preview-cover" />
                  )}
                  <h1 className="article-preview-title">{form.title || "(Chưa có tiêu đề)"}</h1>
                  <div className="article-preview-meta">
                    {CATEGORIES.find((c) => c.value === form.category)?.label} · {STATUS_LABELS[form.status]}
                  </div>
                  <div className="article-content-preview" dangerouslySetInnerHTML={{ __html: renderContent(form.content) }} />
                </div>
              ) : (
                <div className="articles-editor-form">
                  <label className="articles-field-group">
                    <span className="articles-field-label">Tiêu đề *</span>
                    <input
                      type="text"
                      value={form.title}
                      onChange={(e) => handleFormChange("title", e.target.value)}
                      placeholder="Nhập tiêu đề bài viết..."
                      autoFocus
                    />
                  </label>

                  <div className="articles-form-row">
                    <label className="articles-field-group">
                      <span className="articles-field-label">Slug URL</span>
                      <input
                        type="text"
                        value={form.slug}
                        onChange={(e) => handleFormChange("slug", e.target.value)}
                        placeholder="tu-dong-sinh-tu-tieu-de"
                      />
                    </label>
                    <label className="articles-field-group">
                      <span className="articles-field-label">Danh mục</span>
                      <select value={form.category} onChange={(e) => handleFormChange("category", e.target.value)}>
                        {CATEGORIES.map((c) => (
                          <option key={c.value} value={c.value}>{c.label}</option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <label className="articles-field-group">
                    <span className="articles-field-label">Ảnh bìa</span>
                    <input
                      ref={coverFileInputRef}
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={handleCoverFileChange}
                    />
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <button type="button" className="btn-secondary" onClick={handlePickCoverImage} disabled={uploadingCover || saving}>
                        {uploadingCover ? "Đang tải ảnh..." : "Chọn ảnh từ máy"}
                      </button>
                      {form.coverImage ? (
                        <button
                          type="button"
                          className="btn-cancel"
                          onClick={() => handleFormChange("coverImage", "")}
                          disabled={uploadingCover || saving}
                        >
                          Xóa ảnh bìa
                        </button>
                      ) : null}
                    </div>
                    {uploadMessage ? (
                      <p className={`articles-feedback ${uploadMessage.startsWith("Đã") ? "" : "articles-feedback--error"}`} style={{ margin: 0 }}>
                        {uploadMessage}
                      </p>
                    ) : null}
                    {form.coverImage && (
                      <img src={resolveAssetUrl(form.coverImage)} alt="preview" className="articles-cover-preview" />
                    )}
                  </label>

                  <label className="articles-field-group">
                    <span className="articles-field-label">Mô tả SEO</span>
                    <input
                      type="text"
                      value={form.seoDesc}
                      onChange={(e) => handleFormChange("seoDesc", e.target.value)}
                      placeholder="Mô tả ngắn, hiển thị trong kết quả tìm kiếm (tối đa 300 ký tự)"
                      maxLength={300}
                    />
                  </label>

                  <label className="articles-field-group">
                    <div className="articles-field-header">
                      <span className="articles-field-label">Nội dung bài viết</span>
                      <span className="articles-field-hint">Dùng dòng trắng để xuống đoạn</span>
                    </div>
                    <textarea
                      value={form.content}
                      onChange={(e) => handleFormChange("content", e.target.value)}
                      rows={14}
                      placeholder="Viết nội dung bài viết tại đây..."
                      className="articles-content-input"
                    />
                  </label>

                  <label className="articles-field-group articles-field-group--compact">
                    <span className="articles-field-label">Trạng thái</span>
                    <select value={form.status} onChange={(e) => handleFormChange("status", e.target.value)} className="articles-status-select">
                      <option value="DRAFT">Bản nháp</option>
                      <option value="PUBLISHED">Đã đăng (công khai)</option>
                      <option value="HIDDEN">Ẩn</option>
                    </select>
                  </label>
                </div>
              )}
            </div>

            <div className="dialog-footer" style={{ flexShrink: 0 }}>
              <button type="button" className="btn-cancel" onClick={() => setShowEditor(false)} disabled={saving}>Hủy</button>
              <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? "Đang lưu..." : (editingId ? "Cập nhật bài viết" : "Lưu bài viết")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

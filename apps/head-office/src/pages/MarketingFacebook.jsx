import { useEffect, useState } from "react";
import * as api from "../api";
import "../styles/pages.css";

const DEFAULT_CONFIG = {
  appId: "",
  appSecret: "",
  accessToken: "",
  adAccountId: ""
};

function formatDate(rawValue) {
  if (!rawValue) return "-";
  const normalized = typeof rawValue === "number" && rawValue < 1_000_000_000_000
    ? rawValue * 1000
    : rawValue;
  const dt = new Date(normalized);
  if (Number.isNaN(dt.getTime())) return String(rawValue);
  return dt.toLocaleString("vi-VN");
}

export default function MarketingFacebook({ token }) {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [savedConfigMeta, setSavedConfigMeta] = useState({
    hasAppSecret: false,
    hasAccessToken: false,
    appSecretMasked: "",
    accessTokenMasked: ""
  });
  const [error, setError] = useState("");
  const [loadingLocalAudiences, setLoadingLocalAudiences] = useState(false);
  const [localAudiences, setLocalAudiences] = useState([]);
  const [showCreateAudienceDialog, setShowCreateAudienceDialog] = useState(false);
  const [creatingAudience, setCreatingAudience] = useState(false);
  const [loadingFacebookAudienceOptions, setLoadingFacebookAudienceOptions] = useState(false);
  const [facebookAudienceOptions, setFacebookAudienceOptions] = useState([]);
  const [audienceForm, setAudienceForm] = useState({
    name: "",
    description: "",
    facebookAudienceId: "",
    adAccountId: "",
    selectedCustomerIds: []
  });
  const [customers, setCustomers] = useState([]);
  const [detailAudience, setDetailAudience] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [pushingToFacebook, setPushingToFacebook] = useState(false);
  const [pushResult, setPushResult] = useState(null);
  const [removingDetailId, setRemovingDetailId] = useState(null);
  const [showAddToDetail, setShowAddToDetail] = useState(false);
  const [addDetailCustomerIds, setAddDetailCustomerIds] = useState([]);
  const [addingDetails, setAddingDetails] = useState(false);
  const [addDetailError, setAddDetailError] = useState("");
  const [detailSearchQ, setDetailSearchQ] = useState("");
  const [detailListSearchQ, setDetailListSearchQ] = useState("");

  const handleChange = (key, value) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const loadSavedFacebookConfig = async () => {
    setLoadingConfig(true);
    setError("");
    try {
      const res = await api.getFacebookConfig(token);
      const data = res?.data || res || {};
      setConfig((prev) => ({
        ...prev,
        appId: String(data.appId || ""),
        adAccountId: String(data.adAccountId || "")
      }));
      setSavedConfigMeta({
        hasAppSecret: Boolean(data.hasAppSecret),
        hasAccessToken: Boolean(data.hasAccessToken),
        appSecretMasked: String(data.appSecretMasked || ""),
        accessTokenMasked: String(data.accessTokenMasked || "")
      });
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Không tải được cấu hình Facebook từ backend");
    } finally {
      setLoadingConfig(false);
    }
  };

  const handleSaveFacebookConfig = async () => {
    setSavingConfig(true);
    setError("");
    try {
      const payload = {
        appId: config.appId || null,
        adAccountId: config.adAccountId || null,
        ...(String(config.appSecret || "").trim() ? { appSecret: config.appSecret } : {}),
        ...(String(config.accessToken || "").trim() ? { accessToken: config.accessToken } : {})
      };
      const res = await api.saveFacebookConfig(token, payload);
      const data = res?.data || res || {};
      setSavedConfigMeta({
        hasAppSecret: Boolean(data.hasAppSecret),
        hasAccessToken: Boolean(data.hasAccessToken),
        appSecretMasked: String(data.appSecretMasked || ""),
        accessTokenMasked: String(data.accessTokenMasked || "")
      });
      setConfig((prev) => ({ ...prev, appSecret: "", accessToken: "" }));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Không lưu được cấu hình Facebook");
    } finally {
      setSavingConfig(false);
    }
  };

  const loadLocalAudiences = async () => {
    setLoadingLocalAudiences(true);
    setError("");
    try {
      const [audiencesRes, customersRes] = await Promise.all([
        api.getMarketingCustomAudiences(token),
        api.getPartners(token)
      ]);
      const audienceRows = Array.isArray(audiencesRes?.data) ? audiencesRes.data : Array.isArray(audiencesRes) ? audiencesRes : [];
      const customerRows = Array.isArray(customersRes?.data) ? customersRes.data : Array.isArray(customersRes) ? customersRes : [];
      setLocalAudiences(audienceRows);
      setCustomers(customerRows.filter((item) => item?.isCustomer));
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Không tải được đối tượng tùy chỉnh nội bộ");
      setLocalAudiences([]);
      setCustomers([]);
    } finally {
      setLoadingLocalAudiences(false);
    }
  };

  const loadFacebookAudienceOptions = async () => {
    setLoadingFacebookAudienceOptions(true);
    setError("");
    try {
      const res = await api.getFacebookCustomAudiences(token, config);
      const rows = Array.isArray(res?.data) ? res.data : Array.isArray(res?.data?.data) ? res.data.data : [];
      setFacebookAudienceOptions(rows);
    } catch (fetchError) {
      setFacebookAudienceOptions([]);
      setError(fetchError instanceof Error ? fetchError.message : "Không tải được danh sách audience từ Facebook");
    } finally {
      setLoadingFacebookAudienceOptions(false);
    }
  };

  const handleCreateAudience = async () => {
    const name = String(audienceForm.name || "").trim();
    if (!name) { setError("Vui lòng nhập tên đối tượng tùy chỉnh"); return; }
    setCreatingAudience(true);
    setError("");
    try {
      const selectedCustomers = customers.filter((c) => audienceForm.selectedCustomerIds.includes(c.id));
      const details = selectedCustomers.map((c) => ({
        customerId: c.id
      }));
      await api.createMarketingCustomAudience(token, {
        name, description: audienceForm.description || null,
        facebookAudienceId: audienceForm.facebookAudienceId || null,
        adAccountId: audienceForm.adAccountId || null, details
      });
      setShowCreateAudienceDialog(false);
      setAudienceForm({ name: "", description: "", facebookAudienceId: "", adAccountId: "", selectedCustomerIds: [] });
      await loadLocalAudiences();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Không tạo được đối tượng tùy chỉnh");
    } finally {
      setCreatingAudience(false);
    }
  };

  const openDetail = async (item) => {
    setDetailAudience({ ...item, details: null });
    setPushResult(null);
    setShowAddToDetail(false);
    setAddDetailCustomerIds([]);
    setAddDetailError("");
    setDetailSearchQ("");
    setDetailListSearchQ("");
    setLoadingDetail(true);
    try {
      const res = await api.getMarketingCustomAudienceById(token, item.id);
      const data = res?.data || res || {};
      setDetailAudience(data);
    } catch {
      setDetailAudience((prev) => ({ ...prev, details: [] }));
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleRemoveDetail = async (detailId) => {
    if (!detailAudience?.id) return;
    setRemovingDetailId(detailId);
    try {
      const res = await api.removeMarketingCustomAudienceDetail(token, detailAudience.id, detailId);
      const updated = res?.data || res || {};
      setDetailAudience((prev) => ({ ...prev, details: updated.details ?? prev.details }));
      setLocalAudiences((prev) => prev.map((a) =>
        a.id === detailAudience.id
          ? { ...a, detailCount: (updated.details ?? []).length }
          : a
      ));
    } catch (e) {
      setAddDetailError(e instanceof Error ? e.message : "Xóa thất bại");
    } finally {
      setRemovingDetailId(null);
    }
  };

  const handleAddToDetail = async () => {
    if (!detailAudience?.id || !addDetailCustomerIds.length) return;
    setAddingDetails(true);
    setAddDetailError("");
    try {
      const res = await api.addMarketingCustomAudienceDetails(token, detailAudience.id, {
        details: addDetailCustomerIds.map((id) => ({ customerId: id }))
      });
      const updated = res?.data || res || {};
      setDetailAudience((prev) => ({ ...prev, details: updated.details ?? prev.details }));
      setLocalAudiences((prev) => prev.map((a) =>
        a.id === detailAudience.id
          ? { ...a, detailCount: (updated.details ?? []).length }
          : a
      ));
      setAddDetailCustomerIds([]);
      setShowAddToDetail(false);
    } catch (e) {
      setAddDetailError(e instanceof Error ? e.message : "Thêm thất bại");
    } finally {
      setAddingDetails(false);
    }
  };

  const handlePushToFacebook = async () => {
    if (!detailAudience?.id) return;
    setPushingToFacebook(true);
    setPushResult(null);
    try {
      const res = await api.pushCustomAudienceToFacebook(token, detailAudience.id);
      const rows = res?.data?.rows ?? res?.rows ?? 0;
      setPushResult({ ok: true, message: `Đã thay thế ${rows} dòng lên Facebook thành công.` });
    } catch (pushError) {
      const baseMessage = pushError instanceof Error ? pushError.message : "Đẩy lên Facebook thất bại";
      const fbError = pushError && typeof pushError === "object" ? pushError.facebookError : null;
      const code = typeof fbError?.code === "number" ? fbError.code : null;
      const subcode = typeof fbError?.subcode === "number" ? fbError.subcode : null;
      const fbtraceId = typeof fbError?.fbtraceId === "string" ? fbError.fbtraceId : "";

      const details = [
        code !== null ? `code=${code}` : "",
        subcode !== null ? `subcode=${subcode}` : "",
        fbtraceId ? `trace=${fbtraceId}` : ""
      ].filter(Boolean).join(" | ");

      setPushResult({
        ok: false,
        message: details ? `${baseMessage} (${details})` : baseMessage
      });
    } finally {
      setPushingToFacebook(false);
    }
  };

  useEffect(() => { loadLocalAudiences(); }, []);
  useEffect(() => { if (!token) return; loadSavedFacebookConfig(); }, [token]);
  useEffect(() => {
    if (!showConfigDialog) return;
    const handleKeyDown = (e) => { if (e.key === "Escape") setShowConfigDialog(false); };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showConfigDialog]);

  return (
    <section className="page-container marketing-page">
      <header className="page-header">
        <div>
          <h1>Marketing Facebook</h1>
          <p className="stat-text">Quản lý danh sách Đối tượng tùy chỉnh.</p>
        </div>
        <div className="page-header-actions">
          <button type="button" className="btn-cancel" onClick={() => setShowConfigDialog(true)}>
            Cấu hình FB
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setShowCreateAudienceDialog(true);
              if (!customers.length) void loadLocalAudiences();
              void loadFacebookAudienceOptions();
            }}
          >
            + Tạo đối tượng tùy chỉnh
          </button>
        </div>
      </header>

      {showConfigDialog ? (
        <div className="dialog-overlay" onClick={() => setShowConfigDialog(false)}>
          <section className="dialog-panel dialog-panel--md" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h2>Cấu hình Facebook</h2>
              <button type="button" className="close-btn" onClick={() => setShowConfigDialog(false)} aria-label="Đóng">✕</button>
            </div>
            <div className="dialog-body marketing-config-grid">
              <label>
                App ID
                <input value={config.appId} onChange={(e) => handleChange("appId", e.target.value)} placeholder="Nhập App ID" />
              </label>
              <label>
                App Secret
                <textarea className="fb-config-textarea" value={config.appSecret} onChange={(e) => handleChange("appSecret", e.target.value)} placeholder={savedConfigMeta.hasAppSecret ? `Đã lưu: ${savedConfigMeta.appSecretMasked || "********"}` : "Nhập App Secret"} rows={2} />
              </label>
              <label>
                Access Token
                <textarea className="fb-config-textarea" value={config.accessToken} onChange={(e) => handleChange("accessToken", e.target.value)} placeholder={savedConfigMeta.hasAccessToken ? `Đã lưu: ${savedConfigMeta.accessTokenMasked || "********"}` : "Nhập Access Token"} rows={3} />
              </label>
              <label>
                ID Ad Account
                <input value={config.adAccountId} onChange={(e) => handleChange("adAccountId", e.target.value)} placeholder="Nhập ID Ad Account" />
              </label>
            </div>
            <div className="dialog-footer dialog-footer--spread">
              <button type="button" className="btn-cancel" onClick={loadSavedFacebookConfig} disabled={loadingConfig}>
                {loadingConfig ? "Đang tải..." : "Tải cấu hình đã lưu"}
              </button>
              <button type="button" className="btn-primary" onClick={handleSaveFacebookConfig} disabled={savingConfig || loadingConfig}>
                {savingConfig ? "Đang lưu..." : loadingConfig ? "Đang tải cấu hình..." : "Lưu cấu hình FB vào backend"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {error ? <p className="error" style={{ textAlign: "left" }}>{error}</p> : null}

      <section className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Tên đối tượng</th>
              <th>Facebook Audience ID</th>
              <th>Ad Account ID</th>
              <th className="text-right">Số dòng chi tiết</th>
              <th>Người tạo</th>
              <th>Cập nhật</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loadingLocalAudiences ? (
              <tr><td colSpan={7} className="text-center">Đang tải dữ liệu...</td></tr>
            ) : localAudiences.length === 0 ? (
              <tr><td colSpan={7} className="text-center">Chưa có đối tượng tùy chỉnh nội bộ.</td></tr>
            ) : (
              localAudiences.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.name}</strong>
                    {item.description ? <div className="stat-text">{item.description}</div> : null}
                  </td>
                  <td className="font-mono">{item.facebookAudienceId || "-"}</td>
                  <td className="font-mono">{item.adAccountId || "-"}</td>
                  <td className="text-right">{Number(item.detailCount || item.details?.length || 0)}</td>
                  <td>{item.createdBy?.fullName || item.createdBy?.email || "-"}</td>
                  <td>{formatDate(item.updatedAt)}</td>
                  <td><button type="button" className="btn-link" onClick={() => openDetail(item)}>Chi tiết</button></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {detailAudience ? (
        <div className="dialog-overlay" onClick={() => setDetailAudience(null)}>
          <section className="dialog-panel dialog-panel--lg" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h2>{detailAudience.name}</h2>
              <button type="button" className="close-btn" onClick={() => setDetailAudience(null)} aria-label="Đóng">✕</button>
            </div>
            <div className="dialog-body">
              {detailAudience.description ? <p className="stat-text" style={{ marginBottom: 12 }}>{detailAudience.description}</p> : null}
              <div style={{ display: "flex", gap: 24, marginBottom: 12, flexWrap: "wrap" }}>
                <span className="stat-text">Facebook Audience ID: <strong className="font-mono">{detailAudience.facebookAudienceId || "-"}</strong></span>
                <span className="stat-text">Ad Account ID: <strong className="font-mono">{detailAudience.adAccountId || "-"}</strong></span>
              </div>
              {loadingDetail ? (
                <p className="stat-text">Đang tải chi tiết...</p>
              ) : (
                <>
                  <input
                    type="text"
                    placeholder="Tìm theo tên khách hàng, email, số điện thoại..."
                    value={detailListSearchQ}
                    onChange={(e) => setDetailListSearchQ(e.target.value)}
                    style={{ width: "100%", padding: "5px 10px", border: "1px solid #d1d5db", borderRadius: 4, marginBottom: 8, fontSize: 13, boxSizing: "border-box" }}
                  />
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Khách hàng</th>
                        <th>Email</th>
                        <th>SĐT 1</th>
                        <th>SĐT 2</th>
                        <th>SĐT 3</th>
                        <th style={{ width: 64 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const allDetails = detailAudience.details || [];
                        const q = detailListSearchQ.trim().toLowerCase();
                        const filtered = q
                          ? allDetails.filter((d) => {
                              const c = d.customer || {};
                              return (
                                (c.name || "").toLowerCase().includes(q) ||
                                (c.email || "").toLowerCase().includes(q) ||
                                (c.phone || "").includes(q) ||
                                (c.phone2 || "").includes(q) ||
                                (c.phone3 || "").includes(q)
                              );
                            })
                          : allDetails;
                        if (!filtered.length) {
                          return <tr><td colSpan={6} className="text-center">{q ? "Không tìm thấy kết quả." : "Chưa có khách hàng nào."}</td></tr>;
                        }
                        return filtered.map((d, i) => (
                          <tr key={d.id || i}>
                            <td>{d.customer?.name || d.customerId || "-"}</td>
                            <td className="font-mono" style={{ fontSize: 12 }}>{d.customer?.email || "-"}</td>
                            <td className="font-mono" style={{ fontSize: 12 }}>{d.customer?.phone || "-"}</td>
                            <td className="font-mono" style={{ fontSize: 12 }}>{d.customer?.phone2 || "-"}</td>
                            <td className="font-mono" style={{ fontSize: 12 }}>{d.customer?.phone3 || "-"}</td>
                            <td style={{ textAlign: "center" }}>
                              <button
                                type="button"
                                className="btn-danger"
                                style={{ padding: "2px 8px", fontSize: 12, lineHeight: 1.4 }}
                                disabled={removingDetailId === d.id}
                                onClick={() => handleRemoveDetail(d.id)}
                                title="Xóa khỏi đối tượng"
                              >
                                {removingDetailId === d.id ? "..." : "✕"}
                              </button>
                            </td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>

                  {/* Khu vực thêm khách hàng */}
                  <div style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      className="btn-cancel"
                      style={{ fontSize: 13, padding: "4px 12px" }}
                      onClick={() => {
                        setShowAddToDetail((v) => !v);
                        setAddDetailCustomerIds([]);
                        setAddDetailError("");
                        setDetailSearchQ("");
                      }}
                    >
                      {showAddToDetail ? "Ẩn" : "+ Thêm khách hàng"}
                    </button>

                    {showAddToDetail && (
                      <div style={{ marginTop: 10, border: "1px solid #e5e7eb", borderRadius: 6, padding: 12 }}>
                        <input
                          type="text"
                          placeholder="Tìm theo tên hoặc mã KH..."
                          value={detailSearchQ}
                          onChange={(e) => setDetailSearchQ(e.target.value)}
                          style={{ width: "100%", padding: "5px 10px", border: "1px solid #d1d5db", borderRadius: 4, marginBottom: 8, fontSize: 13, boxSizing: "border-box" }}
                        />
                        <div style={{ maxHeight: 200, overflowY: "auto", border: "1px solid #e5e7eb", borderRadius: 4 }}>
                          {(() => {
                            const existingIds = new Set((detailAudience.details || []).map((d) => d.customerId));
                            const filtered = (customers || []).filter((c) => {
                              if (existingIds.has(c.id)) return false;
                              const q = detailSearchQ.trim().toLowerCase();
                              if (!q) return true;
                              return (c.name || "").toLowerCase().includes(q) || (c.code || "").toLowerCase().includes(q);
                            });
                            if (!filtered.length) return <p style={{ padding: 8, margin: 0, fontSize: 13, color: "#6b7280" }}>Không có khách hàng phù hợp.</p>;
                            return filtered.map((c) => (
                              <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", cursor: "pointer", fontSize: 13 }}>
                                <input
                                  type="checkbox"
                                  checked={addDetailCustomerIds.includes(c.id)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setAddDetailCustomerIds((prev) => [...prev, c.id]);
                                    } else {
                                      setAddDetailCustomerIds((prev) => prev.filter((id) => id !== c.id));
                                    }
                                  }}
                                />
                                <span>{c.name}</span>
                                <span className="font-mono" style={{ color: "#6b7280", fontSize: 12 }}>{c.code}</span>
                              </label>
                            ));
                          })()}
                        </div>
                        {addDetailError ? <p style={{ color: "#dc2626", fontSize: 12, margin: "6px 0 0" }}>{addDetailError}</p> : null}
                        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8, gap: 8 }}>
                          <button type="button" className="btn-cancel" onClick={() => { setShowAddToDetail(false); setAddDetailCustomerIds([]); }}>Hủy</button>
                          <button
                            type="button"
                            className="btn-primary"
                            disabled={addingDetails || !addDetailCustomerIds.length}
                            onClick={handleAddToDetail}
                          >
                            {addingDetails ? "Đang thêm..." : `Thêm (${addDetailCustomerIds.length})`}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
            <div className="dialog-footer dialog-footer--column">
              {pushResult ? (
                <p style={{ margin: 0, fontSize: 13, color: pushResult.ok ? "#15803d" : "#dc2626", textAlign: "center" }}>
                  {pushResult.message}
                </p>
              ) : null}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="btn-cancel" onClick={() => setDetailAudience(null)}>Đóng</button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handlePushToFacebook}
                  disabled={pushingToFacebook || loadingDetail || !detailAudience?.facebookAudienceId}
                  title={!detailAudience?.facebookAudienceId ? "Chưa có Facebook Audience ID" : undefined}
                >
                  {pushingToFacebook ? "Đang đẩy lên FB..." : "↺ Cập nhật lên FB"}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {showCreateAudienceDialog ? (
        <div className="dialog-overlay" onClick={() => setShowCreateAudienceDialog(false)}>
          <section className="dialog-panel dialog-panel--md" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h2>Tạo đối tượng tùy chỉnh</h2>
              <button type="button" className="close-btn" onClick={() => setShowCreateAudienceDialog(false)} aria-label="Đóng">✕</button>
            </div>
            <div className="dialog-body">
              <div className="form-group">
                <label>Tên đối tượng *</label>
                <input value={audienceForm.name} onChange={(e) => setAudienceForm((p) => ({ ...p, name: e.target.value }))} placeholder="Ví dụ: Khách VIP tháng 04" />
              </div>
              <div className="form-group">
                <label>Mô tả</label>
                <textarea value={audienceForm.description} onChange={(e) => setAudienceForm((p) => ({ ...p, description: e.target.value }))} rows={2} placeholder="Mô tả nhóm khách hàng" />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Facebook Audience ID (lấy từ API FB)</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <select className="filter-select" style={{ flex: 1 }} value={audienceForm.facebookAudienceId}
                      onChange={(e) => setAudienceForm((p) => ({ ...p, facebookAudienceId: e.target.value, adAccountId: p.adAccountId || config.adAccountId || "" }))}>
                      <option value="">{loadingFacebookAudienceOptions ? "Đang tải audience từ Facebook..." : "-- Chọn audience hiện có --"}</option>
                      {facebookAudienceOptions.map((item) => (
                        <option key={item.id} value={item.id}>{item.name ? `${item.name} (${item.id})` : item.id}</option>
                      ))}
                    </select>
                    <button type="button" className="btn-cancel" onClick={() => void loadFacebookAudienceOptions()} disabled={loadingFacebookAudienceOptions}>
                      {loadingFacebookAudienceOptions ? "Đang tải..." : "Làm mới"}
                    </button>
                  </div>
                  <p className="stat-text" style={{ marginTop: 6 }}>Cần cấu hình đúng Access Token và ID Ad Account để tải dropdown này.</p>
                </div>
                <div className="form-group">
                  <label>Ad Account ID</label>
                  <input value={audienceForm.adAccountId} onChange={(e) => setAudienceForm((p) => ({ ...p, adAccountId: e.target.value }))} placeholder="act_..." />
                </div>
              </div>
              <div className="form-group">
                <label>Chọn khách hàng đưa vào danh sách (hệ thống sẽ lấy email/số điện thoại mới nhất khi đẩy lên Facebook)</label>
                <div style={{ maxHeight: 220, overflow: "auto", border: "1px solid #dfe3ea", borderRadius: 8, padding: 8 }}>
                  {customers.length === 0 ? (
                    <p className="stat-text" style={{ margin: 0 }}>Chưa có khách hàng để chọn.</p>
                  ) : (
                    customers.map((customer) => {
                      const checked = audienceForm.selectedCustomerIds.includes(customer.id);
                      return (
                        <label key={customer.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 2px", cursor: "pointer" }}>
                          <input type="checkbox" checked={checked} onChange={(e) => {
                            setAudienceForm((p) => {
                              if (e.target.checked) return { ...p, selectedCustomerIds: [...p.selectedCustomerIds, customer.id] };
                              return { ...p, selectedCustomerIds: p.selectedCustomerIds.filter((id) => id !== customer.id) };
                            });
                          }} />
                          <span>
                            {customer.code} - {customer.name}
                            <span className="stat-text" style={{ marginLeft: 8 }}>{customer.phone || "-"} | {customer.phone2 || "-"} | {customer.phone3 || "-"}</span>
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={() => setShowCreateAudienceDialog(false)}>Hủy</button>
              <button type="button" className="btn-primary" onClick={handleCreateAudience} disabled={creatingAudience}>
                {creatingAudience ? "Đang tạo..." : "Tạo đối tượng tùy chỉnh"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
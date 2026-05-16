import { useMemo } from "react";
import DesktopPageFrame from "../components/DesktopPageFrame";
import { formatDateTimeVN } from "../utils/datetime";

function decodeToken(token) {
  try {
    const payload = token.split(".")[1];
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
    );
    return JSON.parse(json);
  } catch (_err) {
    return null;
  }
}

function normalizeRoles(input) {
  if (Array.isArray(input)) {
    return input.map((role) => String(role || "").trim()).filter(Boolean);
  }
  if (typeof input === "string") {
    return input
      .split(",")
      .map((role) => role.trim())
      .filter(Boolean);
  }
  return [];
}

export default function Settings({ token, stores = [], assignedStores = [], activeStore = null }) {
  const payload = decodeToken(token);
  const tokenExpiry = payload?.exp ? formatDateTimeVN(payload.exp * 1000) : "-";
  const now = Date.now();
  const visibleStores = (assignedStores.length ? assignedStores : stores).filter((store) => !store?.isWarehouse);
  const scopeLabel = assignedStores.length
    ? `Theo phân công tài khoản (${visibleStores.length} cửa hàng)`
    : `Toàn bộ hệ thống (${visibleStores.length} cửa hàng)`;
  const defaultStoreName = activeStore?.name
    || visibleStores[0]?.name
    || assignedStores[0]?.name
    || stores.find((store) => !store?.isWarehouse)?.name
    || stores[0]?.name
    || "-";
  const storeUsers = useMemo(() => {
    const rows = [];
    const seen = new Set();

    const shopStores = visibleStores;
    for (const store of shopStores) {
      const storeName = store?.name || "-";
      const manager = store?.manager || null;
      const assignments = Array.isArray(store?.staffAssignments) ? store.staffAssignments : [];

      for (const assignment of assignments) {
        const user = assignment?.user;
        if (!user?.id) continue;

        const key = `${store.id || storeName}:${user.id}`;
        if (seen.has(key)) continue;
        seen.add(key);

        rows.push({
          storeName,
          id: user.id,
          fullName: user.fullName || "-",
          email: user.email || "-",
          roles: normalizeRoles(user.roles),
          isActive: user.isActive !== false,
          isManager: manager?.id === user.id,
          effectiveFrom: assignment?.assignedAt || null,
          effectiveTo: assignment?.effectiveTo || null
        });
      }

      if (manager?.id) {
        const managerKey = `${store.id || storeName}:${manager.id}`;
        if (!seen.has(managerKey)) {
          seen.add(managerKey);
          rows.push({
            storeName,
            id: manager.id,
            fullName: manager.fullName || "-",
            email: manager.email || "-",
            roles: ["STORE_MANAGER"],
            isActive: true,
            isManager: true,
            effectiveFrom: null,
            effectiveTo: null
          });
        }
      }
    }

    return rows;
  }, [visibleStores]);

  return (
    <DesktopPageFrame
      title="Thiết lập"
      description="Thông tin ứng dụng và tài khoản đang đăng nhập"
      kpis={[
        { label: "Số cửa hàng", value: visibleStores.length },
        { label: "Cửa hàng mặc định", value: defaultStoreName },
        { label: "Người dùng hiện tại", value: payload?.email || "-" },
        { label: "Hạn token", value: tokenExpiry },
        { label: "Người dùng thuộc cửa hàng", value: storeUsers.length }
      ]}
    >
      <div className="form-card">
        <h3>Thông tin ứng dụng</h3>
        <div className="info-grid">
          <div><strong>Tên app:</strong> Store App POS</div>
          <div><strong>Phiên bản:</strong> 0.1.0</div>
          <div><strong>Số cửa hàng tải được:</strong> {visibleStores.length}</div>
          <div><strong>Cửa hàng mặc định:</strong> {defaultStoreName}</div>
          <div><strong>Phạm vi dữ liệu:</strong> {scopeLabel}</div>
        </div>
      </div>

      <div className="form-card">
        <h3>Tài khoản đăng nhập</h3>
        <div className="info-grid">
          <div><strong>User ID:</strong> {payload?.sub || "-"}</div>
          <div><strong>Email:</strong> {payload?.email || "-"}</div>
          <div><strong>Vai trò:</strong> {normalizeRoles(payload?.roles).join(", ") || "-"}</div>
          <div><strong>Hạn token:</strong> {tokenExpiry}</div>
        </div>
      </div>

      <div className="form-card">
        <h3>Danh sách người dùng thuộc cửa hàng</h3>
        <div style={{ marginBottom: 12, color: "#4f4f4f", fontSize: "0.92rem" }}>
          Đang hiển thị theo phạm vi: <strong>{scopeLabel}</strong>
        </div>
        {!storeUsers.length ? (
          <div>Chưa có người dùng nào được phân công vào cửa hàng.</div>
        ) : (
          <div className="list-shell">
            <table className="simple-table">
              <thead>
                <tr>
                  <th>Cửa hàng</th>
                  <th>Họ tên</th>
                  <th>Email</th>
                  <th>Vai trò</th>
                  <th>Hiệu lực</th>
                  <th>Hiệu lực từ</th>
                  <th>Hiệu lực đến</th>
                  <th>Trạng thái tài khoản</th>
                </tr>
              </thead>
              <tbody>
                {storeUsers.map((user) => (
                  <tr key={`${user.storeName}-${user.id}`}>
                    <td>{user.storeName}</td>
                    <td>{user.fullName}</td>
                    <td>{user.email}</td>
                    <td>
                      {user.roles.length ? user.roles.join(", ") : "-"}
                      {user.isManager ? " (Quản lý cửa hàng)" : ""}
                    </td>
                    <td>
                      {!user.effectiveTo || new Date(user.effectiveTo).getTime() > now
                        ? "Còn hiệu lực"
                        : "Hết hiệu lực"}
                    </td>
                    <td>{formatDateTimeVN(user.effectiveFrom)}</td>
                    <td>{formatDateTimeVN(user.effectiveTo, "Không giới hạn")}</td>
                    <td>{user.isActive ? "Đang hoạt động" : "Ngưng hoạt động"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DesktopPageFrame>
  );
}

/**
 * ==============================================================================
 * DESPLOYGIT ACCOUNT HUB - DASHBOARD CLIENT SCRIPT
 * ==============================================================================
 */

// Application State
const appState = {
  currentPage: 1,
  limit: 50,
  totalPages: 1,
  totalAccounts: 0,
  searchQuery: "",
  statusFilter: "",
  accounts: [],
  debounceTimer: null
};

// DOM Elements
const elements = {
  currentAdminName: document.getElementById("currentAdminName"),
  statTotalAccounts: document.getElementById("statTotalAccounts"),
  statTodayAccounts: document.getElementById("statTodayAccounts"),
  accountsTableBody: document.getElementById("accountsTableBody"),
  searchInput: document.getElementById("searchInput"),
  statusFilter: document.getElementById("statusFilter"),
  refreshBtn: document.getElementById("refreshBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  copyAllTxtBtn: document.getElementById("copyAllTxtBtn"),
  exportTxtBtn: document.getElementById("exportTxtBtn"),
  exportCsvBtn: document.getElementById("exportCsvBtn"),
  exportJsonBtn: document.getElementById("exportJsonBtn"),
  prevPageBtn: document.getElementById("prevPageBtn"),
  nextPageBtn: document.getElementById("nextPageBtn"),
  pageNumberDisplay: document.getElementById("pageNumberDisplay"),
  pageCurrentRange: document.getElementById("pageCurrentRange"),
  pageTotalCount: document.getElementById("pageTotalCount"),
  detailModal: document.getElementById("detailModal"),
  closeModalBtn: document.getElementById("closeModalBtn"),
  toastContainer: document.getElementById("toastContainer")
};

// Auth Header helper
function getAuthHeaders(customHeaders = {}) {
  const token = localStorage.getItem("auth_token");
  const headers = { ...customHeaders };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

// Toast Notifications
function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${type === "success" ? "✅" : "⚠️"}</span> <span>${message}</span>`;
  elements.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Copy to Clipboard
async function copyToClipboard(text, label = "Dữ liệu") {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`Đã sao chép ${label}!`, "success");
  } catch {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand("copy");
    document.body.removeChild(textArea);
    showToast(`Đã sao chép ${label}!`, "success");
  }
}

// Copy element text helper
window.copyText = function(elementId) {
  const el = document.getElementById(elementId);
  if (el) {
    copyToClipboard(el.textContent.trim(), "thông tin");
  }
};

// 1. Kiểm tra phiên đăng nhập
async function checkAuth() {
  try {
    const res = await fetch("/api/v1/auth/me", {
      headers: getAuthHeaders()
    });
    if (!res.ok) {
      localStorage.removeItem("auth_token");
      window.location.href = "/login.html";
      return false;
    }
    const data = await res.json();
    if (data.user && data.user.username) {
      elements.currentAdminName.textContent = data.user.username;
    }
    return true;
  } catch {
    localStorage.removeItem("auth_token");
    window.location.href = "/login.html";
    return false;
  }
}

// 2. Tải thống kê hệ thống
async function fetchStats() {
  try {
    const res = await fetch("/api/v1/stats", {
      headers: getAuthHeaders()
    });
    const json = await res.json();
    if (json.success && json.data) {
      elements.statTotalAccounts.textContent = json.data.totalAccounts.toLocaleString();
      elements.statTodayAccounts.textContent = json.data.todayAccounts.toLocaleString();
    }
  } catch (err) {
    console.error("Lỗi lấy thống kê:", err);
  }
}

// 3. Tải danh sách tài khoản
async function fetchAccounts() {
  elements.accountsTableBody.innerHTML = `
    <tr>
      <td colspan="8" style="text-align: center; padding: 40px;" class="text-muted">
        ⏳ Đang tải danh sách tài khoản...
      </td>
    </tr>
  `;

  try {
    const params = new URLSearchParams({
      page: appState.currentPage,
      limit: appState.limit,
      search: appState.searchQuery,
      status: appState.statusFilter
    });

    const res = await fetch(`/api/v1/accounts?${params.toString()}`, {
      headers: getAuthHeaders()
    });
    const json = await res.json();

    if (!json.success) {
      throw new Error(json.error || "Không thể tải dữ liệu");
    }

    appState.accounts = json.data || [];
    appState.totalPages = json.pagination.totalPages || 1;
    appState.totalAccounts = json.pagination.total || 0;

    renderAccountsTable(appState.accounts);
    renderPagination(json.pagination);
  } catch (err) {
    elements.accountsTableBody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 40px; color: var(--danger);">
          ❌ Lỗi tải dữ liệu: ${err.message}
        </td>
      </tr>
    `;
  }
}

// Render dữ liệu lên bảng
function renderAccountsTable(accounts) {
  if (accounts.length === 0) {
    elements.accountsTableBody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 40px;" class="text-muted">
          📭 Chưa có tài khoản nào được lưu hoặc không khớp bộ lọc!
        </td>
      </tr>
    `;
    return;
  }

  elements.accountsTableBody.innerHTML = accounts.map((acc) => {
    const dateFormatted = acc.created_at ? new Date(acc.created_at).toLocaleString("vi-VN") : "N/A";
    const maskedPassword = "••••••••••••";
    const fullTxtLine = `${acc.email}|${acc.password}|${acc.two_factor_secret || ""}`;

    return `
      <tr id="row-account-${acc.id}">
        <td class="mono text-dim">#${acc.id}</td>
        <td>
          <div class="account-email-cell">
            <span class="mono">${escapeHtml(acc.email)}</span>
            <button class="copy-mini-btn" title="Sao chép Email" onclick="copyToClipboard('${escapeHtml(acc.email)}', 'Email')">📋</button>
            <button class="copy-mini-btn" title="Sao chép định dạng: email|pass|2fa" onclick="copyToClipboard('${escapeHtml(fullTxtLine)}', 'Line Acc')">⚡</button>
          </div>
        </td>
        <td class="mono">${escapeHtml(acc.username || "—")}</td>
        <td>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span class="mono" id="pass-val-${acc.id}">${maskedPassword}</span>
            <button class="copy-mini-btn" title="Hiện mật khẩu" onclick="togglePasswordView(${acc.id}, '${escapeHtml(acc.password)}')">👁️</button>
            <button class="copy-mini-btn" title="Sao chép Mật khẩu" onclick="copyToClipboard('${escapeHtml(acc.password)}', 'Mật khẩu')">📋</button>
          </div>
        </td>
        <td>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span class="badge badge-secret mono">${escapeHtml(acc.two_factor_secret || "N/A")}</span>
            ${acc.two_factor_secret ? `<button class="copy-mini-btn" title="Sao chép 2FA" onclick="copyToClipboard('${escapeHtml(acc.two_factor_secret)}', '2FA Secret')">📋</button>` : ""}
          </div>
        </td>
        <td class="mono" style="font-size: 12px; color: var(--text-muted);">${escapeHtml(acc.proxy || "Direct")}</td>
        <td style="font-size: 12px; color: var(--text-dim);">${dateFormatted}</td>
        <td style="text-align: right;">
          <button class="btn btn-secondary btn-sm" onclick="showAccountDetail(${acc.id})" title="Xem chi tiết">🔍</button>
          <button class="btn btn-danger-outline btn-sm" onclick="deleteAccount(${acc.id}, '${escapeHtml(acc.email)}')" title="Xóa tài khoản">🗑️</button>
        </td>
      </tr>
    `;
  }).join("");
}

// Ẩn hiện mật khẩu từng dòng
window.togglePasswordView = function(id, pass) {
  const span = document.getElementById(`pass-val-${id}`);
  if (span) {
    const isMasked = span.textContent.includes("•");
    span.textContent = isMasked ? pass : "••••••••••••";
  }
};

// Cập nhật thanh phân trang
function renderPagination(pagination) {
  const { page, total, limit, totalPages } = pagination;
  const start = total === 0 ? 0 : (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);

  elements.pageCurrentRange.textContent = `${start} - ${end}`;
  elements.pageTotalCount.textContent = total;
  elements.pageNumberDisplay.textContent = `${page} / ${totalPages}`;

  elements.prevPageBtn.disabled = page <= 1;
  elements.nextPageBtn.disabled = page >= totalPages;
}

// Xem chi tiết tài khoản (Modal)
window.showAccountDetail = function(id) {
  const acc = appState.accounts.find((a) => a.id === id);
  if (!acc) return;

  document.getElementById("modalEmailTitle").textContent = `Chi Tiết: ${acc.email}`;
  document.getElementById("modalEmail").textContent = acc.email;
  document.getElementById("modalUsername").textContent = acc.username || "Chưa thiết lập";
  document.getElementById("modalPassword").textContent = acc.password;
  document.getElementById("modal2Fa").textContent = acc.two_factor_secret || "Không có";
  document.getElementById("modalRecoveryCodes").textContent = (acc.recovery_codes && acc.recovery_codes.length > 0) 
    ? acc.recovery_codes.join("\n") 
    : "Không có mã dự phòng";
  document.getElementById("modalProxyInfo").textContent = `Proxy: ${acc.proxy || "Direct"} | Tạo lúc: ${acc.created_at} | IP gửi: ${acc.client_ip || "N/A"}`;

  elements.detailModal.classList.remove("hidden");
};

// Xóa tài khoản
window.deleteAccount = async function(id, email) {
  if (!confirm(`Bạn có chắc chắn muốn xóa tài khoản "${email}" không? Hành động này không thể hoàn tác.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/v1/accounts/${id}`, {
      method: "DELETE",
      headers: getAuthHeaders()
    });
    const json = await res.json();
    if (json.success) {
      showToast(`Đã xóa tài khoản "${email}"`, "success");
      fetchStats();
      fetchAccounts();
    } else {
      showToast(json.error || "Xóa tài khoản thất bại!", "danger");
    }
  } catch (err) {
    showToast("Lỗi kết nối khi xóa tài khoản!", "danger");
  }
};

// Thoát modal
elements.closeModalBtn.addEventListener("click", () => {
  elements.detailModal.classList.add("hidden");
});

elements.detailModal.addEventListener("click", (e) => {
  if (e.target === elements.detailModal) {
    elements.detailModal.classList.add("hidden");
  }
});

// Copy all visible accounts as TXT (email|password|2fa)
elements.copyAllTxtBtn.addEventListener("click", () => {
  if (appState.accounts.length === 0) {
    showToast("Không có tài khoản nào để copy!", "danger");
    return;
  }

  const lines = appState.accounts.map((acc) => `${acc.email}|${acc.password}|${acc.two_factor_secret || ""}`).join("\n");
  copyToClipboard(lines, `${appState.accounts.length} tài khoản`);
});

// Export endpoints
elements.exportTxtBtn.addEventListener("click", () => {
  window.open(`/api/v1/export?format=txt&search=${encodeURIComponent(appState.searchQuery)}&status=${encodeURIComponent(appState.statusFilter)}`, "_blank");
});

elements.exportCsvBtn.addEventListener("click", () => {
  window.open(`/api/v1/export?format=csv&search=${encodeURIComponent(appState.searchQuery)}&status=${encodeURIComponent(appState.statusFilter)}`, "_blank");
});

elements.exportJsonBtn.addEventListener("click", () => {
  window.open(`/api/v1/export?format=json&search=${encodeURIComponent(appState.searchQuery)}&status=${encodeURIComponent(appState.statusFilter)}`, "_blank");
});

// Search debounce
elements.searchInput.addEventListener("input", (e) => {
  clearTimeout(appState.debounceTimer);
  appState.debounceTimer = setTimeout(() => {
    appState.searchQuery = e.target.value.trim();
    appState.currentPage = 1;
    fetchAccounts();
  }, 350);
});

// Status filter change
elements.statusFilter.addEventListener("change", (e) => {
  appState.statusFilter = e.target.value;
  appState.currentPage = 1;
  fetchAccounts();
});

// Pagination buttons
elements.prevPageBtn.addEventListener("click", () => {
  if (appState.currentPage > 1) {
    appState.currentPage--;
    fetchAccounts();
  }
});

elements.nextPageBtn.addEventListener("click", () => {
  if (appState.currentPage < appState.totalPages) {
    appState.currentPage++;
    fetchAccounts();
  }
});

// Refresh button
elements.refreshBtn.addEventListener("click", () => {
  fetchStats();
  fetchAccounts();
  showToast("Đã làm mới dữ liệu!", "success");
});

// Logout button
elements.logoutBtn.addEventListener("click", async () => {
  try {
    await fetch("/api/v1/auth/logout", { method: "POST", headers: getAuthHeaders() });
    localStorage.removeItem("auth_token");
    window.location.href = "/login.html";
  } catch {
    localStorage.removeItem("auth_token");
    window.location.href = "/login.html";
  }
});

// Helper Escape HTML
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Khởi chạy Dashboard
(async () => {
  const isAuthed = await checkAuth();
  if (isAuthed) {
    fetchStats();
    fetchAccounts();
    // Tự động làm mới số liệu mỗi 30 giây
    setInterval(fetchStats, 30000);
  }
})();

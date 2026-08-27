/**
 * ==============================================================================
 * DATABASE SERVICE (SQLITE REPOSITORY)
 * ==============================================================================
 * Quản lý kết nối và thao tác dữ liệu với SQLite Database
 * 
 * Quy tắc đặt tên biến:
 * - Biến/Phương thức private: _{name}
 * - Biến/Phương thức public: {nameValue}
 * ==============================================================================
 */

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export class DatabaseService {
  // Private / Protected Properties
  _db = null;
  _dbPath = "";

  constructor(dbPath = "./data/accounts.db") {
    this._dbPath = dbPath;
    this._initDatabase();
  }

  // Khởi tạo thư mục và bảng SQLite
  _initDatabase() {
    const dir = path.dirname(this._dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this._db = new Database(this._dbPath);
    this._db.pragma("journal_mode = WAL");
    this._db.pragma("foreign_keys = ON");

    // Tạo bảng accounts
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        username TEXT,
        password TEXT NOT NULL,
        two_factor_secret TEXT,
        recovery_codes TEXT,
        proxy TEXT,
        status TEXT DEFAULT 'active',
        client_ip TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
      );

      CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);
      CREATE INDEX IF NOT EXISTS idx_accounts_created_at ON accounts(created_at);
      CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);
    `);
  }

  // Thêm mới hoặc cập nhật 1 tài khoản
  insertOrUpdateAccount(accountData = {}) {
    const {
      email,
      username = "",
      password,
      twoFactorSecret = "",
      recoveryCodes = [],
      proxy = "",
      status = "active",
      clientIp = "",
      notes = ""
    } = accountData;

    if (!email || !password) {
      throw new Error("Email và mật khẩu là bắt buộc!");
    }

    const recoveryCodesStr = Array.isArray(recoveryCodes) ? recoveryCodes.join("\n") : String(recoveryCodes || "");

    const stmt = this._db.prepare(`
      INSERT INTO accounts (email, username, password, two_factor_secret, recovery_codes, proxy, status, client_ip, notes, updated_at)
      VALUES (@email, @username, @password, @twoFactorSecret, @recoveryCodes, @proxy, @status, @clientIp, @notes, datetime('now', 'localtime'))
      ON CONFLICT(email) DO UPDATE SET
        username = excluded.username,
        password = excluded.password,
        two_factor_secret = excluded.two_factor_secret,
        recovery_codes = excluded.recovery_codes,
        proxy = excluded.proxy,
        status = excluded.status,
        client_ip = excluded.client_ip,
        notes = excluded.notes,
        updated_at = datetime('now', 'localtime')
    `);

    const info = stmt.run({
      email: email.trim(),
      username: username ? username.trim() : null,
      password: password.trim(),
      twoFactorSecret: twoFactorSecret ? twoFactorSecret.trim() : null,
      recoveryCodes: recoveryCodesStr,
      proxy: proxy ? proxy.trim() : null,
      status: status.trim(),
      clientIp: clientIp ? clientIp.trim() : null,
      notes: notes ? notes.trim() : null
    });

    return {
      success: true,
      id: info.lastInsertRowid,
      email: email.trim(),
      isNew: info.changes > 0
    };
  }

  // Thêm danh sách nhiều tài khoản (Batch Insert Transaction)
  insertBatch(accountsList = [], clientIp = "") {
    if (!Array.isArray(accountsList) || accountsList.length === 0) {
      return { successCount: 0, failedCount: 0, results: [] };
    }

    let successCount = 0;
    let failedCount = 0;
    const results = [];

    const insertTx = this._db.transaction((items) => {
      for (const item of items) {
        try {
          const res = this.insertOrUpdateAccount({ ...item, clientIp });
          successCount++;
          results.push({ email: item.email, status: "success", id: res.id });
        } catch (err) {
          failedCount++;
          results.push({ email: item.email, status: "failed", error: err.message });
        }
      }
    });

    insertTx(accountsList);
    return { successCount, failedCount, results };
  }

  // Lấy danh sách tài khoản kèm bộ lọc & phân trang
  getAccounts({ page = 1, limit = 50, search = "", status = "", sortBy = "created_at", sortOrder = "DESC" } = {}) {
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(500, Math.max(1, parseInt(limit) || 50));
    const offset = (pageNum - 1) * limitNum;

    const allowedSortFields = ["id", "email", "username", "created_at", "status"];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : "created_at";
    const sortDirection = sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";

    const conditions = [];
    const params = {};

    if (search && search.trim()) {
      conditions.push("(email LIKE @search OR username LIKE @search OR proxy LIKE @search)");
      params.search = `%${search.trim()}%`;
    }

    if (status && status.trim()) {
      conditions.push("status = @status");
      params.status = status.trim();
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Đếm tổng số bản ghi
    const countStmt = this._db.prepare(`SELECT COUNT(*) as total FROM accounts ${whereClause}`);
    const { total } = countStmt.get(params);

    // Lấy dữ liệu theo trang
    const listStmt = this._db.prepare(`
      SELECT id, email, username, password, two_factor_secret, recovery_codes, proxy, status, client_ip, notes, created_at, updated_at
      FROM accounts
      ${whereClause}
      ORDER BY ${sortField} ${sortDirection}
      LIMIT @limit OFFSET @offset
    `);

    const items = listStmt.all({ ...params, limit: limitNum, offset });

    return {
      data: items.map((item) => ({
        ...item,
        recovery_codes: item.recovery_codes ? item.recovery_codes.split("\n").filter(Boolean) : []
      })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum) || 1
      }
    };
  }

  // Lấy chi tiết 1 tài khoản theo ID
  getAccountById(id) {
    const stmt = this._db.prepare(`SELECT * FROM accounts WHERE id = ?`);
    const item = stmt.get(id);
    if (!item) return null;
    return {
      ...item,
      recovery_codes: item.recovery_codes ? item.recovery_codes.split("\n").filter(Boolean) : []
    };
  }

  // Xóa tài khoản theo ID
  deleteAccount(id) {
    const stmt = this._db.prepare(`DELETE FROM accounts WHERE id = ?`);
    const info = stmt.run(id);
    return info.changes > 0;
  }

  // Thống kê tổng quan hệ thống
  getStats() {
    const totalStmt = this._db.prepare(`SELECT COUNT(*) as total FROM accounts`);
    const { total } = totalStmt.get();

    const todayStmt = this._db.prepare(`
      SELECT COUNT(*) as todayCount 
      FROM accounts 
      WHERE date(created_at) = date('now', 'localtime')
    `);
    const { todayCount } = todayStmt.get();

    const statusStmt = this._db.prepare(`
      SELECT status, COUNT(*) as count 
      FROM accounts 
      GROUP BY status
    `);
    const statusCounts = statusStmt.all();

    const recentStmt = this._db.prepare(`
      SELECT id, email, username, created_at 
      FROM accounts 
      ORDER BY created_at DESC 
      LIMIT 5
    `);
    const recentAccounts = recentStmt.all();

    return {
      totalAccounts: total,
      todayAccounts: todayCount,
      byStatus: statusCounts,
      recent: recentAccounts
    };
  }

  // Xuất toàn bộ dữ liệu (TXT: email|pass|2fa, JSON, hoặc CSV)
  exportAccounts(format = "txt", search = "", status = "") {
    const conditions = [];
    const params = {};

    if (search && search.trim()) {
      conditions.push("(email LIKE @search OR username LIKE @search OR proxy LIKE @search)");
      params.search = `%${search.trim()}%`;
    }

    if (status && status.trim()) {
      conditions.push("status = @status");
      params.status = status.trim();
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const stmt = this._db.prepare(`
      SELECT email, password, two_factor_secret, username, proxy, created_at
      FROM accounts
      ${whereClause}
      ORDER BY created_at DESC
    `);
    const rows = stmt.all(params);

    if (format === "json") {
      return { contentType: "application/json", content: JSON.stringify(rows, null, 2), filename: "accounts.json" };
    }

    if (format === "csv") {
      const header = "Email,Username,Password,2FA_Secret,Proxy,CreatedAt\n";
      const body = rows
        .map((r) => `"${r.email}","${r.username || ""}","${r.password}","${r.two_factor_secret || ""}","${r.proxy || ""}","${r.created_at}"`)
        .join("\n");
      return { contentType: "text/csv; charset=utf-8", content: header + body, filename: "accounts.csv" };
    }

    // Default TXT: email|password|2fa_secret
    const txtContent = rows.map((r) => `${r.email}|${r.password}|${r.two_factor_secret || ""}`).join("\n");
    return { contentType: "text/plain; charset=utf-8", content: txtContent, filename: "accounts.txt" };
  }

  // Đóng kết nối Database khi dừng server
  close() {
    if (this._db) {
      this._db.close();
    }
  }
}

/**
 * ==============================================================================
 * AUTHENTICATION & SECURITY MIDDLEWARE
 * ==============================================================================
 * Quản lý xác thực API Key (cho Tool Client) và JWT Session (cho Web Dashboard)
 * 
 * Quy tắc đặt tên biến:
 * - Biến/Phương thức private: _{name}
 * - Biến/Phương thức public: {nameValue}
 * ==============================================================================
 */

import jwt from "jsonwebtoken";

export class AuthService {
  // Private / Protected Properties
  _apiSecretKey = "";
  _adminUsername = "";
  _adminPassword = "";
  _jwtSecret = "";

  constructor({ apiSecretKey, adminUsername, adminPassword, jwtSecret }) {
    this._apiSecretKey = apiSecretKey || "shardx-secret-api-key-2026";
    this._adminUsername = adminUsername || "admin";
    this._adminPassword = adminPassword || "admin123";
    this._jwtSecret = jwtSecret || "jwt-secret-key-shardx-2026";
  }

  // Middleware xác thực API Key cho client bot
  apiKeyAuth = (req, res, next) => {
    const apiKey = req.headers["x-api-key"] || (req.headers["authorization"] ? req.headers["authorization"].replace(/^Bearer\s+/i, "") : null);

    if (!apiKey || apiKey !== this._apiSecretKey) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized: API Key không hợp lệ hoặc bị thiếu trong Header (X-API-Key)!"
      });
    }
    next();
  };

  // Xác thực đăng nhập Admin Dashboard
  validateAdminCredentials(username, password) {
    if (!username || !password) return false;
    return username === this._adminUsername && password === this._adminPassword;
  }

  // Tạo JWT Token cho phiên đăng nhập Admin
  generateAdminToken(username) {
    return jwt.sign({ username, role: "admin" }, this._jwtSecret, { expiresIn: "7d" });
  }

  // Middleware bảo vệ các trang / API của Dashboard
  adminAuth = (req, res, next) => {
    const token = req.cookies?.auth_token || (req.headers["authorization"] ? req.headers["authorization"].replace(/^Bearer\s+/i, "") : null);

    if (!token) {
      if (req.accepts("html") && !req.path.startsWith("/api/")) {
        return res.redirect("/login.html");
      }
      return res.status(401).json({ success: false, error: "Unauthorized: Phiên đăng nhập hết hạn hoặc chưa đăng nhập!" });
    }

    try {
      const decoded = jwt.verify(token, this._jwtSecret);
      req.user = decoded;
      next();
    } catch {
      if (req.accepts("html") && !req.path.startsWith("/api/")) {
        return res.redirect("/login.html");
      }
      return res.status(401).json({ success: false, error: "Unauthorized: Token không hợp lệ!" });
    }
  };
}

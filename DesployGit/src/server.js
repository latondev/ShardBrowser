/**
 * ==============================================================================
 * CENTRAL ACCOUNT HUB SERVER (REST API & WEB DASHBOARD)
 * ==============================================================================
 * Server trung tâm tiếp nhận, lưu trữ tài khoản và cung cấp Web Dashboard quản trị
 * 
 * Quy tắc đặt tên biến:
 * - Biến/Phương thức private: _{name}
 * - Biến/Phương thức public: {nameValue}
 * ==============================================================================
 */

import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DatabaseService } from "./database.js";
import { AuthService } from "./auth.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ServerApp {
  // Private / Protected Properties
  _app = null;
  _port = 8080;
  _dbService = null;
  _authService = null;
  _httpServer = null;

  constructor() {
    this._port = parseInt(process.env.PORT) || 8080;
    const dbPath = process.env.DATABASE_PATH || "./data/accounts.db";

    this._dbService = new DatabaseService(dbPath);
    this._authService = new AuthService({
      apiSecretKey: process.env.API_SECRET_KEY || "shardx-secret-api-key-2026-very-secure",
      adminUsername: process.env.ADMIN_USERNAME || "admin",
      adminPassword: process.env.ADMIN_PASSWORD || "AdminSecure@2026!Pass",
      jwtSecret: process.env.JWT_SECRET || "jwt-secret-key-shardx-hub-2026"
    });

    this._app = express();
    this._setupMiddlewares();
    this._setupRoutes();
  }

  // Cấu hình Middleware hệ thống
  _setupMiddlewares() {
    this._app.use(
      helmet({
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false
      })
    );
    this._app.use(cors({ origin: true, credentials: true }));
    this._app.use(express.json({ limit: "15mb" }));
    this._app.use(express.urlencoded({ extended: true, limit: "15mb" }));
    this._app.use(cookieParser());

    // Phục vụ file tĩnh Dashboard
    const publicPath = path.join(__dirname, "..", "public");
    this._app.use(express.static(publicPath));
  }

  // Thiết lập tất cả các Route API
  _setupRoutes() {
    // 1. Healthcheck Endpoint
    this._app.get("/api/v1/health", (req, res) => {
      res.json({
        status: "ok",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        service: "DesployGit Account Hub"
      });
    });

    // 2. Auth Routes (Admin Dashboard)
    const loginLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 20,
      message: { success: false, error: "Quá nhiều lần thử đăng nhập, vui lòng đợi 15 phút!" }
    });

    this._app.post("/api/v1/auth/login", loginLimiter, (req, res) => {
      const { username, password } = req.body;
      const isValid = this._authService.validateAdminCredentials(username, password);

      if (!isValid) {
        return res.status(401).json({ success: false, error: "Tên đăng nhập hoặc mật khẩu không chính xác!" });
      }

      const token = this._authService.generateAdminToken(username);
      res.cookie("auth_token", token, {
        httpOnly: true,
        secure: false,
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 ngày
      });

      return res.json({
        success: true,
        message: "Đăng nhập thành công!",
        token
      });
    });

    this._app.post("/api/v1/auth/logout", (req, res) => {
      res.clearCookie("auth_token");
      res.json({ success: true, message: "Đã đăng xuất!" });
    });

    this._app.get("/api/v1/auth/me", this._authService.adminAuth, (req, res) => {
      res.json({ success: true, user: req.user });
    });

    // Middleware đa năng: Chấp nhận cả API Key (Client) hoặc Admin Token (Dashboard)
    const flexibleAuth = (req, res, next) => {
      const apiKey = req.headers["x-api-key"] || (req.headers["authorization"] ? req.headers["authorization"].replace(/^Bearer\s+/i, "") : null);
      if (apiKey && apiKey === process.env.API_SECRET_KEY) {
        return next();
      }
      return this._authService.adminAuth(req, res, next);
    };

    // 3. Ingestion Route: POST /api/v1/accounts (Thêm đơn hoặc Batch)
    this._app.post("/api/v1/accounts", this._authService.apiKeyAuth, (req, res) => {
      try {
        const clientIp = req.ip || req.socket?.remoteAddress || "";
        const body = req.body;

        // Xử lý nếu gửi Batch danh sách accounts
        if (Array.isArray(body.accounts)) {
          const result = this._dbService.insertBatch(body.accounts, clientIp);
          return res.status(201).json({
            success: true,
            message: `Đã xử lý ${result.successCount} tài khoản thành công!`,
            data: result
          });
        }

        // Xử lý 1 tài khoản đơn lẻ
        const accountData = {
          email: body.email,
          username: body.username,
          password: body.password,
          twoFactorSecret: body.twoFactorSecret || body.two_factor_secret || body["2fa"] || "",
          recoveryCodes: body.recoveryCodes || body.recovery_codes || [],
          proxy: body.proxy || "",
          status: body.status || "active",
          clientIp: clientIp,
          notes: body.notes || ""
        };

        const result = this._dbService.insertOrUpdateAccount(accountData);
        return res.status(201).json({
          success: true,
          message: "Lưu tài khoản thành công!",
          data: result
        });
      } catch (err) {
        return res.status(400).json({ success: false, error: err.message });
      }
    });

    // 4. Query Accounts: GET /api/v1/accounts
    this._app.get("/api/v1/accounts", flexibleAuth, (req, res) => {
      try {
        const { page, limit, search, status, sortBy, sortOrder } = req.query;
        const result = this._dbService.getAccounts({ page, limit, search, status, sortBy, sortOrder });
        res.json({ success: true, ...result });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // 5. Get Single Account: GET /api/v1/accounts/:id
    this._app.get("/api/v1/accounts/:id", flexibleAuth, (req, res) => {
      try {
        const account = this._dbService.getAccountById(req.params.id);
        if (!account) {
          return res.status(404).json({ success: false, error: "Không tìm thấy tài khoản!" });
        }
        res.json({ success: true, data: account });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // 6. Delete Account: DELETE /api/v1/accounts/:id
    this._app.delete("/api/v1/accounts/:id", this._authService.adminAuth, (req, res) => {
      try {
        const isDeleted = this._dbService.deleteAccount(req.params.id);
        if (!isDeleted) {
          return res.status(404).json({ success: false, error: "Không tìm thấy tài khoản để xóa!" });
        }
        res.json({ success: true, message: "Đã xóa tài khoản thành công!" });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // 7. Stats: GET /api/v1/stats
    this._app.get("/api/v1/stats", flexibleAuth, (req, res) => {
      try {
        const stats = this._dbService.getStats();
        res.json({ success: true, data: stats });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // 8. Export Accounts: GET /api/v1/export
    this._app.get("/api/v1/export", flexibleAuth, (req, res) => {
      try {
        const format = req.query.format || "txt";
        const search = req.query.search || "";
        const status = req.query.status || "";

        const { contentType, content, filename } = this._dbService.exportAccounts(format, search, status);

        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send(content);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // SPA fallback
    this._app.get("*", (req, res) => {
      const publicPath = path.join(__dirname, "..", "public");
      res.sendFile(path.join(publicPath, "index.html"));
    });
  }

  // Khởi động HTTP Server
  startServer() {
    this._httpServer = this._app.listen(this._port, "0.0.0.0", () => {
      console.log("==================================================================");
      console.log(`🚀 DESPLOYGIT ACCOUNT HUB ĐANG CHẠY TẠI CỔNG: ${this._port}`);
      console.log(`📊 Web Dashboard  : http://localhost:${this._port}`);
      console.log(`🔑 Ingest API     : POST http://localhost:${this._port}/api/v1/accounts`);
      console.log(`🏥 Health Check   : GET http://localhost:${this._port}/api/v1/health`);
      console.log("==================================================================");
    });

    // Xử lý dừng máy chủ an toàn
    const shutdown = () => {
      console.log("\n⚠️ Đang tắt máy chủ DesployGit Hub...");
      if (this._httpServer) {
        this._httpServer.close(() => {
          this._dbService.close();
          console.log("✅ Đã giải phóng cổng và đóng kết nối Database.");
          process.exit(0);
        });
      }
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }
}

// Khởi chạy Server
const app = new ServerApp();
app.startServer();
export default app;

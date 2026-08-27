/**
 * ==============================================================================
 * VPS DEPLOYMENT AUTOMATION TOOL (SSH2 / SFTP)
 * ==============================================================================
 */

import { Client } from "ssh2";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class VpsManager {
  _conn = null;
  _config = {
    host: "180.93.115.138",
    port: 22,
    username: "root",
    password: "uN0%lfIHjilk",
    readyTimeout: 60000,
    keepaliveInterval: 10000
  };

  constructor(customConfig = {}) {
    this._config = { ...this._config, ...customConfig };
  }

  // Kết nối SSH
  connect() {
    return new Promise((resolve, reject) => {
      this._conn = new Client();
      this._conn
        .on("ready", () => {
          console.log(`✅ [SSH] Đã kết nối thành công tới VPS: ${this._config.host}`);
          resolve(this._conn);
        })
        .on("error", (err) => {
          console.error(`❌ [SSH Lỗi]: ${err.message}`);
          reject(err);
        })
        .connect(this._config);
    });
  }

  // Thực thi lệnh SSH từ xa
  execCommand(cmd) {
    return new Promise((resolve, reject) => {
      if (!this._conn) return reject(new Error("Chưa kết nối SSH"));

      console.log(`\n🚀 [VPS RUN]: ${cmd}`);
      this._conn.exec(cmd, (err, stream) => {
        if (err) return reject(err);

        let stdout = "";
        let stderr = "";

        stream
          .on("close", (code) => {
            if (code === 0) {
              resolve({ stdout, stderr, code });
            } else {
              resolve({ stdout, stderr, code });
            }
          })
          .on("data", (data) => {
            const text = data.toString();
            stdout += text;
            process.stdout.write(text);
          })
          .stderr.on("data", (data) => {
            const text = data.toString();
            stderr += text;
            process.stderr.write(text);
          });
      });
    });
  }

  // Upload file qua SFTP
  async uploadFile(localPath, remotePath) {
    return new Promise((resolve, reject) => {
      this._conn.sftp((err, sftp) => {
        if (err) return reject(err);

        const readStream = fs.createReadStream(localPath);
        const writeStream = sftp.createWriteStream(remotePath);

        writeStream.on("close", () => {
          resolve();
        });

        writeStream.on("error", (e) => {
          reject(e);
        });

        readStream.pipe(writeStream);
      });
    });
  }

  // Upload thư mục đệ quy qua SFTP
  async uploadDirectory(localDir, remoteDir) {
    const sftp = await new Promise((resolve, reject) => {
      this._conn.sftp((err, sftp) => (err ? reject(err) : resolve(sftp)));
    });

    const mkdirRecursive = async (rPath) => {
      const parts = rPath.split("/").filter(Boolean);
      let current = "";
      for (const part of parts) {
        current += "/" + part;
        await new Promise((res) => {
          sftp.mkdir(current, () => res());
        });
      }
    };

    await mkdirRecursive(remoteDir);

    const entries = fs.readdirSync(localDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "data") {
        continue;
      }

      const localItem = path.join(localDir, entry.name);
      const remoteItem = `${remoteDir}/${entry.name}`;

      if (entry.isDirectory()) {
        await this.uploadDirectory(localItem, remoteItem);
      } else if (entry.isFile()) {
        console.log(`📤 Uploading: ${entry.name} -> ${remoteItem}`);
        await new Promise((resolve, reject) => {
          const rs = fs.createReadStream(localItem);
          const ws = sftp.createWriteStream(remoteItem);
          ws.on("close", resolve);
          ws.on("error", reject);
          rs.pipe(ws);
        });
      }
    }
  }

  close() {
    if (this._conn) {
      this._conn.end();
      console.log("🔒 Đã đóng kết nối SSH.");
    }
  }
}

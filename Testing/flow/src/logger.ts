import * as path from 'path';
import * as fs from 'fs';

class Logger {
  private _level: string = process.env.LOG_LEVEL || 'info';
  private _levels: Record<string, number> = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3
  };
  private _logDir: string;
  private _errorLogPath: string;
  private _combinedLogPath: string;

  constructor() {
    this._logDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(this._logDir)) {
      try {
        fs.mkdirSync(this._logDir, { recursive: true });
      } catch {}
    }
    this._errorLogPath = path.join(this._logDir, 'error.log');
    this._combinedLogPath = path.join(this._logDir, 'combined.log');
  }

  set level(levelValue: string) {
    this._level = levelValue;
  }

  get level(): string {
    return this._level;
  }

  private _formatMessage(level: string, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level.toUpperCase()}]: ${message}`;
  }

  private _writeToFile(filePath: string, text: string): void {
    try {
      fs.appendFileSync(filePath, text + '\n', 'utf-8');
    } catch {}
  }

  error(message: string, ...args: any[]): void {
    const formatted = this._formatMessage('error', message);
    console.error(`\x1b[31m${formatted}\x1b[0m`, ...args);
    this._writeToFile(this._errorLogPath, formatted);
    this._writeToFile(this._combinedLogPath, formatted);
  }

  warn(message: string, ...args: any[]): void {
    if ((this._levels[this._level] ?? 2) >= 1) {
      const formatted = this._formatMessage('warn', message);
      console.warn(`\x1b[33m${formatted}\x1b[0m`, ...args);
      this._writeToFile(this._combinedLogPath, formatted);
    }
  }

  info(message: string, ...args: any[]): void {
    if ((this._levels[this._level] ?? 2) >= 2) {
      const formatted = this._formatMessage('info', message);
      console.log(`\x1b[32m${formatted}\x1b[0m`, ...args);
      this._writeToFile(this._combinedLogPath, formatted);
    }
  }

  debug(message: string, ...args: any[]): void {
    if ((this._levels[this._level] ?? 2) >= 3) {
      const formatted = this._formatMessage('debug', message);
      console.log(`\x1b[90m${formatted}\x1b[0m`, ...args);
      this._writeToFile(this._combinedLogPath, formatted);
    }
  }
}

export const logger = new Logger();

export function setLogLevel(levelValue: string): void {
  logger.level = levelValue;
}
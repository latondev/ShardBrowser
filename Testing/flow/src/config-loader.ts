import * as fs from 'fs';
import * as path from 'path';
import { TestConfig } from './types';

export function loadConfig(configPath: string): TestConfig {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Configuration file not found: ${configPath}`);
  }
  const raw = fs.readFileSync(configPath, 'utf-8');
  const config = JSON.parse(raw) as TestConfig;
  validateConfig(config);
  return config;
}

function validateConfig(config: TestConfig): void {
  if (!config.url) throw new Error('Missing required field: url');
  if (config.startIndex === undefined) throw new Error('Missing required field: startIndex');
  if (!config.prompt) throw new Error('Missing required field: prompt');
  if (!config.extensionPath) throw new Error('Missing required field: extensionPath');
  if (!config.timeout) config.timeout = 30;
}
#!/usr/bin/env node

import { runFlow } from './index';
import { logger } from './logger';
import * as fs from 'fs';

function parseArgs(): { config: string; profile?: string } {
  const args = process.argv.slice(2);
  let configPath = 'config.json';
  let profileName: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-c' || args[i] === '--config') {
      configPath = args[i + 1] || 'config.json';
      i++;
    } else if (args[i] === '-p' || args[i] === '--profile') {
      profileName = args[i + 1];
      i++;
    }
  }

  if (!fs.existsSync(configPath) && fs.existsSync('config.sample.json')) {
    configPath = 'config.sample.json';
  }

  return { config: configPath, profile: profileName };
}

(async () => {
  try {
    const options = parseArgs();
    logger.info(`Running full flow with config: ${options.config}`);
    await runFlow(options.config);
    process.exit(0);
  } catch (error: any) {
    logger.error(`Fatal error: ${error.message}`);
    process.exit(1);
  }
})();
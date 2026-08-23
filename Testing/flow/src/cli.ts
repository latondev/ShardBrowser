#!/usr/bin/env node

import { Command } from 'commander';
import { runFlow } from './index';
import { logger } from './logger';

const program = new Command();

program
  .name('test-extension-flow')
  .description('Automated flow for ShardBrowser extension')
  .option('-c, --config <path>', 'Path to configuration JSON file', 'config.json')
  .option('-p, --profile <name>', 'ShardBrowser profile name (optional)')
  .parse(process.argv);

const options = program.opts();

(async () => {
  try {
    await runFlow(options.config);
    process.exit(0);
  } catch (error: any) {
    logger.error(`Fatal error: ${error.message}`);
    process.exit(1);
  }
})();
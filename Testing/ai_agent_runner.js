import { AiAgentRunner } from "./git/ai_agent_runner.js";
export { AiAgentRunner };

async function main() {
  const runner = new AiAgentRunner();
  try {
    await runner.runFullE2EWorkflow({
      saveSecrets: true,
    });
  } catch (error) {
    console.error(`\n❌ [Lỗi Hệ Thống]: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1].endsWith("ai_agent_runner.js"))) {
  main();
}

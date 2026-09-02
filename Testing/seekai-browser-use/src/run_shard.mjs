import "dotenv/config";
import { runFullAutonomousAccount, FIXED_PASSWORD } from "./seekai_auto_pipeline.mjs";

console.log("==================================================================");
console.log("🚀 [SHARDBROWSER RUNNER] TỰ ĐỘNG SINH GMAIL TEMP & TẠO SEEKAI KEY");
console.log("==================================================================");

runFullAutonomousAccount({
  password: process.argv[2] || FIXED_PASSWORD,
  headless: process.env.HEADLESS === "1",
  keyName: process.env.SEEKAI_API_KEY_NAME || `Key_${Date.now().toString().slice(-4)}`,
  folder: "SeekAI-Emailnator",
})
  .then((res) => {
    console.log("\n🎉 HOÀN TẤT THÀNH CÔNG:", JSON.stringify(res, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n❌ LỖI THỰC THI:", err.message);
    process.exit(1);
  });


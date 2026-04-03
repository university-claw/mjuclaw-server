import { config } from "./config";
import { app } from "./server";
import { startCleanup } from "./session";
import { startViewCleanup } from "./view-store";

const server = app.listen(config.port, () => {
  console.log("");
  console.log("  ┌─────────────────────────────────────────────┐");
  console.log("  │  NemoClaw KakaoTalk Bridge                  │");
  console.log("  │                                             │");
  console.log(`  │  Port:     ${String(config.port).padEnd(33)}│`);
  console.log(`  │  Sandbox:  ${config.sandbox.name.padEnd(33)}│`);
  console.log("  │                                             │");
  console.log("  │  POST /skill  — 카카오 스킬 웹훅            │");
  console.log("  │  GET  /health — 헬스체크                    │");
  console.log("  └─────────────────────────────────────────────┘");
  console.log("");
});

startCleanup();
startViewCleanup();

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`\n[${signal}] shutting down...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

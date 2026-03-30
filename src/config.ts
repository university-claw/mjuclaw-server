import dotenv from "dotenv";
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  sandbox: {
    name: process.env.SANDBOX_NAME || "mjuclaw",
    nvidiaApiKey: process.env.NVIDIA_API_KEY || "",
    agentTimeout: 120_000, // 2분
  },
  security: {
    pairingCode: process.env.PAIRING_CODE || "",
    adminKakaoId: process.env.ADMIN_KAKAO_ID || "",
    allowedUsersPath: process.env.ALLOWED_USERS_PATH || "./data/allowed-users.json",
    maxPairingAttempts: 5,
  },
  session: {
    ttlMs: 24 * 60 * 60 * 1000, // 24시간
    cleanupIntervalMs: 60 * 60 * 1000, // 1시간
    maxHistory: 20,
  },
};

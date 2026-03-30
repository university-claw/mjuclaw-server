// ── 카카오 스킬 API 타입 ─────────────────────────────────────────

export interface KakaoSkillRequest {
  intent: { id: string; name: string };
  userRequest: {
    timezone: string;
    params: { ignoreMe?: string; surface?: string };
    block: { id: string; name: string };
    utterance: string;
    lang: string | null;
    user: {
      id: string;
      type: string;
      properties: Record<string, string>;
    };
    callbackUrl?: string;
  };
  bot: { id: string; name: string };
  action: {
    name: string;
    clientExtra: Record<string, unknown> | null;
    params: Record<string, string>;
    id: string;
    detailParams: Record<string, unknown>;
  };
}

export interface KakaoSimpleText {
  simpleText: { text: string };
}

export interface KakaoSkillResponse {
  version: "2.0";
  useCallback?: boolean;
  data?: { text: string };
  template?: {
    outputs: KakaoSimpleText[];
    quickReplies?: Array<{
      messageText: string;
      action: "message" | "block";
      label: string;
    }>;
  };
}

// ── 내부 타입 ────────────────────────────────────────────────────

export interface UserSession {
  kakaoId: string;
  isVerified: boolean;
  name: string;
  pairingAttempts: number;
  lastActive: number;
}

export interface AllowedUser {
  kakaoId: string;
  name: string;
  addedAt: string;
}

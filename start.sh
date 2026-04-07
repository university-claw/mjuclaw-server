#!/bin/bash
set -e

# ── MJUClaw 서버 시작 스크립트 ───────────────────────────────────
# 사용법: ./start.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# .env 로드
if [ -f .env ]; then
  export $(grep -v '^#' .env | grep -v '^$' | xargs)
fi

SANDBOX_NAME="${SANDBOX_NAME:-mjuclaw}"
NGROK_DOMAIN=$(echo "$SERVER_URL" | sed 's|https://||')

echo ""
echo "  ┌─────────────────────────────────────────────┐"
echo "  │  MJUClaw 시작 스크립트                      │"
echo "  │                                             │"
echo "  │  Sandbox:  $SANDBOX_NAME"
echo "  │  Domain:   $NGROK_DOMAIN"
echo "  └─────────────────────────────────────────────┘"
echo ""

# ── 1. Docker 확인 ───────────────────────────────────────────────
echo "[1/5] Docker 확인..."
if ! docker info > /dev/null 2>&1; then
  echo "  Docker가 실행 중이 아닙니다. Docker Desktop을 시작합니다..."
  open -a Docker
  echo "  Docker 시작 대기 중..."
  until docker info > /dev/null 2>&1; do sleep 2; done
  echo "  ✓ Docker 준비됨"
else
  echo "  ✓ Docker 이미 실행 중"
fi

# ── 2. OpenShell Gateway ─────────────────────────────────────────
echo ""
echo "[2/5] OpenShell Gateway 시작..."
openshell gateway start 2>&1 | grep -E "✓|!|Error" || true
# sandbox list로 정상 확인
if openshell sandbox list 2>&1 | grep -q "$SANDBOX_NAME"; then
  echo "  ✓ 샌드박스 '$SANDBOX_NAME' 확인됨"
else
  echo "  ⚠ 샌드박스 '$SANDBOX_NAME' 없음 — nemoclaw onboard를 먼저 실행하세요"
  echo ""
  echo "  실행: nemoclaw onboard"
  echo "        (모델: Google Gemini → gemini-3.1-flash-lite-preview)"
  exit 1
fi

# ── 3. GEMINI_API_KEY launchctl 등록 (macOS) ─────────────────────
echo ""
echo "[3/5] API 키 환경변수 등록..."
if [ -n "$GEMINI_API_KEY" ]; then
  launchctl setenv GEMINI_API_KEY "$GEMINI_API_KEY" 2>/dev/null || true
  echo "  ✓ GEMINI_API_KEY 등록됨"
fi

# ── 4. ngrok 터널 ────────────────────────────────────────────────
echo ""
echo "[4/5] ngrok 터널 시작 ($NGROK_DOMAIN)..."
# 기존 ngrok 프로세스 종료
pkill -f "ngrok http" 2>/dev/null || true
sleep 1
ngrok http --domain="$NGROK_DOMAIN" 3000 > /tmp/ngrok-mjuclaw.log 2>&1 &
sleep 6
if curl -s -o /dev/null -w "%{http_code}" "https://$NGROK_DOMAIN/health" 2>/dev/null | grep -q "200"; then
  echo "  ✓ 터널 연결됨: https://$NGROK_DOMAIN"
else
  echo "  ⚠ 터널 확인 실패 — ngrok 상태: $(cat /tmp/ngrok-mjuclaw.log | head -3)"
fi

# ── 5. MJUClaw 서버 ───────────────────────────────────────────────
echo ""
echo "[5/5] MJUClaw 서버 시작..."
pkill -f "node dist/index.js" 2>/dev/null || true
sleep 1
npm start &
sleep 3
if curl -s http://localhost:3000/health > /dev/null 2>&1; then
  echo "  ✓ 서버 실행 중 (port ${PORT:-3000})"
else
  echo "  ✗ 서버 시작 실패"
  exit 1
fi

echo ""
echo "  ┌─────────────────────────────────────────────┐"
echo "  │  ✅ 모든 서비스 실행 중                      │"
echo "  │                                             │"
echo "  │  서버:   http://localhost:${PORT:-3000}              │"
echo "  │  외부:   https://$NGROK_DOMAIN"
echo "  │  스킬:   https://$NGROK_DOMAIN/skill"
echo "  └─────────────────────────────────────────────┘"
echo ""
echo "  종료: Ctrl+C (서버만 종료, Gateway/ngrok는 백그라운드 유지)"
echo ""

# 서버 로그 출력
wait

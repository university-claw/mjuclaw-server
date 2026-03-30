# NemoClaw KakaoTalk Bridge

카카오톡 채널을 통해 [NemoClaw](https://github.com/NVIDIA/NemoClaw) 샌드박스 안의 OpenClaw AI 에이전트를 사용할 수 있게 해주는 브릿지 서버.

## 아키텍처

```
카카오톡 유저
    ↓ 메시지
카카오 서버 (POST /skill)
    ↓
┌──────────────────────────────────────┐
│  NemoClaw KakaoTalk Bridge           │
│  (Express 서버, port 3000)           │
│                                      │
│  1. 즉시 응답 (useCallback: true)    │
│  2. 유저 인증 확인 (페어링)          │
│  3. OpenShell SSH → 샌드박스 접속    │
│  4. OpenClaw 에이전트 실행           │
│  5. 응답 → 카카오 콜백 API 전송     │
└──────────────────────────────────────┘
    ↓ SSH
┌──────────────────────────────────────┐
│  NemoClaw 샌드박스 (mjuclaw)         │
│                                      │
│  openclaw agent --agent main         │
│    --session-id kakao-{user_id}      │
│    -m "{메시지}"                     │
└──────────────────────────────────────┘
    ↓
응답 → 카카오 콜백 API → 카카오톡 말풍선
```

### 핵심 설계

- **단일 샌드박스, 멀티유저**: 하나의 NemoClaw 샌드박스에서 `--session-id`로 유저별 세션 분리
- **NemoClaw 무수정 사용**: fork 없이 블랙박스로 사용, OpenShell SSH로 접속
- **5초 타임아웃 우회**: 카카오 콜백 API를 활용한 비동기 응답 패턴
- **유저별 동시성 제어**: 같은 유저의 연속 요청은 Promise 큐로 직렬화

## 사전 요구사항

- [Node.js](https://nodejs.org/) 20+
- [NemoClaw](https://github.com/NVIDIA/NemoClaw) 설치 및 샌드박스 구동 (`nemoclaw onboard` 완료)
- [OpenShell](https://openshell.dev/) 바이너리 (`openshell` 명령어 사용 가능)
- 카카오 i 오픈빌더 채널 및 스킬 등록
- (선택) [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/) — 로컬 서버 외부 노출용

## 설치

```bash
git clone <this-repo>
cd kakao
npm install
npm run build
```

## 환경 설정

`.env.example`을 복사하여 `.env` 파일을 만들고 값을 채운다.

```bash
cp .env.example .env
```

```env
# NemoClaw
NVIDIA_API_KEY=nvapi-xxxxx       # NVIDIA API 키
SANDBOX_NAME=mjuclaw             # NemoClaw 샌드박스 이름

# KakaoTalk
PAIRING_CODE=your-secret-code    # 유저 인증용 페어링 코드
ADMIN_KAKAO_ID=                  # 관리자 카카오 ID (자동 인증)

# Server
PORT=3000                        # 서버 포트
```

| 변수 | 필수 | 설명 |
|------|:----:|------|
| `NVIDIA_API_KEY` | O | NVIDIA 추론 엔드포인트 인증 키 |
| `SANDBOX_NAME` | - | NemoClaw 샌드박스 이름 (기본: `mjuclaw`) |
| `PAIRING_CODE` | O | 유저가 `/pair` 명령어로 입력할 인증 코드 |
| `ADMIN_KAKAO_ID` | - | 페어링 없이 자동 인증되는 관리자 카카오 ID |
| `PORT` | - | 서버 포트 (기본: `3000`) |

## 실행

```bash
# 프로덕션
npm start

# 개발 (ts-node)
npm run dev
```

서버가 시작되면:

```
  ┌─────────────────────────────────────────────┐
  │  NemoClaw KakaoTalk Bridge                  │
  │                                             │
  │  Port:     3000                             │
  │  Sandbox:  mjuclaw                          │
  │                                             │
  │  POST /skill  — 카카오 스킬 웹훅            │
  │  GET  /health — 헬스체크                    │
  └─────────────────────────────────────────────┘
```

## API 엔드포인트

### `POST /skill`

카카오 i 오픈빌더 스킬 웹훅. 카카오 서버가 유저 메시지를 이 엔드포인트로 전송한다.

**요청**: 카카오 스킬 API v2 포맷 (`KakaoSkillRequest`)

**응답 흐름**:
1. `callbackUrl`이 있으면 → 즉시 `{ useCallback: true }` 반환, 백그라운드에서 에이전트 실행 후 콜백 전송
2. `callbackUrl`이 없으면 → 동기 응답 (에이전트 호출 불가, 인증/명령어만 처리)

### `GET /health`

서버 상태 확인.

```json
{
  "status": "ok",
  "uptime": 3600,
  "sessions": {
    "total": 5,
    "verified": 3,
    "activeLastHour": 2
  }
}
```

## 유저 인증 (페어링)

새 유저가 카카오톡으로 메시지를 보내면 인증을 요구한다.

```
유저: 안녕하세요
봇:   인증이 필요합니다.
      /pair [인증코드] [이름(선택)]
      예시: /pair mycode 홍길동

유저: /pair mycode 홍길동
봇:   인증 완료! 안녕하세요, 홍길동님.
```

- 인증 코드는 `.env`의 `PAIRING_CODE`와 대조
- 5회 실패 시 잠금 (24시간 후 세션 만료로 해제)
- 인증된 유저는 `data/allowed-users.json`에 영속 저장
- `ADMIN_KAKAO_ID`로 설정된 관리자는 자동 인증

## 유저 명령어

| 명령어 | 설명 |
|--------|------|
| `/pair [코드] [이름]` | 인증 |
| `/reset` | 세션 초기화 (OpenClaw 세션 리셋) |
| `/help` | 명령어 목록 |

그 외 모든 메시지는 OpenClaw 에이전트에게 전달된다.

## 카카오 i 오픈빌더 설정

### 1. 채널 생성

[카카오 i 오픈빌더](https://i.kakao.com/)에서 봇을 생성하고 카카오톡 채널에 연결한다.

### 2. 스킬 등록

1. 오픈빌더 → 스킬 → 스킬 생성
2. URL: `https://<your-domain>/skill`
3. **콜백 사용**: 반드시 활성화 (5초 타임아웃 우회에 필수)

> 콜백 기능은 카카오에 별도 신청이 필요할 수 있다.

### 3. 시나리오 블록 연결

1. 시나리오 → 폴백 블록 (또는 새 블록)
2. 파라미터 설정 → 스킬 연결
3. 위에서 등록한 스킬 선택

### 4. 외부 노출 (Cloudflare Tunnel)

로컬 서버를 외부에서 접근 가능하게 하려면:

```bash
# Cloudflare Tunnel 설치 후
cloudflared tunnel --url http://localhost:3000
```

생성된 URL을 오픈빌더 스킬 URL에 입력한다.

## 프로젝트 구조

```
src/
├── index.ts          # 엔트리포인트, 서버 시작, graceful shutdown
├── server.ts         # Express 서버, POST /skill, GET /health
├── kakao.ts          # 카카오 응답 포맷팅, 콜백 전송 (900자 분할)
├── nemoclaw.ts       # OpenShell SSH 브릿지 → OpenClaw 에이전트
├── session.ts        # 유저 세션 관리, 페어링 인증, 영속화
├── config.ts         # 환경변수 로드
└── types.ts          # 카카오 스킬 API + 내부 타입 정의
```

## 로컬 테스트

서버를 실행한 뒤 curl로 카카오 요청을 시뮬레이션할 수 있다.

```bash
# 헬스체크
curl http://localhost:3000/health

# 스킬 요청 (콜백 없는 동기 모드)
curl -X POST http://localhost:3000/skill \
  -H "Content-Type: application/json" \
  -d '{
    "intent": {"id": "test", "name": "test"},
    "userRequest": {
      "timezone": "Asia/Seoul",
      "params": {},
      "block": {"id": "test", "name": "test"},
      "utterance": "/pair your-secret-code 테스터",
      "lang": null,
      "user": {"id": "test-user-001", "type": "botUserKey", "properties": {}}
    },
    "bot": {"id": "test", "name": "test"},
    "action": {"name": "test", "clientExtra": null, "params": {}, "id": "test", "detailParams": {}}
  }'
```

## 라이선스

MIT

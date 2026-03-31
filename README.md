# MJUClaw Server

카카오톡 채널을 통해 명지대학교 학사 서비스(LMS, MSI, UCheck, 도서관)와 AI 에이전트를 사용할 수 있게 해주는 서버.

[NemoClaw](https://github.com/NVIDIA/NemoClaw)(NVIDIA OpenClaw 샌드박스)와 [mju-mcp](https://github.com/university-claw/mju-mcp)(명지대 MCP 서버)를 카카오톡으로 연결한다.

## 아키텍처

```
카카오톡 유저
    ↓ 메시지
카카오 서버 (POST /skill)
    ↓
┌──────────────────────────────────────────┐
│  MJUClaw Server (Express, port 3000)     │
│                                          │
│  1. 즉시 응답 (useCallback: true)        │
│  2. 유저 인증 확인 (웹 온보딩)           │
│  3. 키워드 감지 → mju-mcp 직접 호출     │
│  4. 일반 질문 → NemoClaw 에이전트 호출   │
│  5. 응답 포맷팅 → 카카오 콜백 전송       │
└──────────┬───────────────┬───────────────┘
           │               │
     ┌─────▼─────┐   ┌────▼──────────────┐
     │  mju-mcp  │   │  NemoClaw 샌드박스 │
     │ (subprocess)│  │  (OpenShell SSH)   │
     │           │   │                    │
     │ LMS       │   │  OpenClaw agent    │
     │ MSI       │   │  --session-id      │
     │ UCheck    │   │    kakao-{user_id} │
     │ Library   │   │                    │
     └───────────┘   └────────────────────┘
```

### 핵심 설계

- **학사 서비스 직접 연동**: mju-mcp를 호스트에서 subprocess로 실행하여 대학 서버에 직접 접근
- **AI 에이전트 연동**: NemoClaw 샌드박스의 OpenClaw를 OpenShell SSH로 호출
- **웹 온보딩**: 카카오톡 버튼 → 웹페이지에서 학번/비밀번호 등록 (AES-256-GCM 암호화)
- **5초 타임아웃 우회**: 카카오 콜백 API를 활용한 비동기 응답
- **카카오톡 최적화 포맷**: 각 도구 응답을 말풍선에 맞게 정리

## 지원 기능

### 학사 서비스 (mju-mcp)

키워드를 포함한 메시지를 보내면 자동으로 해당 도구를 호출한다.

| 키워드 | 기능 | 예시 |
|--------|------|------|
| 출석, 출결, 결석 | 전 과목 출석 현황 요약 | "출석 현황 알려줘" |
| 과제, 할 일, 숙제 | 미제출 과제 + 마감 임박 + 안읽은 공지 | "남은 과제 뭐 있어?" |
| 미제출 | 미제출 과제만 조회 | "미제출 과제" |
| 마감, 데드라인 | 마감 임박 과제 | "마감 임박 과제" |
| 시간표 | 요일별 시간표 | "시간표" |
| 성적, 학점 | 이번 학기 성적 | "성적 알려줘" |
| 졸업, 졸업요건 | 졸업 학점 충족 현황 | "졸업요건" |
| 공지, 알림 | 전체 공지사항 | "공지" |
| 안읽은 공지 | 안읽은 공지만 | "새 공지 있어?" |
| 수강, 과목 | 수강 과목 목록 | "수강 과목" |
| 미수강 | 미수강 온라인 학습 | "미수강 강의" |
| 스터디룸 | 도서관 스터디룸 | "스터디룸" |
| 열람실, 좌석 | 열람실 현황 | "열람실" |

### AI 에이전트 (NemoClaw)

위 키워드에 해당하지 않는 일반 메시지는 NemoClaw 샌드박스의 OpenClaw AI 에이전트에게 전달된다.

## 사전 요구사항

- [Node.js](https://nodejs.org/) 20+
- [NemoClaw](https://github.com/NVIDIA/NemoClaw) 설치 및 샌드박스 구동 (`nemoclaw onboard` 완료)
- [OpenShell](https://openshell.dev/) CLI
- [mju-mcp](https://github.com/university-claw/mju-mcp) 빌드본 (`mju-mcp/` 디렉토리에 배치)
- 카카오 i 오픈빌더 채널 + 스킬 + 콜백 승인
- (선택) [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)

## 설치

```bash
git clone <this-repo>
cd mjuclaw-server
npm install
npm run build

# mju-mcp 설치 (별도 클론 + 빌드 후 복사)
git clone https://github.com/university-claw/mju-mcp.git /tmp/mju-mcp
cd /tmp/mju-mcp && npm install --include=dev && npx tsc
cp -r /tmp/mju-mcp ./mju-mcp
```

## 환경 설정

```bash
cp .env.example .env
```

| 변수 | 필수 | 설명 |
|------|:----:|------|
| `NVIDIA_API_KEY` | O | NVIDIA 추론 엔드포인트 키 |
| `SANDBOX_NAME` | - | NemoClaw 샌드박스 이름 (기본: `mjuclaw`) |
| `PORT` | - | 서버 포트 (기본: `3000`) |
| `SERVER_URL` | O | 외부 접근 URL (온보딩 버튼 링크에 사용) |
| `ENCRYPTION_KEY` | O | AES-256 암호화 키 (hex 64자). 생성: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ADMIN_KAKAO_ID` | - | 자동 인증되는 관리자 카카오 ID |

## 실행

```bash
# 프로덕션
npm start

# 개발
npm run dev
```

## API 엔드포인트

| 엔드포인트 | 설명 |
|-----------|------|
| `POST /skill` | 카카오 스킬 웹훅 (메인) |
| `GET /health` | 서버 상태 + 세션 통계 |
| `GET /onboard?uid={kakaoId}` | 학교 인증 웹페이지 |
| `POST /onboard/submit` | 학번/비밀번호 등록 |

## 유저 온보딩 흐름

```
1. 카카오톡 채널 친구추가 → 아무 메시지 전송
2. 웰컴 카드: [학교 인증하기] 버튼
3. 버튼 클릭 → 웹페이지에서 학번/비밀번호 입력
4. AES-256-GCM 암호화 저장 → 인증 완료
5. 이후 메시지부터 학사 서비스 + AI 에이전트 사용 가능
```

## 카카오 i 오픈빌더 설정

### 1. 스킬 등록
- 오픈빌더 → 스킬 → 스킬 생성
- URL: `https://<your-domain>/skill`
- **콜백 URL 발행**: 반드시 활성화

### 2. 폴백 블록 연결
- 시나리오 → 폴백 블록 → 스킬 데이터 사용 → 위 스킬 선택

### 3. 배포
- 스킬/블록 변경 후 반드시 **배포** (배포 전까지 실제 카카오톡 미반영)

### 4. 외부 노출

```bash
cloudflared tunnel --url http://localhost:3000
# 생성된 URL을 오픈빌더 스킬 URL에 입력
```

## 프로젝트 구조

```
src/
├── index.ts        # 엔트리포인트, graceful shutdown
├── server.ts       # Express 서버, POST /skill, 온보딩 라우트
├── kakao.ts        # 카카오 응답 포맷 (simpleText, basicCard, 콜백)
├── nemoclaw.ts     # OpenShell SSH → OpenClaw 에이전트 호출
├── mju-tools.ts    # mju-mcp MCP 클라이언트, 키워드 감지, 포맷터
├── session.ts      # 유저 세션, 크리덴셜 암호화 저장
├── config.ts       # 환경변수
└── types.ts        # 카카오 스킬 API + 내부 타입

public/
└── onboard.html    # 학교 인증 웹페이지 (모바일 최적화)

mju-mcp/            # mju-mcp 빌드본 (gitignore)
data/               # 크리덴셜 + 세션 데이터 (gitignore)
```

## 로컬 테스트

```bash
# 헬스체크
curl http://localhost:3000/health

# 온보딩 (웹페이지 안 거치고 바로 등록)
curl -X POST http://localhost:3000/onboard/submit \
  -H "Content-Type: application/json" \
  -d '{"uid":"test-user","studentId":"60201234","password":"test1234"}'

# 스킬 요청 시뮬레이션
curl -X POST http://localhost:3000/skill \
  -H "Content-Type: application/json" \
  -d '{
    "intent":{"id":"t","name":"t"},
    "userRequest":{
      "timezone":"Asia/Seoul","params":{},"block":{"id":"t","name":"t"},
      "utterance":"시간표",
      "lang":null,
      "user":{"id":"test-user","type":"botUserKey","properties":{}}
    },
    "bot":{"id":"t","name":"t"},
    "action":{"name":"t","clientExtra":null,"params":{},"id":"t","detailParams":{}}
  }'
```

## 라이선스

MIT

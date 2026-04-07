# MJUClaw Server

카카오톡 채널을 통해 명지대학교 학사 서비스(LMS, MSI, UCheck, 도서관)와 AI 에이전트를 사용할 수 있게 해주는 서버.

- **레포**: github.com/university-claw/mjuclaw-server
- **관련 레포**: github.com/nullhyeon/mju-cli (명지대 CLI 도구)

## 아키텍처

```
카카오톡 유저
    ↓ 메시지
카카오 서버 (POST /skill)
    ↓
┌──────────────────────────────────────────────┐
│  MJUClaw Server (Express, port 3000)         │
│                                              │
│  1. 즉시 응답 (useCallback: true)            │
│  2. 유저 인증 확인 (웹 온보딩)               │
│  3. 키워드 감지 → mju-cli 실행              │
│  4. 학사 데이터 + 질문 → NemoClaw 에이전트  │
│  5. 카드(웹 뷰) 또는 텍스트 콜백 전송       │
└──────────┬───────────────────┬───────────────┘
           │                   │
     ┌─────▼─────┐   ┌─────────▼──────────────┐
     │  mju-cli  │   │  NemoClaw 샌드박스      │
     │(execFile) │   │  (Docker + OpenShell)  │
     │           │   │                        │
     │ LMS       │   │  openclaw agent --json │
     │ MSI       │   │  --session-id          │
     │ UCheck    │   │    kakao-{user_id}     │
     │ Library   │   │                        │
     └───────────┘   └────────────────────────┘
```

### 핵심 설계

- **학사 서비스**: mju-cli를 `execFile`로 실행. `--app-dir data/users/{kakaoId}`로 유저별 세션 격리. `--format json`으로 구조화된 데이터 수신.
- **AI 에이전트**: NemoClaw 샌드박스(Docker)의 OpenClaw를 OpenShell SSH로 호출. `--json` 플래그로 응답 수신.
- **파이프라인**: 키워드 감지 → mju-cli 학사 데이터 조회 → NemoClaw에 데이터+질문 전달 → AI 자연어 응답 생성
- **카드 + 웹 뷰**: 학사 데이터는 basicCard(간단 요약 + 버튼) + `/view/:id` 웹 페이지(마크다운 렌더링 + 구조화된 상세 데이터)
- **웹 온보딩**: 카카오톡 버튼 → 웹페이지에서 학번/비밀번호 입력 → mju-cli `auth login`으로 검증 → AES-256-GCM 암호화 저장
- **5초 타임아웃 우회**: 카카오 콜백 API(`useCallback: true`) 활용

## 지원 기능

### 학사 서비스 (mju-cli)

키워드를 포함한 메시지를 보내면 자동으로 해당 CLI를 호출하고 AI가 자연어로 요약한다.

| 키워드 | 기능 |
|--------|------|
| 출석, 출결, 결석, 지각 | 전 과목 출석 현황 |
| 과제, 할 일, 숙제 | 미제출 과제 + 마감 임박 + 안읽은 공지 통합 |
| 미제출 | 미제출 과제만 조회 |
| 마감, 데드라인, 임박, 언제까지 | 마감 임박 과제 |
| 시간표, 수업시간 | 요일별 시간표 |
| 성적, 학점, 점수 | 이번 학기 성적 |
| 졸업, 졸업요건, 졸업학점 | 졸업 요건 충족 현황 |
| 성적이력, 전체성적 | 전체 성적 이력 |
| 수강, 과목, 강의목록 | 수강 과목 목록 |
| 공지, 알림, 안읽은 공지 | 공지사항 |
| 미수강, 온라인 강의 | 미수강 온라인 학습 |
| 스터디룸 | 도서관 스터디룸 현황 |
| 열람실, 좌석 | 열람실 현황 |

### AI 에이전트 (NemoClaw)

키워드에 해당하지 않는 일반 메시지는 NemoClaw OpenClaw 에이전트로 전달된다. 학사 데이터 조회 시에는 데이터와 함께 질문을 전달해 자연어로 답변한다.

## 사전 요구사항

- [Node.js](https://nodejs.org/) 22+
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [NemoClaw](https://github.com/NVIDIA/NemoClaw) + [OpenShell](https://openshell.dev/) CLI
- [ngrok](https://ngrok.com/) 또는 고정 도메인 (외부 노출용)
- 카카오 i 오픈빌더 채널 + 스킬 + 콜백 URL 발행 활성화

## 설치

```bash
git clone https://github.com/university-claw/mjuclaw-server.git
cd mjuclaw-server
npm install
npm run build

# mju-cli 설치
git clone https://github.com/nullhyeon/mju-cli.git
cd mju-cli && npm install && npm run build && cd ..
```

## 환경 설정

```bash
cp .env.example .env
```

| 변수 | 필수 | 설명 |
|------|:----:|------|
| `GEMINI_API_KEY` | O | Google AI Studio API 키 (NemoClaw 추론용) |
| `SANDBOX_NAME` | - | NemoClaw 샌드박스 이름 (기본: `mjuclaw`) |
| `PORT` | - | 서버 포트 (기본: `3000`) |
| `SERVER_URL` | O | 외부 접근 URL (온보딩 버튼 + 웹 뷰 링크용) |
| `ENCRYPTION_KEY` | O | AES-256 키, hex 64자. 생성: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ADMIN_KAKAO_ID` | - | 자동 인증 관리자 카카오 ID |

## NemoClaw 초기 설정

```bash
# 1. Docker Desktop 실행 후 gateway 시작
openshell gateway start

# 2. NemoClaw 샌드박스 생성 (Google Gemini 선택)
nemoclaw onboard
# → Inference: 6) Google Gemini
# → Model: gemma-3.1-flash-lite-preview (또는 원하는 모델)
# → Sandbox name: mjuclaw

# 3. API 키를 launchctl에 등록 (macOS, 재시작 시 필요)
launchctl setenv GEMINI_API_KEY <your-api-key>
```

## 실행

```bash
# 서버
npm start

# ngrok 고정 도메인 (별도 터미널)
ngrok http --domain=<your-domain>.ngrok-free.app 3000
```

## 카카오 i 오픈빌더 설정

1. 오픈빌더 → 스킬 → 스킬 생성 → URL: `https://<your-domain>/skill`
2. **콜백 URL 발행**: 반드시 ON (설정 → 콜백 설정)
3. 시나리오 → 폴백 블록 → 스킬 데이터 사용 → 위 스킬 선택
4. 변경 후 반드시 **배포**

## API 엔드포인트

| 엔드포인트 | 설명 |
|-----------|------|
| `POST /skill` | 카카오 스킬 웹훅 |
| `GET /health` | 서버 상태 + 세션 통계 |
| `GET /onboard?uid={kakaoId}` | 학교 인증 웹페이지 |
| `POST /onboard/submit` | 학번/비밀번호 등록 |
| `GET /view/:id` | 학사 데이터 웹 뷰 (30분 TTL) |

## 유저 온보딩 흐름

```
1. 카카오톡 채널 친구추가 → 아무 메시지 전송
2. 웰컴 카드: [학교 인증하기] 버튼
3. 버튼 클릭 → 웹페이지에서 학번/비밀번호 입력
4. mju-cli auth login으로 실제 로그인 검증
5. AES-256-GCM 암호화 저장 → 인증 완료
6. 이후 메시지부터 학사 서비스 + AI 에이전트 사용 가능
```

## 프로젝트 구조

```
src/
├── index.ts          # 엔트리포인트, graceful shutdown
├── server.ts         # Express 라우트, 메시지 라우팅, /view/:id
├── kakao.ts          # 카카오 응답 빌더 (simpleText, basicCard, 콜백)
├── nemoclaw.ts       # OpenShell SSH → openclaw agent --json
├── mju-tools.ts      # mju-cli 래퍼, 키워드→CLI 매핑, 폴백 포맷터
├── view-store.ts     # 학사 데이터 임시 저장소 (UUID, 30분 TTL)
├── view-renderer.ts  # 학사 데이터 → HTML (dataType별 렌더러, marked.js)
├── session.ts        # 유저 세션 + AES-256-GCM 크리덴셜 암호화
├── config.ts         # 환경변수
└── types.ts          # 카카오 API + 내부 타입 (ProcessResult, ViewEntry 등)

public/
├── onboard.html      # 학교 인증 웹페이지 (모바일 최적화)
└── myongmyong.png    # 명명이 캐릭터 이미지

mju-cli/              # mju-cli 빌드본 (gitignore)
data/                 # 크리덴셜 + 유저 세션 데이터 (gitignore)
```

## 로컬 테스트

```bash
# 헬스체크
curl http://localhost:3000/health

# 스킬 요청 시뮬레이션 (미인증 유저)
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

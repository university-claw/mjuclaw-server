# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MJUClaw Server — 명지대학교 카카오톡 채널을 통해 AI 에이전트(NemoClaw/OpenClaw) + 학사 서비스(LMS, MSI, UCheck, 도서관)를 사용할 수 있게 하는 Express 서버.

- **레포**: github.com/university-claw/mjuclaw-server
- **관련 레포**: github.com/nullhyeon/mju-cli (CLI 도구)

## Build & Run

```bash
npm install          # 의존성 설치
npm run build        # tsc → dist/
npm start            # node dist/index.js (프로덕션)
npm run dev          # ts-node src/index.ts (개발)
```

mju-cli 빌드 (별도 클론 후 `mju-cli/` 디렉토리에 배치):
```bash
cd mju-cli && npm install --include=dev && npx tsc
```

테스트 프레임워크 없음. curl로 수동 테스트:
```bash
curl http://localhost:3000/health
curl -X POST http://localhost:3000/skill -H "Content-Type: application/json" \
  -d '{"intent":{"id":"t","name":"t"},"userRequest":{"timezone":"Asia/Seoul","params":{},"block":{"id":"t","name":"t"},"utterance":"시간표","lang":null,"user":{"id":"test-user","type":"botUserKey","properties":{}}},"bot":{"id":"t","name":"t"},"action":{"name":"t","clientExtra":null,"params":{},"id":"t","detailParams":{}}}'
```

## Architecture

```
카카오톡 유저
    ↓ POST /skill
┌──────────────────────────────────────────┐
│  MJUClaw Server (Express, port 3000)     │
│                                          │
│  1. 즉시 응답 (useCallback: true)        │
│  2. 유저 인증 확인 (웹 온보딩)           │
│  3. 키워드 감지 → mju-cli 실행          │
│  4. 학사 데이터 + 질문 → Gemma AI 요약   │
│  5. 카드(웹 뷰) 또는 텍스트 콜백 전송    │
└──────────┬───────────────┬───────────────┘
           │               │
     ┌─────▼─────┐   ┌────▼──────────────┐
     │  mju-cli  │   │  Google AI Studio  │
     │(execFile) │   │  gemma-4-26b-a4b-it│
     └───────────┘   └────────────────────┘
```

### Request Flow (server.ts)

`POST /skill` → 카카오 스킬 웹훅 엔트리포인트. 두 가지 모드:

1. **콜백 모드** (`callbackUrl` 존재): 즉시 `useCallback: true` 응답 → 백그라운드에서 `processAsync()` 실행 → 결과를 callbackUrl로 POST
2. **동기 모드** (콜백 없음): 4.5초 타임아웃 내에 응답 시도

`processMessage()` 내부 라우팅 (4단계 파이프라인):
1. `/reset`, `/help` → 슬래시 명령어 핸들러
2. 키워드 매치 → `fetchMjuData()` → mju-cli JSON 결과 획득
3. NemoClaw에 원문 + 학사 데이터를 합쳐 전달 → AI 요약 생성
4. 학사 데이터가 있으면 `storeView()` → 카드 응답(웹 뷰 링크), 없으면 텍스트 응답

### Key Design Decisions

1. **mju-cli는 호스트에서 execFile로 실행** — `node mju-cli/dist/main.js` 를 직접 spawn. 유저별 격리된 `--app-dir`(data/users/{kakaoId})을 전달하여 크리덴셜/세션 분리. `--format json` 으로 출력을 파싱.
2. **AI 에이전트는 NemoClaw 샌드박스를 통해 호출** — `nemoclaw.ts`가 `openshell sandbox ssh-config`로 임시 SSH config를 만들어 샌드박스 안에서 `nemoclaw-start openclaw agent --json`을 실행. 실제 추론 모델은 `gemini-3.1-flash-lite-preview` (Google Gemini) 이며 `nemoclaw onboard` 단계에서 샌드박스에 박힘. 서버는 `GEMINI_API_KEY`만 환경변수로 주입. 대화 히스토리는 서버가 아니라 openclaw가 `--session-id kakao-{userId}` 기준으로 관리. 타임아웃 120초(`config.ts:agentTimeout`).
3. **카카오 5초 타임아웃 우회** — 오픈빌더 "콜백 URL 발행" 활성화 필수. 없으면 callbackUrl이 req.body에 포함되지 않음.
4. **유저별 동시성 제어** — nemoclaw.ts의 `enqueue()` 함수가 같은 userId의 요청을 Promise 체인으로 직렬화.
5. **카드 + 웹 뷰 패턴** — 학사 데이터 조회 시 카카오 basicCard(80자 요약 + "자세히 보기" 버튼) → 웹 뷰(`/view/:id`)에서 전체 데이터를 HTML로 렌더링. ViewEntry는 30분 TTL.

### Module Responsibilities

- **server.ts** — Express 라우트, 메시지 라우팅 (키워드 → mju-tools / 일반 → nemoclaw), 동기/비동기 분기, 웹 뷰 라우트(`/view/:id`)
- **mju-tools.ts** — mju-cli 래퍼, 키워드→CLI 커맨드 매핑 (`KEYWORD_MAP` 배열), 출석 체이닝 (과목목록 → 각 과목 출석 조회), 각 도구별 카카오톡 폴백 포맷터
- **nemoclaw.ts** — Google AI Studio API 호출 (gemma-4-26b-a4b-it), 유저별 대화 히스토리 + Promise 큐
- **kakao.ts** — 카카오 응답 빌더 (simpleText, basicCard, 콜백 POST), 900자 truncate, 80자 description 제한
- **view-store.ts** — 학사 데이터 임시 저장소 (인메모리 Map, 30분 TTL), `/view/:id` 엔드포인트용
- **view-renderer.ts** — 학사 데이터 → HTML 렌더링 (시간표, 성적, 졸업요건, 출석 등 dataType별 전용 렌더러)
- **session.ts** — 인메모리 세션 + 파일 기반 크리덴셜 (AES-256-GCM), 24시간 TTL 자동 정리
- **config.ts** — 환경변수 로드. ENCRYPTION_KEY 미설정 시 임시 키 생성 (재시작 시 복호화 불가 경고)
- **types.ts** — 카카오 스킬 API 요청/응답 타입, ProcessResult, ViewEntry, 내부 세션/크리덴셜 타입

### Data Flow Constraints

- 카카오 말풍선: 최대 900자 (`kakao.ts:truncate`), basicCard description은 80자
- mju-cli: `execFile`로 매 요청마다 프로세스 spawn. `--app-dir data/users/{kakaoId}` 로 유저별 격리. 타임아웃 90초.
- 출석 조회: UCheck 과목 목록 → 각 과목별 순차 출석 조회 체이닝 (`handleAttendance()`). 과목 수에 비례하여 느려질 수 있음.
- 웹 뷰: `storeView()` → UUID → `/view/:id`. 30분 후 만료. UUID 형식 검증(`/^[0-9a-f-]{36}$/`).
- 키워드 매칭: `KEYWORD_MAP` 배열 순서가 우선순위. 구체적 키워드("졸업학점")가 일반 키워드("학점") 앞에 와야 함.
- 온보딩 시 mju-cli `auth login`을 먼저 실행하여 크리덴셜 유효성 검증 후 저장.

## Environment Variables

```
GOOGLE_API_KEY      # Google AI Studio API 키 (gemma-4-26b-a4b-it)
PORT                # 서버 포트 (default: 3000)
SERVER_URL          # 외부 URL (온보딩 버튼 링크용)
ENCRYPTION_KEY      # AES-256 키, hex 64자
ADMIN_KAKAO_ID      # 자동 인증 관리자 카카오 ID
CREDENTIALS_PATH    # 크리덴셜 파일 경로 (default: ./data/credentials.json)
```

## Known Issues

- **Cloudflare Quick Tunnel**: 재시작마다 URL 변경 → SERVER_URL + 오픈빌더 스킬 URL 수동 업데이트 필요.
- **ViewStore 인메모리**: 서버 재시작 시 모든 웹 뷰 데이터 소실. 활성 웹 뷰 링크가 404됨.
- **대화 히스토리 인메모리**: 서버 재시작 시 모든 유저의 대화 맥락 소실.
- **mju-cli 프로세스 비용**: 매 요청마다 Node 프로세스 spawn. 동시 요청 많으면 부하 증가.

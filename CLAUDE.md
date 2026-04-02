# MJUClaw Server — 프로젝트 문서

> 최종 업데이트: 2026-04-02

## 프로젝트 개요

명지대학교 카카오톡 채널을 통해 AI 에이전트(NemoClaw/OpenClaw) + 학사 서비스(LMS, MSI, UCheck, 도서관)를 사용할 수 있게 하는 서버.

- **레포**: github.com/university-claw/mjuclaw-server
- **관련 레포**: github.com/university-claw/mju-mcp (MCP 서버), github.com/nullhyeon/mju-cli (CLI 도구)

---

## 아키텍처

```
카카오톡 유저
    ↓ 메시지 (POST /skill)
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
     │(subprocess)│   │  (OpenShell SSH)   │
     └───────────┘   └────────────────────┘
```

### 핵심 설계 결정

1. **mju-mcp는 호스트에서 subprocess로 실행** — 샌드박스 네트워크 정책이 mju.ac.kr 도메인을 차단해서, 호스트에서 직접 실행하는 방식으로 우회
2. **NemoClaw는 블랙박스로 사용** — fork 없이 OpenShell SSH로 접속
3. **카카오 콜백 API** — 5초 타임아웃 우회 필수. 오픈빌더 설정에서 "콜백 URL 발행" 활성화 필요
4. **웹 온보딩** — 카카오톡 채팅으로 비밀번호를 받지 않고, 웹페이지(HTTPS)에서 입력받아 AES-256-GCM으로 암호화 저장

---

## 세션 히스토리 (2026-03-30 ~ 04-02)

### Phase 1: 브릿지 서버 구축
- Express 서버 처음부터 작성 (clawdbot-kakaotalk fork 안 함)
- 카카오 스킬 API 타입 정의, 콜백 전송, 900자 분할
- NemoClaw OpenShell SSH 브릿지 (telegram-bridge.js 패턴 참고)
- 유저 세션 관리, 페어링 인증
- **커밋**: `be8d45f` feat: NemoClaw KakaoTalk Bridge 초기 구현

### Phase 2: 웹 온보딩
- `/pair` 코드 입력 → 웹페이지(학번/비밀번호) 방식으로 전환
- GET /onboard?uid={kakaoId} 웹페이지, POST /onboard/submit API
- AES-256-GCM 크리덴셜 암호화 (ENCRYPTION_KEY 환경변수)
- basicCard + webLink 버튼으로 카카오톡 웰컴 카드
- **커밋**: `1f9cf1b` feat: 웹 온보딩으로 인증 방식 전환

### Phase 3: 카카오톡 연동 테스트
- Cloudflare Quick Tunnel로 외부 노출
- 카카오 i 오픈빌더 스킬 등록 + 폴백 블록 연결
- 콜백 URL 발행 활성화 (오픈빌더 설정 → 콜백 설정)
- callbackUrl 미포함 문제 디버깅 → 콜백 URL 발행 토글 발견
- 동기 모드 4.5초 타임아웃 에이전트 호출 추가
- NemoClaw stdout 필터에 [gateway] 라인 추가
- **커밋**: `2f3191a` fix: 콜백 비동기 처리 + gateway 로그 필터링

### Phase 4: NemoClaw 샌드박스 구성
- `nemoclaw onboard` → 샌드박스 `mjuclaw` 생성
- 모델: ollama-local → qwen3.5:0.8b (로컬) → qwen3.5:397b-cloud (NVIDIA 클라우드 경유 Ollama)
- qwen3.5:9b는 16GB Mac에서 메모리 부족으로 사용 불가
- NVIDIA API 키를 Ollama에 전달: `launchctl setenv NVIDIA_API_KEY ...` + Ollama 재시작

### Phase 5: mju-mcp 설치 시도 (샌드박스 내)
- mju-mcp를 샌드박스에 업로드 (tar pipe over SSH, 호스트에서 빌드)
- OpenClaw 플러그인 등록 시도:
  - `openclaw.plugin.json` 매니페스트 필요
  - `package.json`에 `openclaw.extensions` 필드 필요
  - top-level await 호환성 문제 → `src/plugin.ts` 별도 엔트리포인트 필요
  - extensions 디렉토리 symlink 문제 → 직접 복사로 해결
  - **최종: loaded 상태 달성**
- 네트워크 정책에 mju.ac.kr 도메인 추가 (여러 형식 시도):
  - `access: full` → 403
  - `protocol: rest, tls: terminate` → 403
  - `tls: passthrough` → 403
  - 프록시(10.200.0.1:3128)가 CONNECT 터널 자체를 차단
  - **결론: 샌드박스 내에서 mju.ac.kr 접근 불가**

### Phase 6: mju-mcp 호스트 실행으로 전환
- MCP SDK 클라이언트를 bridge에 추가
- mju-mcp를 호스트에서 subprocess(stdio)로 실행
- 키워드 감지 → 도구 자동 호출 (allCourses 파라미터 활용)
- 출석 조회: 과목 목록 → 각 과목 출석 자동 체이닝
- LMS 과목 ID ≠ UCheck 과목 ID → 과목명으로 검색하도록 수정
- **커밋**: `4d05f2e` feat: mju-mcp 호스트 직접 실행으로 학사 서비스 연동

### Phase 7: 카카오톡 포맷 최적화
- 전체 도구 응답 포맷터 추가 (시간표, 성적, 졸업요건, 수강과목, 할 일, 출석 등)
- 출석: 요약 + 문제 회차만 표시
- 할 일: 미제출(🔴만료/🟡진행) + 마감임박 + 안읽은공지 통합
- 시간표: 요일별 그룹핑
- **커밋**: `533d96d` feat: 전체 학사 도구 카카오톡 포맷터 추가

### Phase 8: README + 리네이밍
- nemoclaw-kakao-bridge → mjuclaw-server (v0.2.0)
- README 전면 재작성
- GitHub 레포 이름 변경: university-claw/mjuclaw-server
- **커밋**: `6dbbb24` docs: README 전면 재작성 + 프로젝트 리네이밍

### Phase 9: 배포 계획
- Oracle Cloud Free Tier (서울/춘천) VM 추천 — 4 OCPU ARM, 24GB RAM, 200GB, $0
- 폴백: Contabo Tokyo ~$7/월
- VM 인스턴스 생성 중 (진행 중)

---

## 알려진 이슈

### 해결됨
- callbackUrl 미포함 → 오픈빌더 "콜백 URL 발행" 토글 활성화로 해결
- qwen3.5:0.8b tool calling 불가 → NVIDIA 클라우드 모델(397b)로 전환
- LMS 과목 ID ≠ UCheck ID → 과목명 검색으로 해결
- NemoClaw stdout [gateway] 라인 노출 → 필터 추가

### 미해결
- **샌드박스 네트워크**: mju.ac.kr 도메인이 프록시(10.200.0.1:3128)에 의해 차단됨. 정책 추가로 해결 안 됨. 현재 호스트 실행으로 우회 중
- **Cloudflare Quick Tunnel URL 변경**: 재시작마다 URL 바뀜 → SERVER_URL + 오픈빌더 스킬 URL 수동 변경 필요. 서버 배포로 해결 예정
- **에이전트 비밀번호 노출**: AGENTS.md에 "크리덴셜 응답에 포함 금지" 규칙 추가했으나, 모델이 무시할 수 있음
- **샌드박스 DNS 실패**: `getent hosts github.com` 실패. git clone 등 샌드박스 내 외부 접근 제한적

---

## 환경 설정 체크리스트

### .env
```
NVIDIA_API_KEY=nvapi-xxxxx
SANDBOX_NAME=mjuclaw
PORT=3000
SERVER_URL=https://<fixed-domain>
ENCRYPTION_KEY=<64자 hex>
ADMIN_KAKAO_ID=<관리자 카카오 ID>
```

### NemoClaw
- `openshell gateway start` → `nemoclaw onboard` (또는 `--resume`)
- 추론 모델: `openshell inference set --provider ollama-local --model "qwen3.5:397b-cloud"`
- Ollama에 NVIDIA API 키 필요: `launchctl setenv NVIDIA_API_KEY <key>` + Ollama 재시작

### 카카오 i 오픈빌더
- 스킬 URL: `https://<domain>/skill`
- **콜백 URL 발행**: 반드시 ON (설정 → 콜백 설정 → "AI 챗봇 구현에 콜백 API가 필요한 경우")
- 폴백 블록 → 스킬 데이터 사용 → 위 스킬 연결
- 변경 후 **배포** 필수

### mju-mcp
- `mju-mcp/` 디렉토리에 빌드본 배치 (gitignore 대상)
- 호스트에서 빌드: `cd mju-mcp && npm install --include=dev && npx tsc`

---

## 프로젝트 구조

```
~/Codes/projects/mjuclaw/kakao/          ← mjuclaw-server 레포
├── src/
│   ├── index.ts        # 엔트리포인트, graceful shutdown
│   ├── server.ts       # Express: /skill, /health, /onboard
│   ├── kakao.ts        # 카카오 응답 포맷 (simpleText, basicCard, 콜백)
│   ├── nemoclaw.ts     # OpenShell SSH → OpenClaw 에이전트
│   ├── mju-tools.ts    # mju-mcp MCP 클라이언트, 키워드 감지, 포맷터
│   ├── session.ts      # 세션 + 크리덴셜 (AES-256-GCM)
│   ├── config.ts       # 환경변수
│   └── types.ts        # 타입 정의
├── public/
│   └── onboard.html    # 학교 인증 웹페이지
├── mju-mcp/            # mju-mcp 빌드본 (gitignore)
├── data/               # credentials.json 등 (gitignore)
├── .env                # 환경변수 (gitignore)
├── CLAUDE.md           # 이 파일
└── README.md
```

---

## 다음 단계

1. **Oracle Cloud 배포** — VM 인스턴스 생성 + Docker + 고정 IP + 서버 세팅
2. **mju-cli skill 방식 검토** — mju-mcp 대신 mju-cli를 OpenClaw skill로 등록하여 에이전트가 직접 CLI 호출
3. **유저별 샌드박스** — 현재 단일 샌드박스 + session-id → 유저별 독립 디렉토리 + 경량 샌드박스
4. **고정 도메인** — Cloudflare 고정 터널 또는 서버 직접 도메인
5. **다중 유저 크리덴셜** — 현재 mju-mcp에 하드코딩된 학번 → 유저별 크리덴셜 동적 전달

---

## 커밋 히스토리

```
be8d45f feat: NemoClaw KakaoTalk Bridge 초기 구현
1f9cf1b feat: 웹 온보딩으로 인증 방식 전환
2f3191a fix: 콜백 비동기 처리 + gateway 로그 필터링
4d05f2e feat: mju-mcp 호스트 직접 실행으로 학사 서비스 연동
533d96d feat: 전체 학사 도구 카카오톡 포맷터 추가
6dbbb24 docs: README 전면 재작성 + 프로젝트 리네이밍
```

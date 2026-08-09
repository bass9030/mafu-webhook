# AGENTS.md

## Project Overview

이 저장소는 마후마후의 X(구 Twitter) 게시물과 LINE 메시지를 일본어에서 한국어로 번역해 구독자의 Discord webhook으로 보내는 Express 애플리케이션이다. 웹 UI에서는 webhook 등록·수정·해제와 최근 공지를 제공한다.

- 런타임: Node.js 20 (`dockerfile`), CommonJS JavaScript
- 웹: Express 4, EJS, 정적 HTML/CSS/브라우저 JavaScript
- 데이터: MariaDB (`mariadb` 드라이버)
- 외부 연동: X 비공식 GraphQL API, Gemini, DeepL, Discord webhook, Sentry
- 패키지 매니저: npm (`package-lock.json` lockfileVersion 3)

## Repository Structure

- `bin/www`: HTTP 서버 진입점과 `PORT` 처리. `app.js`를 로드한 후 `.env`를 읽는 현재 순서에 주의한다.
- `app.js`: Express 미들웨어/라우트 등록, 에러 페이지, 프로덕션 트윗 폴러 시작 지점.
- `routes/`: HTTP 계층. `api.js`에 구독 CRUD, 공지, 개발용 테스트 전송, LINE 수신 API가 모여 있다.
- `utils/getTweet.js`: X 타임라인 조회, 새 트윗 판별, RT/인용문 번역 및 Discord embed 생성.
- `utils/translator.js`: Gemini 우선 번역과 실패 시 DeepL fallback. `utils/glossary.json`을 Gemini system instruction에 포함한다.
- `utils/webhookManager.js`: MariaDB pool, webhook/공지/마지막 트윗 CRUD, 구독 옵션 필터링과 Discord 전송.
- `utils/sendLINE.js`, `utils/otpGenerator.js`: LINE payload의 embed 변환과 30초 단위 HMAC OTP 인증.
- `utils/DebugLogger.js`, `utils/instrument.js`: 콘솔 및 Sentry 관측 계층.
- `views/`, `public/`: EJS 페이지와 정적 자산. 메인 UI 동작과 `/api` 호출은 `public/script.js`에 있다.
- `init.sql`: 새 MariaDB 컨테이너용 초기 스키마 (`webhooks`, `notices`, `lastTweet`). 기존 DB의 변경 이력 관리 도구는 아니다.
- `docker-compose*.yaml`, `dockerfile*`, `run.sh`, `build-image.sh`: 개발/배포 컨테이너 구성.
- `tools/generate-license-page/`: 별도 npm 프로젝트인 라이선스 페이지 생성기.
- `tools/migration-v2-to-v3/`: 과거 v2 DB를 v3로 바꾸는 일회성 도구. 현재 앱의 일반 migration 체계로 취급하지 않는다.

기존 `AGENTS.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `.cursorrules`는 이 문서 작성 전에는 없었다. 서비스 개요는 `readme.md`, 실제 배포 절차는 `.github/workflows/deploy.yaml`을 참고한다.

## Architecture and Data Flow

의존 방향은 `app.js` -> `routes/*` -> `utils/*` -> 외부 API/DB이다. 별도 controller/service/repository 프레임워크나 DI 컨테이너는 없다. 브라우저는 `public/script.js`에서 `/api/*`를 직접 호출한다.

주요 트윗 흐름은 다음과 같다.

1. `app.js`가 `NODE_ENV=production`일 때 시작 직후와 이후 5분마다 `checkNewTweet()`을 호출한다. 개발 모드에서는 자동 감지를 비활성화한다.
2. `utils/getTweet.js`가 `utils/twitterFeatures.js`의 variables/features와 X 인증 환경 변수를 사용해 고정 사용자 ID `268758461`의 타임라인을 읽는다.
3. DB의 `lastTweet` 값과 `BigInt`로 비교하고, 새 항목을 오래된 순서부터 처리한다.
4. 일반/RT/인용/장문 트윗을 재귀적으로 펼친 뒤 `utils/translator.js`로 번역하고 `EmbedBuilder`를 만든다.
5. `WebhookManager.sendWebhook()`이 구독 옵션에 맞는 행을 조회해 Discord로 전송한다.

LINE 흐름은 `POST /api/line-webhook` -> user-agent 및 현재/이전/다음 OTP 확인 -> `sendLINE.sendHook()` -> 번역 -> `WebhookManager.sendWebhook(..., LINE)`이다. 공지는 `POST /api/sendNoti`에서 SHA-512 토큰을 확인한 뒤 DB에 저장하고 공지 수신 구독자에게 전송하며, `GET /api/getNotices`가 최근 10개를 UI에 제공한다.

### Coupled invariants

- `webhooks.options`는 하위 3비트가 각각 LINE `4`, 공지 `2`, 멘션 `1`이다. `public/script.js#setOptions`, `WebhookManager.getOptions/setOptions`, `WEBHOOK_TYPE`, SQL의 bitwise 필터를 함께 유지한다.
- `roleID=-1`은 멘션 없음, `@everyone`/`@here`는 그대로 전송, 숫자는 `<@&...>` 역할 멘션으로 변환된다. 클라이언트와 `routes/api.js` 검증을 함께 변경한다.
- `WebhookManager` 인스턴스는 작업 전 `getConnection()`, 완료 후 `releaseConnection()`이 필요하다. 새 경로에서는 오류/조기 반환에도 연결이 반환되는지 확인한다. 장기 작업은 `getTweet.js#checkNewTweet`의 `finally` 패턴을 참고한다.
- X 응답 파싱은 비공식 API의 구체적인 중첩 구조와 GraphQL operation ID에 결합돼 있다. `utils/getTweet.js`와 `utils/twitterFeatures.js`를 함께 검토하고 실패 시 응답 로깅을 보존한다.
- 번역 glossary를 바꿀 때 기준 파일은 `utils/glossary.json`이다. `utils/uploadGlossary.js`는 CSV를 다시 쓰고 원격 DeepL glossary를 삭제/생성하는 실행형 스크립트이므로 단순 검증 목적으로 실행하지 않는다.

## Development Commands

루트 패키지에서 확인된 명령은 다음뿐이다.

```bash
# lockfile 그대로 의존성 설치
npm ci

# package.json의 개발 시작 명령
npm start

# 컨테이너 기반 개발(빌드, watch, web+MariaDB 시작)
docker compose -f docker-compose-dev.yaml up --build --watch

# 프로덕션 이미지 두 개 빌드
docker build -t mahook-web -f dockerfile .
docker build -t mahook-db -f dockerfile.mariadb .
```

`npm start`는 `nodemon ./bin/www`를 실행하지만 `nodemon`이 루트 `package.json`에 선언돼 있지 않다. 깨끗한 설치에서 동작한다고 가정하지 말고, 이 문제를 수정하지 않는 작업에서는 전역 설치를 문서화하거나 lockfile을 임의 변경하지 않는다. 애플리케이션 컨테이너의 실제 실행 명령은 `node ./bin/www`이다.

현재 루트에는 `test`, `lint`, `format`, `typecheck`, `build` npm script와 관련 설정이 없다. 존재하지 않는 명령을 검증 절차에 추가하지 않는다. GitHub Actions도 테스트가 아니라 `production` 브랜치 push 시 Docker 이미지 빌드·전송·재시작만 수행한다.

## Code Conventions

- CommonJS의 `require`/`module.exports`를 사용한다. 새 파일에 ESM이나 TypeScript를 섞지 않는다.
- 대다수 최근 파일은 큰따옴표, 4칸 들여쓰기, 후행 쉼표를 쓴다. 저장소에 포매터는 없으므로 관련 파일 주변 형식을 보존한다. 오래된 scaffold 파일의 작은따옴표/2칸 스타일을 전역 정리하지 않는다.
- HTTP handler는 Express `Router`의 async 함수로 작성하고 성공/오류 상태를 `{ status: res.statusCode, ... }` JSON으로 돌려준다. 예상 가능한 조회 실패는 `WebhookNotFoundError`, 그 밖의 예외는 `sendErrorLog()` 후 500으로 처리하는 `routes/api.js`를 기준으로 삼는다.
- DB 쿼리는 `utils/webhookManager.js`에 두고 `?` placeholder와 값 배열을 사용한다. 라우트에 문자열 보간 SQL을 추가하지 않는다.
- Discord payload는 `discord.js`의 `EmbedBuilder`와 `WebhookClient`를 사용한다. 트윗 embed의 기준 구현은 `getTweet.js#getWebhookEmbed`, LINE은 `sendLINE.js#sendHook`, 공지는 `webhookManager.js#sendWebhook`이다.
- 외부 호출과 DB 작업은 `async`/`await`로 연결한다. 호출 결과가 후속 상태나 연결 수명에 영향을 주면 `await`를 생략하지 않는다.
- 운영 오류/외부 응답은 `utils/DebugLogger.js`를 통해 콘솔과 Sentry에 기록한다. `instrument.js`는 Sentry 초기화 설정이며 변경 시 개인정보 전송 설정도 함께 검토한다.
- 설정은 `process.env`에서 직접 읽는다. 필요한 키는 `PORT`, `NODE_ENV`, `TWITTER_AUTH_TOKEN`, `TWITTER_CT0`, `GEMINI_API_KEY`, `DEEPL_API_KEY`, `DEEPL_GLOSSARY_ID`, `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `NOTICE_TOKEN_KEY`, `OTP_SECRET`이다. compose에는 `DB_ROOT_PASSWORD`도 필요하다. 루트 `.env`는 gitignore 대상이다.
- 로컬 `.env` 로딩은 `bin/www`에서 `require('../app')` 뒤에 수행된다. 여러 유틸리티가 import 시점에 env로 client/pool을 생성하므로, 로컬 직접 실행을 손볼 때는 이 초기화 순서를 반드시 점검한다. Docker compose는 프로세스 시작 전에 환경을 주입한다.

## Testing

현재 자동 테스트 프레임워크, 테스트 디렉터리, fixture/mock, CI 테스트 단계가 없다. 두 도구 패키지의 `test` script도 의도적으로 실패하는 placeholder이며 실행 가능한 테스트가 아니다.

기능 변경 시 가능하면 Node 내장 테스트 러너 등 새 체계를 무단 도입하기보다 변경 범위에 맞는 테스트 도입 여부를 명시적으로 결정한다. 테스트를 추가한다면 package script와 함께 추가하고 외부 X/Gemini/DeepL/Discord/Sentry 및 MariaDB를 실제 호출하지 않도록 경계를 분리해야 한다. 현재 최소 정적 검증은 변경한 JavaScript에 대해 다음처럼 수행할 수 있다.

```bash
node --check path/to/changed-file.js
```

API/DB/외부 연동 변경은 필요한 환경과 격리된 DB/webhook이 있을 때만 수동 통합 확인한다. 프로덕션 자격 증명이나 실제 구독자 webhook으로 시험하지 않는다. 개발 모드에서만 제공되는 `GET /api/testWebhook`도 실제 번역 API, X, DB, Discord를 호출한다.

## How to Make Changes

- 구독 API 변경: `routes/api.js`의 validation/status 처리, `utils/webhookManager.js`의 DB 동작, `public/script.js`의 payload/응답 UI를 함께 확인한다.
- 새 webhook 메시지 유형 추가: `WEBHOOK_TYPE`, 옵션 비트 encode/decode, DB 선택 조건, `sendWebhook()` switch, 메인 UI checkbox/payload를 하나의 변경으로 취급한다. 기존 비트 의미를 재사용하지 않는다.
- 트윗 파싱/표현 버그: `utils/getTweet.js`의 `getTimelineByUserID`, `generationTweetMarkdown`, `getWebhookEmbed` 중 해당 단계에서 수정한다. 일반, 장문 `note_tweet`, RT, 인용, RT 안의 인용 및 미디어를 회귀 범위로 본다.
- 번역 변경: provider/fallback은 `utils/translator.js`, 용어는 `utils/glossary.json`에서 수정한다. DeepL 원격 glossary 갱신은 별도의 운영 작업이다.
- LINE 수신 변경: 인증 계약은 `routes/api.js`의 user-agent/authorization 처리와 `utils/otpGenerator.js`, 메시지 변환은 `utils/sendLINE.js`에서 수정한다.
- DB 모델 변경: 새 설치용 `init.sql`과 `utils/webhookManager.js` 쿼리를 함께 갱신한다. 기존 운영 DB용 자동 migration 체계가 없으므로 필요한 migration/rollout 절차를 별도로 제시한다. 과거 `tools/migration-v2-to-v3`를 재실행하지 않는다.
- 페이지/브라우저 동작 변경: route/render 위치는 `app.js` 또는 `routes/index.js`, 마크업은 `views/*.ejs`, 동작은 `public/script.js`, 스타일은 `public/style.css`이다. 공통 `<head>`는 `views/header.ejs` include를 사용한다.
- 관측/오류 처리 변경: Sentry 초기화는 `utils/instrument.js`, 호출 wrapper는 `utils/DebugLogger.js`, Express 최종 오류 렌더링은 `app.js`에서 확인한다.

## Generated, External, and Sensitive Files

- `.env`, DB 비밀번호, X 쿠키 토큰, Gemini/DeepL 키, OTP/공지 비밀, Discord webhook token을 커밋하거나 로그/응답에 노출하지 않는다.
- `tools/migration-v2-to-v3/migration-v2-to-v3.js`에는 과거 DB 접속 정보가 하드코딩돼 있으며 파괴적인 `ALTER TABLE ... DROP COLUMN`을 수행한다. 실행하거나 새 migration의 예제로 복사하지 않는다.
- `package-lock.json`과 각 `tools/*/package-lock.json`은 서로 독립된 npm 프로젝트의 lockfile이다. 해당 프로젝트 의존성을 실제 변경할 때만 대응하는 lockfile을 갱신한다.
- `node_modules/`, `.env`, `lastTweet.txt`, `timeline.json`, `tweetData.json`, `*.db`는 gitignore 대상이다.
- `views/opensource.ejs`는 현재 추적된 페이지다. 생성 도구는 `tools/generate-license-page` 작업 디렉터리의 `opensource.ejs`를 출력하므로 경로를 확인하지 않고 실행하거나 결과를 덮어쓰지 않는다.
- `init.sql`은 MariaDB 이미지 최초 초기화 때만 적용된다. `/mahook-db` volume이 이미 있으면 수정 사항이 자동 반영되지 않는다.
- `.github/workflows/deploy.yaml`, `build-image.sh`, `run.sh`에는 이미지 삭제/서비스 재시작 같은 운영 영향 명령이 있다. 문서 확인이나 일반 검증 목적으로 실행하지 않는다.

## Validation Checklist

- [ ] 수정한 경로와 직접 연결된 route, utility, UI, SQL 및 옵션 비트 계약을 함께 검토했다.
- [ ] 모든 변경 JavaScript에 `node --check`를 실행했다.
- [ ] `package.json` 변경 시 올바른 프로젝트의 lockfile을 갱신했고 `npm ci` 가능 여부를 확인했다.
- [ ] 실행 검증이 필요하면 `NODE_ENV=development`를 사용해 자동 5분 트윗 폴링을 막았다.
- [ ] 외부 호출 검증은 격리된 자격 증명/DB/webhook에서만 수행했고 비밀이나 원문 응답을 커밋하지 않았다.
- [ ] Docker/DB 변경 시 web 이미지와 MariaDB 초기 스키마, 기존 volume에 대한 rollout 차이를 확인했다.
- [ ] 공식 lint/typecheck/test script가 없음을 결과 보고에 숨기지 않았으며, 실행하지 않은 통합 검증을 실행했다고 표현하지 않았다.

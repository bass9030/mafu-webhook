# mahook LINE webhook client

마훅의 `POST /api/line-webhook`으로 LINE 메시지를 보내는 독립 Go 클라이언트입니다.
JSON 원본 바이트의 SHA-256 digest와 timestamp, nonce, 요청 경로를 Ed25519 개인키로
서명합니다.

## 키 생성 및 서버 설정

```bash
openssl genpkey -algorithm Ed25519 -out line-private.pem
openssl pkey -in line-private.pem -pubout -outform DER | base64 -w0
```

두 번째 명령의 출력값을 마훅 서버의 `LINE_SIGNING_PUBLIC_KEY`로 설정합니다. 개인키는
이 클라이언트가 실행되는 호스트에서만 보관합니다.

## 빌드

SQLite 감지 모드는 `github.com/mattn/go-sqlite3`를 사용하므로 Go와 C 컴파일러가
필요합니다.

```bash
go build -o mahook-line-client ./cmd/mahook-line-client
```

## 실행

개인키 파일을 사용하는 방법:

```bash
./mahook-line-client \
  -url https://mahook.example.com/api/line-webhook \
  -key-id line-2026-01 \
  -private-key-file ./line-private.pem \
  -content "LINE 메시지"
```

환경 변수를 사용하는 방법:

```bash
export MAHOOK_LINE_WEBHOOK_URL=https://mahook.example.com/api/line-webhook
export LINE_SIGNING_KEY_ID=line-2026-01
export LINE_SIGNING_PRIVATE_KEY="$(openssl pkey -in line-private.pem -outform DER | base64 -w0)"

echo "LINE 메시지" | ./mahook-line-client
```

`LINE_SIGNING_PRIVATE_KEY`는 PKCS#8 PEM 문자열 또는 PKCS#8 DER의 base64 값을 받습니다.
위 예시처럼 PEM 파일 전체를 base64로 인코딩한 값은 지원하지 않으므로, 환경 변수에
base64를 사용할 때는 다음 명령으로 DER 값을 생성합니다.

```bash
openssl pkey -in line-private.pem -outform DER | base64 -w0
```

`-time`을 생략하면 현재 Unix millisecond가 메시지 시간이 됩니다. `-content`를
생략하면 표준 입력에서 메시지를 읽습니다.

운영 환경에서는 개인키와 메시지 내용이 평문 네트워크에 노출되지 않도록 반드시
HTTPS endpoint를 사용하세요. 기본 HTTP endpoint는 로컬 개발용입니다.

## LINE 메시지 감지 모드

`-db` 또는 `LINE_DB_PATH`가 설정되면 직접 전송 대신 감지 모드로 실행됩니다. 기존
클라이언트와 동일하게 SQLite `chat` 테이블의 `last_message`,
`last_created_time`을 주기적으로 조회합니다. 기본 chat ID는 마후마후 계정의
`u2d03b563a3d76aea46fae544f09ab79e`입니다.

```bash
export MAHOOK_LINE_WEBHOOK_URL=https://mahook.example.com/api/line-webhook
export LINE_SIGNING_KEY_ID=line-2026-01
export LINE_SIGNING_PRIVATE_KEY="$(openssl pkey -in line-private.pem -outform DER | base64 -w0)"
export LINE_DB_PATH=/path/to/naver-line/line.db

./mahook-line-client \
  -interval 5s \
  -state-file /var/lib/mahook-line/last_sent_message
```

사용 가능한 감지 설정:

- `LINE_DB_PATH` 또는 `-db`: LINE SQLite DB 경로
- `LINE_CHAT_ID` 또는 `-chat-id`: 감지할 `chat_id`
- `MAHOOK_LINE_STATE_FILE` 또는 `-state-file`: 마지막 전송 timestamp 저장 파일
- `-interval`: 조회 주기, 기본값 `5s`

상태 파일이 없으면 마지막 전송 시간을 `0`으로 간주하므로 DB에 들어 있는 현재 최신
메시지 한 건을 즉시 전송합니다. 전송에 실패하면 상태를 갱신하지 않아 다음 조회에서
재시도합니다. 프로그램 종료 신호(`SIGINT`, `SIGTERM`)는 현재 작업을 정리한 뒤
정상적으로 종료합니다.

LINE DB에는 대화별 최신 메시지만 있으므로 프로그램이 정지된 동안 여러 메시지가
도착하면 가장 마지막 메시지만 복구할 수 있습니다. 모든 메시지를 보존해야 한다면
LINE DB의 메시지 이력 테이블을 별도로 조회하도록 확장해야 합니다.

## 테스트

```bash
go test ./...
```

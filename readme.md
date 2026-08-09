# 마훅(mahook)

![main](https://github.com/bass9030/mafu-webhook/blob/master/images/main.png?raw=true)

> 한글 번역된 마후마후 트윗을, 디스코드에서.

<a style="font-size: large;" href="https://mahook.bass9030.dev">이용하러 가기</a>

[마후마후](https://twitter.com/uni_mafumafu)님의 트윗을 Gemini, DeepL로 번역하여 디스코드로 전송합니다.

## LINE webhook 요청 서명

`POST /api/line-webhook`은 Ed25519로 서명된 JSON 요청만 처리합니다. 서버에는
공개키만 저장하며, 개인키는 LINE 메시지를 전달하는 송신 측에서만 관리합니다.

### 키 생성

```bash
openssl genpkey -algorithm Ed25519 -out line-private.pem
openssl pkey -in line-private.pem -pubout -out line-public.pem
openssl pkey -in line-private.pem -pubout -outform DER | base64 -w0
```

마지막 명령의 출력값을 서버의 `LINE_SIGNING_PUBLIC_KEY`에 설정합니다. PEM 문자열도
사용할 수 있습니다. `LINE_SIGNING_KEY_ID`에는 키 교체를 구분할 식별자를 설정합니다.

```dotenv
LINE_SIGNING_PUBLIC_KEY=<base64 encoded SPKI DER public key>
LINE_SIGNING_KEY_ID=line-2026-01
```

### 서명 계약

송신 측은 전송할 JSON의 UTF-8 원본 바이트로 SHA-256 digest를 계산합니다. JSON을
서명한 후 다시 직렬화하면 바이트가 달라질 수 있으므로, 서명한 것과 동일한 Buffer를
HTTP body로 전송해야 합니다.

```text
Content-Digest: sha-256=:<base64 SHA-256 digest>:
X-Key-Id: line-2026-01
X-Timestamp: <Unix timestamp in seconds>
X-Nonce: <16~128 character random base64url value>
X-Signature: <base64 Ed25519 signature>
```

서명 대상 문자열은 아래 다섯 줄을 LF(`\n`)로 연결한 값입니다. 마지막 줄 뒤에는
개행을 붙이지 않습니다.

```text
@method:POST
@path:/api/line-webhook
x-timestamp:<X-Timestamp value>
x-nonce:<X-Nonce value>
content-digest:<Content-Digest value>
```

서버는 timestamp가 현재 시각에서 5분 이내인지 확인하고, 한 번 승인한 nonce는 다시
받지 않습니다. nonce 저장소는 현재 단일 프로세스 메모리 기반이므로 웹 서버를 여러
인스턴스로 확장할 때는 Redis 등 공유 TTL 저장소로 교체해야 합니다.

이 계약을 구현한 Go 송신 클라이언트는
[`tools/line-webhook-client`](./tools/line-webhook-client)에 있습니다.

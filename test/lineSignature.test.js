// utils/lineSignature.js: LINE 중계 요청 Ed25519 서명 검증
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { generateKeyPairSync, randomBytes, sign } = require("crypto");
const {
    createContentDigest,
    createLineSignatureBase,
    loadEd25519PublicKey,
    LineSignatureVerifier,
} = require("../utils/lineSignature");

const NOW = 1_786_284_000;
const { privateKey, publicKey } = generateKeyPairSync("ed25519");

function signedRequest(
    body = Buffer.from('{"time":1786284000000,"content":"hello"}'),
    timestamp = String(NOW),
) {
    const nonce = randomBytes(24).toString("base64url");
    const contentDigest = createContentDigest(body);
    const base = createLineSignatureBase("POST", "/api/line-webhook", timestamp, nonce, contentDigest);
    return {
        method: "POST",
        path: "/api/line-webhook",
        rawBody: body,
        headers: {
            keyId: "line-2026-01",
            timestamp,
            nonce,
            contentDigest,
            signature: sign(null, Buffer.from(base), privateKey).toString("base64"),
        },
    };
}

const verifier = () =>
    new LineSignatureVerifier(publicKey, { keyId: "line-2026-01", now: () => NOW });

test("서명 대상 문자열: Go 클라이언트와 같은 형식", () => {
    assert.equal(
        createLineSignatureBase("post", "/p", "1", "n", "d"),
        "@method:POST\n@path:/p\nx-timestamp:1\nx-nonce:n\ncontent-digest:d",
    );
    assert.equal(
        createContentDigest(Buffer.from("")),
        "sha-256=:47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=:",
    );
});

test("공개키: SPKI DER base64와 PEM(\\n 이스케이프 포함) 모두 허용, 다른 알고리즘 거부", () => {
    const der = publicKey.export({ format: "der", type: "spki" }).toString("base64");
    const pem = publicKey.export({ format: "pem", type: "spki" });
    assert.equal(loadEd25519PublicKey(der).asymmetricKeyType, "ed25519");
    assert.equal(loadEd25519PublicKey(pem.replace(/\n/g, "\\n")).asymmetricKeyType, "ed25519");
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey;
    assert.throws(() => loadEd25519PublicKey(ec.export({ format: "pem", type: "spki" })));
});

test("올바른 서명 허용", () => {
    assert.equal(verifier().verify(signedRequest()), true);
});

test("nonce 재사용 거부, 만료 후 기록 정리", () => {
    let now = NOW;
    const v = new LineSignatureVerifier(publicKey, { now: () => now });
    const request = signedRequest();
    assert.equal(v.verify(request), true);
    assert.equal(v.verify(request), false);
    now = NOW + 300;
    v.verify(signedRequest(undefined, String(now)));
    assert.equal(v.usedNonces.has(request.headers.nonce), false);
});

test("body 변조 거부", () => {
    const request = signedRequest();
    request.rawBody = Buffer.from('{"time":1786284000000,"content":"changed"}');
    assert.equal(verifier().verify(request), false);
});

test("timestamp: 5분 초과 또는 형식 오류 거부", () => {
    assert.equal(verifier().verify(signedRequest(undefined, String(NOW - 301))), false);
    assert.equal(verifier().verify(signedRequest(undefined, String(NOW + 301))), false);
    assert.equal(verifier().verify(signedRequest(undefined, String(NOW - 300))), true);
    assert.equal(verifier().verify(signedRequest(undefined, `${NOW}000`)), false);
});

test("키 ID 불일치 거부 (기대값이 없으면 검사하지 않음)", () => {
    const request = signedRequest();
    request.headers.keyId = "unknown";
    assert.equal(verifier().verify(request), false);
    assert.equal(new LineSignatureVerifier(publicKey, { now: () => NOW }).verify(request), true);
});

test("nonce 형식, 서명 길이 오류 거부", () => {
    const shortNonce = signedRequest();
    shortNonce.headers.nonce = "short";
    assert.equal(verifier().verify(shortNonce), false);
    const badSig = signedRequest();
    badSig.headers.signature = badSig.headers.signature.slice(0, 40);
    assert.equal(verifier().verify(badSig), false);
});

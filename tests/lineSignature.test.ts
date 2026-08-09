import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import test from "node:test";
import {
    createContentDigest,
    createLineSignatureBase,
    LineSignatureVerifier,
    type LineSignatureRequest,
} from "../utils/lineSignature";

const NOW = 1_786_284_000;
const { privateKey, publicKey } = generateKeyPairSync("ed25519");

function signedRequest(
    body: Buffer = Buffer.from('{"time":1786284000000,"content":"hello"}'),
    timestamp = String(NOW),
): LineSignatureRequest {
    const nonce = randomBytes(24).toString("base64url");
    const contentDigest = createContentDigest(body);
    const signatureBase = createLineSignatureBase(
        "POST",
        "/api/line-webhook",
        timestamp,
        nonce,
        contentDigest,
    );
    return {
        method: "POST",
        path: "/api/line-webhook",
        rawBody: body,
        headers: {
            keyId: "line-2026-01",
            timestamp,
            nonce,
            contentDigest,
            signature: sign(null, Buffer.from(signatureBase), privateKey).toString(
                "base64",
            ),
        },
    };
}

function verifier(): LineSignatureVerifier {
    return new LineSignatureVerifier(publicKey, {
        keyId: "line-2026-01",
        now: () => NOW,
    });
}

test("accepts a correctly signed request", () => {
    assert.equal(verifier().verify(signedRequest()), true);
});

test("rejects replayed nonces", () => {
    const request = signedRequest();
    const signatureVerifier = verifier();
    assert.equal(signatureVerifier.verify(request), true);
    assert.equal(signatureVerifier.verify(request), false);
});

test("rejects a modified body", () => {
    const request = signedRequest();
    request.rawBody = Buffer.from('{"time":1786284000000,"content":"changed"}');
    assert.equal(verifier().verify(request), false);
});

test("rejects an expired timestamp", () => {
    assert.equal(verifier().verify(signedRequest(undefined, String(NOW - 301))), false);
});

test("rejects an unexpected key id", () => {
    const request = signedRequest();
    request.headers.keyId = "unknown";
    assert.equal(verifier().verify(request), false);
});

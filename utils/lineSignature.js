// LINE 중계 클라이언트(tools/line-webhook-client, Go) 요청의 Ed25519 서명 검증
//
// 서명 대상 문자열 (LF로 연결, 마지막 줄 뒤 개행 없음):
//   @method:POST
//   @path:/api/line-webhook
//   x-timestamp:<X-Timestamp, Unix 초>
//   x-nonce:<X-Nonce, base64url 16~128자>
//   content-digest:<Content-Digest, "sha-256=:<base64 SHA-256(원본 body)>:">
const {
    createHash,
    createPublicKey,
    timingSafeEqual,
    verify,
} = require("crypto");

const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const BASE64_PATTERN =
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const DEFAULT_MAX_AGE_SECONDS = 300;

/** @param {Buffer} rawBody */
function createContentDigest(rawBody) {
    return `sha-256=:${createHash("sha256").update(rawBody).digest("base64")}:`;
}

function createLineSignatureBase(method, path, timestamp, nonce, contentDigest) {
    return [
        `@method:${method.toUpperCase()}`,
        `@path:${path}`,
        `x-timestamp:${timestamp}`,
        `x-nonce:${nonce}`,
        `content-digest:${contentDigest}`,
    ].join("\n");
}

/**
 * PEM 문자열 또는 SPKI DER의 base64 값을 Ed25519 공개키로 읽는다.
 * @param {string} value
 * @returns {import("crypto").KeyObject}
 */
function loadEd25519PublicKey(value) {
    const key = value.includes("BEGIN PUBLIC KEY")
        ? value.replace(/\\n/g, "\n")
        : { key: Buffer.from(value.trim(), "base64"), format: "der", type: "spki" };
    const publicKey = createPublicKey(key);
    if (publicKey.asymmetricKeyType !== "ed25519") {
        throw new Error("LINE_SIGNING_PUBLIC_KEY must be an Ed25519 public key");
    }
    return publicKey;
}

class LineSignatureVerifier {
    /**
     * @param {string | import("crypto").KeyObject} publicKey
     * @param {{ keyId?: string, maxAgeSeconds?: number, now?: () => number }} [options]
     *   now: 현재 Unix 시각(초)
     */
    constructor(publicKey, options = {}) {
        this.publicKey =
            typeof publicKey === "string"
                ? loadEd25519PublicKey(publicKey)
                : publicKey;
        if (this.publicKey.asymmetricKeyType !== "ed25519") {
            throw new Error("An Ed25519 public key is required");
        }
        this.expectedKeyId = options.keyId;
        this.maxAgeSeconds = options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
        this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
        /** 승인한 nonce → 만료 시각(초). 단일 프로세스 메모리 기반 */
        this.usedNonces = new Map();
    }

    /**
     * @param {{
     *   method: string, path: string, rawBody: Buffer,
     *   headers: { keyId?: string, timestamp: string, nonce: string,
     *              contentDigest: string, signature: string }
     * }} request
     * @returns {boolean}
     */
    verify(request) {
        const now = this.now();
        this.removeExpiredNonces(now);
        const { headers } = request;
        if (this.expectedKeyId && headers.keyId !== this.expectedKeyId) return false;
        if (!/^\d{10}$/.test(headers.timestamp)) return false;
        if (Math.abs(now - Number(headers.timestamp)) > this.maxAgeSeconds) {
            return false;
        }
        if (!NONCE_PATTERN.test(headers.nonce) || this.usedNonces.has(headers.nonce)) {
            return false;
        }
        if (!safeEqual(headers.contentDigest, createContentDigest(request.rawBody))) {
            return false;
        }
        const signature = decodeSignature(headers.signature);
        if (!signature) return false;

        const signatureBase = createLineSignatureBase(
            request.method,
            request.path,
            headers.timestamp,
            headers.nonce,
            headers.contentDigest,
        );
        const isValid = verify(
            null,
            Buffer.from(signatureBase, "utf8"),
            this.publicKey,
            signature,
        );
        if (isValid) {
            this.usedNonces.set(headers.nonce, now + this.maxAgeSeconds);
        }
        return isValid;
    }

    removeExpiredNonces(now) {
        for (const [nonce, expiresAt] of this.usedNonces) {
            if (expiresAt <= now) this.usedNonces.delete(nonce);
        }
    }
}

function decodeSignature(value) {
    if (!BASE64_PATTERN.test(value)) return null;
    const decoded = Buffer.from(value, "base64");
    return decoded.length === 64 ? decoded : null;
}

function safeEqual(left, right) {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
}

module.exports = {
    createContentDigest,
    createLineSignatureBase,
    loadEd25519PublicKey,
    LineSignatureVerifier,
};

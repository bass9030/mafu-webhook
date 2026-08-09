import {
    createHash,
    createPublicKey,
    timingSafeEqual,
    verify,
    type KeyObject,
} from "node:crypto";

export interface LineSignatureHeaders {
    keyId?: string;
    timestamp: string;
    nonce: string;
    contentDigest: string;
    signature: string;
}

export interface LineSignatureRequest {
    method: string;
    path: string;
    rawBody: Buffer;
    headers: LineSignatureHeaders;
}

interface LineSignatureVerifierOptions {
    keyId?: string;
    maxAgeSeconds?: number;
    now?: () => number;
}

const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function createContentDigest(rawBody: Buffer): string {
    return `sha-256=:${createHash("sha256").update(rawBody).digest("base64")}:`;
}

export function createLineSignatureBase(
    method: string,
    path: string,
    timestamp: string,
    nonce: string,
    contentDigest: string,
): string {
    return [
        `@method:${method.toUpperCase()}`,
        `@path:${path}`,
        `x-timestamp:${timestamp}`,
        `x-nonce:${nonce}`,
        `content-digest:${contentDigest}`,
    ].join("\n");
}

export function loadEd25519PublicKey(value: string): KeyObject {
    const normalized = value.includes("BEGIN PUBLIC KEY")
        ? value.replace(/\\n/g, "\n")
        : {
              key: Buffer.from(value, "base64"),
              format: "der" as const,
              type: "spki" as const,
          };
    const publicKey = createPublicKey(normalized);
    if (publicKey.asymmetricKeyType !== "ed25519") {
        throw new Error("LINE_SIGNING_PUBLIC_KEY must be an Ed25519 public key");
    }
    return publicKey;
}

export class LineSignatureVerifier {
    private readonly publicKey: KeyObject;
    private readonly expectedKeyId?: string;
    private readonly maxAgeSeconds: number;
    private readonly now: () => number;
    private readonly usedNonces = new Map<string, number>();

    constructor(publicKey: string | KeyObject, options: LineSignatureVerifierOptions = {}) {
        this.publicKey =
            typeof publicKey === "string"
                ? loadEd25519PublicKey(publicKey)
                : publicKey;
        if (this.publicKey.asymmetricKeyType !== "ed25519") {
            throw new Error("An Ed25519 public key is required");
        }
        this.expectedKeyId = options.keyId;
        this.maxAgeSeconds = options.maxAgeSeconds ?? 300;
        this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    }

    verify(request: LineSignatureRequest): boolean {
        const now = this.now();
        this.removeExpiredNonces(now);
        const { headers } = request;
        if (this.expectedKeyId && headers.keyId !== this.expectedKeyId) return false;
        if (!/^\d{10}$/.test(headers.timestamp)) return false;
        const timestamp = Number(headers.timestamp);
        if (Math.abs(now - timestamp) > this.maxAgeSeconds) return false;
        if (!NONCE_PATTERN.test(headers.nonce) || this.usedNonces.has(headers.nonce)) {
            return false;
        }

        const expectedDigest = createContentDigest(request.rawBody);
        if (!safeEqual(headers.contentDigest, expectedDigest)) return false;
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

    private removeExpiredNonces(now: number): void {
        for (const [nonce, expiresAt] of this.usedNonces) {
            if (expiresAt <= now) this.usedNonces.delete(nonce);
        }
    }
}

function decodeSignature(value: string): Buffer | null {
    if (!BASE64_PATTERN.test(value)) return null;
    const decoded = Buffer.from(value, "base64");
    return decoded.length === 64 ? decoded : null;
}

function safeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return (
        leftBuffer.length === rightBuffer.length &&
        timingSafeEqual(leftBuffer, rightBuffer)
    );
}

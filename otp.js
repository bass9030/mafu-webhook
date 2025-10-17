const crypto = require("crypto");

class TOTPGenerator {
    constructor(secret, timeStep = 30, digits = 6, algorithm = "sha1") {
        this.secret = secret;
        this.timeStep = timeStep; // RFC 6238 default: 30 seconds
        this.digits = digits; // RFC 6238 default: 6 digits
        this.algorithm = algorithm; // RFC 6238 default: SHA-1
    }

    /**
     * Base32 디코딩 (Google Authenticator 등에서 사용하는 형식)
     */
    static base32Decode(encoded) {
        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        let bits = "";
        let value = 0;

        encoded = encoded.replace(/=+$/, ""); // padding 제거

        for (let i = 0; i < encoded.length; i++) {
            const char = encoded[i].toUpperCase();
            const index = alphabet.indexOf(char);
            if (index === -1) {
                throw new Error(`Invalid character in Base32: ${char}`);
            }
            bits += index.toString(2).padStart(5, "0");
        }

        const bytes = [];
        for (let i = 0; i < bits.length; i += 8) {
            const byte = bits.slice(i, i + 8);
            if (byte.length === 8) {
                bytes.push(parseInt(byte, 2));
            }
        }

        return Buffer.from(bytes);
    }

    /**
     * RFC 6238에 따른 현재 시간 스텝 계산
     */
    getCurrentTimeStep(timestamp = null) {
        const currentTime = timestamp || Math.floor(Date.now() / 1000);
        return Math.floor(currentTime / this.timeStep);
    }

    /**
     * RFC 4226 HOTP 알고리즘 구현 (TOTP의 기반)
     */
    generateHOTP(counter, secret) {
        // 8바이트 카운터를 빅엔디안으로 변환
        const counterBuffer = Buffer.alloc(8);
        counterBuffer.writeUInt32BE(0, 0); // 상위 4바이트
        counterBuffer.writeUInt32BE(counter, 4); // 하위 4바이트

        // HMAC 계산
        const hmac = crypto.createHmac(this.algorithm, secret);
        hmac.update(counterBuffer);
        const digest = hmac.digest();

        // Dynamic truncation (RFC 4226 Section 5.4)
        const offset = digest[digest.length - 1] & 0x0f;
        const code =
            ((digest[offset] & 0x7f) << 24) |
            ((digest[offset + 1] & 0xff) << 16) |
            ((digest[offset + 2] & 0xff) << 8) |
            (digest[offset + 3] & 0xff);

        // 지정된 자릿수로 자르기
        const otp = (code % Math.pow(10, this.digits))
            .toString()
            .padStart(this.digits, "0");
        return otp;
    }

    /**
     * RFC 6238 TOTP 생성
     */
    generate(timestamp = null) {
        const timeStep = this.getCurrentTimeStep(timestamp);
        let secret;

        // 문자열이면 Base32 디코딩 시도
        if (typeof this.secret === "string") {
            try {
                secret = TOTPGenerator.base32Decode(this.secret);
            } catch (e) {
                // Base32가 아니면 UTF-8로 처리
                secret = Buffer.from(this.secret, "utf8");
            }
        } else {
            secret = this.secret;
        }

        return this.generateHOTP(timeStep, secret);
    }

    /**
     * TOTP 검증 (시간 오차 허용)
     */
    verify(token, timestamp = null, window = 1) {
        const currentTimeStep = this.getCurrentTimeStep(timestamp);

        // 현재 시간과 앞뒤 window 범위의 TOTP 검증
        for (let i = -window; i <= window; i++) {
            const testTimeStep = currentTimeStep + i;
            const testToken = this.generateHOTP(
                testTimeStep,
                typeof this.secret === "string"
                    ? TOTPGenerator.base32Decode(this.secret)
                    : this.secret
            );

            if (testToken === token) {
                return true;
            }
        }

        return false;
    }

    /**
     * 다음 TOTP가 생성될 때까지 남은 시간 (초)
     */
    getRemainingTime(timestamp = null) {
        const currentTime = timestamp || Math.floor(Date.now() / 1000);
        const currentTimeStep = this.getCurrentTimeStep(currentTime);
        const nextTimeStep = (currentTimeStep + 1) * this.timeStep;
        return nextTimeStep - currentTime;
    }
}

// 사용 예제
function example() {
    console.log("=== RFC 6238 TOTP Generator 예제 ===\n");

    // 1. Base32 인코딩된 시크릿 키 사용 (Google Authenticator 호환)
    const secret1 = "JBSWY3DPEHPK3PXP"; // "Hello!" in Base32
    const totp1 = new TOTPGenerator(secret1);

    console.log("1. Base32 시크릿 키 사용:");
    console.log(`   시크릿: ${secret1}`);
    console.log(`   현재 TOTP: ${totp1.generate()}`);
    console.log(`   남은 시간: ${totp1.getRemainingTime()}초\n`);

    // 2. 바이너리 시크릿 키 사용
    const secret2 = crypto.randomBytes(20); // 160비트 랜덤 키
    const totp2 = new TOTPGenerator(secret2);

    console.log("2. 바이너리 시크릿 키 사용:");
    console.log(`   시크릿 (hex): ${secret2.toString("hex")}`);
    console.log(`   현재 TOTP: ${totp2.generate()}\n`);

    // 3. 다른 파라미터 사용 (SHA-256, 8자리)
    const totp3 = new TOTPGenerator(secret1, 30, 8, "sha256");
    console.log("3. SHA-256, 8자리 TOTP:");
    console.log(`   현재 TOTP: ${totp3.generate()}\n`);

    // 4. TOTP 검증 예제
    const currentToken = totp1.generate();
    console.log("4. TOTP 검증:");
    console.log(`   생성된 토큰: ${currentToken}`);
    console.log(`   검증 결과: ${totp1.verify(currentToken)}`);
    console.log(`   잘못된 토큰 검증: ${totp1.verify("123456")}\n`);

    // 5. 특정 시간의 TOTP 생성
    const specificTime = Math.floor(Date.now() / 1000) - 60; // 1분 전
    console.log("5. 특정 시간의 TOTP:");
    console.log(`   1분 전 TOTP: ${totp1.generate(specificTime)}`);
    console.log(`   현재 TOTP: ${totp1.generate()}`);
}

// RFC 6238 테스트 벡터 검증
function testRFC6238Vectors() {
    console.log("\n=== RFC 6238 테스트 벡터 검증 ===\n");

    // RFC 6238 Appendix B의 테스트 벡터
    const testVectors = [
        { time: 59, sha1: "94287082", sha256: "46119246", sha512: "90693936" },
        {
            time: 1111111109,
            sha1: "07081804",
            sha256: "68084774",
            sha512: "25091201",
        },
        {
            time: 1111111111,
            sha1: "14050471",
            sha256: "67062674",
            sha512: "99943326",
        },
        {
            time: 1234567890,
            sha1: "89005924",
            sha256: "91819424",
            sha512: "93441116",
        },
        {
            time: 2000000000,
            sha1: "69279037",
            sha256: "90698825",
            sha512: "38618901",
        },
        {
            time: 20000000000,
            sha1: "65353130",
            sha256: "77737706",
            sha512: "47863826",
        },
    ];

    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA===="; // RFC 6238 테스트 시크릿

    testVectors.forEach((vector) => {
        console.log(`시간: ${vector.time}`);

        // SHA-1 테스트
        const totp1 = new TOTPGenerator(secret, 30, 8, "sha1");
        const result1 = totp1.generate(vector.time);
        console.log(
            `  SHA-1   - 예상: ${vector.sha1}, 실제: ${result1}, ${
                result1 === vector.sha1 ? "✓" : "✗"
            }`
        );

        // SHA-256 테스트
        const totp256 = new TOTPGenerator(secret, 30, 8, "sha256");
        const result256 = totp256.generate(vector.time);
        console.log(
            `  SHA-256 - 예상: ${vector.sha256}, 실제: ${result256}, ${
                result256 === vector.sha256 ? "✓" : "✗"
            }`
        );

        // SHA-512 테스트
        const totp512 = new TOTPGenerator(secret, 30, 8, "sha512");
        const result512 = totp512.generate(vector.time);
        console.log(
            `  SHA-512 - 예상: ${vector.sha512}, 실제: ${result512}, ${
                result512 === vector.sha512 ? "✓" : "✗"
            }`
        );

        console.log();
    });
}

// 실행
if (require.main === module) {
    example();
    testRFC6238Vectors();
}

module.exports = TOTPGenerator;

const { createHmac } = require("node:crypto");

function getOTP() {
    const timeStep = 30;
    const T = Math.floor(Date.now() / 1000 / timeStep);

    let otp_now = generateOTPNumber(T);
    let otp_future = generateOTPNumber(T + 1);
    let otp_past = generateOTPNumber(T - 1);

    return {
        past: otp_past,
        now: otp_now,
        future: otp_future,
    };
}

function generateOTPNumber(time) {
    const hmac = createHmac("sha256", process.env.OTP_SECRET);
    hmac.update(time.toString());
    let hash = hmac.digest();
    if (hash.length < 20) {
        throw new Error("Hash too short for HOTP");
    }

    // offset 범위 검증
    const offset = hash[hash.length - 1] & 0xf;
    if (offset + 3 >= hash.length) {
        throw new Error("Invalid offset for HOTP");
    }

    const code =
        ((hash[offset] & 0x7f) << 24) |
        ((hash[offset + 1] & 0xff) << 16) |
        ((hash[offset + 2] & 0xff) << 8) |
        (hash[offset + 3] & 0xff);
    return (code % 1000000).toString().padStart(6, "0"); // 6자리 숫자
}

if (require.main == module) {
    require("dotenv").config();
    console.log(getOTP());
}

module.exports = getOTP;

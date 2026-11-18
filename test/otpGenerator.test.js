const { test } = require("node:test");
const assert = require("node:assert/strict");

process.env.OTP_SECRET = "test-otp-secret";
const getOTP = require("../utils/otpGenerator");

const T0 = 1700000000000;

function otpAt(ms) {
    const realNow = Date.now;
    Date.now = () => ms;
    try {
        return getOTP();
    } finally {
        Date.now = realNow;
    }
}

test("고정 시각/시크릿에서 past/now/future 값이 결정적이다 (골든 값)", () => {
    assert.deepEqual(otpAt(T0), {
        past: "886432",
        now: "374151",
        future: "462344",
    });
});

test("30초 간격으로 past/now/future가 한 칸씩 이동한다", () => {
    const a = otpAt(T0);
    const b = otpAt(T0 + 30_000);
    assert.equal(b.past, a.now);
    assert.equal(b.now, a.future);
});

test("6자리 숫자 문자열이다", () => {
    for (const v of Object.values(otpAt(T0))) {
        assert.match(v, /^[0-9]{6}$/);
    }
});

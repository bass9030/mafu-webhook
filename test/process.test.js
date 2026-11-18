// 프로세스 수준 동작: bin/www 시작/종료, 모듈 로드 부작용
// 자식 프로세스로 실행하므로 다른 테스트의 스텁이 적용되지 않음.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

// bin/www는 .env를 읽지만 dotenv는 이미 있는 환경 변수를 덮어쓰지 않으므로
// 외부로 나갈 수 있는 값은 여기서 모두 비우거나 로컬로 고정한다.
const SAFE_ENV = {
    PATH: process.env.PATH,
    NODE_ENV: "test", // production이 아니면 트윗 폴링 비활성
    PORT: "0",
    DEBUG: "mafu-webhook:server",
    SENTRY_ENDPOINT: "",
    DEBUG_WEBHOOK_URL: "",
    DB_HOST: "127.0.0.1",
    DB_USER: "test",
    DB_PASSWORD: "test",
    DB_NAME: "test",
    TWITTER_AUTH_TOKEN: "",
    TWITTER_CT0: "",
    GEMINI_API_KEY: "test",
    DEEPL_API_KEY: "",
};

function startServer() {
    const child = spawn(process.execPath, ["bin/www"], {
        cwd: ROOT,
        env: SAFE_ENV,
        stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const listening = new Promise((resolve, reject) => {
        const onData = (d) => {
            output += d;
            if (/Listening on port \d+/.test(output)) resolve();
        };
        child.stdout.on("data", onData);
        child.stderr.on("data", onData);
        child.once("exit", (code, signal) =>
            reject(new Error(`exited early: ${code} ${signal}\n${output}`)),
        );
    });
    const exited = new Promise((resolve) =>
        child.once("exit", (code, signal) => resolve({ code, signal })),
    );
    return { child, listening, exited, output: () => output };
}

for (const signal of ["SIGTERM", "SIGINT"]) {
    test(`bin/www: ${signal}를 받으면 DB 풀을 닫고 코드 0으로 종료`, async () => {
        const s = startServer();
        await s.listening;
        s.child.kill(signal);
        const result = await Promise.race([
            s.exited,
            new Promise((r) => setTimeout(() => r("timeout"), 10_000)),
        ]);
        if (result === "timeout") s.child.kill("SIGKILL");
        assert.deepEqual(result, { code: 0, signal: null }, s.output());
    });
}

test("utils/translator.js는 저장소 루트가 아닌 cwd에서도 로드됨", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mahook-cwd-"));
    try {
        const out = execFileSync(
            process.execPath,
            [
                "-e",
                `const t = require(${JSON.stringify(path.join(ROOT, "utils", "translator.js"))});` +
                    "console.log(typeof t);",
            ],
            { cwd, env: { PATH: process.env.PATH, GEMINI_API_KEY: "test" }, encoding: "utf-8" },
        );
        assert.equal(out.trim(), "function");
    } finally {
        fs.rmSync(cwd, { recursive: true, force: true });
    }
});

test("utils/webhookManager.js를 불러와도 종료 신호 핸들러를 등록하지 않음", () => {
    const out = execFileSync(
        process.execPath,
        [
            "-e",
            "const before = process.listenerCount('SIGTERM') + process.listenerCount('SIGINT');" +
                `require(${JSON.stringify(path.join(ROOT, "utils", "webhookManager.js"))});` +
                "const after = process.listenerCount('SIGTERM') + process.listenerCount('SIGINT');" +
                "console.log(after - before); process.exit(0);",
        ],
        { cwd: ROOT, env: SAFE_ENV, encoding: "utf-8" },
    );
    assert.equal(out.trim(), "0");
});

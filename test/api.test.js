// HTTP 라우트 (app.js, routes/*.js)
// 상태 코드, JSON 본문, 한국어 메시지를 그대로 고정한다.
// 오류 경로의 커넥션 반환 여부는 4단계에서 개선될 예정이라 여기서는 검사하지 않는다.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { installStubs, reset, state, flush, jsonResponse } = require("./helpers/stub");
const { tweet, timelineResponse, tweetEntry } = require("./helpers/tweets");

// app 내부 fetch(X API)는 스텁, 테스트 → 서버 요청은 실제 fetch 사용
const httpFetch = globalThis.fetch;

let translateImpl;
installStubs({ translator: async (t) => translateImpl(t) });

const NOTICE_TOKEN = "notice-secret";
process.env.NOTICE_TOKEN_KEY = crypto
    .createHash("sha512")
    .update(NOTICE_TOKEN)
    .digest("hex")
    .toUpperCase(); // 비교 시 toLowerCase() 처리되는지 확인용

const app = require("../app");
const getOTP = require("../utils/otpGenerator");

const LOGO = "https://mahook.bass9030.dev/logo.png";
const MSG_ROLE =
    "역할 ID가 올바르지 않습니다.\n역할 ID는 @everyone, @here 또는 숫자로된 역할 ID여야 합니다.";
const MSG_BAD_URL = "올바르지 않은 웹후크 URL 입니다.";
const MSG_DUP = "이미 등록된 웹후크 URL 입니다.";
const MSG_EDIT_404 = "웹후크를 찾을 수 없습니다. 올바른 웹후크 URL인지 확인해주세요.";
const MSG_UNREG_404 = "웹후크를 찾을 수 없습니다. 등록된 웹후크인지 확인해주세요.";
const HOOK_URL = "https://discord.com/api/webhooks/123456/tok_EN-.x";

let server;
let base;

before(async () => {
    server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

// getProfileURL 조회 실패로 기록되는 오류를 제외한 오류 목록
const NO_NET = "no network in test";
const appErrors = () => state.captured.filter((e) => e?.message !== NO_NET);

function resetAll() {
    reset();
    translateImpl = async (t) => `[KO]${t}`;
    // getProfileURL은 캐시가 비어 있으므로 조회 실패 → 로고 URL
    state.fetchHandler = () => {
        throw new Error(NO_NET);
    };
}

beforeEach(resetAll);

async function req(method, path, { json, form, headers = {} } = {}) {
    const init = { method, headers: { ...headers } };
    if (json !== undefined) {
        init.headers["content-type"] = "application/json";
        init.body = JSON.stringify(json);
    } else if (form !== undefined) {
        init.headers["content-type"] = "application/x-www-form-urlencoded";
        init.body = new URLSearchParams(form).toString();
    }
    const res = await httpFetch(base + path, init);
    const text = await res.text();
    let body = text;
    if ((res.headers.get("content-type") ?? "").includes("application/json")) {
        body = JSON.parse(text);
    }
    return { status: res.status, body, type: res.headers.get("content-type") ?? "" };
}

// ---------------------------------------------------------------- 페이지

test("정적 페이지 렌더링", async () => {
    for (const p of [
        "/",
        "/howto",
        "/howtoedit",
        "/howtoremove",
        "/opensource-license",
        "/api/wa-you-know-sans-wa-papyrus",
    ]) {
        const r = await req("GET", p);
        assert.equal(r.status, 200, p);
        assert.match(r.type, /text\/html/, p);
    }
});

test("없는 경로는 404 에러 페이지", async () => {
    const r = await req("GET", "/no-such-page");
    assert.equal(r.status, 404);
    assert.match(r.body, /<h1>404<\/h1>/);
    // development가 아니면 디버그 정보 없음
    assert.ok(!r.body.includes("디버그용 정보"));
});

// ---------------------------------------------------------------- /api/register

test("register: body 없음 → 400", async () => {
    const r = await req("POST", "/api/register");
    assert.equal(r.status, 400);
    assert.deepEqual(r.body, { status: 400 });
});

test("[현재 동작] register: body는 있지만 url이 없으면 500", async () => {
    const r = await req("POST", "/api/register", { json: { roleID: "@everyone" } });
    assert.equal(r.status, 500);
    assert.deepEqual(r.body, { status: 500 });
    assert.ok(appErrors()[0] instanceof TypeError);
});

test("register: 잘못된 roleID → 400", async () => {
    for (const roleID of ["abc", "", null, undefined]) {
        const r = await req("POST", "/api/register", { json: { url: HOOK_URL, roleID } });
        assert.equal(r.status, 400, String(roleID));
        assert.deepEqual(r.body, { status: 400, message: MSG_ROLE });
    }
    assert.equal(state.sent.length, 0);
});

test("register: 허용되는 roleID", async () => {
    for (const roleID of ["@everyone", "@here", "123", -1, "-1", "abc1" /* 현재 동작: 앵커 없음 */]) {
        const r = await req("POST", "/api/register", {
            json: { url: "https://example.com", roleID },
        });
        // roleID 검사는 통과하고 URL 검사에서 걸림
        assert.deepEqual(r.body, { status: 400, message: MSG_BAD_URL }, String(roleID));
    }
});

test("register: 잘못된 웹후크 URL → 400", async () => {
    for (const url of [
        "https://example.com/api/webhooks/1/a",
        "https://discord.com/api/webhooks/abc/tok",
        "discord.com/api/webhooks/1/",
    ]) {
        const r = await req("POST", "/api/register", { json: { url, roleID: -1 } });
        assert.equal(r.status, 400, url);
        assert.deepEqual(r.body, { status: 400, message: MSG_BAD_URL }, url);
    }
});

test("register: 성공 → 환영 메시지 전송 후 INSERT", async () => {
    state.queryHandler = () => ({ affectedRows: 1 });
    const r = await req("POST", "/api/register", {
        json: { url: HOOK_URL, roleID: "@everyone", options: 3 },
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { status: 200 });

    assert.deepEqual(state.webhookClients, [{ id: "123456", token: "tok_EN-.x" }]);
    assert.deepEqual(state.sent, [
        {
            id: "123456",
            token: "tok_EN-.x",
            payload: {
                content: "",
                username: "마훅 - 마후 트윗 번역봇",
                avatarURL: LOGO,
                embeds: [
                    {
                        title: "마훅 구독 완료!",
                        description:
                            "마훅 구독이 완료되었습니다!\n이제부터 마후마후 트윗을 한국어로 즐겨보세요!",
                        color: 0x1da1f2,
                    },
                ],
            },
        },
    ]);
    assert.deepEqual(state.queries, [
        {
            sql: "INSERT INTO webhooks (channelID, webhookToken, options, roleID) VALUES (?, ?, ?, ?);",
            params: ["123456", "tok_EN-.x", 3, "@everyone"],
        },
    ]);
    await flush();
    assert.equal(state.acquired, 1);
    assert.equal(state.released, 1);
});

test("[현재 동작] register: 프로필 URL 캐시가 비어 있으면 매 요청마다 X 조회 실패를 오류로 기록", async () => {
    state.queryHandler = () => ({ affectedRows: 1 });
    await req("POST", "/api/register", { json: { url: HOOK_URL, roleID: -1 } });
    assert.equal(state.fetchCalls.length, 1);
    assert.deepEqual(state.captured.map((e) => e.message), [NO_NET]);
});

test("register: discordapp.com 도메인도 허용", async () => {
    const r = await req("POST", "/api/register", {
        json: { url: "https://discordapp.com/api/webhooks/9/tk", roleID: -1, options: 0 },
    });
    assert.equal(r.status, 200);
    assert.deepEqual(state.queries[0].params, ["9", "tk", 0, -1]);
});

test("register: Discord가 웹후크를 찾지 못하면(10015 / 404) → 400, DB 접근 없음", async () => {
    for (const err of [{ code: 10015 }, { status: 404 }]) {
        resetAll();
        state.sendHandler = () => {
            throw Object.assign(new Error("Unknown Webhook"), err);
        };
        const r = await req("POST", "/api/register", { json: { url: HOOK_URL, roleID: -1 } });
        assert.equal(r.status, 400);
        assert.deepEqual(r.body, { status: 400, message: MSG_BAD_URL });
        assert.equal(state.acquired, 0);
        assert.equal(appErrors().length, 0);
    }
});

test("[현재 동작] register: 중복이면 환영 메시지가 나간 뒤 409", async () => {
    state.queryHandler = () => {
        throw Object.assign(new Error("Duplicate"), { errno: 1062 });
    };
    const r = await req("POST", "/api/register", { json: { url: HOOK_URL, roleID: -1 } });
    assert.equal(r.status, 409);
    assert.deepEqual(r.body, { status: 409, message: MSG_DUP });
    assert.equal(state.sent.length, 1);
    assert.equal(appErrors().length, 0);
});

test("register: 그 밖의 오류 → 500 + 오류 기록", async () => {
    const err = new Error("db down");
    state.queryHandler = () => {
        throw err;
    };
    const r = await req("POST", "/api/register", { json: { url: HOOK_URL, roleID: -1 } });
    assert.equal(r.status, 500);
    assert.deepEqual(r.body, { status: 500 });
    assert.deepEqual(appErrors(), [err]);
});

// ---------------------------------------------------------------- /api/edit

test("edit: body 없음 → 400", async () => {
    const r = await req("POST", "/api/edit");
    assert.equal(r.status, 400);
    assert.deepEqual(r.body, { status: 400 });
});

test("edit: 잘못된 roleID → 400", async () => {
    const r = await req("POST", "/api/edit", { json: { url: HOOK_URL, roleID: "abc" } });
    assert.equal(r.status, 400);
    assert.deepEqual(r.body, { status: 400, message: MSG_ROLE });
});

test("edit: 성공 → UPDATE", async () => {
    for (const roleID of ["@everyone", "@here", "123", -1, "-1"]) {
        resetAll();
        state.queryHandler = () => ({ affectedRows: 1 });
        const r = await req("POST", "/api/edit", { json: { url: HOOK_URL, roleID, options: 5 } });
        assert.equal(r.status, 200, String(roleID));
        assert.deepEqual(r.body, { status: 200 });
        assert.deepEqual(state.queries, [
            {
                sql: "UPDATE webhooks SET roleID = ?, options = ? WHERE channelID = ? AND webhookToken = ?;",
                params: [roleID, 5, "123456", "tok_EN-.x"],
            },
        ]);
        await flush();
        assert.equal(state.released, 1);
    }
    // edit은 URL 형식 검사 없이 split 결과를 그대로 사용, Discord 호출 없음
    assert.equal(state.sent.length, 0);
});

test("edit: 대상 없음 → 404", async () => {
    state.queryHandler = () => ({ affectedRows: 0 });
    const r = await req("POST", "/api/edit", { json: { url: HOOK_URL, roleID: -1 } });
    assert.equal(r.status, 404);
    assert.deepEqual(r.body, { status: 404, message: MSG_EDIT_404 });
});

test("[현재 동작] edit: url 없으면 500", async () => {
    const r = await req("POST", "/api/edit", { json: { roleID: -1 } });
    assert.equal(r.status, 500);
    assert.deepEqual(r.body, { status: 500 });
    assert.ok(state.captured[0] instanceof TypeError);
});

test("edit: DB 오류 → 500", async () => {
    state.queryHandler = () => {
        throw new Error("x");
    };
    const r = await req("POST", "/api/edit", { json: { url: HOOK_URL, roleID: -1 } });
    assert.equal(r.status, 500);
    assert.deepEqual(r.body, { status: 500 });
    assert.equal(state.captured.length, 1);
});

// ---------------------------------------------------------------- /api/unregister

test("unregister: url 쿼리 없음 → 400", async () => {
    const r = await req("DELETE", "/api/unregister");
    assert.equal(r.status, 400);
    assert.deepEqual(r.body, { status: 400 });
});

test("unregister: 성공 → DELETE", async () => {
    state.queryHandler = () => ({ affectedRows: 1 });
    const r = await req("DELETE", "/api/unregister?url=" + encodeURIComponent(HOOK_URL));
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { status: 200 });
    assert.deepEqual(state.queries, [
        {
            sql: "DELETE FROM webhooks WHERE channelID = ? AND webhookToken = ?;",
            params: ["123456", "tok_EN-.x"],
        },
    ]);
    assert.equal(state.released, 1);
});

test("unregister: 대상 없음 → 404", async () => {
    state.queryHandler = () => ({ affectedRows: 0 });
    const r = await req("DELETE", "/api/unregister?url=" + encodeURIComponent(HOOK_URL));
    assert.equal(r.status, 404);
    assert.deepEqual(r.body, { status: 404, message: MSG_UNREG_404 });
});

test("unregister: DB 오류 → 500", async () => {
    state.queryHandler = () => {
        throw new Error("x");
    };
    const r = await req("DELETE", "/api/unregister?url=" + encodeURIComponent(HOOK_URL));
    assert.equal(r.status, 500);
    assert.deepEqual(r.body, { status: 500 });
});

test("[현재 동작] unregister: '//'가 없는 url이면 HTML 500 에러 페이지", async () => {
    const r = await req("DELETE", "/api/unregister?url=abc");
    assert.equal(r.status, 500);
    assert.match(r.type, /text\/html/);
    assert.match(r.body, /<h1>500<\/h1>/);
    assert.equal(state.acquired, 0);
});

// ---------------------------------------------------------------- /api/getNotices

test("getNotices: 공지 목록", async () => {
    const rows = [{ date: "2026-01-01T00:00:00.000Z", title: "t", content: "c" }];
    state.queryHandler = () => rows;
    const r = await req("GET", "/api/getNotices");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { status: 200, data: rows });
    assert.equal(state.released, 1);
});

test("getNotices: 쿼리 오류는 빈 목록", async () => {
    state.queryHandler = () => {
        throw new Error("x");
    };
    const r = await req("GET", "/api/getNotices");
    assert.deepEqual(r.body, { status: 200, data: [] });
});

test("getNotices: 커넥션 획득 실패 → 500", async () => {
    state.getConnectionHandler = () => {
        throw new Error("pool");
    };
    const r = await req("GET", "/api/getNotices");
    assert.equal(r.status, 500);
    assert.deepEqual(r.body, { status: 500 });
    assert.equal(state.captured.length, 1);
});

// ---------------------------------------------------------------- /api/sendNoti

test("sendNoti: 필드 누락 → 400", async () => {
    for (const form of [
        { title: "t", "amazing-something": NOTICE_TOKEN },
        { content: "c", "amazing-something": NOTICE_TOKEN },
        { title: "t", content: "c" },
    ]) {
        const r = await req("POST", "/api/sendNoti", { form });
        assert.equal(r.status, 400);
        assert.deepEqual(r.body, { status: 400 });
    }
});

test("sendNoti: 토큰 불일치 → 403", async () => {
    const r = await req("POST", "/api/sendNoti", {
        form: { title: "t", content: "c", "amazing-something": "wrong" },
    });
    assert.equal(r.status, 403);
    assert.deepEqual(r.body, { status: 403 });
    assert.equal(state.queries.length, 0);
});

test("sendNoti: 성공 → 공지 저장, 텍스트 응답, 공지 수신 웹후크에 전송", async () => {
    state.queryHandler = (sql) =>
        sql.startsWith("SELECT")
            ? [{ channelID: "1", webhookToken: "t", options: 2, roleID: "-1" }]
            : {};
    const r = await req("POST", "/api/sendNoti", {
        form: { title: "공지 제목", content: "공지 내용", "amazing-something": NOTICE_TOKEN },
    });
    assert.equal(r.status, 200);
    assert.match(r.type, /text\/html/);
    assert.equal(r.body, "공지 전송 성공!");

    assert.equal(state.queries[0].sql, "INSERT INTO notices (date, title, content) VALUES (?, ?, ?);");
    assert.match(state.queries[0].params[0], /^\d{4}-\d{1,2}-\d{1,2} \d{1,2}:\d{1,2}:\d{1,2}$/);
    assert.deepEqual(state.queries[0].params.slice(1), ["공지 제목", "공지 내용"]);
    assert.deepEqual(state.queries[1], {
        sql: "SELECT * FROM webhooks WHERE options & ? = ?;",
        params: [2, 2],
    });
    await flush();
    assert.equal(state.sent.length, 1);
    assert.deepEqual(state.sent[0].payload.embeds[0].fields, [
        { name: "공지 제목", value: "공지 내용" },
    ]);
});

test("sendNoti: JSON body도 허용", async () => {
    state.queryHandler = (sql) => (sql.startsWith("SELECT") ? [] : {});
    const r = await req("POST", "/api/sendNoti", {
        json: { title: "t", content: "c", "amazing-something": NOTICE_TOKEN },
    });
    assert.equal(r.body, "공지 전송 성공!");
});

test("[현재 동작] sendNoti: NOTICE_TOKEN_KEY 미설정이면 500", async () => {
    const saved = process.env.NOTICE_TOKEN_KEY;
    delete process.env.NOTICE_TOKEN_KEY;
    try {
        const r = await req("POST", "/api/sendNoti", {
            form: { title: "t", content: "c", "amazing-something": NOTICE_TOKEN },
        });
        assert.equal(r.status, 500);
        assert.deepEqual(r.body, { status: 500 });
    } finally {
        process.env.NOTICE_TOKEN_KEY = saved;
    }
});

// ---------------------------------------------------------------- /api/testWebhook

test("testWebhook: development가 아니면 404 에러 페이지", async () => {
    const r = await req("GET", "/api/testWebhook");
    assert.equal(r.status, 404);
    assert.match(r.body, /<h1>404<\/h1>/);
    assert.equal(state.fetchCalls.length, 0);
});

test("testWebhook(development): 성공 / 실패", async () => {
    app.set("env", "development");
    try {
        state.fetchHandler = () =>
            jsonResponse(timelineResponse([tweetEntry(tweet({ id: "77" }))]));
        state.queryHandler = () => [{ channelID: "1", webhookToken: "t", options: 0, roleID: "-1" }];
        let r = await req("GET", "/api/testWebhook");
        assert.equal(r.status, 200);
        assert.equal(r.body, "웹훅 전송 성공");
        await flush();
        assert.equal(state.sent.length, 1);
        assert.equal(state.sent[0].payload.embeds[0].url, "https://x.com/uni_mafumafu/status/77");

        state.fetchHandler = () => {
            throw new Error("net");
        };
        r = await req("GET", "/api/testWebhook?id=1");
        assert.equal(r.status, 500);
        assert.ok(r.body.startsWith("<pre><code>ReferenceError"));
        assert.ok(r.body.endsWith("</code></pre>"));
    } finally {
        app.set("env", "test");
    }
});

// ---------------------------------------------------------------- /api/line-webhook

const LINE_UA = { "user-agent": "mahook-line/3.0" };

test("line-webhook: user-agent 불일치 → 404 에러 페이지", async () => {
    const r = await req("POST", "/api/line-webhook", {
        json: { content: "x", time: "1" },
        headers: { authorization: getOTP().now },
    });
    assert.equal(r.status, 404);
    assert.match(r.type, /text\/html/);
});

test("line-webhook: OTP 불일치 → 403", async () => {
    const r = await req("POST", "/api/line-webhook", {
        json: { content: "x", time: "1" },
        headers: { ...LINE_UA, authorization: "000000x" },
    });
    assert.equal(r.status, 403);
    assert.deepEqual(r.body, { status: 403 });
});

test("line-webhook: past/now/future OTP 모두 허용, 필드 누락 → 400", async () => {
    const otps = getOTP();
    for (const otp of [otps.past, otps.now, otps.future]) {
        const r = await req("POST", "/api/line-webhook", {
            json: { content: "x" },
            headers: { ...LINE_UA, authorization: otp },
        });
        assert.equal(r.status, 400);
        assert.deepEqual(r.body, { status: 400 });
    }
});

test("[현재 동작] line-webhook: 즉시 200 응답, 백그라운드 전송은 모든 수신자에서 실패", async () => {
    state.queryHandler = () => [
        { channelID: "1", webhookToken: "t", options: 4, roleID: "-1" },
        { channelID: "2", webhookToken: "t", options: 5, roleID: "@here" },
    ];
    const r = await req("POST", "/api/line-webhook", {
        json: { content: "こんにちは", time: "1700000000000" },
        headers: { ...LINE_UA, authorization: getOTP().now },
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { status: 200 });

    await flush();
    assert.deepEqual(state.queries, [
        { sql: "SELECT * FROM webhooks WHERE options & ? = ?;", params: [4, 4] },
    ]);
    assert.equal(state.sent.length, 0);
    assert.equal(state.captured.length, 2);
    assert.deepEqual(state.infoLogs, ["Webhook sended. \nTotal: 2 | Success: 0 | Fail: 2"]);
    assert.equal(state.acquired, 1);
    assert.equal(state.released, 1);
});

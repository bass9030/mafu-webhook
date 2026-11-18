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

// LINE 웹훅 서명 검증용 키 (검증기는 첫 요청 때 환경 변수로 생성된다)
const LINE_KEY_ID = "line-test-key";
const lineKeys = crypto.generateKeyPairSync("ed25519");
process.env.LINE_SIGNING_PUBLIC_KEY = lineKeys.publicKey
    .export({ format: "der", type: "spki" })
    .toString("base64");
process.env.LINE_SIGNING_KEY_ID = LINE_KEY_ID;

const app = require("../app");
const {
    createContentDigest,
    createLineSignatureBase,
} = require("../utils/lineSignature");

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

/**
 * Go 클라이언트(tools/line-webhook-client)와 같은 방식으로 서명한 헤더.
 * req()가 JSON.stringify(json)을 body로 보내므로 같은 바이트로 digest를 만든다.
 */
function lineHeaders(json, overrides = {}) {
    const body = Buffer.from(JSON.stringify(json));
    const timestamp = overrides.timestamp ?? String(Math.floor(Date.now() / 1000));
    const nonce = overrides.nonce ?? crypto.randomBytes(24).toString("base64url");
    const contentDigest = createContentDigest(body);
    const base = createLineSignatureBase(
        "POST",
        overrides.path ?? "/api/line-webhook",
        timestamp,
        nonce,
        contentDigest,
    );
    return {
        "content-digest": contentDigest,
        "x-key-id": overrides.keyId ?? LINE_KEY_ID,
        "x-timestamp": timestamp,
        "x-nonce": nonce,
        "x-signature": crypto
            .sign(null, Buffer.from(base), lineKeys.privateKey)
            .toString("base64"),
    };
}

test("line-webhook: 서명 헤더 누락 → 401", async () => {
    const json = { content: "x", time: 1 };
    const full = lineHeaders(json);
    for (const missing of Object.keys(full).filter((k) => k !== "x-key-id")) {
        const headers = { ...full };
        delete headers[missing];
        const r = await req("POST", "/api/line-webhook", { json, headers });
        assert.equal(r.status, 401, missing);
        assert.deepEqual(r.body, { status: 401 });
    }
    // JSON이 아니면 원본 body가 없으므로 401
    const r = await req("POST", "/api/line-webhook", { form: json, headers: full });
    assert.equal(r.status, 401);
});

test("line-webhook: 서명 검증 실패 → 401", async () => {
    const json = { content: "x", time: 1 };
    const cases = {
        "다른 키 ID": lineHeaders(json, { keyId: "unknown" }),
        "만료된 timestamp": lineHeaders(json, {
            timestamp: String(Math.floor(Date.now() / 1000) - 301),
        }),
        "다른 경로로 서명": lineHeaders(json, { path: "/api/other" }),
        "body 변조": lineHeaders({ content: "changed", time: 1 }),
        "서명 변조": { ...lineHeaders(json), "x-signature": "A".repeat(86) + "==" },
    };
    for (const [name, headers] of Object.entries(cases)) {
        const r = await req("POST", "/api/line-webhook", { json, headers });
        assert.equal(r.status, 401, name);
        assert.deepEqual(r.body, { status: 401 });
    }
    assert.deepEqual(state.sent, []);
});

test("line-webhook: 같은 nonce 재사용 → 401", async () => {
    const json = { content: "x" }; // 검증 통과 후 time 누락으로 400
    const headers = lineHeaders(json);
    assert.equal((await req("POST", "/api/line-webhook", { json, headers })).status, 400);
    assert.equal((await req("POST", "/api/line-webhook", { json, headers })).status, 401);
});

test("line-webhook: 서명은 유효하나 필드 누락 → 400", async () => {
    for (const json of [{ content: "x" }, { time: 1 }, { content: "", time: 1 }]) {
        const r = await req("POST", "/api/line-webhook", {
            json,
            headers: lineHeaders(json),
        });
        assert.equal(r.status, 400);
        assert.deepEqual(r.body, { status: 400 });
    }
});

test("line-webhook: 즉시 200 응답 후 LINE 수신 웹후크에 번역 embed 전송", async () => {
    state.queryHandler = () => [
        { channelID: "1", webhookToken: "t", options: 4, roleID: "-1" },
        { channelID: "2", webhookToken: "t", options: 5, roleID: "@here" },
    ];
    const r = await req("POST", "/api/line-webhook", {
        json: { content: "こんにちは", time: 1700000000000 },
        headers: lineHeaders({ content: "こんにちは", time: 1700000000000 }),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { status: 200 });

    await flush();
    assert.deepEqual(state.queries, [
        { sql: "SELECT * FROM webhooks WHERE options & ? = ?;", params: [4, 4] },
    ]);
    assert.deepEqual(state.captured, []);
    assert.deepEqual(state.infoLogs, ["Webhook sended. \nTotal: 2 | Success: 2 | Fail: 0"]);
    assert.deepEqual(state.sent.map((s) => [s.id, s.payload.content]), [
        ["1", ""], // 멘션 꺼짐
        ["2", "@here"],
    ]);
    const LINE_ICON =
        "https://profile.line-scdn.net/0hwr6BH-fyKF0LOwNQZWNXCjd-JjB8FS4Vc14yOixocmokW21eMVo3b34-cTp2X2sOMgpmM35ocGVy/preview";
    for (const s of state.sent) {
        assert.equal(s.payload.username, "마훅 - 마후 트윗 번역봇");
        assert.equal(s.payload.avatarURL, LINE_ICON);
        assert.deepEqual(s.payload.embeds, [
            {
                title: "New LINE Release!",
                url: "https://line.me/R/ti/p/@uni_mafumafu",
                footer: { text: "https://line.me/R/ti/p/@uni_mafumafu", icon_url: LINE_ICON },
                timestamp: "2023-11-14T22:13:20.000Z",
                description: "[KO]こんにちは",
                color: 0x06c755,
            },
        ]);
    }
    assert.equal(state.acquired, 1);
    assert.equal(state.released, 1);
});

// ---------------------------------------------------------------- 커넥션 관리 (4단계)
// 응답은 위 테스트들로 고정하고, 여기서는 커넥션 획득/반환 수지만 검사한다.

async function connBalance(method, path, opts, setup) {
    resetAll();
    setup?.();
    const r = await req(method, path, opts);
    await flush();
    return { r, acquired: state.acquired, released: state.released };
}

test("오류 경로에서도 커넥션을 반환", async () => {
    const throwing = (err) => () => {
        state.queryHandler = () => {
            throw err;
        };
    };
    const cases = [
        ["POST", "/api/register", { json: { url: HOOK_URL, roleID: -1 } }, throwing(Object.assign(new Error("dup"), { errno: 1062 })), 409],
        ["POST", "/api/register", { json: { url: HOOK_URL, roleID: -1 } }, throwing(new Error("db")), 500],
        ["POST", "/api/edit", { json: { url: HOOK_URL, roleID: -1 } }, () => (state.queryHandler = () => ({ affectedRows: 0 })), 404],
        ["POST", "/api/edit", { json: { url: HOOK_URL, roleID: -1 } }, throwing(new Error("db")), 500],
        ["DELETE", "/api/unregister?url=" + encodeURIComponent(HOOK_URL), {}, () => (state.queryHandler = () => ({ affectedRows: 0 })), 404],
        ["DELETE", "/api/unregister?url=" + encodeURIComponent(HOOK_URL), {}, throwing(new Error("db")), 500],
        ["POST", "/api/sendNoti", { form: { title: "t", content: "c", "amazing-something": NOTICE_TOKEN } }, throwing(new Error("db")), 500],
    ];
    for (const [method, path, opts, setup, status] of cases) {
        const { r, acquired, released } = await connBalance(method, path, opts, setup);
        assert.equal(r.status, status, `${method} ${path}`);
        assert.equal(acquired, 1, `${method} ${path}`);
        assert.equal(released, 1, `${method} ${path}`);
    }
});

test("커넥션 획득 전에 끝나는 경로는 커넥션을 쓰지 않음", async () => {
    const cases = [
        // Discord가 웹후크를 찾지 못함
        ["POST", "/api/register", { json: { url: HOOK_URL, roleID: -1 } }, () => (state.sendHandler = () => { throw Object.assign(new Error("x"), { code: 10015 }); })],
        // 커넥션 획득 실패
        ["GET", "/api/getNotices", {}, () => (state.getConnectionHandler = () => { throw new Error("pool"); })],
        ["POST", "/api/register", { json: { url: HOOK_URL, roleID: -1 } }, () => (state.getConnectionHandler = () => { throw new Error("pool"); })],
    ];
    for (const [method, path, opts, setup] of cases) {
        const { acquired, released } = await connBalance(method, path, opts, setup);
        assert.equal(acquired, 0);
        assert.equal(released, 0);
    }
});

test("동시 요청이 서로의 커넥션을 덮어쓰지 않음", async () => {
    // 두 요청이 모두 커넥션을 받은 뒤에야 진행되도록 대기
    let waiting = [];
    state.getConnectionHandler = () =>
        new Promise((resolve) => {
            waiting.push(resolve);
            if (waiting.length === 2) waiting.forEach((r) => r());
        });
    state.queryHandler = () => ({ affectedRows: 1 });
    const [a, b] = await Promise.all([
        req("POST", "/api/edit", { json: { url: HOOK_URL, roleID: -1, options: 1 } }),
        req("POST", "/api/edit", { json: { url: HOOK_URL, roleID: -1, options: 2 } }),
    ]);
    await flush();
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(state.acquired, 2);
    assert.deepEqual([...state.releasedConns].sort(), [1, 2]);
});

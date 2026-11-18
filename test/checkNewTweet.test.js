// 새 트윗 감지/전송 파이프라인 (utils/getTweet.js checkNewTweet, sendRecentTweet)
// checkNewTweet은 모듈 전역 prevLastTweetID에 의존하므로 테스트가 선언 순서대로 이어지는 시나리오임.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { installStubs, reset, state, jsonResponse, flush } = require("./helpers/stub");
const { tweet, timelineResponse, tweetEntry } = require("./helpers/tweets");

let translateImpl;
installStubs({ translator: async (t) => translateImpl(t) });
const { checkNewTweet, sendRecentTweet } = require("../utils/getTweet");

const ROWS = [
    { channelID: "1", webhookToken: "t1", options: 0, roleID: "-1" },
    { channelID: "2", webhookToken: "t2", options: 1, roleID: "@everyone" },
];

let db;
beforeEach(() => {
    reset();
    translateImpl = async (t) => `[KO]${t}`;
    db = { lastTweet: [], count: 2n, rows: ROWS };
    state.queryHandler = (sql) => {
        if (sql === "SELECT * FROM lastTweet;") return db.lastTweet;
        if (sql.startsWith("REPLACE INTO lastTweet")) return {};
        if (sql === "SELECT COUNT(*) FROM webhooks;") return [{ "COUNT(*)": db.count }];
        if (sql === "SELECT * FROM webhooks;") return db.rows;
        throw new Error("unexpected query: " + sql);
    };
});

function timeline(...ids) {
    state.fetchHandler = () =>
        jsonResponse(timelineResponse(ids.map((id) => tweetEntry(tweet({ id: String(id) })))));
}

const sentStatusIds = () =>
    state.sent.map((s) => [s.id, s.payload.embeds[0].url.split("/").pop()]);

test("초기 상태: lastTweet이 없으면 0으로 저장, 새 트윗 감지 후 웹후크가 0개면 전송 생략", async () => {
    db.count = 0n;
    timeline(30, 20, 10);
    await checkNewTweet();

    assert.deepEqual(state.queries, [
        { sql: "SELECT * FROM lastTweet;", params: undefined },
        { sql: "REPLACE INTO lastTweet (key_str, id) VALUES (?, ?);", params: ["tweetID", 0] },
        { sql: "REPLACE INTO lastTweet (key_str, id) VALUES (?, ?);", params: ["tweetID", "30"] },
        { sql: "SELECT COUNT(*) FROM webhooks;", params: undefined },
    ]);
    assert.deepEqual(state.infoLogs, ["3 new tweet detect"]);
    assert.equal(state.sent.length, 0);
    assert.equal(state.acquired, 1);
    assert.equal(state.released, 1);

    const vars = JSON.parse(new URL(state.fetchCalls[0].url).searchParams.get("variables"));
    assert.equal(vars.userId, 268758461);
});

test("새 트윗만 오래된 순으로 모든 웹후크에 전송하고 lastTweet 갱신", async () => {
    timeline(50, 40, 30);
    await checkNewTweet();

    assert.deepEqual(state.queries.map((q) => [q.sql, q.params]), [
        ["REPLACE INTO lastTweet (key_str, id) VALUES (?, ?);", ["tweetID", "50"]],
        ["SELECT COUNT(*) FROM webhooks;", undefined],
        ["SELECT * FROM webhooks;", undefined],
        ["SELECT * FROM webhooks;", undefined],
    ]);
    assert.deepEqual(sentStatusIds(), [
        ["1", "40"],
        ["2", "40"],
        ["1", "50"],
        ["2", "50"],
    ]);
    assert.deepEqual(state.sent.map((s) => s.payload.content), ["", "@everyone", "", "@everyone"]);
    assert.deepEqual(state.infoLogs, [
        "2 new tweet detect",
        "Webhook sended. \nTotal: 2 | Success: 2 | Fail: 0",
        "Webhook sended. \nTotal: 2 | Success: 2 | Fail: 0",
    ]);
    assert.equal(state.acquired, 1);
    assert.equal(state.released, 1);
});

test("새 트윗이 없으면 아무것도 하지 않음", async () => {
    timeline(50, 40, 30);
    await checkNewTweet();
    assert.deepEqual(state.queries, []);
    assert.equal(state.sent.length, 0);
    assert.deepEqual(state.infoLogs, []);
    assert.equal(state.released, 1);
});

test("트윗 하나의 embed 생성이 실패해도 나머지는 계속 전송", async () => {
    const err = new Error("translate fail");
    translateImpl = async (t) => {
        if (t === "text-60") throw err;
        return `[KO]${t}`;
    };
    timeline(70, 60, 50);
    await checkNewTweet();
    assert.deepEqual(state.captured, [err]);
    assert.deepEqual(sentStatusIds(), [
        ["1", "70"],
        ["2", "70"],
    ]);
    assert.deepEqual(state.queries[0].params, ["tweetID", "70"]);
});

test("타임라인 조회 실패는 삼키고 커넥션 반환, lastTweet 유지", async () => {
    state.fetchHandler = () => jsonResponse("", { ok: false, status: 429, statusText: "Too Many Requests" });
    await checkNewTweet(); // throw 하지 않음
    assert.ok(state.captured.at(-1) instanceof ReferenceError);
    // sendResponseDataLog(JSON.stringify(undefined))
    assert.equal(state.debugLogs.at(-1), undefined);
    assert.deepEqual(state.queries, []);
    assert.equal(state.acquired, 1);
    assert.equal(state.released, 1);

    // 이전 lastTweet(70) 기준이 유지됨
    reset();
    db.count = 2n;
    state.queryHandler = (sql) => (sql.startsWith("SELECT * FROM webhooks") ? ROWS : sql.startsWith("SELECT COUNT") ? [{ "COUNT(*)": 2n }] : {});
    timeline(80, 70);
    await checkNewTweet();
    assert.deepEqual(state.infoLogs[0], "1 new tweet detect");
});

test("타임라인이 비어 있으면 오류를 기록하고 넘어감", async () => {
    timeline();
    await checkNewTweet();
    assert.ok(state.captured.at(-1) instanceof TypeError);
    assert.equal(state.debugLogs.at(-1), "[]");
    assert.equal(state.released, 1);
});

test("sendRecentTweet(): 가장 최근 트윗을 TWITTER 타입으로 전송 (전송은 await 하지 않음)", async () => {
    timeline(90, 80);
    await sendRecentTweet();
    await flush();
    assert.deepEqual(state.queries.map((q) => q.sql), ["SELECT * FROM webhooks;"]);
    assert.deepEqual(sentStatusIds(), [
        ["1", "90"],
        ["2", "90"],
    ]);
});

test("sendRecentTweet(id): 지정한 rest_id의 트윗 전송", async () => {
    timeline(90, 80);
    await sendRecentTweet("80");
    await flush();
    assert.deepEqual(sentStatusIds(), [
        ["1", "80"],
        ["2", "80"],
    ]);
});

test("sendRecentTweet(id): 없는 id면 TypeError", async () => {
    timeline(90, 80);
    await assert.rejects(sendRecentTweet("1"), TypeError);
    assert.equal(state.sent.length, 0);
});

test("sendRecentTweet: 타임라인 조회 실패는 그대로 전파", async () => {
    state.fetchHandler = () => {
        throw new Error("net");
    };
    await assert.rejects(sendRecentTweet(), { name: "ReferenceError" });
    assert.equal(state.acquired, 0);
});

test("[현재 동작] lastTweet 저장(setLastTweetID)을 기다리지 않고 전송을 진행", async () => {
    // 직전 테스트들까지의 상태: prevLastTweetID = 80
    let resolveReplace;
    const base = state.queryHandler;
    state.queryHandler = (sql, params) => {
        if (sql.startsWith("REPLACE INTO lastTweet")) {
            return new Promise((r) => (resolveReplace = () => r({})));
        }
        return base(sql, params);
    };
    timeline(100, 90, 80);
    const running = checkNewTweet();
    await flush();
    // REPLACE가 끝나지 않았는데도 전송 완료
    assert.deepEqual(sentStatusIds(), [
        ["1", "90"],
        ["2", "90"],
        ["1", "100"],
        ["2", "100"],
    ]);
    resolveReplace();
    await running;
});

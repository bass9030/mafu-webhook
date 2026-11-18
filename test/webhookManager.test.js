const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { installStubs, reset, state, flush } = require("./helpers/stub");
const { matchSnapshot } = require("./helpers/snapshot");

installStubs();
const { EmbedBuilder } = require("discord.js");
const {
    WebhookManager,
    WebhookNotFoundError,
    WEBHOOK_TYPE,
} = require("../utils/webhookManager");

const LOGO = "https://mahook.bass9030.dev/logo.png";
const USERNAME = "마훅 - 마후 트윗 번역봇";

beforeEach(() => reset());

async function connected() {
    const m = new WebhookManager();
    await m.getConnection();
    return m;
}

test("WEBHOOK_TYPE 값", () => {
    assert.deepEqual(WEBHOOK_TYPE, { TWITTER: 0, NOTI: 2, LINE: 4 });
});

test("getOptions / setOptions: 비트 0=멘션, 1=공지, 2=LINE", () => {
    assert.equal(WebhookManager.setOptions(false, false, false), 0);
    assert.equal(WebhookManager.setOptions(false, false, true), 1);
    assert.equal(WebhookManager.setOptions(false, true, false), 2);
    assert.equal(WebhookManager.setOptions(true, false, false), 4);
    assert.equal(WebhookManager.setOptions(true, true, true), 7);
    for (let n = 0; n < 8; n++) {
        const o = WebhookManager.getOptions(n);
        assert.deepEqual(o, {
            isLINESend: !!(n & 4),
            isNotiSend: !!(n & 2),
            isMention: !!(n & 1),
        });
        assert.equal(
            WebhookManager.setOptions(o.isLINESend, o.isNotiSend, o.isMention),
            n,
        );
    }
});

test("getConnection / releaseConnection", async () => {
    const m = await connected();
    assert.equal(state.acquired, 1);
    await m.releaseConnection();
    assert.equal(state.released, 1);
    assert.equal(m.db, null);
    // 이미 해제된 상태에서 다시 호출해도 release 하지 않음
    await m.releaseConnection();
    assert.equal(state.released, 1);
});

test("setLastTweetID / getLastTweetID", async () => {
    const m = await connected();
    await m.setLastTweetID("123");
    assert.deepEqual(state.queries[0], {
        sql: "REPLACE INTO lastTweet (key_str, id) VALUES (?, ?);",
        params: ["tweetID", "123"],
    });

    state.queryHandler = () => [{ key_str: "tweetID", id: 456n }];
    assert.equal(await m.getLastTweetID(), 456n);
    assert.equal(state.queries[1].sql, "SELECT * FROM lastTweet;");

    // 행이 없으면 null
    state.queryHandler = () => [];
    assert.equal(await m.getLastTweetID(), null);

    // 쿼리 오류도 null
    state.queryHandler = () => {
        throw new Error("db down");
    };
    assert.equal(await m.getLastTweetID(), null);
});

test("addWebhook", async () => {
    const m = await connected();
    await m.addWebhook("111", "tok", 3, "@everyone");
    assert.deepEqual(state.queries[0], {
        sql: "INSERT INTO webhooks (channelID, webhookToken, options, roleID) VALUES (?, ?, ?, ?);",
        params: ["111", "tok", 3, "@everyone"],
    });
});

test("addWebhook: DB 오류는 그대로 전파", async () => {
    const m = await connected();
    const err = Object.assign(new Error("dup"), { errno: 1062 });
    state.queryHandler = () => {
        throw err;
    };
    await assert.rejects(m.addWebhook("1", "t", 0, -1), err);
});

test("removeWebhook", async () => {
    const m = await connected();
    state.queryHandler = () => ({ affectedRows: 1 });
    await m.removeWebhook("111", "tok");
    assert.deepEqual(state.queries[0], {
        sql: "DELETE FROM webhooks WHERE channelID = ? AND webhookToken = ?;",
        params: ["111", "tok"],
    });

    state.queryHandler = () => ({ affectedRows: 0 });
    await assert.rejects(m.removeWebhook("111", "tok"), WebhookNotFoundError);
});

test("editWebhook", async () => {
    const m = await connected();
    state.queryHandler = () => ({ affectedRows: 1 });
    await m.editWebhook("111", "tok", 5, "999");
    assert.deepEqual(state.queries[0], {
        sql: "UPDATE webhooks SET roleID = ?, options = ? WHERE channelID = ? AND webhookToken = ?;",
        params: ["999", 5, "111", "tok"],
    });

    state.queryHandler = () => ({ affectedRows: 0 });
    await assert.rejects(m.editWebhook("1", "t", 0, -1), WebhookNotFoundError);
});

test("WebhookNotFoundError", () => {
    const e = new WebhookNotFoundError();
    assert.ok(e instanceof Error);
    assert.equal(e.name, "WebhookNotFoundError");
});

test("getWebhookCount", async () => {
    const m = await connected();
    state.queryHandler = () => [{ "COUNT(*)": 3n }];
    assert.equal(await m.getWebhookCount(), 3n);
    assert.equal(state.queries[0].sql, "SELECT COUNT(*) FROM webhooks;");
});

test("getNotices: 결과 그대로 반환, 오류 시 []", async () => {
    const m = await connected();
    const rows = [{ date: "d", title: "t", content: "c" }];
    state.queryHandler = () => rows;
    assert.equal(await m.getNotices(), rows);
    assert.equal(
        state.queries[0].sql,
        "SELECT date, title, content FROM notices ORDER BY date DESC LIMIT 10",
    );

    state.queryHandler = () => {
        throw new Error("x");
    };
    assert.deepEqual(await m.getNotices(), []);
});

const ROWS = [
    { channelID: "1", webhookToken: "t1", options: 0, roleID: "@everyone" }, // 멘션 꺼짐
    { channelID: "2", webhookToken: "t2", options: 1, roleID: "-1" }, // 멘션 켜짐 + 역할 없음
    { channelID: "3", webhookToken: "t3", options: 3, roleID: "@everyone" },
    { channelID: "4", webhookToken: "t4", options: 7, roleID: "@here" },
    { channelID: "5", webhookToken: "t5", options: 1, roleID: "12345" },
];

function twitterEmbeds() {
    return [
        new EmbedBuilder()
            .setTitle("New Tweet Release!")
            .setAuthor({ name: "author", iconURL: "https://icon/author.png" })
            .setFooter({ text: "footer", iconURL: "https://icon/footer.png" }),
        new EmbedBuilder().setImage("https://img/2.jpg"),
    ];
}

test("sendWebhook(TWITTER): 전체 웹후크 조회, 멘션 계산, author 아이콘을 avatar로 사용", async () => {
    const m = await connected();
    state.queryHandler = () => ROWS;
    const embeds = twitterEmbeds();
    await m.sendWebhook(embeds);

    assert.deepEqual(state.queries, [{ sql: "SELECT * FROM webhooks;", params: undefined }]);
    assert.deepEqual(
        state.sent.map((s) => [s.id, s.token, s.payload.content]),
        [
            ["1", "t1", ""],
            ["2", "t2", ""],
            ["3", "t3", "@everyone"],
            ["4", "t4", "@here"],
            ["5", "t5", "<@&12345>"],
        ],
    );
    for (const s of state.sent) {
        assert.equal(s.payload.avatarURL, "https://icon/author.png");
        assert.equal(s.payload.username, USERNAME);
        assert.deepEqual(s.payload.embeds, embeds.map((e) => e.toJSON()));
    }
    assert.deepEqual(state.infoLogs, [
        "Webhook sended. \nTotal: 5 | Success: 5 | Fail: 0",
    ]);
});

test("sendWebhook: 기본 type은 TWITTER", async () => {
    const m = await connected();
    await m.sendWebhook(twitterEmbeds(), WEBHOOK_TYPE.TWITTER);
    await m.sendWebhook(twitterEmbeds());
    assert.equal(state.queries[0].sql, state.queries[1].sql);
});

test("sendWebhook: 수신자 중 일부 실패해도 나머지는 전송, 실패 수 집계", async () => {
    const m = await connected();
    state.queryHandler = () => ROWS.slice(0, 3);
    const err = new Error("discord fail");
    state.sendHandler = (c) => {
        if (c.id === "2") throw err;
    };
    await m.sendWebhook(twitterEmbeds());
    assert.deepEqual(state.sent.map((s) => s.id), ["1", "3"]);
    assert.deepEqual(state.captured, [err]);
    assert.deepEqual(state.infoLogs, [
        "Webhook sended. \nTotal: 3 | Success: 2 | Fail: 1",
    ]);
});

test("sendWebhook(NOTI): 공지 수신 비트로 조회, 공지 embed 생성", async () => {
    const m = await connected();
    state.queryHandler = () => [ROWS[2], ROWS[3]];
    await m.sendWebhook({ title: "제목", content: "내용" }, WEBHOOK_TYPE.NOTI);

    assert.deepEqual(state.queries, [
        { sql: "SELECT * FROM webhooks WHERE options & ? = ?;", params: [2, 2] },
    ]);
    assert.equal(state.sent.length, 2);
    for (const s of state.sent) {
        assert.equal(s.payload.avatarURL, LOGO);
        assert.equal(s.payload.username, USERNAME);
    }
    assert.deepEqual(state.sent.map((s) => s.payload.content), ["@everyone", "@here"]);
    matchSnapshot("webhookManager.noti-embed", state.sent[0].payload.embeds);
});

test("sendWebhook(LINE): LINE 수신 비트로 조회, footer 아이콘(LINE 프로필)을 avatar로 사용", async () => {
    const m = await connected();
    state.queryHandler = () => [ROWS[3]];
    await m.sendWebhook(twitterEmbeds(), WEBHOOK_TYPE.LINE);
    assert.deepEqual(state.queries[0].params, [4, 4]);
    assert.equal(state.sent.length, 1);
    assert.equal(state.sent[0].payload.avatarURL, "https://icon/footer.png");
});

test("[현재 동작] sendWebhook(LINE)에 배열이 아닌 EmbedBuilder 하나를 주면 모든 수신자에서 실패", async () => {
    const m = await connected();
    state.queryHandler = () => [ROWS[3], ROWS[4]];
    await m.sendWebhook(new EmbedBuilder().setTitle("x"), WEBHOOK_TYPE.LINE);
    assert.equal(state.sent.length, 0);
    assert.equal(state.captured.length, 2);
    assert.ok(state.captured.every((e) => e instanceof TypeError));
    assert.deepEqual(state.infoLogs, [
        "Webhook sended. \nTotal: 2 | Success: 0 | Fail: 2",
    ]);
});

test("sendNotice: notices INSERT 후 공지 전송 (전송은 await 하지 않음)", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-03-04T05:06:07Z") });
    const m = await connected();
    state.queryHandler = (sql) => (sql.startsWith("SELECT") ? [ROWS[2]] : {});
    await m.sendNotice("제목", "내용");
    t.mock.timers.reset();

    assert.deepEqual(state.queries[0], {
        sql: "INSERT INTO notices (date, title, content) VALUES (?, ?, ?);",
        params: ["2026-3-4 5:6:7", "제목", "내용"],
    });
    // sendNotice가 끝난 시점에 조회 쿼리는 이미 발행됨
    assert.deepEqual(state.queries[1], {
        sql: "SELECT * FROM webhooks WHERE options & ? = ?;",
        params: [2, 2],
    });
    await flush();
    assert.equal(state.sent.length, 1);
    assert.equal(state.sent[0].payload.embeds[0].fields[0].name, "제목");
});

test("withConnection: 성공 시 결과 반환 후 커넥션 반환", async () => {
    let inside;
    const result = await WebhookManager.withConnection(async (m) => {
        inside = m;
        assert.ok(m instanceof WebhookManager);
        assert.ok(m.db);
        assert.equal(state.released, 0);
        return 42;
    });
    assert.equal(result, 42);
    assert.equal(state.acquired, 1);
    assert.deepEqual(state.releasedConns, [1]);
    assert.equal(inside.db, null);
});

test("withConnection: fn 오류 시 커넥션 반환 후 오류 전파", async () => {
    const err = new Error("x");
    await assert.rejects(
        WebhookManager.withConnection(async () => {
            throw err;
        }),
        err,
    );
    assert.equal(state.released, 1);
});

test("withConnection: 커넥션 획득 실패 시 fn을 실행하지 않음", async () => {
    const err = new Error("pool");
    state.getConnectionHandler = () => {
        throw err;
    };
    let called = false;
    await assert.rejects(
        WebhookManager.withConnection(async () => {
            called = true;
        }),
        err,
    );
    assert.equal(called, false);
    assert.equal(state.released, 0);
});

test("withConnection: 호출마다 별도 인스턴스/커넥션", async () => {
    const managers = await Promise.all([
        WebhookManager.withConnection(async (m) => m),
        WebhookManager.withConnection(async (m) => m),
    ]);
    assert.notEqual(managers[0], managers[1]);
    assert.deepEqual([...state.releasedConns].sort(), [1, 2]);
});

test("[현재 동작] sendWebhook: 알 수 없는 type이면 비트 마스크로 조회하고, 전송 없이 성공으로 집계", async () => {
    const m = await connected();
    state.queryHandler = () => [ROWS[0], ROWS[1]];
    await m.sendWebhook(twitterEmbeds(), 1);
    assert.deepEqual(state.queries[0].params, [1, 1]);
    assert.equal(state.sent.length, 0);
    assert.equal(state.webhookClients.length, 2);
    assert.deepEqual(state.infoLogs, [
        "Webhook sended. \nTotal: 2 | Success: 2 | Fail: 0",
    ]);
});

test("[현재 동작] sendWebhook: 멘션 켜짐 + roleID가 null/숫자 -1이면", async () => {
    const m = await connected();
    state.queryHandler = () => [
        { channelID: "1", webhookToken: "t", options: 1, roleID: null },
        { channelID: "2", webhookToken: "t", options: 1, roleID: -1 },
    ];
    await m.sendWebhook(twitterEmbeds());
    assert.deepEqual(state.sent.map((s) => s.payload.content), ["<@&null>", ""]);
});

test("[현재 동작] sendWebhook: options가 null이면 해당 수신자만 실패", async () => {
    const m = await connected();
    state.queryHandler = () => [
        { channelID: "9", webhookToken: "t", options: null, roleID: "-1" },
        ROWS[0],
    ];
    await m.sendWebhook(twitterEmbeds());
    assert.deepEqual(state.sent.map((s) => s.id), ["1"]);
    assert.equal(state.captured.length, 1);
    assert.ok(state.captured[0] instanceof TypeError);
    // 클라이언트는 옵션 해석 전에 생성됨
    assert.equal(state.webhookClients.length, 2);
});

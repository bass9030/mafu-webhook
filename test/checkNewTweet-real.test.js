// 실제 X 응답(test/fixtures/UserTweetsAndReplies.json)으로 checkNewTweet 전체 흐름 확인
// (checkNewTweet.test.js와 모듈 상태를 공유하지 않도록 파일 분리)
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { installStubs, state, jsonResponse } = require("./helpers/stub");

const translated = [];
installStubs({
    translator: async (t) => {
        translated.push(t);
        return `[KO]${t}`;
    },
});
const { checkNewTweet } = require("../utils/getTweet");
const realTimeline = require("./fixtures/UserTweetsAndReplies.json");

test("대화 묶음이 섞인 실제 응답에서도 새 트윗을 오래된 순으로 전송", async () => {
    const LAST = "2116038835704655885";
    state.fetchHandler = () => jsonResponse(realTimeline);
    state.queryHandler = (sql) => {
        if (sql === "SELECT * FROM lastTweet;") return [{ key_str: "tweetID", id: BigInt(LAST) }];
        if (sql.startsWith("REPLACE INTO lastTweet")) return {};
        if (sql === "SELECT COUNT(*) FROM webhooks;") return [{ "COUNT(*)": 1n }];
        if (sql === "SELECT * FROM webhooks;")
            return [{ channelID: "1", webhookToken: "t", options: 0, roleID: "-1" }];
        throw new Error("unexpected query: " + sql);
    };

    await checkNewTweet();

    assert.deepEqual(state.captured, []);
    assert.deepEqual(state.infoLogs[0], "9 new tweet detect");
    assert.deepEqual(
        state.sent.map((s) => s.payload.embeds[0].url.split("/").pop()),
        [
            "2116475117865943390",
            "2117186256375586949", // 대화 묶음(자기 타래) 원글
            "2117599140662448305",
            "2117937235647709349", // 대화 묶음(자기 타래) 답글
            "2118307031992226201",
            "2118312539243397442",
            "2119366392671834522",
            "2120123773789880449",
            "2120450976679358725",
        ],
    );
    // 자기 답글은 답글 접두사가 붙음
    const reply = state.sent[3].payload.embeds[0];
    assert.ok(reply.description.startsWith("↩ [@uni_mafumafu](https://x.com/uni_mafumafu/status/"));
    // 웹후크 avatar는 로고가 아니라 마후마후 프로필 이미지 (embed author 아이콘)
    for (const s of state.sent) {
        assert.equal(s.payload.avatarURL, s.payload.embeds[0].author.icon_url);
        assert.match(s.payload.avatarURL, /^https:\/\/pbs\.twimg\.com\/profile_images\//);
    }
    // 모든 embed 작성자가 마후마후
    assert.ok(state.sent.every((s) => s.payload.embeds[0].author.name.endsWith("(@uni_mafumafu)")));
    assert.deepEqual(state.queries.find((q) => q.sql.startsWith("REPLACE")).params, [
        "tweetID",
        "2120450976679358725",
    ]);
    assert.equal(state.released, 1);
});

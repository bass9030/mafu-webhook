// X 타임라인 조회/파싱 (utils/getTweet.js getTimelineByUserID)
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { installStubs, reset, state, jsonResponse } = require("./helpers/stub");
const { tweet, timelineResponse, tweetEntry } = require("./helpers/tweets");

installStubs({ translator: async (t) => t });
const { getTimelineByUserID } = require("../utils/getTweet");
const { default_variables, default_features } = require("../utils/twitterFeatures");
const realTimeline = require("./fixtures/UserTweetsAndReplies.json");

beforeEach(() => reset());

function respond(entries) {
    state.fetchHandler = () => jsonResponse(timelineResponse(entries));
}

test("요청 URL, 헤더", async () => {
    respond([]);
    await getTimelineByUserID(268758461, 5);

    const { url, init } = state.fetchCalls[0];
    const u = new URL(url);
    assert.equal(
        u.origin + u.pathname,
        "https://x.com/i/api/graphql/FmuxExUC21Xn_C2NwtX5sQ/UserTweetsAndReplies",
    );
    assert.deepEqual(JSON.parse(u.searchParams.get("variables")), {
        ...default_variables,
        userId: 268758461,
        count: 5,
    });
    assert.deepEqual(JSON.parse(u.searchParams.get("features")), default_features);
    assert.equal(init.method, "GET");
    assert.deepEqual(init.headers, {
        referer: "https://x.com/",
        cookie: "auth_token=test-auth-token; ct0=test-ct0;",
        authorization:
            "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
        "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
        "x-csrf-token": "test-ct0",
        "x-twitter-active-user": "yes",
        "x-twitter-client-language": "en",
        "x-client-transaction-id": "test-transaction-id",
    });
});

test("[현재 동작] Object.assign이 공유 default_variables를 변경함", async () => {
    respond([]);
    await getTimelineByUserID(268758461, 7);
    assert.equal(default_variables.count, 7);
    await getTimelineByUserID(268758461);
    assert.ok("count" in default_variables);
    assert.equal(default_variables.count, undefined);
    const vars = JSON.parse(
        new URL(state.fetchCalls[1].url).searchParams.get("variables"),
    );
    assert.ok(!("count" in vars));
});

test("마후마후 트윗만 남기고, tweet-* 이외 엔트리는 무시하고, ID 내림차순 정렬", async () => {
    respond([
        tweetEntry(tweet({ id: "1999999999999999999" })),
        tweetEntry(tweet({ id: "3000000000000000000", screenName: "someone_else" })),
        tweetEntry(tweet({ id: "2000000000000000001" })),
        tweetEntry(tweet({ id: "100" })),
        { entryId: "cursor-top-123", content: {} },
        { entryId: "who-to-follow-1", content: {} },
    ]);
    const data = await getTimelineByUserID(268758461);
    assert.deepEqual(
        data.map((t) => t.rest_id),
        ["2000000000000000001", "1999999999999999999", "100"],
    );
    // tweet_results.result 객체 자체를 반환
    assert.equal(data[0].legacy.id_str, "2000000000000000001");
});

test("TimelineAddEntries가 여러 개면 첫 번째만 사용", async () => {
    const res = timelineResponse([tweetEntry(tweet({ id: "1" }))]);
    res.data.user.result.timeline.timeline.instructions.push({
        type: "TimelineAddEntries",
        entries: [tweetEntry(tweet({ id: "2" }))],
    });
    state.fetchHandler = () => jsonResponse(res);
    const data = await getTimelineByUserID(268758461);
    assert.deepEqual(data.map((t) => t.rest_id), ["1"]);
});

function conversationItem(convId, t) {
    return {
        entryId: `profile-conversation-${convId}-tweet-${t.rest_id}`,
        item: { itemContent: { tweet_results: { result: t } } },
    };
}

test("profile-conversation(대화 묶음) 엔트리는 안의 마후마후 트윗만 펼침", async () => {
    // 실제 대화 묶음 엔트리는 content.itemContent 없이 content.items만 가짐
    respond([
        tweetEntry(tweet({ id: "10" })),
        {
            entryId: "profile-conversation-20",
            content: {
                items: [
                    conversationItem(20, tweet({ id: "21" })),
                    // 다른 사람의 답글은 제외
                    conversationItem(20, tweet({ id: "22", screenName: "_amatsuki_" })),
                    conversationItem(20, tweet({ id: "23", replyTo: { id: "22", screenName: "_amatsuki_" } })),
                    // tweet 항목이 아닌 것은 무시
                    { entryId: "profile-conversation-20-cursor-showmore-1", item: {} },
                ],
            },
        },
    ]);
    const data = await getTimelineByUserID(268758461);
    assert.deepEqual(data.map((t) => t.rest_id), ["23", "21", "10"]);
    assert.equal(state.captured.length, 0);
});

test("작성자 정보가 없는 트윗(삭제된 트윗 등)은 건너뜀", async () => {
    respond([
        tweetEntry(tweet({ id: "10" })),
        { entryId: "tweet-11", content: { itemContent: { tweet_results: { result: { __typename: "TweetTombstone" } } } } },
        {
            entryId: "profile-conversation-20",
            content: {
                items: [
                    conversationItem(20, { __typename: "TweetTombstone", rest_id: "21" }),
                    { entryId: "profile-conversation-20-tweet-22", item: { itemContent: { tweet_results: {} } } },
                    conversationItem(20, tweet({ id: "23" })),
                ],
            },
        },
    ]);
    const data = await getTimelineByUserID(268758461);
    assert.deepEqual(data.map((t) => t.rest_id), ["23", "10"]);
});

test("실제 응답 fixture: 대화 묶음 포함 마후마후 트윗 20개, 다른 사람 트윗 제외", async () => {
    state.fetchHandler = () => jsonResponse(realTimeline);
    const data = await getTimelineByUserID(268758461);
    assert.deepEqual(
        data.map((t) => t.rest_id),
        [
            "2120450976679358725", "2120123773789880449", "2119366392671834522",
            "2118312539243397442", "2118307031992226201", "2117937235647709349",
            "2117599140662448305", "2117186256375586949", "2116475117865943390",
            "2116038835704655885", "2115742979302592712", "2115738706485416117",
            "2115736416575693269", "2115373904822952072", "2115008056144924994",
            "2114660946165784594", "2114285923756294554", "2113931603278008374",
            "2113601289741603182", "2113599430767341640",
        ],
    );
    assert.ok(data.every((t) => t.core.user_results.result.core.screen_name === "uni_mafumafu"));
    // 아마츠키의 답글(대화 묶음 안)은 제외
    assert.ok(!data.some((t) => t.rest_id === "2115404374612857258"));
    // 고정 트윗(TimelinePinEntry)은 포함하지 않음
    assert.ok(!data.some((t) => t.rest_id === "1825857996876034162"));
    assert.equal(state.captured.length, 0);
});

test("[현재 동작] 응답이 ok가 아니면 원래 오류를 두 번 기록하고 ReferenceError를 던짐", async () => {
    state.fetchHandler = () =>
        jsonResponse("", { ok: false, status: 503, statusText: "Service Unavailable" });
    await assert.rejects(getTimelineByUserID(268758461), {
        name: "ReferenceError",
        message: /res_text/,
    });
    assert.equal(state.captured.length, 2);
    assert.equal(state.captured[0], state.captured[1]);
    assert.equal(
        state.captured[0].message,
        "Twitter API response not ok: 503 Service Unavailable",
    );
    assert.deepEqual(state.debugLogs, [""]);
});

test("[현재 동작] JSON 파싱 실패 시 응답 본문을 기록하고 ReferenceError", async () => {
    state.fetchHandler = () => jsonResponse("<html>blocked</html>");
    await assert.rejects(getTimelineByUserID(268758461), { name: "ReferenceError" });
    assert.ok(state.captured[0] instanceof SyntaxError);
    assert.deepEqual(state.debugLogs, ["<html>blocked</html>"]);
});

test("[현재 동작] fetch 자체가 실패하면 오류를 한 번 기록하고 ReferenceError", async () => {
    const err = new Error("ECONNRESET");
    state.fetchHandler = () => {
        throw err;
    };
    await assert.rejects(getTimelineByUserID(268758461), { name: "ReferenceError" });
    assert.deepEqual(state.captured, [err]);
    assert.deepEqual(state.debugLogs, []);
});

// 트윗 → 번역 마크다운 → Discord embed 변환 (utils/getTweet.js)
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { installStubs, reset, state, jsonResponse } = require("./helpers/stub");
const { matchSnapshot } = require("./helpers/snapshot");
const { tweet, media, timelineResponse, tweetEntry } = require("./helpers/tweets");

let translateImpl;
const translated = [];
installStubs({
    translator: async (text) => {
        translated.push(text);
        return translateImpl(text);
    },
});
const {
    getTweetText,
    formatAuthor,
    toBlockquote,
    generateTweetMarkdown,
    getWebhookEmbed,
    getProfileURL,
} = require("../utils/getTweet");
const noteTweet = require("./fixtures/note-tweet-4photos.json");
const retweet = require("./fixtures/retweet-of-note-tweet.json");

const LOGO = "https://mahook.bass9030.dev/logo.png";

beforeEach(() => {
    reset();
    translated.length = 0;
    translateImpl = async (t) => `[KO]${t}`;
});

// profileURL은 모듈 전역 상태라서 getWebhookEmbed 호출 전에 먼저 검사해야 함
test("[현재 동작] getProfileURL: 캐시가 비어 있고 조회에 성공해도 빈 문자열 반환", async () => {
    state.fetchHandler = () =>
        jsonResponse(timelineResponse([tweetEntry(tweet({ id: "1" }))]));
    assert.equal(await getProfileURL(), "");
    assert.equal(state.fetchCalls.length, 1);
    const vars = JSON.parse(
        new URL(state.fetchCalls[0].url).searchParams.get("variables"),
    );
    assert.equal(vars.userId, 268758461);
    assert.equal(vars.count, 1);
});

test("getProfileURL: 캐시가 비어 있고 조회에 실패하면 로고 URL", async () => {
    state.fetchHandler = () => {
        throw new Error("network");
    };
    assert.equal(await getProfileURL(), LOGO);
});

test("getTweetText: t.co URL을 원래 URL로 바꾸고 미디어 URL은 제거", () => {
    const t = tweet({
        id: "1",
        text: "見て https://t.co/a https://t.co/m",
        urls: [{ url: "https://t.co/a", expanded_url: "https://example.com/x" }],
        media: [media("photo", 1, "https://t.co/m")],
    });
    assert.equal(getTweetText(t), "見て https://example.com/x ");
});

test("[현재 동작] getTweetText: 같은 t.co URL이 두 번 나오면 첫 번째만 치환", () => {
    const t = tweet({
        id: "1",
        text: "https://t.co/a https://t.co/a",
        urls: [{ url: "https://t.co/a", expanded_url: "https://e.com" }],
    });
    assert.equal(getTweetText(t), "https://e.com https://t.co/a");
});

test("getTweetText: 장문 트윗은 note_tweet 본문과 entity_set URL 사용", () => {
    const text = getTweetText(noteTweet);
    assert.ok(text.startsWith("【LIVE DVD & Blu-ray"));
    assert.ok(text.includes("https://mg.withlive-app.com/event/lottery/super_mafumafu_world"));
    assert.ok(text.includes("https://a-sketch-inc.lnk.to/supermafumafuworld"));
    assert.ok(!text.includes("https://t.co/vFXHYzeFtx"));
    matchSnapshot("tweetRender.note-tweet-text", text);
});

test("getTweetText: 본문이 없으면 빈 문자열", () => {
    assert.equal(getTweetText({}), "");
    assert.equal(getTweetText(undefined), "");
});

test("formatAuthor", () => {
    assert.equal(
        formatAuthor(tweet({ id: "1" })),
        "**まふまふ ([@uni_mafumafu](https://x.com/uni_mafumafu))**",
    );
    const noName = tweet({ id: "1", screenName: "foo" });
    delete noName.core.user_results.result.core.name;
    assert.equal(formatAuthor(noName), "**foo ([@foo](https://x.com/foo))**");
    assert.equal(formatAuthor({}), "**unknown ([@unknown](https://x.com/unknown))**");
});

test("toBlockquote: 빈 줄 포함 모든 줄에 '> \\u200b' 접두사", () => {
    assert.equal(toBlockquote("a\n\nb"), "> ​a\n> ​\n> ​b");
});

test("generateTweetMarkdown: 일반 트윗", async () => {
    assert.equal(
        await generateTweetMarkdown(tweet({ id: "1", text: "こんにちは" })),
        "[KO]こんにちは",
    );
});

test("generateTweetMarkdown: 번역 결과 앞뒤 공백 제거", async () => {
    translateImpl = async () => "  \n번역\n  ";
    assert.equal(await generateTweetMarkdown(tweet({ id: "1" })), "번역");
});

test("[현재 동작] generateTweetMarkdown: 번역 결과가 null이면 'null'", async () => {
    translateImpl = async () => null;
    assert.equal(await generateTweetMarkdown(tweet({ id: "1" })), "null");
});

test("generateTweetMarkdown: 답글이면 답글 대상 링크 접두사", async () => {
    const t = tweet({ id: "2", text: "返信", replyTo: { id: "9", screenName: "foo" } });
    assert.equal(
        await generateTweetMarkdown(t),
        "↩ [@foo](https://x.com/foo/status/9)님에게 보내는 답글\n\n[KO]返信",
    );
});

test("generateTweetMarkdown: 인용 트윗", async () => {
    const quoted = tweet({ id: "5", text: "引用元", screenName: "q", name: "Q" });
    const t = tweet({ id: "6", text: "本文", quoted });
    assert.equal(
        await generateTweetMarkdown(t),
        "[KO]本文\n\n" +
            "> ​QT: **Q ([@q](https://x.com/q))**:\n" +
            "> ​\n" +
            "> ​[KO]引用元",
    );
});

test("generateTweetMarkdown: RT (fixture)", async () => {
    const md = await generateTweetMarkdown(retweet);
    assert.ok(
        md.startsWith(
            "RT: **まふまふの何でも屋さん ([@uni_nandemoya](https://x.com/uni_nandemoya))**:\n[KO]",
        ),
    );
    // RT 본문(잘린 legacy.full_text)이 아니라 원본 트윗(note_tweet)을 번역
    assert.deepEqual(translated, [getTweetText(noteTweet)]);
    matchSnapshot("tweetRender.retweet-markdown", md);
});

test("generateTweetMarkdown: RT한 트윗이 인용 트윗이면 재귀 처리", async () => {
    const quoted = tweet({ id: "1", text: "Q", screenName: "q", name: "QN" });
    const inner = tweet({ id: "2", text: "I", screenName: "i", name: "IN", quoted });
    const rt = tweet({ id: "3", text: "RT @i: I", retweeted: inner });
    assert.equal(
        await generateTweetMarkdown(rt),
        "RT: **IN ([@i](https://x.com/i))**:\n" +
            "[KO]I\n\n" +
            "> ​QT: **QN ([@q](https://x.com/q))**:\n" +
            "> ​\n" +
            "> ​[KO]Q",
    );
});

test("generateTweetMarkdown: 중첩 깊이 3에서 RT/인용을 더 펼치지 않음", async () => {
    const t3 = tweet({ id: "3", text: "deep" });
    const t2 = tweet({ id: "2", screenName: "b", name: "B", retweeted: t3 });
    const t1 = tweet({ id: "1", screenName: "a", name: "A", retweeted: t2 });
    const t0 = tweet({ id: "0", retweeted: t1 });
    assert.equal(
        await generateTweetMarkdown(t0),
        "RT: **A ([@a](https://x.com/a))**:\n" +
            "RT: **B ([@b](https://x.com/b))**:\n" +
            "[KO]text-2",
    );

    // depth 인자로 직접 지정
    const q = tweet({ id: "8", text: "QQ", quoted: tweet({ id: "9" }) });
    assert.equal(await generateTweetMarkdown(q, 3), "[KO]QQ");
    assert.equal(
        await generateTweetMarkdown(q, 2),
        "[KO]QQ\n\n> ​QT: **まふまふ ([@uni_mafumafu](https://x.com/uni_mafumafu))**:\n> ​\n> ​[KO]text-9",
    );
});

test("generateTweetMarkdown: 답글 + 인용", async () => {
    const t = tweet({
        id: "1",
        text: "A",
        quoted: tweet({ id: "2", text: "B" }),
        replyTo: { id: "7", screenName: "x" },
    });
    const md = await generateTweetMarkdown(t);
    assert.ok(md.startsWith("↩ [@x](https://x.com/x/status/7)님에게 보내는 답글\n\n[KO]A\n\n> "));
});

test("generateTweetMarkdown: 번역 오류는 그대로 전파", async () => {
    const err = new Error("translate");
    translateImpl = async () => {
        throw err;
    };
    await assert.rejects(generateTweetMarkdown(tweet({ id: "1" })), err);
});

function embedJSON(embeds) {
    return embeds.map((e) => e.toJSON());
}

test("getWebhookEmbed: 장문 트윗 + 사진 4장 (fixture)", async () => {
    const embeds = await getWebhookEmbed(noteTweet);
    assert.equal(embeds.length, 4);
    matchSnapshot("tweetRender.embed-note-tweet-4photos", embedJSON(embeds));
});

test("getWebhookEmbed: RT 미디어는 원본 트윗에서 가져옴 (fixture)", async () => {
    const embeds = await getWebhookEmbed(retweet);
    assert.equal(embeds.length, 4);
    matchSnapshot("tweetRender.embed-retweet", embedJSON(embeds));
});

test("getWebhookEmbed: 이후 getProfileURL은 마지막 트윗 작성자의 프로필 이미지", async () => {
    await getWebhookEmbed(tweet({ id: "1", screenName: "someone" }));
    assert.equal(await getProfileURL(), "https://pbs.twimg.com/someone.jpg");
    assert.equal(state.fetchCalls.length, 0);
});

test("getWebhookEmbed: 미디어 없는 일반 트윗", async () => {
    const embeds = await getWebhookEmbed(
        tweet({ id: "100", text: "テキスト", createdAt: "Wed Jan 01 00:00:00 +0000 2025" }),
    );
    assert.deepEqual(embedJSON(embeds), [
        {
            title: "New Tweet Release!",
            url: "https://x.com/uni_mafumafu/status/100",
            author: {
                name: "まふまふ (@uni_mafumafu)",
                icon_url: "https://pbs.twimg.com/uni_mafumafu.jpg",
                url: "https://x.com/uni_mafumafu",
            },
            footer: {
                text: "마훅 - 한글 번역된 마후마후 트윗을 디스코드에서",
                icon_url: LOGO,
            },
            timestamp: "2025-01-01T00:00:00.000Z",
            description: "[KO]テキスト",
            color: 0x1da1f2,
        },
    ]);
});

test("getWebhookEmbed: 미디어는 최대 4개, 첫 번째는 본 embed 이미지", async () => {
    const embeds = await getWebhookEmbed(
        tweet({ id: "1", media: [1, 2, 3, 4, 5].map((n) => media("photo", n)) }),
    );
    const json = embedJSON(embeds);
    assert.equal(json.length, 4);
    assert.equal(json[0].image.url, "https://pbs.twimg.com/media/photo-1.jpg");
    assert.deepEqual(json.slice(1), [2, 3, 4].map((n) => ({
        url: "https://x.com/uni_mafumafu/status/1",
        image: { url: `https://pbs.twimg.com/media/photo-${n}.jpg` },
    })));
});

test("[현재 동작] getWebhookEmbed: photo/video 외 타입은 건너뛰되 순번은 소모", async () => {
    const embeds = await getWebhookEmbed(
        tweet({
            id: "1",
            media: [media("animated_gif", 1), media("video", 2), media("photo", 3)],
        }),
    );
    const json = embedJSON(embeds);
    // 첫 번째가 gif라 본 embed에는 이미지가 없음
    assert.equal(json[0].image, undefined);
    assert.deepEqual(json.slice(1).map((e) => e.image.url), [
        "https://pbs.twimg.com/media/video-2.jpg",
        "https://pbs.twimg.com/media/photo-3.jpg",
    ]);
});

test("getWebhookEmbed: 본 트윗 미디어가 없으면 인용 트윗 미디어 사용", async () => {
    const quoted = tweet({ id: "2", media: [media("photo", 9)] });
    const embeds = await getWebhookEmbed(tweet({ id: "1", quoted }));
    assert.equal(embeds[0].toJSON().image.url, "https://pbs.twimg.com/media/photo-9.jpg");
});

test("getWebhookEmbed: 본 트윗 미디어가 있으면 인용 트윗 미디어는 무시", async () => {
    const quoted = tweet({ id: "2", media: [media("photo", 9)] });
    const embeds = await getWebhookEmbed(
        tweet({ id: "1", quoted, media: [media("photo", 1)] }),
    );
    assert.equal(embeds.length, 1);
    assert.equal(embeds[0].toJSON().image.url, "https://pbs.twimg.com/media/photo-1.jpg");
});

test("getWebhookEmbed: 인용+답글 전체 형태", async () => {
    const quoted = tweet({ id: "2", text: "引用", screenName: "q", name: "Q", media: [media("photo", 1)] });
    const t = tweet({
        id: "3",
        text: "本文",
        quoted,
        replyTo: { id: "1", screenName: "uni_mafumafu" },
    });
    matchSnapshot("tweetRender.embed-quote-reply", embedJSON(await getWebhookEmbed(t)));
});

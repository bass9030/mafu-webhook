const { test } = require("node:test");
const assert = require("node:assert/strict");
const { installStubs, state } = require("./helpers/stub");

installStubs();
const { EmbedBuilder } = require("discord.js");
const {
    createWebhookClient,
    buildMention,
    buildWelcomeEmbed,
    buildNoticeEmbed,
    buildWebhookPayload,
} = require("../utils/discordSender");
const { WEBHOOK_TYPE } = require("../utils/constants");
const webhookManagerModule = require("../utils/webhookManager");

const LOGO = "https://mahook.bass9030.dev/logo.png";
const USERNAME = "마훅 - 마후 트윗 번역봇";

test("WEBHOOK_TYPE은 webhookManager가 export하는 것과 같은 객체", () => {
    assert.equal(webhookManagerModule.WEBHOOK_TYPE, WEBHOOK_TYPE);
});

test("createWebhookClient", () => {
    createWebhookClient("123", "tok");
    assert.deepEqual(state.webhookClients.at(-1), { id: "123", token: "tok" });
});

test("buildMention", () => {
    assert.equal(buildMention("@everyone"), "@everyone");
    assert.equal(buildMention("@here"), "@here");
    assert.equal(buildMention("123"), "<@&123>");
    assert.equal(buildMention(123), "<@&123>");
    assert.equal(buildMention("-1"), "");
    assert.equal(buildMention(-1), "");
    // 현재 동작
    assert.equal(buildMention(null), "<@&null>");
});

test("buildWelcomeEmbed", () => {
    assert.deepEqual(buildWelcomeEmbed().toJSON(), {
        title: "마훅 구독 완료!",
        description:
            "마훅 구독이 완료되었습니다!\n이제부터 마후마후 트윗을 한국어로 즐겨보세요!",
        color: 0x1da1f2,
    });
});

test("buildNoticeEmbed", () => {
    assert.deepEqual(buildNoticeEmbed("제목", "내용").toJSON(), {
        title: "마훅 공지사항",
        fields: [{ name: "제목", value: "내용" }],
        color: 4037805,
        footer: {
            text: "마훅 - 한글 번역된 마후마후 트윗을 디스코드에서",
            icon_url: LOGO,
        },
    });
});

test("buildWebhookPayload: NOTI", () => {
    const p = buildWebhookPayload({ title: "t", content: "c" }, WEBHOOK_TYPE.NOTI, "@here");
    assert.deepEqual(Object.keys(p), ["avatarURL", "username", "content", "embeds"]);
    assert.equal(p.avatarURL, LOGO);
    assert.equal(p.username, USERNAME);
    assert.equal(p.content, "@here");
    assert.deepEqual(p.embeds.map((e) => e.toJSON()), [buildNoticeEmbed("t", "c").toJSON()]);
});

test("buildWebhookPayload: TWITTER / LINE은 embed 배열 그대로, author 아이콘이 avatar", () => {
    const embeds = [
        new EmbedBuilder()
            .setAuthor({ name: "a", iconURL: "https://icon" })
            .setFooter({ text: "f", iconURL: "https://footer-icon" }),
        new EmbedBuilder().setImage("https://img"),
    ];
    for (const type of [WEBHOOK_TYPE.TWITTER, WEBHOOK_TYPE.LINE]) {
        const p = buildWebhookPayload(embeds, type, "");
        assert.deepEqual(p, {
            avatarURL: "https://icon",
            username: USERNAME,
            content: "",
            embeds,
        });
        assert.equal(p.embeds, embeds);
    }
});

test("[현재 동작] buildWebhookPayload: 배열이 아닌 embed 하나면 TypeError", () => {
    assert.throws(
        () => buildWebhookPayload(new EmbedBuilder(), WEBHOOK_TYPE.LINE, ""),
        TypeError,
    );
});

test("[현재 동작] buildWebhookPayload: author가 없는 embed(LINE embed 등)는 배열이어도 TypeError", () => {
    // utils/sendLINE.js의 LINE embed는 footer만 있고 author가 없음
    const lineEmbed = new EmbedBuilder()
        .setTitle("New LINE Release!")
        .setFooter({ text: "f", iconURL: "https://line-icon" });
    assert.throws(
        () => buildWebhookPayload([lineEmbed], WEBHOOK_TYPE.LINE, ""),
        TypeError,
    );
});

test("buildWebhookPayload: 알 수 없는 type은 null", () => {
    assert.equal(buildWebhookPayload([], 1, ""), null);
    assert.equal(buildWebhookPayload([], "2", ""), null);
});

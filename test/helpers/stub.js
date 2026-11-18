// 테스트용 외부 의존성 스텁
// 반드시 앱 모듈(require("../../utils/...") 등)보다 먼저 installStubs()를 호출해야 함.
// 앱 모듈은 require 시점에 구조 분해 할당(const { X } = require(...))을 하므로
// require.cache에 미리 가짜 모듈을 넣어두는 방식으로 교체한다.
const Module = require("module");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");

function setModule(id, exports) {
    const resolved = require.resolve(id, { paths: [ROOT] });
    const m = new Module(resolved);
    m.filename = resolved;
    m.loaded = true;
    m.exports = exports;
    require.cache[resolved] = m;
}

/**
 * 테스트 상태(호출 기록, 동작 교체용 핸들러)
 */
const state = {
    // Sentry
    captured: [],
    infoLogs: [],
    debugLogs: [],
    // DB
    queries: [],
    acquired: 0,
    released: 0,
    /** release된 커넥션 번호 (커넥션마다 1부터 증가) */
    releasedConns: [],
    /** @type {(sql: string, params?: any[]) => any} */
    queryHandler: () => [],
    /** @type {null | (() => any)} */
    getConnectionHandler: null,
    // Discord
    webhookClients: [],
    sent: [],
    /** @type {(client: {id: string, token: string}, payload: any) => any} */
    sendHandler: () => undefined,
    // Gemini / DeepL
    genAIOptions: null,
    geminiCalls: [],
    /** @type {(req: any) => any} */
    geminiHandler: () => ({ text: "" }),
    deeplKeys: [],
    deeplCalls: [],
    /** @type {(...args: any[]) => any} */
    deeplHandler: () => ({ text: "" }),
    // fetch
    fetchCalls: [],
    /** @type {(url: string, opts: any) => any} */
    fetchHandler: () => {
        throw new Error("fetch not stubbed");
    },
};

function reset() {
    state.captured = [];
    state.infoLogs = [];
    state.debugLogs = [];
    state.queries = [];
    state.acquired = 0;
    state.released = 0;
    state.releasedConns = [];
    state.queryHandler = () => [];
    state.getConnectionHandler = null;
    state.webhookClients = [];
    state.sent = [];
    state.sendHandler = () => undefined;
    state.geminiCalls = [];
    state.geminiHandler = () => ({ text: "" });
    state.deeplCalls = [];
    state.deeplHandler = () => ({ text: "" });
    state.fetchCalls = [];
    state.fetchHandler = () => {
        throw new Error("fetch not stubbed");
    };
}

/** EmbedBuilder 등을 비교 가능한 plain object로 변환 */
function toPlain(v) {
    if (Array.isArray(v)) return v.map(toPlain);
    if (v && typeof v.toJSON === "function") return v.toJSON();
    return v;
}

let installed = false;

/**
 * @param {{ translator?: Function, quiet?: boolean }} [opts]
 *   translator: utils/translator.js를 대체할 함수 (생략 시 실제 모듈 사용)
 */
function installStubs(opts = {}) {
    if (installed) throw new Error("installStubs()는 한 번만 호출");
    installed = true;

    process.env.TZ = "UTC";
    process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
    process.env.GEMINI_API_KEY = "test-gemini-key";
    process.env.DEEPL_API_KEY = "test-deepl-key";
    process.env.DEEPL_GLOSSARY_ID = "test-glossary-id";
    process.env.TWITTER_AUTH_TOKEN = "test-auth-token";
    process.env.TWITTER_CT0 = "test-ct0";

    if (opts.quiet !== false && !process.env.DEBUG_TESTS) {
        console.log = () => {};
        console.error = () => {};
    }

    setModule("@sentry/node", {
        logger: {
            info: (m) => state.infoLogs.push(m),
            debug: (m) => state.debugLogs.push(m),
        },
        captureException: (e) => state.captured.push(e),
    });

    setModule("mariadb", {
        createPool: () => ({
            getConnection: async () => {
                if (state.getConnectionHandler) await state.getConnectionHandler();
                state.acquired++;
                const connId = state.acquired;
                return {
                    connId,
                    query: async (sql, params) => {
                        state.queries.push({ sql, params });
                        return state.queryHandler(sql, params);
                    },
                    release: () => {
                        state.released++;
                        state.releasedConns.push(connId);
                        return Promise.resolve();
                    },
                };
            },
            end: async () => {},
        }),
    });

    const realDiscord = require(require.resolve("discord.js", { paths: [ROOT] }));
    class FakeWebhookClient {
        constructor({ id, token }) {
            this.id = id;
            this.token = token;
            state.webhookClients.push({ id, token });
        }
        async send(payload) {
            const result = await state.sendHandler(
                { id: this.id, token: this.token },
                payload,
            );
            state.sent.push({
                id: this.id,
                token: this.token,
                payload: { ...payload, embeds: toPlain(payload.embeds) },
            });
            return result;
        }
    }
    setModule("discord.js", { ...realDiscord, WebhookClient: FakeWebhookClient });

    setModule("@google/genai", {
        GoogleGenAI: class {
            constructor(options) {
                state.genAIOptions = options;
                this.models = {
                    generateContent: async (req) => {
                        state.geminiCalls.push(req);
                        return state.geminiHandler(req);
                    },
                };
            }
        },
    });

    setModule("deepl-node", {
        Translator: class {
            constructor(key) {
                // 실제 deepl-node처럼 키가 비어 있으면 생성 시 예외
                if (!key) throw new Error("authKey must be a non-empty string");
                state.deeplKeys.push(key);
            }
            async translateText(...args) {
                state.deeplCalls.push(args);
                return state.deeplHandler(...args);
            }
        },
    });

    setModule("x-client-transaction-id", {
        fetchXDocument: async () => ({}),
        ClientTransaction: {
            create: async () => ({
                generateTransactionId: async () => "test-transaction-id",
            }),
        },
    });

    // 요청 로그 출력 억제
    setModule("morgan", () => (req, res, next) => next());

    if (opts.translator) {
        setModule(path.join(ROOT, "utils", "translator.js"), opts.translator);
    }

    globalThis.fetch = async (url, init) => {
        state.fetchCalls.push({ url, init });
        return state.fetchHandler(url, init);
    };

    return state;
}

/** 대기 중인 마이크로태스크/즉시 실행 콜백을 모두 흘려보냄 (await 안 된 비동기 작업용) */
async function flush(times = 10) {
    for (let i = 0; i < times; i++) {
        await new Promise((r) => setImmediate(r));
    }
}

/** fetch 응답 객체 생성 */
function jsonResponse(body, { ok = true, status = 200, statusText = "OK" } = {}) {
    return {
        ok,
        status,
        statusText,
        text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    };
}

module.exports = { installStubs, reset, state, flush, toPlain, jsonResponse, ROOT };

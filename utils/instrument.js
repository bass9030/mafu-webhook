// 반드시 다른 모듈(express, http 등)보다 먼저 로드되어야 자동 계측이 적용됨
const Sentry = require("@sentry/node");

Sentry.init({
    dsn: process.env.SENTRY_ENDPOINT,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.01,
    debug: process.env.SENTRY_DEBUG === "true",
    integrations: [
        Sentry.expressIntegration({
            shouldHandleError(error) {
                const status = Number(error.status ?? error.statusCode ?? 500);
                // 기본값(5xx)에 더해 401/403도 수집
                return status === 401 || status === 403 || status >= 500;
            },
        }),
    ],
});

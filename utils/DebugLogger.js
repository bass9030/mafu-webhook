const Sentry = require("@sentry/node");

// Sentry.logger는 문자열 메시지를 받으므로 객체/에러를 문자열로 변환
const toLogMessage = (v) => {
    if (typeof v === "string") return v;
    if (v instanceof Error) return v.stack ?? v.message;
    try {
        return JSON.stringify(v);
    } catch {
        return String(v);
    }
};

/**
 * @param {string} message
 * @param {any} log
 */
module.exports = {
    sendInfoLog: (e) => {
        console.log(e);
        Sentry.logger.info(toLogMessage(e));
    },
    sendErrorLog: (e) => {
        console.error(e);
        Sentry.captureException(e);
    },
    sendResponseDataLog: (response) => {
        console.log(response);
        Sentry.logger.debug(toLogMessage(response));
    },
};

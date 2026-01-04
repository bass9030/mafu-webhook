const Sentry = require("@sentry/node");

/**
 * @param {string} message
 * @param {any} log
 */
module.exports = {
    sendInfoLog: (e) => {
        Sentry.logger.info(e);
    },
    sendErrorLog: (e) => {
        Sentry.captureException(e);
    },
    sendResponseDataLog: (response) => {
        Sentry.logger.debug(response);
    },
};

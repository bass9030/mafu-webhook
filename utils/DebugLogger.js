const Sentry = require("@sentry/node");

/**
 * @param {string} message
 * @param {any} log
 */
module.exports = {
    sendInfoLog: (e) => {
        console.log(e);
        Sentry.logger.info(e);
    },
    sendErrorLog: (e) => {
        console.error(e);
        Sentry.captureException(e);
    },
    sendResponseDataLog: (response) => {
        console.log(response);
        Sentry.logger.debug(response);
    },
};

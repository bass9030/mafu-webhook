const { WebhookClient } = require("discord.js");

/**
 * @param {string} message
 * @param {any} log
 */
module.exports = async (message, log) => {
    const hook = new WebhookClient({ url: process.env.DEBUG_WEBHOOK_URL });
    const date = new Date();
    await hook.send({
        files: !!log
            ? [
                  {
                      contentType: "application/json",
                      data: log,
                      name: "response.json",
                  },
              ]
            : undefined,
        content: `<t:${Math.floor(date.getTime() / 1000)}:f> ${message}`,
    });
};

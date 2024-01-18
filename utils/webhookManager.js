const db = require('better-sqlite3')('./webhooks.db');
const { Webhook, MessageBuilder } = require('discord-webhook-node');

db.exec('CREATE TABLE IF NOT EXISTS webhooks (' + 
            'id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, ' +
            'webhookURL TEXT PRIMARY KEY NOT NULL' +
        ');');

class webhookManager {
    static addWebhook(url) {
        db.prepare('INSERT INTO webhooks (webhookURL) VALUES (?);').run(url);
    }

    static removeWebhook(url) {
        db.prepare('DELETE FROM webhooks WHERE webhookURL = ?;').run(url);
    }

    /**
     * @param {MessageBuilder} message 
     */
    static async sendWebhook(message) {
        const webhooks = db.prepare('SELECT * FROM webhooks;').all()
        for(let i = 0; i < webhooks.length; i++) {
            const hook = new Webhook(e.webhookURL);
            await hook.send(message);
        }
    }
}

process.on('SIGKILL', () => {

})

module.exports = webhookManager;
const db = require('better-sqlite3')('./webhooks.db');
const { Webhook, MessageBuilder } = require('discord-webhook-node');

db.exec('CREATE TABLE IF NOT EXISTS webhooks (' + 
            'id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, ' +
            'webhookURL TEXT NOT NULL UNIQUE' +
        ');');

class webhookManager {
    static addWebhook(url) {
        db.prepare('INSERT INTO webhooks (webhookURL) VALUES (?);').run(url);
    }

    static removeWebhook(url) {
        let result = db.prepare('DELETE FROM webhooks WHERE webhookURL = ?;').run(url);
        return {changes: result.changes}
    }

    static getWebhookCount() {
        let count = db.prepare('SELECT COUNT(*) FROM webhooks;').get();
        return count['COUNT(*)'];
    }

    /**
     * @param {MessageBuilder} message 
     */
    static async sendWebhook(message, profileURL) {
        const webhooks = db.prepare('SELECT * FROM webhooks;').all()
        for(let i = 0; i < webhooks.length; i++) {
            let e = webhooks[i];
            try {
                new Promise(async () => {
                    const hook = new Webhook(e.webhookURL);
                    hook.setAvatar(profileURL);
                    hook.setUsername('마훅 - 마후 트윗 번역봇');
                    await hook.send(message);
                });
            }catch(e){
                console.error(`Failed to send webhook to ${e.webhookURL}`)
                console.error(e)
            }
        }
    }
}

setInterval(() => {
    db.backup(`./backup/${new Date().getTime()}_webhooks.db`);
}, 1000 * 60 * 60 * 2)

process.on('exit', () => {
    db.close();
})

module.exports = webhookManager;
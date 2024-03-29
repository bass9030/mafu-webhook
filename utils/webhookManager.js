const db = require('better-sqlite3')('./webhooks.db');
const { Webhook, MessageBuilder } = require('discord-webhook-node');

db.exec('CREATE TABLE IF NOT EXISTS webhooks (' + 
            'id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, ' +
            'webhookURL TEXT NOT NULL UNIQUE,' +
            'roleID TEXT,' +
            'sendNoticeMessage INTEGER' +
        ');');

class webhookManager {
    static addWebhook(url, roleID, sendNoti) {
        db.prepare('INSERT INTO webhooks (webhookURL, roleID, sendNoticeMessage) VALUES (?, ?, ?);')
            .run(url, roleID, sendNoti ? 1 : 0);
    }

    static removeWebhook(url) {
        let result = db.prepare('DELETE FROM webhooks WHERE webhookURL = ?;').run(url);
        return {changes: result.changes}
    }

    static editWebhook(url, roleID, sendNoti) {
        let result = db.prepare('UPDATE SET roleID = ?, sendNoticeMessage = ? FROM webhooks WHERE webhookURL = ?;')
            .run(roleID, sendNoti ? 1 : 0, url);
        return {changes: result.changes}
    }

    static getWebhookCount() {
        let count = db.prepare('SELECT COUNT(*) FROM webhooks;').get();
        return count['COUNT(*)'];
    }

    /**
     * @param {MessageBuilder} message 
     */
    static async sendWebhook(message) {
        const webhooks = db.prepare('SELECT * FROM webhooks;').all()
        for(let i = 0; i < webhooks.length; i++) {
            let e = webhooks[i];
            try {
                new Promise(async () => {
                    const hook = new Webhook(e.webhookURL);
                    // console.log(message.getJSON()['embeds'][0]['footer'])
                    let profileURL = message.getJSON()['embeds'][0]['footer']['icon_url'];
                    
                    hook.setAvatar(profileURL);
                    hook.setUsername('마훅 - 마후 트윗 번역봇');
                    if(!!e.roleID) {
                        if(e.roleID == '@everyone' || e.roleID == '@here') await hook.send(e.roleID);
                        else await hook.send('<@&' + e.roleID + '>');
                    }
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
}, 1000 * 60 * 60 * 12)

process.on('exit', () => {
    db.close();
})

module.exports = webhookManager;
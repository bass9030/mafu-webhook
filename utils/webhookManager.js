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
        let result = db.prepare('UPDATE webhooks SET roleID = ?, sendNoticeMessage = ? WHERE webhookURL = ?;')
            .run(roleID, sendNoti ? 1 : 0, url);
        return {changes: result.changes}
    }

    static getWebhookCount() {
        let count = db.prepare('SELECT COUNT(*) FROM webhooks;').get();
        return count['COUNT(*)'];
    }

    /**
     * @param {MessageBuilder | string} message 
     */
    static async sendWebhook(message, isNoti) {
        const webhooks = isNoti ? db.prepare('SELECT * FROM webhooks WHERE sendNoticeMessage = ?;').all(1) : db.prepare('SELECT * FROM webhooks;').all();
        for(let i = 0; i < webhooks.length; i++) {
            let e = webhooks[i];
            try {
                new Promise(async () => {
                    try {
                        const hook = new Webhook(e.webhookURL);
                        // console.log(message.getJSON()['embeds'][0]['footer'])
                        if(typeof message == 'string')
                            hook.setAvatar('https://mahook.bass9030.dev/logo.png');
                        else{
                            let profileURL = message.getJSON()['embeds'][0]['footer']['icon_url'];
                            if(!!profileURL) hook.setAvatar(profileURL);
                        } 
                        hook.setUsername('마훅 - 마후 트윗 번역봇');
                        if(!!e.roleID) {
                            if(e.roleID == '@everyone' || e.roleID == '@here') await hook.send(e.roleID);
                            else await hook.send('<@&' + e.roleID + '>');
                        }
                        if(isNoti) await hook.info('마훅 공지사항', '', message);
                        else await hook.send(message);
                    }catch(err){
                        console.error(`Failed to send webhook to ${e.webhookURL}`)
                        console.error(err)
                    }
                });
            }catch(err){
                console.error(`Failed to send webhook to ${e.webhookURL}`)
                console.error(err)
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
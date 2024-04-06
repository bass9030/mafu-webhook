// const db = require('better-sqlite3')('./webhooks.db');
const appRoot = require('app-root-path').path;
const path = require('path');
require('dotenv').config({
    path: path.join(appRoot, '.env')
});

const mariadb = require('mariadb')
const core = mariadb.createPool({
    host: process.env.DB_HOST,
    port: 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 10
});
const { Webhook, MessageBuilder } = require('discord-webhook-node');

core.getConnection().then((db) => {
    try {
        db.execute('CREATE TABLE IF NOT EXISTS webhooks (' + 
            'id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, ' +
            'webhookURL VARCHAR(2048) NOT NULL UNIQUE,' +
            'roleID VARCHAR(19),' +
            'sendNoticeMessage BOOLEAN' +
        ');');
    }finally{
        db.release();
    }
})

class webhookManager {
    static async addWebhook(url, roleID, sendNoti) {
        let db;
        try {
            db = await core.getConnection();
            db.query('INSERT INTO webhooks (webhookURL, roleID, sendNoticeMessage) VALUES (?, ?, ?);', [url, roleID, sendNoti ? 1 : 0]);
        }finally{
            db?.release();
        }
    }

    static async removeWebhook(url) {
        let db;
        try {
            let db = await core.getConnection();
            let result = db.query('DELETE FROM webhooks WHERE webhookURL = ?;', [url]);
            return {changes: result.affectedRows};
        }finally{
            db?.release();
        }
    }

    static async editWebhook(url, roleID, sendNoti) {
        let db;
        try {
            let db = await core.getConnection();
            let result = db.query('UPDATE webhooks SET roleID = ?, sendNoticeMessage = ? WHERE webhookURL = ?;', [roleID, sendNoti ? 1 : 0, url])
            return {changes: result.affectedRows}
        }finally{
            db?.release();
        }
    }

    static async getWebhookCount() {
        let db = await core.getConnection();
        let count = await db.query('SELECT COUNT(*) FROM webhooks;');
        return count[0]['COUNT(*)'];
    }

    /**
     * @param {MessageBuilder | string} message 
     */
    static async sendWebhook(message, isNoti) {
        const webhooks = isNoti ? db.prepare('SELECT * FROM webhooks WHERE sendNoticeMessage = ?;').all(1) : db.prepare('SELECT * FROM webhooks;').all();
        for(let i = 0; i < webhooks.length; i++) {
            let e = webhooks[i];
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
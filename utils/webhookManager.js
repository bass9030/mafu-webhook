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
    database: 'mahook',
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
        db.execute('CREATE TABLE IF NOT EXISTS notices (' + 
            'id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, ' +
            'date DATETIME NOT NULL,' +
            'title TEXT,' +
            'content TEXT' +
        ');');
    }catch(e){
        console.error(e);
    }finally{
        db.release();
    }
})

async function sendDebugLog(message) {
    const hook = new Webhook(process.env.DEBUG_WEBHOOK_URL);
    await hook.send(message);
}

class webhookManager {
    static async addWebhook(url, roleID, sendNoti) {
        let db;
        try {
            db = await core.getConnection();
            await db.query('INSERT INTO webhooks (webhookURL, roleID, sendNoticeMessage) VALUES (?, ?, ?);', [url, roleID, sendNoti ? 1 : 0]);
            return {success: true};
        }catch(err){
            return {success: false, err}
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

    static async sendNotice(title, content) {
        let db;
        try {
            db = await core.getConnection();
            let now = new Date();
            await db.query('INSERT INTO notices (date, title, content) VALUES (?, ?, ?);',
                [`${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()} ${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}`, title, content]
            );
            this.sendWebhook({title, content}, true);
        }finally{
            db?.release()
        }
    }

    static async getNotices() {
        let db;
        try {
            db = await core.getConnection();
            let result = await db.query('SELECT date, title, content FROM notices ORDER BY date DESC LIMIT 10',);

            return result;
        }catch{
            return [];
        }finally{
            db?.release()
        }
    }

    /**
     * @param {MessageBuilder | object} message 
     */
    static async sendWebhook(message, isNoti) {
        let db;
        let err_cnt = 0;
        let success_cnt = 0;
        try {
            db = await core.getConnection();
            const webhooks = isNoti ? await db.query('SELECT * FROM webhooks WHERE sendNoticeMessage = ?;', [1]) : await db.query('SELECT * FROM webhooks;');
             for(let i = 0; i < webhooks.length; i++) {
                let e = webhooks[i];
                try {
                    const hook = new Webhook(e.webhookURL);
                    if(!!e.roleID) {
                        if(e.roleID == '@everyone' || e.roleID == '@here') hook.payload = {content: e.roleID};
                        else hook.payload = {content: '<@&' + e.roleID + '>'};
                    }

                    if(isNoti)
                        hook.setAvatar('https://mahook.bass9030.dev/logo.png');
                    else{
                        let profileURL = message.getJSON()['embeds'][0]['footer']['icon_url'];
                        if(!!profileURL) hook.setAvatar(profileURL);
                    }
                     
                    hook.setUsername('마훅 - 마후 트윗 번역봇');
                    if(isNoti) await hook.info('마훅 공지사항', message.title, message.content);
                    else await hook.send(message);
                    success_cnt++;
                }catch(err){
                    err_cnt++;
                    console.error(`Failed to send webhook to ${e.webhookURL}`)
                    console.error(err)
                }
            }   
            sendDebugLog(`[${new Date().toLocaleString('ja')}] Webhook sended. \nTotal: ${webhooks.length} | Success: ${success_cnt} | Fail: ${err_cnt}`);

        }finally{
            db?.release()
        }
    }
}

module.exports = webhookManager;
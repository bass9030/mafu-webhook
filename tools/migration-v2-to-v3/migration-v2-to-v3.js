const mariadb = require("mariadb");

function setOptions(isLINESend, isNotiSend, isMention) {
    let bit = `${isLINESend ? "1" : "0"}${isNotiSend ? "1" : "0"}${
        isMention ? "1" : "0"
    }`.padStart(8, "0");
    return parseInt(bit, 2);
}

async function main() {
    const db = await mariadb.createConnection({
        host: process.env.DB_HOST,
        port: 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
    });

    // await db.execute("BEGIN");
    await db.query(
        "ALTER TABLE webhooks ADD COLUMN `channelID` VARCHAR(20) NOT NULL AFTER `id`;"
    );
    await db.query(
        "ALTER TABLE webhooks ADD COLUMN `webhookToken` VARCHAR(200) NOT NULL AFTER `channelID`;"
    );
    await db.query(
        "ALTER TABLE webhooks ADD COLUMN `options` TINYINT UNSIGNED NOT NULL AFTER `webhookToken`;"
    );

    let data = await db.query("SELECT * FROM webhooks;");
    for (let e of data) {
        let options = setOptions(true, e.sendNoticeMessage, e.roleID != -1);

        let url = e.webhookURL.split("//")[1];
        let channelID = url.split("/")[3];
        let webhookToken = url.split("/")[4];
        await db.query(
            "UPDATE webhooks SET channelID = ?, webhookToken = ?, options = ? WHERE id = ?;",
            [channelID, webhookToken, options, e.id]
        );
    }

    await db.query("ALTER TABLE webhooks DROP COLUMN `webhookURL`;");
    await db.query("ALTER TABLE webhooks DROP COLUMN `sendNoticeMessage`;");
    // await db.execute("END;");
}

main();

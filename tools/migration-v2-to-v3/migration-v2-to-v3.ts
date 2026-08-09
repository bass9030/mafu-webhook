import "dotenv/config";
import mariadb from "mariadb";

interface LegacyWebhook {
  id: number;
  webhookURL: string;
  sendNoticeMessage: boolean;
  roleID: string | number;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function setOptions(line: boolean, notice: boolean, mention: boolean): number {
  return (line ? 4 : 0) | (notice ? 2 : 0) | (mention ? 1 : 0);
}

async function main(): Promise<void> {
  const db = await mariadb.createConnection({
    host: requiredEnv("DB_HOST"),
    port: 3306,
    user: requiredEnv("DB_USER"),
    password: requiredEnv("DB_PASSWORD"),
    database: requiredEnv("DB_NAME"),
  });
  try {
    await db.beginTransaction();
    await db.query("ALTER TABLE webhooks ADD COLUMN `channelID` VARCHAR(20) NOT NULL AFTER `id`;");
    await db.query("ALTER TABLE webhooks ADD COLUMN `webhookToken` VARCHAR(200) NOT NULL AFTER `channelID`;");
    await db.query("ALTER TABLE webhooks ADD COLUMN `options` TINYINT UNSIGNED NOT NULL AFTER `webhookToken`;");
    const rows = await db.query<LegacyWebhook[]>("SELECT * FROM webhooks;");
    for (const row of rows) {
      const parsed = new URL(row.webhookURL);
      const [, , channelID, webhookToken] = parsed.pathname.split("/");
      if (!channelID || !webhookToken) throw new Error(`Invalid webhook URL in row ${row.id}`);
      await db.query(
        "UPDATE webhooks SET channelID = ?, webhookToken = ?, options = ? WHERE id = ?;",
        [channelID, webhookToken, setOptions(true, row.sendNoticeMessage, String(row.roleID) !== "-1"), row.id],
      );
    }
    await db.query("ALTER TABLE webhooks DROP COLUMN `webhookURL`;");
    await db.query("ALTER TABLE webhooks DROP COLUMN `sendNoticeMessage`;");
    await db.commit();
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    await db.end();
  }
}

void main();

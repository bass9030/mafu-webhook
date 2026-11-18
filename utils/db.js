const mariadb = require("mariadb");

// 모듈 로드 시 process.env를 읽으므로 .env가 로드된 뒤(bin/www) require되어야 함
const pool = mariadb.createPool({
    host: process.env.DB_HOST,
    port: 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 30,
});

async function closePool() {
    await pool.end();
}

module.exports = {
    pool,
    closePool,
};

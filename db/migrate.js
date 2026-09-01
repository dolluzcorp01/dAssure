/**
 * Runs every SQL file in db/migrations in filename order.
 *
 *   node db/migrate.js
 *
 * Every migration is written to be safe to re-run: tables use
 * CREATE TABLE IF NOT EXISTS and seed rows use INSERT IGNORE or
 * ON DUPLICATE KEY UPDATE. The one exception is the two CREATE TRIGGER
 * statements, which MySQL has no IF NOT EXISTS form for - if you re-run
 * migration 003 you will see "Trigger already exists", which is harmless
 * and reported rather than thrown.
 */

require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const DB = process.env.DB_NAME || "dtprm";
const DIR = path.join(__dirname, "migrations");

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        multipleStatements: true,
        charset: "utf8mb4",
    });

    await conn.query(
        `CREATE DATABASE IF NOT EXISTS \`${DB}\`
         CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await conn.query(`USE \`${DB}\``);
    console.log(`Using database ${DB}`);

    const files = fs.readdirSync(DIR).filter(f => f.endsWith(".sql")).sort();

    for (const file of files) {
        const sql = fs.readFileSync(path.join(DIR, file), "utf8");
        process.stdout.write(`  ${file} ... `);
        try {
            // The trigger files use DELIMITER, which is a client directive the
            // driver does not understand. Split on it and run each block with
            // the statements separated the way the driver expects.
            if (sql.includes("DELIMITER")) {
                const blocks = sql.split(/DELIMITER\s+\$\$|DELIMITER\s+;/);
                for (const block of blocks) {
                    const trimmed = block.trim();
                    if (!trimmed) continue;
                    if (trimmed.includes("$$")) {
                        for (const stmt of trimmed.split("$$")) {
                            if (stmt.trim()) {
                                await conn.query(stmt).catch(e => {
                                    if (e.code === "ER_TRG_ALREADY_EXISTS") return;
                                    throw e;
                                });
                            }
                        }
                    } else {
                        await conn.query(trimmed);
                    }
                }
            } else {
                await conn.query(sql);
            }
            console.log("done");
        } catch (e) {
            console.log("FAILED");
            console.error(`\n${file}: ${e.sqlMessage || e.message}\n`);
            await conn.end();
            process.exit(1);
        }
    }

    const [[{ n }]] = await conn.query(
        `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ?`, [DB]);
    console.log(`\n${files.length} migrations applied. ${n} tables in ${DB}.`);
    console.log(
        `\nNext: grant yourself an engagement role, or the first login returns NO_ENGAGEMENT.`
        + `\nSee the "First run" section of README.md.`);

    await conn.end();
})().catch(e => {
    console.error(e);
    process.exit(1);
});

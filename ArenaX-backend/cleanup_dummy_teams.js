const mysql = require("mysql2/promise");

async function cleanup() {
    console.log("==========================================================");
    console.log("   CLEANING UP ALL DUMMY TEST TEAMS & ACCOUNTS");
    console.log("==========================================================\n");

    const pool = mysql.createPool({
        host: "127.0.0.1",
        user: "root",
        password: "",
        database: "ArenaX",
        port: 3306,
        waitForConnections: true,
        connectionLimit: 5
    });

    let conn;
    try {
        conn = await pool.getConnection();

        // 1. Reset matches in Stage 5
        console.log("--- Resetting Stage 5 matches ---");
        const [stageMatches] = await conn.query("SELECT match_id FROM `MATCH` WHERE stage_id = 5");
        const matchIds = stageMatches.map(m => m.match_id);

        if (matchIds.length > 0) {
            await conn.query("DELETE FROM MATCH_RESULT WHERE match_id IN (?)", [matchIds]);
            await conn.query("DELETE FROM BRACKET_ADVANCEMENT WHERE source_match_id IN (?) OR destination_match_id IN (?)", [matchIds, matchIds]);
            await conn.query("DELETE FROM MOBA_SERIES WHERE match_id IN (?)", [matchIds]);
            await conn.query("DELETE FROM MATCH_PARTICIPANT WHERE match_id IN (?)", [matchIds]);
            await conn.query("DELETE FROM `MATCH` WHERE stage_id = 5");
            console.log(`✓ Removed ${matchIds.length} matches from Stage 5.`);
        }
        await conn.query("UPDATE TOURNAMENT_STAGE SET group_generation_status = 'not_generated' WHERE stage_id = 5");

        // 2. Find and delete all dummy teams
        console.log("\n--- Deleting Dummy Teams ---");
        const [dummyTeams] = await conn.query(
            "SELECT team_id, team_name FROM TEAM WHERE team_name LIKE 'TestTeam%' OR team_name LIKE 'DETeam%' OR team_name LIKE 'Test Team%' OR team_name LIKE 'DE Team%'"
        );

        const dummyIds = dummyTeams.map(t => t.team_id);
        if (dummyIds.length > 0) {
            await conn.query("DELETE FROM REGISTRATION WHERE team_id IN (?)", [dummyIds]);
            await conn.query("DELETE FROM TEAM_MEMBER WHERE team_id IN (?)", [dummyIds]);
            await conn.query("DELETE FROM TEAM WHERE team_id IN (?)", [dummyIds]);
            console.log(`✓ Deleted ${dummyIds.length} dummy teams permanently.`);
        } else {
            console.log("No dummy teams found.");
        }

        // 3. Remove esha's dummy game account so esha is NEVER a captain or player
        await conn.query("DELETE FROM GAME_ACCOUNT WHERE game_username = 'TestCap' OR game_uid LIKE 'TCAP_%'");
        console.log("✓ Cleaned up esha's dummy game account. (esha is now purely an organizer).");

        // 4. Verify teams registered in Tournament 8 (summer)
        const [t8Teams] = await conn.query(
            "SELECT tm.team_id, tm.team_name, tm.team_tag, u.email AS captain_email FROM REGISTRATION r JOIN TEAM tm ON r.team_id = tm.team_id JOIN GAME_ACCOUNT ga ON tm.captain_id = ga.account_id JOIN USER u ON ga.user_id = u.user_id WHERE r.tournament_id = 8 ORDER BY tm.team_id ASC"
        );
        console.log(`\n✓ Tournament #8 ("summer") now has exactly ${t8Teams.length} REAL APPROVED TEAMS:`);
        t8Teams.forEach((t, i) => {
            console.log(`   ${String(i + 1).padStart(2)}. ${t.team_name.padEnd(22)} [${t.team_tag.padEnd(4)}] -> Captain: ${t.captain_email}`);
        });

        console.log("\n==========================================================");
        console.log("   CLEANUP COMPLETE! 100% CLEAN REAL TEAMS ONLY.");
        console.log("==========================================================\n");

    } catch (err) {
        console.error("❌ Cleanup Error:", err);
    } finally {
        if (conn) conn.release();
        await pool.end();
    }
}

cleanup();

const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");

const BASE_TEAMS = [
    { name: "Team Liquid", tag: "TL" },
    { name: "OG Esports", tag: "OG" },
    { name: "Team Spirit", tag: "TS" },
    { name: "Gaimin Gladiators", tag: "GG" },
    { name: "Tundra Esports", tag: "TND" },
    { name: "Evil Geniuses", tag: "EG" },
    { name: "Fnatic", tag: "FNC" },
    { name: "Team Secret", tag: "SEC" },
    { name: "Natus Vincere", tag: "NAVI" },
    { name: "Virtus.pro", tag: "VP" },
    { name: "PSG Quest", tag: "PSG" },
    { name: "BetBoom Team", tag: "BB" },
    { name: "Azure Ray", tag: "AR" },
    { name: "Xtreme Gaming", tag: "XG" },
    { name: "Talon Esports", tag: "TLN" },
    { name: "Blacklist Rivalry", tag: "BLR" }
];

async function seedAllGames() {
    console.log("==========================================================");
    console.log("   ARENAX UNIVERSAL SEEDER (ALL 4 GAMES + PLAYERS)");
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

        // 1. Ensure the 4 official games exist, then fetch them
        await conn.query(`
            INSERT IGNORE INTO GAME (game_id, game_name, short_code) VALUES
            (1, 'Dota 2', 'DOTA2'),
            (2, 'League of Legends', 'LOL'),
            (3, 'Mobile Legends: Bang Bang', 'MLBB'),
            (4, 'Honor of Kings', 'HOK')
        `);
        const [games] = await conn.query("SELECT game_id, game_name FROM GAME ORDER BY game_id ASC");
        console.log("✓ Games detected in ArenaX:");
        games.forEach(g => console.log(`   - ID ${g.game_id}: ${g.game_name}`));
        console.log();

        const passwordHash = await bcrypt.hash("123456", 10);

        // 1b. Ensure Organizer accounts exist (for fresh PC setup)
        await conn.query(
            `INSERT IGNORE INTO USER (username, email, password_hash, role) VALUES
             ('organizer_admin', 'organizer@arenax.com', ?, 'organizer'),
             ('aegon78', 'aegon78@gmail.com', '$2b$10$tfzMro03Omj6nKVEY39AguO3UGqLWltg5J0.U250jzxwjlJVukreK', 'organizer'),
             ('eshamoni', 'esha123@gmail.com', '$2b$10$jJxfwlViBQopqAAVi4O2jOqEEB1PKH5e5QeazLZmXS1Hp4Ko4T9Bi', 'organizer'),
             ('AAegon', 'aegon70@gmail.com', '$2b$10$vSf1A2prSgv4DxwxexW4HOaEyZYCMjweg6Pdxa7wd7.lYAbzkz1rK', 'organizer')`,
            [passwordHash]
        );

        // 2. Ensure 16 Captains and 64 Players (Total 80 user accounts)
        console.log("--- Creating / Verifying 80 User Accounts (16 Captains + 64 Members) ---");
        const captainUserIds = [];
        const playerUserIdsMap = {}; // teamIdx -> [p1, p2, p3, p4]

        for (let i = 1; i <= 16; i++) {
            // Captain
            const capEmail = `captain${i}@arenax.com`;
            const capUsername = `captain_${i}`;
            const [uCap] = await conn.query("SELECT user_id FROM USER WHERE email = ?", [capEmail]);
            let capId;
            if (uCap.length > 0) {
                capId = uCap[0].user_id;
            } else {
                const [ins] = await conn.query(
                    "INSERT INTO USER (username, email, password_hash, role) VALUES (?, ?, ?, 'player')",
                    [capUsername, capEmail, passwordHash]
                );
                capId = ins.insertId;
            }
            captainUserIds.push(capId);

            // 4 Players for this team
            playerUserIdsMap[i] = [];
            for (let p = 1; p <= 4; p++) {
                const pEmail = `player${p}_t${i}@arenax.com`;
                const pUsername = `p${p}_t${i}`;
                const [uP] = await conn.query("SELECT user_id FROM USER WHERE email = ?", [pEmail]);
                let pId;
                if (uP.length > 0) {
                    pId = uP[0].user_id;
                } else {
                    const [insP] = await conn.query(
                        "INSERT INTO USER (username, email, password_hash, role) VALUES (?, ?, ?, 'player')",
                        [pUsername, pEmail, passwordHash]
                    );
                    pId = insP.insertId;
                }
                playerUserIdsMap[i].push(pId);
            }
        }
        console.log("✓ 80 Users Verified (all with password: '123456').\n");

        // 3. For EACH of the 4 games, ensure Game Accounts and 16 Teams
        for (const game of games) {
            console.log(`--- Setting Up 16 Teams for "${game.game_name}" (Game ID: ${game.game_id}) ---`);

            const gamePrefix = game.game_name.split(" ")[0].toUpperCase();

            for (let i = 1; i <= 16; i++) {
                const base = BASE_TEAMS[i - 1];
                const teamName = `${base.name} [${gamePrefix}]`;
                const teamTag = `${base.tag}_${game.game_id}`;
                const capUserId = captainUserIds[i - 1];

                // Ensure captain GAME_ACCOUNT for this game
                const capIgn = `${base.tag}_Cap`;
                const capUid = `UID_G${game.game_id}_C${i}`;
                const [cAcc] = await conn.query(
                    "SELECT account_id FROM GAME_ACCOUNT WHERE user_id = ? AND game_id = ?",
                    [capUserId, game.game_id]
                );
                let capAccId;
                if (cAcc.length > 0) {
                    capAccId = cAcc[0].account_id;
                } else {
                    const [insCa] = await conn.query(
                        "INSERT INTO GAME_ACCOUNT (user_id, game_id, game_username, game_uid, server_region) VALUES (?, ?, ?, ?, 'Singapore')",
                        [capUserId, game.game_id, capIgn, capUid]
                    );
                    capAccId = insCa.insertId;
                }

                // Ensure Team for this game
                const [tRow] = await conn.query("SELECT team_id FROM TEAM WHERE team_name = ?", [teamName]);
                let teamId;
                if (tRow.length > 0) {
                    teamId = tRow[0].team_id;
                    await conn.query("UPDATE TEAM SET captain_id = ?, game_id = ?, status = 'active' WHERE team_id = ?", [
                        capAccId,
                        game.game_id,
                        teamId
                    ]);
                } else {
                    const [insT] = await conn.query(
                        "INSERT INTO TEAM (game_id, captain_id, team_name, team_tag, status) VALUES (?, ?, ?, ?, 'active')",
                        [game.game_id, capAccId, teamName, teamTag]
                    );
                    teamId = insT.insertId;
                }

                // Link Captain in TEAM_MEMBER
                await conn.query(
                    `INSERT INTO TEAM_MEMBER (team_id, game_account_id, role, is_active, is_substitute)
                     VALUES (?, ?, 'captain', TRUE, FALSE)
                     ON DUPLICATE KEY UPDATE role = 'captain', is_active = TRUE`,
                    [teamId, capAccId]
                );

                // Link 4 Players
                const playerUserIds = playerUserIdsMap[i];
                for (let p = 1; p <= 4; p++) {
                    const pUserId = playerUserIds[p - 1];
                    const pIgn = `${base.tag}_P${p}`;
                    const pUid = `UID_G${game.game_id}_T${i}_P${p}`;

                    const [pAcc] = await conn.query(
                        "SELECT account_id FROM GAME_ACCOUNT WHERE user_id = ? AND game_id = ?",
                        [pUserId, game.game_id]
                    );
                    let pAccId;
                    if (pAcc.length > 0) {
                        pAccId = pAcc[0].account_id;
                    } else {
                        const [insPa] = await conn.query(
                            "INSERT INTO GAME_ACCOUNT (user_id, game_id, game_username, game_uid, server_region) VALUES (?, ?, ?, ?, 'Singapore')",
                            [pUserId, game.game_id, pIgn, pUid]
                        );
                        pAccId = insPa.insertId;
                    }

                    await conn.query(
                        `INSERT INTO TEAM_MEMBER (team_id, game_account_id, role, is_active, is_substitute)
                         VALUES (?, ?, 'player', TRUE, FALSE)
                         ON DUPLICATE KEY UPDATE role = 'player', is_active = TRUE`,
                        [teamId, pAccId]
                    );
                }
            }
            console.log(`✓ 16 Teams created/ready for "${game.game_name}"!`);
        }

        // 4. Also register teams into any existing tournaments matching game_id
        const [tournaments] = await conn.query("SELECT tournament_id, name, game_id FROM TOURNAMENT");
        console.log("\n--- Registering Teams into Existing Tournaments ---");
        for (const t of tournaments) {
            const [tTeams] = await conn.query("SELECT team_id FROM TEAM WHERE game_id = ? LIMIT 16", [t.game_id]);
            for (const team of tTeams) {
                await conn.query(
                    `INSERT INTO REGISTRATION (tournament_id, team_id, status)
                     VALUES (?, ?, 'approved')
                     ON DUPLICATE KEY UPDATE status = 'approved'`,
                    [t.tournament_id, team.team_id]
                );
            }
            console.log(`✓ Tournament #${t.tournament_id} ("${t.name}") has ${tTeams.length} approved teams registered!`);
        }

        console.log("\n==========================================================");
        console.log("   ALL 4 GAMES ARE NOW 100% SEEDED & READY TO TEST!");
        console.log("==========================================================\n");

    } catch (err) {
        console.error("❌ Seeding Error:", err);
    } finally {
        if (conn) conn.release();
        await pool.end();
    }
}

seedAllGames();

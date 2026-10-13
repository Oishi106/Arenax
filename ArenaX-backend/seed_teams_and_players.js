const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");

const TEAMS_DATA = [
    { name: "Team Liquid", tag: "TL", captainName: "Liquid_Nisha" },
    { name: "OG Esports", tag: "OG", captainName: "OG_Ceb" },
    { name: "Team Spirit", tag: "TS", captainName: "Spirit_Yatoro" },
    { name: "Gaimin Gladiators", tag: "GG", captainName: "GG_Quinn" },
    { name: "Tundra Esports", tag: "TND", captainName: "Tundra_Topson" },
    { name: "Evil Geniuses", tag: "EG", captainName: "EG_Cr1t" },
    { name: "Fnatic", tag: "FNC", captainName: "FNC_Raven" },
    { name: "Team Secret", tag: "SEC", captainName: "Secret_Puppey" },
    { name: "Natus Vincere", tag: "NAVI", captainName: "NAVI_Dendi" },
    { name: "Virtus.pro", tag: "VP", captainName: "VP_Fng" },
    { name: "PSG Quest", tag: "PSG", captainName: "PSG_Noone" },
    { name: "BetBoom Team", tag: "BB", captainName: "BB_TORONTOTOKYO" },
    { name: "Azure Ray", tag: "AR", captainName: "AR_Somnus" },
    { name: "Xtreme Gaming", tag: "XG", captainName: "XG_Ame" },
    { name: "Talon Esports", tag: "TLN", captainName: "TLN_23savage" },
    { name: "Blacklist Rivalry", tag: "BLR", captainName: "BLR_Abed" }
];

async function seed() {
    // Target Tournament ID from command line argument or default to 8
    const targetTournamentId = Number(process.argv[2]) || 8;
    const teamCount = Number(process.argv[3]) || 16;

    console.log("==========================================================");
    console.log(`   ARENAX AUTOMATED TEST DATA SEEDER`);
    console.log(`   Target Tournament: #${targetTournamentId} | Teams to create: ${teamCount}`);
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

        // 1. Verify tournament exists
        const [tournaments] = await conn.query(
            "SELECT tournament_id, name, game_id, status FROM TOURNAMENT WHERE tournament_id = ?",
            [targetTournamentId]
        );
        if (tournaments.length === 0) {
            throw new Error(`Tournament #${targetTournamentId} not found in database!`);
        }
        const tournament = tournaments[0];
        console.log(`✓ Seeding for Tournament: "${tournament.name}" (ID: ${tournament.tournament_id}, Game ID: ${tournament.game_id})`);

        // Common password hash for '123456'
        const passwordHash = await bcrypt.hash("123456", 10);

        const createdCaptains = [];

        for (let i = 0; i < teamCount; i++) {
            const teamMeta = TEAMS_DATA[i] || {
                name: `Pro Team ${i + 1}`,
                tag: `PT${i + 1}`,
                captainName: `Captain_${i + 1}`
            };

            const captainEmail = `captain${i + 1}@arenax.com`;
            const captainUsername = `captain_${i + 1}`;

            // Check if captain user already exists
            const [existingUser] = await conn.query("SELECT user_id FROM USER WHERE email = ?", [captainEmail]);
            let captainUserId;
            if (existingUser.length > 0) {
                captainUserId = existingUser[0].user_id;
            } else {
                const [uRes] = await conn.query(
                    "INSERT INTO USER (username, email, password_hash, role) VALUES (?, ?, ?, 'player')",
                    [captainUsername, captainEmail, passwordHash]
                );
                captainUserId = uRes.insertId;
            }

            // Check / create captain's GAME_ACCOUNT
            const captainUid = `UID_CAP_${i + 1}`;
            const [existingAcc] = await conn.query(
                "SELECT account_id FROM GAME_ACCOUNT WHERE user_id = ? AND game_id = ?",
                [captainUserId, tournament.game_id]
            );
            let captainAccountId;
            if (existingAcc.length > 0) {
                captainAccountId = existingAcc[0].account_id;
            } else {
                const [accRes] = await conn.query(
                    "INSERT INTO GAME_ACCOUNT (user_id, game_id, game_username, game_uid, server_region) VALUES (?, ?, ?, ?, 'Singapore')",
                    [captainUserId, tournament.game_id, teamMeta.captainName, captainUid]
                );
                captainAccountId = accRes.insertId;
            }

            // Check / create Team
            const [existingTeam] = await conn.query("SELECT team_id FROM TEAM WHERE team_name = ?", [teamMeta.name]);
            let teamId;
            if (existingTeam.length > 0) {
                teamId = existingTeam[0].team_id;
                await conn.query("UPDATE TEAM SET captain_id = ?, game_id = ? WHERE team_id = ?", [
                    captainAccountId,
                    tournament.game_id,
                    teamId
                ]);
            } else {
                const [teamRes] = await conn.query(
                    "INSERT INTO TEAM (game_id, captain_id, team_name, team_tag, status) VALUES (?, ?, ?, ?, 'active')",
                    [tournament.game_id, captainAccountId, teamMeta.name, teamMeta.tag]
                );
                teamId = teamRes.insertId;
            }

            // Add Captain to TEAM_MEMBER
            await conn.query(
                `INSERT INTO TEAM_MEMBER (team_id, game_account_id, role, is_active, is_substitute)
                 VALUES (?, ?, 'captain', TRUE, FALSE)
                 ON DUPLICATE KEY UPDATE role = 'captain', is_active = TRUE`,
                [teamId, captainAccountId]
            );

            // Create 4 other players for this team to complete a 5-man roster
            for (let p = 1; p <= 4; p++) {
                const playerEmail = `player${p}_t${i + 1}@arenax.com`;
                const playerUsername = `p${p}_t${i + 1}`;
                const playerUid = `UID_P${p}_T${i + 1}`;

                const [pUser] = await conn.query("SELECT user_id FROM USER WHERE email = ?", [playerEmail]);
                let pUserId;
                if (pUser.length > 0) {
                    pUserId = pUser[0].user_id;
                } else {
                    const [puRes] = await conn.query(
                        "INSERT INTO USER (username, email, password_hash, role) VALUES (?, ?, ?, 'player')",
                        [playerUsername, playerEmail, passwordHash]
                    );
                    pUserId = puRes.insertId;
                }

                const [pAcc] = await conn.query(
                    "SELECT account_id FROM GAME_ACCOUNT WHERE user_id = ? AND game_id = ?",
                    [pUserId, tournament.game_id]
                );
                let pAccountId;
                if (pAcc.length > 0) {
                    pAccountId = pAcc[0].account_id;
                } else {
                    const [paRes] = await conn.query(
                        "INSERT INTO GAME_ACCOUNT (user_id, game_id, game_username, game_uid, server_region) VALUES (?, ?, ?, ?, 'Singapore')",
                        [pUserId, tournament.game_id, `${teamMeta.tag}_Player${p}`, playerUid]
                    );
                    pAccountId = paRes.insertId;
                }

                await conn.query(
                    `INSERT INTO TEAM_MEMBER (team_id, game_account_id, role, is_active, is_substitute)
                     VALUES (?, ?, 'player', TRUE, FALSE)
                     ON DUPLICATE KEY UPDATE role = 'player', is_active = TRUE`,
                    [teamId, pAccountId]
                );
            }

            // Register team in target tournament with status = 'approved'
            await conn.query(
                `INSERT INTO REGISTRATION (tournament_id, team_id, status)
                 VALUES (?, ?, 'approved')
                 ON DUPLICATE KEY UPDATE status = 'approved'`,
                [targetTournamentId, teamId]
            );

            createdCaptains.push({
                index: i + 1,
                teamName: teamMeta.name,
                teamTag: teamMeta.tag,
                captainEmail: captainEmail,
                captainInGame: teamMeta.captainName
            });
        }

        console.log(`\n✓ SUCCESS! Created ${teamCount} Full Teams (each with 5 members = ${teamCount * 5} player accounts).`);
        console.log(`✓ All ${teamCount} teams are registered and APPROVED in Tournament #${targetTournamentId}!\n`);

        console.log("--------------------------------------------------------------------------------------");
        console.log("| #  | Team Name              | Tag   | Captain Email          | Password | In-Game Name   |");
        console.log("--------------------------------------------------------------------------------------");
        createdCaptains.forEach(c => {
            const padTeam = c.teamName.padEnd(22);
            const padTag = c.teamTag.padEnd(5);
            const padEmail = c.captainEmail.padEnd(22);
            const padIGN = c.captainInGame.padEnd(14);
            const padIdx = String(c.index).padStart(2);
            console.log(`| ${padIdx} | ${padTeam} | ${padTag} | ${padEmail} | 123456   | ${padIGN} |`);
        });
        console.log("--------------------------------------------------------------------------------------\n");

    } catch (err) {
        console.error("❌ Seeding Error:", err);
    } finally {
        if (conn) conn.release();
        await pool.end();
    }
}

seed();

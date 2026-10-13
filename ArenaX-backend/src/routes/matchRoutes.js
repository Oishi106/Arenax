const express = require("express");
const db = require("../config/db");
const { requireAuth, requireRole } = require("../middleware/authmiddleware");

const router = express.Router();

/**
 * Shared helper: Check if a user is captain of a team registered as a match participant
 */
async function isUserCaptainOfMatchParticipant(matchId, userId, connection) {
    const queryClient = connection || db.promise();
    const [rows] = await queryClient.query(
        `SELECT mp.registration_id, r.team_id
         FROM MATCH_PARTICIPANT mp
         JOIN REGISTRATION r ON mp.registration_id = r.registration_id
         JOIN TEAM tm ON r.team_id = tm.team_id
         LEFT JOIN GAME_ACCOUNT ga ON tm.captain_id = ga.account_id
         LEFT JOIN TEAM_MEMBER tmem ON tm.team_id = tmem.team_id AND tmem.role = 'captain'
         LEFT JOIN GAME_ACCOUNT ga_mem ON tmem.game_account_id = ga_mem.account_id
         WHERE mp.match_id = ? AND (ga.user_id = ? OR ga_mem.user_id = ?)`,
        [matchId, userId, userId]
    );
    return rows.length > 0;
}

/**
 * POST /api/matches/:matchId/result
 * Team Captain endpoint to submit a match result.
 * Must be captain of one of the participating teams.
 */
router.post("/:matchId/result", requireAuth, async (req, res) => {
    const matchId = req.params.matchId;
    const userId = req.session.userId;
    const winnerRegId = req.body.winner_registration_id || req.body.winning_registration_id;
    const teamAKills = req.body.team_a_kills;
    const teamBKills = req.body.team_b_kills;
    const evidenceUrl = req.body.evidence || req.body.evidence_url;

    // 1. Input validation
    if (winnerRegId === undefined || teamAKills === undefined || teamBKills === undefined || !evidenceUrl) {
        return res.status(400).json({
            error: "WINNING REGISTRATION ID, TEAM A KILLS, TEAM B KILLS, AND EVIDENCE ARE REQUIRED",
            code: "INVALID_INPUT"
        });
    }

    const killsA = Number(teamAKills);
    const killsB = Number(teamBKills);
    const winnerId = Number(winnerRegId);

    if (!Number.isInteger(killsA) || killsA < 0 || !Number.isInteger(killsB) || killsB < 0) {
        return res.status(400).json({
            error: "TEAM KILLS MUST BE NON-NEGATIVE INTEGERS",
            code: "INVALID_INPUT"
        });
    }

    let conn;
    try {
        conn = await db.promise().getConnection();
        await conn.beginTransaction();

        // 2. Fetch match and verify it exists & tournament is live
        const [matches] = await conn.query(
            `SELECT m.match_id, m.stage_id, m.group_id, m.status, ts.tournament_id, t.status AS tournament_status
             FROM \`MATCH\` m
             JOIN TOURNAMENT_STAGE ts ON m.stage_id = ts.stage_id
             JOIN TOURNAMENT t ON ts.tournament_id = t.tournament_id
             WHERE m.match_id = ? FOR UPDATE`,
            [matchId]
        );

        if (matches.length === 0) {
            await conn.rollback();
            return res.status(404).json({
                error: "MATCH NOT FOUND",
                code: "NOT_FOUND"
            });
        }

        const match = matches[0];

        // Ensure tournament is live before accepting any match results
        if (match.tournament_status !== "live") {
            await conn.rollback();
            return res.status(409).json({
                error: `CANNOT SUBMIT RESULT: TOURNAMENT IS CURRENTLY '${match.tournament_status.toUpperCase()}'. MATCH RESULTS CAN ONLY BE SUBMITTED WHEN THE TOURNAMENT IS 'LIVE'.`,
                code: "TOURNAMENT_NOT_LIVE"
            });
        }

        if (match.status === "completed") {
            await conn.rollback();
            return res.status(409).json({
                error: "MATCH RESULT HAS ALREADY BEEN VERIFIED AND COMPLETED",
                code: "STATE_CONFLICT"
            });
        }

        // 3. Fetch match participants & verify winner
        const [participants] = await conn.query(
            `SELECT registration_id, side FROM MATCH_PARTICIPANT WHERE match_id = ? FOR UPDATE`,
            [matchId]
        );

        if (participants.length !== 2) {
            await conn.rollback();
            return res.status(400).json({
                error: "MATCH DOES NOT HAVE EXACTLY 2 PARTICIPANTS",
                code: "INVALID_INPUT"
            });
        }

        const validWinner = participants.some((p) => p.registration_id === winnerId);
        if (!validWinner) {
            await conn.rollback();
            return res.status(400).json({
                error: "SUBMITTED WINNER IS NOT A PARTICIPANT IN THIS MATCH",
                code: "INVALID_INPUT"
            });
        }

        // 4. Verify user is captain of a participating team
        const isCaptain = await isUserCaptainOfMatchParticipant(matchId, userId, conn);
        if (!isCaptain) {
            await conn.rollback();
            return res.status(403).json({
                error: "ONLY A CAPTAIN OF A PARTICIPATING TEAM MAY SUBMIT MATCH RESULTS",
                code: "FORBIDDEN"
            });
        }

        // 5. Check if result already submitted/verified
        const [existingResults] = await conn.query(
            `SELECT result_id, status FROM MATCH_RESULT WHERE match_id = ? FOR UPDATE`,
            [matchId]
        );

        if (existingResults.length > 0) {
            const existingStatus = existingResults[0].status.toUpperCase();
            if (existingStatus === "VERIFIED") {
                await conn.rollback();
                return res.status(409).json({
                    error: "MATCH RESULT IS ALREADY VERIFIED",
                    code: "STATE_CONFLICT"
                });
            } else if (existingStatus === "SUBMITTED") {
                await conn.rollback();
                return res.status(409).json({
                    error: "A MATCH RESULT HAS ALREADY BEEN SUBMITTED AND IS AWAITING ORGANIZER REVIEW",
                    code: "STATE_CONFLICT"
                });
            }
        }

        // 6. Insert new match result
        const [insertRes] = await conn.query(
            `INSERT INTO MATCH_RESULT (match_id, submitted_by, winning_registration_id, team_a_kills, team_b_kills, evidence_url, status, submitted_at)
             VALUES (?, ?, ?, ?, ?, ?, 'SUBMITTED', CURRENT_TIMESTAMP)`,
            [matchId, userId, winnerId, killsA, killsB, evidenceUrl]
        );

        await conn.commit();

        return res.status(201).json({
            message: "Match result submitted",
            result: {
                result_id: insertRes.insertId,
                match_id: Number(matchId),
                winning_registration_id: winnerId,
                team_a_kills: killsA,
                team_b_kills: killsB,
                evidence_url: evidenceUrl,
                status: "SUBMITTED"
            }
        });
    } catch (err) {
        if (conn) await conn.rollback();
        console.error(err);
        return res.status(500).json({
            error: "FAILED TO SUBMIT MATCH RESULT",
            code: "INTERNAL_SERVER_ERROR"
        });
    } finally {
        if (conn) conn.release();
    }
});

/**
 * GET /api/matches/:matchId/result
 * Get current result status for a match
 */
router.get("/:matchId/result", requireAuth, async (req, res) => {
    const matchId = req.params.matchId;

    try {
        const [results] = await db.promise().query(
            `SELECT mr.result_id, mr.match_id, mr.submitted_by, mr.winning_registration_id,
                    mr.team_a_kills, mr.team_b_kills, mr.evidence_url, mr.status, mr.submitted_at,
                    mr.verified_by, mr.verified_at,
                    u.username AS submitted_by_username
             FROM MATCH_RESULT mr
             JOIN USER u ON mr.submitted_by = u.user_id
             WHERE mr.match_id = ?`,
            [matchId]
        );

        if (results.length === 0) {
            return res.status(404).json({
                error: "NO RESULT SUBMITTED FOR THIS MATCH",
                code: "NOT_FOUND"
            });
        }

        return res.status(200).json({
            result: results[0]
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({
            error: "FAILED TO FETCH MATCH RESULT",
            code: "INTERNAL_SERVER_ERROR"
        });
    }
});

/**
 * PUT /api/matches/:matchId/result/verify
 * Organizer-only endpoint to verify and confirm a submitted match result.
 */
router.put("/:matchId/result/verify", requireAuth, requireRole("organizer"), async (req, res) => {
    const matchId = req.params.matchId;
    const organizerId = req.session.userId;
    const { winner_registration_id, winning_registration_id, team_a_kills, team_b_kills } = req.body;

    let conn;
    try {
        conn = await db.promise().getConnection();
        await conn.beginTransaction();

        // 1. Fetch match & tournament ownership
        const [matches] = await conn.query(
            `SELECT m.match_id, m.stage_id, m.group_id, m.status, t.organizer_id
             FROM \`MATCH\` m
             JOIN TOURNAMENT_STAGE ts ON m.stage_id = ts.stage_id
             JOIN TOURNAMENT t ON ts.tournament_id = t.tournament_id
             WHERE m.match_id = ? FOR UPDATE`,
            [matchId]
        );

        if (matches.length === 0) {
            await conn.rollback();
            return res.status(404).json({
                error: "MATCH NOT FOUND",
                code: "NOT_FOUND"
            });
        }

        const match = matches[0];

        if (match.organizer_id !== organizerId) {
            await conn.rollback();
            return res.status(403).json({
                error: "YOU DO NOT OWN THIS TOURNAMENT",
                code: "FORBIDDEN"
            });
        }

        // 2. Fetch submitted match result
        const [results] = await conn.query(
            `SELECT result_id, winning_registration_id, team_a_kills, team_b_kills, status
             FROM MATCH_RESULT
             WHERE match_id = ? FOR UPDATE`,
            [matchId]
        );

        if (results.length === 0) {
            await conn.rollback();
            return res.status(404).json({
                error: "NO SUBMITTED RESULT FOUND TO VERIFY FOR THIS MATCH",
                code: "NOT_FOUND"
            });
        }

        const currentResult = results[0];

        if (currentResult.status.toUpperCase() === "VERIFIED") {
            await conn.rollback();
            return res.status(409).json({
                error: "MATCH RESULT IS ALREADY VERIFIED",
                code: "STATE_CONFLICT"
            });
        }

        // 3. Determine official winner & kills (allow organizer overrides if provided)
        const [participants] = await conn.query(
            `SELECT registration_id, side FROM MATCH_PARTICIPANT WHERE match_id = ? FOR UPDATE`,
            [matchId]
        );

        let finalWinnerId = currentResult.winning_registration_id;
        let finalKillsA = currentResult.team_a_kills;
        let finalKillsB = currentResult.team_b_kills;

        const reqWinner = winner_registration_id || winning_registration_id;
        if (reqWinner !== undefined) {
            const wId = Number(reqWinner);
            if (!participants.some((p) => p.registration_id === wId)) {
                await conn.rollback();
                return res.status(400).json({
                    error: "VERIFIED WINNER IS NOT A MATCH PARTICIPANT",
                    code: "INVALID_INPUT"
                });
            }
            finalWinnerId = wId;
        }

        if (team_a_kills !== undefined) {
            const kA = Number(team_a_kills);
            if (!Number.isInteger(kA) || kA < 0) {
                await conn.rollback();
                return res.status(400).json({
                    error: "TEAM A KILLS MUST BE A NON-NEGATIVE INTEGER",
                    code: "INVALID_INPUT"
                });
            }
            finalKillsA = kA;
        }

        if (team_b_kills !== undefined) {
            const kB = Number(team_b_kills);
            if (!Number.isInteger(kB) || kB < 0) {
                await conn.rollback();
                return res.status(400).json({
                    error: "TEAM B KILLS MUST BE A NON-NEGATIVE INTEGER",
                    code: "INVALID_INPUT"
                });
            }
            finalKillsB = kB;
        }

        // 4. Update MATCH_RESULT to VERIFIED
        await conn.query(
            `UPDATE MATCH_RESULT
             SET status = 'VERIFIED',
                 winning_registration_id = ?,
                 team_a_kills = ?,
                 team_b_kills = ?,
                 verified_by = ?,
                 verified_at = CURRENT_TIMESTAMP
             WHERE match_id = ?`,
            [finalWinnerId, finalKillsA, finalKillsB, organizerId, matchId]
        );

        // 5. Update MATCH to completed
        await conn.query(
            `UPDATE \`MATCH\` SET status = 'completed' WHERE match_id = ?`,
            [matchId]
        );

        // 6. Process BRACKET_ADVANCEMENT for playoff matches if present
        const [advancements] = await conn.query(
            `SELECT advancement_id, source_match_id, destination_match_id, outcome_type, destination_side
             FROM BRACKET_ADVANCEMENT
             WHERE source_match_id = ?`,
            [matchId]
        );

        if (advancements.length > 0) {
            const losingRegistrationId = participants.find((p) => p.registration_id !== finalWinnerId)?.registration_id;

            for (const adv of advancements) {
                const targetRegId = adv.outcome_type === "winner" ? finalWinnerId : losingRegistrationId;

                if (targetRegId) {
                    // Prevent duplicate key errors by removing any existing row for this side or team in destination match
                    await conn.query(
                        `DELETE FROM MATCH_PARTICIPANT WHERE match_id = ? AND (side = ? OR registration_id = ?)`,
                        [adv.destination_match_id, adv.destination_side, targetRegId]
                    );

                    await conn.query(
                        `INSERT INTO MATCH_PARTICIPANT (match_id, registration_id, side)
                         VALUES (?, ?, ?)`,
                        [adv.destination_match_id, targetRegId, adv.destination_side]
                    );

                    const [destParts] = await conn.query(
                        `SELECT COUNT(*) AS cnt FROM MATCH_PARTICIPANT WHERE match_id = ?`,
                        [adv.destination_match_id]
                    );

                    if (destParts[0].cnt === 2) {
                        await conn.query(
                            `UPDATE \`MATCH\` SET status = 'scheduled' WHERE match_id = ? AND status = 'scheduled'`,
                            [adv.destination_match_id]
                        );
                    }
                }
            }
        }

        await conn.commit();

        return res.status(200).json({
            message: "Match result verified",
            verified: true,
            result: {
                status: "VERIFIED",
                match_id: Number(matchId),
                winning_registration_id: finalWinnerId,
                winner_team_id: finalWinnerId,
                team_a_kills: finalKillsA,
                team_b_kills: finalKillsB,
                verified_by: organizerId
            }
        });
    } catch (err) {
        if (conn) await conn.rollback();
        console.error(err);
        return res.status(500).json({
            error: "FAILED TO VERIFY MATCH RESULT",
            code: "INTERNAL_SERVER_ERROR"
        });
    } finally {
        if (conn) conn.release();
    }
});

/**
 * PUT /api/matches/:matchId/result/reject
 * Organizer-only endpoint to reject a submitted match result.
 * Removes submitted result & evidence, allowing a fresh captain submission.
 */
router.put("/:matchId/result/reject", requireAuth, requireRole("organizer"), async (req, res) => {
    const matchId = req.params.matchId;
    const organizerId = req.session.userId;

    let conn;
    try {
        conn = await db.promise().getConnection();
        await conn.beginTransaction();

        // 1. Fetch match & tournament ownership
        const [matches] = await conn.query(
            `SELECT m.match_id, m.stage_id, m.group_id, m.status, t.organizer_id
             FROM \`MATCH\` m
             JOIN TOURNAMENT_STAGE ts ON m.stage_id = ts.stage_id
             JOIN TOURNAMENT t ON ts.tournament_id = t.tournament_id
             WHERE m.match_id = ? FOR UPDATE`,
            [matchId]
        );

        if (matches.length === 0) {
            await conn.rollback();
            return res.status(404).json({
                error: "MATCH NOT FOUND",
                code: "NOT_FOUND"
            });
        }

        const match = matches[0];

        if (match.organizer_id !== organizerId) {
            await conn.rollback();
            return res.status(403).json({
                error: "YOU DO NOT OWN THIS TOURNAMENT",
                code: "FORBIDDEN"
            });
        }

        // 2. Fetch submitted match result
        const [results] = await conn.query(
            `SELECT result_id, status FROM MATCH_RESULT WHERE match_id = ? FOR UPDATE`,
            [matchId]
        );

        if (results.length === 0) {
            await conn.rollback();
            return res.status(404).json({
                error: "NO SUBMITTED RESULT FOUND TO REJECT FOR THIS MATCH",
                code: "NOT_FOUND"
            });
        }

        const currentResult = results[0];

        if (currentResult.status.toUpperCase() === "VERIFIED") {
            await conn.rollback();
            return res.status(409).json({
                error: "CANNOT REJECT AN ALREADY VERIFIED RESULT",
                code: "STATE_CONFLICT"
            });
        }

        // 3. Delete/revoke result row
        await conn.query(`DELETE FROM MATCH_RESULT WHERE match_id = ?`, [matchId]);

        // Ensure match remains scheduled/live (not completed)
        if (match.status === "completed") {
            await conn.query(`UPDATE \`MATCH\` SET status = 'scheduled' WHERE match_id = ?`, [matchId]);
        }

        await conn.commit();

        return res.status(200).json({
            message: "Match result rejected",
            verified: false,
            status: "REJECTED"
        });
    } catch (err) {
        if (conn) await conn.rollback();
        console.error(err);
        return res.status(500).json({
            error: "FAILED TO REJECT MATCH RESULT",
            code: "INTERNAL_SERVER_ERROR"
        });
    } finally {
        if (conn) conn.release();
    }
});

/**
 * PUT /api/matches/:matchId/schedule
 * Organizer-only endpoint to update match schedule, lobby code, server region, draft mode, and series BO.
 */
router.put("/:matchId/schedule", requireAuth, requireRole("organizer"), async (req, res) => {
    const matchId = req.params.matchId;
    const organizerId = req.session.userId;
    const { scheduled_time, lobby_code, server_region, draft_mode, best_of } = req.body;

    let conn;
    try {
        conn = await db.promise().getConnection();
        await conn.beginTransaction();

        const [matches] = await conn.query(
            `SELECT m.match_id, m.stage_id, m.status, t.organizer_id
             FROM \`MATCH\` m
             JOIN TOURNAMENT_STAGE ts ON m.stage_id = ts.stage_id
             JOIN TOURNAMENT t ON ts.tournament_id = t.tournament_id
             WHERE m.match_id = ? FOR UPDATE`,
            [matchId]
        );

        if (matches.length === 0) {
            await conn.rollback();
            return res.status(404).json({
                error: "MATCH NOT FOUND",
                code: "NOT_FOUND"
            });
        }

        const match = matches[0];
        if (match.organizer_id !== organizerId) {
            await conn.rollback();
            return res.status(403).json({
                error: "YOU DO NOT OWN THIS TOURNAMENT",
                code: "FORBIDDEN"
            });
        }

        // Validate scheduled_time if provided
        let formattedTime = null;
        if (scheduled_time) {
            const parsed = new Date(scheduled_time);
            if (isNaN(parsed.getTime())) {
                await conn.rollback();
                return res.status(400).json({
                    error: "INVALID SCHEDULED TIME FORMAT",
                    code: "INVALID_INPUT"
                });
            }
            formattedTime = parsed.toISOString().slice(0, 19).replace("T", " ");
        }

        const cleanLobbyCode = lobby_code !== undefined ? (lobby_code ? String(lobby_code).trim().slice(0, 20) : null) : undefined;
        const cleanServerRegion = server_region !== undefined ? (server_region ? String(server_region).trim().slice(0, 30) : null) : undefined;
        const cleanDraftMode = draft_mode !== undefined ? (draft_mode ? String(draft_mode).trim().slice(0, 30) : null) : undefined;

        await conn.query(
            `UPDATE \`MATCH\`
             SET scheduled_time = COALESCE(?, scheduled_time),
                 lobby_code = COALESCE(?, lobby_code),
                 server_region = COALESCE(?, server_region),
                 draft_mode = COALESCE(?, draft_mode)
             WHERE match_id = ?`,
            [
                scheduled_time !== undefined ? formattedTime : null,
                cleanLobbyCode,
                cleanServerRegion,
                cleanDraftMode,
                matchId
            ]
        );

        // Explicitly clear field if null or empty string passed
        if (scheduled_time === null || scheduled_time === "") {
            await conn.query(`UPDATE \`MATCH\` SET scheduled_time = NULL WHERE match_id = ?`, [matchId]);
        }
        if (lobby_code === null || lobby_code === "") {
            await conn.query(`UPDATE \`MATCH\` SET lobby_code = NULL WHERE match_id = ?`, [matchId]);
        }
        if (server_region === null || server_region === "") {
            await conn.query(`UPDATE \`MATCH\` SET server_region = NULL WHERE match_id = ?`, [matchId]);
        }
        if (draft_mode === null || draft_mode === "") {
            await conn.query(`UPDATE \`MATCH\` SET draft_mode = NULL WHERE match_id = ?`, [matchId]);
        }

        if (best_of && ["BO1", "BO3", "BO5"].includes(best_of.toUpperCase())) {
            await conn.query(
                `INSERT INTO MOBA_SERIES (match_id, best_of)
                 VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE best_of = VALUES(best_of)`,
                [matchId, best_of.toUpperCase()]
            );
        }

        await conn.commit();

        const [updatedRows] = await db.promise().query(
            `SELECT m.match_id, m.scheduled_time, m.lobby_code, m.server_region, m.draft_mode, ms.best_of
             FROM \`MATCH\` m
             LEFT JOIN MOBA_SERIES ms ON m.match_id = ms.match_id
             WHERE m.match_id = ?`,
            [matchId]
        );

        return res.status(200).json({
            message: "Match schedule and lobby updated successfully",
            match: updatedRows[0]
        });
    } catch (err) {
        if (conn) await conn.rollback();
        console.error(err);
        return res.status(500).json({
            error: "FAILED TO UPDATE MATCH SCHEDULE",
            code: "INTERNAL_SERVER_ERROR"
        });
    } finally {
        if (conn) conn.release();
    }
});

module.exports = router;

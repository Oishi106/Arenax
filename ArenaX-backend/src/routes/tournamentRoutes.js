const express = require("express");
const db = require("../config/db");
const { requireAuth, requireRole } = require("../middleware/authmiddleware");
const { getRegistrationStatus, normalizeTimestamp } = require("../utils/registrationTimeline");
const { validatePrizePool } = require("../utils/prizePoolValidator");

const router = express.Router();

// Only these two formats are allowed (matches TOURNAMENT.format ENUM in the DB)
const VALID_FORMATS = ["single_elimination", "double_elimination"];

// Allowed forward-only lifecycle transitions (matches TOURNAMENT.status ENUM in the DB)
const VALID_STATUS_TRANSITIONS = {
    draft: ["published"],
    published: ["live"],
    live: ["completed"],
    completed: []
};

/**
 * GET /api/tournaments
 * Public browse list — only shows tournaments that are actually announced
 * (published, live, or completed). Draft tournaments are intentionally
 * excluded here so unfinished/unpublished tournaments never leak publicly.
 * Filters: game_id, status
 */
router.get("/", requireAuth, (req, res) => {
    const { game_id, status } = req.query;

    let sql = `
        SELECT
            t.tournament_id,
            t.name,
            t.format,
            t.status,
            t.registration_start_at,
            t.registration_end_at,
            t.prize_pool_usd,
            t.prize_first_usd,
            t.prize_second_usd,
            t.prize_third_usd,
            t.created_at,
            g.game_id,
            g.game_name,
            u.user_id AS organizer_id,
            u.username AS organizer_username,
            (SELECT COUNT(*) FROM TOURNAMENT_STAGE ts WHERE ts.tournament_id = t.tournament_id AND ts.group_generation_status != 'not_generated') AS active_group_stages
        FROM TOURNAMENT t
        JOIN GAME g ON t.game_id = g.game_id
        JOIN USER u ON t.organizer_id = u.user_id
        WHERE t.status IN ('published', 'live', 'completed')
    `;

    const queryParams = [];

    if (game_id) {
        sql += ` AND t.game_id = ?`;
        queryParams.push(game_id);
    }

    if (status) {
        if (!["published", "live", "completed"].includes(status)) {
            return res.status(400).json({
                error: "INVALID STATUS FILTER"
            });
        }
        sql += ` AND t.status = ?`;
        queryParams.push(status);
    }

    sql += ` ORDER BY t.created_at DESC`;

    db.query(sql, queryParams, (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({
                error: "FAILED TO FETCH TOURNAMENTS"
            });
        }

        const enriched = results.map((t) => ({
            ...t,
            prize_pool_usd: t.prize_pool_usd !== null ? Number(t.prize_pool_usd) : null,
            prize_first_usd: t.prize_first_usd !== null ? Number(t.prize_first_usd) : null,
            prize_second_usd: t.prize_second_usd !== null ? Number(t.prize_second_usd) : null,
            prize_third_usd: t.prize_third_usd !== null ? Number(t.prize_third_usd) : null,
            registration_status: getRegistrationStatus(t, t.active_group_stages)
        }));

        return res.status(200).json({
            tournaments: enriched
        });
    });
});

/**
 * GET /api/tournaments/my
 * Organizer-only. Returns every tournament created by the logged-in
 * organizer, including drafts. Must be declared BEFORE "/:id" so Express
 * does not treat "my" as a tournament id.
 */
router.get("/my", requireAuth, requireRole("organizer"), (req, res) => {
    const organizerId = req.session.userId;

    const sql = `
        SELECT
            t.tournament_id,
            t.name,
            t.format,
            t.status,
            t.registration_start_at,
            t.registration_end_at,
            t.prize_pool_usd,
            t.prize_first_usd,
            t.prize_second_usd,
            t.prize_third_usd,
            t.created_at,
            g.game_id,
            g.game_name,
            (SELECT COUNT(*) FROM TOURNAMENT_STAGE ts WHERE ts.tournament_id = t.tournament_id AND ts.group_generation_status != 'not_generated') AS active_group_stages
        FROM TOURNAMENT t
        JOIN GAME g ON t.game_id = g.game_id
        WHERE t.organizer_id = ?
        ORDER BY t.created_at DESC
    `;

    db.query(sql, [organizerId], (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({
                error: "FAILED TO FETCH YOUR TOURNAMENTS"
            });
        }

        const enriched = results.map((t) => ({
            ...t,
            prize_pool_usd: t.prize_pool_usd !== null ? Number(t.prize_pool_usd) : null,
            prize_first_usd: t.prize_first_usd !== null ? Number(t.prize_first_usd) : null,
            prize_second_usd: t.prize_second_usd !== null ? Number(t.prize_second_usd) : null,
            prize_third_usd: t.prize_third_usd !== null ? Number(t.prize_third_usd) : null,
            registration_status: getRegistrationStatus(t, t.active_group_stages)
        }));

        return res.status(200).json({
            tournaments: enriched
        });
    });
});

/**
 * GET /api/tournaments/:id
 * Get one tournament's details.
 * A draft tournament is only visible to the organizer who owns it —
 * everyone else gets 404, so a draft never leaks through direct-id access.
 */
router.get("/:id", requireAuth, (req, res) => {
    const tournamentId = req.params.id;
    const userId = req.session.userId;

    const sql = `
        SELECT
            t.tournament_id,
            t.name,
            t.format,
            t.status,
            t.registration_start_at,
            t.registration_end_at,
            t.prize_pool_usd,
            t.prize_first_usd,
            t.prize_second_usd,
            t.prize_third_usd,
            t.created_at,
            g.game_id,
            g.game_name,
            u.user_id AS organizer_id,
            u.username AS organizer_username,
            (SELECT COUNT(*) FROM TOURNAMENT_STAGE ts WHERE ts.tournament_id = t.tournament_id AND ts.group_generation_status != 'not_generated') AS active_group_stages
        FROM TOURNAMENT t
        JOIN GAME g ON t.game_id = g.game_id
        JOIN USER u ON t.organizer_id = u.user_id
        WHERE t.tournament_id = ?
    `;

    db.query(sql, [tournamentId], (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({
                error: "FAILED TO FETCH TOURNAMENT"
            });
        }

        if (results.length === 0) {
            return res.status(404).json({
                error: "TOURNAMENT NOT FOUND"
            });
        }

        const tournament = results[0];

        const isOwner = tournament.organizer_id === userId;

        if (tournament.status === "draft" && !isOwner) {
            return res.status(404).json({
                error: "TOURNAMENT NOT FOUND"
            });
        }

        tournament.prize_pool_usd = tournament.prize_pool_usd !== null ? Number(tournament.prize_pool_usd) : null;
        tournament.prize_first_usd = tournament.prize_first_usd !== null ? Number(tournament.prize_first_usd) : null;
        tournament.prize_second_usd = tournament.prize_second_usd !== null ? Number(tournament.prize_second_usd) : null;
        tournament.prize_third_usd = tournament.prize_third_usd !== null ? Number(tournament.prize_third_usd) : null;
        tournament.registration_status = getRegistrationStatus(tournament, tournament.active_group_stages);

        return res.status(200).json({
            tournament: tournament
        });
    });
});

/**
 * GET /api/tournaments/:id/hub
 * Returns comprehensive tournament hub data for Groups & Teams, Standings, and Matches tabs:
 * - participants: approved & pending registered teams with full player rosters and group/seed metadata
 * - matches: all matches across all stages (group, play_in, upper, lower, grand_final)
 * - standings: live tournament leaderboard with match W/L, kills, kill diff, bracket status, and placements
 */
router.get("/:id/hub", async (req, res) => {
    const tournamentId = req.params.id;
    const userId = req.session ? req.session.userId : null;

    try {
        const [tournaments] = await db.promise().query(
            `SELECT t.tournament_id, t.name, t.format, t.status,
                    t.prize_pool_usd, t.prize_first_usd, t.prize_second_usd, t.prize_third_usd,
                    t.organizer_id, t.registration_start_at, t.registration_end_at
             FROM TOURNAMENT t
             WHERE t.tournament_id = ?`,
            [tournamentId]
        );

        if (tournaments.length === 0) {
            return res.status(404).json({ error: "TOURNAMENT NOT FOUND" });
        }

        const tournament = tournaments[0];
        const isOwner = Number(tournament.organizer_id) === Number(userId);

        if (tournament.status === "draft" && !isOwner) {
            return res.status(404).json({ error: "TOURNAMENT NOT FOUND" });
        }

        const prizePool = tournament.prize_pool_usd !== null ? Number(tournament.prize_pool_usd) : null;
        const prizeFirst = tournament.prize_first_usd !== null ? Number(tournament.prize_first_usd) : null;
        const prizeSecond = tournament.prize_second_usd !== null ? Number(tournament.prize_second_usd) : null;
        const prizeThird = tournament.prize_third_usd !== null ? Number(tournament.prize_third_usd) : null;

        // 1. Fetch registrations (approved + pending)
        const [regResults] = await db.promise().query(
            `SELECT r.registration_id, r.status, r.seed_number, r.registered_at, r.approved_at,
                    tm.team_id, tm.team_name, tm.team_tag
             FROM REGISTRATION r
             JOIN TEAM tm ON r.team_id = tm.team_id
             WHERE r.tournament_id = ? AND r.status IN ('approved', 'pending')
             ORDER BY FIELD(r.status, 'approved', 'pending'), COALESCE(r.seed_number, 999999) ASC, r.registered_at ASC`,
            [tournamentId]
        );

        // Fetch rosters for all registered teams
        const teamIds = regResults.map((r) => r.team_id);
        const membersByTeam = {};

        if (teamIds.length > 0) {
            const [memberResults] = await db.promise().query(
                `SELECT tm.team_id, tm.member_id, tm.role, tm.assigned_role, tm.is_substitute, tm.is_active,
                        ga.account_id AS game_account_id, ga.game_username, ga.game_uid, ga.server_region,
                        u.user_id, u.username
                 FROM TEAM_MEMBER tm
                 JOIN GAME_ACCOUNT ga ON tm.game_account_id = ga.account_id
                 JOIN USER u ON ga.user_id = u.user_id
                 WHERE tm.team_id IN (?)
                 ORDER BY FIELD(tm.role, 'captain', 'player', 'substitute'), tm.is_substitute ASC, tm.is_active DESC`,
                [teamIds]
            );

            for (const m of memberResults) {
                if (!membersByTeam[m.team_id]) {
                    membersByTeam[m.team_id] = [];
                }
                membersByTeam[m.team_id].push({
                    user_id: m.user_id,
                    username: m.username,
                    game_account_id: m.game_account_id,
                    game_username: m.game_username,
                    game_uid: m.game_uid,
                    server_region: m.server_region,
                    role: m.role,
                    assigned_role: m.assigned_role,
                    is_substitute: Boolean(m.is_substitute),
                    is_active: Boolean(m.is_active)
                });
            }
        }

        // Fetch group membership info if any group stage exists
        const [groupMemberRows] = await db.promise().query(
            `SELECT sgm.registration_id, sgm.slot_number, sgm.final_rank, sgm.qualified, sgm.playoff_seed,
                    sg.group_id, sg.group_name, sg.group_order
             FROM STAGE_GROUP_MEMBER sgm
             JOIN STAGE_GROUP sg ON sgm.group_id = sg.group_id
             JOIN TOURNAMENT_STAGE ts ON sgm.stage_id = ts.stage_id
             WHERE ts.tournament_id = ?`,
            [tournamentId]
        );

        const groupInfoByReg = {};
        groupMemberRows.forEach((gm) => {
            groupInfoByReg[gm.registration_id] = {
                group_id: gm.group_id,
                group_name: gm.group_name,
                group_order: gm.group_order,
                slot_number: gm.slot_number,
                final_rank: gm.final_rank,
                qualified: Boolean(gm.qualified),
                playoff_seed: gm.playoff_seed
            };
        });

        let approvedIndex = 0;
        const participants = regResults.map((r) => {
            const isApproved = r.status === "approved";
            if (isApproved) approvedIndex += 1;
            const gInfo = groupInfoByReg[r.registration_id] || null;
            return {
                registration_id: r.registration_id,
                status: r.status,
                seed_number: r.seed_number || (isApproved ? approvedIndex : null),
                registered_at: r.registered_at,
                approved_at: r.approved_at,
                team_id: r.team_id,
                team_name: r.team_name,
                team_tag: r.team_tag,
                group_info: gInfo,
                roster: membersByTeam[r.team_id] || []
            };
        });

        // 2. Fetch all matches across all stages for this tournament
        const [matchRows] = await db.promise().query(
            `SELECT m.match_id, m.stage_id, m.group_id, m.status, m.round_number, m.bracket_position, m.bracket_type,
                    m.scheduled_time, m.lobby_code, m.server_region, m.draft_mode,
                    ts.stage_name, ts.stage_format, ts.stage_order,
                    sg.group_name,
                    mr.status AS result_status, mr.winning_registration_id,
                    mr.team_a_kills, mr.team_b_kills, mr.evidence_url, mr.submitted_at, mr.verified_at,
                    ms.best_of
             FROM \`MATCH\` m
             JOIN TOURNAMENT_STAGE ts ON m.stage_id = ts.stage_id
             LEFT JOIN STAGE_GROUP sg ON m.group_id = sg.group_id
             LEFT JOIN MATCH_RESULT mr ON m.match_id = mr.match_id
             LEFT JOIN MOBA_SERIES ms ON m.match_id = ms.match_id
             WHERE ts.tournament_id = ?
             ORDER BY ts.stage_order ASC,
                      FIELD(m.bracket_type, 'group', 'play_in', 'upper', 'lower', 'grand_final'),
                      m.round_number ASC,
                      m.bracket_position ASC`,
            [tournamentId]
        );

        const matchIds = matchRows.map((m) => m.match_id);
        const matchPartsMap = new Map();

        if (matchIds.length > 0) {
            const [mpRows] = await db.promise().query(
                `SELECT mp.match_id, mp.registration_id, mp.side, tm.team_id, tm.team_name, tm.team_tag
                 FROM MATCH_PARTICIPANT mp
                 JOIN REGISTRATION r ON mp.registration_id = r.registration_id
                 JOIN TEAM tm ON r.team_id = tm.team_id
                 WHERE mp.match_id IN (?)
                 ORDER BY mp.side ASC`,
                [matchIds]
            );

            mpRows.forEach((p) => {
                if (!matchPartsMap.has(p.match_id)) matchPartsMap.set(p.match_id, []);
                matchPartsMap.get(p.match_id).push({
                    registration_id: p.registration_id,
                    team_id: p.team_id,
                    team_name: p.team_name,
                    team_tag: p.team_tag,
                    side: p.side
                });
            });
        }

        const formattedMatches = matchRows.map((m) => ({
            match_id: m.match_id,
            stage_id: m.stage_id,
            stage_name: m.stage_name,
            stage_format: m.stage_format,
            stage_order: m.stage_order,
            group_id: m.group_id,
            group_name: m.group_name || null,
            bracket_type: m.bracket_type,
            round_number: m.round_number,
            bracket_position: m.bracket_position,
            status: m.status,
            scheduled_time: m.scheduled_time || null,
            lobby_code: m.lobby_code || null,
            server_region: m.server_region || null,
            draft_mode: m.draft_mode || null,
            result_status: m.result_status || null,
            winning_registration_id: m.winning_registration_id || null,
            team_a_kills: m.team_a_kills != null ? Number(m.team_a_kills) : null,
            team_b_kills: m.team_b_kills != null ? Number(m.team_b_kills) : null,
            evidence_url: m.evidence_url || null,
            submitted_at: m.submitted_at || null,
            verified_at: m.verified_at || null,
            best_of: m.best_of || "BO1",
            participants: matchPartsMap.get(m.match_id) || []
        }));

        // 3. Calculate Overall Tournament Standings & Placements for Approved Teams
        const approvedParticipants = participants.filter((p) => p.status === "approved");
        const statsByReg = new Map();

        approvedParticipants.forEach((p) => {
            statsByReg.set(Number(p.registration_id), {
                registration_id: p.registration_id,
                team_id: p.team_id,
                team_name: p.team_name,
                team_tag: p.team_tag,
                seed_number: p.seed_number,
                group_name: p.group_info?.group_name || null,
                played: 0,
                wins: 0,
                losses: 0,
                win_rate: 0,
                total_kills: 0,
                total_conceded: 0,
                kill_difference: 0,
                bracket_status: formattedMatches.length > 0 ? "ACTIVE" : "REGISTERED",
                placement: null,
                placement_label: null,
                prize_usd: null
            });
        });

        // Track highest active bracket type and elimination state per team
        const maxUpperRound = Math.max(0, ...formattedMatches.filter((m) => m.bracket_type === "upper").map((m) => m.round_number || 1));
        const maxLowerRound = Math.max(0, ...formattedMatches.filter((m) => m.bracket_type === "lower").map((m) => m.round_number || 1));
        const hasLowerBracket = formattedMatches.some((m) => m.bracket_type === "lower");

        formattedMatches.forEach((m) => {
            const isVerified = m.status === "completed" || m.result_status === "VERIFIED";
            const sideA = m.participants.find((p) => p.side === "A");
            const sideB = m.participants.find((p) => p.side === "B");

            if (isVerified && m.winning_registration_id && sideA && sideB) {
                const winId = Number(m.winning_registration_id);
                const statA = statsByReg.get(Number(sideA.registration_id));
                const statB = statsByReg.get(Number(sideB.registration_id));
                const killsA = m.team_a_kills != null ? Number(m.team_a_kills) : 0;
                const killsB = m.team_b_kills != null ? Number(m.team_b_kills) : 0;

                if (statA) {
                    statA.played += 1;
                    statA.total_kills += killsA;
                    statA.total_conceded += killsB;
                    if (winId === Number(sideA.registration_id)) {
                        statA.wins += 1;
                    } else {
                        statA.losses += 1;
                    }
                }

                if (statB) {
                    statB.played += 1;
                    statB.total_kills += killsB;
                    statB.total_conceded += killsA;
                    if (winId === Number(sideB.registration_id)) {
                        statB.wins += 1;
                    } else {
                        statB.losses += 1;
                    }
                }

                const loserId = winId === Number(sideA.registration_id) ? Number(sideB.registration_id) : Number(sideA.registration_id);
                const winnerStat = statsByReg.get(winId);
                const loserStat = statsByReg.get(loserId);

                // Determine placements from key elimination matches
                if (m.bracket_type === "grand_final") {
                    if (winnerStat) {
                        winnerStat.placement = 1;
                        winnerStat.placement_label = "1st Place";
                        winnerStat.bracket_status = "CHAMPION";
                    }
                    if (loserStat) {
                        loserStat.placement = 2;
                        loserStat.placement_label = "2nd Place";
                        loserStat.bracket_status = "RUNNER_UP";
                    }
                } else if (m.bracket_type === "lower") {
                    if (loserStat) {
                        if (m.round_number === maxLowerRound) {
                            loserStat.placement = 3;
                            loserStat.placement_label = "3rd Place";
                            loserStat.bracket_status = "3RD_PLACE";
                        } else if (m.round_number === maxLowerRound - 1 && maxLowerRound >= 2) {
                            loserStat.placement = 4;
                            loserStat.placement_label = "4th Place";
                            loserStat.bracket_status = "4TH_PLACE";
                        } else {
                            loserStat.bracket_status = "ELIMINATED";
                        }
                    }
                } else if (m.bracket_type === "play_in") {
                    if (loserStat) {
                        loserStat.bracket_status = "ELIMINATED";
                    }
                } else if (m.bracket_type === "upper" && !hasLowerBracket) {
                    // Single Elimination
                    if (m.round_number === maxUpperRound) {
                        if (winnerStat) {
                            winnerStat.placement = 1;
                            winnerStat.placement_label = "1st Place";
                            winnerStat.bracket_status = "CHAMPION";
                        }
                        if (loserStat) {
                            loserStat.placement = 2;
                            loserStat.placement_label = "2nd Place";
                            loserStat.bracket_status = "RUNNER_UP";
                        }
                    } else if (m.round_number === maxUpperRound - 1 && maxUpperRound >= 2) {
                        if (loserStat) {
                            loserStat.placement = 3;
                            loserStat.placement_label = "3rd-4th Place";
                            loserStat.bracket_status = "SEMIFINALIST";
                        }
                    } else if (loserStat) {
                        loserStat.bracket_status = "ELIMINATED";
                    }
                }
            }
        });

        // For teams not yet eliminated or placed, check their current active match bracket
        formattedMatches.forEach((m) => {
            const isVerified = m.status === "completed" || m.result_status === "VERIFIED";
            if (!isVerified) {
                m.participants.forEach((p) => {
                    const st = statsByReg.get(Number(p.registration_id));
                    if (st && !["CHAMPION", "RUNNER_UP", "3RD_PLACE", "4TH_PLACE", "SEMIFINALIST", "ELIMINATED"].includes(st.bracket_status)) {
                        if (m.bracket_type === "grand_final") {
                            st.bracket_status = "GRAND_FINALIST";
                        } else if (m.bracket_type === "lower") {
                            st.bracket_status = "LOWER_BRACKET";
                        } else if (m.bracket_type === "upper") {
                            st.bracket_status = "UPPER_BRACKET";
                        } else if (m.bracket_type === "play_in") {
                            st.bracket_status = "PLAY_IN";
                        } else if (m.bracket_type === "group") {
                            st.bracket_status = "GROUP_STAGE";
                        }
                    }
                });
            }
        });

        const STATUS_PRIORITY = {
            CHAMPION: 1,
            RUNNER_UP: 2,
            "3RD_PLACE": 3,
            SEMIFINALIST: 3,
            "4TH_PLACE": 4,
            GRAND_FINALIST: 5,
            UPPER_BRACKET: 6,
            LOWER_BRACKET: 7,
            PLAY_IN: 8,
            GROUP_STAGE: 9,
            ACTIVE: 10,
            REGISTERED: 11,
            ELIMINATED: 12
        };

        const standingsList = Array.from(statsByReg.values()).map((s) => {
            s.kill_difference = s.total_kills - s.total_conceded;
            s.win_rate = s.played > 0 ? Math.round((s.wins / s.played) * 100) : 0;
            if (s.placement === 1 && prizeFirst !== null) {
                s.prize_usd = prizeFirst;
            } else if (s.placement === 2 && prizeSecond !== null) {
                s.prize_usd = prizeSecond;
            } else if ((s.bracket_status === "3RD_PLACE" || s.bracket_status === "SEMIFINALIST") && prizeThird !== null) {
                s.prize_usd = prizeThird;
            }
            return s;
        });

        standingsList.sort((a, b) => {
            if (a.placement !== null && b.placement !== null && a.placement !== b.placement) {
                return a.placement - b.placement;
            }
            if (a.placement !== null && b.placement === null) return -1;
            if (a.placement === null && b.placement !== null) return 1;

            const prioA = STATUS_PRIORITY[a.bracket_status] || 99;
            const prioB = STATUS_PRIORITY[b.bracket_status] || 99;
            if (prioA !== prioB) return prioA - prioB;

            if (b.wins !== a.wins) return b.wins - a.wins;
            if (b.kill_difference !== a.kill_difference) return b.kill_difference - a.kill_difference;
            if (b.total_kills !== a.total_kills) return b.total_kills - a.total_kills;
            return (a.seed_number || 999) - (b.seed_number || 999);
        });

        standingsList.forEach((s, idx) => {
            s.rank = idx + 1;
        });

        return res.status(200).json({
            tournamentId: Number(tournamentId),
            prize_pool_usd: prizePool,
            prize_first_usd: prizeFirst,
            prize_second_usd: prizeSecond,
            prize_third_usd: prizeThird,
            participants,
            matches: formattedMatches,
            standings: standingsList
        });
    } catch (err) {
        console.error("Failed to fetch tournament hub data:", err);
        return res.status(500).json({
            error: "FAILED TO FETCH TOURNAMENT HUB DATA",
            code: "INTERNAL_SERVER_ERROR"
        });
    }
});

/**
 * GET /api/tournaments/:tournamentId/results/pending
 * Organizer-only endpoint to get all pending submitted match results for a tournament.
 */
router.get("/:tournamentId/results/pending", requireAuth, requireRole("organizer"), async (req, res) => {
    const tournamentId = req.params.tournamentId;
    const organizerId = req.session.userId;

    try {
        const [tournaments] = await db.promise().query(
            `SELECT tournament_id, organizer_id FROM TOURNAMENT WHERE tournament_id = ?`,
            [tournamentId]
        );

        if (tournaments.length === 0) {
            return res.status(404).json({
                error: "TOURNAMENT NOT FOUND",
                code: "NOT_FOUND"
            });
        }

        if (tournaments[0].organizer_id !== organizerId) {
            return res.status(403).json({
                error: "YOU DO NOT OWN THIS TOURNAMENT",
                code: "FORBIDDEN"
            });
        }

        const [pendingResults] = await db.promise().query(
            `SELECT mr.result_id, mr.match_id, mr.winning_registration_id,
                    mr.team_a_kills, mr.team_b_kills, mr.evidence_url, mr.status, mr.submitted_at,
                    m.stage_id, m.group_id,
                    ts.stage_name, COALESCE(sg.group_name, 'Playoffs') AS group_name,
                    u.username AS submitted_by_username
             FROM MATCH_RESULT mr
             JOIN \`MATCH\` m ON mr.match_id = m.match_id
             JOIN TOURNAMENT_STAGE ts ON m.stage_id = ts.stage_id
             LEFT JOIN STAGE_GROUP sg ON m.group_id = sg.group_id
             JOIN USER u ON mr.submitted_by = u.user_id
             WHERE ts.tournament_id = ? AND UPPER(mr.status) = 'SUBMITTED'
             ORDER BY mr.submitted_at ASC`,
            [tournamentId]
        );

        // Fetch match participants for each pending result
        const resultsWithParticipants = [];
        for (const item of pendingResults) {
            const [participants] = await db.promise().query(
                `SELECT mp.registration_id, mp.side, tm.team_id, tm.team_name, tm.team_tag
                 FROM MATCH_PARTICIPANT mp
                 JOIN REGISTRATION r ON mp.registration_id = r.registration_id
                 JOIN TEAM tm ON r.team_id = tm.team_id
                 WHERE mp.match_id = ?
                 ORDER BY mp.side ASC`,
                [item.match_id]
            );
            resultsWithParticipants.push({
                ...item,
                participants: participants
            });
        }

        return res.status(200).json({
            pendingResults: resultsWithParticipants
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({
            error: "FAILED TO FETCH PENDING MATCH RESULTS",
            code: "INTERNAL_SERVER_ERROR"
        });
    }
});

/**
 * POST /api/tournaments
 * Organizer-only. Creates a new tournament, always starting in "draft".
 * Validates game_id, format, timeline, and prize_pool_usd + 1st/2nd/3rd prizes.
 */
router.post("/", requireAuth, requireRole("organizer"), (req, res) => {
    const organizerId = req.session.userId;
    const {
        game_id,
        name,
        format,
        registration_start_at,
        registration_end_at,
        prize_pool_usd,
        prize_first_usd,
        prize_second_usd,
        prize_third_usd
    } = req.body;

    if (!game_id || !name || !format) {
        return res.status(400).json({
            error: "GAME ID, NAME, AND FORMAT ARE REQUIRED"
        });
    }

    if (!VALID_FORMATS.includes(format)) {
        return res.status(400).json({
            error: "FORMAT MUST BE 'single_elimination' OR 'double_elimination'"
        });
    }

    const prizeCheck = validatePrizePool(prize_pool_usd);
    if (!prizeCheck.valid) {
        return res.status(400).json({ error: prizeCheck.error, code: "INVALID_PRIZE_POOL" });
    }
    const firstCheck = validatePrizePool(prize_first_usd);
    if (!firstCheck.valid) {
        return res.status(400).json({ error: `1ST PRIZE: ${firstCheck.error}`, code: "INVALID_PRIZE_POOL" });
    }
    const secondCheck = validatePrizePool(prize_second_usd);
    if (!secondCheck.valid) {
        return res.status(400).json({ error: `2ND PRIZE: ${secondCheck.error}`, code: "INVALID_PRIZE_POOL" });
    }
    const thirdCheck = validatePrizePool(prize_third_usd);
    if (!thirdCheck.valid) {
        return res.status(400).json({ error: `3RD PRIZE: ${thirdCheck.error}`, code: "INVALID_PRIZE_POOL" });
    }

    const p1 = firstCheck.value;
    const p2 = secondCheck.value;
    const p3 = thirdCheck.value;
    const hasBreakdown = p1 !== null || p2 !== null || p3 !== null;
    const breakdownSum = (p1 || 0) + (p2 || 0) + (p3 || 0);

    let effectiveTotalPrize = prizeCheck.value;
    if (effectiveTotalPrize === null && hasBreakdown) {
        effectiveTotalPrize = breakdownSum;
    } else if (effectiveTotalPrize !== null && hasBreakdown && breakdownSum > effectiveTotalPrize + 0.001) {
        return res.status(400).json({
            error: `SUM OF 1ST, 2ND, AND 3RD PRIZES ($${breakdownSum}) CANNOT EXCEED TOTAL PRIZE POOL ($${effectiveTotalPrize})`,
            code: "INVALID_PRIZE_POOL"
        });
    }

    const normStart = normalizeTimestamp(registration_start_at);
    const normEnd = normalizeTimestamp(registration_end_at);

    if (normStart && normEnd) {
        if (new Date(normEnd) <= new Date(normStart)) {
            return res.status(400).json({
                error: "REGISTRATION DEADLINE MUST BE AFTER REGISTRATION START TIME",
                code: "REGISTRATION_TIMELINE_INVALID"
            });
        }
    }

    const gameCheckSql = `SELECT game_id FROM GAME WHERE game_id = ?`;

    db.query(gameCheckSql, [game_id], (err, gameResults) => {
        if (err) {
            console.error(err);
            return res.status(500).json({
                error: "FAILED TO VALIDATE GAME"
            });
        }

        if (gameResults.length === 0) {
            return res.status(400).json({
                error: "SELECTED GAME DOES NOT EXIST"
            });
        }

        const insertSql = `
            INSERT INTO TOURNAMENT (
                game_id, organizer_id, name, format, status,
                registration_start_at, registration_end_at,
                prize_pool_usd, prize_first_usd, prize_second_usd, prize_third_usd
            )
            VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)
        `;

        db.query(
            insertSql,
            [game_id, organizerId, name, format, normStart, normEnd, effectiveTotalPrize, p1, p2, p3],
            (err, result) => {
                if (err) {
                    console.error(err);
                    return res.status(500).json({
                        error: "FAILED TO CREATE TOURNAMENT"
                    });
                }

                return res.status(201).json({
                    message: "TOURNAMENT CREATED SUCCESSFULLY",
                    tournamentId: result.insertId,
                    registration_start_at: normStart,
                    registration_end_at: normEnd,
                    prize_pool_usd: effectiveTotalPrize,
                    prize_first_usd: p1,
                    prize_second_usd: p2,
                    prize_third_usd: p3
                });
            }
        );
    });
});

/**
 * PUT /api/tournaments/:id
 * Organizer-only, owner-only. Edits name/game/format/timeline/prize_pool_usd + 1st/2nd/3rd prizes.
 * Allowed while tournament is in draft or published status.
 */
router.put("/:id", requireAuth, requireRole("organizer"), (req, res) => {
    const tournamentId = req.params.id;
    const organizerId = req.session.userId;
    const {
        game_id,
        name,
        format,
        registration_start_at,
        registration_end_at,
        prize_pool_usd,
        prize_first_usd,
        prize_second_usd,
        prize_third_usd
    } = req.body;

    if (!game_id || !name || !format) {
        return res.status(400).json({
            error: "GAME ID, NAME, AND FORMAT ARE REQUIRED"
        });
    }

    if (!VALID_FORMATS.includes(format)) {
        return res.status(400).json({
            error: "FORMAT MUST BE 'single_elimination' OR 'double_elimination'"
        });
    }

    const prizeCheck = validatePrizePool(prize_pool_usd);
    if (!prizeCheck.valid) {
        return res.status(400).json({ error: prizeCheck.error, code: "INVALID_PRIZE_POOL" });
    }
    const firstCheck = validatePrizePool(prize_first_usd);
    if (!firstCheck.valid) {
        return res.status(400).json({ error: `1ST PRIZE: ${firstCheck.error}`, code: "INVALID_PRIZE_POOL" });
    }
    const secondCheck = validatePrizePool(prize_second_usd);
    if (!secondCheck.valid) {
        return res.status(400).json({ error: `2ND PRIZE: ${secondCheck.error}`, code: "INVALID_PRIZE_POOL" });
    }
    const thirdCheck = validatePrizePool(prize_third_usd);
    if (!thirdCheck.valid) {
        return res.status(400).json({ error: `3RD PRIZE: ${thirdCheck.error}`, code: "INVALID_PRIZE_POOL" });
    }

    const p1 = firstCheck.value;
    const p2 = secondCheck.value;
    const p3 = thirdCheck.value;
    const hasBreakdown = p1 !== null || p2 !== null || p3 !== null;
    const breakdownSum = (p1 || 0) + (p2 || 0) + (p3 || 0);

    let effectiveTotalPrize = prizeCheck.value;
    if (effectiveTotalPrize === null && hasBreakdown) {
        effectiveTotalPrize = breakdownSum;
    } else if (effectiveTotalPrize !== null && hasBreakdown && breakdownSum > effectiveTotalPrize + 0.001) {
        return res.status(400).json({
            error: `SUM OF 1ST, 2ND, AND 3RD PRIZES ($${breakdownSum}) CANNOT EXCEED TOTAL PRIZE POOL ($${effectiveTotalPrize})`,
            code: "INVALID_PRIZE_POOL"
        });
    }

    const normStart = normalizeTimestamp(registration_start_at);
    const normEnd = normalizeTimestamp(registration_end_at);

    if (normStart && normEnd) {
        if (new Date(normEnd) <= new Date(normStart)) {
            return res.status(400).json({
                error: "REGISTRATION DEADLINE MUST BE AFTER REGISTRATION START TIME",
                code: "REGISTRATION_TIMELINE_INVALID"
            });
        }
    }

    const ownerCheckSql = `SELECT organizer_id, status FROM TOURNAMENT WHERE tournament_id = ?`;

    db.query(ownerCheckSql, [tournamentId], (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({
                error: "FAILED TO VALIDATE TOURNAMENT"
            });
        }

        if (results.length === 0) {
            return res.status(404).json({
                error: "TOURNAMENT NOT FOUND"
            });
        }

        if (results[0].organizer_id !== organizerId) {
            return res.status(403).json({
                error: "YOU DO NOT OWN THIS TOURNAMENT"
            });
        }

        if (!["draft", "published"].includes(results[0].status)) {
            return res.status(400).json({
                error: "ONLY DRAFT OR PUBLISHED TOURNAMENTS CAN BE EDITED"
            });
        }

        const gameCheckSql = `SELECT game_id FROM GAME WHERE game_id = ?`;

        db.query(gameCheckSql, [game_id], (err, gameResults) => {
            if (err) {
                console.error(err);
                return res.status(500).json({
                    error: "FAILED TO VALIDATE GAME"
                });
            }

            if (gameResults.length === 0) {
                return res.status(400).json({
                    error: "SELECTED GAME DOES NOT EXIST"
                });
            }

            const updateSql = `
                UPDATE TOURNAMENT
                SET game_id = ?, name = ?, format = ?, registration_start_at = ?, registration_end_at = ?,
                    prize_pool_usd = ?, prize_first_usd = ?, prize_second_usd = ?, prize_third_usd = ?
                WHERE tournament_id = ?
            `;

            db.query(
                updateSql,
                [game_id, name, format, normStart, normEnd, effectiveTotalPrize, p1, p2, p3, tournamentId],
                (err) => {
                    if (err) {
                        console.error(err);
                        return res.status(500).json({
                            error: "FAILED TO UPDATE TOURNAMENT"
                        });
                    }

                    return res.status(200).json({
                        message: "TOURNAMENT UPDATED SUCCESSFULLY"
                    });
                }
            );
        });
    });
});

/**
 * PUT /api/tournaments/:id/registration-timeline
 * Organizer-only, owner-only. Updates registration start/end timeline or extends deadline.
 */
router.put("/:id/registration-timeline", requireAuth, requireRole("organizer"), async (req, res) => {
    const tournamentId = req.params.id;
    const organizerId = req.session.userId;
    const { registration_start_at, registration_end_at } = req.body;

    try {
        const [rows] = await db.promise().query(
            `SELECT t.tournament_id, t.organizer_id, t.status, t.registration_start_at, t.registration_end_at,
                    (SELECT COUNT(*) FROM TOURNAMENT_STAGE ts WHERE ts.tournament_id = t.tournament_id AND ts.group_generation_status != 'not_generated') AS active_group_stages
             FROM TOURNAMENT t WHERE t.tournament_id = ?`,
            [tournamentId]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                error: "TOURNAMENT NOT FOUND",
                code: "NOT_FOUND"
            });
        }

        const tournament = rows[0];

        if (tournament.organizer_id !== organizerId) {
            return res.status(403).json({
                error: "YOU DO NOT OWN THIS TOURNAMENT",
                code: "FORBIDDEN"
            });
        }

        if (tournament.status === "completed") {
            return res.status(400).json({
                error: "CANNOT UPDATE TIMELINE OF A COMPLETED TOURNAMENT",
                code: "TOURNAMENT_COMPLETED"
            });
        }

        const now = new Date();
        const normStart = registration_start_at !== undefined ? normalizeTimestamp(registration_start_at) : (tournament.registration_start_at ? normalizeTimestamp(tournament.registration_start_at) : null);
        const normEnd = registration_end_at !== undefined ? normalizeTimestamp(registration_end_at) : (tournament.registration_end_at ? normalizeTimestamp(tournament.registration_end_at) : null);

        // Validation 1: start < end
        if (normStart && normEnd) {
            if (new Date(normEnd) <= new Date(normStart)) {
                return res.status(400).json({
                    error: "REGISTRATION DEADLINE MUST BE AFTER REGISTRATION START TIME",
                    code: "REGISTRATION_TIMELINE_INVALID"
                });
            }
        }

        // Validation 2: When extending registration_end_at, the new deadline MUST be in the future
        if (registration_end_at !== undefined && normEnd) {
            if (new Date(normEnd) <= now) {
                return res.status(400).json({
                    error: "NEW REGISTRATION DEADLINE MUST BE IN THE FUTURE",
                    code: "REGISTRATION_DEADLINE_INVALID"
                });
            }
        }

        // Validation 3: Cannot move registration_start_at after registration has already opened
        if (registration_start_at !== undefined && tournament.registration_start_at) {
            const existingStart = new Date(tournament.registration_start_at);
            if (now >= existingStart && normStart !== normalizeTimestamp(tournament.registration_start_at)) {
                return res.status(400).json({
                    error: "CANNOT MODIFY REGISTRATION START TIME AFTER REGISTRATION HAS ALREADY BEGUN",
                    code: "REGISTRATION_TIMELINE_INVALID"
                });
            }
        }

        await db.promise().query(
            `UPDATE TOURNAMENT SET registration_start_at = ?, registration_end_at = ? WHERE tournament_id = ?`,
            [normStart, normEnd, tournamentId]
        );

        const updatedTournament = {
            ...tournament,
            registration_start_at: normStart,
            registration_end_at: normEnd
        };

        const registration_status = getRegistrationStatus(updatedTournament, tournament.active_group_stages);

        return res.status(200).json({
            message: "REGISTRATION TIMELINE UPDATED SUCCESSFULLY",
            registration_start_at: normStart,
            registration_end_at: normEnd,
            registration_status: registration_status
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({
            error: "FAILED TO UPDATE REGISTRATION TIMELINE",
            code: "INTERNAL_SERVER_ERROR"
        });
    }
});

/**
 * PATCH /api/tournaments/:id/status
 * Organizer-only, owner-only. Moves the tournament forward through its
 * lifecycle. Rejects any transition not explicitly allowed
 * (e.g. draft -> live, or completed -> live) with a clear 400 error
 * instead of silently accepting it.
 */
router.patch("/:id/status", requireAuth, requireRole("organizer"), (req, res) => {
    const tournamentId = req.params.id;
    const organizerId = req.session.userId;
    const { status } = req.body;

    if (!status || !Object.keys(VALID_STATUS_TRANSITIONS).includes(status)) {
        return res.status(400).json({
            error: "STATUS MUST BE ONE OF: draft, published, live, completed"
        });
    }

    const ownerCheckSql = `SELECT organizer_id, status FROM TOURNAMENT WHERE tournament_id = ?`;

    db.query(ownerCheckSql, [tournamentId], (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({
                error: "FAILED TO VALIDATE TOURNAMENT"
            });
        }

        if (results.length === 0) {
            return res.status(404).json({
                error: "TOURNAMENT NOT FOUND"
            });
        }

        if (results[0].organizer_id !== organizerId) {
            return res.status(403).json({
                error: "YOU DO NOT OWN THIS TOURNAMENT"
            });
        }

        const currentStatus = results[0].status;
        const allowedNextStatuses = VALID_STATUS_TRANSITIONS[currentStatus];

        if (!allowedNextStatuses.includes(status)) {
            return res.status(400).json({
                error: `CANNOT MOVE TOURNAMENT FROM '${currentStatus}' TO '${status}'`
            });
        }

        const updateSql = `UPDATE TOURNAMENT SET status = ? WHERE tournament_id = ?`;

        db.query(updateSql, [status, tournamentId], (err) => {
            if (err) {
                console.error(err);
                return res.status(500).json({
                    error: "FAILED TO UPDATE TOURNAMENT STATUS"
                });
            }

            return res.status(200).json({
                message: `TOURNAMENT STATUS UPDATED TO '${status}'`
            });
        });
    });
});

module.exports = router;
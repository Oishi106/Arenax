const express = require("express");
const db = require("../config/db");
const { requireAuth, requireRole } = require("../middleware/authmiddleware");
const { getExcelGroupLetter } = require("../utils/excelNaming");

const router = express.Router();

const VALID_FORMATS = ["group_stage", "single_elimination", "double_elimination"];

/**
 * Shared helper: Check if a stage is locked.
 * A stage is permanently locked if:
 * 1. group_generation_status != 'not_generated'
 * 2. OR any MATCH exists for the stage
 * 3. OR any STAGE_GROUP exists for the stage
 */
async function isStageLocked(stageId, connection) {
    const queryClient = connection || db.promise();
    const [rows] = await queryClient.query(
        `SELECT ts.group_generation_status,
                (SELECT COUNT(*) FROM \`MATCH\` m WHERE m.stage_id = ts.stage_id) AS match_count,
                (SELECT COUNT(*) FROM STAGE_GROUP sg WHERE sg.stage_id = ts.stage_id) AS group_count
         FROM TOURNAMENT_STAGE ts
         WHERE ts.stage_id = ?`,
        [stageId]
    );

    if (rows.length === 0) return false;
    const stage = rows[0];
    return stage.group_generation_status !== "not_generated" || stage.match_count > 0 || stage.group_count > 0;
}

/**
 * Shared helper: Check if any stage in a tournament is locked.
 */
async function isAnyStageInTournamentLocked(tournamentId, connection) {
    const queryClient = connection || db.promise();
    const [stages] = await queryClient.query(
        `SELECT stage_id FROM TOURNAMENT_STAGE WHERE tournament_id = ?`,
        [tournamentId]
    );

    for (const stage of stages) {
        if (await isStageLocked(stage.stage_id, queryClient)) {
            return true;
        }
    }
    return false;
}

/**
 * GET /api/stages/tournament/:tournamentId
 * Listing of stages for a tournament, in stage_order ASC.
 * Access:
 * - If tournament is in 'draft' status: only organizer owner can view. Otherwise 404.
 * - If published / live / completed: any authenticated user can view.
 */
router.get("/tournament/:tournamentId", requireAuth, async (req, res) => {
    const tournamentId = req.params.tournamentId;
    const userId = req.session.userId;

    try {
        const [tournaments] = await db.promise().query(
            `SELECT tournament_id, organizer_id, status FROM TOURNAMENT WHERE tournament_id = ?`,
            [tournamentId]
        );

        if (tournaments.length === 0) {
            return res.status(404).json({
                error: "TOURNAMENT NOT FOUND",
                code: "NOT_FOUND"
            });
        }

        const tournament = tournaments[0];
        const isOwner = tournament.organizer_id === userId;

        if (tournament.status === "draft" && !isOwner) {
            return res.status(404).json({
                error: "TOURNAMENT NOT FOUND",
                code: "NOT_FOUND"
            });
        }

        const [stages] = await db.promise().query(
            `SELECT stage_id, tournament_id, stage_order, stage_name, stage_format, group_generation_status
             FROM TOURNAMENT_STAGE
             WHERE tournament_id = ?
             ORDER BY stage_order ASC`,
            [tournamentId]
        );

        return res.status(200).json({
            stages: stages
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({
            error: "FAILED TO FETCH STAGES",
            code: "INTERNAL_SERVER_ERROR"
        });
    }
});

/**
 * GET /api/stages/:stageId/groups
 * Return groups, members, and matches (once generated) for a stage.
 * Access:
 * - Organizer owner can always access.
 * - Non-owner users can access ONLY when tournament is NOT draft.
 */
router.get("/:stageId/groups", requireAuth, async (req, res) => {
    const stageId = req.params.stageId;
    const userId = req.session.userId;

    try {
        const [stages] = await db.promise().query(
            `SELECT ts.stage_id, ts.tournament_id, ts.stage_format, ts.group_generation_status,
                    t.organizer_id, t.status AS tournament_status
             FROM TOURNAMENT_STAGE ts
             JOIN TOURNAMENT t ON ts.tournament_id = t.tournament_id
             WHERE ts.stage_id = ?`,
            [stageId]
        );

        if (stages.length === 0) {
            return res.status(404).json({
                error: "STAGE NOT FOUND",
                code: "NOT_FOUND"
            });
        }

        const stage = stages[0];
        const isOwner = stage.organizer_id === userId;

        if (stage.tournament_status === "draft" && !isOwner) {
            return res.status(404).json({
                error: "STAGE NOT FOUND",
                code: "NOT_FOUND"
            });
        }

        // Fetch groups
        const [groups] = await db.promise().query(
            `SELECT group_id, stage_id, group_name, group_order
             FROM STAGE_GROUP
             WHERE stage_id = ?
             ORDER BY group_order ASC`,
            [stageId]
        );

        // Fetch members
        const [members] = await db.promise().query(
            `SELECT sgm.member_id, sgm.group_id, sgm.stage_id, sgm.registration_id, sgm.slot_number AS slot,
                    sgm.final_rank, sgm.qualified,
                    r.team_id, tm.team_name, tm.team_tag
             FROM STAGE_GROUP_MEMBER sgm
             JOIN REGISTRATION r ON sgm.registration_id = r.registration_id
             JOIN TEAM tm ON r.team_id = tm.team_id
             WHERE sgm.stage_id = ?
             ORDER BY sgm.group_id ASC, sgm.slot_number ASC`,
            [stageId]
        );

        // Fetch matches if generated
        let matchesMap = new Map();
        if (["matches_generated", "qualified", "bracket_generated"].includes(stage.group_generation_status)) {
            const [matches] = await db.promise().query(
                `SELECT m.match_id, m.stage_id, m.group_id, m.status, m.round_number, m.bracket_position,
                        m.scheduled_time, m.lobby_code, m.server_region, m.draft_mode,
                        mr.status AS result_status, mr.winning_registration_id, mr.evidence_url,
                        mp.registration_id, r.team_id, mp.side, tm.team_name, tm.team_tag
                 FROM \`MATCH\` m
                 LEFT JOIN MATCH_RESULT mr ON m.match_id = mr.match_id
                 LEFT JOIN MATCH_PARTICIPANT mp ON m.match_id = mp.match_id
                 LEFT JOIN REGISTRATION r ON mp.registration_id = r.registration_id
                 LEFT JOIN TEAM tm ON r.team_id = tm.team_id
                 WHERE m.stage_id = ?
                 ORDER BY m.group_id ASC, m.round_number ASC, m.bracket_position ASC`,
                [stageId]
            );

            matches.forEach((row) => {
                if (!matchesMap.has(row.match_id)) {
                    matchesMap.set(row.match_id, {
                        match_id: row.match_id,
                        group_id: row.group_id,
                        status: row.status,
                        result_status: row.result_status || null,
                        winning_registration_id: row.winning_registration_id || null,
                        evidence_url: row.evidence_url || null,
                        round_number: row.round_number,
                        bracket_position: row.bracket_position,
                        scheduled_time: row.scheduled_time || null,
                        lobby_code: row.lobby_code || null,
                        server_region: row.server_region || null,
                        draft_mode: row.draft_mode || null,
                        participants: []
                    });
                }
                if (row.registration_id) {
                    matchesMap.get(row.match_id).participants.push({
                        registration_id: row.registration_id,
                        team_id: row.team_id,
                        team_name: row.team_name,
                        team_tag: row.team_tag,
                        side: row.side
                    });
                }
            });
        }

        const groupMembersMap = new Map();
        members.forEach((m) => {
            if (!groupMembersMap.has(m.group_id)) groupMembersMap.set(m.group_id, []);
            groupMembersMap.get(m.group_id).push({
                slot: m.slot,
                registration_id: m.registration_id,
                team_id: m.team_id,
                team_name: m.team_name,
                team_tag: m.team_tag,
                final_rank: m.final_rank,
                qualified: m.qualified
            });
        });

        const groupMatchesMap = new Map();
        matchesMap.forEach((match) => {
            if (!groupMatchesMap.has(match.group_id)) groupMatchesMap.set(match.group_id, []);
            groupMatchesMap.get(match.group_id).push(match);
        });

        const formattedGroups = groups.map((g) => ({
            group_id: g.group_id,
            group_name: g.group_name,
            group_order: g.group_order,
            members: groupMembersMap.get(g.group_id) || [],
            matches: groupMatchesMap.get(g.group_id) || []
        }));

        return res.status(200).json({
            stageId: Number(stageId),
            tournamentId: stage.tournament_id,
            tournament_id: stage.tournament_id,
            groupGenerationStatus: stage.group_generation_status,
            groups: formattedGroups
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({
            error: "FAILED TO FETCH GROUPS",
            code: "INTERNAL_SERVER_ERROR"
        });
    }
});

/**
 * POST /api/stages
 * Organizer-only, owner-only. Creates a new stage.
 */
router.post("/", requireAuth, requireRole("organizer"), async (req, res) => {
    const organizerId = req.session.userId;
    const { tournament_id, stage_order, stage_name, stage_format } = req.body;

    if (!tournament_id || !stage_name || !stage_format) {
        return res.status(400).json({
            error: "TOURNAMENT ID, STAGE NAME, AND STAGE FORMAT ARE REQUIRED",
            code: "INVALID_INPUT"
        });
    }

    if (!VALID_FORMATS.includes(stage_format)) {
        return res.status(400).json({
            error: "STAGE FORMAT MUST BE ONE OF: group_stage, single_elimination, double_elimination",
            code: "INVALID_INPUT"
        });
    }

    if (stage_order !== undefined && (!Number.isInteger(stage_order) || stage_order < 1)) {
        return res.status(400).json({
            error: "STAGE ORDER MUST BE A POSITIVE WHOLE NUMBER",
            code: "INVALID_INPUT"
        });
    }

    let conn;
    try {
        conn = await db.promise().getConnection();
        await conn.beginTransaction();

        const [tournaments] = await conn.query(
            `SELECT tournament_id, organizer_id, status FROM TOURNAMENT WHERE tournament_id = ? FOR UPDATE`,
            [tournament_id]
        );

        if (tournaments.length === 0) {
            await conn.rollback();
            return res.status(404).json({
                error: "TOURNAMENT NOT FOUND",
                code: "NOT_FOUND"
            });
        }

        const tournament = tournaments[0];

        if (tournament.organizer_id !== organizerId) {
            await conn.rollback();
            return res.status(403).json({
                error: "YOU DO NOT OWN THIS TOURNAMENT",
                code: "FORBIDDEN"
            });
        }

        if (tournament.status !== "draft") {
            await conn.rollback();
            return res.status(409).json({
                error: "STAGES CAN ONLY BE CREATED WHILE TOURNAMENT IS IN DRAFT STATUS",
                code: "STATE_CONFLICT"
            });
        }

        if (await isAnyStageInTournamentLocked(tournament_id, conn)) {
            await conn.rollback();
            return res.status(409).json({
                error: "CANNOT CREATE STAGE - ONE OR MORE STAGES ARE LOCKED",
                code: "STATE_CONFLICT"
            });
        }

        if (stage_format === "group_stage") {
            const [existingGroupStages] = await conn.query(
                `SELECT stage_id FROM TOURNAMENT_STAGE WHERE tournament_id = ? AND stage_format = 'group_stage'`,
                [tournament_id]
            );

            if (existingGroupStages.length > 0) {
                await conn.rollback();
                return res.status(409).json({
                    error: "TOURNAMENT ALREADY CONTAINS A GROUP STAGE",
                    code: "STATE_CONFLICT"
                });
            }
        }

        const [existingStages] = await conn.query(
            `SELECT stage_id, stage_order FROM TOURNAMENT_STAGE WHERE tournament_id = ? ORDER BY stage_order ASC`,
            [tournament_id]
        );

        const currentCount = existingStages.length;
        let targetOrder = stage_order !== undefined ? Number(stage_order) : currentCount + 1;
        if (targetOrder > currentCount + 1) {
            targetOrder = currentCount + 1;
        }

        if (stage_format === "group_stage" && targetOrder !== 1) {
            await conn.rollback();
            return res.status(400).json({
                error: "A GROUP STAGE MAY ONLY BE PLACED AT STAGE ORDER 1",
                code: "INVALID_INPUT"
            });
        }

        if (targetOrder <= currentCount) {
            await conn.query(
                `UPDATE TOURNAMENT_STAGE SET stage_order = stage_order + 1000 WHERE tournament_id = ? AND stage_order >= ?`,
                [tournament_id, targetOrder]
            );
            await conn.query(
                `UPDATE TOURNAMENT_STAGE SET stage_order = stage_order - 999 WHERE tournament_id = ? AND stage_order >= 1001`,
                [tournament_id]
            );
        }

        const [insertResult] = await conn.query(
            `INSERT INTO TOURNAMENT_STAGE (tournament_id, stage_order, stage_name, stage_format) VALUES (?, ?, ?, ?)`,
            [tournament_id, targetOrder, stage_name, stage_format]
        );

        await conn.commit();

        return res.status(201).json({
            message: "STAGE CREATED SUCCESSFULLY",
            stageId: insertResult.insertId,
            stage_order: targetOrder
        });
    } catch (err) {
        if (conn) await conn.rollback();
        console.error(err);
        return res.status(500).json({
            error: "FAILED TO CREATE STAGE",
            code: "INTERNAL_SERVER_ERROR"
        });
    } finally {
        if (conn) conn.release();
    }
});

/**
 * POST /api/stages/:stageId/generate-groups
 * Organizer-only, owner-only. Phase A: Generate groups & assign approved teams.
 */
router.post("/:stageId/generate-groups", requireAuth, requireRole("organizer"), async (req, res) => {
    const stageId = req.params.stageId;
    const organizerId = req.session.userId;
    const requestedMode = req.body.assignmentMode || "sequential";

    if (!["sequential", "random"].includes(requestedMode)) {
        return res.status(400).json({
            error: "ASSIGNMENT MODE MUST BE 'sequential' OR 'random'",
            code: "INVALID_INPUT"
        });
    }

    let conn;
    try {
        conn = await db.promise().getConnection();
        await conn.beginTransaction();

        // 1. Lock & fetch stage and tournament details
        const [stages] = await conn.query(
            `SELECT ts.stage_id, ts.tournament_id, ts.stage_format, ts.group_generation_status,
                    t.organizer_id, t.status AS tournament_status
             FROM TOURNAMENT_STAGE ts
             JOIN TOURNAMENT t ON ts.tournament_id = t.tournament_id
             WHERE ts.stage_id = ? FOR UPDATE`,
            [stageId]
        );

        if (stages.length === 0) {
            await conn.rollback();
            return res.status(404).json({
                error: "STAGE NOT FOUND",
                code: "NOT_FOUND"
            });
        }

        const stage = stages[0];

        if (stage.organizer_id !== organizerId) {
            await conn.rollback();
            return res.status(403).json({
                error: "YOU DO NOT OWN THIS TOURNAMENT",
                code: "FORBIDDEN"
            });
        }

        if (stage.stage_format !== "group_stage") {
            await conn.rollback();
            return res.status(400).json({
                error: "STAGE FORMAT MUST BE group_stage TO GENERATE GROUPS",
                code: "INVALID_INPUT"
            });
        }

        if (stage.tournament_status !== "published") {
            await conn.rollback();
            return res.status(409).json({
                error: "GROUPS CAN ONLY BE GENERATED WHEN TOURNAMENT IS IN PUBLISHED STATUS",
                code: "STATE_CONFLICT"
            });
        }

        if (stage.group_generation_status !== "not_generated") {
            await conn.rollback();
            return res.status(409).json({
                error: "GROUP STAGE HAS ALREADY BEEN GENERATED",
                code: "STATE_CONFLICT"
            });
        }

        // 2. Fetch approved registrations for THIS tournament
        const [registrations] = await conn.query(
            `SELECT registration_id FROM REGISTRATION
             WHERE tournament_id = ? AND status = 'approved'
             ORDER BY registration_id ASC FOR UPDATE`,
            [stage.tournament_id]
        );

        const totalTeams = registrations.length;

        // Check rule: n % 8 == 0 AND n > 0
        if (totalTeams === 0 || totalTeams % 8 !== 0) {
            await conn.rollback();
            return res.status(400).json({
                error: `APPROVED REGISTRATION COUNT (${totalTeams}) IS INVALID. MUST BE DIVISIBLE BY 4 WITH AN EVEN NUMBER OF GROUPS (E.G. 8, 16, 24, 32, 40, 64, 128)`,
                code: "INVALID_INPUT"
            });
        }

        const groupCount = totalTeams / 4;
        let regIds = registrations.map((r) => r.registration_id);

        if (requestedMode === "random") {
            // Fisher-Yates shuffle
            for (let i = regIds.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [regIds[i], regIds[j]] = [regIds[j], regIds[i]];
            }
        }

        // 3. Create groups & assign members
        for (let g = 0; g < groupCount; g++) {
            const groupOrder = g + 1;
            const groupName = "Group " + getExcelGroupLetter(groupOrder);

            const [groupRes] = await conn.query(
                `INSERT INTO STAGE_GROUP (stage_id, group_name, group_order) VALUES (?, ?, ?)`,
                [stageId, groupName, groupOrder]
            );
            const groupId = groupRes.insertId;

            for (let slot = 1; slot <= 4; slot++) {
                const regId = regIds[g * 4 + (slot - 1)];
                await conn.query(
                    `INSERT INTO STAGE_GROUP_MEMBER (group_id, stage_id, registration_id, slot_number, final_rank, qualified)
                     VALUES (?, ?, ?, ?, NULL, NULL)`,
                    [groupId, stageId, regId, slot]
                );
            }
        }

        // Update stage state
        await conn.query(
            `UPDATE TOURNAMENT_STAGE
             SET group_generation_status = 'groups_assigned',
                 group_assignment_mode = ?,
                 groups_generated_at = CURRENT_TIMESTAMP
             WHERE stage_id = ?`,
            [requestedMode, stageId]
        );

        await conn.commit();

        return res.status(201).json({
            message: "GROUPS GENERATED SUCCESSFULLY",
            stageId: Number(stageId),
            assignmentMode: requestedMode,
            groupCount: groupCount,
            teamsPerGroup: 4,
            totalTeams: totalTeams
        });
    } catch (err) {
        if (conn) await conn.rollback();
        console.error(err);
        return res.status(500).json({
            error: "FAILED TO GENERATE GROUPS",
            code: "INTERNAL_SERVER_ERROR"
        });
    } finally {
        if (conn) conn.release();
    }
});

/**
 * DELETE /api/stages/:stageId/groups
 * Organizer-only, owner-only. Resets generated groups back to not_generated.
 * Allowed ONLY when group_generation_status = 'groups_assigned' and no matches exist.
 */
router.delete("/:stageId/groups", requireAuth, requireRole("organizer"), async (req, res) => {
    const stageId = req.params.stageId;
    const organizerId = req.session.userId;

    let conn;
    try {
        conn = await db.promise().getConnection();
        await conn.beginTransaction();

        const [stages] = await conn.query(
            `SELECT ts.stage_id, ts.tournament_id, ts.group_generation_status,
                    t.organizer_id, t.status AS tournament_status
             FROM TOURNAMENT_STAGE ts
             JOIN TOURNAMENT t ON ts.tournament_id = t.tournament_id
             WHERE ts.stage_id = ? FOR UPDATE`,
            [stageId]
        );

        if (stages.length === 0) {
            await conn.rollback();
            return res.status(404).json({
                error: "STAGE NOT FOUND",
                code: "NOT_FOUND"
            });
        }

        const stage = stages[0];

        if (stage.organizer_id !== organizerId) {
            await conn.rollback();
            return res.status(403).json({
                error: "YOU DO NOT OWN THIS TOURNAMENT",
                code: "FORBIDDEN"
            });
        }

        if (stage.group_generation_status !== "groups_assigned") {
            await conn.rollback();
            return res.status(409).json({
                error: "GROUPS CAN ONLY BE RESET WHEN IN GROUPS_ASSIGNED STATUS AND BEFORE MATCHES ARE GENERATED",
                code: "STATE_CONFLICT"
            });
        }

        const [matchCount] = await conn.query(
            `SELECT COUNT(*) AS cnt FROM \`MATCH\` WHERE stage_id = ?`,
            [stageId]
        );

        if (matchCount[0].cnt > 0) {
            await conn.rollback();
            return res.status(409).json({
                error: "CANNOT RESET GROUPS - MATCHES HAVE ALREADY BEEN GENERATED",
                code: "STATE_CONFLICT"
            });
        }

        // Delete group members and groups
        await conn.query(`DELETE FROM STAGE_GROUP_MEMBER WHERE stage_id = ?`, [stageId]);
        await conn.query(`DELETE FROM STAGE_GROUP WHERE stage_id = ?`, [stageId]);

        // Reset stage state
        await conn.query(
            `UPDATE TOURNAMENT_STAGE
             SET group_generation_status = 'not_generated',
                 group_assignment_mode = NULL,
                 groups_generated_at = NULL
             WHERE stage_id = ?`,
            [stageId]
        );

        await conn.commit();

        return res.status(200).json({
            message: "GROUPS RESET SUCCESSFULLY",
            stageId: Number(stageId)
        });
    } catch (err) {
        if (conn) await conn.rollback();
        console.error(err);
        return res.status(500).json({
            error: "FAILED TO RESET GROUPS",
            code: "INTERNAL_SERVER_ERROR"
        });
    } finally {
        if (conn) conn.release();
    }
});

/**
 * PUT /api/stages/:stageId/groups/swap
 * Organizer-only, owner-only. Swaps two registrations between groups or within same group.
 * Allowed ONLY when group_generation_status = 'groups_assigned'.
 */
router.put("/:stageId/groups/swap", requireAuth, requireRole("organizer"), async (req, res) => {
    const stageId = req.params.stageId;
    const organizerId = req.session.userId;
    const regIdA = req.body.registrationIdA || req.body.registration_id_a;
    const regIdB = req.body.registrationIdB || req.body.registration_id_b;

    if (!regIdA || !regIdB || regIdA === regIdB) {
        return res.status(400).json({
            error: "TWO DIFFERENT REGISTRATION IDS ARE REQUIRED FOR SWAP",
            code: "INVALID_INPUT"
        });
    }

    let conn;
    try {
        conn = await db.promise().getConnection();
        await conn.beginTransaction();

        const [stages] = await conn.query(
            `SELECT ts.stage_id, ts.tournament_id, ts.group_generation_status,
                    t.organizer_id
             FROM TOURNAMENT_STAGE ts
             JOIN TOURNAMENT t ON ts.tournament_id = t.tournament_id
             WHERE ts.stage_id = ? FOR UPDATE`,
            [stageId]
        );

        if (stages.length === 0) {
            await conn.rollback();
            return res.status(404).json({
                error: "STAGE NOT FOUND",
                code: "NOT_FOUND"
            });
        }

        const stage = stages[0];

        if (stage.organizer_id !== organizerId) {
            await conn.rollback();
            return res.status(403).json({
                error: "YOU DO NOT OWN THIS TOURNAMENT",
                code: "FORBIDDEN"
            });
        }

        if (stage.group_generation_status !== "groups_assigned") {
            await conn.rollback();
            return res.status(409).json({
                error: "MEMBERS CAN ONLY BE SWAPPED WHILE GROUPS ARE IN GROUPS_ASSIGNED STATUS",
                code: "STATE_CONFLICT"
            });
        }

        const [members] = await conn.query(
            `SELECT member_id, group_id, stage_id, registration_id, slot_number
             FROM STAGE_GROUP_MEMBER
             WHERE stage_id = ? AND registration_id IN (?, ?) FOR UPDATE`,
            [stageId, regIdA, regIdB]
        );

        if (members.length !== 2) {
            await conn.rollback();
            return res.status(400).json({
                error: "ONE OR BOTH REGISTRATIONS ARE NOT ASSIGNED TO A GROUP IN THIS STAGE",
                code: "INVALID_INPUT"
            });
        }

        const memA = members.find((m) => m.registration_id === Number(regIdA));
        const memB = members.find((m) => m.registration_id === Number(regIdB));

        // Safely swap group_id and slot_number using temporary slot -1 to avoid UNIQUE(group_id, slot_number) collision
        await conn.query(
            `UPDATE STAGE_GROUP_MEMBER SET slot_number = -1 WHERE member_id = ?`,
            [memA.member_id]
        );

        await conn.query(
            `UPDATE STAGE_GROUP_MEMBER SET group_id = ?, slot_number = ? WHERE member_id = ?`,
            [memA.group_id, memA.slot_number, memB.member_id]
        );

        await conn.query(
            `UPDATE STAGE_GROUP_MEMBER SET group_id = ?, slot_number = ? WHERE member_id = ?`,
            [memB.group_id, memB.slot_number, memA.member_id]
        );

        await conn.commit();

        return res.status(200).json({
            message: "MEMBERS SWAPPED SUCCESSFULLY"
        });
    } catch (err) {
        if (conn) await conn.rollback();
        console.error(err);
        return res.status(500).json({
            error: "FAILED TO SWAP MEMBERS",
            code: "INTERNAL_SERVER_ERROR"
        });
    } finally {
        if (conn) conn.release();
    }
});

/**
 * PUT /api/stages/:stageId/groups/move
 * Organizer-only, owner-only. Moves a registration to another group in the stage.
 * Reject with 409 if target group already has 4 members.
 */
router.put("/:stageId/groups/move", requireAuth, requireRole("organizer"), async (req, res) => {
    const stageId = req.params.stageId;
    const organizerId = req.session.userId;
    const regId = req.body.registrationId || req.body.registration_id;
    const toGroupId = req.body.toGroupId || req.body.to_group_id;

    if (!regId || !toGroupId) {
        return res.status(400).json({
            error: "REGISTRATION ID AND TARGET GROUP ID ARE REQUIRED",
            code: "INVALID_INPUT"
        });
    }

    let conn;
    try {
        conn = await db.promise().getConnection();
        await conn.beginTransaction();

        const [stages] = await conn.query(
            `SELECT ts.stage_id, ts.tournament_id, ts.group_generation_status,
                    t.organizer_id
             FROM TOURNAMENT_STAGE ts
             JOIN TOURNAMENT t ON ts.tournament_id = t.tournament_id
             WHERE ts.stage_id = ? FOR UPDATE`,
            [stageId]
        );

        if (stages.length === 0) {
            await conn.rollback();
            return res.status(404).json({
                error: "STAGE NOT FOUND",
                code: "NOT_FOUND"
            });
        }

        const stage = stages[0];

        if (stage.organizer_id !== organizerId) {
            await conn.rollback();
            return res.status(403).json({
                error: "YOU DO NOT OWN THIS TOURNAMENT",
                code: "FORBIDDEN"
            });
        }

        if (stage.group_generation_status !== "groups_assigned") {
            await conn.rollback();
            return res.status(409).json({
                error: "MEMBERS CAN ONLY BE MOVED WHILE GROUPS ARE IN GROUPS_ASSIGNED STATUS",
                code: "STATE_CONFLICT"
            });
        }

        // Verify target group belongs to stage
        const [targetGroups] = await conn.query(
            `SELECT group_id FROM STAGE_GROUP WHERE group_id = ? AND stage_id = ? FOR UPDATE`,
            [toGroupId, stageId]
        );

        if (targetGroups.length === 0) {
            await conn.rollback();
            return res.status(404).json({
                error: "TARGET GROUP NOT FOUND IN THIS STAGE",
                code: "NOT_FOUND"
            });
        }

        // Verify registration is currently assigned to this stage
        const [members] = await conn.query(
            `SELECT member_id, group_id, slot_number FROM STAGE_GROUP_MEMBER WHERE stage_id = ? AND registration_id = ? FOR UPDATE`,
            [stageId, regId]
        );

        if (members.length === 0) {
            await conn.rollback();
            return res.status(404).json({
                error: "REGISTRATION IS NOT ASSIGNED TO A GROUP IN THIS STAGE",
                code: "NOT_FOUND"
            });
        }

        const currentMember = members[0];
        if (currentMember.group_id === Number(toGroupId)) {
            await conn.rollback();
            return res.status(200).json({
                message: "MEMBER IS ALREADY IN THE TARGET GROUP"
            });
        }

        // Check target group member count & available slots
        const [targetMembers] = await conn.query(
            `SELECT slot_number FROM STAGE_GROUP_MEMBER WHERE group_id = ? FOR UPDATE`,
            [toGroupId]
        );

        if (targetMembers.length >= 4) {
            await conn.rollback();
            return res.status(409).json({
                error: "TARGET GROUP IS FULL (MAX 4 MEMBERS PER GROUP)",
                code: "STATE_CONFLICT"
            });
        }

        const usedSlots = new Set(targetMembers.map((m) => m.slot_number));
        let availableSlot = null;
        for (let s = 1; s <= 4; s++) {
            if (!usedSlots.has(s)) {
                availableSlot = s;
                break;
            }
        }

        if (!availableSlot) {
            await conn.rollback();
            return res.status(409).json({
                error: "NO AVAILABLE SLOT IN TARGET GROUP",
                code: "STATE_CONFLICT"
            });
        }

        await conn.query(
            `UPDATE STAGE_GROUP_MEMBER SET group_id = ?, slot_number = ? WHERE member_id = ?`,
            [toGroupId, availableSlot, currentMember.member_id]
        );

        await conn.commit();

        return res.status(200).json({
            message: "MEMBER MOVED SUCCESSFULLY"
        });
    } catch (err) {
        if (conn) await conn.rollback();
        console.error(err);
        return res.status(500).json({
            error: "FAILED TO MOVE MEMBER",
            code: "INTERNAL_SERVER_ERROR"
        });
    } finally {
        if (conn) conn.release();
    }
});

/**
 * DELETE /api/stages/:stageId/groups/members/:registrationId
 * Organizer-only, owner-only. Removes a team from a stage group and sets registration status to 'rejected'.
 * Allowed ONLY when group_generation_status = 'groups_assigned' and no matches exist.
 */
router.delete("/:stageId/groups/members/:registrationId", requireAuth, requireRole("organizer"), async (req, res) => {
    const stageId = req.params.stageId;
    const registrationId = req.params.registrationId;
    const organizerId = req.session.userId;

    let conn;
    try {
        conn = await db.promise().getConnection();
        await conn.beginTransaction();

        const [stages] = await conn.query(
            `SELECT ts.stage_id, ts.tournament_id, ts.group_generation_status,
                    t.organizer_id
             FROM TOURNAMENT_STAGE ts
             JOIN TOURNAMENT t ON ts.tournament_id = t.tournament_id
             WHERE ts.stage_id = ? FOR UPDATE`,
            [stageId]
        );

        if (stages.length === 0) {
            await conn.rollback();
            return res.status(404).json({
                error: "STAGE NOT FOUND",
                code: "NOT_FOUND"
            });
        }

        const stage = stages[0];

        if (stage.organizer_id !== organizerId) {
            await conn.rollback();
            return res.status(403).json({
                error: "YOU DO NOT OWN THIS TOURNAMENT",
                code: "FORBIDDEN"
            });
        }

        if (stage.group_generation_status !== "groups_assigned") {
            await conn.rollback();
            return res.status(409).json({
                error: "TEAMS CAN ONLY BE REMOVED WHILE GROUPS ARE IN GROUPS_ASSIGNED STATUS",
                code: "STATE_CONFLICT"
            });
        }

        const [matchCount] = await conn.query(
            `SELECT COUNT(*) AS cnt FROM \`MATCH\` WHERE stage_id = ?`,
            [stageId]
        );

        if (matchCount[0].cnt > 0) {
            await conn.rollback();
            return res.status(409).json({
                error: "CANNOT REMOVE TEAM - MATCHES HAVE ALREADY BEEN GENERATED FOR THIS STAGE",
                code: "STATE_CONFLICT"
            });
        }

        // Verify registration is currently assigned to this stage
        const [members] = await conn.query(
            `SELECT member_id, group_id, slot_number FROM STAGE_GROUP_MEMBER WHERE stage_id = ? AND registration_id = ? FOR UPDATE`,
            [stageId, registrationId]
        );

        if (members.length === 0) {
            await conn.rollback();
            return res.status(404).json({
                error: "REGISTRATION IS NOT ASSIGNED TO A GROUP IN THIS STAGE",
                code: "NOT_FOUND"
            });
        }

        // Delete stage group member row
        await conn.query(
            `DELETE FROM STAGE_GROUP_MEMBER WHERE member_id = ?`,
            [members[0].member_id]
        );

        // Reject registration and clear approved_at timestamp
        await conn.query(
            `UPDATE REGISTRATION SET status = 'rejected', approved_at = NULL WHERE registration_id = ?`,
            [registrationId]
        );

        await conn.commit();

        return res.status(200).json({
            message: "TEAM REMOVED FROM GROUP AND REGISTRATION REJECTED SUCCESSFULLY",
            stageId: Number(stageId),
            registrationId: Number(registrationId)
        });
    } catch (err) {
        if (conn) await conn.rollback();
        console.error(err);
        return res.status(500).json({
            error: "FAILED TO REMOVE TEAM FROM GROUP",
            code: "INTERNAL_SERVER_ERROR"
        });
    } finally {
        if (conn) conn.release();
    }
});

/**
 * POST /api/stages/:stageId/generate-group-matches
 * Organizer-only, owner-only. Phase B: Confirm & generate 6 round-robin matches per group.
 */
router.post("/:stageId/generate-group-matches", requireAuth, requireRole("organizer"), async (req, res) => {
    const stageId = req.params.stageId;
    const organizerId = req.session.userId;

    let conn;
    try {
        conn = await db.promise().getConnection();
        await conn.beginTransaction();

        // 1. Lock stage & tournament
        const [stages] = await conn.query(
            `SELECT ts.stage_id, ts.tournament_id, ts.stage_format, ts.group_generation_status,
                    t.organizer_id, t.status AS tournament_status
             FROM TOURNAMENT_STAGE ts
             JOIN TOURNAMENT t ON ts.tournament_id = t.tournament_id
             WHERE ts.stage_id = ? FOR UPDATE`,
            [stageId]
        );

        if (stages.length === 0) {
            await conn.rollback();
            return res.status(404).json({
                error: "STAGE NOT FOUND",
                code: "NOT_FOUND"
            });
        }

        const stage = stages[0];

        if (stage.organizer_id !== organizerId) {
            await conn.rollback();
            return res.status(403).json({
                error: "YOU DO NOT OWN THIS TOURNAMENT",
                code: "FORBIDDEN"
            });
        }

        if (stage.stage_format !== "group_stage") {
            await conn.rollback();
            return res.status(400).json({
                error: "STAGE FORMAT MUST BE group_stage TO GENERATE GROUP MATCHES",
                code: "INVALID_INPUT"
            });
        }

        if (stage.group_generation_status !== "groups_assigned") {
            await conn.rollback();
            return res.status(409).json({
                error: "GROUP MATCHES CAN ONLY BE GENERATED WHEN IN GROUPS_ASSIGNED STATUS",
                code: "STATE_CONFLICT"
            });
        }

        // Check if matches already exist
        const [existingMatchCount] = await conn.query(
            `SELECT COUNT(*) AS cnt FROM \`MATCH\` WHERE stage_id = ?`,
            [stageId]
        );

        if (existingMatchCount[0].cnt > 0) {
            await conn.rollback();
            return res.status(409).json({
                error: "MATCHES HAVE ALREADY BEEN GENERATED FOR THIS STAGE",
                code: "STATE_CONFLICT"
            });
        }

        // 2. Load all groups & members for stage
        const [groups] = await conn.query(
            `SELECT group_id, group_name, group_order FROM STAGE_GROUP WHERE stage_id = ? ORDER BY group_order ASC FOR UPDATE`,
            [stageId]
        );

        if (groups.length === 0) {
            await conn.rollback();
            return res.status(409).json({
                error: "NO GROUPS FOUND FOR THIS STAGE",
                code: "STATE_CONFLICT"
            });
        }

        const [members] = await conn.query(
            `SELECT member_id, group_id, registration_id, slot_number
             FROM STAGE_GROUP_MEMBER
             WHERE stage_id = ?
             ORDER BY group_id ASC, slot_number ASC FOR UPDATE`,
            [stageId]
        );

        const groupMemberMap = new Map();
        members.forEach((m) => {
            if (!groupMemberMap.has(m.group_id)) groupMemberMap.set(m.group_id, []);
            groupMemberMap.get(m.group_id).push(m);
        });

        // Assert every group contains EXACTLY 4 members
        for (const g of groups) {
            const groupMems = groupMemberMap.get(g.group_id) || [];
            if (groupMems.length !== 4) {
                await conn.rollback();
                return res.status(409).json({
                    error: `GROUP '${g.group_name}' DOES NOT CONTAIN EXACTLY 4 MEMBERS (FOUND ${groupMems.length})`,
                    code: "STATE_CONFLICT"
                });
            }
        }

        // 3. Generate 6 round-robin matches per group
        // Round 1: 1 vs 2, 3 vs 4
        // Round 2: 1 vs 3, 2 vs 4
        // Round 3: 1 vs 4, 2 vs 3
        const roundPairings = [
            { round: 1, pos: 1, slotA: 1, slotB: 2 },
            { round: 1, pos: 2, slotA: 3, slotB: 4 },
            { round: 2, pos: 3, slotA: 1, slotB: 3 },
            { round: 2, pos: 4, slotA: 2, slotB: 4 },
            { round: 3, pos: 5, slotA: 1, slotB: 4 },
            { round: 3, pos: 6, slotA: 2, slotB: 3 }
        ];

        let totalMatchesCreated = 0;

        for (const g of groups) {
            const groupMems = groupMemberMap.get(g.group_id);
            const slotMap = new Map();
            groupMems.forEach((m) => slotMap.set(m.slot_number, m.registration_id));

            for (const pairing of roundPairings) {
                const regA = slotMap.get(pairing.slotA);
                const regB = slotMap.get(pairing.slotB);

                if (!regA || !regB || regA === regB) {
                    await conn.rollback();
                    return res.status(500).json({
                        error: "INVALID MEMBER PAIRING DETECTED",
                        code: "INTERNAL_SERVER_ERROR"
                    });
                }

                const [matchRes] = await conn.query(
                    `INSERT INTO \`MATCH\` (stage_id, group_id, status, round_number, bracket_position)
                     VALUES (?, ?, 'scheduled', ?, ?)`,
                    [stageId, g.group_id, pairing.round, pairing.pos]
                );
                const matchId = matchRes.insertId;

                // Participant Side A (Lower slot)
                await conn.query(
                    `INSERT INTO MATCH_PARTICIPANT (match_id, registration_id, side) VALUES (?, ?, 'A')`,
                    [matchId, regA]
                );

                // Participant Side B (Higher slot)
                await conn.query(
                    `INSERT INTO MATCH_PARTICIPANT (match_id, registration_id, side) VALUES (?, ?, 'B')`,
                    [matchId, regB]
                );

                totalMatchesCreated++;
            }
        }

        // Update stage status
        await conn.query(
            `UPDATE TOURNAMENT_STAGE SET group_generation_status = 'matches_generated' WHERE stage_id = ?`,
            [stageId]
        );

        await conn.commit();

        return res.status(201).json({
            message: "GROUP STAGE MATCHES GENERATED SUCCESSFULLY",
            stageId: Number(stageId),
            groupCount: groups.length,
            teamsPerGroup: 4,
            matchesPerGroup: 6,
            totalMatches: totalMatchesCreated
        });
    } catch (err) {
        if (conn) await conn.rollback();
        console.error(err);
        return res.status(500).json({
            error: "FAILED TO GENERATE GROUP MATCHES",
            code: "INTERNAL_SERVER_ERROR"
        });
    } finally {
        if (conn) conn.release();
    }
});

/**
 * PUT /api/stages/tournament/:tournamentId/reorder
 * Organizer-only, owner-only. Safe stage reordering.
 */
router.put("/tournament/:tournamentId/reorder", requireAuth, requireRole("organizer"), async (req, res) => {
    const tournamentId = req.params.tournamentId;
    const organizerId = req.session.userId;
    const stageIds = req.body.stageIds || req.body.stage_ids;

    if (!Array.isArray(stageIds) || stageIds.length === 0) {
        return res.status(400).json({
            error: "STAGE IDS ARRAY IS REQUIRED AND MUST NOT BE EMPTY",
            code: "INVALID_INPUT"
        });
    }

    let conn;
    try {
        conn = await db.promise().getConnection();
        await conn.beginTransaction();

        const [tournaments] = await conn.query(
            `SELECT tournament_id, organizer_id, status FROM TOURNAMENT WHERE tournament_id = ? FOR UPDATE`,
            [tournamentId]
        );

        if (tournaments.length === 0) {
            await conn.rollback();
            return res.status(404).json({
                error: "TOURNAMENT NOT FOUND",
                code: "NOT_FOUND"
            });
        }

        const tournament = tournaments[0];

        if (tournament.organizer_id !== organizerId) {
            await conn.rollback();
            return res.status(403).json({
                error: "YOU DO NOT OWN THIS TOURNAMENT",
                code: "FORBIDDEN"
            });
        }

        if (tournament.status !== "draft") {
            await conn.rollback();
            return res.status(409).json({
                error: "STAGES CAN ONLY BE REORDERED WHILE TOURNAMENT IS IN DRAFT STATUS",
                code: "STATE_CONFLICT"
            });
        }

        const [existingStages] = await conn.query(
            `SELECT stage_id, stage_format FROM TOURNAMENT_STAGE WHERE tournament_id = ? FOR UPDATE`,
            [tournamentId]
        );

        if (stageIds.length !== existingStages.length) {
            await conn.rollback();
            return res.status(400).json({
                error: "SUBMITTED STAGE ID SET DOES NOT MATCH TOURNAMENT STAGES COUNT",
                code: "INVALID_INPUT"
            });
        }

        const existingMap = new Map();
        existingStages.forEach((s) => existingMap.set(s.stage_id, s));

        const seenIds = new Set();
        for (const sid of stageIds) {
            const numId = Number(sid);
            if (!existingMap.has(numId) || seenIds.has(numId)) {
                await conn.rollback();
                return res.status(400).json({
                    error: "SUBMITTED STAGE ID SET CONTAINS DUPLICATE OR INVALID STAGE IDS FOR THIS TOURNAMENT",
                    code: "INVALID_INPUT"
                });
            }
            seenIds.add(numId);
        }

        for (const stage of existingStages) {
            if (await isStageLocked(stage.stage_id, conn)) {
                await conn.rollback();
                return res.status(409).json({
                    error: "CANNOT REORDER STAGES - ONE OR MORE STAGES ARE LOCKED",
                    code: "STATE_CONFLICT"
                });
            }
        }

        for (let i = 0; i < stageIds.length; i++) {
            const stage = existingMap.get(Number(stageIds[i]));
            if (stage.stage_format === "group_stage" && i !== 0) {
                await conn.rollback();
                return res.status(400).json({
                    error: "A GROUP STAGE MAY ONLY BE PLACED AT STAGE ORDER 1",
                    code: "INVALID_INPUT"
                });
            }
        }

        await conn.query(
            `UPDATE TOURNAMENT_STAGE SET stage_order = stage_order + 1000 WHERE tournament_id = ?`,
            [tournamentId]
        );

        for (let i = 0; i < stageIds.length; i++) {
            await conn.query(
                `UPDATE TOURNAMENT_STAGE SET stage_order = ? WHERE stage_id = ?`,
                [i + 1, Number(stageIds[i])]
            );
        }

        await conn.commit();

        return res.status(200).json({
            message: "STAGES REORDERED SUCCESSFULLY",
            stageIds: stageIds
        });
    } catch (err) {
        if (conn) await conn.rollback();
        console.error(err);
        return res.status(500).json({
            error: "FAILED TO REORDER STAGES",
            code: "INTERNAL_SERVER_ERROR"
        });
    } finally {
        if (conn) conn.release();
    }
});

/**
 * PUT /api/stages/:id
 * Organizer-only, owner-only. Edits a stage's name, format, or order.
 */
router.put("/:id", requireAuth, requireRole("organizer"), async (req, res) => {
    const stageId = req.params.id;
    const organizerId = req.session.userId;
    const { stage_order, stage_name, stage_format } = req.body;

    if (!stage_name || !stage_format) {
        return res.status(400).json({
            error: "STAGE NAME AND STAGE FORMAT ARE REQUIRED",
            code: "INVALID_INPUT"
        });
    }

    if (!VALID_FORMATS.includes(stage_format)) {
        return res.status(400).json({
            error: "STAGE FORMAT MUST BE ONE OF: group_stage, single_elimination, double_elimination",
            code: "INVALID_INPUT"
        });
    }

    if (stage_order !== undefined && (!Number.isInteger(stage_order) || stage_order < 1)) {
        return res.status(400).json({
            error: "STAGE ORDER MUST BE A POSITIVE WHOLE NUMBER",
            code: "INVALID_INPUT"
        });
    }

    let conn;
    try {
        conn = await db.promise().getConnection();
        await conn.beginTransaction();

        const [results] = await conn.query(
            `SELECT ts.stage_id, ts.tournament_id, ts.stage_order AS current_order, ts.stage_format AS current_format,
                    t.organizer_id, t.status
             FROM TOURNAMENT_STAGE ts
             JOIN TOURNAMENT t ON ts.tournament_id = t.tournament_id
             WHERE ts.stage_id = ? FOR UPDATE`,
            [stageId]
        );

        if (results.length === 0) {
            await conn.rollback();
            return res.status(404).json({
                error: "STAGE NOT FOUND",
                code: "NOT_FOUND"
            });
        }

        const stage = results[0];

        if (stage.organizer_id !== organizerId) {
            await conn.rollback();
            return res.status(403).json({
                error: "YOU DO NOT OWN THIS TOURNAMENT",
                code: "FORBIDDEN"
            });
        }

        if (stage.status !== "draft") {
            await conn.rollback();
            return res.status(409).json({
                error: "STAGES CAN ONLY BE EDITED WHILE TOURNAMENT IS IN DRAFT STATUS",
                code: "STATE_CONFLICT"
            });
        }

        if (await isStageLocked(stageId, conn)) {
            await conn.rollback();
            return res.status(409).json({
                error: "STAGE IS LOCKED AND CANNOT BE EDITED",
                code: "STATE_CONFLICT"
            });
        }

        const tournamentId = stage.tournament_id;

        if (stage_format === "group_stage") {
            const [existingGroupStages] = await conn.query(
                `SELECT stage_id FROM TOURNAMENT_STAGE WHERE tournament_id = ? AND stage_format = 'group_stage' AND stage_id != ?`,
                [tournamentId, stageId]
            );

            if (existingGroupStages.length > 0) {
                await conn.rollback();
                return res.status(409).json({
                    error: "TOURNAMENT ALREADY CONTAINS A GROUP STAGE",
                    code: "STATE_CONFLICT"
                });
            }
        }

        const [existingStages] = await conn.query(
            `SELECT stage_id, stage_order, stage_format FROM TOURNAMENT_STAGE WHERE tournament_id = ? ORDER BY stage_order ASC`,
            [tournamentId]
        );

        const currentCount = existingStages.length;
        let targetOrder = stage_order !== undefined ? Number(stage_order) : stage.current_order;
        if (targetOrder > currentCount) {
            targetOrder = currentCount;
        }

        if (stage_format === "group_stage" && targetOrder !== 1) {
            await conn.rollback();
            return res.status(400).json({
                error: "A GROUP STAGE MAY ONLY BE PLACED AT STAGE ORDER 1",
                code: "INVALID_INPUT"
            });
        }

        if (targetOrder !== stage.current_order) {
            await conn.query(
                `UPDATE TOURNAMENT_STAGE SET stage_order = stage_order + 1000 WHERE tournament_id = ?`,
                [tournamentId]
            );

            const otherStages = existingStages.filter((s) => s.stage_id !== Number(stageId));
            otherStages.splice(targetOrder - 1, 0, { stage_id: Number(stageId), stage_format });

            for (let i = 0; i < otherStages.length; i++) {
                if (otherStages[i].stage_format === "group_stage" && i !== 0) {
                    await conn.rollback();
                    return res.status(400).json({
                        error: "A GROUP STAGE MAY ONLY BE PLACED AT STAGE ORDER 1",
                        code: "INVALID_INPUT"
                    });
                }

                await conn.query(
                    `UPDATE TOURNAMENT_STAGE SET stage_order = ? WHERE stage_id = ?`,
                    [i + 1, otherStages[i].stage_id]
                );
            }
        }

        await conn.query(
            `UPDATE TOURNAMENT_STAGE SET stage_name = ?, stage_format = ? WHERE stage_id = ?`,
            [stage_name, stage_format, stageId]
        );

        await conn.commit();

        return res.status(200).json({
            message: "STAGE UPDATED SUCCESSFULLY"
        });
    } catch (err) {
        if (conn) await conn.rollback();
        console.error(err);
        return res.status(500).json({
            error: "FAILED TO UPDATE STAGE",
            code: "INTERNAL_SERVER_ERROR"
        });
    } finally {
        if (conn) conn.release();
    }
});

/**
 * DELETE /api/stages/:id
 * Organizer-only, owner-only. Deletes a stage.
 */
router.delete("/:id", requireAuth, requireRole("organizer"), async (req, res) => {
    const stageId = req.params.id;
    const organizerId = req.session.userId;

    let conn;
    try {
        conn = await db.promise().getConnection();
        await conn.beginTransaction();

        const [results] = await conn.query(
            `SELECT ts.stage_id, ts.tournament_id, ts.stage_order, t.organizer_id, t.status
             FROM TOURNAMENT_STAGE ts
             JOIN TOURNAMENT t ON ts.tournament_id = t.tournament_id
             WHERE ts.stage_id = ? FOR UPDATE`,
            [stageId]
        );

        if (results.length === 0) {
            await conn.rollback();
            return res.status(404).json({
                error: "STAGE NOT FOUND",
                code: "NOT_FOUND"
            });
        }

        const stage = results[0];

        if (stage.organizer_id !== organizerId) {
            await conn.rollback();
            return res.status(403).json({
                error: "YOU DO NOT OWN THIS TOURNAMENT",
                code: "FORBIDDEN"
            });
        }

        if (stage.status !== "draft") {
            await conn.rollback();
            return res.status(409).json({
                error: "STAGES CAN ONLY BE DELETED WHILE TOURNAMENT IS IN DRAFT STATUS",
                code: "STATE_CONFLICT"
            });
        }

        if (await isStageLocked(stageId, conn)) {
            await conn.rollback();
            return res.status(409).json({
                error: "STAGE IS LOCKED AND CANNOT BE DELETED",
                code: "STATE_CONFLICT"
            });
        }

        const tournamentId = stage.tournament_id;

        const [countResult] = await conn.query(
            `SELECT COUNT(*) AS total_stages FROM TOURNAMENT_STAGE WHERE tournament_id = ?`,
            [tournamentId]
        );

        if (countResult[0].total_stages <= 1) {
            await conn.rollback();
            return res.status(409).json({
                error: "CANNOT DELETE THE FINAL REMAINING STAGE OF A TOURNAMENT",
                code: "STATE_CONFLICT"
            });
        }

        const deletedOrder = stage.stage_order;

        await conn.query(`DELETE FROM TOURNAMENT_STAGE WHERE stage_id = ?`, [stageId]);

        await conn.query(
            `UPDATE TOURNAMENT_STAGE SET stage_order = stage_order + 1000 WHERE tournament_id = ? AND stage_order > ?`,
            [tournamentId, deletedOrder]
        );

        await conn.query(
            `UPDATE TOURNAMENT_STAGE SET stage_order = stage_order - 1001 WHERE tournament_id = ? AND stage_order >= 1001`,
            [tournamentId]
        );

        await conn.commit();

        return res.status(200).json({
            message: "STAGE DELETED SUCCESSFULLY"
        });
    } catch (err) {
        if (conn) await conn.rollback();
        console.error(err);
        return res.status(500).json({
            error: "FAILED TO DELETE STAGE",
            code: "INTERNAL_SERVER_ERROR"
        });
    } finally {
        if (conn) conn.release();
    }
});

/**
 * GET /api/stages/:stageId/groups/:groupId/standings
 * Computes official group-stage standings for a group.
 * Only VERIFIED results affect played, wins, losses, total_kills, kill_difference.
 * Standings order: 1. wins (desc), 2. total_kills (desc), 3. kill_difference (desc), 4. final_rank (asc).
 * Ties are strictly preserved if all criteria match.
 */
router.get("/:stageId/groups/:groupId/standings", requireAuth, async (req, res) => {
    const stageId = req.params.stageId;
    const groupId = req.params.groupId;
    const userId = req.session.userId;

    try {
        // 1. Verify stage & group existence and tournament access permissions
        const [groups] = await db.promise().query(
            `SELECT sg.group_id, sg.stage_id, sg.group_name, sg.group_order,
                    ts.tournament_id, t.organizer_id, t.status AS tournament_status
             FROM STAGE_GROUP sg
             JOIN TOURNAMENT_STAGE ts ON sg.stage_id = ts.stage_id
             JOIN TOURNAMENT t ON ts.tournament_id = t.tournament_id
             WHERE sg.group_id = ? AND sg.stage_id = ?`,
            [groupId, stageId]
        );

        if (groups.length === 0) {
            return res.status(404).json({
                error: "GROUP NOT FOUND IN THIS STAGE",
                code: "NOT_FOUND"
            });
        }

        const group = groups[0];
        const isOwner = group.organizer_id === userId;

        if (group.tournament_status === "draft" && !isOwner) {
            return res.status(404).json({
                error: "GROUP NOT FOUND",
                code: "NOT_FOUND"
            });
        }

        // 2. Fetch all members in this group
        const [members] = await db.promise().query(
            `SELECT sgm.member_id, sgm.group_id, sgm.stage_id, sgm.registration_id, sgm.slot_number,
                    sgm.final_rank, sgm.qualified,
                    r.team_id, tm.team_name, tm.team_tag
             FROM STAGE_GROUP_MEMBER sgm
             JOIN REGISTRATION r ON sgm.registration_id = r.registration_id
             JOIN TEAM tm ON r.team_id = tm.team_id
             WHERE sgm.group_id = ? AND sgm.stage_id = ?
             ORDER BY sgm.slot_number ASC`,
            [groupId, stageId]
        );

        // 3. Fetch all VERIFIED matches in this group
        const [verifiedMatches] = await db.promise().query(
            `SELECT m.match_id, mr.winning_registration_id, mr.team_a_kills, mr.team_b_kills,
                    mpA.registration_id AS reg_a, mpB.registration_id AS reg_b
             FROM \`MATCH\` m
             JOIN MATCH_RESULT mr ON m.match_id = mr.match_id
             JOIN MATCH_PARTICIPANT mpA ON m.match_id = mpA.match_id AND mpA.side = 'A'
             JOIN MATCH_PARTICIPANT mpB ON m.match_id = mpB.match_id AND mpB.side = 'B'
             WHERE m.group_id = ? AND mr.status = 'VERIFIED'`,
            [groupId]
        );

        // 4. Compute statistics per member
        const statsMap = new Map();
        members.forEach((m) => {
            statsMap.set(m.registration_id, {
                registration_id: m.registration_id,
                team_id: m.team_id,
                team_name: m.team_name,
                team_tag: m.team_tag,
                slot_number: m.slot_number,
                played: 0,
                wins: 0,
                losses: 0,
                total_kills: 0,
                total_conceded: 0,
                kill_difference: 0,
                final_rank: m.final_rank,
                qualified: m.qualified
            });
        });

        verifiedMatches.forEach((match) => {
            const teamA = statsMap.get(match.reg_a);
            const teamB = statsMap.get(match.reg_b);

            if (teamA) {
                teamA.played += 1;
                teamA.total_kills += match.team_a_kills;
                teamA.total_conceded += match.team_b_kills;
                if (match.winning_registration_id === teamA.registration_id) {
                    teamA.wins += 1;
                } else {
                    teamA.losses += 1;
                }
            }

            if (teamB) {
                teamB.played += 1;
                teamB.total_kills += match.team_b_kills;
                teamB.total_conceded += match.team_a_kills;
                if (match.winning_registration_id === teamB.registration_id) {
                    teamB.wins += 1;
                } else {
                    teamB.losses += 1;
                }
            }
        });

        // Compute kill difference
        const standingsList = Array.from(statsMap.values()).map((s) => {
            s.kill_difference = s.total_kills - s.total_conceded;
            return s;
        });

        // 5. Sort standings
        // Ordering criteria:
        // 1. wins DESC
        // 2. total_kills DESC
        // 3. kill_difference DESC
        // 4. final_rank ASC (if set)
        standingsList.sort((a, b) => {
            if (b.wins !== a.wins) return b.wins - a.wins;
            if (b.total_kills !== a.total_kills) return b.total_kills - a.total_kills;
            if (b.kill_difference !== a.kill_difference) return b.kill_difference - a.kill_difference;
            if (a.final_rank !== null && b.final_rank !== null && a.final_rank !== b.final_rank) {
                return a.final_rank - b.final_rank;
            }
            if (a.final_rank !== null && b.final_rank === null) return -1;
            if (a.final_rank === null && b.final_rank !== null) return 1;
            return 0; // Preserve tie if identical
        });

        // Assign rank while preserving ties
        let currentRank = 1;
        for (let i = 0; i < standingsList.length; i++) {
            if (i > 0) {
                const prev = standingsList[i - 1];
                const curr = standingsList[i];
                const isTied =
                    curr.wins === prev.wins &&
                    curr.total_kills === prev.total_kills &&
                    curr.kill_difference === prev.kill_difference &&
                    curr.final_rank === prev.final_rank;

                if (!isTied) {
                    currentRank = i + 1;
                }
            }
            standingsList[i].rank = currentRank;
        }

        return res.status(200).json({
            group: {
                group_id: group.group_id,
                group_name: group.group_name,
                stage_id: group.stage_id
            },
            standings: standingsList
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({
            error: "FAILED TO FETCH STANDINGS",
            code: "INTERNAL_SERVER_ERROR"
        });
    }
});

/**
 * Helper: Generate Double Elimination Playoff Bracket for 4 Teams
 */
async function generate4TeamBracket(conn, stageId, qualifiedTeams) {
    let rank1Teams = qualifiedTeams.filter((t) => t.final_rank === 1);
    let rank2Teams = qualifiedTeams.filter((t) => t.final_rank === 2);

    if (rank1Teams.length === 0 && rank2Teams.length === 0) {
        rank1Teams = qualifiedTeams.slice(0, 2);
        rank2Teams = qualifiedTeams.slice(2, 4);
    }

    for (let i = 0; i < rank1Teams.length; i++) {
        if (rank1Teams[i].member_id) {
            await conn.query(
                `UPDATE STAGE_GROUP_MEMBER SET playoff_seed = ?, bye_status = FALSE WHERE member_id = ?`,
                [i + 1, rank1Teams[i].member_id]
            );
        }
    }
    for (let i = 0; i < rank2Teams.length; i++) {
        if (rank2Teams[i].member_id) {
            await conn.query(
                `UPDATE STAGE_GROUP_MEMBER SET playoff_seed = ?, bye_status = FALSE WHERE member_id = ?`,
                [rank1Teams.length + i + 1, rank2Teams[i].member_id]
            );
        }
    }

    // Upper Round 1 Match 1 (Upper Semifinal 1)
    const [ubR1M1Res] = await conn.query(
        `INSERT INTO \`MATCH\` (stage_id, status, round_number, bracket_position, bracket_type)
         VALUES (?, 'scheduled', 1, 1, 'upper')`,
        [stageId]
    );
    const ubR1M1 = ubR1M1Res.insertId;
    await conn.query(`INSERT INTO MOBA_SERIES (match_id, best_of) VALUES (?, 'BO1')`, [ubR1M1]);

    if (rank1Teams[0]) {
        await conn.query(
            `INSERT INTO MATCH_PARTICIPANT (match_id, registration_id, side) VALUES (?, ?, 'A')`,
            [ubR1M1, rank1Teams[0].registration_id]
        );
    }
    const opp1 = rank2Teams.length > 1 ? rank2Teams[1] : rank2Teams[0];
    if (opp1) {
        await conn.query(
            `INSERT INTO MATCH_PARTICIPANT (match_id, registration_id, side) VALUES (?, ?, 'B')`,
            [ubR1M1, opp1.registration_id]
        );
    }

    // Upper Round 1 Match 2 (Upper Semifinal 2)
    const [ubR1M2Res] = await conn.query(
        `INSERT INTO \`MATCH\` (stage_id, status, round_number, bracket_position, bracket_type)
         VALUES (?, 'scheduled', 1, 2, 'upper')`,
        [stageId]
    );
    const ubR1M2 = ubR1M2Res.insertId;
    await conn.query(`INSERT INTO MOBA_SERIES (match_id, best_of) VALUES (?, 'BO1')`, [ubR1M2]);

    if (rank1Teams[1]) {
        await conn.query(
            `INSERT INTO MATCH_PARTICIPANT (match_id, registration_id, side) VALUES (?, ?, 'A')`,
            [ubR1M2, rank1Teams[1].registration_id]
        );
    }
    const opp2 = rank2Teams[0];
    if (opp2) {
        await conn.query(
            `INSERT INTO MATCH_PARTICIPANT (match_id, registration_id, side) VALUES (?, ?, 'B')`,
            [ubR1M2, opp2.registration_id]
        );
    }

    // Upper Round 2 (Upper Final)
    const [ubFinalRes] = await conn.query(
        `INSERT INTO \`MATCH\` (stage_id, status, round_number, bracket_position, bracket_type)
         VALUES (?, 'scheduled', 2, 1, 'upper')`,
        [stageId]
    );
    const ubFinal = ubFinalRes.insertId;
    await conn.query(`INSERT INTO MOBA_SERIES (match_id, best_of) VALUES (?, 'BO3')`, [ubFinal]);

    await conn.query(
        `INSERT INTO BRACKET_ADVANCEMENT (source_match_id, destination_match_id, outcome_type, destination_side)
         VALUES (?, ?, 'winner', 'A'), (?, ?, 'winner', 'B')`,
        [ubR1M1, ubFinal, ubR1M2, ubFinal]
    );

    // Lower Round 1 (Lower Semifinal)
    const [lbR1Res] = await conn.query(
        `INSERT INTO \`MATCH\` (stage_id, status, round_number, bracket_position, bracket_type)
         VALUES (?, 'scheduled', 1, 1, 'lower')`,
        [stageId]
    );
    const lbR1 = lbR1Res.insertId;
    await conn.query(`INSERT INTO MOBA_SERIES (match_id, best_of) VALUES (?, 'BO1')`, [lbR1]);

    await conn.query(
        `INSERT INTO BRACKET_ADVANCEMENT (source_match_id, destination_match_id, outcome_type, destination_side)
         VALUES (?, ?, 'loser', 'A'), (?, ?, 'loser', 'B')`,
        [ubR1M1, lbR1, ubR1M2, lbR1]
    );

    // Lower Round 2 (Lower Final)
    const [lbFinalRes] = await conn.query(
        `INSERT INTO \`MATCH\` (stage_id, status, round_number, bracket_position, bracket_type)
         VALUES (?, 'scheduled', 2, 1, 'lower')`,
        [stageId]
    );
    const lbFinal = lbFinalRes.insertId;
    await conn.query(`INSERT INTO MOBA_SERIES (match_id, best_of) VALUES (?, 'BO3')`, [lbFinal]);

    await conn.query(
        `INSERT INTO BRACKET_ADVANCEMENT (source_match_id, destination_match_id, outcome_type, destination_side)
         VALUES (?, ?, 'winner', 'A'), (?, ?, 'loser', 'B')`,
        [lbR1, lbFinal, ubFinal, lbFinal]
    );

    // Grand Final (Round 3)
    const [gfRes] = await conn.query(
        `INSERT INTO \`MATCH\` (stage_id, status, round_number, bracket_position, bracket_type)
         VALUES (?, 'scheduled', 3, 1, 'grand_final')`,
        [stageId]
    );
    const gfMatch = gfRes.insertId;
    await conn.query(`INSERT INTO MOBA_SERIES (match_id, best_of) VALUES (?, 'BO5')`, [gfMatch]);

    await conn.query(
        `INSERT INTO BRACKET_ADVANCEMENT (source_match_id, destination_match_id, outcome_type, destination_side)
         VALUES (?, ?, 'winner', 'A'), (?, ?, 'winner', 'B')`,
        [ubFinal, gfMatch, lbFinal, gfMatch]
    );

    return {
        playInMatchesCount: 0,
        upperMatchesCount: 3,
        lowerMatchesCount: 2,
        grandFinalMatchId: gfMatch
    };
}

/**
 * Helper: Generate Double Elimination Playoff Bracket for 8 Teams
 */
async function generate8TeamBracket(conn, stageId, qualifiedTeams) {
    let rank1Teams = qualifiedTeams.filter((t) => t.final_rank === 1);
    let rank2Teams = qualifiedTeams.filter((t) => t.final_rank === 2);

    if (rank1Teams.length === 0 && rank2Teams.length === 0) {
        rank1Teams = qualifiedTeams.slice(0, 4);
        rank2Teams = qualifiedTeams.slice(4, 8);
    }

    for (let i = 0; i < rank1Teams.length; i++) {
        if (rank1Teams[i].member_id) {
            await conn.query(
                `UPDATE STAGE_GROUP_MEMBER SET playoff_seed = ?, bye_status = FALSE WHERE member_id = ?`,
                [i + 1, rank1Teams[i].member_id]
            );
        }
    }
    for (let i = 0; i < rank2Teams.length; i++) {
        if (rank2Teams[i].member_id) {
            await conn.query(
                `UPDATE STAGE_GROUP_MEMBER SET playoff_seed = ?, bye_status = FALSE WHERE member_id = ?`,
                [rank1Teams.length + i + 1, rank2Teams[i].member_id]
            );
        }
    }

    // Upper Round 1 (Quarterfinals: 4 matches, BO1)
    const upperR1Matches = [];
    for (let i = 0; i < 4; i++) {
        const [mRes] = await conn.query(
            `INSERT INTO \`MATCH\` (stage_id, status, round_number, bracket_position, bracket_type)
             VALUES (?, 'scheduled', 1, ?, 'upper')`,
            [stageId, i + 1]
        );
        const mId = mRes.insertId;
        await conn.query(`INSERT INTO MOBA_SERIES (match_id, best_of) VALUES (?, 'BO1')`, [mId]);

        if (rank1Teams[i]) {
            await conn.query(
                `INSERT INTO MATCH_PARTICIPANT (match_id, registration_id, side) VALUES (?, ?, 'A')`,
                [mId, rank1Teams[i].registration_id]
            );
        }
        const r2Index = 3 - i;
        if (rank2Teams[r2Index]) {
            await conn.query(
                `INSERT INTO MATCH_PARTICIPANT (match_id, registration_id, side) VALUES (?, ?, 'B')`,
                [mId, rank2Teams[r2Index].registration_id]
            );
        }
        upperR1Matches.push(mId);
    }

    // Upper Round 2 (Semifinals: 2 matches, BO3)
    const upperSFMatches = [];
    for (let i = 0; i < 2; i++) {
        const [mRes] = await conn.query(
            `INSERT INTO \`MATCH\` (stage_id, status, round_number, bracket_position, bracket_type)
             VALUES (?, 'scheduled', 2, ?, 'upper')`,
            [stageId, i + 1]
        );
        const mId = mRes.insertId;
        await conn.query(`INSERT INTO MOBA_SERIES (match_id, best_of) VALUES (?, 'BO3')`, [mId]);
        upperSFMatches.push(mId);

        await conn.query(
            `INSERT INTO BRACKET_ADVANCEMENT (source_match_id, destination_match_id, outcome_type, destination_side)
             VALUES (?, ?, 'winner', 'A'), (?, ?, 'winner', 'B')`,
            [upperR1Matches[i * 2], mId, upperR1Matches[i * 2 + 1], mId]
        );
    }

    // Upper Round 3 (Upper Final: 1 match, BO3)
    const [ubFinalRes] = await conn.query(
        `INSERT INTO \`MATCH\` (stage_id, status, round_number, bracket_position, bracket_type)
         VALUES (?, 'scheduled', 3, 1, 'upper')`,
        [stageId]
    );
    const upperFinalMatch = ubFinalRes.insertId;
    await conn.query(`INSERT INTO MOBA_SERIES (match_id, best_of) VALUES (?, 'BO3')`, [upperFinalMatch]);

    await conn.query(
        `INSERT INTO BRACKET_ADVANCEMENT (source_match_id, destination_match_id, outcome_type, destination_side)
         VALUES (?, ?, 'winner', 'A'), (?, ?, 'winner', 'B')`,
        [upperSFMatches[0], upperFinalMatch, upperSFMatches[1], upperFinalMatch]
    );

    // Lower Round 1 (2 matches, BO1)
    const lowerR1Matches = [];
    for (let i = 0; i < 2; i++) {
        const [mRes] = await conn.query(
            `INSERT INTO \`MATCH\` (stage_id, status, round_number, bracket_position, bracket_type)
             VALUES (?, 'scheduled', 1, ?, 'lower')`,
            [stageId, i + 1]
        );
        const mId = mRes.insertId;
        await conn.query(`INSERT INTO MOBA_SERIES (match_id, best_of) VALUES (?, 'BO1')`, [mId]);
        lowerR1Matches.push(mId);

        await conn.query(
            `INSERT INTO BRACKET_ADVANCEMENT (source_match_id, destination_match_id, outcome_type, destination_side)
             VALUES (?, ?, 'loser', 'A'), (?, ?, 'loser', 'B')`,
            [upperR1Matches[i * 2], mId, upperR1Matches[i * 2 + 1], mId]
        );
    }

    // Lower Round 2 (2 matches, BO1)
    const lowerR2Matches = [];
    for (let i = 0; i < 2; i++) {
        const [mRes] = await conn.query(
            `INSERT INTO \`MATCH\` (stage_id, status, round_number, bracket_position, bracket_type)
             VALUES (?, 'scheduled', 2, ?, 'lower')`,
            [stageId, i + 1]
        );
        const mId = mRes.insertId;
        await conn.query(`INSERT INTO MOBA_SERIES (match_id, best_of) VALUES (?, 'BO1')`, [mId]);
        lowerR2Matches.push(mId);

        await conn.query(
            `INSERT INTO BRACKET_ADVANCEMENT (source_match_id, destination_match_id, outcome_type, destination_side)
             VALUES (?, ?, 'winner', 'A'), (?, ?, 'loser', 'B')`,
            [lowerR1Matches[i], mId, upperSFMatches[1 - i], mId]
        );
    }

    // Lower Round 3 (Lower Semifinal: 1 match, BO1)
    const [lbR3Res] = await conn.query(
        `INSERT INTO \`MATCH\` (stage_id, status, round_number, bracket_position, bracket_type)
         VALUES (?, 'scheduled', 3, 1, 'lower')`,
        [stageId]
    );
    const lowerR3Match = lbR3Res.insertId;
    await conn.query(`INSERT INTO MOBA_SERIES (match_id, best_of) VALUES (?, 'BO1')`, [lowerR3Match]);

    await conn.query(
        `INSERT INTO BRACKET_ADVANCEMENT (source_match_id, destination_match_id, outcome_type, destination_side)
         VALUES (?, ?, 'winner', 'A'), (?, ?, 'winner', 'B')`,
        [lowerR2Matches[0], lowerR3Match, lowerR2Matches[1], lowerR3Match]
    );

    // Lower Round 4 (Lower Final: 1 match, BO3)
    const [lbFinalRes] = await conn.query(
        `INSERT INTO \`MATCH\` (stage_id, status, round_number, bracket_position, bracket_type)
         VALUES (?, 'scheduled', 4, 1, 'lower')`,
        [stageId]
    );
    const lowerFinalMatch = lbFinalRes.insertId;
    await conn.query(`INSERT INTO MOBA_SERIES (match_id, best_of) VALUES (?, 'BO3')`, [lowerFinalMatch]);

    await conn.query(
        `INSERT INTO BRACKET_ADVANCEMENT (source_match_id, destination_match_id, outcome_type, destination_side)
         VALUES (?, ?, 'winner', 'A'), (?, ?, 'loser', 'B')`,
        [lowerR3Match, lowerFinalMatch, upperFinalMatch, lowerFinalMatch]
    );

    // Grand Final (Round 5)
    const [gfRes] = await conn.query(
        `INSERT INTO \`MATCH\` (stage_id, status, round_number, bracket_position, bracket_type)
         VALUES (?, 'scheduled', 5, 1, 'grand_final')`,
        [stageId]
    );
    const grandFinalMatch = gfRes.insertId;
    await conn.query(`INSERT INTO MOBA_SERIES (match_id, best_of) VALUES (?, 'BO5')`, [grandFinalMatch]);

    await conn.query(
        `INSERT INTO BRACKET_ADVANCEMENT (source_match_id, destination_match_id, outcome_type, destination_side)
         VALUES (?, ?, 'winner', 'A'), (?, ?, 'winner', 'B')`,
        [upperFinalMatch, grandFinalMatch, lowerFinalMatch, grandFinalMatch]
    );

    return {
        playInMatchesCount: 0,
        upperMatchesCount: 7,
        lowerMatchesCount: 6,
        grandFinalMatchId: grandFinalMatch
    };
}

/**
 * Helper: Generate Double Elimination Playoff Bracket for 16 or 24 Teams (with optional Play-In)
 */
async function generate16Or24TeamBracket(conn, stageId, qualifiedTeams) {
    const totalQual = qualifiedTeams.length;
    const target = 16;
    const playInCount = totalQual > target ? totalQual - target : 0;
    const byeCount = playInCount > 0 ? 2 * target - totalQual : totalQual;

    let byeTeams = [];
    let playInTeams = [];

    let rank1Teams = qualifiedTeams.filter((t) => t.final_rank === 1);
    let rank2Teams = qualifiedTeams.filter((t) => t.final_rank === 2);

    if (rank1Teams.length === 0 && rank2Teams.length === 0) {
        rank1Teams = qualifiedTeams.slice(0, Math.ceil(totalQual / 2));
        rank2Teams = qualifiedTeams.slice(Math.ceil(totalQual / 2));
    }

    if (playInCount > 0) {
        byeTeams = rank1Teams.slice(0, byeCount);
        const remainingRank1 = rank1Teams.slice(byeCount);
        playInTeams = [...remainingRank1, ...rank2Teams];
    } else {
        byeTeams = rank1Teams;
    }

    for (let i = 0; i < byeTeams.length; i++) {
        if (byeTeams[i].member_id) {
            await conn.query(
                `UPDATE STAGE_GROUP_MEMBER SET playoff_seed = ?, bye_status = TRUE WHERE member_id = ?`,
                [i + 1, byeTeams[i].member_id]
            );
        }
    }
    for (let i = 0; i < playInTeams.length; i++) {
        if (playInTeams[i].member_id) {
            await conn.query(
                `UPDATE STAGE_GROUP_MEMBER SET playoff_seed = ?, bye_status = FALSE WHERE member_id = ?`,
                [byeCount + i + 1, playInTeams[i].member_id]
            );
        }
    }

    const playInMatches = [];
    if (playInCount > 0) {
        for (let p = 0; p < playInCount; p++) {
            const teamA = playInTeams[p * 2];
            const teamB = playInTeams[p * 2 + 1];

            const [mRes] = await conn.query(
                `INSERT INTO \`MATCH\` (stage_id, status, round_number, bracket_position, bracket_type)
                 VALUES (?, 'scheduled', 0, ?, 'play_in')`,
                [stageId, p + 1]
            );
            const matchId = mRes.insertId;

            await conn.query(`INSERT INTO MOBA_SERIES (match_id, best_of) VALUES (?, 'BO1')`, [matchId]);

            if (teamA) {
                await conn.query(
                    `INSERT INTO MATCH_PARTICIPANT (match_id, registration_id, side) VALUES (?, ?, 'A')`,
                    [matchId, teamA.registration_id]
                );
            }
            if (teamB) {
                await conn.query(
                    `INSERT INTO MATCH_PARTICIPANT (match_id, registration_id, side) VALUES (?, ?, 'B')`,
                    [matchId, teamB.registration_id]
                );
            }

            playInMatches.push({ matchId, p });
        }
    }

    const upperR1Matches = [];
    const upperQFMatches = [];
    const upperSFMatches = [];
    let upperFinalMatch = null;

    const lowerR1Matches = [];
    const lowerR2Matches = [];
    const lowerR3Matches = [];
    const lowerR4Matches = [];
    let lowerR5Match = null;
    let lowerFinalMatch = null;
    let grandFinalMatch = null;

    const mainSize = target;
    const r1Count = mainSize / 2;

    for (let i = 0; i < r1Count; i++) {
        const [mRes] = await conn.query(
            `INSERT INTO \`MATCH\` (stage_id, status, round_number, bracket_position, bracket_type)
             VALUES (?, 'scheduled', 1, ?, 'upper')`,
            [stageId, i + 1]
        );
        const mId = mRes.insertId;
        await conn.query(`INSERT INTO MOBA_SERIES (match_id, best_of) VALUES (?, 'BO1')`, [mId]);

        if (i < byeTeams.length) {
            await conn.query(
                `INSERT INTO MATCH_PARTICIPANT (match_id, registration_id, side) VALUES (?, ?, 'A')`,
                [mId, byeTeams[i].registration_id]
            );
        }

        if (playInCount === 0 && r1Count === 8) {
            const pairIndex = i % 2 === 0 ? i + 1 : i - 1;
            const opponentTeam = rank2Teams[pairIndex];
            if (opponentTeam) {
                await conn.query(
                    `INSERT INTO MATCH_PARTICIPANT (match_id, registration_id, side) VALUES (?, ?, 'B')`,
                    [mId, opponentTeam.registration_id]
                );
            }
        }

        upperR1Matches.push(mId);
    }

    if (playInCount > 0) {
        for (let p = 0; p < playInMatches.length; p++) {
            const destUpperMatchId = upperR1Matches[p % upperR1Matches.length];
            await conn.query(
                `INSERT INTO BRACKET_ADVANCEMENT (source_match_id, destination_match_id, outcome_type, destination_side)
                 VALUES (?, ?, 'winner', 'B')`,
                [playInMatches[p].matchId, destUpperMatchId]
            );
        }
    }

    const qfCount = r1Count / 2;
    for (let i = 0; i < qfCount; i++) {
        const [mRes] = await conn.query(
            `INSERT INTO \`MATCH\` (stage_id, status, round_number, bracket_position, bracket_type)
             VALUES (?, 'scheduled', 2, ?, 'upper')`,
            [stageId, i + 1]
        );
        const mId = mRes.insertId;
        await conn.query(`INSERT INTO MOBA_SERIES (match_id, best_of) VALUES (?, 'BO1')`, [mId]);
        upperQFMatches.push(mId);

        await conn.query(
            `INSERT INTO BRACKET_ADVANCEMENT (source_match_id, destination_match_id, outcome_type, destination_side)
             VALUES (?, ?, 'winner', 'A'), (?, ?, 'winner', 'B')`,
            [upperR1Matches[i * 2], mId, upperR1Matches[i * 2 + 1], mId]
        );
    }

    const sfCount = qfCount / 2;
    for (let i = 0; i < sfCount; i++) {
        const [mRes] = await conn.query(
            `INSERT INTO \`MATCH\` (stage_id, status, round_number, bracket_position, bracket_type)
             VALUES (?, 'scheduled', 3, ?, 'upper')`,
            [stageId, i + 1]
        );
        const mId = mRes.insertId;
        await conn.query(`INSERT INTO MOBA_SERIES (match_id, best_of) VALUES (?, 'BO3')`, [mId]);
        upperSFMatches.push(mId);

        await conn.query(
            `INSERT INTO BRACKET_ADVANCEMENT (source_match_id, destination_match_id, outcome_type, destination_side)
             VALUES (?, ?, 'winner', 'A'), (?, ?, 'winner', 'B')`,
            [upperQFMatches[i * 2], mId, upperQFMatches[i * 2 + 1], mId]
        );
    }

    {
        const [mRes] = await conn.query(
            `INSERT INTO \`MATCH\` (stage_id, status, round_number, bracket_position, bracket_type)
             VALUES (?, 'scheduled', 4, 1, 'upper')`,
            [stageId]
        );
        upperFinalMatch = mRes.insertId;
        await conn.query(`INSERT INTO MOBA_SERIES (match_id, best_of) VALUES (?, 'BO1')`, [upperFinalMatch]);

        await conn.query(
            `INSERT INTO BRACKET_ADVANCEMENT (source_match_id, destination_match_id, outcome_type, destination_side)
             VALUES (?, ?, 'winner', 'A'), (?, ?, 'winner', 'B')`,
            [upperSFMatches[0], upperFinalMatch, upperSFMatches[1], upperFinalMatch]
        );
    }

    for (let i = 0; i < r1Count / 2; i++) {
        const [mRes] = await conn.query(
            `INSERT INTO \`MATCH\` (stage_id, status, round_number, bracket_position, bracket_type)
             VALUES (?, 'scheduled', 1, ?, 'lower')`,
            [stageId, i + 1]
        );
        const mId = mRes.insertId;
        await conn.query(`INSERT INTO MOBA_SERIES (match_id, best_of) VALUES (?, 'BO1')`, [mId]);
        lowerR1Matches.push(mId);

        await conn.query(
            `INSERT INTO BRACKET_ADVANCEMENT (source_match_id, destination_match_id, outcome_type, destination_side)
             VALUES (?, ?, 'loser', 'A'), (?, ?, 'loser', 'B')`,
            [upperR1Matches[i * 2], mId, upperR1Matches[i * 2 + 1], mId]
        );
    }

    for (let i = 0; i < r1Count / 2; i++) {
        const [mRes] = await conn.query(
            `INSERT INTO \`MATCH\` (stage_id, status, round_number, bracket_position, bracket_type)
             VALUES (?, 'scheduled', 2, ?, 'lower')`,
            [stageId, i + 1]
        );
        const mId = mRes.insertId;
        await conn.query(`INSERT INTO MOBA_SERIES (match_id, best_of) VALUES (?, 'BO1')`, [mId]);
        lowerR2Matches.push(mId);

        await conn.query(
            `INSERT INTO BRACKET_ADVANCEMENT (source_match_id, destination_match_id, outcome_type, destination_side)
             VALUES (?, ?, 'winner', 'A'), (?, ?, 'loser', 'B')`,
            [lowerR1Matches[i], mId, upperQFMatches[i], mId]
        );
    }

    for (let i = 0; i < 2; i++) {
        const [mRes] = await conn.query(
            `INSERT INTO \`MATCH\` (stage_id, status, round_number, bracket_position, bracket_type)
             VALUES (?, 'scheduled', 3, ?, 'lower')`,
            [stageId, i + 1]
        );
        const mId = mRes.insertId;
        await conn.query(`INSERT INTO MOBA_SERIES (match_id, best_of) VALUES (?, 'BO1')`, [mId]);
        lowerR3Matches.push(mId);

        await conn.query(
            `INSERT INTO BRACKET_ADVANCEMENT (source_match_id, destination_match_id, outcome_type, destination_side)
             VALUES (?, ?, 'winner', 'A'), (?, ?, 'winner', 'B')`,
            [lowerR2Matches[i * 2], mId, lowerR2Matches[i * 2 + 1], mId]
        );
    }

    for (let i = 0; i < 2; i++) {
        const [mRes] = await conn.query(
            `INSERT INTO \`MATCH\` (stage_id, status, round_number, bracket_position, bracket_type)
             VALUES (?, 'scheduled', 4, ?, 'lower')`,
            [stageId, i + 1]
        );
        const mId = mRes.insertId;
        await conn.query(`INSERT INTO MOBA_SERIES (match_id, best_of) VALUES (?, 'BO3')`, [mId]);
        lowerR4Matches.push(mId);

        await conn.query(
            `INSERT INTO BRACKET_ADVANCEMENT (source_match_id, destination_match_id, outcome_type, destination_side)
             VALUES (?, ?, 'winner', 'A'), (?, ?, 'loser', 'B')`,
            [lowerR3Matches[i], mId, upperSFMatches[i], mId]
        );
    }

    {
        const [mRes] = await conn.query(
            `INSERT INTO \`MATCH\` (stage_id, status, round_number, bracket_position, bracket_type)
             VALUES (?, 'scheduled', 5, 1, 'lower')`,
            [stageId]
        );
        lowerR5Match = mRes.insertId;
        await conn.query(`INSERT INTO MOBA_SERIES (match_id, best_of) VALUES (?, 'BO1')`, [lowerR5Match]);

        await conn.query(
            `INSERT INTO BRACKET_ADVANCEMENT (source_match_id, destination_match_id, outcome_type, destination_side)
             VALUES (?, ?, 'winner', 'A'), (?, ?, 'winner', 'B')`,
            [lowerR4Matches[0], lowerR5Match, lowerR4Matches[1], lowerR5Match]
        );
    }

    {
        const [mRes] = await conn.query(
            `INSERT INTO \`MATCH\` (stage_id, status, round_number, bracket_position, bracket_type)
             VALUES (?, 'scheduled', 6, 1, 'lower')`,
            [stageId]
        );
        lowerFinalMatch = mRes.insertId;
        await conn.query(`INSERT INTO MOBA_SERIES (match_id, best_of) VALUES (?, 'BO1')`, [lowerFinalMatch]);

        await conn.query(
            `INSERT INTO BRACKET_ADVANCEMENT (source_match_id, destination_match_id, outcome_type, destination_side)
             VALUES (?, ?, 'winner', 'A'), (?, ?, 'loser', 'B')`,
            [lowerR5Match, lowerFinalMatch, upperFinalMatch, lowerFinalMatch]
        );
    }

    {
        const [mRes] = await conn.query(
            `INSERT INTO \`MATCH\` (stage_id, status, round_number, bracket_position, bracket_type)
             VALUES (?, 'scheduled', 7, 1, 'grand_final')`,
            [stageId]
        );
        grandFinalMatch = mRes.insertId;
        await conn.query(`INSERT INTO MOBA_SERIES (match_id, best_of) VALUES (?, 'BO5')`, [grandFinalMatch]);

        await conn.query(
            `INSERT INTO BRACKET_ADVANCEMENT (source_match_id, destination_match_id, outcome_type, destination_side)
             VALUES (?, ?, 'winner', 'A'), (?, ?, 'winner', 'B')`,
            [upperFinalMatch, grandFinalMatch, lowerFinalMatch, grandFinalMatch]
        );
    }

    return {
        playInMatchesCount: playInMatches.length,
        upperMatchesCount: upperR1Matches.length + upperQFMatches.length + upperSFMatches.length + 1,
        lowerMatchesCount: lowerR1Matches.length + lowerR2Matches.length + lowerR3Matches.length + lowerR4Matches.length + 1 + 1,
        grandFinalMatchId: grandFinalMatch
    };
}

/**
 * Main dispatcher: Generate Single Elimination Bracket
 * Supports 2, 4, 8, 16, 32 teams with BYEs, series BO configuration, and BRACKET_ADVANCEMENT rules.
 */
async function generateSingleEliminationBracket(conn, stageId, teams) {
    // 1. Clean up any existing bracket matches for this stage
    await conn.query("DELETE FROM `MATCH` WHERE stage_id = ? AND bracket_type != 'group'", [stageId]);

    const totalTeams = teams.length;
    if (totalTeams < 2) {
        throw new Error("AT LEAST 2 TEAMS REQUIRED FOR SINGLE ELIMINATION BRACKET");
    }

    // Determine target bracket power of 2: P >= totalTeams (e.g. 2, 4, 8, 16, 32)
    let P = 2;
    while (P < totalTeams) {
        P *= 2;
    }
    const totalRounds = Math.log2(P);

    // Map: roundNumber (1..totalRounds) -> array of match IDs
    const roundMatches = {};
    for (let r = 1; r <= totalRounds; r++) {
        roundMatches[r] = [];
        const matchesInRound = P / Math.pow(2, r);
        const isFinal = (r === totalRounds);
        const isSemi = (r === totalRounds - 1 && totalRounds > 1);
        const bestOf = isFinal ? "BO5" : (isSemi ? "BO3" : "BO1");
        const bType = isFinal ? "grand_final" : "upper";

        for (let pos = 1; pos <= matchesInRound; pos++) {
            const [mRes] = await conn.query(
                `INSERT INTO \`MATCH\` (stage_id, status, round_number, bracket_position, bracket_type)
                 VALUES (?, 'scheduled', ?, ?, ?)`,
                [stageId, r, pos, bType]
            );
            const mId = mRes.insertId;
            await conn.query(`INSERT INTO MOBA_SERIES (match_id, best_of) VALUES (?, ?)`, [mId, bestOf]);
            roundMatches[r].push(mId);
        }
    }

    // Connect BRACKET_ADVANCEMENT between rounds
    for (let r = 1; r < totalRounds; r++) {
        const matchesInRound = roundMatches[r].length;
        for (let i = 0; i < matchesInRound; i++) {
            const sourceMatchId = roundMatches[r][i];
            const destIndex = Math.floor(i / 2);
            const destinationMatchId = roundMatches[r + 1][destIndex];
            const destinationSide = (i % 2 === 0) ? "A" : "B";

            await conn.query(
                `INSERT INTO BRACKET_ADVANCEMENT (source_match_id, destination_match_id, outcome_type, destination_side)
                 VALUES (?, ?, 'winner', ?)`,
                [sourceMatchId, destinationMatchId, destinationSide]
            );
        }
    }

    // Seed Round 1 matches
    const round1Count = P / 2;
    const byeCount = P - totalTeams;

    let teamIdx = 0;
    for (let k = 0; k < round1Count; k++) {
        const mId = roundMatches[1][k];
        const teamA = teams[teamIdx++];
        let teamB = null;

        if (k >= byeCount && teamIdx < totalTeams) {
            teamB = teams[teamIdx++];
        } else if (teamIdx < totalTeams && (round1Count - k - 1) * 2 + 1 < (totalTeams - teamIdx + 1)) {
            teamB = teams[teamIdx++];
        }

        if (teamA) {
            await conn.query(
                `INSERT INTO MATCH_PARTICIPANT (match_id, registration_id, side) VALUES (?, ?, 'A')`,
                [mId, teamA.registration_id]
            );
        }

        if (teamB) {
            await conn.query(
                `INSERT INTO MATCH_PARTICIPANT (match_id, registration_id, side) VALUES (?, ?, 'B')`,
                [mId, teamB.registration_id]
            );
        } else if (teamA && totalRounds > 1) {
            // Team A has a BYE in Round 1: Mark match completed and auto-advance to Round 2
            await conn.query(
                `UPDATE \`MATCH\` SET status = 'completed' WHERE match_id = ?`,
                [mId]
            );

            const destIndex = Math.floor(k / 2);
            const destinationMatchId = roundMatches[2][destIndex];
            const destinationSide = (k % 2 === 0) ? "A" : "B";

            await conn.query(
                `INSERT INTO MATCH_PARTICIPANT (match_id, registration_id, side) VALUES (?, ?, ?)`,
                [destinationMatchId, teamA.registration_id, destinationSide]
            );
        }
    }

    // Ensure any destination matches with both participants filled are marked as scheduled
    await conn.query(
        `UPDATE \`MATCH\` m
         SET status = 'scheduled'
         WHERE stage_id = ? AND status = 'scheduled' AND (
            SELECT COUNT(*) FROM MATCH_PARTICIPANT mp WHERE mp.match_id = m.match_id
         ) = 2`,
        [stageId]
    );

    return {
        totalRounds,
        totalMatches: P - 1,
        grandFinalMatchId: roundMatches[totalRounds][0]
    };
}

/**
 * Main dispatcher: Generate Double Elimination Playoff Bracket
 */
async function generateDoubleEliminationBracket(conn, stageId, qualifiedTeams) {
    // Clean up any existing playoff matches for this stage to ensure clean generation
    await conn.query("DELETE FROM `MATCH` WHERE stage_id = ? AND bracket_type != 'group'", [stageId]);

    const totalQual = qualifiedTeams.length;
    if (totalQual <= 4) {
        return await generate4TeamBracket(conn, stageId, qualifiedTeams);
    }
    if (totalQual <= 8) {
        return await generate8TeamBracket(conn, stageId, qualifiedTeams);
    }
    return await generate16Or24TeamBracket(conn, stageId, qualifiedTeams);
}

/**
 * POST /api/stages/:stageId/generate-qualification
 * Organizer-only endpoint to calculate standings for all groups and determine the Top 2 qualified teams per group.
 */
router.post("/:stageId/generate-qualification", requireAuth, requireRole("organizer"), async (req, res) => {
    const stageId = req.params.stageId;
    const organizerId = req.session.userId;

    let conn;
    try {
        conn = await db.promise().getConnection();
        await conn.beginTransaction();

        const [stages] = await conn.query(
            `SELECT ts.stage_id, ts.tournament_id, ts.stage_format, ts.group_generation_status,
                    t.organizer_id, t.status AS tournament_status
             FROM TOURNAMENT_STAGE ts
             JOIN TOURNAMENT t ON ts.tournament_id = t.tournament_id
             WHERE ts.stage_id = ? FOR UPDATE`,
            [stageId]
        );

        if (stages.length === 0) {
            await conn.rollback();
            return res.status(404).json({
                error: "STAGE NOT FOUND",
                code: "NOT_FOUND"
            });
        }

        const stage = stages[0];

        if (stage.organizer_id !== organizerId) {
            await conn.rollback();
            return res.status(403).json({
                error: "YOU DO NOT OWN THIS TOURNAMENT",
                code: "FORBIDDEN"
            });
        }

        if (stage.stage_format !== "group_stage") {
            await conn.rollback();
            return res.status(400).json({
                error: "STAGE FORMAT MUST BE group_stage TO GENERATE QUALIFICATION",
                code: "INVALID_INPUT"
            });
        }

        if (stage.group_generation_status === "bracket_generated") {
            await conn.rollback();
            return res.status(409).json({
                error: "QUALIFICATION IS LOCKED BECAUSE PLAYOFF BRACKET HAS ALREADY BEEN GENERATED",
                code: "STATE_CONFLICT"
            });
        }

        const [groups] = await conn.query(
            `SELECT group_id, group_name, group_order FROM STAGE_GROUP WHERE stage_id = ? ORDER BY group_order ASC FOR UPDATE`,
            [stageId]
        );

        if (groups.length === 0) {
            await conn.rollback();
            return res.status(409).json({
                error: "NO GROUPS FOUND FOR THIS STAGE",
                code: "STATE_CONFLICT"
            });
        }

        const [matchCounts] = await conn.query(
            `SELECT m.group_id, COUNT(m.match_id) AS total_matches,
                    COUNT(mr.result_id) AS verified_matches
             FROM \`MATCH\` m
             LEFT JOIN MATCH_RESULT mr ON m.match_id = mr.match_id AND mr.status = 'VERIFIED'
             WHERE m.stage_id = ? AND m.group_id IS NOT NULL
             GROUP BY m.group_id`,
            [stageId]
        );

        if (matchCounts.length !== groups.length) {
            await conn.rollback();
            return res.status(409).json({
                error: "All group matches must be verified before qualification",
                code: "GROUP_STAGE_NOT_COMPLETE"
            });
        }

        for (const mc of matchCounts) {
            if (mc.total_matches !== 6 || mc.verified_matches !== 6) {
                await conn.rollback();
                return res.status(409).json({
                    error: "All group matches must be verified before qualification",
                    code: "GROUP_STAGE_NOT_COMPLETE"
                });
            }
        }

        const qualifiedResults = [];

        for (const g of groups) {
            const [members] = await conn.query(
                `SELECT sgm.member_id, sgm.group_id, sgm.stage_id, sgm.registration_id, sgm.slot_number,
                        sgm.final_rank, sgm.qualified, r.team_id, tm.team_name, tm.team_tag
                 FROM STAGE_GROUP_MEMBER sgm
                 JOIN REGISTRATION r ON sgm.registration_id = r.registration_id
                 JOIN TEAM tm ON r.team_id = tm.team_id
                 WHERE sgm.group_id = ? AND sgm.stage_id = ? FOR UPDATE`,
                [g.group_id, stageId]
            );

            const [vMatches] = await conn.query(
                `SELECT m.match_id, mr.winning_registration_id, mr.team_a_kills, mr.team_b_kills,
                        mpA.registration_id AS reg_a, mpB.registration_id AS reg_b
                 FROM \`MATCH\` m
                 JOIN MATCH_RESULT mr ON m.match_id = mr.match_id
                 JOIN MATCH_PARTICIPANT mpA ON m.match_id = mpA.match_id AND mpA.side = 'A'
                 JOIN MATCH_PARTICIPANT mpB ON m.match_id = mpB.match_id AND mpB.side = 'B'
                 WHERE m.group_id = ? AND mr.status = 'VERIFIED'`,
                [g.group_id]
            );

            const statsMap = new Map();
            members.forEach((m) => {
                statsMap.set(m.registration_id, {
                    member_id: m.member_id,
                    registration_id: m.registration_id,
                    team_id: m.team_id,
                    team_name: m.team_name,
                    team_tag: m.team_tag,
                    group_id: g.group_id,
                    group_name: g.group_name,
                    group_order: g.group_order,
                    slot_number: m.slot_number,
                    wins: 0,
                    total_kills: 0,
                    total_conceded: 0,
                    kill_difference: 0,
                    final_rank: m.final_rank
                });
            });

            vMatches.forEach((match) => {
                const teamA = statsMap.get(match.reg_a);
                const teamB = statsMap.get(match.reg_b);
                if (teamA) {
                    teamA.total_kills += match.team_a_kills;
                    teamA.total_conceded += match.team_b_kills;
                    if (match.winning_registration_id === teamA.registration_id) teamA.wins += 1;
                }
                if (teamB) {
                    teamB.total_kills += match.team_b_kills;
                    teamB.total_conceded += match.team_a_kills;
                    if (match.winning_registration_id === teamB.registration_id) teamB.wins += 1;
                }
            });

            const standings = Array.from(statsMap.values()).map((s) => {
                s.kill_difference = s.total_kills - s.total_conceded;
                return s;
            });

            standings.sort((a, b) => {
                if (b.wins !== a.wins) return b.wins - a.wins;
                if (b.total_kills !== a.total_kills) return b.total_kills - a.total_kills;
                if (b.kill_difference !== a.kill_difference) return b.kill_difference - a.kill_difference;
                if (a.final_rank !== null && b.final_rank !== null && a.final_rank !== b.final_rank) {
                    return a.final_rank - b.final_rank;
                }
                if (a.final_rank !== null && b.final_rank === null) return -1;
                if (a.final_rank === null && b.final_rank !== null) return 1;
                return 0;
            });

            const p2 = standings[1];
            const p3 = standings[2];
            const isTied =
                p2.wins === p3.wins &&
                p2.total_kills === p3.total_kills &&
                p2.kill_difference === p3.kill_difference &&
                (p2.final_rank === null || p3.final_rank === null || p2.final_rank === p3.final_rank);

            if (isTied) {
                await conn.rollback();
                return res.status(409).json({
                    error: `Qualification cannot be generated due to an unresolved tie in group '${g.group_name}'. The organizer must set final_rank to resolve the tie.`,
                    code: "QUALIFICATION_TIE_UNRESOLVED"
                });
            }

            for (let i = 0; i < standings.length; i++) {
                const rank = i + 1;
                const isQual = rank <= 2;
                if (standings[i].final_rank !== null) {
                    await conn.query(
                        `UPDATE STAGE_GROUP_MEMBER SET qualified = ? WHERE member_id = ?`,
                        [isQual, standings[i].member_id]
                    );
                } else {
                    await conn.query(
                        `UPDATE STAGE_GROUP_MEMBER SET qualified = ?, final_rank = ? WHERE member_id = ?`,
                        [isQual, rank, standings[i].member_id]
                    );
                }

                if (isQual) {
                    qualifiedResults.push({
                        member_id: standings[i].member_id,
                        registration_id: standings[i].registration_id,
                        team_id: standings[i].team_id,
                        team_name: standings[i].team_name,
                        group_name: g.group_name,
                        final_rank: standings[i].final_rank !== null ? standings[i].final_rank : rank
                    });
                }
            }
        }

        await conn.query(
            `UPDATE TOURNAMENT_STAGE SET group_generation_status = 'qualified' WHERE stage_id = ?`,
            [stageId]
        );

        await conn.commit();

        return res.status(200).json({
            message: "Group stage qualification generated successfully",
            stageId: Number(stageId),
            totalGroups: groups.length,
            qualifiedCount: qualifiedResults.length,
            qualifiedTeams: qualifiedResults
        });
    } catch (err) {
        if (conn) await conn.rollback();
        console.error(err);
        return res.status(500).json({
            error: "FAILED TO GENERATE QUALIFICATION",
            code: "INTERNAL_SERVER_ERROR"
        });
    } finally {
        if (conn) conn.release();
    }
});

/**
 * PUT /api/stages/:stageId/groups/:groupId/members/:memberId/rank
 * Organizer-only endpoint to manually set final_rank for a group member to resolve a tie.
 */
router.put("/:stageId/groups/:groupId/members/:memberId/rank", requireAuth, requireRole("organizer"), async (req, res) => {
    const { stageId, groupId, memberId } = req.params;
    const organizerId = req.session.userId;
    const { final_rank } = req.body;

    if (final_rank === undefined || !Number.isInteger(Number(final_rank)) || Number(final_rank) < 1 || Number(final_rank) > 4) {
        return res.status(400).json({
            error: "FINAL RANK MUST BE AN INTEGER BETWEEN 1 AND 4",
            code: "INVALID_INPUT"
        });
    }

    let conn;
    try {
        conn = await db.promise().getConnection();
        await conn.beginTransaction();

        const [stages] = await conn.query(
            `SELECT ts.stage_id, ts.tournament_id, ts.group_generation_status, t.organizer_id
             FROM TOURNAMENT_STAGE ts
             JOIN TOURNAMENT t ON ts.tournament_id = t.tournament_id
             WHERE ts.stage_id = ? FOR UPDATE`,
            [stageId]
        );

        if (stages.length === 0) {
            await conn.rollback();
            return res.status(404).json({
                error: "STAGE NOT FOUND",
                code: "NOT_FOUND"
            });
        }

        if (stages[0].organizer_id !== organizerId) {
            await conn.rollback();
            return res.status(403).json({
                error: "YOU DO NOT OWN THIS TOURNAMENT",
                code: "FORBIDDEN"
            });
        }

        if (stages[0].group_generation_status === "bracket_generated") {
            await conn.rollback();
            return res.status(409).json({
                error: "FINAL RANK IS LOCKED BECAUSE PLAYOFF BRACKET IS GENERATED",
                code: "STATE_CONFLICT"
            });
        }

        await conn.query(
            `UPDATE STAGE_GROUP_MEMBER SET final_rank = ? WHERE member_id = ? AND group_id = ? AND stage_id = ?`,
            [Number(final_rank), memberId, groupId, stageId]
        );

        await conn.commit();

        return res.status(200).json({
            message: "Final rank set successfully",
            memberId: Number(memberId),
            final_rank: Number(final_rank)
        });
    } catch (err) {
        if (conn) await conn.rollback();
        console.error(err);
        return res.status(500).json({
            error: "FAILED TO SET FINAL RANK",
            code: "INTERNAL_SERVER_ERROR"
        });
    } finally {
        if (conn) conn.release();
    }
});

/**
 * POST /api/stages/:stageId/generate-bracket
 * Organizer-only endpoint to generate either Single Elimination or Double Elimination bracket.
 * Sourced from:
 * 1) Top qualified teams if stage is 'group_stage' (or previous stage had group qualification).
 * 2) Approved tournament registrations if standalone stage.
 */
router.post("/:stageId/generate-bracket", requireAuth, requireRole("organizer"), async (req, res) => {
    const stageId = req.params.stageId;
    const organizerId = req.session.userId;
    const { seeding_mode, seedingMode } = req.body || {};
    const mode = seeding_mode || seedingMode || "sequential";

    let conn;
    try {
        conn = await db.promise().getConnection();
        await conn.beginTransaction();

        const [stages] = await conn.query(
            `SELECT ts.stage_id, ts.tournament_id, ts.stage_order, ts.stage_format, ts.group_generation_status,
                    t.organizer_id, t.status AS tournament_status
             FROM TOURNAMENT_STAGE ts
             JOIN TOURNAMENT t ON ts.tournament_id = t.tournament_id
             WHERE ts.stage_id = ? FOR UPDATE`,
            [stageId]
        );

        if (stages.length === 0) {
            await conn.rollback();
            return res.status(404).json({
                error: "STAGE NOT FOUND",
                code: "NOT_FOUND"
            });
        }

        const stage = stages[0];

        if (stage.organizer_id !== organizerId) {
            await conn.rollback();
            return res.status(403).json({
                error: "YOU DO NOT OWN THIS TOURNAMENT",
                code: "FORBIDDEN"
            });
        }

        if (stage.tournament_status === "completed") {
            await conn.rollback();
            return res.status(409).json({
                error: "CANNOT GENERATE BRACKET FOR A COMPLETED TOURNAMENT",
                code: "STATE_CONFLICT"
            });
        }

        let candidateTeams = [];

        if (stage.stage_format === "group_stage") {
            if (stage.group_generation_status !== "qualified") {
                await conn.rollback();
                return res.status(409).json({
                    error: "PLAYOFF BRACKET CAN ONLY BE GENERATED AFTER GROUP QUALIFICATION IS COMPLETED",
                    code: "STATE_CONFLICT"
                });
            }

            const [qualifiedMembers] = await conn.query(
                `SELECT sgm.member_id, sgm.group_id, sgm.stage_id, sgm.registration_id, sgm.final_rank,
                        sg.group_name, sg.group_order, r.team_id, tm.team_name, tm.team_tag
                 FROM STAGE_GROUP_MEMBER sgm
                 JOIN STAGE_GROUP sg ON sgm.group_id = sg.group_id
                 JOIN REGISTRATION r ON sgm.registration_id = r.registration_id
                 JOIN TEAM tm ON r.team_id = tm.team_id
                 WHERE sgm.stage_id = ? AND sgm.qualified = TRUE
                 ORDER BY sg.group_order ASC, sgm.final_rank ASC FOR UPDATE`,
                [stageId]
            );
            candidateTeams = qualifiedMembers;
        } else {
            // Standalone single_elimination or double_elimination stage
            // Check if there was a preceding group stage in this tournament with qualified members:
            const [prevQualified] = await conn.query(
                `SELECT sgm.member_id, sgm.group_id, sgm.stage_id, sgm.registration_id, sgm.final_rank,
                        sg.group_name, sg.group_order, r.team_id, tm.team_name, tm.team_tag
                 FROM TOURNAMENT_STAGE prev_ts
                 JOIN STAGE_GROUP_MEMBER sgm ON prev_ts.stage_id = sgm.stage_id
                 JOIN STAGE_GROUP sg ON sgm.group_id = sg.group_id
                 JOIN REGISTRATION r ON sgm.registration_id = r.registration_id
                 JOIN TEAM tm ON r.team_id = tm.team_id
                 WHERE prev_ts.tournament_id = ? AND prev_ts.stage_order < ? AND sgm.qualified = TRUE
                 ORDER BY prev_ts.stage_order DESC, sg.group_order ASC, sgm.final_rank ASC FOR UPDATE`,
                [stage.tournament_id, stage.stage_order]
            );

            if (prevQualified.length > 0) {
                candidateTeams = prevQualified;
            } else {
                // Source directly from approved tournament registrations
                const [approvedRegs] = await conn.query(
                    `SELECT r.registration_id, r.team_id, r.seed_number, tm.team_name, tm.team_tag
                     FROM REGISTRATION r
                     JOIN TEAM tm ON r.team_id = tm.team_id
                     WHERE r.tournament_id = ? AND r.status = 'approved'
                     ORDER BY COALESCE(r.seed_number, 999999) ASC, r.registered_at ASC FOR UPDATE`,
                    [stage.tournament_id]
                );
                candidateTeams = approvedRegs;
            }
        }

        if (candidateTeams.length < 2) {
            await conn.rollback();
            return res.status(400).json({
                error: `AT LEAST 2 APPROVED TEAMS ARE REQUIRED TO GENERATE A BRACKET (FOUND: ${candidateTeams.length})`,
                code: "INVALID_INPUT"
            });
        }

        // Apply seeding mode
        if (mode === "random") {
            for (let i = candidateTeams.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [candidateTeams[i], candidateTeams[j]] = [candidateTeams[j], candidateTeams[i]];
            }
        }

        let bracketStats;
        if (stage.stage_format === "single_elimination") {
            bracketStats = await generateSingleEliminationBracket(conn, stageId, candidateTeams);
        } else {
            // double_elimination or group_stage playoff
            if (candidateTeams.length < 4 || candidateTeams.length % 2 !== 0) {
                await conn.rollback();
                return res.status(400).json({
                    error: `DOUBLE ELIMINATION REQUIRES AN EVEN NUMBER OF AT LEAST 4 TEAMS (FOUND: ${candidateTeams.length})`,
                    code: "INVALID_INPUT"
                });
            }
            bracketStats = await generateDoubleEliminationBracket(conn, stageId, candidateTeams);
        }

        await conn.query(
            `UPDATE TOURNAMENT_STAGE SET group_generation_status = 'bracket_generated' WHERE stage_id = ?`,
            [stageId]
        );

        await conn.commit();

        return res.status(201).json({
            message: `${stage.stage_format === "single_elimination" ? "Single" : "Double"} elimination bracket generated successfully`,
            stageId: Number(stageId),
            stageFormat: stage.stage_format,
            teamsCount: candidateTeams.length,
            stats: bracketStats
        });
    } catch (err) {
        if (conn) await conn.rollback();
        console.error(err);
        return res.status(500).json({
            error: "FAILED TO GENERATE BRACKET",
            code: "INTERNAL_SERVER_ERROR"
        });
    } finally {
        if (conn) conn.release();
    }
});

/**
 * DELETE /api/stages/:stageId/bracket
 * Organizer-only endpoint to reset/clear generated bracket for a stage.
 */
router.delete("/:stageId/bracket", requireAuth, requireRole("organizer"), async (req, res) => {
    const stageId = req.params.stageId;
    const organizerId = req.session.userId;

    let conn;
    try {
        conn = await db.promise().getConnection();
        await conn.beginTransaction();

        const [stages] = await conn.query(
            `SELECT ts.stage_id, ts.tournament_id, ts.stage_format, ts.group_generation_status,
                    t.organizer_id, t.status AS tournament_status
             FROM TOURNAMENT_STAGE ts
             JOIN TOURNAMENT t ON ts.tournament_id = t.tournament_id
             WHERE ts.stage_id = ? FOR UPDATE`,
            [stageId]
        );

        if (stages.length === 0) {
            await conn.rollback();
            return res.status(404).json({ error: "STAGE NOT FOUND", code: "NOT_FOUND" });
        }

        const stage = stages[0];

        if (stage.organizer_id !== organizerId) {
            await conn.rollback();
            return res.status(403).json({ error: "YOU DO NOT OWN THIS TOURNAMENT", code: "FORBIDDEN" });
        }

        if (stage.tournament_status === "completed") {
            await conn.rollback();
            return res.status(409).json({ error: "CANNOT RESET BRACKET OF A COMPLETED TOURNAMENT", code: "STATE_CONFLICT" });
        }

        // Check if any match in this stage already has a VERIFIED result
        const [verifiedMatches] = await conn.query(
            `SELECT COUNT(*) AS cnt
             FROM \`MATCH\` m
             JOIN MATCH_RESULT mr ON m.match_id = mr.match_id
             WHERE m.stage_id = ? AND m.bracket_type != 'group' AND mr.status = 'VERIFIED'`,
            [stageId]
        );

        if (verifiedMatches[0].cnt > 0) {
            await conn.rollback();
            return res.status(409).json({
                error: "CANNOT RESET BRACKET - ONE OR MORE MATCH RESULTS HAVE ALREADY BEEN VERIFIED",
                code: "STATE_CONFLICT"
            });
        }

        // Delete bracket matches (ON DELETE CASCADE removes MATCH_PARTICIPANT, BRACKET_ADVANCEMENT, MOBA_SERIES, unverified MATCH_RESULT)
        await conn.query("DELETE FROM `MATCH` WHERE stage_id = ? AND bracket_type != 'group'", [stageId]);

        const nextStatus = stage.stage_format === "group_stage" ? "qualified" : "not_generated";
        await conn.query(
            "UPDATE TOURNAMENT_STAGE SET group_generation_status = ? WHERE stage_id = ?",
            [nextStatus, stageId]
        );

        await conn.commit();

        return res.status(200).json({
            message: "Bracket reset successfully",
            stageId: Number(stageId),
            groupGenerationStatus: nextStatus
        });
    } catch (err) {
        if (conn) await conn.rollback();
        console.error(err);
        return res.status(500).json({
            error: "FAILED TO RESET BRACKET",
            code: "INTERNAL_SERVER_ERROR"
        });
    } finally {
        if (conn) conn.release();
    }
});

/**
 * GET /api/stages/:stageId/bracket
 * Read endpoint for Playoff Bracket structure, rounds, matches, series BO, and advancement paths.
 */
router.get("/:stageId/bracket", requireAuth, async (req, res) => {
    const stageId = req.params.stageId;
    const userId = req.session.userId;

    try {
        const [stages] = await db.promise().query(
            `SELECT ts.stage_id, ts.tournament_id, ts.stage_format, ts.group_generation_status,
                    t.organizer_id, t.status AS tournament_status
             FROM TOURNAMENT_STAGE ts
             JOIN TOURNAMENT t ON ts.tournament_id = t.tournament_id
             WHERE ts.stage_id = ?`,
            [stageId]
        );

        if (stages.length === 0) {
            return res.status(404).json({
                error: "STAGE NOT FOUND",
                code: "NOT_FOUND"
            });
        }

        const stage = stages[0];
        const isOwner = stage.organizer_id === userId;

        if (stage.tournament_status === "draft" && !isOwner) {
            return res.status(404).json({
                error: "STAGE NOT FOUND",
                code: "NOT_FOUND"
            });
        }

        const [matches] = await db.promise().query(
            `SELECT m.match_id, m.stage_id, m.status, m.round_number, m.bracket_position, m.bracket_type,
                    m.scheduled_time, m.lobby_code, m.server_region, m.draft_mode,
                    mr.status AS result_status, mr.winning_registration_id,
                    mr.team_a_kills, mr.team_b_kills, mr.evidence_url, mr.submitted_at, mr.verified_at,
                    ms.best_of, ms.series_winner_registration_id
             FROM \`MATCH\` m
             LEFT JOIN MATCH_RESULT mr ON m.match_id = mr.match_id
             LEFT JOIN MOBA_SERIES ms ON m.match_id = ms.match_id
             WHERE m.stage_id = ? AND m.bracket_type != 'group'
             ORDER BY m.bracket_type ASC, m.round_number ASC, m.bracket_position ASC`,
            [stageId]
        );

        const [participants] = await db.promise().query(
            `SELECT mp.match_id, mp.registration_id, mp.side, tm.team_id, tm.team_name, tm.team_tag,
                    sgm.playoff_seed, sgm.bye_status, sg.group_name, sgm.final_rank AS group_rank
             FROM MATCH_PARTICIPANT mp
             JOIN REGISTRATION r ON mp.registration_id = r.registration_id
             JOIN TEAM tm ON r.team_id = tm.team_id
             LEFT JOIN STAGE_GROUP_MEMBER sgm ON r.registration_id = sgm.registration_id AND sgm.stage_id = ?
             LEFT JOIN STAGE_GROUP sg ON sgm.group_id = sg.group_id
             WHERE mp.match_id IN (SELECT match_id FROM \`MATCH\` WHERE stage_id = ? AND bracket_type != 'group')`,
            [stageId, stageId]
        );

        const [advancements] = await db.promise().query(
            `SELECT ba.advancement_id, ba.source_match_id, ba.destination_match_id, ba.outcome_type, ba.destination_side
             FROM BRACKET_ADVANCEMENT ba
             WHERE ba.source_match_id IN (SELECT match_id FROM \`MATCH\` WHERE stage_id = ? AND bracket_type != 'group')`,
            [stageId]
        );

        const partsMap = new Map();
        participants.forEach((p) => {
            if (!partsMap.has(p.match_id)) partsMap.set(p.match_id, []);
            partsMap.get(p.match_id).push(p);
        });

        const advMap = new Map();
        advancements.forEach((a) => {
            if (!advMap.has(a.source_match_id)) advMap.set(a.source_match_id, []);
            advMap.get(a.source_match_id).push(a);
        });

        const formattedMatches = matches.map((m) => ({
            match_id: m.match_id,
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
            participants: partsMap.get(m.match_id) || [],
            advancements: advMap.get(m.match_id) || []
        }));

        return res.status(200).json({
            stageId: Number(stageId),
            tournamentId: stage.tournament_id,
            tournament_id: stage.tournament_id,
            tournamentStatus: stage.tournament_status,
            tournament_status: stage.tournament_status,
            stageFormat: stage.stage_format,
            stage_format: stage.stage_format,
            groupGenerationStatus: stage.group_generation_status,
            bracket: {
                playIn: formattedMatches.filter((m) => m.bracket_type === "play_in"),
                upperBracket: formattedMatches.filter((m) => m.bracket_type === "upper"),
                lowerBracket: formattedMatches.filter((m) => m.bracket_type === "lower"),
                grandFinal: formattedMatches.find((m) => m.bracket_type === "grand_final") || null
            }
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({
            error: "FAILED TO FETCH BRACKET",
            code: "INTERNAL_SERVER_ERROR"
        });
    }
});

module.exports = router;
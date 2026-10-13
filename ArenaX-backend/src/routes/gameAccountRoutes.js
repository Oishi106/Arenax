const express = require("express");
const db = require("../config/db");
const { requireAuth } = require("../middleware/authMiddleware");

const router = express.Router();

// Game UID must be numbers only - no letters, spaces, or punctuation.
// Fixed reasonable length range so obviously-fake values are rejected too.
const UID_FORMAT_REGEX = /^[0-9]{3,20}$/;

// GET /api/game-accounts/my
// Get all game accounts belonging to the logged-in user
router.get("/my", requireAuth, (req, res) => {
    const userId = req.session.userId;     

    const sql = `
        SELECT
            account_id,
            game_id,
            game_username,
            game_uid,
            server_region,
            is_free_agent,
            university
        FROM GAME_ACCOUNT
        WHERE user_id = ?
    `;

    db.query(sql, [userId], (err, results) => {
        if (err) {
            console.error(err);

            return res.status(500).json({
                error: "FAILED TO FETCH GAME ACCOUNTS"
            });
        }

        res.status(200).json({
            gameAccounts: results
        });
    });       
});         


// POST /api/game-accounts
// Create a new game account for the logged-in user
router.post("/", requireAuth, (req, res) => {

    const userId = req.session.userId;

    const {
        game_id,
        game_username,
        game_uid,
        server_region,
        is_free_agent,
        university
    } = req.body;


    // 1. Validate required information
    if (!game_id || !game_username || !game_uid || !server_region) {
        return res.status(400).json({
            error: "Game ID, username, UID and server region are required"
        });
    }

    // 1b. Validate UID format - alphanumeric only, no punctuation/spaces
    if (!UID_FORMAT_REGEX.test(game_uid)) {
        return res.status(400).json({
            error: "GAME UID MUST BE 3-20 DIGITS, NUMBERS ONLY (NO LETTERS, SPACES, OR SYMBOLS)"
        });
    }


    // 2. Check whether the game exists
    const gameCheckSql = `
        SELECT game_id
        FROM GAME
        WHERE game_id = ?
    `;

    db.query(gameCheckSql, [game_id], (err, gameResults) => {

        if (err) {
            console.error(err);

            return res.status(500).json({
                error: "FAILED TO CHECK GAME"
            });
        }

        if (gameResults.length === 0) {
            return res.status(400).json({
                error: "GAME NOT FOUND"
            });
        }


        // 3. Check whether this user already has an account for this game
        const duplicateCheckSql = `
            SELECT account_id
            FROM GAME_ACCOUNT
            WHERE user_id = ? AND game_id = ?
        `;

        db.query(
            duplicateCheckSql,
            [userId, game_id],
            (err, duplicateResults) => {

                if (err) {
                    console.error(err);

                    return res.status(500).json({
                        error: "FAILED TO CHECK DUPLICATE GAME ACCOUNT"
                    });
                }

                if (duplicateResults.length > 0) {
                    return res.status(409).json({
                        error: "GAME ACCOUNT ALREADY EXISTS"
                    });
                }


                // 4. Check whether this game UID is already registered
                const uidCheckSql = `
                    SELECT account_id
                    FROM GAME_ACCOUNT
                    WHERE game_id = ? AND game_uid = ?
                `;

                db.query(
                    uidCheckSql,
                    [game_id, game_uid],
                    (err, uidResults) => {

                        if (err) {
                            console.error(err);

                            return res.status(500).json({
                                error: "FAILED TO CHECK GAME UID"
                            });
                        }

                        if (uidResults.length > 0) {
                            return res.status(409).json({
                                error: "GAME UID IS ALREADY REGISTERED"
                            });
                        }


                        const insertSql = `
                                INSERT INTO GAME_ACCOUNT (
                                    user_id,
                                    game_id,
                                    game_username,
                                    game_uid,
                                    server_region,
                                    is_free_agent,
                                    university
                                )
                                VALUES (?, ?, ?, ?, ?, ?, ?)
                            `;

                        db.query(
                            insertSql,
                            [
                                userId,
                                game_id,
                                game_username,
                                game_uid,
                                server_region,
                                is_free_agent,
                                university
                            ],
                            (err, insertResults) => {

                                if (err) {
                                    console.error(err);

                                    return res.status(500).json({
                                        error: "FAILED TO INSERT GAME ACCOUNT"
                                    });
                                }

                                res.status(201).json({
                                    message: "GAME ACCOUNT CREATED SUCCESSFULLY",
                                    accountId: insertResults.insertId
                                });
                            }
                        );
                    }
                );
            }
        );
    });
});

// PUT /api/game-accounts/:id
// Update a game account for the logged-in user
router.put("/:id", requireAuth, (req, res) => {
    const accountId = req.params.id;
    const userId = req.session.userId;

    const { game_username,
        game_uid,
        server_region,
     } = req.body;

    if (!game_username|| !game_uid || !server_region) {
        return res.status(400).json({
            error: "GAME USERNAME, GAME UID, AND SERVER REGION ARE REQUIRED"
        });
    }

    // Validate UID format on edit too - same rule as create
    if (!UID_FORMAT_REGEX.test(game_uid)) {
        return res.status(400).json({
            error: "GAME UID MUST BE 3-20 DIGITS, NUMBERS ONLY (NO LETTERS, SPACES, OR SYMBOLS)"
        });
    }

    const ownershipCheckSql = `
        SELECT account_id,game_id
        FROM GAME_ACCOUNT
        WHERE account_id = ? AND user_id = ?
    `;
    db.query(ownershipCheckSql, [accountId, userId], (err, ownershipResults) => {
        if (err) {
            console.error(err);
            return res.status(500).json({
                error: "FAILED TO CHECK ACCOUNT OWNERSHIP"
            });
        }

        if (ownershipResults.length === 0) {
            return res.status(404).json({
                error: "YOU ARE NOT THE OWNER OF THIS ACCOUNT"
            });
        }

        const currentGameId = ownershipResults[0].game_id;

        const uidCheckSql = `
            SELECT account_id
            FROM GAME_ACCOUNT
            WHERE game_id = ? AND game_uid = ? AND account_id != ?
        `;
        db.query(uidCheckSql, [currentGameId, game_uid, accountId], (err, uidResults) => {
            if (err) {
                console.error(err);
                return res.status(500).json({
                    error: "FAILED TO CHECK GAME UID"
                });
            }

            if (uidResults.length > 0) {
                return res.status(409).json({
                    error: "THIS GAME UID IS ALREADY IN USE"
                });
            }

            // FIX: the actual UPDATE query was missing here before - the
            // request used to hang forever with no response. Now it
            // actually updates the row and responds.
            const updateSql = `
                UPDATE GAME_ACCOUNT
                SET game_username = ?, game_uid = ?, server_region = ?
                WHERE account_id = ?
            `;

            db.query(updateSql, [game_username, game_uid, server_region, accountId], (err) => {
                if (err) {
                    console.error(err);
                    return res.status(500).json({
                        error: "FAILED TO UPDATE GAME ACCOUNT"
                    });
                }

                res.status(200).json({
                    message: "GAME ACCOUNT UPDATED SUCCESSFULLY"
                });
            });
        });
    });
});

// DELETE /api/game-accounts/:id
// Delete a game account for the logged-in user.
// Blocked if the account is currently an active team member/captain,
// so deleting doesn't silently orphan a team's roster.
router.delete("/:id", requireAuth, (req, res) => {
    const accountId = req.params.id;
    const userId = req.session.userId;

    const ownershipCheckSql = `
        SELECT account_id
        FROM GAME_ACCOUNT
        WHERE account_id = ? AND user_id = ?
    `;

    db.query(ownershipCheckSql, [accountId, userId], (err, ownershipResults) => {
        if (err) {
            console.error(err);
            return res.status(500).json({
                error: "FAILED TO CHECK ACCOUNT OWNERSHIP"
            });
        }

        if (ownershipResults.length === 0) {
            return res.status(404).json({
                error: "YOU ARE NOT THE OWNER OF THIS ACCOUNT"
            });
        }

        const activeTeamCheckSql = `
            SELECT member_id
            FROM TEAM_MEMBER
            WHERE game_account_id = ? AND is_active = TRUE
        `;

        db.query(activeTeamCheckSql, [accountId], (err, activeResults) => {
            if (err) {
                console.error(err);
                return res.status(500).json({
                    error: "FAILED TO CHECK TEAM MEMBERSHIP"
                });
            }

            if (activeResults.length > 0) {
                return res.status(400).json({
                    error: "CANNOT DELETE - THIS ACCOUNT IS AN ACTIVE MEMBER OF A TEAM. LEAVE THE TEAM FIRST"
                });
            }

            const deleteSql = `DELETE FROM GAME_ACCOUNT WHERE account_id = ?`;

            db.query(deleteSql, [accountId], (err) => {
                if (err) {
                    console.error(err);
                    return res.status(500).json({
                        error: "FAILED TO DELETE GAME ACCOUNT"
                    });
                }

                res.status(200).json({
                    message: "GAME ACCOUNT DELETED SUCCESSFULLY"
                });
            });
        });
    });
});


module.exports = router;
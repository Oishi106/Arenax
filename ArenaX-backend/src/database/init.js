const mysql = require("mysql2");

const db = mysql.createConnection({
    host: "127.0.0.1",
    user: "root",
    password: "",
    port: 3306
});

const createDatabase = `
    CREATE DATABASE IF NOT EXISTS ArenaX
`;

db.query(createDatabase, (err) => {
    if (err) {
        console.log("Error creating database:", err);
        return;
    }

    console.log("ArenaX database created successfully!");

    db.query("USE ArenaX", (err) => {
        if (err) {
            console.log("Error selecting database:", err);
            return;
        }

        console.log("ArenaX database selected!");

        createTables();
    });
});


function createTables() {

    const queries = [


        `
        CREATE TABLE IF NOT EXISTS USER (
            user_id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(30) NOT NULL UNIQUE,
            email VARCHAR(100) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            role ENUM('player', 'organizer') NOT NULL,
            account_status ENUM('active', 'suspended', 'banned') NOT NULL DEFAULT 'active',
            is_email_verified BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        `,

        
        `
        CREATE TABLE IF NOT EXISTS GAME (
            game_id INT AUTO_INCREMENT PRIMARY KEY,
            game_name VARCHAR(50) NOT NULL UNIQUE,
            short_code VARCHAR(10) NOT NULL UNIQUE
        )
        `,

        
        `
        CREATE TABLE IF NOT EXISTS GAME_ACCOUNT (
            account_id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            game_id INT NOT NULL,
            game_username VARCHAR(50) NOT NULL,
            game_uid VARCHAR(50) NOT NULL,
            server_region VARCHAR(30),
            is_free_agent BOOLEAN NOT NULL DEFAULT FALSE,
            university VARCHAR(100),
            UNIQUE (game_id, game_uid),

            FOREIGN KEY (user_id)
                REFERENCES USER(user_id)
                ON DELETE CASCADE,

            FOREIGN KEY (game_id)
                REFERENCES GAME(game_id)
                ON DELETE CASCADE
        )
        `,
        
        
        `
        CREATE TABLE IF NOT EXISTS FREE_AGENT_PROFILE (
            free_agent_id INT AUTO_INCREMENT PRIMARY KEY,
            game_account_id INT NOT NULL UNIQUE,
            availability_status VARCHAR(30) NOT NULL,
            preferred_role VARCHAR(30),

            FOREIGN KEY (game_account_id)
                REFERENCES GAME_ACCOUNT(account_id)
                ON DELETE CASCADE
        )
        `,

        
        `
        CREATE TABLE IF NOT EXISTS TEAM (
            team_id INT AUTO_INCREMENT PRIMARY KEY,
            game_id INT NOT NULL,
            captain_id INT NOT NULL,
            team_name VARCHAR(50) NOT NULL UNIQUE,
            status ENUM('forming', 'active') NOT NULL DEFAULT 'forming',
            team_tag VARCHAR(20) NOT NULL UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY (game_id)
                REFERENCES GAME(game_id),

            FOREIGN KEY (captain_id)
                REFERENCES GAME_ACCOUNT(account_id)
        )
        `,

        
        `
        CREATE TABLE IF NOT EXISTS TEAM_MEMBER (
            member_id INT AUTO_INCREMENT PRIMARY KEY,
            team_id INT NOT NULL,
            game_account_id INT NOT NULL,
            role ENUM('captain', 'player', 'substitute') NOT NULL,
            assigned_role VARCHAR(30) NULL DEFAULT NULL,
            is_substitute BOOLEAN NOT NULL DEFAULT FALSE,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

            UNIQUE (team_id, game_account_id),

            FOREIGN KEY (team_id)
                REFERENCES TEAM(team_id)
                ON DELETE CASCADE,

            FOREIGN KEY (game_account_id)
                REFERENCES GAME_ACCOUNT(account_id)
                ON DELETE CASCADE
        )
        `,

        
        `
        CREATE TABLE IF NOT EXISTS TEAM_INVITATION (
            invitation_id INT AUTO_INCREMENT PRIMARY KEY,
            team_id INT NOT NULL,
            game_account_id INT NOT NULL,
            status ENUM('pending', 'accepted', 'rejected') NOT NULL DEFAULT 'pending',
            sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            responded_at TIMESTAMP NULL,

            FOREIGN KEY (team_id)
                REFERENCES TEAM(team_id)
                ON DELETE CASCADE,

            FOREIGN KEY (game_account_id)
                REFERENCES GAME_ACCOUNT(account_id)
                ON DELETE CASCADE
        )
        `,

        
        `
        CREATE TABLE IF NOT EXISTS TEAM_APPLICATION (
            application_id INT AUTO_INCREMENT PRIMARY KEY,
            team_id INT NOT NULL,
            game_account_id INT NOT NULL,
            status ENUM('pending', 'accepted', 'rejected') NOT NULL DEFAULT 'pending',
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            responded_at TIMESTAMP NULL,

            FOREIGN KEY (team_id)
                REFERENCES TEAM(team_id)
                ON DELETE CASCADE,

            FOREIGN KEY (game_account_id)
                REFERENCES GAME_ACCOUNT(account_id)
                ON DELETE CASCADE
        )
        `,

        
        `
        CREATE TABLE IF NOT EXISTS TOURNAMENT (
            tournament_id INT AUTO_INCREMENT PRIMARY KEY,
            game_id INT NOT NULL,
            organizer_id INT NOT NULL,
            name VARCHAR(100) NOT NULL,
            format ENUM('single_elimination', 'double_elimination') NOT NULL,
            status ENUM('draft', 'published', 'live', 'completed') NOT NULL DEFAULT 'draft',
            registration_start_at DATETIME NULL,
            registration_end_at DATETIME NULL,
            prize_pool_usd DECIMAL(12,2) NULL,
            prize_first_usd DECIMAL(12,2) NULL,
            prize_second_usd DECIMAL(12,2) NULL,
            prize_third_usd DECIMAL(12,2) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY (game_id)
                REFERENCES GAME(game_id),

            FOREIGN KEY (organizer_id)
                REFERENCES USER(user_id)
        )
        `,

        
        `
        CREATE TABLE IF NOT EXISTS TOURNAMENT_STAGE (
            stage_id INT AUTO_INCREMENT PRIMARY KEY,
            tournament_id INT NOT NULL,
            stage_order INT NOT NULL,
            stage_name VARCHAR(50) NOT NULL,
            stage_format ENUM('group_stage', 'single_elimination', 'double_elimination') NOT NULL,
            group_generation_status ENUM('not_generated', 'groups_assigned', 'matches_generated') NOT NULL DEFAULT 'not_generated',
            group_assignment_mode ENUM('sequential', 'random') NULL,
            groups_generated_at DATETIME NULL,

            UNIQUE (tournament_id, stage_order),

            FOREIGN KEY (tournament_id)
                REFERENCES TOURNAMENT(tournament_id)
                ON DELETE CASCADE
        )
        `,

        `
        CREATE TABLE IF NOT EXISTS STAGE_GROUP (
            group_id INT AUTO_INCREMENT PRIMARY KEY,
            stage_id INT NOT NULL,
            group_name VARCHAR(20) NOT NULL,
            group_order INT NOT NULL,

            UNIQUE (stage_id, group_name),
            UNIQUE (stage_id, group_order),
            UNIQUE (group_id, stage_id),

            FOREIGN KEY (stage_id)
                REFERENCES TOURNAMENT_STAGE(stage_id)
                ON DELETE CASCADE
        )
        `,

        `
        CREATE TABLE IF NOT EXISTS STAGE_GROUP_MEMBER (
            member_id INT AUTO_INCREMENT PRIMARY KEY,
            group_id INT NOT NULL,
            stage_id INT NOT NULL,
            registration_id INT NOT NULL,
            slot_number TINYINT NOT NULL,
            final_rank TINYINT NULL,
            qualified BOOLEAN NULL,

            CHECK (slot_number BETWEEN 1 AND 4),

            UNIQUE (stage_id, registration_id),
            UNIQUE (group_id, slot_number),
            UNIQUE (group_id, registration_id),

            FOREIGN KEY (group_id, stage_id)
                REFERENCES STAGE_GROUP(group_id, stage_id)
                ON DELETE CASCADE,

            FOREIGN KEY (registration_id)
                REFERENCES REGISTRATION(registration_id)
                ON DELETE CASCADE
        )
        `,

        
        `
        CREATE TABLE IF NOT EXISTS REGISTRATION (
            registration_id INT AUTO_INCREMENT PRIMARY KEY,
            tournament_id INT NOT NULL,
            team_id INT NOT NULL,
            status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
            seed_number INT,
            registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            approved_at TIMESTAMP NULL,

            UNIQUE (tournament_id, team_id),

            FOREIGN KEY (tournament_id)
                REFERENCES TOURNAMENT(tournament_id)
                ON DELETE CASCADE,

            FOREIGN KEY (team_id)
                REFERENCES TEAM(team_id)
                ON DELETE CASCADE
        )
        `,

        
        `
        CREATE TABLE IF NOT EXISTS \`MATCH\` (
            match_id INT AUTO_INCREMENT PRIMARY KEY,
            stage_id INT NOT NULL,
            group_id INT NULL,
            status ENUM('scheduled', 'live', 'completed') NOT NULL DEFAULT 'scheduled',
            scheduled_time TIMESTAMP NULL,
            lobby_code VARCHAR(20),
            server_region VARCHAR(30),
            draft_mode VARCHAR(30),
            round_number INT NOT NULL,
            bracket_position INT NOT NULL,

            FOREIGN KEY (stage_id)
                REFERENCES TOURNAMENT_STAGE(stage_id)
                ON DELETE CASCADE,

            FOREIGN KEY (group_id)
                REFERENCES STAGE_GROUP(group_id)
                ON DELETE CASCADE
        )
        `,

        
        `
        CREATE TABLE IF NOT EXISTS MATCH_PARTICIPANT (
            match_participant_id INT AUTO_INCREMENT PRIMARY KEY,
            match_id INT NOT NULL,
            registration_id INT NOT NULL,
            side ENUM('A', 'B') NOT NULL,

            UNIQUE (match_id, side),

            FOREIGN KEY (match_id)
                REFERENCES \`MATCH\`(match_id)
                ON DELETE CASCADE,

            FOREIGN KEY (registration_id)
                REFERENCES REGISTRATION(registration_id)
                ON DELETE CASCADE,

            UNIQUE (match_id, registration_id)
        )
        `,

        
        `
        CREATE TABLE IF NOT EXISTS BRACKET_ADVANCEMENT (
            advancement_id INT AUTO_INCREMENT PRIMARY KEY,
            source_match_id INT NOT NULL,
            destination_match_id INT NOT NULL,
            outcome_type ENUM('winner', 'loser') NOT NULL,
            destination_side ENUM('A', 'B') NOT NULL,

            FOREIGN KEY (source_match_id)
                REFERENCES \`MATCH\`(match_id)
                ON DELETE CASCADE,

            FOREIGN KEY (destination_match_id)
                REFERENCES \`MATCH\`(match_id)
                ON DELETE CASCADE
        )
        `,

        
        `
        CREATE TABLE IF NOT EXISTS MOBA_SERIES (
            series_id INT AUTO_INCREMENT PRIMARY KEY,
            match_id INT NOT NULL UNIQUE,
            best_of ENUM('BO1', 'BO3', 'BO5') NOT NULL,
            series_winner_registration_id INT NULL,

            FOREIGN KEY (match_id)
                REFERENCES \`MATCH\`(match_id)
                ON DELETE CASCADE,

            FOREIGN KEY (series_winner_registration_id)
                REFERENCES REGISTRATION(registration_id)
        )
        `,

        
        `
        CREATE TABLE IF NOT EXISTS SERIES_PARTICIPANT (
            series_participant_id INT AUTO_INCREMENT PRIMARY KEY,
            series_id INT NOT NULL,
            registration_id INT NOT NULL,
            side ENUM('A', 'B') NOT NULL,
            game_wins INT NOT NULL DEFAULT 0,

            UNIQUE (series_id, registration_id),
            UNIQUE (series_id, side),

            FOREIGN KEY (series_id)
                REFERENCES MOBA_SERIES(series_id)
                ON DELETE CASCADE,

            FOREIGN KEY (registration_id)
                REFERENCES REGISTRATION(registration_id)
                ON DELETE CASCADE
        )
        `,

        
        `
        CREATE TABLE IF NOT EXISTS MOBA_GAME_RESULT (
            game_result_id INT AUTO_INCREMENT PRIMARY KEY,
            series_id INT NOT NULL,
            game_number INT NOT NULL,
            winner_registration_id INT NOT NULL,
            duration_seconds INT NOT NULL,

            UNIQUE (series_id, game_number),

            FOREIGN KEY (series_id)
                REFERENCES MOBA_SERIES(series_id)
                ON DELETE CASCADE,

            FOREIGN KEY (winner_registration_id)
                REFERENCES REGISTRATION(registration_id)
        )
        `,

        
        `
        CREATE TABLE IF NOT EXISTS MATCH_RESULT (
            result_id INT AUTO_INCREMENT PRIMARY KEY,
            match_id INT NOT NULL UNIQUE,
            submitted_by INT NOT NULL,
            winning_registration_id INT NOT NULL,
            team_a_kills INT NOT NULL DEFAULT 0,
            team_b_kills INT NOT NULL DEFAULT 0,
            evidence_url VARCHAR(255) NULL,
            status ENUM('SUBMITTED', 'VERIFIED', 'REJECTED') NOT NULL DEFAULT 'SUBMITTED',
            submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            verified_by INT NULL,
            verified_at TIMESTAMP NULL DEFAULT NULL,

            FOREIGN KEY (match_id)
                REFERENCES \`MATCH\`(match_id)
                ON DELETE CASCADE,

            FOREIGN KEY (winning_registration_id)
                REFERENCES REGISTRATION(registration_id),

            FOREIGN KEY (submitted_by)
                REFERENCES USER(user_id),

            FOREIGN KEY (verified_by)
                REFERENCES USER(user_id)
        )
        `
    ];

    let completed = 0;

    queries.forEach((query, index) => {

        db.query(query, (err) => {

            if (err) {
                console.log(`Error creating table ${index + 1}:`, err);
                return;
            }

            completed++;

            if (completed === queries.length) {
                console.log("=================================");
                console.log(`All ${queries.length} ArenaX tables created!`);
                console.log("Running idempotent migrations...");
                runMigrations(() => {
                    console.log("Migrations completed successfully!");
                    console.log("=================================");
                    db.end();
                });
            }
        });

    });
}

function runMigrations(onComplete) {
    const migrations = [
        "ALTER TABLE TOURNAMENT_STAGE MODIFY COLUMN stage_format ENUM('group_stage', 'single_elimination', 'double_elimination') NOT NULL",
        "ALTER TABLE TOURNAMENT_STAGE ADD COLUMN IF NOT EXISTS group_generation_status ENUM('not_generated', 'groups_assigned', 'matches_generated', 'qualified', 'bracket_generated') NOT NULL DEFAULT 'not_generated'",
        "ALTER TABLE TOURNAMENT_STAGE MODIFY COLUMN group_generation_status ENUM('not_generated', 'groups_assigned', 'matches_generated', 'qualified', 'bracket_generated') NOT NULL DEFAULT 'not_generated'",
        "ALTER TABLE TOURNAMENT_STAGE ADD COLUMN IF NOT EXISTS group_assignment_mode ENUM('sequential', 'random') NULL",
        "ALTER TABLE TOURNAMENT_STAGE ADD COLUMN IF NOT EXISTS groups_generated_at DATETIME NULL",
        "ALTER TABLE `MATCH` ADD COLUMN group_id INT NULL",
        "ALTER TABLE `MATCH` ADD CONSTRAINT fk_match_group_id FOREIGN KEY (group_id) REFERENCES STAGE_GROUP(group_id) ON DELETE CASCADE",
        "ALTER TABLE `MATCH` ADD COLUMN bracket_type ENUM('group', 'play_in', 'upper', 'lower', 'grand_final') DEFAULT 'group'",
        "ALTER TABLE STAGE_GROUP_MEMBER ADD COLUMN playoff_seed INT NULL",
        "ALTER TABLE STAGE_GROUP_MEMBER ADD COLUMN bye_status BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE MATCH_RESULT MODIFY COLUMN status ENUM('SUBMITTED', 'VERIFIED', 'REJECTED') NOT NULL DEFAULT 'SUBMITTED'",
        "ALTER TABLE MATCH_RESULT ADD COLUMN team_a_kills INT NOT NULL DEFAULT 0",
        "ALTER TABLE MATCH_RESULT ADD COLUMN team_b_kills INT NOT NULL DEFAULT 0",
        "ALTER TABLE MATCH_RESULT ADD COLUMN evidence_url VARCHAR(255) NULL",
        "ALTER TABLE MATCH_RESULT ADD COLUMN submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
        "ALTER TABLE MATCH_RESULT ADD COLUMN verified_by INT NULL",
        "ALTER TABLE MATCH_RESULT ADD COLUMN verified_at TIMESTAMP NULL DEFAULT NULL",
        "ALTER TABLE MATCH_RESULT ADD CONSTRAINT fk_match_result_verified_by FOREIGN KEY (verified_by) REFERENCES USER(user_id)",
        "ALTER TABLE TOURNAMENT ADD COLUMN registration_start_at DATETIME NULL",
        "ALTER TABLE TOURNAMENT ADD COLUMN registration_end_at DATETIME NULL",
        "ALTER TABLE TOURNAMENT ADD COLUMN prize_pool_usd DECIMAL(12,2) NULL"
    ];

    let doneCount = 0;
    migrations.forEach((sql) => {
        db.query(sql, (err) => {
            // Ignore error 1060 (duplicate column), 1061 (duplicate key), 1826 (duplicate constraint)
            doneCount++;
            if (doneCount === migrations.length) {
                if (onComplete) onComplete();
            }
        });
    });
}
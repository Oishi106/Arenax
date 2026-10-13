const API_BASE_URL = "http://localhost:5000/api";

/**
 * Custom error class for API response errors
 */
export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
    this.code = data?.code || null;
  }
}

/**
 * Generic fetch wrapper with credentials: "include" and 401 handling
 */
async function request(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  
  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  const config = {
    credentials: "include",
    ...options,
    headers,
  };

  try {
    const response = await fetch(url, config);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status === 401) {
        const error = new ApiError(data.error || data.message || "Unauthorized", 401, data);
        error.isUnauthenticated = true;
        throw error;
      }
      const errorMessage = data.error || data.message || `Request failed with status ${response.status}`;
      throw new ApiError(errorMessage, response.status, data);
    }

    return data;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(error.message || "Unable to connect to ArenaX server.", 0, null);
  }
}

// Authentication APIs
export async function getMe() {
  return request("/auth/me");
}

export async function logoutUser() {
  return request("/auth/logout", { method: "POST" });
}

// Game APIs
export async function getGames() {
  const data = await request("/games");
  return data.game || [];
}

// Game Account Management APIs
export async function getMyGameAccounts() {
  const data = await request("/game-accounts/my");
  return data.gameAccounts || [];
}

export async function createGameAccount(accountData) {
  return request("/game-accounts", {
    method: "POST",
    body: JSON.stringify(accountData),
  });
}

export async function updateGameAccount(accountId, accountData) {
  return request(`/game-accounts/${accountId}`, {
    method: "PUT",
    body: JSON.stringify(accountData),
  });
}

// Team Management APIs
export async function getMyTeams() {
  const data = await request("/teams/my");
  return data.teams || [];
}

export async function createTeam(teamData) {
  return request("/teams", {
    method: "POST",
    body: JSON.stringify(teamData),
  });
}

export async function getTeamDetails(teamId) {
  const data = await request(`/teams/${teamId}`);
  return data.team;
}

export async function deleteTeam(teamId) {
  return request(`/teams/${teamId}`, {
    method: "DELETE",
  });
}

export async function updateMemberRole(teamId, accountId, assignedRole) {
  return request(`/teams/${teamId}/members/${accountId}/role`, {
    method: "PUT",
    body: JSON.stringify({ assigned_role: assignedRole }),
  });
}

export async function removeTeamMember(teamId, accountId) {
  return request(`/teams/${teamId}/members/${accountId}`, {
    method: "DELETE",
  });
}

// Free Agent Management & Discovery APIs
export async function getFreeAgents(filters = {}) {
  const params = new URLSearchParams();
  if (filters.game_id) params.append("game_id", filters.game_id);
  if (filters.preferred_role) params.append("preferred_role", filters.preferred_role);
  if (filters.university) params.append("university", filters.university);
  if (filters.search) params.append("search", filters.search);

  const queryString = params.toString();
  const endpoint = queryString ? `/free-agents?${queryString}` : "/free-agents";
  const data = await request(endpoint);
  return data.freeAgents || [];
}

export async function getMyFreeAgents() {
  const data = await request("/free-agents/my");
  return data.freeAgents || [];
}

export async function createFreeAgentProfile(profileData) {
  return request("/free-agents", {
    method: "POST",
    body: JSON.stringify(profileData),
  });
}

export async function updateFreeAgentProfile(id, profileData) {
  return request(`/free-agents/${id}`, {
    method: "PUT",
    body: JSON.stringify(profileData),
  });
}

export async function deleteFreeAgentProfile(id) {
  return request(`/free-agents/${id}`, {
    method: "DELETE",
  });
}

// Team Invitation APIs
export async function sendTeamInvitation(invitationData) {
  // invitationData: { team_id, game_account_id }
  return request("/team-invitations", {
    method: "POST",
    body: JSON.stringify(invitationData),
  });
}

export async function getMyTeamInvitations() {
  const data = await request("/team-invitations/my");
  return data.invitations || [];
}

export async function acceptTeamInvitation(id) {
  return request(`/team-invitations/${id}/accept`, {
    method: "POST",
  });
}

export async function rejectTeamInvitation(id) {
  return request(`/team-invitations/${id}/reject`, {
    method: "POST",
  });
}

// Recruiting Teams Discovery APIs
export async function getRecruitingTeams(filters = {}) {
  const params = new URLSearchParams();
  if (filters.game_id) params.append("game_id", filters.game_id);
  if (filters.search) params.append("search", filters.search);

  const queryString = params.toString();
  const endpoint = queryString ? `/teams/recruiting?${queryString}` : "/teams/recruiting";
  const data = await request(endpoint);
  return data.teams || [];
}

// Team Application APIs
export async function createTeamApplication(applicationData) {
  // applicationData: { team_id, game_account_id }
  return request("/team-applications", {
    method: "POST",
    body: JSON.stringify(applicationData),
  });
}

export async function getMyTeamApplications() {
  const data = await request("/team-applications/my");
  return data.applications || [];
}

export async function getReceivedTeamApplications() {
  const data = await request("/team-applications/received");
  return data.applications || [];
}

export async function acceptTeamApplication(id) {
  return request(`/team-applications/${id}/accept`, {
    method: "POST",
  });
}

export async function rejectTeamApplication(id) {
  return request(`/team-applications/${id}/reject`, {
    method: "POST",
  });
}


// Tournament Management APIs
export async function getTournaments(filters = {}) {
  const params = new URLSearchParams();
  if (filters.game_id) params.append("game_id", filters.game_id);
  if (filters.status) params.append("status", filters.status);

  const queryString = params.toString();
  const endpoint = queryString ? `/tournaments?${queryString}` : "/tournaments";
  const data = await request(endpoint);
  return data.tournaments || [];
}

export async function getMyTournaments() {
  const data = await request("/tournaments/my");
  return data.tournaments || [];
}

export async function getTournamentDetails(tournamentId) {
  const data = await request(`/tournaments/${tournamentId}`);
  return data.tournament;
}

export async function getTournamentHub(tournamentId) {
  return request(`/tournaments/${tournamentId}/hub`);
}

export async function createTournament(tournamentData) {
  // tournamentData: { game_id, name, format }
  return request("/tournaments", {
    method: "POST",
    body: JSON.stringify(tournamentData),
  });
}

export async function updateTournament(tournamentId, tournamentData) {
  // tournamentData: { game_id, name, format }
  return request(`/tournaments/${tournamentId}`, {
    method: "PUT",
    body: JSON.stringify(tournamentData),
  });
}

export async function updateTournamentStatus(tournamentId, status) {
  return request(`/tournaments/${tournamentId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

// Tournament Registration APIs
export async function registerTeamForTournament(data) {
  // data: { tournament_id, team_id }
  return request("/registrations", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getMyRegistrations() {
  const data = await request("/registrations/my");
  return data.registrations || [];
}

export async function getTournamentRegistrations(tournamentId) {
  const data = await request(`/registrations/tournament/${tournamentId}`);
  return data.registrations || [];
}

export async function approveRegistration(id) {
  return request(`/registrations/${id}/approve`, { method: "POST" });
}

export async function rejectRegistration(id) {
  return request(`/registrations/${id}/reject`, { method: "POST" });
}

export async function deleteGameAccount(accountId) {
  return request(`/game-accounts/${accountId}`, {
    method: "DELETE",
  });
}

// Tournament Stage Management APIs
export async function getTournamentStages(tournamentId) {
  const data = await request(`/stages/tournament/${tournamentId}`);
  return data.stages || [];
}

export async function createStage(stageData) {
  // stageData: { tournament_id, stage_order, stage_name, stage_format }
  return request("/stages", {
    method: "POST",
    body: JSON.stringify(stageData),
  });
}

export async function updateStage(stageId, stageData) {
  // stageData: { stage_order, stage_name, stage_format }
  return request(`/stages/${stageId}`, {
    method: "PUT",
    body: JSON.stringify(stageData),
  });
}

export async function deleteStage(stageId) {
  return request(`/stages/${stageId}`, {
    method: "DELETE",
  });
}

// Group Stage & Group Management APIs
export async function generateGroups(stageId, data = {}) {
  const assignmentMode = data.assignmentMode || data.allocation_mode || "sequential";
  return request(`/stages/${stageId}/generate-groups`, {
    method: "POST",
    body: JSON.stringify({ assignmentMode }),
  });
}

export async function resetGroups(stageId) {
  return request(`/stages/${stageId}/groups`, {
    method: "DELETE",
  });
}

export async function swapGroupMembers(stageId, data) {
  return request(`/stages/${stageId}/groups/swap`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function moveGroupMember(stageId, data) {
  return request(`/stages/${stageId}/groups/move`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function removeGroupMember(stageId, registrationId) {
  return request(`/stages/${stageId}/groups/members/${registrationId}`, {
    method: "DELETE",
  });
}

export async function getStageGroups(stageId) {
  return request(`/stages/${stageId}/groups`);
}

export async function generateGroupMatches(stageId) {
  return request(`/stages/${stageId}/generate-group-matches`, {
    method: "POST",
  });
}

export async function getGroupStandings(stageId, groupId) {
  return request(`/stages/${stageId}/groups/${groupId}/standings`);
}

// Match Results APIs
export async function submitMatchResult(matchId, data) {
  return request(`/matches/${matchId}/result`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getMatchResult(matchId) {
  return request(`/matches/${matchId}/result`);
}

export async function getPendingMatchResults(tournamentId) {
  return request(`/tournaments/${tournamentId}/results/pending`);
}

export async function verifyMatchResult(matchId, data = {}) {
  return request(`/matches/${matchId}/result/verify`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function rejectMatchResult(matchId) {
  return request(`/matches/${matchId}/result/reject`, {
    method: "PUT",
  });
}

// Qualification & Tie Resolution APIs
export async function generateQualification(stageId) {
  return request(`/stages/${stageId}/generate-qualification`, {
    method: "POST",
  });
}

export async function assignFinalRank(stageId, groupId, memberId, finalRank) {
  const rankValue = typeof finalRank === "object" ? finalRank.final_rank : finalRank;
  return request(`/stages/${stageId}/groups/${groupId}/members/${memberId}/rank`, {
    method: "PUT",
    body: JSON.stringify({ final_rank: Number(rankValue) }),
  });
}

// Playoff Bracket APIs
export async function generateBracket(stageId, data = {}) {
  return request(`/stages/${stageId}/generate-bracket`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function resetBracket(stageId) {
  return request(`/stages/${stageId}/bracket`, {
    method: "DELETE",
  });
}

export async function getBracket(stageId) {
  return request(`/stages/${stageId}/bracket`);
}

// Match Scheduling & Configuration APIs
export async function scheduleMatch(matchId, data) {
  return request(`/matches/${matchId}/schedule`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

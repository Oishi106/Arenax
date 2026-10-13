import React, { useEffect, useState } from "react";
import {
  getStageGroups,
  getGroupStandings,
  getMe,
  getMyTeams,
  getMyRegistrations,
  getPendingMatchResults,
} from "../api";
import SubmitResultModal from "./SubmitResultModal";
import PlayoffBracketView from "./PlayoffBracketView";
import PendingResultsReview from "./PendingResultsReview";

function PublicGroupStageView({ stageId, tournamentId, onToast, initialTab }) {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [stageData, setStageData] = useState(null);

  const effectiveTournamentId = tournamentId || stageData?.tournament_id;
  const [currentUser, setCurrentUser] = useState(null);
  const [myCaptainTeamIds, setMyCaptainTeamIds] = useState([]);
  const [myCaptainRegIds, setMyCaptainRegIds] = useState([]);
  const [pendingResultsMap, setPendingResultsMap] = useState({});

  // Submit Result Modal state
  const [selectedMatchForSubmit, setSelectedMatchForSubmit] = useState(null);

  // Active sub-tab inside Group Stage: 'standings' | 'groups' | 'matches' | 'bracket'
  const [activeTab, setActiveTab] = useState(initialTab || "standings");

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  // Active selected group filter for Standings/Matches view
  const [selectedGroupId, setSelectedGroupId] = useState(null);

  // Map of groupId -> { loading, error, standingsList }
  const [standingsMap, setStandingsMap] = useState({});

  const fetchStageData = async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const data = await getStageGroups(stageId);
      setStageData(data);

      const groups = data.groups || [];
      if (groups.length > 0) {
        setSelectedGroupId((prev) => prev || groups[0].group_id);
        fetchStandingsForGroups(stageId, groups);
      }
    } catch (err) {
      console.error("Failed to load public group stage:", err);
      setErrorMsg(err.message || "Unable to load group stage data.");
    } finally {
      setLoading(false);
    }
  };

  const fetchUserAndPendingResults = async () => {
    try {
      const meData = await getMe();
      const user = meData.user || null;
      setCurrentUser(user);

      if (user) {
        try {
          const [myTeams, myRegs] = await Promise.all([
            getMyTeams().catch((err) => {
              console.error("Failed to load teams:", err);
              return [];
            }),
            getMyRegistrations().catch((err) => {
              console.error("Failed to load registrations:", err);
              return [];
            }),
          ]);

          const capTeamIdsFromTeams = (myTeams || [])
            .filter((t) => (t.role && t.role.toLowerCase() === "captain") || t.is_captain)
            .map((t) => Number(t.team_id));

          const capTeamIdsFromRegs = (myRegs || [])
            .filter((r) => r.team_id)
            .map((r) => Number(r.team_id));

          const allCapTeamIds = Array.from(
            new Set([...capTeamIdsFromTeams, ...capTeamIdsFromRegs])
          );
          const regIds = (myRegs || [])
            .filter((r) => r.registration_id)
            .map((r) => Number(r.registration_id));

          setMyCaptainTeamIds(allCapTeamIds);
          setMyCaptainRegIds(regIds);
        } catch (teamErr) {
          console.error("Failed to load user teams/registrations:", teamErr);
        }
      }
    } catch {
      setCurrentUser(null);
    }
  };

  const fetchPendingResultsMap = async () => {
    if (effectiveTournamentId && currentUser?.role === "organizer") {
      try {
        const pendingRes = await getPendingMatchResults(effectiveTournamentId);
        const map = {};
        (pendingRes.pendingResults || []).forEach((p) => {
          map[p.match_id] = p;
        });
        setPendingResultsMap(map);
      } catch {
        setPendingResultsMap({});
      }
    }
  };

  const fetchStandingsForGroups = async (stgId, groupList) => {
    const map = {};
    for (const g of groupList) {
      try {
        const res = await getGroupStandings(stgId, g.group_id);
        map[g.group_id] = {
          loading: false,
          error: null,
          standings: res.standings || [],
        };
      } catch (err) {
        console.error(`Failed to load standings for group ${g.group_id}:`, err);
        map[g.group_id] = {
          loading: false,
          error: "Unable to load standings for this group.",
          standings: [],
        };
      }
    }
    setStandingsMap(map);
  };

  useEffect(() => {
    fetchUserAndPendingResults();
  }, []);

  useEffect(() => {
    if (stageId) {
      fetchStageData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageId]);

  useEffect(() => {
    if (effectiveTournamentId && currentUser?.role === "organizer") {
      fetchPendingResultsMap();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveTournamentId, currentUser]);

  // Auto-select group if the captain belongs to one
  useEffect(() => {
    if (!stageData?.groups || stageData.groups.length === 0) return;
    if (myCaptainTeamIds.length === 0 && myCaptainRegIds.length === 0) return;

    const userGroup = stageData.groups.find((g) =>
      (g.members || []).some(
        (m) =>
          myCaptainTeamIds.includes(Number(m.team_id)) ||
          myCaptainRegIds.includes(Number(m.registration_id))
      )
    );
    if (userGroup) {
      setSelectedGroupId(userGroup.group_id);
    }
  }, [stageData, myCaptainTeamIds, myCaptainRegIds]);

  if (loading) {
    return (
      <div className="mt-8 space-y-4">
        <div className="h-10 w-48 animate-pulse rounded-xl bg-zinc-900" />
        <div className="h-64 animate-pulse rounded-2xl border border-zinc-800 bg-zinc-900/40" />
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="mt-8 rounded-2xl border border-red-500/20 bg-red-500/10 p-6 text-center text-xs text-red-400">
        <span>{errorMsg}</span>
        <button
          onClick={fetchStageData}
          className="ml-3 font-bold underline hover:text-white"
        >
          Try Again
        </button>
      </div>
    );
  }

  const groups = stageData?.groups || [];
  const groupStatus = stageData?.groupGenerationStatus || "not_generated";

  if (groups.length === 0 || groupStatus === "not_generated") {
    return (
      <div className="mt-8 rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 p-12 text-center">
        <h4 className="text-base font-bold text-white">Groups Have Not Been Generated Yet</h4>
        <p className="mt-1 text-xs text-zinc-400">
          The tournament organizer has not generated group assignments for this stage yet.
        </p>
      </div>
    );
  }

  // Active group object
  const activeGroup =
    groups.find((g) => String(g.group_id) === String(selectedGroupId)) ||
    groups[0];

  const activeGroupMembers = activeGroup?.members || [];
  const activeGroupMatches = activeGroup?.matches || [];

  // Filter standings by selected group
  const activeStandingsData = standingsMap[selectedGroupId] || {
    loading: false,
    error: null,
    standings: [],
  };

  // Group matches by round
  const matchesByRound = {};
  activeGroupMatches.forEach((m) => {
    const round = m.round_number || 1;
    if (!matchesByRound[round]) matchesByRound[round] = [];
    matchesByRound[round].push(m);
  });

  // Collect all matches where user is captain across all groups
  const allCaptainMatches = (stageData?.groups || []).flatMap((g) =>
    (g.matches || []).filter((m) =>
      (m.participants || []).some(
        (p) =>
          (p.team_id && myCaptainTeamIds.includes(Number(p.team_id))) ||
          (p.registration_id && myCaptainRegIds.includes(Number(p.registration_id)))
      )
    )
  );

  const pendingSubmitMatches = allCaptainMatches.filter((m) => {
    const isCompleted = m.status === "completed" || m.result_status === "VERIFIED";
    const isPending =
      m.result_status === "SUBMITTED" ||
      m.status === "pending_verification" ||
      Boolean(pendingResultsMap[m.match_id]);
    return !isCompleted && !isPending;
  });

  const isOrganizer = currentUser?.role === "organizer";

  return (
    <div className="mt-8 pt-8 border-t border-zinc-800/80">
      {/* Captain Action Banner if match results are ready to submit */}
      {pendingSubmitMatches.length > 0 && (
        <div className="mb-6 rounded-2xl border border-red-500/40 bg-gradient-to-r from-red-500/15 via-red-500/10 to-transparent p-4 sm:p-5 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="flex h-2.5 w-2.5 rounded-full bg-red-500 animate-ping" />
              <h4 className="text-sm font-bold text-white">Action Required: Submit Match Result</h4>
              <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-bold text-red-400 border border-red-500/30">
                {pendingSubmitMatches.length} Ready
              </span>
            </div>
            <p className="text-xs text-zinc-300">
              You are captain in Match #{pendingSubmitMatches[0].match_id} (
              {pendingSubmitMatches[0].participants?.[0]?.team_name || "Team A"} vs{" "}
              {pendingSubmitMatches[0].participants?.[1]?.team_name || "Team B"}
              ). Submit match score and victory screenshot to proceed.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setSelectedMatchForSubmit(pendingSubmitMatches[0]);
            }}
            className="shrink-0 rounded-xl bg-red-500 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-red-500/20 hover:bg-red-600 transition"
          >
            Submit Result Now →
          </button>
        </div>
      )}

      {/* View Header & Sub-Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h3 className="text-xl font-black text-white">Group Stage</h3>
          <p className="text-xs text-zinc-400 mt-0.5">
            Group stage standings, teams, and round-robin matches.
          </p>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex items-center gap-1 bg-zinc-900 p-1.5 rounded-xl border border-zinc-800 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setActiveTab("standings")}
            className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${
              activeTab === "standings"
                ? "bg-red-500 text-white shadow-md shadow-red-500/20"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            Standings
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("groups")}
            className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${
              activeTab === "groups"
                ? "bg-red-500 text-white shadow-md shadow-red-500/20"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            Groups & Teams
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("matches")}
            className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${
              activeTab === "matches"
                ? "bg-red-500 text-white shadow-md shadow-red-500/20"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            Matches
          </button>

          {groupStatus === "bracket_generated" && (
            <button
              type="button"
              onClick={() => setActiveTab("bracket")}
              className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${
                activeTab === "bracket"
                  ? "bg-amber-500 text-zinc-950 font-bold shadow-md shadow-amber-500/20"
                  : "text-amber-400 hover:text-amber-300 font-bold"
              }`}
            >
              Playoff Bracket
            </button>
          )}
        </div>
      </div>

      {/* Group Selector Pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-3 mb-6 scrollbar-none">
        <span className="text-xs font-bold text-zinc-500 uppercase shrink-0 mr-1">Group:</span>
        {groups.map((g) => {
          const isUserInGroup = (g.members || []).some(
            (mem) =>
              myCaptainTeamIds.includes(Number(mem.team_id)) ||
              myCaptainRegIds.includes(Number(mem.registration_id))
          );
          return (
            <button
              key={g.group_id}
              type="button"
              onClick={() => setSelectedGroupId(g.group_id)}
              className={`rounded-xl px-4 py-2 text-xs font-bold transition shrink-0 border flex items-center gap-1.5 ${
                String(selectedGroupId) === String(g.group_id)
                  ? "bg-zinc-800 text-white border-zinc-600 shadow-md"
                  : "bg-zinc-950/80 text-zinc-400 border-zinc-800/80 hover:border-zinc-700 hover:text-white"
              }`}
            >
              <span>{g.group_name}</span>
              {isUserInGroup && (
                <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[9px] font-extrabold text-red-400 border border-red-500/30 uppercase">
                  Your Group
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* TAB 1: STANDINGS */}
      {activeTab === "standings" && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 overflow-hidden shadow-xl">
          {activeStandingsData.loading ? (
            <div className="p-8 text-center text-xs text-zinc-500 animate-pulse">Loading standings...</div>
          ) : activeStandingsData.error ? (
            <div className="p-8 text-center text-xs text-red-400">{activeStandingsData.error}</div>
          ) : activeStandingsData.standings.length === 0 ? (
            <div className="p-12 text-center text-xs text-zinc-500">No standings data available for this group.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-950/90 text-zinc-400 text-[11px] uppercase tracking-wider">
                    <th className="py-3.5 pl-6 font-bold">Rank</th>
                    <th className="py-3.5 font-bold">Team</th>
                    <th className="py-3.5 text-center font-bold">P</th>
                    <th className="py-3.5 text-center font-bold">W</th>
                    <th className="py-3.5 text-center font-bold">L</th>
                    <th className="py-3.5 text-center font-bold">Kills</th>
                    <th className="py-3.5 text-center font-bold">+/-</th>
                    <th className="py-3.5 pr-6 text-right font-bold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {activeStandingsData.standings.map((row) => (
                    <tr
                      key={row.member_id}
                      className={`hover:bg-zinc-800/30 transition ${
                        row.qualified ? "bg-emerald-500/5" : ""
                      }`}
                    >
                      {/* Rank */}
                      <td className="py-4 pl-6 font-black text-white">
                        <div className="flex items-center gap-1.5">
                          <span className={row.rank === 1 ? "text-amber-400" : row.rank === 2 ? "text-slate-300" : "text-zinc-400"}>
                            #{row.rank}
                          </span>
                          {row.final_rank && (
                            <span className="text-[10px] text-zinc-500 font-normal" title="Organizer tie-breaker rank">
                              (R{row.final_rank})
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Team */}
                      <td className="py-4 font-bold text-white">
                        <div className="flex items-center gap-2">
                          <span>{row.team_name}</span>
                          {row.team_tag && (
                            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-bold text-zinc-400">
                              [{row.team_tag}]
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Stats */}
                      <td className="py-4 text-center font-semibold text-zinc-300">{row.played}</td>
                      <td className="py-4 text-center font-semibold text-emerald-400">{row.wins}</td>
                      <td className="py-4 text-center font-semibold text-red-400">{row.losses}</td>
                      <td className="py-4 text-center font-semibold text-white">{row.total_kills}</td>
                      <td
                        className={`py-4 text-center font-semibold ${
                          row.kill_difference > 0
                            ? "text-emerald-400"
                            : row.kill_difference < 0
                            ? "text-red-400"
                            : "text-zinc-400"
                        }`}
                      >
                        {row.kill_difference > 0 ? `+${row.kill_difference}` : row.kill_difference}
                      </td>

                      {/* Status */}
                      <td className="py-4 pr-6 text-right">
                        {row.qualified ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold uppercase text-emerald-400 border border-emerald-500/20">
                            ✓ Qualified
                          </span>
                        ) : (
                          <span className="text-[11px] text-zinc-500 font-medium">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: GROUPS & TEAMS */}
      {activeTab === "groups" && (
        <div className="grid gap-6 grid-cols-1 sm:grid-cols-2">
          {groups.map((group) => {
            const gMembers = group.members || [];
            return (
              <div
                key={group.group_id}
                className="rounded-2xl border border-zinc-800 bg-zinc-900/50 overflow-hidden shadow-xl"
              >
                <div className="border-b border-zinc-800 bg-zinc-950/80 px-5 py-3.5 flex items-center justify-between">
                  <h4 className="text-base font-black text-white">{group.group_name}</h4>
                  <span className="text-xs font-semibold text-zinc-500">{gMembers.length} / 4 Teams</span>
                </div>

                <div className="p-4 space-y-2.5">
                  {[1, 2, 3, 4].map((slotNum) => {
                    const member = gMembers.find((m) => Number(m.slot) === slotNum);
                    return (
                      <div
                        key={slotNum}
                        className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-3.5 flex items-center justify-between"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-500/10 text-xs font-black text-red-500 border border-red-500/20">
                            {slotNum}
                          </div>
                          <div>
                            <p className="text-sm font-bold text-white">
                              {member ? member.team_name : <span className="text-zinc-600 italic">Empty Slot</span>}
                            </p>
                            {member?.team_tag && (
                              <p className="text-[11px] font-semibold text-zinc-500">Tag: [{member.team_tag}]</p>
                            )}
                          </div>
                        </div>

                        {member?.qualified && (
                          <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase text-emerald-400 border border-emerald-500/20">
                            Qualified
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* TAB 3: MATCHES */}
      {activeTab === "matches" && (
        <div className="space-y-6">
          {/* Organizer Pending Results Review Section */}
          {isOrganizer && effectiveTournamentId && (
            <PendingResultsReview
              tournamentId={effectiveTournamentId}
              onRefreshData={() => {
                fetchStageData();
                fetchPendingResultsMap();
              }}
              onToast={onToast}
            />
          )}

          {Object.keys(matchesByRound).length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 p-12 text-center text-xs text-zinc-400">
              No group matches generated yet for this group.
            </div>
          ) : (
            Object.keys(matchesByRound).map((roundNum) => (
              <div key={roundNum} className="space-y-3">
                <h4 className="text-xs font-bold tracking-widest text-zinc-400 uppercase">
                  Round {roundNum} Matches
                </h4>

                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                  {matchesByRound[roundNum].map((m) => {
                    const teamA = m.participants?.[0];
                    const teamB = m.participants?.[1];
                    const isCompleted = m.status === "completed" || m.result_status === "VERIFIED";

                    const isCaptainOfMatch = (m.participants || []).some(
                      (p) =>
                        (p.team_id && myCaptainTeamIds.includes(Number(p.team_id))) ||
                        (p.registration_id && myCaptainRegIds.includes(Number(p.registration_id)))
                    );

                    const pendingResult = pendingResultsMap[m.match_id];
                    const isPendingVerification =
                      m.result_status === "SUBMITTED" ||
                      m.status === "pending_verification" ||
                      Boolean(pendingResult);

                    return (
                      <div
                        key={m.match_id}
                        className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 shadow-lg flex flex-col justify-between"
                      >
                        <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3 mb-3 text-xs">
                          <span className="font-semibold text-zinc-500">Match #{m.match_id}</span>
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase border ${
                              isCompleted
                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                : isPendingVerification
                                ? "bg-amber-500/10 text-amber-400 border-amber-500/30 animate-pulse"
                                : "bg-zinc-800 text-zinc-400 border-zinc-700"
                            }`}
                          >
                            {isCompleted
                              ? "COMPLETED"
                              : isPendingVerification
                              ? "AWAITING VERIFICATION"
                              : m.status}
                          </span>
                        </div>

                        {/* Match Participants & Score */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-bold text-white">
                              {teamA?.team_name || "TBD"}
                              {teamA?.team_tag && <span className="text-xs text-zinc-500 ml-1">[{teamA.team_tag}]</span>}
                            </span>
                          </div>

                          <div className="text-center text-xs font-bold text-zinc-500 my-1 uppercase tracking-widest">
                            VS
                          </div>

                          <div className="flex items-center justify-between text-sm">
                            <span className="font-bold text-white">
                              {teamB?.team_name || "TBD"}
                              {teamB?.team_tag && <span className="text-xs text-zinc-500 ml-1">[{teamB.team_tag}]</span>}
                            </span>
                          </div>
                        </div>

                        {/* Action Footer */}
                        <div className="mt-4 pt-3 border-t border-zinc-800/80 flex justify-between items-center text-xs">
                          {isCompleted ? (
                            <span className="text-xs font-semibold text-emerald-400">✓ Result Verified</span>
                          ) : isPendingVerification ? (
                            isOrganizer ? (
                              <button
                                type="button"
                                onClick={() => {
                                  // Scroll to PendingResultsReview console
                                  window.scrollTo({ top: 400, behavior: "smooth" });
                                }}
                                className="w-full rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 shadow-md shadow-emerald-600/20 transition"
                              >
                                Review & Verify Result ↗
                              </button>
                            ) : isCaptainOfMatch ? (
                              <span className="text-xs font-semibold text-amber-400">⏳ Result Submitted (Awaiting Review)</span>
                            ) : (
                              <span className="text-xs font-medium text-zinc-500">Under Organizer Review</span>
                            )
                          ) : isCaptainOfMatch ? (
                            <button
                              type="button"
                              onClick={() => setSelectedMatchForSubmit(m)}
                              className="w-full rounded-lg bg-red-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-600 shadow-md shadow-red-500/20 transition"
                            >
                              Submit Result
                            </button>
                          ) : isOrganizer ? (
                            <span className="text-xs text-zinc-500 italic">Awaiting Captain Submission</span>
                          ) : (
                            <span className="text-xs text-zinc-500 font-medium">Scheduled</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* TAB 4: PLAYOFF BRACKET */}
      {activeTab === "bracket" && (
        <div className="space-y-6">
          <PlayoffBracketView
            stageId={stageId}
            tournamentId={effectiveTournamentId}
            onToast={onToast}
          />
          {isOrganizer && effectiveTournamentId && (
            <PendingResultsReview
              tournamentId={effectiveTournamentId}
              onRefreshData={() => {
                fetchStageData();
                fetchPendingResultsMap();
              }}
              onToast={onToast}
            />
          )}
        </div>
      )}

      {/* Submit Result Modal */}
      <SubmitResultModal
        isOpen={Boolean(selectedMatchForSubmit)}
        match={selectedMatchForSubmit}
        captainTeam={
          selectedMatchForSubmit
            ? (selectedMatchForSubmit.participants || []).find(
                (p) =>
                  (p.team_id && myCaptainTeamIds.includes(Number(p.team_id))) ||
                  (p.registration_id && myCaptainRegIds.includes(Number(p.registration_id)))
              )
            : null
        }
        onClose={() => setSelectedMatchForSubmit(null)}
        onSuccess={(msg) => {
          fetchStageData();
          fetchPendingResultsMap();
          onToast && onToast(msg);
        }}
      />
    </div>
  );
}

export default PublicGroupStageView;

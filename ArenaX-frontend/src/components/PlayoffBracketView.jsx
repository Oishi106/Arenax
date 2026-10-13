import React, { useEffect, useState } from "react";
import { getBracket, getMe, getMyTeams, getMyRegistrations } from "../api";
import SubmitResultModal from "./SubmitResultModal";
import ScheduleMatchModal from "./ScheduleMatchModal";
import PendingResultsReview from "./PendingResultsReview";

function PlayoffBracketView({ stageId, tournamentId, tournamentStatus, onToast }) {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [bracketData, setBracketData] = useState(null);
  const [stageFormat, setStageFormat] = useState("double_elimination");
  const [fetchedTournamentId, setFetchedTournamentId] = useState(null);
  const [fetchedTournamentStatus, setFetchedTournamentStatus] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [myCaptainTeamIds, setMyCaptainTeamIds] = useState([]);
  const [myCaptainRegIds, setMyCaptainRegIds] = useState([]);
  const [selectedMatchForSubmit, setSelectedMatchForSubmit] = useState(null);
  const [selectedMatchForSchedule, setSelectedMatchForSchedule] = useState(null);

  const effectiveTournamentId = tournamentId || fetchedTournamentId;
  const effectiveTournamentStatus = (tournamentStatus || fetchedTournamentStatus || "").toLowerCase();
  const isTournamentLive = effectiveTournamentStatus === "live";

  // Active section filter: 'all' | 'play_in' | 'upper' | 'lower' | 'grand_final'
  const [activeSection, setActiveSection] = useState("upper");

  const fetchBracket = async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const data = await getBracket(stageId);
      setBracketData(data.bracket || null);
      if (data.stageFormat || data.stage_format) {
        setStageFormat(data.stageFormat || data.stage_format);
      }
      if (data.tournament_id || data.tournamentId) {
        setFetchedTournamentId(data.tournament_id || data.tournamentId);
      }
      if (data.tournament_status || data.tournamentStatus) {
        setFetchedTournamentStatus(data.tournament_status || data.tournamentStatus);
      }
    } catch (err) {
      console.error("Failed to fetch playoff bracket:", err);
      setErrorMsg(err.message || err.data?.error || "Failed to load playoff bracket.");
    } finally {
      setLoading(false);
    }
  };

  const fetchUserData = async () => {
    try {
      const meData = await getMe();
      const user = meData.user || null;
      setCurrentUser(user);

      if (user) {
        try {
          const [myTeams, myRegs] = await Promise.all([
            getMyTeams().catch(() => []),
            getMyRegistrations().catch(() => []),
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

  useEffect(() => {
    fetchUserData();
  }, []);

  useEffect(() => {
    if (stageId) {
      fetchBracket();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageId]);

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
        <button onClick={fetchBracket} className="ml-3 font-bold underline hover:text-white">
          Retry
        </button>
      </div>
    );
  }

  if (!bracketData) {
    return (
      <div className="mt-8 rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 p-12 text-center text-xs text-zinc-500">
        No playoff bracket generated yet.
      </div>
    );
  }

  const playInMatches = bracketData.playIn || [];
  const upperMatches = bracketData.upperBracket || [];
  const lowerMatches = bracketData.lowerBracket || [];
  const grandFinalMatch = bracketData.grandFinal || null;

  const isSingleElim = stageFormat === "single_elimination" || lowerMatches.length === 0;
  const hasPlayIn = playInMatches.length > 0;

  // Helper: Group matches by round_number
  const groupMatchesByRound = (matchList) => {
    const rounds = {};
    matchList.forEach((m) => {
      const r = m.round_number || 1;
      if (!rounds[r]) rounds[r] = [];
      rounds[r].push(m);
    });
    return rounds;
  };

  const renderMatchCard = (m) => {
    const participants = m.participants || [];
    const sideA = participants.find((p) => p.side === "A");
    const sideB = participants.find((p) => p.side === "B");
    const isCompleted = m.status === "completed" || m.result_status === "VERIFIED";
    const bestOf = m.best_of || "BO1";
    const hasBothParticipants = Boolean(sideA && sideB);

    const isSideAWinner =
      isCompleted &&
      m.winning_registration_id &&
      Number(sideA?.registration_id) === Number(m.winning_registration_id);
    const isSideBWinner =
      isCompleted &&
      m.winning_registration_id &&
      Number(sideB?.registration_id) === Number(m.winning_registration_id);
    const hasKills = m.team_a_kills != null && m.team_b_kills != null;

    const isCaptainOfMatch = (m.participants || []).some(
      (p) =>
        (p.team_id && myCaptainTeamIds.includes(Number(p.team_id))) ||
        (p.registration_id && myCaptainRegIds.includes(Number(p.registration_id)))
    );

    const isPendingVerification =
      m.result_status === "SUBMITTED" ||
      m.status === "pending_verification";

    // Format scheduled time if present
    let formattedDate = null;
    if (m.scheduled_time) {
      try {
        const d = new Date(m.scheduled_time);
        if (!isNaN(d.getTime())) {
          formattedDate = d.toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });
        }
      } catch {
        formattedDate = null;
      }
    }

    return (
      <div
        key={m.match_id}
        className="w-72 shrink-0 rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4 shadow-xl flex flex-col justify-between hover:border-zinc-700 transition"
      >
        {/* Card Header */}
        <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2.5 mb-3 text-[11px]">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-zinc-300">Match #{m.match_id}</span>
            {currentUser?.role === "organizer" && (
              <button
                type="button"
                onClick={() => setSelectedMatchForSchedule(m)}
                title="Configure Schedule, Lobby & Mode"
                className="rounded px-1.5 py-0.5 text-[10px] font-bold text-zinc-400 bg-zinc-800 hover:bg-zinc-700 hover:text-white transition"
              >
                ⚙
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className={`rounded px-1.5 py-0.5 font-black uppercase text-[9px] ${
                bestOf === "BO5"
                  ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                  : bestOf === "BO3"
                  ? "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                  : "bg-zinc-800 text-zinc-400"
              }`}
            >
              {bestOf}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 font-bold uppercase text-[9px] border ${
                isCompleted
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : isPendingVerification
                  ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                  : "bg-zinc-800 text-zinc-400 border-zinc-700"
              }`}
            >
              {isCompleted ? "VERIFIED" : m.status}
            </span>
          </div>
        </div>

        {/* Schedule & Lobby Details Bar */}
        {(formattedDate || m.lobby_code || m.server_region || m.draft_mode) && (
          <div className="mb-2.5 flex flex-wrap gap-1.5 text-[9px]">
            {formattedDate && (
              <span className="rounded bg-zinc-800/80 px-2 py-0.5 text-zinc-300 font-semibold border border-zinc-700/60">
                🕒 {formattedDate}
              </span>
            )}
            {m.lobby_code && (
              <span className="rounded bg-blue-500/10 px-2 py-0.5 text-blue-300 font-bold border border-blue-500/20">
                🔑 {m.lobby_code}
              </span>
            )}
            {m.server_region && (
              <span className="rounded bg-zinc-800/60 px-1.5 py-0.5 text-zinc-400 border border-zinc-700/40">
                🌐 {m.server_region}
              </span>
            )}
            {m.draft_mode && (
              <span className="rounded bg-zinc-800/60 px-1.5 py-0.5 text-zinc-400 border border-zinc-700/40">
                ⚔ {m.draft_mode}
              </span>
            )}
          </div>
        )}

        {/* Participant Side A */}
        <div className="space-y-2">
          <div
            className={`rounded-xl border p-2.5 text-xs flex items-center justify-between transition ${
              isSideAWinner
                ? "border-emerald-500/60 bg-emerald-500/10 shadow-sm shadow-emerald-500/10"
                : isCompleted && sideA
                ? "border-zinc-800/60 bg-zinc-950/40 opacity-70"
                : sideA
                ? "border-zinc-800 bg-zinc-950/80"
                : "border-dashed border-zinc-800/60 bg-zinc-950/30 text-zinc-500"
            }`}
          >
            <div className="flex items-center gap-2 truncate">
              <span className={`text-[10px] font-bold ${isSideAWinner ? "text-emerald-400" : "text-red-500"}`}>A</span>
              {sideA ? (
                <span className={`font-bold truncate ${isSideAWinner ? "text-emerald-300 font-black" : "text-white"}`}>
                  {sideA.team_name} {sideA.team_tag ? `[${sideA.team_tag}]` : ""}
                </span>
              ) : (
                <span className="italic text-zinc-500 text-[11px]">Advancing Team</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {hasKills && (
                <span className={`text-[11px] font-mono font-bold ${isSideAWinner ? "text-emerald-400" : "text-zinc-400"}`}>
                  {m.team_a_kills} kills
                </span>
              )}
              {isSideAWinner && (
                <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-black text-emerald-300 border border-emerald-500/30 uppercase tracking-wide">
                  👑 WINNER
                </span>
              )}
              {isCompleted && !isSideAWinner && sideA && (
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] font-medium text-zinc-500">
                  Defeated
                </span>
              )}
              {sideA?.bye_status && (
                <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-400 border border-emerald-500/20">
                  BYE
                </span>
              )}
            </div>
          </div>

          <div className="text-center text-[10px] font-black text-zinc-600 uppercase tracking-widest">
            VS
          </div>

          {/* Participant Side B */}
          <div
            className={`rounded-xl border p-2.5 text-xs flex items-center justify-between transition ${
              isSideBWinner
                ? "border-emerald-500/60 bg-emerald-500/10 shadow-sm shadow-emerald-500/10"
                : isCompleted && sideB
                ? "border-zinc-800/60 bg-zinc-950/40 opacity-70"
                : sideB
                ? "border-zinc-800 bg-zinc-950/80"
                : "border-dashed border-zinc-800/60 bg-zinc-950/30 text-zinc-500"
            }`}
          >
            <div className="flex items-center gap-2 truncate">
              <span className={`text-[10px] font-bold ${isSideBWinner ? "text-emerald-400" : "text-red-500"}`}>B</span>
              {sideB ? (
                <span className={`font-bold truncate ${isSideBWinner ? "text-emerald-300 font-black" : "text-white"}`}>
                  {sideB.team_name} {sideB.team_tag ? `[${sideB.team_tag}]` : ""}
                </span>
              ) : (
                <span className="italic text-zinc-500 text-[11px]">Advancing Team</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {hasKills && (
                <span className={`text-[11px] font-mono font-bold ${isSideBWinner ? "text-emerald-400" : "text-zinc-400"}`}>
                  {m.team_b_kills} kills
                </span>
              )}
              {isSideBWinner && (
                <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-black text-emerald-300 border border-emerald-500/30 uppercase tracking-wide">
                  👑 WINNER
                </span>
              )}
              {isCompleted && !isSideBWinner && sideB && (
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] font-medium text-zinc-500">
                  Defeated
                </span>
              )}
              {sideB?.bye_status && (
                <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-400 border border-emerald-500/20">
                  BYE
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action Footer */}
        <div className="mt-3 pt-2.5 border-t border-zinc-800/80 flex items-center justify-between text-xs">
          {isCompleted ? (
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-1.5">
                <span className="text-emerald-400 font-bold text-[11px]">✓ Result Verified</span>
                {hasKills && (
                  <span className="text-zinc-400 font-mono text-[10px] bg-zinc-800/80 px-1.5 py-0.5 rounded border border-zinc-700/50">
                    {m.team_a_kills} - {m.team_b_kills}
                  </span>
                )}
              </div>
              {m.evidence_url && (
                <a
                  href={m.evidence_url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded px-2 py-0.5 text-[10px] font-bold text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 transition flex items-center gap-1"
                  title="View match victory screenshot evidence"
                >
                  Evidence ↗
                </a>
              )}
            </div>
          ) : isPendingVerification ? (
            currentUser?.role === "organizer" ? (
              <span className="text-amber-400 font-bold text-[11px]">⚡ Pending Organizer Review</span>
            ) : (
              <div className="w-full flex items-center justify-between">
                <span className="text-amber-400 font-semibold text-[11px]">⏳ Result Submitted (Awaiting Review)</span>
                {m.evidence_url && (
                  <a href={m.evidence_url} target="_blank" rel="noreferrer" className="text-blue-400 text-[10px] underline">
                    Evidence ↗
                  </a>
                )}
              </div>
            )
          ) : isCaptainOfMatch && hasBothParticipants ? (
            isTournamentLive ? (
              <button
                type="button"
                onClick={() => setSelectedMatchForSubmit(m)}
                className="w-full rounded-lg bg-red-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-600 shadow-md shadow-red-500/20 transition"
              >
                Submit Result
              </button>
            ) : (
              <span
                className="w-full text-center rounded-lg bg-zinc-800/80 px-2 py-1.5 text-[10px] font-semibold text-zinc-400 border border-zinc-700/50"
                title="Match results can only be submitted once registration closes and the organizer sets the tournament to Live"
              >
                🔒 Locked ({effectiveTournamentStatus === "published" ? "Tournament Pending Live" : effectiveTournamentStatus.toUpperCase() || "Not Live"})
              </span>
            )
          ) : hasBothParticipants ? (
            <span className="text-zinc-500 text-[11px] font-medium">Scheduled</span>
          ) : (
            <span className="text-zinc-600 text-[11px] italic">Awaiting Advancing Teams</span>
          )}
        </div>

        {/* Advancement Links Preview */}
        {m.advancements && m.advancements.length > 0 && (
          <div className="mt-2.5 pt-2 border-t border-zinc-800/40 text-[10px] text-zinc-500 flex flex-wrap gap-2">
            {m.advancements.map((adv) => (
              <span key={adv.advancement_id} className="truncate">
                {adv.outcome_type.toLowerCase() === "winner" ? "➔ Winner" : "➔ Loser"} to Match #{adv.destination_match_id} ({adv.destination_side})
              </span>
            ))}
          </div>
        )}
      </div>
    );
  };

  const getRoundTitle = (sectionKey, roundNumber, maxRounds) => {
    const r = Number(roundNumber);
    const max = Number(maxRounds);
    if (isSingleElim) {
      if (r === max) return "Championship Match";
      if (r === max - 1) return "Semifinals";
      if (r === max - 2) return "Quarterfinals";
      return `Round ${r}`;
    }
    if (sectionKey === "Upper Bracket") {
      if (r === max) return "Upper Final";
      if (r === max - 1) return "Semifinals";
      if (r === max - 2) return "Quarterfinals";
      return `Round ${r}`;
    }
    if (sectionKey === "Lower Bracket") {
      if (r === max) return "Lower Final";
      if (r === max - 1) return "Lower Semifinal";
      return `Lower Round ${r}`;
    }
    if (sectionKey === "Play-In Round") {
      return `Play-In Round ${r}`;
    }
    return `Round ${r}`;
  };

  const renderBracketSection = (matchesList, sectionTitle) => {
    const rounds = groupMatchesByRound(matchesList);
    const roundNumbers = Object.keys(rounds).sort((a, b) => Number(a) - Number(b));
    const maxRound = roundNumbers.length > 0 ? Math.max(...roundNumbers.map(Number)) : 1;

    if (roundNumbers.length === 0) {
      return (
        <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 p-8 text-center text-xs text-zinc-500">
          No matches in {sectionTitle}.
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">{sectionTitle}</h4>

        {/* Horizontal Round Columns */}
        <div className="flex items-start gap-6 overflow-x-auto pb-4 scrollbar-thin">
          {roundNumbers.map((rNum) => (
            <div key={rNum} className="space-y-3 shrink-0">
              <div className="rounded-lg bg-zinc-900 px-3 py-1.5 text-center text-xs font-black text-white border border-zinc-800">
                {getRoundTitle(sectionTitle, rNum, maxRound)}
              </div>
              <div className="space-y-4">
                {rounds[rNum].map((matchItem) => renderMatchCard(matchItem))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="mt-8 pt-8 border-t border-zinc-800/80 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h3 className="text-xl font-black text-white">
              {isSingleElim ? "Single Elimination Bracket" : "Double Elimination Playoff Bracket"}
            </h3>
            <span
              className={`rounded-full px-3 py-1 text-xs font-bold border ${
                isSingleElim
                  ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                  : "bg-purple-500/10 text-purple-400 border-purple-500/20"
              }`}
            >
              {isSingleElim ? "Single Elimination" : "Double Elimination"}
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            {isSingleElim
              ? "Winners advance automatically through each round until the championship."
              : "Upper Bracket, Lower Bracket, BO3 Semifinals, and BO5 Grand Final."}
          </p>
        </div>

        {/* Bracket Section Filters */}
        {!isSingleElim && (
          <div className="flex items-center gap-1 bg-zinc-900 p-1.5 rounded-xl border border-zinc-800 self-start sm:self-auto">
            {hasPlayIn && (
              <button
                type="button"
                onClick={() => setActiveSection("play_in")}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  activeSection === "play_in" ? "bg-red-500 text-white" : "text-zinc-400 hover:text-white"
                }`}
              >
                Play-In Round
              </button>
            )}

            <button
              type="button"
              onClick={() => setActiveSection("upper")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                activeSection === "upper" ? "bg-red-500 text-white" : "text-zinc-400 hover:text-white"
              }`}
            >
              Upper Bracket
            </button>

            <button
              type="button"
              onClick={() => setActiveSection("lower")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                activeSection === "lower" ? "bg-red-500 text-white" : "text-zinc-400 hover:text-white"
              }`}
            >
              Lower Bracket
            </button>

            <button
              type="button"
              onClick={() => setActiveSection("grand_final")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                activeSection === "grand_final" ? "bg-red-500 text-white" : "text-zinc-400 hover:text-white"
              }`}
            >
              Grand Final
            </button>
          </div>
        )}
      </div>

      {/* Render Single Elimination vs Double Elimination */}
      {isSingleElim ? (
        <div className="space-y-6">
          {renderBracketSection(
            [...upperMatches, ...(grandFinalMatch ? [grandFinalMatch] : [])],
            "Elimination Tournament"
          )}
        </div>
      ) : (
        <>
          {activeSection === "play_in" && hasPlayIn && renderBracketSection(playInMatches, "Play-In Round")}
          {activeSection === "upper" && renderBracketSection(upperMatches, "Upper Bracket")}
          {activeSection === "lower" && renderBracketSection(lowerMatches, "Lower Bracket")}
          {activeSection === "grand_final" && (
            <div className="space-y-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Grand Final (BO5)</h4>
              {grandFinalMatch ? (
                <div className="flex justify-center p-4">
                  {renderMatchCard(grandFinalMatch)}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 p-8 text-center text-xs text-zinc-500">
                  Grand Final match not available yet.
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Organizer Pending Results Review Section */}
      {currentUser?.role === "organizer" && effectiveTournamentId && (
        <PendingResultsReview
          tournamentId={effectiveTournamentId}
          onRefreshData={fetchBracket}
          onToast={onToast}
        />
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
          fetchBracket();
          onToast && onToast(msg);
        }}
      />

      {/* Schedule & Lobby Modal */}
      <ScheduleMatchModal
        isOpen={Boolean(selectedMatchForSchedule)}
        match={selectedMatchForSchedule}
        onClose={() => setSelectedMatchForSchedule(null)}
        onSuccess={(msg) => {
          fetchBracket();
          onToast && onToast(msg);
        }}
      />
    </div>
  );
}

export default PlayoffBracketView;

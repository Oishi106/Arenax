import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import RegisterTeamModal from "../components/RegisterTeamModal";
import PublicGroupStageView from "../components/PublicGroupStageView";
import PlayoffBracketView from "../components/PlayoffBracketView";
import SubmitResultModal from "../components/SubmitResultModal";
import ScheduleMatchModal from "../components/ScheduleMatchModal";
import PendingResultsReview from "../components/PendingResultsReview";
import {
  getTournamentDetails,
  getTournamentHub,
  getMe,
  getMyTeams,
  getMyRegistrations,
  getTournamentStages,
} from "../api";
import { formatPrizePool } from "../utils/formatters";

const STATUS_STYLES = {
  draft: "bg-zinc-700/30 text-zinc-400 border-zinc-600/30",
  published: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  live: "bg-red-500/10 text-red-400 border-red-500/30 animate-pulse",
  completed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
};

const REG_TIMELINE_STYLES = {
  NOT_STARTED: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  OPEN: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  CLOSED: "bg-zinc-800 text-zinc-400 border-zinc-700",
  FROZEN: "bg-purple-500/10 text-purple-400 border-purple-500/20",
};

const REG_STATUS_STYLES = {
  pending: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  approved: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  rejected: "bg-red-500/10 text-red-400 border-red-500/20",
};

const FORMAT_LABELS = {
  group_stage: "Group Stage",
  single_elimination: "Single Elimination",
  double_elimination: "Double Elimination",
};

const BRACKET_STATUS_BADGES = {
  CHAMPION: {
    label: "🏆 Champion",
    cls: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  },
  RUNNER_UP: {
    label: "🥈 Runner-Up",
    cls: "bg-slate-400/15 text-slate-200 border-slate-400/30",
  },
  "3RD_PLACE": {
    label: "🥉 3rd Place",
    cls: "bg-amber-700/20 text-amber-400 border-amber-600/30",
  },
  SEMIFINALIST: {
    label: "🥉 3rd-4th Place",
    cls: "bg-amber-700/20 text-amber-400 border-amber-600/30",
  },
  "4TH_PLACE": {
    label: "4th Place",
    cls: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  },
  GRAND_FINALIST: {
    label: "🔥 Grand Final",
    cls: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  },
  UPPER_BRACKET: {
    label: "🟢 Upper Bracket",
    cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
  },
  LOWER_BRACKET: {
    label: "🟡 Lower Bracket",
    cls: "bg-amber-500/10 text-amber-400 border-amber-500/25",
  },
  PLAY_IN: {
    label: "⚡ Play-In",
    cls: "bg-blue-500/10 text-blue-400 border-blue-500/25",
  },
  GROUP_STAGE: {
    label: "🔵 Group Stage",
    cls: "bg-blue-500/10 text-blue-400 border-blue-500/25",
  },
  ACTIVE: {
    label: "● Active",
    cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
  },
  REGISTERED: {
    label: "✓ Seeded",
    cls: "bg-zinc-800 text-zinc-300 border-zinc-700",
  },
  ELIMINATED: {
    label: "Eliminated",
    cls: "bg-red-500/10 text-red-400/80 border-red-500/20",
  },
};

const BRACKET_TYPE_LABELS = {
  group: "Group Stage",
  play_in: "Play-In Round",
  upper: "Upper Bracket",
  lower: "Lower Bracket",
  grand_final: "Grand Final",
};

function TournamentDetails() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [tournament, setTournament] = useState(null);
  const [stages, setStages] = useState([]);
  const [hubData, setHubData] = useState({
    participants: [],
    matches: [],
    standings: [],
  });
  const [user, setUser] = useState(null);
  const [myRegistration, setMyRegistration] = useState(null);
  const [myCaptainTeamIds, setMyCaptainTeamIds] = useState([]);
  const [myCaptainRegIds, setMyCaptainRegIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);

  // Active Hub Tab: 'overview' | 'groups' | 'standings' | 'matches' | 'bracket'
  const [activeTab, setActiveTab] = useState("overview");

  // Groups & Teams state
  const [expandedTeamRosters, setExpandedTeamRosters] = useState({});
  const [teamSearch, setTeamSearch] = useState("");

  // Standings sub-view ('overall' | 'groups')
  const [standingsViewMode, setStandingsViewMode] = useState("overall");

  // Matches tab filters & modals
  const [matchStatusFilter, setMatchStatusFilter] = useState("all");
  const [matchBracketFilter, setMatchBracketFilter] = useState("all");
  const [selectedMatchForSubmit, setSelectedMatchForSubmit] = useState(null);
  const [selectedMatchForSchedule, setSelectedMatchForSchedule] = useState(null);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(""), 4000);
  };

  const toggleTeamRoster = (regId) => {
    setExpandedTeamRosters((prev) => ({
      ...prev,
      [regId]: !prev[regId],
    }));
  };

  const fetchDetails = async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const data = await getTournamentDetails(id);
      setTournament(data);

      try {
        const [stagesData, fetchedHub] = await Promise.all([
          getTournamentStages(id).catch(() => []),
          getTournamentHub(id).catch(() => ({
            participants: [],
            matches: [],
            standings: [],
          })),
        ]);
        setStages(stagesData || []);
        setHubData({
          participants: fetchedHub?.participants || [],
          matches: fetchedHub?.matches || [],
          standings: fetchedHub?.standings || [],
        });
      } catch (stageErr) {
        console.error("Failed to load stages/hub:", stageErr);
      }

      try {
        const meData = await getMe();
        setUser(meData.user);

        const [myTeams, myRegs] = await Promise.all([
          getMyTeams().catch(() => []),
          getMyRegistrations().catch(() => []),
        ]);

        const existing = (myRegs || []).find(
          (r) => String(r.tournament_id) === String(id)
        );
        setMyRegistration(existing || null);

        const capTeamIdsFromTeams = (myTeams || [])
          .filter(
            (t) =>
              (t.role && t.role.toLowerCase() === "captain") || t.is_captain
          )
          .map((t) => Number(t.team_id));

        const capTeamIdsFromRegs = (myRegs || [])
          .filter((r) => r.team_id)
          .map((r) => Number(r.team_id));

        setMyCaptainTeamIds(
          Array.from(new Set([...capTeamIdsFromTeams, ...capTeamIdsFromRegs]))
        );
        setMyCaptainRegIds(
          (myRegs || [])
            .filter((r) => r.registration_id)
            .map((r) => Number(r.registration_id))
        );
      } catch {
        setUser(null);
      }
    } catch (err) {
      console.error("Failed to load tournament:", err);
      if (err.isUnauthenticated) {
        navigate("/login");
        return;
      }
      setErrorMsg(err.message || "Tournament not found.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, navigate]);

  const handleRegisterSuccess = () => {
    showToast("Registration submitted successfully!");
    fetchDetails();
  };

  const isOwner =
    user &&
    tournament &&
    Number(user.user_id) === Number(tournament.organizer_id);
  const isOrganizer = user?.role === "organizer";

  const groupStage = stages.find((s) => s.stage_format === "group_stage");
  const playoffStage =
    stages.find(
      (s) =>
        s.stage_format === "single_elimination" ||
        s.stage_format === "double_elimination"
    ) ||
    (groupStage?.group_generation_status === "bracket_generated"
      ? groupStage
      : null);

  const regStatus =
    tournament?.registration_status ||
    (tournament?.status === "published" ? "OPEN" : "CLOSED");
  const canShowRegisterButton =
    user && tournament && regStatus === "OPEN" && !myRegistration;

  const formatDate = (dateStr) => {
    if (!dateStr) return null;
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return null;
      return d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return null;
    }
  };

  // Lifecycle stage indicators (derived from backend stage and tournament states)
  const isGroupsGenerated =
    groupStage &&
    ["groups_assigned", "matches_generated", "qualified", "bracket_generated"].includes(
      groupStage.group_generation_status
    );
  const isQualified =
    groupStage &&
    ["qualified", "bracket_generated"].includes(
      groupStage.group_generation_status
    );
  const isBracketGenerated = Boolean(
    playoffStage &&
      (playoffStage.group_generation_status === "bracket_generated" ||
        (hubData.matches || []).some((m) => m.bracket_type !== "group"))
  );
  const isCompleted = tournament?.status === "completed";
  const isRegDone =
    regStatus === "CLOSED" ||
    regStatus === "FROZEN" ||
    tournament?.status === "live" ||
    isCompleted ||
    isBracketGenerated ||
    isGroupsGenerated;

  const participants = hubData.participants || [];
  const approvedTeams = participants.filter((p) => p.status === "approved");
  const pendingTeams = participants.filter((p) => p.status === "pending");
  const allMatches = hubData.matches || [];
  const standings = hubData.standings || [];

  const grandFinalMatch = allMatches.find(
    (m) => m.bracket_type === "grand_final"
  );
  const isGrandFinalActive =
    grandFinalMatch &&
    (grandFinalMatch.participants || []).length === 2 &&
    !isCompleted;

  // Filtered matches for Matches tab
  const availableBracketTypes = Array.from(
    new Set(allMatches.map((m) => m.bracket_type).filter(Boolean))
  );

  const filteredMatches = allMatches.filter((m) => {
    const isMatchDone =
      m.status === "completed" || m.result_status === "VERIFIED";
    const isMatchPending =
      m.result_status === "SUBMITTED" || m.status === "pending_verification";

    if (matchStatusFilter === "upcoming" && (isMatchDone || isMatchPending)) {
      return false;
    }
    if (matchStatusFilter === "pending" && !isMatchPending) {
      return false;
    }
    if (matchStatusFilter === "completed" && !isMatchDone) {
      return false;
    }
    if (
      matchBracketFilter !== "all" &&
      m.bracket_type !== matchBracketFilter
    ) {
      return false;
    }
    return true;
  });

  // Group filtered matches by section (Bracket Type + Round)
  const groupedMatchesSections = [];
  const sectionMap = new Map();
  filteredMatches.forEach((m) => {
    const bLabel =
      m.bracket_type === "group"
        ? m.group_name || "Group Stage"
        : BRACKET_TYPE_LABELS[m.bracket_type] || m.stage_name || "Bracket";
    const rLabel =
      m.bracket_type === "grand_final"
        ? "Championship Match"
        : `Round ${m.round_number || 1}`;
    const key = `${m.stage_order || 1}_${m.bracket_type}_${m.group_id || 0}_${m.round_number || 1}`;
    if (!sectionMap.has(key)) {
      const sec = {
        key,
        title: `${bLabel} — ${rLabel}`,
        bracketType: m.bracket_type,
        bestOf: m.best_of || "BO1",
        matches: [],
      };
      sectionMap.set(key, sec);
      groupedMatchesSections.push(sec);
    }
    sectionMap.get(key).matches.push(m);
  });

  // Captain ready-to-submit matches across the tournament
  const captainReadyMatches = allMatches.filter((m) => {
    const isDone = m.status === "completed" || m.result_status === "VERIFIED";
    const isPending =
      m.result_status === "SUBMITTED" || m.status === "pending_verification";
    const hasTwoTeams = (m.participants || []).length === 2;
    const isMyMatch = (m.participants || []).some(
      (p) =>
        (p.team_id && myCaptainTeamIds.includes(Number(p.team_id))) ||
        (p.registration_id &&
          myCaptainRegIds.includes(Number(p.registration_id)))
    );
    return !isDone && !isPending && hasTwoTeams && isMyMatch;
  });

  const prizePoolNum =
    tournament?.prize_pool_usd !== null &&
    tournament?.prize_pool_usd !== undefined
      ? Number(tournament.prize_pool_usd)
      : null;

  const prizeFirstNum =
    tournament?.prize_first_usd !== null &&
    tournament?.prize_first_usd !== undefined
      ? Number(tournament.prize_first_usd)
      : null;

  const prizeSecondNum =
    tournament?.prize_second_usd !== null &&
    tournament?.prize_second_usd !== undefined
      ? Number(tournament.prize_second_usd)
      : null;

  const prizeThirdNum =
    tournament?.prize_third_usd !== null &&
    tournament?.prize_third_usd !== undefined
      ? Number(tournament.prize_third_usd)
      : null;

  const hasPrizeBreakdown =
    (prizeFirstNum !== null && prizeFirstNum > 0) ||
    (prizeSecondNum !== null && prizeSecondNum > 0) ||
    (prizeThirdNum !== null && prizeThirdNum > 0);

  return (
    <div className="min-h-screen bg-[var(--bg-obsidian)] text-white flex flex-col font-sans antialiased">
      <Navbar />

      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-950/90 px-5 py-3.5 text-sm text-emerald-300 shadow-2xl backdrop-blur-md">
          <span className="font-semibold">{toastMessage}</span>
        </div>
      )}

      <main className="mx-auto max-w-5xl w-full px-6 py-12 flex-1">
        {loading ? (
          <div className="h-64 rounded-2xl border border-zinc-800 bg-zinc-900/30 animate-pulse" />
        ) : errorMsg ? (
          <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 p-16 text-center">
            <h3 className="text-xl font-bold text-white">{errorMsg}</h3>
            <Link
              to="/tournaments"
              className="mt-6 inline-flex items-center gap-2 rounded-xl border border-zinc-700 px-6 py-3 font-semibold text-white transition hover:border-zinc-500"
            >
              &larr; Back to Tournaments
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Tournament Header Hero */}
            <div className="rounded-2xl border border-[var(--color-arena-border)] bg-[#090a0f] p-6 sm:p-8 shadow-2xl space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3 mb-2.5 flex-wrap">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-bold uppercase border shadow-sm ${STATUS_STYLES[tournament.status] || STATUS_STYLES.draft}`}
                    >
                      {isCompleted ? "🏆 COMPLETED" : tournament.status}
                    </span>
                    <span className="text-xs font-black tracking-widest text-red-400 uppercase font-display border border-red-500/20 bg-red-500/10 px-2.5 py-0.5 rounded">
                      {tournament.game_name}
                    </span>
                    {tournament.registration_status && (
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase border ${REG_TIMELINE_STYLES[tournament.registration_status] || "bg-zinc-800 text-zinc-400 border-zinc-700"}`}
                      >
                        REGISTRATION{" "}
                        {tournament.registration_status === "NOT_STARTED"
                          ? "NOT STARTED"
                          : tournament.registration_status}
                      </span>
                    )}
                  </div>

                  <h1 className="text-3xl md:text-5xl font-extrabold font-display tracking-wider text-white">
                    {tournament.name}
                  </h1>
                </div>

                {/* Organizer Management Shortcuts */}
                {isOwner && (
                  <div className="flex flex-wrap sm:flex-col gap-2 shrink-0">
                    <Link
                      to={`/tournaments/${id}/stages`}
                      className="rounded-xl bg-red-500 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-red-500/20 hover:bg-red-600 transition text-center"
                    >
                      ⚙ Manage Stages & Groups
                    </Link>
                    <Link
                      to={`/tournaments/${id}/registrations`}
                      className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-semibold text-zinc-300 hover:border-zinc-500 hover:text-white transition text-center"
                    >
                      👥 Review Registrations
                    </Link>
                  </div>
                )}
              </div>

              {/* Adaptive Tournament Lifecycle State Machine */}
              <div className="pt-4 border-t border-zinc-800/80">
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-3">
                  Tournament Lifecycle Progress
                </p>
                {groupStage ? (
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-xs">
                    <div
                      className={`p-2.5 rounded-xl border ${isRegDone ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : regStatus === "OPEN" ? "border-red-500/40 bg-red-500/15 text-white font-bold animate-pulse" : "border-zinc-800 bg-zinc-900/40 text-zinc-500"}`}
                    >
                      <div className="text-[10px] uppercase font-bold">
                        {isRegDone
                          ? "✓ Complete"
                          : regStatus === "OPEN"
                          ? "● Active"
                          : "○ Upcoming"}
                      </div>
                      <div className="text-xs font-semibold mt-0.5">
                        Registration
                      </div>
                    </div>

                    <div
                      className={`p-2.5 rounded-xl border ${isQualified ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : isGroupsGenerated ? "border-red-500/40 bg-red-500/15 text-white font-bold animate-pulse" : "border-zinc-800 bg-zinc-900/40 text-zinc-500"}`}
                    >
                      <div className="text-[10px] uppercase font-bold">
                        {isQualified
                          ? "✓ Complete"
                          : isGroupsGenerated
                          ? "● Active"
                          : "○ Upcoming"}
                      </div>
                      <div className="text-xs font-semibold mt-0.5">
                        Group Stage
                      </div>
                    </div>

                    <div
                      className={`p-2.5 rounded-xl border ${isQualified ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : isGroupsGenerated ? "border-amber-500/30 bg-amber-500/10 text-amber-400 font-semibold" : "border-zinc-800 bg-zinc-900/40 text-zinc-500"}`}
                    >
                      <div className="text-[10px] uppercase font-bold">
                        {isQualified
                          ? "✓ Complete"
                          : isGroupsGenerated
                          ? "● Pending"
                          : "○ Upcoming"}
                      </div>
                      <div className="text-xs font-semibold mt-0.5">
                        Qualification
                      </div>
                    </div>

                    <div
                      className={`p-2.5 rounded-xl border ${isCompleted ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : isBracketGenerated ? "border-red-500/40 bg-red-500/15 text-white font-bold animate-pulse" : "border-zinc-800 bg-zinc-900/40 text-zinc-500"}`}
                    >
                      <div className="text-[10px] uppercase font-bold">
                        {isCompleted
                          ? "✓ Complete"
                          : isBracketGenerated
                          ? "● Active"
                          : "○ Upcoming"}
                      </div>
                      <div className="text-xs font-semibold mt-0.5">
                        Playoffs
                      </div>
                    </div>

                    <div
                      className={`col-span-2 sm:col-span-1 p-2.5 rounded-xl border ${isCompleted ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-400 font-bold" : isGrandFinalActive ? "border-amber-500/40 bg-amber-500/15 text-amber-300 font-bold animate-pulse" : "border-zinc-800 bg-zinc-900/40 text-zinc-500"}`}
                    >
                      <div className="text-[10px] uppercase font-bold">
                        {isCompleted
                          ? "🏆 Winner Crowned"
                          : isGrandFinalActive
                          ? "● Live Final"
                          : "○ Upcoming"}
                      </div>
                      <div className="text-xs font-semibold mt-0.5">
                        Grand Final
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                    <div
                      className={`p-2.5 rounded-xl border ${isRegDone ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : regStatus === "OPEN" ? "border-red-500/40 bg-red-500/15 text-white font-bold animate-pulse" : "border-zinc-800 bg-zinc-900/40 text-zinc-500"}`}
                    >
                      <div className="text-[10px] uppercase font-bold">
                        {isRegDone
                          ? "✓ Complete"
                          : regStatus === "OPEN"
                          ? "● Active"
                          : "○ Upcoming"}
                      </div>
                      <div className="text-xs font-semibold mt-0.5">
                        Registration ({approvedTeams.length} Teams)
                      </div>
                    </div>

                    <div
                      className={`p-2.5 rounded-xl border ${isBracketGenerated ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : approvedTeams.length >= 2 ? "border-amber-500/30 bg-amber-500/10 text-amber-400" : "border-zinc-800 bg-zinc-900/40 text-zinc-500"}`}
                    >
                      <div className="text-[10px] uppercase font-bold">
                        {isBracketGenerated
                          ? "✓ Complete"
                          : approvedTeams.length >= 2
                          ? "● Ready"
                          : "○ Pending"}
                      </div>
                      <div className="text-xs font-semibold mt-0.5">
                        Team Seeding & Draw
                      </div>
                    </div>

                    <div
                      className={`p-2.5 rounded-xl border ${isCompleted ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : isBracketGenerated ? "border-red-500/40 bg-red-500/15 text-white font-bold animate-pulse" : "border-zinc-800 bg-zinc-900/40 text-zinc-500"}`}
                    >
                      <div className="text-[10px] uppercase font-bold">
                        {isCompleted
                          ? "✓ Complete"
                          : isBracketGenerated
                          ? "● Active"
                          : "○ Upcoming"}
                      </div>
                      <div className="text-xs font-semibold mt-0.5">
                        Playoffs Bracket
                      </div>
                    </div>

                    <div
                      className={`p-2.5 rounded-xl border ${isCompleted ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-400 font-bold" : isGrandFinalActive ? "border-amber-500/40 bg-amber-500/15 text-amber-300 font-bold animate-pulse" : "border-zinc-800 bg-zinc-900/40 text-zinc-500"}`}
                    >
                      <div className="text-[10px] uppercase font-bold">
                        {isCompleted
                          ? "🏆 Winner Crowned"
                          : isGrandFinalActive
                          ? "● Active"
                          : "○ Upcoming"}
                      </div>
                      <div className="text-xs font-semibold mt-0.5">
                        Grand Final
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Quick Specs Grid */}
              <div className="grid gap-3 sm:grid-cols-4 pt-2">
                <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/80 p-3.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 font-display">
                    Format
                  </p>
                  <p className="mt-1 text-xs font-bold text-white capitalize">
                    {tournament.format?.replace("_", " ")}
                  </p>
                </div>
                <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/80 p-3.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 font-display">
                    Organizer
                  </p>
                  <p className="mt-1 text-xs font-bold text-white truncate">
                    @{tournament.organizer_username || "ArenaX Staff"}
                  </p>
                </div>
                <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/80 p-3.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 font-display">
                    Total Prize Pool
                  </p>
                  <p className="mt-1 text-xs font-extrabold text-emerald-400 font-display tracking-wider">
                    {formatPrizePool(tournament.prize_pool_usd)}
                  </p>
                  {hasPrizeBreakdown && (
                    <p className="mt-1 text-[10px] font-semibold text-zinc-400 leading-relaxed">
                      {prizeFirstNum ? `🥇 $${prizeFirstNum.toLocaleString()}` : ""}
                      {prizeSecondNum ? ` • 🥈 $${prizeSecondNum.toLocaleString()}` : ""}
                      {prizeThirdNum ? ` • 🥉 $${prizeThirdNum.toLocaleString()}` : ""}
                    </p>
                  )}
                </div>
                <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/80 p-3.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 font-display">
                    Registration Window
                  </p>
                  <p className="mt-1 text-xs font-bold text-zinc-300 truncate">
                    {tournament.registration_end_at
                      ? `Closes ${formatDate(tournament.registration_end_at)}`
                      : "Ongoing"}
                  </p>
                </div>
              </div>

              {/* Navigation Hub Tabs with Counters */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-2 border-t border-zinc-800/80 scrollbar-none">
                <button
                  type="button"
                  onClick={() => setActiveTab("overview")}
                  className={`rounded-xl px-4 py-2 text-xs font-bold transition shrink-0 ${activeTab === "overview" ? "bg-red-500 text-white shadow-md shadow-red-500/20" : "bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800"}`}
                >
                  Overview
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("groups")}
                  className={`rounded-xl px-4 py-2 text-xs font-bold transition shrink-0 flex items-center gap-1.5 ${activeTab === "groups" ? "bg-red-500 text-white shadow-md shadow-red-500/20" : "bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800"}`}
                >
                  <span>{groupStage ? "Groups & Teams" : "Teams & Lineups"}</span>
                  <span className="rounded-full bg-black/30 px-1.5 py-0.2 text-[10px] font-extrabold">
                    {participants.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("standings")}
                  className={`rounded-xl px-4 py-2 text-xs font-bold transition shrink-0 flex items-center gap-1.5 ${activeTab === "standings" ? "bg-red-500 text-white shadow-md shadow-red-500/20" : "bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800"}`}
                >
                  <span>Standings</span>
                  <span className="rounded-full bg-black/30 px-1.5 py-0.2 text-[10px] font-extrabold">
                    {standings.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("matches")}
                  className={`rounded-xl px-4 py-2 text-xs font-bold transition shrink-0 flex items-center gap-1.5 ${activeTab === "matches" ? "bg-red-500 text-white shadow-md shadow-red-500/20" : "bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800"}`}
                >
                  <span>Matches</span>
                  <span className="rounded-full bg-black/30 px-1.5 py-0.2 text-[10px] font-extrabold">
                    {allMatches.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("bracket")}
                  className={`rounded-xl px-4 py-2 text-xs font-bold transition shrink-0 ${activeTab === "bracket" ? "bg-amber-500 text-zinc-950 shadow-md shadow-amber-500/20" : "bg-zinc-900 text-amber-400 hover:text-amber-300 hover:bg-zinc-800"}`}
                >
                  Playoff Bracket
                </button>
              </div>
            </div>

            {/* TAB 1: OVERVIEW */}
            {activeTab === "overview" && (
              <div className="space-y-6">
                {/* Registration Action Section */}
                <div className="rounded-2xl border border-zinc-800 bg-[#090a0f] p-6 shadow-xl space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-bold text-white">
                      Team Registration
                    </h3>
                    <span className="text-xs font-semibold text-zinc-400">
                      {approvedTeams.length} Approved
                      {pendingTeams.length > 0
                        ? ` • ${pendingTeams.length} Pending`
                        : ""}
                    </span>
                  </div>

                  {/* Registration Timeline Details */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-4">
                      <span className="text-zinc-500">Registration Opens:</span>
                      <p className="mt-1 font-semibold text-white">
                        {formatDate(tournament.registration_start_at) ||
                          "Not restricted (Immediate)"}
                      </p>
                    </div>

                    <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-4">
                      <span className="text-zinc-500">
                        Registration Deadline:
                      </span>
                      <p className="mt-1 font-semibold text-white">
                        {formatDate(tournament.registration_end_at) ||
                          "Not restricted"}
                      </p>
                    </div>
                  </div>

                  {user ? (
                    <div>
                      {myRegistration ? (
                        <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/80 p-5 flex items-center justify-between">
                          <div>
                            <p className="text-xs text-zinc-500">
                              Your Registered Team
                            </p>
                            <p className="mt-1 text-sm font-bold text-white">
                              {myRegistration.team_name}
                            </p>
                          </div>
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-semibold uppercase border ${REG_STATUS_STYLES[myRegistration.status] || "text-zinc-400"}`}
                          >
                            {myRegistration.status}
                          </span>
                        </div>
                      ) : canShowRegisterButton ? (
                        <button
                          onClick={() => setIsRegisterModalOpen(true)}
                          className="w-full rounded-xl bg-red-500 py-3.5 font-bold text-white shadow-xl shadow-red-500/20 transition hover:bg-red-600"
                        >
                          Register My Team
                        </button>
                      ) : (
                        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 p-4 text-center text-xs text-zinc-500">
                          {regStatus === "NOT_STARTED"
                            ? "Registration has not opened yet. Check back at the opening date."
                            : regStatus === "FROZEN"
                            ? "Registration is frozen because group matches or stages have already started."
                            : "Registration is currently closed for this tournament."}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 p-6 text-center text-xs text-zinc-400">
                      <span>Please </span>
                      <Link
                        to="/login"
                        className="font-bold text-red-500 underline hover:text-red-400"
                      >
                        log in
                      </Link>
                      <span> as a team captain to register your team.</span>
                    </div>
                  )}
                </div>

                {/* Stages List */}
                <div className="rounded-2xl border border-zinc-800 bg-[#090a0f] p-6 shadow-xl space-y-4">
                  <h3 className="text-base font-bold text-white">
                    Tournament Stages
                  </h3>
                  {stages.length === 0 ? (
                    <p className="text-xs text-zinc-500 italic">
                      No stages configured yet.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {stages.map((stage) => (
                        <div
                          key={stage.stage_id}
                          className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-4 flex items-center justify-between"
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/10 border border-red-500/20 text-xs font-extrabold text-red-400">
                              {stage.stage_order}
                            </div>
                            <div>
                              <p className="text-sm font-bold text-white">
                                {stage.stage_name}
                              </p>
                              <p className="text-xs text-zinc-500">
                                {FORMAT_LABELS[stage.stage_format] ||
                                  stage.stage_format}
                              </p>
                            </div>
                          </div>
                          <span className="rounded-full bg-zinc-800 px-3 py-1 text-[11px] font-semibold text-zinc-400 uppercase">
                            {stage.group_generation_status?.replace("_", " ") ||
                              "Scheduled"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 2: GROUPS & TEAMS (PARTICIPANTS & OFFICIAL LINEUPS) */}
            {activeTab === "groups" && (
              <div className="space-y-8">
                {/* Summary Stats Bar */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-2xl border border-zinc-800 bg-[#090a0f] p-4">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                      Approved Teams
                    </p>
                    <p className="mt-1 text-2xl font-black text-emerald-400">
                      {approvedTeams.length}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-zinc-800 bg-[#090a0f] p-4">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                      Pending Review
                    </p>
                    <p className="mt-1 text-2xl font-black text-amber-400">
                      {pendingTeams.length}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-zinc-800 bg-[#090a0f] p-4">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                      Active Players
                    </p>
                    <p className="mt-1 text-2xl font-black text-white">
                      {participants.reduce(
                        (sum, p) => sum + (p.roster ? p.roster.length : 0),
                        0
                      )}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-zinc-800 bg-[#090a0f] p-4">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                      Competition Mode
                    </p>
                    <p className="mt-1 text-sm font-extrabold text-red-400 capitalize pt-1">
                      {tournament.format?.replace("_", " ")}
                    </p>
                  </div>
                </div>

                {/* Group Pools View (if tournament has an active group stage) */}
                {groupStage &&
                  groupStage.group_generation_status !== "not_generated" && (
                    <PublicGroupStageView
                      stageId={groupStage.stage_id}
                      tournamentId={id}
                      initialTab="groups"
                      onToast={showToast}
                    />
                  )}

                {/* Participating Teams & Lineups Directory */}
                <div className="rounded-2xl border border-zinc-800 bg-[#090a0f] p-6 shadow-xl space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-4">
                    <div>
                      <h3 className="text-lg font-black text-white">
                        Participating Teams & Official Lineups
                      </h3>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        Seeded teams, registration status, and verified 5-player
                        in-game rosters for {tournament.name}.
                      </p>
                    </div>
                    <input
                      type="text"
                      value={teamSearch}
                      onChange={(e) => setTeamSearch(e.target.value)}
                      placeholder="Search team or player IGN..."
                      className="rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-xs text-white placeholder-zinc-500 focus:border-red-500 focus:outline-none w-full sm:w-64"
                    />
                  </div>

                  {participants.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 p-12 text-center">
                      <h4 className="text-sm font-bold text-white">
                        No Teams Registered Yet
                      </h4>
                      <p className="mt-1 text-xs text-zinc-400">
                        Teams that register for this tournament will appear here
                        with their official rosters.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {participants
                        .filter((team) => {
                          if (!teamSearch.trim()) return true;
                          const q = teamSearch.toLowerCase();
                          const matchTeam =
                            team.team_name?.toLowerCase().includes(q) ||
                            team.team_tag?.toLowerCase().includes(q);
                          const matchPlayer = (team.roster || []).some(
                            (m) =>
                              m.game_username?.toLowerCase().includes(q) ||
                              m.username?.toLowerCase().includes(q)
                          );
                          return matchTeam || matchPlayer;
                        })
                        .map((team) => {
                          const isExpanded = Boolean(
                            expandedTeamRosters[team.registration_id]
                          );
                          const roster = team.roster || [];
                          const captain = roster.find(
                            (m) => m.role === "captain"
                          );
                          const standingRow = standings.find(
                            (s) =>
                              Number(s.registration_id) ===
                              Number(team.registration_id)
                          );
                          const statusBadge =
                            standingRow &&
                            BRACKET_STATUS_BADGES[standingRow.bracket_status];

                          return (
                            <div
                              key={team.registration_id}
                              className="rounded-2xl border border-zinc-800/90 bg-zinc-950/70 p-5 flex flex-col justify-between hover:border-zinc-700 transition shadow-lg"
                            >
                              <div>
                                {/* Card Top Header */}
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/10 border border-red-500/25 text-xs font-black text-red-400">
                                      {team.seed_number
                                        ? `#${team.seed_number}`
                                        : "—"}
                                    </div>
                                    <div>
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <Link
                                          to={`/teams/${team.team_id}`}
                                          className="text-base font-extrabold text-white hover:text-red-400 transition"
                                        >
                                          {team.team_name}
                                        </Link>
                                        {team.team_tag && (
                                          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-mono font-bold text-zinc-300 border border-zinc-700">
                                            [{team.team_tag}]
                                          </span>
                                        )}
                                      </div>
                                      <p className="text-[11px] text-zinc-400 mt-0.5">
                                        Captain:{" "}
                                        <span className="text-zinc-200 font-semibold">
                                          {captain
                                            ? `${captain.game_username} (@${captain.username})`
                                            : "Assigned"}
                                        </span>
                                      </p>
                                    </div>
                                  </div>

                                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                                    <span
                                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase border ${REG_STATUS_STYLES[team.status] || "bg-zinc-800 text-zinc-400 border-zinc-700"}`}
                                    >
                                      {team.status}
                                    </span>
                                    {team.group_info?.group_name && (
                                      <span className="rounded bg-blue-500/10 px-2 py-0.5 text-[10px] font-bold text-blue-400 border border-blue-500/20">
                                        {team.group_info.group_name}
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {/* Quick Player Pills Preview */}
                                <div className="mt-4 flex flex-wrap gap-1.5">
                                  {roster.slice(0, 5).map((member) => (
                                    <span
                                      key={member.game_account_id}
                                      className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold border ${
                                        member.role === "captain"
                                          ? "bg-amber-500/10 text-amber-300 border-amber-500/25"
                                          : "bg-zinc-900 text-zinc-300 border-zinc-800"
                                      }`}
                                    >
                                      {member.role === "captain" && (
                                        <span>👑</span>
                                      )}
                                      <span>{member.game_username}</span>
                                      {member.assigned_role && (
                                        <span className="text-[9px] text-zinc-500 uppercase">
                                          • {member.assigned_role}
                                        </span>
                                      )}
                                    </span>
                                  ))}
                                </div>

                                {/* Expanded Full Roster Table */}
                                {isExpanded && (
                                  <div className="mt-4 pt-3 border-t border-zinc-800/80 space-y-2">
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                                      Verified Lineup ({roster.length} Players)
                                    </p>
                                    <div className="space-y-1.5">
                                      {roster.map((m) => (
                                        <div
                                          key={m.game_account_id}
                                          className="flex items-center justify-between rounded-xl bg-zinc-900/90 border border-zinc-800/80 px-3 py-2 text-xs"
                                        >
                                          <div className="flex items-center gap-2">
                                            <span
                                              className={`rounded px-1.5 py-0.5 text-[9px] font-extrabold uppercase ${
                                                m.role === "captain"
                                                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                                  : m.is_substitute
                                                  ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                                                  : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/25"
                                              }`}
                                            >
                                              {m.role === "captain"
                                                ? "CAPTAIN"
                                                : m.is_substitute
                                                ? "SUB"
                                                : "STARTER"}
                                            </span>
                                            <span className="font-bold text-white">
                                              {m.game_username}
                                            </span>
                                            <span className="text-zinc-500 text-[11px]">
                                              (@{m.username})
                                            </span>
                                          </div>
                                          <div className="flex items-center gap-2 text-[11px]">
                                            {m.assigned_role && (
                                              <span className="rounded bg-zinc-800 px-2 py-0.5 text-zinc-300 font-semibold">
                                                {m.assigned_role}
                                              </span>
                                            )}
                                            <span className="font-mono text-zinc-500">
                                              UID: {m.game_uid}
                                            </span>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* Card Footer */}
                              <div className="mt-4 pt-3 border-t border-zinc-800/70 flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2">
                                  {statusBadge ? (
                                    <span
                                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold border ${statusBadge.cls}`}
                                    >
                                      {statusBadge.label}
                                    </span>
                                  ) : (
                                    <span className="text-zinc-500 text-[11px]">
                                      {roster.length} Players
                                    </span>
                                  )}
                                  {standingRow && standingRow.played > 0 && (
                                    <span className="text-[11px] font-semibold text-zinc-400">
                                      {standingRow.wins}W - {standingRow.losses}L
                                    </span>
                                  )}
                                </div>

                                <button
                                  type="button"
                                  onClick={() =>
                                    toggleTeamRoster(team.registration_id)
                                  }
                                  className="text-xs font-bold text-red-400 hover:text-red-300 transition"
                                >
                                  {isExpanded
                                    ? "Hide Full Roster ▲"
                                    : `View Full Roster (${roster.length}) ▼`}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 3: STANDINGS (TOURNAMENT LEADERBOARD & PRIZE POOL DISTRIBUTION) */}
            {activeTab === "standings" && (
              <div className="space-y-6">
                {/* Switcher if tournament also has a Group Stage */}
                {groupStage &&
                  groupStage.group_generation_status !== "not_generated" && (
                    <div className="flex items-center justify-between rounded-2xl border border-zinc-800 bg-[#090a0f] p-4">
                      <div>
                        <h4 className="text-sm font-bold text-white">
                          Standings View Mode
                        </h4>
                        <p className="text-xs text-zinc-400">
                          Switch between Overall Tournament Placements and Group
                          Stage Tables.
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 bg-zinc-900 p-1 rounded-xl border border-zinc-800">
                        <button
                          type="button"
                          onClick={() => setStandingsViewMode("overall")}
                          className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition ${
                            standingsViewMode === "overall"
                              ? "bg-red-500 text-white"
                              : "text-zinc-400 hover:text-white"
                          }`}
                        >
                          Overall Leaderboard
                        </button>
                        <button
                          type="button"
                          onClick={() => setStandingsViewMode("groups")}
                          className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition ${
                            standingsViewMode === "groups"
                              ? "bg-red-500 text-white"
                              : "text-zinc-400 hover:text-white"
                          }`}
                        >
                          Group Stage Tables
                        </button>
                      </div>
                    </div>
                  )}

                {standingsViewMode === "groups" && groupStage ? (
                  <PublicGroupStageView
                    stageId={groupStage.stage_id}
                    tournamentId={id}
                    initialTab="standings"
                    onToast={showToast}
                  />
                ) : (
                  <>
                    {/* Prize Pool & Podium Distribution Cards */}
                    {((prizePoolNum && prizePoolNum > 0) || hasPrizeBreakdown) && (
                      <div className="rounded-2xl border border-zinc-800 bg-[#090a0f] p-6 shadow-xl space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div>
                            <h3 className="text-base font-black text-white">
                              🏆 Prize Pool & Podium Distribution
                            </h3>
                            <p className="text-xs text-zinc-400 mt-0.5">
                              Total Prize Pool:{" "}
                              <span className="text-emerald-400 font-bold">
                                {formatPrizePool(prizePoolNum)}
                              </span>
                              {hasPrizeBreakdown && (
                                <span className="ml-2 text-zinc-300">
                                  (🥇 1st:{" "}
                                  <span className="text-amber-300 font-bold">
                                    {prizeFirstNum
                                      ? `$${prizeFirstNum.toLocaleString()}`
                                      : "TBD"}
                                  </span>{" "}
                                  • 🥈 2nd:{" "}
                                  <span className="text-slate-200 font-bold">
                                    {prizeSecondNum
                                      ? `$${prizeSecondNum.toLocaleString()}`
                                      : "TBD"}
                                  </span>{" "}
                                  • 🥉 3rd:{" "}
                                  <span className="text-amber-500 font-bold">
                                    {prizeThirdNum
                                      ? `$${prizeThirdNum.toLocaleString()}`
                                      : "TBD"}
                                  </span>
                                  )
                                </span>
                              )}
                            </p>
                          </div>
                        </div>

                        {hasPrizeBreakdown ? (
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            {[
                              {
                                place: "🥇 1st Place (Champion)",
                                amount: prizeFirstNum,
                                team: standings.find((s) => s.placement === 1),
                                border: "border-amber-500/40 bg-amber-500/10",
                                text: "text-amber-300",
                              },
                              {
                                place: "🥈 2nd Place (Runner-Up)",
                                amount: prizeSecondNum,
                                team: standings.find((s) => s.placement === 2),
                                border: "border-slate-400/30 bg-slate-400/10",
                                text: "text-slate-200",
                              },
                              {
                                place: "🥉 3rd Place",
                                amount: prizeThirdNum,
                                team: standings.find(
                                  (s) =>
                                    s.placement === 3 ||
                                    s.bracket_status === "3RD_PLACE" ||
                                    s.bracket_status === "SEMIFINALIST"
                                ),
                                border: "border-amber-700/40 bg-amber-700/10",
                                text: "text-amber-400",
                              },
                            ].map((pod, idx) => (
                              <div
                                key={idx}
                                className={`rounded-xl border p-4 ${pod.border}`}
                              >
                                <div className="flex items-center justify-between text-xs font-bold">
                                  <span className={pod.text}>{pod.place}</span>
                                </div>
                                <p className="mt-1.5 text-lg font-extrabold text-emerald-400 font-display">
                                  {pod.amount !== null && pod.amount > 0
                                    ? `$${pod.amount.toLocaleString()} USD`
                                    : "Not specified"}
                                </p>
                                <p className="mt-1 text-xs font-bold text-white truncate">
                                  {pod.team ? (
                                    `${pod.team.team_name} [${pod.team.team_tag}]`
                                  ) : (
                                    <span className="text-zinc-500 italic">
                                      TBD (In Progress)
                                    </span>
                                  )}
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/50 p-4 text-xs text-zinc-400">
                            The organizer has set a Total Prize Pool of{" "}
                            <span className="font-bold text-emerald-400">
                              {formatPrizePool(prizePoolNum)}
                            </span>
                            . Individual 1st, 2nd, and 3rd place prize amounts
                            have not been specified yet.
                          </div>
                        )}
                      </div>
                    )}

                    {/* Overall Tournament Standings Table */}
                    <div className="rounded-2xl border border-zinc-800 bg-[#090a0f] overflow-hidden shadow-xl">
                      <div className="border-b border-zinc-800 px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <h3 className="text-lg font-black text-white">
                            Tournament Standings & Leaderboard
                          </h3>
                          <p className="text-xs text-zinc-400">
                            Live rankings calculated from verified match wins,
                            bracket progression, and kill differential.
                          </p>
                        </div>
                        <span className="text-xs font-semibold text-zinc-400">
                          {standings.length} Approved Teams
                        </span>
                      </div>

                      {standings.length === 0 ? (
                        <div className="p-12 text-center text-xs text-zinc-500">
                          No approved teams in this tournament yet. Once teams
                          are approved, live standings will appear here.
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs">
                            <thead>
                              <tr className="border-b border-zinc-800 bg-zinc-950/90 text-zinc-400 text-[11px] uppercase tracking-wider">
                                <th className="py-3.5 pl-6 font-bold">Rank</th>
                                <th className="py-3.5 font-bold">Team</th>
                                <th className="py-3.5 font-bold">
                                  Bracket Status
                                </th>
                                <th className="py-3.5 text-center font-bold">
                                  P
                                </th>
                                <th className="py-3.5 text-center font-bold">
                                  W
                                </th>
                                <th className="py-3.5 text-center font-bold">
                                  L
                                </th>
                                <th className="py-3.5 text-center font-bold">
                                  Win %
                                </th>
                                <th className="py-3.5 text-center font-bold">
                                  Kills
                                </th>
                                <th className="py-3.5 text-center font-bold">
                                  Deaths
                                </th>
                                <th className="py-3.5 text-center font-bold">
                                  +/-
                                </th>
                                {prizePoolNum > 0 && (
                                  <th className="py-3.5 pr-6 text-right font-bold">
                                    Prize Won
                                  </th>
                                )}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-800/60">
                              {standings.map((row) => {
                                const badge =
                                  BRACKET_STATUS_BADGES[row.bracket_status] ||
                                  BRACKET_STATUS_BADGES.ACTIVE;
                                return (
                                  <tr
                                    key={row.registration_id}
                                    className={`hover:bg-zinc-900/60 transition ${
                                      row.placement === 1
                                        ? "bg-amber-500/5"
                                        : row.placement === 2
                                        ? "bg-slate-400/5"
                                        : ""
                                    }`}
                                  >
                                    <td className="py-4 pl-6 font-black text-white">
                                      <span
                                        className={
                                          row.rank === 1
                                            ? "text-amber-400 text-sm"
                                            : row.rank === 2
                                            ? "text-slate-300 text-sm"
                                            : row.rank === 3
                                            ? "text-amber-600 text-sm"
                                            : "text-zinc-400"
                                        }
                                      >
                                        {row.placement_label || `#${row.rank}`}
                                      </span>
                                    </td>

                                    <td className="py-4 font-bold text-white">
                                      <div className="flex items-center gap-2">
                                        <Link
                                          to={`/teams/${row.team_id}`}
                                          className="hover:text-red-400 transition"
                                        >
                                          {row.team_name}
                                        </Link>
                                        {row.team_tag && (
                                          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-mono font-bold text-zinc-400">
                                            [{row.team_tag}]
                                          </span>
                                        )}
                                      </div>
                                    </td>

                                    <td className="py-4">
                                      <span
                                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold border ${badge.cls}`}
                                      >
                                        {badge.label}
                                      </span>
                                    </td>

                                    <td className="py-4 text-center font-semibold text-zinc-300">
                                      {row.played}
                                    </td>
                                    <td className="py-4 text-center font-bold text-emerald-400">
                                      {row.wins}
                                    </td>
                                    <td className="py-4 text-center font-bold text-red-400">
                                      {row.losses}
                                    </td>
                                    <td className="py-4 text-center font-semibold text-zinc-300">
                                      {row.win_rate}%
                                    </td>
                                    <td className="py-4 text-center font-bold text-white">
                                      {row.total_kills}
                                    </td>
                                    <td className="py-4 text-center font-semibold text-zinc-400">
                                      {row.total_conceded}
                                    </td>
                                    <td
                                      className={`py-4 text-center font-bold ${
                                        row.kill_difference > 0
                                          ? "text-emerald-400"
                                          : row.kill_difference < 0
                                          ? "text-red-400"
                                          : "text-zinc-400"
                                      }`}
                                    >
                                      {row.kill_difference > 0
                                        ? `+${row.kill_difference}`
                                        : row.kill_difference}
                                    </td>
                                    {prizePoolNum > 0 && (
                                      <td className="py-4 pr-6 text-right font-extrabold text-emerald-400">
                                        {row.prize_usd
                                          ? `$${row.prize_usd.toLocaleString()}`
                                          : "—"}
                                      </td>
                                    )}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* TAB 4: MATCHES (ALL TOURNAMENT MATCHES SCHEDULE & SCORECARDS) */}
            {activeTab === "matches" && (
              <div className="space-y-6">
                {/* Organizer Pending Results Review Console */}
                {isOrganizer && (
                  <PendingResultsReview
                    tournamentId={id}
                    onRefreshData={fetchDetails}
                    onToast={showToast}
                  />
                )}

                {/* Captain Action Banner if logged-in captain has an active match */}
                {captainReadyMatches.length > 0 && (
                  <div className="rounded-2xl border border-red-500/40 bg-gradient-to-r from-red-500/15 via-red-500/10 to-transparent p-4 sm:p-5 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="flex h-2.5 w-2.5 rounded-full bg-red-500 animate-ping" />
                        <h4 className="text-sm font-bold text-white">
                          Action Required: Submit Match Result
                        </h4>
                        <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-bold text-red-400 border border-red-500/30">
                          {captainReadyMatches.length} Active Match
                        </span>
                      </div>
                      <p className="text-xs text-zinc-300">
                        You are captain in Match #
                        {captainReadyMatches[0].match_id} (
                        {captainReadyMatches[0].participants?.[0]?.team_name ||
                          "Team A"}{" "}
                        vs{" "}
                        {captainReadyMatches[0].participants?.[1]?.team_name ||
                          "Team B"}
                        ). Submit the final kill score and screenshot evidence.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedMatchForSubmit(captainReadyMatches[0])
                      }
                      className="shrink-0 rounded-xl bg-red-500 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-red-500/20 hover:bg-red-600 transition"
                    >
                      Submit Result Now &rarr;
                    </button>
                  </div>
                )}

                {/* Match Filters Bar */}
                <div className="rounded-2xl border border-zinc-800 bg-[#090a0f] p-5 shadow-xl space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-black text-white">
                        Match Schedule & Scorecards
                      </h3>
                      <p className="text-xs text-zinc-400">
                        All matches across group stages, upper/lower brackets,
                        and the grand final.
                      </p>
                    </div>

                    {/* Status Filter Pills */}
                    <div className="flex flex-wrap items-center gap-1.5 bg-zinc-900 p-1.5 rounded-xl border border-zinc-800">
                      {[
                        { key: "all", label: `All (${allMatches.length})` },
                        { key: "upcoming", label: "Upcoming / Live" },
                        { key: "pending", label: "Pending Review" },
                        { key: "completed", label: "Completed" },
                      ].map((tab) => (
                        <button
                          key={tab.key}
                          type="button"
                          onClick={() => setMatchStatusFilter(tab.key)}
                          className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                            matchStatusFilter === tab.key
                              ? "bg-red-500 text-white"
                              : "text-zinc-400 hover:text-white"
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Bracket Type Filter Pills */}
                  {availableBracketTypes.length > 1 && (
                    <div className="flex items-center gap-2 overflow-x-auto pt-2 border-t border-zinc-800/80 scrollbar-none">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 shrink-0">
                        Bracket:
                      </span>
                      <button
                        type="button"
                        onClick={() => setMatchBracketFilter("all")}
                        className={`rounded-lg px-3 py-1 text-xs font-bold border transition ${
                          matchBracketFilter === "all"
                            ? "bg-zinc-800 text-white border-zinc-600"
                            : "bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-white"
                        }`}
                      >
                        All Brackets
                      </button>
                      {availableBracketTypes.map((bType) => (
                        <button
                          key={bType}
                          type="button"
                          onClick={() => setMatchBracketFilter(bType)}
                          className={`rounded-lg px-3 py-1 text-xs font-bold border transition shrink-0 ${
                            matchBracketFilter === bType
                              ? "bg-zinc-800 text-white border-zinc-600"
                              : "bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-white"
                          }`}
                        >
                          {BRACKET_TYPE_LABELS[bType] || bType}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Matches List Grouped by Stage / Bracket & Round */}
                {allMatches.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 p-16 text-center">
                    <h3 className="text-base font-bold text-white">
                      MATCHES NOT GENERATED YET
                    </h3>
                    <p className="mt-1 text-xs text-zinc-400">
                      Once the tournament organizer generates the bracket or
                      group matches, all matchups and live scores will appear
                      here.
                    </p>
                  </div>
                ) : groupedMatchesSections.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 p-12 text-center text-xs text-zinc-400">
                    No matches match your selected filter.
                  </div>
                ) : (
                  <div className="space-y-6">
                    {groupedMatchesSections.map((sec) => (
                      <div key={sec.key} className="space-y-3">
                        <div className="flex items-center justify-between px-1">
                          <h4 className="text-xs font-black tracking-widest text-zinc-300 uppercase flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-red-500" />
                            <span>{sec.title}</span>
                          </h4>
                          <span className="text-[11px] font-semibold text-zinc-500">
                            {sec.matches.length}{" "}
                            {sec.matches.length === 1 ? "Match" : "Matches"}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {sec.matches.map((m) => {
                            const sideA = (m.participants || []).find(
                              (p) => p.side === "A"
                            );
                            const sideB = (m.participants || []).find(
                              (p) => p.side === "B"
                            );
                            const isVerified =
                              m.status === "completed" ||
                              m.result_status === "VERIFIED";
                            const isPending =
                              m.result_status === "SUBMITTED" ||
                              m.status === "pending_verification";
                            const hasBothTeams = Boolean(sideA && sideB);
                            const isSideAWinner =
                              isVerified &&
                              m.winning_registration_id &&
                              Number(sideA?.registration_id) ===
                                Number(m.winning_registration_id);
                            const isSideBWinner =
                              isVerified &&
                              m.winning_registration_id &&
                              Number(sideB?.registration_id) ===
                                Number(m.winning_registration_id);
                            const hasKills =
                              m.team_a_kills != null && m.team_b_kills != null;
                            const isCaptainOfMatch = (
                              m.participants || []
                            ).some(
                              (p) =>
                                (p.team_id &&
                                  myCaptainTeamIds.includes(
                                    Number(p.team_id)
                                  )) ||
                                (p.registration_id &&
                                  myCaptainRegIds.includes(
                                    Number(p.registration_id)
                                  ))
                            );

                            return (
                              <div
                                key={m.match_id}
                                className="rounded-2xl border border-zinc-800 bg-[#090a0f] p-5 shadow-xl flex flex-col justify-between hover:border-zinc-700 transition"
                              >
                                {/* Match Card Header */}
                                <div>
                                  <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3 mb-3 text-xs">
                                    <div className="flex items-center gap-2">
                                      <span className="font-extrabold text-zinc-300">
                                        Match #{m.match_id}
                                      </span>
                                      <span className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] font-black text-zinc-300 border border-zinc-700">
                                        {m.best_of || "BO1"}
                                      </span>
                                      {isOwner && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setSelectedMatchForSchedule(m)
                                          }
                                          title="Configure Match Schedule & Lobby"
                                          className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] font-bold text-zinc-300 hover:bg-zinc-700 hover:text-white transition"
                                        >
                                          ⚙ Schedule
                                        </button>
                                      )}
                                    </div>

                                    <span
                                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase border ${
                                        isVerified
                                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                                          : isPending
                                          ? "bg-amber-500/10 text-amber-400 border-amber-500/30 animate-pulse"
                                          : "bg-zinc-800 text-zinc-400 border-zinc-700"
                                      }`}
                                    >
                                      {isVerified
                                        ? "COMPLETED"
                                        : isPending
                                        ? "PENDING VERIFICATION"
                                        : hasBothTeams
                                        ? "READY / SCHEDULED"
                                        : "WAITING FOR TEAMS"}
                                    </span>
                                  </div>

                                  {/* Schedule / Server / Lobby Info Bar */}
                                  {(m.scheduled_time ||
                                    m.server_region ||
                                    m.draft_mode ||
                                    m.lobby_code) && (
                                    <div className="mb-3 flex flex-wrap gap-1.5 text-[10px]">
                                      {m.scheduled_time && (
                                        <span className="rounded bg-zinc-900 px-2 py-0.5 text-zinc-300 border border-zinc-800">
                                          🕒 {formatDate(m.scheduled_time)}
                                        </span>
                                      )}
                                      {m.server_region && (
                                        <span className="rounded bg-zinc-900 px-2 py-0.5 text-zinc-300 border border-zinc-800">
                                          🌐 {m.server_region}
                                        </span>
                                      )}
                                      {m.draft_mode && (
                                        <span className="rounded bg-zinc-900 px-2 py-0.5 text-zinc-300 border border-zinc-800">
                                          ⚔ {m.draft_mode}
                                        </span>
                                      )}
                                      {m.lobby_code && (
                                        <span className="rounded bg-blue-500/10 px-2 py-0.5 text-blue-300 font-bold border border-blue-500/20">
                                          🔑 Lobby: {m.lobby_code}
                                        </span>
                                      )}
                                    </div>
                                  )}

                                  {/* Teams & Scoreboard */}
                                  <div className="space-y-2">
                                    <div
                                      className={`flex items-center justify-between rounded-xl px-3.5 py-2.5 border ${
                                        isSideAWinner
                                          ? "border-emerald-500/40 bg-emerald-500/10"
                                          : "border-zinc-800/80 bg-zinc-950/80"
                                      }`}
                                    >
                                      <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-black text-zinc-500 w-4">
                                          A
                                        </span>
                                        <span
                                          className={`text-sm font-bold ${
                                            sideA
                                              ? "text-white"
                                              : "text-zinc-600 italic"
                                          }`}
                                        >
                                          {sideA
                                            ? sideA.team_name
                                            : "TBD (Awaiting Advancement)"}
                                        </span>
                                        {sideA?.team_tag && (
                                          <span className="text-[10px] font-mono text-zinc-400">
                                            [{sideA.team_tag}]
                                          </span>
                                        )}
                                        {isSideAWinner && (
                                          <span className="text-xs">🏆</span>
                                        )}
                                      </div>
                                      <span
                                        className={`text-sm font-black ${
                                          isSideAWinner
                                            ? "text-emerald-400"
                                            : "text-zinc-300"
                                        }`}
                                      >
                                        {hasKills ? `${m.team_a_kills} Kills` : "—"}
                                      </span>
                                    </div>

                                    <div
                                      className={`flex items-center justify-between rounded-xl px-3.5 py-2.5 border ${
                                        isSideBWinner
                                          ? "border-emerald-500/40 bg-emerald-500/10"
                                          : "border-zinc-800/80 bg-zinc-950/80"
                                      }`}
                                    >
                                      <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-black text-zinc-500 w-4">
                                          B
                                        </span>
                                        <span
                                          className={`text-sm font-bold ${
                                            sideB
                                              ? "text-white"
                                              : "text-zinc-600 italic"
                                          }`}
                                        >
                                          {sideB
                                            ? sideB.team_name
                                            : "TBD (Awaiting Advancement)"}
                                        </span>
                                        {sideB?.team_tag && (
                                          <span className="text-[10px] font-mono text-zinc-400">
                                            [{sideB.team_tag}]
                                          </span>
                                        )}
                                        {isSideBWinner && (
                                          <span className="text-xs">🏆</span>
                                        )}
                                      </div>
                                      <span
                                        className={`text-sm font-black ${
                                          isSideBWinner
                                            ? "text-emerald-400"
                                            : "text-zinc-300"
                                        }`}
                                      >
                                        {hasKills ? `${m.team_b_kills} Kills` : "—"}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                {/* Match Card Footer Actions */}
                                <div className="mt-4 pt-3 border-t border-zinc-800/80 flex items-center justify-between text-xs">
                                  {isVerified ? (
                                    <span className="font-semibold text-emerald-400">
                                      ✓ Official Result Verified
                                    </span>
                                  ) : isPending ? (
                                    <span className="font-semibold text-amber-400">
                                      ⏳ Result Submitted — Under Organizer
                                      Review
                                    </span>
                                  ) : isCaptainOfMatch && hasBothTeams ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setSelectedMatchForSubmit(m)
                                      }
                                      className="w-full rounded-xl bg-red-500 py-2 text-xs font-bold text-white shadow-md shadow-red-500/20 hover:bg-red-600 transition"
                                    >
                                      Submit Match Result
                                    </button>
                                  ) : (
                                    <span className="text-zinc-500">
                                      {hasBothTeams
                                        ? "Awaiting match completion"
                                        : "Waiting for previous round winners"}
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 5: PLAYOFF BRACKET */}
            {activeTab === "bracket" && (
              <div>
                {playoffStage ? (
                  <PlayoffBracketView
                    stageId={playoffStage.stage_id}
                    tournamentId={id}
                    tournamentStatus={tournament?.status}
                    onToast={showToast}
                  />
                ) : (
                  <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 p-16 text-center">
                    <h3 className="text-base font-bold text-white">
                      PLAYOFF BRACKET NOT GENERATED YET
                    </h3>
                    <p className="mt-1 text-xs text-zinc-400">
                      The playoff bracket will appear here once teams are
                      approved and the bracket is generated.
                    </p>
                  </div>
                )}
              </div>
            )}

            <Link
              to="/tournaments"
              className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-zinc-400 hover:text-white transition"
            >
              &larr; Back to Tournaments
            </Link>
          </div>
        )}
      </main>

      <RegisterTeamModal
        isOpen={isRegisterModalOpen}
        onClose={() => setIsRegisterModalOpen(false)}
        onSuccess={handleRegisterSuccess}
        tournament={tournament}
      />

      {/* Submit Result Modal from Matches tab */}
      <SubmitResultModal
        isOpen={Boolean(selectedMatchForSubmit)}
        match={selectedMatchForSubmit}
        captainTeam={
          selectedMatchForSubmit
            ? (selectedMatchForSubmit.participants || []).find(
                (p) =>
                  (p.team_id && myCaptainTeamIds.includes(Number(p.team_id))) ||
                  (p.registration_id &&
                    myCaptainRegIds.includes(Number(p.registration_id)))
              )
            : null
        }
        onClose={() => setSelectedMatchForSubmit(null)}
        onSuccess={(msg) => {
          setSelectedMatchForSubmit(null);
          fetchDetails();
          showToast(msg || "Match result submitted!");
        }}
      />

      {/* Organizer Schedule Match Modal from Matches tab */}
      <ScheduleMatchModal
        isOpen={Boolean(selectedMatchForSchedule)}
        match={selectedMatchForSchedule}
        onClose={() => setSelectedMatchForSchedule(null)}
        onSuccess={(msg) => {
          setSelectedMatchForSchedule(null);
          fetchDetails();
          showToast(msg || "Match schedule updated!");
        }}
      />

      <Footer />
    </div>
  );
}

export default TournamentDetails;
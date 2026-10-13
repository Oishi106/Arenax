import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import CreateTournamentModal from "../components/CreateTournamentModal";
import { getMyTournaments, getGames, getMe, updateTournamentStatus } from "../api";

const STATUS_STYLES = {
  draft: "bg-zinc-700/30 text-zinc-400 border-zinc-600/30",
  published: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  live: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  completed: "bg-zinc-800 text-zinc-400 border-zinc-700",
};

const NEXT_STATUS = {
  draft: { next: "published", label: "Publish" },
  published: { next: "live", label: "Go Live" },
  live: { next: "completed", label: "Mark Completed" },
  completed: null,
};

function MyTournaments() {
  const [tournaments, setTournaments] = useState([]);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [checkingRole, setCheckingRole] = useState(true);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTournament, setEditingTournament] = useState(null);
  const [toastMessage, setToastMessage] = useState("");
  const [actionErrorId, setActionErrorId] = useState(null);
  const [actionErrorMsg, setActionErrorMsg] = useState("");

  const navigate = useNavigate();

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(""), 4000);
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [fetchedTournaments, fetchedGames] = await Promise.all([
        getMyTournaments(),
        getGames(),
      ]);
      setTournaments(fetchedTournaments);
      setGames(fetchedGames);
    } catch (error) {
      console.error("Failed to load your tournaments:", error);
      if (error.isUnauthenticated) {
        navigate("/login");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const checkAccess = async () => {
      try {
        const meData = await getMe();
        if (!meData.user || meData.user.role !== "organizer") {
          navigate("/tournaments");
          return;
        }
        setCheckingRole(false);
        loadData();
      } catch (error) {
        navigate("/login");
      }
    };
    checkAccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  const handleCreateSuccess = (newTournamentId) => {
    loadData();
    showToast("Tournament created successfully!");
  };

  const handleEditClick = (tournament) => {
    setEditingTournament(tournament);
    setIsModalOpen(true);
  };

  const handleCreateClick = () => {
    setEditingTournament(null);
    setIsModalOpen(true);
  };

  const handleStatusChange = async (tournament) => {
    const transition = NEXT_STATUS[tournament.status];
    if (!transition) return;

    setActionErrorId(null);
    setActionErrorMsg("");

    try {
      await updateTournamentStatus(tournament.tournament_id, transition.next);
      showToast(`Tournament moved to '${transition.next}'.`);
      loadData();
    } catch (err) {
      console.error(err);
      setActionErrorId(tournament.tournament_id);
      setActionErrorMsg(err.message || "Failed to update status.");
    }
  };

  if (checkingRole) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-zinc-700 border-t-red-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col">
      <Navbar />

      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-950/90 px-5 py-3.5 text-sm text-emerald-300 shadow-2xl backdrop-blur-md">
          <span className="font-semibold">{toastMessage}</span>
        </div>
      )}

      {/* Header */}
      <section className="border-b border-zinc-900 bg-gradient-to-b from-zinc-900/40 to-zinc-950 px-6 py-20 text-center">
        <p className="mb-4 text-xs font-bold tracking-[0.3em] text-red-500 uppercase">
          ORGANIZER DASHBOARD
        </p>
        <h1 className="text-4xl font-black md:text-6xl tracking-tight">
          MY <span className="text-red-500">TOURNAMENTS.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-zinc-400 text-sm md:text-base leading-relaxed">
          Create tournaments, manage their lifecycle, and publish them for teams to register.
        </p>

        <div className="mt-8 flex justify-center gap-3">
          <button
            onClick={handleCreateClick}
            className="inline-flex items-center gap-2 rounded-xl bg-red-500 px-6 py-3.5 font-bold text-white shadow-xl shadow-red-500/20 transition hover:bg-red-600 hover:scale-105"
          >
            + Create Tournament
          </button>
          <Link
            to="/tournaments"
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 px-6 py-3.5 font-bold text-white transition hover:border-zinc-500"
          >
            View Public Page
          </Link>
        </div>
      </section>

      {/* List */}
      <main className="mx-auto max-w-5xl w-full px-6 py-16 flex-1">
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 rounded-2xl border border-zinc-800 bg-zinc-900/30 animate-pulse" />
            ))}
          </div>
        ) : tournaments.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 p-16 text-center">
            <h3 className="text-xl font-bold text-white">You haven't created any tournaments yet.</h3>
            <button
              onClick={handleCreateClick}
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-red-500 px-6 py-3 font-semibold text-white transition hover:bg-red-600"
            >
              + Create Your First Tournament
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {tournaments.map((t) => {
              const transition = NEXT_STATUS[t.status];
              return (
                <div
                  key={t.tournament_id}
                  className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4"
                >
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold uppercase border ${STATUS_STYLES[t.status]}`}
                      >
                        {t.status}
                      </span>
                      <span className="text-xs text-zinc-500">{t.game_name}</span>
                    </div>
                    <h3 className="text-lg font-bold text-white">{t.name}</h3>
                    <p className="text-xs text-zinc-500 mt-1 capitalize">
                      Format: {t.format.replace("_", " ")}
                      {t.prize_pool_usd !== null && t.prize_pool_usd !== undefined && Number(t.prize_pool_usd) > 0 && (
                        <span className="ml-2 text-emerald-400 font-semibold">
                          • Total Prize: ${Number(t.prize_pool_usd).toLocaleString()} USD
                        </span>
                      )}
                      {(t.prize_first_usd || t.prize_second_usd || t.prize_third_usd) && (
                        <span className="ml-2 text-zinc-400 normal-case">
                          (
                          {t.prize_first_usd ? `🥇 $${Number(t.prize_first_usd).toLocaleString()}` : ""}
                          {t.prize_second_usd ? ` • 🥈 $${Number(t.prize_second_usd).toLocaleString()}` : ""}
                          {t.prize_third_usd ? ` • 🥉 $${Number(t.prize_third_usd).toLocaleString()}` : ""}
                          )
                        </span>
                      )}
                    </p>
                    {actionErrorId === t.tournament_id && (
                      <p className="text-xs text-red-400 mt-2">{actionErrorMsg}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Link
                      to={`/tournaments/${t.tournament_id}`}
                      className="rounded-lg border border-zinc-700 px-4 py-2 text-xs font-semibold text-zinc-300 transition hover:border-zinc-500 hover:text-white"
                    >
                      View
                    </Link>
                     <Link
                      to={`/my-tournaments/${t.tournament_id}/registrations`}
                      className="rounded-lg border border-zinc-700 px-4 py-2 text-xs font-semibold text-zinc-300 transition hover:border-zinc-500 hover:text-white"
                    >
                      Registrations
                    </Link>

                    <Link
                      to={`/my-tournaments/${t.tournament_id}/stages`}
                      className="rounded-lg border border-zinc-700 px-4 py-2 text-xs font-semibold text-zinc-300 transition hover:border-zinc-500 hover:text-white"
                    >
                      Stages
                    </Link>

                    {["draft", "published"].includes(t.status) && (
                      <button
                        onClick={() => handleEditClick(t)}
                        className="rounded-lg border border-zinc-700 px-4 py-2 text-xs font-semibold text-zinc-300 transition hover:border-zinc-500 hover:text-white"
                      >
                        Edit
                      </button>
                    )}

                    {transition && (
                      <button
                        onClick={() => handleStatusChange(t)}
                        className="rounded-lg bg-red-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-red-600"
                      >
                        {transition.label}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <CreateTournamentModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={handleCreateSuccess}
        games={games}
        editingTournament={editingTournament}
      />

      <Footer />
    </div>
  );
}

export default MyTournaments;
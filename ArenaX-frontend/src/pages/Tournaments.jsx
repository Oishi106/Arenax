import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import TournamentCard from "../components/TournamentCard";
import { getTournaments, getGames, getMe } from "../api";

function Tournaments() {
  const [tournaments, setTournaments] = useState([]);
  const [games, setGames] = useState([]);
  const [selectedGameId, setSelectedGameId] = useState(null);
  const [user, setUser] = useState(null);

  const [loading, setLoading] = useState(true);

  const navigate = useNavigate();

  const loadData = async (gameId) => {
    setLoading(true);
    try {
      const filters = gameId ? { game_id: gameId } : {};
      const [fetchedTournaments, fetchedGames] = await Promise.all([
        getTournaments(filters),
        getGames(),
      ]);
      setTournaments(fetchedTournaments);
      setGames(fetchedGames);
    } catch (error) {
      console.error("Failed to load tournaments:", error);
      if (error.isUnauthenticated) {
        navigate("/login");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const meData = await getMe();
        setUser(meData.user || null);
      } catch {
        setUser(null);
      }
    };
    fetchUser();
  }, []);

  useEffect(() => {
    loadData(selectedGameId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGameId, navigate]);

  const isOrganizer = user && user.role === "organizer";

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col">
      <Navbar />

      {/* Hero */}
      <section className="border-b border-zinc-900 bg-zinc-900/30 px-6 py-32 text-center">
        <p className="mb-5 text-xs font-bold tracking-[0.3em] text-red-500">
          ARENAX TOURNAMENTS
        </p>

        <h1 className="text-5xl font-black md:text-7xl">
          Find your next{" "}
          <span className="text-red-500">challenge.</span>
        </h1>

        <p className="mx-auto mt-7 max-w-2xl leading-7 text-zinc-500">
          Discover upcoming tournaments and compete against the best teams.
        </p>

        {isOrganizer && (
          <div className="mt-8">
            <Link
              to="/my-tournaments"
              className="inline-flex items-center gap-2 rounded-xl bg-red-500 px-6 py-3.5 font-bold text-white shadow-xl shadow-red-500/20 transition hover:bg-red-600 hover:scale-105"
            >
              Manage My Tournaments
            </Link>
          </div>
        )}
      </section>

      {/* Tournaments */}
      <main className="mx-auto max-w-7xl w-full px-6 py-24 flex-1">
        {/* Filters */}
        <div className="mb-10 flex flex-wrap gap-3">
          <button
            onClick={() => setSelectedGameId(null)}
            className={`rounded-lg px-5 py-2.5 text-sm font-semibold transition ${
              selectedGameId === null
                ? "bg-red-500 text-white"
                : "border border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-white"
            }`}
          >
            All Games
          </button>

          {games.map((g) => (
            <button
              key={g.game_id}
              onClick={() => setSelectedGameId(g.game_id)}
              className={`rounded-lg px-5 py-2.5 text-sm font-semibold transition ${
                String(selectedGameId) === String(g.game_id)
                  ? "bg-red-500 text-white"
                  : "border border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-white"
              }`}
            >
              {g.game_name}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-64 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-6 animate-pulse" />
            ))}
          </div>
        ) : tournaments.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 p-16 text-center">
            <h3 className="text-xl font-bold text-white">No tournaments announced yet.</h3>
            <p className="mt-2 text-sm text-zinc-400 max-w-md mx-auto leading-relaxed">
              Check back soon — organizers are working on new events.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {tournaments.map((t) => (
              <TournamentCard key={t.tournament_id} tournament={t} />
            ))}
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}

export default Tournaments;
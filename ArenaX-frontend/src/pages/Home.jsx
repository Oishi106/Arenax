import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import TournamentCard from "../components/TournamentCard";
import SectionTitle from "../components/SectionTitle";
import { getTournaments } from "../api";                                 

function Home() {
  const [featuredTournaments, setFeaturedTournaments] = useState([]);                 
  const [loadingTournaments, setLoadingTournaments] = useState(true);              

  useEffect(() => {
    getTournaments()
      .then((data) => {
        setFeaturedTournaments(data.slice(0, 3));
      })
      .catch((err) => {
        console.error("Failed to load featured tournaments:", err);
        setFeaturedTournaments([]);
      })
      .finally(() => setLoadingTournaments(false));
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-white">

      <Navbar />

      {/* ================= HERO ================= */}
      <section className="relative overflow-hidden border-b border-zinc-900 bg-gradient-to-b from-zinc-900/40 via-zinc-950 to-zinc-950 py-24 md:py-32">
        {/* Background glow effects */}
        <div className="absolute left-1/2 top-10 -z-0 h-[450px] w-[600px] -translate-x-1/2 rounded-full bg-red-500/10 blur-[140px] pointer-events-none" />
        <div className="absolute top-1/3 left-10 -z-0 h-72 w-72 rounded-full bg-emerald-500/5 blur-[120px] pointer-events-none" />

        <div className="relative mx-auto max-w-7xl px-6">
          <div className="grid gap-12 lg:grid-cols-12 items-center">
            {/* Hero Left Content */}
            <div className="lg:col-span-7">
              <div className="inline-flex items-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 px-4 py-1.5 text-xs font-bold tracking-widest text-red-400 uppercase shadow-lg shadow-red-500/10 mb-6">
                <span className="h-2 w-2 rounded-full bg-red-500 animate-ping" />
                THE ULTIMATE ESPORTS TOURNAMENT HUB
              </div>

              <h1 className="text-5xl font-black leading-[1.02] tracking-tight md:text-7xl lg:text-8xl text-white">
                Compete. <br />
                Conquer. <br />
                <span className="bg-gradient-to-r from-red-500 via-rose-500 to-amber-500 bg-clip-text text-transparent">
                  Become Legendary.
                </span>
              </h1>

              <p className="mt-8 max-w-xl text-base md:text-lg leading-relaxed text-zinc-400">
                Form competitive MOBA rosters, battle in organized bracket tournaments, track real-time match series, and climb the esports leaderboard.
              </p>

              <div className="mt-10 flex flex-wrap gap-4">
                <Link
                  to="/tournaments"
                  className="inline-flex items-center gap-2 rounded-xl bg-red-500 px-8 py-4 font-bold text-white shadow-xl shadow-red-500/25 transition hover:bg-red-600 hover:scale-105"
                >
                  Explore Tournaments
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </Link>

                <Link
                  to="/signup"
                  className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900/60 px-8 py-4 font-bold text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-800"
                >
                  Create Account
                </Link>
              </div>
            </div>

            {/* Hero Right Visuals - Stats Grid Cards */}
            <div className="lg:col-span-5 grid grid-cols-2 gap-4">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 backdrop-blur-md hover:border-red-500/40 transition">
                <div className="text-3xl md:text-4xl font-black text-red-500 mb-1">50+</div>
                <div className="text-xs font-bold uppercase tracking-wider text-zinc-400">Live & Draft Tournaments</div>
                <div className="mt-3 text-[11px] text-zinc-500">Single & Double Elimination Bracket format</div>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 backdrop-blur-md hover:border-emerald-500/40 transition">
                <div className="text-3xl md:text-4xl font-black text-emerald-400 mb-1">120+</div>
                <div className="text-xs font-bold uppercase tracking-wider text-zinc-400">Competitive Teams</div>
                <div className="mt-3 text-[11px] text-zinc-500">Forming & Active Competitive Rosters</div>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 backdrop-blur-md hover:border-amber-500/40 transition">
                <div className="text-3xl md:text-4xl font-black text-amber-400 mb-1">5 Positions</div>
                <div className="text-xs font-bold uppercase tracking-wider text-zinc-400">Role Slots System</div>
                <div className="mt-3 text-[11px] text-zinc-500">Marksman, Clashlaner, Jungler, Roam, Midlaner</div>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 backdrop-blur-md hover:border-purple-500/40 transition">
                <div className="text-3xl md:text-4xl font-black text-purple-400 mb-1">BO1 / BO3 / BO5</div>
                <div className="text-xs font-bold uppercase tracking-wider text-zinc-400">Series Results</div>
                <div className="mt-3 text-[11px] text-zinc-500">Transparent Match Series & Disputed Results</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================= GAMES ================= */}
      <section className="border-b border-zinc-900 bg-zinc-950 py-24">
        <div className="mx-auto max-w-7xl px-6">
          <SectionTitle
            label="CHOOSE YOUR BATTLEFIELD"
            title={
              <>
                Supported Competitive <span className="text-red-500">MOBA Titles</span>
              </>
            }
          />

          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
            {[
              {
                name: "Dota 2",
                short: "DOTA2",
                banner: "https://images.unsplash.com/photo-1542751371-adc38448a05e?q=80&w=800&auto=format&fit=crop",
                description: "Deep tactical MOBA strategy, 5v5 hero battles, and high-tier prize pool events.",
                tag: "PC MOBA",
              },
              {
                name: "League of Legends",
                short: "LOL",
                banner: "https://images.unsplash.com/photo-1511512578047-dfb367046420?q=80&w=800&auto=format&fit=crop",
                description: "Summoner's Rift competitive ecosystem with active bracket tournaments.",
                tag: "PC MOBA",
              },
              {
                name: "Mobile Legends: Bang Bang",
                short: "MLBB",
                banner: "https://images.unsplash.com/photo-1538481199705-c710c4e965fc?q=80&w=800&auto=format&fit=crop",
                description: "Fast-paced mobile esports action with instant team recruitment and role slots.",
                tag: "Mobile MOBA",
              },
              {
                name: "Honor of Kings",
                short: "HOK",
                banner: "https://images.unsplash.com/photo-1560253023-3ec5d502959f?q=80&w=800&auto=format&fit=crop",
                description: "Global mobile competitive MOBA with 5-player roster position matching.",
                tag: "Mobile MOBA",
              },
            ].map((game) => (
              <div
                key={game.name}
                className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50 transition duration-300 hover:-translate-y-2 hover:border-red-500/50 hover:shadow-2xl hover:shadow-red-500/10"
              >
                {/* Artwork Header */}
                <div className="relative h-48 w-full overflow-hidden bg-zinc-950">
                  <img
                    src={game.banner}
                    alt={game.name}
                    className="h-full w-full object-cover transition duration-500 group-hover:scale-110 opacity-70 group-hover:opacity-90"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-zinc-900/30 to-transparent" />
                  <span className="absolute top-3 right-3 rounded-md bg-zinc-950/80 backdrop-blur-md px-2.5 py-1 text-[10px] font-extrabold text-red-400 uppercase tracking-widest border border-red-500/20">
                    {game.tag}
                  </span>
                </div>

                {/* Content */}
                <div className="p-6 flex-1 flex flex-col justify-between">
                  <div>
                    <h3 className="text-xl font-black text-white group-hover:text-red-500 transition">
                      {game.name}
                    </h3>
                    <p className="mt-3 text-xs leading-relaxed text-zinc-400">
                      {game.description}
                    </p>
                  </div>

                  <Link
                    to="/tournaments"
                    className="mt-6 inline-flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/80 px-4 py-2.5 text-xs font-bold text-red-400 group-hover:border-red-500/40 group-hover:bg-red-500 group-hover:text-white transition duration-200"
                  >
                    <span>Browse Tournaments</span>
                    <span>→</span>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>


      {/* ================= TOURNAMENTS ================= */}

      <section className="py-24">

        <div className="mx-auto max-w-7xl px-6">

          <div className="mb-12 flex items-end justify-between">

            <div>

              <p className="mb-3 text-xs font-bold tracking-[0.3em] text-red-500">
                COMPETE NOW
              </p>

              <h2 className="text-4xl font-black md:text-5xl">
                Featured Tournaments
              </h2>

            </div>

            <Link
              to="/tournaments"
              className="hidden font-semibold text-red-500 sm:block"
            >
              View All →
            </Link>

          </div>

          {loadingTournaments ? (
            <div className="grid gap-6 lg:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-64 rounded-2xl border border-zinc-800 bg-zinc-900/30 animate-pulse" />
              ))}
            </div>
          ) : featuredTournaments.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 p-16 text-center">
              <h3 className="text-lg font-bold text-white">No tournaments announced yet.</h3>
              <p className="mt-2 text-sm text-zinc-400">Check back soon for upcoming events.</p>
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-3">
              {featuredTournaments.map((t) => (
                <TournamentCard key={t.tournament_id} tournament={t} />
              ))}
            </div>
          )}

        </div>

      </section>


      {/* ================= FEATURES ================= */}

      <section className="border-y border-zinc-900 bg-zinc-900/30 py-24">

        <div className="mx-auto max-w-7xl px-6">

          <SectionTitle
            label="WHY ARENAX?"
            title={
              <>
                Everything you need to{" "}
                <span className="text-red-500">
                  compete.
                </span>
              </>
            }
          />

          <div className="grid gap-6 md:grid-cols-3">

            {[
              {
                number: "01",
                title: "Competitive Tournaments",
                description:
                  "Discover organized tournaments and compete against teams from the community.",
              },
              {
                number: "02",
                title: "Build Your Team",
                description:
                  "Create your team, manage your roster and recruit players to strengthen your lineup.",
              },
              {
                number: "03",
                title: "Transparent Results",
                description:
                  "Follow tournament brackets, matches and confirmed results in one place.",
              },
            ].map((feature) => (

              <div
                key={feature.number}
                className="rounded-2xl border border-zinc-800 bg-zinc-950 p-8"
              >

                <span className="text-sm font-bold text-red-500">
                  {feature.number}
                </span>

                <h3 className="mt-8 text-xl font-bold">
                  {feature.title}
                </h3>

                <p className="mt-4 leading-7 text-zinc-500">
                  {feature.description}
                </p>

              </div>

            ))}

          </div>

        </div>

      </section>

      <Footer />

    </div>
  );
}

export default Home;
import React, { useState, useEffect } from "react";
import { generateBracket, resetBracket, getBracket } from "../api";
import PlayoffBracketView from "./PlayoffBracketView";

function BracketManager({ stageId, stageFormat, tournamentId, tournamentStatus, onToast }) {
  const [loading, setLoading] = useState(true);
  const [hasMatches, setHasMatches] = useState(false);
  const [matchCount, setMatchCount] = useState(0);
  const [seedingMode, setSeedingMode] = useState("sequential");
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [bracketRefreshKey, setBracketRefreshKey] = useState(0);

  const isLocked = ["live", "completed"].includes(tournamentStatus);

  const checkBracketStatus = async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const data = await getBracket(stageId);
      const b = data.bracket || {};
      const allMatches = [
        ...(b.playIn || []),
        ...(b.upperBracket || []),
        ...(b.lowerBracket || []),
        ...(b.grandFinal ? [b.grandFinal] : []),
      ];
      setHasMatches(allMatches.length > 0);
      setMatchCount(allMatches.length);
    } catch (err) {
      console.error("Failed to check bracket status:", err);
      // If error or 404, assume not generated yet
      setHasMatches(false);
      setMatchCount(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (stageId) {
      checkBracketStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageId]);

  const handleGenerate = async () => {
    setActionLoading(true);
    setErrorMsg("");
    try {
      await generateBracket(stageId, { seedingMode });
      onToast && onToast("Bracket generated successfully!");
      await checkBracketStatus();
      setBracketRefreshKey((k) => k + 1);
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || err.data?.error || "Failed to generate bracket.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleReset = async () => {
    if (
      !window.confirm(
        "Are you sure you want to reset the bracket? This will remove all unverified matches and bracket advancements."
      )
    ) {
      return;
    }

    setActionLoading(true);
    setErrorMsg("");
    try {
      await resetBracket(stageId);
      onToast && onToast("Bracket reset successfully!");
      await checkBracketStatus();
      setBracketRefreshKey((k) => k + 1);
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || err.data?.error || "Failed to reset bracket.");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-8 animate-pulse text-center text-xs text-zinc-500">
        Loading bracket configuration...
      </div>
    );
  }

  const formatTitle =
    stageFormat === "single_elimination" ? "Single Elimination" : "Double Elimination";

  return (
    <div className="space-y-6">
      {errorMsg && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-xs text-red-400 font-medium">
          {errorMsg}
        </div>
      )}

      {/* Control Panel */}
      {!hasMatches ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-xl space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400 animate-pulse" />
                <h4 className="text-base font-bold text-white">
                  Bracket Not Generated for {formatTitle}
                </h4>
              </div>
              <p className="text-xs text-zinc-400 mt-1">
                Generate matches and slot approved teams into the bracket. Teams can be sourced directly from approved tournament registrations or from a previous group stage.
              </p>
            </div>

            {/* Seeding Mode Toggle */}
            <div className="flex items-center gap-2 bg-zinc-950 p-1.5 rounded-xl border border-zinc-800 shrink-0">
              <button
                type="button"
                onClick={() => setSeedingMode("sequential")}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  seedingMode === "sequential"
                    ? "bg-red-500 text-white"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                Sequential Seeding
              </button>
              <button
                type="button"
                onClick={() => setSeedingMode("random")}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  seedingMode === "random"
                    ? "bg-red-500 text-white"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                Random Shuffle
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-zinc-800/80 pt-4">
            <span className="text-xs text-zinc-500">
              {stageFormat === "single_elimination"
                ? "Supports 2, 4, 8, 16, or 32 teams with automatic BYE rounds."
                : "Supports 4, 8, 16, or 24 teams with Upper, Lower, and Grand Final matches."}
            </span>

            <button
              type="button"
              onClick={handleGenerate}
              disabled={actionLoading || isLocked}
              className="inline-flex items-center gap-2 rounded-xl bg-red-500 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-red-500/20 hover:bg-red-600 transition disabled:opacity-50"
            >
              {actionLoading ? "Generating Bracket..." : `⚡ Generate ${formatTitle} Bracket`}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-900/40 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="text-xs font-bold text-zinc-300">
              {formatTitle} Bracket Active ({matchCount} Matches)
            </span>
          </div>

          {!isLocked && (
            <button
              type="button"
              onClick={handleReset}
              disabled={actionLoading}
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/20 transition disabled:opacity-50"
            >
              {actionLoading ? "Resetting..." : "↺ Reset Bracket"}
            </button>
          )}
        </div>
      )}

      {/* Bracket Tree View */}
      {hasMatches && (
        <PlayoffBracketView
          key={bracketRefreshKey}
          stageId={stageId}
          tournamentId={tournamentId}
          tournamentStatus={tournamentStatus}
          onToast={onToast}
        />
      )}
    </div>
  );
}

export default BracketManager;

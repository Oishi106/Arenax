import React, { useState, useEffect } from "react";
import { submitMatchResult } from "../api";

function SubmitResultModal({ isOpen, onClose, onSuccess, match, captainTeam }) {
  const [winnerRegId, setWinnerRegId] = useState("");
  const [teamAKills, setTeamAKills] = useState("0");
  const [teamBKills, setTeamBKills] = useState("0");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (isOpen) {
      setWinnerRegId("");
      setTeamAKills("0");
      setTeamBKills("0");
      setEvidenceUrl("");
      setErrorMsg("");
    }
  }, [isOpen, match?.match_id]);

  if (!isOpen || !match) return null;

  const participants = match.participants || [];
  const teamA = participants[0];
  const teamB = participants[1];

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg("");

    if (!winnerRegId) {
      setErrorMsg("Please select the winning team.");
      return;
    }
    if (!evidenceUrl.trim()) {
      setErrorMsg("Please provide a valid evidence URL (screenshot/video link).");
      return;
    }

    const killsA = Number(teamAKills);
    const killsB = Number(teamBKills);

    if (isNaN(killsA) || killsA < 0 || isNaN(killsB) || killsB < 0) {
      setErrorMsg("Kills must be non-negative numbers.");
      return;
    }

    setLoading(true);
    try {
      await submitMatchResult(match.match_id, {
        winning_registration_id: Number(winnerRegId),
        team_a_kills: killsA,
        team_b_kills: killsB,
        evidence_url: evidenceUrl.trim(),
      });

      onSuccess && onSuccess("Match result submitted for organizer verification!");
      onClose();
    } catch (err) {
      console.error("Submission error:", err);
      setErrorMsg(err.message || err.data?.error || "Failed to submit match result.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl space-y-5">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
          <div>
            <h3 className="text-lg font-bold text-white">Submit Match Scorecard</h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Match #{match.match_id} • Round {match.round_number || 1} • Post-Match Official Report
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Informational Guidance Banner */}
        <div className="rounded-xl border border-blue-500/25 bg-blue-500/5 p-3 text-xs text-zinc-300 space-y-1">
          <div className="flex items-center gap-1.5 font-bold text-blue-400">
            <span>📋</span>
            <span>Post-Game Scoreboard Report</span>
          </div>
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            In competitive matches, either participating captain reports the complete post-match scoreboard (both teams' scores &amp; victor). The tournament organizer audits the screenshot proof before confirming progression.
          </p>
        </div>

        {/* Captain Identity Verification Card */}
        {captainTeam && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span className="text-zinc-400">Reporting Captain:</span>
              <span className="font-bold text-white">
                {captainTeam.team_name} {captainTeam.team_tag ? `[${captainTeam.team_tag}]` : ""}
              </span>
            </div>
            <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/30 uppercase">
              Authorized Captain
            </span>
          </div>
        )}

        {errorMsg && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Winner Dropdown */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-zinc-300">
              Match Winner (Which team won the match?) <span className="text-red-500">*</span>
            </label>
            <select
              value={winnerRegId}
              onChange={(e) => setWinnerRegId(e.target.value)}
              required
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3.5 py-2.5 text-xs text-white outline-none focus:border-red-500"
            >
              <option value="">-- Select Winner --</option>
              {teamA && (
                <option value={teamA.registration_id}>
                  {teamA.team_name} {teamA.team_tag ? `[${teamA.team_tag}]` : ""} (Side A){" "}
                  {captainTeam?.registration_id === teamA.registration_id ? "— [Your Team]" : "— [Opponent]"}
                </option>
              )}
              {teamB && (
                <option value={teamB.registration_id}>
                  {teamB.team_name} {teamB.team_tag ? `[${teamB.team_tag}]` : ""} (Side B){" "}
                  {captainTeam?.registration_id === teamB.registration_id ? "— [Your Team]" : "— [Opponent]"}
                </option>
              )}
            </select>
          </div>

          {/* Kills Row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-zinc-300">
                {teamA?.team_name || "Team A"} Kills <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min="0"
                value={teamAKills}
                onChange={(e) => setTeamAKills(e.target.value)}
                required
                className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3.5 py-2.5 text-xs text-white outline-none focus:border-red-500"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-zinc-300">
                {teamB?.team_name || "Team B"} Kills <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min="0"
                value={teamBKills}
                onChange={(e) => setTeamBKills(e.target.value)}
                required
                className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3.5 py-2.5 text-xs text-white outline-none focus:border-red-500"
              />
            </div>
          </div>

          {/* Evidence URL */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-zinc-300">
              Evidence Link (Screenshot / Video URL) <span className="text-red-500">*</span>
            </label>
            <input
              type="url"
              placeholder="https://imgur.com/screenshot.png"
              value={evidenceUrl}
              onChange={(e) => setEvidenceUrl(e.target.value)}
              required
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3.5 py-2.5 text-xs text-white outline-none placeholder:text-zinc-600 focus:border-red-500"
            />
            <p className="mt-1 text-[11px] text-zinc-500">
              Provide an accessible URL showing the match scoreboard or victory screen.
            </p>
          </div>

          {/* Integrity Guard Note */}
          <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-2.5 text-[11px] text-zinc-400 flex items-start gap-2">
            <span className="text-xs">🔒</span>
            <span>
              <strong>Integrity Guard:</strong> Only the captain of participating teams can submit results. All scores and evidence links are audited and officially confirmed by the tournament organizer before bracket progression.
            </span>
          </div>

          {/* Actions */}
          <div className="mt-6 flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="rounded-xl border border-zinc-700 px-4 py-2 text-xs font-semibold text-zinc-300 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-xl bg-red-500 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-red-500/20 hover:bg-red-600 disabled:opacity-50"
            >
              {loading ? "Submitting..." : "Submit Result"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default SubmitResultModal;

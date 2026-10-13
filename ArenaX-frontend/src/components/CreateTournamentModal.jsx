import React, { useState, useEffect } from "react";
import { createTournament, updateTournament } from "../api";

function CreateTournamentModal({ isOpen, onClose, onSuccess, games = [], editingTournament = null }) {
  const [gameId, setGameId] = useState("");
  const [name, setName] = useState("");
  const [format, setFormat] = useState("single_elimination");
  const [prizePoolUsd, setPrizePoolUsd] = useState("");
  const [prizeFirstUsd, setPrizeFirstUsd] = useState("");
  const [prizeSecondUsd, setPrizeSecondUsd] = useState("");
  const [prizeThirdUsd, setPrizeThirdUsd] = useState("");
  const [regStartAt, setRegStartAt] = useState("");
  const [regEndAt, setRegEndAt] = useState("");

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const isEditMode = Boolean(editingTournament);

  const formatToInputDate = (dateVal) => {
    if (!dateVal) return "";
    try {
      const d = new Date(dateVal);
      if (isNaN(d.getTime())) return "";
      const pad = (n) => String(n).padStart(2, "0");
      const yyyy = d.getFullYear();
      const mm = pad(d.getMonth() + 1);
      const dd = pad(d.getDate());
      const hh = pad(d.getHours());
      const min = pad(d.getMinutes());
      return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
    } catch {
      return "";
    }
  };

  useEffect(() => {
    if (isEditMode) {
      setGameId(String(editingTournament.game_id));
      setName(editingTournament.name);
      setFormat(editingTournament.format);
      setPrizePoolUsd(
        editingTournament.prize_pool_usd !== null && editingTournament.prize_pool_usd !== undefined
          ? String(editingTournament.prize_pool_usd)
          : ""
      );
      setPrizeFirstUsd(
        editingTournament.prize_first_usd !== null && editingTournament.prize_first_usd !== undefined
          ? String(editingTournament.prize_first_usd)
          : ""
      );
      setPrizeSecondUsd(
        editingTournament.prize_second_usd !== null && editingTournament.prize_second_usd !== undefined
          ? String(editingTournament.prize_second_usd)
          : ""
      );
      setPrizeThirdUsd(
        editingTournament.prize_third_usd !== null && editingTournament.prize_third_usd !== undefined
          ? String(editingTournament.prize_third_usd)
          : ""
      );
      setRegStartAt(formatToInputDate(editingTournament.registration_start_at));
      setRegEndAt(formatToInputDate(editingTournament.registration_end_at));
    } else {
      if (games.length > 0) {
        setGameId(String(games[0].game_id));
      }
      setName("");
      setFormat("single_elimination");
      setPrizePoolUsd("");
      setPrizeFirstUsd("");
      setPrizeSecondUsd("");
      setPrizeThirdUsd("");
      setRegStartAt("");
      setRegEndAt("");
    }
    setErrorMessage("");
  }, [isOpen, games, editingTournament, isEditMode]);

  if (!isOpen) return null;

  const parseMoneyField = (rawStr, label) => {
    if (!rawStr || String(rawStr).trim() === "") {
      return { valid: true, value: null };
    }
    const strVal = String(rawStr).trim();
    const num = Number(strVal);
    if (isNaN(num)) {
      return { valid: false, error: `${label} must be a valid number.` };
    }
    if (num < 0) {
      return { valid: false, error: `${label} cannot be negative.` };
    }
    if (strVal.includes(".")) {
      const decimals = strVal.split(".")[1];
      if (decimals && decimals.length > 2) {
        return { valid: false, error: `${label} cannot have more than 2 decimal places.` };
      }
    }
    return { valid: true, value: num };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage("");

    if (!gameId) {
      setErrorMessage("Please select a game.");
      return;
    }
    if (!name.trim()) {
      setErrorMessage("Tournament name is required.");
      return;
    }

    if (regStartAt && regEndAt) {
      if (new Date(regEndAt) <= new Date(regStartAt)) {
        setErrorMessage("Registration deadline must be after registration start time.");
        return;
      }
    }

    const totalCheck = parseMoneyField(prizePoolUsd, "Total Prize Pool");
    if (!totalCheck.valid) {
      setErrorMessage(totalCheck.error);
      return;
    }
    const firstCheck = parseMoneyField(prizeFirstUsd, "1st Place Prize");
    if (!firstCheck.valid) {
      setErrorMessage(firstCheck.error);
      return;
    }
    const secondCheck = parseMoneyField(prizeSecondUsd, "2nd Place Prize");
    if (!secondCheck.valid) {
      setErrorMessage(secondCheck.error);
      return;
    }
    const thirdCheck = parseMoneyField(prizeThirdUsd, "3rd Place Prize");
    if (!thirdCheck.valid) {
      setErrorMessage(thirdCheck.error);
      return;
    }

    const p1 = firstCheck.value;
    const p2 = secondCheck.value;
    const p3 = thirdCheck.value;
    const hasBreakdown = p1 !== null || p2 !== null || p3 !== null;
    const sumBreakdown = (p1 || 0) + (p2 || 0) + (p3 || 0);

    let finalTotalPrize = totalCheck.value;
    if (finalTotalPrize === null && hasBreakdown) {
      finalTotalPrize = sumBreakdown;
    } else if (finalTotalPrize !== null && hasBreakdown && sumBreakdown > finalTotalPrize + 0.001) {
      setErrorMessage(
        `Sum of 1st, 2nd, and 3rd prizes ($${sumBreakdown.toLocaleString()}) cannot exceed Total Prize Pool ($${finalTotalPrize.toLocaleString()}).`
      );
      return;
    }

    setLoading(true);

    try {
      const payload = {
        game_id: parseInt(gameId, 10),
        name: name.trim(),
        format,
        prize_pool_usd: finalTotalPrize,
        prize_first_usd: p1,
        prize_second_usd: p2,
        prize_third_usd: p3,
        registration_start_at: regStartAt ? new Date(regStartAt).toISOString() : null,
        registration_end_at: regEndAt ? new Date(regEndAt).toISOString() : null,
      };

      if (isEditMode) {
        await updateTournament(editingTournament.tournament_id, payload);
        onSuccess();
      } else {
        const res = await createTournament(payload);
        onSuccess(res.tournamentId);
      }
      onClose();
    } catch (err) {
      console.error(err);
      if (err.isUnauthenticated) {
        window.location.href = "/login";
        return;
      }
      setErrorMessage(err.message || err.data?.error || "Failed to save tournament. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 p-6 md:p-8 shadow-2xl my-8">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800/80 pb-4 mb-6">
          <div>
            <h2 className="text-xl font-black text-white">
              {isEditMode ? "Edit Tournament" : "Create New Tournament"}
            </h2>
            <p className="text-xs text-zinc-400 mt-1">
              {isEditMode
                ? "Update tournament details, timeline, and 1st/2nd/3rd prize pool breakdown."
                : "Set up a new competitive event and prize distribution."}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-900 hover:text-white"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Error Banner */}
        {errorMessage && (
          <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-3.5 text-xs text-red-400 flex items-start gap-2.5">
            <svg className="w-4 h-4 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="font-semibold">{errorMessage}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Game Selection */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-zinc-300">
              Select Game <span className="text-red-500">*</span>
            </label>
            <select
              value={gameId}
              onChange={(e) => setGameId(e.target.value)}
              required
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-white outline-none focus:border-red-500"
            >
              {games.length === 0 ? (
                <option value="">No games available</option>
              ) : (
                games.map((g) => (
                  <option key={g.game_id} value={g.game_id}>
                    {g.game_name} ({g.short_code})
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Tournament Name */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-zinc-300">
              Tournament Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              placeholder="e.g. ArenaX Winter Championship"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-red-500"
            />
          </div>

          {/* Format */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-zinc-300">
              Format <span className="text-red-500">*</span>
            </label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              required
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-white outline-none focus:border-red-500"
            >
              <option value="single_elimination">Single Elimination</option>
              <option value="double_elimination">Double Elimination</option>
            </select>
          </div>

          {/* Total Prize Pool & 1st / 2nd / 3rd Prize Breakdown */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-zinc-300">
                Total Prize Pool ($ USD) <span className="text-zinc-500 font-normal">(Optional)</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g. 500000.00 (or auto-calculated from 1st/2nd/3rd below)"
                value={prizePoolUsd}
                onChange={(e) => setPrizePoolUsd(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-red-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <div>
                <label className="mb-1 block text-[11px] font-bold text-amber-400">
                  🥇 1st Prize ($ USD)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="e.g. 250000"
                  value={prizeFirstUsd}
                  onChange={(e) => setPrizeFirstUsd(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white outline-none placeholder:text-zinc-600 focus:border-amber-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-bold text-slate-300">
                  🥈 2nd Prize ($ USD)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="e.g. 150000"
                  value={prizeSecondUsd}
                  onChange={(e) => setPrizeSecondUsd(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white outline-none placeholder:text-zinc-600 focus:border-slate-400"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-bold text-amber-600">
                  🥉 3rd Prize ($ USD)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="e.g. 100000"
                  value={prizeThirdUsd}
                  onChange={(e) => setPrizeThirdUsd(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white outline-none placeholder:text-zinc-600 focus:border-amber-600"
                />
              </div>
            </div>
            <p className="text-[11px] text-zinc-500">
              Specify exact 1st, 2nd, and 3rd place prizes. If Total Prize Pool is left blank, it will be calculated automatically as the sum of 1st + 2nd + 3rd.
            </p>
          </div>

          {/* Registration Timeline */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-zinc-300">
                Registration Opens <span className="text-zinc-500 font-normal">(Optional)</span>
              </label>
              <input
                type="datetime-local"
                value={regStartAt}
                onChange={(e) => setRegStartAt(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-xs text-white outline-none focus:border-red-500"
              />
              <p className="mt-1 text-[11px] text-zinc-500">Date & time registration becomes open.</p>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-zinc-300">
                Registration Deadline <span className="text-zinc-500 font-normal">(Optional)</span>
              </label>
              <input
                type="datetime-local"
                value={regEndAt}
                onChange={(e) => setRegEndAt(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-xs text-white outline-none focus:border-red-500"
              />
              <p className="mt-1 text-[11px] text-zinc-500">Must be after registration opening time.</p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-6 border-t border-zinc-800/80 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-300 transition hover:bg-zinc-900 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-red-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-600 disabled:opacity-50"
            >
              {loading ? "Saving..." : isEditMode ? "Save Changes" : "Create Tournament"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CreateTournamentModal;
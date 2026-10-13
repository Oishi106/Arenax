import React, { useState, useEffect } from "react";
import { scheduleMatch } from "../api";

function ScheduleMatchModal({ isOpen, onClose, onSuccess, match }) {
  const [scheduledTime, setScheduledTime] = useState("");
  const [lobbyCode, setLobbyCode] = useState("");
  const [serverRegion, setServerRegion] = useState("Singapore");
  const [draftMode, setDraftMode] = useState("Captains Mode");
  const [bestOf, setBestOf] = useState("BO1");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (isOpen && match) {
      setErrorMsg("");
      setLobbyCode(match.lobby_code || "");
      setServerRegion(match.server_region || "Singapore");
      setDraftMode(match.draft_mode || "Captains Mode");
      setBestOf(match.best_of || "BO1");

      if (match.scheduled_time) {
        try {
          const d = new Date(match.scheduled_time);
          if (!isNaN(d.getTime())) {
            // Format to YYYY-MM-DDTHH:mm
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, "0");
            const day = String(d.getDate()).padStart(2, "0");
            const hours = String(d.getHours()).padStart(2, "0");
            const mins = String(d.getMinutes()).padStart(2, "0");
            setScheduledTime(`${year}-${month}-${day}T${hours}:${mins}`);
          } else {
            setScheduledTime("");
          }
        } catch {
          setScheduledTime("");
        }
      } else {
        setScheduledTime("");
      }
    }
  }, [isOpen, match]);

  if (!isOpen || !match) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg("");
    setLoading(true);

    try {
      await scheduleMatch(match.match_id, {
        scheduled_time: scheduledTime ? new Date(scheduledTime).toISOString() : null,
        lobby_code: lobbyCode.trim() || null,
        server_region: serverRegion.trim() || null,
        draft_mode: draftMode.trim() || null,
        best_of: bestOf,
      });

      onSuccess && onSuccess(`Match #${match.match_id} schedule & lobby updated!`);
      onClose();
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || err.data?.error || "Failed to update match schedule.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800/80 pb-4 mb-4">
          <div>
            <h3 className="text-lg font-black text-white">Configure Match #{match.match_id}</h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Round {match.round_number} &bull; Bracket Position {match.bracket_position}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white transition"
          >
            ✕
          </button>
        </div>

        {errorMsg && (
          <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400 font-medium">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Scheduled Time */}
          <div>
            <label className="block text-xs font-bold text-zinc-300 mb-1">
              Match Schedule (Date & Time)
            </label>
            <input
              type="datetime-local"
              value={scheduledTime}
              onChange={(e) => setScheduledTime(e.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 focus:border-red-500 focus:outline-none transition"
            />
            <span className="text-[10px] text-zinc-500">Leave blank to clear scheduled time.</span>
          </div>

          {/* Lobby Code */}
          <div>
            <label className="block text-xs font-bold text-zinc-300 mb-1">
              Lobby Code / Password
            </label>
            <input
              type="text"
              maxLength={20}
              placeholder="e.g. ARENA-9981 or PW: 1234"
              value={lobbyCode}
              onChange={(e) => setLobbyCode(e.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 focus:border-red-500 focus:outline-none transition"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Server Region */}
            <div>
              <label className="block text-xs font-bold text-zinc-300 mb-1">
                Server Region
              </label>
              <select
                value={serverRegion}
                onChange={(e) => setServerRegion(e.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-white focus:border-red-500 focus:outline-none transition"
              >
                <option value="Singapore">Singapore (SEA)</option>
                <option value="India">India</option>
                <option value="EU West">EU West</option>
                <option value="EU East">EU East</option>
                <option value="US East">US East</option>
                <option value="US West">US West</option>
                <option value="Tokyo">Tokyo</option>
              </select>
            </div>

            {/* Draft Mode */}
            <div>
              <label className="block text-xs font-bold text-zinc-300 mb-1">
                Draft Mode
              </label>
              <select
                value={draftMode}
                onChange={(e) => setDraftMode(e.target.value)}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-white focus:border-red-500 focus:outline-none transition"
              >
                <option value="Captains Mode">Captains Mode</option>
                <option value="Tournament Draft">Tournament Draft</option>
                <option value="All Pick">All Pick</option>
                <option value="Blind Pick">Blind Pick</option>
              </select>
            </div>
          </div>

          {/* Series Best Of */}
          <div>
            <label className="block text-xs font-bold text-zinc-300 mb-1">
              Series Format (Best Of)
            </label>
            <div className="flex gap-2">
              {["BO1", "BO3", "BO5"].map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => setBestOf(fmt)}
                  className={`flex-1 py-2 text-xs font-bold rounded-xl border transition ${
                    bestOf === fmt
                      ? "bg-red-500 text-white border-red-500"
                      : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-white"
                  }`}
                >
                  {fmt}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 flex items-center justify-end gap-3 pt-3 border-t border-zinc-800/80">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="rounded-xl border border-zinc-700 px-4 py-2 text-xs font-bold text-zinc-400 hover:bg-zinc-800 hover:text-white transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-xl bg-red-500 px-5 py-2 text-xs font-bold text-white hover:bg-red-600 transition shadow-lg shadow-red-500/20 disabled:opacity-50"
            >
              {loading ? "Saving..." : "Save Match Settings"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ScheduleMatchModal;

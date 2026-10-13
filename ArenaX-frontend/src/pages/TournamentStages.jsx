import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import StageModal from "../components/StageModal";
import GroupStageManager from "../components/GroupStageManager";
import BracketManager from "../components/BracketManager";
import PlayoffBracketView from "../components/PlayoffBracketView";
import PendingResultsReview from "../components/PendingResultsReview";
import {
  getTournamentDetails,
  getTournamentStages,
  deleteStage,
  getMe,
} from "../api";

const FORMAT_LABELS = {
  group_stage: "Group Stage",
  single_elimination: "Single Elimination",
  double_elimination: "Double Elimination",
};

function TournamentStages() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [tournament, setTournament] = useState(null);
  const [stages, setStages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [checkingRole, setCheckingRole] = useState(true);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStage, setEditingStage] = useState(null);
  const [toastMessage, setToastMessage] = useState("");
  const [actionErrorId, setActionErrorId] = useState(null);
  const [actionErrorMsg, setActionErrorMsg] = useState("");

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(""), 4000);
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [tournamentData, stagesData] = await Promise.all([
        getTournamentDetails(id),
        getTournamentStages(id),
      ]);
      setTournament(tournamentData);
      setStages(stagesData);
    } catch (err) {
      console.error(err);
      if (err.isUnauthenticated) navigate("/login");
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
      } catch {
        navigate("/login");
      }
    };
    checkAccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, navigate]);

  const handleAddClick = () => {
    setEditingStage(null);
    setIsModalOpen(true);
  };

  const handleEditClick = (stage) => {
    setEditingStage(stage);
    setIsModalOpen(true);
  };

  const handleModalSuccess = () => {
    loadData();
    showToast(editingStage ? "Stage updated successfully!" : "Stage added successfully!");
  };

  const handleDelete = async (stage) => {
    if (!window.confirm(`Delete stage "${stage.stage_name}"? This cannot be undone.`)) {
      return;
    }
    setActionErrorId(null);
    setActionErrorMsg("");
    try {
      await deleteStage(stage.stage_id);
      showToast("Stage deleted.");
      loadData();
    } catch (err) {
      console.error(err);
      setActionErrorId(stage.stage_id);
      setActionErrorMsg(err.message || "Failed to delete stage.");
    }
  };

  const isLocked = tournament && ["live", "completed"].includes(tournament.status);

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

      <main className="mx-auto max-w-4xl w-full px-6 py-16 flex-1">
        <div className="flex items-center gap-4 text-sm font-semibold text-zinc-400">
          <Link
            to={`/tournaments/${id}`}
            className="hover:text-white transition"
          >
            &larr; Back to Tournament
          </Link>
          <span>•</span>
          <Link
            to="/my-tournaments"
            className="hover:text-white transition"
          >
            My Tournaments
          </Link>
        </div>

        <div className="mt-4 mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-white">
              {tournament ? tournament.name : "Stages"}
            </h1>
            <p className="text-sm text-zinc-400 mt-1">
              Break this tournament into ordered stages - each can use its own format.
            </p>
          </div>

          {!isLocked && (
            <button
              onClick={handleAddClick}
              className="inline-flex items-center gap-2 rounded-xl bg-red-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-red-500/20 transition hover:bg-red-600 self-start sm:self-auto"
            >
              + Add Stage
            </button>
          )}
        </div>

        {isLocked && (
          <div className="mb-6 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-xs text-amber-400">
            This tournament is <span className="font-bold uppercase">{tournament.status}</span> - stages are locked and can no longer be added, edited, or removed.
          </div>
        )}

        {loading ? (
          <div className="space-y-4">
            {[1, 2].map((i) => (
              <div key={i} className="h-20 rounded-2xl border border-zinc-800 bg-zinc-900/30 animate-pulse" />
            ))}
          </div>
        ) : stages.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/20 p-16 text-center">
            <h3 className="text-lg font-bold text-white">No stages added yet.</h3>
            <p className="mt-2 text-sm text-zinc-400">
              Add stages like Group Stage, Quarterfinal, Semifinal, and Final in order.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {stages.map((stage) => (
              <div key={stage.stage_id} className="space-y-3">
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-500/10 border border-red-500/20 text-sm font-bold text-red-400">
                      {stage.stage_order}
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-white">{stage.stage_name}</h3>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {FORMAT_LABELS[stage.stage_format] || stage.stage_format}
                      </p>
                      {actionErrorId === stage.stage_id && (
                        <p className="text-xs text-red-400 mt-1">{actionErrorMsg}</p>
                      )}
                    </div>
                  </div>

                  {!isLocked && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleEditClick(stage)}
                        className="rounded-lg border border-zinc-700 px-4 py-2 text-xs font-semibold text-zinc-300 transition hover:border-zinc-500 hover:text-white"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(stage)}
                        className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-400 transition hover:bg-red-500/20"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>

                {stage.stage_format === "group_stage" ? (
                  <GroupStageManager
                    stageId={stage.stage_id}
                    tournamentId={id}
                    tournamentStatus={tournament?.status}
                    onToast={showToast}
                  />
                ) : (
                  <div className="space-y-6">
                    <BracketManager
                      stageId={stage.stage_id}
                      stageFormat={stage.stage_format}
                      tournamentId={id}
                      tournamentStatus={tournament?.status}
                      onToast={showToast}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>

      <StageModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={handleModalSuccess}
        tournamentId={id}
        editingStage={editingStage}
      />

      <Footer />
    </div>
  );
}

export default TournamentStages;
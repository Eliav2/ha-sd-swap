import type { Device, Job, StageName, StageStatus, WsMessage } from "../shared/types.ts";

// --- State ---
let currentJob: Job | null = null;
const subscribers = new Set<(msg: WsMessage) => void>();

export function getCurrentJob(): Job | null {
  return currentJob;
}

export function isLocked(): boolean {
  return currentJob !== null && currentJob.status === "in_progress";
}

/** Create a new clone job. Throws if a job is already in progress. */
export function createJob(device: Device): Job {
  if (isLocked()) {
    throw new Error("A clone operation is already in progress.");
  }

  currentJob = {
    id: crypto.randomUUID().slice(0, 8),
    status: "in_progress",
    device,
    stages: {
      backup: { name: "backup", status: "pending", progress: 0 },
      download: { name: "download", status: "pending", progress: 0 },
      flash: { name: "flash", status: "pending", progress: 0 },
      inject: { name: "inject", status: "pending", progress: 0 },
    },
    error: null,
    backupName: null,
    createdAt: Date.now(),
  };

  return currentJob;
}

/** Update a stage's progress. Broadcasts to all WebSocket subscribers. */
export function updateStage(
  stage: StageName,
  status: StageStatus,
  progress: number,
  speed?: number,
  eta?: number,
): void {
  if (!currentJob) return;
  currentJob.stages[stage] = { name: stage, status, progress };
  broadcast({ type: "stage_update", stage, status, progress, speed, eta });
}

/** Store the backup name on the current job (for frontend display). */
export function setBackupName(name: string): void {
  if (!currentJob) return;
  currentJob.backupName = name;
}

/** Mark the entire job as completed. */
export function completeJob(): void {
  if (!currentJob) return;
  currentJob.status = "completed";
  broadcast({ type: "done", backupName: currentJob.backupName });
}

/** Mark the job as failed with an error message scoped to a stage. */
export function failJob(stage: StageName, message: string): void {
  if (!currentJob) return;
  currentJob.status = "failed";
  currentJob.error = message;
  currentJob.stages[stage].status = "failed";
  broadcast({ type: "error", stage, message });
}

/** Clear the current job (used by cancel). Broadcasts cancellation. */
export function clearJob(): void {
  if (!currentJob) return;
  currentJob = null;
  broadcast({ type: "cancelled" });
}

/** Subscribe to job updates. Returns an unsubscribe function. */
export function subscribe(cb: (msg: WsMessage) => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

function broadcast(msg: WsMessage): void {
  for (const cb of subscribers) {
    try {
      cb(msg);
    } catch {
      /* ignore dead subscribers */
    }
  }
}

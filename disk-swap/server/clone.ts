import { statfsSync } from "node:fs";
import type { Job, StageName } from "../shared/types.ts";
import {
  createJob,
  updateStage,
  completeJob,
  failJob,
} from "./jobs.ts";
import {
  createFullBackup,
  pollJob,
  getOsInfo,
  getInfo,
  machineToBoardSlug,
} from "./supervisor.ts";
import {
  buildDownloadUrl,
  buildChecksumUrl,
  imagePath,
  downloadImage,
  verifyChecksum,
  isCachedImageValid,
  cleanupImage,
} from "./images.ts";
import { flash, runPartprobe } from "./flasher.ts";
import { injectBackup } from "./injector.ts";

const isDev = process.env.DEV === "1";
const MIN_DOWNLOAD_SPACE = 600 * 1024 * 1024; // 600 MB

// Pipeline context — module-level since only one clone runs at a time
let backupSlug = "";
let boardSlug = "";
let osVersion = "";
let localImagePath = "";

/** Pre-flight checks. Throws descriptive errors on failure. */
async function preflight(devicePath: string): Promise<void> {
  if (!isDev) {
    const stat = statfsSync("/data");
    const freeBytes = stat.bfree * stat.bsize;
    if (freeBytes < MIN_DOWNLOAD_SPACE) {
      const freeMB = Math.round(freeBytes / 1024 / 1024);
      throw new Error(
        `Not enough disk space for image download. Need ~600 MB, only ${freeMB} MB free.`,
      );
    }
  }

  const { listUsbDevices } = isDev
    ? await import("./mock.ts")
    : await import("./devices.ts");

  const devices = await listUsbDevices();
  const target = devices.find((d) => d.path === devicePath);
  if (!target) {
    throw new Error(
      `Target device ${devicePath} not found or is not a safe USB target.`,
    );
  }
}

/** Run the full clone pipeline. Returns the job immediately; runs stages async. */
export async function runClonePipeline(devicePath: string): Promise<Job> {
  await preflight(devicePath);
  const job = createJob(devicePath);

  // Fire-and-forget — progress goes via WebSocket
  (async () => {
    try {
      await runBackupStage();
      await runDownloadStage();
      await runFlashStage(devicePath);
      await runInjectStage(devicePath);
      completeJob();
    } catch (err) {
      if (job.status === "in_progress") {
        const active = findActiveStage(job);
        failJob(active, String(err));
      }
      console.error("Clone pipeline failed:", err);
    }
  })();

  return job;
}

function findActiveStage(job: Job): StageName {
  for (const name of ["backup", "download", "flash", "inject"] as StageName[]) {
    if (job.stages[name].status === "in_progress") return name;
  }
  return "backup";
}

// --- Individual Stage Runners ---

async function runBackupStage(): Promise<void> {
  updateStage("backup", "in_progress", 0);

  if (isDev) {
    for (let p = 0; p <= 100; p += 20) {
      await new Promise((r) => setTimeout(r, 300));
      updateStage("backup", "in_progress", Math.min(p, 99));
    }
    backupSlug = "mock-backup-slug";
    updateStage("backup", "completed", 100);
    return;
  }

  try {
    const { job_id } = await createFullBackup();

    while (true) {
      await new Promise((r) => setTimeout(r, 2000));
      const status = await pollJob(job_id);

      if (status.errors?.length > 0) {
        throw new Error(`Backup failed: ${status.errors.join(", ")}`);
      }

      updateStage("backup", "in_progress", Math.round(status.progress));

      if (status.done) {
        backupSlug = status.reference || "";
        if (!backupSlug) {
          throw new Error("Backup completed but no slug returned.");
        }
        if (!(await Bun.file(`/backup/${backupSlug}.tar`).exists())) {
          throw new Error(`Backup file /backup/${backupSlug}.tar not found.`);
        }
        updateStage("backup", "completed", 100);
        return;
      }
    }
  } catch (err) {
    failJob("backup", String(err));
    throw err;
  }
}

async function runDownloadStage(): Promise<void> {
  updateStage("download", "in_progress", 0);

  try {
    if (isDev) {
      boardSlug = "rpi4-64";
      osVersion = "17.1";
    } else {
      const [info, osInfo] = await Promise.all([getInfo(), getOsInfo()]);
      boardSlug = machineToBoardSlug(info.machine);
      osVersion = osInfo.version;
    }

    const imageUrl = buildDownloadUrl(boardSlug, osVersion);
    const checksumUrl = buildChecksumUrl(imageUrl);
    localImagePath = imagePath(boardSlug, osVersion);

    if (isDev) {
      // Mock download
      for (let p = 0; p <= 100; p += 10) {
        await new Promise((r) => setTimeout(r, 200));
        updateStage("download", "in_progress", Math.min(p, 99));
      }
      updateStage("download", "completed", 100);
      return;
    }

    // Check cached image
    if (await isCachedImageValid(localImagePath, checksumUrl)) {
      console.log("Using cached image (checksum valid).");
      updateStage("download", "completed", 100);
      return;
    }

    await downloadImage(imageUrl, localImagePath, (percent) => {
      updateStage("download", "in_progress", percent);
    });

    await verifyChecksum(localImagePath, checksumUrl);
    updateStage("download", "completed", 100);
  } catch (err) {
    cleanupImage(localImagePath);
    failJob("download", String(err));
    throw err;
  }
}

async function runFlashStage(devicePath: string): Promise<void> {
  updateStage("flash", "in_progress", 0);

  try {
    if (isDev) {
      for (let p = 0; p <= 100; p += 5) {
        await new Promise((r) => setTimeout(r, 200));
        updateStage("flash", "in_progress", Math.min(p, 99));
      }
      updateStage("flash", "completed", 100);
      return;
    }

    await flash(localImagePath, devicePath, (percent) => {
      updateStage("flash", "in_progress", percent);
    });

    await runPartprobe(devicePath);
    updateStage("flash", "completed", 100);

    // Clean up downloaded image to free space
    cleanupImage(localImagePath);
  } catch (err) {
    failJob("flash", String(err));
    throw err;
  }
}

async function runInjectStage(devicePath: string): Promise<void> {
  updateStage("inject", "in_progress", 0);

  try {
    if (isDev) {
      for (let p = 0; p <= 100; p += 25) {
        await new Promise((r) => setTimeout(r, 200));
        updateStage("inject", "in_progress", Math.min(p, 99));
      }
      updateStage("inject", "completed", 100);
      return;
    }

    await injectBackup(devicePath, backupSlug, (percent) => {
      updateStage("inject", "in_progress", percent);
    });

    updateStage("inject", "completed", 100);
  } catch (err) {
    failJob("inject", String(err));
    throw err;
  }
}

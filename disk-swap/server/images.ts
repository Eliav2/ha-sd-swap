import { unlinkSync } from "node:fs";

const GITHUB_RELEASES_BASE =
  "https://github.com/home-assistant/operating-system/releases/download";

const IMAGE_DIR = "/data";

export function buildDownloadUrl(boardSlug: string, version: string): string {
  return `${GITHUB_RELEASES_BASE}/${version}/haos_${boardSlug}-${version}.img.xz`;
}

export function buildChecksumUrl(imageUrl: string): string {
  return `${imageUrl}.sha256`;
}

export function imagePath(boardSlug: string, version: string): string {
  return `${IMAGE_DIR}/haos_${boardSlug}-${version}.img.xz`;
}

/** Download the HAOS image with progress reporting. */
export async function downloadImage(
  url: string,
  destPath: string,
  progressCb: (percent: number, bytesPerSec: number, etaSec: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(url, { redirect: "follow", signal });
  if (!res.ok) {
    throw new Error(`Download failed: HTTP ${res.status} from ${url}`);
  }

  const contentLength = Number(res.headers.get("content-length") || 0);
  if (!res.body) throw new Error("No response body");

  const writer = Bun.file(destPath).writer();
  let received = 0;
  let prevReceived = 0;
  let prevTime = Date.now();
  let speed = 0;
  let eta = 0;

  for await (const chunk of res.body) {
    writer.write(chunk);
    received += chunk.byteLength;

    const now = Date.now();
    const elapsed = (now - prevTime) / 1000;
    if (elapsed >= 1) {
      speed = (received - prevReceived) / elapsed;
      prevReceived = received;
      prevTime = now;
      if (speed > 0 && contentLength > 0) {
        eta = (contentLength - received) / speed;
      }
    }

    if (contentLength > 0) {
      progressCb(Math.round((received / contentLength) * 100), speed, eta);
    }
  }
  await writer.end();
}

/** Verify SHA256 checksum of the downloaded image. Returns false if skipped. */
export async function verifyChecksum(
  localPath: string,
  sha256Url: string,
): Promise<boolean> {
  const sha256Res = await fetch(sha256Url, { redirect: "follow" });
  if (sha256Res.status === 404) {
    console.log("[images] No checksum file available, skipping verification.");
    return false;
  }
  if (!sha256Res.ok) {
    throw new Error(`Failed to download checksum: HTTP ${sha256Res.status}`);
  }
  const sha256Text = (await sha256Res.text()).trim();
  const expectedHash = sha256Text.split(/\s+/)[0].toLowerCase();

  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(localPath).stream()) {
    hasher.update(chunk);
  }
  const actualHash = hasher.digest("hex");

  if (actualHash !== expectedHash) {
    unlinkSync(localPath);
    throw new Error(
      `Checksum mismatch: expected ${expectedHash}, got ${actualHash}`,
    );
  }
  return true;
}

/** Check if a cached image already exists and passes checksum. */
export async function isCachedImageValid(
  localPath: string,
  sha256Url: string,
): Promise<boolean> {
  if (!(await Bun.file(localPath).exists())) return false;
  try {
    await verifyChecksum(localPath, sha256Url);
    // Checksum matched (true) or unavailable/404 (false) — trust cache either way.
    // Only a checksum mismatch throws, which is caught below.
    return true;
  } catch {
    return false;
  }
}

/** Check if a cached image exists for the given board/version and return info. */
export async function getImageCacheInfo(
  boardSlug: string,
  version: string,
): Promise<{ cached: boolean; sizeBytes: number }> {
  const path = imagePath(boardSlug, version);
  const file = Bun.file(path);
  if (!(await file.exists())) return { cached: false, sizeBytes: 0 };
  return { cached: true, sizeBytes: file.size };
}

/** Delete the cached image for a given board/version. */
export function discardCachedImage(boardSlug: string, version: string): void {
  cleanupImage(imagePath(boardSlug, version));
}

/** Delete the downloaded image to free disk space. */
export function cleanupImage(localPath: string): void {
  try {
    unlinkSync(localPath);
  } catch {
    /* ignore if already deleted */
  }
}

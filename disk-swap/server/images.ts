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
  progressCb: (percent: number) => void,
): Promise<void> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Download failed: HTTP ${res.status} from ${url}`);
  }

  const contentLength = Number(res.headers.get("content-length") || 0);
  if (!res.body) throw new Error("No response body");

  const writer = Bun.file(destPath).writer();
  let received = 0;

  for await (const chunk of res.body) {
    writer.write(chunk);
    received += chunk.byteLength;
    if (contentLength > 0) {
      progressCb(Math.round((received / contentLength) * 100));
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
    const verified = await verifyChecksum(localPath, sha256Url);
    // If no checksum available, treat cache as stale to force re-download
    return verified;
  } catch {
    return false;
  }
}

/** Delete the downloaded image to free disk space. */
export function cleanupImage(localPath: string): void {
  try {
    unlinkSync(localPath);
  } catch {
    /* ignore if already deleted */
  }
}

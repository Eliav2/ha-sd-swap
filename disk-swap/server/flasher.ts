import { $ } from "bun";

/** Get the uncompressed image size (needed for pv --size). */
export async function getUncompressedSize(imagePath: string): Promise<number> {
  const output = await $`xz --list --robot ${imagePath}`.text();
  const lines = output.trim().split("\n");
  // Last line has: totals TAB streams TAB blocks TAB compressed TAB uncompressed
  const fields = lines[lines.length - 1].split("\t");
  return parseInt(fields[4], 10);
}

/**
 * Flash the image to the target device.
 * Pipeline: xz -dc <image> | pv --numeric --size <uncompressed> | dd of=<device> bs=4M conv=fdatasync,sync status=none
 * pv --numeric outputs integers 0-100 to stderr.
 */
export async function flash(
  imagePath: string,
  devicePath: string,
  progressCb: (percent: number) => void,
): Promise<void> {
  const uncompressedSize = await getUncompressedSize(imagePath);

  const proc = Bun.spawn(
    [
      "sh",
      "-c",
      `xz -dc "${imagePath}" | pv --numeric --size ${uncompressedSize} | dd of="${devicePath}" bs=4M conv=fdatasync,sync status=none`,
    ],
    {
      stdout: "ignore",
      stderr: "pipe",
    },
  );

  const reader = proc.stderr.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const num = parseFloat(line.trim());
      if (!isNaN(num)) {
        progressCb(Math.min(Math.round(num), 100));
      }
    }
  }

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Flash pipeline exited with code ${exitCode}`);
  }
}

/** Re-read partition table after flashing. */
export async function runPartprobe(devicePath: string): Promise<void> {
  try {
    await $`partprobe ${devicePath}`;
  } catch {
    // Retry once after a short delay
    await new Promise((r) => setTimeout(r, 2000));
    await $`partprobe ${devicePath}`;
  }
  // Give the kernel a moment to settle
  await new Promise((r) => setTimeout(r, 1000));
}

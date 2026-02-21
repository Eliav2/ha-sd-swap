# ha-sd-swap — Full Implementation Plan

> End-to-end SD card migration: flash fresh HAOS + restore full backup, all from within Home Assistant.

---

## Vision

1. User plugs new SD card into USB adapter connected to the Pi
2. Add-on detects the card automatically (hotplug via SSE)
3. User clicks "Clone to new card" → confirms target device
4. Add-on orchestrates backup → download → flash → inject with live progress
5. User physically swaps cards → Pi boots → restores backup from onboarding → done

---

## The 5-Stage Workflow

```
STAGE 0: PRE-FLIGHT CHECKS (before anything destructive)
┌──────────────────────────────────────────────────────────────────┐
│ Acquire global clone lock (reject if clone already in progress)  │
│ Validate target device: USB, 8GB-2TB, not boot disk              │
│ Check disk space on /data/: need ~600MB for image download       │
│ (Supervisor handles backup space separately — errors surfaced)   │
│ Confirmation dialog: device name, size, "ALL DATA WILL BE ERASED"│
└──────────────────────────────────────────────────────────────────┘

STAGE 1: BACKUP           STAGE 2: DOWNLOAD           STAGE 3: FLASH
┌──────────────────┐      ┌────────────────────────┐   ┌────────────────────────┐
│ POST /backups/   │      │ GET /info → machine     │   │ Verify .sha256 checksum│
│   new/full       │─────▶│ Lookup table → slug     │──▶│ xz -dc haos.img.xz    │
│ {background:true}│      │ Stream download to      │   │ | pv --numeric         │
│                  │      │   /data/haos.img.xz     │   │ | dd of=/dev/sdX bs=4M │
│ Poll /jobs/{id}  │      │ Also download .sha256   │   │   conv=fdatasync,sync  │
│ until done       │      │ Emit % via WebSocket    │   │ partprobe /dev/sdX     │
│                  │      └────────────────────────┘   └────────────────────────┘
│ Backup .tar file │
│ available at     │
│ /backup/{slug}.tar│
│ (mapped volume)  │
└──────────────────┘

STAGE 4: INJECT BACKUP INTO NEW SD
┌──────────────────────────────────────────────────────────────────┐
│ lsblk -nro NAME,LABEL /dev/sdX → find hassos-data partition     │
│ Mount hassos-data partition (ext4, rw) at /mnt/newsd             │
│ mkdir -p /mnt/newsd/supervisor/backup/                           │
│ Copy /backup/{slug}.tar → /mnt/newsd/supervisor/backup/          │
│   (with progress: bytes copied / total bytes)                    │
│ sync && unmount /mnt/newsd                                       │
│                                                                  │
│ Show "Swap the card now" UI with instructions                    │
│   → After swap + boot, Supervisor auto-discovers the backup      │
│   → User selects "Restore from backup" in onboarding (1 click)  │
└──────────────────────────────────────────────────────────────────┘
```

---

## System Architecture

```
HA Supervisor  http://supervisor  (172.30.32.2:80)
      │
      ├── GET  /info              → machine name, arch (no auth needed)
      ├── GET  /os/info           → board, version, version_latest
      ├── GET  /host/info         → disk info, hostname
      ├── GET  /network/info      → IP addresses (for Swap Now screen)
      ├── POST /backups/new/full  → create backup (needs role: backup)
      └── GET  /jobs/{id}         → poll backup progress

Mapped volumes (via config.yaml)
      ├── /data/                  → add-on persistent storage (image downloads)
      └── /backup/                → HA backup directory (backup .tar files land here)

Container (s6-overlay, two services)
      ├── nginx (port 8099)  ← HA ingress proxy
      │     ├── /            → /var/www/         (static UI)
      │     ├── /api/*       → 127.0.0.1:8080   (Bun backend proxy_pass)
      │     └── /ws/*        → 127.0.0.1:8080   (WebSocket upgrade + proxy)
      │
      └── bun (port 8080)  ← Hono + Bun.serve backend
            ├── GET  /api/devices         list safe USB block devices
            ├── GET  /api/system-info     board, version, disk space, free space
            ├── POST /api/start-clone     pre-flight checks → kick off stages 1-4
            ├── GET  /api/jobs/current    active job (for page reload reconnection)
            ├── GET  /api/jobs/{id}       poll overall job + per-stage state
            ├── GET  /api/events          SSE stream (hotplug, job updates)
            └── WS   /ws/progress/{id}    real-time progress per stage
```

---

## Key Technical Facts (verified from source + GitHub API)

### Supervisor API Authentication
- Token: `$SUPERVISOR_TOKEN` env var (auto-injected by Supervisor)
- Header: `Authorization: Bearer $SUPERVISOR_TOKEN`
- Base URL: `http://supervisor` (resolves to 172.30.32.2:80)
- `GET /info` — **no auth required** (bypass list), returns machine + arch
- `hassio_role: backup` — grants full `/backups/*` read+write access

### Machine Name → Image Asset Mapping

Use an explicit lookup table — `machine.replace()` doesn't work for all boards:

```typescript
const MACHINE_TO_SLUG: Record<string, string> = {
  "raspberrypi3":    "rpi3",
  "raspberrypi3-64": "rpi3-64",
  "raspberrypi4":    "rpi4",
  "raspberrypi4-64": "rpi4-64",
  "raspberrypi5-64": "rpi5-64",
  "generic-x86-64":  "generic-x86-64",
  "generic-aarch64": "generic-aarch64",
  "odroid-c2":       "odroid-c2",
  "odroid-c4":       "odroid-c4",
  "odroid-m1":       "odroid-m1",
  "odroid-n2":       "odroid-n2",
  "odroid-xu":       "odroid-xu",
  "tinker":          "tinker",
  "khadas-vim3":     "khadas-vim3",
  "green":           "green",
  "yellow":          "yellow",
};

function machineToBoardSlug(machine: string): string {
  const slug = MACHINE_TO_SLUG[machine];
  if (!slug) throw new Error(`Unsupported machine type: ${machine}`);
  return slug;
}
```

```
Download URL pattern:
  https://github.com/home-assistant/operating-system/releases/download/
    {version}/haos_{board_slug}-{version}.img.xz

Checksum URL:
  {download_url}.sha256

Version selection:
  GET /os/info → version_latest field (stable channel)
  Also expose current version so user can choose: match current vs latest
```

### HA OS Image Sizes (v17.1, compressed)
```
haos_rpi4-64:          346 MB → ~1.1 GB uncompressed
haos_rpi5-64:          355 MB → ~1.1 GB uncompressed
haos_rpi3-64:          335 MB → ~1.1 GB uncompressed
haos_generic-aarch64:  366 MB → ~1.1 GB uncompressed
haos_generic-x86-64:   555 MB → ~1.8 GB uncompressed
```

### HAOS Partition Layout (after flash)
```
/dev/sdX1  hassos-boot   FAT32   ~256 MB  (bootloader, kernel)
/dev/sdX2  hassos-kernel-a  raw
/dev/sdX3  hassos-kernel-b  raw
/dev/sdX4  hassos-system-a  squashfs  (OS root A)
/dev/sdX5  hassos-system-b  squashfs  (OS root B)
/dev/sdX6  hassos-bootstate raw
/dev/sdX7  hassos-overlay   ext4  (~100 MB)
/dev/sdX8  hassos-data      ext4  (~remaining space, grows on first boot)
```

**For backup injection:**
1. Run `partprobe /dev/sdX` to re-read partition table
2. Find data partition: `lsblk -nro NAME,LABEL /dev/sdX | grep hassos-data | awk '{print $1}'`
   (scoped to target device — do NOT use `blkid -L` which searches all devices globally)
3. Mount, copy backup.tar to `/supervisor/backup/`, unmount
4. The Supervisor auto-discovers `.tar` files in this directory on boot

### Flash Command Pipeline
```bash
# Verify download integrity (HAOS releases include .sha256 files)
SHA_URL="${IMAGE_URL}.sha256"
curl -sL "$SHA_URL" | sha256sum -c -

# Get uncompressed size for progress tracking
UNCOMPRESSED=$(xz --list --robot /data/haos.img.xz | tail -1 | awk '{print $5}')

# Flash with progress
xz -dc /data/haos.img.xz \
  | pv --numeric --size "$UNCOMPRESSED" \
  | dd of=/dev/sdX bs=4M conv=fdatasync,sync status=none

# pv --numeric outputs plain integer % to stderr, one per second → easy WebSocket streaming

# Re-read partition table so kernel sees new partitions (required before Stage 4)
partprobe /dev/sdX
```

### Device Safety Rules
```typescript
import { $ } from "bun";

interface BlockDevice {
  name: string;
  size: number;
  tran: string | null;
  vendor: string;
  model: string;
  serial: string;
}

function isSafeTarget(dev: BlockDevice, bootDisk: string): boolean {
  if (dev.name === bootDisk) return false;       // never flash boot device
  if (dev.tran !== "usb") return false;           // USB devices only
  if (dev.size < 8 * 1024 ** 3) return false;    // reject < 8GB (too small for HAOS)
  if (dev.size > 2 * 1024 ** 4) return false;    // reject > 2TB (probably not an SD card)
  return true;
}

async function getBootDisk(): Promise<string> {
  const root = await $`findmnt --noheadings --output SOURCE --target /`.text();
  const pkname = await $`lsblk --noheadings --output PKNAME --nodeps ${root.trim()}`.text();
  return (pkname.trim() || root.trim()).replace("/dev/", "");
}
```

---

## Files to Build

### Backend (`sd-swap/server/`)

TypeScript backend running on **Bun** with **Hono** as the HTTP framework.
Shared types with the frontend via `shared/types.ts`.

```
server/
├── index.ts          Hono app, all routes, Bun.serve with WebSocket
├── supervisor.ts     HTTP client for Supervisor API (uses fetch — built into Bun)
│                     - getInfo() → machine, arch
│                     - getOsInfo() → version, version_latest, board
│                     - getNetworkInfo() → IPv4 address (for Swap Now screen)
│                     - createFullBackup(name) → slug, job_id
│                     - pollJob(jobId) → progress %, done, errors
│                     Note: backup .tar accessed via mapped /backup/ volume, not API download
├── devices.ts        Block device management
│                     - listUsbDevices() → filtered, safe list via lsblk --json
│                       cmd: lsblk --json -o NAME,SIZE,TYPE,TRAN,VENDOR,MODEL,SERIAL --nodeps
│                     - getBootDisk() → findmnt + lsblk PKNAME (via Bun.$)
│                     - isSafeTarget(dev, bootDisk) → safety filter
│                     - watchHotplug() → poll lsblk every 2s, diff against prev, emit add/remove
├── images.ts         HAOS image management
│                     - MACHINE_TO_SLUG lookup table (see above)
│                     - buildDownloadUrl(boardSlug, version) → URL
│                     - downloadImage(url, dest, progressCb) → streams with fetch + Bun.write
│                     - verifyChecksum(imagePath, sha256Url) → download .sha256 + verify
├── flasher.ts        SD card flashing
│                     - flash(imagePath, device, progressCb) → xz|pv|dd via Bun.spawn
│                     - reads pv --numeric stderr for progress %
│                     - runs partprobe after dd completes (via Bun.$)
├── injector.ts       Backup injection into new SD
│                     - findDataPartition(device) → lsblk -nro NAME,LABEL /dev/sdX (Bun.$)
│                       then filter for LABEL=hassos-data (scoped to target device only)
│                     - mountPartition(partition, mountpoint) → Bun.$ mount -t ext4
│                     - injectBackup(slug, mountpoint) → copy /backup/{slug}.tar (Bun file I/O)
│                     - cleanup() → sync, unmount (always runs, even on error — try/finally)
│                     - progress: bytes_copied / file_size
├── jobs.ts           In-memory job state machine
│                     - Job: id, stages[backup|download|flash|inject], overall %
│                     - global clone lock: simple boolean + Promise — only one clone at a time
│                     - subscribe(jobId) → ReadableStream of state updates
│                     - cleanupOnFailure(job, stage) → per-stage rollback
└── events.ts         SSE event bus (hotplug + job updates → frontend)

shared/               # Shared between frontend and backend
└── types.ts          Device, Job, Stage, SystemInfo, API request/response types
```

### Frontend (`frontend/` → pre-built to `sd-swap/rootfs/var/www/`)

**TanStack Start** in SPA mode, pre-built with Vite. Only the static `dist/` output
ships in the container — no Node.js runtime needed.

```
Tech stack:
  - Framework:    TanStack Start (SPA mode — static preset, no SSR server)
  - Router:       TanStack Router (type-safe, file-based, built-in)
  - Components:   shadcn/ui (with Base UI primitives, NOT Radix)
  - Styling:      Tailwind CSS
  - Package mgr:  pnpm
  - Build:        Vite (via TanStack Start / Vinxi)
  - Deploy:       Static output → nginx serves from /var/www/
```

Project is scaffolded via `pnpm create @tanstack/start@latest` — the CLI generates
the base structure (routes, config, entry points). We add our components on top:

```
frontend/                          # Scaffolded by TanStack Start CLI
├── package.json                   # (generated + our additions)
├── pnpm-lock.yaml
├── app.config.ts                  # Configure SPA/static preset here
├── tailwind.config.ts             # Added: Tailwind config
├── components.json                # Added: shadcn/ui config (base-ui provider)
├── app/
│   ├── ...                        # CLI-generated entry files (client, router, etc.)
│   ├── globals.css                # Added: Tailwind base + shadcn theme tokens
│   ├── routes/
│   │   ├── __root.tsx             # Generated by CLI — add providers + SSE context
│   │   └── index.tsx              # Generated by CLI — replace with 4-screen state machine
│   ├── components/                # Added: all project-specific components
│   │   ├── ui/                    # shadcn/ui primitives (base-ui based)
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── progress.tsx
│   │   │   └── alert.tsx
│   │   ├── DeviceSelect.tsx       # Screen 1: device list + system info
│   │   ├── ConfirmDialog.tsx      # Screen 2: destructive action confirmation
│   │   ├── Progress.tsx           # Screen 3: 4-stage progress bars (WebSocket)
│   │   └── SwapNow.tsx            # Screen 4: success + migration instructions
│   ├── lib/                       # Added: API/WebSocket/SSE client utilities
│   │   ├── api.ts                 # Typed fetch wrappers for /api/* endpoints
│   │   ├── ws.ts                  # WebSocket client with auto-reconnect
│   │   ├── sse.ts                 # EventSource for hotplug device updates
│   │   └── utils.ts               # cn() helper, etc.
│   └── types.ts                   # Added: shared types (Device, Job, Stage, etc.)
└── dist/                          # Build output → copied to rootfs/var/www/
```

Build & deploy flow:
```bash
# Developer machine (CI or local)
cd frontend && pnpm install && pnpm build
# Output: frontend/dist/

# Dockerfile copies pre-built output into the container image:
#   COPY frontend/dist/ /var/www/
```

**Ingress base path handling**: HA ingress proxies through a dynamic path
(`/api/hassio_ingress/TOKEN/`). The app uses relative URLs so all API calls
resolve correctly regardless of the ingress prefix.

4 screens (managed as a state machine in the index route):

```
Screen 1: DEVICE SELECT
  ┌─────────────────────────────────────────┐
  │  SD Card Swap                           │
  │                                         │
  │  Connected USB devices:                 │
  │  ┌─────────────────────────────────┐   │
  │  │  Generic USB3.0 CRW  64 GB     │   │  ← auto-detected via SSE hotplug
  │  │    /dev/sda  •  USB 3.0         │   │
  │  └─────────────────────────────────┘   │
  │                                         │
  │  System:  Raspberry Pi 4               │
  │  HAOS:    17.1 (latest: 17.1)          │
  │  Free space: 12.3 GB                   │
  │                                         │
  │  [ Clone to new card ]                  │
  └─────────────────────────────────────────┘

Screen 2: CONFIRMATION DIALOG (before starting)
  ┌─────────────────────────────────────────┐
  │  ⚠ WARNING                              │
  │                                         │
  │  All data on this device will be erased:│
  │                                         │
  │  Device:  /dev/sda                      │
  │  Name:    Generic USB3.0 CRW            │
  │  Size:    64 GB                         │
  │                                         │
  │  This will:                             │
  │   • Create a full backup of your HA     │
  │   • Download HAOS 17.1 (~350 MB)        │
  │   • Flash the image to /dev/sda         │
  │   • Copy your backup to the new card    │
  │                                         │
  │  [ Cancel ]        [ Erase & Clone ]    │
  └─────────────────────────────────────────┘

Screen 3: PROGRESS (live WebSocket)
  ┌─────────────────────────────────────────┐
  │  Cloning to /dev/sda — do not unplug!   │
  │                                         │
  │  ① Backup     ████████████░░░  78%      │
  │  ② Download   ░░░░░░░░░░░░░░░   —       │
  │  ③ Flash      ░░░░░░░░░░░░░░░   —       │
  │  ④ Inject     ░░░░░░░░░░░░░░░   —       │
  │                                         │
  │  If something goes wrong, see error     │
  │  details and retry options below.       │
  └─────────────────────────────────────────┘

Screen 4: SWAP NOW (success)
  ┌─────────────────────────────────────────┐
  │  Done! Your new SD card is ready.       │
  │                                         │
  │  To complete the migration:             │
  │                                         │
  │  1. Shut down the Pi (Settings → System │
  │     → Hardware → Shutdown)              │
  │  2. Remove the current SD card          │
  │  3. Insert the new SD card              │
  │  4. Power on and wait ~2 min            │
  │  5. Open one of these URLs:             │
  │     http://192.168.1.42:8123  ← likely  │
  │     http://homeassistant.local:8123     │
  │  6. Select "Restore from backup"        │
  │  7. Pick the backup and click Restore   │
  │                                         │
  │  ⚠ Your custom hostname, HTTPS, and    │
  │  DNS settings are inside the backup.    │
  │  Use the URLs above until restore       │
  │  completes — then your normal access    │
  │  will work again.                       │
  │                                         │
  │  Your backup is pre-loaded on the new   │
  │  card — no upload needed.               │
  └─────────────────────────────────────────┘
```

### s6 Services

Two services run inside the container:

```
rootfs/etc/services.d/sd-swap/
├── run       # existing — starts nginx on ingress port
└── finish    # existing — standard s6 finish

rootfs/etc/services.d/sd-swap-api/
├── run       # NEW — starts Bun backend on port 8080
└── finish    # NEW — standard s6 finish
```

**sd-swap-api/run** (new):
```bash
#!/usr/bin/with-contenv bashio
exec bun run /usr/src/server/index.ts
```

### Updated nginx.conf.tpl

Replace the placeholder `/api/` stub with proper proxy + WebSocket support:

```nginx
# API proxy to Bun backend
location /api/ {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Ingress-Path $ingress_path;
    proxy_read_timeout 3600s;   # long-running SSE streams
}

# WebSocket proxy for real-time progress
location /ws/ {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
}
```

### Updated Dockerfile

```dockerfile
ARG BUILD_FROM
FROM $BUILD_FROM

# System dependencies
RUN apk add --no-cache \
    util-linux \       # lsblk, findmnt, blkid, blockdev
    coreutils \        # dd with conv=fdatasync
    xz \               # xz -dc decompression
    nginx \            # ingress proxy
    pv \               # progress metering (--numeric mode)
    jq \               # JSON in shell scripts
    e2fsprogs \        # ext4: mount, e2fsck for backup injection (stage 4)
    curl \             # image download + Bun installer
    parted             # partprobe command (re-read partition table after flash)

# Install Bun runtime (official install script, pinned version)
ARG BUN_VERSION=1.3.9
RUN curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash -s "bun-v${BUN_VERSION}"

# Backend source + install dependencies
COPY server/ /usr/src/server/
COPY shared/ /usr/src/shared/
COPY package.json bun.lock /usr/src/
RUN cd /usr/src && bun install --frozen-lockfile --production

# Pre-built frontend (built with pnpm on dev machine)
COPY frontend/dist/ /var/www/

# Mount point for new SD's data partition (Stage 4 injection)
RUN mkdir -p /mnt/newsd

# Root filesystem overlay (s6 services, nginx config)
COPY rootfs /
```

---

## config.yaml Changes

Already applied:
- `hassio_role: backup` (was `default`) — unlocks all `/backups/*` write endpoints
- `map: - type: backup, read_only: false` — lets us read backup files to copy into new SD

Still needed:
- `timeout: 1800` (was `300`) — 30 minutes instead of 5. Full backup + 350MB download + flash + inject can easily exceed 5 minutes on slow hardware/network

---

## Implementation Sequence

### Step 1: Backend skeleton + device listing
- Create `sd-swap/server/` directory with `index.ts`, `devices.ts`, `supervisor.ts`
- Create `sd-swap/shared/types.ts` for shared types
- Create `sd-swap/package.json` with Bun + Hono dependencies
- Add `sd-swap-api` s6 service (`run` + `finish`)
- Update Dockerfile: install Bun, system deps; `bun install` deps
- Update `nginx.conf.tpl`: replace API stub with proxy_pass + WebSocket upgrade
- Update `config.yaml`: timeout → 1800
- Update `apparmor.txt`: add mount, umount, partprobe, e2fsck, findmnt, bun, /backup/**
- Implement `devices.ts`: `listUsbDevices()`, `getBootDisk()`, `isSafeTarget()`
- Implement `supervisor.ts`: `getInfo()`, `getOsInfo()`
- Implement `index.ts`: Hono app with `GET /api/devices`, `GET /api/system-info`
- Test: both endpoints return correct data in a running add-on

### Step 2: Download pipeline + checksum
- `images.ts`: `MACHINE_TO_SLUG` table, `buildDownloadUrl()`, `downloadImage()`, `verifyChecksum()`
- Download streams with `fetch` + `Bun.write`, emits progress as bytes_received / content_length
- Also downloads `.sha256` and verifies before proceeding to flash
- `jobs.ts`: Job model, stage tracking, global clone lock (boolean + Promise)
- `events.ts`: SSE event bus for broadcasting progress

### Step 3: Flash pipeline
- `flasher.ts`: `Bun.spawn` running `xz -dc | pv --numeric | dd`
- Parse pv stderr (integer % lines) for progress
- After dd completes: run `partprobe /dev/sdX` via `Bun.$` to refresh partition table
- Error handling: if dd fails, report which stage failed and why

### Step 4: Backup creation + injection
- `supervisor.ts`: `createFullBackup(name)`, `pollJob(jobId)`
  - Backup name: `sd-swap-clone-{YYYY-MM-DD}` for easy identification in onboarding
  - Use `background: true`, poll `GET /jobs/{jobId}` every 2s, extract slug from `reference` field
  - After backup completes: verify `/backup/{slug}.tar` exists on mapped volume
- `injector.ts`:
  - `findDataPartition(device)` → `Bun.$` lsblk -nro NAME,LABEL /dev/sdX filtered for hassos-data
  - `Bun.$` mount -t ext4 /dev/sdXN /mnt/newsd
  - `Bun.$` mkdir -p /mnt/newsd/supervisor/backup/
  - Copy `/backup/{slug}.tar` → `/mnt/newsd/supervisor/backup/{slug}.tar` (Bun file I/O)
  - Progress: track bytes copied vs total file size via chunked copy (e.g. 1MB chunks)
  - `Bun.$` sync && umount /mnt/newsd in `finally` block
- After successful inject: delete `/data/haos.img.xz` to free disk space

### Step 5: Orchestrator + API endpoint
- Wire stages 1→4 into `POST /api/start-clone`:
  - Stage 0: pre-flight checks (space, device validation, acquire lock)
  - Stages 1-4: run sequentially, stream progress via WebSocket
- `GET /api/jobs/{id}` for polling fallback
- Error cleanup per stage (see Error Handling section)

### Step 6: Frontend (TanStack Start SPA)
- Scaffold with official CLI: `pnpm create @tanstack/start@latest frontend/`
  (do NOT manually create routes or project structure — use what the CLI generates)
- Install additional deps: `tailwindcss`, `shadcn/ui` (configured with Base UI, not Radix)
- Configure SPA/static preset in `app.config.ts` (no SSR server)
- Add project-specific components into the scaffolded structure:
  - DeviceSelect, ConfirmDialog, Progress, SwapNow screen components
  - shadcn/ui primitives (button, card, dialog, progress, alert)
- State machine in the index route drives screen transitions
- `lib/api.ts`: typed fetch wrappers (relative URLs for ingress compatibility)
- `lib/ws.ts`: WebSocket client with auto-reconnect for live progress
- `lib/sse.ts`: EventSource for hotplug device add/remove events
- On page load: check `/api/jobs/current` → reconnect to in-progress job if any
- Error states: show what failed per stage, offer retry
- Build: `pnpm build` → output in `frontend/dist/` → Dockerfile copies to `/var/www/`

---

## Error Handling & Cleanup

Each stage has specific failure modes and cleanup requirements:

| Stage | Failure mode | Cleanup action |
|-------|-------------|----------------|
| 0 Pre-flight | Not enough disk space | Show error with required vs available space. No cleanup needed. |
| 0 Pre-flight | Device removed before start | Show error. No cleanup needed. |
| 1 Backup | Supervisor API error / timeout | Release clone lock. Show error with Supervisor response. |
| 2 Download | Network error mid-download | Delete partial `/data/haos.img.xz`. Release lock. Offer retry. |
| 2 Download | Checksum mismatch | Delete corrupted file. Release lock. Show "download corrupted, retry". |
| 3 Flash | dd error / device removed | Card is in undefined state — warn user "card may be unusable". Release lock. |
| 3 Flash | partprobe fails | Non-fatal — retry once, then attempt lsblk anyway. |
| 4 Inject | Mount fails | Check if partition exists (`blkid`). Release lock. Show error. |
| 4 Inject | Copy fails (disk full on new card) | `umount /mnt/newsd` in finally block. Release lock. |
| 4 Inject | Any error | Always run `umount /mnt/newsd` in finally block. |

**Global rule:** The clone lock is released in a `finally` block wrapping the entire clone operation. No stage failure should leave the lock held.

**Partial download reuse:** If `/data/haos.img.xz` exists and checksum passes, skip download (cache hit). Delete after successful flash to free space.

---

## API Schemas

### `GET /api/devices` response
```json
{
  "devices": [
    {
      "name": "sda",
      "path": "/dev/sda",
      "size": 64424509440,
      "size_human": "64 GB",
      "vendor": "Generic",
      "model": "USB3.0 CRW",
      "tran": "usb",
      "serial": "00000001"
    }
  ]
}
```

### `GET /api/system-info` response
```json
{
  "machine": "raspberrypi4-64",
  "board_slug": "rpi4-64",
  "os_version": "17.1",
  "os_version_latest": "17.1",
  "ip_address": "192.168.1.42",
  "free_space_bytes": 12300000000,
  "free_space_human": "12.3 GB"
}
```

### `POST /api/start-clone` request
```json
{
  "device": "/dev/sda"
}
```

### `POST /api/start-clone` response (success)
```json
{
  "job_id": "abc123"
}
```

### `POST /api/start-clone` response (pre-flight failure)
```json
{
  "error": "Not enough disk space. Need 600 MB, have 200 MB free."
}
```

### `GET /api/jobs/{id}` response
```json
{
  "job_id": "abc123",
  "status": "in_progress",
  "device": "/dev/sda",
  "stages": {
    "backup":   {"status": "completed", "progress": 100},
    "download": {"status": "in_progress", "progress": 45},
    "flash":    {"status": "pending", "progress": 0},
    "inject":   {"status": "pending", "progress": 0}
  },
  "error": null
}
```
Status values: `pending`, `in_progress`, `completed`, `failed`

### WebSocket `/ws/progress/{job_id}` — server→client messages
```json
{"stage": "backup", "progress": 78, "status": "in_progress"}
{"stage": "download", "progress": 100, "status": "completed"}
{"stage": "flash", "progress": 12, "status": "in_progress"}
{"type": "error", "stage": "download", "message": "Checksum mismatch"}
{"type": "done"}
```

### SSE `/api/events` — server→client events
```
event: device_added
data: {"name":"sda","path":"/dev/sda","size":64424509440,"model":"USB3.0 CRW"}

event: device_removed
data: {"name":"sda"}
```

---

## Backup Creation Flow (Stage 1 detail)

```
1. POST http://supervisor/backups/new/full
   Headers: Authorization: Bearer $SUPERVISOR_TOKEN
   Body: {"name": "sd-swap-clone-2026-02-18"}
   Response: {"result": "ok", "data": {"slug": "abc12345"}}

   Note: without "background: true", this blocks until backup completes.
   For large installs, use background mode:

   Body: {"name": "sd-swap-clone-2026-02-18", "background": true}
   Response: {"result": "ok", "data": {"job_id": "xxxxxxxx"}}

2. Poll: GET http://supervisor/jobs/{job_id}
   Response: {"result": "ok", "data": {"done": false, "progress": 45}}
   Poll every 2 seconds until done: true

3. When done, get the backup slug from job result:
   {"result": "ok", "data": {"done": true, "reference": "abc12345"}}
   The "reference" field contains the backup slug.

4. Backup file is now at: /backup/abc12345.tar (mapped volume)
   Verify it exists before proceeding to Stage 4.
```

---

## Frontend Implementation Details

### Scaffolding
Use the official TanStack Start CLI — do NOT manually create routes or project structure:
```bash
cd frontend
pnpm create @tanstack/start@latest .
```
The CLI generates the project skeleton including route files, config, and entry points.
After scaffolding, add the project-specific components and libraries.

### URL handling for HA ingress
HA ingress proxies through a path like `/api/hassio_ingress/TOKEN/`.
The frontend must use **relative URLs** so they resolve correctly:

```typescript
// API calls — use relative paths from the page URL
const devices = await fetch('api/devices').then(r => r.json());

// WebSocket — derive from current page location
const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${wsProto}//${location.host}${location.pathname}ws/progress/${jobId}`;
const ws = new WebSocket(wsUrl);

// SSE — same relative approach
const events = new EventSource('api/events');
```

### Page load behavior
On page load, the frontend must handle reconnection:
```
1. GET /api/jobs/current → check if a clone is already running
   - If a job exists with status "in_progress" → jump to Progress screen, reconnect WebSocket
   - If no active job → show Device Select screen
2. GET /api/devices → populate device list
3. GET /api/system-info → show board + version info
4. Connect to SSE /api/events → listen for hotplug updates
```

This requires one additional endpoint:
- `GET /api/jobs/current` → returns the active job (if any) or 404

---

## Pre-flight Disk Space Check (Stage 0 detail)

The disk space check verifies space for the **image download only** (~600 MB).
The backup is created by the Supervisor into its own managed storage — we don't control
where it goes, but it uses the same physical disk. If there isn't enough space for the
backup, the Supervisor API will return an error, which we surface to the user.

```typescript
import { statfsSync } from "node:fs";

function checkDiskSpace(minBytes = 600 * 1024 * 1024): { ok: boolean; free: number; required: number } {
  const stat = statfsSync("/data");
  const free = stat.bfree * stat.bsize;
  return { ok: free >= minBytes, free, required: minBytes };
}
```

For the target card size check, compare against the uncompressed image size:
```typescript
import { $ } from "bun";

async function getUncompressedSize(imagePath: string): Promise<number> {
  const output = await $`xz --list --robot ${imagePath}`.text();
  // Last line, 5th field = uncompressed size in bytes
  const lines = output.trim().split("\n");
  return parseInt(lines[lines.length - 1].split("\t")[4], 10);
}
```

Note: this check runs AFTER download (we need the file to read its header).
Before download, we can estimate using known image sizes (~1.2 GB uncompressed for Pi,
~1.8 GB for x86). Reject cards < 8 GB in device safety rules as a coarse guard.

---

## Resolved Questions

1. **~~Auto-restore marker~~** → RESOLVED: No HAOS provisioning mechanism for auto-restore exists. No `.provisioning` file, no auto-restore flag. Strategy: inject backup into `/supervisor/backup/` on the data partition. Supervisor auto-discovers it on boot. User selects "Restore from backup" in onboarding (uses official HA backup/restore feature).

2. **~~hassos-data partition number~~** → RESOLVED: Use `lsblk -nro NAME,LABEL /dev/sdX` scoped to the target device, filter for `LABEL=hassos-data`. Works regardless of partition number or board type.

3. **~~Ext4 partition writability~~** → RESOLVED: After fresh flash, the ext4 filesystem is clean. Mount directly with `mount -t ext4 -o rw`. Run `e2fsck -n` only if mount fails, as a diagnostic.

4. **~~Download size vs card size~~** → RESOLVED: Pre-flight check in Stage 0 compares `xz --list --robot` uncompressed size against target device size from `lsblk`.

5. **~~First boot data preservation~~** → RESOLVED: HAOS first boot runs `resize2fs` to grow hassos-data partition. This preserves existing files. Injected backup.tar survives first boot.

6. **~~Backup injection path~~** → RESOLVED: Copy to `/mnt/newsd/supervisor/backup/{slug}.tar`. The Supervisor scans this directory and auto-discovers `.tar` files containing valid `backup.json` metadata.

## Remaining Risks

1. **Network resilience during download**: 350 MB download with no resume. Strategy for v1: if download fails, delete partial file and let user retry. Strategy for v2: use `fetch` Range headers for resume support.

2. **`hassio_role: manager` needed?**: Currently `backup`. If we later want `/host/shutdown` to offer a one-click shutdown from the Swap Now screen, we'd need `manager` role. Defer — keep minimal permissions for v1.

3. **Large backups in onboarding**: Research suggests backups >1GB uploaded via onboarding UI may have issues, but our approach pre-places the file on disk (no upload). Needs real-device testing to confirm the backup appears in the onboarding restore list regardless of size.

## AppArmor Profile Updates Needed

The current `apparmor.txt` is missing permissions required by the plan:

```
# Bun runtime
/usr/local/bin/bun ix,
/usr/src/** r,

# Partition management (Stage 3-4)
/usr/sbin/partprobe ix,
/usr/bin/mount ix,
/usr/bin/umount ix,
/usr/sbin/e2fsck ix,
/usr/bin/findmnt ix,

# Backup volume access
/backup/** rw,

# Temp mount point for new SD
/mnt/newsd/** rw,
```

# ha-sd-swap — Full Implementation Plan

> End-to-end SD card migration: flash fresh HAOS + restore full backup, all from within Home Assistant.

---

## Vision

1. User plugs new SD card into USB adapter connected to the Pi
2. Add-on detects the card automatically (hotplug via SSE)
3. User clicks "Clone to new card"
4. Add-on orchestrates 4 stages automatically with live progress
5. User physically swaps cards → Pi boots → full HA clone running on new card

---

## The 4-Stage Workflow

```
STAGE 1: BACKUP           STAGE 2: DOWNLOAD           STAGE 3: FLASH
┌──────────────────┐      ┌────────────────────────┐   ┌────────────────────────┐
│ POST /backups/   │      │ GET /info → machine     │   │ xz -dc haos_rpi4-64-   │
│   new/full       │─────▶│ Build GitHub URL        │──▶│   17.1.img.xz          │
│ {background:true}│      │ Stream download to      │   │ | pv --numeric         │
│                  │      │   /data/haos.img.xz     │   │ | dd of=/dev/sdX bs=4M │
│ Poll /jobs/{id}  │      │ Emit % via WebSocket    │   │   conv=fdatasync,sync  │
│ until done       │      └────────────────────────┘   └────────────────────────┘
└──────────────────┘

STAGE 4: INJECT BACKUP + BOOT INSTRUCTIONS
┌──────────────────────────────────────────────────────────────────┐
│ Mount new SD's hassos-data partition (ext4, /dev/sdX8 typically) │
│ Copy backup.tar → /mnt/newsd/backup/                             │
│ Write /mnt/newsd/.sd-swap-restore with backup slug               │
│ Unmount                                                          │
│                                                                  │
│ Show "Swap the card now" UI with step-by-step instructions       │
│   → After swap + boot, HA onboarding detects the backup file     │
│   → User clicks restore in onboarding UI (1 click)              │
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
      ├── POST /backups/new/full  → create backup (needs role: backup)
      ├── GET  /jobs/{id}         → poll progress
      └── GET  /backups/{slug}/download → stream .tar

Container (s6-overlay, two services)
      ├── nginx (port 8099)  ← HA ingress proxy
      │     ├── /          → /var/www/      (static UI)
      │     ├── /api/*     → 127.0.0.1:8080 (FastAPI)
      │     └── /ws/*      → 127.0.0.1:8080 (WebSocket)
      │
      └── uvicorn (port 8080)  ← FastAPI backend
            ├── GET  /api/devices         list safe USB block devices
            ├── GET  /api/system-info     board, version, disk space
            ├── POST /api/start-clone     kick off all 4 stages as background job
            ├── GET  /api/jobs/{id}       poll overall job + per-stage state
            ├── GET  /api/events          SSE stream (hotplug, job updates)
            └── WS   /ws/progress         real-time progress stream
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
```
GET /info response field:  machine
  "raspberrypi4-64"  →  image: haos_rpi4-64-{ver}.img.xz
  "raspberrypi5-64"  →  image: haos_rpi5-64-{ver}.img.xz
  "raspberrypi3-64"  →  image: haos_rpi3-64-{ver}.img.xz
  "generic-x86-64"   →  image: haos_generic-x86-64-{ver}.img.xz
  "generic-aarch64"  →  image: haos_generic-aarch64-{ver}.img.xz
  "odroid-n2"        →  image: haos_odroid-n2-{ver}.img.xz
  (etc — strip "raspberry" prefix, keep rest)

Mapping function:
  machine.replace("raspberrypi", "rpi")  → board slug for filename

Download URL:
  https://github.com/home-assistant/operating-system/releases/download/
    {version}/haos_{board_slug}-{version}.img.xz

Latest version:
  GET /os/info → version_latest field   (uses stable channel)
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

**For backup injection:** mount `/dev/sdX8` (hassos-data), copy backup.tar to `/backup/` directory inside.

### Flash Command Pipeline
```bash
# Get uncompressed size for progress tracking
UNCOMPRESSED=$(xz --list --robot /data/haos.img.xz | tail -1 | awk '{print $5}')

# Flash with progress
xz -dc /data/haos.img.xz \
  | pv --numeric --size "$UNCOMPRESSED" \
  | dd of=/dev/sdX bs=4M conv=fdatasync,sync status=none

# pv --numeric outputs plain integer % to stderr, one per second → easy WebSocket streaming
```

### Device Safety Rules
```python
def is_safe_target(dev: dict, boot_disk: str) -> bool:
    if dev['name'] == boot_disk:  return False  # never flash boot device
    if dev.get('tran') != 'usb': return False   # USB devices only
    size = int(dev.get('size', 0))
    if size < 8 * 1024**3:       return False   # reject < 8GB (too small for HAOS)
    if size > 2 * 1024**4:       return False   # reject > 2TB (probably not an SD card)
    return True

def get_boot_disk() -> str:
    root = run(['findmnt', '--noheadings', '--output', 'SOURCE', '--target', '/']).stdout
    pkname = run(['lsblk', '--noheadings', '--output', 'PKNAME', '--nodeps', root]).stdout
    return pkname or root.removeprefix('/dev/')
```

---

## Files to Build

### Backend (`sd-swap/app/`)

```
app/
├── main.py          FastAPI app, all routes, startup/shutdown lifecycle
├── supervisor.py    Async HTTP client for Supervisor API
│                    - get_info() → machine, arch, hassos version
│                    - get_os_info() → version, version_latest, board
│                    - create_full_backup(name) → slug, job_id
│                    - poll_job(job_id) → progress, done, errors
│                    - download_backup(slug, dest_path) → streams to file
├── devices.py       Block device management
│                    - list_usb_devices() → filtered, safe list
│                    - get_boot_disk() → findmnt + lsblk PKNAME
│                    - watch_hotplug() → async generator, yields add/remove events
├── images.py        HAOS image management
│                    - machine_to_board_slug(machine) → "rpi4-64" etc
│                    - build_download_url(board_slug, version) → URL
│                    - download_image(url, dest, progress_cb) → streams, emits %
├── flasher.py       SD card flashing
│                    - flash(image_path, device, progress_cb) → xz|pv|dd pipeline
│                    - verify_flash(device) → basic sanity check
│                    - sync_device(device) → blockdev --flushbufs
├── injector.py      Backup injection into new SD
│                    - find_data_partition(device) → /dev/sdX8
│                    - mount_data_partition(partition, mountpoint)
│                    - inject_backup(backup_path, mountpoint)
│                    - unmount(mountpoint)
├── jobs.py          In-memory async job state machine
│                    - Job: id, stages[backup|download|flash|inject], overall %
│                    - subscribe(job_id) → async generator of state updates
└── events.py        SSE event bus (hotplug + job updates → frontend)
```

### Frontend (`sd-swap/rootfs/var/www/`)

Single-page app, 4 screens:

```
Screen 1: DEVICE SELECT
  ┌─────────────────────────────────────────┐
  │  SD Card Swap                           │
  │                                         │
  │  Connected USB devices:                 │
  │  ┌─────────────────────────────────┐   │
  │  │ 🟢 Generic USB3.0 CRW  64 GB   │   │  ← auto-detected
  │  │    /dev/sda  •  USB 3.0         │   │
  │  └─────────────────────────────────┘   │
  │                                         │
  │  System:  Raspberry Pi 4               │
  │  HAOS:    17.1 (latest: 17.1)          │
  │  Backup:  ~2.3 GB estimated            │
  │                                         │
  │  [ Start Clone → ]                      │
  └─────────────────────────────────────────┘

Screen 2: PROGRESS (live WebSocket)
  ┌─────────────────────────────────────────┐
  │  Cloning...  Do not unplug!             │
  │                                         │
  │  ① Backup     ████████████░░░  78%      │
  │  ② Download   ░░░░░░░░░░░░░░░   0%      │
  │  ③ Flash      ░░░░░░░░░░░░░░░   0%      │
  │  ④ Inject     ░░░░░░░░░░░░░░░   0%      │
  └─────────────────────────────────────────┘

Screen 3: SWAP NOW
  ┌─────────────────────────────────────────┐
  │  ✅ Done! Swap your SD card now.        │
  │                                         │
  │  1. Power off the Pi                    │
  │  2. Remove current SD card             │
  │  3. Insert new SD card                  │
  │  4. Power on                            │
  │  5. Wait ~2 min for first boot          │
  │  6. Go to homeassistant.local           │
  │  7. Click "Restore from backup"         │
  │  8. Select "sd-swap-backup" → Restore   │
  └─────────────────────────────────────────┘
```

### New s6 Service for uvicorn

```
rootfs/etc/services.d/sd-swap-api/
├── run     # starts uvicorn on port 8080
└── finish  # standard s6 finish
```

### Updated Dockerfile

```dockerfile
ARG BUILD_FROM
FROM $BUILD_FROM

RUN apk add --no-cache \
    util-linux \      # lsblk, findmnt, blkid, blockdev
    coreutils \       # dd with conv=fdatasync
    xz \              # xz -dc decompression
    nginx \           # ingress proxy
    pv \              # progress metering (--numeric mode)
    jq \              # JSON in shell scripts
    python3 \         # FastAPI backend
    py3-pip \         # package installer
    e2fsprogs \       # ext4 mount for backup injection (stage 4)
    curl              # image download fallback / health checks

RUN pip install --no-cache-dir \
    fastapi \
    "uvicorn[standard]" \
    aiohttp \         # async Supervisor API client
    aiofiles          # async file I/O for streaming

COPY rootfs /
```

---

## Updated config.yaml Changes

Already applied:
- `hassio_role: backup` (was `default`) — unlocks all `/backups/*` write endpoints
- `map: - type: backup, read_only: false` — lets us read backup files to copy into new SD

---

## Implementation Sequence

### Step 1 (Next): Backend skeleton + device listing
- Create `sd-swap/app/` directory with `main.py`, `devices.py`, `supervisor.py`
- Add uvicorn s6 service
- Update Dockerfile to install Python + deps
- Test: `GET /api/devices` returns USB block devices, `GET /api/system-info` returns board + version

### Step 2: Download pipeline
- `images.py` — resolve machine→slug, build URL, stream download with `aiohttp`
- Progress emitted as bytes/total → percent

### Step 3: Flash pipeline
- `flasher.py` — async subprocess `xz|pv|dd`, stream pv stderr to WebSocket

### Step 4: Backup + injection
- `supervisor.py` — `POST /backups/new/full`, poll jobs, `GET /backups/{slug}/download`
- `injector.py` — mount sdX8, copy tar, unmount

### Step 5: Frontend
- Start with plain HTML + vanilla JS (no build step, served from `/var/www/`)
- WebSocket client for progress, EventSource for hotplug
- 3 screens: Device Select → Progress → Swap Now

---

## Open Questions / Risks

1. **Auto-restore marker**: No Supervisor API for auto-restoring on fresh boot.
   Strategy: inject backup.tar into hassos-data partition + show user the 1-click restore in onboarding UI.
   Investigate: does `/mnt/data/.provisioning` or any HAOS marker trigger auto-restore?

2. **hassos-data partition number**: Research confirms it's typically partition 8 on Pi. May vary by board.
   Strategy: after flash, scan all partitions of new SD with `blkid`, find the one with `LABEL=hassos-data`.

3. **Ext4 partition writability**: hassos-data may need `e2fsck -f` before mounting read-write.
   Strategy: run `e2fsck -n` (read-only check) first, then mount with `-o rw`.

4. **Download size vs card size**: Must verify the target SD card is large enough (≥ image uncompressed size).
   Strategy: check card size against image size before starting, show error if too small.

5. **Network resilience during download**: 350 MB download with no resume = pain.
   Strategy: `curl -C -` with `-o /data/haos.img.xz` for resume support; `aiohttp` with range requests.

6. **`hassio_role: manager` needed?**: Currently `backup`. If we want to call `/host/reboot` after injection,
   we need `manager`. Defer until Stage 4 is implemented — keep minimal permissions for now.

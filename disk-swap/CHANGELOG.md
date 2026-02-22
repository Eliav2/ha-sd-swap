## 0.5.8

- Fix flash: use `oflag=direct` instead of `conv=fdatasync,sync` so dd stays killable during cancel
- Add real-time speed display (MB/s) during download and flash stages
- Allow canceling clone even during flash/inject (shows warning instead of blocking)
- Detect protection mode: show warning banner with direct link to addon settings when protection mode is enabled
- Remove flash diagnostics code (no longer needed)

## 0.5.7

- Add flash error capture: non-numeric stderr lines from xz/pv/dd are collected and shown on failure
- Add flash diagnostics logging (device permissions, whoami, test write)
- AppArmor: add capability rules (sys_rawio, sys_admin, dac_override, dac_read_search) for block device access
- Add SYS_RAWIO and SYS_ADMIN privileged capabilities in config.yaml

## 0.5.3

- Image cache status: show "cached" badge for downloaded OS image with version, board, and size
- Discard cached image: add section in backup select screen to discard and re-download
- Relative time display for backups using date-fns ("3 minutes ago")
- Sort backups newest first

## 0.5.1

- Reorder flow: erase confirmation before backup selection

## 0.5.0

- Cancel operation: abort running clone and return to device selection
- Backup selection: choose from existing HA backups or create a new one
- Stage descriptions: each pipeline step shows explanatory text; download links to GitHub release
- Image caching: skip re-download when OS image already exists on disk
- Include database in backup
- Skip checksum verification when .sha256 file unavailable (HAOS doesn't publish them)

## 0.4.0

- Use manager Supervisor role for /jobs/* polling access
- Use `backup: hot` so Supervisor doesn't stop addon during clone
- Pipeline debug logging and crash handlers
- WebSocket fix: normalize double-slash paths from HA ingress
- Persist clone state across page navigation
- Add refresh button to device list
- Fix disk_free unit conversion (GB not bytes)

## 0.3.0

- Full clone pipeline: backup, download, flash, inject
- Real-time WebSocket progress for all stages
- Fix overlay rootfs detection in getBootDisk
- Normalize HA ingress double-slash paths
- Add mount/e2fsck packages for ext4 support

## 0.1.0

- Initial skeleton release
- Add-on repository structure with ingress web UI
- Block device enumeration placeholder
- HA OS image download placeholder

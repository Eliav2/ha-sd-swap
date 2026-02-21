# Development & Testing

## Prerequisites

- [UTM](https://mac.getutm.app) with HA OS VM running
- HA OS image: `haos_generic-aarch64` ([releases](https://github.com/home-assistant/operating-system/releases))
- Decompress `.qcow2.xz` before importing into UTM
- HA accessible at `http://homeassistant.local:8123`

## Add-on Repository Setup

1. In HA UI: **Settings → Add-ons → Add-on Store**
2. Click the three-dot menu (top right) → **Repositories**
3. Add: `https://github.com/eliav2/ha-sd-swap`
4. The "SD Card Swap" add-on appears in the store
5. Install it

## Development Loop

```
Edit code locally → Push to GitHub → Rebuild in HA → Check logs
```

### 1. Make changes locally

Edit files in `sd-swap/` as needed.

### 2. Push to GitHub

```bash
git add -A && git commit -m "description" && git push
```

### 3. Rebuild the add-on in HA

**Option A — From the UI:**
- Settings → Add-ons → SD Card Swap → Rebuild

**Option B — From SSH (faster):**
```bash
# First, enable the SSH add-on in HA:
#   Settings → Add-ons → Install "Terminal & SSH"
#   Configure a password, start the add-on

ssh root@homeassistant.local

# Rebuild and restart
ha addons rebuild local_sd_swap
ha addons restart local_sd_swap

# Tail logs
ha addons logs local_sd_swap --follow
```

### 4. Open the add-on UI

- Settings → Add-ons → SD Card Swap → **Open Web UI**
- Or via the sidebar if `panel_icon` / `panel_title` are set in config.yaml

## Useful HA CLI Commands (via SSH)

```bash
ha addons info local_sd_swap       # add-on status and config
ha addons logs local_sd_swap       # view logs
ha addons restart local_sd_swap    # restart without rebuild
ha addons rebuild local_sd_swap    # full rebuild from repo
ha supervisor logs                 # supervisor logs (for API issues)
ha host info                       # host system info
ha os info                         # HA OS version info
```

## USB Device Testing

For testing stages 3 (flash) and 4 (inject), you need a physical USB SD card reader:

1. Plug a USB SD card reader into your Mac
2. In the UTM VM toolbar, click the USB icon
3. Attach the card reader to the VM
4. It appears as `/dev/sdX` inside the VM

Note: the Mac's built-in SD card slot cannot be passed through — use an external USB reader.

## What Can Be Tested Without Hardware

| Feature | Hardware needed? |
|---|---|
| Supervisor API (backup, system-info) | No |
| Image download + checksum | No |
| Frontend UI (all 4 screens) | No |
| WebSocket/SSE progress updates | No |
| Job state machine | No |
| Device listing (empty list) | No |
| Flash (dd pipeline) | Yes — USB SD reader |
| Inject (mount + copy backup) | Yes — USB SD reader |

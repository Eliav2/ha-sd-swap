# Development & Testing

## Prerequisites

- [UTM](https://mac.getutm.app) with HA OS VM running
- HA OS image: `haos_generic-aarch64` ([releases](https://github.com/home-assistant/operating-system/releases))
- Decompress `.qcow2.xz` before importing into UTM
- HA accessible at `http://homeassistant.local:8123`

## Local Development

The fastest workflow uses Bun locally with mock data:

```bash
cd disk-swap
bun dev    # starts on http://localhost:8099 with hot reload + mock data
```

This uses `DEV=1` to load mock USB devices and system info. No HA VM needed for API/frontend work.

## App Repository Setup

1. In HA UI: **Settings → Apps → App Store**
2. Click the three-dot menu (top right) → **Repositories**
3. Add: `https://github.com/Eliav2/ha-disk-swap`
4. The "Disk Swap" app appears in the store
5. Install it

## Integration Testing (HA VM)

```
Edit code locally → Push to GitHub → Rebuild in HA → Check logs
```

### 1. Make changes locally

Edit files in `disk-swap/` as needed.

### 2. Push to GitHub

```bash
git add -A && git commit -m "description" && git push
```

### 3. Rebuild the app in HA

**Option A — From the UI:**
- Settings → Apps → Disk Swap → Rebuild

**Option B — From SSH (faster):**
```bash
ssh root@192.168.64.2 -p 22

# Reload store, update, start
ha store reload
ha apps update <slug>
ha apps start <slug>
ha apps logs <slug>
```

### 4. Open the app UI

- Settings → Apps → Disk Swap → **Open Web UI**
- Or via the sidebar panel "Disk Swap"

## Useful HA CLI Commands (via SSH)

```bash
ha apps info <slug>         # app status and config
ha apps logs <slug>         # view logs
ha apps restart <slug>      # restart without rebuild
ha supervisor logs          # supervisor logs (for API issues)
ha host info                # host system info
ha os info                  # HA OS version info
```

## USB Device Testing

For testing flash and inject stages, you need a physical USB storage device:

1. Plug a USB device (SD reader, USB stick, USB SSD) into your Mac
2. In the UTM VM toolbar, click the USB icon
3. Attach the device to the VM
4. It appears as `/dev/sdX` inside the VM

Note: the Mac's built-in SD card slot cannot be passed through — use an external USB device.

## What Can Be Tested Without Hardware

| Feature | Hardware needed? |
|---|---|
| Supervisor API (backup, system-info) | No |
| Image download + checksum | No |
| Frontend UI (all screens) | No |
| WebSocket/SSE progress updates | No |
| Job state machine | No |
| Device listing (empty list) | No |
| Flash (dd pipeline) | Yes — USB device |
| Inject (mount + copy backup) | Yes — USB device |

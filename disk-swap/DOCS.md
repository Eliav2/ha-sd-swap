# Home Assistant App: Disk Swap

## Overview

Disk Swap lets you flash Home Assistant OS to any USB storage device directly
from within Home Assistant. Plug in a USB stick, SD card via adapter, or USB SSD,
open the app UI, pick an image, flash, swap, and boot.

## Requirements

- A USB storage device (USB stick, SD card with USB adapter, USB SSD, etc.)
- The app needs **full device access** (granted automatically on install)

## How to use

1. Plug your USB storage device into your Home Assistant device
2. Start the Disk Swap app
3. Open the Web UI from the app page
4. The UI will detect available USB devices
5. Select the target device (be careful to pick the right one!)
6. Choose an HA OS image (latest release or custom URL)
7. Click Flash and wait for completion
8. Safely remove the device, swap, and reboot

## Security Warning

This app requires **full device access** because it needs to write raw
disk images to block devices. It will show a security warning in the HA UI.
This is expected and necessary for its functionality.

**Always verify you are flashing the correct device.** Writing to the wrong
device will destroy all data on it.

## Support

- [GitHub Repository](https://github.com/eliav2/ha-disk-swap)
- [Issue Tracker](https://github.com/eliav2/ha-disk-swap/issues)

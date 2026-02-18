# Home Assistant Add-on: SD Card Swap

## Overview

SD Card Swap lets you flash a new SD card with Home Assistant OS directly
from within Home Assistant. Plug in a new SD card via a USB adapter, open
the add-on UI, pick an image, flash, swap cards, and boot.

## Requirements

- A USB SD card reader/adapter
- A new SD card inserted into the reader
- The add-on needs **full device access** (granted automatically on install)

## How to use

1. Insert your new SD card into a USB card reader
2. Plug the USB card reader into your Home Assistant device
3. Start the SD Card Swap add-on
4. Open the Web UI from the add-on page
5. The UI will detect available block devices
6. Select the target SD card (be careful to pick the right device!)
7. Choose an HA OS image (latest release or custom URL)
8. Click Flash and wait for completion
9. Safely remove the USB reader, swap cards, and reboot

## Security Warning

This add-on requires **full device access** because it needs to write raw
disk images to block devices. It will show a security warning in the HA UI.
This is expected and necessary for its functionality.

**Always verify you are flashing the correct device.** Writing to the wrong
device will destroy all data on it.

## Support

- [GitHub Repository](https://github.com/eliav2/ha-sd-swap)
- [Issue Tracker](https://github.com/eliav2/ha-sd-swap/issues)

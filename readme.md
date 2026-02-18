# ha-sd-swap

A Home Assistant App(add-on) for end-to-end SD card migration — directly on the Raspberry Pi, no PC required.

## The Problem

Migrating to a new SD card normally means taking your Pi offline, finding a computer, and using tools like Raspberry Pi Imager or Balena Etcher. There's no way to do it from within Home Assistant itself.

## The Solution

`ha-sd-swap` lets you plug a new SD card into your Pi via a USB adapter and flash it with a fresh HA OS image — all from the HA UI. Once done, simply swap the cards and boot.

## How It Works

1. Plug your new SD card in via USB adapter
2. Open the add-on UI — it detects the new card automatically
3. Choose your image (latest HA OS or custom)
4. Flash, verify, swap, done

## Status

🚧 Early experiment / work in progress

# ha-disk-swap

A Home Assistant App for end-to-end disk migration — directly on the device, no PC required.

## The Problem

Migrating to a new storage device normally means taking your system offline, finding a computer, and using tools like Raspberry Pi Imager or Balena Etcher. There's no way to do it from within Home Assistant itself.

## The Solution

`ha-disk-swap` lets you plug any USB storage device (SD card via adapter, USB stick, USB SSD) into your HA device and flash it with a fresh HA OS image — all from the HA UI. Once done, simply swap and boot.

## How It Works

1. Plug your new storage device in via USB
2. Open the app UI — it detects the device automatically
3. Choose your image (latest HA OS or custom)
4. Flash, verify, swap, done

## Status

Early experiment / work in progress

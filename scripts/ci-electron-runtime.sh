#!/usr/bin/env bash
set -euo pipefail
# These tests assert native maximize and window security, so Xvfb alone is
# insufficient. Use a real window manager; retain the existing assertions.
openbox > "${RUNNER_TEMP:-/tmp}/colorful-life-openbox.log" 2>&1 &
window_manager_pid=$!
trap 'kill "$window_manager_pid" 2>/dev/null || true' EXIT
for attempt in {1..50}; do
  if wmctrl -m >/dev/null 2>&1; then break; fi
  sleep 0.1
done
wmctrl -m
for gate in test:electron-runtime test:orders-runtime test:inventory-runtime test:security-runtime test:development-runtime; do
  npm run "$gate"
done

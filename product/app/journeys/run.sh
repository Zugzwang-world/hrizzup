#!/usr/bin/env bash
# The app's journeys (Maestro) on the Android emulator that is running, at a phone size and
# then a tablet size, with a screenshot of each screen at each size, and then the app's cold
# start timed and compared with main's (startup.sh).
#
#   bash product/app/journeys/run.sh <the app's .apk> <folder for results and screenshots>
#
# The emulator is a phone (Pixel 7). For the tablet size, Android's own display override
# (`wm size` and `wm density`) turns its screen into an 800 by 1280 point tablet, so the app
# lays itself out as on a tablet; the override is undone at the end.
set -euo pipefail
apk="$1"
out="$2"
flows="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$out"

# A just-booted emulator on a small CI machine is slow, and Android's own apps (the launcher)
# can stop responding for a while; their "isn't responding" dialog would cover the app under
# test. Android's test setting hides such dialogs, and any already open is closed.
adb shell settings put global hide_error_dialogs 1
adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS > /dev/null 2>&1 || true

adb install -r "$apk"

# Google Play services on the emulator brings its settings up to date a minute or two after the
# emulator starts, by restarting its own processes, and Android then stops every app that was
# using its font service, as a web view does (the bot check: seen in App journeys on
# 10 November 2026, about a minute into the journeys, on every run). So the journeys start once
# that restart is behind them: once its processes have changed and then stayed put for 20
# seconds, or after 3 minutes whatever happens.
settle_play_services() {
  local last now changed=false stable=0 waited=0
  # `|| true`: pidof answers 1 when a process isn't running, which mustn't end the script.
  last="$(adb shell pidof com.google.android.gms.persistent com.google.android.gms 2>/dev/null | tr -d '\r' || true)"
  while [ "$waited" -lt 180 ]; do
    sleep 5
    waited=$((waited + 5))
    now="$(adb shell pidof com.google.android.gms.persistent com.google.android.gms 2>/dev/null | tr -d '\r' || true)"
    if [ "$now" != "$last" ]; then
      changed=true
      stable=0
      last="$now"
    else
      stable=$((stable + 5))
    fi
    if [ "$changed" = true ] && [ "$stable" -ge 20 ] && [ -n "$now" ]; then
      echo "Google Play services restarted itself and settled, after $waited seconds."
      return 0
    fi
  done
  echo "Google Play services didn't restart within $waited seconds; the journeys start now."
}
settle_play_services

journeys() {
  maestro test --format junit --output "$out/$1.xml" --test-output-dir "$out/$1" \
    -e SIZE="$1" "$flows"
}

trap 'adb shell wm size reset; adb shell wm density reset' EXIT
adb shell wm size reset
adb shell wm density reset
journeys phone
adb shell wm size 1600x2560
adb shell wm density 320
journeys tablet
adb shell wm size reset
adb shell wm density reset
# The app's cold start, at the phone size, against main's (startup.sh says why not the phone
# budget itself): last, so the journeys at both sizes always run first.
bash "$flows/startup.sh" "$out" "${STARTUP_BASELINE:-}"

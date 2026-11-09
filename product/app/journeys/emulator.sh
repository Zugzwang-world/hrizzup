#!/usr/bin/env bash
# The Android emulator for the app's journeys (.github/workflows/app-journeys.yml), at the
# versions .github/scripts/tools.py pins.
#
#   bash product/app/journeys/emulator.sh install <emulator .zip> <system image .zip>
#   bash product/app/journeys/emulator.sh snapshot         # first boot; its snapshot is saved on the way out
#   bash product/app/journeys/emulator.sh run <command>    # boots from the snapshot, runs the command, shuts down
#
# `run` gives the command ANDROID_SERIAL (and adb on its PATH), turns Android's animations off,
# and exits with the command's own exit code once the emulator has shut down.
#
# Why not the android-emulator-runner action, which this replaces: it always asks Google's SDK
# manager for the newest emulator and system image, so a pinned version can't hold, and it
# reaches Google on every run even when everything is cached. This makes the same calls it
# made (the same AVD, options and boot checks), with the pinned files.
#
# Needs ANDROID_HOME (GitHub's runners set it), API_LEVEL, TARGET and PROFILE (the workflow's).
set -euo pipefail

: "${ANDROID_HOME:?}" "${API_LEVEL:?}" "${TARGET:?}" "${PROFILE:?}"
ARCH=x86_64
AVD=journeys
PORT=5554
BOOT_TIMEOUT=600 # seconds; a cold first boot on GitHub's machines takes a few minutes
OPTIONS=(-port "$PORT" -avd "$AVD" -no-window -gpu swiftshader_indirect -noaudio -no-boot-anim -camera-back none)
export ANDROID_AVD_HOME="$HOME/.android/avd"
export ANDROID_SERIAL="emulator-$PORT"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
emulator_pid=""

install() {
  local emulator_zip="$1" image_zip="$2" images="$ANDROID_HOME/system-images/android-$API_LEVEL/$TARGET"
  # GitHub's runners come with an emulator of their own; only the pinned one is left.
  rm -rf "$ANDROID_HOME/emulator" "$images/$ARCH"
  mkdir -p "$images"
  unzip -q "$emulator_zip" -d "$ANDROID_HOME"
  unzip -q "$image_zip" -d "$images"
  # The SDK's own tools (avdmanager) know an installed package by its package.xml, which
  # Google's archive leaves for the SDK manager to write. The system image's older
  # source.properties is enough for them; the emulator needs this record, written as the SDK
  # manager writes it, from the archive's own version.
  local revision major minor micro
  revision="$(grep -m1 '^Pkg.Revision=' "$ANDROID_HOME/emulator/source.properties" | cut -d= -f2 | tr -d '\r')"
  IFS=. read -r major minor micro <<< "$revision"
  printf '%s' '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' \
    '<ns2:repository xmlns:ns2="http://schemas.android.com/repository/android/common/02"' \
    ' xmlns:ns5="http://schemas.android.com/repository/android/generic/02">' \
    '<localPackage path="emulator" obsolete="false">' \
    '<type-details xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="ns5:genericDetailsType"/>' \
    "<revision><major>${major}</major><minor>${minor:-0}</minor><micro>${micro:-0}</micro></revision>" \
    '<display-name>Android Emulator</display-name></localPackage></ns2:repository>' \
    > "$ANDROID_HOME/emulator/package.xml"
  echo "Emulator $revision, system image android-$API_LEVEL $TARGET $ARCH revision" \
    "$(grep -m1 '^Pkg.Revision=' "$images/$ARCH/source.properties" | cut -d= -f2 | tr -d '\r')."
}

create_avd() {
  if [ -d "$ANDROID_AVD_HOME/$AVD.avd" ]; then
    return # restored with the snapshot
  fi
  mkdir -p "$ANDROID_AVD_HOME"
  echo no | "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" create avd --force -n "$AVD" \
    --package "system-images;android-$API_LEVEL;$TARGET;$ARCH" --device "$PROFILE"
  echo "hw.cpu.ncore=2" >> "$ANDROID_AVD_HOME/$AVD.avd/config.ini"
}

boot() {
  "$ANDROID_HOME/emulator/emulator" "${OPTIONS[@]}" "$@" &
  emulator_pid=$!
  local waited=0
  until [ "$(adb shell getprop sys.boot_completed 2> /dev/null | tr -d '\r')" = 1 ]; do
    if ! kill -0 "$emulator_pid" 2> /dev/null; then
      echo "The emulator stopped before it finished booting." >&2
      return 1
    fi
    if [ "$waited" -ge "$BOOT_TIMEOUT" ]; then
      echo "The emulator didn't finish booting within ${BOOT_TIMEOUT} seconds." >&2
      return 1
    fi
    sleep 2
    waited=$((waited + 2))
  done
  echo "Emulator booted (after about ${waited} seconds)."
  adb shell input keyevent 82
}

shut_down() {
  if [ -z "$emulator_pid" ] || ! kill -0 "$emulator_pid" 2> /dev/null; then
    return 0
  fi
  adb emu kill > /dev/null 2>&1 || true
  # Wait for it to exit, so a snapshot it saves on the way out is complete before it's cached.
  local waited=0
  while kill -0 "$emulator_pid" 2> /dev/null; do
    if [ "$waited" -ge 180 ]; then
      echo "The emulator didn't exit within 180 seconds; stopping it." >&2
      kill "$emulator_pid" 2> /dev/null || true
      break
    fi
    sleep 1
    waited=$((waited + 1))
  done
  emulator_pid=""
}
trap shut_down EXIT

case "${1:-}" in
  install)
    [ "$#" -eq 3 ] || { echo "install <emulator .zip> <system image .zip>" >&2; exit 2; }
    install "$2" "$3"
    ;;
  snapshot)
    create_avd
    boot
    shut_down
    echo "The emulator's snapshot is saved."
    ;;
  run)
    shift
    [ "$#" -gt 0 ] || { echo "run <command>" >&2; exit 2; }
    create_avd
    boot -no-snapshot-save
    adb shell settings put global window_animation_scale 0.0
    adb shell settings put global transition_animation_scale 0.0
    adb shell settings put global animator_duration_scale 0.0
    status=0
    "$@" || status=$?
    shut_down
    exit "$status"
    ;;
  *)
    sed -n '2,9p' "$0" >&2
    exit 2
    ;;
esac

#!/usr/bin/env bash
# The app's journeys (Maestro) on the Android emulator that is running, at a phone size and
# then a tablet size, with a screenshot of each screen at each size, and then the app's cold
# start timed and compared with main's (startup.sh).
#
#   bash product/app/journeys/run.sh <the app's .apk> <folder for results and screenshots> [phone|tablet|both]
#
# The emulator is a phone (Pixel 7). For the tablet size, Android's own display override
# (`wm size` and `wm density`) turns its screen into an 800 by 1280 point tablet, so the app
# lays itself out as on a tablet; the override is undone at the end.
#
# The third argument says which size's journeys this machine runs: `both` (the default, and what
# the App journeys check does), `phone` (only the phone's journeys) or `tablet` (the tablet's
# journeys, then the cold start at the phone size, which keeps the journeys right before it as
# `both` does). App journeys on two machines, beside the check (.github/workflows/app-journeys.yml),
# runs `phone` on one machine and `tablet` on the other. Anything else is refused at once, before
# anything is made or started.
set -euo pipefail
apk="$1"
out="$2"
size="${3-both}" # only a missing argument means both: an empty one (a size that came out empty) is refused
case "$size" in
  phone | tablet | both) ;;
  *) echo "The size to run is phone, tablet or both, not '$size'." >&2; exit 2 ;;
esac
flows="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$flows/../../.." && pwd)"
mkdir -p "$out"

# The signed-in journey's own account (sign-in-code.yaml), made for this run, and a fresh sign-in
# code for it just before each size's journeys (a new code cancels the last), by
# product/web/scripts/app-journey-account.ts, the only command given staging's keys, asked of
# Doppler by name (infra/doppler/named_keys.py; the job's names check comes first). No email is
# sent and the app holds no secret. Without a Doppler token (this Mac, by default) the signed-in
# journey is left out; the App journeys check always has one.
# The token itself goes only to named_keys.py, which gives the command the keys and not the
# token: it leaves this script's environment at once, so Maestro, adb and startup.sh never hold it.
doppler_token="${DOPPLER_TOKEN:-}"
unset DOPPLER_TOKEN
# The step's own log, which a command substitution doesn't capture.
exec 3>&1
# In GitHub's runners named_keys.py first prints a line telling the runner to hide each key's
# value (`::add-mask::…`): those go to the log itself, and only the command's own answer, its
# last line, comes back to the caller.
account() {
  local raw
  raw="$(DOPPLER_TOKEN="$doppler_token" python3 "$root/infra/doppler/named_keys.py" \
    SUPABASE_URL SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY \
    -- pnpm --silent --dir "$root/product/web" exec node scripts/app-journey-account.ts "$@")" \
    || return $? # set -e doesn't reach inside a command substitution, so a failure is passed on here
  { printf '%s\n' "$raw" | grep '^::add-mask::' || true; } >&3
  printf '%s\n' "$raw" | { grep -v '^::add-mask::' || true; } | tail -n 1
}
signed_in=false
if [ -n "$doppler_token" ]; then
  email="$(account create)"
  case "$email" in
    delivered+run-*@resend.dev) ;;
    *) echo "No account was made for the signed-in journey." >&2; exit 1 ;;
  esac
  signed_in=true
  echo "The signed-in journey's account for this run: $email"
elif [ -n "${GITHUB_ACTIONS:-}" ]; then
  echo "No Doppler token, so the signed-in journey can't run here." >&2
  exit 1
else
  echo "No Doppler token: the signed-in journey is left out."
fi

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
  local status=0 code=""
  if [ "$signed_in" = true ]; then
    code="$(account code "$email")"
    if ! [[ "$code" =~ ^[0-9]{6,10}$ ]]; then echo "No sign-in code was made." >&2; return 1; fi
    if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::add-mask::$code"; fi
    maestro test --format junit --output "$out/$1.xml" --test-output-dir "$out/$1" \
      -e SIZE="$1" -e EMAIL="$email" -e CODE="$code" \
      -e EMAIL_PATTERN="$(printf '%s' "$email" | sed 's/[.+]/\\&/g')" "$flows" || status=$?
    # The code was typed, so it's in the run's text files, which are kept as a public artifact:
    # it's wiped from them. A screenshot Maestro takes when a step fails may still show it in the
    # code field, so it's also cancelled (a new code is asked for and thrown away) before the
    # artifact is uploaded, whatever happened: what's left can't sign anyone in.
    { grep -rlIF "$code" "$out" 2>/dev/null || true; } | while read -r file; do
      sed -i.bak "s/$code/[code]/g" "$file" && rm -f "$file.bak" || true
    done
    account code "$email" > /dev/null || echo "The last code couldn't be cancelled; it runs out in 10 minutes." >&2
  else
    maestro test --format junit --output "$out/$1.xml" --test-output-dir "$out/$1" \
      -e SIZE="$1" --exclude-tags signed-in "$flows" || status=$?
  fi
  return "$status"
}

# Which sizes this machine runs, in the order the App journeys check always has: the phone's
# journeys, then the tablet's, then (when the tablet's ran, or both) the cold start at the phone
# size, against main's (startup.sh says why not the phone budget itself): last, so the journeys
# always run first. `phone` stops after the phone's journeys.
run_sizes() {
  adb shell wm size reset
  adb shell wm density reset
  if [ "$1" != tablet ]; then
    journeys phone
  fi
  if [ "$1" = phone ]; then
    return 0
  fi
  adb shell wm size 1600x2560
  adb shell wm density 320
  journeys tablet
  adb shell wm size reset
  adb shell wm density reset
  bash "$flows/startup.sh" "$out" "${STARTUP_BASELINE:-}"
}

trap 'adb shell wm size reset; adb shell wm density reset' EXIT
run_sizes "$size"

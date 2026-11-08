#!/usr/bin/env bash
# The app's own speed budget (blueprint section 14, the app's column): first content within 2
# seconds of a cold start. On the running emulator, the app is started cold 5 times; each time,
# the time from Android starting its process ("Start proc", Android's own log) to the app's
# first content (lib/startup.ts writes "hrizzup:first-content" once the first screen is drawn)
# is read from Android's log. The median counts.
#
#   bash product/app/journeys/startup.sh <folder for results>
#
# Writes startup.json and startup.md (a row for the pull request's table) to the folder, and
# fails when the median is over the budget plus the same small tolerance the website's load
# time gets (0.25 s).
set -euo pipefail
out="$1"
mkdir -p "$out"
app=com.hrizzup.app
budget_ms=2000
tolerance_ms=250
runs=5
times=()

for run in $(seq 1 "$runs"); do
  adb shell am force-stop "$app"
  adb logcat -c
  adb shell am start -n "$app/.MainActivity" >/dev/null
  for _ in $(seq 1 60); do
    if adb logcat -d -s ReactNativeJS:V | grep -c "hrizzup:first-content" > /dev/null; then break; fi
    sleep 0.5
  done
  log="$(adb logcat -d -v epoch)"
  # The first matching line's time, read by awk alone (no early-exiting grep in a pipeline,
  # which `set -o pipefail` would turn into a silent failure).
  started="$(awk -v app="$app" 'index($0, "Start proc") && index($0, ":" app "/") { print $1; exit }' <<< "$log")"
  shown="$(awk 'index($0, "hrizzup:first-content") { print $1; exit }' <<< "$log")"
  if [ -z "$started" ] || [ -z "$shown" ]; then
    echo "Run $run: couldn't read the start or the first content from Android's log" >&2
    exit 1
  fi
  ms="$(awk -v a="$started" -v b="$shown" 'BEGIN { printf "%d", (b - a) * 1000 }')"
  echo "Cold start $run of $runs: first content after $ms ms"
  times+=("$ms")
done

median="$(printf '%s\n' "${times[@]}" | sort -n | awk '{ a[NR] = $1 } END { print a[int((NR + 1) / 2)] }')"
passes=$([ "$median" -le $((budget_ms + tolerance_ms)) ] && echo true || echo false)
mark=$([ "$passes" = true ] && echo "✅" || echo "❌")
printf '{"runs": [%s], "medianMs": %s, "budgetMs": %s, "toleranceMs": %s, "passes": %s}\n' \
  "$(IFS=,; echo "${times[*]}")" "$median" "$budget_ms" "$tolerance_ms" "$passes" > "$out/startup.json"
printf '| App, cold start to first content (Android emulator) | %s %s.%02d s / %s.%02d s |\n' \
  "$mark" $((median / 1000)) $(((median % 1000) / 10)) $((budget_ms / 1000)) $(((budget_ms % 1000) / 10)) \
  > "$out/startup.md"
cat "$out/startup.md"
[ "$passes" = true ] || { echo "Over the app's budget: the median cold start is $median ms" >&2; exit 1; }

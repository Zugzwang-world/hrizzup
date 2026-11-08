#!/usr/bin/env bash
# The app's cold start on the CI emulator (blueprint section 14, the app's column: first content
# within 2 seconds of a cold start on a mid-range phone).
#
#   bash product/app/journeys/startup.sh <folder for results> [main's startup.json]
#
# The app is started cold 7 times; each time, the time from Android starting its process
# ("Start proc", Android's own log) to the app's first content (lib/startup.ts writes
# "hrizzup:first-content" once the first screen is drawn) is read from Android's log, and the
# median counts.
#
# The emulator is not a phone: on GitHub's 2 shared cores with software graphics, the same
# empty app took 2.5 to 4.3 s across five cold starts, and its median moved from 3.12 s to
# 4.21 s between two runs of the same app (9 November 2026). So the 2-second budget is shown
# next to the number, and what fails here is a clear regression against main's median on the
# same kind of emulator: more than 60% and more than 1.5 s slower, outside that noise. A
# paired comparison (main's build and this one, alternately on one emulator) would cancel the
# noise and allow a tighter margin (the Product brief's open questions). The 2-second budget
# itself is a phone's, measured on real phones.
#
# Writes startup.json and startup.md (a row for the pull request's table) to the folder.
set -euo pipefail
out="$1"
baseline="${2:-}"
mkdir -p "$out"
app=com.hrizzup.app
budget_ms=2000
runs=7
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
seconds() { awk -v ms="$1" 'BEGIN { printf "%.2f s", ms / 1000 }'; }

main_ms=""
if [ -n "$baseline" ] && [ -f "$baseline" ]; then
  main_ms="$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["medianMs"])' "$baseline")"
fi
if [ -n "$main_ms" ]; then
  change="$(awk -v a="$median" -v b="$main_ms" 'BEGIN { printf "%+.0f%%", (a - b) * 100 / b }')"
  regressed="$(awk -v a="$median" -v b="$main_ms" 'BEGIN { print ((a > b * 1.6 && a - b > 1500) ? "true" : "false") }')"
  versus="main: $(seconds "$main_ms"), $change"
else
  regressed=false
  versus="main not measured yet"
fi
passes=$([ "$regressed" = false ] && echo true || echo false)
mark=$([ "$passes" = true ] && echo "✅" || echo "❌")
printf '{"runs": [%s], "medianMs": %s, "budgetMs": %s, "mainMedianMs": %s, "passes": %s}\n' \
  "$(IFS=,; echo "${times[*]}")" "$median" "$budget_ms" "${main_ms:-null}" "$passes" > "$out/startup.json"
printf '| App, cold start to first content (CI emulator; the 2.00 s budget is a phone'"'"'s) | %s %s; %s |\n' \
  "$mark" "$(seconds "$median")" "$versus" > "$out/startup.md"
cat "$out/startup.md"
if [ "$regressed" = true ]; then
  echo "The app's cold start regressed: $median ms against main's $main_ms ms" >&2
  exit 1
fi

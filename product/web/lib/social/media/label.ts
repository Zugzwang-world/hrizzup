/**
 * The words that say how long a clip is (docs/social/media-design.md, 8.1). Pure: no environment, safe in
 * client code.
 */

/** A length in whole seconds as minutes and seconds, `0:58` or `2:31` (hours are minutes: a clip is five minutes at most); null when it isn't known. */
export function durationText(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** What a clip is called beside its picture: `Video, 0:58`, `Audio, 2:31`, and no time when it isn't known. */
export function clipLabel(kind: 'video' | 'audio', seconds: number | null): string {
  const name = kind === 'video' ? 'Video' : 'Audio';
  const time = durationText(seconds);
  return time === null ? name : `${name}, ${time}`;
}

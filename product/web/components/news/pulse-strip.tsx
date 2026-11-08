const DAY = 86_400_000;

type Props = { times: readonly string[]; now: number };

/**
 * A story's last day at a glance: a tick for each update, newest on the right. Busy stories
 * look busy and quiet ones look quiet, before anyone reads a word. One drawing, so it never
 * crowds the text around it.
 */
export function PulseStrip({ times, now }: Props) {
  const recent = times.map((t) => Date.parse(t)).filter((t) => now - t <= DAY && t <= now);
  const label =
    recent.length === 0
      ? 'No updates in the last day'
      : `${recent.length} ${recent.length === 1 ? 'update' : 'updates'} in the last day`;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox="0 0 240 14"
      preserveAspectRatio="none"
      className="block h-3.5 w-full"
    >
      <title>{label}</title>
      <rect x="0" y="6.5" width="240" height="1" className="fill-border" />
      {recent.map((t) => {
        const x = ((t - (now - DAY)) / DAY) * 236;
        return (
          <rect key={t} x={x.toFixed(1)} y="1" width="4" height="12" rx="1" className="fill-live" />
        );
      })}
    </svg>
  );
}

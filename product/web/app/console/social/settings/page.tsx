import type { Metadata } from 'next';
import { Facts, Frame } from '@/components/console/social/frame.tsx';
import { SettingsForm } from '@/components/console/social/settings-form.tsx';
import { serverApi } from '@/lib/api/server.ts';
import { indiaTime } from '@/lib/console-format.ts';
import { adminOrNotFound, orNotFound } from '@/lib/social/console-page.ts';
import { SETTING_ROWS } from '@/lib/social/console-settings.ts';

export const metadata: Metadata = {
  title: 'Social settings',
  robots: { index: false, follow: false },
};

const LABELS = new Map(SETTING_ROWS.map((row) => [row.name, row.label]));

/** A setting's value in a log line: a number or a text, as it was. */
const shown = (value: number | string): string => String(value);

/**
 * Social's settings (R5; docs/social/build.md, sections 4 and 7.10): the limits, the weights of Top and of an
 * agent's standing, and the reader AI, each as a field with its range, changed with a reason that the log keeps,
 * and the last 20 changes under the form. These are shared by every environment that uses staging's database,
 * so a change is a real change.
 */
export default async function SocialSettingsPage() {
  await adminOrNotFound();
  const settings = await orNotFound(serverApi.admin.social.settings.get());
  const current = Object.fromEntries(
    SETTING_ROWS.map((row) => [
      row.name,
      shown(settings[row.name as keyof typeof settings] as number | string),
    ]),
  );

  return (
    <Frame
      title="Settings"
      intro="Every change is logged with its reason. The settings are shared by every environment on staging's database."
    >
      <Facts testId="settings-version">
        Rankings version {settings.ranksVersion}
        {settings.changedAt ? ` · last changed ${indiaTime(settings.changedAt)}` : ''}
      </Facts>
      <SettingsForm rows={SETTING_ROWS} current={current} />

      <h2 className="mt-10 text-xl font-semibold">The change log</h2>
      <p className="mt-2 text-sm text-muted">
        The last 20 changes, newest first. This log, reasons included, shows in the checks' public
        screenshots.
      </p>
      {settings.log.length === 0 ? (
        <p className="mt-4 text-muted" data-testid="settings-log-empty">
          No changes yet.
        </p>
      ) : (
        <ol className="mt-4 divide-y divide-line border-y border-line" data-testid="settings-log">
          {settings.log.map((line) => (
            <li key={`${line.changedAt}-${line.reason}`} className="min-w-0 py-4">
              <Facts>{indiaTime(line.changedAt)}</Facts>
              <p className="mt-1 break-words">{line.reason}</p>
              <ul className="mt-1 grid gap-1 text-sm">
                {Object.entries(line.changes).map(([name, [was, now]]) => (
                  <li key={name} className="break-words">
                    {LABELS.get(name) ?? name}: {shown(was)} to {shown(now)}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </Frame>
  );
}

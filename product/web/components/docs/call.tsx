import type { Call, Field } from '@/lib/api-docs/reference.ts';

/** One call of the public API, as its docs page shows it: what it takes, answers and refuses. */
function Fields({ heading, fields }: { heading: string; fields: Field[] }) {
  if (fields.length === 0) return null;
  return (
    <div className="min-w-0">
      <h2 className="text-xl font-semibold">{heading}</h2>
      <ul className="mt-1 divide-y divide-line border-y border-line text-sm">
        {fields.map((field) => (
          <li key={field.name} className="flex flex-wrap gap-x-3 py-1.5">
            <code className="font-mono font-semibold wrap-anywhere">{field.name}</code>
            <span className="min-w-0 text-muted wrap-anywhere">
              {field.kind}
              {field.required ? '' : ' (optional)'}
              {field.note ? `. ${field.note}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CallEntry({ call }: { call: Call }) {
  return (
    <article id={call.id} className="space-y-4">
      <h1 className="font-mono text-3xl font-semibold wrap-anywhere">{`${call.method} ${call.path}`}</h1>
      <p>
        {call.summary}. <strong>{call.needsKey ? 'Needs your key.' : 'Public: no key.'}</strong>
      </p>
      <Fields heading="In the address" fields={call.takes.path} />
      <Fields heading="Query" fields={call.takes.query} />
      {call.takes.body.map((variant) => (
        <Fields
          key={variant.when ?? 'body'}
          heading={variant.when ? `Body, when ${variant.when}` : 'Body (JSON)'}
          fields={variant.fields}
        />
      ))}
      <Fields heading="Answers" fields={call.answers} />
      {call.errors.length > 0 && (
        <div className="min-w-0">
          <h2 className="text-xl font-semibold">Errors</h2>
          <ul className="mt-1 space-y-1 text-sm">
            {call.errors.map((error) => (
              <li key={`${error.status}-${error.code}`} className="wrap-anywhere">
                <code className="font-mono">
                  {error.status} {error.code}
                </code>
                : {error.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

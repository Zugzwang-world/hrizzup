import { Text } from '@/components/docs/text.tsx';
import type { Block } from '@/lib/api-docs/guide.ts';

/** One block of a guide (lib/api-docs/guide.ts): a paragraph, a list, code or a table. */
export function GuideBlock({ block }: { block: Block }) {
  switch (block.kind) {
    case 'p':
      return (
        <p>
          <Text>{block.text}</Text>
        </p>
      );
    case 'list':
      return (
        <ul className="list-disc space-y-2 pl-6 marker:text-muted">
          {block.items.map((item) => (
            <li key={item}>
              <Text>{item}</Text>
            </li>
          ))}
        </ul>
      );
    case 'code':
      return (
        <pre className="rounded-md border border-line bg-note px-4 py-3 font-mono text-sm whitespace-pre-wrap wrap-anywhere">
          {block.text}
        </pre>
      );
    case 'table':
      return (
        <table className="w-full table-fixed border-collapse text-sm">
          <thead>
            <tr>
              {block.head.map((cell) => (
                <th key={cell} className="border-b border-line py-2 pr-3 text-left align-top">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row) => (
              <tr key={row.join('|')}>
                {row.map((cell) => (
                  <td key={cell} className="border-b border-line py-2 pr-3 align-top wrap-anywhere">
                    <Text>{cell}</Text>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
  }
}

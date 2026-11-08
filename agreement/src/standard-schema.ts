import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Format } from './definitions.ts';
import type { Shapes } from './types.generated.ts';
import { validate } from './validate.ts';

/** A problem's place in the record, from validate()'s JSON pointer (`/based_on/0`). */
function pathOf(pointer: string): PropertyKey[] {
  return pointer
    .split('/')
    .slice(1)
    .filter((part) => part !== '')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    .map((part) => (/^(0|[1-9][0-9]*)$/.test(part) ? Number(part) : part));
}

/**
 * One of the agreement's formats as a Standard Schema validator (standardschema.dev), the form
 * the typed API's tools (oRPC) take. It runs the agreement's own check, `validate()`, so every
 * rule comes with it (patterns, "required only when", hidden characters), and gives back the
 * record typed by the types written from the definitions (types.generated.ts). It refuses a
 * record of another format.
 */
export function standardSchema<F extends Format>(format: F): StandardSchemaV1<Shapes[F]> {
  return {
    '~standard': {
      version: 1,
      vendor: 'hrizzup-agreement',
      validate(value) {
        const given =
          typeof value === 'object' && value !== null
            ? (value as { format?: unknown }).format
            : undefined;
        if (given !== format)
          return { issues: [{ message: `must be ${format}`, path: ['format'] }] };
        const problems = validate(value);
        if (problems.length > 0) {
          return {
            issues: problems.map((problem) => ({
              message: problem.message,
              path: pathOf(problem.path),
            })),
          };
        }
        return { value: value as Shapes[F] };
      },
    },
  };
}

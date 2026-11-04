import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { isFormat, parts, shapes } from './definitions.ts';

/** Something wrong with a record: where (a JSON pointer into it) and what. */
export type Problem = { path: string; message: string };

let ajv: Ajv2020 | undefined;

/**
 * One validator holding every definition, built on first use. Strict mode makes a mistake in
 * a definition itself (an unknown keyword, a broken reference, a loose type) fail loudly
 * instead of passing. Its `required` rule is the one left off: it would refuse the standard
 * "required only when…" pattern (`if`/`then`), which the definitions use on purpose.
 */
export function validator(): Ajv2020 {
  if (!ajv) {
    ajv = new Ajv2020({
      strictSchema: true,
      strictNumbers: true,
      strictTypes: true,
      strictTuples: true,
      strictRequired: false,
      allErrors: true,
      verbose: true,
    });
    addFormats(ajv);
    for (const schema of [...parts, ...Object.values(shapes)]) ajv.addSchema(schema);
  }
  return ajv;
}

/**
 * Hidden text that no single pattern catches the same way in every language, so it's refused
 * here, in code; code in another language adds the same three checks with its own Unicode data
 * (agreement/README.md, "Rules for every hand-over point"):
 * - any format, private-use or lone surrogate character (Unicode categories Cf, Co and Cs) but
 *   the zero-width joiner, which takes in the tag characters, and the extra variation selectors
 *   (U+E0100 to U+E01EF): invisible characters that can carry hidden text to an AI;
 * - variation selectors stacked two or more in a row (an emoji needs one at most);
 * - a zero-width joiner anywhere but inside an emoji: at either end of the text, next to
 *   another joiner, or next to a plain (ASCII) character, a new line included.
 * Unassigned characters (Cn) aren't refused: which ones are unassigned depends on each
 * language's Unicode version, so new emoji would be refused on older systems.
 */
const HIDDEN = [
  /(?!\u{200D})[\p{Cf}\p{Co}\p{Cs}]|[\u{E0100}-\u{E01EF}]/u,
  /[\u{FE00}-\u{FE0F}]{2}/u,
  /^\u{200D}|\u{200D}$|\u{200D}\u{200D}|[\n -~]\u{200D}|\u{200D}[\n -~]/u,
];

// Only runs on records whose shape has passed, so their depth is bounded by the definitions.
function hiddenText(value: unknown, path: string, problems: Problem[]) {
  if (typeof value === 'string') {
    if (HIDDEN.some((rule) => rule.test(value))) {
      problems.push({ path, message: 'must not hide characters' });
    }
  } else if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) hiddenText(item, `${path}/${i}`, problems);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) hiddenText(item, `${path}/${key}`, problems);
  }
}

/**
 * The agreement's format check for one record, against the definition its `format` names.
 * An empty list means the record matches. Every hand-over point runs this on what it receives,
 * and sets aside anything with problems (agreement/README.md, "Rules for every hand-over point").
 */
export function validate(record: unknown): Problem[] {
  const format =
    typeof record === 'object' && record !== null
      ? (record as { format?: unknown }).format
      : undefined;
  if (!isFormat(format)) {
    return [{ path: '/format', message: `must be one of ${Object.keys(shapes).join(', ')}` }];
  }
  const check = validator().getSchema(shapes[format].$id);
  if (!check) throw new Error(`The definition of ${format} isn't loaded`);
  if (!check(record)) {
    return (check.errors ?? []).map((e) => {
      // A pattern's own text is unreadable in a log; its building block's title says what's expected.
      const title = (e.parentSchema as { title?: unknown } | undefined)?.title;
      const message =
        e.keyword === 'pattern' && typeof title === 'string'
          ? `must be ${title.charAt(0).toLowerCase()}${title.slice(1)}`
          : (e.message ?? 'is not valid');
      return { path: e.instancePath || '/', message };
    });
  }
  const problems: Problem[] = [];
  hiddenText(record, '', problems);
  return problems;
}

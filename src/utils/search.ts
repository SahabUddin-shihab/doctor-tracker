/**
 * Search strategy: indexed token-prefix search.
 *
 * Every searchable document stores `searchTokens`, a deduplicated array of
 * normalised words (lower-cased, diacritics stripped, split on non-letters).
 * A multikey index on that array lets MongoDB answer a query such as
 * `{ searchTokens: { $regex: '^card' } }` with tight index bounds instead of
 * scanning the collection (a regex that is not anchored to the start of the
 * value cannot use index bounds).
 *
 * Trade-off: matching is word-prefix based ("card" finds "Cardiology"), not
 * arbitrary-substring based ("iolog" will not match). That is the behaviour
 * people expect from a type-ahead search box, and it stays fast at scale.
 */

const MAX_TOKENS_PER_DOCUMENT = 64;
const MAX_QUERY_TOKENS = 5;
const MAX_TOKEN_LENGTH = 40;

export function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip Latin combining diacritics
    .toLowerCase();
}

export function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter(Boolean)
    .map((token) => token.slice(0, MAX_TOKEN_LENGTH));
}

/** Digits-only phone token plus a national-format variant (+880171… → 0171…). */
export function phoneTokens(phone: string): string[] {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return [];
  const tokens = [digits];
  if (digits.startsWith('880') && digits.length > 3) tokens.push(`0${digits.slice(3)}`);
  return tokens;
}

export function emailTokens(email: string | null | undefined): string[] {
  if (!email) return [];
  return [...tokenize(email), normalizeText(email)];
}

export function uniqueTokens(...groups: string[][]): string[] {
  return [...new Set(groups.flat())].slice(0, MAX_TOKENS_PER_DOCUMENT);
}

/**
 * Builds a Mongo filter that requires every query word to prefix-match one of
 * the document's tokens. Returns null for an empty query. Tokens contain only
 * letters/digits so they are safe to place inside a RegExp source.
 */
export function buildPrefixFilter(term: string, field = 'searchTokens'): Record<string, unknown> | null {
  if (term.trim() === '') return null;
  const tokens = tokenize(term).slice(0, MAX_QUERY_TOKENS);
  // A query made only of punctuation (".*", "%%") has nothing searchable in it: it matches
  // nothing, rather than silently degrading into "show everything".
  if (tokens.length === 0) return { [field]: { $in: [] } };
  const clauses = tokens.map((token) => ({ [field]: { $regex: `^${token}` } }));
  return clauses.length === 1 ? (clauses[0] as Record<string, unknown>) : { $and: clauses };
}

/** Lower-cased, whitespace-collapsed key used for case-insensitive grouping and filtering. */
export function toKey(value: string): string {
  return normalizeText(value).replace(/\s+/g, ' ').trim();
}

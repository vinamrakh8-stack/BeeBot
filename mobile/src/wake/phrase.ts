/** Normalize a spoken phrase for local, word-boundary matching. */
export function normalizePhrase(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Match a configured wake phrase inside a local transcript.
 *
 * The phrase is checked with normalized word boundaries so "hey bee" does not
 * trigger on "hey been", while punctuation and casing are ignored.
 */
export function containsWakePhrase(transcript: string, phrase: string): boolean {
  const configured = normalizePhrase(phrase);
  if (!configured) return false;
  const spoken = normalizePhrase(transcript);
  if (!spoken) return false;
  return ` ${spoken} `.includes(` ${configured} `);
}

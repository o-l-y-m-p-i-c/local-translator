/**
 * Highlights all occurrences of `query` within `text` using <mark> tags.
 * Case-insensitive matching. Returns an array of React nodes.
 *
 * Usage:
 *   <HighlightText text={source} query={searchQuery} />
 *   <HighlightText text={key} query={searchQuery} />
 */
export function HighlightText({ text, query }: { text: string; query: string }) {
  const trimmed = query.trim();
  if (!trimmed) return <>{text}</>;

  const lowerText = text.toLowerCase();
  const lowerQuery = trimmed.toLowerCase();
  const parts: Array<{ text: string; match: boolean }> = [];
  let lastIndex = 0;
  let idx = lowerText.indexOf(lowerQuery, lastIndex);

  while (idx !== -1) {
    if (idx > lastIndex) {
      parts.push({ text: text.slice(lastIndex, idx), match: false });
    }
    parts.push({ text: text.slice(idx, idx + trimmed.length), match: true });
    lastIndex = idx + trimmed.length;
    idx = lowerText.indexOf(lowerQuery, lastIndex);
  }
  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), match: false });
  }

  return (
    <>
      {parts.map((part, i) =>
        part.match
          ? <mark key={i} style={{ background: "#fff3cd", padding: 0, borderRadius: 2 }}>{part.text}</mark>
          : <span key={i}>{part.text}</span>,
      )}
    </>
  );
}

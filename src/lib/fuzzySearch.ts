export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (q.length === 0) return 1;

  let score = 0;
  let qi = 0;
  let consecutive = 0;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += 1;
      consecutive++;
      score += consecutive;

      if (ti === 0 || t[ti - 1] === " ") score += 5;
      score += Math.max(0, 3 - ti);

      qi++;
    } else {
      consecutive = 0;
    }
  }

  return qi === q.length ? score : 0;
}

export function filterAndSort<T>(
  items: T[],
  query: string,
  getText: (item: T) => string,
  limit: number,
): Array<{ item: T; score: number }> {
  const scored: Array<{ item: T; score: number }> = [];

  for (const item of items) {
    const score = fuzzyScore(query, getText(item));
    if (score > 0) scored.push({ item, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

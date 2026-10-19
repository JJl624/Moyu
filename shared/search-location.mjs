export function lineOffset(text, line) {
  const target = Number.isFinite(line) ? Math.max(1, Math.trunc(line)) : 1;
  let offset = 0;
  for (let current = 1; current < target; current++) {
    const next = text.indexOf('\n', offset);
    if (next < 0) return text.length;
    offset = next + 1;
  }
  return offset;
}

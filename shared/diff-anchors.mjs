// Unchanged runs can be merged on just one side when a change is an insertion
// or deletion. Consume both unchanged streams to retain their actual offsets.
export function diffAnchors(diff) {
  const runs = side => {
    let position = 0;
    return diff[side].flatMap(part => {
      const from = position;
      position += part.value.length;
      return part.changed ? [] : [{ from, length: part.value.length }];
    });
  };
  const a = runs("left"), b = runs("right"), anchors = [];
  let i = 0, j = 0, offsetA = 0, offsetB = 0;
  while (i < a.length && j < b.length) {
    const length = Math.min(a[i].length - offsetA, b[j].length - offsetB);
    anchors.push({ a: a[i].from + offsetA, b: b[j].from + offsetB, length });
    offsetA += length;
    offsetB += length;
    if (offsetA === a[i].length) {
      i++;
      offsetA = 0;
    }
    if (offsetB === b[j].length) {
      j++;
      offsetB = 0;
    }
  }
  return anchors;
}
export function mapDiffOffset(anchors, offset, from = "a") {
  const to = from === "a" ? "b" : "a";
  let left = 0, right = anchors.length;
  while (left < right) {
    const mid = (left + right) >> 1;
    if (anchors[mid][from] <= offset) left = mid + 1;
    else right = mid;
  }
  const anchor = anchors[Math.max(0, left - 1)];
  return anchor ? anchor[to] + Math.min(anchor.length, Math.max(0, offset - anchor[from])) : undefined;
}

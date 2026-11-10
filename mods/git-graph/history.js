// A single detail item follows the expanded commit without changing commit keys.
export function inlineHistory(commits, selectedIndex, hasMore, rowHeight, detailHeight) {
  const expanded = Number.isInteger(selectedIndex) && selectedIndex >= 0 && selectedIndex < commits.length;
  const detailAt = expanded ? selectedIndex + 1 : -1;
  const count = commits.length + Number(hasMore) + Number(expanded);
  const commitIndex = i => i === detailAt ? -1 : expanded && i > detailAt ? i - 1 : i;
  return {
    count,
    detailAt,
    sizes: expanded ? Array.from({ length: count }, (_, i) => i === detailAt ? detailHeight : rowHeight) : rowHeight,
    commitIndex,
    key: i => i === detailAt ? `details:${commits[selectedIndex].hash}` : commits[commitIndex(i)]?.hash ?? "more",
  };
}

const identity = ({ root, on, commit, file }) => JSON.stringify([root, on ?? null, commit.hash, file.path]);

// A space has at most one replaceable tab; pinned tabs keep their own descriptors.
export function previewOpen(entries, liveTabs, diff, keep, token) {
  const live = new Set(liveTabs);
  const tabs = entries.filter(entry => !entry.tab || live.has(entry.tab));
  const pinned = tabs.find(entry => !entry.preview && identity(entry.diff) === identity(diff));
  if (pinned) return { entries: tabs, entry: pinned, create: false };
  const preview = tabs.find(entry => entry.preview);
  const entry = { token: preview?.token ?? token, tab: preview?.tab ?? null, pane: preview?.pane ?? null, diff, preview: !keep };
  return {
    entries: preview ? tabs.map(tab => tab.token === preview.token ? entry : tab) : [...tabs, entry],
    entry,
    create: !preview,
  };
}

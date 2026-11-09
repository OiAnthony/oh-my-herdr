// Select a directory and its machine together; never borrow a cwd from another terminal.
const machineOf = terminal => terminal?.includes("/") ? terminal.split("/")[0] : null;

export function selectTarget(focus, spaces, panes) {
  const space = spaces.find(s => s.id === focus?.space) ?? spaces.find(s => s.active);
  const tab = focus?.tab ?? space?.tabs.find(t => t.active)?.id ?? null;
  const pane = panes.find(p => p.pane === focus?.pane);
  let cwd, on;
  if (focus?.terminal) {
    on = machineOf(focus.terminal);
    cwd = focus.cwd || (pane?.terminal === focus.terminal ? pane.cwd : null);
  } else {
    const terminal = panes.find(p => p.tab === tab && p.terminal && p.cwd);
    cwd = terminal?.cwd || space?.folder || null;
    on = terminal ? machineOf(terminal.terminal) : space?.machine ?? null;
  }
  return { space: space?.id ?? null, tab, cwd: cwd || null, path: cwd || null, kind: "directory", on };
}

export async function resolveTarget(target, exec) {
  if (!target.path) throw new Error("No file or working directory in this space.");
  const result = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: target.path, on: target.on });
  const root = result.stdout.replace(/\r?\n$/, "");
  return result.code === 0 && root ? { ...target, path: root, kind: "repository" } : target;
}

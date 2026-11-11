import { binding } from "./model.js";

const leaf = node => node.kind === "terminal" || node.kind === "process-owner";
const textMatches = (node, query) => [node.name, node.id, node.address, node.paneName, node.paneId, node.machine]
  .some(value => String(value ?? "").toLowerCase().includes(query));

// Port searches also include collected listeners outside Herdr's managed OS trees.
function otherListeners(root, snapshot, port) {
  const managed = new Set(root.processes.map(process => process.pid));
  const visit = node => {
    if (node.kind === "terminal") node.processes.forEach(process => managed.add(process.pid));
    node.children.forEach(visit);
  };
  visit(root);
  const table = new Map((snapshot?.listeners?.processes ?? snapshot?.processes?.rows ?? []).map(process => [process.pid, process]));
  const owners = new Map();
  for (const listener of snapshot?.listeners?.rows ?? []) {
    if (String(listener.port) !== port || managed.has(listener.pid)) continue;
    const candidate = table.get(listener.pid);
    const process = listener.start && candidate?.start === listener.start ? candidate : null;
    let node = owners.get(listener.pid);
    if (!node) {
      const id = JSON.stringify(["port-process", root.machine, listener.pid, process?.start ?? null]);
      const chain = [], visited = new Set();
      let current = process;
      while (current && !visited.has(current.pid)) {
        visited.add(current.pid);
        chain.unshift(current);
        current = table.get(current.ppid);
      }
      if (!chain.length) chain.push({ pid: listener.pid, ppid: null, name: "Unknown process" });
      node = { id, kind: "process-owner", name: process?.name || "Unknown process", machine: root.machine,
        pid: listener.pid, children: [], metric: root.metric, at: snapshot?.listeners?.at,
        cpu: process?.cpu ?? null, memory: process?.memory ?? null, footprint: null, footprintAt: null,
        unknown: process ? 0 : 1, status: process ? snapshot.processes.state : "partial",
        stale: root.stale || !["ready", "partial"].includes(snapshot?.listeners?.state),
        identity: id, directChildren: null, descendants: null,
        processes: chain.map((entry, depth) => ({ ...entry, depth })),
        ports: [], portsAt: snapshot?.listeners?.at };
      owners.set(listener.pid, node);
    }
    const id = JSON.stringify([listener.family, listener.protocol, listener.address, listener.port, listener.socket ?? listener.pid]);
    if (!node.ports.some(existing => existing.id === id)) {
      node.ports.push({ ...listener, id, pids: [listener.pid], binding: binding(listener.address) });
    }
  }
  if (!owners.size) return null;
  return { id: JSON.stringify(["other-listeners", root.machine]), kind: "machine",
    name: `${root.name} / Other processes`, machine: root.machine, metric: root.metric,
    children: [...owners.values()], processes: [], ports: [], cpu: null, memory: null, unknown: 0 };
}

export function buildResourceTree(nodes, { filters = {}, snapshots = new Map() } = {}) {
  const name = (filters.name ?? "").trim().toLowerCase();
  const pid = (filters.pid ?? "").trim(), port = (filters.port ?? "").trim();
  const filtering = Boolean(name || pid || port);
  function project(source, inheritedName = false, pane = null) {
    if (source.kind === "pane" && source.children.length === 1 && source.children[0].kind === "terminal") {
      return project(source.children[0], inheritedName, source);
    }
    const node = pane ? { ...source, pane: pane.pane, paneName: pane.name, paneId: pane.id } : source;
    const named = !name || inheritedName || textMatches(node, name);
    const children = node.children.flatMap(child => child.kind === "tab" ? child.children : [child])
      .map(child => project(child, named)).filter(Boolean);
    if (!filtering) return { ...node, children };
    if (!leaf(node)) return children.length || (named && !pid && !port) ? { ...node, children } : null;

    const matching = node.processes.filter(process =>
      (named || String(process.name ?? "").toLowerCase().includes(name)) &&
      (!pid || String(process.pid) === pid) &&
      (!port || node.ports.some(listener => String(listener.port) === port && listener.pids.includes(process.pid))));
    const pids = new Set(matching.map(process => process.pid));
    const visible = new Set(pids), table = new Map(node.processes.map(process => [process.pid, process]));
    for (const process of matching) {
      let parent = table.get(process.ppid);
      while (parent && !visible.has(parent.pid)) {
        visible.add(parent.pid);
        parent = table.get(parent.ppid);
      }
    }
    const own = matching.length || (named && !port && (!pid || String(node.pid) === pid));
    if (!own && !children.length) return null;
    return { ...node, children, showDetails: Boolean(own),
      visibleProcesses: node.processes.filter(process => visible.has(process.pid)),
      visiblePorts: node.ports.filter(listener => (!port || String(listener.port) === port) && listener.pids.some(value => pids.has(value))) };
  }
  const roots = nodes.flatMap(root => {
    const children = [...root.children];
    if (port) {
      const other = otherListeners(root, snapshots.get(root.machine ?? ""), port);
      if (other) children.push(other);
    }
    return children;
  });
  return roots.map(node => project(node)).filter(Boolean);
}

export function resourceRows(tree, { expanded = new Set(), sort = "memory", currentSpace = null } = {}) {
  const compare = (a, b) => Number(b.kind === "space" && b.space === currentSpace) - Number(a.kind === "space" && a.space === currentSpace)
    || (sort === "name" ? a.name.localeCompare(b.name) : (b[sort] ?? -1) - (a[sort] ?? -1) || a.name.localeCompare(b.name));
  const rows = [];
  function walk(node, depth) {
    rows.push({ id: node.id, type: "node", node, depth });
    if (!expanded.has(node.id)) return;
    for (const child of [...node.children].sort(compare)) walk(child, depth + 1);
    if (!leaf(node) || node.showDetails === false) return;
    if (node.kind === "terminal") rows.push({ id: `${node.id}:detail`, type: "detail", node, depth: depth + 1 });
    for (const process of node.visibleProcesses ?? node.processes) {
      rows.push({ id: `${node.id}:pid:${process.pid}`, type: "process", node, process, depth: depth + 1 + (process.depth ?? 0) });
      for (const port of (node.visiblePorts ?? node.ports).filter(listener => listener.pids.includes(process.pid))) {
        rows.push({ id: `${node.id}:port:${process.pid}:${port.family}:${port.address}:${port.port}`, type: "port", node, port, depth: depth + 2 + (process.depth ?? 0) });
      }
    }
  }
  for (const node of [...tree].sort(compare)) walk(node, 0);
  return rows;
}

// Machine summaries already deduplicate nested roots and ambiguous terminal ownership.
export function processRows(nodes, { filters = {}, sort = "memory" } = {}) {
  const name = (filters.name ?? "").trim().toLowerCase(), pid = (filters.pid ?? "").trim();
  const rows = nodes.flatMap(node => {
    const fresh = !node.stale && ["ready", "partial"].includes(node.processState);
    return node.processes
      .filter(process => (!name || [process.name, node.machine].some(value => String(value ?? "").toLowerCase().includes(name)))
        && (!pid || String(process.pid) === pid))
      .map(process => ({ id: `process:${process.identity}`,
        type: "process", node, depth: 0,
        process: { ...process, cpu: fresh ? process.cpu : null, memory: fresh ? process.memory : null } }));
  });
  return rows.sort((a, b) =>
    (sort === "name" ? (a.process.name ?? "").localeCompare(b.process.name ?? "")
      : sort === "pid" ? a.process.pid - b.process.pid : (b.process[sort] ?? -1) - (a.process[sort] ?? -1))
    || (a.process.name ?? "").localeCompare(b.process.name ?? "") || a.id.localeCompare(b.id));
}

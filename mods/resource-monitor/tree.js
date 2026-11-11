import { binding } from "./model.js";
import { bytes, cpu, endpoint, clean } from "./format.js";

const leaf = node => node.kind === "terminal" || node.kind === "process-owner";
const terms = query => query.trim().toLowerCase().split(/\s+/).filter(Boolean);
const matches = (fields, words) => {
  const text = fields.map(clean).join(" ").toLowerCase();
  return words.every(word => text.includes(word));
};
const labels = node => [node.name, node.address, node.paneName, node.paneId, node.machine ?? "This computer"];
const processFields = process => [process.name, process.pid, process.ppid, process.start,
  cpu(process.cpu), bytes(process.memory), `RSS ${bytes(process.resident)}`];
const portFields = port => [endpoint(port), "TCP LISTEN", port.binding];

// Port searches also include collected listeners outside Herdr's managed OS trees.
function otherListeners(root, snapshot) {
  const managed = new Set(root.processes.map(process => process.pid));
  const visit = node => {
    if (node.kind === "terminal") node.processes.forEach(process => managed.add(process.pid));
    node.children.forEach(visit);
  };
  visit(root);
  const table = new Map((snapshot?.listeners?.processes ?? snapshot?.processes?.rows ?? []).map(process => [process.pid, process]));
  const owners = new Map();
  for (const listener of snapshot?.listeners?.rows ?? []) {
    if (managed.has(listener.pid)) continue;
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
        processState: process ? snapshot.processes.state : "partial",
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

export function buildResourceTree(nodes, { query = "", showPorts = false, snapshots = new Map() } = {}) {
  const words = terms(query);
  function project(source, path = [], pane = null) {
    if (source.kind === "pane" && source.children.length === 1 && source.children[0].kind === "terminal") {
      return project(source.children[0], path, source);
    }
    const node = pane ? { ...source, pane: pane.pane, paneName: pane.name, paneId: pane.id } : source;
    const context = [...path, ...labels(node)];
    const children = node.children.flatMap(child => child.kind === "tab" ? child.children : [child])
      .map(child => project(child, context)).filter(Boolean);
    if (!words.length) return { ...node, children };
    const fresh = !node.stale && ["ready", "partial"].includes(node.processState);
    const own = matches([...context, cpu(fresh ? node.cpu : null), bytes(fresh ? node.memory : null),
      node.metric, node.message, node.stale ? "stale" : ""], words);
    if (!leaf(node)) return children.length || own ? { ...node, children } : null;

    const visiblePorts = new Set();
    const matching = node.processes.filter(process => {
      const fields = [...context, ...processFields(process), node.metric, node.message, node.stale ? "stale" : ""];
      const processMatches = matches(fields, words);
      const ports = showPorts ? node.ports.filter(port => port.pids.includes(process.pid)
        && (processMatches || matches([...fields, ...portFields(port)], words))) : [];
      ports.forEach(port => visiblePorts.add(port));
      return processMatches || ports.length;
    });
    const pids = new Set(matching.map(process => process.pid));
    const visible = new Set(pids), table = new Map(node.processes.map(process => [process.pid, process]));
    for (const process of matching) {
      let parent = table.get(process.ppid);
      while (parent && !visible.has(parent.pid)) {
        visible.add(parent.pid);
        parent = table.get(parent.ppid);
      }
    }
    const details = matches([...context, node.directChildren === null ? "Child counts unknown"
      : `${node.directChildren} children ${node.descendants} descendants`,
    showPorts ? `${node.ports.length} listeners` : "", node.message], words);
    if (!own && !details && !matching.length && !children.length) return null;
    return { ...node, children, showDetails: Boolean(own || details || matching.length),
      visibleProcesses: node.processes.filter(process => visible.has(process.pid)),
      visiblePorts: node.ports.filter(port => visiblePorts.has(port)) };
  }
  const roots = nodes.flatMap(root => {
    const children = [...root.children];
    if (showPorts && words.length) {
      const other = otherListeners(root, snapshots.get(root.machine ?? ""));
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
export function processRows(nodes, { query = "", sort = "memory" } = {}) {
  const words = terms(query);
  const rows = nodes.flatMap(node => {
    const fresh = !node.stale && ["ready", "partial"].includes(node.processState);
    return node.processes
      .map(process => ({ id: `process:${process.identity}`,
        type: "process", node, depth: 0,
        process: { ...process, cpu: fresh ? process.cpu : null, memory: fresh ? process.memory : null } }))
      .filter(row => !words.length || matches([node.machine ?? "This computer", ...processFields(row.process),
        node.metric, node.message, node.stale ? "stale" : ""], words));
  });
  return rows.sort((a, b) =>
    (sort === "name" ? (a.process.name ?? "").localeCompare(b.process.name ?? "")
      : sort === "pid" ? a.process.pid - b.process.pid : (b.process[sort] ?? -1) - (a.process[sort] ?? -1))
    || (a.process.name ?? "").localeCompare(b.process.name ?? "") || a.id.localeCompare(b.id));
}

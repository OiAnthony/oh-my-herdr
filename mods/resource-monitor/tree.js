import { binding } from "./model.js";
import { bytes, cpu, endpoint, clean } from "./format.js";

const leaf = node => node.kind === "terminal" || node.kind === "system-process";
const terms = query => query.trim().toLowerCase().split(/\s+/).filter(Boolean);
const matches = (fields, words) => {
  const text = fields.map(clean).join(" ").toLowerCase();
  return words.every(word => text.includes(word));
};
const labels = node => [node.name, node.address, node.paneName, node.paneId, node.machine ?? "This computer"];
const processFields = process => [process.name, process.pid, process.ppid, process.start,
  cpu(process.cpu), bytes(process.memory), `RSS ${bytes(process.resident)}`];
const portFields = port => [endpoint(port), "TCP LISTEN", port.binding];

export function buildResourceTree(nodes, { query = "" } = {}) {
  const words = terms(query);
  function project(source, path = [], pane = null) {
    if (source.kind === "pane" && source.children.length === 1 && source.children[0].kind === "terminal") {
      return project(source.children[0], path, source);
    }
    const node = pane ? { ...source, pane: pane.pane, paneName: pane.name, paneId: pane.id } : source;
    const context = [...path, ...labels(node)];
    const children = node.children.flatMap(child => child.kind === "tab" ? child.children : [child])
      .map(child => project(child, context)).filter(Boolean);
    if (!words.length) return { ...node, children, visiblePorts: node.ports };
    const fresh = !node.stale && ["ready", "partial"].includes(node.processState);
    const own = matches([...context, cpu(fresh ? node.cpu : null), bytes(fresh ? node.memory : null),
      node.metric, node.message, node.stale ? "stale" : ""], words);
    if (!leaf(node)) return children.length || own ? { ...node, children } : null;

    const visiblePorts = new Set();
    const matching = node.processes.filter(process => {
      const fields = [...context, ...processFields(process), node.metric, node.message, node.stale ? "stale" : ""];
      const processMatches = matches(fields, words);
      const ports = node.ports.filter(port => port.pids.includes(process.pid)
        && (processMatches || matches([...fields, ...portFields(port)], words)));
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
    `${node.ports.length} listeners`, node.message], words);
    if (!own && !details && !matching.length && !children.length) return null;
    return { ...node, children, showDetails: Boolean(own || details || matching.length),
      visibleProcesses: node.processes.filter(process => visible.has(process.pid)),
      visiblePorts: node.ports.filter(port => visiblePorts.has(port)) };
  }
  const roots = nodes.flatMap(root => root.scope === "system" ? [root] : root.children);
  return roots.map(node => project(node)).filter(Boolean);
}

export function resourceRows(tree, { expanded = new Set(), sort = "memory", currentSpace = null } = {}) {
  const compare = (a, b) => Number(b.kind === "space" && b.space === currentSpace) - Number(a.kind === "space" && a.space === currentSpace)
    || (sort === "name" ? a.name.localeCompare(b.name) : (b[sort] ?? -1) - (a[sort] ?? -1) || a.name.localeCompare(b.name));
  const rows = [];
  function walk(node, depth) {
    rows.push({ id: node.id, type: "node", node, depth, ...(node.kind === "system-process" ? { process: node.process } : {}) });
    if (!expanded.has(node.id)) return;
    for (const child of [...node.children].sort(compare)) walk(child, depth + 1);
    if (!leaf(node) || node.showDetails === false) return;
    if (node.kind === "system-process") {
      for (const port of node.visiblePorts ?? []) {
        rows.push({ id: `${node.id}:port:${port.id}`, type: "port", node, process: node.process, port, depth: depth + 1 });
      }
      return;
    }
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

// Listener metadata belongs to the slower scan, never to a newer PID incarnation.
export function portRows(snapshots, { query = "", sort = "port", now = Date.now(), managed = null } = {}) {
  const words = terms(query), rows = [], seen = new Set();
  const allowed = managed === null ? null : new Set(managed.flatMap(node =>
    node.processes.filter(process => process.start).map(process => JSON.stringify([node.machine ?? "", process.pid, process.start]))));
  for (const [machine, snapshot] of snapshots) {
    const listeners = snapshot.listeners;
    const table = new Map((listeners?.processes ?? []).map(process => [process.pid, process]));
    const node = { machine: machine || null, at: listeners?.at, name: machine || "This computer",
      stale: !["ready", "partial"].includes(listeners?.state) || now - listeners.at > 15000,
      message: listeners?.message };
    for (const port of listeners?.rows ?? []) {
      if (allowed && (!port.start || !allowed.has(JSON.stringify([machine || "", port.pid, port.start])))) continue;
      const candidate = table.get(port.pid);
      const process = port.start && candidate?.start === port.start ? candidate
        : { pid: port.pid, name: "Unknown process", start: null };
      const id = JSON.stringify(["listener", machine, port.pid, port.start, port.family, port.address, port.port, port.socket]);
      if (seen.has(id)) continue;
      seen.add(id);
      if (words.length && !matches([node.name, process.name, process.pid, endpoint(port), "TCP LISTEN",
        binding(port.address), node.stale ? "stale" : ""], words)) continue;
      rows.push({ id, type: "listener", node, process, port, depth: 0 });
    }
  }
  return rows.sort((a, b) => (sort === "name" ? a.process.name.localeCompare(b.process.name)
    : sort === "pid" ? a.process.pid - b.process.pid : a.port.port - b.port.port) || a.id.localeCompare(b.id));
}

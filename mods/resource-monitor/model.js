// Pure snapshot model: Core parents locate tabs; only OS PPIDs attribute resources.
const key = (...parts) => JSON.stringify(parts);
const validNumber = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
const usable = channel => channel?.state === "ready" || channel?.state === "partial";
const machineOf = address => typeof address === "string" && address.includes("/") ? address.slice(0, address.indexOf("/")) : null;
const qualify = (value, machine) => value && machine && !value.includes("/") ? `${machine}/${value}` : value;
const processKey = (machine, p) => key(machine, p.pid, p.start ?? null);

export function binding(address) {
  const value = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (value === "*" || value === "0.0.0.0" || value === "::") return "all interfaces";
  if (value === "::1" || /^127\./.test(value)) return "loopback";
  return "specific address";
}

function portsFor(rows, machine, pids) {
  const result = new Map();
  for (const row of rows) {
    if (!row.start || row.start !== pids.get(row.pid)) continue;
    // A socket id proves sharing only within the same concrete endpoint.
    const endpoint = [machine, row.family, row.protocol, row.address, row.port];
    const id = key(...endpoint, row.socket ? ["socket", row.socket] : ["pid", row.pid]);
    const previous = result.get(id);
    if (previous) {
      if (!previous.pids.includes(row.pid)) previous.pids.push(row.pid);
    } else result.set(id, { ...row, machine, id, pids: [row.pid], binding: binding(row.address) });
  }
  return [...result.values()];
}

function sum(processes, field) {
  let total = 0, count = 0;
  for (const process of processes) if (validNumber(process[field])) { total += process[field]; count++; }
  return count ? total : null;
}

function base(kind, id, name, machine, metric, at) {
  return { id, kind, name, machine, metric, at, children: [], processes: [], ports: [],
    cpu: null, memory: null, unknown: 0, footprint: null, footprintAt: null,
    directChildren: null, descendants: null, identity: id, status: null, message: null };
}

export function buildResources({ terminals = [], spaces = [], panes = [], agents = [], snapshots = new Map(), now = Date.now(), maxSampleAge = 10000 }) {
  const machines = new Map(), locations = new Map(), tabs = new Map(), spaceIndex = new Map(), terminalIndex = new Map();
  const live = terminals.filter(t => t.state === "live");
  const records = new Map(live.map(t => [qualify(t.address, t.machine ?? null), t]));
  const agentsByAddress = new Map(agents.map(a => [a.address, a]));
  function ensureMachine(machine) {
    const id = machine ?? "";
    if (machines.has(id)) return machines.get(id);
    const snapshot = snapshots.get(id);
    const metric = snapshot?.processes?.metric ?? (snapshot?.platform === "windows" ? "Working Set" : "RSS");
    const node = base("machine", key("machine", machine), machine ?? "Local", machine, metric, snapshot?.processes?.at ?? null);
    node.snapshot = snapshot ?? null;
    node.host = snapshot?.host ?? null;
    node.platform = snapshot?.platform ?? null;
    node._snapshot = snapshot;
    machines.set(id, node);
    return node;
  }
  for (const space of spaces) {
    const machine = space.machine ?? machineOf(space.id);
    const root = ensureMachine(machine);
    const id = qualify(space.id, machine);
    const node = base("space", key("space", machine, id), space.name || id, machine, root.metric, root.at);
    node.space = id;
    root.children.push(node);
    spaceIndex.set(key(machine, id), node);
    for (const tab of space.tabs ?? []) {
      const tabId = qualify(tab.id, machine);
      const child = base("tab", key("tab", machine, tabId), tab.name || tabId, machine, root.metric, root.at);
      child.tab = tabId;
      child.space = id;
      node.children.push(child);
      tabs.set(key(machine, tabId), child);
    }
  }
  for (const pane of panes) {
    const machine = machineOf(pane.tab), tab = tabs.get(key(machine, pane.tab));
    if (!tab || !pane.pane) continue;
    const node = base("pane", key("pane", machine, pane.pane), pane.title || pane.mod || pane.pane, machine, tab.metric, tab.at);
    node.pane = pane.pane;
    node.tab = tab.tab;
    node.space = tab.space;
    node.mod = pane.mod ?? null;
    tab.children.push(node);
    if (pane.terminal) locations.set(qualify(pane.terminal, machine), { tab: pane.tab, pane: node });
  }
  for (const agent of agents) if (!locations.has(agent.address)) locations.set(agent.address, { tab: agent.tab, space: agent.space });
  function locate(address, machine) {
    const visited = new Set();
    let current = address;
    let fallback = null;
    while (current && !visited.has(current)) {
      visited.add(current);
      const record = records.get(current);
      const direct = locations.get(current);
      const tab = qualify(direct?.tab || record?.labels?.["herdr.tab"], machine);
      const space = qualify(direct?.space || record?.labels?.["herdr.space"], machine);
      const candidate = tabs.get(key(machine, tab));
      if (candidate && (!space || candidate.space === space)) return candidate;
      const knownSpace = spaceIndex.get(key(machine, space));
      if (!fallback && knownSpace) fallback = knownSpace;
      current = qualify(record?.parent, machine);
    }
    return fallback;
  }
  for (const terminal of live) {
    const machine = terminal.machine ?? machineOf(terminal.address);
    const root = ensureMachine(machine);
    const address = qualify(terminal.address, machine);
    let parent = locate(address, machine);
    if (!parent || parent.kind !== "tab") {
      const space = parent ?? (() => {
        let unknown = root.children.find(n => n.unassigned);
        if (!unknown) {
          unknown = base("space", key("space", machine, null), "Unassigned", machine, root.metric, root.at);
          unknown.unassigned = true;
          root.children.push(unknown);
        }
        return unknown;
      })();
      parent = space.children.find(n => n.unassigned);
      if (!parent) {
        parent = base("tab", key("tab", machine, space.id, null), "Unassigned", machine, root.metric, root.at);
        parent.unassigned = true;
        space.children.push(parent);
      }
    }
    const agent = agentsByAddress.get(address);
    const node = base("terminal", key("terminal", machine, address), terminal.name || agent?.title || terminal.title || terminal.program?.name || address, machine, root.metric, root.at);
    node.address = address;
    node.pid = terminal.pid ?? null;
    node.foregroundPid = terminal.foreground?.pid ?? null;
    node.agent = Boolean(agent || terminal.program?.agent);
    node._terminal = terminal;
    node.space = parent.space ?? null;
    node.tab = parent.tab ?? null;
    node.parent = qualify(terminal.parent, machine) ?? null;
    const pane = locations.get(address)?.pane;
    terminalIndex.set(address, { node, parent: pane ?? parent });
  }
  for (const { node, parent } of terminalIndex.values()) {
    let target = parent;
    // A pane is an explicit placement; otherwise keep Core ancestry within the same tab.
    if (parent.kind !== "pane") {
      const ancestor = terminalIndex.get(node.parent)?.node;
      const visited = new Set([node.address]);
      let current = ancestor;
      while (current && !visited.has(current.address)) {
        visited.add(current.address);
        current = terminalIndex.get(current.parent)?.node;
      }
      if (!current && ancestor && ancestor.machine === node.machine && ancestor.tab === node.tab && ancestor.space === node.space) target = ancestor;
    }
    target.children.push(node);
  }

  for (const root of machines.values()) {
    const snapshot = root._snapshot;
    const channel = snapshot?.processes;
    const stale = usable(channel) && (!validNumber(channel.at) || now - channel.at > maxSampleAge);
    const table = new Map(), children = new Map(), duplicatePids = new Set();
    for (const row of channel?.rows ?? []) {
      if (!Number.isInteger(row.pid) || row.pid <= 0) continue;
      if (table.has(row.pid)) {
        if (key(table.get(row.pid)) !== key(row)) duplicatePids.add(row.pid);
        continue;
      }
      table.set(row.pid, row);
    }
    for (const pid of duplicatePids) table.delete(pid);
    for (const process of table.values()) {
      if (!children.has(process.ppid)) children.set(process.ppid, []);
      children.get(process.ppid).push(process.pid);
    }
    for (const list of children.values()) list.sort((a, b) => a - b);
    const leaves = [];
    const collect = node => { if (node.kind === "terminal") leaves.push(node); node.children.forEach(collect); };
    collect(root);
    const roots = new Map();
    for (const node of leaves) if (Number.isInteger(node.pid) && node.pid > 0) {
      if (!roots.has(node.pid)) roots.set(node.pid, []);
      roots.get(node.pid).push(node);
    }
    function walk(pid, cutRoots) {
      const result = [], visited = new Set(), stack = [[pid, 0]];
      while (stack.length) {
        const [next, depth] = stack.pop();
        if (visited.has(next) || !table.has(next) || (depth && cutRoots && roots.has(next))) continue;
        visited.add(next);
        result.push({ ...table.get(next), machine: root.machine, identity: processKey(root.machine, table.get(next)), depth });
        const kids = children.get(next) ?? [];
        for (let i = kids.length - 1; i >= 0; i--) stack.push([kids[i], depth + 1]);
      }
      return result;
    }
    const footprintChannel = snapshot?.footprints;
    const footprintRows = new Map((usable(footprintChannel) ? footprintChannel.rows ?? [] : []).map(row => [row.pid, row]));
    const listeners = usable(snapshot?.listeners) ? snapshot.listeners.rows ?? [] : [];
    const conflictProcesses = [];
    for (const [pid, owners] of roots) if (owners.length > 1) conflictProcesses.push(...walk(pid, true));
    function metrics(node) {
      node.cpu = sum(node.processes, "cpu");
      node.memory = sum(node.processes, "memory");
      node.ports = portsFor(listeners, root.machine, new Map(node.processes.filter(p => p.start).map(p => [p.pid, p.start])));
      node.portsState = snapshot?.listeners?.state ?? "loading";
      node.portsAt = snapshot?.listeners?.at ?? null;
      node.portCount = node.portsState === "ready" ? node.ports.length : null;
      node.processState = channel?.state ?? "loading";
      node.stale = Boolean(stale || (!usable(channel) && channel?.at != null));
      node.at = channel?.at ?? null;
      const footprintAt = footprintChannel?.at;
      const freshFootprints = snapshot?.platform === "macos" && usable(footprintChannel) && validNumber(footprintAt) && now >= footprintAt && now - footprintAt <= 15000;
      for (const process of node.processes) {
        const row = footprintRows.get(process.pid);
        const valid = freshFootprints && !node.stale && process.start && row?.start === process.start && validNumber(row?.bytes);
        process.footprint = valid ? row.bytes : null;
        process.footprintAt = valid ? footprintAt : null;
      }
      let footprint = 0;
      const complete = node.processes.length > 0 && node.completeOwnership && !stale && freshFootprints && node.processes.every(process => {
        const row = footprintRows.get(process.pid);
        if (!process.start || row?.start !== process.start || !validNumber(row?.bytes)) return false;
        footprint += row.bytes;
        return true;
      });
      node.footprint = complete ? footprint : null;
      node.footprintAt = complete ? footprintAt : null;
      node.historyValid = usable(channel) && !stale && node.completeOwnership && node.processes.length > 0 && node.processes.every(p => p.start && validNumber(p.memory));
    }
    for (const node of leaves) {
      const terminal = node._terminal;
      const process = table.get(node.pid);
      const conflict = (roots.get(node.pid)?.length ?? 0) > 1;
      node.completeOwnership = channel?.state === "ready" && Boolean(process) && !conflict && duplicatePids.size === 0;
      const observedStart = process?.start ?? null;
      node.identity = key(node.id, node.pid, observedStart, terminal.program_started_ms ?? null, terminal.created_ms ?? null);
      if (!usable(channel)) {
        node.unknown = 1;
        node.status = channel?.state ?? "loading";
        node.message = channel?.message ?? "Waiting for process information";
        if (process && !conflict) {
          node.processes = walk(node.pid, true).map(p => ({ ...p, root: p.pid === node.pid, foreground: p.pid === node.foregroundPid }));
          node.directChildren = (children.get(node.pid) ?? []).filter(pid => pid !== node.pid).length;
          node.descendants = walk(node.pid, false).length - 1;
        }
      } else if (!process || conflict) {
        node.unknown = 1;
        node.status = conflict ? "conflict" : node.pid ? "missing" : "waiting";
        node.message = conflict ? "Multiple terminals share this root PID; ownership is ambiguous" : "Root process is not present in this snapshot";
      } else {
        node.processes = walk(node.pid, true).map(p => ({ ...p, root: p.pid === node.pid, foreground: p.pid === node.foregroundPid }));
        node.directChildren = (children.get(node.pid) ?? []).filter(pid => pid !== node.pid).length;
        node.descendants = walk(node.pid, false).length - 1;
        node.unknown = node.processes.filter(p => !p.start || !validNumber(p.cpu) || !validNumber(p.memory)).length;
        if (channel.state === "partial" || duplicatePids.size) node.unknown++;
        node.status = stale ? "stale" : node.unknown ? "partial" : "ready";
        node.message = channel.message ?? (stale ? "Process sample is stale" : node.unknown ? "Some process information is unknown" : null);
      }
      metrics(node);
      delete node._terminal;
    }
    function aggregate(node) {
      const summaries = node.children.map(aggregate);
      const unique = new Map();
      const own = node.kind === "terminal";
      if (own || usable(channel)) {
        if (own) for (const process of node.processes) unique.set(process.identity, process);
        for (const child of summaries) for (const process of child.processes) unique.set(process.identity, process);
        if (node === root) for (const process of conflictProcesses) unique.set(process.identity, process);
      }
      const unknown = summaries.reduce((total, child) => total + child.unknown, own ? node.unknown : 0);
      const completeOwnership = (!own || node.completeOwnership) && channel?.state === "ready" && summaries.every(child => child.completeOwnership);
      const identity = key(node.identity, summaries.map(child => child.identity).sort());
      // Logical descendants affect their enclosing groups, never their parent's OS attribution.
      if (own) return { processes: [...unique.values()], unknown, completeOwnership, identity };
      node.processes = [...unique.values()];
      node.unknown = unknown;
      if (!usable(channel) && node.unknown === 0) node.unknown = 1;
      node.completeOwnership = completeOwnership;
      node.identity = identity;
      node.status = !usable(channel) ? channel?.state ?? "loading" : stale ? "stale" : node.unknown ? "partial" : "ready";
      node.message = channel?.message ?? (node.unknown ? "Known subtotal; some members are unknown" : null);
      metrics(node);
      return node;
    }
    aggregate(root);
    delete root._snapshot;
  }
  return [...machines.values()];
}

// OS process nodes carry only their own readings; the machine sums each identity once.
export function buildSystemResources({ snapshots = new Map(), now = Date.now(), maxSampleAge = 10000 } = {}) {
  const machines = [];
  for (const [machineKey, snapshot] of snapshots) {
    const machine = machineKey || null, channel = snapshot?.processes;
    const metric = channel?.metric ?? (snapshot?.platform === "windows" ? "Working Set" : "RSS");
    const root = base("machine", key("system-machine", machine), machine ?? "Local", machine, metric, channel?.at ?? null);
    root.scope = "system";
    root.snapshot = snapshot;
    root.host = snapshot?.host ?? null;
    root.platform = snapshot?.platform ?? null;
    const fresh = usable(channel) && validNumber(channel.at) && channel.at <= now && now - channel.at <= maxSampleAge;
    const stale = Boolean((usable(channel) && !fresh) || (!usable(channel) && channel?.at != null));
    const table = new Map(), conflicts = new Set();
    for (const row of channel?.rows ?? []) {
      if (!Number.isInteger(row.pid) || row.pid <= 0) continue;
      if (table.has(row.pid)) {
        if (key(table.get(row.pid)) !== key(row)) conflicts.add(row.pid);
      } else table.set(row.pid, row);
    }
    for (const pid of conflicts) table.delete(pid);
    const nodes = new Map();
    const listeners = usable(snapshot?.listeners) ? snapshot.listeners.rows ?? [] : [];
    const footprintChannel = snapshot?.footprints;
    const footprints = new Map((usable(footprintChannel) ? footprintChannel.rows ?? [] : []).map(row => [row.pid, row]));
    const freshFootprints = fresh && snapshot?.platform === "macos" && validNumber(footprintChannel?.at)
      && footprintChannel.at <= now && now - footprintChannel.at <= 15000;
    for (const row of table.values()) {
      const process = { ...row, machine, identity: processKey(machine, row),
        cpu: fresh && validNumber(row.cpu) ? row.cpu : null,
        memory: fresh && validNumber(row.memory) ? row.memory : null };
      const footprint = footprints.get(row.pid);
      process.footprint = freshFootprints && row.start && footprint?.start === row.start && validNumber(footprint.bytes) ? footprint.bytes : null;
      process.footprintAt = process.footprint !== null ? footprintChannel.at : null;
      const node = base("system-process", key("system-process", machine, row.pid, row.start ?? null), row.name || `PID ${row.pid}`, machine, metric, root.at);
      node.pid = row.pid;
      node.process = process;
      node.processes = [process];
      node.cpu = process.cpu;
      node.memory = process.memory;
      node.footprint = process.footprint;
      node.footprintAt = process.footprintAt;
      node.unknown = !row.start || process.cpu === null || process.memory === null ? 1 : 0;
      node.completeOwnership = channel?.state === "ready" && conflicts.size === 0;
      node.historyValid = fresh && node.completeOwnership && Boolean(row.start) && process.memory !== null;
      node.ports = portsFor(listeners, machine, new Map(row.start ? [[row.pid, row.start]] : []));
      nodes.set(row.pid, node);
    }
    // Break one edge per PPID cycle. Every enumerable process remains reachable.
    const parents = new Map([...table.values()].map(row => [row.pid, nodes.has(row.ppid) ? row.ppid : null]));
    const done = new Set();
    for (const pid of nodes.keys()) {
      const path = new Set();
      let current = pid;
      while (current !== null && !done.has(current) && !path.has(current)) {
        path.add(current);
        current = parents.get(current);
      }
      if (path.has(current)) parents.set(current, null);
      for (const member of path) done.add(member);
    }
    for (const [pid, node] of nodes) (nodes.get(parents.get(pid)) ?? root).children.push(node);
    root.processes = [...nodes.values()].map(node => node.process);
    root.cpu = fresh ? sum(root.processes, "cpu") : null;
    root.memory = fresh ? sum(root.processes, "memory") : null;
    root.unknown = [...nodes.values()].reduce((total, node) => total + node.unknown, conflicts.size);
    if (channel?.state !== "ready") root.unknown++;
    root.completeOwnership = channel?.state === "ready" && conflicts.size === 0;
    root.historyValid = fresh && root.completeOwnership && root.processes.length > 0
      && root.processes.every(process => process.start && validNumber(process.memory));
    root.ports = portsFor(listeners, machine, new Map(root.processes.filter(process => process.start).map(process => [process.pid, process.start])));
    if (root.historyValid && root.processes.every(process => process.footprint !== null)) {
      root.footprint = sum(root.processes, "footprint");
      root.footprintAt = footprintChannel.at;
    }
    for (const node of [root, ...nodes.values()]) {
      node.processState = channel?.state ?? "loading";
      node.stale = stale;
      node.status = !usable(channel) ? node.processState : stale ? "stale" : node.unknown || channel.state === "partial" ? "partial" : "ready";
      node.message = channel?.message ?? (stale ? "Process sample is stale" : node.unknown ? "Known subtotal; some process information is unknown" : null);
      node.portsState = snapshot?.listeners?.state ?? "loading";
      node.portsAt = snapshot?.listeners?.at ?? null;
      node.portCount = node.portsState === "ready" ? node.ports.length : null;
    }
    machines.push(root);
  }
  return machines;
}

export class MemoryHistory {
  constructor() { this.entries = new Map(); }
  update(nodes, observedAt) {
    const present = new Set();
    const visit = node => {
      present.add(node.id);
      const identity = key(node.identity, node.metric);
      let entry = this.entries.get(node.id);
      if (!entry || entry.identity !== identity) {
        entry = { identity, at: -Infinity, values: [] };
        this.entries.set(node.id, entry);
      }
      const at = node.at ?? node.snapshot?.processes?.at;
      const valid = node.historyValid !== false && !node.stale && !["error", "unavailable", "loading", "stale", "conflict", "missing", "waiting"].includes(node.status);
      if (valid && validNumber(node.memory) && validNumber(at) && at <= observedAt && at > entry.at) {
        entry.values.push(node.memory);
        if (entry.values.length > 60) entry.values.shift();
        entry.at = at;
      }
      for (const child of node.children ?? []) visit(child);
    };
    nodes.forEach(visit);
    for (const id of this.entries.keys()) if (!present.has(id)) this.entries.delete(id);
  }
  get(nodeOrId) {
    const id = typeof nodeOrId === "string" ? nodeOrId : nodeOrId.id;
    const entry = this.entries.get(id);
    if (!entry || (typeof nodeOrId !== "string" && entry.identity !== key(nodeOrId.identity, nodeOrId.metric))) return [];
    return entry.values.slice();
  }
  clear() { this.entries.clear(); }
}

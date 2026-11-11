// One bounded native call per machine. No shell, ps/top/lsof or silent fallback.
const LIMIT = 8 * 1024 * 1024;
const usable = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
const channel = (state, at, rows = [], message = null) => ({ state, at, rows, message });
const platformName = value => ({ darwin: "macos", macos: "macos", linux: "linux", windows: "windows" })[value];

export function parseNative(text, previous = null, at = Date.now(), maxAge = 3000) {
  const data = JSON.parse(text);
  if (data?.schema !== 1 || !platformName(data.platform) || !Array.isArray(data.rows) ||
      !usable(data.monotonic) || typeof data.topologyComplete !== "boolean") throw new Error("Invalid native snapshot");
  const elapsed = previous && data.monotonic - previous.monotonic;
  const before = new Map((previous?.rows ?? []).map(row => [row.pid, row]));
  const pids = new Set();
  const rows = data.rows.map(p => {
    if (!Number.isSafeInteger(p.pid) || p.pid <= 0 || !Number.isSafeInteger(p.ppid) || p.ppid < 0 ||
        typeof p.name !== "string" || pids.has(p.pid) ||
        (p.start !== null && (typeof p.start !== "string" || !p.start)) ||
        [p.memory, p.footprint, p.seconds].some(n => n !== null && !usable(n))) throw new Error("Invalid native process");
    pids.add(p.pid);
    const old = before.get(p.pid);
    const cpu = elapsed > 0 && elapsed * 1000 <= maxAge && at - previous.at <= maxAge &&
      p.start && old?.start === p.start && usable(p.seconds) && usable(old.seconds) && p.seconds >= old.seconds
      ? (p.seconds - old.seconds) * 100 / elapsed : null;
    return { ...p, resident: p.memory, memory: platformName(data.platform) === "macos" ? p.footprint : p.memory, cpu };
  });
  const processes = channel(data.topologyComplete ? "ready" : "partial", at, rows,
    data.topologyComplete ? null : "Some process identities were inaccessible or changed during sampling");
  processes.metric = platformName(data.platform) === "macos" ? "Footprint" : platformName(data.platform) === "windows" ? "Working Set" : "RSS";
  const footprints = platformName(data.platform) === "macos"
    ? channel(rows.every(p => usable(p.footprint)) ? "ready" : "partial", at,
      rows.filter(p => usable(p.footprint)).map(p => ({ pid: p.pid, start: p.start, bytes: p.footprint })))
    : channel("unavailable", at, [], "Footprint is a macOS metric");
  let listeners = channel("unavailable", 0, [], "Open Resources to collect listening ports");
  if (data.listeners) {
    if (!Array.isArray(data.listeners.rows) || typeof data.listeners.complete !== "boolean" ||
        !["managed", "all"].includes(data.listeners.scope)) throw new Error("Invalid listener snapshot");
    for (const p of data.listeners.rows) {
      if (!Number.isSafeInteger(p.pid) || p.pid < 0 || !Number.isInteger(p.port) || p.port < 0 || p.port > 65535 ||
          !["ipv4", "ipv6"].includes(p.family) || typeof p.address !== "string" || !p.address ||
          p.protocol !== "tcp" || (p.socket !== null && typeof p.socket !== "string")) throw new Error("Invalid native listener");
    }
    const identities = new Map(rows.map(p => [p.pid, p.start]));
    listeners = channel(data.listeners.complete ? "ready" : "partial", at,
      data.listeners.rows.map(p => ({ ...p, start: identities.get(p.pid) ?? null })),
      data.listeners.complete ? null : "Listener ownership is limited by current-user permissions");
    // Port searches keep their own topology until the next slower listener scan.
    listeners.processes = rows;
    listeners.scope = data.listeners.scope;
  } else if (data.listenerError) {
    listeners = channel("error", at, [], "Native listener scan failed");
  }
  const total = usable(data.host?.total) && data.host.total > 0 ? data.host.total : null;
  const available = total && usable(data.host?.available) && data.host.available <= total ? data.host.available : null;
  const host = { state: total ? "ready" : "unavailable", at, total, available,
    message: total && available === null ? "Host available memory is not reported" : null };
  return { platform: platformName(data.platform), at, monotonic: data.monotonic, processes, footprints, listeners, host };
}

export function createCollector(exec, localHelper) {
  const states = new Map(), pending = new Map();
  return {
    sample(machine = null, { platform = null, roots = [], ports = false, allPorts = false, maxAge = 3000 } = {}) {
      const key = machine ?? "";
      if (pending.has(key)) return pending.get(key);
      let state = states.get(key);
      if (!state) { state = {}; states.set(key, state); }
      const run = async () => {
        const args = [`--roots=${[...new Set(roots.filter(pid => Number.isSafeInteger(pid) && pid > 0))].sort((a, b) => a - b).join(",")}`];
        if (ports) args.push(allPorts ? "--all-ports" : "--ports");
        try {
          const result = await exec(machine ? "herdr-resource-sample" : localHelper(platform), args, { on: machine, timeout: 2000 });
          if (result.code !== 0 || result.stderr?.trim() || result.stdout.length >= LIMIT / 4) throw new Error("Native helper failed");
          const snapshot = parseNative(result.stdout, state.cpu, Date.now(), maxAge);
          if (states.get(key) !== state) return null;
          state.cpu = { at: snapshot.at, monotonic: snapshot.monotonic, rows: snapshot.processes.rows };
          if (ports) state.listeners = snapshot.listeners;
          else if (state.listeners) snapshot.listeners = state.listeners;
          return { ...snapshot, machine };
        } catch {
          if (states.get(key) !== state) return null;
          state.cpu = null;
          const at = Date.now(), message = "Native resource helper unavailable or failed; build/install it for this machine";
          return { machine, platform, at,
            processes: channel("error", at, [], message), footprints: channel("unavailable", at, [], message),
            listeners: channel("unavailable", at, [], message), host: { state: "unavailable", at, total: null, available: null, message } };
        }
      };
      const job = run().finally(() => { if (pending.get(key) === job) pending.delete(key); });
      pending.set(key, job);
      return job;
    },
    forget(machine) { states.delete(machine ?? ""); },
    clear() { states.clear(); }
  };
}

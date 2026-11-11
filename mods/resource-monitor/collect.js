// Read-only OS collectors. No runtime imports: exec is supplied by the panel.
const CACHE_MS = 10000;
const OUTPUT_LIMIT = 8 * 1024 * 1024;
const PS_ARGS = ["LC_ALL=C", "LANG=C", "ps", "-ww", "-axo", "pid=,ppid=,%cpu=,rss=,lstart=,comm="];
const POWERSHELL = ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"];
const PS_PREFIX = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); ";
const WINDOWS_PROCESSES = PS_PREFIX + `@{ rows=@(Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,Name,CreationDate,WorkingSetSize,KernelModeTime,UserModeTime | ForEach-Object {
  @{ pid=[int]$_.ProcessId; ppid=[int]$_.ParentProcessId; name=$_.Name;
     start=$(if ($null -ne $_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { $null });
     memory=$(if ($null -ne $_.WorkingSetSize) { [double]$_.WorkingSetSize } else { $null });
     seconds=$(if ($null -ne $_.KernelModeTime -and $null -ne $_.UserModeTime) { ([double]$_.KernelModeTime + [double]$_.UserModeTime) / 10000000.0 } else { $null }) }
}) } | ConvertTo-Json -Depth 4 -Compress`;
// NoMatchingNetTCPConnection is the cmdlet's genuine empty-result condition,
// not a reason to suppress permission, transport, or CIM errors.
const WINDOWS_LISTENERS = PS_PREFIX + `$items=@(); try { $items=@(Get-NetTCPConnection -State Listen -ErrorAction Stop) } catch {
  if ($_.FullyQualifiedErrorId -notlike 'CmdletizationQuery_NotFound*' -and $_.FullyQualifiedErrorId -notlike 'NoMatchingNetTCPConnection*') { throw }
}; @{ rows=@($items | ForEach-Object { @{ pid=[int]$_.OwningProcess; address=$_.LocalAddress; port=[int]$_.LocalPort } }) } | ConvertTo-Json -Depth 4 -Compress`;
const WINDOWS_HOST = PS_PREFIX + `$os=Get-CimInstance -ClassName Win32_OperatingSystem -Property TotalVisibleMemorySize,FreePhysicalMemory; @{ total=$(if ($null -ne $os.TotalVisibleMemorySize) { [double]$os.TotalVisibleMemorySize * 1024 } else { $null }); available=$(if ($null -ne $os.FreePhysicalMemory) { [double]$os.FreePhysicalMemory * 1024 } else { $null }) } | ConvertTo-Json -Compress`;
const WINDOWS_PROBE = PS_PREFIX + "if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Unsupported operating system' }; 'Windows_NT'";

function channel(state, at, rows = [], message = null) { return { state, at, rows, message }; }
function numeric(value) {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function integer(value) { const n = numeric(value); return n != null && Number.isSafeInteger(n) ? n : null; }
function basename(name) { return String(name).split(/[\\/]/).pop() || String(name); }
function failed(state, at, message, host = false) {
  return host ? { state, at, total: null, available: null, message } : channel(state, at, [], message);
}
function parsed(rows, rejected, at, message = "Some records could not be parsed") {
  return channel(rejected ? (rows.length ? "partial" : "error") : "ready", at, rows, rejected ? message : null);
}
function emptySnapshot(machine, platform, at, state, message) {
  return { machine, platform, at, processes: failed(state, at, message), listeners: failed(state, at, message), host: failed(state, at, message, true), footprints: failed(state, at, message) };
}
function missingProgram(error) {
  const text = String(error?.message ?? error);
  // Match a launch failure, never generic ENOENT / 'not found': those can
  // describe a missing remote machine, folder, or connection instead.
  return /cannot start [^\r\n:]+: (?:program not found|No such file or directory)/i.test(text)
    || /spawn\s+\S+\s+ENOENT\b/i.test(text);
}
function commandFailure(result, label) {
  if (result.missing) return `${label} is not installed`;
  if (result.thrown) return `${label} could not execute (machine unavailable, command failed, or timed out)`;
  if (result.truncated) return `${label} output was truncated`;
  if (/permission denied|access (?:is )?denied|unauthorized/i.test(result.stderr || "")) return `${label} permission denied`;
  if (/not recognized|CommandNotFoundException|not found|No such file or directory/i.test(result.stderr || "")) return `${label} or a required system command is unavailable`;
  return `${label} exited with status ${result.code}`;
}
function failureState(result) {
  return result.missing || /CommandNotFoundException|is not recognized|command not found|env:.*(?:No such file or directory|not found)/i.test(result.stderr || "") ? "unavailable" : "error";
}
function good(result) { return !result.thrown && !result.truncated && result.code === 0; }
function reachesOutputLimit(text) {
  if (text.length < OUTPUT_LIMIT / 4) return false;
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes++;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
    else bytes += 3;
    if (bytes >= OUTPUT_LIMIT) return true;
  }
  return false;
}

/** ps uses lstart (stable creation identity), never etime or full command args. */
export function parsePs(text, at = Date.now()) {
  const rows = []; let rejected = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+?)\s*$/.exec(line);
    if (!m) { rejected++; continue; }
    const pid = integer(m[1]), ppid = integer(m[2]), cpu = numeric(m[3]), rss = numeric(m[4]);
    if (pid == null || ppid == null || cpu == null || rss == null || !Number.isSafeInteger(rss * 1024)) { rejected++; continue; }
    rows.push({ pid, ppid, cpu, memory: rss * 1024, start: m[5].replace(/\s+/g, " "), name: basename(m[6]) });
  }
  if (!rows.length && !rejected) return failed("error", at, "Process table was empty");
  return parsed(rows, rejected, at);
}

function endpoint(value, family = null) {
  const m = /^(.*):(\d+)$/.exec(value);
  if (!m) return null;
  let address = m[1].replace(/^\[|\]$/g, "");
  const port = integer(m[2]);
  if (!address || port == null || port > 65535) return null;
  family = family || (address.includes(":") ? "ipv6" : "ipv4");
  if (address === "*") address = family === "ipv6" ? "::" : "0.0.0.0";
  return { address, port, family };
}
function uniqueListeners(rows) {
  const seen = new Set();
  return rows.filter(r => { const key = `${r.pid}|${r.family}|${r.address}|${r.port}|${r.socket ?? ""}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

/** lsof -F0: NUL field delimiters, newline record delimiters, numeric endpoints. */
export function parseLsof(text, at = Date.now()) {
  const rows = []; let pid = null, file = null, rejected = 0;
  function flush() {
    if (!file) return;
    const family = file.t === "IPv4" ? "ipv4" : file.t === "IPv6" ? "ipv6" : null;
    const ep = family && endpoint(file.n || "", family);
    if (pid == null || !ep || (file.P && file.P !== "TCP")) { rejected++; return; }
    const socket = file.D && !/^0x0+$/.test(file.D) ? `device:${file.D}` : /^\d+$/.test(file.i || "") && +file.i > 0 ? `inode:${file.i}` : null;
    rows.push({ pid, ...ep, protocol: "tcp", socket });
  }
  for (const token of text.split(/[\0\n]/)) {
    if (!token) continue;
    const key = token[0], value = token.slice(1);
    if (key === "p") { flush(); file = null; pid = integer(value); }
    else if (key === "f") { flush(); file = {}; }
    else if (file) file[key] = value;
  }
  flush();
  const out = parsed(uniqueListeners(rows), rejected, at);
  if (out.state !== "error") {
    out.state = "partial";
    out.message = "lsof listener ownership is limited by current-user permissions; hidden processes may be absent";
  }
  return out;
}

/** ss's inode allows shared sockets to be deduplicated across owning PIDs. */
export function parseSs(text, at = Date.now()) {
  const rows = []; let rejected = 0, hidden = false;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const fields = line.trim().split(/\s+/);
    const base = fields[0] === "LISTEN" ? 1 : 0;
    const local = fields[base + 2] || "";
    // Extended inet6 diagnostics carry v6only even for dual-stack sockets.
    // Older ss versions may print '*' without a family: do not guess IPv4.
    const family = /\bv6only:[01]\b/.test(line) ? "ipv6" : null;
    const ep = /^\*:/.test(local) && !family ? null : endpoint(local, family);
    if (!ep) { rejected++; continue; }
    const pids = [...line.matchAll(/\bpid=(\d+)/g)].map(m => integer(m[1])).filter(p => p != null);
    if (!pids.length) hidden = true;
    const inode = /\bino:(\d+)/.exec(line)?.[1];
    // PID zero preserves visible endpoints with unknown ownership; it is never
    // assigned to a terminal process tree by the model.
    for (const pid of pids.length ? new Set(pids) : [0]) rows.push({ pid, ...ep, protocol: "tcp", socket: inode && +inode > 0 ? `inode:${inode}` : null });
  }
  const out = parsed(uniqueListeners(rows), rejected, at);
  if (hidden && out.state !== "error") { out.state = "partial"; out.message = "Some listener owners are hidden by current-user permissions"; }
  return out;
}

export function parseMeminfo(text, at = Date.now()) {
  const total = /^MemTotal:\s+(\d+)\s+kB\s*$/m.exec(text), available = /^MemAvailable:\s+(\d+)\s+kB\s*$/m.exec(text);
  if (!total || !available) return failed("unavailable", at, "MemTotal / MemAvailable is missing; free pages are not available memory", true);
  return hostValues(Number(total[1]) * 1024, Number(available[1]) * 1024, at);
}
function hostValues(total, available, at, message = null) {
  total = numeric(total); available = numeric(available);
  if (total == null || total <= 0 || available == null || available > total) return failed("error", at, "Host memory values were invalid", true);
  return { state: "ready", at, total, available, message };
}
export function parseMemoryPressure(text, at = Date.now()) {
  const total = /The system has\s+(\d+)\s+\(/.exec(text), free = /System-wide memory free percentage:\s*([\d.]+)%/.exec(text);
  if (!total || !free || +free[1] > 100) return failed("error", at, "memory_pressure did not report total and system-wide available percentage", true);
  return hostValues(+total[1], +total[1] * +free[1] / 100, at, "Available memory estimated from memory_pressure system-wide free percentage");
}

function topBytes(value) {
  const m = /^(\d+(?:\.\d+)?)([BKMGTP]?)(?:[+-])?$/i.exec(value);
  if (!m) return null;
  return numeric(Number(m[1]) * 1024 ** Math.max(0, "BKMGTP".indexOf(m[2].toUpperCase())));
}
export function parseTop(text, processes, at = Date.now()) {
  const starts = new Map(processes.map(p => [p.pid, p.start]));
  const rows = []; let header = false, rejected = 0;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*PID\s+MEM\s*$/.test(line)) { header = true; continue; }
    if (!header || !line.trim()) continue;
    const m = /^\s*(\d+)\s+(\S+)\s*$/.exec(line), bytes = m && topBytes(m[2]);
    if (!m || bytes == null) { rejected++; continue; }
    const pid = integer(m[1]);
    if (pid == null) { rejected++; continue; }
    rows.push({ pid, start: starts.get(pid) ?? null, bytes });
  }
  if (!header || !rows.length) return failed("error", at, "top footprint output could not be parsed");
  return parsed(rows, rejected, at);
}

function jsonObject(text) {
  const value = JSON.parse(text.replace(/^\uFEFF/, ""));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a JSON object");
  return value;
}
export function parseWindowsProcesses(text, previous = null, at = Date.now(), maxSampleAge = CACHE_MS) {
  const source = jsonObject(text).rows;
  if (!Array.isArray(source) || !source.length) return failed("error", at, "CIM process table was empty or invalid");
  const rows = []; let rejected = 0;
  const delta = previous && at - previous.at;
  const before = previous && new Map(previous.rows.map(p => [p.pid, p]));
  for (const p of source) {
    const pid = integer(p.pid), ppid = integer(p.ppid), memory = numeric(p.memory), seconds = numeric(p.seconds);
    const start = typeof p.start === "string" && p.start ? p.start : null;
    if (pid == null || ppid == null || typeof p.name !== "string") { rejected++; continue; }
    const old = before?.get(pid);
    const cpu = delta > 0 && delta <= maxSampleAge && start && old?.start === start && seconds != null && old.seconds != null && seconds >= old.seconds
      ? (seconds - old.seconds) * 100000 / delta : null;
    rows.push({ pid, ppid, name: basename(p.name), start, memory, cpu, seconds });
  }
  return parsed(rows, rejected, at);
}
export function parseWindowsListeners(text, at = Date.now()) {
  const source = jsonObject(text).rows;
  if (!Array.isArray(source)) return failed("error", at, "Windows listener output was invalid");
  const rows = []; let rejected = 0, hidden = false;
  for (const p of source) {
    const pid = integer(p.pid), port = integer(p.port), address = typeof p.address === "string" ? p.address : "";
    if (pid == null || port == null || port > 65535 || !address) { rejected++; continue; }
    if (!pid) hidden = true;
    rows.push({ pid, port, address, family: address.includes(":") ? "ipv6" : "ipv4", protocol: "tcp", socket: null });
  }
  const out = parsed(uniqueListeners(rows), rejected, at);
  if (hidden && out.state !== "error") { out.state = "partial"; out.message = "Some Windows listener owners could not be identified"; }
  return out;
}

export function createCollector(exec) {
  const machines = new Map();
  const pendingByMachine = new Map();
  const key = machine => machine ?? "";
  async function run(machine, program, args) {
    const at = Date.now();
    try {
      const r = await exec(program, args, { on: machine, timeout: 5000 });
      const stdout = String(r.stdout ?? ""), stderr = String(r.stderr ?? "");
      // The host returns no separate truncation flag. At its documented bound,
      // reject even otherwise parseable output rather than claim full coverage.
      return { ...r, stdout, stderr, at, truncated: reachesOutputLimit(stdout) || reachesOutputLimit(stderr) || /\b(?:output (?:was )?truncated|output limit exceeded)\b/i.test(stderr) };
    } catch (error) { return { code: -1, stdout: "", stderr: "", at, thrown: true, missing: missingProgram(error) }; }
  }
  async function platform(machine, state, hint) {
    if (state.platform) return { platform: state.platform };
    if (["macos", "linux", "windows"].includes(hint)) return { platform: hint };
    const unix = await run(machine, "uname", ["-s"]);
    if (good(unix)) {
      const name = unix.stdout.trim();
      if (name === "Darwin") return { platform: "macos" };
      if (name === "Linux") return { platform: "linux" };
      return { state: "unavailable", message: "Unsupported operating system" };
    }
    // A timeout, disconnect, or a nonzero exit from an installed uname is not
    // evidence of Windows. In particular never launch another offline probe.
    if (!unix.missing && !([126, 127, 9009].includes(unix.code) && /uname.*(?:not found|not recognized)|(?:not found|not recognized).*uname/i.test(unix.stderr))) {
      return { state: "error", message: commandFailure(unix, "Platform probe") };
    }
    const win = await run(machine, "powershell.exe", [...POWERSHELL, WINDOWS_PROBE]);
    return good(win) && win.stdout.trim() === "Windows_NT" ? { platform: "windows" }
      : { state: failureState(win), message: commandFailure(win, "Windows platform probe") };
  }
  async function collect(machine, state, hint, maxSampleAge) {
    const detected = await platform(machine, state, hint);
    if (!detected.platform) return emptySnapshot(machine, null, Date.now(), detected.state, detected.message);
    const os = detected.platform;
    if (machines.get(key(machine)) !== state) return emptySnapshot(machine, os, Date.now(), "error", "Sampling was invalidated");
    state.platform = os;
    const now = Date.now(), refreshHost = !state.host || now - state.host.at >= CACHE_MS;
    const refreshFootprint = os === "macos" && (!state.footprints || now - state.footprints.at >= CACHE_MS);
    const psJob = os === "windows" ? run(machine, "powershell.exe", [...POWERSHELL, WINDOWS_PROCESSES]) : run(machine, "env", PS_ARGS);
    const socketJob = os === "windows" ? run(machine, "powershell.exe", [...POWERSHELL, WINDOWS_LISTENERS])
      : os === "macos" ? run(machine, "env", ["LC_ALL=C", "LANG=C", "/usr/sbin/lsof", "-nP", "-iTCP", "-sTCP:LISTEN", "-F0pftDinPT"])
      : run(machine, "env", ["LC_ALL=C", "LANG=C", "ss", "-H", "-ltnpe"]);
    const hostJob = !refreshHost ? null : os === "windows" ? run(machine, "powershell.exe", [...POWERSHELL, WINDOWS_HOST])
      : os === "macos" ? run(machine, "env", ["LC_ALL=C", "LANG=C", "/usr/bin/memory_pressure", "-Q"])
      : run(machine, "env", ["LC_ALL=C", "LANG=C", "cat", "/proc/meminfo"]);
    const topJob = refreshFootprint ? run(machine, "env", ["LC_ALL=C", "LANG=C", "/usr/bin/top", "-l", "1", "-stats", "pid,mem"]) : null;
    const [ps, sockets, host, top] = await Promise.all([psJob, socketJob, hostJob, topJob]);
    function parseResult(result, parser, label, isHost = false) {
      if (!good(result)) return failed(failureState(result), result.at, commandFailure(result, label), isHost);
      try {
        const value = parser(result.stdout, result.at);
        if (result.stderr.trim() && value.state === "ready") { value.state = "partial"; value.message = `${label} reported warnings; coverage may be incomplete`; }
        return value;
      } catch { return failed("error", result.at, `${label} output could not be parsed`, isHost); }
    }
    const processes = parseResult(ps, (text, at) => os === "windows" ? parseWindowsProcesses(text, state.cpu, at, maxSampleAge) : parsePs(text, at), "Process table");
    // lsof exit 1 may mean no matching sockets, or partial visibility. Keep
    // parseable rows as partial evidence, never as a complete successful scan.
    let listeners;
    if (os === "macos" && sockets.code === 1 && !sockets.thrown && !sockets.truncated && (sockets.stdout.trim() || !sockets.stderr.trim())) {
      listeners = parseLsof(sockets.stdout, sockets.at);
      if (listeners.state !== "error") { listeners.state = "partial"; listeners.message = "lsof returned a partial selection; current-user visibility may omit listeners"; }
    } else listeners = parseResult(sockets, os === "windows" ? parseWindowsListeners : os === "macos" ? parseLsof : parseSs, "TCP listener scan");
    const hostValue = host ? parseResult(host, os === "windows" ? (text, at) => { const p = jsonObject(text); return hostValues(p.total, p.available, at); }
      : os === "macos" ? parseMemoryPressure : parseMeminfo, "Host memory", true) : state.host;
    const footprints = os !== "macos" ? failed("unavailable", now, "Footprint is only collected on macOS")
      : top ? parseResult(top, (text, at) => parseTop(text, processes.rows, at), "macOS footprint") : state.footprints;
    if (machines.get(key(machine)) !== state) return emptySnapshot(machine, os, Date.now(), "error", "Sampling was invalidated");
    if (host) state.host = hostValue;
    if (top) state.footprints = footprints;
    state.cpu = os === "windows" && processes.state === "ready" ? { at: processes.at, rows: processes.rows } : null;
    return { machine, platform: os, at: processes.at, processes, listeners, host: hostValue, footprints };
  }
  return {
    sample(machine, platformHint = null, maxSampleAge = CACHE_MS) {
      machine = machine ?? null;
      const id = key(machine);
      if (pendingByMachine.has(id)) return pendingByMachine.get(id);
      let state = machines.get(id);
      if (!state) { state = {}; machines.set(id, state); }
      const pending = collect(machine, state, platformHint, maxSampleAge).catch(() => emptySnapshot(machine, state.platform ?? null, Date.now(), "error", "Sampling failed"));
      pendingByMachine.set(id, pending);
      pending.finally(() => { if (pendingByMachine.get(id) === pending) pendingByMachine.delete(id); });
      return pending;
    },
    forget(machine) { machines.delete(key(machine)); },
    clear() { machines.clear(); },
  };
}

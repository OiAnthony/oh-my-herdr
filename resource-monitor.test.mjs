import test from "node:test";
import assert from "node:assert/strict";
import { buildResources, MemoryHistory, binding } from "./mods/resource-monitor/model.js";
import { buildResourceTree, resourceRows } from "./mods/resource-monitor/tree.js";
import { parsePs, parseLsof, parseSs, parseMeminfo, parseMemoryPressure, parseTop, parseWindowsProcesses, parseWindowsListeners } from "./mods/resource-monitor/collect.js";

const at = 100000;
const process = (pid, ppid = 0, memory = 10, extra = {}) => ({ pid, ppid, memory, cpu: 1, name: `p${pid}`, start: `start-${pid}`, ...extra });
const terminal = (address, pid, extra = {}) => ({ address, pid, state: "live", ...extra });
const channel = (rows = [], extra = {}) => ({ state: "ready", at, rows, message: null, ...extra });
const snapshot = (rows, extra = {}) => ({ machine: null, platform: "macos", at, processes: channel(rows), listeners: channel(), footprints: channel([], { state: "unavailable" }), host: { state: "ready", at, total: 1000, available: 400, message: null }, ...extra });
const layout = [{ id: "s1", name: "Work", machine: null, tabs: [{ id: "tab1", name: "Task" }] }];
const placed = { labels: { "herdr.space": "s1", "herdr.tab": "tab1" } };
function build(terminals, rows, options = {}) {
  return buildResources({ terminals, spaces: layout, snapshots: new Map([["", snapshot(rows)]]), now: at, ...options });
}
function all(nodes) { return nodes.flatMap(node => [node, ...all(node.children)]); }
const leaf = (nodes, address) => all(nodes).find(node => node.address === address);

test("display merges terminal panes, retains logical children and mod panes, and preserves metrics", () => {
  const nodes = build([terminal("t1", 10), terminal("t2", 20, { parent: "t1" }), terminal("t3", 30)],
    [process(10), process(20, 0, 50), process(30, 0, 20)], {
      panes: [{ pane: "p1", terminal: "t1", tab: "tab1", title: "Original title" },
        { pane: "p2", terminal: "t3", tab: "tab1" }, { pane: "p3", tab: "tab1", mod: "files", title: "Files" }]
    });
  const before = structuredClone(nodes), tree = buildResourceTree(nodes);
  const main = leaf(tree, "t1");
  assert.equal(main.pane, "p1");
  assert.equal(main.paneName, "Original title");
  assert.equal(main.memory, 10);
  assert.equal(main.children[0].address, "t2");
  assert.equal(all(tree).filter(node => node.kind === "pane").length, 1);
  const expanded = new Set(all(tree).map(node => node.id));
  const rows = resourceRows(tree, { expanded });
  assert.deepEqual(rows.filter(row => row.depth === 2).map(row => row.node.address ?? row.node.name), ["t3", "t1", "Files"]);
  assert.equal(rows.find(row => row.node.address === "t2").depth, 3);
  assert.equal(rows.filter(row => row.type === "process").length, 3);
  assert.equal(resourceRows(tree).length, 1);
  assert.equal(resourceRows(tree, { expanded, sort: "name" }).find(row => row.depth === 2).node.name, "Files");
  assert.deepEqual(nodes, before);
});

test("name searches retain matching pane metadata, process names and enclosing paths", () => {
  const nodes = build([terminal("t1", 10), terminal("t2", 20, { parent: "t1" })],
    [process(10), process(20, 0, 10, { name: "web-worker" })], {
      panes: [{ pane: "p1", terminal: "t1", tab: "tab1", title: "Original title" }]
    });
  for (const name of ["Original title", "p1", "t1", "Work", "web-worker"]) {
    const tree = buildResourceTree(nodes, { filters: { name } });
    assert.ok(leaf(tree, "t1"), name);
    if (name === "web-worker") {
      assert.equal(leaf(tree, "t1").showDetails, false);
      assert.equal(leaf(tree, "t2").visibleProcesses[0].pid, 20);
    }
  }
  assert.deepEqual(buildResourceTree(nodes, { filters: { name: "not-present" } }), []);
});

test("PID and port filters must match the same process and retain its OS parent chain", () => {
  const snap = snapshot([process(10), process(11, 10), process(12, 11), process(13, 10)], {
    listeners: channel([
      { pid: 12, family: "ipv4", protocol: "tcp", address: "127.0.0.1", port: 8080 },
      { pid: 13, family: "ipv4", protocol: "tcp", address: "0.0.0.0", port: 80 }
    ])
  });
  const snapshots = new Map([["", snap]]);
  const nodes = build([terminal("t1", 10, placed)], [], { snapshots });
  const tree = buildResourceTree(nodes, { snapshots, filters: { pid: "12", port: "8080" } });
  const match = leaf(tree, "t1");
  assert.deepEqual(match.visibleProcesses.map(process => process.pid), [10, 11, 12]);
  assert.deepEqual(match.visiblePorts.map(port => port.port), [8080]);
  assert.equal(match.memory, 40);
  assert.deepEqual(buildResourceTree(nodes, { snapshots, filters: { pid: "13", port: "8080" } }), []);
  assert.deepEqual(buildResourceTree(nodes, { snapshots, filters: { port: "808" } }), []);
  assert.deepEqual(buildResourceTree(nodes, { snapshots, filters: { pid: "1" } }), []);
  assert.deepEqual(buildResourceTree(nodes, { snapshots, filters: { name: "not-present", port: "8080" } }), []);
  const expanded = new Set(all(tree).map(node => node.id));
  assert.equal(resourceRows(tree, { expanded }).filter(row => row.type === "port").length, 1);
  assert.equal(resourceRows(tree).length, 1);
});

test("port searches include unassigned listeners, deduplicate socket repeats and preserve unknown owners", () => {
  const listener = { pid: 20, family: "ipv6", protocol: "tcp", address: "::", port: 8080, socket: "a" };
  const snap = snapshot([process(10), process(1), process(20, 1, 90, { name: "outside-server" })], {
    listeners: channel([listener, listener, { ...listener, pid: 99, socket: "b" }], { state: "partial" })
  });
  const snapshots = new Map([["", snap]]);
  const nodes = build([terminal("t1", 10, placed)], [], { snapshots });
  const before = structuredClone(nodes);
  const tree = buildResourceTree(nodes, { snapshots, filters: { port: "8080" } });
  const owners = all(tree).filter(node => node.kind === "process-owner");
  assert.deepEqual(owners.map(node => node.pid), [20, 99]);
  assert.equal(owners[0].name, "outside-server");
  assert.equal(owners[0].ports.length, 1);
  assert.deepEqual(owners[0].visibleProcesses.map(process => process.pid), [1, 20]);
  assert.equal(owners[0].ports[0].binding, "all interfaces");
  assert.equal(owners[1].memory, null);
  assert.equal(owners[1].status, "partial");
  assert.equal(buildResourceTree(nodes).some(node => node.name.includes("Other processes")), false);
  assert.equal(all(buildResourceTree(nodes, { snapshots, filters: { name: "outside-server", port: "8080" } }))
    .filter(node => node.kind === "process-owner").length, 1);
  assert.deepEqual(nodes, before);
});

test("port results keep equal remote PIDs separate and never duplicate managed listeners", () => {
  const spaces = [...layout, { id: "remote/s1", machine: "remote", tabs: [{ id: "remote/tab1" }] }];
  const listener = { pid: 10, family: "ipv4", protocol: "tcp", address: "127.0.0.1", port: 8080 };
  const snapshots = new Map([["", snapshot([process(10)], { listeners: channel([listener]) })],
    ["remote", snapshot([process(10)], { machine: "remote", listeners: channel([listener]) })]]);
  const nodes = build([terminal("t1", 10, placed)], [], { snapshots, spaces });
  const tree = buildResourceTree(nodes, { snapshots, filters: { port: "8080" } });
  const owners = all(tree).filter(node => node.kind === "process-owner");
  assert.equal(owners.length, 1);
  assert.equal(owners[0].machine, "remote");
  assert.equal(leaf(tree, "t1").visiblePorts.length, 1);
  assert.equal(resourceRows(tree, { currentSpace: "s1" })[0].node.space, "s1");
});

test("OS trees are disjoint across nested roots while descendant counts retain the entire observed tree", () => {
  const terminals = [terminal("t1", 10, { ...placed, foreground: { pid: 11 } }), terminal("t2", 12, { parent: "t1" })];
  const rows = [process(10), process(11, 10), process(12, 10), process(13, 12), process(14, 11)];
  const nodes = build(terminals, rows);
  const parent = leaf(nodes, "t1"), child = leaf(nodes, "t2");
  assert.deepEqual(parent.processes.map(p => [p.pid, p.depth]), [[10, 0], [11, 1], [14, 2]]);
  assert.equal(parent.processes[0].root, true);
  assert.equal(parent.processes[1].foreground, true);
  assert.equal(parent.directChildren, 2);
  assert.equal(parent.descendants, 4);
  assert.equal(child.descendants, 1);
  assert.equal(parent.memory, 30);
  assert.equal(child.memory, 20);
  assert.equal(nodes[0].memory, 50);
  const reversed = build([...terminals].reverse(), [...rows].reverse());
  assert.deepEqual(leaf(reversed, "t1").processes.map(p => p.pid), parent.processes.map(p => p.pid));
  assert.equal(reversed[0].memory, 50);
});

test("machine-qualified IDs isolate equal PIDs, labels and ports", () => {
  const spaces = [...layout, { ...layout[0], id: "remote/s1", machine: "remote", tabs: [{ id: "remote/tab1", name: "Remote task" }] }];
  const remote = snapshot([process(10, 0, 70)], { machine: "remote", platform: "windows" });
  const nodes = build([terminal("t1", 10, placed), terminal("remote/t1", 10, placed)], [process(10)], { spaces, snapshots: new Map([["", snapshot([process(10)])], ["remote", remote]]) });
  assert.equal(nodes.length, 2);
  assert.equal(leaf(nodes, "t1").memory, 10);
  assert.equal(leaf(nodes, "remote/t1").memory, 70);
  assert.equal(leaf(nodes, "remote/t1").metric, "Working Set");
  assert.notEqual(leaf(nodes, "t1").id, leaf(nodes, "remote/t1").id);
  assert.notEqual(leaf(nodes, "t1").identity, leaf(nodes, "remote/t1").identity);
});

test("panes, agents and logical parents locate tabs without becoming OS parents", () => {
  const terminals = [terminal("t1", 10), terminal("t2", 20, { parent: "t1", labels: { "herdr.space": "s1" } }), terminal("t3", 30), terminal("t4", 40, { parent: "t5" }), terminal("t5", 50, { parent: "t4" }), terminal("old", 60, { state: "finished" })];
  const nodes = build(terminals, terminals.map(t => process(t.pid)), { panes: [{ pane: "p1", terminal: "t1", tab: "tab1", title: "Shell" }], agents: [{ address: "t3", tab: "tab1", space: "s1", title: "Agent" }] });
  const tab = nodes[0].children[0].children[0];
  const pane = tab.children.find(n => n.pane === "p1");
  assert.equal(pane.kind, "pane");
  assert.equal(pane.children[0].address, "t1");
  assert.equal(leaf(nodes, "t1").children[0].address, "t2");
  assert.equal(pane.memory, 20);
  assert.equal(tab.memory, 30);
  assert.equal(leaf(nodes, "t2").descendants, 0);
  assert.equal(leaf(nodes, "t1").memory, 10);
  assert.equal(leaf(nodes, "t3").agent, true);
  assert.equal(nodes[0].children.find(n => n.unassigned).children[0].children.length, 2);
  assert.equal(leaf(nodes, "old"), undefined);
});

test("pane placement overrides logical ancestry and preserves tab and machine resource totals", () => {
  const spaces = [...layout, { id: "s2", name: "Other", tabs: [{ id: "tab2", name: "Other task" }] }];
  const terminals = [terminal("child", 20, { parent: "parent" }), terminal("parent", 10, placed),
    terminal("placed", 30, { parent: "parent", labels: { "herdr.space": "s2", "herdr.tab": "tab2" } })];
  const nodes = build(terminals, [process(10), process(20), process(30)], { spaces,
    panes: [{ pane: "p1", terminal: "parent", tab: "tab1" }, { pane: "p2", terminal: "child", tab: "tab1" },
      { pane: "p3", tab: "tab1", mod: "files", title: "Files" }] });
  const tab = nodes[0].children[0].children[0];
  assert.equal(tab.children.find(n => n.pane === "p1").memory, 10);
  assert.equal(tab.children.find(n => n.pane === "p2").children[0].address, "child");
  assert.equal(leaf(nodes, "parent").children.some(n => n.address === "child"), false);
  assert.equal(tab.children.find(n => n.pane === "p3").mod, "files");
  assert.equal(leaf(nodes, "placed").space, "s2");
  assert.equal(leaf(nodes, "placed").tab, "tab2");
  assert.equal(tab.memory, 20);
  assert.equal(nodes[0].memory, 30);
});

test("remote panes and pane-less agents inherit only machine-qualified ancestry", () => {
  const spaces = [...layout, { id: "remote/s1", machine: "remote", tabs: [{ id: "remote/tab1" }] }];
  const nodes = build([terminal("t1", 10, placed), terminal("remote/t1", 10, placed), terminal("remote/t2", 20, { parent: "t1", program: { agent: true } })],
    [process(10)], { spaces, panes: [{ pane: "remote/p1", terminal: "remote/t1", tab: "remote/tab1" }],
      snapshots: new Map([["", snapshot([process(10)])], ["remote", snapshot([process(10), process(20)], { machine: "remote" })]]) });
  const remote = nodes.find(n => n.machine === "remote");
  const pane = all([remote]).find(n => n.pane === "remote/p1");
  assert.equal(pane.children[0].address, "remote/t1");
  assert.equal(leaf(nodes, "remote/t1").children[0].address, "remote/t2");
  assert.equal(leaf(nodes, "remote/t2").agent, true);
  assert.equal(leaf(nodes, "t1").children.length, 0);
  assert.equal(pane.memory, 20);
  assert.equal(remote.memory, 20);
});

test("duplicate managed roots never choose an owner and count once at machine scope", () => {
  for (const terminals of [[terminal("a", 10, placed), terminal("b", 10, placed)], [terminal("b", 10, placed), terminal("a", 10, placed)]]) {
    const nodes = build(terminals, [process(10), process(11, 10)]);
    for (const address of ["a", "b"]) {
      assert.equal(leaf(nodes, address).status, "conflict");
      assert.equal(leaf(nodes, address).memory, null);
      assert.equal(leaf(nodes, address).unknown, 1);
    }
    assert.equal(nodes[0].memory, 20);
    assert.equal(nodes[0].processes.length, 2);
    assert.equal(nodes[0].unknown, 2);
    assert.equal(nodes[0].footprint, null);
  }
});

test("OS cycles, identical duplicate records and inconsistent duplicate PIDs remain bounded", () => {
  const rows = [process(10, 11), process(11, 10), process(11, 10)];
  const nodes = build([terminal("t1", 10)], rows);
  assert.equal(leaf(nodes, "t1").descendants, 1);
  assert.equal(nodes[0].memory, 20);
  const inconsistent = build([terminal("t1", 10)], [process(10), process(10, 0, 20, { start: "reused" })]);
  assert.equal(leaf(inconsistent, "t1").memory, null);
  assert.ok(inconsistent[0].unknown > 0);
});

test("endpoints deduplicate FD repeats and proven shared sockets, retaining dual stack and unrelated same ports", () => {
  const listener = (pid, extra = {}) => ({ pid, family: "ipv4", protocol: "tcp", address: "127.0.0.1", port: 3000, socket: "socket-a", ...extra });
  const listeners = [listener(10), listener(10), listener(11), listener(10, { family: "ipv6", address: "::1" }), listener(11, { socket: null }), listener(99)];
  const nodes = build([terminal("t1", 10, placed), terminal("t2", 11, placed)], [process(10), process(11)], { snapshots: new Map([["", snapshot([process(10), process(11)], { listeners: channel(listeners) })]]) });
  assert.equal(leaf(nodes, "t1").portCount, 2);
  assert.equal(leaf(nodes, "t2").portCount, 2);
  assert.equal(nodes[0].portCount, 3);
  assert.deepEqual(nodes[0].ports.find(p => p.socket === "socket-a" && p.family === "ipv4").pids, [10, 11]);
  assert.equal(binding("127.2.3.4"), "loopback");
  assert.equal(binding("[::1]"), "loopback");
  for (const address of ["*", "0.0.0.0", "::"]) assert.equal(binding(address), "all interfaces");
  assert.equal(binding("192.168.1.1"), "specific address");
  const next = build([terminal("t1", 10)], [process(10)]);
  assert.equal(leaf(next, "t1").portCount, 0);
});

test("failed, partial, absent and exited roots preserve unknown rather than inventing zero", () => {
  const terminals = [terminal("good", 10, placed), terminal("missing", 99, placed), terminal("pending", null, placed)];
  const nodes = build(terminals, [process(10, 0, 0, { cpu: 0 })]);
  assert.equal(nodes[0].memory, 0);
  assert.equal(nodes[0].unknown, 2);
  assert.equal(leaf(nodes, "pending").memory, null);
  const partial = build([terminal("t1", 10)], [], { snapshots: new Map([["", snapshot([process(10, 0, null)], { processes: channel([process(10, 0, null)], { state: "partial" }), listeners: channel([], { state: "partial" }) })]]) });
  assert.equal(partial[0].memory, null);
  assert.equal(partial[0].cpu, 1);
  assert.equal(partial[0].portCount, null);
  assert.ok(partial[0].unknown > 0);
  for (const state of ["error", "unavailable"]) {
    const broken = snapshot([], { processes: channel([process(10)], { state, message: "offline" }), listeners: channel([], { state }) });
    const failed = build([terminal("t1", 10)], [], { snapshots: new Map([["", broken]]) });
    assert.equal(failed[0].memory, null);
    assert.ok(failed[0].unknown > 0);
    assert.equal(failed[0].stale, true);
    assert.equal(failed[0].portCount, null);
    const retained = leaf(failed, "t1");
    assert.equal(retained.memory, 10);
    assert.equal(retained.cpu, 1);
    assert.equal(retained.processes.length, 1);
    assert.equal(retained.processes[0].root, true);
    assert.equal(retained.status, state);
    assert.equal(retained.stale, true);
    assert.equal(retained.historyValid, false);
    assert.equal(retained.footprint, null);
  }
  const loading = buildResources({ terminals: [terminal("t1", 10)], now: at });
  assert.equal(loading[0].memory, null);
  assert.equal(loading[0].status, "loading");
  assert.equal(loading[0].unknown, 1);
});

test("footprint requires every member, exact start identity and at most fifteen seconds; RSS stays independent", () => {
  const terminals = [terminal("t1", 10, placed), terminal("t2", 20, placed)];
  const rows = [process(10, 0, 10, { cpu: null }), process(20, 0, 20)];
  const footprints = [ { pid: 10, start: "start-10", bytes: 100 }, { pid: 20, start: "start-20", bytes: 200 } ];
  function withFootprints(values, age = 0) {
    return build(terminals, rows, { snapshots: new Map([["", snapshot(rows, { footprints: channel(values, { at: at - age }) })]]) });
  }
  const complete = withFootprints(footprints, 15000);
  assert.equal(complete[0].memory, 30);
  assert.equal(complete[0].footprint, 300);
  assert.equal(complete[0].footprintAt, at - 15000);
  assert.equal(leaf(complete, "t1").processes[0].footprint, 100);
  assert.equal(leaf(complete, "t1").processes[0].footprintAt, at - 15000);
  assert.equal(withFootprints(footprints, 15001)[0].footprint, null);
  assert.equal(leaf(withFootprints(footprints, 15001), "t1").processes[0].footprint, null);
  const missing = withFootprints(footprints.slice(0, 1));
  assert.equal(leaf(missing, "t1").footprint, 100);
  assert.equal(missing[0].footprint, null);
  const reused = withFootprints([{ ...footprints[0], start: "old-start" }, footprints[1]]);
  assert.equal(leaf(reused, "t1").footprint, null);
  assert.equal(leaf(reused, "t1").processes[0].footprint, null);
  assert.equal(reused[0].footprint, null);
  assert.equal(reused[0].memory, 30);
});

test("history uses snapshot timestamps, bounds samples and resets on PID reuse and metric change", () => {
  const history = new MemoryHistory();
  let nodes;
  for (let i = 0; i < 65; i++) {
    nodes = build([terminal("t1", 10, placed)], [], { now: at + i, snapshots: new Map([["", snapshot([process(10, 0, i)], { processes: channel([process(10, 0, i)], { at: at + i }) })]]) });
    history.update(nodes, at + i);
    history.update(nodes, at + i + 1);
  }
  const node = leaf(nodes, "t1");
  assert.deepEqual(history.get(node), Array.from({ length: 60 }, (_, i) => i + 5));
  assert.equal(history.get(nodes[0]).length, 60);
  const copy = history.get(node); copy.push(999);
  assert.equal(history.get(node).length, 60);
  const rebuilt = build([terminal("t1", 10, placed)], [process(10, 0, 999)], { now: at + 100 });
  history.update(rebuilt, at + 100);
  assert.equal(history.get(leaf(rebuilt, "t1")).length, 60);
  const reused = build([terminal("t1", 10, placed)], [process(10, 0, 77, { start: "new-start" })]);
  history.update(reused, at);
  assert.deepEqual(history.get(leaf(reused, "t1")), [77]);
  assert.deepEqual(history.get(reused[0]), [77]);
  const windows = build([terminal("t1", 10, placed)], [], { snapshots: new Map([["", snapshot([process(10)], { platform: "windows" })]]) });
  history.update(windows, at);
  assert.deepEqual(history.get(leaf(windows, "t1")), [10]);
  history.update([], at);
  assert.deepEqual(history.get(node.id), []);
  history.update(windows, at);
  history.clear();
  assert.deepEqual(history.get(leaf(windows, "t1")), []);
});

test("stale, failed, unknown identity and incomplete samples never append trends", () => {
  const history = new MemoryHistory();
  const terminals = [terminal("t1", 10, placed)];
  const good = build(terminals, [process(10)]);
  history.update(good, at);
  const failed = build(terminals, [], { snapshots: new Map([["", snapshot([], { processes: channel([process(10)], { state: "error" }) })]]) });
  history.update(failed, at + 1);
  assert.deepEqual(history.get(leaf(failed, "t1")), [10]);
  const stale = build(terminals, [process(10)], { now: at + 10001 });
  history.update(stale, at + 10001);
  assert.deepEqual(history.get(leaf(stale, "t1")), [10]);
  const partial = build(terminals, [], { snapshots: new Map([["", snapshot([], { processes: channel([process(10, 0, 999)], { state: "partial", at: at + 1 }) })]]) });
  history.update(partial, at + 1);
  assert.deepEqual(history.get(leaf(partial, "t1")), [10]);
  const unidentified = build(terminals, [process(10, 0, 100, { start: null })]);
  history.update(unidentified, at);
  assert.deepEqual(history.get(leaf(unidentified, "t1")), []);
});

test("Unix process records preserve stable identity, bytes and multi-core CPU; malformed coverage is partial", () => {
  const result = parsePs(" 10 1 125.5 2048 Wed Nov 11 12:00:00 2026 /Applications/Some App/node\ninvalid record\n", at);
  assert.equal(result.state, "partial");
  assert.deepEqual(result.rows, [{ pid: 10, ppid: 1, cpu: 125.5, memory: 2097152, start: "Wed Nov 11 12:00:00 2026", name: "node" }]);
  assert.equal(parsePs("", at).state, "error");
});

test("socket parsers retain shared identity, wildcard families and hidden-owner uncertainty", () => {
  const lsof = parseLsof("p10\0\nf3\0tIPv4\0D0xabc\0i0\0n*:3000\0PTCP\0\nf4\0tIPv4\0D0xabc\0n*:3000\0PTCP\0\nf5\0tIPv6\0D0xdef\0n[::1]:3000\0PTCP\0\n", at);
  assert.equal(lsof.state, "partial");
  assert.deepEqual(lsof.rows.map(p => [p.address, p.family, p.socket]), [["0.0.0.0", "ipv4", "device:0xabc"], ["::1", "ipv6", "device:0xdef"]]);
  const ss = parseSs('LISTEN 0 128 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=10,fd=3),("node",pid=11,fd=4)) ino:55\nLISTEN 0 128 [::]:4000 [::]:* ino:56 v6only:1\n', at);
  assert.equal(ss.state, "partial");
  assert.deepEqual(ss.rows.map(p => [p.pid, p.address, p.socket]), [[10, "127.0.0.1", "inode:55"], [11, "127.0.0.1", "inode:55"], [0, "::", "inode:56"]]);
  assert.equal(parseSs("LISTEN 0 128 *:3000 *:*", at).state, "error");
});

test("host parsers never substitute free pages for available memory, and footprint keeps its own units", () => {
  assert.equal(parseMeminfo("MemTotal: 1000 kB\nMemFree: 20 kB\n", at).state, "unavailable");
  assert.equal(parseMeminfo("MemTotal: 1000 kB\nMemAvailable: 400 kB\n", at).available, 409600);
  assert.equal(parseMemoryPressure("The system has 1024000 (250 pages with a page size of 4096).\nSystem-wide memory free percentage: 40%", at).available, 409600);
  const result = parseTop("PID MEM\n10 1.5G+\n11 512K-\n", [{ pid: 10, start: "stable" }], at);
  assert.deepEqual(result.rows, [{ pid: 10, start: "stable", bytes: 1610612736 }, { pid: 11, start: null, bytes: 524288 }]);
});

test("Windows CPU uses elapsed time and start identity; warmup, reuse and stale intervals remain unknown", () => {
  const json = (seconds, start = "created") => JSON.stringify({ rows: [{ pid: 10, ppid: 1, name: "node.exe", start, memory: 4096, seconds }] });
  const first = parseWindowsProcesses(json(1), null, at);
  assert.equal(first.rows[0].cpu, null);
  assert.equal(parseWindowsProcesses(json(4), first, at + 2000).rows[0].cpu, 150);
  assert.equal(parseWindowsProcesses(json(4, "reused"), first, at + 2000).rows[0].cpu, null);
  assert.equal(parseWindowsProcesses(json(4), first, at + 10001).rows[0].cpu, null);
  assert.equal(parseWindowsProcesses(json(22), first, at + 10500, 15000).rows[0].cpu, 200);
  assert.equal(parseWindowsProcesses(json(22), first, at + 15001, 15000).rows[0].cpu, null);
  assert.equal(parseWindowsProcesses(json(null), first, at + 2000).rows[0].cpu, null);
  assert.equal(parseWindowsProcesses(json(0), first, at + 2000).rows[0].cpu, null);
  const ports = parseWindowsListeners(JSON.stringify({ rows: [{ pid: 10, address: "::1", port: 3000 }, { pid: 0, address: "0.0.0.0", port: 80 }] }), at);
  assert.equal(ports.state, "partial");
  assert.deepEqual(ports.rows.map(p => p.family), ["ipv6", "ipv4"]);
});

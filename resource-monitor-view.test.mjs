import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createCollector } from "./mods/resource-monitor/collect.js";
import { buildResources, MemoryHistory } from "./mods/resource-monitor/model.js";
import { buildResourceTree, processRows, resourceRows } from "./mods/resource-monitor/tree.js";

const source = readFileSync(new URL("./mods/resource-monitor/main.js", import.meta.url), "utf8")
  .replace(/^import .+;\n/gm, "").replace("export default class ResourceMonitor", "globalThis.ResourceMonitor = class ResourceMonitor");
function fixture({ delayed = false } = {}) {
  const host = { active: true, notifications: 0, calls: [], jobs: [], timers: [], inputs: [],
    terminals: [{ address: "t1", pid: 10, state: "live", labels: { "herdr.tab": "tab1" } }] };
  const handle = () => ({ released: false, focus() {}, release() { this.released = true; } });
  const element = kind => {
    const node = { kind, items: [], attributes: {} };
    const proxy = new Proxy(node, { get(target, key) {
      if (key in target) return target[key];
      return (...args) => {
        if (key === "when") { if (args[0]) args[1](proxy); }
        else if (key === "child" || key === "trigger" || key === "content") target.items.push(args[0]);
        else if (key === "children") target.items.push(...args[0]);
        else target.attributes[key] = args[0];
        return proxy;
      };
    } });
    return proxy;
  };
  const component = kind => ({ new(id) { const node = element(kind); node.attributes.id = id; return node; } });
  const cx = {
    notify() { host.notifications++; }, focus_handle: handle,
    spawn(fn) { host.jobs.push(Promise.resolve().then(() => fn(cx))); },
    timer: { every(ms, fn) { const timer = { ms, fn, cancelled: false, cancel() { this.cancelled = true; } }; host.timers.push(timer); return timer; } }
  };
  const context = vm.createContext({
    View: class {}, Button: component("button"), Popover: component("popover"), Tab: component("tab"), Tabs: component("tabs"),
    Input: component("input"), Scrollbar: { vertical: () => element("scrollbar") },
    h_flex: () => element("flex"), v_flex: () => element("column"), div: () => element("div"), svg: path => element(path), theme: () => ({}),
    v_virtual_list: (_id, count, _height, _key, render) => {
      const node = element("list");
      node.items.push(...render({ start: 0, end: count }));
      return node;
    },
    InputState: { new() {
      const state = { ...handle(), text: "", value() { return this.text; }, set_value(s) { this.text = s; }, on() {} };
      host.inputs.push(state); return state;
    } }, VirtualListScrollHandle: { new: handle },
    createCollector, buildResources, MemoryHistory, buildResourceTree, processRows, resourceRows,
    props: () => ({}), appHome: () => "/fixture-home",
    appWindow: () => ({ active: host.active, platform: "macos" }),
    focused: () => ({ space: "s1" }), terminals: () => host.terminals,
    spaces: () => [{ id: "s1", active: true, tabs: [{ id: "tab1" }] }],
    panes: () => [], agents: () => [], machines: () => [{ name: null, layout: "available" }],
    exec(_path, args) {
      host.calls.push(args);
      const n = host.calls.length;
      const reply = () => ({ code: 0, stderr: "", stdout: JSON.stringify({
        schema: 1, platform: "macos", monotonic: n, topologyComplete: false,
        rows: [{ pid: 10, ppid: 1, name: "shell", start: "birth", seconds: n * (host.cpuScale ?? 1), memory: 200, footprint: host.memory ?? 100 },
          ...(host.extraRows ?? [])],
        host: { total: 1000, available: null }, listeners: args.includes("--ports") || args.includes("--all-ports")
          ? { rows: [], complete: true, scope: args.includes("--all-ports") ? "all" : "managed" } : null
      }) });
      return delayed ? new Promise(resolve => { host.resolve = () => resolve(reply()); }) : Promise.resolve(reply());
    }
  });
  vm.runInContext(source, context);
  const view = new context.ResourceMonitor();
  view.init({}, cx);
  const flush = async () => { while (host.jobs.length) await Promise.all(host.jobs.splice(0)); };
  return { host, cx, view, flush, tick: async () => { host.timers[0].fn(cx); await flush(); } };
}

test("one scheduler shares footer/panel samples, suppresses unchanged footer redraws and pauses when inactive", async t => {
  const { host, view, flush, tick } = fixture();
  t.after(() => view.close());
  await flush();
  assert.equal(host.timers.length, 1);
  assert.equal(host.timers[0].ms, 1000);
  await tick();
  const notifications = host.notifications;
  await tick();
  assert.equal(host.notifications, notifications);
  assert.equal(view.summary().cpu, 100);
  host.active = false;
  const count = host.calls.length;
  await tick();
  assert.equal(host.calls.length, count);
  host.active = true;
  await tick();
  assert.equal(view.summary().cpu, null);
});

test("footer shows CPU and memory without approximation or terminal count, and refreshes CPU-only changes", async t => {
  const { host, view, cx, flush, tick } = fixture();
  t.after(() => view.close());
  await flush();
  host.memory = 1024 ** 3;
  await tick();
  assert.ok(view.summary().root.unknown);
  const ui = view.render(cx);
  const text = node => typeof node === "string" ? [node] : node.items.flatMap(text);
  assert.deepEqual(text(ui), ["100.0%", "·", "1.00 GB"]);
  const notifications = host.notifications;
  host.cpuScale = 2;
  await tick();
  assert.ok(host.notifications > notifications);
  assert.deepEqual(text(view.render(cx)), ["400.0%", "·", "1.00 GB"]);
});

test("an open Resources panel redraws when displayed CPU changes, and skips unchanged samples", async t => {
  const { host, view, flush, tick } = fixture();
  t.after(() => view.close());
  await flush();
  view.open = true;
  await tick();
  const notifications = host.notifications;
  await tick();
  assert.equal(host.notifications, notifications);
  host.cpuScale = 2;
  await tick();
  assert.ok(host.notifications > notifications);
});

test("Processes tab renders a flat sortable table and shares sampling without querying listeners", async t => {
  const { host, view, cx, flush, tick } = fixture();
  t.after(() => view.close());
  host.extraRows = [{ pid: 11, ppid: 10, name: "worker", start: "child-birth", seconds: 1, memory: 300, footprint: 200 }];
  await flush();
  view.open = true;
  const walk = node => typeof node === "string" ? [] : [node, ...node.items.flatMap(walk)];
  const text = node => typeof node === "string" ? [node] : node.items.flatMap(text);
  const button = (ui, id) => walk(ui).find(node => node.attributes.id === id);
  const ui = view.panel(cx);
  const beforeSwitch = host.calls.length;
  button(ui, "resource-tab-processes").attributes.on_click({}, cx);
  await flush();
  assert.equal(host.calls.length, beforeSwitch);
  assert.equal(view.tab, "processes");
  assert.deepEqual(view.rows.map(row => row.process.pid), [11, 10]);
  assert.ok(view.rows.every(row => row.depth === 0 && row.type === "process"));
  const table = view.panel(cx);
  assert.ok(text(table).includes("Processes"));
  assert.ok(text(table).includes("PID"));
  assert.ok(text(table).includes("worker"));
  assert.ok(text(table).includes("11"));
  assert.equal(walk(table).filter(node => node.kind === "input").length, 2);
  button(table, "resource-sort-pid").attributes.on_click({}, cx);
  assert.deepEqual(view.rows.map(row => row.process.pid), [10, 11]);
  const expanded = [...view.expanded];
  view.activate(view.rows[0].id, cx);
  assert.deepEqual([...view.expanded], expanded);
  view.filters.pid.set_value("11");
  view.flatten();
  assert.deepEqual(view.rows.map(row => row.process.pid), [11]);
  const calls = host.calls.length;
  await tick();
  assert.equal(host.calls.length, calls + 1);
  assert.equal(host.timers.length, 1);
  assert.ok(host.calls.every(args => !args.includes("--ports") && !args.includes("--all-ports")));
  button(table, "resource-tab-resources").attributes.on_click({}, cx);
  await flush();
  assert.equal(view.sort, "memory");
  assert.equal(view.filters.pid.value(), "");
  assert.equal(view.rows[0].type, "node");
});

test("only the visible Terminals tab requests listeners; CPU-only ticks retain listener topology", async t => {
  const { host, view, cx, flush, tick } = fixture();
  t.after(() => view.close());
  await flush();
  assert.equal(host.calls[0].includes("--ports"), false);
  view.open = true;
  view.refresh(cx);
  await flush();
  assert.equal(host.calls.at(-1).includes("--ports"), false);
  view.tab = "terminals";
  view.refresh(cx);
  await flush();
  assert.equal(host.calls.at(-1).includes("--ports"), true);
  const metadata = view.snapshots.get("").listeners.processes;
  await tick();
  assert.equal(host.calls.at(-1).includes("--ports"), false);
  assert.equal(view.snapshots.get("").listeners.processes, metadata);
  view.filters.port.set_value("8080");
  view.flatten();
  view.portsAt.clear();
  await tick();
  assert.equal(host.calls.at(-1).includes("--all-ports"), true);
  assert.equal(view.snapshots.get("").listeners.scope, "all");
  view.open = false;
  view.portsAt.clear();
  await tick();
  assert.equal(host.calls.at(-1).includes("--ports"), false);
  assert.equal(host.calls.at(-1).includes("--all-ports"), false);
});

test("closing the owning view releases handles and ignores an already dispatched sample", async () => {
  const { host, view, flush } = fixture({ delayed: true });
  await Promise.resolve();
  assert.equal(host.calls.length, 1);
  view.close();
  const notifications = host.notifications;
  host.resolve();
  await flush();
  assert.equal(view.snapshots.size, 0);
  assert.equal(host.notifications, notifications);
  assert.equal(host.timers[0].cancelled, true);
  assert.equal(view.handle.released, true);
  assert.equal(host.inputs.every(input => input.released), true);
});

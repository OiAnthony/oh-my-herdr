import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createCollector } from "./mods/resource-monitor/collect.js";
import { buildResources, MemoryHistory } from "./mods/resource-monitor/model.js";
import { buildResourceTree, processRows, resourceRows } from "./mods/resource-monitor/tree.js";
import { bytes, cpu, footerCpu, footerCpuColor, endpoint, clean } from "./mods/resource-monitor/format.js";

const source = readFileSync(new URL("./mods/resource-monitor/main.js", import.meta.url), "utf8")
  .replace(/^import .+;\n/gm, "").replace("export default class ResourceMonitor", "globalThis.ResourceMonitor = class ResourceMonitor");
const walk = node => typeof node === "string" ? [] : [node, ...node.items.flatMap(walk)];
const text = node => typeof node === "string" ? [node] : node.items.flatMap(text);
const button = (ui, id) => walk(ui).find(node => node.attributes.id === id);
function fixture({ delayed = false } = {}) {
  const host = { active: true, notifications: 0, calls: [], jobs: [], timers: [],
    theme: { ansi2: "#4ade80", ansi3: "#facc15", ansi1: "#f87171", muted: "#9198a1" },
    terminals: [{ address: "t1", pid: 10, state: "live", labels: { "herdr.tab": "tab1" } }] };
  const handle = () => ({ released: false, focus() {}, scroll_to_item() {}, release() { this.released = true; } });
  const element = kind => {
    const node = { kind, items: [], attributes: {} };
    const proxy = new Proxy(node, { get(target, key) {
      if (key in target) return target[key];
      return (...args) => {
        if (key === "when") { if (args[0]) args[1](proxy); }
        else if (key === "child" || key === "trigger" || key === "content") target.items.push(args[0]);
        else if (key === "children") target.items.push(...args[0]);
        else if (key === "on_action") {
          target.actions ??= {};
          target.actions[args[0]] = args[1];
        }
        else target.attributes[key] = args[0];
        return proxy;
      };
    } });
    return proxy;
  };
  const component = kind => ({ new(id) { const node = element(kind); node.attributes.id = id; return node; } });
  const cx = {
    notify() { host.notifications++; }, focus_handle: handle, stop_propagation() { host.stopped = true; },
    bind_keys(bindings) { host.bindings = bindings; },
    spawn(fn) { host.jobs.push(Promise.resolve().then(() => fn(cx))); },
    timer: { every(ms, fn) { const timer = { ms, fn, cancelled: false, cancel() { this.cancelled = true; } }; host.timers.push(timer); return timer; } }
  };
  const context = vm.createContext({
    Date,
    View: class {}, Button: component("button"), Popover: component("popover"), Tab: component("tab"), Tabs: component("tabs"), Toggle: component("toggle"),
    PathBuilder: { stroke: () => ({ move_to() {}, line_to() {}, build() { return {}; } }) },
    window: { paint_path: () => element("path"), viewport_size: () => host.viewport ?? { width: 1200, height: 1000 } },
    Scrollbar: { vertical: () => element("scrollbar") },
    h_flex: () => element("flex"), v_flex: () => element("column"), div: () => element("div"), svg: path => element(path), theme: () => host.theme,
    v_virtual_list: (_id, count, _height, _key, render) => {
      const node = element("list");
      node.items.push(...render({ start: 0, end: count }));
      return node;
    },
    VirtualListScrollHandle: { new: handle },
    createCollector, buildResources, MemoryHistory, buildResourceTree, processRows, resourceRows, bytes, cpu, footerCpu, footerCpuColor, endpoint, clean,
    props: () => ({}), appHome: () => "/fixture-home",
    appWindow: () => ({ active: host.active, platform: "macos" }),
    focused: () => ({ space: "s1" }), terminals: () => host.terminals,
    spaces: () => [{ id: "s1", active: true, tabs: [{ id: "tab1" }] }],
    panes: () => [], agents: () => [], machines: () => [{ name: null, layout: "available" }],
    exec(_path, args) {
      host.calls.push(args);
      const n = host.calls.length;
      const reply = () => ({ code: 0, stderr: "", stdout: JSON.stringify({
        schema: 1, platform: "macos", monotonic: n, topologyComplete: host.topologyComplete ?? false,
        rows: [{ pid: 10, ppid: 1, name: "shell", start: "birth", seconds: n * (host.cpuScale ?? 1), memory: 200, footprint: host.memory ?? 100 },
          ...(host.extraRows ?? [])],
        host: { total: 1000, available: null }, listeners: args.includes("--ports") || args.includes("--all-ports")
          ? { rows: host.listeners ?? [], complete: true, scope: args.includes("--all-ports") ? "all" : "managed" } : null
      }) });
      return delayed ? new Promise(resolve => { host.resolve = () => resolve(reply()); }) : Promise.resolve(reply());
    }
  });
  vm.runInContext(source, context);
  const view = new context.ResourceMonitor();
  view.init({}, cx);
  const flush = async () => { while (host.jobs.length) await Promise.all(host.jobs.splice(0)); };
  const dispatchKey = key => {
    const panel = button(view.panel(cx), "resource-manager");
    const binding = host.bindings.find(binding => binding.keystroke === key && binding.context === panel.attributes.key_context);
    if (binding) panel.actions[binding.action]({}, cx);
    // Popover's Confirm/Cancel actions dispatch before raw key events.
    else if (["space", "enter", "escape"].includes(key)) {
      button(view.render(cx), "resource-status-popover").attributes.on_open_change(key === "escape" ? false : !view.open, cx);
    } else panel.attributes.on_key_down({ key, key_char: key.length === 1 ? key : undefined, modifiers: {} }, cx);
    panel.attributes.on_key_up({ key });
  };
  return { host, cx, view, flush, dispatchKey, tick: async () => { host.timers[0].fn(cx); await flush(); } };
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

test("footer CPU uses stable tenths, integer percentages above 100, and a themed green-yellow-red ramp", async t => {
  const { host, view, cx, flush } = fixture();
  t.after(() => view.close());
  await flush();
  const summary = view.summary();
  let value;
  view.summary = () => ({ ...summary, cpu: value });
  for (const [sample, expected] of [
    [null, "—"], [NaN, "—"], [Infinity, "—"], [0, "0.0%"],
    [0.1, "0.1%"], [1, "1.0%"], [5.78, "5.8%"], [9.99, "10.0%"], [9.999, "10.0%"],
    [10, "10.0%"], [99.9, "99.9%"], [99.99, "100%"], [100, "100%"],
    [120, "120%"], [400, "400%"], [1600, "1600%"]
  ]) {
    value = sample;
    assert.equal(text(view.render(cx))[0], expected);
  }
  value = 1.001;
  const before = view.footerSignature();
  value = 1.009;
  assert.equal(view.footerSignature(), before);
  assert.equal(text(view.render(cx))[0], "1.0%");
  value = 1.06;
  assert.notEqual(view.footerSignature(), before);
  for (const [sample, expected] of [
    [null, host.theme.muted], [0, host.theme.ansi2], [25, "#a2d54b"],
    [50, host.theme.ansi3], [75, "#f99f43"], [100, host.theme.ansi1], [120, host.theme.ansi1]
  ]) {
    value = sample;
    const row = button(view.render(cx), "resource-status-trigger").items[0].items[0];
    assert.equal(row.items[0].attributes.text_color, expected);
    assert.equal(row.items[1].attributes.text_color, expected);
  }
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
  assert.deepEqual(text(ui), ["100%", " · ", "1.00 GB"]);
  const notifications = host.notifications;
  host.cpuScale = 2;
  await tick();
  assert.ok(host.notifications > notifications);
  assert.deepEqual(text(view.render(cx)), ["400%", " · ", "1.00 GB"]);
});

test("footer popover resolves its panel size in pixels before anchoring, including small windows", t => {
  const { host, view, cx } = fixture();
  t.after(() => view.close());
  view.open = true;
  for (const [viewport, width, height] of [
    [{ width: 1200, height: 1000 }, 416, 640],
    [{ width: 900, height: 700 }, 416, 595],
    [{ width: 320, height: 400 }, 304, 340]
  ]) {
    host.viewport = viewport;
    const ui = view.render(cx);
    const popover = button(ui, "resource-status-popover");
    const panel = button(ui, "resource-manager");
    assert.equal(popover.attributes.anchor, "bottom_right");
    assert.equal(panel.attributes.w, width);
    assert.equal(panel.attributes.h, height);
    assert.equal(panel.attributes.max_w, undefined);
    assert.equal(panel.attributes.max_h, undefined);
  }
});

test("an open Tree panel redraws when displayed CPU changes, and skips unchanged samples", async t => {
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

test("Tree combines resource hierarchy, filters and memory trend without collecting ports by default", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const { host, view, cx, flush, tick } = fixture();
  t.after(() => view.close());
  host.topologyComplete = true;
  await flush();
  t.mock.timers.tick(1000);
  await tick();
  view.open = true;
  const ui = view.panel(cx);
  assert.equal(view.tab, "tree");
  assert.deepEqual(walk(ui).filter(node => node.kind === "tab").map(node => node.attributes.id),
    ["resource-tab-tree", "resource-tab-processes"]);
  assert.ok(text(ui).includes("Tree"));
  assert.equal(walk(ui).filter(node => node.kind === "input").length, 0);
  assert.ok(walk(ui).some(node => node.kind === "path"));
  assert.equal(button(ui, "resource-show-ports").attributes.pressed, false);
  assert.ok(host.calls.every(args => !args.includes("--ports") && !args.includes("--all-ports")));
  view.query = "shell 10";
  view.flatten(true);
  assert.deepEqual(view.rows.filter(row => row.type === "process").map(row => row.process.pid), [10]);
});

test("Processes tab renders a flat sortable table and shares sampling without querying listeners", async t => {
  const { host, view, cx, flush, tick } = fixture();
  t.after(() => view.close());
  host.extraRows = [{ pid: 11, ppid: 10, name: "worker", start: "child-birth", seconds: 1, memory: 300, footprint: 200 }];
  await flush();
  view.open = true;
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
  assert.equal(walk(table).filter(node => node.kind === "input").length, 0);
  button(table, "resource-sort-pid").attributes.on_click({}, cx);
  assert.deepEqual(view.rows.map(row => row.process.pid), [10, 11]);
  const expanded = [...view.expanded];
  view.activate(view.rows[0].id, cx);
  assert.deepEqual([...view.expanded], expanded);
  view.query = "worker 11";
  view.flatten();
  assert.deepEqual(view.rows.map(row => row.process.pid), [11]);
  const calls = host.calls.length;
  await tick();
  assert.equal(host.calls.length, calls + 1);
  assert.equal(host.timers.length, 1);
  assert.ok(host.calls.every(args => !args.includes("--ports") && !args.includes("--all-ports")));
  button(table, "resource-tab-tree").attributes.on_click({}, cx);
  await flush();
  assert.equal(view.sort, "memory");
  assert.equal(view.query, "");
  assert.equal(view.rows[0].type, "node");
});

test("Tree ports toggle gates sampling, filtering and cached port rows", async t => {
  const { host, view, cx, flush, tick } = fixture();
  t.after(() => view.close());
  host.listeners = [{ pid: 10, port: 8080, family: "ipv4", address: "127.0.0.1", protocol: "tcp", socket: "listener" }];
  await flush();
  assert.equal(host.calls[0].includes("--ports"), false);
  view.open = true;
  view.refresh(cx);
  await flush();
  assert.equal(host.calls.at(-1).includes("--ports"), false);
  button(view.panel(cx), "resource-show-ports").attributes.on_change(true, cx);
  await flush();
  assert.equal(host.calls.at(-1).includes("--ports"), true);
  assert.equal(walk(view.panel(cx)).filter(node => node.kind === "input").length, 0);
  view.query = "shell 10";
  view.flatten(true);
  assert.ok(view.rows.some(row => row.type === "port" && row.port.port === 8080));
  const metadata = view.snapshots.get("").listeners.processes;
  await tick();
  assert.equal(host.calls.at(-1).includes("--ports"), false);
  assert.equal(view.snapshots.get("").listeners.processes, metadata);
  view.query = "shell 8080";
  view.flatten();
  view.portsAt.clear();
  await tick();
  assert.equal(host.calls.at(-1).includes("--all-ports"), true);
  assert.equal(view.snapshots.get("").listeners.scope, "all");
  button(view.panel(cx), "resource-show-ports").attributes.on_change(false, cx);
  assert.equal(view.query, "shell 8080");
  assert.equal(view.portSearch, false);
  assert.ok(view.rows.every(row => row.type !== "port"));
  assert.equal(walk(view.panel(cx)).filter(node => node.kind === "input").length, 0);
  await tick();
  assert.equal(host.calls.at(-1).includes("--ports"), false);
  assert.equal(host.calls.at(-1).includes("--all-ports"), false);
  button(view.panel(cx), "resource-show-ports").attributes.on_change(true, cx);
  await flush();
  button(view.panel(cx), "resource-tab-processes").attributes.on_click({}, cx);
  view.portsAt.clear();
  await tick();
  assert.equal(host.calls.at(-1).includes("--ports"), false);
  assert.equal(host.calls.at(-1).includes("--all-ports"), false);
  button(view.panel(cx), "resource-tab-tree").attributes.on_click({}, cx);
  await flush();
  assert.equal(host.calls.at(-1).includes("--ports"), true);
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
});

const press = (view, cx, key, extra = {}) => {
  view.key({ key, key_char: key.length === 1 ? key : undefined, modifiers: {}, ...extra }, cx);
  if (!extra.is_held) button(view.panel(cx), "resource-manager").attributes.on_key_up({ key });
};

test("typing filters both tabs, spaces combine keywords, Backspace edits, and Escape clears before closing", async t => {
  const { view, host, cx, flush } = fixture();
  t.after(() => view.close());
  host.extraRows = [{ pid: 11, ppid: 10, name: "Worker", start: "child", seconds: 1, memory: 1024 ** 2, footprint: 1024 ** 2 }];
  await flush();
  view.open = true;
  for (const tab of ["tree", "processes"]) {
    button(view.panel(cx), `resource-tab-${tab}`).attributes.on_click({}, cx);
    const before = view.rows.length;
    for (const key of ["W", "o", "r", "k", "e", "r", "space", "1", "1"]) press(view, cx, key);
    assert.equal(view.query, "Worker 11");
    assert.equal(view.searching, true);
    assert.deepEqual(view.rows.filter(row => row.type === "process" && row.process.pid === 11).map(row => row.process.pid), [11]);
    assert.ok(text(view.panel(cx)).includes("Filter: Worker 11"));
    press(view, cx, "z");
    assert.equal(view.rows.length, 0);
    assert.ok(text(view.panel(cx)).includes("No matching resources"));
    press(view, cx, "backspace");
    assert.ok(view.rows.length > 0);
    press(view, cx, "escape");
    assert.equal(view.open, true);
    assert.equal(view.query, "");
    assert.equal(view.searching, false);
    assert.ok(view.rows.length >= before);
    const panel = button(view.panel(cx), "resource-manager");
    view.query = "worker";
    view.flatten(true);
    panel.actions.resource_monitor_escape({}, cx);
    panel.actions.resource_monitor_escape({}, cx);
    assert.equal(view.open, true);
    assert.equal(view.query, "");
    panel.attributes.on_key_up({ key: "escape" });
  }
  press(view, cx, "escape");
  assert.equal(view.open, false);
  assert.equal(host.stopped, true);
  assert.equal(host.bindings[0].context, "ResourceManager");
});

test("Resource Manager actions override Popover space and Enter bindings before raw key events", async t => {
  const { view, cx, dispatchKey, flush } = fixture();
  t.after(() => view.close());
  await flush();
  view.open = true;
  for (const tab of ["tree", "processes"]) {
    button(view.panel(cx), `resource-tab-${tab}`).attributes.on_click({}, cx);
    dispatchKey("space");
    assert.equal(view.open, true, `${tab}: a leading space must not close the popover`);
    assert.equal(view.query, " ");
    dispatchKey("escape");
    assert.equal(view.open, true);
    for (const key of ["s", "h", "e", "l", "l", "space", "1", "0"]) dispatchKey(key);
    assert.equal(view.query, "shell 10");
    assert.ok(view.rows.some(row => row.type === "process" && row.process.pid === 10));
    assert.equal(view.open, true, `${tab}: a keyword separator must not close the popover`);
    const selected = view.selected;
    const expanded = view.expanded.has(selected);
    dispatchKey("enter");
    assert.equal(view.open, true, `${tab}: Enter must activate a row instead of toggling the popover`);
    assert.equal(view.query, "shell 10");
    if (tab === "tree") assert.equal(view.expanded.has(selected), !expanded);
    dispatchKey("escape");
    assert.equal(view.query, "");
    assert.equal(view.open, true);
  }
  dispatchKey("escape");
  assert.equal(view.open, false);
});

test("shortcuts and navigation never enter the query, while spaces and Unicode are searchable text", async t => {
  const { view, cx, flush } = fixture();
  t.after(() => view.close());
  await flush();
  view.open = true;
  for (const modifier of ["control", "platform", "alt"]) press(view, cx, "a", { modifiers: { [modifier]: true } });
  for (const key of ["up", "down", "left", "right", "enter", "tab"]) press(view, cx, key);
  assert.equal(view.query, "");
  press(view, cx, "space");
  assert.equal(view.searching, true);
  press(view, cx, "escape");
  assert.equal(view.open, true);
  press(view, cx, "x", { key_char: "🚀" });
  press(view, cx, "backspace");
  assert.equal(view.query, "");
  press(view, cx, "/", { key_char: "/" });
  assert.equal(view.query, "/");
});

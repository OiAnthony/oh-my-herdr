import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./mods/tabs-professional/main.js", import.meta.url), "utf8")
  .replace(/^import .+;\n/gm, "").replace("export default class Tabs", "globalThis.Tabs = class Tabs");

function fixture() {
  const panel = { id: "panel", hidden: true }, body = { id: "panel-body", active: "files" };
  const graph = { id: "graph-panel", hidden: true };
  const host = { now: 0, calls: [], timers: [], target: { space: "s1", tab: "t1", pane: "p1" }, layout: "Professional" };
  let receive;
  const cx = {
    spawn(fn) { fn(cx); },
    timer: { after(ms, fn) {
      const task = { at: host.now + ms, fn, cancelled: false, cancel() { this.cancelled = true; } };
      host.timers.push(task);
      return task;
    } },
  };
  const context = vm.createContext({
    View: class {}, Date: { now: () => host.now },
    localStorage: { getItem: () => null },
    nextCommand: () => new Promise(resolve => { receive = resolve; }),
    focused: () => host.target,
    shared: key => key === "layout" ? host.layout : null,
    setShared: (key, value) => host.calls.push({ key, value, at: host.now }),
    layout: () => ({ children: [panel, body, graph] }),
    run: (command, args) => {
      host.calls.push({ command, args: { ...args }, at: host.now });
      if (args.id === "panel") panel.hidden = command === "layout.hide";
      if (args.id === "graph-panel") graph.hidden = command === "layout.toggle" ? !graph.hidden : command === "layout.hide";
      if (command === "layout.select") body.active = args.child;
    },
  });
  vm.runInContext(source, context);
  const view = new context.Tabs();
  view.init({}, cx);
  const send = async command => { receive(command); await new Promise(setImmediate); };
  const advance = ms => {
    const end = host.now + ms;
    for (;;) {
      const task = host.timers.filter(t => !t.cancelled && t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!task) break;
      host.now = Math.max(host.now, task.at);
      task.cancelled = true;
      task.fn(cx);
    }
    host.now = end;
  };
  const commands = () => host.calls.filter(call => call.command);
  return { host, view, panel, body, graph, send, advance, commands };
}

test("a single Changes press waits 300ms, then opens and focuses Changes", async () => {
  const f = fixture();
  await f.send("toggle-changes");
  assert.deepEqual(f.commands(), []);
  f.advance(299);
  assert.deepEqual(f.commands(), []);
  f.advance(1);
  assert.equal(f.panel.hidden, false);
  assert.equal(f.body.active, "changes");
  assert.ok(f.host.calls.some(call => call.key === "professional-panels.focus" && call.value === "changes"));
});

test("two presses within 300ms toggle Graph without changing side panel visibility", async () => {
  for (const hidden of [true, false]) {
    const f = fixture();
    f.panel.hidden = hidden;
    f.body.active = "changes";
    await f.send("toggle-changes");
    f.advance(299);
    await f.send("toggle-changes");
    assert.deepEqual(f.commands().map(call => [call.command, call.args.id]), [["layout.toggle", "graph-panel"]]);
    f.advance(1000);
    assert.equal(f.commands().length, 1);
    assert.equal(f.panel.hidden, hidden);
  }
});

test("repeating the single shortcut toggles Changes even with terminal focus", async () => {
  const f = fixture();
  await f.send("toggle-changes");
  f.advance(300);
  assert.equal(f.panel.hidden, false);
  assert.equal(f.body.active, "changes");
  await f.send("toggle-changes");
  f.advance(300);
  assert.equal(f.panel.hidden, true);
  assert.ok(f.commands().some(call => call.command === "pane.focus" && call.args.pane === "p1"));
  assert.equal(f.graph.hidden, true);
});

test("repeating the double shortcut toggles Graph while leaving the side panel unchanged", async () => {
  const f = fixture();
  f.panel.hidden = false;
  const double = async () => {
    await f.send("toggle-changes");
    f.advance(100);
    await f.send("toggle-changes");
    f.advance(300);
  };
  await double();
  assert.equal(f.graph.hidden, false);
  await double();
  assert.equal(f.graph.hidden, true);
  assert.equal(f.panel.hidden, false);
  assert.equal(f.body.active, "files");
  assert.deepEqual(f.commands().map(call => call.command), ["layout.toggle", "layout.toggle"]);
});

test("presses 300ms apart execute two single actions", async () => {
  const f = fixture();
  await f.send("toggle-changes");
  f.advance(300);
  await f.send("toggle-changes");
  f.advance(300);
  assert.equal(f.panel.hidden, true);
  assert.equal(f.commands().some(call => call.args.id === "graph-panel"), false);
});

test("a delayed timer does not extend the double press deadline", async () => {
  const f = fixture();
  await f.send("toggle-changes");
  f.host.now = 301;
  await f.send("toggle-changes");
  assert.equal(f.panel.hidden, false);
  f.advance(300);
  assert.equal(f.panel.hidden, true);
  assert.equal(f.commands().some(call => call.args.id === "graph-panel"), false);
});

test("switching space, tab or layout discards the pending press", async () => {
  for (const change of [
    f => { f.host.target = { ...f.host.target, space: "s2" }; },
    f => { f.host.target = { ...f.host.target, tab: "t2" }; },
    f => { f.host.layout = "main"; },
  ]) {
    const f = fixture();
    await f.send("toggle-changes");
    change(f);
    f.advance(300);
    assert.deepEqual(f.commands(), []);
  }
});

test("Files takes focus immediately and cancels pending Changes; closing cancels its timer", async () => {
  const f = fixture();
  await f.send("toggle-changes");
  f.advance(100);
  await f.send("focus-files");
  assert.equal(f.panel.hidden, false);
  assert.equal(f.body.active, "files");
  f.advance(300);
  assert.equal(f.body.active, "files");
  const count = f.commands().length;
  await f.send("toggle-changes");
  f.view.close();
  f.advance(300);
  assert.equal(f.commands().length, count);
});

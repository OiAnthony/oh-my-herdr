import { View, div, svg, PathBuilder } from "gpui-kit";
import { Button, Input, InputState, Popover, Scrollbar, Tab, Tabs, VirtualListScrollHandle, h_flex, v_flex, v_virtual_list } from "gpui-base";
import { agents, appHome, exec, focused, machines, panes, props, spaces, terminals, theme, window as appWindow } from "herdr";
import { createCollector } from "./collect.js";
import { buildResources, MemoryHistory } from "./model.js";
import { buildResourceTree, processRows, resourceRows } from "./tree.js";

const ROW = 28;
const LIST = "resource-monitor-rows";
const icon = name => svg(`mods/workspace-chrome/${name}.svg`).size(13).flex_none();
const machineOf = terminal => terminal.machine ?? (terminal.address?.includes("/") ? terminal.address.slice(0, terminal.address.indexOf("/")) : null);
const bytes = value => {
  if (!Number.isFinite(value)) return "—";
  if (value < 1024 ** 2) return `${Math.round(value / 1024)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
};
const cpu = value => Number.isFinite(value) ? `${value.toFixed(1)}%` : "—";
const age = (at, now) => at ? `${Math.max(0, Math.floor((now - at) / 1000))}s ago` : "Not sampled";
const endpoint = port => `${port.family === "ipv6" ? `[${port.address}]` : port.address}:${port.port}`;
const clean = text => String(text ?? "").replace(/[\u0000-\u001f\u007f]/g, " ");

export default class ResourceMonitor extends View {
  init(_props, cx) {
    this.open = Boolean(props()?.open);
    this.hovered = false;
    this.tab = "resources";
    this.closed = false;
    this.generation = 0;
    this.collector = createCollector(exec, platform => `${appHome()}/mods/resource-monitor/bin/herdr-resource-sample${platform === "windows" ? ".exe" : ""}`);
    this.snapshots = new Map();
    this.inflight = new Map();
    this.connections = new Map();
    this.history = new MemoryHistory();
    this.expanded = new Set();
    this.seen = new Set();
    this.nodes = [];
    this.rows = [];
    this.sort = "memory";
    this.portsAt = new Map();
    this.wasActive = Boolean(appWindow()?.active);
    this.selected = null;
    this.revealSearch = false;
    this.now = Date.now();
    this.focusedInputs = new Set();
    this.signature = null;
    this.handle = cx.focus_handle();
    this.scroll = VirtualListScrollHandle.new();
    this.filters = {
      name: InputState.new({ placeholder: "Name" }),
      pid: InputState.new({ placeholder: "PID" }),
      port: InputState.new({ placeholder: "Port" })
    };
    for (const [name, input] of Object.entries(this.filters)) {
      input.on("change", (_e, cx) => {
        this.flatten(true);
        if (name === "port") this.portsAt.clear();
        cx.notify();
      });
      input.on("focus", () => { this.focusedInputs.add(name); });
      input.on("blur", () => { this.focusedInputs.delete(name); });
    }
    this.currentSpace = focused()?.space ?? spaces().find(s => s.active)?.id ?? null;
    this.refresh(cx);
    this.schedule(cx);
  }

  schedule(cx) {
    this.timer?.cancel();
    this.timer = cx.timer.every(1000, cx => {
      if (this.closed) return;
      if (!appWindow()?.active) {
        if (this.wasActive) { this.wasActive = false; this.collector.clear(); this.portsAt.clear(); }
        return;
      }
      this.wasActive = true;
      this.now = Date.now();
      this.refresh(cx);
    });
  }

  close() {
    this.closed = true;
    this.generation++;
    this.timer?.cancel();
    this.collector.clear();
    this.history.clear();
    this.snapshots.clear();
    this.handle?.release();
    this.scroll?.release();
    for (const input of Object.values(this.filters ?? {})) input.release();
  }

  rebuild() {
    const ts = terminals(), ss = spaces(), ps = panes(), as = agents();
    // Snapshot objects change only after collection; live terminal facts are already host-driven.
    const currentSpace = focused()?.space ?? ss.find(s => s.active)?.id ?? null;
    const signature = JSON.stringify([currentSpace, ts.map(t => [t.address, t.pid, t.foreground?.pid, t.parent, t.state, t.name, t.title, t.program?.agent, t.labels]),
      ss.map(s => [s.id, s.name, s.machine, s.tabs.map(t => [t.id, t.name])]), ps.map(p => [p.pane, p.terminal, p.tab, p.title, p.mod]), as.map(a => [a.address, a.space, a.tab, a.title])]);
    if (signature === this.signature && !this.dirty) return;
    this.signature = signature;
    const spaceChanged = currentSpace !== this.currentSpace;
    this.currentSpace = currentSpace;
    this.dirty = false;
    this.nodes = buildResources({ terminals: ts, spaces: ss, panes: ps, agents: as, snapshots: this.snapshots, now: this.now, maxSampleAge: 3000 });
    const present = new Set();
    const visit = node => {
      present.add(node.id);
      if (!this.seen.has(node.id)) {
        this.seen.add(node.id);
        if (node.space === this.currentSpace && node.kind !== "terminal") this.expanded.add(node.id);
      }
      if (spaceChanged && node.space === this.currentSpace && node.kind !== "terminal") this.expanded.add(node.id);
      for (const child of node.children ?? []) visit(child);
    };
    this.nodes.forEach(visit);
    for (const id of this.seen) if (!present.has(id)) { this.seen.delete(id); this.expanded.delete(id); }
    this.history.update(this.nodes, this.now);
    this.flatten();
  }

  refresh(cx) {
    if (this.closed) return;
    const before = this.footerSignature();
    const available = new Map(machines().map(m => [m.name ?? "", m.layout]));
    const targets = new Map();
    this.rebuild();
    for (const terminal of terminals()) {
      if (terminal.state !== "live") continue;
      const machine = machineOf(terminal), key = machine ?? "";
      targets.set(key, machine);
    }
    for (const key of this.connections.keys()) if (!targets.has(key)) {
      this.connections.delete(key);
      this.portsAt.delete(key);
      this.collector.forget(key || null);
    }
    for (const [key] of targets) {
      const identity = JSON.stringify([available.get(key), terminals()
        .filter(t => t.state === "live" && (machineOf(t) ?? "") === key)
        .map(t => [t.address, t.pid, t.created_ms, t.program_started_ms]).sort()]);
      if (this.connections.get(key) !== identity) {
        this.connections.set(key, identity);
        this.snapshots.delete(key);
        this.collector.forget(key || null);
        this.dirty = true;
      }
    }
    for (const key of this.snapshots.keys()) {
      if (!targets.has(key)) { this.snapshots.delete(key); this.collector.forget(key || null); this.dirty = true; }
    }
    for (const [key] of targets) {
      const old = this.snapshots.get(key);
      if (available.get(key) === "unavailable" && old?.processes.state !== "error") {
        this.collector.forget(key || null);
        this.snapshots.set(key, {
          ...(old ?? { machine: key || null, platform: null, at: 0, host: { state: "unavailable", at: 0, total: null, available: null }, footprints: { state: "unavailable", at: 0, rows: [] } }),
          processes: { ...(old?.processes ?? { rows: [], at: 0 }), state: "error", message: "Machine is unavailable" },
          listeners: { ...(old?.listeners ?? { rows: [], at: 0 }), state: "error", message: "Machine is unavailable" }
        });
        this.dirty = true;
      }
    }
    this.rebuild();
    if (before !== this.footerSignature()) cx.notify();
    if (!appWindow()?.active) return;
    const candidates = [...targets].filter(([key]) => available.get(key) !== "unavailable" && !this.inflight.has(key))
      .sort(([a], [b]) => (this.snapshots.get(a)?.at ?? 0) - (this.snapshots.get(b)?.at ?? 0));
    for (const [key, machine] of candidates.slice(0, Math.max(0, 2 - this.inflight.size))) {
      const generation = this.generation;
      const connection = this.connections.get(key);
      const token = {};
      const roots = terminals().filter(t => t.state === "live" && (machineOf(t) ?? "") === key).map(t => t.pid);
      const ports = this.open && this.tab === "terminals" && Date.now() - (this.portsAt.get(key) ?? 0) >= 5000;
      if (ports) this.portsAt.set(key, Date.now());
      this.inflight.set(key, token);
      cx.spawn(async cx => {
        let snapshot;
        try { snapshot = await this.collector.sample(machine, { platform: machine === null ? appWindow()?.platform : null, roots, ports, allPorts: this.portSearch }); }
        catch {
          const old = this.snapshots.get(key);
          snapshot = {
            ...(old ?? { machine, platform: null, host: { state: "unavailable", at: 0, total: null, available: null }, footprints: { state: "unavailable", at: 0, rows: [] } }),
            at: Date.now(),
            processes: { ...(old?.processes ?? { at: 0, rows: [] }), state: "error", message: "Resource collection failed" },
            listeners: { ...(old?.listeners ?? { at: 0, rows: [] }), state: "error", message: "Resource collection failed" }
          };
        }
        if (this.closed || generation !== this.generation || this.inflight.get(key) !== token) return;
        this.inflight.delete(key);
        if (!snapshot) return;
        if (this.connections.get(key) !== connection) return;
        // A disconnected/removed target cannot receive a late success from its old connection.
        if (machines().some(m => (m.name ?? "") === key && m.layout === "unavailable") ||
            !terminals().some(t => t.state === "live" && (machineOf(t) ?? "") === key)) return;
        const previous = this.snapshots.get(key);
        for (const name of ["processes", "listeners", "host", "footprints"]) {
          if (["error", "unavailable"].includes(snapshot[name]?.state) && previous?.[name]) {
            snapshot[name] = { ...previous[name], state: snapshot[name].state, message: snapshot[name].message };
          }
        }
        const before = this.footerSignature(), panelBefore = this.panelSnapshot ?? null;
        this.snapshots.set(key, snapshot);
        this.now = Date.now();
        this.dirty = true;
        this.rebuild();
        this.panelSnapshot = this.panelSignature();
        if (this.hovered || before !== this.footerSignature() || panelBefore !== this.panelSnapshot) cx.notify();
      });
    }
  }

  flatten(reveal = false) {
    const filters = Object.fromEntries(Object.entries(this.filters).map(([name, input]) => [name, input.value().trim()]));
    this.searching = Object.values(filters).some(Boolean);
    this.portSearch = this.tab === "terminals" && Boolean(filters.port);
    if (reveal) this.revealSearch = this.searching;
    this.tree = this.tab === "processes" ? [] : buildResourceTree(this.nodes, { filters, snapshots: this.snapshots });
    if (this.tab !== "processes" && (reveal || (this.searching && this.revealSearch))) {
      const visit = node => { this.expanded.add(node.id); node.children.forEach(visit); };
      this.tree.forEach(visit);
    }
    this.rows = this.tab === "processes" ? processRows(this.nodes, { filters, sort: this.sort })
      : resourceRows(this.tree, { expanded: this.expanded, sort: this.sort, currentSpace: this.currentSpace });
    if (!this.rows.some(row => row.id === this.selected)) this.selected = this.rows[0]?.id ?? null;
  }

  activate(id, cx) {
    const row = this.rows.find(row => row.id === id);
    if (!row) return;
    this.selected = id;
    if (row.type === "node") {
      this.revealSearch = false;
      if (this.expanded.has(id)) this.expanded.delete(id);
      else this.expanded.add(id);
      this.flatten();
    }
    this.handle.focus();
    cx.notify();
  }

  key(event, cx) {
    if (event.key === "escape") {
      this.open = false;
      cx.notify();
      cx.stop_propagation();
      return;
    }
    if (this.focusedInputs.size || event.modifiers.control || event.modifiers.platform || event.modifiers.alt) return;
    const index = this.rows.findIndex(row => row.id === this.selected);
    if (event.key === "down" || event.key === "up") {
      const next = Math.min(Math.max(0, index + (event.key === "down" ? 1 : -1)), this.rows.length - 1);
      this.selected = this.rows[next]?.id ?? null;
      if (next >= 0) this.scroll.scroll_to_item(next);
    } else if (event.key === "enter" || event.key === "space") this.activate(this.selected, cx);
    else if (event.key === "right" || event.key === "left") {
      const row = this.rows[index];
      if (row?.type === "node") {
        this.revealSearch = false;
        if (event.key === "right") this.expanded.add(row.id);
        else this.expanded.delete(row.id);
        this.flatten();
      }
    } else if (event.key === "/") this.filters.name.focus();
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  button(id, label, action) {
    const t = theme();
    return Button.new(id).h(24).px(6).flex_none().rounded(4)
      .text_color(t.muted).text_size(11).tab_index(0)
      .accessibility_label(label).hover(el => el.bg(t.hover)).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .when(Boolean(action), el => el.on_click(action)).child(label);
  }

  spark(node, t) {
    const samples = this.history.get(node);
    if (samples.length < 2) return div().w(48).flex_none().text_right().text_color(t.muted).tooltip("Not enough samples").child("—");
    const min = Math.min(...samples), span = Math.max(...samples) - min || 1;
    const path = PathBuilder.stroke(1.3);
    samples.forEach((value, i) => {
      const x = `${i * 100 / (samples.length - 1)}%`, y = `${95 - (value - min) * 90 / span}%`;
      if (i) path.line_to(x, y); else path.move_to(x, y);
    });
    return div().w(48).h(14).flex_none().child(globalThis.window.paint_path(path.build(), t.accent).size_full());
  }

  row(row, t) {
    const { node, type } = row;
    const base = h_flex().h(ROW).w_full().px(12).gap(8).items_center().text_size(11)
      .when(row.id === this.selected, el => el.bg(t.selected)).hover(el => el.bg(t.hover));
    const name = div().flex_1().min_w(0).pl(Math.min(row.depth, 6) * 10).truncate();
    const value = (text, width) => div().w(width).flex_none().text_right().child(text);
    if (type === "port") return base.text_color(t.muted)
      .child(name.tooltip(`${node.machine ?? "This computer"} · ${endpoint(row.port)} · TCP LISTEN`).child(endpoint(row.port)))
      .child(div().flex_none().child("TCP LISTEN"));
    if (type === "detail") {
      const ports = this.snapshots.get(node.machine ?? "")?.listeners;
      const detail = [node.directChildren === null ? "Child counts unknown" : `${node.directChildren} children · ${node.descendants} descendants`,
        this.tab === "terminals" ? (ports?.state === "ready" ? `${node.ports.length} listeners` : ports?.message) : null,
        node.message].filter(Boolean).join(" · ");
      return base.text_color(t.muted).child(name.tooltip(clean(detail)).child(clean(detail)));
    }
    if (type === "process") {
      const process = row.process;
      const flat = this.tab === "processes";
      const title = `${flat && node.machine ? `${clean(node.machine)} / ` : ""}${clean(process.name)}`;
      return base.text_color(t.muted)
        .child(name.tooltip(`${node.machine ?? "This computer"} · ${clean(process.name)} · PID ${process.pid} · PPID ${process.ppid} · ${process.start ?? "Start unknown"}${node.message ? ` · ${clean(node.message)}` : ""}`)
          .child(flat ? `${title}${node.stale ? " · stale" : ""}` : `${title} · ${process.pid}`))
        .when(flat, el => el.child(value(String(process.pid), 44)))
        .child(value(cpu(process.cpu), 52)).child(value(bytes(process.memory), 76)
          .tooltip(`${node.metric} · RSS ${bytes(process.resident)} · ${age(node.at, this.now)}`));
    }
    const fresh = !node.stale && ["ready", "partial"].includes(node.processState);
    const title = `${node.kind === "space" && node.machine ? `${clean(node.machine)} / ` : ""}${clean(node.name)}${node.stale ? " · stale" : ""}`;
    return base.cursor_pointer()
      .child(h_flex().flex_1().min_w(0).pl(Math.min(row.depth, 6) * 10).gap(4).items_center()
        .child(icon(this.expanded.has(node.id) ? "chevron-down" : "chevron-right").text_color(t.muted))
        .child(div().min_w(0).truncate().tooltip(`${title}${node.address ? ` · ${node.address}` : ""}${node.message ? ` · ${clean(node.message)}` : ""}`).child(title)))
      .child(value(cpu(fresh ? node.cpu : null), 52).text_color(t.muted))
      .child(value(bytes(fresh ? node.memory : null), 76).text_color(t.muted)
        .tooltip(`${node.metric}${node.unknown ? " · Known subtotal; coverage incomplete" : ""} · ${age(node.at, this.now)}`));
  }

  summary() {
    const active = spaces().find(s => s.id === this.currentSpace) ?? spaces().find(s => s.active);
    const machine = active?.machine ?? null;
    const root = this.nodes.find(n => n.machine === machine);
    const count = terminals().filter(t => t.state === "live" && machineOf(t) === machine).length;
    const fresh = root && !root.stale && this.now - root.at <= 3000 && ["ready", "partial"].includes(root.processState);
    return { root, machine, memory: count === 0 ? 0 : fresh ? root.memory : null,
      cpu: count === 0 ? 0 : fresh && this.wasActive ? root.cpu : null, count };
  }

  footerSignature() {
    const s = this.summary();
    return JSON.stringify([s.machine, cpu(s.cpu), bytes(s.memory), Boolean(s.root?.unknown), s.root?.message]);
  }

  panelSignature() {
    if (!this.open) return null;
    const s = this.summary();
    // Sample timestamps advance every second; compare what the panel actually shows.
    return JSON.stringify([
      s.machine, s.count, cpu(s.cpu), bytes(s.memory), s.root?.metric, s.root?.unknown, s.root?.message,
      age(s.root?.at, this.now),
      this.rows.map(row => {
        const n = row.node, p = row.process;
        return [row.id, row.type, row.depth, n.name, n.address, n.metric, n.stale, n.processState, n.unknown, n.message,
          cpu(n.cpu), bytes(n.memory), age(n.at, this.now), n.directChildren, n.descendants,
          p && [p.pid, p.ppid, p.start, p.name, cpu(p.cpu), bytes(p.memory), bytes(p.resident)],
          row.port && endpoint(row.port)];
      }),
      this.tab === "terminals" && [
        s.root && this.history.get(s.root),
        [...this.snapshots.values()].map(s => [s.listeners?.state, s.listeners?.scope, s.listeners?.message])
      ]
    ]);
  }

  panel(cx) {
    const t = theme(), summary = this.summary();
    const tab = (id, label) => Tab.new(`resource-tab-${id}`).selected(this.tab === id)
      .h(28).px(8).text_size(11).border_b(2).border_color(this.tab === id ? t.accent : t.popover)
      .text_color(this.tab === id ? t.foreground : t.muted).hover(el => el.text_color(t.foreground))
      .on_click((_e, cx) => {
        this.tab = id; this.portsAt.clear();
        if (id !== "processes" && this.sort === "pid") this.sort = "memory";
        for (const input of Object.values(this.filters)) input.set_value("");
        this.flatten();
        if (id !== "processes") this.refresh(cx);
        cx.notify();
      }).child(h_flex().gap(6).items_center()
        .child(svg(`mods/resource-monitor/${id === "terminals" ? "terminal" : "activity"}.svg`).size(12))
        .child(label).when(id === "terminals", el => el.child(div().px(4).rounded(4).bg(t.selected).text_size(10).child(String(summary.count)))));
    const list = v_flex().flex_1().min_h(0).relative()
      .child(v_virtual_list(LIST, this.rows.length, ROW, index => this.rows[index].id,
        range => this.rows.slice(range.start, range.end).map(row => this.row(row, t)))
        .size_full().track_scroll(this.scroll).on_item_click((id, cx) => this.activate(id, cx)))
      .child(Scrollbar.vertical(LIST).viewport_from_layout().absolute().inset_0());
    return v_flex().id("resource-manager").w(416).max_w("95%").h(640).max_h("85%")
      .track_focus(this.handle).bg(t.popover).text_color(t.foreground).text_size(11).rounded(8)
      .border_1().border_color(t.border).overflow_hidden().role("group").accessibility_label("Resource Manager")
      .on_key_down((e, cx) => this.key(e, cx))
      .child(h_flex().px(12).h(32).flex_none().gap(6).items_center().border_b(1).border_color(t.border)
        .child(svg("mods/resource-monitor/memory.svg").size(12).text_color(t.muted))
        .child(div().flex_1().font_medium().child("Resource Manager"))
        .child(this.button("resource-refresh", "Refresh", (_e, cx) => { this.portsAt.clear(); this.refresh(cx); }))
        .child(this.button("resource-close", "Close", (_e, cx) => { this.open = false; cx.notify(); })))
      .child(Tabs.new("resource-tabs").flex().flex_row().px(12).py(4).gap(4).flex_none()
        .child(tab("resources", "Resources")).child(tab("terminals", "PTYs")).child(tab("processes", "Processes")))
      .child(v_flex().px(12).py(8).gap(4).border_b(1).border_color(t.border).flex_none()
        .child(h_flex().gap(12).items_center().child(cpu(summary.cpu)).child(`${bytes(summary.memory)} ${summary.root?.metric ?? "memory"}`)
          .when(this.tab === "terminals" && Boolean(summary.root), el => el.child(this.spark(summary.root, t))))
        .child(div().text_color(t.muted).tooltip("Combined process load; 100% equals one CPU core. Sampling pauses when the app is inactive.")
          .child(`${summary.machine ?? "This computer"} · ${summary.root?.unknown ? "Known subtotal · " : ""}${age(summary.root?.at, this.now)}`)))
      .when(this.tab !== "resources", el => el.child(h_flex().px(12).py(6).gap(4).flex_none()
        .children(Object.entries(this.filters).filter(([name]) => this.tab === "terminals" || name !== "port")
          .map(([name, input]) => div().when(name === "name", el => el.flex_1().min_w(0))
          .when(name !== "name", el => el.w(64).flex_none())
          .child(Input.new(input).w_full().h(26).px(6).rounded(4).border_1().border_color(t.input).bg(t.background)
            .accessibility_label(name === "name" ? (this.tab === "processes" ? "Filter process names or machines" : "Filter names or addresses")
              : name === "pid" ? "Filter exact process ID" : "Filter exact TCP listening port"))))))
      .child(h_flex().px(12).h(26).gap(8).items_center().bg(t.chrome).border_b(1).border_color(t.border).flex_none()
        .children([["name", "Name", null], ...(this.tab === "processes" ? [["pid", "PID", 44]] : []),
          ["cpu", "CPU", 52], ["memory", "Memory", 76]].map(([id, label, width]) =>
          Button.new(`resource-sort-${id}`).h(24).text_size(10).text_color(this.sort === id ? t.foreground : t.muted)
            .px(0).when(width !== null, el => el.w(width).flex_none().justify_end().text_right())
            .when(width === null, el => el.flex_1().min_w(0).justify_start().text_left())
            .tab_index(0).accessibility_label(`Sort by ${label}`).on_click((_e, cx) => { this.sort = id; this.flatten(); cx.notify(); }).child(label))))
      .when(this.rows.length > 0, el => el.child(list))
      .when(!this.rows.length, el => el.child(div().flex_1().p(24).text_color(t.muted)
        .child(this.searching ? "No matching resources" : this.tab === "processes" ? "No sampled processes" : "No running terminals")))
      .child(v_flex().px(12).py(8).border_t(1).border_color(t.border).gap(3).text_color(t.muted).flex_none()
        .when(Boolean(summary.root?.message), el => el.child(clean(summary.root.message)))
        .when(this.tab === "terminals" && [...this.snapshots.values()].some(s => s.listeners?.state !== "ready" ||
          (this.portSearch && s.listeners.scope !== "all")), el => el.child("Listener coverage incomplete"))
        .child(this.tab === "terminals" ? "Read-only · Listening ports are not verified web services"
          : this.tab === "processes" ? "Read-only · Managed terminals and their child processes" : "Read-only · Expand a row for process details"));
  }

  render(cx) {
    this.now = Date.now();
    this.rebuild();
    const t = theme(), summary = this.summary();
    const memory = bytes(summary.memory), load = cpu(summary.cpu);
    const label = `CPU ${load} · memory ${memory}`;
    const trigger = Button.new("resource-status-trigger").h(22).px(4).rounded(4).text_size(11).text_color(t.muted)
      .tab_index(0).accessibility_label(`Resources: ${label}`)
      .tooltip(`${summary.machine ?? "This computer"} · ${summary.root?.metric ?? "memory"} ${bytes(summary.memory)} · CPU ${cpu(summary.cpu)}${summary.root?.unknown ? " · Coverage incomplete" : ""}`)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .hover(el => el.bg(t.hover).text_color(t.foreground))
      .child(h_flex().gap(6).items_center()
        .child(svg("mods/resource-monitor/activity.svg").size(12)).child(load)
        .child(div().text_color(t.dim).child("·"))
        .child(svg("mods/resource-monitor/memory.svg").size(12))
        .child(memory));
    return h_flex().size_full().px(6).items_center().bg(t.chrome).border_t(1).border_color(t.border)
      .child(Popover.new("resource-status-popover").open(this.open).anchor("bottom_right").track_focus(this.handle).overlay_closable(true)
        .on_open_change((open, cx) => {
          this.open = open;
          if (open) { this.portsAt.clear(); this.refresh(cx); }
          cx.notify();
        }).trigger(trigger).when(this.open, el => el.content(this.panel(cx))));
  }
}

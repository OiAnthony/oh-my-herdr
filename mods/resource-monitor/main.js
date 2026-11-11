import { View, div, svg, PathBuilder } from "gpui-kit";
import { Button, Popover, Radio, RadioGroup, Scrollbar, Tab, Tabs, Toggle, VirtualListScrollHandle, h_flex, v_flex, v_virtual_list } from "gpui-base";
import { agents, appHome, exec, focused, machines, panes, props, spaces, terminals, theme, window as appWindow } from "herdr";
import { createCollector } from "./collect.js";
import { buildResources, buildSystemResources, MemoryHistory } from "./model.js";
import { buildResourceTree, processRows, portRows, resourceRows } from "./tree.js";
import { bytes, cpu, footerCpu, footerCpuColor, endpoint, clean } from "./format.js";

const ROW = 28;
const LIST = "resource-monitor-rows";
const icon = name => svg(`mods/workspace-chrome/${name}.svg`).size(13).flex_none();
const machineOf = terminal => terminal.machine ?? (terminal.address?.includes("/") ? terminal.address.slice(0, terminal.address.indexOf("/")) : null);
const age = (at, now) => at ? `${Math.max(0, Math.floor((now - at) / 1000))}s ago` : "Not sampled";

export default class ResourceMonitor extends View {
  init(_props, cx) {
    this.open = Boolean(props()?.open);
    this.hovered = false;
    this.tab = "tree";
    this.scope = "herdr";
    this.showPorts = false;
    this.closed = false;
    this.generation = 0;
    this.collector = createCollector(exec, platform => `${appHome()}/mods/resource-monitor/bin/herdr-resource-sample${platform === "windows" ? ".exe" : ""}`);
    this.snapshots = new Map();
    this.systemSnapshots = new Map();
    this.systemNodes = [];
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
    this.query = "";
    this.escapeDown = false;
    this.signature = null;
    this.handle = cx.focus_handle();
    // Popover handles these as actions before raw key events reach this view.
    cx.bind_keys([
      { keystroke: "escape", action: "resource_monitor_escape", context: "ResourceManager" },
      { keystroke: "space", action: "resource_monitor_space", context: "ResourceManager" },
      { keystroke: "enter", action: "resource_monitor_enter", context: "ResourceManager" }
    ]);
    this.scroll = VirtualListScrollHandle.new();
    this.currentSpace = focused()?.space ?? spaces().find(s => s.active)?.id ?? null;
    this.refresh(cx);
    this.schedule(cx);
  }

  schedule(cx) {
    this.timer?.cancel();
    this.timer = cx.timer.every(1000, cx => {
      if (this.closed) return;
      if (!appWindow()?.active) {
        if (this.wasActive) { this.wasActive = false; this.generation++; this.collector.clear(); this.portsAt.clear(); }
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
    this.systemSnapshots.clear();
    this.handle?.release();
    this.scroll?.release();
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
    this.systemNodes = buildSystemResources({ snapshots: this.systemSnapshots, now: this.now, maxSampleAge: 3000 });
    const present = new Set();
    const visit = node => {
      present.add(node.id);
      if (!this.seen.has(node.id)) {
        this.seen.add(node.id);
        if ((node.space === this.currentSpace && node.kind !== "terminal") || node.kind === "machine") this.expanded.add(node.id);
      }
      if (spaceChanged && node.space === this.currentSpace && node.kind !== "terminal") this.expanded.add(node.id);
      for (const child of node.children ?? []) visit(child);
    };
    [...this.nodes, ...this.systemNodes].forEach(visit);
    for (const id of this.seen) if (!present.has(id)) { this.seen.delete(id); this.expanded.delete(id); }
    this.history.update([...this.nodes, ...this.systemNodes], this.now);
    this.flatten();
  }

  setScope(scope, cx) {
    if (this.scope === scope) return;
    this.scope = scope;
    this.generation++;
    this.collector.clear();
    this.portsAt.clear();
    this.systemSnapshots.clear();
    for (const [key, snapshot] of this.snapshots) this.snapshots.set(key, {
      ...snapshot, listeners: { state: "unavailable", at: 0, rows: [], message: "Waiting for listening ports in this scope" }
    });
    this.dirty = true;
    this.revealSearch = Boolean(this.query.trim());
    this.refresh(cx);
    this.scroll.scroll_to_item(0);
    this.handle.focus();
    cx.notify();
  }

  setOpen(open, cx) {
    this.open = open;
    if (open) this.escapeDown = false;
    if (this.scope !== "herdr") this.setScope("herdr", cx);
    else if (open) { this.portsAt.clear(); this.refresh(cx); }
    cx.notify();
  }

  viewNodes() { return this.scope === "system" ? this.systemNodes : this.nodes; }
  viewSnapshots() { return this.scope === "system" ? this.systemSnapshots : this.snapshots; }

  refresh(cx) {
    if (this.closed) return;
    const before = this.footerSignature();
    const requestScope = this.open ? this.scope : "herdr";
    const available = new Map(machines().map(m => [m.name ?? "", m.layout]));
    const targets = new Map();
    this.rebuild();
    for (const terminal of terminals()) {
      if (terminal.state !== "live") continue;
      const machine = machineOf(terminal), key = machine ?? "";
      targets.set(key, machine);
    }
    if (this.open && this.scope === "system") {
      targets.set("", null);
      for (const space of spaces()) targets.set(space.machine ?? "", space.machine ?? null);
    }
    for (const key of this.connections.keys()) if (!targets.has(key)) {
      this.connections.delete(key);
      this.portsAt.delete(key);
      this.collector.forget(key || null);
      this.systemSnapshots.delete(key);
    }
    for (const [key] of targets) {
      const identity = JSON.stringify([available.get(key), terminals()
        .filter(t => t.state === "live" && (machineOf(t) ?? "") === key)
        .map(t => [t.address, t.pid, t.created_ms, t.program_started_ms]).sort()]);
      if (this.connections.get(key) !== identity) {
        this.connections.set(key, identity);
        this.snapshots.delete(key);
        this.collector.forget(key || null);
        this.systemSnapshots.delete(key);
        this.dirty = true;
      }
    }
    for (const key of this.snapshots.keys()) {
      if (!targets.has(key)) { this.snapshots.delete(key); this.systemSnapshots.delete(key); this.collector.forget(key || null); this.dirty = true; }
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
        if (requestScope === "system") this.systemSnapshots.set(key, this.snapshots.get(key));
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
      const ports = this.open && (this.tab === "ports" || (this.tab === "tree" && this.showPorts)) && Date.now() - (this.portsAt.get(key) ?? 0) >= 5000;
      if (ports) this.portsAt.set(key, Date.now());
      this.inflight.set(key, token);
      cx.spawn(async cx => {
        let snapshot;
        try { snapshot = await this.collector.sample(machine, { platform: machine === null ? appWindow()?.platform : null, roots, scope: requestScope, ports }); }
        catch {
          const old = requestScope === "system" ? this.systemSnapshots.get(key) : this.snapshots.get(key);
          snapshot = {
            ...(old ?? { machine, platform: null, host: { state: "unavailable", at: 0, total: null, available: null }, footprints: { state: "unavailable", at: 0, rows: [] } }),
            scope: requestScope, at: Date.now(),
            processes: { ...(old?.processes ?? { at: 0, rows: [] }), state: "error", message: "Resource collection failed" },
            listeners: { ...(old?.listeners ?? { at: 0, rows: [] }), state: "error", message: "Resource collection failed" }
          };
        }
        if (this.inflight.get(key) === token) this.inflight.delete(key);
        if (this.closed || generation !== this.generation || (this.open ? this.scope : "herdr") !== requestScope || !snapshot) return;
        if (this.connections.get(key) !== connection) return;
        // A disconnected/removed target cannot receive a late success from its old connection.
        if (machines().some(m => (m.name ?? "") === key && m.layout === "unavailable") ||
            (!terminals().some(t => t.state === "live" && (machineOf(t) ?? "") === key) &&
             !(this.open && this.scope === "system" && (!key || spaces().some(s => s.machine === key))))) return;
        const previous = requestScope === "system" ? this.systemSnapshots.get(key) : this.snapshots.get(key);
        for (const name of ["processes", "listeners", "host", "footprints"]) {
          if (["error", "unavailable"].includes(snapshot[name]?.state) && previous?.[name]) {
            snapshot[name] = { ...previous[name], state: snapshot[name].state, message: snapshot[name].message };
          }
        }
        const before = this.footerSignature(), panelBefore = this.panelSnapshot ?? null;
        this.snapshots.set(key, snapshot);
        if (requestScope === "system") this.systemSnapshots.set(key, snapshot);
        this.now = Date.now();
        this.dirty = true;
        this.rebuild();
        this.panelSnapshot = this.panelSignature();
        if (this.hovered || before !== this.footerSignature() || panelBefore !== this.panelSnapshot) cx.notify();
      });
    }
  }

  flatten(reveal = false) {
    this.searching = this.query.length > 0;
    const nodes = this.viewNodes(), snapshots = this.viewSnapshots();
    if (reveal) this.revealSearch = this.searching;
    this.tree = this.tab !== "tree" ? [] : buildResourceTree(nodes, { query: this.query, showPorts: this.showPorts });
    if (this.tab === "tree" && (reveal || (this.searching && this.revealSearch))) {
      const visit = node => { this.expanded.add(node.id); node.children.forEach(visit); };
      this.tree.forEach(visit);
    }
    this.rows = this.tab === "ports" ? portRows(snapshots, { query: this.query, sort: this.sort, now: this.now, managed: this.scope === "herdr" ? this.nodes : null })
      : this.tab === "processes" ? processRows(nodes, { query: this.query, sort: this.sort })
      : resourceRows(this.tree, { expanded: this.expanded, sort: this.sort, currentSpace: this.currentSpace })
        .filter(row => this.showPorts || row.type !== "port");
    if (!this.rows.some(row => row.id === this.selected)) this.selected = this.rows[0]?.id ?? null;
  }

  expandAll(expand, cx) {
    this.revealSearch = false;
    const visit = node => {
      if (expand) this.expanded.add(node.id);
      else this.expanded.delete(node.id);
      node.children.forEach(visit);
    };
    this.tree.forEach(visit);
    this.flatten();
    this.handle.focus();
    cx.notify();
  }

  locatePane(cx) {
    const focus = focused();
    if (!focus?.pane && !focus?.terminal) return;
    if (this.scope !== "herdr") this.setScope("herdr", cx);
    this.tab = "tree";
    if (this.sort === "port" || this.sort === "pid") this.sort = "memory";
    this.query = "";
    this.revealSearch = false;
    this.flatten();
    let target = null;
    const find = (node, path) => {
      const next = [...path, node];
      if ((focus.pane && node.pane === focus.pane && node.space === focus.space) ||
          (!focus.pane && node.address === focus.terminal)) target = next;
      node.children.forEach(child => find(child, next));
    };
    this.tree.forEach(node => find(node, []));
    if (target) {
      target.slice(0, -1).forEach(node => this.expanded.add(node.id));
      this.flatten();
      this.selected = target.at(-1).id;
      this.scroll.scroll_to_item(this.rows.findIndex(row => row.id === this.selected), "center");
    }
    this.handle.focus();
    cx.notify();
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

  escape(cx) {
    if (!this.escapeDown) {
      this.escapeDown = true;
      if (this.searching) { this.query = ""; this.flatten(); }
      else this.setOpen(false, cx);
      cx.notify();
    }
    cx.stop_propagation();
  }

  key(event, cx) {
    if (event.key === "escape") return this.escape(cx);
    if (event.modifiers.control || event.modifiers.platform || event.modifiers.alt) return;
    const character = event.key === "space" ? " " : event.key_char;
    if (event.key === "backspace" || (character && !/[\u0000-\u001f\u007f]/.test(character))) {
      this.query = event.key === "backspace" ? [...this.query].slice(0, -1).join("") : this.query + character;
      this.flatten(true);
      if (this.rows.length) this.scroll.scroll_to_item(0);
      cx.stop_propagation();
      cx.notify();
      return;
    }
    const index = this.rows.findIndex(row => row.id === this.selected);
    if (event.key === "down" || event.key === "up") {
      const next = Math.min(Math.max(0, index + (event.key === "down" ? 1 : -1)), this.rows.length - 1);
      this.selected = this.rows[next]?.id ?? null;
      if (next >= 0) this.scroll.scroll_to_item(next);
    } else if (event.key === "enter") this.activate(this.selected, cx);
    else if (event.key === "right" || event.key === "left") {
      const row = this.rows[index];
      if (row?.type === "node") {
        this.revealSearch = false;
        if (event.key === "right") this.expanded.add(row.id);
        else this.expanded.delete(row.id);
        this.flatten();
      }
    } else return;
    cx.stop_propagation();
    cx.notify();
  }


  iconButton(id, label, asset, action) {
    const t = theme();
    return Button.new(id).size(24).px(0).flex_none().rounded(4).text_color(t.muted)
      .tab_index(0).accessibility_label(label).tooltip(label).hover(el => el.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action)
      .child(svg(`mods/resource-monitor/${asset}.svg`).size(13));
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
    if (type === "listener") return base.text_color(t.muted)
      .child(name.tooltip(`${node.machine ?? "This computer"} · ${endpoint(row.port)} · TCP LISTEN · ${age(node.at, this.now)}${node.message ? ` · ${clean(node.message)}` : ""}`)
        .child(`${endpoint(row.port)}${node.stale ? " · stale" : ""}`))
      .child(div().w(104).flex_none().truncate().tooltip(`${node.machine ?? "This computer"} · ${clean(row.process.name)}`).child(clean(row.process.name)))
      .child(value(String(row.process.pid), 44));
    if (type === "port") return base.text_color(t.muted)
      .child(name.tooltip(`${node.machine ?? "This computer"} · ${endpoint(row.port)} · TCP LISTEN`).child(endpoint(row.port)))
      .child(div().flex_none().child("TCP LISTEN"));
    if (type === "detail") {
      const ports = this.viewSnapshots().get(node.machine ?? "")?.listeners;
      const detail = [node.directChildren === null ? "Child counts unknown" : `${node.directChildren} children · ${node.descendants} descendants`,
        this.showPorts ? (ports?.state === "ready" ? `${node.ports.length} listeners` : ports?.message) : null,
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
    const title = `${node.kind === "space" && node.machine ? `${clean(node.machine)} / ` : ""}${clean(node.name)}${node.kind === "system-process" ? ` · ${node.process.pid}` : ""}${node.stale ? " · stale" : ""}`;
    return base.cursor_pointer()
      .child(h_flex().flex_1().min_w(0).pl(Math.min(row.depth, 6) * 10).gap(4).items_center()
        .child(icon(this.expanded.has(node.id) ? "chevron-down" : "chevron-right").text_color(t.muted))
        .child(div().min_w(0).truncate().tooltip(`${title}${node.process ? ` · PPID ${node.process.ppid} · ${node.process.start ?? "Start unknown"}` : ""}${node.address ? ` · ${node.address}` : ""}${node.message ? ` · ${clean(node.message)}` : ""}`).child(title)))
      .child(value(cpu(fresh ? node.cpu : null), 52).text_color(t.muted))
      .child(value(bytes(fresh ? node.memory : null), 76).text_color(t.muted)
        .tooltip(`${node.metric}${node.unknown ? " · Known subtotal; coverage incomplete" : ""} · ${age(node.at, this.now)}`));
  }

  summary(scope = "herdr") {
    const active = spaces().find(s => s.id === this.currentSpace) ?? spaces().find(s => s.active);
    const machine = active?.machine ?? null;
    const root = (scope === "system" ? this.systemNodes : this.nodes).find(n => n.machine === machine);
    const count = scope === "system" ? root?.processes.length ?? 0
      : terminals().filter(t => t.state === "live" && machineOf(t) === machine).length;
    const fresh = root && !root.stale && this.now - root.at <= 3000 && ["ready", "partial"].includes(root.processState);
    const emptyManaged = scope === "herdr" && count === 0;
    return { root, machine, memory: emptyManaged ? 0 : fresh ? root.memory : null,
      cpu: emptyManaged ? 0 : fresh && this.wasActive ? root.cpu : null, count };
  }

  footerSignature() {
    const s = this.summary();
    return JSON.stringify([s.machine, footerCpu(s.cpu), bytes(s.memory), Boolean(s.root?.unknown), s.root?.message]);
  }

  panelSignature() {
    if (!this.open) return null;
    const s = this.summary(this.scope);
    // Sample timestamps advance every second; compare what the panel actually shows.
    return JSON.stringify([
      this.scope, this.tab,
      s.machine, s.count, cpu(s.cpu), bytes(s.memory), s.root?.metric, s.root?.unknown, s.root?.message,
      age(s.root?.at, this.now),
      this.rows.map(row => {
        const n = row.node, p = row.process;
        return [row.id, row.type, row.depth, n.name, n.address, n.metric, n.stale, n.processState, n.unknown, n.message,
          cpu(n.cpu), bytes(n.memory), age(n.at, this.now), n.directChildren, n.descendants,
          p && [p.pid, p.ppid, p.start, p.name, cpu(p.cpu), bytes(p.memory), bytes(p.resident)],
          row.port && endpoint(row.port)];
      }),
      (this.tab === "ports" || (this.tab === "tree" && this.showPorts)) &&
        [...this.viewSnapshots().values()].map(s => [s.listeners?.state, s.listeners?.scope, s.listeners?.message]),
      this.tab === "tree" && s.root && this.history.get(s.root)
    ]);
  }

  panel(cx) {
    const t = theme(), summary = this.summary(this.scope), snapshots = this.viewSnapshots();
    const pendingPorts = !snapshots.size || [...snapshots.values()].some(s => !s.listeners?.at && !["error", "unavailable"].includes(s.processes?.state));
    const viewport = globalThis.window.viewport_size();
    const tab = (id, label) => Tab.new(`resource-tab-${id}`).selected(this.tab === id)
      .accessibility_label(label)
      .h(28).px(8).text_size(11).border_b(2).border_color(this.tab === id ? t.accent : t.popover)
      .text_color(this.tab === id ? t.foreground : t.muted).hover(el => el.text_color(t.foreground))
      .on_click((_e, cx) => {
        this.tab = id; this.portsAt.clear();
        if (id === "ports") this.sort = "port";
        else if (this.sort === "port" || (id === "tree" && this.sort === "pid")) this.sort = "memory";
        this.query = "";
        this.flatten();
        this.handle.focus();
        if (id !== "processes") this.refresh(cx);
        cx.notify();
      }).child(h_flex().gap(6).items_center()
        .child(svg(`mods/resource-monitor/${id === "tree" ? "terminal" : id === "ports" ? "ports" : "activity"}.svg`).size(12))
        .child(label).when(id === "tree", el => el.child(div().px(4).rounded(4).bg(t.selected).text_size(10).child(String(summary.count)))));
    const list = v_flex().flex_1().min_h(0).relative()
      .child(v_virtual_list(LIST, this.rows.length, ROW, index => this.rows[index].id,
        range => this.rows.slice(range.start, range.end).map(row => this.row(row, t)))
        .size_full().track_scroll(this.scroll).on_item_click((id, cx) => this.activate(id, cx)))
      .child(Scrollbar.vertical(LIST).viewport_from_layout().absolute().inset_0());
    return v_flex().id("resource-manager")
      .w(Math.min(416, viewport.width * 0.95)).h(Math.min(640, viewport.height * 0.85))
      .track_focus(this.handle).bg(t.popover).text_color(t.foreground).text_size(11).rounded(8)
      .border_1().border_color(t.border).overflow_hidden().role("group").accessibility_label("Resource Manager")
      .key_context("ResourceManager")
      .on_action("resource_monitor_escape", (_e, cx) => this.escape(cx))
      .on_action("resource_monitor_space", (_e, cx) => this.key({ key: "space", modifiers: {} }, cx))
      .on_action("resource_monitor_enter", (_e, cx) => this.key({ key: "enter", modifiers: {} }, cx))
      .on_key_down((e, cx) => this.key(e, cx))
      .on_key_up(e => { if (e.key === "escape") this.escapeDown = false; })
      .child(h_flex().px(12).h(32).flex_none().gap(6).items_center().border_b(1).border_color(t.border)
        .child(svg("mods/resource-monitor/memory.svg").size(12).text_color(t.muted))
        .child(div().flex_1().font_medium().child("Resource Manager"))
        .when(this.tab === "tree", el => el
          .child(this.iconButton("resource-expand-all", "Expand all", "expand-all", (_e, cx) => this.expandAll(true, cx)))
          .child(this.iconButton("resource-collapse-all", "Collapse all", "collapse-all", (_e, cx) => this.expandAll(false, cx))))
        .child(this.iconButton("resource-locate-pane", "Locate current pane", "locate", (_e, cx) => this.locatePane(cx)))
        .child(this.iconButton("resource-refresh", "Refresh", "refresh", (_e, cx) => { this.portsAt.clear(); this.refresh(cx); }))
        .child(this.iconButton("resource-close", "Close", "close", (_e, cx) => this.setOpen(false, cx))))
      .child(h_flex().px(12).py(6).gap(8).flex_none().items_center()
        .child(div().text_color(t.muted).child("Scope"))
        .child(RadioGroup.new("resource-scope").axis("horizontal").accessibility_label("Resource scope")
          .flex().flex_row().gap(2).p(2).rounded(5).border_1().border_color(t.border)
          .children([["herdr", "Herdr"], ["system", "System"]].map(([scope, label]) => div()
            .tooltip(scope === "herdr" ? "Herdr-managed terminals and their OS descendants; excludes the Desktop and Core apps themselves"
              : "All enumerable processes on each machine; CPU and memory depend on current-user permissions")
            .child(Radio.new(`resource-scope-${scope}`)
              .checked(this.scope === scope).h(24).px(10).flex().items_center().justify_center().rounded(3).text_size(11).tab_index(0)
              .text_color(this.scope === scope ? t.foreground : t.muted).bg(this.scope === scope ? t.selected : t.popover)
              .hover(el => el.bg(t.hover)).accessibility_label(`${label} scope`)
              .on_change((checked, cx) => { if (checked) this.setScope(scope, cx); }).child(label))))))
      .child(h_flex().px(12).py(4).gap(4).flex_none()
        .child(Tabs.new("resource-tabs").flex().flex_row().gap(4)
          .child(tab("tree", "Tree")).child(tab("processes", "Processes")).child(tab("ports", "Ports")))
        .child(div().flex_1())
        .when(this.tab === "tree", el => el.child(Toggle.new("resource-show-ports").pressed(this.showPorts)
          .h(24).px(6).rounded(4).text_size(11).text_color(this.showPorts ? t.accent : t.muted)
          .bg(this.showPorts ? t.selected : t.popover).hover(el => el.bg(t.hover))
          .tab_index(0).accessibility_label("Show listening ports")
          .on_change((value, cx) => {
            this.showPorts = value;
            this.portsAt.clear();
            this.flatten();
            if (value) this.refresh(cx);
            cx.notify();
          }).child(this.showPorts ? "Ports on" : "Ports off"))))
      .child(v_flex().px(12).py(8).gap(4).border_b(1).border_color(t.border).flex_none()
        .child(h_flex().gap(12).items_center().child(cpu(summary.cpu)).child(`${bytes(summary.memory)} ${summary.root?.metric ?? "memory"}`)
          .when(this.tab === "tree" && Boolean(summary.root), el => el.child(this.spark(summary.root, t))))
        .child(div().text_color(t.muted).tooltip("Process totals, not host used memory; shared pages may be counted more than once. CPU 100% equals one core. Sampling pauses when the app is inactive.")
          .child(`${summary.machine ?? "This computer"} · ${this.scope === "system" ? "Readable processes" : "Managed processes"}${summary.root?.unknown ? " · Partial data" : ""} · ${age(summary.root?.at, this.now)}`))
        .when(Boolean(summary.root?.message), el => el.child(div().text_color(t.muted).child(clean(summary.root.message))))
        .when(this.tab === "ports" || (this.tab === "tree" && this.showPorts), el => el
          .child(div().text_color(t.muted).tooltip("TCP listening sockets only; not verified web services. Coverage depends on current-user permissions.")
            .child(pendingPorts ? "Loading listening ports…"
              : [...snapshots.values()].some(s => s.listeners?.state !== "ready")
                ? "Listener coverage incomplete" : "TCP LISTEN"))))
      .when(this.searching, el => el.child(h_flex().px(12).py(6).gap(8).flex_none().items_center()
        .accessibility_label(`Filter: ${this.query}`)
        .child(div().flex_1().min_w(0).truncate().tooltip(this.query).child(`Filter: ${this.query}`))
        .child(div().text_color(t.muted).child("Esc to clear"))))
      .child(h_flex().px(12).h(26).gap(8).items_center().bg(t.chrome).border_b(1).border_color(t.border).flex_none()
        .children((this.tab === "ports" ? [["port", "Endpoint", null], ["name", "Process", 104], ["pid", "PID", 44]]
          : [["name", "Name", null], ...(this.tab === "processes" ? [["pid", "PID", 44]] : []),
            ["cpu", "CPU", 52], ["memory", "Memory", 76]]).map(([id, label, width]) =>
          Button.new(`resource-sort-${id}`).h(24).text_size(10).text_color(this.sort === id ? t.foreground : t.muted)
            .px(0).when(width !== null, el => el.w(width).flex_none().justify_end().text_right())
            .when(width === null, el => el.flex_1().min_w(0).justify_start().text_left())
            .when(this.tab === "ports" && id === "name", el => el.justify_start().text_left())
            .tab_index(0).accessibility_label(`Sort by ${label}`).on_click((_e, cx) => { this.sort = id; this.flatten(); cx.notify(); }).child(label))))
      .when(this.rows.length > 0, el => el.child(list))
      .when(!this.rows.length, el => el.child(div().flex_1().p(24).text_color(t.muted)
        .child(this.tab === "ports" && pendingPorts && (this.scope === "system" || summary.count > 0) ? "Loading listening ports…"
          : this.searching ? "No matching resources" : this.tab === "ports" ? "No listening ports in collected results"
            : this.scope === "system" && !snapshots.size ? "Loading system processes…"
              : this.tab === "processes" || this.scope === "system" ? "No sampled processes" : "No running terminals")));
  }

  render(cx) {
    this.now = Date.now();
    this.rebuild();
    const t = theme(), summary = this.summary();
    const memory = bytes(summary.memory), load = footerCpu(summary.cpu), loadColor = footerCpuColor(summary.cpu, t);
    const label = `CPU ${load} · memory ${memory}`;
    const font = appWindow()?.platform === "macos" ? "Menlo" : appWindow()?.platform === "windows" ? "Consolas" : "monospace";
    const trigger = Button.new("resource-status-trigger").w(152).h(22).px(4).flex_none().justify_start().rounded(4).text_size(11).text_color(t.muted)
      .tab_index(0).accessibility_label(`Resources: ${label}`)
      .tooltip(`${summary.machine ?? "This computer"} · ${summary.root?.metric ?? "memory"} ${memory} · CPU ${load}${summary.root?.unknown ? " · Coverage incomplete" : ""}`)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .hover(el => el.bg(t.hover).text_color(t.foreground))
      .child(h_flex().gap(0).items_center().flex_none()
        .child(h_flex().gap(3).items_center().flex_none()
          .child(svg("mods/resource-monitor/activity.svg").size(12).flex_none().text_color(loadColor))
          .child(div().flex_none().font_family(font).text_left().text_color(loadColor).child(load)))
        .child(div().flex_none().font_family(font).text_color(t.dim).child(" · "))
        .child(h_flex().gap(3).items_center().flex_none()
          .child(svg("mods/resource-monitor/memory.svg").size(12).flex_none())
          .child(div().flex_none().font_family(font).text_left().child(memory))));
    return h_flex().size_full().px(6).items_center().bg(t.chrome).border_t(1).border_color(t.border)
      .child(Popover.new("resource-status-popover").open(this.open).anchor("bottom_right").track_focus(this.handle).overlay_closable(true)
        .on_open_change((open, cx) => this.setOpen(open, cx)).trigger(trigger).when(this.open, el => el.content(this.panel(cx))));
  }
}

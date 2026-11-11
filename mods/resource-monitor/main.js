import { View, div, svg, PathBuilder } from "gpui-kit";
import { Button, Input, InputState, Popover, Scrollbar, VirtualListScrollHandle, h_flex, v_flex, v_virtual_list } from "gpui-base";
import { agents, closeOverlay, exec, focused, machines, panes, props, spaces, terminals, theme, window as appWindow } from "herdr";
import { createCollector } from "./collect.js";
import { buildResources, MemoryHistory } from "./model.js";
import { buildResourceTree, resourceRows } from "./tree.js";

const ROW = 32;
const LIST = "resource-monitor-rows";
const INTERVALS = [1, 2, 5, 10];
const icon = name => svg(`mods/workspace-chrome/${name}.svg`).size(13).flex_none();
const machineOf = terminal => terminal.machine ?? (terminal.address?.includes("/") ? terminal.address.slice(0, terminal.address.indexOf("/")) : null);
const bytes = value => {
  if (!Number.isFinite(value)) return "Unknown";
  for (const [scale, unit] of [[1024 ** 3, "GiB"], [1024 ** 2, "MiB"], [1024, "KiB"]]) {
    if (value >= scale) return `${(value / scale).toFixed(1)} ${unit}`;
  }
  return `${Math.round(value)} B`;
};
const cpu = value => Number.isFinite(value) ? `${value.toFixed(1)}%` : "Unknown";
const age = (at, now) => at ? `${Math.max(0, Math.floor((now - at) / 1000))}s ago` : "Not sampled";
const endpoint = port => `${port.family === "ipv6" ? `[${port.address}]` : port.address}:${port.port}`;
const clean = text => String(text ?? "").replace(/[\u0000-\u001f\u007f]/g, " ");

export default class ResourceMonitor extends View {
  init(_props, cx) {
    this.overlay = props()?.overlay;
    this.closed = false;
    this.generation = 0;
    this.collector = createCollector(exec);
    this.snapshots = new Map();
    this.inflight = new Map();
    this.connections = new Map();
    this.history = new MemoryHistory();
    this.expanded = new Set();
    this.seen = new Set();
    this.nodes = [];
    this.rows = [];
    this.sort = "memory";
    this.interval = 5;
    this.intervalOpen = false;
    this.selected = null;
    this.revealSearch = false;
    this.now = Date.now();
    this.focusedInputs = new Set();
    this.signature = null;
    this.handle = cx.focus_handle();
    this.scroll = VirtualListScrollHandle.new();
    this.filters = {
      name: InputState.new({ placeholder: "Name / address" }),
      pid: InputState.new({ placeholder: "PID" }),
      port: InputState.new({ placeholder: "Port" })
    };
    for (const [name, input] of Object.entries(this.filters)) {
      input.on("change", (_e, cx) => { this.flatten(true); cx.notify(); });
      input.on("focus", () => { this.focusedInputs.add(name); });
      input.on("blur", () => { this.focusedInputs.delete(name); });
    }
    this.currentSpace = focused()?.space ?? spaces().find(s => s.active)?.id ?? null;
    this.handle.focus();
    this.refresh(cx);
    this.schedule(cx);
  }

  schedule(cx) {
    this.timer?.cancel();
    this.timer = cx.timer.every(this.interval * 1000, cx => {
      if (this.closed) return;
      this.now = Date.now();
      this.dirty = true;
      this.refresh(cx);
      cx.notify();
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
    this.nodes = buildResources({ terminals: ts, spaces: ss, panes: ps, agents: as, snapshots: this.snapshots, now: this.now, maxSampleAge: Math.max(10000, (this.interval + 5) * 1000) });
    const visit = node => {
      if (!this.seen.has(node.id)) {
        this.seen.add(node.id);
        if (node.space === this.currentSpace && node.kind !== "terminal") this.expanded.add(node.id);
      }
      if (spaceChanged && node.space === this.currentSpace && node.kind !== "terminal") this.expanded.add(node.id);
      for (const child of node.children ?? []) visit(child);
    };
    this.nodes.forEach(visit);
    this.history.update(this.nodes, this.now);
    this.flatten();
  }

  refresh(cx) {
    if (this.closed) return;
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
    if (!appWindow()?.active) return;
    const candidates = [...targets].filter(([key]) => available.get(key) !== "unavailable" && !this.inflight.has(key))
      .sort(([a], [b]) => (this.snapshots.get(a)?.at ?? 0) - (this.snapshots.get(b)?.at ?? 0));
    for (const [key, machine] of candidates.slice(0, Math.max(0, 2 - this.inflight.size))) {
      const generation = this.generation;
      const connection = this.connections.get(key);
      const token = {};
      this.inflight.set(key, token);
      cx.spawn(async cx => {
        let snapshot;
        try { snapshot = await this.collector.sample(machine, machine === null ? appWindow()?.platform : null, Math.max(10000, (this.interval + 5) * 1000)); }
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
        this.snapshots.set(key, snapshot);
        this.now = Date.now();
        this.dirty = true;
        this.rebuild();
        cx.notify();
      });
    }
  }

  flatten(reveal = false) {
    const filters = Object.fromEntries(Object.entries(this.filters).map(([name, input]) => [name, input.value().trim()]));
    this.searching = Object.values(filters).some(Boolean);
    this.portSearch = Boolean(filters.port);
    if (reveal) this.revealSearch = this.searching;
    this.tree = buildResourceTree(this.nodes, { filters, snapshots: this.snapshots });
    if (reveal || (this.searching && this.revealSearch)) {
      const visit = node => { this.expanded.add(node.id); node.children.forEach(visit); };
      this.tree.forEach(visit);
    }
    this.rows = resourceRows(this.tree, { expanded: this.expanded, sort: this.sort, currentSpace: this.currentSpace });
    if (!this.rows.some(row => row.id === this.selected)) this.selected = this.rows[0]?.id ?? null;
  }

  expandAll(open, cx) {
    this.revealSearch = false;
    this.expanded.clear();
    this.flatten(open);
    this.handle.focus();
    if (this.rows.length) this.scroll.scroll_to_item(0);
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

  key(event, cx) {
    if (event.key === "escape") {
      if (this.intervalOpen) { this.intervalOpen = false; cx.notify(); }
      else closeOverlay(this.overlay);
      cx.stop_propagation();
      return;
    }
    if (this.intervalOpen) return;
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

  button(id, label, action, active = false) {
    const t = theme();
    return Button.new(id).h(28).px(8).flex_none().rounded(5).border_1().border_color(active ? t.accent : t.border)
      .bg(active ? t.selected : t.raised).text_color(t.foreground).text_size(12).tab_index(0)
      .accessibility_label(label).hover(el => el.bg(t.hover)).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .when(Boolean(action), el => el.on_click(action)).child(label);
  }

  intervalControl(t) {
    return Popover.new("resource-interval").open(this.intervalOpen)
      .on_open_change((open, cx) => { this.intervalOpen = open; cx.notify(); })
      .trigger(this.button("resource-interval-trigger", `${this.interval}s ▾`, null)
        .accessibility_label(`Refresh interval: ${this.interval} seconds`).tooltip("Refresh interval"))
      .when(this.intervalOpen, el => el.content(v_flex().p(4).gap(3).rounded(5).bg(t.popover).border_1().border_color(t.border)
        .children(INTERVALS.map(seconds => this.button(`resource-interval-${seconds}`, `${seconds}s`, (_e, cx) => {
          this.interval = seconds;
          this.intervalOpen = false;
          this.schedule(cx);
          cx.notify();
        }, this.interval === seconds)))));
  }

  spark(node, t) {
    const samples = this.history.get(node);
    if (samples.length < 2) return div().w(64).flex_none().text_right().text_color(t.muted).child("No trend");
    const min = Math.min(...samples), span = Math.max(...samples) - min || 1;
    const path = PathBuilder.stroke(1.3);
    samples.forEach((value, i) => {
      const x = `${i * 100 / (samples.length - 1)}%`, y = `${95 - (value - min) * 90 / span}%`;
      if (i) path.line_to(x, y); else path.move_to(x, y);
    });
    return div().w(64).h(18).flex_none().child(globalThis.window.paint_path(path.build(), t.accent).size_full());
  }

  row(row, t) {
    const { node, type } = row;
    const base = h_flex().h(ROW).w_full().px(12).gap(12).items_center().text_size(12)
      .when(row.id === this.selected, el => el.bg(t.selected)).hover(el => el.bg(t.hover));
    const name = div().flex_1().min_w(200).pl(row.depth * 14).truncate();
    const value = (text, width) => div().w(width).flex_none().text_right().child(text);
    if (type === "port") return base.text_color(t.muted)
      .child(name.child(`${node.machine ?? "This computer"}  ${endpoint(row.port)}`))
      .child(div().flex_none().text_color(t.foreground).tooltip(age(node.portsAt, this.now)).child(`TCP LISTEN · ${row.port.binding ?? "specific address"}`));
    if (type === "detail") {
      const snapshot = this.snapshots.get(node.machine ?? "");
      const ports = snapshot?.listeners;
      const detail = [node.directChildren === null ? "Child counts unknown" : `${node.directChildren} direct children; ${node.descendants} descendants`,
        Number.isFinite(node.footprint) ? `Footprint ${bytes(node.footprint)} (${age(node.footprintAt, this.now)})` : (snapshot?.platform === "macos" ? "Footprint unknown" : null),
        ports?.state === "ready" ? (node.ports.length ? null : "No TCP listeners found") : (ports?.message ?? "Listener coverage unknown"),
        node.message].filter(Boolean).join(" · ");
      return base.text_color(t.muted).child(name.tooltip(clean(detail)).child(clean(detail)));
    }
    if (type === "process") {
      const process = row.process;
      return base.text_color(t.muted)
        .child(name.tooltip(`PID ${process.pid} · PPID ${process.ppid}${process.start ? ` · Started ${process.start}` : " · Start time unknown"}`)
          .child(`${clean(process.name)}  ${process.pid} / ${process.ppid}${process.root ? " · root" : ""}${process.foreground ? " · foreground" : ""}`))
        .child(value(cpu(process.cpu), 78)).child(value(bytes(process.memory), 106)
          .tooltip(`Footprint: ${bytes(process.footprint)} · ${age(process.footprintAt, this.now)}`))
        .child(value("", 78)).child(value("", 72)).child(value("", 64));
    }
    const snapshot = this.snapshots.get(node.machine ?? "");
    const fresh = snapshot?.processes.state === "ready" || snapshot?.processes.state === "partial";
    const warning = node.unknown ? ` · ${node.unknown} unknown` : "";
    const kind = node.kind === "terminal" ? "Pane" : node.kind === "process-owner" ? "Process" : node.kind[0].toUpperCase() + node.kind.slice(1);
    const title = `${node.kind === "space" && node.machine ? `${clean(node.machine)} / ` : ""}${clean(node.name)}${warning}${node.stale ? " · stale" : ""}`;
    return base.cursor_pointer()
      .child(h_flex().flex_1().min_w(200).pl(row.depth * 14).gap(6).items_center()
        .child(icon(this.expanded.has(node.id) ? "chevron-down" : "chevron-right").text_color(t.muted))
        .child(div().flex_none().text_size(10).text_color(t.muted).child(kind))
        .child(div().min_w(0).truncate().tooltip(`${title}${node.pane ? ` · Pane: ${clean(node.paneName ?? node.name)} (${node.pane})` : ""}${node.address ? ` · ${node.address}` : ""}${node.parent ? ` · Core parent: ${node.parent}` : ""}${node.message ? ` · ${clean(node.message)}` : ""}`).child(title))
        .when(Boolean(node.status), el => el.child(div().flex_none().text_size(10).text_color(t.muted).child(clean(node.status)))))
      .child(value(cpu(node.cpu), 78).text_color(fresh ? t.foreground : t.muted))
      .child(value(bytes(node.memory), 106).text_color(fresh ? t.foreground : t.muted)
        .tooltip(`${node.metric} · Footprint: ${bytes(node.footprint)} · ${age(node.footprintAt, this.now)}`))
      .child(value(node.kind === "terminal" ? (node.descendants ?? "Unknown").toString() : "", 78))
      .child(value(snapshot?.listeners.state === "ready" ? String(node.ports.length) : `${node.ports.length} known`, 72))
      .child(this.spark(node, t));
  }

  render(cx) {
    this.rebuild();
    const t = theme();
    const paused = !appWindow()?.active;
    const hostRows = this.nodes.map(node => {
      const snapshot = this.snapshots.get(node.machine ?? ""), host = snapshot?.host;
      const known = host?.state === "ready" && host.total > 0 && Number.isFinite(host.available);
      const text = known ? `${((host.total - host.available) * 100 / host.total).toFixed(1)}% host memory · ${bytes(host.available)} available` : (host?.message ?? "Host memory unknown");
      const resourceState = snapshot?.processes;
      return div().min_w(0).truncate().text_size(11.5).text_color(t.muted)
        .tooltip(`${clean(node.name)} · ${text} · ${age(host?.at, this.now)}${resourceState?.message ? ` · ${clean(resourceState.message)}` : ""}`)
        .child(`${clean(node.name)}: ${text}${resourceState?.state === "error" ? " · stale" : ""}`);
    });
    const list = v_flex().flex_1().min_h(0).min_w(0).relative()
      .child(v_virtual_list(LIST, this.rows.length, ROW, index => this.rows[index].id,
        range => this.rows.slice(range.start, range.end).map(row => this.row(row, t)))
        .size_full().track_scroll(this.scroll).on_item_click((id, cx) => this.activate(id, cx)))
      .child(Scrollbar.vertical(LIST).viewport_from_layout().absolute().inset_0());
    return v_flex().id("resource-monitor").track_focus(this.handle).size_full().min_w(0).min_h(0)
      .bg(t.popover).text_color(t.foreground).text_size(12.5).role("group").accessibility_label("Resources: child processes and listening ports")
      .on_key_down((e, cx) => this.key(e, cx))
      .child(h_flex().px(12).h(38).flex_none().gap(6).items_center()
        .child(div().flex_1().min_w(0).font_semibold().text_size(13).tooltip("Tree · Read-only resource monitor").child("Resources · Tree"))
        .child(this.button("resource-expand-all", "Expand all", (_e, cx) => this.expandAll(true, cx)))
        .child(this.button("resource-collapse-all", "Collapse all", (_e, cx) => this.expandAll(false, cx)))
        .child(this.intervalControl(t))
        .child(this.button("resource-refresh", "Refresh", (_e, cx) => { this.refresh(cx); cx.notify(); })
          .tooltip(paused ? "Sampling is paused while the app is inactive" : "Refresh resources now"))
        .child(this.button("resource-close", "Close", () => closeOverlay(this.overlay))))
      .child(h_flex().px(12).pb(6).gap(6).items_center().flex_none().on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .children(Object.entries(this.filters).map(([name, input]) =>
          div().when(name === "name", el => el.flex_1().min_w(80))
            .when(name !== "name", el => el.w(64).flex_none())
            .tooltip(name === "name" ? "Pane, process, space or tab name; pane ID or terminal address" : name === "pid" ? "Exact PID; combined with other filters" : "Exact TCP listening port; includes collected processes outside panes")
            .child(Input.new(input).w_full().h(28).px(8).rounded(5).border_1().border_color(t.input).bg(t.background).text_color(t.foreground)
              .accessibility_label(name === "name" ? "Filter names or addresses" : name === "pid" ? "Filter exact process ID" : "Filter exact TCP listening port"))))
        .children(["name", "cpu", "memory"].map(sort => this.button(`resource-sort-${sort}`, sort === "cpu" ? "CPU" : sort === "name" ? "Name" : "Memory", (_e, cx) => {
          this.sort = sort; this.flatten(); cx.notify();
        }, this.sort === sort).tooltip(`Sort by ${sort}`))))
      .child(v_flex().px(12).pb(6).gap(3).flex_none().children(hostRows))
      .when(this.portSearch, el => el.child(div().px(12).pb(6).text_size(11).text_color(t.muted)
        .child(`Port search · Collected TCP listeners${[...this.snapshots.values()].some(snapshot => snapshot.listeners?.state !== "ready") || !this.snapshots.size ? " · Coverage incomplete or unavailable" : ""}`)))
      .child(div().id("resource-horizontal").flex_1().min_h(0).min_w(0).overflow_x_scrollbar()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(v_flex().min_w(800).w_full().h_full()
          .child(h_flex().h(30).flex_none().px(12).gap(12).items_center().bg(t.chrome).text_color(t.muted).text_size(11)
            .child(div().flex_1().min_w(200).child("Name / PID / PPID"))
            .child(div().w(78).flex_none().text_right().tooltip("Percent of one core; may exceed 100%. Unix ps CPU is not a fixed sampling window.").child("CPU / core"))
            .child(div().w(106).flex_none().text_right().tooltip("RSS on Unix; Working Set on Windows. Summed shared pages can repeat.").child("RSS / WS"))
            .child(div().w(78).flex_none().text_right().child("Descendants"))
            .child(div().w(72).flex_none().text_right().child("Listeners"))
            .child(div().w(64).flex_none().text_right().child("Memory")))
          .when(this.rows.length > 0, el => el.child(list))
          .when(!this.rows.length, el => el.child(div().p(24).text_color(t.muted).child(this.searching ? "No matching resources in collected data" : "No running panes in this scope")))))
      .child(div().px(12).py(4).flex_none().text_size(11).text_color(t.muted)
        .child("Read-only · Listening ports are not verified web services · Shared pages may repeat in RSS/WS"));
  }
}

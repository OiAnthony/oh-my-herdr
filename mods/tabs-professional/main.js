// Adapted from Herdr tabs v0.1.14 (Apache-2.0).
// Modified by oh-my-herdr: launcher split button and Files/Changes focus behavior.
// Fixed upstream source and license: ../../THIRD_PARTY.md; ../../LICENSE.
import { View, div, svg, image } from "gpui-kit";
import { Button, h_flex } from "gpui-base";
import { spaces, panes, run, openOverlay, theme, window, shared, setShared, layout, settings, nextCommand, focused } from "herdr";

const CHANGES_DOUBLE_PRESS_MS = 300;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class Tabs extends View {
  init(_props, cx) {
    this.pressed = null;
    this.changesPress = null;
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
    cx.spawn(async cx => {
      for (;;) this.handleCommand(await nextCommand(), cx);
    });
  }

  cancelChanges() {
    const pending = this.changesPress;
    this.changesPress = null;
    pending?.task.cancel();
    return pending;
  }

  sameContext(pending) {
    const target = focused();
    return pending.layout === shared("layout") && pending.space === target?.space && pending.tab === target?.tab;
  }

  handleCommand(command, cx) {
    if (command === "launch-default") { this.openLauncher("launch"); return; }
    if (!["focus-files", "toggle-files", "toggle-changes"].includes(command)) return;
    const previous = this.cancelChanges();
    if (command.endsWith("-files") || !find(layout(), "graph-panel")) {
      this.panelCommand(command);
      return;
    }
    if (previous && this.sameContext(previous)) {
      if (Date.now() - previous.at < CHANGES_DOUBLE_PRESS_MS) {
        run("layout.toggle", { id: "graph-panel" });
        return;
      }
      // A busy foreground executor must not extend the double-press deadline.
      this.panelCommand(previous.command);
    }
    const target = focused();
    const pending = { command, at: Date.now(), layout: shared("layout"), space: target?.space, tab: target?.tab };
    this.changesPress = pending;
    pending.task = cx.timer.after(CHANGES_DOUBLE_PRESS_MS, () => {
      if (this.changesPress !== pending) return;
      this.changesPress = null;
      if (this.sameContext(pending)) this.panelCommand(command);
    });
  }

  panelCommand(command) {
    const child = command.endsWith("-files") ? "files" : "changes";
    const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
    if (!panel || !body) return;
    if (command === `toggle-${child}` && !panel.hidden && body.active === child) {
      setShared("professional-panels.focus", null);
      run("layout.hide", { id: "panel" });
      const target = focused();
      if (target?.pane) run("pane.focus", { pane: target.pane });
      else if (target?.terminal) run("pane.focus", { terminal: target.terminal });
    } else {
      run("layout.select", { stack: "panel-body", child });
      run("layout.show", { id: "panel" });
      setShared("professional-panels.focus", child);
    }
  }

  close() { this.cancelChanges(); }

  openLauncher(action) {
    openOverlay({ mod: "agent-launcher", kind: "popup", width: 250, height: 512, props: { action } });
  }

  launcher(space) {
    const t = theme(), choice = shared("agent-launcher.defaults")?.[space?.machine ?? ""];
    const stop = (_event, cx) => cx.stop_propagation();
    return h_flex().id("tab-launcher").h(28).flex_none().max_w(210).items_center().rounded(6)
      .border(1).border_color(t.border).bg(t.surface).text_size(12).text_color(t.foreground)
      .child(Button.new("tab-launch-default").h_full().min_w(0).px(8).gap(6).rounded_l(5)
        .accessibility_label(choice ? "New tab with " + choice.name : "Choose a default agent")
        .tooltip(choice ? "Start " + choice.name + " in a new tab" : "Choose an agent or custom command")
        .hover(el => el.bg(t.hover)).on_mouse_down("left", stop)
        .on_click((_event, cx) => { cx.stop_propagation(); this.openLauncher("launch"); })
        .child(div().child("+"))
        .when(Boolean(choice?.icon), el => el.child(choice.tint ? svg(choice.icon).size(14) : image(choice.icon).size(14)))
        .child(div().min_w(0).max_w(145).truncate().child(choice?.name ?? "Start agent…")))
      .child(Button.new("tab-launch-menu").w(26).h_full().flex_none().items_center().justify_center().rounded_r(5)
        .border_l(1).border_color(t.border).accessibility_label("Choose agent or default command")
        .tooltip("Start once, set a default, or customize the command").hover(el => el.bg(t.hover))
        .on_mouse_down("left", stop).on_click((_event, cx) => { cx.stop_propagation(); this.openLauncher("menu"); })
        .child(svg("mods/workspace-chrome/chevron-down.svg").size(12).flex_none()));
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  render() {
    const t = theme();
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const item = (c, i) => {
      const program = panes().find(p => p.tab === c.id && p.program?.agent)?.program ?? panes().find(p => p.tab === c.id)?.program;
      const name = /^tb\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;
      return h_flex().id(`tab-${c.id}`).h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
        .border(1).border_color(c.active ? t.border : t.chrome).bg(c.active ? t.raised : t.chrome).text_color(c.active ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(c.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded(3).bg(t[c.status])))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const enabled = shared("workspace.panels") ?? ["files", "changes"];
    this.syncPanel(space, panel, body, enabled);
    const panelButton = (id, label, icon) => {
      const on = panel && !panel.hidden && body?.active === id;
      return h_flex().id(`panel-${id}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
        }).child(svg(icon).size(14)).child(label);
    };
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().children(shown.map(item)))
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))
      .child(this.launcher(space))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/tabs/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/tabs/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}

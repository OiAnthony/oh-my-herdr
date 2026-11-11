import { View, div, svg } from "gpui-kit";
import { Button, h_flex } from "gpui-base";
import { spaces, agents, theme, run, window, keys, layout, props, openOverlay } from "herdr";

function findNode(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

// This layout adapter owns the statusline composition, not the graph feature.
export default class ProfessionalStatus extends View {
  hint() {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const binding = keys().find(k => k.section === "global" && k.action === "app.palette");
    const parts = binding?.keys.endsWith("--") ? [...binding.keys.slice(0, -2).split("-"), "-"] : binding?.keys.split("-");
    const key = parts?.map(p => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  graphTarget() {
    const binding = props()?.graph;
    if (!binding?.panel || !binding.mod) return null;
    const panel = findNode(layout(), binding.panel);
    return panel?.type === "block" && panel.content?.mod === binding.mod ? { binding, panel } : null;
  }

  toggleGraph() {
    const target = this.graphTarget();
    if (!target) return;
    run("layout.toggle", { id: target.binding.panel });
  }

  render() {
    const t = theme(), space = spaces().find(s => s.active), list = agents();
    const needs = list.filter(agent => agent.status === "blocked").length;
    const target = this.graphTarget();
    const active = Boolean(target && !target.panel.hidden);
    const label = (icon, text) => h_flex().gap(6).items_center()
      .child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border)
      .text_size(11.8).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.dim)).child(`${list.length} agents`)
        .when(needs > 0, el => el.child(div().text_color(t.blocked).child(`· ${needs} needs you`))))
      .when(Boolean(target), el => el.child(h_flex().id("professional-git-graph").h(22).px(6).flex_none().items_center().rounded(4)
        .role("button").accessibility_label("Git Graph").tooltip("Toggle Git Graph")
        .text_color(active ? t.foreground : t.muted).when(active, button => button.bg(t.selected))
        .hover(button => button.bg(t.hover).text_color(t.foreground)).cursor_pointer()
        .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
        .on_click(() => this.toggleGraph())
        .child("Git Graph")))
      .child(Button.new("professional-resources").h(22).px(6).flex_none().rounded(4)
        .tab_index(0).accessibility_label("Resources").tooltip("Child processes and listening ports")
        .text_color(t.muted).hover(button => button.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
        .on_click(() => openOverlay({ mod: "resource-monitor", kind: "window", key: "resource-monitor", keep: false, width: 0.8, height: 0.75 }))
        .child("Resources"))
      .child(div().flex_1())
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint()));
  }
}

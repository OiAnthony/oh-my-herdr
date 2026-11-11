// Adapted from Herdr's pane v0.1.14 (Apache-2.0).
// Modified for read-only diff titles and Professional pane composition.
// Source revision and full license: NOTICE, LICENSE.Apache-2.0.
import { div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, spaces, props, run, theme, home, shared } from "herdr";
import { diffPath } from "./path.js";

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

export class PaneHeader {
  init() { this.hovered = false; }

  button(t, id, icon, command, args) {
    return div().id(id).p(3).rounded(4).text_color(t.dim)
      .hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { cx.stop_propagation(); run(command, args); })
      .child(svg(`mods/pane/${icon}.svg`).size(14));
  }

  render(cx) {
    const t = theme(), p = panes().find(p => p.pane === props()?.pane);
    if (!p) return div();
    const space = spaces().find(space => space.tabs.some(tab => tab.id === p.tab));
    const entry = p.mod === "git-graph" && (shared(`git-graph.diff-tabs.${space?.id}`) ?? []).find(entry => entry.pane === p.pane);
    const target = entry && entry.diff;
    const title = entry ? entry.title ?? diffPath(target, target.titleCwd ?? target.root) : null;
    const name = title ?? (((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell");
    const pic = icon(p.program, 14, t.dim), st = p.status, pane = p.pane;
    return h_flex().id(`pane-head-${pane}`).size_full().px(10).gap(8).items_center()
      .bg(t.background).border_b(1).border_color(t.border).text_size(12)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .when(Boolean(pic), el => el.child(pic))
      .child(div().min_w(0).truncate().font_medium().text_color(t.foreground)
        .when(Boolean(title), el => el.flex_1().tooltip(title))
        .when(!title, el => el.flex_none().max_w(260)).child(name))
      .when(!title, el => el.child(div().flex_1().truncate().text_color(t.dim).child(folder(p.cwd))))
      .when(st === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
      .when(st === "blocked", el => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).child("Needs you")))
      .when(st === "done", el => el.child(div().size(7).flex_none().rounded(4).bg(t.done)))
      .when(this.hovered, el => el
        .child(this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
        .child(this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
        .child(this.button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
        .child(this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane })));
  }
}

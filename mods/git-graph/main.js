import { View } from "gpui-kit";
import { props } from "herdr";
import { Graph } from "./graph.js";
import { Menu } from "./menu.js";
import { Dialog } from "./dialog.js";
import { Settings } from "./settings.js";
import { Diff } from "./diff.js";
import { PaneHeader } from "./pane.js";

// One mod: graph, menus, dialogs, settings and diffs.
export default class GitGraph extends View {
  init(_props, cx) {
    const role = props()?.role;
    this.part = role === "pane-header" ? new PaneHeader() : role === "menu" ? new Menu() : role === "dialog" ? new Dialog() : role === "settings" ? new Settings() : role === "diff" ? new Diff() : new Graph();
    this.part.init(cx);
  }

  close(cx) { this.part.close?.(cx); }

  render(cx) { return this.part.render(cx); }
}

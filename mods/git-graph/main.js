import { View } from "gpui-kit";
import { props } from "herdr";
import { Graph } from "./graph.js";
import { Menu } from "./menu.js";
import { Dialog } from "./dialog.js";
import { Settings } from "./settings.js";

// One mod: the graph, its menus, dialogs and settings.
export default class GitGraph extends View {
  init(_props, cx) {
    const role = props()?.role;
    this.part = role === "menu" ? new Menu() : role === "dialog" ? new Dialog() : role === "settings" ? new Settings() : new Graph();
    this.part.init(cx);
  }

  render(cx) { return this.part.render(cx); }
}

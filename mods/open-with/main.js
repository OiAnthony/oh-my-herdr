import { View, div, image, svg } from "gpui-kit";
import { Button, h_flex, v_flex } from "gpui-base";
import { appHome, closeOverlay, exec, hc, nextCommand, notify, openOverlay, props, readTextFile, run, shared, setShared, theme, window } from "herdr";
import { captureTarget, resolveTarget } from "./context.js";
import { availableApps, launch, parseApps } from "./apps.js";
import { hostOf } from "./vscode.js";

const DEFAULT_KEY = "open-with.default-app";
const LAUNCHER_PADDING = 10;
const LAUNCHER_MAX_WIDTH = 190;

export default class OpenWith extends View {
  init(_props, cx) {
    const p = props() ?? _props ?? {};
    this.launcher = p.role === "launcher";
    this.widthTarget = p.widthTarget;
    this.overlay = p.overlay;
    this.apps = [];
    this.loading = true;
    this.index = 0;
    this.error = null;
    if (!this.launcher) {
      this.target = captureTarget();
      this.handle = cx.focus_handle();
      this.handle.focus();
    }
    cx.spawn(async cx => {
      try {
        const raw = await readTextFile(`${appHome()}/mods/open-with/apps.json`);
        this.apps = parseApps(raw);
        if (!this.launcher) {
          this.apps = availableApps(this.apps, this.target, window()?.platform);
          this.index = this.apps.indexOf(this.defaultApp());
          this.target = await resolveTarget(this.target, exec);
          this.resolved = true;
        }
      } catch (error) {
        this.error = error?.message ?? String(error);
      } finally { this.loading = false; cx.notify(); }
    });
    if (this.launcher) cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "open-default") this.openDefault(cx);
      }
    });
  }

  defaultApp(apps = this.apps) {
    return apps.find(app => app.id === shared(DEFAULT_KEY)) ?? apps[0];
  }

  openDefault(cx) {
    const target = captureTarget();
    this.choose(this.defaultApp(availableApps(this.apps, target, window()?.platform)), cx, target);
  }

  setDefault(index) {
    const app = this.apps[index];
    if (app) setShared(DEFAULT_KEY, app.id);
  }

  close() {
    this.handle?.release();
  }

  choose(app, cx, target = this.target) {
    if (this.loading || this.busy || !app) return;
    this.busy = app.id;
    this.error = null;
    cx.notify();
    cx.spawn(async cx => {
      try {
        const resolved = !this.launcher && this.resolved ? target : await resolveTarget(target, exec);
        if (!this.launcher) {
          this.target = resolved;
          this.resolved = true;
        }
        await launch(app, resolved, exec, window()?.platform,
          machine => hostOf(machine, { appHome, readTextFile, hc }));
        if (!this.launcher) closeOverlay(this.overlay);
      } catch (error) {
        this.error = error?.message ?? String(error);
        if (this.launcher) notify({ title: `Could not open with ${app.title}`, body: this.error, level: "error" });
      } finally { this.busy = null; cx.notify(); }
    });
  }

  icon(app) {
    return (app?.icon ? image(app.icon) : svg("mods/open-with/icons/application.svg"))
      .size(16).flex_none();
  }

  renderLauncher() {
    const t = theme();
    const app = this.apps.length ? this.defaultApp(availableApps(this.apps, captureTarget(), window()?.platform)) : null;
    const stop = (_event, cx) => cx.stop_propagation();
    return h_flex().id("open-with-toolbar").size_full().pr(LAUNCHER_PADDING).items_center().justify_end()
      .bg(t.chrome).border_b(1).border_color(t.border)
      .child(h_flex().id("open-with-button-group").h(28).flex_none().max_w(LAUNCHER_MAX_WIDTH)
        .on_size_change(({ width }) => {
          if (!this.widthTarget || width <= 0) return;
          const px = Math.ceil(width) + LAUNCHER_PADDING;
          if (this.launcherWidth === px) return;
          this.launcherWidth = px;
          run("layout.resize", { id: this.widthTarget, px });
        })
        .items_center().rounded(6).border(1).border_color(t.border)
        .bg(t.surface).text_size(12).text_color(t.foreground)
        .child(Button.new("open-with-launcher").h_full().min_w(0).px(8).gap(6).items_center().rounded_l(5)
          .disabled(this.loading || Boolean(this.busy) || !app)
          .accessibility_label(app ? `Open with ${app.title}` : "Open With")
          .tooltip(this.error ?? (app ? `Open the current repository or working directory in ${app.title}` : "Loading applications…"))
          .hover(el => el.bg(t.hover)).cursor_pointer().on_mouse_down("left", stop)
          .on_click((_event, cx) => {
            cx.stop_propagation();
            this.openDefault(cx);
          })
          .child(this.icon(app))
          .child(div().min_w(0).truncate().child(this.loading ? "Loading…" : this.busy ? "Opening…" : app?.title ?? "Open With")))
        .child(Button.new("open-with-dropdown").w(26).h_full().flex_none().items_center().justify_center()
          .rounded_r(5).border_l(1).border_color(t.border)
          .accessibility_label("Choose default application or open with")
          .tooltip("Choose default application or open with")
          .hover(el => el.bg(t.hover)).cursor_pointer().on_mouse_down("left", stop)
          .on_click((_event, cx) => {
            cx.stop_propagation();
            openOverlay({ mod: "open-with", kind: "popup", width: 360, height: 460 });
          })
          .child(svg("mods/open-with/icons/chevron-down.svg").size(12))));
  }
  render() {
    if (this.launcher) return this.renderLauncher();
    const t = theme(), defaultApp = this.defaultApp();
    const stop = (_event, cx) => cx.stop_propagation();
    const caption = this.target.kind === "repository" ? "Git repository" : "Working directory";
    return v_flex().id("open-with-menu").track_focus(this.handle).size_full().p(8).gap(4)
      .role("menu").accessibility_label("Open With")
      .bg(t.popover).text_color(t.foreground).text_size(13)
      .on_key_down((event, cx) => {
        if (event.key === "escape") { closeOverlay(this.overlay); cx.stop_propagation(); }
        if (this.apps.length && ["up", "down"].includes(event.key)) {
          this.index = (this.index + (event.key === "down" ? 1 : -1) + this.apps.length) % this.apps.length;
          cx.stop_propagation(); cx.notify();
        }
        if (event.key === "enter") { this.choose(this.apps[this.index], cx); cx.stop_propagation(); }
        if (event.key === "d") { this.setDefault(this.index); cx.stop_propagation(); }
      })
      .child(div().px(8).py(4).font_semibold().child("Open With"))
      .child(v_flex().px(8).pb(8).gap(3).border_b(1).border_color(t.border)
        .child(div().text_size(11).text_color(t.dim).child(caption))
        .child(div().text_size(12).text_color(t.muted).child(`${this.target.on ? `${this.target.on}:` : ""}${this.target.path ?? "No target"}`)))
      .when(this.loading, el => el.child(div().p(8).text_color(t.dim).child("Loading…")))
      .child(v_flex().id("open-with-apps").h(Math.min(this.apps.length * 36, 288)).flex_none().overflow_y_scrollbar().gap(2)
        .children(this.apps.map((app, index) => h_flex().id(`open-with-${app.id}`).h(34).flex_none().pl(8).pr(4).mr(12).gap(8)
          .role("menu_item").accessibility_label(`Open with ${app.title}`)
          .when(index === this.index, el => el.aria_active_descendant())
          .items_center().rounded(5).cursor_pointer().when(index === this.index, el => el.bg(t.selected))
          .hover(el => el.bg(t.hover)).on_click((_event, cx) => this.choose(app, cx))
          .child(this.icon(app))
          .child(div().flex_1().child(app.title))
          .when(this.busy === app.id, el => el.child(div().text_size(11).text_color(t.dim).child("Opening…")))
          .child(h_flex().id(`open-with-default-${app.id}`).size(26).flex_none().items_center().justify_center().rounded(4)
            .role("button").accessibility_label(`Set ${app.title} as default`)
            .tooltip(defaultApp?.id === app.id ? "Default application" : "Set as default")
            .text_color(defaultApp?.id === app.id ? t.accent : t.dim).hover(el => el.bg(t.raised).text_color(t.foreground))
            .on_mouse_down("left", stop).on_click((_event, cx) => { cx.stop_propagation(); this.setDefault(index); })
            .child(defaultApp?.id === app.id ? "★" : "☆")))))
      .when(Boolean(this.error), el => el.child(div().p(8).text_size(12).text_color(t.blocked).child(this.error)))
      .child(div().px(8).py(4).text_size(11).text_color(t.dim).child("↑ ↓ Select · Enter Open · D Default · Esc Close"));
  }
}

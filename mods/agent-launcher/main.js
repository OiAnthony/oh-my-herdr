import { View, div, svg, image } from "gpui-kit";
import { Button, h_flex, v_flex, InputState, Input } from "gpui-base";
import { spaces, focused, knownAgents, run, openOverlay, closeOverlay, props, theme, shared, setShared } from "herdr";
import { DEFAULTS, COMMANDS, captureTarget, customCommand, agentChoice, resolveLaunch, newTabCommand } from "./launch.js";

export default class AgentLauncher extends View {
  init(_props, cx) {
    const p = props() ?? _props ?? {};
    this.overlay = p.overlay;
    this.target = p.target ?? captureTarget(spaces(), focused());
    this.where = this.target.machine ?? "";
    this.editing = p.mode === "edit";
    this.agents = [];
    this.loading = !this.editing;
    this.index = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
    if (this.editing) {
      const custom = this.custom();
      this.nameInput = InputState.new({ value: custom?.name ?? "", placeholder: "Optional display name" });
      this.programInput = InputState.new({ value: custom?.argv?.[0] ?? "", placeholder: "Executable path or shell function" });
      this.argsInput = InputState.new({ value: JSON.stringify(custom?.argv?.slice(1) ?? []), placeholder: "JSON array of arguments" });
      for (const input of [this.nameInput, this.programInput, this.argsInput]) {
        input.on("change", (_e, cx) => { this.error = null; cx.notify(); });
        input.on("submit", (_e, cx) => { this.save(); cx.notify(); });
      }
      this.programInput.focus();
      cx.timer.after(100, () => this.programInput.focus());
      return;
    }
    const choice = shared(DEFAULTS)?.[this.where];
    if (p.action === "launch" && choice?.kind === "custom") {
      this.loading = false;
      this.start(choice);
      return;
    }
    cx.spawn(async cx => {
      try {
        this.agents = await knownAgents({ on: this.target.machine });
        const selected = this.selected();
        const current = selected?.kind === "agent" ? this.agents.find(agent => agent.key === selected.key) : null;
        if (current && (selected.name !== current.name || selected.icon !== current.icon || selected.tint !== current.tint)) {
          this.setDefault(agentChoice(current));
        }
        this.loading = false;
        if (p.action === "launch" && choice) this.start(choice);
      } catch (error) {
        this.loading = false;
        this.error = error?.message ?? String(error);
      }
      cx.notify();
    });
  }

  close() { this.handle?.release(); }
  custom() { return shared(COMMANDS)?.[this.where]; }
  selected() { return shared(DEFAULTS)?.[this.where]; }
  isDefault(choice) { const current = this.selected(); return current?.kind === choice.kind && current.key === choice.key; }

  setDefault(choice) {
    setShared(DEFAULTS, { ...shared(DEFAULTS), [this.where]: choice });
  }

  start(choice) {
    if (this.starting || (choice?.kind === "agent" && this.loading)) return;
    try {
      const launch = choice ? resolveLaunch(choice, this.agents, this.custom()) : null;
      const command = newTabCommand(this.target, launch, spaces());
      this.starting = true;
      closeOverlay(this.overlay);
      run(command.name, command.args);
    } catch (error) { this.error = error?.message ?? String(error); }
  }

  edit() {
    closeOverlay(this.overlay);
    openOverlay({ mod: "agent-launcher", kind: "dialog", width: 480, height: 370, props: { mode: "edit", target: this.target } });
  }

  save() {
    try {
      const custom = customCommand(this.programInput.value(), this.argsInput.value(), this.nameInput.value());
      setShared(COMMANDS, { ...shared(COMMANDS), [this.where]: custom });
      if (this.selected()?.kind === "custom") this.setDefault({ kind: "custom", key: "custom", name: custom.name });
      closeOverlay(this.overlay);
      openOverlay({ mod: "agent-launcher", kind: "popup", width: 250, height: 512, props: { target: this.target } });
    } catch (error) { this.error = error?.message ?? String(error); }
  }

  worktree(action) {
    closeOverlay(this.overlay);
    openOverlay({ mod: "worktree", kind: "dialog", width: action === "new" ? 460 : 560,
      height: action === "new" ? 280 : 480, props: { space: this.target.space, folder: this.target.folder, action } });
  }

  icon(choice) {
    if (!choice?.icon) return svg("mods/workspace-chrome/terminal.svg").size(14).text_color(theme().muted);
    return choice.tint ? svg(choice.icon).size(14).text_color(theme().foreground) : image(choice.icon).size(14);
  }

  choices() {
    const installed = this.agents.filter(a => a.installed).map(a => ({ choice: agentChoice(a), enabled: true }));
    const missing = this.agents.filter(a => !a.installed).slice(0, 2).map(a => ({ choice: agentChoice(a), enabled: false }));
    const custom = this.custom();
    return [...installed, ...(custom ? [{ choice: { kind: "custom", key: "custom", name: custom.name }, enabled: true }] : []), ...missing];
  }

  row(id, label, action, enabled = true, icon = null) {
    const t = theme();
    return Button.new(id).h(31).w_full().px(9).gap(9).rounded(6).items_center().justify_start().flex_none()
      .disabled(!enabled).text_color(enabled ? t.foreground : t.dim).hover(s => s.bg(t.hover))
      .accessibility_label(label).on_click((_e, cx) => { action(); cx.notify(); }).child(icon ?? div().w(14)).child(label);
  }

  renderEditor() {
    const t = theme();
    const field = (label, state) => v_flex().gap(5)
      .child(div().text_size(11.5).text_color(t.muted).child(label))
      .child(Input.new(state).accessibility_label(label).h(34).px(9).rounded(6).border_1().border_color(t.border).bg(t.background).text_size(12.8).text_color(t.foreground));
    return v_flex().id("agent-command-editor").track_focus(this.handle).size_full().p(18).gap(12).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(this.overlay); cx.stop_propagation(); } })
      .child(div().font_semibold().text_size(15).child("Custom new tab command"))
      .child(field("Display name", this.nameInput))
      .child(field("Program", this.programInput))
      .child(field("Arguments (JSON array of strings)", this.argsInput))
      .child(div().text_size(11).text_color(t.dim).child("No shell expansion. For pipes or redirects, explicitly run a shell with its script argument."))
      .when(Boolean(this.error), el => el.child(div().text_size(11.5).text_color(t.blocked).child(this.error)))
      .child(h_flex().gap(8).justify_end().mt_auto()
        .child(Button.new("agent-command-cancel").px(12).h(30).accessibility_label("Cancel custom command").on_click(() => closeOverlay(this.overlay)).child("Cancel"))
        .child(Button.new("agent-command-save").px(12).h(30).accessibility_label("Save custom command").on_click((_e, cx) => { this.save(); cx.notify(); }).child("Save")));
  }

  render() {
    if (this.editing) return this.renderEditor();
    const t = theme(), choices = this.choices();
    const enabled = choices.filter(c => c.enabled);
    this.index = Math.min(this.index, Math.max(0, enabled.length - 1));
    const stop = (_e, cx) => cx.stop_propagation();
    return v_flex().id("agent-launch-menu").track_focus(this.handle).w_full().h(Math.min(491, 198 + Math.max(1, choices.length) * 31)).min_h(0).p(5).bg(t.popover).text_size(12.8).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.modifiers.control || e.modifiers.platform || e.modifiers.alt) return;
        if (e.key === "escape") closeOverlay(this.overlay);
        else if (e.key === "down") this.index = Math.min(this.index + 1, enabled.length - 1);
        else if (e.key === "up") this.index = Math.max(0, this.index - 1);
        else if (e.key === "enter" && enabled[this.index]) this.start(enabled[this.index].choice);
        else if (e.key === "d" && enabled[this.index]) this.setDefault(enabled[this.index].choice);
        else return;
        cx.stop_propagation(); cx.notify();
      })
      .child(this.row("agent-terminal", "Terminal", () => this.start(null), true, svg("mods/workspace-chrome/terminal.svg").size(14)))
      .child(div().px(9).pt(8).pb(4).text_size(11).text_color(t.dim).child("Start an agent"))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar()
        .when(this.loading, el => el.child(div().px(9).py(6).text_color(t.dim).child("Checking installed agents…")))
        .children(choices.map(({ choice, enabled: available }) => {
          const on = this.isDefault(choice), index = enabled.findIndex(c => c.choice.kind === choice.kind && c.choice.key === choice.key);
          return h_flex().id(`agent-${choice.kind}-${choice.key}`).h(31).mr(12).flex_none().items_center().rounded(6)
            .when(index === this.index, el => el.bg(t.selected))
            .child(Button.new(`agent-start-${choice.kind}-${choice.key}`).h_full().flex_1().min_w(0).px(9).gap(9).justify_start()
              .disabled(!available || (choice.kind === "agent" && this.loading)).accessibility_label(`Start ${choice.name} in a new tab`)
              .tooltip(available ? `Start ${choice.name} once` : "Not installed on this machine")
              .text_color(available ? t.foreground : t.dim).hover(s => s.bg(t.hover))
              .on_click((_e, cx) => { this.start(choice); cx.notify(); })
              .child(this.icon(choice)).child(div().flex_1().min_w(0).truncate().child(choice.name))
              .when(!available, el => el.child(div().text_size(10.5).child("not installed"))))
            .child(Button.new(`agent-default-${choice.kind}-${choice.key}`).w(28).h_full().flex_none().justify_center()
              .disabled(!available).accessibility_label(`Set ${choice.name} as default`)
              .tooltip(on ? "Default for this machine" : "Set as default without starting")
              .text_color(on ? t.accent : t.dim).hover(s => s.bg(t.raised)).on_mouse_down("left", stop)
              .on_click((_e, cx) => { cx.stop_propagation(); this.setDefault(choice); cx.notify(); }).child(on ? "★" : "☆"));
        }))
        .when(!this.loading && !choices.length && !this.error, el => el.child(div().px(9).py(6).text_color(t.dim).child("No agents found. Add a custom command below."))))
      .when(Boolean(this.error), el => el.child(div().px(9).py(4).text_size(11.5).text_color(t.blocked).child(this.error)))
      .child(this.row("agent-edit-custom", this.custom() ? "Edit custom command…" : "Custom command…", () => this.edit()))
      .child(div().h(1).mx(4).my(5).bg(t.border))
      .child(this.row("agent-new-space", "New space", () => { closeOverlay(this.overlay); run("space.new", { machine: this.target.machine ?? "" }); }, true, div().w(14).child("+")))
      .child(this.row("agent-new-worktree", "New worktree…", () => this.worktree("new"), Boolean(this.target.space), svg("mods/workspace-chrome/branch.svg").size(14)))
      .child(this.row("agent-open-worktree", "Open worktree…", () => this.worktree("open"), Boolean(this.target.space), svg("mods/workspace-chrome/branch.svg").size(14)));
  }
}

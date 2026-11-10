import { View } from "gpui-kit";
import { props, nextCommand, shared, setShared } from "herdr";
import Files from "./files.js";
import Changes from "./changes.js";

// Layout adapter: the native child controls keep the same mod key context.
export default class ProfessionalPanels extends View {
  init(p, cx) {
    this.child = props()?.child ?? "files";
    this.part = this.child === "changes" ? new Changes() : new Files();
    this.part.init(p, cx);
    this.handle = this.part.handle ?? cx.focus_handle();
    cx.spawn(async () => {
      for (;;) if (await nextCommand() === "focus") this.handle.focus();
    });
  }

  render(cx) {
    if (shared("professional-panels.focus") === this.child) {
      setShared("professional-panels.focus", null);
      // Shared writes synchronize the host layout and restore its previous focus first.
      cx.timer.after(0, () => this.handle.focus());
    }
    return this.part.render(cx).track_focus(this.handle);
  }
}

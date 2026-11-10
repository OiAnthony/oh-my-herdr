import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, settings, run } from "herdr";
import { openDiffTab } from "./diff.js";
import { showChanges, canShowChanges } from "./act.js";
import { icon } from "./menu.js";

function fileTree(files) {
  const root = { directories: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.split("/"), name = parts.pop();
    let node = root;
    for (const part of parts) {
      if (!node.directories.has(part)) node.directories.set(part, { directories: new Map(), files: [] });
      node = node.directories.get(part);
    }
    node.files.push({ name, file });
  }
  const entries = [];
  const visit = (node, depth, parent = "") => {
    for (const [name, child] of node.directories) {
      let label = name, directory = child, path = parent + name;
      while (directory.files.length === 0 && directory.directories.size === 1) {
        const [next, nested] = directory.directories.entries().next().value;
        label += ` / ${next}`; path += `/${next}`;
        directory = nested;
      }
      entries.push({ name: label, path, depth });
      visit(directory, depth + 1, `${path}/`);
    }
    for (const entry of node.files) entries.push({ ...entry, depth });
  };
  visit(root, 0);
  return entries;
}

function stamp(seconds) {
  const date = new Date(seconds * 1000), pad = value => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// A retained child owns interactive controls even when mounted by a deferred list row.
export class CommitDetails extends View {
  init(data) { this.update(data); }
  update(data) { this.data = data; }

  render() {
    const { commit, details: d, context, wide, collapseCommand } = this.data ?? {};
    if (!commit) return div();
    const t = theme(), mono = settings().font_family ?? "JetBrains Mono";
    const meta = (label, value, color = t.muted) => h_flex().gap(8).items_center().h(21).flex_none()
      .child(div().w(64).flex_none().text_color(t.dim).child(label))
      .child(div().flex_1().min_w(0).truncate().font_family(mono).text_color(color).tooltip(value).child(value));
    const metadata = v_flex().id(`graph-meta-${commit.hash}`).flex_1().min_w(0).min_h(0).p(12).gap(2).text_size(11.5).overflow_y_scrollbar();
    if (!commit.uncommitted) {
      metadata.child(meta("Commit", commit.hash, t.accent))
        .child(meta("Parents", commit.parents.join(", ") || "none", t.accent))
        .child(meta("Author", `${commit.author} <${commit.email}>`))
        .when(Boolean(d?.committer), el => el.child(meta("Committer", `${d.committer}${d.committerEmail ? ` <${d.committerEmail}>` : ""}`)))
        .child(meta("Date", stamp(commit.time)));
    }
    metadata.child(div().pt(commit.uncommitted ? 0 : 12).text_color(t.foreground).child(d?.message || commit.subject));
    const files = v_flex().flex_1().min_w(0).min_h(0)
      .when(wide, el => el.border_l(1).border_color(t.border))
      .when(!wide, el => el.border_t(1).border_color(t.border));
    const close = div().id("graph-details-close").size(24).flex_none().flex().items_center().justify_center().rounded(4)
      .role("button").accessibility_label("Collapse commit details").tooltip("Collapse commit details").cursor_pointer()
      .text_color(t.dim).hover(el => el.bg(t.hover).text_color(t.foreground))
      .on_click(() => run(collapseCommand)).child("×");
    const total = d && !d.error ? d.files.length + d.more : 0;
    const top = h_flex().h(32).flex_none().px(10).gap(8).items_center().text_size(11.5)
      .child(div().flex_1().text_color(t.muted).child(!d ? "Loading files…" : d.error ? "Changed files" : `${total} file${total === 1 ? "" : "s"}`))
      .when(Boolean(commit.uncommitted && canShowChanges(context)), el => el.child(div().id("graph-open-changes").px(6).py(2).rounded(4)
        .role("button").accessibility_label("Open Changes").text_color(t.accent).cursor_pointer().hover(button => button.bg(t.hover))
        .on_click(() => showChanges(context)).child("Open Changes")))
      .child(close);
    const tree = v_flex().id(`graph-files-${commit.hash}`).flex_1().min_h(0).px(8).pb(8).overflow_y_scrollbar().text_size(11.5);
    if (d?.error) tree.child(div().p(4).text_color(t.ansi1).child(d.error));
    else if (d) {
      const entries = fileTree(d.files);
      tree.when(entries.length === 0, el => el.child(div().p(4).text_color(t.dim).child("No changed files")))
        .children(entries.map((entry, i) => {
          if (!entry.file) return h_flex().h(23).flex_none().pl(4 + entry.depth * 14).gap(6).items_center().text_color(t.muted)
            .child(svg(icon("folder")).size(12).flex_none()).child(div().min_w(0).truncate().tooltip(entry.path).child(entry.name));
          const file = entry.file, statusColor = file.status === "A" || file.untracked ? t.ansi2 : file.status === "D" || file.status === "U" ? t.ansi1 : t.blocked;
          return h_flex().id(`gf-${i}`).h(24).flex_none().pl(4 + entry.depth * 14).pr(6).gap(7).items_center().rounded(4)
            .role("button").accessibility_label(`View diff: ${file.path}`).tooltip(file.path).cursor_pointer().hover(el => el.bg(t.hover))
            .on_click((event, cx) => { cx.stop_propagation(); openDiffTab(commit, file, context, event.click_count > 1); })
            .child(div().w(12).flex_none().text_size(10.5).text_color(statusColor).child(file.untracked ? "?" : file.status))
            .child(div().flex_1().min_w(0).truncate().text_color(t.accent).child(entry.name))
            .when(file.binary, el => el.child(div().text_color(t.dim).child("binary")))
            .when(file.add > 0, el => el.child(div().text_color(t.ansi2).child(`+${file.add}`)))
            .when(file.del > 0, el => el.child(div().text_color(t.ansi1).child(`−${file.del}`)));
        }))
        .when(d.more > 0, el => el.child(div().p(4).text_color(t.dim).child(`and ${d.more} more`)));
    }
    return (wide ? h_flex() : v_flex()).size_full().items_stretch().min_w(0).min_h(0).text_color(t.foreground)
      .children([metadata, files.child(top).child(tree)]);
  }
}

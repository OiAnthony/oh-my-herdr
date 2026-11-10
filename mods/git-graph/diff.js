import { div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, v_virtual_list } from "gpui-base";
import { run, props, exec, readTextFile, theme, settings, shared, setShared, spaces, panes, focused } from "herdr";
import { READ, diffArgs, diffRows } from "./git.js";
import { previewOpen } from "./preview.js";
import { diffTitle } from "./path.js";

const ROW = 20, CHAR_LIMIT = 400000, LINE_LIMIT = 3000;

// Each read request captures its repository and file before asynchronous work starts.
function pin(commit, file, { root, on, titleCwd }) {
  return Object.freeze({
    root, on: on ?? null, titleCwd: titleCwd ?? root,
    commit: Object.freeze({ hash: commit.hash, parents: Object.freeze([...(commit.parents ?? [])]), subject: commit.subject ?? "", uncommitted: Boolean(commit.uncommitted) }),
    file: Object.freeze({ path: file.path, status: file.status ?? "", binary: Boolean(file.binary), untracked: Boolean(file.untracked) }),
  });
}

export function openDiffTab(commit, file, ctx, keep = false) {
  const diff = pin(commit, file, ctx), space = focused()?.space;
  if (!space) throw new Error("Open a space before previewing a diff");
  const live = spaces().find(item => item.id === space)?.tabs.map(tab => tab.id) ?? [];
  const plan = previewOpen(readTabs(space), live, diff, keep, Math.random().toString(36).slice(2));
  setShared(tabKey(space), plan.entries);
  const name = tabName(plan.entry);
  if (plan.create) return run("tab.new", { space, name, mod: "git-graph", props: { role: "diff", slot: { space, token: plan.entry.token } } });
  if (plan.entry.tab) {
    run("tab.rename", { id: plan.entry.tab, name });
    run("tab.select", { id: plan.entry.tab });
  }
  return null;
}

const tabKey = space => `git-graph.diff-tabs.${space}`;
const readTabs = space => shared(tabKey(space)) ?? [];
const tabName = ({ diff, preview }) => `${preview ? "Preview · " : ""}${diff.file.path.split("/").pop()} · ${diff.commit.uncommitted ? "Working tree" : diff.commit.hash.slice(0, 8)}`;

async function readDiff({ root, on, commit, file }) {
  let text;
  if (commit.uncommitted && file.untracked) {
    text = await readTextFile(`${root}/${file.path}`, { on });
    if (text === null) return { state: "unreadable", message: "File is missing or unreadable." };
    if (text.includes("\0")) return { state: "binary", message: "Binary file — no text diff available." };
    if (!text.length) return { state: "empty", message: "Empty untracked file — no text changes." };
    const bounded = text.slice(0, CHAR_LIMIT).replace(/\n$/, "").split("\n");
    text = `@@ -0,0 +1,${bounded.length} @@\n${bounded.slice(0, LINE_LIMIT).map(line => `+${line}`).join("\n")}`;
  } else {
    const result = await exec("git", [...READ, "--literal-pathspecs", ...diffArgs(commit, file.path)], { cwd: root, on });
    if (result.code !== 0) throw new Error(result.stderr.trim() || `git exited with ${result.code}`);
    text = result.stdout;
    if (file.binary || /^(?:Binary files .* differ|GIT binary patch)$/m.test(text)) return { state: "binary", message: "Binary file changed — no text diff available." };
  }
  const parsed = diffRows(text);
  if (!parsed?.length) return { state: "empty", message: "No text changes (the file may have only metadata changes)." };
  const rows = parsed.map(row => ({ ...row, text: row.text.replace(/\t/g, "    ") }));
  const width = rows.reduce((width, row) => Math.max(width, Array.from(row.text).length * 12 + 90), 300);
  return { state: "ready", rows, width };
}

export class Diff {
  init(cx) {
    this.id = `git-diff-${Math.random().toString(36).slice(2)}`;
    this.slot = props()?.slot;
    this.request = null;
    this.generation = 0;
    this.sync(cx);
  }

  bindTab() {
    if (!this.slot) return;
    const { space, token } = this.slot, entries = readTabs(space);
    const entry = entries.find(item => item.token === token), focus = focused();
    if (!entry || entry.pane) return;
    const tab = entry.tab ?? (focus?.space === space ? focus.tab : null);
    const candidates = panes().filter(pane => pane.tab === tab && pane.mod === "git-graph");
    if (candidates.length !== 1) return;
    const bound = { ...entry, tab, pane: candidates[0].pane };
    setShared(tabKey(space), entries.map(item => item.token === token ? bound : item));
    run("tab.rename", { id: bound.tab, name: tabName(bound) });
  }

  sync(cx) {
    const entry = this.slot && readTabs(this.slot.space).find(item => item.token === this.slot.token);
    const source = this.slot ? entry?.diff : props()?.diff;
    const request = JSON.stringify(source);
    if (request === this.request) return;
    this.request = request;
    const generation = ++this.generation;
    this.state = "loading"; this.rows = []; this.width = 300;
    let diff;
    try {
      if (!source?.root || !source?.file?.path || !source?.commit?.hash) throw new Error("Missing repository, commit or file context");
      diff = pin(source.commit, source.file, source);
    } catch (e) {
      this.state = "error"; this.message = `Can't show this diff: ${e?.message ?? e}`;
      return;
    }
    cx.spawn(async cx => {
      const title = await diffTitle(diff, exec);
      if (generation !== this.generation) return;
      if (this.slot) {
        const { space, token } = this.slot, entries = readTabs(space);
        const entry = entries.find(entry => entry.token === token);
        if (entry && JSON.stringify(entry.diff) === request && entry.title !== title) {
          setShared(tabKey(space), entries.map(item => item.token === token ? { ...item, title } : item));
        }
      }
      cx.notify();
    });
    cx.spawn(async cx => {
      let result;
      try { result = await readDiff(diff); }
      catch (e) { result = { state: "error", message: `Can't show this diff: ${e?.message ?? e}` }; }
      if (generation !== this.generation) return;
      Object.assign(this, result);
      cx.notify();
    });
  }

  diffRow({ kind, number, text }, t) {
    if (kind === "@") return div().w_full().px(12).h(ROW).flex_none().truncate().bg(t.raised).text_color(t.dim).child(text);
    return h_flex().w_full().h(ROW).flex_none().gap(10)
      .when(kind === "+", (e) => e.bg(t.ansi2 + "18")).when(kind === "-", (e) => e.bg(t.ansi1 + "18"))
      .child(div().w(44).flex_none().text_right().text_color(t.dim).child(number === undefined ? "" : String(number)))
      .child(div().w(10).flex_none().text_color(kind === "+" ? t.ansi2 : kind === "-" ? t.ansi1 : t.dim).child(kind === "+" || kind === "-" ? kind : " "))
      .child(div().flex_1().min_w(0).truncate().child(text));
  }

  render(cx) {
    this.sync(cx);
    const t = theme(), mono = settings().font_family ?? "JetBrains Mono";
    const body = div().flex_1().min_h(0).min_w(0).relative().font_family(mono).text_size(11);
    if (this.state !== "ready") {
      body.child(div().p(16).text_color(this.state === "error" ? t.ansi1 : t.dim).child(this.state === "loading" ? "Loading diff…" : this.message));
    } else {
      body.child(div().id(`${this.id}-x`).size_full().overflow_x_scrollbar()
        .child(div().w_full().min_w(this.width).h_full()
          .child(v_virtual_list(this.id, this.rows.length, ROW, (i) => String(i),
            (range) => this.rows.slice(range.start, range.end).map((row) => this.diffRow(row, t))).size_full())))
        .child(Scrollbar.vertical(this.id).viewport_from_layout().absolute().inset_0());
    }
    return v_flex().id(`${this.id}-view`).on_size_change(() => this.bindTab()).size_full().min_h(0).min_w(0).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(12.5)
      .role("group").accessibility_label("Diff preview")
      .child(body);
  }
}

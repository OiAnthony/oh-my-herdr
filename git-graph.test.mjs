import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { diffPath, diffTitle } from "./mods/git-graph/path.js";
import { inlineHistory } from "./mods/git-graph/history.js";
import { previewOpen } from "./mods/git-graph/preview.js";
import { submoduleWorkspace } from "./mods/git-graph/repos.js";

const commits = [{ hash: "tip" }, { hash: "merge" }, { hash: "root" }];
const keys = history => Array.from({ length: history.count }, (_, i) => history.key(i));

test("expansion inserts details after its commit without stealing the next commit or pagination row", () => {
  const history = inlineHistory(commits, 1, true, 24, 272);
  assert.deepEqual(keys(history), ["tip", "merge", "details:merge", "root", "more"]);
  assert.deepEqual(history.sizes, [24, 24, 272, 24, 24]);
  assert.equal(history.commitIndex(2), -1);
  assert.equal(history.commitIndex(3), 2);
  assert.equal(history.commitIndex(4), commits.length);
});

test("the final commit expands before pagination and collapse removes only its details", () => {
  const expanded = inlineHistory(commits, 2, true, 24, 272);
  assert.deepEqual(keys(expanded), ["tip", "merge", "root", "details:root", "more"]);
  const collapsed = inlineHistory(commits, undefined, true, 24, 272);
  assert.deepEqual(keys(collapsed), ["tip", "merge", "root", "more"]);
  assert.equal(collapsed.sizes, 24);
});

test("switching expansion retains stable commit identities and removes the previous detail item", () => {
  const first = inlineHistory(commits, 0, false, 24, 272);
  const next = inlineHistory(commits, 1, false, 24, 400);
  assert.deepEqual(keys(first), ["tip", "details:tip", "merge", "root"]);
  assert.deepEqual(keys(next), ["tip", "merge", "details:merge", "root"]);
  assert.equal(next.sizes[next.detailAt], 400);
  assert.equal(inlineHistory([], undefined, false, 24, 272).count, 0);
});

const diff = (path, root = "/repo", on = null, hash = "tip") => ({ root, on, commit: { hash }, file: { path } });

test("a second single click replaces the file in the same preview tab", () => {
  const first = previewOpen([], [], diff("a.js"), false, "first");
  const bound = [{ ...first.entry, tab: "preview-tab", pane: "preview-pane", title: "old/a.js" }];
  const next = previewOpen(bound, ["preview-tab"], diff("b.js"), false, "unused");
  assert.equal(next.create, false);
  assert.equal(next.entries.length, 1);
  assert.equal(next.entry.tab, "preview-tab");
  assert.equal(next.entry.token, "first");
  assert.equal(next.entry.pane, "preview-pane");
  assert.equal(next.entry.title, undefined);
  assert.equal(next.entry.diff.file.path, "b.js");
  assert.equal(bound[0].diff.file.path, "a.js");
});

test("double click promotes a pending preview without creating a second tab", () => {
  const first = previewOpen([], [], diff("a.js"), false, "first");
  const kept = previewOpen(first.entries, [], diff("a.js"), true, "unused");
  assert.equal(kept.create, false);
  assert.equal(kept.entry.token, "first");
  assert.equal(kept.entry.preview, false);
  assert.equal(kept.entries.length, 1);
});

test("pinned files survive later previews and reopening them selects their existing tab", () => {
  const pinned = { token: "kept", tab: "kept-tab", diff: diff("a.js"), preview: false };
  const next = previewOpen([pinned], ["kept-tab"], diff("b.js"), false, "preview");
  assert.equal(next.create, true);
  assert.equal(next.entry.preview, true);
  const bound = next.entries.map(entry => entry.token === "preview" ? { ...entry, tab: "preview-tab" } : entry);
  const reopened = previewOpen(bound, ["kept-tab", "preview-tab"], diff("a.js"), false, "unused");
  assert.equal(reopened.create, false);
  assert.equal(reopened.entry.tab, "kept-tab");
  assert.equal(reopened.entry.preview, false);
  assert.equal(reopened.entries.find(entry => entry.token === "preview").diff.file.path, "b.js");
  assert.equal(pinned.diff.file.path, "a.js");
});

test("closing a preview allows a fresh tab instead of selecting its stale id", () => {
  const closed = { token: "old", tab: "closed-tab", diff: diff("a.js"), preview: true };
  const next = previewOpen([closed], [], diff("b.js"), false, "new");
  assert.equal(next.create, true);
  assert.equal(next.entry.token, "new");
  assert.deepEqual(next.entries.map(entry => entry.token), ["new"]);
});

test("the same path in a different repository, machine or commit is not a pinned-file match", () => {
  const pinned = { token: "kept", tab: "kept-tab", diff: diff("a.js"), preview: false };
  for (const target of [diff("a.js", "/other"), diff("a.js", "/repo", "remote"), diff("a.js", "/repo", null, "parent")]) {
    const next = previewOpen([pinned], ["kept-tab"], target, false, "new");
    assert.equal(next.create, true);
    assert.equal(next.entry.preview, true);
    assert.equal(next.entries[0], pinned);
  }
});

test("titles distinguish submodule files from the workspace and direct repository contexts", async t => {
  const dir = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "graph-title-")));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const git = async (cwd, ...args) => promisify(execFile)("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args], { cwd });
  const source = join(dir, "source"), workspace = join(dir, "workspace");
  await fs.mkdir(join(source, "src"), { recursive: true });
  await fs.mkdir(join(workspace, "tools"), { recursive: true });
  await git(source, "init", "-q");
  await fs.writeFile(join(source, "src/index.ts"), "export const value = 1;\n");
  await git(source, "add", ".");
  await git(source, "commit", "-qm", "fixture");
  await git(workspace, "init", "-q");
  await git(workspace, "-c", "protocol.file.allow=always", "submodule", "add", "--quiet", source, "libs/client");
  const root = join(workspace, "libs/client");
  const execute = async (command, args, { cwd }) => {
    try { return { code: 0, ...(await promisify(execFile)(command, args, { cwd })) }; }
    catch (e) { if (typeof e.code !== "number") throw e; return { code: e.code, stdout: e.stdout, stderr: e.stderr }; }
  };
  const target = { ...diff("src/index.ts", root), titleCwd: workspace };
  assert.equal(await diffTitle(target, execute), "libs/client/src/index.ts");
  assert.equal(await diffTitle({ ...target, titleCwd: join(workspace, "tools") }, execute), "libs/client/src/index.ts");
  assert.equal(await diffTitle({ ...target, titleCwd: join(root, "src") }, execute), "src/index.ts");
  assert.equal(await diffTitle({ ...target, titleCwd: dir }, execute), "workspace/libs/client/src/index.ts");
  assert.equal(await diffTitle({ ...target, titleCwd: source }, execute), "src/index.ts");
});

test("title paths respect directory boundaries and preserve POSIX filename backslashes", () => {
  assert.equal(diffPath(diff("src/a\\b.ts", "/workspace/libs/client"), "/workspace/"), "libs/client/src/a\\b.ts");
  assert.equal(diffPath(diff("src/index.ts", "/workspace-other/client"), "/workspace"), "src/index.ts");
  assert.equal(diffPath(diff("src/index.ts", "C:\\Workspace\\libs\\client"), "c:\\workspace\\"), "libs/client/src/index.ts");
  assert.equal(diffPath(diff("src/index.ts", "D:\\Workspace\\client"), "C:\\Workspace"), "src/index.ts");
  assert.equal(diffPath(diff("src/index.ts", "\\\\server\\share\\workspace\\client"), "\\\\server\\share\\workspace"), "client/src/index.ts");
});

test("workspace discovery includes root and initialized nested submodules, not missing checkouts", async t => {
  const dir = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "graph-workspace-")));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const git = async (cwd, ...args) => promisify(execFile)("git", ["-c", "protocol.file.allow=always", "-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args], { cwd });
  const source = join(dir, "source"), parent = join(dir, "parent"), workspace = join(dir, "workspace");
  for (const root of [source, parent, workspace]) {
    await fs.mkdir(root);
    await git(root, "init", "-q");
    await fs.writeFile(join(root, "file.txt"), root);
    await git(root, "add", ".");
    await git(root, "commit", "-qm", "initial");
  }
  await git(parent, "submodule", "add", "--quiet", source, "nested/client");
  await git(parent, "commit", "-qam", "nested submodule");
  for (const path of ["libs/client", "other/client", "not initialized"]) {
    await git(workspace, "submodule", "add", "--quiet", path === "libs/client" ? parent : source, path);
  }
  await git(workspace, "commit", "-qam", "submodules");
  await git(workspace, "submodule", "update", "--init", "--recursive");
  await git(workspace, "submodule", "deinit", "-f", "--", "not initialized");
  const execute = async (command, args, { cwd }) => ({ code: 0, ...(await promisify(execFile)(command, args, { cwd })) });
  const result = await submoduleWorkspace(workspace, null, execute);
  assert.deepEqual(result.repos.map(repo => [repo.path, repo.name]), [
    [workspace, "workspace (root)"],
    [join(workspace, "libs/client"), "libs/client"],
    [join(workspace, "libs/client/nested/client"), "libs/client/nested/client"],
    [join(workspace, "other/client"), "other/client"],
  ]);
  assert.equal(await submoduleWorkspace(source, null, execute), null);
});

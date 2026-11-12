import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../", import.meta.url));
const { version } = JSON.parse(await fs.readFile(join(source, "oh-my-herdr.json")));
const name = `oh-my-herdr-${version}-darwin-${process.arch}`;
const zip = join(source, "dist", `${name}.zip`);
const supported = process.platform === "darwin" && ["arm64", "x64"].includes(process.arch);

async function put(root, path, bytes, mode) {
  await fs.mkdir(dirname(join(root, path)), { recursive: true });
  await fs.writeFile(join(root, path), bytes, { mode });
}
async function snapshot(root) {
  const result = {};
  async function visit(path, prefix = "") {
    for (const entry of await fs.readdir(path, { withFileTypes: true })) {
      const relative = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await visit(join(path, entry.name), `${relative}/`);
      else if (entry.isSymbolicLink()) result[relative] = `link:${await fs.readlink(join(path, entry.name))}`;
      else result[relative] = createHash("sha256").update(await fs.readFile(join(path, entry.name))).digest("hex");
    }
  }
  await visit(root);
  return result;
}

test("final ZIP consumes only private Node, refuses damage before writes, and preserves ownership on update/uninstall", { skip: !supported }, async t => {
  // Build first: this test intentionally fails rather than silently skipping a missing ZIP.
  await fs.access(zip);
  const temp = await fs.mkdtemp(join(await fs.realpath(tmpdir()), "oh-my-herdr 发布包 中文 "));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  execFileSync("/usr/bin/unzip", ["-q", zip, "-d", temp]);
  const root = join(temp, name), home = join(temp, "目标 home 中文"), bin = join(temp, "tools");
  await fs.mkdir(home);
  await fs.mkdir(bin);
  await fs.symlink("/usr/bin/dirname", join(bin, "dirname"));
  const sentinel = join(temp, "forbidden-tools");
  for (const tool of ["node", "cargo", "rustc", "git", "curl", "wget", "cc", "clang", "xcodebuild", "sudo"]) {
    await put(bin, tool, '#!/bin/bash\nprintf "%s\\n" "$0" >> "$FORBIDDEN_TOOLS"\nexit 99\n', 0o755);
  }
  // Host CLI is a boundary stub here. Real eight-Mod loading is a separate local smoke check.
  await put(bin, "herdr-app", '#!/bin/bash\nif [ "$1" = --version ]; then echo "herdr-app 0.1.15"; fi\nexit 0\n', 0o755);
  const env = { ...process.env, PATH: bin, FORBIDDEN_TOOLS: sentinel, HERDR_APP_HOME: home };
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  const run = (...args) => spawnSync("/bin/bash", [join(root, "install.sh"), ...args], { env, encoding: "utf8", timeout: 90_000 });
  const output = result => `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const succeeds = result => assert.equal(result.status, 0, output(result));
  const refuses = async (args, pattern) => {
    const before = await snapshot(home), result = run(...args);
    assert.notEqual(result.status, 0, output(result));
    assert.match(output(result), pattern);
    assert.deepEqual(await snapshot(home), before);
  };
  const keys = { global: { "cmd-w": "tab.close", "cmd-shift-w": "pane.close", "cmd-t": "tab.new", "cmd-shift-p": "command.palette" } };
  await t.test("uninitialized home and missing Herdr fail without creating configuration", async () => {
    await refuses([], /not initialized/);
    await fs.rename(join(bin, "herdr-app"), join(bin, "host-disabled"));
    try { await refuses([], /herdr-app is required/); }
    finally { await fs.rename(join(bin, "host-disabled"), join(bin, "herdr-app")); }
  });
  await put(home, "keys.json", JSON.stringify(keys));
  const builtinFiles = {
    "workspace-chrome": ["main.js", "terminal.svg", "branch.svg", "check.svg", "spinner.svg", "chevron-down.svg", "chevron-right.svg", "pin.svg", "pin-off.svg"],
    spaces: ["main.js"], pane: ["close.svg"],
    files: ["file.svg", "folder.svg", "chevron-down.svg", "chevron-right.svg"],
    changes: ["changes.svg"], tabs: ["win-min.svg", "win-max.svg", "win-restore.svg", "win-close.svg"],
  };
  const builtins = {};
  for (const [mod, paths] of Object.entries(builtinFiles)) {
    builtins[mod] = {};
    for (const path of paths) {
      builtins[mod][path] = "fixture";
      await put(home, `mods/${mod}/${path}`, path.endsWith(".svg") ? "<svg></svg>" : "export default {};\n");
    }
  }
  await put(home, "installed.json", JSON.stringify(builtins));
  for (const [path, content] of Object.entries({
    "mods/open-with/apps.json": '[{"id":"personal"}]', "mods/open-with/hosts.json": '{"remote":"SSH-Alias"}',
    "settings.json": '{"theme":"personal"}', "shared.json": '{"layout":"main"}', "layouts/.state/oh-my-herdr.json": '{"custom":true}',
  })) await put(home, path, content);
  const original = await snapshot(home);
  const metadataPath = join(root, "release.json");
  const metadata = await fs.readFile(metadataPath);
  const damage = async (path, replacement, pattern, rehash = false) => {
    const originalBytes = await fs.readFile(join(root, path));
    const mode = (await fs.stat(join(root, path))).mode & 0o777;
    try {
      if (replacement === null) await fs.unlink(join(root, path));
      else await fs.writeFile(join(root, path), replacement);
      if (rehash) {
        const release = JSON.parse(metadata);
        release.files[path] = createHash("sha256").update(replacement).digest("hex");
        await fs.writeFile(metadataPath, JSON.stringify(release));
      }
      await refuses([], pattern);
    } finally {
      await fs.writeFile(join(root, path), originalBytes, { mode });
      await fs.chmod(join(root, path), mode);
      await fs.writeFile(metadataPath, metadata);
    }
  };
  await t.test("missing private runtime never falls back to a global Node", () => damage("runtime/node", null, /private runtime\/node/));
  await t.test("wrong package architecture is rejected before Node starts", () => damage("release-target", `darwin-${process.arch === "arm64" ? "x64" : "arm64"}\n`, /architecture mismatch/));
  await t.test("missing package metadata cannot turn a ZIP into a source install", () => damage("release.json", null, /incomplete release package/i));
  await t.test("missing helper stops before configuration writes", () => damage("mods/resource-monitor/bin/herdr-resource-sample", null, /herdr-resource-sample/));
  await t.test("damaged helper is rejected by the package checksum", () => damage("mods/resource-monitor/bin/herdr-resource-sample", "not an executable", /checksum mismatch/));
  await t.test("wrong helper architecture is rejected even with a matching inventory hash", async () => {
    const bytes = await fs.readFile(join(root, "mods/resource-monitor/bin/herdr-resource-sample"));
    bytes.writeUInt32LE(process.arch === "arm64" ? 0x01000007 : 0x0100000c, 4);
    await damage("mods/resource-monitor/bin/herdr-resource-sample", bytes, /helper architecture mismatch/, true);
  });
  await t.test("missing icon exporter cannot produce a partial installation", () => damage("scripts/export-app-icons.jxa", null, /export-app-icons/));
  await t.test("dry run validates without changing the home", async () => {
    succeeds(run("--dry-run"));
    assert.deepEqual(await snapshot(home), original);
  });
  await t.test("missing builtin resources fail before installing any suite files", async () => {
    const path = join(home, "mods/pane/close.svg");
    await fs.rename(path, `${path}.saved`);
    try { await refuses([], /Missing static resource/); }
    finally { await fs.rename(`${path}.saved`, path); }
  });
  await t.test("personal shortcut conflicts fail before changing files", async () => {
    await put(home, "keys.json", JSON.stringify({ global: { "cmd-w": "personal.action" } }));
    try { await refuses([], /Unowned keybinding conflict/); }
    finally { await put(home, "keys.json", JSON.stringify(keys)); }
  });
  await t.test("symlinked Mod directories are never followed", async () => {
    const path = join(home, "mods/open-with"), saved = join(temp, "saved-personal-config");
    await fs.rename(path, saved);
    await fs.symlink(saved, path);
    const before = await snapshot(saved);
    try {
      await refuses([], /Symlink refused/);
      assert.deepEqual(await snapshot(saved), before);
    } finally {
      await fs.unlink(path);
      await fs.rename(saved, path);
    }
  });
  await t.test("unowned conflicts are preserved", async () => {
    await put(home, "mods/open-with/main.js", "personal mod");
    await refuses([], /Unowned file conflict/);
    await fs.unlink(join(home, "mods/open-with/main.js"));
  });
  await t.test("install and re-extracted ZIP update work without developer tools or system Node", async () => {
    const wrongHome = join(temp, "must-not-use-env-home");
    succeeds(spawnSync("/bin/bash", [join(root, "install.sh"), home], { env: { ...env, HERDR_APP_HOME: wrongHome }, encoding: "utf8", timeout: 90_000 }));
    await assert.rejects(fs.access(wrongHome), { code: "ENOENT" });
    const record = JSON.parse(await fs.readFile(join(home, ".oh-my-herdr/installed.json")));
    assert.equal(record.version, version);
    const installedKeys = JSON.parse(await fs.readFile(join(home, "keys.json")));
    assert.equal(installedKeys.global["cmd-w"], "pane.close");
    assert.equal(installedKeys.global["cmd-t"], "tab.new");
    assert.equal((await fs.readFile(join(home, "shared.json"), "utf8")), '{"layout":"main"}');
    // Updating means running a freshly extracted bundle, not a second ownership system.
    await fs.rm(root, { recursive: true });
    execFileSync("/usr/bin/unzip", ["-q", zip, "-d", temp]);
    succeeds(run());
    assert.deepEqual(JSON.parse(await fs.readFile(join(home, ".oh-my-herdr/installed.json"))), record);
  });
  await t.test("local edits block update and uninstall without replacing personal files", async () => {
    const path = join(home, "mods/open-with/main.js"), bytes = await fs.readFile(path);
    await fs.writeFile(path, "personal edit");
    try {
      await refuses([], /Owned file edited or deleted/);
      await refuses(["--uninstall"], /Owned file edited or deleted/);
    } finally { await fs.writeFile(path, bytes); }
  });
  await t.test("uninstall needs no system Node or Herdr executable and restores shortcuts", async () => {
    const cachedBefore = Object.fromEntries(Object.entries(await snapshot(home)).filter(([path]) => path.startsWith("data/")));
    await fs.unlink(join(bin, "herdr-app"));
    succeeds(run("--uninstall"));
    const restored = JSON.parse(await fs.readFile(join(home, "keys.json")));
    assert.deepEqual(Object.fromEntries(Object.entries(restored).filter(([, bindings]) => Object.keys(bindings).length)), keys);
    const after = await snapshot(home);
    const { "keys.json": ignoredBefore, ...beforeFiles } = original;
    const afterFiles = Object.fromEntries(Object.entries(after).filter(([path]) => path !== "keys.json" && !path.startsWith("data/")));
    assert.deepEqual(Object.fromEntries(Object.entries(after).filter(([path]) => path.startsWith("data/"))), cachedBefore);
    assert.deepEqual(afterFiles, beforeFiles);
    await assert.rejects(fs.access(sentinel), { code: "ENOENT" });
  });
});

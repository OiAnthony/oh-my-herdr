import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { check, install, loadBundle, resolveHome, uninstall } from "./oh-my-herdr.mjs";

const names = ["open-with", "professional-status", "git-graph"];
const recordPath = ".oh-my-herdr/installed.json";
async function put(root, path, text) {
  await fs.mkdir(dirname(join(root, path)), { recursive: true });
  await fs.writeFile(join(root, path), text);
}
async function fixture(t) {
  // realpath avoids macOS's system /var -> /private/var alias, not a tested user link.
  const root = await fs.mkdtemp(join(await fs.realpath(tmpdir()), "oh-my-herdr-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourceRoot = join(root, "source"), home = join(root, "home");
  await fs.mkdir(home);
  const manifest = { name: "oh-my-herdr", version: "0.3.0", herdrVersion: "0.1.14",
    mods: names.map(name => ({ name, source: `mods/${name}` })),
    layouts: [{ name: "Professional", source: "layouts/professional/Professional.json", preview: "layouts/professional/Professional.svg" }] };
  await put(sourceRoot, "oh-my-herdr.json", JSON.stringify(manifest));
  for (const name of names) await put(sourceRoot, `mods/${name}/main.js`, `export default ${JSON.stringify(name)};\n`);
  await put(sourceRoot, "mods/open-with/icons/application.svg", "<svg></svg>");
  await put(sourceRoot, "mods/open-with/main.js", 'const icon = "mods/open-with/icons/application.svg";\n');
  await put(sourceRoot, "layouts/professional/Professional.json", JSON.stringify({ type: "block", preview: "layouts/Professional.svg", content: { mod: "open-with" } }));
  await put(sourceRoot, "layouts/professional/Professional.svg", "<svg></svg>");
  return { root, sourceRoot, home, options: { sourceRoot } };
}
async function snapshot(root) {
  const result = {};
  async function walk(path, prefix = "") {
    for (const name of (await fs.readdir(path)).sort()) {
      const relative = prefix ? `${prefix}/${name}` : name;
      const info = await fs.lstat(join(path, name));
      if (info.isDirectory()) { result[`${relative}/`] = "directory"; await walk(join(path, name), relative); }
      else if (info.isSymbolicLink()) result[relative] = `symlink:${await fs.readlink(join(path, name))}`;
      else result[relative] = (await fs.readFile(join(path, name))).toString("hex");
    }
  }
  await walk(root);
  return result;
}
async function missing(path) { await assert.rejects(fs.stat(path), { code: "ENOENT" }); }

test("home precedence and explicit empty environment object", () => {
  assert.equal(resolveHome("/explicit", { HERDR_APP_HOME: "/environment", XDG_CONFIG_HOME: "/xdg" }, "/user"), "/explicit");
  assert.equal(resolveHome(undefined, { HERDR_APP_HOME: "/environment", XDG_CONFIG_HOME: "/xdg" }, "/user"), "/environment");
  assert.equal(resolveHome(undefined, { XDG_CONFIG_HOME: "/xdg" }, "/user"), "/xdg/herdr-app");
  assert.equal(resolveHome(undefined, {}, "/user"), "/user/.config/herdr-app");
});

test("first deploy excludes generated/private files and preserves every unowned file", async t => {
  const { sourceRoot, home, options } = await fixture(t);
  for (const name of ["apps.json", "hosts.json", "herdr.d.ts", "jsconfig.json", "main.error", ".hidden"]) {
    await put(sourceRoot, `mods/open-with/${name}`, "must not deploy");
    await put(home, `mods/open-with/${name}`, "personal");
  }
  const personal = ["settings.json", "shared.json", "installed.json", "layouts/.state/Professional.json", "mods/open-with/icons/custom.svg", "mods/unrelated/main.js"];
  for (const path of personal) await put(home, path, "personal");
  await install(home, options);
  for (const path of personal) assert.equal(await fs.readFile(join(home, path), "utf8"), "personal");
  const record = JSON.parse(await fs.readFile(join(home, recordPath), "utf8"));
  assert.equal(record.name, "oh-my-herdr");
  for (const name of ["apps.json", "hosts.json", "herdr.d.ts", "jsconfig.json", "main.error", ".hidden"]) {
    assert.equal(await fs.readFile(join(home, `mods/open-with/${name}`), "utf8"), "personal");
    assert.equal(record.files[`mods/open-with/${name}`], undefined);
  }
  const before = await snapshot(home);
  await install(home, options);
  assert.deepEqual(await snapshot(home), before);
});

test("adopts byte-identical files without replacing them", async t => {
  const { sourceRoot, home, options } = await fixture(t);
  const bundle = await loadBundle(sourceRoot);
  for (const [path, file] of bundle.files) await put(home, path, file.bytes);
  const entry = join(home, "mods/open-with/main.js");
  const before = await fs.stat(entry);
  await install(home, options);
  const after = await fs.stat(entry);
  assert.equal(after.ino, before.ino);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.ok(JSON.parse(await fs.readFile(join(home, recordPath))).files["mods/open-with/main.js"]);
});

test("updates unchanged ownership and removes only obsolete owned files", async t => {
  const { sourceRoot, home, options } = await fixture(t);
  await put(sourceRoot, "mods/open-with/obsolete.svg", "old asset");
  await install(home, options);
  await put(home, "mods/open-with/icons/personal.svg", "custom icon");
  await fs.unlink(join(sourceRoot, "mods/open-with/obsolete.svg"));
  await put(sourceRoot, "mods/open-with/main.js", "new implementation\n");
  await install(home, options);
  assert.equal(await fs.readFile(join(home, "mods/open-with/main.js"), "utf8"), "new implementation\n");
  await missing(join(home, "mods/open-with/obsolete.svg"));
  assert.equal(await fs.readFile(join(home, "mods/open-with/icons/personal.svg"), "utf8"), "custom icon");
});

test("all conflicts are preflighted before any destination mutation", async t => {
  const { home, options } = await fixture(t);
  await put(home, "layouts/Professional.svg", "late conflict");
  const before = await snapshot(home);
  await assert.rejects(install(home, options), /Unowned file conflict/);
  assert.deepEqual(await snapshot(home), before);
  await missing(join(home, ".oh-my-herdr"));
});

for (const operation of ["edited", "deleted"]) {
  test(`${operation} owned files stop install and uninstall without any mutation`, async t => {
    const { sourceRoot, home, options } = await fixture(t);
    await install(home, options);
    const path = "mods/git-graph/main.js";
    if (operation === "edited") await put(home, path, "local edit");
    else await fs.unlink(join(home, path));
    await put(sourceRoot, "mods/open-with/main.js", "upstream update");
    const before = await snapshot(home);
    await assert.rejects(install(home, options), /Owned file edited or deleted/);
    assert.deepEqual(await snapshot(home), before);
    await assert.rejects(uninstall(home), /Owned file edited or deleted/);
    assert.deepEqual(await snapshot(home), before);
  });
}

test("uninstall removes only unchanged owned files and its record", async t => {
  const { home, options } = await fixture(t);
  await install(home, options);
  const personal = ["mods/open-with/apps.json", "mods/open-with/hosts.json", "mods/open-with/icons/custom.svg", "mods/open-with/gpui-kit.d.ts", "mods/open-with/.error", "shared.json", "installed.json", "layouts/.state/Professional.json"];
  for (const path of personal) await put(home, path, "keep");
  await uninstall(home);
  for (const path of personal) assert.equal(await fs.readFile(join(home, path), "utf8"), "keep");
  await missing(join(home, recordPath));
  await missing(join(home, "mods/open-with/main.js"));
  const before = await snapshot(home);
  await uninstall(home);
  assert.deepEqual(await snapshot(home), before);
});

for (const target of ["source-root", "source-file", "destination-parent", "destination-file", "record-parent", "record-file"]) {
  test(`rejects ${target} symlink without following it`, async t => {
    const { root, sourceRoot, home, options } = await fixture(t);
    const outside = join(root, "outside");
    await fs.mkdir(outside);
    await put(outside, "sentinel", "untouched");
    if (target === "source-root") {
      await fs.symlink(sourceRoot, join(root, "linked-source"));
      options.sourceRoot = join(root, "linked-source");
    } else if (target === "source-file") {
      await fs.unlink(join(sourceRoot, "mods/open-with/main.js"));
      await fs.symlink(join(outside, "sentinel"), join(sourceRoot, "mods/open-with/main.js"));
    } else if (target === "destination-parent") await fs.symlink(outside, join(home, "mods"));
    else if (target === "destination-file") {
      await fs.mkdir(join(home, "mods/open-with"), { recursive: true });
      await fs.symlink(join(outside, "sentinel"), join(home, "mods/open-with/main.js"));
    } else if (target === "record-parent") await fs.symlink(outside, join(home, ".oh-my-herdr"));
    else {
      await fs.mkdir(join(home, ".oh-my-herdr"));
      await fs.symlink(join(outside, "sentinel"), join(home, recordPath));
    }
    const before = await snapshot(home), outsideBefore = await snapshot(outside);
    await assert.rejects(install(home, options), /Symlink refused/);
    assert.deepEqual(await snapshot(home), before);
    assert.deepEqual(await snapshot(outside), outsideBefore);
  });
}

for (const path of ["../escape", "settings.json", "mods/unrelated/main.js", "mods/open-with/apps.json", "mods/open-with/.state/file", "layouts/Other.json"]) {
  test(`rejects ownership record boundary escape ${path}`, async t => {
    const { home, options } = await fixture(t);
    await put(home, recordPath, JSON.stringify({ name: "oh-my-herdr", schemaVersion: 1, version: "0.1.0", files: { [path]: "0".repeat(64) } }));
    const before = await snapshot(home);
    await assert.rejects(install(home, options), /Unsafe relative path|Ownership outside suite/);
    await assert.rejects(uninstall(home), /Unsafe relative path|Ownership outside suite/);
    assert.deepEqual(await snapshot(home), before);
  });
}

test("rejects manifest source escape before creating the selected home", async t => {
  const { root, sourceRoot } = await fixture(t);
  const manifest = JSON.parse(await fs.readFile(join(sourceRoot, "oh-my-herdr.json")));
  manifest.mods[0].source = "../../outside";
  await put(sourceRoot, "oh-my-herdr.json", JSON.stringify(manifest));
  const home = join(root, "not-created");
  await assert.rejects(install(home, { sourceRoot }), /Invalid manifest mod/);
  await missing(home);
});

for (const operation of ["first-install", "update", "uninstall"]) {
  test(`rolls back ${operation} writes when committing the record fails`, async t => {
    const { sourceRoot, home, options } = await fixture(t);
    if (operation !== "first-install") await install(home, options);
    if (operation === "update") {
      await put(sourceRoot, "mods/open-with/main.js", "changed\n");
      await put(sourceRoot, "mods/open-with/new.svg", "<svg></svg>");
    }
    await put(home, "mods/open-with/icons/personal.svg", "keep");
    const before = await snapshot(home);
    let writes = 0;
    const beforeCommit = ({ path }) => {
      if (path === recordPath) throw new Error("injected record failure");
      writes++;
    };
    await assert.rejects(operation === "uninstall" ? uninstall(home, { beforeCommit }) : install(home, { ...options, beforeCommit }), /injected record failure/);
    assert.ok(writes > 0);
    assert.deepEqual(await snapshot(home), before);
  });
}

test("check reports every failing mod instead of stopping after the first", async t => {
  const { home, options } = await fixture(t);
  await install(home, options);
  await assert.rejects(check(home, { ...options, runCheck: async (_binary, args) => {
    throw new Error(`Cannot load ${args[1]}`);
  } }), error => error instanceof AggregateError
    && names.every(name => error.errors.some(failure => failure.message.includes(`check failed: ${name}:`))));
});

test("check permits installed builtin references but rejects missing resources and unknown mods", async t => {
  const { sourceRoot, home, options } = await fixture(t);
  await put(sourceRoot, "mods/open-with/main.js", 'const icon = "mods/pane/close.svg";');
  await put(sourceRoot, "layouts/professional/Professional.json", JSON.stringify({ preview: "layouts/Professional.svg", content: { mod: "pane" } }));
  await put(home, "installed.json", JSON.stringify({ pane: { "main.js": "builtin", "close.svg": "builtin" } }));
  await put(home, "mods/pane/main.js", "builtin");
  await put(home, "mods/pane/close.svg", "<svg></svg>");
  await install(home, options);
  const runCheck = async () => ({});
  await check(home, { ...options, runCheck });
  await fs.unlink(join(home, "mods/pane/close.svg"));
  await assert.rejects(check(home, { ...options, runCheck }), /Missing static resource/);
  await put(home, "mods/pane/close.svg", "<svg></svg>");
  await put(home, "installed.json", "{}");
  await assert.rejects(check(home, { ...options, runCheck }), /Unknown layout mod/);
});

test("check validates literal relative imports and finite template asset choices", async t => {
  const { sourceRoot, home, options } = await fixture(t);
  await put(sourceRoot, "mods/open-with/main.js", 'import { value } from "./helper.js";\nconst icon = `mods/open-with/icons/${value ? "first" : "second"}.svg`;');
  await put(sourceRoot, "mods/open-with/helper.js", "export const value = true;\n");
  await put(sourceRoot, "mods/open-with/icons/first.svg", "<svg></svg>");
  await put(sourceRoot, "mods/open-with/icons/second.svg", "<svg></svg>");
  await install(home, options);
  const runCheck = async () => ({});
  await check(home, { ...options, runCheck });
  await fs.unlink(join(sourceRoot, "mods/open-with/helper.js"));
  await install(home, options);
  await assert.rejects(check(home, { ...options, runCheck }), /Missing or external relative import/);
  await put(sourceRoot, "mods/open-with/helper.js", "export const value = true;\n");
  await fs.unlink(join(sourceRoot, "mods/open-with/icons/second.svg"));
  await install(home, options);
  await assert.rejects(check(home, { ...options, runCheck }), /Resource outside suite\/builtins/);
});

test("check refuses a layout preview that does not match its suite destination", async t => {
  const { sourceRoot, home, options } = await fixture(t);
  await put(sourceRoot, "layouts/professional/Professional.json", JSON.stringify({ preview: "layouts/Other.svg", content: { mod: "open-with" } }));
  await install(home, options);
  await assert.rejects(check(home, { ...options, runCheck: async () => ({}) }), /Invalid layout preview/);
});

async function addHistoricalMod(home, name = "git-graph-main") {
  const path = `mods/${name}/main.js`, bytes = "historical implementation\n";
  await put(home, path, bytes);
  const record = JSON.parse(await fs.readFile(join(home, recordPath)));
  record.version = "0.1.0";
  record.files[path] = createHash("sha256").update(bytes).digest("hex");
  await put(home, recordPath, JSON.stringify(record));
  return path;
}

test("migration removes unchanged historical graph ownership and deploys canonical latest graph", async t => {
  const { sourceRoot, home, options } = await fixture(t);
  await install(home, options);
  const historical = await addHistoricalMod(home);
  await put(home, "mods/git-graph-main/jsconfig.json", "generated, unowned");
  await put(sourceRoot, "mods/git-graph/main.js", "latest canonical graph 0.3.2\n");
  await install(home, options);
  assert.equal(await fs.readFile(join(home, "mods/git-graph/main.js"), "utf8"), "latest canonical graph 0.3.2\n");
  await missing(join(home, historical));
  assert.equal(await fs.readFile(join(home, "mods/git-graph-main/jsconfig.json"), "utf8"), "generated, unowned");
  const record = JSON.parse(await fs.readFile(join(home, recordPath)));
  assert.ok(Object.keys(record.files).every(path => !path.startsWith("mods/git-graph-main/")));
  assert.ok(record.files["mods/git-graph/main.js"]);
});

for (const change of ["edited", "deleted"]) {
  test(`migration refuses ${change} historical owned graph without mutation`, async t => {
    const { sourceRoot, home, options } = await fixture(t);
    await install(home, options);
    const historical = await addHistoricalMod(home);
    if (change === "edited") await put(home, historical, "user graph edit");
    else await fs.unlink(join(home, historical));
    await put(sourceRoot, "mods/git-graph/main.js", "latest canonical graph\n");
    const before = await snapshot(home);
    await assert.rejects(install(home, options), /Owned file edited or deleted/);
    await assert.rejects(uninstall(home), /Owned file edited or deleted/);
    assert.deepEqual(await snapshot(home), before);
  });
}

test("historical graph ownership cannot include private files", async t => {
  const { home, options } = await fixture(t);
  const path = "mods/git-graph-main/hosts.json";
  await put(home, recordPath, JSON.stringify({ name: "oh-my-herdr", schemaVersion: 1, version: "0.1.0", files: { [path]: "0".repeat(64) } }));
  const before = await snapshot(home);
  await assert.rejects(install(home, options), /Ownership outside suite/);
  await assert.rejects(uninstall(home), /Ownership outside suite/);
  assert.deepEqual(await snapshot(home), before);
});

for (const name of ["open-vscode", "tabs-professional"]) {
  test(`migration retires owned ${name} without removing personal files`, async t => {
    const { home, options } = await fixture(t);
    await install(home, options);
    const historical = await addHistoricalMod(home, name);
    const personal = `mods/${name}/notes.txt`;
    await put(home, personal, "personal");
    await install(home, options);
    await missing(join(home, historical));
    assert.equal(await fs.readFile(join(home, personal), "utf8"), "personal");
    const record = JSON.parse(await fs.readFile(join(home, recordPath)));
    assert.equal(record.files[historical], undefined);
  });
  test(`migration refuses edited owned ${name} before changing anything`, async t => {
    const { home, options } = await fixture(t);
    await install(home, options);
    const historical = await addHistoricalMod(home, name);
    await put(home, historical, "user edit");
    const before = await snapshot(home);
    await assert.rejects(install(home, options), /Owned file edited or deleted/);
    assert.deepEqual(await snapshot(home), before);
  });
}

test("SSH host migration preserves private data and runs only during retirement", async t => {
  const { home, options } = await fixture(t);
  await install(home, options);
  await addHistoricalMod(home, "open-vscode");
  const path = "mods/open-with/hosts.json", legacy = "mods/open-vscode/hosts.json";
  const hosts = '{"remote":"ssh-alias"}\n';
  await put(home, legacy, hosts);
  await install(home, options);
  assert.equal(await fs.readFile(join(home, path), "utf8"), hosts);
  assert.equal(await fs.readFile(join(home, legacy), "utf8"), hosts);
  assert.equal(JSON.parse(await fs.readFile(join(home, recordPath))).files[path], undefined);
  await put(home, path, '{"remote":"new-alias"}\n');
  await install(home, options);
  await uninstall(home);
  assert.equal(await fs.readFile(join(home, path), "utf8"), '{"remote":"new-alias"}\n');
});

test("SSH host conflict stops retirement without replacing either configuration", async t => {
  const { home, options } = await fixture(t);
  await install(home, options);
  await addHistoricalMod(home, "open-vscode");
  await put(home, "mods/open-vscode/hosts.json", '{"remote":"old"}');
  await put(home, "mods/open-with/hosts.json", '{"remote":"new"}');
  const before = await snapshot(home);
  await assert.rejects(install(home, options), /SSH host configuration conflict/);
  assert.deepEqual(await snapshot(home), before);
});

test("SSH host migration rolls back with retired files when record commit fails", async t => {
  const { home, options } = await fixture(t);
  await install(home, options);
  await addHistoricalMod(home, "open-vscode");
  await put(home, "mods/open-vscode/hosts.json", '{"remote":"ssh-alias"}');
  const before = await snapshot(home);
  await assert.rejects(install(home, { ...options, beforeCommit: ({ path }) => {
    if (path === recordPath) throw new Error("injected migration failure");
  } }), /injected migration failure/);
  assert.deepEqual(await snapshot(home), before);
});

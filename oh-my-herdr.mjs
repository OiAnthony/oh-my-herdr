#!/usr/bin/env node
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, posix, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const RECORD = ".oh-my-herdr/installed.json";
const MODS = new Set(["open-with", "professional-status", "git-graph"]);
// Historical ownership is accepted only to remove retired components during updates.
const OWNED_MODS = new Set([...MODS, "git-graph-main", "tabs-professional", "open-vscode"]);
const LAYOUTS = new Set(["Professional"]);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const excluded = name => name.startsWith(".") || /\.(?:d\.ts|error)$/.test(name)
  || ["jsconfig.json", "apps.json", "hosts.json"].includes(name);

export function resolveHome(argument, env = process.env, userHome = homedir()) {
  return resolve(argument ?? env.HERDR_APP_HOME ?? join(env.XDG_CONFIG_HOME ?? join(userHome, ".config"), "herdr-app"));
}

function relativePath(path) {
  if (typeof path !== "string" || !path || isAbsolute(path) || path.includes("\\")
      || path.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe relative path: ${path}`);
  }
  return path;
}

function ownedPath(path, mods = MODS) {
  relativePath(path);
  const parts = path.split("/");
  if (parts[0] === "mods" && mods.has(parts[1]) && parts.length >= 3 && !parts.slice(2).some(excluded)) return;
  if (parts.length === 2 && parts[0] === "layouts"
      && [...LAYOUTS].some(name => parts[1] === `${name}.json` || parts[1] === `${name}.svg`)) return;
  throw new Error(`Ownership outside suite boundaries: ${path}`);
}

async function stat(path) {
  try { return await fs.lstat(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

// Inspect every existing component, including the selected root's ancestors.
// Do not resolve symlinks: even an in-tree link is not an installer-owned path.
async function safePath(root, relative = "") {
  if (relative) relativePath(relative);
  const target = resolve(root, relative);
  const parts = target.split(sep).filter(Boolean);
  let current = sep;
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]);
    const info = await stat(current);
    if (!info) continue;
    if (info.isSymbolicLink()) throw new Error(`Symlink refused: ${current}`);
    if (index < parts.length - 1 && !info.isDirectory()) throw new Error(`Not a directory: ${current}`);
  }
  return target;
}

async function bytesAt(root, relative) {
  const path = await safePath(root, relative);
  const info = await stat(path);
  if (!info) return null;
  if (!info.isFile()) throw new Error(`Not a regular file: ${path}`);
  return fs.readFile(path);
}

export async function loadBundle(root = ROOT) {
  root = resolve(root);
  const raw = await bytesAt(root, "oh-my-herdr.json");
  if (!raw) throw new Error("Missing oh-my-herdr.json");
  const manifest = JSON.parse(raw);
  if (manifest.name !== "oh-my-herdr" || typeof manifest.version !== "string"
      || manifest.herdrVersion !== "0.1.14" || !Array.isArray(manifest.mods) || !Array.isArray(manifest.layouts)) {
    throw new Error("Invalid oh-my-herdr manifest");
  }
  const files = new Map();
  const mods = new Set();
  const layouts = new Set();
  const add = async (source, destination) => {
    ownedPath(destination);
    if (files.has(destination)) throw new Error(`Duplicate destination: ${destination}`);
    const bytes = await bytesAt(root, source);
    if (!bytes) throw new Error(`Missing suite file: ${source}`);
    files.set(destination, { bytes, sha256: digest(bytes) });
  };
  const walk = async (source, destination) => {
    const path = await safePath(root, source);
    const info = await stat(path);
    if (!info?.isDirectory()) throw new Error(`Missing mod directory: ${source}`);
    for (const entry of (await fs.readdir(path)).sort()) {
      if (excluded(entry)) continue;
      const child = `${source}/${entry}`;
      const childPath = await safePath(root, child);
      const info = await stat(childPath);
      if (info?.isDirectory()) await walk(child, `${destination}/${entry}`);
      else await add(child, `${destination}/${entry}`);
    }
  };
  for (const mod of manifest.mods) {
    if (!MODS.has(mod.name) || mods.has(mod.name) || mod.source !== `mods/${mod.name}`) throw new Error("Invalid manifest mod");
    mods.add(mod.name);
    await walk(mod.source, `mods/${mod.name}`);
    if (!files.has(`mods/${mod.name}/main.js`)) throw new Error(`Missing mod entry: ${mod.name}`);
  }
  for (const layout of manifest.layouts) {
    if (!LAYOUTS.has(layout.name) || layouts.has(layout.name)
        || layout.source !== `layouts/professional/${layout.name}.json`
        || layout.preview !== `layouts/professional/${layout.name}.svg`) throw new Error("Invalid manifest layout");
    layouts.add(layout.name);
    await add(layout.source, `layouts/${layout.name}.json`);
    await add(layout.preview, `layouts/${layout.name}.svg`);
  }
  if (mods.size !== MODS.size || layouts.size !== LAYOUTS.size) throw new Error("Incomplete suite manifest");
  return { manifest, files, mods, layouts };
}

async function readRecord(home) {
  const bytes = await bytesAt(home, RECORD);
  if (!bytes) return { bytes: null, files: {} };
  const record = JSON.parse(bytes);
  if (record.name !== "oh-my-herdr" || record.schemaVersion !== 1 || typeof record.version !== "string"
      || !record.files || typeof record.files !== "object" || Array.isArray(record.files)) throw new Error("Invalid ownership record");
  for (const [path, hash] of Object.entries(record.files)) {
    ownedPath(path, OWNED_MODS);
    if (typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)) throw new Error(`Invalid ownership hash: ${path}`);
  }
  return { bytes, files: record.files };
}

async function preflight(home, record, desired) {
  const snapshots = new Map();
  // The whole previous deployment is checked, including files removed upstream.
  for (const [path, hash] of Object.entries(record.files)) {
    const bytes = await bytesAt(home, path);
    if (!bytes || digest(bytes) !== hash) throw new Error(`Owned file edited or deleted: ${path}; no files were changed`);
    snapshots.set(path, bytes);
  }
  for (const [path, file] of desired) {
    if (snapshots.has(path)) continue;
    const bytes = await bytesAt(home, path);
    if (bytes && digest(bytes) !== file.sha256) throw new Error(`Unowned file conflict: ${path}; no files were changed`);
    snapshots.set(path, bytes);
  }
  return snapshots;
}

async function ensureDirectory(path, created) {
  const info = await stat(path);
  if (info) {
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Unsafe directory: ${path}`);
    return;
  }
  await ensureDirectory(dirname(path), created);
  await fs.mkdir(path);
  created.push(path);
}

// Staging and backups never appear under watched mods/ or layouts/.
async function transact(home, operations, beforeCommit) {
  if (!operations.length) return;
  const created = [];
  const applied = [];
  let stage;
  let rollbackFailed = false;
  try {
    await safePath(home, RECORD);
    await ensureDirectory(join(home, ".oh-my-herdr"), created);
    stage = await fs.mkdtemp(join(home, ".oh-my-herdr", "transaction-"));
    for (let index = 0; index < operations.length; index++) {
      const operation = operations[index];
      operation.staged = join(stage, `${index}.new`);
      operation.backup = join(stage, `${index}.old`);
      if (operation.after !== null) await fs.writeFile(operation.staged, operation.after, { flag: "wx" });
      if (operation.before !== null) await fs.writeFile(operation.backup, operation.before, { flag: "wx" });
    }
    // A second full pass detects edits made while staging, before any deployed write.
    for (const operation of operations) {
      const now = await bytesAt(home, operation.path);
      if (now === null ? operation.before !== null : operation.before === null || !now.equals(operation.before)) {
        throw new Error(`File changed during staging: ${operation.path}`);
      }
    }
    for (let index = 0; index < operations.length; index++) {
      const operation = operations[index];
      const target = await safePath(home, operation.path);
      await ensureDirectory(dirname(target), created);
      if (beforeCommit) await beforeCommit({ index, path: operation.path });
      // Check again immediately before each mutation, including fault-injection hooks.
      const now = await bytesAt(home, operation.path);
      if (now === null ? operation.before !== null : operation.before === null || !now.equals(operation.before)) {
        throw new Error(`File changed during commit: ${operation.path}`);
      }
      if (operation.after === null) await fs.unlink(target);
      else await fs.rename(operation.staged, target);
      applied.push(operation);
    }
  } catch (error) {
    const failures = [];
    for (const operation of applied.reverse()) {
      try {
        const target = await safePath(home, operation.path);
        if (operation.before === null) await fs.unlink(target);
        else await fs.rename(operation.backup, target);
      } catch (rollbackError) { failures.push(rollbackError); }
    }
    if (failures.length) {
      rollbackFailed = true;
      throw new AggregateError([error, ...failures], `Rollback incomplete; backups retained at ${stage}`);
    }
    throw error;
  } finally {
    // Only our fresh private transaction directory is recursively removed.
    // Retain backups if rollback failed, for manual recovery.
    if (stage && !rollbackFailed) {
      try { await fs.rm(stage, { recursive: true, force: true }); }
      catch (error) { console.error(`Private staging cleanup failed at ${stage}: ${error.message}`); }
    }
    for (const directory of created.reverse()) {
      try { await fs.rmdir(directory); }
      catch (error) {
        if (!["ENOTEMPTY", "EEXIST", "ENOENT"].includes(error.code)) console.error(`Empty directory cleanup failed at ${directory}: ${error.message}`);
      }
    }
  }
}

export async function install(home, { sourceRoot = ROOT, beforeCommit } = {}) {
  home = resolve(home);
  const bundle = await loadBundle(sourceRoot);
  const record = await readRecord(home);
  const snapshots = await preflight(home, record, bundle.files);
  const operations = [];
  const legacyHosts = Object.hasOwn(record.files, "mods/open-vscode/main.js")
    ? await bytesAt(home, "mods/open-vscode/hosts.json") : null;
  if (legacyHosts) {
    const path = "mods/open-with/hosts.json", current = await bytesAt(home, path);
    if (current && !current.equals(legacyHosts)) throw new Error("SSH host configuration conflict: reconcile both hosts.json files, then back up the legacy file outside mods/ before installing; no files were changed");
    if (!current) operations.push({ path, before: null, after: legacyHosts });
  }
  for (const [path, file] of bundle.files) {
    const before = snapshots.get(path);
    if (!before || !before.equals(file.bytes)) operations.push({ path, before, after: file.bytes });
  }
  for (const path of Object.keys(record.files)) {
    if (!bundle.files.has(path)) operations.push({ path, before: snapshots.get(path), after: null });
  }
  const after = Buffer.from(`${JSON.stringify({ schemaVersion: 1, name: "oh-my-herdr", version: bundle.manifest.version,
    files: Object.fromEntries([...bundle.files].map(([path, file]) => [path, file.sha256])) }, null, 2)}\n`);
  if (!record.bytes || !record.bytes.equals(after)) operations.push({ path: RECORD, before: record.bytes, after });
  await transact(home, operations, beforeCommit);
  return { home, files: bundle.files.size };
}

export async function uninstall(home, { beforeCommit } = {}) {
  home = resolve(home);
  const record = await readRecord(home);
  const snapshots = await preflight(home, record, new Map());
  const operations = Object.keys(record.files).map(path => ({ path, before: snapshots.get(path), after: null }));
  if (record.bytes) operations.push({ path: RECORD, before: record.bytes, after: null });
  await transact(home, operations, beforeCommit);
  return { home, files: operations.length - (record.bytes ? 1 : 0) };
}

async function validateDeployment(home, bundle) {
  const record = await readRecord(home);
  if (!record.bytes) throw new Error("Suite is not installed (missing ownership record)");
  await preflight(home, record, bundle.files);
  if (Object.keys(record.files).length !== bundle.files.size) throw new Error("Deployment contains obsolete ownership; install the current suite first");
  for (const [path, file] of bundle.files) {
    const bytes = await bytesAt(home, path);
    if (!bytes || !bytes.equals(file.bytes) || record.files[path] !== file.sha256) throw new Error(`Deployment differs from suite: ${path}`);
  }
  const builtinBytes = await bytesAt(home, "installed.json");
  const builtins = builtinBytes ? JSON.parse(builtinBytes) : {};
  if (!builtins || typeof builtins !== "object" || Array.isArray(builtins)) throw new Error("Invalid Herdr builtin record");
  const builtinFile = (name, path) => Object.hasOwn(builtins, name) && builtins[name]
    && typeof builtins[name] === "object" && Object.hasOwn(builtins[name], path);
  const modReference = async name => {
    if (typeof name !== "string" || !/^[a-zA-Z0-9_-]+$/.test(name)
        || (!bundle.mods.has(name) && !builtinFile(name, "main.js"))) throw new Error(`Unknown layout mod: ${name}`);
    if (!await bytesAt(home, `mods/${name}/main.js`)) throw new Error(`Missing referenced mod: ${name}`);
  };
  const resource = async path => {
    relativePath(path);
    if (!bundle.files.has(path)) {
      const parts = path.split("/");
      if (parts[0] !== "mods" || !builtinFile(parts[1], parts.slice(2).join("/"))) throw new Error(`Resource outside suite/builtins: ${path}`);
    }
    if (!await bytesAt(home, path)) throw new Error(`Missing static resource: ${path}`);
  };
  const visit = async value => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (["mod", "terminal_menu"].includes(key) && typeof child === "string") await modReference(child);
      if (key === "header" && typeof child === "string" && child !== "tabs") await modReference(child);
      if (["preview", "image"].includes(key) && typeof child === "string") await resource(child);
      await visit(child);
    }
  };
  for (const name of bundle.layouts) {
    const layout = JSON.parse((await bytesAt(home, `layouts/${name}.json`)).toString());
    if (layout.preview !== `layouts/${name}.svg`) throw new Error(`Invalid layout preview: ${name}`);
    await visit(layout);
    const preview = await bytesAt(home, layout.preview);
    if (!/<svg(?:\s|>)/.test(preview.toString())) throw new Error(`Invalid SVG preview: ${name}`);
  }
  // Literal imports/resources and finite ternary asset templates only; this is not a JS parser.
  // Runtime-computed personal configs and icon names remain the runtime's responsibility.
  for (const [path, file] of bundle.files) {
    if (!/\.(?:js|json)$/.test(path)) continue;
    const text = file.bytes.toString();
    if (path.endsWith(".js")) {
      const imports = /\b(?:import\s*(?:[^;"'`]*?\bfrom\s*)?|export\s+[^;]*?\bfrom\s*|import\s*\()\s*["'](\.\.?\/[^"']+)["']/g;
      for (const match of text.matchAll(imports)) {
        const target = posix.normalize(posix.join(posix.dirname(path), match[1]));
        if (!bundle.files.has(target)) throw new Error(`Missing or external relative import: ${path}: ${match[1]}`);
        if (!await bytesAt(home, target)) throw new Error(`Missing relative import: ${target}`);
      }
    }
    for (const match of text.matchAll(/(["'])((?:mods|icons|backgrounds|layouts)\/[^"'\r\n]+)\1/g)) {
      if (!match[2].endsWith("/")) await resource(match[2]);
    }
    for (const match of text.matchAll(/`((?:mods|icons|backgrounds|layouts)\/[^`]+)`/g)) {
      let paths = [match[1]];
      const ternary = /\$\{[^{}]*?\?\s*["']([^"']+)["']\s*:\s*["']([^"']+)["']\s*\}/;
      while (paths.some(path => ternary.test(path))) {
        paths = paths.flatMap(path => {
          const choice = path.match(ternary);
          return choice ? [path.replace(choice[0], choice[1]), path.replace(choice[0], choice[2])] : [path];
        });
      }
      for (const path of paths) if (!path.includes("${") && !path.endsWith("/")) await resource(path);
    }
  }
}

export async function check(home, { sourceRoot = ROOT, runCheck = promisify(execFile), env = process.env } = {}) {
  home = resolve(home);
  const bundle = await loadBundle(sourceRoot);
  await validateDeployment(home, bundle);
  const failures = [];
  for (const name of bundle.mods) {
    try {
      const result = await runCheck("herdr-app", ["check", join(home, "mods", name)], { env: { ...env, HERDR_APP_HOME: home } });
      if (result?.stdout) process.stdout.write(result.stdout);
      if (result?.stderr) process.stderr.write(result.stderr);
    } catch (error) { failures.push(new Error(`herdr-app check failed: ${name}: ${error.stderr || error.message}`, { cause: error })); }
  }
  if (failures.length) throw new AggregateError(failures, failures.map(error => error.message).join("\n"));
  return { home, mods: bundle.mods.size };
}

export async function main(argv = process.argv.slice(2)) {
  const [command, argument, ...extra] = argv;
  if (!["install", "check", "uninstall"].includes(command) || extra.length || argument?.startsWith("-")) {
    throw new Error("Usage: node oh-my-herdr.mjs install|check|uninstall [app-home] (no force option)");
  }
  const result = await ({ install, check, uninstall })[command](resolveHome(argument));
  console.log(`${command}: ${result.home}; ${result.files ?? result.mods} ${command === "check" ? "mods checked" : "owned files"}. No layout was switched.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

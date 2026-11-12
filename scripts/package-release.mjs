#!/usr/bin/env node
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBundle } from "../oh-my-herdr.mjs";
import { validateNativeHelper } from "./validate-package.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "dist");
const nodeVersion = "26.13.1";
const nodeHashes = {
  arm64: "aec2514ea1ceb2ba52455e9ec65986f6749a06dd759e5db2a72e6889668c9735",
  x64: "82bb96078a24ca50b9c9a38f2379e6be6d87171fcd400fc14c8934b3bce96e2f",
};
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
// Exact installer/document dependencies; Mod files come only from tracked, allowed paths.
const entries = ["install.sh", "oh-my-herdr.mjs", "oh-my-herdr.json", "keybindings.json", "LICENSE", "NOTICE",
  "THIRD_PARTY.md", "README.md", "README.zh-CN.md", "RECIPE.md", "CHANGELOG.md", "preview.png", "docs/development.md", "docs/design/resource-monitor.md",
  "scripts/validate-package.mjs", "scripts/cache-app-icons.mjs", "scripts/export-app-icons.jxa"];

async function checksums() {
  const zips = (await fs.readdir(output)).filter(name => /^oh-my-herdr-\d+\.\d+\.\d+-darwin-(arm64|x64)\.zip$/.test(name)).sort();
  if (!zips.length) throw new Error("No release ZIPs found");
  await fs.writeFile(join(output, "SHA256SUMS"), (await Promise.all(zips.map(async name => `${hash(await fs.readFile(join(output, name)))}  ${name}\n`))).join(""));
}

async function main() {
  if (process.argv.length === 3 && process.argv[2] === "--checksums") { await checksums(); return; }
  if (process.argv.length !== 2) throw new Error("Usage: node scripts/package-release.mjs [--checksums]");
  if (process.platform !== "darwin" || !nodeHashes[process.arch]) throw new Error("Build releases on native macOS arm64 or x64 runners");
  const manifest = JSON.parse(await fs.readFile(join(root, "oh-my-herdr.json")));
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error("Invalid release version");
  const name = `oh-my-herdr-${manifest.version}-darwin-${process.arch}`;
  const tracked = execFileSync("git", ["ls-files", "-z", "--", "mods", "layouts"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  const mods = new Set(manifest.mods.map(mod => mod.name));
  for (const path of tracked) {
    if (/^layouts\/oh-my-herdr\.(json|svg)$/.test(path)) entries.push(path);
    const parts = path.split("/");
    if (parts[0] !== "mods" || !mods.has(parts[1]) || !((parts.length === 3) || (parts.length === 4 && ["icons", "licenses"].includes(parts[2])))) continue;
    const file = basename(path);
    if (/^(?:LICENSE(?:[.-][\w.-]+)?|NOTICE(?:\.txt)?|THIRD-PARTY\.md|README\.txt|SOURCE\.[\w.-]+\.txt)$/.test(file)
        || file === "mod.json" || /\.(?:js|svg)$/.test(file) || (parts[2] === "licenses" && file.endsWith(".txt"))) entries.push(path);
  }
  execFileSync(process.execPath, [join(root, "scripts/build-resource-helper.mjs")], { stdio: "inherit" });
  await validateNativeHelper(root);
  entries.push("mods/resource-monitor/bin/herdr-resource-sample");
  const scratch = await fs.mkdtemp(join(root, ".release-"));
  try {
    const stage = join(scratch, name);
    await fs.mkdir(stage);
    for (const path of entries) {
      // Never follow source links, including links in a parent directory.
      let current = root;
      for (const part of path.split("/")) {
        current = join(current, part);
        if ((await fs.lstat(current)).isSymbolicLink()) throw new Error(`Symlink refused: ${path}`);
      }
      if (!(await fs.stat(current)).isFile()) throw new Error(`Not a regular source file: ${path}`);
      const destination = join(stage, path);
      await fs.mkdir(dirname(destination), { recursive: true });
      await fs.copyFile(current, destination);
      await fs.chmod(destination, path === "install.sh" || path.endsWith("/herdr-resource-sample") ? 0o755 : 0o644);
    }
    const tarName = `node-v${nodeVersion}-darwin-${process.arch}`;
    const url = `https://nodejs.org/dist/v${nodeVersion}/${tarName}.tar.gz`;
    const cache = join(root, ".release-cache");
    await fs.mkdir(cache, { recursive: true });
    const archive = join(cache, `${tarName}.tar.gz`);
    try { await fs.access(archive); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      console.log(`Downloading ${url}`);
      const download = `${archive}.download`;
      execFileSync("/usr/bin/curl", ["--http1.1", "--fail", "--location", "--silent", "--show-error", "--continue-at", "-", "--max-time", "1800", "--output", download, url], { stdio: "inherit" });
      if (hash(await fs.readFile(download)) !== nodeHashes[process.arch]) throw new Error("Official Node archive SHA256 mismatch; refusing to cache");
      await fs.rename(download, archive);
    }
    const bytes = await fs.readFile(archive);
    if (hash(bytes) !== nodeHashes[process.arch]) throw new Error("Official Node archive SHA256 mismatch; refusing to package");
    execFileSync("/usr/bin/tar", ["-xzf", archive, "-C", scratch, `${tarName}/bin/node`, `${tarName}/LICENSE`]);
    await fs.mkdir(join(stage, "runtime"));
    await fs.copyFile(join(scratch, tarName, "bin/node"), join(stage, "runtime/node"));
    // Keep the entire official license, including all bundled dependency notices.
    await fs.copyFile(join(scratch, tarName, "LICENSE"), join(stage, "runtime/LICENSE"));
    await fs.chmod(join(stage, "runtime/node"), 0o755);
    await fs.writeFile(join(stage, "release-target"), `darwin-${process.arch}\n`);
    const bundle = await loadBundle(stage);
    const files = {};
    for (const path of [...entries, "runtime/node", "runtime/LICENSE", "release-target"].sort()) {
      files[path] = hash(await fs.readFile(join(stage, path)));
    }
    for (const path of bundle.files.keys()) if (!Object.hasOwn(files, path)) throw new Error(`Missing release file: ${path}`);
    await fs.writeFile(join(stage, "release.json"), `${JSON.stringify({ schemaVersion: 1, version: manifest.version,
      platform: "darwin", arch: process.arch, minimumMacOS: "13.5", nodeVersion, nodeArchive: url,
      nodeArchiveSHA256: nodeHashes[process.arch], files }, null, 2)}\n`);
    execFileSync(join(stage, "runtime/node"), ["--input-type=module", "-e",
      "import {validatePackage, validateNativeHelper} from './scripts/validate-package.mjs'; await validatePackage(process.cwd()); await validateNativeHelper(process.cwd());"], { cwd: stage, stdio: "inherit" });
    const zip = join(scratch, `${name}.zip`);
    execFileSync("/usr/bin/zip", ["-q", "-r", "-X", zip, name], { cwd: scratch });
    await fs.mkdir(output, { recursive: true });
    await fs.copyFile(zip, join(output, `${name}.zip`));
    await checksums();
    console.log(join(output, `${name}.zip`));
    console.log(join(output, "SHA256SUMS"));
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

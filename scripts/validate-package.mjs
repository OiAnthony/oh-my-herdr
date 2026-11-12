import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve, sep } from "node:path";

const execute = promisify(execFile);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const helperPath = "mods/resource-monitor/bin/herdr-resource-sample";

async function regularFile(root, path) {
  if (!path || path.split("/").some(part => !part || part === "." || part === "..") || path.includes("\\")) {
    throw new Error(`Invalid package path: ${path}`);
  }
  const target = join(root, path);
  let current = sep;
  for (const part of resolve(target).split(sep).filter(Boolean)) {
    current = join(current, part);
    if ((await fs.lstat(current)).isSymbolicLink()) throw new Error(`Symlink refused: ${current}`);
  }
  if (!(await fs.stat(target)).isFile()) throw new Error(`Not a regular package file: ${path}`);
  return fs.readFile(target);
}

export async function validatePackage(root) {
  let release;
  try { release = JSON.parse(await regularFile(root, "release.json")); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    // A ZIP with deleted metadata must not silently become a source checkout.
    if (!await fs.stat(join(root, "native/resource-sample/Cargo.toml")).catch(error => {
      if (error.code === "ENOENT") return null;
      throw error;
    })) throw new Error("Incomplete release package: missing release.json; extract a fresh ZIP");
    return;
  }
  if (!release || typeof release !== "object" || Array.isArray(release)
      || release.schemaVersion !== 1 || release.platform !== "darwin" || !["arm64", "x64"].includes(release.arch)
      || release.nodeVersion !== "26.13.1" || !release.files || typeof release.files !== "object" || Array.isArray(release.files)) {
    throw new Error("Invalid release package metadata; extract a fresh ZIP");
  }
  if (process.platform !== release.platform || process.arch !== release.arch) throw new Error(`Package architecture mismatch: need ${process.platform}-${process.arch}, got ${release.platform}-${release.arch}`);
  if (resolve(process.execPath) !== join(resolve(root), "runtime/node")) throw new Error("Release packages must use their private runtime/node, not a global Node");
  if (process.versions.node !== release.nodeVersion) throw new Error("Private Node version mismatch; extract a fresh ZIP");
  const required = ["install.sh", "oh-my-herdr.mjs", "oh-my-herdr.json", "keybindings.json", "release-target",
    "scripts/validate-package.mjs", "scripts/cache-app-icons.mjs", "scripts/export-app-icons.jxa",
    "runtime/node", "runtime/LICENSE", "LICENSE", "NOTICE", "THIRD_PARTY.md", helperPath];
  for (const path of required) if (!Object.hasOwn(release.files, path)) throw new Error(`Incomplete release inventory: ${path}`);
  for (const [path, expected] of Object.entries(release.files)) {
    if (!/^[a-f0-9]{64}$/.test(expected) || hash(await regularFile(root, path)) !== expected) throw new Error(`Release package checksum mismatch: ${path}; extract a fresh ZIP`);
  }
  const manifest = JSON.parse(await regularFile(root, "oh-my-herdr.json"));
  if (manifest.version !== release.version || (await regularFile(root, "release-target")).toString().trim() !== `darwin-${release.arch}`) {
    throw new Error("Release package version/target mismatch");
  }
}

export async function validateNativeHelper(root) {
  if (process.platform !== "darwin") return;
  const bytes = await regularFile(root, helperPath);
  const cpu = { arm64: 0x0100000c, x64: 0x01000007 }[process.arch];
  if (bytes.length < 32 || bytes.readUInt32LE(0) !== 0xfeedfacf || bytes.readUInt32LE(4) !== cpu) {
    throw new Error(`Native helper architecture mismatch or invalid executable: expected darwin-${process.arch}`);
  }
  try {
    const { stdout } = await execute(join(root, helperPath), ["--roots=", "--scope=herdr"], { timeout: 10_000 });
    const sample = JSON.parse(stdout);
    if (sample.schema !== 1 || sample.platform !== "macos" || !Array.isArray(sample.rows)) throw new Error("Invalid helper response");
  } catch (error) {
    throw new Error(`Native helper cannot run: ${error.message}. For a ZIP, extract a fresh matching package; check macOS Privacy & Security if blocked.`, { cause: error });
  }
}

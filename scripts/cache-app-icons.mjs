import * as fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_APPS } from "../mods/open-with/apps.js";

const execute = promisify(execFile);
const exporter = fileURLToPath(new URL("./export-app-icons.jxa", import.meta.url));

export async function cacheAppIcons(home, apps = DEFAULT_APPS.filter(app => app.icon.endsWith("/application.svg"))) {
  if (process.platform !== "darwin") return;
  for (const relative of ["data", "data/open-with-icons"]) {
    const path = join(home, relative);
    await fs.mkdir(path, { recursive: true });
    const info = await fs.lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Unsafe icon cache directory: ${path}`);
  }
  const directory = join(home, "data/open-with-icons");
  const stage = await fs.mkdtemp(join(directory, ".export-"));
  try {
    const { stdout } = await execute("/usr/bin/osascript", ["-l", "JavaScript", exporter, stage, JSON.stringify(apps)], { timeout: 30_000 });
    const found = new Set(JSON.parse(stdout));
    const icons = {};
    for (const app of apps) {
      if (!found.has(app.id)) {
        console.log(`Icon unavailable: ${app.title}; using bundled fallback.`);
        continue;
      }
      const source = join(stage, `${app.id}.png`);
      const bytes = await fs.readFile(source);
      const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
      const name = `${app.id}-${hash}.png`;
      await fs.rename(source, join(directory, name));
      icons[app.bundleId] = `data/open-with-icons/${name}`;
    }
    const manifest = join(stage, "icons.json");
    await fs.writeFile(manifest, `${JSON.stringify(icons, null, 2)}\n`);
    await fs.rename(manifest, join(directory, "icons.json"));
    console.log(`Cached ${Object.keys(icons).length} local application icons.`);
    return icons;
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}

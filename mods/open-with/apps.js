import { launchVscode } from "./vscode.js";

export const DEFAULT_APPS = [
  { id: "finder", title: "Finder", bundleId: "com.apple.finder", icon: "mods/open-with/icons/application.svg" },
  { id: "vscode", title: "VS Code", bundleId: "com.microsoft.VSCode", icon: "mods/open-with/icons/application.svg" },
  { id: "zed", title: "Zed", bundleId: "dev.zed.Zed", icon: "mods/open-with/icons/application.svg" },
  { id: "idea", title: "IntelliJ IDEA", bundleId: "com.jetbrains.intellij", icon: "mods/open-with/icons/application.svg" },
  { id: "cursor", title: "Cursor", bundleId: "com.todesktop.230313mzl4w4u92", icon: "mods/open-with/icons/cursor.svg" },
  { id: "sublime", title: "Sublime Text", bundleId: "com.sublimetext.4", icon: "mods/open-with/icons/sublime.svg" },
];

export function parseApps(raw) {
  if (raw === null) return DEFAULT_APPS;
  const apps = JSON.parse(raw);
  if (!Array.isArray(apps) || !apps.length || apps.length > 20) {
    throw new Error("apps.json must contain 1–20 applications.");
  }
  const ids = new Set();
  for (const app of apps) {
    if (!app || !/^[a-z][a-z0-9-]*$/.test(app.id) || ids.has(app.id)
      || typeof app.title !== "string" || !app.title.trim()
      || (app.id !== "vscode" && typeof app.bundleId !== "string")
      || (app.bundleId !== undefined && (typeof app.bundleId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(app.bundleId)))) {
      throw new Error("Each app needs a unique id, title and macOS bundleId (optional for vscode).");
    }
    if (app.icon !== undefined && (typeof app.icon !== "string" || !app.icon.trim())) {
      throw new Error("An app icon must be a nonempty image path when provided.");
    }
    ids.add(app.id);
  }
  return apps;
}

export function availableApps(apps, target, platform) {
  if (!target.on && platform === "macos") return apps;
  return [apps.find(app => app.id === "vscode") ?? DEFAULT_APPS.find(app => app.id === "vscode")];
}

export async function launch(app, target, exec, platform, resolveMachine) {
  if (!target.path) throw new Error("No file or working directory in this space.");
  if (app.id === "vscode") return launchVscode(target, platform, exec, resolveMachine);
  if (target.on) throw new Error(`Cannot open a remote path in a local app (${target.on}:${target.path}).`);
  if (platform !== "macos") throw new Error(`${app.title} requires macOS. Choose VS Code instead.`);
  const result = await exec("/usr/bin/open", ["-b", app.bundleId, target.path]);
  if (result.code !== 0) throw new Error(result.stderr.trim() || `${app.title} exited with ${result.code}.`);
}

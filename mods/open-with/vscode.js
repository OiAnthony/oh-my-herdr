import { folderUri, protocolUrl, resolveHost } from "./uri.js";

const ps = value => `'${value.replaceAll("'", "''")}'`;

export async function hostOf(machine, { appHome, readTextFile, hc }) {
  const raw = await readTextFile(`${appHome()}/mods/open-with/hosts.json`);
  const overrides = raw === null ? {} : JSON.parse(raw);
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) throw new Error("hosts.json must be an object mapping machine names to SSH hosts.");
  const override = resolveHost(machine, [], overrides);
  if (override) return override;
  const result = await hc(["machine", "ls", "--json"]);
  if (result.code !== 0) throw new Error(result.stderr.trim() || "Could not list SSH machines.");
  const host = resolveHost(machine, JSON.parse(result.stdout).machines ?? [], overrides);
  if (!host) throw new Error(`No ssh host for "${machine}". Add it to mods/open-with/hosts.json: {"${machine}": "<Host in your ssh config>"}`);
  return host;
}

export async function launchVscode(target, platform, exec, resolveMachine) {
  const host = target.on ? await resolveMachine(target.on) : null;
  if (target.on && !host) throw new Error(`No SSH host for "${target.on}".`);
  const uri = folderUri(target.path, host, platform === "windows");
  const url = protocolUrl(target.path, host, platform === "windows");
  if (platform === "windows") {
    const script = `$opened = $false; if (Get-Command code -ErrorAction SilentlyContinue) { & code --folder-uri ${ps(uri)}; $opened = ($LASTEXITCODE -eq 0) }; if (-not $opened) { Start-Process -ErrorAction Stop ${ps(url)} }`;
    const result = await exec("powershell", ["-NoProfile", "-Command", script]);
    if (result.code !== 0) throw new Error(result.stderr.trim() || `VS Code exited with ${result.code}.`);
    return;
  }
  const result = await exec("code", ["--folder-uri", uri]).catch(() => null);
  if (result?.code === 0) return;
  const opener = platform === "macos" ? "open" : "xdg-open";
  const fallback = await exec(opener, [url]);
  if (fallback.code !== 0) throw new Error(fallback.stderr.trim() || `${opener} exited with ${fallback.code}.`);
}

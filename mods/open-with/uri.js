// Adapted from CacaoRick/herdr-open-vscode, MIT; see LICENSE.open-vscode.
// Modified by oh-my-herdr: preserve POSIX backslashes, support local Windows/UNC,
// and validate SSH overrides. Source revision and changes: ../../THIRD_PARTY.md.
// Pure helpers: where a folder is, as the URIs VS Code understands.

// Everything but unreserved characters, so the URI survives PowerShell and code.cmd.
function encodeSegment(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

// Absolute drive paths identify Windows even when the SSH client runs on another OS.
export function uriPath(folder, windows = false) {
  const drivePath = /^[A-Za-z]:[\\/]/.test(folder);
  const slashed = windows || drivePath ? folder.replace(/\\/g, "/") : folder;
  const drive = slashed.match(/^([A-Za-z]):(\/.*)?$/);
  if (drive) return `/${drive[1]}:${(drive[2] ?? "/").split("/").map(encodeSegment).join("/")}`;
  return slashed.split("/").map(encodeSegment).join("/");
}

// Herdr's JS has no TextEncoder: encodeURIComponent gives the UTF-8 bytes.
function utf8Hex(s) {
  return encodeURIComponent(s)
    .replace(/%([0-9A-F]{2})|([\s\S])/g, (_, hex, c) => (hex ?? c.charCodeAt(0).toString(16).padStart(2, "0")).toLowerCase());
}

// VS Code lowercases URI authorities, so a Host with capitals only survives hex-encoded.
export function sshAuthority(host) {
  if (/^[a-z0-9._@-]+$/.test(host)) return `ssh-remote+${host}`;
  return `ssh-remote+${utf8Hex(JSON.stringify({ hostName: host }))}`;
}

// host: null for a folder on this computer.
export function folderUri(folder, host, windows = false) {
  const path = uriPath(folder, !host && windows);
  return host ? `vscode-remote://${sshAuthority(host)}${path}` : `file://${windows && path.startsWith("//") ? path.slice(2) : path}`;
}

// The same place as a link the OS hands to VS Code, for when `code` isn't on PATH.
export function protocolUrl(folder, host, windows = false) {
  const path = uriPath(folder, !host && windows);
  return host ? `vscode://vscode-remote/${sshAuthority(host)}${path}` : `vscode://file${path}`;
}

// What ssh should be given for a machine, from `hc machine ls` and hosts.json.
// Returns a host, or null when the machine has none VS Code could use.
export function resolveHost(name, machines, overrides) {
  if (Object.prototype.hasOwnProperty.call(overrides ?? {}, name)) {
    const host = overrides[name];
    if (typeof host !== "string" || !host || /\s/.test(host)) throw new Error(`Invalid SSH host override for "${name}".`);
    return host;
  }
  const m = machines.find((x) => x.name === name);
  if (!m || m.via || !m.target || /\s/.test(m.target)) return null;
  return m.target;
}

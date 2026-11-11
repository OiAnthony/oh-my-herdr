import test from "node:test";
import assert from "node:assert/strict";
import { selectTarget, resolveTarget } from "../mods/open-with/target.js";
import { folderUri, protocolUrl, resolveHost, sshAuthority, uriPath } from "../mods/open-with/uri.js";
import { availableApps, DEFAULT_APPS, launch } from "../mods/open-with/apps.js";
import { hostOf, launchVscode } from "../mods/open-with/vscode.js";

const ok = { code: 0, stdout: "", stderr: "" };
const failed = { code: 1, stdout: "", stderr: "not available" };
const spaces = [{ id: "local", machine: null, active: true, folder: "/local", tabs: [{ id: "tab", active: true }] }];

test("focused remote terminal block does not use the window space's local machine", () => {
  const target = selectTarget({ space: "local", tab: "tab", pane: null, terminal: "remote/t1", cwd: "/remote/subdir" }, spaces, []);
  assert.equal(target.path, "/remote/subdir");
  assert.equal(target.on, "remote");
});

test("focused local terminal block does not inherit a remote space's machine", () => {
  const target = selectTarget({ space: "remote", pane: null, terminal: "t1", cwd: "/local" }, [{ id: "remote", machine: "remote", folder: "/remote", tabs: [] }], []);
  assert.equal(target.path, "/local");
  assert.equal(target.on, null);
});

test("unknown focused terminal cwd never borrows another machine's folder", () => {
  const target = selectTarget({ space: "local", tab: "tab", pane: null, terminal: "remote/t1", cwd: null }, spaces,
    [{ pane: "p", tab: "tab", terminal: "t2", cwd: "/local/other" }]);
  assert.equal(target.path, null);
  assert.equal(target.on, "remote");
});

test("mod pane fallback takes both directory and machine from its tab terminal", () => {
  const target = selectTarget({ space: "local", tab: "tab", pane: "mod", terminal: null }, spaces,
    [{ pane: "p", tab: "tab", terminal: "remote/t2", cwd: "/remote/repo" }]);
  assert.equal(target.path, "/remote/repo");
  assert.equal(target.on, "remote");
});

test("repository resolution executes on the captured machine and preserves it", async () => {
  const target = { path: "/repo/sub", cwd: "/repo/sub", on: "remote", kind: "directory" };
  const resolved = await resolveTarget(target, async (command, args, options) => {
    assert.equal(command, "git");
    assert.deepEqual(args, ["rev-parse", "--show-toplevel"]);
    assert.deepEqual(options, { cwd: "/repo/sub", on: "remote" });
    return { ...ok, stdout: "/repo\n" };
  });
  assert.equal(resolved.path, "/repo");
  assert.equal(resolved.on, "remote");
  assert.equal(resolved.kind, "repository");
  assert.equal(await resolveTarget(target, async () => failed), target);
  await assert.rejects(resolveTarget({ path: null }, async () => assert.fail("must not execute")), /No file/);
});

test("POSIX backslashes are filename characters, including remote paths on Windows", () => {
  assert.equal(uriPath("/repo/a\\b #中文"), "/repo/a%5Cb%20%23%E4%B8%AD%E6%96%87");
  assert.equal(folderUri("/repo/a\\b", "host", true), "vscode-remote://ssh-remote+host/repo/a%5Cb");
  assert.equal(protocolUrl("/repo/a\\b", "host", true), "vscode://vscode-remote/ssh-remote+host/repo/a%5Cb");
});

test("local Windows drive and UNC paths remain absolute URI targets", () => {
  assert.equal(folderUri("C:\\repo a\\sub", null, true), "file:///C:/repo%20a/sub");
  assert.equal(protocolUrl("C:\\repo a", null, true), "vscode://file/C:/repo%20a");
  assert.equal(folderUri("\\\\server\\share\\a b", null, true), "file://server/share/a%20b");
  assert.equal(folderUri("C:\\repo a\\sub", "host"), "vscode-remote://ssh-remote+host/C:/repo%20a/sub");
});

test("mixed-case SSH aliases survive authority lowercasing through hex encoding", () => {
  const authority = sshAuthority("MyHost");
  assert.equal(authority, `ssh-remote+${Buffer.from(JSON.stringify({ hostName: "MyHost" })).toString("hex")}`);
  assert.equal(sshAuthority("user@host"), "ssh-remote+user@host");
});

test("SSH host resolution requires an override for relay machines", () => {
  const machines = [{ name: "direct", target: "user@host" }, { name: "relay", target: "target", via: "jump" }];
  assert.equal(resolveHost("direct", machines, {}), "user@host");
  assert.equal(resolveHost("relay", machines, {}), null);
  assert.equal(resolveHost("relay", machines, { relay: "SSH-Alias" }), "SSH-Alias");
  assert.throws(() => resolveHost("relay", machines, { relay: 42 }), /Invalid SSH host/);
});

test("host lookup reads the new configuration only, and supports a corrected retry", async () => {
  let raw = "{";
  const deps = { appHome: () => "/app", readTextFile: async path => {
    assert.equal(path, "/app/mods/open-with/hosts.json"); return raw;
  }, hc: async () => assert.fail("override must not need hc") };
  await assert.rejects(hostOf("remote", deps));
  raw = '{"remote":"SSH-Alias"}';
  assert.equal(await hostOf("remote", deps), "SSH-Alias");
});

test("remote and non-macOS targets expose only VS Code even when custom apps omit it", () => {
  const custom = [DEFAULT_APPS[1]];
  assert.deepEqual(availableApps(custom, { on: "remote" }, "macos"), [DEFAULT_APPS[0]]);
  assert.deepEqual(availableApps(custom, { on: null }, "linux"), [DEFAULT_APPS[0]]);
  assert.equal(availableApps(custom, { on: null }, "macos"), custom);
});

test("local bundle apps reject remote targets before any program can run", async () => {
  await assert.rejects(launch(DEFAULT_APPS[1], { path: "/secret", on: "remote" }, async () => assert.fail("must not execute"), "macos"), /remote path/);
});

test("VS Code launches locally using the remote folder URI, not remote exec", async () => {
  const calls = [];
  await launchVscode({ path: "/repo/a\\b", on: "remote" }, "linux", async (...args) => {
    calls.push(args); return ok;
  }, async machine => { assert.equal(machine, "remote"); return "host"; });
  assert.deepEqual(calls, [["code", ["--folder-uri", "vscode-remote://ssh-remote+host/repo/a%5Cb"]]]);
});

test("missing CLI and failed CLI both fall back to the local protocol opener", async () => {
  for (const platform of ["macos", "linux"]) {
    for (const rejects of [true, false]) {
      const calls = [];
      await launchVscode({ path: "/repo a", on: null }, platform, async (...args) => {
        calls.push(args);
        if (args[0] === "code") { if (rejects) throw new Error("missing"); return failed; }
        return ok;
      });
      assert.deepEqual(calls[1], [platform === "macos" ? "open" : "xdg-open", ["vscode://file/repo%20a"]]);
    }
  }
});

test("host resolution and protocol errors stay errors, never launch a remote path locally", async () => {
  await assert.rejects(launchVscode({ path: "/repo", on: "remote" }, "linux", async () => assert.fail("must not execute"), async () => null), /No SSH host/);
  await assert.rejects(launchVscode({ path: "/repo", on: null }, "linux", async () => failed), /not available/);
});


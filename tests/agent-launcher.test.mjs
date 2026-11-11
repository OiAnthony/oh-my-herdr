import test from "node:test";
import assert from "node:assert/strict";
import { captureTarget, customCommand, resolveLaunch, newTabCommand } from "../mods/agent-launcher/launch.js";

const local = { id: "s1", machine: null, folder: "/repo", active: true };
const remote = { id: "host/s1", machine: "host", folder: "/remote", active: false };

test("custom arguments preserve spaces, quotes, empty strings and shell syntax literally", () => {
  const argv = ["a b", "中文", "a'quote", "", "$(touch /tmp/not-run)", "x | y"];
  const command = customCommand("/path with spaces/agent", JSON.stringify(argv), "My agent");
  assert.deepEqual(command.argv, ["/path with spaces/agent", ...argv]);
});

test("invalid custom input cannot replace a usable command", () => {
  for (const program of ["", "  ", "a\0b", "a\nb"]) assert.throws(() => customCommand(program, "[]", "Agent"), /executable/);
  for (const args of ["{", "{}", '[1]', '[null]', '["a\\u0000b"]']) {
    assert.throws(() => customCommand("agent", args, "Agent"), /JSON array/);
  }
});

test("a saved agent key resolves its current command instead of stale launch arguments", () => {
  const choice = { kind: "agent", key: "agent", name: "Old display" };
  const agents = [{ key: "agent", name: "Agent", installed: true, run: ["agent", "--new-profile"] }];
  assert.deepEqual(resolveLaunch(choice, agents), { name: "Agent", argv: ["agent", "--new-profile"] });
  agents[0].installed = false;
  assert.throws(() => resolveLaunch(choice, agents), /not installed/);
  assert.throws(() => resolveLaunch(choice, []), /no longer/);
});

test("missing defaults and custom commands never fall back to an arbitrary agent", () => {
  const agents = [{ key: "other", name: "Other", installed: true, run: ["other"] }];
  assert.throws(() => resolveLaunch(null, agents), /Choose a default/);
  assert.throws(() => resolveLaunch({ kind: "custom" }, agents, null), /missing/);
});

test("target pins the selected space and its own machine's terminal directory", () => {
  const focus = { space: remote.id, terminal: "host/t1", cwd: "/remote/subdir" };
  const target = captureTarget([local, remote], focus);
  const launch = customCommand("agent", "[]", "Agent");
  assert.deepEqual(newTabCommand(target, launch, [{ ...local, active: true }, { ...remote, active: false }]), {
    name: "tab.new", args: { space: remote.id, folder: "/remote/subdir", name: "Agent", argv: ["agent"] },
  });
  assert.throws(() => newTabCommand(target, launch, [local]), /original space/);
  assert.throws(() => newTabCommand(target, launch, [{ ...remote, machine: "other" }]), /original space/);
});

test("a composition terminal on another machine cannot leak its cwd into the selected space", () => {
  assert.deepEqual(captureTarget([local], { space: local.id, terminal: "host/t1", cwd: "/private/remote" }), {
    space: local.id, machine: null, folder: "/repo",
  });
  assert.equal(captureTarget([remote], { space: remote.id, terminal: "t1", cwd: "/private/local" }).folder, "/remote");
});

test("an empty window starts a local space even if another space appears before launch", () => {
  const target = captureTarget([], null);
  assert.deepEqual(newTabCommand(target, customCommand("agent", "[]", "Agent"), [remote]), {
    name: "space.new", args: { machine: "", name: "Agent", argv: ["agent"] },
  });
});

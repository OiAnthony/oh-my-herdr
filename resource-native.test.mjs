import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { parseNative } from "./mods/resource-monitor/collect.js";

const helper = fileURLToPath(new URL(`./mods/resource-monitor/bin/herdr-resource-sample${process.platform === "win32" ? ".exe" : ""}`, import.meta.url));
const sample = (roots = [process.pid], ports = false) => JSON.parse(execFileSync(helper,
  [`--roots=${roots.join(",")}`, ...(ports ? [ports === "all" ? "--all-ports" : "--ports"] : [])], { encoding: "utf8", timeout: 3000 }));

test("native CPU accounting agrees with measured busy-loop CPU time", () => {
  const before = sample(), old = before.rows.find(p => p.pid === process.pid);
  assert.ok(old.start);
  const used = process.cpuUsage(), end = performance.now() + 250;
  while (performance.now() < end) { /* Burn CPU in the measured process. */ }
  const seconds = Object.values(process.cpuUsage(used)).reduce((a, b) => a + b) / 1e6;
  const after = sample(), row = after.rows.find(p => p.pid === process.pid);
  const measured = row.seconds - old.seconds;
  assert.equal(row.start, old.start);
  assert.ok(measured / seconds > 0.8 && measured / seconds < 1.3,
    `native ${measured}s vs process.cpuUsage ${seconds}s`);
  assert.ok(row.memory > 0);
  if (process.platform === "darwin") assert.ok(row.footprint > 0);
  assert.ok(after.monotonic > before.monotonic);
  const first = parseNative(JSON.stringify(before), null, 1000);
  const next = parseNative(JSON.stringify(after), { ...first, rows: first.processes.rows }, 2000);
  assert.ok(next.processes.rows.find(p => p.pid === process.pid).cpu > 0);
});

test("native topology deduplicates nested roots and finds live IPv4/IPv6 listeners", async t => {
  const child = spawn(process.execPath, ["-e", `
    const net = require("node:net");
    (async () => {
      const a = net.createServer(), b = net.createServer();
      await new Promise(r => a.listen(0, "127.0.0.1", r));
      await new Promise(r => b.listen({port: 0, host: "::1", ipv6Only: true}, r));
      console.log(JSON.stringify([a.address().port, b.address().port]));
    })();
  `, "resource-monitor-private-argv-marker"], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill(); await once(child, "exit"); } });
  const lines = createInterface({ input: child.stdout });
  t.after(() => lines.close());
  const timeout = setTimeout(() => child.kill(), 3000);
  t.after(() => clearTimeout(timeout));
  const [line] = await once(lines, "line");
  const ports = JSON.parse(line), snapshot = sample([process.pid, child.pid, child.pid], true);
  clearTimeout(timeout);
  assert.equal(snapshot.rows.filter(p => p.pid === child.pid).length, 1);
  assert.equal(snapshot.rows.find(p => p.pid === child.pid).ppid, process.pid);
  for (const [i, family] of ["ipv4", "ipv6"].entries()) {
    assert.ok(snapshot.listeners.rows.some(p => p.pid === child.pid && p.port === ports[i] && p.family === family),
      `missing ${family} listener ${ports[i]}`);
  }
  assert.equal(JSON.stringify(snapshot).includes("resource-monitor-private-argv-marker"), false);
  assert.deepEqual(sample([], true).listeners.rows, []);
  const unassigned = sample([], "all");
  assert.equal(unassigned.listeners.scope, "all");
  assert.ok(unassigned.listeners.rows.some(p => p.pid === child.pid && p.port === ports[0]));
});

test("native CLI rejects malformed roots and returns no managed rows for an empty root set", () => {
  assert.deepEqual(sample([]).rows, []);
  for (const arg of ["--roots=0", "--roots=1;echo bad", "--unknown"]) {
    assert.throws(() => execFileSync(helper, [arg], { stdio: "pipe", timeout: 3000 }), e => e.status === 1);
  }
});

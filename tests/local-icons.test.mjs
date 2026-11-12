import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_APPS } from "../mods/open-with/apps.js";
import { withLocalIcons } from "../mods/open-with/local-icons.js";
import { cacheAppIcons } from "../scripts/cache-app-icons.mjs";

test("cached application artwork replaces neutral icons without changing launch targets", () => {
  const icons = Object.fromEntries(DEFAULT_APPS.slice(0, 4).map(app => [app.bundleId, `data/open-with-icons/${app.id}.png`]));
  const resolved = withLocalIcons(DEFAULT_APPS, icons);
  for (let index = 0; index < 4; index++) {
    const app = DEFAULT_APPS[index];
    assert.deepEqual(resolved[index], { ...app, icon: icons[app.bundleId] });
  }
  assert.equal(resolved[4], DEFAULT_APPS[4]);
  assert.equal(resolved[5], DEFAULT_APPS[5]);
  assert.equal(DEFAULT_APPS[0].icon, "mods/open-with/icons/application.svg");
});

test("personal artwork takes precedence and missing cache leaves the bundled fallback", () => {
  const personal = { ...DEFAULT_APPS[0], icon: "personal/code.svg" };
  const noIcon = { id: "custom", title: "Custom", bundleId: "org.example.custom" };
  const icons = { [personal.bundleId]: "data/open-with-icons/code.png", [noIcon.bundleId]: "data/open-with-icons/custom.png" };
  const result = withLocalIcons([personal, noIcon, DEFAULT_APPS[1]], icons);
  assert.equal(result[0], personal);
  assert.deepEqual(result[1], { ...noIcon, icon: icons[noIcon.bundleId] });
  assert.equal(result[2], DEFAULT_APPS[1]);
  assert.deepEqual(withLocalIcons(DEFAULT_APPS, {}), DEFAULT_APPS);
});

test("native export caches a real Finder PNG and omits an unavailable application", { skip: process.platform !== "darwin" }, async t => {
  const home = await fs.mkdtemp(join(tmpdir(), "herdr-icons-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const finder = DEFAULT_APPS.find(app => app.id === "finder");
  const missing = { id: "absent", title: "Absent", bundleId: "invalid.oh-my-herdr.not-installed" };
  const icons = await cacheAppIcons(home, [finder, missing]);
  assert.deepEqual(Object.keys(icons), [finder.bundleId]);
  const png = await fs.readFile(join(home, icons[finder.bundleId]));
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.ok(png.readUInt32BE(16) >= 32 && png.readUInt32BE(20) >= 32, "icon has sufficient resolution for a Retina menu");
  assert.deepEqual(JSON.parse(await fs.readFile(join(home, "data/open-with-icons/icons.json"), "utf8")), icons);
  const again = await cacheAppIcons(home, [finder]);
  assert.deepEqual(again, icons);
  assert.deepEqual((await fs.readdir(join(home, "data/open-with-icons"))).sort(), [icons[finder.bundleId].split("/").at(-1), "icons.json"].sort());
});

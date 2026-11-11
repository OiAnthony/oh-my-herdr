import test from "node:test";
import assert from "node:assert/strict";
import { agentTitle, terminalTitle } from "./mods/agents-professional/title.js";

const omp = { key: "omp", name: "OMP", icon: "omp.svg" };

test("OMP branding and known state separators are removed while task text stays literal", () => {
  for (const state of [">", "!", ":", ..."⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏○◔◑◕●⠁⠂⠄⠠⠐⠈", "-", "\\", "|", "/"]) {
    assert.equal(terminalTitle(`π ${state} 🐙 GITHUB: 检查 π 的显示`, omp), "🐙 GITHUB: 检查 π 的显示");
    assert.equal(terminalTitle(`π ${state}`, omp), "");
  }
  for (const body of ["✓ 📋 ADMIN: 修复管理", "herdr-workspace", "π 是任务正文", "▦ TABLE: 启动服务", "⛳ TREE: Install", ">条件", "⠋spinner"]) {
    assert.equal(terminalTitle(`π ${body}`, omp), body);
    assert.equal(terminalTitle(body, omp), body === "π 是任务正文" ? "是任务正文" : body);
  }
  assert.equal(terminalTitle("π > > 保留正文符号", omp), "> 保留正文符号");
  assert.equal(terminalTitle("> 🐙 原始任务标题", omp), "> 🐙 原始任务标题");
  assert.equal(terminalTitle("π: ! 保留正文符号", omp), "! 保留正文符号");
  assert.equal(terminalTitle("π ⠴ ▦ TREE: Install", omp), "▦ TREE: Install");
  assert.equal(terminalTitle("π", omp), "");
  assert.equal(terminalTitle(null, omp), "");
  assert.equal(terminalTitle("π-value", omp), "π-value");
});

test("branding remains without an OMP icon and other programs retain their title rules", () => {
  assert.equal(terminalTitle("π > 🐙 检查", { ...omp, icon: null }), "π > 🐙 检查");
  assert.equal(terminalTitle("π > 🐙 检查", { ...omp, key: "pi" }), "π > 🐙 检查");
  assert.equal(terminalTitle("> 🐙 检查", { key: "shell" }), "检查");
});

test("automatic titles deduplicate OMP while explicitly named tabs remain literal", () => {
  const lead = { program: omp, title: "π > 🐙 GITHUB: 检查" };
  assert.equal(agentTitle({ name: "1", named: false }, lead), "🐙 GITHUB: 检查");
  assert.equal(agentTitle({ name: "OMP", named: true }, lead), "🐙 GITHUB: 检查");
  assert.equal(agentTitle({ name: "π 我的任务", named: true }, lead), "π 我的任务");
  assert.equal(agentTitle({ name: "π > 我的任务", named: true }, lead), "π > 我的任务");
  assert.equal(agentTitle({ name: "OMP", named: true }, { program: omp, title: "π ⠋" }), "OMP");
  assert.equal(agentTitle({ name: "2", named: false }, { program: omp, title: "π /repo" }), "2");
});

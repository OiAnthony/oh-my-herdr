// Menu command semantics adapted from Herdr new-menu v0.1.14 (Apache-2.0).
// Modified by oh-my-herdr: captured target, saved defaults, custom argv and launch modes.
// Fixed upstream source and license: ../../THIRD_PARTY.md; ../../LICENSE.
// Shared-state wire format is also read by the independent tabs-professional adapter.
export const DEFAULTS = "agent-launcher.defaults";
export const COMMANDS = "agent-launcher.commands";

export function captureTarget(spaces, focus) {
  const space = spaces.find(s => s.id === focus?.space) ?? spaces.find(s => s.active);
  const terminalMachine = focus?.terminal?.includes("/") ? focus.terminal.split("/")[0] : null;
  const sameTerminal = space && focus?.space === space.id && focus.terminal && terminalMachine === space.machine;
  return {
    space: space?.id ?? null,
    machine: space?.machine ?? null,
    folder: (sameTerminal ? focus.cwd : null) || space?.folder || null,
  };
}

export function customCommand(program, parameters, name) {
  const executable = program.trim();
  if (!executable || /[\0\r\n]/.test(executable)) throw new Error("Enter an executable or shell function, not a command line.");
  let args;
  try { args = JSON.parse(parameters); }
  catch { throw new Error('Arguments must be a JSON array of strings, for example ["--help"].'); }
  if (!Array.isArray(args) || args.some(arg => typeof arg !== "string" || arg.includes("\0"))) {
    throw new Error("Arguments must be a JSON array of strings without NUL characters.");
  }
  return { kind: "custom", key: "custom", name: name.trim() || executable, argv: [executable, ...args] };
}

export function agentChoice(agent) {
  return { kind: "agent", key: agent.key, name: agent.name, icon: agent.icon, tint: agent.tint };
}

export function resolveLaunch(choice, agents, custom) {
  if (choice?.kind === "custom") {
    if (!custom || custom.kind !== "custom" || !Array.isArray(custom.argv) || !custom.argv.length) {
      throw new Error("The custom command is missing. Edit it before starting a new tab.");
    }
    return customCommand(custom.argv[0], JSON.stringify(custom.argv.slice(1)), custom.name);
  }
  if (choice?.kind !== "agent") throw new Error("Choose a default agent using the star in this menu.");
  const agent = agents.find(a => a.key === choice.key);
  if (!agent) throw new Error(`${choice.name ?? choice.key} is no longer in the agent list. Choose another default.`);
  if (!agent.installed) throw new Error(`${agent.name} is not installed on this machine.`);
  if (!Array.isArray(agent.run) || !agent.run.length || agent.run.some(a => typeof a !== "string" || a.includes("\0"))) {
    throw new Error(`${agent.name} has an invalid launch command.`);
  }
  return { name: agent.name, argv: agent.run };
}

export function newTabCommand(target, launch, spaces) {
  const args = {};
  if (launch) { args.name = launch.name; args.argv = launch.argv; }
  if (target.folder) args.folder = target.folder;
  if (!target.space) return { name: "space.new", args: { ...args, machine: target.machine ?? "" } };
  const space = spaces.find(s => s.id === target.space);
  if (!space || space.machine !== target.machine) throw new Error("The original space is no longer available. Open the launch menu again.");
  return { name: "tab.new", args: { ...args, space: target.space } };
}

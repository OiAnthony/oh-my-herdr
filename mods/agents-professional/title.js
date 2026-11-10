const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

export function terminalTitle(value, program) {
  // OMP already has a program icon; its remaining title is literal task text.
  if (program?.key === "omp" && program.icon) return (value ?? "").replace(/^π(?:\s+|$)/u, "");
  return clean(value);
}

export function agentTitle(tab, lead) {
  const prog = lead?.program?.name;
  const live = terminalTitle(lead?.title, lead?.program);
  const telling = live && live !== prog && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== lead?.program?.key;
  return (tab.name === prog || !tab.named) && telling ? live : tab.name;
}

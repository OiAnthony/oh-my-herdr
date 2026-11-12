export const bytes = value => {
  if (!Number.isFinite(value)) return "—";
  if (value < 1024 ** 2) return `${Math.round(value / 1024)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
};
export const cpu = value => Number.isFinite(value) ? `${value.toFixed(1)}%` : "—";
const memoryUnits = ["KB", "MB", "GB", "TB", "PB", "EB"];
const cpuUnits = ["k", "M", "G", "T", "P", "E"];
const threeDigits = value => {
  const rounded = Number(value.toFixed(value < 10 ? 2 : value < 100 ? 1 : 0));
  return rounded.toFixed(rounded < 10 ? 2 : rounded < 100 ? 1 : 0);
};
export const footerBytes = value => {
  if (!Number.isFinite(value)) return "—";
  let size = value / 1024, unit = 0;
  while (Number(threeDigits(size)) >= 1000 && unit < memoryUnits.length - 1) { size /= 1024; unit++; }
  return `${threeDigits(size)} ${memoryUnits[unit]}`;
};
export const footerCpu = value => {
  if (!Number.isFinite(value)) return "—";
  const rounded = Number(value.toFixed(value < 100 ? 1 : 0));
  if (rounded < 1000) return `${rounded.toFixed(rounded < 100 ? 1 : 0)}%`;
  let load = value / 1000, unit = 0;
  while (Number(threeDigits(load)) >= 1000 && unit < cpuUnits.length - 1) { load /= 1000; unit++; }
  return `${threeDigits(load)}${cpuUnits[unit]}%`;
};
export const footerCpuColor = (value, theme) => {
  if (!Number.isFinite(value)) return theme.muted;
  const load = Math.max(0, Math.min(100, Number(value.toFixed(value < 100 ? 1 : 0))));
  const [from, to, weight] = load < 50
    ? [theme.ansi2, theme.ansi3, load / 50]
    : [theme.ansi3, theme.ansi1, (load - 50) / 50];
  return `#${[1, 3, 5].map(i => {
    const start = parseInt(from.slice(i, i + 2), 16), end = parseInt(to.slice(i, i + 2), 16);
    return Math.round(start + (end - start) * weight).toString(16).padStart(2, "0");
  }).join("")}`;
};
export const endpoint = port => `${port.family === "ipv6" ? `[${port.address}]` : port.address}:${port.port}`;
export const clean = text => String(text ?? "").replace(/[\u0000-\u001f\u007f]/g, " ");

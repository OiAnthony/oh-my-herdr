export const bytes = value => {
  if (!Number.isFinite(value)) return "—";
  if (value < 1024 ** 2) return `${Math.round(value / 1024)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
};
export const cpu = value => Number.isFinite(value) ? `${value.toFixed(1)}%` : "—";
export const footerCpu = value => {
  if (!Number.isFinite(value)) return "—";
  const rounded = Number(value.toFixed(value < 100 ? 1 : 0));
  return `${rounded.toFixed(rounded < 100 ? 1 : 0)}%`;
};
export const footerCpuColor = (value, theme) => {
  if (!Number.isFinite(value)) return theme.muted;
  const load = Math.max(0, Math.min(100, parseFloat(footerCpu(value))));
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

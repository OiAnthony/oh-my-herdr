const FALLBACK = "mods/open-with/icons/application.svg";

// Personal artwork wins; only fill absent or bundled neutral artwork.
export function withLocalIcons(apps, icons) {
  return apps.map(app => {
    const icon = icons[app.bundleId];
    return (!app.icon || app.icon === FALLBACK) && typeof icon === "string"
      ? { ...app, icon } : app;
  });
}

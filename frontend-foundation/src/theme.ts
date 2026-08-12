export type ServicoopTheme = "light" | "dark";

export const SERVICOOP_THEME_STORAGE_KEY = "servicoop-theme";

export function preferredServicoopTheme(): ServicoopTheme {
  const stored = window.localStorage.getItem(SERVICOOP_THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyServicoopTheme(): ServicoopTheme {
  const theme = preferredServicoopTheme();
  document.documentElement.dataset.scTheme = theme;
  return theme;
}

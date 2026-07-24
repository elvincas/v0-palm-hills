"use client";

import * as React from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "ph_theme";

// Preferencia de apariencia por dispositivo (2026-07-24) — NO es un dato de
// empresa (no vive en Supabase), es local a este navegador/PWA, igual que
// otras preferencias de UI del proyecto. `document.documentElement` ya se
// marca antes del primer paint via el script inline en layout.tsx; este hook
// solo sincroniza el estado de React con esa clase para que la UI (el toggle
// en el modal "Appearance") sepa cual esta activa.
export function useTheme() {
  const [theme, setThemeState] = React.useState<Theme>("light");

  React.useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as Theme | null) || "light";
    setThemeState(stored);
  }, []);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch { /* storage no disponible */ }
    document.documentElement.classList.toggle("dark", t === "dark");
  };

  return { theme, setTheme };
}

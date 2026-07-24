"use client";

import * as React from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "ph_theme";

// Preferencia de apariencia por dispositivo (2026-07-24) — NO es un dato de
// empresa (no vive en Supabase), es local a este navegador/PWA, igual que
// otras preferencias de UI del proyecto. `document.documentElement` se marca
// antes del primer paint via el script inline en layout.tsx, PERO eso no
// alcanza: `<html className="bg-background">` en el layout es un valor
// estatico que no refleja el tema, y la hidratacion de React reconcilia esa
// clase de vuelta a solo "bg-background" apenas hidrata — por eso el modo
// oscuro se "olvidaba" cada vez que se cerraba y reabria la PWA (bug real,
// 2026-07-24). Este `useLayoutEffect` reaplica la clase en cada montaje,
// ANTES del primer paint del navegador (a diferencia de useEffect), asi que
// gana sobre lo que haya hecho la hidratacion y no se ve flash de tema claro.
export function useTheme() {
  const [theme, setThemeState] = React.useState<Theme>("light");

  React.useLayoutEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as Theme | null) || "light";
    setThemeState(stored);
    document.documentElement.classList.toggle("dark", stored === "dark");
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

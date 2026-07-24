"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export const NAV_ICONS: Record<string, string> = {
  dash: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  cal: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
  fact: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8",
  cli: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
  inv: "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z M3.27 6.96L12 12.01l8.73-5.05 M12 22.08V12",
  ord: "M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17M17 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM9 19a2 2 0 1 0 4 0 2 2 0 0 0-4 0z",
  mej: "M12 19V5M5 12l7-7 7 7",
  usr: "M12 2c5.523 0 10 4.477 10 10s-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2zm0 9c-1.657 0-3-1.343-3-3s1.343-3 3-3 3 1.343 3 3-1.343 3-3 3zm0 1c2.21 0 4 1.79 4 4v2c0 1.1-.9 2-2 2h-4c-1.1 0-2-.9-2-2v-2c0-2.21 1.79-4 4-4z",
  pl: "M3 3v18h18 M7 15l4-6 3 4 5-8",
  com: "M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z M3.27 6.96 12 12l8.73-5.04 M12 22V12 M12 2v5 M9.5 3.5l5 3",
  ven: "M19 5L5 19 M7.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM16.5 18a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  alm: "M3 21h18 M5 21V9l7-5 7 5v12 M9 21v-6h6v6",
  emp: "M3 21h18 M6 21V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v17 M9 7h1 M9 11h1 M14 11h1 M9 15h1 M14 15h1 M17 21v-7h4v7",
  tpl: "M4 4h16v16H4z M4 9h16 M9 9v11",
  thm: "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z",
};

// Tabs visibles en el bottom nav. Mejoras y Users se movieron al menu "More"
// del header (2026-07-21): son de uso poco frecuente y asi caben P&L/Purchases
// sin saturar la barra.
export const NAV_TABS = [
  { id: "dash", label: "Home" },
  { id: "cal", label: "Calendar" },
  { id: "fact", label: "Invoices" },
  { id: "cli", label: "Clients" },
  { id: "inv", label: "Inventory" },
  { id: "ord", label: "Orders" },
  { id: "pl", label: "P&L" },
  { id: "com", label: "Purchases" },
];

// Todas las pestañas validas (incluye las que ya no estan en el bottom nav
// pero siguen siendo destinos validos via el menu "More" o un link directo).
export const ALL_TAB_IDS = [...NAV_TABS.map((t) => t.id), "mej", "usr"];

// Memoria de navegacion por pestaña: al salir de una sub-pagina (ej. el perfil
// de un cliente) hacia otra pestaña, se recuerda donde quedo el usuario para
// regresarlo ahi mismo si vuelve pronto. Pasado el limite de tiempo, la
// pestaña vuelve a abrir en su lista normal.
const LASTLOC_TTL_MS = 10 * 60 * 1000; // 10 minutos

const saveLastLoc = (tab: string, path: string) => {
  try {
    localStorage.setItem(`ph_lastloc_${tab}`, JSON.stringify({ path, ts: Date.now() }));
  } catch { /* storage no disponible */ }
};

const clearLastLoc = (tab: string) => {
  try { localStorage.removeItem(`ph_lastloc_${tab}`); } catch { /* ignore */ }
};

const readLastLoc = (tab: string): string | null => {
  try {
    const raw = localStorage.getItem(`ph_lastloc_${tab}`);
    if (!raw) return null;
    const { path, ts } = JSON.parse(raw) as { path?: string; ts?: number };
    if (!path || Date.now() - (ts || 0) > LASTLOC_TTL_MS) {
      clearLastLoc(tab);
      return null;
    }
    return path;
  } catch {
    return null;
  }
};

export function BottomNav({
  active,
  onSelect,
  hiddenTabs,
}: {
  active: string;
  onSelect?: (id: string) => void;
  hiddenTabs?: string[];
}) {
  const router = useRouter();
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    itemRefs.current[active]?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [active]);

  // Registrar la ubicacion actual como "donde quedo" la pestaña activa.
  // En la pagina principal (path "/") se limpia: estar en la lista significa
  // que la pestaña ya no debe regresar a una sub-pagina vieja.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const path = window.location.pathname;
    if (path !== "/") saveLastLoc(active, path);
    else clearLastLoc(active);
  }, [active]);

  const go = (id: string) => {
    // Volver a la sub-pagina recordada (si sigue vigente). Tocar la pestaña
    // estando YA en esa sub-pagina navega a la lista, como escape.
    const saved = readLastLoc(id);
    if (saved && saved !== window.location.pathname) {
      router.push(saved);
      return;
    }
    if (saved) clearLastLoc(id);
    if (onSelect) {
      onSelect(id);
    } else {
      router.push(`/?tab=${id}`);
    }
  };

  const tabs = NAV_TABS.filter((t) => !hiddenTabs?.includes(t.id));

  return (
    // Barra flotante en una sola caja curva (estilo Apple: cápsula translúcida
    // con margen del borde, no una barra pegada de borde a borde). El tab
    // activo lleva su propia caja verde suave adentro.
    <nav
      className="fixed left-1/2 -translate-x-1/2 w-[calc(100%-24px)] max-w-[456px] z-[5] bg-card/90 backdrop-blur-md border border-border rounded-[26px] shadow-[0_6px_20px_rgba(28,31,25,0.12)]"
      style={{ bottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
    >
      <div
        className="flex overflow-x-auto no-scrollbar gap-0.5 p-1.5"
        style={{ scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" }}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              itemRefs.current[t.id] = el;
            }}
            onClick={() => go(t.id)}
            style={{ scrollSnapAlign: "center" }}
            className={`w-[58px] shrink-0 flex flex-col items-center py-1.5 px-0.5 cursor-pointer text-[10px] gap-0.5 border-none rounded-2xl transition-colors font-sans ${
              active === t.id ? "bg-secondary text-secondary-foreground font-bold" : "bg-transparent text-muted-foreground font-normal"
            }`}
          >
            <svg
              width={19}
              height={19}
              viewBox="0 0 24 24"
              fill="none"
              stroke={active === t.id ? "var(--secondary-foreground)" : "var(--muted-foreground)"}
              strokeWidth={active === t.id ? 2 : 1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d={NAV_ICONS[t.id]} />
            </svg>
            <span className="truncate w-full text-center">{t.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

"use client";

import { useRouter } from "next/navigation";

export const NAV_ICONS: Record<string, string> = {
  dash: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  fact: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8",
  cli: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
  inv: "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z M3.27 6.96L12 12.01l8.73-5.05 M12 22.08V12",
  ord: "M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17M17 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM9 19a2 2 0 1 0 4 0 2 2 0 0 0-4 0z",
  mej: "M12 19V5M5 12l7-7 7 7",
  usr: "M12 2c5.523 0 10 4.477 10 10s-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2zm0 9c-1.657 0-3-1.343-3-3s1.343-3 3-3 3 1.343 3 3-1.343 3-3 3zm0 1c2.21 0 4 1.79 4 4v2c0 1.1-.9 2-2 2h-4c-1.1 0-2-.9-2-2v-2c0-2.21 1.79-4 4-4z",
};

export const NAV_TABS = [
  { id: "dash", label: "Inicio" },
  { id: "fact", label: "Facturas" },
  { id: "cli", label: "Clientes" },
  { id: "inv", label: "Inventario" },
  { id: "ord", label: "Ordenes" },
  { id: "mej", label: "Mejoras" },
  { id: "usr", label: "Usuarios" },
];

export function BottomNav({
  active,
  onSelect,
}: {
  active: string;
  onSelect?: (id: string) => void;
}) {
  const router = useRouter();

  const go = (id: string) => {
    if (onSelect) {
      onSelect(id);
    } else {
      router.push(`/?tab=${id}`);
    }
  };

  return (
    <nav
      className="bg-card border-t border-border flex fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] z-[5]"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {NAV_TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => go(t.id)}
          className={`flex-1 flex flex-col items-center py-2.5 px-0.5 cursor-pointer text-xs gap-1 border-none bg-transparent font-sans ${
            active === t.id ? "text-secondary-foreground font-bold" : "text-muted-foreground font-normal"
          }`}
        >
          <svg
            width={22}
            height={22}
            viewBox="0 0 24 24"
            fill="none"
            stroke={active === t.id ? "var(--secondary-foreground)" : "var(--muted-foreground)"}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d={NAV_ICONS[t.id]} />
          </svg>
          {t.label}
        </button>
      ))}
    </nav>
  );
}

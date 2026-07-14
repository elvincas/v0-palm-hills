"use client"

import { useRouter } from "next/navigation"

// Boton Back unificado para todas las paginas: rectangulito fino y minimalista
// (borde --border, fondo blanco, flecha SVG de linea). Por defecto vuelve a la
// pagina anterior del historial; si la pagina se abrio directo (sin historial),
// navega al fallback. Se puede pasar onClick para backs internos (ej. volver al
// paso anterior de un flujo sin salir de la pagina).
export function BackButton({
  fallback = "/",
  label = "Back",
  onClick,
  className = "",
}: {
  fallback?: string
  label?: string
  onClick?: () => void
  className?: string
}) {
  const router = useRouter()
  const goBack = () => {
    if (window.history.length > 1) router.back()
    else router.push(fallback)
  }
  return (
    <button
      onClick={onClick || goBack}
      className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white border border-[#e3e7dd] text-[13px] font-medium text-[#4a6741] shadow-sm active:scale-95 transition-all cursor-pointer ${className}`}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M19 12H5" />
        <path d="m12 19-7-7 7-7" />
      </svg>
      {label}
    </button>
  )
}

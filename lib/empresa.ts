// Company Profile: datos de la empresa (nombre, logo, direccion, contacto)
// editables desde la app en vez de hardcodeados — paso 2 del roadmap hacia
// una app reutilizable por otros negocios (ver memoria de sesion). Fila unica
// (id=1) en la tabla `empresa`. Compartido entre el DataContext (app/page.tsx)
// y las paginas standalone que generan documentos sin pasar por el.
export interface Empresa {
  id: number;
  nombre: string;
  logo?: string | null;
  dir?: string | null;
  ciudad?: string | null;
  estado_dir?: string | null;
  zip?: string | null;
  telefono?: string | null;
  email?: string | null;
  // Slogan corto (ej. "Beauty & Health") — reemplaza a la ciudad/estado en el
  // header de la app y se muestra junto al nombre en el header de los
  // documentos (factura/estimate/quotation), en vez de la direccion.
  eslogan?: string | null;
  // Plantillas de mensaje al cliente (2026-07-24, fase B): un mensaje libre
  // por tipo de documento, opcional — si esta vacio, el documento no muestra
  // ningun mensaje extra (los textos estructurales como la firma de entrega
  // o el disclaimer del estimate NO dependen de esto, siguen fijos).
  mensaje_factura?: string | null;
  mensaje_estimate?: string | null;
  mensaje_cotizacion?: string | null;
  mensaje_remito?: string | null;
  mensaje_nota_credito?: string | null;
  // Opciones de layout de documentos (2026-07-24, fase B2) — no es un editor
  // visual libre (eso queda para mas adelante, ver memoria de sesion), son
  // presets: posicion del logo, escala de tipografia, color de acento, y
  // mostrar/ocultar los bloques de firma/disclaimer. Aplica a factura,
  // estimate y quotation (los 3 documentos que comparten lib/pdf/documento-pdf.tsx).
  doc_logo_pos?: "left" | "center" | "right";
  doc_font_scale?: "compact" | "normal" | "large";
  doc_accent_color?: string;
  doc_show_signature?: boolean;
  doc_show_disclaimer?: boolean;
}

// Fallback si la tabla no cargo todavia (o esta vacia) — mismos datos que
// estaban hardcodeados antes, para no dejar ningun documento en blanco.
export const EMPRESA_DEFAULT: Empresa = {
  id: 1,
  nombre: "Palm Hills",
  logo: null,
  dir: null,
  ciudad: null,
  estado_dir: null,
  zip: null,
  telefono: "(551) 248-3442",
  email: "admin@palmhillsco.net",
  eslogan: "Beauty & Health",
  mensaje_factura: null,
  mensaje_estimate: null,
  mensaje_cotizacion: null,
  mensaje_remito: null,
  mensaje_nota_credito: null,
  doc_logo_pos: "left",
  doc_font_scale: "normal",
  doc_accent_color: "#4a6741",
  doc_show_signature: true,
  doc_show_disclaimer: true,
};

export const FONT_SCALE_FACTOR: Record<string, number> = { compact: 0.85, normal: 1, large: 1.15 };

export const empresaDireccion = (e: Empresa): string =>
  [e.dir, [e.ciudad, e.estado_dir].filter(Boolean).join(", "), e.zip].filter(Boolean).join(" · ");

export const empresaContacto = (e: Empresa): string =>
  [e.telefono, e.email].filter(Boolean).join("  ·  ");

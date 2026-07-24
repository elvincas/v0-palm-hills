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
  // Plantillas de mensaje al cliente (2026-07-24, fase B): un mensaje libre
  // por tipo de documento, opcional — si esta vacio, el documento no muestra
  // ningun mensaje extra (los textos estructurales como la firma de entrega
  // o el disclaimer del estimate NO dependen de esto, siguen fijos).
  mensaje_factura?: string | null;
  mensaje_estimate?: string | null;
  mensaje_cotizacion?: string | null;
  mensaje_remito?: string | null;
  mensaje_nota_credito?: string | null;
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
  mensaje_factura: null,
  mensaje_estimate: null,
  mensaje_cotizacion: null,
  mensaje_remito: null,
  mensaje_nota_credito: null,
};

export const empresaDireccion = (e: Empresa): string =>
  [e.dir, [e.ciudad, e.estado_dir].filter(Boolean).join(", "), e.zip].filter(Boolean).join(" · ");

export const empresaContacto = (e: Empresa): string =>
  [e.telefono, e.email].filter(Boolean).join("  ·  ");

# CLAUDE.md — v0-palm-hills

Sistema de gestión para negocios de salud/belleza. Desarrollado con Next.js 16 + React 19 + TypeScript + Supabase.

---

## Tech Stack

- **Framework**: Next.js 16.2.4 (App Router, client components)
- **UI**: React 19, Tailwind CSS 4, Radix UI (30+ componentes)
- **DB/Auth**: Supabase (PostgreSQL + Auth SSR)
- **PDF**: @react-pdf/renderer (server-side, rutas API) para facturas/estimates
- **Forms**: react-hook-form + zod
- **Search**: fuse.js + motor propio (lib/search.ts) con soporte fonético español
- **Excel/ZIP**: xlsx + jszip para importaciones masivas
- **Deploy**: Vercel + Supabase Cloud
- **Package manager**: SOLO npm (package-lock.json). El pnpm-lock.yaml se eliminó — si reaparece, Vercel falla con ERR_PNPM_OUTDATED_LOCKFILE

---

## Estructura de Carpetas

```
app/
  page.tsx                  # Componente monolítico principal (~6900 líneas) — todos los tabs
  layout.tsx                # Root layout con Vercel Analytics + apple-touch-icon
  auth/                     # Login, sign-up, callback OAuth
  api/admin/users/          # API admin-only para gestión de usuarios
  api/facturas/[id]/pdf/    # PDF de factura generado server-side (auth requerida)
  api/ordenes/[id]/pdf/     # PDF de estimate generado server-side
  clientes/[id]/            # Perfil de cliente, nueva-orden, estado-cuenta
  ordenes/[id]/estimado/    # Vista de estimate (el pick se hace en el tab Ordenes)
  facturas/[id]/            # Detalle de factura (pagos, revertir, PDF)
  notas-credito/[id]/       # Documento de nota de crédito + aplicar a factura
  remitos/[id]/             # Documento de remito imprimible (Castillo)
components/
  bottom-nav.tsx            # Navegación inferior mobile (píldora activa)
  ui/                       # Componentes Radix UI estilizados (50+)
lib/
  supabase/client.ts        # Cliente browser
  supabase/server.ts        # Cliente SSR (usado por las rutas de PDF)
  pdf/documento-pdf.tsx     # Generador PDF compartido factura/estimate (@react-pdf)
  search.ts                 # Motor de búsqueda avanzado con Levenshtein + fonética
  delivery.ts               # Helpers de fechas de entrega
  print.ts                  # (legacy) utilidades de impresión
  utils.ts                  # cn() para merge de clases CSS
scripts/
  test-pdf.ts               # Test del PDF: npx tsx scripts/test-pdf.ts (paginación, headers)
hooks/
  use-mobile.ts             # Detección de pantalla mobile
  use-toast.ts              # Notificaciones toast
supabase/
  functions/backup-database/ # Cloud function de respaldo
```

---

## Tabs / Pantallas Principales

| Tab | Descripción |
|-----|-------------|
| **Home** | Dashboard con meta de ventas (localStorage: `ph_meta_YYYY-MM`), métricas, últimas facturas, log de actividad |
| **Clientes** | CRUD clientes, importación Excel, foto de local, código auto-numérico (`01-0001`) |
| **Inventario** | Dual almacén (palmhills / castillo), fotos, SKU, stock mínimo, importación masiva Excel+ZIP |
| **Facturas** | Sub-tabs Facturas, Notas de Crédito y Remitos; sin impuestos; detalle con pagos |
| **Ordenes** | Flujo orden → pick → factura, envíos parciales por almacén |
| **Calendario** | Fechas de entrega (🚚), visitas, cobros, pedidos; los eventos alimentan el selector de fecha en órdenes/facturas |
| **Mejoras** | Backlog de tareas internas con prioridad y costo estimado |
| **Users** | Solo admin — gestión de usuarios en Supabase Auth |

---

## Modelos de Datos (tablas Supabase)

### `clientes`
`id`, `nom`, `codigo_cliente` (formato `01-0001`), `tel`, `email`, `dir`, `ciudad`, `estado_dir`, `contacto`, `estado` (Active/Inactive/Waiting), `abierto_sabados`, `foto_local` (base64), `lista_precio_id` (→ listas_precios, nullable)

### `productos`
`id`, `nom`, `sku`, `barcode`, `fabricante`, `etiquetas` (string[]), `precio`, `costo`, `cajas`, `stock`, `min`, `foto` (base64), `almacen` (palmhills | castillo | null)

### `facturas`
`id`, `num` (empieza en 1001), `cli` (nombre string), `fecha`, `estado` (Pending/Partially Paid/Paid), `total`, `lineas` (LineaFactura[]), `pagos` ([{monto, fecha, nota?, metodo?}] — metodo: Cash/Zelle/Check/Card/Bank Transfer/Credit), `orden_id` (orden que la generó, para revertir)

### `ordenes`
`id`, `num` (empieza en 1), `cli`, `fecha`, `estado` (Pending/In Progress/Completed), `total`, `lineas` (LineaOrden[])

### `notas_credito`
`id`, `num`, `cli`, `fecha`, `monto`, `motivo`, `tipo` (amount|product), `lineas` (LineaNC[]), `aplicada` (bool), `aplicada_en` (texto), `aplicada_fecha`, `aplicada_factura_id`. Al aplicar a una factura se registra como pago (metodo "Credit") en ella; aplicada NO resta del balance global del cliente.

### `remitos`
`id`, `num` (empieza en 5001), `orden_id`, `orden_num`, `cli`, `fecha`, `lineas`, `enviado` (bool), `fecha_envio`. Se generan al completar pick de órdenes Castillo.

### `todos`
`id`, `texto`, `cliente_id`, `cliente_nom`, `fecha_limite`, `completado`, `created_at` — to-dos del dashboard y perfil de cliente.

### `config`
Tabla key/value (RLS authenticated). Keys: `remito_email` (correo fijo de remitos), `meta_YYYY-MM` (sales goal mensual — sobrevive reinstalar la PWA).

### `listas_precios`
`id`, `nombre`, `precios` (jsonb `{prodId: precio}`). Precios especiales por cliente: `clientes.lista_precio_id` apunta a UNA lista (o null = precios base). New Order / New Invoice / Edit Order usan el precio de lista como base automática (se muestra en dorado); el ajuste manual por línea va por encima. Gestión: botón "Lists" en Inventario (precios + asignación de clientes) y selector en el perfil del cliente.

### `mejoras`
`id`, `titulo`, `descripcion`, `costo`, `prioridad` (High/Medium/Low), `estado` (Pending/In Progress/Completed)

### `eventos_calendario`
`id`, `fecha` (YYYY-MM-DD), `tipo` (delivery/visit/collect_money/order_request), `cliente_id` (nullable)

### `actividad`
`msg`, `ts` — log de eventos del sistema (todo CRUD escribe aquí)

---

## LineaFactura / LineaOrden

```ts
// LineaFactura
{ prodNom, sku, barcode, qty, precio, precioOriginal, almacen }

// LineaOrden
{ prodId, prodNom, barcode, sku, precio, precioFinal, qty, qtyEnviada, picked, almacen }
```

---

## Estado Global — DataContext

`DataProvider` en `app/page.tsx` expone:

**Colecciones**: `clientes`, `productos`, `facturas`, `notasCredito`, `ordenes`, `mejoras`, `eventosCalendario`, `logs`

**Computed**: `proximasFechasEntrega` (fechas futuras de tipo "delivery")

**Usuario**: `role` (admin | visitante), `readOnly` (true si visitante)

**Mutaciones**: `addCliente`, `updateCliente`, `deleteCliente`, `addClientesBulk`, `addProducto`, `updateProducto`, `deleteProducto`, `addProductosBulk`, `updateProductoFoto`, `addFactura`, `deleteFactura`, `addNotaCredito`, `deleteNotaCredito`, `addOrden`, `updateOrden`, `deleteOrden`, `addMejora`, `updateMejora`, `deleteMejora`, `addEvento`, `deleteEvento`, `refreshLogs`

**Hooks propios**: `useData()`, `usePagedList(list, resetDeps?, pageSize=40)`

---

## Patrones Importantes

### Carga de fotos en segundo plano
Las fotos (base64) se cargan en lotes de 20 para evitar timeouts de Supabase. El estado inicial se carga sin fotos.

### PostgREST pagination
Tablas grandes usan `range()` manual (1000 filas por request).

### Numeración
- Facturas: empiezan en **1001**
- Órdenes: empiezan en **1**
- Clientes: código formato `XX-XXXX` (e.g., `01-0001`)

### Almacenes
Dos almacenes: `palmhills` (default) y `castillo`. El campo `almacen` en `productos` y en líneas de factura/orden indica el origen.

### Nombres de producto (2026-07-21)
Los nombres de producto se muestran SIEMPRE en mayúscula visualmente (clase `uppercase`, o `.toUpperCase()` en el PDF de `lib/pdf/documento-pdf.tsx` porque `@react-pdf/renderer` no soporta `textTransform`) — el dato en `productos.nom` NO se modifica, solo la presentación. Aplica en Inventario, New/Edit Order, pick sheet, New Invoice, Credit Notes, y en los documentos del cliente (factura/estimate, remito, nota de crédito). Nuevos lugares que rendericen `prodNom`/`p.nom` deben seguir esta convención. Además, no se trunca con `truncate`/"…" — se usa `break-words` para mostrar el nombre completo (excepto el badge diminuto sobre la foto del Top 3 en Home, donde el nombre completo ya se ve debajo).

### Búsqueda avanzada (lib/search.ts)
- Levenshtein con tolerancia según longitud del token
- Variantes fonéticas español: z/c→s, qu→k, v→b, h→"", y/ll→i
- Boost a coincidencias exactas y prefix

### Estilo UI (rediseño 2026-07-10, aprobado por mockup)
- Minimalista tipo Routific/Apple: un solo acento verde `#4a6741`; dorado `#b09060` solo como firma (números de documento, chips almacén)
- Superficies planas: tarjetas blancas, borde `--border #e3e7dd`, sombra sutil — el glassmorphism quedó solo en piezas viejas
- Iconos SVG de línea en botones de acción (NO emoji); los emoji 🏰/🌴 de almacén SÍ se quedan (identidad, pedido explícito)
- Toolbars de documentos: una fila de botones idénticos flex-1 estilo tab bar (icono arriba + etiqueta), tintes por acción (dorado/verde/azul/rojo)
- Chips de estado: tint suave + punto (`Badge` en page.tsx); listas de facturas/NC/remitos en formato 3 columnas apiladas uniforme
- Fondo `--background #f2f4ee` (verde-neutro); bottom nav con píldora activa
- SKUs SIEMPRE en mono gris (el usuario rechazó cambiarles color/fuente)
- **El usuario exige simetría y alineación perfecta en toda la UI** — mismos altos, filas llenas sin huecos, revisar en móvil ~390px
- Mobile-first, max-width 480px, safe-area insets; pull-to-refresh propio en todos los tabs (spinner iOS + anillo de progreso, threshold 80px)

### Impresión / PDF (definitivo 2026-07-11)
NO usar `window.print()`: iOS/WebKit no repite `<thead>` ni respeta cortes de página. Los botones Print/PDF hacen fetch a `/api/facturas/[id]/pdf` o `/api/ordenes/[id]/pdf` (generación con @react-pdf/renderer, size LETTER, header `<View fixed>` repetido por página) y abren el **share sheet nativo** con el archivo (`navigator.share({files})`) → opción Print/Save/AirDrop. Test: `npx tsx scripts/test-pdf.ts`.

### Descuento de lista de precios en documentos (2026-07-20)
Facturas y estimates guardan `precioCatalogo` por línea (precio de catálogo puro, sin lista) además de `precio`/`precioOriginal`. En `/facturas/[id]` y `/ordenes/[id]/estimado` hay un switch **"Show list price as discount"** (encendido por defecto, solo aparece si hay descuento de lista que revelar) que decide si el precio tachado es el de catálogo (revela también el descuento de la lista) o el histórico (solo el ajuste manual línea por línea). El PDF respeta el mismo switch vía `?listDiscount=1|0`. Documentos viejos sin `precioCatalogo` lo completan al vuelo con un query a `productos` (por `prodId` en órdenes; por SKU+almacén o nombre en facturas, que no guardan `prodId`).

### Aging Report (2026-07-20)
Botón junto al buscador de Invoices → `/reportes/facturas-pendientes`: lista facturas Pending/Partially Paid ordenadas por antigüedad (+30 días resaltadas en rojo), con toggle "By age" (plano) / "By client" (agrupado, clientes con la factura pendiente más vieja primero). PDF vía `/api/reportes/facturas-pendientes/pdf?groupBy=flat|client` (mismo patrón @react-pdf; al ser tabla que fluye no necesita la paginación manual de facturas/estimates). Test: `npx tsx scripts/test-reporte-cartera.ts`.

### Top Clients (score honesto)
`calcTopClientes` en page.tsx: score = 60% volumen + 40% pago (pago = %pagado × speedFactor30: COD≤2d=1.0, 3-30d 0.9→0.7, >30d cae a 0.4→0.1). Se muestra en Home, modal en Clientes; `calcTopProductos` alimenta Home + modal en Inventario (1m/3m) + top 25% en perfil de cliente.

### Cargas paginadas
Toda carga con `.range()` DEBE ordenar con `.order(col).order("id")` — miles de productos comparten `created_at` y sin desempate PostgREST duplica/salta filas.

---

## Variables de Entorno

```
NEXT_PUBLIC_SUPABASE_URL=https://fpzurpkszplgqarpozmt.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
```

---

## Configuración Notable

```js
// next.config.mjs
{
  typescript: { ignoreBuildErrors: true },  // Build no falla por errores de tipos
  images: { unoptimized: true }             // Sin optimización de imágenes en Vercel
}
```

---

## Deuda Técnica Conocida

- `app/page.tsx` es un componente monolítico de ~6900 líneas (todos los tabs en uno)
- Sin framework de tests (solo `scripts/test-pdf.ts` para el PDF, correr con tsx)
- Error handling básico con `alert()` (sin error boundaries)
- Casi todas las queries son client-side directas a Supabase (solo los PDFs tienen ruta API)
- TypeScript con `ignoreBuildErrors: true`
- Rol visitante se valida solo en UI — RLS permite escribir a cualquier usuario autenticado
- Pendiente: envío de remitos por Gmail con PDF adjunto (esperando App Password de admin@palmhillsco.net)

---

## Deploy

- **Plataforma**: Vercel
- **URL producción**: https://v0-palm-hills.vercel.app
- **Backend**: Supabase Cloud
- **Analytics**: Vercel Analytics (solo producción)

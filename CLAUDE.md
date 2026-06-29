# CLAUDE.md — v0-palm-hills

Sistema de gestión para negocios de salud/belleza. Desarrollado con Next.js 16 + React 19 + TypeScript + Supabase.

---

## Tech Stack

- **Framework**: Next.js 16.2.4 (App Router, client components)
- **UI**: React 19, Tailwind CSS 4, Radix UI (30+ componentes)
- **DB/Auth**: Supabase (PostgreSQL + Auth SSR)
- **Forms**: react-hook-form + zod
- **Search**: fuse.js + motor propio (lib/search.ts) con soporte fonético español
- **Excel/ZIP**: xlsx + jszip para importaciones masivas
- **Deploy**: Vercel + Supabase Cloud

---

## Estructura de Carpetas

```
app/
  page.tsx                  # Componente monolítico principal (~5800 líneas) — todos los tabs
  layout.tsx                # Root layout con Vercel Analytics
  auth/                     # Login, sign-up, callback OAuth
  api/admin/users/          # API admin-only para gestión de usuarios
  clientes/[id]/            # Perfil de cliente, nueva-orden, estado-cuenta (PDF)
  ordenes/[id]/             # pick-sheet (fulfillment), estimado
  facturas/[id]/            # Detalle de factura
components/
  bottom-nav.tsx            # Navegación inferior mobile (8 tabs)
  ui/                       # Componentes Radix UI estilizados (50+)
lib/
  supabase/client.ts        # Cliente browser
  supabase/server.ts        # Cliente SSR
  search.ts                 # Motor de búsqueda avanzado con Levenshtein + fonética
  delivery.ts               # Helpers de fechas de entrega
  print.ts                  # Utilidades de impresión/PDF
  utils.ts                  # cn() para merge de clases CSS
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
| **Facturas** | Sub-tabs Facturas y Notas de Crédito, IVA 16%, detalle con pagos |
| **Ordenes** | Flujo orden → pick → factura, envíos parciales por almacén |
| **Calendario** | Fechas de entrega (🚚), visitas, cobros, pedidos; los eventos alimentan el selector de fecha en órdenes/facturas |
| **Mejoras** | Backlog de tareas internas con prioridad y costo estimado |
| **Users** | Solo admin — gestión de usuarios en Supabase Auth |

---

## Modelos de Datos (tablas Supabase)

### `clientes`
`id`, `nom`, `codigo_cliente` (formato `01-0001`), `tel`, `email`, `dir`, `ciudad`, `estado_dir`, `contacto`, `estado` (Active/Inactive/Waiting), `abierto_sabados`, `foto_local` (base64)

### `productos`
`id`, `nom`, `sku`, `barcode`, `fabricante`, `etiquetas` (string[]), `precio`, `costo`, `cajas`, `stock`, `min`, `foto` (base64), `almacen` (palmhills | castillo | null)

### `facturas`
`id`, `num` (empieza en 1001), `cli` (nombre string), `fecha`, `estado` (Pending/Paid/In Review/Completed), `total`, `lineas` (LineaFactura[]), `pagos` ([{monto, fecha, nota?}])

### `ordenes`
`id`, `num` (empieza en 1), `cli`, `fecha`, `estado` (Pending/In Progress/Completed), `total`, `lineas` (LineaOrden[])

### `notas_credito`
`id`, `num`, `cli`, `fecha`, `monto`, `motivo`

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

### Búsqueda avanzada (lib/search.ts)
- Levenshtein con tolerancia según longitud del token
- Variantes fonéticas español: z/c→s, qu→k, v→b, h→"", y/ll→i
- Boost a coincidencias exactas y prefix

### Estilo UI
- **Glassmorphism**: `backdrop-blur-md bg-white/50 border border-white/60 shadow-sm`
- Colores: oklch() en CSS variables, soporte dark mode
- Mobile-first, max-width 480px, safe-area insets para notch
- Bottom sheet modals con backdrop blur

### Impresión / PDF en iOS PWA
Usa `navigator.share` (Web Share API) en lugar de `window.print()` cuando está disponible (fix para iOS).

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

- `app/page.tsx` es un componente monolítico de ~5800 líneas (todos los tabs en uno)
- No hay tests (sin Jest/Vitest)
- Error handling básico con `alert()` (sin error boundaries)
- Todas las queries son client-side directas a Supabase (sin capa de API)
- TypeScript con `ignoreBuildErrors: true`

---

## Deploy

- **Plataforma**: Vercel
- **URL producción**: https://v0-palm-hills.vercel.app
- **Backend**: Supabase Cloud
- **Analytics**: Vercel Analytics (solo producción)

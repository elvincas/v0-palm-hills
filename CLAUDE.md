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
| **Ordenes** | Sub-tabs Orders/Quotations. Orders: flujo orden → pick → factura, envíos parciales por almacén. Quotations: cotizaciones independientes que no reservan inventario (ver tabla `cotizaciones`) |
| **Calendario** | Fechas de entrega (🚚), visitas, cobros, pedidos; los eventos alimentan el selector de fecha en órdenes/facturas |
| **P&L** | Reporte de utilidad por periodo + gestión de gastos operativos pagados |
| **Purchases** | Ingresado de inventario: facturas de compra a proveedores, actualiza stock y costo |
| **Mejoras** | Backlog de tareas internas con prioridad y costo estimado — accesible desde el menú "More" (⋯) del header, no en el bottom nav |
| **Users** | Solo admin — gestión de usuarios en Supabase Auth — accesible desde el menú "More" (⋯) del header |

**Navegación (2026-07-21):** el bottom nav muestra `dash, cal, fact, cli, inv, ord, pl, com` (`components/bottom-nav.tsx` → `NAV_TABS`). Mejoras y Users se movieron a un menú desplegable "More" (botón ⋯ en el header de `app/page.tsx`) porque son de uso poco frecuente — decisión explícita del usuario para no saturar el bottom nav al agregar P&L/Purchases. `ALL_TAB_IDS` (superset que incluye `mej`/`usr`) es lo que valida el parámetro `?tab=` en la URL — si se agregan tabs nuevos que no van en el bottom nav, hay que añadirlos ahí también o el deep-link no los reconoce.

---

## Modelos de Datos (tablas Supabase)

### `clientes`
`id`, `nom`, `codigo_cliente` (formato `01-0001`), `tel` (teléfono principal), `email`, `dir`, `ciudad`, `estado_dir`, `contacto`, `estado` (Active/Inactive/Waiting), `abierto_sabados`, `foto_local` (base64), `lista_precio_id` (→ listas_precios, nullable), `vendedor_id` (→ vendedores, nullable, ver tabla `vendedores` abajo), `fax`, `telefonos` (jsonb `TelefonoContacto[]`: `{rol, nombre?, establecimiento?, num}` — contactos adicionales del cliente, ej. "Manager · Store #2 — Pete — (551) 248-3442"; `rol` es de una lista fija en `ROLES_TELEFONO` (Store/Owner/Manager/Payments/Places orders). Todo número (principal y adicionales) se formatea en vivo a `(xxx) xxx-xxxx` con `formatPhone()` — 2026-07-21, definida por duplicado en `app/page.tsx` y `app/clientes/[id]/page.tsx`, mismo patrón que otros helpers puros del proyecto)

### `vendedores` (2026-07-23)
`id`, `nombre`, `prefijo` (2 dígitos, unique — el mismo prefijo que ya usaba `codigo_cliente`), `comision_venta_pct`, `comision_cobro_pct` (dos porcentajes independientes, pedido explícito del usuario: "1% por ventas, 1% por cobros" no tienen que ser iguales), `base_comision` (`venta`|`cobros`|`ambas` — decide qué línea(s) se muestran como "la" comisión en el reporte), `activo`. RLS: select para cualquier authenticated, write bloqueado a `visitante` (mismo patrón que `compras`/`gastos`).

- **Numeración de clientes por vendedor**: antes `nextCodigoCliente` buscaba el máximo número global sin importar el prefijo (bug latente: si dos vendedores existieran, uno le robaría numeración al otro). Ahora `nextCodigoClienteFor(prefijo)` en el componente `Clientes` calcula el siguiente número SOLO dentro de ese prefijo — un vendedor nuevo (ej. `02`) empieza en `02-0001` sin pisar al `01`.
- **Asignación**: el selector de vendedor solo aparece al CREAR un cliente (en el formulario de Clientes) — recalcula `codigo_cliente` en vivo al cambiar de vendedor. Editar un cliente existente NO permite cambiar de vendedor ahí (para no confundir con renumerar su código ya asignado); la reasignación de vendedor de un cliente existente se hace en su perfil (`/clientes/[id]`, guardado instantáneo igual que Price List) y NUNCA toca `codigo_cliente` — solo decide a quién se le acredita la comisión de ahí en adelante.
- **Reporte de comisión**: pantalla "Salespeople" (`VendedoresModal` en `app/page.tsx`), accesible desde el menú More (⋯) y con botón de acceso rápido en el tab Clientes. Selector de periodo (mismo patrón que P&L: presets + rango custom). Por cada vendedor: `venta` = suma de `facturas.total` con `fecha` en rango para clientes de ese vendedor (por nombre, ya que `facturas.cli` es texto no id); `cobro` = suma de `pagos[].monto` con fecha de pago en rango para esas mismas facturas. Comisión = cada total × su propio porcentaje; se muestra según `base_comision` (una línea, la otra, o ambas).
- **Seed inicial**: "Stephanie Beltrán", prefijo `01`, 1%/1%, `ambas` — los 91 clientes existentes (todos ya usaban prefijo `01`) se le asignaron automáticamente en la migración.

### `productos`
`id`, `nom`, `sku`, `barcode`, `fabricante`, `etiquetas` (string[]), `precio`, `costo`, `cajas`, `stock`, `min`, `foto` (base64), `almacen` (palmhills | castillo | null), `categorias` (jsonb `{categoriaId: valores[]}`, ver `categorias` abajo)

### `facturas`
`id`, `num` (empieza en 1001), `cli` (nombre string), `fecha`, `estado` (Pending/Partially Paid/Paid), `total`, `lineas` (LineaFactura[]), `pagos` ([{monto, fecha, nota?, metodo?}] — metodo: Cash/Zelle/Check/Card/Bank Transfer/Credit), `orden_id` (orden que la generó, para revertir)

### `ordenes`
`id`, `num` (empieza en 1), `cli`, `fecha`, `estado` (Pending/In Progress/Completed), `total`, `lineas` (LineaOrden[])

### `notas_credito`
`id`, `num`, `cli`, `fecha`, `monto`, `motivo`, `tipo` (amount|product), `lineas` (LineaNC[]), `aplicada` (bool), `aplicada_en` (texto), `aplicada_fecha`, `aplicada_factura_id`. Al aplicar a una factura se registra como pago (metodo "Credit") en ella; aplicada NO resta del balance global del cliente.

### `remitos`
`id`, `num` (empieza en 5001), `orden_id`, `orden_num`, `cli`, `fecha`, `lineas`, `enviado` (bool), `fecha_envio`. Se generan al completar pick de órdenes Castillo. **RLS estaba deshabilitado por completo (0 policies) hasta el 2026-07-23** — era la única tabla operativa del proyecto sin row level security, cualquiera con la anon key podía leer/escribir sin autenticarse. Se habilitó con policies select/insert/update/delete para `authenticated`, mismo patrón permisivo que `facturas` (sin bloqueo por rol, ya que remitos se generan en el mismo flujo de `completePick`). Si se crea una tabla nueva, verificar SIEMPRE `alter table ... enable row level security` + las 4 policies — ver también el caso de `eventos_calendario` arriba (le faltaba la de UPDATE).

### `todos`
`id`, `texto`, `cliente_id`, `cliente_nom`, `fecha_limite`, `completado`, `created_at` — to-dos del dashboard y perfil de cliente.

### `config`
Tabla key/value (RLS authenticated). Keys: `remito_email` (correo fijo de remitos), `meta_YYYY-MM` (sales goal mensual — sobrevive reinstalar la PWA).

### `listas_precios`
`id`, `nombre`, `precios` (jsonb `{prodId: precio}`). Precios especiales por cliente: `clientes.lista_precio_id` apunta a UNA lista (o null = precios base). New Order / New Invoice / Edit Order usan el precio de lista como base automática (se muestra en dorado); el ajuste manual por línea va por encima. Gestión: botón "Lists" en Inventario (precios + asignación de clientes) y selector en el perfil del cliente.

### `mejoras`
`id`, `titulo`, `descripcion`, `costo`, `prioridad` (High/Medium/Low), `estado` (Pending/In Progress/Completed)

### `eventos_calendario`
`id`, `fecha` (YYYY-MM-DD), `tipos` (jsonb `TipoEvento[]`: delivery/visit/collect_money/order_request — 2026-07-21, antes era `tipo` singular; columna vieja sigue en la tabla sin usarse, solo por si acaso — **era NOT NULL y rompía todo INSERT nuevo** hasta que se le quitó la restricción el 2026-07-22, ver [[bugs_conocidos]]), `cliente_id` (nullable), `nota`. Un evento puede tener varios tipos a la vez (ej. Collect money + Order request en una sola visita) salvo "delivery", que siempre va solo y sin cliente. Tocar un evento en el día seleccionado del Calendario abre el mismo modal en modo edición (`updateEvento`) — antes solo se podía borrar con la "x", nunca leer la nota completa ni editar. RLS: recordar que un CRUD completo necesita las 4 policies (SELECT/INSERT/UPDATE/DELETE) — a esta tabla le faltó la de UPDATE hasta el 2026-07-22 (editar un evento fallaba con "cannot coerce the result to a single JSON object"). Consultas por delivery: NO usar `.contains('tipos', ['delivery'])` — el operador `cs` de PostgREST no resolvía bien un array de strings contra esta columna jsonb y dejaba el picker de fecha de New Order sin ningún día seleccionable (bug real, detectado el día después de la migración a `tipos`). Traer los eventos futuros (tabla chica) con `.select('fecha, tipos')` y filtrar `tipos.includes('delivery')` en el cliente.

### `actividad`
`msg`, `ts` — log de eventos del sistema (todo CRUD escribe aquí)

### `gastos` (2026-07-21)
`id`, `categoria` (texto, ver `CATEGORIAS_GASTO` en page.tsx), `descripcion`, `monto`, `fecha` (fecha del gasto/vencimiento), `pagado` (bool), `fecha_pago`, `comprobante` (foto base64, opcional). RLS bloquea escritura a rol `visitante` (igual patrón que `mejoras`). Solo los gastos con `pagado = true` cuentan en el P&L, filtrados por `fecha_pago` dentro del periodo — un gasto fijo sin pagar (ej. renta pendiente) NO aparece como gasto todavía (pedido explícito del usuario).

### `categorias` (2026-07-21, filtro de almacén 2026-07-23)
`id`, `nombre` (ej. "Tipo de Negocio"), `valores` (jsonb string[], ej. `["Farmacias","Supermercados","Beauty Supply","Botanica","99 Cents"]`). Los productos guardan a cuáles valores pertenecen en `productos.categorias` (`{categoriaId: valores[]}`) — un producto puede tener varios valores de la misma categoría y pertenecer a varias categorías. Gestión: botón "🗂️ Categories" en Inventario (mismo patrón bidireccional que "Lists": crear categoría → agregar valores → buscar y asignar productos a un valor) y sección "Categories" en el edit de un producto existente (chips seleccionables, toggle instantáneo vía `setProductoCategoriaValor`, no espera al Save del form). El picker de productos (dentro de un valor) tiene un filtro All/Palm Hills/Castillo además del buscador (que también busca por marca) — antes solo mostraba los primeros 40 productos (los ya asignados + relleno) sin forma de ver el resto sin escribir en el buscador; ahora pagina con `usePagedList`/`LoadMoreButton` como el resto de la app (mismo fix aplicado a los pickers de producto y cliente en `listas_precios`). RLS: visitante lee, no escribe (igual que `mejoras`/`gastos`/`compras`). Piloto sembrado: categoría "Tipo de Negocio" con los 5 valores de ejemplo.

### Brands (2026-07-23)
Botón "🏭 Brands" en Inventario (`MarcasModal`), mismo esquema bidireccional que Categories pero opera directo sobre `productos.fabricante` (string simple, UN valor por producto) en vez del jsonb multi-valor de `categorias` — no hay tabla propia, la lista de marcas se deriva de los valores distintos ya presentes en `fabricante` entre los productos. Flujo: escribir un nombre de marca (ej. Karseell, Hair Plus, Olaplex) → se abre su picker de productos (mismo filtro de almacén + búsqueda que Categories) → tocar un producto asigna esa marca (sobreescribe cualquier marca previa) o la quita. Mutación dedicada `setProductoFabricante(prodId, fabricante)` (update dirigido, mismo patrón que `setProductoCategoriaValor`). El campo se llama "Brand" en el UI (antes "Manufacturer") — mismo dato, el usuario lo usa para organizar productos por marca comercial y así asignarlos más rápido a los tipos de negocio en Categories. **Rename (2026-07-23)**: botón "Rename" junto a "Delete brand" en el detalle de una marca — renombra en bloque el `fabricante` de todos los productos que la tenían asignada (ej. "Capilo Español" → "Capilo"), reutilizando `setProductoFabricante` por producto.

### `compras` (Ingresado de Inventario, 2026-07-21)
`id`, `num` (auto-incremental, empieza en 1), `proveedor` (texto libre), `num_factura_proveedor` (referencia opcional de la factura del proveedor), `fecha`, `total`, `lineas` (jsonb `LineaCompra[]`: `{prodId, prodNom, sku, qty, costoUnitario, almacen}`), `nota`, `comprobante` (text, data URI base64 — foto/PDF/Excel de la factura del proveedor, 2026-07-22), `comprobante_nombre` (nombre original del archivo). RLS bloquea escritura a `visitante`. Al guardar (`addCompra` en el DataContext): suma `qty` al stock de cada producto (solo `palmhills`, `castillo` no lleva stock en vivo — mismo criterio que `ajustarInventario`) y sobrescribe `productos.costo` con el `costoUnitario` más reciente de cada línea. No hay snapshot histórico de costo por compra — el costo del producto es siempre "el más reciente conocido". El comprobante: fotos se reducen con `compressComprobante` (mismo compresor de gastos), PDF/Excel se guardan sin comprimir (límite 5MB); el tipo se detecta leyendo el prefijo `data:<mime>` del data URI, no hay columna de mime type separada.

### `almacenes` (2026-07-23)
`id` (text, PK — el slug, ej. `"palmhills"`, no un uuid: así no hace falta migrar ningún dato existente), `nombre`, `icono` (emoji), `lleva_stock` (bool), `orden` (int, define cuál es el "principal"/default), `activo` (bool). RLS: select para cualquier `authenticated`, write bloqueado a `visitante` (igual que `compras`/`gastos`). Ver sección "Almacenes" en Patrones Importantes para el detalle completo de `lleva_stock` y los helpers.

### `empresa` (Company Profile, 2026-07-24)
Fila única (`id=1`, constraint que lo obliga). `nombre`, `logo` (text, data URI base64 PNG), `dir`, `ciudad`, `estado_dir`, `zip`, `telefono`, `email`, `eslogan` (2026-07-24, texto corto ej. "Beauty & Health"). RLS: select para cualquier `authenticated` (todos necesitan verla para los documentos), write bloqueado a `visitante`. Sembrada con los datos que antes estaban escritos directo en el código (Palm Hills, `(551) 248-3442`, `admin@palmhillsco.net`, eslogan "Beauty & Health") — mientras nadie edite Company Profile, todo se ve exactamente igual que antes. Tipo + `EMPRESA_DEFAULT` (fallback) en `lib/empresa.ts`, compartido entre el DataContext y las páginas standalone que generan documentos.

**Eslogan (2026-07-24):** reemplaza a ciudad/estado en el header de la app (antes mostraba `[ciudad, estado_dir]` debajo del nombre, ahora `empresa.eslogan`) y se agrega como línea nueva (itálica, gris) entre el nombre y el teléfono/email en el header de factura/estimate/quotation (pantalla + PDF) — remito y nota de crédito no lo llevan, mismo alcance que Layout options. Campo editable en Company Profile.

**Document Templates (fase B, 2026-07-24):** la misma fila de `empresa` tiene 5 columnas `mensaje_factura`/`mensaje_estimate`/`mensaje_cotizacion`/`mensaje_remito`/`mensaje_nota_credito` (texto libre, nullable) — un mensaje opcional al cliente por tipo de documento, editable en "Document Templates" (menú More). Se muestra como bloque adicional (fondo `#f2f4ee`, itálica) junto al contenido estructural fijo (firma de entrega de la factura, disclaimer del estimate/quotation) — NO lo reemplaza. Wireado en: factura y estimate (pantalla + PDF), quotation (pantalla + PDF), remito y nota de crédito (solo pantalla, esos dos usan `window.print()` en vez de un PDF de servidor).

**Layout options (fase B2, 2026-07-24):** el usuario pidió un editor visual completo (drag/resize de cuadros, posición libre del logo, etc.) — se evaluó como un proyecto grande comparable al storefront (requeriría un canvas editor + rearquitecturar el renderer a data-driven) y el usuario, dado a elegir, prefirió esto ahora y el editor visual libre más adelante ("Ambos: opciones ahora, visual después" — el editor visual sigue diferido, no iniciar sin que lo pida). Se implementó como **presets**, no posición libre: 5 columnas más en `empresa` — `doc_logo_pos` (left/center/right), `doc_font_scale` (compact/normal/large), `doc_accent_color` (hex), `doc_show_signature` (bool, firma de entrega en factura), `doc_show_disclaimer` (bool, disclaimer de estimate/quotation). Controles en la misma pantalla "Document Templates" (menú More), arriba de Client Messages. Aplica solo a **factura, estimate y quotation** (los 3 documentos que comparten `lib/pdf/documento-pdf.tsx`) — remito y nota de crédito quedan fuera a propósito, mismo alcance que fase B.

- **PDF** (`lib/pdf/documento-pdf.tsx`): el `StyleSheet.create()` estático se volvió una función `makeStyles(accent, scale)` invocada por render (`f(n, scale)` escala cada `fontSize`/tamaño de logo). `doc_font_scale` se traduce a número vía `FONT_SCALE_FACTOR` (`lib/empresa.ts`: compact=0.85, normal=1, large=1.15) antes de pasarlo al renderer. El dorado (`#b09060`) del título "ESTIMATE"/"QUOTATION" NO es personalizable a propósito (convención ya existente "dorado solo como firma") — solo el título de INVOICE y el resto de los acentos (borde de header, totales, "Thank you") usan `doc_accent_color`.
- **Pantalla (HTML)**: como Tailwind no soporta clases arbitrarias dinámicas en runtime, el color de acento se aplica con `style={{ color/borderColor: empresa.doc_accent_color }}` inline encima de las clases Tailwind existentes, solo en los elementos del documento impreso (borde+título de header, línea de descuento, borde+monto de total, firma/"gracias") — nunca en el chrome de la app (botones Back/Print, chips de método de pago), que se queda siempre verde fijo. Wireado en `facturas/[id]`, `ordenes/[id]/estimado`, `cotizaciones/[id]` (mismos 3 documentos que el PDF).
- Todos los campos son opcionales con default seguro (`|| "#4a6741"`, `|| 1`, `?? true`) — cualquier documento viejo o ruta no actualizada se ve exactamente igual que antes.

### `cotizaciones` (Quotations, fase B, 2026-07-24)
`id`, `num` (numeración propia, empieza en 1), `cli`, `fecha`, `estado` (Pending/Accepted/Rejected/Expired), `lineas` (jsonb `LineaCotizacion[]`: `{prodId, prodNom, sku, barcode, qty, precio, precioCatalogo, almacen}` — sin `qtyEnviada`/`picked`, una cotización nunca se pickea), `total`, `valido_hasta` (fecha opcional), `mensaje` (override por-cotización, no usado por la UI actual que solo edita la plantilla global). RLS: authenticated sin bloqueo por rol (igual que `facturas`).

Documento **completamente independiente de `ordenes`** — a propósito, para resolver que antes la única forma de cotizar era crear una Orden (lo que reserva inventario vía `addOrden`/`ajustarInventario` de inmediato, aunque el cliente ni haya confirmado). Una Quotation nunca toca `productos.reservado`.

- **UI**: tab Orders tiene sub-tabs "Orders"/"Quotations" (`vistaOrdenes` en el componente `Ordenes`). "+ New Quotation" abre `CotizacionModal` (cliente vía `<select>`, líneas de producto con buscador — mismo patrón que "New Invoice" en Facturas).
- **Documento**: `/cotizaciones/[id]` (mismo mecanismo de paginación por altura medida que `/facturas/[id]`), PDF vía `/api/cotizaciones/[id]/pdf`. `lib/pdf/documento-pdf.tsx` ganó el tipo `"quotation"` (título "QUOTATION", disclaimer "does not reserve inventory", muestra `valido_hasta` si está fijada).
- **Estado**: pastillas Pending/Accepted/Rejected/Expired editables directo en el documento (solo admin).
- **Convert to Order**: botón que crea una Orden real con las mismas líneas — ahí sí se reserva inventario (respeta `lleva_stock` por almacén, mismo criterio que `ajustarInventario`) y la cotización pasa a "Accepted". Es la única forma de que una cotización se vuelva una venta real.

### `faltantes` (Missing Stock Report, 2026-07-23)
`id`, `fecha`, `orden_id`/`orden_num`, `cli`, `prod_id`/`prod_nom`/`sku`/`almacen`, `qty`, `precio`, `monto`. Sin UI para crear/editar a mano — se puebla sola en `completePick` (Ordenes): al completar un pick, cada línea que quedó en `qtyEnviada === 0` ("Missing", sin stock para enviarla) genera una fila vía `addFaltantesBulk`, con `qty` = lo pedido originalmente y `monto` = `qty × precio` (la venta que no se pudo facturar). RLS permisiva para `authenticated` (igual que `facturas`/`remitos`, sin bloqueo por rol — completar un pick no está restringido a admin). Reporte: botón "📉 Missing Stock Report" en el tab Orders (`FaltantesModal`), mismo period-preset que P&L/Vendedores + toggle "By date"/"By product" (agrupado, ordenado por $ perdido) para ver qué se queda sin stock más seguido.

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

### Almacenes (genéricos y configurables, 2026-07-23)
El campo `almacen` en `productos` y en líneas de factura/orden/compra sigue siendo un string simple (el slug, ej. `"palmhills"`/`"castillo"`) — pero ya NO es un enum fijo en el código. La tabla `almacenes` (ver abajo) le agrega metadata configurable a esos slugs. Helpers en `lib/almacenes.ts`: `almacenInfo(almacenes, slug)` (nombre/icono/lleva_stock, con fallback seguro si el slug no existe) y `almacenPrincipal(almacenes)` (el almacén activo con menor `orden` — reemplaza el viejo fallback hardcodeado `|| "palmhills"` en la mayoría de los lugares que asignan un almacén real a un producto/línea nueva; los que solo arman una *clave interna* de cálculo, como los mapas de costo del P&L, se dejaron con el literal `"palmhills"` a propósito — no vale la pena enchufarles `almacenes` para cero diferencia de comportamiento). Pantalla de gestión: "Warehouses" (`AlmacenesModal`) en el menú More (⋯).

**`lleva_stock`** es el flag que reemplaza toda la lógica que antes comparaba contra el string literal `"castillo"`: decide si el almacén trackea stock en vivo (como Palm Hills) o es de paso/consignación (como Castillo hoy) — en ese caso no descuenta stock (`ajustarInventario`, `addCompra`) y **genera un remito al completar el pick** en vez de facturar directo del inventario (antes hardcodeado "solo para Castillo"; ahora es un remito por cada almacén con `lleva_stock=false` presente en el pick, así que un negocio con dos almacenes de consignación tendría dos remitos separados). También decide si el formulario de producto muestra los campos Stock/Min.

**Sin migración de datos**: la tabla se sembró con los dos almacenes ya existentes (`palmhills` lleva_stock=true, `castillo` lleva_stock=false) — ninguna fila de `productos`/`facturas`/`ordenes`/`compras` se tocó, solo se les agregó metadata a los mismos slugs que ya usaban.

### Company Profile (2026-07-24)
Nombre/logo/dirección/contacto editables desde "Company Profile" en el menú More (solo admin) — reemplazan lo que antes estaba escrito directo en el código en ~10 lugares distintos. `useData().empresa` (o el fetch directo a la tabla `empresa` en las páginas standalone) alimenta: el header de la app, y el encabezado de **todos** los documentos que ve el cliente — factura, estimate, remito, nota de crédito, estado de cuenta — tanto en pantalla (HTML) como en sus PDFs (incluyendo Catalog y Aging Report). El logo se sube y comprime a PNG (preserva transparencia, a diferencia de los compresores de foto de producto/comprobante que rellenan blanco) con `compressLogo`, máx. 400px.

**Deliberadamente sin tocar** (bajo impacto, se difiere hasta que haga falta): las pantallas de login/signup (`app/auth/*`) y los metadatos de `app/layout.tsx` (título de pestaña del navegador, preview al compartir el link) siguen mostrando "Palm Hills" fijo — son páginas sin sesión, y la policy de `empresa` solo permite lectura a `authenticated`. Habilitarlo requeriría una policy de SELECT pública (el nombre de la empresa no es sensible, sería razonable) o convertir el `metadata` estático de `layout.tsx` a `generateMetadata` async.

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
- **Botón "+" (2026-07-22, revertido el mismo día):** componente compartido `AddPillButton` en page.tsx — cápsula verde sólida con degradado sutil (SIN brillo/highlight arriba — se probó y el usuario lo pidió quitar), elegida entre varios mockups. Se probó moverlo inline al header de cada tab, pero el usuario prefirió la ubicación flotante original — quedó como `ADD_PILL_POS` (`fixed bottom-24 right-4 z-[6]`, subido de `bottom-[72px]` para no pegarse tanto al bottom nav) en las 8 tablas donde vive. Los dos que abren un menú de varias opciones (Calendario, Inventario) apilan las opciones arriba del botón fijo, no como dropdown anclado.

### Rediseño "Apple-style" — fase 1 (2026-07-22)
Aprobado por el usuario vía mockup (3 opciones de Home + 2 variantes de bottom nav mostradas antes de tocar código real — ver [[feedback_user_preferences]]). Referencia visual: capturas de Calendar/Wallet/Reminders de iOS — el usuario pidió la CURVATURA y la agrupación de Apple, no sus colores (verde `#4a6741` y dorado `#b09060` se mantienen intactos).

- **Radio de tarjeta global**: `rounded-2xl` → `rounded-3xl` en TODAS las tarjetas de página (page.tsx y las pantallas de detalle: perfil de cliente, factura, nota de crédito, aging report, editor de listas de precios). Excepción intencional: las celdas del calendario quedan en `rounded-2xl` (cuadrado) o `rounded-full` (círculo de "hoy"/seleccionado) — bumpearlas también se veía mal en un elemento tan chico.
- **Bottom nav**: una sola caja curva flotante (`rounded-[26px]`, con margen del borde, `bg-card/90 backdrop-blur-md`) en vez de barra pegada de borde a borde. Los 8 tabs y sus íconos reales quedan intactos adentro; el activo tiene su propia píldora verde.
- **"Hoy" en ambos calendarios** (tab Calendario y el selector de fecha en `nueva-orden`): círculo sólido verde con número en blanco (convención real de Apple Calendar), reemplazando el anillo dorado anterior. Tiene prioridad visual sobre el tinte de "delivery day" ese mismo día.
- **Navegación de mes**: los botones ‹ › + el texto "Mes Año" pasan de 3 elementos sueltos a una sola cápsula agrupada (`bg-muted rounded-full`).
- **Home**: la meta de ventas pasa de tarjeta plana a un hero con degradado verde (`from-[#82a175] via-primary to-[#3c5536]`, barra de progreso blanca — se eliminó el color dinámico ámbar/azul/gris del progreso porque no contrastaba bien sobre el degradado). Sales this month / Invoices / Clients / Low stock pasan del grid 2×2 a una lista de filas con ícono en círculo de color.
- **Pendiente (fase 2, no hecho todavía)**: agrupar en una sola cápsula translúcida los toolbars de botones sueltos que quedan en Inventario (Top/Lists/Catalog/Categories), Facturas (buscador + aging report), etc. — el usuario aprobó el concepto en el mockup pero esta parte no se aplicó aún, solo Home/Calendario/Nav/radios. **Fix puntual 2026-07-23**: la fila de Inventario se cortaba a la derecha (Categories no cabía) porque Sort by + los 4 botones + el contador iban todos en una sola fila sin wrap — se separó en dos filas (Sort by + contador arriba, botones con `flex-wrap` abajo) para que no se corte en pantallas angostas; la cápsula translúcida sigue pendiente.

### Impresión / PDF (definitivo 2026-07-11)
NO usar `window.print()`: iOS/WebKit no repite `<thead>` ni respeta cortes de página. Los botones Print/PDF hacen fetch a `/api/facturas/[id]/pdf` o `/api/ordenes/[id]/pdf` (generación con @react-pdf/renderer, size LETTER, header `<View fixed>` repetido por página) y abren el **share sheet nativo** con el archivo (`navigator.share({files})`) → opción Print/Save/AirDrop. Test: `npx tsx scripts/test-pdf.ts`.

### Inputs de dinero — `MoneyInput` (2026-07-23)
`components/ui/money-input.tsx`: input estilo POS/cajero para cualquier campo en USD $. El usuario solo escribe dígitos (sin punto decimal) y el valor se acomoda solo de centavos hacia la izquierda — 1 → 0.01, 12 → 0.12, 123 → 1.23 — igual que una calculadora de caja registradora; backspace corre en reversa. Props: `value`/`onChange` son siempre dólares (`number`), el manejo interno es en centavos; acepta el resto de props nativas de `<input>` (`onBlur`, `onKeyDown`, `autoFocus`, `className`, etc.) por spread. Reemplazó los `<input type="number" step="0.01">` y los `<input type="text" inputMode="decimal" pattern="[0-9]*[.,]?[0-9]*">` sueltos en: precio/costo de producto, pago de factura, monto de nota de crédito (general y por línea), gasto, costo unitario de compra, precio ajustado por línea en New Order/Edit Order, meta de ventas.
**Excepción deliberada**: el campo de precio especial por cliente en `components/lista-precios-editor.tsx` NO se convirtió — ahí un campo vacío significa "usar precio base" (semántica de borrar/anular que `MoneyInput` no soporta, siempre resuelve a un monto).

### Descuento de lista de precios en documentos (2026-07-20)
Facturas y estimates guardan `precioCatalogo` por línea (precio de catálogo puro, sin lista) además de `precio`/`precioOriginal`. En `/facturas/[id]` y `/ordenes/[id]/estimado` hay un switch **"Show list price as discount"** (encendido por defecto, solo aparece si hay descuento de lista que revelar) que decide si el precio tachado es el de catálogo (revela también el descuento de la lista) o el histórico (solo el ajuste manual línea por línea). El PDF respeta el mismo switch vía `?listDiscount=1|0`. Documentos viejos sin `precioCatalogo` lo completan al vuelo con un query a `productos` (por `prodId` en órdenes; por SKU+almacén o nombre en facturas, que no guardan `prodId`).

### Catálogo de productos (2026-07-21)
Botón "📖 Catalog" en Inventario abre un modal (`CatalogoModal`) con 3 opciones: almacén (Palm Hills/Castillo/Both), mostrar precio, incluir fotos. El navegador filtra `productos` (ya en memoria vía `useData()`), y si hay fotos las reduce a miniatura (~160px, canvas, `compressCatalogPhoto`) ANTES de mandarlas — `@react-pdf/renderer` no recomprime imágenes al embeberlas, así que las ~2200 fotos completas del inventario generarían un PDF de cientos de MB. La ruta `/api/reportes/catalogo/pdf` es POST (no GET): recibe los productos ya resueltos del cliente en vez de consultar Supabase, evitando además sumar una librería de imágenes (sharp/jimp) al servidor — riesgo de deploy en Vercel que no valía la pena para un reporte ocasional. Layout: grid con foto si `conFotos`, tabla compacta si no. Test: `npx tsx scripts/test-catalogo.ts`.

### Aging Report (2026-07-20)
Botón junto al buscador de Invoices → `/reportes/facturas-pendientes`: lista facturas Pending/Partially Paid ordenadas por antigüedad (+30 días resaltadas en rojo), con toggle "By age" (plano) / "By client" (agrupado, clientes con la factura pendiente más vieja primero). PDF vía `/api/reportes/facturas-pendientes/pdf?groupBy=flat|client` (mismo patrón @react-pdf; al ser tabla que fluye no necesita la paginación manual de facturas/estimates). Test: `npx tsx scripts/test-reporte-cartera.ts`.

### P&L Report (2026-07-21, separado en dos reportes 2026-07-22)
Tab "P&L" (componente `PLReport` en page.tsx). Selector de periodo (presets This Month/Last Month/This Quarter/This Year + rango custom `desde`/`hasta`). El usuario pidió explícitamente separar el reporte mezclado original en dos vistas puras (toggle `vista: "income" | "cash"`) porque las compras de inventario no se veían reflejadas en ningún lado — no sabe de contabilidad y pidió que se optimizara esa parte como lo haría un experto:

**Income Statement (accrual — pestaña "Income Statement")**: el P&L de verdad, principio de devengado/matching.
- **Revenue = Invoiced**: total facturado en el periodo (`facturas[].total` por `fecha`), cobrado o no.
- **COGS**: líneas de las facturas facturadas en el periodo × **costo actual** de `productos.costo` (no hay snapshot histórico por venta — mismo trade-off aceptado en `compras`). Resuelve el producto por SKU+almacén o nombre (las líneas de factura no guardan `prodId`).
- **Gastos**: cuentan por **fecha de incurrido** (`gastos[].fecha`), pagados o no — así funciona un P&L real. Distinto a propósito del Cash Flow de abajo.
- **Sales commissions** (2026-07-23): suma, por cada `vendedor` con `base_comision` en `venta`/`ambas`, de la venta facturada en el periodo de sus clientes (por nombre, vía `clientes.vendedor_id`) × `comision_venta_pct`. Se resta del Net Income con el mismo criterio que "Expenses incurred" — es una comisión ya devengada este periodo, se le haya pagado o no al vendedor todavía.
- **Net Income** = Gross Profit (Invoiced − COGS) − Expenses incurred − Sales commissions.

**Cash Flow (pestaña "Cash Flow")**: solo lo que realmente entró y salió de caja.
- **Cash In** = Cash Collected: suma de `pagos[].monto` con fecha de pago en el periodo.
- **Cash Out** = **Inventory Purchases** (`compras` filtradas por `fecha` en el periodo — esto es lo que faltaba: comprar mercancía es salida de caja real aunque el inventario no se haya vendido y por ende no sea gasto todavía en el Income Statement) + **Expenses Paid** (`gastos` con `pagado = true` y `fecha_pago` en el periodo).
- **Net Cash Flow** = Cash Collected − Total Cash Out.
- **Outstanding Receivables**: total pendiente de cobro HOY (no acotado al periodo, mismo cálculo que el Aging Report) — se muestra solo aquí, como contexto de caja futura; en el Income Statement sería redundante porque Revenue ya lo cuenta como facturado.
- **Commissions owed (on collections)** (2026-07-23): mismo cálculo que arriba pero sobre `comision_cobro_pct` × cobros del periodo, para vendedores con `base_comision` en `cobros`/`ambas`. Se muestra solo como referencia — a propósito NO se resta del Net Cash Flow, porque la app no sabe si esa comisión ya se le pagó de verdad al vendedor. El pago real se registra como un `Gasto` normal (categoría comisión) cuando ocurre, y ese sí cuenta como salida de caja vía el mecanismo existente de Expenses Paid.

La gestión de Gastos (alta/edición, filtro All/Pending/Paid, comprobante de pago) es compartida por ambas vistas — no depende del toggle.

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

# Especificación — Dashboard de fondos

Nov 18, 2026 · @Rafael Granados

## Resumen

El diseño define un dashboard web para gestionar fondos en USD en tres artboards: inicio de sesión, vista general y estados del flujo de agregar fondos. Todas las cifras son datos de demostración y la cabecera lo indica con la etiqueta "Demo data".

| Artboard | Tamaño (px) | Tipo |
| --- | --- | --- |
| Dashboard (Main) | 1440 × 1180 | Página fluida |
| Login | 1440 × 900 | Página fluida |
| Add funds — transaction states | 1440 × 640 | Lámina fija con 3 modales |

## Inicio de sesión

Pantalla dividida en dos columnas que se apilan en móvil.

- **Panel de marca (izquierda, fondo navy):** logo con \[BRAND NAME\], titular "Manage your funds in one place.", texto de apoyo y espacio para la divulgación regulatoria.
- **Formulario (derecha, fondo blanco, máx. 400 px):** campos Email y Password, enlace "Forgot password?", casilla "Keep me signed in on this device" y botón primario "Sign in".
- **Seguridad:** aviso de verificación en dos pasos obligatoria tras iniciar sesión.
- **Registro:** enlace "Create an account" al pie.

## Dashboard

La vista general muestra un saldo disponible de $1,248,309.57 USD (demo), con las acciones de agregar fondos y retirar en la misma tarjeta.

**Navegación lateral (240 px, se apila en móvil):** Overview (activo), Transactions, Payment methods, Statements y Settings. Al pie hay una tarjeta "Need help?" que enlaza al Help Center.

**Cabecera:** título "Overview", saludo "Welcome back, \[Client Name\]", etiqueta "Demo data", botón de notificaciones y menú de cuenta.

**Tarjeta de saldo (navy):**

| Dato | Valor demo |
| --- | --- |
| Disponible | $1,248,309.57 |
| Pendiente | $12,450.00 |
| Total | $1,260,759.57 |
| Actualizado | hace 2 min |

Botones: "Add funds" (blanco, primario) y "Withdraw" (contorno).

**Tarjetas de resumen (cuadrícula auto-fit, mín. 220 px):**

| Tarjeta | Valor | Detalle |
| --- | --- | --- |
| Deposits this month | $84,200.00 | 6 completados |
| Withdrawals this month | $31,675.40 | 3 completados |
| Pending transactions | 2 | En espera de confirmación |
| Linked accounts | 2 | Bank •••• 4417, Card •••• 0932 |

**Historial de transacciones:** búsqueda, filtros "All types" y "Last 30 days", y "Export CSV". Columnas: fecha, descripción con método, referencia, estado y monto. Pie: "Showing 7 of 48" y enlace "View all transactions".

| Fecha | Tipo | Método | Referencia | Estado | Monto |
| --- | --- | --- | --- | --- | --- |
| Nov 18, 2026 | Deposit | Bank •••• 4417 | TX-80412 | Pending | +$12,450.00 |
| Nov 15, 2026 | Withdrawal | Bank •••• 4417 | TX-80377 | Completed | −$8,000.00 |
| Nov 12, 2026 | Deposit | Card •••• 0932 | TX-80321 | Failed | +$5,000.00 (tachado) |
| Nov 10, 2026 | Deposit | Bank •••• 4417 | TX-80290 | Completed | +$25,000.00 |
| Nov 06, 2026 | Withdrawal | Bank •••• 4417 | TX-80211 | Completed | −$15,675.40 |
| Nov 03, 2026 | Deposit | Card •••• 0932 | TX-80158 | Completed | +$9,200.00 |
| Nov 01, 2026 | Withdrawal | Bank •••• 4417 | TX-80102 | Completed | −$8,000.00 |

Los estados usan píldoras de color: verde (Completed), ámbar (Pending) y rojo (Failed). Los depósitos fallidos se muestran tachados en gris y no suman al saldo.

## Estados de agregar fondos

El flujo tiene tres modales; el de error solo aparece cuando el proveedor de pago rechaza la operación y nunca descuenta dinero.

| Estado | Icono | Título | Contenido | Acciones |
| --- | --- | --- | --- | --- |
| Procesando | Spinner azul | Processing your deposit | Confirma $25,000.00 desde Bank •••• 4417, barra de progreso, "Please keep this window open." | Ninguna |
| Éxito | Check verde | Funds added | Monto acreditado, referencia TX-80290 y comisión $0.00 | Done |
| Error | Alerta roja | Transaction couldn't be completed | Motivo ("Your card issuer declined this deposit"), confirmación de que no se cobró, código CARD\_DECLINED y referencia TX-80321 | Contact support, Try again |

"Contact support" abre un ticket dentro de la app con la referencia adjunta; no redirige a chats externos. El modal de error usa `role="alertdialog"` para que los lectores de pantalla lo anuncien.

## Sistema visual

Estilo fintech limpio: tipografía Inter, base navy y un solo acento azul sobre fondo gris claro.

| Token | Valor | Uso |
| --- | --- | --- |
| Fondo | #F6F7F9 | Lienzo de la app |
| Superficie | #FFFFFF | Tarjetas, sidebar, formularios |
| Tinta / navy | #0F172A | Texto principal, tarjeta de saldo, panel de marca |
| Texto secundario | #475569 | Etiquetas y metadatos |
| Acento | #1D4ED8 | Botón Sign in, enlaces, nav activa (#EFF4FF de fondo) |
| Borde | #E5E7EB / #D1D5DB | Tarjetas / campos |
| Éxito | #DCFCE7 / #166534 | Píldora Completed, depósitos |
| Aviso | #FEF3C7 / #92400E | Píldora Pending |
| Error | #FEE2E2 / #991B1B | Píldora Failed, modal de error |

- **Tipografía:** Inter 400–700; saldo a 52 px bold con centavos a 30 px; títulos de página a 26 px; cifras con `tabular-nums`.
- **Forma:** radios de 8–18 px; tarjetas con borde de 1 px; sombra solo en modales.
- **Accesibilidad:** zonas táctiles de 44 px o más, `aria-label` en botones de solo icono, `<label>` en todos los campos y tablas con scroll horizontal en móvil.

## Pendientes del cliente

Antes de pasar a desarrollo, el cliente debe completar estos placeholders:

- [ ] Nombre y logo de la marca (\[BRAND NAME\])
- [ ] Texto de divulgación regulatoria o de licencia en el login
- [ ] Nombre del cliente en el saludo (\[Client Name\])
- [ ] Proveedor de pagos y métodos aceptados (definen los códigos de error reales)
- [ ] URL del Help Center y sistema de tickets para "Contact support"
- [ ] Retirar la etiqueta "Demo data" cuando el saldo venga del ledger real

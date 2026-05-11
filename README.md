# Split PWA

PWA en **HTML + CSS + JavaScript** (sin React/Vue/Svelte) para repartir gastos entre varias personas. Usa **Firebase** (Auth anónimo, Firestore, Cloud Messaging para registrar el token FCM en Firestore).

## Requisitos

- **Node.js** `20.19+` o `22.12+` (requerido por Vite 8).
- Cuenta de **Firebase** con un proyecto creado (plan gratuito Spark es suficiente para Auth, Firestore y guardar tokens).

## Configuración local

### 1. Variables de entorno

En la raíz del proyecto, crea un archivo `.env` (no lo subas al repositorio; ya está en `.gitignore`):

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_VAPID_KEY=
```

Los valores salen de **Firebase Console → Configuración del proyecto → Tus apps → Web**. La **clave VAPID** está en **Cloud Messaging → Certificados de clave web**.

### 2. Firebase Console

| Servicio | Qué activar |
|----------|-------------|
| **Authentication** | Método **Anónimo**. |
| **Firestore** | Crear base de datos en modo que prefieras; desplegar las **reglas** del archivo `firestore.rules`. |
| **Cloud Messaging** | Para obtener la VAPID key y registrar tokens web. |

### 3. Instalar y ejecutar

```bash
npm install
npm run dev
```

Abre la URL que muestra Vite (por defecto `http://localhost:5173`).

### 4. Proyecto Firebase en la CLI (solo para desplegar reglas)

Edita `.firebaserc` y sustituye `YOUR_FIREBASE_PROJECT_ID` por el ID real de tu proyecto, o ejecuta:

```bash
firebase login
firebase use --add
```

## Cómo está organizado el código

| Archivo / carpeta | Rol |
|-------------------|-----|
| `index.html` | Punto de entrada; solo contiene `<main id="app">`. Toda la interfaz la genera JavaScript. |
| `src/main.js` | Monta la UI (paneles), enlaza botones y llama a auth, splits, gastos y notificaciones. |
| `src/firebase.js` | Inicializa Firebase App, Auth, Firestore y Messaging (si el navegador lo soporta). |
| `src/auth.js` | **Login anónimo** y documento base del usuario en `users/{uid}`. |
| `src/split.js` | **Crear reparto**: escribe el documento del split y los participantes con nombre (`p1`, `p2`, …). |
| `src/expenses.js` | **Unirse** a un reparto (`memberUids`) y **añadir gastos** en una subcolección. |
| `src/balances.js` | Lee participantes y gastos y calcula **qué debe o recibe** cada uno (partes iguales por gasto). |
| `src/notifications.js` | Pide permiso de notificaciones, obtiene **token FCM** y lo guarda en `users/{uid}/fcmTokens/{token}`. |
| `public/sw.js` | Service worker (caché de la PWA). |
| `firestore.rules` | Reglas de seguridad de Firestore. |

## Modelo de datos en Firestore

```
users/{uid}
  (metadatos del usuario anónimo)

users/{uid}/fcmTokens/{tokenId}
  token, createdAt, updatedAt

splits/{splitId}
  title, ownerUid, createdAt, participantCount, memberUids[]

splits/{splitId}/participants/{p1, p2, …}
  name, order

splits/{splitId}/expenses/{expenseId}
  amount, description, paidByParticipantId, createdAt, createdByUid
```

- **`memberUids`**: UIDs de Firebase de las personas que **se han unido** al reparto desde la app (no son solo los nombres escritos al crear el split).
- Los **nombres** (`participants`) sirven para saber quién es `p1`, `p2`, etc. al indicar **quién pagó** el gasto.

### Saldos (“qué debe cada uno”)

Para cada gasto, el importe se divide en **partes iguales** entre todos los participantes. Por cada gasto: a cada uno se le resta su parte; a quien pagó se le suma el total pagado. El **saldo neto** indica si esa persona **debe dinero** (negativo) o **le deben / debe recibir** (positivo). Los gastos cuyo `paidByParticipantId` no coincide con un `p1…pn` del reparto se ignoran en el cálculo.

## Flujo de uso en la aplicación

### Crear reparto

1. Opcional: **Crear usuario anónimo** (Auth).
2. Escribe un **título** para reconocer el reparto (vacío → se guarda como «Sin título»).
3. Introduce al menos **dos nombres** y pulsa **Guardar reparto**.
4. Se crea un documento en `splits/` y el **ID del reparto** se copia al campo **ID del reparto**; el **título** aparece arriba cuando cargas ese reparto.

El creador queda en **`memberUids`** desde el principio.

### Unirse a un reparto (otras personas)

1. En otro navegador o dispositivo: mismo proyecto Firebase y `.env`.
2. **Crear usuario anónimo**.
3. Pegar el **mismo ID de reparto** y pulsar **Unirme a este reparto**.
4. Su UID se añade con `arrayUnion` a **`memberUids`**.
5. En **Gastos del reparto** verás el **total pagado por cada persona** y el **detalle** de cada gasto (se actualiza al unirte).

### Notificaciones (token FCM)

1. **Activar notificaciones push** y aceptar el permiso del navegador.
2. El token FCM se guarda bajo `users/{uid}/fcmTokens/…`.

Este proyecto **no incluye un servidor** que envíe mensajes push a otros dispositivos cuando se crea un gasto. Los tokens quedan guardados para cumplir el flujo típico del curso; si más adelante quisieras avisos automáticos a todos, haría falta un **backend** con credenciales de administrador FCM.

### Añadir gasto

1. Con el **ID del reparto** correcto (el desplegable **Pagó** se rellena solo con los **nombres** del reparto; por dentro sigue guardándose `p1`, `p2`, etc.).
2. Rellena monto, descripción y elige **quién pagó**.
3. Pulsa **Añadir gasto**. Se crea un documento en `splits/{splitId}/expenses/` y se actualizan listas y saldos.

### Ver saldos

Con el ID del reparto en el campo correspondiente, pulsa **Actualizar gastos y saldos** (también se recalculan al guardar un reparto nuevo o tras añadir un gasto).

La interfaz solo muestra **añadir gasto**, **lista de gastos** y **saldos** cuando tienes **acceso** al reparto (eres miembro o lo acabas de crear). Si solo pegas un ID pero no eres miembro, usa **Unirme** primero.

## Desplegar reglas de Firestore

Desde la raíz del proyecto:

```bash
npm run deploy:rules
```

Si no tienes la CLI globalmente:

```bash
npx firebase-tools deploy --only firestore:rules
```

## Reglas de seguridad (resumen)

- Cada usuario solo puede leer/escribir **su** documento `users/{uid}` y sus **`fcmTokens`**.
- Un **split** lo puede leer el **dueño** o cualquier UID en **`memberUids`**.
- Solo el **dueño** crea participantes y puede borrar/editar el split con libertad (según reglas).
- Un usuario **no miembro** puede hacer **solo** un tipo de actualización: **unirse** (`memberSelfJoin`), que suma su UID a `memberUids` sin cambiar dueño, fechas ni número de participantes.
- Los **gastos** solo los crean miembros del reparto; todos los miembros pueden leerlos.

## Scripts npm

| Script | Descripción |
|--------|-------------|
| `npm run dev` | Servidor de desarrollo Vite. |
| `npm run deploy:rules` | Despliega `firestore.rules`. |

## Notas

- Para que todos vean gastos nuevos **sin push**, puedes ampliar la app con **`onSnapshot`** sobre la colección `expenses` del reparto (tiempo real con la web abierta).
- Para probar entre varias personas, cada una necesita su propia sesión anónima y haber pulsado **Unirme** con el mismo `splitId`.

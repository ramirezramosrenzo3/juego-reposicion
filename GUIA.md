# Juego de Reposición: guía paso a paso

Todo el código ya está escrito. Solo tienes que seguir estos pasos, sin programar. Tarda unos 20 minutos la primera vez.

Vas a hacer 6 cosas:
1. Descomprimir el ZIP.
2. Crear una base de datos gratis en Supabase.
3. Pegar un archivo SQL para crear las tablas.
4. Copiar dos claves de Supabase dentro de `config.js`.
5. Subir los archivos a GitHub.
6. Activar GitHub Pages para tener tu link.

---

## Archivos del proyecto

| Archivo | Para qué sirve | ¿Hay que subirlo a GitHub? |
|---|---|---|
| `index.html` | La página que abren los celulares | **Sí** |
| `config.js` | Tus claves de Supabase (lo único que editas) | **Sí** |
| `game.js` | Las reglas y los números del juego | **Sí** |
| `app.js` | Las pantallas de cada rol y la conexión | **Sí** |
| `avatares.js` | Los 16 avatares (se usan las imágenes de la carpeta `avatares`) | **Sí** |
| `supabase.sql` | Crea las tablas en la base de datos | No (solo se pega en Supabase) |
| `REGLAS.md` | Las reglas completas explicadas | Opcional |
| `GUIA.md` | Esta guía | Opcional |
| `test.js` | Pruebas automáticas del motor y de los bots | Opcional |
| `validacion/` | Modelo de validación económica (no lo usa el juego) | No |

---

## Paso 1: descomprimir el ZIP

1. Descarga el archivo `juego-reposicion.zip`.
2. Descomprímelo:
   - **Windows:** clic derecho sobre el ZIP → **Extraer todo** → **Extraer**.
   - **Mac:** doble clic sobre el ZIP.
   - **Celular:** usa la app de archivos (Archivos en Android, Archivos en iPhone) y toca **Descomprimir**.
3. Vas a obtener una carpeta llamada `juego-reposicion` con los archivos de la tabla de arriba. Deja esa carpeta abierta: la vas a necesitar en los pasos 3, 4 y 5.

## Paso 2: crear la base de datos (Supabase, gratis)

1. Entra a **supabase.com** y crea una cuenta (puedes usar tu cuenta de Google o GitHub).
2. Haz clic en **New project**.
3. Ponle un nombre (por ejemplo `reposicion`), crea una contraseña y guárdala en algún lugar.
4. En **Region**, elige **South America (São Paulo)**.
5. Haz clic en **Create new project** y espera 1 o 2 minutos hasta que aparezca el panel del proyecto.

## Paso 3: crear las tablas (pegar el SQL)

1. En el menú izquierdo, entra a **SQL Editor** (ícono `>_`).
2. Haz clic en **New query**.
3. Abre `supabase.sql` con el Bloc de notas (Windows), TextEdit (Mac) o cualquier editor de texto. **Copia todo el contenido** (Ctrl+A y luego Ctrl+C, o Cmd+A y Cmd+C).
4. Pégalo en el editor de Supabase (Ctrl+V o Cmd+V).
5. Haz clic en **Run**. Debe decir **Success** abajo (por ejemplo, **Success. No rows returned**).

Si en lugar de eso aparece **Failed to get project's logs**, es un aviso del panel de Supabase y no un error del SQL, y suele pasar con proyectos recién creados. Recarga la página y entra a **Table Editor**: si ves las tablas `salas`, `jugadores`, `rondas` y `decisiones`, el paso salió bien y puedes seguir. Si no están, vuelve a pegar y ejecutar el SQL.

Si aparece un error en rojo con un texto, copia el mensaje completo y envíamelo.

Si ya habías pegado la versión 3.0 en este mismo proyecto, no necesitas uno nuevo: sigue la sección **Actualizar a la versión 3.1** más abajo. Si era una versión anterior a la 3.0, crea un proyecto nuevo (paso 2) y pega el SQL ahí, para que no queden tablas ni funciones viejas.

## Paso 4: copiar tus claves en `config.js`

1. En Supabase, haz clic en el ícono de **engranaje** (Project Settings) y luego en **API**.
2. Copia el **Project URL** (empieza con `https://`).
3. Copia la clave **anon public** (es una clave larga que empieza con `eyJ`). Si Supabase le pone otro nombre, por ejemplo **publishable**, usa esa: es la clave pública. **No uses la clave `service_role` ni una que diga `secret`.**
4. Abre `config.js` con el Bloc de notas o TextEdit. Reemplaza los dos valores para que quede así:

```js
window.CONFIG_SUPABASE = {
  url: 'https://abcd1234.supabase.co',          // tu Project URL
  anonKey: 'eyJhbGciOi...',                      // tu clave anon public
};
```

5. Guarda el archivo. Si dejas los valores de ejemplo (`TU-PROYECTO`), al crear una sala dirá **"Sin conexión, reintentando…"**.

**Cuidado con la URL:** debe terminar exactamente en `.supabase.co`, sin `/` al final y **sin `/rest/v1`** (en la página de la API de Supabase aparece con `/rest/v1`, pero ahí no va). Si al tocar **Crear sala** sale **"Invalid path specified in requested URL"**, es porque la URL tiene algo de más.

## Paso 5: subir los archivos a GitHub

1. Entra a **github.com**, crea una cuenta si no tienes y haz clic en **New repository** (el botón verde o el ícono **+**).
2. Nombre del repositorio: `juego-reposicion`. Marca **Public**. Haz clic en **Create repository**.
3. En la página que aparece, haz clic en el enlace **uploading an existing file**.
4. Abre la carpeta `juego-reposicion` que descomprimiste en el paso 1. Selecciona **los archivos** (no la carpeta) y arrástralos a la página de GitHub. Como mínimo deben subir estos 5:
   - `index.html`
   - `config.js`
   - `game.js`
   - `app.js`
   - `avatares.js`
   También puedes subir `REGLAS.md`, `GUIA.md` y `test.js`. No subas `supabase.sql` ni la carpeta `validacion`.
5. **Importante:** los archivos deben quedar en la raíz del repositorio, no dentro de otra carpeta. En la lista debes ver `index.html` directamente, sin una carpeta de por medio.
6. Abajo, en el cuadro de mensaje, escribe cualquier texto (por ejemplo "primera versión") y haz clic en **Commit changes**.

## Paso 6: activar GitHub Pages (tu link)

1. En tu repositorio, haz clic en **Settings** (pestaña de arriba).
2. En el menú izquierdo, haz clic en **Pages**.
3. En **Source**, elige **Deploy from a branch**.
4. En **Branch**, elige **main** y **/ (root)**. Haz clic en **Save**.
5. Espera de 1 a 10 minutos. Recarga la página de **Pages** hasta que aparezca el mensaje **"Your site is live at..."**.
6. Tu link tiene esta forma:

```
https://TU-USUARIO.github.io/juego-reposicion/
```

Ese es el link que compartes con tus amigos. Ábrelo en tu celular para comprobar que carga la pantalla **Juego de Reposición**.

Si sale un error 404, revisa que `index.html` esté en la raíz del repositorio (paso 5).

---

## Cómo entrar a una sala

Hay dos formas. Ambas están en la pantalla de inicio:

**Crear una sala (una sola persona la crea):**
1. Escribe tu nombre.
2. Elige cuántas **semanas** dura la partida (de 5 a 60; por defecto 30).
3. Elige cuántos **segundos** tiene cada persona para decidir cada semana (de 20 a 180; por defecto 60).
4. Toca **Crear sala**.
5. Aparece la **Sala de espera** con un **código de 4 caracteres** (por ejemplo `7AH3`) y un **link** para compartir.

**Unirse a una sala (los otros 5 jugadores):**
- **Opción A, con el link:** abre el link que te compartieron. El código ya aparece escrito. Escribe tu nombre y toca **Unirme**.
- **Opción B, con el código:** abre el link principal del juego. En **Código de sala** escribe los 4 caracteres y toca **Unirme**. Escribe tu nombre antes de tocarlo.

Cuando estén los 6 jugadores, quien creó la sala ve el botón **Iniciar partida** (solo se activa con 6). Toca **Iniciar partida**.

**¿No hay 6 personas? Usa bots 🤖** (ver la sección **Los bots** más abajo):
- **Probar solo:** en la pantalla de inicio toca **🤖 Probar solo con 5 bots**. Crea la sala, pone 5 bots y empieza al instante, sin esperar a nadie.
- **Con algunas personas:** en la sala de espera, quien creó la sala toca **🤖 Completar con bots los lugares vacíos** y luego **Iniciar partida**. Si después llega otra persona con el código, toma el lugar de un bot. **Quitar los bots** los saca a todos.

**Si cierras la página sin querer:** al volver a abrir el link, el juego te devuelve a tu sala automáticamente. Usa siempre el mismo celular y el mismo navegador.

Si abres el link de **otra** sala, el juego cambia a esa sala. Para salir de una sala en espera, toca **Salir de la sala**. Si el anfitrión sale durante la espera, la sala se borra y hay que crear otra.

---

## Cómo se juega

1. En la primera pantalla cada persona **elige su avatar** (uno de 16) y escribe su nombre. Dos personas de la misma sala no pueden tener el mismo avatar.
2. Al darle **Iniciar** el anfitrión, se abre una **sala de elección de 2 minutos**: cada uno elige su equipo (**G'sertte** o **Gallecolors**) y su puesto. El primero en confirmar un puesto lo bloquea para los demás (se ve en tiempo real); puedes desbloquearlo para cambiar. Quien no elija a tiempo recibe un puesto al azar, igual que los bots.
3. En la partida solo ves los nombres y avatares de **tu** equipo; los puestos del otro equipo no se muestran.
4. Arriba hay un **cronómetro fijo** (se pone rojo en los últimos 10 s). Si no envías tu decisión, **se envía sola** lo que tengas en pantalla justo antes de acabar el tiempo.
5. Verás una **cadena animada** con camiones que avanzan cada semana, el **dinero del equipo** y, en tu tabla, lo que tienes en almacén, lo que se produce y lo que se está entregando.

Cada persona ve solo la pantalla de su rol:

- **Fábrica:** elige la calidad de cada sabor (económico, estándar o premium) y cuántas galletas producir. Lo producido llega en 2 semanas.
- **Distribuidor:** elige cuánto pedir a la fábrica (llega en 2 semanas) y, si quiere, **puja por los influencers** (ver abajo).
- **Tienda final:** elige el precio de cada sabor (entre $2.50 y $8.00) y cuánto pedir al distribuidor (llega en 2 semanas).

Todos los celulares deben mostrar la misma **versión del juego** (aparece en la sala de espera y al final de la partida, por ejemplo `3.2`). Si alguien ve otra, que recargue la página.

Cada semana:
1. Escribe tu decisión y toca **Enviar decisión**. Puedes cambiarla mientras el tiempo corra, con **Actualizar decisión**.
2. La semana se cierra cuando los 6 decidieron o cuando se acaba el tiempo. Luego verás los resultados de tu equipo y empieza la siguiente.
3. Si no decides a tiempo, esa semana no pides, no produces y no pujas.

Al final de la última semana aparece **Partida terminada** con el ganador. Gana el equipo con más ganancia acumulada.

**Duración:** con la configuración por defecto (30 semanas de 60 segundos) la partida dura unos 30 minutos como máximo, sin contar la sala de espera. Si los 6 deciden antes, cada semana se cierra antes.

## Los bots

Un bot es un jugador que maneja el juego. Ocupa un lugar de fábrica, distribuidor o tienda y decide solo cada semana. Su equipo gana o pierde con lo que decida. En la pantalla aparecen con 🤖, y arriba de tu decisión puedes ver quién juega cada puesto de los dos equipos.

- Los bots **deciden apenas empieza la semana**. Con 1 persona y 5 bots, la semana se cierra en cuanto esa persona envía su decisión.
- **Qué hacen:** la fábrica produce en calidad estándar; el distribuidor y la tienda piden para tener unas 4 semanas de la demanda reciente; la tienda vende a $4.50; el distribuidor puja por influencers libres solo si la tienda tiene stock para atender más demanda.
- **Qué tan buenos son:** son un rival razonable, no un experto. En simulaciones atienden casi toda la demanda, quedan parejos entre ellos y le ganan siempre a un equipo que no hace nada. Los detalles están en `REGLAS.md`, sección 16.
- **Importante:** las decisiones de los bots las envía el celular de las personas. Si todas las personas cierran la página, la partida se detiene hasta que alguien vuelva a abrirla.

## Actualizar a la versión 3.2 (si ya tenías el juego funcionando)

Mismos pasos que abajo, pero en el paso 2 sube **4 archivos y la carpeta `avatares`**: `index.html`, `game.js`, `app.js` y `avatares.js` (nunca `config.js`). La sala de espera debe decir **Versión del juego: 3.2**. Sube también la carpeta `avatares` (16 imágenes) con **Add file → Upload files**.

## Actualizar a la versión 3.1 (si ya tenías el juego funcionando)

**Hazlo en este orden.** Primero la base de datos y después los archivos, porque la versión nueva de la página necesita las tablas nuevas.

1. **Supabase:** entra a tu proyecto → **SQL Editor** → **New query**. Abre el `supabase.sql` nuevo con el Bloc de notas, copia todo, pégalo y toca **Run**. No borra nada: tus partidas y salas siguen igual. Si sale "Failed to get project's logs", es un aviso del panel y no del SQL: recarga la página y mira que haya salido bien (ver paso 3).
2. **GitHub:** sube **solo estos 2 archivos**, `game.js` y `app.js`, para reemplazar los que ya tienes:
   - Entra a tu repositorio → **Add file** → **Upload files** → elige `game.js` y `app.js` del ZIP → **Commit changes**.
   - **No subas `config.js`** del ZIP: tiene los datos de ejemplo y borraría tus claves.
   - En el celular, esa opción aparece mejor con la versión de escritorio del sitio de GitHub (menú del navegador → **Sitio de escritorio**). Si te cuesta, hazlo desde una computadora.
3. Espera 1 o 2 minutos, abre tu link con una pestaña privada y revisa que la sala de espera diga **Versión del juego: 3.1**.

Si la página muestra "Falta actualizar la base de datos", el paso 1 no se aplicó: vuelve a pegar el SQL.

## Los influencers (opcionales)

Hay 3 influencers, A, B y C. Cada uno sube la demanda de **todos los sabores** del equipo que lo tenga:

- **A** sube entre 15% y 35%.
- **B** sube entre 25% y 45%.
- **C** sube entre 35% y 55%.

Cada semana, el distribuidor de cada equipo puede pujar por cualquiera de los tres, por ninguno o por varios. Solo escribe un **monto** (pon 0 si no quieres pujar).

- Las pujas son **secretas**.
- Gana el monto más alto y **paga ese monto**.
- Si empatan en el monto más alto, gana el equipo con **mejor calidad promedio**. Si también empatan en calidad, gana **al azar**.
- Un influencer ganado dura **2 semanas**. Mientras está ocupado no se puede pujar por él.

## Cómo se calcula la ganancia

**Ganancia del equipo = margen de ventas − mantenimiento del stock − pujas pagadas.**

- Cada galleta vendida deja su precio menos lo que costó producirla.
- El stock sin vender no es un gasto, pero cada semana paga un 3% de su valor por estar guardado.

Las reglas completas están en `REGLAS.md`.

## Cómo probar tú solo antes de invitar a los demás

**Lo más fácil: bots.** En la pantalla de inicio toca **🤖 Probar solo con 5 bots**. Empieza al instante, juegas tu puesto y los otros 5 los juegan los bots. Para una prueba rápida, pon 5 semanas y 20 segundos antes de tocar el botón.

**Probar con varias personas reales en tu computadora:** las ventanas de **incógnito** de Chrome comparten la misma memoria entre sí. Si abres 6 ventanas de incógnito, todas serán el mismo jugador. Para simular varios jugadores necesitas que cada uno tenga memoria separada:

- **Lo mejor:** pide a 5 amigos que abran el link desde sus celulares.
- **Alternativa en la misma computadora:** usa **perfiles distintos** de Chrome (ícono de tu perfil → **Añadir**), o usa **Chrome, Edge y Firefox** a la vez. Cada perfil o navegador tiene memoria propia.

Regla general: **una persona por celular y por navegador.** Si dos personas usan la misma pestaña o el mismo navegador, comparten jugador.

## Cómo cambiar las reglas

Los números están al inicio de `game.js`:

- **`CONFIG`**: costo de producir, precios entre etapas, precio de partida, límites de precio, elasticidad, crecimiento del mercado, mantenimiento, probabilidad de desvío, ruido de la demanda, topes de pedido y de puja, duración de influencers, stock inicial.
- **`PRODUCTOS`**: nombre, color, demanda media y capacidad de producción de cada sabor.
- **`CALIDADES`**: costo y demanda de económico, estándar y premium.
- **`INFLUENCERS`**: el rango de subida de A, B y C.

Para cambiar un número: en GitHub abre `game.js`, toca el ícono del lápiz, cambia el valor y guarda con **Commit changes**. Cambia los números **entre partidas**, nunca en medio de una: el juego recalcula todo desde la semana 1.

## Si algo sale mal

| Lo que ves | Qué hacer |
|---|---|
| "Sin conexión, reintentando… (revisa tu internet y config.js)" | Revisa que `config.js` tenga tus claves reales y que el internet funcione. |
| Pantalla de error 404 en el link | Espera unos minutos después de activar Pages, o revisa que `index.html` esté en la raíz (paso 5). |
| "La sala no existe" | Revisa que el código esté bien escrito. Las letras no distinguen mayúsculas. |
| "La partida ya empezó" | Solo puedes unirte antes de que el anfitrión toque **Iniciar partida**. |
| "La sala ya tiene 6 jugadores" | Ya están completos y no hay bots que ceder. Crea otra sala. |
| "Falta actualizar la base de datos…" o "Could not find the function … completar_bots" | Pega de nuevo el `supabase.sql` de la versión 3.2 en Supabase y toca **Run** (ver **Actualizar a la versión 3.1**). |
| Los bots no deciden y la semana espera todo el tiempo | Revisa que al menos una persona tenga la página abierta y que todos tengan la misma versión (3.2). |
| "Se acabó el tiempo de esta semana" | La semana ya se cerró. Espera a la siguiente. |
| Error en rojo en el SQL de Supabase | Copia el mensaje completo y envíamelo. |
| El proyecto de Supabase no responde | Los proyectos gratis se pausan tras una semana sin uso. Entra a Supabase y reactívalo. |
| Los cambios en GitHub no se ven | Espera un par de minutos y recarga la página con el candado o con Ctrl+F5. |

## Limitaciones que debes saber

- Es un juego entre amigos. Las decisiones viajan por una base de datos pública con clave anon, así que alguien con conocimientos técnicos podría ver las decisiones de otros antes de que cierre la semana. No lo uses para apostar dinero.
- Cada partida tiene una semilla (un número) guardada en la base de datos. Quien lea esa tabla puede calcular la demanda de cada semana antes que los jugadores. Entre amigos no pasa nada; si algún día hay dinero de por medio, hay que cambiarlo.
- Los bots dependen de que haya al menos una persona con la página abierta. Además, quien participa en la partida podría, con conocimientos técnicos, enviar decisiones en nombre de un bot rival: para jugar entre amigos no importa.
- En celulares angostos, las tablas largas (marcador, ventas) se deslizan hacia los lados dentro de su recuadro. Desliza con el dedo dentro de la tabla para ver todas las columnas.
- Los montos aparecen con el símbolo `$`. Si quieres otra moneda, cambia el símbolo en `app.js`.
- Las partidas quedan guardadas en Supabase.
- Los números (demanda, elasticidad, calidad, mantenimiento, rangos de influencers, capacidades) son valores de partida. Se van a ajustar con las partidas de prueba.

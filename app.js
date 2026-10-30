/*
  INTERFAZ DEL JUEGO (versión 3)
  Se conecta a Supabase (salas y decisiones) y usa game.js (las reglas).
  Cada celular refresca cada 1.2 segundos y recalcula el estado completo.
*/
(function () {
  'use strict';

  if (!window.supabase || !window.CONFIG_SUPABASE || !window.JuegoReposicion) {
    document.getElementById('app').innerHTML =
      '<section class="card"><h1>No se pudo cargar el juego</h1>' +
      '<p class="ayuda">Revisa tu conexión a internet y que config.js tenga tus claves de Supabase.</p></section>';
    return;
  }

  const JR = window.JuegoReposicion;
  const C = window.CONFIG_SUPABASE;
  const { PRODUCTOS, CALIDADES, INFLUENCERS, INF_KEYS, CONFIG } = JR;
  const sb = window.supabase.createClient(C.url, C.anonKey);
  const app = document.getElementById('app');

  const EQ = { A: 'Equipo A', B: 'Equipo B' };
  const ROLN = { fabrica: 'Fábrica', distribuidor: 'Distribuidor', tienda: 'Tienda final' };
  const RES = {
    gano: '<span class="pos">✔ Ganaste</span>',
    perdio: '<span class="neg">✖ Perdiste</span>',
    ocupado: 'Estaba ocupado esa semana',
    sin_puja: 'No pujaste',
  };
  // Solo las columnas que la base permite leer (los ids y el anfitrión son secretos)
  const COLS_SALA = 'codigo,estado,total_rondas,segundos,semilla,iniciada_en,creada_en';
  const COLS_JUG = 'sala,nombre,equipo,rol,unido_en,es_anfitrion';
  const COLS_RON = 'sala,numero,cerrada_en';
  const COLS_DEC = 'sala,ronda,equipo,rol,payload,enviada_en';

  // ---------- ESTADO LOCAL ----------
  let jugadorId = localStorage.getItem('jugadorId');
  if (!jugadorId) {
    jugadorId = crypto.randomUUID();
    localStorage.setItem('jugadorId', jugadorId);
  }
  let nombre = localStorage.getItem('nombre') || '';
  let sala = localStorage.getItem('sala') || null;
  const codigoUrl = (new URLSearchParams(location.search).get('sala') || '').toUpperCase();
  // Si el link trae otra sala, esa sala reemplaza a la guardada
  if (codigoUrl && codigoUrl !== sala) {
    sala = null;
    localStorage.removeItem('sala');
  }

  let datos = null;     // filas de la base + datos propios del jugador
  let estado = null;    // estado del juego calculado por game.js
  let actual = 0;       // número de la semana que se está jugando
  let pantalla = '';    // 'inicio' | 'lobby' | 'juego' | 'fin'
  let ocupado = false;
  let ocupadoDesde = 0;

  // ---------- UTILIDADES ----------
  const $ = (id) => document.getElementById(id);
  const val = (id) => { const el = $(id); return el ? el.value : ''; };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => (n < 0 ? '−' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('es-PE');
  const dinero2 = (n) => '$' + Number(n).toFixed(2);
  const num = (n) => Math.round(n).toLocaleString('es-PE');
  const pct = (x) => Math.round(x * 100) + '%';
  const chip = (p) => `<span class="chip" style="background:${p.color}"></span>${esc(p.nombre)}`;
  const render = (el, html) => {
    if (!el) return;
    if (el._h !== html) { el.innerHTML = html; el._h = html; }
  };
  const aviso = (t) => { const el = $('aviso'); if (el) el.textContent = t || ''; };
  const mensajeError = (e) => {
    const m = String((e && e.message) || e || '');
    if (/failed to fetch|networkerror|load failed|network/i.test(m)) {
      return 'Sin conexión, reintentando… (revisa tu internet y config.js)';
    }
    return m;
  };
  const tabla = (cab, filas, clase = '') =>
    `<div class="scroll"><table class="${clase}"><thead><tr>${cab.map((h) => `<th>${h}</th>`).join('')}</tr></thead>` +
    `<tbody>${filas.map((f) => `<tr>${f.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

  function finRonda(r) {
    const s = datos.sala;
    const inicio = r === 1
      ? new Date(s.iniciada_en).getTime()
      : new Date((datos.rondas.find((x) => x.numero === r - 1) || {}).cerrada_en).getTime();
    if (!inicio || isNaN(inicio)) return null;
    return inicio + s.segundos * 1000;
  }

  // ---------- PANTALLAS ----------
  const PLANTILLAS = {
    inicio: () => `
      <section class="card">
        <h1>Juego de Reposición</h1>
        <p class="ayuda">Fábrica, distribuidor y tienda, en 2 equipos de 3. Gana quien tenga más utilidad al final.</p>
        <label>Tu nombre
          <input id="nombre" value="${esc(nombre)}" maxlength="20" autocomplete="off">
        </label>
        <h2>Crear sala nueva</h2>
        <div class="fila">
          <label>Semanas (5 a 60)
            <input id="rondas" type="number" value="30" min="5" max="60" inputmode="numeric">
          </label>
          <label>Segundos por decisión
            <input id="segundos" type="number" value="60" min="20" max="180" inputmode="numeric">
          </label>
        </div>
        <button class="principal" data-accion="crear">Crear sala</button>
        <h2>Unirse a una sala</h2>
        <label>Código de sala (4 letras o números)
          <input id="codigo" value="${esc(codigoUrl)}" maxlength="4" autocapitalize="characters" autocomplete="off">
        </label>
        <button class="principal" data-accion="unirse">Unirme</button>
        <p id="aviso" class="aviso"></p>
      </section>`,
    lobby: () => `
      <section class="card">
        <h1>Sala de espera</h1>
        <div id="lobby"></div>
        <p id="aviso" class="aviso"></p>
      </section>`,
    juego: () => `
      <header class="barra">
        <strong id="cab"></strong>
        <span id="tiempo" class="tiempo"></span>
      </header>
      <p id="aviso" class="aviso"></p>
      <section class="card" id="mi"></section>
      <section class="card" id="inf"></section>
      <section class="card" id="ult"></section>
      <section class="card" id="marc"></section>`,
    fin: () => `<section class="card" id="fin"></section>`,
  };

  function construir(p) {
    pantalla = p;
    app.innerHTML = PLANTILLAS[p]();
  }

  // ---------- ACCIONES ----------
  function entrar(codigo) {
    sala = codigo;
    localStorage.setItem('sala', codigo);
    localStorage.setItem('nombre', nombre);
    datos = null;
    pantalla = '';
    refrescar();
  }

  function salir() {
    sala = null;
    datos = null;
    estado = null;
    localStorage.removeItem('sala');
    pantalla = '';
    construir('inicio');
  }

  async function crearSala() {
    nombre = val('nombre').trim();
    const { data, error } = await sb.rpc('crear_sala', {
      p_nombre: nombre, p_jugador: jugadorId, p_rondas: Number(val('rondas')), p_segundos: Number(val('segundos')),
    });
    if (error) return aviso(mensajeError(error));
    entrar(data);
  }

  async function unirse() {
    nombre = val('nombre').trim();
    const codigo = val('codigo').trim().toUpperCase();
    if (!codigo) return aviso('Escribe el código de la sala');
    const { error } = await sb.rpc('unirse_sala', { p_codigo: codigo, p_jugador: jugadorId, p_nombre: nombre });
    if (error) return aviso(mensajeError(error));
    entrar(codigo);
  }

  async function iniciar() {
    const { error } = await sb.rpc('iniciar_sala', { p_codigo: sala, p_jugador: jugadorId });
    if (error) return aviso(mensajeError(error));
    refrescar();
  }

  async function salirDeSala() {
    const { error } = await sb.rpc('salir_sala', { p_codigo: sala, p_jugador: jugadorId });
    if (error) return aviso(mensajeError(error));
    salir();
  }

  // Lee el formulario de la pantalla según el rol de este jugador
  function porIndice(sel) {
    const arr = PRODUCTOS.map(() => null);
    document.querySelectorAll(sel).forEach((el) => { arr[Number(el.dataset.i)] = el.value; });
    return arr;
  }
  const enteros = (arr) => arr.map((v) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n > 0 ? n : 0;
  });
  function leerFormulario(rol) {
    if (rol === 'fabrica') {
      return { calidad: porIndice('#mi .cal'), produccion: enteros(porIndice('#mi .prod')) };
    }
    if (rol === 'distribuidor') {
      const pujas = INF_KEYS.map((k, idx) => {
        const inf = estado.inf[k];
        if (actual < inf.ocupadoHasta) return null;           // influencer ocupado: no se puja
        const el = document.querySelector(`#mi .pm[data-k="${idx}"]`);
        const monto = el ? Math.floor(Number(el.value)) : 0;
        if (!(monto > 0)) return null;                        // 0 = no pujó
        return { monto };
      });
      return { pedido: enteros(porIndice('#mi .ped')), pujas };
    }
    // tienda
    return {
      precio: porIndice('#mi .pre').map((v) => (v === null || v === '' ? null : Number(v))),
      pedido: enteros(porIndice('#mi .ped')),
    };
  }

  async function enviarDec() {
    const yo = datos && datos.yo;
    if (!yo || !yo.rol) return;
    const { error } = await sb.rpc('enviar_decision', {
      p_codigo: sala, p_jugador: jugadorId, p_ronda: actual, p_payload: leerFormulario(yo.rol),
    });
    if (error) return aviso(mensajeError(error));
    aviso('✔ Decisión enviada');
    refrescar();
  }

  document.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-accion]');
    if (!b) return;
    try {
      const a = b.dataset.accion;
      if (a === 'crear') await crearSala();
      else if (a === 'unirse') await unirse();
      else if (a === 'iniciar') await iniciar();
      else if (a === 'enviar-dec') await enviarDec();
      else if (a === 'salir-sala') await salirDeSala();
      else if (a === 'salir') salir();
    } catch (e) {
      aviso(mensajeError(e));
    }
  });

  // ---------- LECTURA Y CIERRE DE SEMANAS ----------
  async function refrescar() {
    if (!sala) return;
    // Si una lectura se queda colgada más de 10 s, se libera para no congelar la pantalla
    if (ocupado && Date.now() - ocupadoDesde < 10000) return;
    ocupado = true;
    ocupadoDesde = Date.now();
    try {
      const [s, j, r, d, yo] = await Promise.all([
        sb.from('salas').select(COLS_SALA).eq('codigo', sala).maybeSingle(),
        sb.from('jugadores').select(COLS_JUG).eq('sala', sala).order('unido_en'),
        sb.from('rondas').select(COLS_RON).eq('sala', sala).order('numero'),
        sb.from('decisiones').select(COLS_DEC).eq('sala', sala),
        sb.rpc('mi_jugador', { p_codigo: sala, p_jugador: jugadorId }),
      ]);
      const err = s.error || j.error || r.error || d.error || yo.error;
      if (err) throw new Error(err.message);
      if (!s.data) { salir(); return; }

      datos = {
        sala: s.data, jugadores: j.data, rondas: r.data, decisiones: d.data,
        yo: yo.data || null, miDec: null, semana: null,
      };
      const sem = await sb.rpc('estado_semana', { p_codigo: sala });
      if (sem.error) throw new Error(sem.error.message);
      datos.semana = sem.data;
      await intentarCerrar(sem.data);

      if (datos.sala.estado === 'jugando' && sem.data) {
        const md = await sb.rpc('mi_decision', { p_codigo: sala, p_jugador: jugadorId, p_ronda: sem.data.ronda });
        if (md.error) throw new Error(md.error.message);
        datos.miDec = md.data ?? null;   // null si todavía no decide esta semana
      }
      calcular();
      pintar();
    } catch (e) {
      aviso(mensajeError(e));
    } finally {
      ocupado = false;
    }
  }

  // Si ya decidieron los 6 o se acabó el tiempo, pide cerrar la semana.
  // El servidor decide de verdad; si el reloj de este celular se adelanta, no pasa nada.
  async function intentarCerrar(sem) {
    if (!sem || datos.sala.estado !== 'jugando') return;
    if (sem.ronda > sem.total) return;
    const fin = sem.fin ? new Date(sem.fin).getTime() : null;
    if (sem.votos >= 6 || (fin && Date.now() >= fin)) {
      await sb.rpc('cerrar_ronda', { p_codigo: sala });
    }
  }

  function calcular() {
    const s = datos.sala;
    const porRonda = JR.armarDecisiones(datos.decisiones, s.total_rondas);
    const cerradas = datos.rondas.length;
    estado = JR.reproducir(s.semilla, porRonda.slice(0, cerradas));
    actual = cerradas + 1;
  }

  function pintar() {
    const s = datos.sala;
    if (s.estado === 'espera') return pintarLobby();
    if (s.estado === 'terminado') return pintarFin();
    return pintarJuego();
  }

  // ---------- LOBBY ----------
  function pintarLobby() {
    if (pantalla !== 'lobby') construir('lobby');
    const s = datos.sala;
    const soyAnfitrion = !!(datos.yo && datos.yo.es_anfitrion);
    const listo = datos.jugadores.length === 6;
    const link = `${location.origin}${location.pathname}?sala=${s.codigo}`;
    const lista = datos.jugadores.map((j) =>
      `<li>${esc(j.nombre)}${j.es_anfitrion ? ' 👑' : ''}</li>`
    ).join('');
    render($('lobby'), `
      <p>Código de sala: <strong class="codigo">${esc(s.codigo)}</strong></p>
      <p class="ayuda">Comparte este link con tus amigos (ya trae el código):</p>
      <input class="link" readonly value="${esc(link)}" onclick="this.select()">
      <p>Semanas: <b>${s.total_rondas}</b> · Segundos por decisión: <b>${s.segundos}</b></p>
      <p>Jugadores: <b>${datos.jugadores.length}/6</b></p>
      <ul class="lista">${lista}</ul>
      ${soyAnfitrion
        ? `<button class="principal" data-accion="iniciar" ${listo ? '' : 'disabled'}>
             ${listo ? 'Iniciar partida' : 'Esperando a 6 jugadores…'}</button>`
        : '<p class="ayuda">Esperando a que quien creó la sala inicie la partida…</p>'}
      <button class="secundario" data-accion="salir-sala">Salir de la sala</button>
      <details class="reglas" open>
        <summary>Reglas en 1 minuto</summary>
        <ul>
          <li>Cada equipo tiene fábrica → distribuidor → tienda. Cada rol decide su área.</li>
          <li>Fábrica: calidad y producción. Distribuidor: pedidos a fábrica y pujas por influencers. Tienda: precio y pedidos al distribuidor.</li>
          <li>Hay 5 sabores. La demanda es del mercado y la comparten los dos equipos; cambia cada semana.</li>
          <li>Ganancia del equipo = ventas − costo de lo vendido − mantenimiento del stock − pujas pagadas.</li>
          <li>Influencers (opcionales): suben la demanda de todos los sabores de su equipo. Las pujas son secretas: gana el monto más alto y paga ese monto. Si hay empate, gana el equipo con mejor calidad.</li>
        </ul>
      </details>
      <p class="ayuda">Versión del juego: ${esc(JR.VERSION)}</p>
    `);
  }

  // ---------- JUEGO ----------
  function pintarJuego() {
    if (pantalla !== 'juego') construir('juego');
    const s = datos.sala;
    const yo = datos.yo;
    if (!yo) {
      render($('mi'), '<p>No apareces en esta sala.</p><button class="secundario" data-accion="salir">Volver al inicio</button>');
      return;
    }
    $('cab').textContent = `Semana ${actual} de ${s.total_rondas} · ${EQ[yo.equipo]} · ${ROLN[yo.rol]}`;
    const ult = estado.historial[estado.historial.length - 1];
    const rep = ult ? ult.equipos[yo.equipo] : null;
    render($('mi'), htmlMi(yo, rep));
    render($('inf'), htmlInf());
    render($('ult'), htmlUlt(yo, ult));
    render($('marc'), htmlMarc(yo, ult));
    actualizarTiempo();
  }

  function htmlMi(yo, rep) {
    const eq = estado.equipos[yo.equipo];
    const pl = datos.miDec || {};
    const enviada = datos.miDec !== null;
    // Valores ya limpiados por el motor, para mostrar lo que realmente se usará
    const lim = JR.leerDecision({ [yo.rol]: pl });
    const enCamino = (clave) => PRODUCTOS.map((_, i) =>
      eq.enTransito[clave].filter((e) => e.p === i).reduce((a, e) => a + e.q, 0));
    const stock = eq.stock[yo.rol].map((L) => L.q);
    const boton = `<button class="principal" data-accion="enviar-dec">${enviada ? 'Actualizar decisión' : 'Enviar decisión'}</button>`;
    const estadoEnvio = `<p class="estado">${enviada
      ? '✔ Decisión enviada. Puedes cambiarla hasta que acabe el tiempo.'
      : 'Aún no envías tu decisión.'}</p>`;

    if (yo.rol === 'fabrica') {
      const sugerido = (i) => (rep ? rep.pedidoFab[i] : Math.round(PRODUCTOS[i].demMedia));
      const pCal = (i) => lim.calidad[i] || eq.calidad[i];
      const pProd = (i) => (pl.produccion !== undefined ? lim.produccion[i] : sugerido(i));
      const camino = enCamino('prod');
      const tablaStock = tabla(
        ['Sabor', 'Stock terminado', 'En producción', 'Calidad actual'],
        PRODUCTOS.map((p, i) => [chip(p), num(stock[i]), num(camino[i]), CALIDADES[eq.calidad[i]].nombre])
      );
      const formulario = tabla(
        ['Sabor', 'Calidad', 'Producir (llega en 2 semanas)'],
        PRODUCTOS.map((p, i) => [
          chip(p),
          `<select class="cal" data-i="${i}">${Object.entries(CALIDADES).map(([k, v]) =>
            `<option value="${k}" ${pCal(i) === k ? 'selected' : ''}>${v.nombre} (${dinero2(CONFIG.costoBase * v.costo)} por galleta)</option>`).join('')}</select>`,
          `<input type="number" class="prod" data-i="${i}" min="0" max="${p.capProd}" inputmode="numeric" value="${pProd(i)}">`,
        ]),
        'form'
      );
      const ultima = rep
        ? `<h3>Lo que pasó la semana pasada</h3>` + tabla(
            ['Sabor', 'Pedido del distribuidor', 'Producido', 'Despachado al distribuidor'],
            PRODUCTOS.map((p, i) => [chip(p), num(rep.pedidoFab[i]), num(rep.produccion[i]), num(rep.despFD[i])]))
        : '<p class="ayuda">Aquí verás lo que pasó cuando termine la primera semana.</p>';
      return `
        <h2>Tu decisión · Fábrica</h2>
        <p class="ayuda">Decides la calidad de cada sabor y cuánto producir. Lo que produces llega a tu stock en 2 semanas. Cada galleta paga su costo cuando se vende.</p>
        <h3>Tu stock</h3>
        ${tablaStock}
        ${ultima}
        <h3>Decide esta semana</h3>
        <p class="ayuda">Te sugerimos producir lo que pidió el distribuidor la semana pasada. Puedes cambiarlo.</p>
        ${formulario}
        ${boton}${estadoEnvio}`;
    }

    if (yo.rol === 'distribuidor') {
      const sugerido = (i) => (rep ? rep.pedidoDist[i] : Math.round(PRODUCTOS[i].demMedia));
      const pPed = (i) => (pl.pedido !== undefined ? lim.pedidoFab[i] : sugerido(i));
      const camino = enCamino('fd');
      const tablaStock = tabla(
        ['Sabor', 'Stock', 'Llegando de fábrica'],
        PRODUCTOS.map((p, i) => [chip(p), num(stock[i]), num(camino[i])])
      );
      const formulario = tabla(
        ['Sabor', 'Pedir a fábrica (llega en 2 semanas)'],
        PRODUCTOS.map((p, i) => [
          chip(p),
          `<input type="number" class="ped" data-i="${i}" min="0" max="${CONFIG.tope}" inputmode="numeric" value="${pPed(i)}">`,
        ]),
        'form'
      );
      const ultima = rep
        ? `<h3>Lo que pasó la semana pasada</h3>` + tabla(
            ['Sabor', 'Pedido de la tienda', 'Despachado a la tienda', 'Tu pedido a fábrica', 'Despachado por fábrica'],
            PRODUCTOS.map((p, i) => [chip(p), num(rep.pedidoDist[i]), num(rep.despDT[i]), num(rep.pedidoFab[i]), num(rep.despFD[i])]))
        : '';
      return `
        <h2>Tu decisión · Distribuidor</h2>
        <p class="ayuda">Decides cuánto pedir a fábrica y pujas por los influencers. Lo que pida la tienda sale de tu stock.</p>
        <h3>Tu stock</h3>
        ${tablaStock}
        ${ultima}
        <h3>Pedido a fábrica</h3>
        ${formulario}
        ${htmlSubasta(lim)}
        ${boton}${estadoEnvio}`;
    }

    // tienda
    const pPre = (i) => (lim.precio[i] !== null ? lim.precio[i] : eq.precio[i]);
    const pPedT = (i) => (pl.pedido !== undefined ? lim.pedidoDist[i] : (rep ? rep.demanda[i] : Math.round(PRODUCTOS[i].demMedia)));
    const camino = enCamino('dt');
    const tablaStock = tabla(
      ['Sabor', 'Stock', 'Llegando del distribuidor', 'Precio actual'],
      PRODUCTOS.map((p, i) => [chip(p), num(stock[i]), num(camino[i]), dinero2(eq.precio[i])])
    );
    const formulario = tabla(
      ['Sabor', 'Precio al cliente ($2.50 a $8.00)', 'Pedir al distribuidor (llega en 2 semanas)'],
      PRODUCTOS.map((p, i) => [
        chip(p),
        `<input type="number" class="pre" data-i="${i}" min="${CONFIG.precioMin}" max="${CONFIG.precioMax}" step="0.1" inputmode="decimal" value="${pPre(i).toFixed(2)}">`,
        `<input type="number" class="ped" data-i="${i}" min="0" max="${CONFIG.tope}" inputmode="numeric" value="${pPedT(i)}">`,
      ]),
      'form'
    );
    const ultima = rep
      ? `<h3>Lo que pasó la semana pasada</h3>` + tabla(
          ['Sabor', 'Precio', 'Demanda', 'Vendido', 'Perdido', 'Clientes de la otra tienda', 'Clientes que se fueron'],
          PRODUCTOS.map((p, i) => [chip(p), dinero2(rep.precio[i]), num(rep.demanda[i]), num(rep.vendido[i]),
            num(rep.perdidoFinal[i]), num(rep.desvRec[i]), num(rep.desvEnv[i])]))
      : '<p class="ayuda">Aquí verás lo que pasó cuando termine la primera semana.</p>';
    return `
      <h2>Tu decisión · Tienda final</h2>
      <p class="ayuda">Decides el precio de cada sabor y cuánto pedir al distribuidor. Vendes a los clientes desde tu stock.</p>
      <h3>Tu stock</h3>
      ${tablaStock}
      ${ultima}
      <h3>Precio y pedido</h3>
      <p class="ayuda">Un precio más alto baja tu parte de la demanda y la pasa a la otra tienda. Te sugerimos pedir lo que se demandó la semana pasada.</p>
      ${formulario}
      ${boton}${estadoEnvio}`;
  }

  // Pujas secretas por los influencers (solo distribuidores). Solo se pide un monto.
  function htmlSubasta(lim) {
    const filas = INF_KEYS.map((k, idx) => {
      const inf = estado.inf[k];
      const info = INFLUENCERS[k];
      const ocupado = actual < inf.ocupadoHasta;
      const monto = lim.pujas[idx] ? lim.pujas[idx].monto : 0;
      const estadoTxt = ocupado
        ? `<span class="neg">Ocupado</span><br><small>${esc(EQ[inf.dueno])} · +${pct(inf.uplift)} en todos los sabores · hasta la semana ${inf.hasta}</small>`
        : `<span class="pos">Libre</span><br><small>sube la demanda ${pct(info.min)} a ${pct(info.max)}</small>`;
      return [
        `<b>Influencer ${k}</b>`,
        estadoTxt,
        ocupado ? '—' : `<input type="number" class="pm" data-k="${idx}" min="0" max="${CONFIG.topeMonto}" step="1" inputmode="numeric" value="${monto}">`,
      ];
    });
    return `
      <h3>Subasta de influencers</h3>
      <p class="ayuda">Pujas secretas: gana el monto más alto y paga ese monto. Si hay empate en el monto, gana el equipo con mejor calidad promedio; si también empatan en calidad, gana al azar. Pon 0 si no quieres pujar. Solo puedes pujar por los influencers libres.</p>
      ${tabla(['Influencer', 'Estado', 'Tu monto ($)'], filas, 'form')}`;
  }

  // Estado público de los influencers (lo ve todo el mundo)
  function htmlInf() {
    const filas = INF_KEYS.map((k) => {
      const inf = estado.inf[k];
      const info = INFLUENCERS[k];
      const ocupado = actual < inf.ocupadoHasta;
      const estadoTxt = ocupado
        ? `<span class="neg">Ocupado</span> · ${esc(EQ[inf.dueno])} · +${pct(inf.uplift)} · hasta la semana ${inf.hasta}`
        : '<span class="pos">Libre</span> · se subasta esta semana';
      return [`<b>Influencer ${k}</b>`, `${pct(info.min)} a ${pct(info.max)}`, estadoTxt];
    });
    return `
      <h2>Influencers</h2>
      ${tabla(['Influencer', 'Sube la demanda', 'Estado'], filas)}
      <p class="ayuda">Un influencer sube la demanda de todos los sabores de su equipo y dura 2 semanas.</p>`;
  }

  function htmlUlt(yo, ult) {
    if (!ult) {
      return '<h2>Resultados</h2><p class="ayuda">Aquí verás los resultados de tu equipo al terminar la primera semana.</p>';
    }
    const r = ult.equipos[yo.equipo];
    const u = r.utilidadRonda;
    let html = `
      <h2>Última semana (${ult.ronda}) · ${EQ[yo.equipo]}</h2>
      <p>Ganancia del equipo esta semana: <b class="${u.total >= 0 ? 'pos' : 'neg'}">${money(u.total)}</b></p>
      <p class="ayuda">Margen de ventas ${money(u.ventas)} − mantenimiento ${money(u.mantenimiento)} − pujas pagadas ${money(u.influencers)}</p>`;

    if (yo.rol === 'distribuidor') {
      const prev = datos.decisiones.find((x) => x.ronda === ult.ronda && x.equipo === yo.equipo && x.rol === 'distribuidor');
      const pb = prev && prev.payload && Array.isArray(prev.payload.pujas) ? prev.payload.pujas : [];
      const filas = INF_KEYS.map((k, idx) => {
        const b = pb[idx];
        const txt = b && Number(b.monto) > 0 ? money(Number(b.monto)) : '—';
        return [`Influencer ${k}`, txt, RES[r.pujas[idx]] || esc(r.pujas[idx])];
      });
      html += `<h3>Tus pujas de la semana pasada</h3>` + tabla(['Influencer', 'Tu puja', 'Resultado'], filas);
    }

    html += `<h3>Ventas de la tienda</h3>` + tabla(
      ['Sabor', 'Demanda', 'Vendido', 'Perdido', 'Clientes de la otra tienda', 'Clientes que se fueron'],
      PRODUCTOS.map((p, i) => [chip(p), num(r.demanda[i]), num(r.vendido[i]), num(r.perdidoFinal[i]),
        num(r.desvRec[i]), num(r.desvEnv[i])]));
    return html;
  }

  function htmlMarc(yo, ult) {
    const filas = JR.EQUIPOS.map((X) => {
      const u = estado.equipos[X].utilidad;
      const semana = ult ? ult.equipos[X].utilidadRonda.total : 0;
      return [
        `${EQ[X]}${yo && X === yo.equipo ? ' (tú)' : ''}`,
        money(u.ventas), money(u.mantenimiento), money(u.influencers),
        `<b>${money(JR.sumaUtil(u))}</b>`, money(semana),
      ];
    });
    return `
      <h2>Marcador</h2>
      ${tabla(['Equipo', 'Margen de ventas', 'Mantenimiento', 'Pujas pagadas', 'Total', 'Última semana'], filas)}
      <p class="ayuda">Gana el equipo con más total al terminar la partida.</p>`;
  }

  function actualizarTiempo() {
    const el = $('tiempo');
    if (!el || !datos || !datos.sala || datos.sala.estado !== 'jugando' || !actual) return;
    const fin = finRonda(actual);
    if (!fin) return;
    const seg = Math.max(0, Math.ceil((fin - Date.now()) / 1000));
    el.textContent = seg > 0 ? `⏱ ${seg} s` : 'Cerrando semana…';
  }

  // ---------- FIN ----------
  function pintarFin() {
    if (pantalla !== 'fin') construir('fin');
    const total = JR.puntajes(estado);
    const ganador = total.A > total.B ? 'A' : total.B > total.A ? 'B' : null;
    const ult = estado.historial[estado.historial.length - 1];
    const yo = datos.yo;
    const equipos = JR.EQUIPOS.map((X) => {
      const integrantes = datos.jugadores
        .filter((j) => j.equipo === X)
        .map((j) => `${esc(j.nombre)} <small>(${ROLN[j.rol]})</small>`).join('<br>');
      return `<div class="equipo"><h3>${EQ[X]}</h3><p>${integrantes}</p></div>`;
    }).join('');
    render($('fin'), `
      <h1>Partida terminada</h1>
      <p class="ganador">${ganador
        ? `🏆 Gana ${EQ[ganador]}${yo && yo.equipo === ganador ? ' (¡tu equipo!)' : ''}`
        : 'Empate'}</p>
      <div class="fila">${equipos}</div>
      ${htmlMarc(yo, ult)}
      <button class="principal" data-accion="salir">Nueva partida</button>
      <p class="ayuda">Versión del juego: ${esc(JR.VERSION)}</p>`);
  }

  // ---------- ARRANQUE ----------
  if (sala) {
    refrescar();
  } else {
    construir('inicio');
  }
  setInterval(refrescar, 1200);
  setInterval(actualizarTiempo, 500);
})();

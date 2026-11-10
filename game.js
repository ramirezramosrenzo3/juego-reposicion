/*
  MOTOR DEL JUEGO DE REPOSICIÓN (versión 3.1: con bots)
  -----------------------------------------
  Función pura y determinista: con la misma semilla y las mismas decisiones,
  cualquier celular calcula exactamente el mismo resultado.
  Las reglas completas están en REGLAS.md. Aquí solo se calcula.
*/
(function () {
  'use strict';

  // ---------- PARÁMETROS (ajustables) ----------
  const CONFIG = {
    lead: 2,                       // semanas de espera en cada etapa
    costoBase: 2.0,                // costo de producir una galleta (calidad estándar)
    precioFab: 2.6,                // fábrica -> distribuidor
    precioDist: 3.4,               // distribuidor -> tienda
    precioBase: 4.5,               // precio al cliente de partida (referencia de la demanda)
    precioMin: 2.5,
    precioMax: 8.0,
    elasticidad: 1.8,              // qué tanto baja la demanda al subir el precio
    crecimientoMercado: 0.5,       // qué tanto crece el mercado total cuando los equipos son más atractivos
    tasaMantenimiento: 0.03,       // 3% del valor del stock por semana
    probDesvioMin: 0.2,
    probDesvioMax: 0.6,
    ruidoDemanda: 0.3,             // ±30% de variación de la demanda del mercado
    tope: 500,                     // máximo de unidades por pedido
    topeMonto: 10000,              // máximo de una puja
    duracionInfluencer: 2,         // semanas que dura un influencer
    stockInicial: { fabrica: 1.5, distribuidor: 1, tienda: 0.5 },
  };

  const PRODUCTOS = [
    { id: 'chocolate', nombre: 'Chocolate', color: '#8B5E3C', capProd: 250, demMedia: 90 },
    { id: 'vainilla',  nombre: 'Vainilla',  color: '#F7E8D0', capProd: 220, demMedia: 80 },
    { id: 'menta',     nombre: 'Menta',     color: '#A8E6C1', capProd: 200, demMedia: 70 },
    { id: 'fresa',     nombre: 'Fresa',     color: '#F7A4C6', capProd: 180, demMedia: 60 },
    { id: 'mora',      nombre: 'Mora',      color: '#8E4B77', capProd: 160, demMedia: 50 },
  ];

  const CALIDADES = {
    economico: { nombre: 'Económico', costo: 0.8,  demanda: 0.85 },
    estandar:  { nombre: 'Estándar',  costo: 1.0,  demanda: 1.0 },
    premium:   { nombre: 'Premium',   costo: 1.25, demanda: 1.25 },
  };

  const INFLUENCERS = {
    A: { nombre: 'Influencer A', min: 0.05, max: 0.12 },
    B: { nombre: 'Influencer B', min: 0.08, max: 0.13 },
    C: { nombre: 'Influencer C', min: 0.09, max: 0.16 },
  };
  const INF_KEYS = ['A', 'B', 'C'];

  const EQUIPOS = ['A', 'B'];
  const ROLES = ['fabrica', 'distribuidor', 'tienda'];
  const N = PRODUCTOS.length;

  // Versión del motor: se muestra en la sala para detectar celulares con reglas distintas
  const VERSION = '4.2.2';

  // ---------- UTILIDADES ----------
  const zeros = () => Array(N).fill(0);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const sumaUtil = (u) => u.ventas - u.mantenimiento - u.influencers;

  function crearRng(semilla) {
    let a = semilla >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Stock por sabor: {q: unidades, c: costo promedio por unidad}
  const lotesVacios = () => PRODUCTOS.map(() => ({ q: 0, c: CONFIG.costoBase }));
  function agregar(lista, i, q, c) {
    if (q <= 0) return;
    const L = lista[i];
    const total = L.q + q;
    L.c = (L.q * L.c + q * c) / total;
    L.q = total;
  }
  function retirar(lista, i, q) {
    const L = lista[i];
    const n = Math.min(q, L.q);
    L.q -= n;
    return { q: n, c: L.c };
  }

  // Calidad promedio de un equipo (usada para desempatar la subasta)
  // Se suma en enteros (×100) para que dos equipos con la misma calidad empaten exactamente
  function calidadPromedio(eq) {
    return eq.calidad.reduce((a, k) => a + Math.round(CALIDADES[k].demanda * 100), 0);
  }

  // ---------- ESTADO INICIAL ----------

  // ---------- EVENTOS ALEATORIOS (versión 4.2) ----------
  // efectos: cambio porcentual de la demanda del mercado por sabor, en el orden de PRODUCTOS
  // (chocolate, vainilla, menta, fresa, mora). Los sabores que no aparecen no cambian.
  const EVENTOS = [
    { id: 'navidad', nombre: 'Navidad', duracion: 4, efectos: { 0: 0.20, 1: 0.20, 4: -0.10 },
      desc: 'Llegó la Navidad, aumenta el consumo de galletas tradicionales.' },
    { id: 'maincra', nombre: 'MAINCRA', duracion: 4, efectos: { 0: -0.15, 1: -0.15, 2: -0.15, 3: -0.15, 4: 0.05 },
      desc: '¡Ratas en la cocina! Que inicie la desratización.' },
    { id: 'cyber', nombre: 'Cyber Galletas', duracion: 4, efectos: { 3: 0.10, 1: 0.10, 4: 0.04 },
      desc: 'Llegaron las ofertas de Cyber Galletas.' },
    { id: 'covid', nombre: 'COVID-20', duracion: 4, efectos: { 0: -0.07, 1: -0.07 },
      desc: 'La gente empezará a comprar más papel higiénico que galletas.' },
    { id: 'nino', nombre: 'Fenómeno del Niño', duracion: 4, efectos: { 0: -0.16, 3: 0.12, 4: 0.05 },
      desc: '¡Lima está que arde! Todo se derrite...' },
    { id: 'mochila', nombre: 'Mochila perdida', duracion: 4, efectos: { 2: -0.11, 1: -0.11 },
      desc: 'Durante un paseo escolar se perdió una mochila llena de galletas.' },
    { id: 'happy', nombre: 'Happy Cookies', duracion: 4, efectos: { 2: 0.19, 0: -0.03, 1: -0.03, 3: -0.03, 4: -0.03 },
      desc: 'El sabor de la menta... ¿es más pastoso?' },
    { id: 'muffin', nombre: '¡¡¡ALERTA MUFFIN!!!', duracion: 4, efectos: { 0: -0.09, 1: -0.09, 4: -0.09 },
      desc: 'Ha llegado un nuevo competidor de MUFFINS.' },
    { id: 'huelga', nombre: 'Huelga de transportistas', duracion: 1, efectos: {}, logistico: true,
      desc: 'Han cerrado la Panamericana Sur entre Ica y Lima.',
      operativo: 'Esta semana no llegan las reposiciones ni los traslados. Lo pendiente no se pierde: se suma a lo que llega la próxima semana.' },
  ];
  const EVENTO_PRIMERA_RONDA = 5;   // primera semana en la que se evalúa un evento
  const EVENTO_PROB_INICIAL = 40;   // % de probabilidad de la primera evaluación
  const EVENTO_PROB_PASO = 5;       // sube 5 puntos por cada evaluación sin evento
  const EVENTO_ESPERA = 5;          // semanas desde que aparece un evento hasta la siguiente evaluación
  const eventoPorId = (id) => EVENTOS.find((e) => e.id === id) || null;

  // Decide (con el azar de la partida, igual en todos los celulares) si la semana n trae un evento.
  // Se llama al cerrar la semana n-1. No depende de las decisiones de nadie.
  function prepararEvento(estado, n) {
    if (estado.semilla === null || estado.semilla === undefined) return;
    if (estado.evento && n > estado.evento.fin) estado.evento = null;
    if (estado.evento || n < estado.proxEval) return;
    const rng = crearRng((estado.semilla ^ Math.imul(n, 0x85ebca6b) ^ 0x5bd1e995) >>> 0);
    if (rng() < estado.probEvento / 100) {
      const ev = EVENTOS[Math.min(EVENTOS.length - 1, Math.floor(rng() * EVENTOS.length))];
      estado.evento = { id: ev.id, inicio: n, fin: n + ev.duracion - 1 };
      estado.probEvento = EVENTO_PROB_INICIAL;
      estado.proxEval = n + EVENTO_ESPERA;
    } else {
      estado.probEvento = Math.min(100, estado.probEvento + EVENTO_PROB_PASO);
    }
  }
  // Evento que está activo en la semana t (o null)
  function eventoActivo(estado, t) {
    const e = estado.evento;
    return e && t >= e.inicio && t <= e.fin ? e : null;
  }

  function estadoInicial() {
    const equipo = () => {
      const stock = { fabrica: lotesVacios(), distribuidor: lotesVacios(), tienda: lotesVacios() };
      PRODUCTOS.forEach((p, i) => {
        stock.fabrica[i] = { q: Math.round(p.demMedia * CONFIG.stockInicial.fabrica), c: CONFIG.costoBase };
        stock.distribuidor[i] = { q: Math.round(p.demMedia * CONFIG.stockInicial.distribuidor), c: CONFIG.costoBase };
        stock.tienda[i] = { q: Math.round(p.demMedia * CONFIG.stockInicial.tienda), c: CONFIG.costoBase };
      });
      // Envíos ya en camino, para que la primera semana no arranque en cero
      const enTransito = { prod: [], fd: [], dt: [] };
      for (const clave of ['prod', 'fd', 'dt']) {
        PRODUCTOS.forEach((p, i) => {
          for (let w = 1; w <= CONFIG.lead; w++) {
            enTransito[clave].push({ llega: w, p: i, q: Math.round(p.demMedia), c: CONFIG.costoBase });
          }
        });
      }
      return {
        stock,
        enTransito,
        calidad: PRODUCTOS.map(() => 'estandar'),
        precio: PRODUCTOS.map(() => CONFIG.precioBase),
        utilidad: { ventas: 0, mantenimiento: 0, influencers: 0 },
      };
    };
    const inf = {};
    INF_KEYS.forEach((k) => { inf[k] = { ocupadoHasta: 0, dueno: null, uplift: 0, hasta: -1 }; });
    return { ronda: 0, inf, equipos: { A: equipo(), B: equipo() }, historial: [],
      semilla: null, evento: null, probEvento: EVENTO_PROB_INICIAL, proxEval: EVENTO_PRIMERA_RONDA };
  }

  // ---------- LECTURA DE DECISIONES (siempre limpia y acotada) ----------
  // payloads por rol:
  //   fabrica:      { calidad: [5 textos], produccion: [5 números] }
  //   distribuidor: { pedido: [5 números], pujas: [ {monto} | null  x3 (A, B, C) ] }
  //   tienda:       { precio: [5 números], pedido: [5 números] }
  function cantidades(lista, topes) {
    return PRODUCTOS.map((_, i) => {
      const max = topes ? topes[i] : CONFIG.tope;
      const n = Math.floor(Number(Array.isArray(lista) ? lista[i] : 0));
      return Number.isFinite(n) ? clamp(n, 0, max) : 0;
    });
  }
  function leerPuja(x) {
    if (!x || typeof x !== 'object') return null;
    const monto = Math.floor(Number(x.monto));
    if (!Number.isFinite(monto) || monto <= 0) return null;
    return { monto: Math.min(monto, CONFIG.topeMonto) };
  }
  function leerDecision(dec) {
    const f = dec.fabrica || {};
    const d = dec.distribuidor || {};
    const t = dec.tienda || {};
    const calidadValida = (k) => Object.prototype.hasOwnProperty.call(CALIDADES, k);
    return {
      calidad: PRODUCTOS.map((_, i) =>
        Array.isArray(f.calidad) && calidadValida(f.calidad[i]) ? f.calidad[i] : null),
      produccion: cantidades(f.produccion, PRODUCTOS.map((p) => p.capProd)),
      pedidoFab: cantidades(d.pedido),
      pujas: [0, 1, 2].map((k) => leerPuja(Array.isArray(d.pujas) ? d.pujas[k] : null)),
      precio: PRODUCTOS.map((_, i) => {
        const raw = Array.isArray(t.precio) ? t.precio[i] : undefined;
        if (raw === null || raw === undefined || raw === '') return null;
        const v = Number(raw);
        return Number.isFinite(v) ? clamp(Math.round(v * 100) / 100, CONFIG.precioMin, CONFIG.precioMax) : null;
      }),
      pedidoDist: cantidades(t.pedido),
    };
  }

  // ---------- SUBASTA DE INFLUENCERS (pujas secretas) ----------
  // Gana el monto más alto (paga su monto). Empate arriba: gana la mejor calidad
  // promedio; si también empatan en calidad, gana al azar.
  function subastar(estado, t, lect, rng) {
    const res = {};
    INF_KEYS.forEach((k, idx) => {
      const inf = estado.inf[k];
      if (t < inf.ocupadoHasta) {
        res[k] = { ocupado: true, ganador: inf.dueno, desempate: false, uplift: inf.uplift };
        return;
      }
      const ofertas = EQUIPOS
        .map((X) => ({ X, monto: lect[X].pujas[idx] ? lect[X].pujas[idx].monto : 0 }))
        .filter((o) => o.monto > 0);
      let ganador = null;
      let desempate = false;
      if (ofertas.length) {
        const max = Math.max(...ofertas.map((o) => o.monto));
        const top = ofertas.filter((o) => o.monto === max);
        if (top.length === 1) {
          ganador = top[0];
        } else {
          desempate = true;
          const mejor = Math.max(...top.map((o) => calidadPromedio(estado.equipos[o.X])));
          const empatados = top.filter((o) => calidadPromedio(estado.equipos[o.X]) === mejor);
          ganador = empatados.length === 1 ? empatados[0] : empatados[Math.floor(rng() * empatados.length)];
        }
      }
      if (ganador) {
        const info = INFLUENCERS[k];
        const uplift = info.min + (info.max - info.min) * rng();
        inf.ocupadoHasta = t + CONFIG.duracionInfluencer;
        inf.dueno = ganador.X;
        inf.uplift = uplift;
        inf.hasta = t + CONFIG.duracionInfluencer - 1;
        estado.equipos[ganador.X].utilidad.influencers += ganador.monto;
        res[k] = { ocupado: false, ganador: ganador.X, desempate, uplift };
      } else {
        res[k] = { ocupado: false, ganador: null, desempate: false, uplift: 0 };
      }
    });
    return res;
  }

  function resultadoPuja(sub, X, monto) {
    if (sub.ocupado) return 'ocupado';
    if (!monto) return 'sin_puja';
    return sub.ganador === X ? 'gano' : 'perdio';
  }
  const pujaMonto = (L, idx) => (L.pujas[idx] ? L.pujas[idx].monto : 0);

  // Factor de demanda de los influencers de un equipo (aplica a TODOS los sabores)
  function factorInfluencers(estado, X, t) {
    let m = 1;
    INF_KEYS.forEach((k) => {
      const inf = estado.inf[k];
      if (inf.dueno === X && t <= inf.hasta) m *= 1 + inf.uplift;
    });
    return m;
  }

  // ---------- UNA SEMANA ----------
  // decisiones = { A: {fabrica, distribuidor, tienda}, B: {...} }
  function avanzarRonda(estado, t, decisiones, rng) {
    // Demanda del mercado y probabilidad de desvío (las mismas para ambos equipos)
    // Variación uniforme dentro de ±20% de la demanda media
    const base = PRODUCTOS.map((p) => Math.round(p.demMedia * (1 + CONFIG.ruidoDemanda * (2 * rng() - 1))));
    const ev = eventoActivo(estado, t);
    const evId = ev ? ev.id : null;
    const evDef = ev ? eventoPorId(ev.id) : null;
    const huelga = !!(evDef && evDef.logistico);
    const modEv = PRODUCTOS.map((p, i) => 1 + ((evDef && evDef.efectos[i]) || 0));
    const prob = PRODUCTOS.map(() => CONFIG.probDesvioMin + (CONFIG.probDesvioMax - CONFIG.probDesvioMin) * rng());

    const lect = {
      A: leerDecision(decisiones.A || {}),
      B: leerDecision(decisiones.B || {}),
    };
    const antes = {};
    EQUIPOS.forEach((X) => { antes[X] = { ...estado.equipos[X].utilidad }; });

    // 1) Calidad y precio de la semana (se quedan hasta que se cambien)
    EQUIPOS.forEach((X) => {
      const eq = estado.equipos[X];
      lect[X].calidad.forEach((c, i) => { if (c) eq.calidad[i] = c; });
      lect[X].precio.forEach((pr, i) => { if (pr !== null) eq.precio[i] = pr; });
    });

    // 2) Subasta de influencers
    const subasta = subastar(estado, t, lect, rng);

    // 3) Llegadas, producción y pedidos de cada equipo
    const ctx = {};
    EQUIPOS.forEach((X) => {
      const eq = estado.equipos[X];
      const L = lect[X];
      for (const [clave, destino] of [['prod', 'fabrica'], ['fd', 'distribuidor'], ['dt', 'tienda']]) {
        eq.enTransito[clave] = eq.enTransito[clave].filter((e) => {
          if (!huelga && e.llega <= t) {   // en huelga nada llega: queda pendiente para la próxima semana
            agregar(eq.stock[destino], e.p, e.q, e.c);
            return false;
          }
          return true;
        });
      }
      PRODUCTOS.forEach((p, i) => {
        const n = L.produccion[i];
        if (n > 0) {
          eq.enTransito.prod.push({ llega: t + CONFIG.lead, p: i, q: n, c: CONFIG.costoBase * CALIDADES[eq.calidad[i]].costo });
        }
      });
      const despFD = zeros();
      PRODUCTOS.forEach((p, i) => {
        const lote = retirar(eq.stock.fabrica, i, L.pedidoFab[i]);
        if (lote.q > 0) eq.enTransito.fd.push({ llega: t + CONFIG.lead, p: i, q: lote.q, c: lote.c });
        despFD[i] = lote.q;
      });
      const despDT = zeros();
      PRODUCTOS.forEach((p, i) => {
        const lote = retirar(eq.stock.distribuidor, i, L.pedidoDist[i]);
        if (lote.q > 0) eq.enTransito.dt.push({ llega: t + CONFIG.lead, p: i, q: lote.q, c: lote.c });
        despDT[i] = lote.q;
      });
      ctx[X] = {
        produccion: L.produccion.slice(),
        pedidoFab: L.pedidoFab.slice(),
        pedidoDist: L.pedidoDist.slice(),
        despFD, despDT,
        desvEnv: zeros(), desvRec: zeros(),
      };
    });

    // 4) Demanda compartida: el mercado de cada sabor se reparte según el atractivo de cada equipo
    //    atractivo = (precio de referencia / precio)^elasticidad × factor de calidad × influencers
    const att = {};
    EQUIPOS.forEach((X) => {
      const eq = estado.equipos[X];
      const fac = factorInfluencers(estado, X, t);
      att[X] = PRODUCTOS.map((p, i) =>
        Math.pow(CONFIG.precioBase / eq.precio[i], CONFIG.elasticidad) * CALIDADES[eq.calidad[i]].demanda * fac);
    });
    const demanda = { A: zeros(), B: zeros() };
    PRODUCTOS.forEach((p, i) => {
      const suma = att.A[i] + att.B[i];
      const mercado = base[i] * modEv[i] * Math.pow(suma / 2, CONFIG.crecimientoMercado);
      EQUIPOS.forEach((X) => { demanda[X][i] = Math.round(mercado * att[X][i] / suma); });
    });

    // 5) Ventas en tienda
    EQUIPOS.forEach((X) => {
      const eq = estado.equipos[X];
      const c = ctx[X];
      c.att = att[X];
      c.demanda = demanda[X];
      c.vendido = zeros();
      PRODUCTOS.forEach((p, i) => {
        const v = Math.min(demanda[X][i], eq.stock.tienda[i].q);
        const lote = retirar(eq.stock.tienda, i, v);
        c.vendido[i] = v;
        eq.utilidad.ventas += v * (eq.precio[i] - lote.c);
      });
      c.perdido = demanda[X].map((x, i) => x - c.vendido[i]);
    });

    // 6) Desvío: clientes sin producto van a la otra tienda si tiene stock
    PRODUCTOS.forEach((p, i) => {
      const desviar = (X, Y) => {
        const cx = ctx[X];
        const cy = ctx[Y];
        const eqY = estado.equipos[Y];
        const pr = clamp((prob[i] * cy.att[i]) / cx.att[i], 0.02, 0.9);
        for (let k = 0; k < cx.perdido[i]; k++) {
          if (eqY.stock.tienda[i].q <= 0) break;
          if (rng() < pr) {
            const lote = retirar(eqY.stock.tienda, i, 1);
            eqY.utilidad.ventas += eqY.precio[i] - lote.c;
            cy.vendido[i] += 1;
            cy.desvRec[i] += 1;
            cx.desvEnv[i] += 1;
          }
        }
      };
      desviar('A', 'B');
      desviar('B', 'A');
    });

    // 7) Mantenimiento del inventario (3% del valor del stock de cada etapa)
    EQUIPOS.forEach((X) => {
      const eq = estado.equipos[X];
      let valor = 0;
      PRODUCTOS.forEach((p, i) => {
        // Fábrica: su costo. Distribuidor y tienda: el precio de transferencia que pagaron (REGLAS sección 12)
        valor += eq.stock.fabrica[i].q * eq.stock.fabrica[i].c
          + eq.stock.distribuidor[i].q * CONFIG.precioFab
          + eq.stock.tienda[i].q * CONFIG.precioDist;
      });
      const costo = CONFIG.tasaMantenimiento * valor;
      eq.utilidad.mantenimiento += costo;
      ctx[X].mantenimiento = costo;
    });

    // 8) Reporte de la semana
    EQUIPOS.forEach((X) => {
      const eq = estado.equipos[X];
      const c = ctx[X];
      c.perdidoFinal = c.perdido.map((x, i) => x - c.desvEnv[i]);
      c.stock = {
        fabrica: eq.stock.fabrica.map((L) => L.q),
        distribuidor: eq.stock.distribuidor.map((L) => L.q),
        tienda: eq.stock.tienda.map((L) => L.q),
      };
      c.calidad = eq.calidad.slice();
      c.precio = eq.precio.slice();
      c.influencers = INF_KEYS
        .filter((k) => estado.inf[k].dueno === X && t <= estado.inf[k].hasta)
        .map((k) => ({ k, uplift: estado.inf[k].uplift }));
      c.pujas = INF_KEYS.map((k, idx) => resultadoPuja(subasta[k], X, pujaMonto(lect[X], idx)));
      c.utilidadRonda = {
        ventas: eq.utilidad.ventas - antes[X].ventas,
        mantenimiento: eq.utilidad.mantenimiento - antes[X].mantenimiento,
        influencers: eq.utilidad.influencers - antes[X].influencers,
      };
      c.utilidadRonda.total = c.utilidadRonda.ventas - c.utilidadRonda.mantenimiento - c.utilidadRonda.influencers;
    });

    estado.ronda = t;
    estado.historial.push({
      ronda: t,
      evento: evId,
      base,
      probDesvio: prob,
      subasta: Object.fromEntries(INF_KEYS.map((k) => [k, {
        ocupado: subasta[k].ocupado,
        ganador: subasta[k].ganador,
        desempate: subasta[k].desempate,
        uplift: subasta[k].uplift,
      }])),
      equipos: ctx,
    });
    prepararEvento(estado, t + 1);
    return estado;
  }

  // Reconstruye todo el juego desde la semana 1 con las decisiones de cada semana.
  function reproducir(semilla, decisionesPorRonda) {
    const estado = estadoInicial();
    estado.semilla = semilla >>> 0;
    decisionesPorRonda.forEach((dec, idx) => {
      const t = idx + 1;
      avanzarRonda(estado, t, dec, crearRng((semilla ^ Math.imul(t, 0x9e3779b1)) >>> 0));
    });
    return estado;
  }

  // Convierte las filas de la base de datos en el formato del motor.
  //  filasDecisiones: [{ronda, jugador, payload}]
  //  jugadores:       [{id, equipo, rol}]
  function armarDecisiones(filas, totalRondas) {
    const salida = Array.from({ length: totalRondas }, () => ({ A: {}, B: {} }));
    filas.forEach((f) => {
      if (!EQUIPOS.includes(f.equipo) || !ROLES.includes(f.rol)) return;
      if (f.ronda < 1 || f.ronda > totalRondas) return;
      salida[f.ronda - 1][f.equipo][f.rol] = f.payload || {};
    });
    return salida;
  }

  function puntajes(estado) {
    return {
      A: sumaUtil(estado.equipos.A.utilidad),
      B: sumaUtil(estado.equipos.B.utilidad),
    };
  }

  // ---------- BOTS ----------
  // Un bot decide solo con lo que muestra el estado de la partida (sin azar):
  // cualquier celular que calcule la decisión de un bot obtiene exactamente la misma.
  // Regla de inventario: mantener "cobertura" semanas de demanda entre stock y pedidos en camino.
  const BOT = {
    cobertura: 4.0,         // semanas de demanda que intenta tener (2 de espera + margen)
    ventana: 3,             // semanas recientes que mira para estimar la demanda
    minCoberturaPuja: 1.5,  // solo puja si la tienda tiene stock para atender más demanda
    // Qué parte de la ganancia esperada ofrece en cada puja (varía por semana). Probado en
    // simulación: ofrecer poco gana más que ofrecer mucho cuando ambos equipos pujan.
    fraccionesPuja: [0.15, 0.2, 0.25],
  };

  // Promedio de un dato de las últimas semanas (p. ej. lo que pidió el distribuidor)
  function promedioReciente(estado, X, campo, i, porDefecto) {
    const h = estado.historial.slice(-BOT.ventana);
    if (!h.length) return porDefecto;
    return h.reduce((a, r) => a + r.equipos[X][campo][i], 0) / h.length;
  }
  const enCamino = (eq, clave, i) =>
    eq.enTransito[clave].filter((e) => e.p === i).reduce((a, e) => a + e.q, 0);
  // Unidades a pedir para volver a la cobertura objetivo
  const faltante = (necesidad, posicion, tope) =>
    clamp(Math.ceil(necesidad * BOT.cobertura - posicion), 0, tope);

  // estado = partida después de cerrar la semana t-1; t = semana que se decide.
  // Devuelve el mismo formato que envía una persona (ver "payloads por rol").
  function decisionBot(estado, X, rol, t) {
    const eq = estado.equipos[X];
    const mitad = (i) => PRODUCTOS[i].demMedia / 2;   // cada equipo atiende ~la mitad del mercado

    if (rol === 'fabrica') {
      return {
        calidad: PRODUCTOS.map(() => 'estandar'),
        produccion: PRODUCTOS.map((p, i) => faltante(
          promedioReciente(estado, X, 'pedidoFab', i, mitad(i)),
          eq.stock.fabrica[i].q + enCamino(eq, 'prod', i),
          p.capProd)),
      };
    }

    if (rol === 'distribuidor') {
      const pedido = PRODUCTOS.map((p, i) => faltante(
        promedioReciente(estado, X, 'pedidoDist', i, mitad(i)),
        eq.stock.distribuidor[i].q + enCamino(eq, 'fd', i),
        CONFIG.tope));

      // Cuánta demanda atiende la tienda y qué tan cubierta está (para decidir si conviene un influencer)
      let demanda = 0;
      let margen = 0;
      let posicion = 0;
      PRODUCTOS.forEach((p, i) => {
        const d = promedioReciente(estado, X, 'demanda', i, mitad(i));
        demanda += d;
        margen += d * Math.max(0, eq.precio[i] - CONFIG.costoBase * CALIDADES[eq.calidad[i]].costo);
        posicion += eq.stock.tienda[i].q + enCamino(eq, 'dt', i);
      });
      const hayStock = demanda > 0 && posicion / demanda >= BOT.minCoberturaPuja;
      const pujas = INF_KEYS.map((k, idx) => {
        const inf = estado.inf[k];
        if (t < inf.ocupadoHasta || !hayStock) return null;
        const info = INFLUENCERS[k];
        const alza = (info.min + info.max) / 2;
        // ~70% del alza de demanda llega a ventas (el mercado se reparte con el rival)
        const ganancia = margen * alza * 0.7 * CONFIG.duracionInfluencer;
        const fr = BOT.fraccionesPuja[(t + idx) % BOT.fraccionesPuja.length];
        const monto = Math.min(CONFIG.topeMonto, Math.floor(ganancia * fr));
        return monto >= 1 ? { monto } : null;
      });
      return { pedido, pujas };
    }

    // tienda
    const precio = [];
    const pedido = PRODUCTOS.map((p, i) => {
      const d = promedioReciente(estado, X, 'demanda', i, mitad(i));
      const pos = eq.stock.tienda[i].q + enCamino(eq, 'dt', i);
      precio.push(CONFIG.precioBase);
      return faltante(d, pos, CONFIG.tope);
    });
    return { precio, pedido };
  }

  const API = {
    VERSION, CONFIG, PRODUCTOS, CALIDADES, INFLUENCERS, INF_KEYS, EQUIPOS, ROLES,
    EVENTOS, eventoPorId, eventoActivo, prepararEvento,
    estadoInicial, avanzarRonda, reproducir, armarDecisiones, puntajes, sumaUtil,
    factorInfluencers, calidadPromedio, crearRng, leerDecision, decisionBot, BOT,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    (typeof window !== 'undefined' ? window : globalThis).JuegoReposicion = API;
  }
})();

/* ══ CARTUCHO DE AULES ══════════════════════════════════════════════════════
   Genera una copia de seguridad de Moodle (.mbz) con UN tema (una sección y sus
   actividades) para restaurarla en Aules con «Fusiona la còpia de seguretat amb
   aquest curs». El formato copia el de una copia real de Aules (Moodle 5.2.1+,
   backup_version 2026042000): ver herramientas/aules-mbz.md.

   Vive en Utilidades (lib/cartucho.js: lo usa el apartado «Bloques de Aules») y lo usan también
   herramientas/cartucho/haz.mjs y sus pruebas. Funciona igual en el navegador y en Node 22:
   usa solo crypto.subtle (SHA-1 de los archivos), CompressionStream('gzip') y
   TextEncoder. Sin dependencias.

   Reglas (acordadas con Andrés, 9 nov 2026):
   - Sin usuarios: users 0, sin inscripciones, sin entregas, sin notas.
   - El tema va en una sección NUEVA, numerada detrás de las del curso (la elige
     quien lo genera): Moodle encaja por número y así no toca nada de lo que hay.
   - Nada de soluciones ni claves salvo que se marquen a mano («soluciones: true»
     en esa actividad): la app no las mete por su cuenta.
   - Las fechas se escriben en la hora de Madrid. El curso de origen declara la
     misma fecha de inicio que el curso de destino (inicioCurso) para que Moodle
     no desplace las fechas al restaurar.

   Entrada (tema):
   { seccion: 7, nombre: 'Números racionales · La grapadora de Nick',
     resumen: 'Fracciones, …', visible: true,
     cabecera: { nombre: 'Cabecera tema Racionales 2ESO.png', datos: Uint8Array, ancho, alto },
     inicioCurso: 1788935460,            // segundos (Paràmetres → Data d'inici del curs); 0 = sin fecha:
                                         // Moodle solo mueve las fechas si origen y destino tienen fecha de
                                         // inicio y distan 24 h o más (restore_step::apply_date_offset)
     actividades: [
       { tipo: 'etiqueta', html: '<p>…</p>', oculta: false },
       { tipo: 'enlace', nombre: 'La grapadora de Nick (app)', url: 'https://…', descripcion: '…' },
       { tipo: 'pdf', nombre: 'Ficha 1 · Servir', archivo: 'Ficha 1 - Servir.pdf', datos: Uint8Array, descripcion: '' },
       { tipo: 'fotos', nombre: 'Fotos de tu libreta', html: '<p>…</p>', desde: '2026-11-19 00:00',
         hasta: '2026-11-22 23:59', maxFotos: 4, nota: 10 },
       { tipo: 'acta', nombre: 'Acta de La palestra', html: '<p>…</p>', desde, hasta, modo: 'texto' | 'archivo', nota: 10 } ] }
   Salida: { mbz: Uint8Array, nombre: 'tema-….mbz', avisos: [] }
   ═════════════════════════════════════════════════════════════════════════ */
(function (g) {
  'use strict';
  const VERSION_MOODLE = '2026042001.04', RELEASE = '5.2.1+ (Build: 20260630)';
  const BACKUP_VERSION = '2026042000', BACKUP_RELEASE = '5.2';
  const NULO = '$@NULL@$';
  const SOLUCION = /soluci|clave|corrector|respuestas/i;

  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const xml = cuerpo => '<?xml version="1.0" encoding="UTF-8"?>\n' + cuerpo;
  const txt = s => new TextEncoder().encode(s);

  // «2026-11-22 23:59» en Madrid → segundos Unix (sin librerías: prueba el desfase de +1 y +2 h)
  function hora(madrid) {
    if (typeof madrid === 'number') return madrid;
    const m = /^(\d{4})-(\d\d)-(\d\d)(?:[ T](\d\d):(\d\d))?$/.exec(String(madrid).trim());
    if (!m) throw new Error('Fecha no válida: ' + madrid + ' (AAAA-MM-DD HH:MM)');
    const [, a, me, d, h = '0', mi = '0'] = m;
    const utc = Date.UTC(+a, +me - 1, +d, +h, +mi);
    for (const off of [1, 2]) {
      const t = utc - off * 3600e3;
      const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', day: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t));
      const v = k => +f.find(p => p.type === k).value;
      if (v('hour') === +h && v('minute') === +mi && v('day') === +d) return t / 1000;
    }
    throw new Error('Hora inexistente en Madrid: ' + madrid);
  }

  async function sha1(bytes) {
    const h = await g.crypto.subtle.digest('SHA-1', bytes);
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ── tar (ustar) + gzip ──────────────────────────────────────────────────
  function cabeceraTar(nombre, tam, tipo, mtime) {
    const h = new Uint8Array(512), n = txt(nombre);
    let nom = n, pre = new Uint8Array(0);
    if (n.length > 100) {                       // ustar: prefijo + nombre partidos por una «/»
      const s = nombre.lastIndexOf('/', 154);
      pre = txt(nombre.slice(0, s)); nom = txt(nombre.slice(s + 1));
      if (pre.length > 155 || nom.length > 100) throw new Error('Ruta demasiado larga: ' + nombre);
    }
    const pon = (off, b) => h.set(b, off);
    const oct = (v, len) => txt(v.toString(8).padStart(len - 1, '0') + '\0');
    pon(0, nom); pon(100, oct(tipo === '5' ? 0o755 : 0o644, 8)); pon(108, oct(0, 8)); pon(116, oct(0, 8));
    pon(124, oct(tam, 12)); pon(136, oct(mtime, 12)); pon(148, txt('        ')); pon(156, txt(tipo));
    pon(257, txt('ustar\0')); pon(263, txt('00')); pon(345, pre);
    let suma = 0; for (const b of h) suma += b;
    pon(148, txt(suma.toString(8).padStart(6, '0') + '\0 '));
    return h;
  }
  function tar(entradas, mtime) {                 // entradas: [{ruta, datos?}] (sin datos = carpeta)
    const trozos = [];
    for (const e of entradas) {
      const dir = !e.datos;
      trozos.push(cabeceraTar(dir ? e.ruta.replace(/\/?$/, '/') : e.ruta, dir ? 0 : e.datos.length, dir ? '5' : '0', mtime));
      if (!dir) { trozos.push(e.datos); const r = e.datos.length % 512; if (r) trozos.push(new Uint8Array(512 - r)); }
    }
    trozos.push(new Uint8Array(1024));
    const total = trozos.reduce((s, t) => s + t.length, 0), out = new Uint8Array(total);
    let o = 0; for (const t of trozos) { out.set(t, o); o += t.length; }
    return out;
  }
  async function gzip(bytes) {
    const cs = new g.CompressionStream('gzip');
    const sal = new Response(new Blob([bytes]).stream().pipeThrough(cs));
    return new Uint8Array(await sal.arrayBuffer());
  }

  // ── piezas XML (iguales a las de la copia real de Aules) ─────────────────
  const VACIOS = {
    'calendar.xml': '<events>\n</events>',
    'filters.xml': '<filters>\n  <filter_actives>\n  </filter_actives>\n  <filter_configs>\n  </filter_configs>\n</filters>',
    'grade_history.xml': '<grade_history>\n  <grade_grades>\n  </grade_grades>\n</grade_history>',
    'roles.xml': '<roles>\n  <role_overrides>\n  </role_overrides>\n  <role_assignments>\n  </role_assignments>\n</roles>',
    'grades.xml': '<activity_gradebook>\n  <grade_items>\n  </grade_items>\n  <grade_letters>\n  </grade_letters>\n</activity_gradebook>',
  };
  const disponibleDesde = (t, verAntes) => esc(JSON.stringify({ op: '&', c: [{ type: 'date', d: '>=', t }], showc: [!!verAntes] }));

  function moduloXml(a, sec, ahora) {
    return xml(`<module id="${a.cmid}" version="${BACKUP_VERSION}">
  <modulename>${a.mod}</modulename>
  <sectionid>${sec.id}</sectionid>
  <sectionnumber>${sec.numero}</sectionnumber>
  <idnumber></idnumber>
  <added>${ahora}</added>
  <score>0</score>
  <indent>0</indent>
  <visible>${a.oculta || a.seccionOculta ? 0 : 1}</visible>
  <visibleoncoursepage>1</visibleoncoursepage>
  <visibleold>${a.oculta ? 0 : 1}</visibleold>
  <groupmode>0</groupmode>
  <groupingid>0</groupingid>
  <completion>0</completion>
  <completiongradeitemnumber>${NULO}</completiongradeitemnumber>
  <completionpassgrade>0</completionpassgrade>
  <completionview>0</completionview>
  <completionexpected>0</completionexpected>
  <availability>${a.desdeT ? disponibleDesde(a.desdeT, false) : NULO}</availability>
  <showdescription>${a.descripcion || a.mod === 'assign' ? 1 : 0}</showdescription>
  <downloadcontent>1</downloadcontent>
  <lang></lang>
  <enableaitools>${NULO}</enableaitools>
  <enabledaiactions>${NULO}</enabledaiactions>
  <tags>
  </tags>
</module>`);
  }
  const inforef = (archivos = [], items = []) => xml('<inforef>\n' +
    (archivos.length ? '  <fileref>\n' + archivos.map(i => `    <file>\n      <id>${i}</id>\n    </file>\n`).join('') + '  </fileref>\n' : '') +
    (items.length ? '  <grade_itemref>\n' + items.map(i => `    <grade_item>\n      <id>${i}</id>\n    </grade_item>\n`).join('') + '  </grade_itemref>\n' : '') +
    '</inforef>');
  const parrafo = s => s ? `<p>${esc(s)}</p>` : '';

  function actividadXml(a, ahora) {
    const cab = (cuerpo) => xml(`<activity id="${a.inst}" moduleid="${a.cmid}" modulename="${a.mod}" contextid="${a.ctx}">\n${cuerpo}\n</activity>`);
    if (a.mod === 'label') return cab(`  <label id="${a.inst}">
    <name>${esc(a.nombreCorto)}</name>
    <intro>${esc(a.html)}</intro>
    <introformat>1</introformat>
    <timemodified>${ahora}</timemodified>
  </label>`);
    if (a.mod === 'url') return cab(`  <url id="${a.inst}">
    <name>${esc(a.nombre)}</name>
    <intro>${esc(parrafo(a.descripcion))}</intro>
    <introformat>1</introformat>
    <externalurl>${esc(a.url)}</externalurl>
    <display>3</display>
    <displayoptions>a:0:{}</displayoptions>
    <parameters>a:0:{}</parameters>
    <timemodified>${ahora}</timemodified>
  </url>`);
    if (a.mod === 'resource') return cab(`  <resource id="${a.inst}">
    <name>${esc(a.nombre)}</name>
    <intro>${esc(parrafo(a.descripcion))}</intro>
    <introformat>1</introformat>
    <tobemigrated>0</tobemigrated>
    <legacyfiles>0</legacyfiles>
    <legacyfileslast>${NULO}</legacyfileslast>
    <display>0</display>
    <displayoptions>a:1:{s:10:"printintro";i:1;}</displayoptions>
    <filterfiles>0</filterfiles>
    <revision>1</revision>
    <timemodified>${ahora}</timemodified>
  </resource>`);
    if (a.mod === 'assign') {
      let pc = 9000000 + a.inst * 20;
      const conf = (plugin, subtype, name, value) => `      <plugin_config id="${pc++}">
        <plugin>${plugin}</plugin>
        <subtype>${subtype}</subtype>
        <name>${name}</name>
        <value>${value}</value>
      </plugin_config>\n`;
      return cab(`  <assign id="${a.inst}">
    <name>${esc(a.nombre)}</name>
    <intro>${esc(a.html)}</intro>
    <introformat>1</introformat>
    <alwaysshowdescription>1</alwaysshowdescription>
    <submissiondrafts>0</submissiondrafts>
    <sendnotifications>0</sendnotifications>
    <sendlatenotifications>0</sendlatenotifications>
    <sendstudentnotifications>1</sendstudentnotifications>
    <duedate>${a.hastaT}</duedate>
    <cutoffdate>${a.cierreT || 0}</cutoffdate>
    <gradingduedate>${a.hastaT + 60}</gradingduedate>
    <allowsubmissionsfromdate>${a.desdeT || 0}</allowsubmissionsfromdate>
    <grade>${a.nota}</grade>
    <timemodified>${ahora}</timemodified>
    <completionsubmit>1</completionsubmit>
    <requiresubmissionstatement>0</requiresubmissionstatement>
    <teamsubmission>0</teamsubmission>
    <requireallteammemberssubmit>0</requireallteammemberssubmit>
    <teamsubmissiongroupingid>0</teamsubmissiongroupingid>
    <blindmarking>0</blindmarking>
    <hidegrader>0</hidegrader>
    <revealidentities>0</revealidentities>
    <attemptreopenmethod>untilpass</attemptreopenmethod>
    <maxattempts>1</maxattempts>
    <markingworkflow>0</markingworkflow>
    <markingallocation>0</markingallocation>
    <markercount>2</markercount>
    <multimarkmethod>manual</multimarkmethod>
    <markinganonymous>0</markinganonymous>
    <preventsubmissionnotingroup>0</preventsubmissionnotingroup>
    <activity></activity>
    <activityformat>1</activityformat>
    <timelimit>0</timelimit>
    <submissionattachments>0</submissionattachments>
    <gradepenalty>0</gradepenalty>
    <userflags>
    </userflags>
    <allocatedmarkers>
    </allocatedmarkers>
    <submissions>
    </submissions>
    <grades>
    </grades>
    <marks>
    </marks>
    <plugin_configs>
${conf('file', 'assignsubmission', 'maxfilesubmissions', a.maxFotos)}${conf('file', 'assignsubmission', 'maxsubmissionsizebytes', 52428800)}${conf('file', 'assignsubmission', 'filetypeslist', a.tiposArchivo || '')}${conf('comments', 'assignsubmission', 'enabled', 1)}${conf('comments', 'assignfeedback', 'enabled', 1)}${conf('comments', 'assignfeedback', 'commentinline', 0)}${conf('editpdf', 'assignfeedback', 'enabled', 0)}${conf('offline', 'assignfeedback', 'enabled', 0)}${conf('file', 'assignfeedback', 'enabled', 0)}${conf('onenote', 'assignfeedback', 'enabled', 0)}${a.textoEnLinea ? conf('onlinetext', 'assignsubmission', 'wordlimit', 0) + conf('onlinetext', 'assignsubmission', 'wordlimitenabled', 0) : ''}${conf('onlinetext', 'assignsubmission', 'enabled', a.textoEnLinea ? 1 : 0)}${conf('file', 'assignsubmission', 'enabled', a.textoEnLinea ? 0 : 1)}    </plugin_configs>
    <overrides>
    </overrides>
  </assign>`);
    }
    throw new Error('Tipo de actividad desconocido: ' + a.mod);
  }

  function itemNotaXml(a, cat, ahora) {
    return xml(`<activity_gradebook>
  <grade_items>
    <grade_item id="${a.item}">
      <categoryid>${cat}</categoryid>
      <itemname>${esc(a.nombre)}</itemname>
      <itemtype>mod</itemtype>
      <itemmodule>assign</itemmodule>
      <iteminstance>${a.inst}</iteminstance>
      <itemnumber>0</itemnumber>
      <iteminfo>${NULO}</iteminfo>
      <idnumber></idnumber>
      <calculation>${NULO}</calculation>
      <gradetype>1</gradetype>
      <grademax>${a.nota.toFixed(5)}</grademax>
      <grademin>0.00000</grademin>
      <scaleid>${NULO}</scaleid>
      <outcomeid>${NULO}</outcomeid>
      <gradepass>0.00000</gradepass>
      <multfactor>1.00000</multfactor>
      <plusfactor>0.00000</plusfactor>
      <aggregationcoef>0.00000</aggregationcoef>
      <aggregationcoef2>0.00000</aggregationcoef2>
      <weightoverride>0</weightoverride>
      <sortorder>2</sortorder>
      <display>0</display>
      <decimals>${NULO}</decimals>
      <hidden>0</hidden>
      <locked>0</locked>
      <locktime>0</locktime>
      <needsupdate>0</needsupdate>
      <timecreated>${ahora}</timecreated>
      <timemodified>${ahora}</timemodified>
      <grade_grades>
      </grade_grades>
    </grade_item>
  </grade_items>
  <grade_letters>
  </grade_letters>
</activity_gradebook>`);
  }

  function gradebookXml(cat, item, ahora) {
    return xml(`<gradebook>
  <attributes>
  </attributes>
  <grade_categories>
    <grade_category id="${cat}">
      <parent>${NULO}</parent>
      <depth>1</depth>
      <path>/${cat}/</path>
      <fullname>?</fullname>
      <aggregation>13</aggregation>
      <keephigh>0</keephigh>
      <droplow>0</droplow>
      <aggregateonlygraded>1</aggregateonlygraded>
      <aggregateoutcomes>0</aggregateoutcomes>
      <timecreated>${ahora}</timecreated>
      <timemodified>${ahora}</timemodified>
      <hidden>0</hidden>
    </grade_category>
  </grade_categories>
  <grade_items>
    <grade_item id="${item}">
      <categoryid>${NULO}</categoryid>
      <itemname>${NULO}</itemname>
      <itemtype>course</itemtype>
      <itemmodule>${NULO}</itemmodule>
      <iteminstance>${cat}</iteminstance>
      <itemnumber>${NULO}</itemnumber>
      <iteminfo>${NULO}</iteminfo>
      <idnumber>${NULO}</idnumber>
      <calculation>${NULO}</calculation>
      <gradetype>1</gradetype>
      <grademax>100.00000</grademax>
      <grademin>0.00000</grademin>
      <scaleid>${NULO}</scaleid>
      <outcomeid>${NULO}</outcomeid>
      <gradepass>0.00000</gradepass>
      <multfactor>1.00000</multfactor>
      <plusfactor>0.00000</plusfactor>
      <aggregationcoef>0.00000</aggregationcoef>
      <aggregationcoef2>0.00000</aggregationcoef2>
      <weightoverride>0</weightoverride>
      <sortorder>1</sortorder>
      <display>0</display>
      <decimals>${NULO}</decimals>
      <hidden>0</hidden>
      <locked>0</locked>
      <locktime>0</locktime>
      <needsupdate>0</needsupdate>
      <timecreated>${ahora}</timecreated>
      <timemodified>${ahora}</timemodified>
      <grade_grades>
      </grade_grades>
    </grade_item>
  </grade_items>
  <grade_letters>
  </grade_letters>
  <grade_settings>
    <grade_setting id="">
      <name>minmaxtouse</name>
      <value>1</value>
    </grade_setting>
  </grade_settings>
</gradebook>`);
  }

  function archivoXml(f) {
    return `  <file id="${f.id}">
    <contenthash>${f.hash}</contenthash>
    <contextid>${f.ctx}</contextid>
    <component>${f.comp}</component>
    <filearea>${f.area}</filearea>
    <itemid>${f.itemid}</itemid>
    <filepath>/</filepath>
    <filename>${esc(f.nombre)}</filename>
    <userid>${NULO}</userid>
    <filesize>${f.tam}</filesize>
    <mimetype>${f.mime || NULO}</mimetype>
    <status>0</status>
    <timecreated>${f.t}</timecreated>
    <timemodified>${f.t}</timemodified>
    <source>${f.nombre === '.' ? NULO : esc(f.nombre)}</source>
    <author>${NULO}</author>
    <license>${f.nombre === '.' ? NULO : 'unknown'}</license>
    <sortorder>${f.nombre === '.' ? 0 : 1}</sortorder>
    <repositorytype>${NULO}</repositorytype>
    <repositoryid>${NULO}</repositoryid>
    <reference>${NULO}</reference>
  </file>\n`;
  }

  // ── comprobaciones antes de generar ──────────────────────────────────────
  function revisa(tema) {
    const err = [], avisos = [];
    if (!Number.isInteger(tema.seccion) || tema.seccion < 1) err.push('El número de sección tiene que ser 1 o más (detrás de las del curso).');
    if (!tema.nombre) err.push('Falta el nombre del tema.');
    if (!Number.isInteger(tema.inicioCurso)) err.push('Falta la fecha de inicio del curso de destino (Paràmetres → Data d\'inici del curs).');
    for (const [i, a] of (tema.actividades || []).entries()) {
      const q = `Actividad ${i + 1} (${a.nombre || a.tipo})`;
      if (a.tipo === 'pdf') {
        if (!a.datos || !a.datos.length) err.push(q + ': falta el archivo.');
        if (SOLUCION.test((a.archivo || '') + ' ' + (a.nombre || '')) && a.soluciones !== true)
          err.push(q + ': parece de soluciones o claves. La app no las sube por su cuenta; si de verdad va, márcala a mano.');
        if (a.datos && !/^%PDF/.test(new TextDecoder().decode(a.datos.slice(0, 4)))) err.push(q + ': no es un PDF.');
      } else if (a.tipo === 'enlace') {
        if (!/^https:\/\//.test(a.url || '')) err.push(q + ': el enlace tiene que empezar por https://');
      } else if (a.tipo === 'fotos' || a.tipo === 'acta') {
        if (!a.hasta) err.push(q + ': falta el plazo.');
      } else if (a.tipo !== 'etiqueta') err.push(q + ': tipo desconocido (etiqueta, enlace, pdf, fotos o acta).');
    }
    const tam = (tema.actividades || []).reduce((s, a) => s + (a.datos ? a.datos.length : 0), 0) + (tema.cabecera?.datos?.length || 0);
    if (tam > 45 * 1024 * 1024) err.push('Pasa de 45 MB (Aules admite 50 MB por copia): parte el tema.');
    return { err, avisos };
  }

  // ── la copia ─────────────────────────────────────────────────────────────
  async function creaMbz(tema, opciones = {}) {
    const { err, avisos } = revisa(tema);
    if (err.length) { const e = new Error(err.join('\n')); e.errores = err; throw e; }
    const ahora = opciones.ahora || Math.floor(Date.now() / 1000);
    // ids inventados, en rangos que no chocan entre sí (Moodle los remapea al restaurar)
    const base = 900000000 + (ahora % 1000000) * 10;
    let n = 0; const id = () => base + (++n);
    const curso = { id: id(), ctx: id() }, cat = id(), itemCurso = id();
    const sec = { id: id(), numero: tema.seccion };
    const archivos = [];
    const dir = (ctx, comp, area, itemid) => { const f = { id: id(), hash: 'da39a3ee5e6b4b0d3255bfef95601890afd80709', ctx, comp, area, itemid, nombre: '.', tam: 0, t: ahora }; archivos.push(f); return f.id; };
    const contenido = {};                      // hash → bytes
    const real = async (ctx, comp, area, itemid, nombre, datos, mime) => {
      const hash = await sha1(datos); contenido[hash] = datos;
      const f = { id: id(), hash, ctx, comp, area, itemid, nombre, tam: datos.length, mime, t: ahora }; archivos.push(f); return f.id;
    };

    // sección: cabecera dentro del resumen, como en Aules
    const refsSec = [];
    let resumen = '';
    if (tema.cabecera) {
      refsSec.push(await real(curso.ctx, 'course', 'section', sec.id, tema.cabecera.nombre, tema.cabecera.datos, /\.jpe?g$/i.test(tema.cabecera.nombre) ? 'image/jpeg' : 'image/png'));
      refsSec.push(dir(curso.ctx, 'course', 'section', sec.id));
      const w = tema.cabecera.ancho ? ` width="${tema.cabecera.ancho}" height="${tema.cabecera.alto}"` : '';
      resumen = `<p><img class="img-fluid" role="presentation" src="@@PLUGINFILE@@/${encodeURIComponent(tema.cabecera.nombre)}" alt=""${w}>${esc(tema.resumen || '')}</p>`;
    } else resumen = parrafo(tema.resumen);

    const MOD = { etiqueta: 'label', enlace: 'url', pdf: 'resource', fotos: 'assign', acta: 'assign' };
    const acts = [];
    for (const a0 of tema.actividades) {
      const a = { ...a0, mod: MOD[a0.tipo], cmid: id(), inst: id(), ctx: id(), refs: [], seccionOculta: tema.visible === false };
      if (a.tipo === 'etiqueta') {
        const plano = a.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        a.nombreCorto = plano.length > 50 ? plano.slice(0, 47) + '...' : plano;
        a.nombre = a.nombreCorto;
      }
      if (a.tipo === 'pdf') {
        a.refs.push(await real(a.ctx, 'mod_resource', 'content', 0, a.archivo, a.datos, 'application/pdf'));
        a.refs.push(dir(a.ctx, 'mod_resource', 'content', 0));
      }
      /* acta (1.19): la tarea donde el alumno pega el acta de una app. modo 'texto' = texto en línea (deducido
         del formato: plugin onlinetext activado, sin límite de palabras); modo 'archivo' = un .txt */
      if (a.tipo === 'acta') { a.textoEnLinea = a.modo !== 'archivo'; if (!a.textoEnLinea) { a.maxFotos = 1; a.tiposArchivo = '.txt'; } }
      if (a.tipo === 'fotos' || a.tipo === 'acta') {
        a.desdeT = a.desde ? hora(a.desde) : 0; a.hastaT = hora(a.hasta);
        a.cierreT = a.cierre ? hora(a.cierre) : (a.sinRetraso === false ? 0 : a.hastaT);
        a.maxFotos = a.maxFotos || 4; a.nota = a.nota || 10; a.item = id();
        if (a.desdeT && a.desdeT >= a.hastaT) throw new Error(a.nombre + ': se abre después del plazo.');
      }
      acts.push(a);
    }
    if (!tema.visible && tema.visible !== undefined) avisos.push('El tema entra oculto para los alumnos.');

    const E = [];                               // entradas del tar, en orden
    const pon = (ruta, s) => E.push({ ruta, datos: typeof s === 'string' ? txt(s) : s });
    const carpeta = ruta => E.push({ ruta });

    carpeta('activities');
    for (const a of acts) {
      const d = `activities/${a.mod}_${a.cmid}`; carpeta(d);
      pon(`${d}/module.xml`, moduloXml(a, sec, ahora));
      pon(`${d}/${a.mod}.xml`, actividadXml(a, ahora));
      pon(`${d}/inforef.xml`, inforef(a.refs, a.item ? [a.item] : []));
      for (const f of ['calendar.xml', 'filters.xml', 'grade_history.xml', 'roles.xml']) pon(`${d}/${f}`, xml(VACIOS[f]));
      pon(`${d}/grades.xml`, a.item ? itemNotaXml(a, cat, ahora) : xml(VACIOS['grades.xml']));
      if (a.mod === 'assign') pon(`${d}/grading.xml`, xml(`<areas>\n  <area id="${id()}">\n    <areaname>submissions</areaname>\n    <activemethod>${NULO}</activemethod>\n    <definitions>\n    </definitions>\n  </area>\n</areas>`));
    }
    carpeta('course');
    pon('course/course.xml', xml(`<course id="${curso.id}" contextid="${curso.ctx}">
  <shortname>tema-utilidades-${ahora}</shortname>
  <fullname>Tema generado con Utilidades</fullname>
  <idnumber></idnumber>
  <summary></summary>
  <summaryformat>1</summaryformat>
  <format>topics</format>
  <showgrades>1</showgrades>
  <newsitems>5</newsitems>
  <startdate>${tema.inicioCurso}</startdate>
  <enddate>0</enddate>
  <marker>0</marker>
  <maxbytes>52428800</maxbytes>
  <legacyfiles>0</legacyfiles>
  <showreports>0</showreports>
  <visible>1</visible>
  <groupmode>0</groupmode>
  <groupmodeforce>0</groupmodeforce>
  <defaultgroupingid>0</defaultgroupingid>
  <lang></lang>
  <theme></theme>
  <timecreated>${ahora}</timecreated>
  <timemodified>${ahora}</timemodified>
  <requested>0</requested>
  <showactivitydates>1</showactivitydates>
  <showcompletionconditions>1</showcompletionconditions>
  <pdfexportfont>${NULO}</pdfexportfont>
  <enablecompletion>1</enablecompletion>
  <completionnotify>0</completionnotify>
  <enableaitools>${NULO}</enableaitools>
  <category id="${id()}">
    <name>Utilidades</name>
    <description></description>
  </category>
  <tags>
  </tags>
  <customfields>
  </customfields>
  <courseformatoptions>
    <courseformatoption>
      <format>topics</format>
      <sectionid>0</sectionid>
      <name>hiddensections</name>
      <value>0</value>
    </courseformatoption>
    <courseformatoption>
      <format>topics</format>
      <sectionid>0</sectionid>
      <name>coursedisplay</name>
      <value>0</value>
    </courseformatoption>
  </courseformatoptions>
</course>`));
    pon('course/enrolments.xml', xml('<enrolments>\n  <enrols>\n  </enrols>\n</enrolments>'));
    pon('course/roles.xml', xml(VACIOS['roles.xml']));
    pon('course/calendar.xml', xml(VACIOS['calendar.xml']));
    pon('course/filters.xml', xml(VACIOS['filters.xml']));
    pon('course/completiondefaults.xml', xml('<course_completion_defaults>\n</course_completion_defaults>'));
    pon('course/contentbank.xml', xml('<contents>\n</contents>'));
    pon('course/inforef.xml', inforef());
    carpeta('files');
    const hechos = new Set();
    for (const h of Object.keys(contenido).sort()) {
      if (!hechos.has(h.slice(0, 2))) { carpeta('files/' + h.slice(0, 2)); hechos.add(h.slice(0, 2)); }
      pon(`files/${h.slice(0, 2)}/${h}`, contenido[h]);
    }
    pon('files.xml', xml('<files>\n' + archivos.map(archivoXml).join('') + '</files>'));
    pon('gradebook.xml', gradebookXml(cat, itemCurso, ahora));
    pon('grade_history.xml', xml(VACIOS['grade_history.xml']));
    pon('groups.xml', xml('<groups>\n  <groupcustomfields>\n  </groupcustomfields>\n  <groupings>\n    <groupingcustomfields>\n    </groupingcustomfields>\n  </groupings>\n</groups>'));
    pon('outcomes.xml', xml('<outcomes_definition>\n</outcomes_definition>'));
    pon('questions.xml', xml('<question_categories>\n</question_categories>'));
    pon('roles.xml', xml('<roles_definition>\n</roles_definition>'));
    pon('scales.xml', xml('<scales_definition>\n</scales_definition>'));
    pon('badges.xml', xml('<badges>\n</badges>'));
    pon('completion.xml', xml('<course_completion>\n</course_completion>'));
    carpeta('sections');
    const ds = `sections/section_${sec.id}`; carpeta(ds);
    pon(`${ds}/section.xml`, xml(`<section id="${sec.id}">
  <number>${sec.numero}</number>
  <name>${esc(tema.nombre)}</name>
  <summary>${esc(resumen)}</summary>
  <summaryformat>1</summaryformat>
  <sequence>${acts.map(a => a.cmid).join(',')}</sequence>
  <visible>${tema.visible === false ? 0 : 1}</visible>
  <availabilityjson>${tema.desde ? disponibleDesde(hora(tema.desde), true) : esc('{"op":"&","c":[],"showc":[]}')}</availabilityjson>
  <component>${NULO}</component>
  <itemid>${NULO}</itemid>
  <timemodified>${ahora}</timemodified>
</section>`));
    pon(`${ds}/inforef.xml`, inforef(refsSec));

    const nombre = opciones.nombre || 'tema-' + tema.nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '-' + new Date(ahora * 1000).toISOString().slice(0, 10) + '-nu.mbz';
    const raiz = [['filename', nombre], ['imscc11', 0], ['users', 0], ['anonymize', 0], ['role_assignments', 0], ['activities', 1], ['blocks', 0], ['files', 1], ['filters', 0], ['comments', 0], ['badges', 0], ['calendarevents', 0], ['userscompletion', 0], ['logs', 0], ['grade_histories', 0], ['groups', 0], ['competencies', 0], ['customfield', 0], ['contentbankcontent', 0], ['xapistate', 0], ['legacyfiles', 0]];
    const ajuste = (nivel, extra, nom, val) => `      <setting>\n        <level>${nivel}</level>\n${extra}        <name>${nom}</name>\n        <value>${esc(val)}</value>\n      </setting>\n`;
    let ajustes = raiz.map(([k, v]) => ajuste('root', '', k, v)).join('');
    ajustes += ajuste('section', `        <section>section_${sec.id}</section>\n`, `section_${sec.id}_included`, 1) + ajuste('section', `        <section>section_${sec.id}</section>\n`, `section_${sec.id}_userinfo`, 0);
    for (const a of acts) { const k = `${a.mod}_${a.cmid}`; ajustes += ajuste('activity', `        <activity>${k}</activity>\n`, `${k}_included`, 1) + ajuste('activity', `        <activity>${k}</activity>\n`, `${k}_userinfo`, 0); }
    pon('moodle_backup.xml', xml(`<moodle_backup>
  <information>
    <name>${esc(nombre)}</name>
    <moodle_version>${VERSION_MOODLE}</moodle_version>
    <moodle_release>${RELEASE}</moodle_release>
    <backup_version>${BACKUP_VERSION}</backup_version>
    <backup_release>${BACKUP_RELEASE}</backup_release>
    <backup_date>${ahora}</backup_date>
    <mnet_remoteusers>0</mnet_remoteusers>
    <include_files>1</include_files>
    <include_file_references_to_external_content>0</include_file_references_to_external_content>
    <original_wwwroot>https://diazepamina-creator.github.io/utilidades</original_wwwroot>
    <original_site_identifier_hash>${await sha1(txt('utilidades-cartucho'))}</original_site_identifier_hash>
    <original_course_id>${curso.id}</original_course_id>
    <original_course_format>topics</original_course_format>
    <original_course_fullname>Tema generado con Utilidades</original_course_fullname>
    <original_course_shortname>tema-utilidades-${ahora}</original_course_shortname>
    <original_course_startdate>${tema.inicioCurso}</original_course_startdate>
    <original_course_enddate>0</original_course_enddate>
    <original_course_contextid>${curso.ctx}</original_course_contextid>
    <original_system_contextid>1</original_system_contextid>
    <details>
      <detail backup_id="${(await sha1(txt(nombre + ahora))).slice(0, 32)}">
        <type>course</type>
        <format>moodle2</format>
        <interactive>1</interactive>
        <mode>10</mode>
        <execution>1</execution>
        <executiontime>0</executiontime>
      </detail>
    </details>
    <contents>
      <activities>
${acts.map(a => `        <activity>
          <moduleid>${a.cmid}</moduleid>
          <sectionid>${sec.id}</sectionid>
          <modulename>${a.mod}</modulename>
          <title>${esc(a.nombre)}</title>
          <directory>activities/${a.mod}_${a.cmid}</directory>
          <insubsection></insubsection>
        </activity>\n`).join('')}      </activities>
      <sections>
        <section>
          <sectionid>${sec.id}</sectionid>
          <title>${esc(tema.nombre)}</title>
          <directory>${ds}</directory>
          <parentcmid></parentcmid>
          <modname></modname>
        </section>
      </sections>
      <course>
        <courseid>${curso.id}</courseid>
        <title>tema-utilidades-${ahora}</title>
        <directory>course</directory>
      </course>
    </contents>
    <settings>
${ajustes}    </settings>
  </information>
</moodle_backup>`));
    pon('moodle_backup.log', new Uint8Array(0));

    // índice de Moodle, primero en el archivo
    const lineas = E.map(e => e.datos ? `${e.ruta}\tf\t${e.datos.length}\t${ahora}` : `${e.ruta}/\td\t0\t?`);
    const indice = { ruta: '.ARCHIVE_INDEX', datos: txt(`Moodle archive file index. Count: ${E.length}\n` + lineas.join('\n') + '\n') };
    const mbz = await gzip(tar([indice, ...E], ahora));
    return { mbz, nombre, avisos, secciones: 1, actividades: acts.length, archivos: Object.keys(contenido).length };
  }

  const Cartucho = { creaMbz, revisa, hora, tar, VERSION_MOODLE, BACKUP_VERSION };
  if (typeof module !== 'undefined' && module.exports) module.exports = Cartucho;
  g.Cartucho = Cartucho;
})(typeof globalThis !== 'undefined' ? globalThis : this);

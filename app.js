(function () {
  'use strict';
  var cfg = window.APP_CONFIG;
  var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY);
  var $ = function (id) { return document.getElementById(id); };
  var st = { user: null, profile: null, settings: null, projects: [], clients: [], day: today(), entries: [], timer: null, mode: 'login', tick: null };

  function pad(n) { return String(n).padStart(2, '0'); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function hm(t) { return String(t).slice(0, 5); }
  function mins(t) { var p = hm(t).split(':'); return +p[0] * 60 + +p[1]; }
  function fmtH(m) { return (m / 60).toFixed(2).replace('.', ',') + ' h'; }
  function toast(m) { var t = $('toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(function () { t.style.display = 'none'; }, 3500); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function err(e) { var m = (e && e.message) || String(e); if (/no_overlap|exclusion/.test(m)) m = 'Se solapa con otra entrada'; toast(m); }

  // ===== Tema =====
  function applyTheme(t) { document.documentElement.setAttribute('data-theme', t); try { localStorage.setItem('bhh-theme', t); } catch (e) {} }
  var saved = null; try { saved = localStorage.getItem('bhh-theme'); } catch (e) {}
  applyTheme(saved || 'dark');
  document.querySelectorAll('.themeBtn').forEach(function (b) { b.onclick = function () { applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); }; });

  // ===== Autenticación =====
  function setMode(m) {
    st.mode = m;
    var reg = m === 'register';
    $('regFields').hidden = !reg; $('regConsent').hidden = !reg;
    $('authBtn').textContent = reg ? 'Crear cuenta' : 'Ingresar';
    $('toggleMode').textContent = reg ? 'Ya tengo cuenta' : 'Crear cuenta';
    $('authMsg').textContent = '';
  }
  $('toggleMode').onclick = function () { setMode(st.mode === 'login' ? 'register' : 'login'); };
  $('forgot').onclick = async function () {
    var email = $('fEmail').value.trim();
    if (!email) { $('authMsg').textContent = 'Escribe tu correo primero'; return; }
    var r = await sb.auth.resetPasswordForEmail(email, { redirectTo: cfg.APP_URL });
    $('authMsg').textContent = r.error ? r.error.message : 'Te enviamos un correo para restablecerla';
  };
  $('authForm').onsubmit = async function (e) {
    e.preventDefault();
    var email = $('fEmail').value.trim(), pass = $('fPass').value, r;
    $('authMsg').textContent = '';
    if (st.mode === 'register') {
      if (!$('fConsent').checked) { $('authMsg').textContent = 'Debes aceptar el uso de datos'; return; }
      r = await sb.auth.signUp({ email: email, password: pass, options: { emailRedirectTo: cfg.APP_URL, data: { full_name: $('fName').value.trim(), username: $('fUser').value.trim(), consent: 'true' } } });
      if (!r.error && !r.data.session) { $('authMsg').textContent = 'Revisa tu correo para confirmar la cuenta'; return; }
    } else {
      r = await sb.auth.signInWithPassword({ email: email, password: pass });
    }
    if (r.error) $('authMsg').textContent = r.error.message;
  };
  $('outBtn').onclick = function () { sb.auth.signOut(); };
  sb.auth.onAuthStateChange(function (ev, session) { if (ev === 'PASSWORD_RECOVERY') $('resetM').hidden = false; boot(session); });

  async function boot(session) {
    if (!session) { st.user = null; clearInterval(st.tick); $('askFab').hidden = true; $('app').hidden = true; $('auth').hidden = false; return; }
    if (st.user && st.user.id === session.user.id) return;
    st.user = session.user;
    $('auth').hidden = true; $('app').hidden = false; $('askFab').hidden = false;
    await loadBase();
    $('dayPick').value = st.day;
    $('manualD').open = true;
    await loadDay();

  }

  async function loadBase() {
    var r = await Promise.all([
      sb.from('profiles').select('*').eq('id', st.user.id).single(),
      sb.from('work_settings').select('*').eq('user_id', st.user.id).single(),
      sb.from('projects').select('id,name,client_id,archived').eq('archived', false).order('name'),
      sb.from('clients').select('id,name').order('name')
    ]);
    st.profile = r[0].data; st.settings = r[1].data; st.projects = r[2].data || []; st.clients = r[3].data || [];
    var n = (st.profile && (st.profile.full_name || st.profile.username)) || '';
    $('hello').textContent = 'Hola, ' + n.split(' ')[0]; var adm = st.profile && st.profile.role === 'admin'; $('hiSub').textContent = adm ? 'Bitácora HH · Admin' : 'Bitácora HH'; $('usersBtn').hidden = !adm; $('inboxBtn').hidden = !adm; if (adm) checkInbox();
    fillProjects();
  }
  function projLabel(p) { var c = st.clients.find(function (x) { return x.id === p.client_id; }); return (c ? c.name + ' · ' : '') + p.name; }
  function fillProjects() {
    var h = st.projects.map(function (p) { return '<option value="' + p.id + '">' + esc(projLabel(p)) + '</option>'; }).join('');
    $('tProj').innerHTML = h; $('mProj').innerHTML = h;
    $('projCount').textContent = '(' + st.projects.length + ')';
    $('projList').innerHTML = st.projects.map(function (p) { return '<span class="pchip">' + esc(projLabel(p)) + '</span>'; }).join('');
  }

  // ===== Día =====
  async function loadDay() {
    var r = await sb.from('time_entries').select('*, projects(name, client_id)').eq('entry_date', st.day).order('start_time');
    if (r.error) return err(r.error);
    st.entries = r.data || [];
    render();
    loadLog();
  }
  function render() {
    var imp = 0, int = 0;
    st.entries.forEach(function (e) { if (e.imputable) imp += e.duration_minutes; else int += e.duration_minutes; });
    var goal = st.settings ? st.settings.max_imputable_day_minutes : 480;
    $('tImp').textContent = fmtH(imp).replace(' h',''); $('tInt').textContent = fmtH(int); $('tGoal').textContent = fmtH(goal);
    $('bar').style.width = Math.min(100, imp / goal * 100) + '%';
    $('dN').textContent = st.entries.length;
    $('dLeft').textContent = imp >= goal ? 'Cumplida' : fmtH(goal - imp);
    var le = st.entries[st.entries.length - 1]; $('dLast').textContent = le ? hm(le.end_time) : '—';
    var last = st.entries[st.entries.length - 1];
    if (last) { $('mStart').value = hm(last.end_time); }
  }
  var logMode = 'month', logSort = { col: 0, dir: -1 }, logRows = [];
  var LCOLS = ['Fecha', 'Inicio', 'Fin', 'Proyecto', 'Tarea', 'Ticket', 'Horas', 'Tipo'];
  function logRange() {
    var d = new Date(st.day + 'T12:00:00'), a, b;
    function f(x) { return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate()); }
    if (logMode === 'day') return [st.day, st.day];
    if (logMode === 'week') { var w = (d.getDay() + 6) % 7; a = new Date(d); a.setDate(d.getDate() - w); b = new Date(a); b.setDate(a.getDate() + 6); return [f(a), f(b)]; }
    a = new Date(d.getFullYear(), d.getMonth(), 1, 12); b = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12); return [f(a), f(b)];
  }
  async function loadLog() {
    var rg = logRange();
    var r = await sb.from('time_entries').select('id,entry_date,start_time,end_time,task,ticket,duration_minutes,imputable,projects(name)').gte('entry_date', rg[0]).lte('entry_date', rg[1]).order('entry_date').order('start_time').limit(2000);
    if (r.error) return err(r.error);
    logRows = r.data || [];
    drawLog();
  }
  function drawLog() {
    var c = logSort.col, dr = logSort.dir;
    var rows = logRows.slice().sort(function (x, y) {
      var k = [function (e) { return e.entry_date; }, function (e) { return e.start_time; }, function (e) { return e.end_time; }, function (e) { return e.projects ? e.projects.name : ''; }, function (e) { return e.task || ''; }, function (e) { return e.ticket || ''; }, function (e) { return e.duration_minutes; }, function (e) { return e.imputable ? 'Imputable' : 'Interna'; }][c];
      var p = k(x), q = k(y), r = (typeof p === 'number') ? p - q : String(p).localeCompare(String(q), 'es', { numeric: true });
      if (r === 0) r = x.entry_date === y.entry_date ? (x.start_time < y.start_time ? -1 : 1) : (x.entry_date < y.entry_date ? -1 : 1);
      return r * (r === 0 ? 1 : dr);
    });
    var imp = 0, inn = 0;
    rows.forEach(function (e) { if (e.imputable) imp += e.duration_minutes; else inn += e.duration_minutes; });
    var h = '<thead><tr>' + LCOLS.map(function (n, i) { var on = logSort.col === i; return '<th data-c="' + i + '" class="srt" aria-sort="' + (on ? (dr > 0 ? 'ascending' : 'descending') : 'none') + '">' + n + '<span>' + (on ? (dr > 0 ? ' ▲' : ' ▼') : ' ↕') + '</span></th>'; }).join('') + '<th></th></tr></thead><tbody>';
    h += rows.map(function (e) {
      var d = e.entry_date.split('-');
      return '<tr class="' + (e.imputable ? '' : 'int') + '"><td>' + d[2] + '/' + d[1] + '/' + d[0] + '</td><td>' + hm(e.start_time) + '</td><td>' + hm(e.end_time) + '</td><td>' + esc(e.projects ? e.projects.name : '') + '</td><td>' + esc(e.task) + '</td><td>' + esc(e.ticket || '') + '</td><td class="num">' + fmtH(e.duration_minutes) + '</td><td>' + (e.imputable ? 'Imputable' : 'Interna') + '</td><td><button class="ico" data-del="' + e.id + '" aria-label="Eliminar" title="Eliminar">×</button></td></tr>';
    }).join('') || '<tr><td colspan="9" class="muted">Sin entradas en este período</td></tr>';
    $('logT').innerHTML = h + '</tbody>';
    var rg = logRange();
    $('logInfo').textContent = rows.length + ' entradas · ' + fmtH(imp) + ' imputables · ' + fmtH(inn) + ' internas · ' + rg[0].split('-').reverse().join('/') + (rg[0] === rg[1] ? '' : ' – ' + rg[1].split('-').reverse().join('/'));
    document.querySelectorAll('#logMode button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-m') === logMode); });
  }
  $('logT').onclick = async function (e) {
    var th = e.target.closest('th.srt');
    if (th) { var c = +th.getAttribute('data-c'); if (logSort.col === c) logSort.dir = -logSort.dir; else { logSort.col = c; logSort.dir = c === 6 ? -1 : 1; } drawLog(); return; }
    var id = e.target.getAttribute('data-del');
    if (!id || !(await askConfirm('Eliminar entrada', '¿Seguro que quieres eliminarla?', 'Eliminar'))) return;
    var r = await sb.from('time_entries').delete().eq('id', id);
    if (r.error) return err(r.error);
    loadDay();
  };
  $('logMode').onclick = function (e) { var m = e.target.getAttribute('data-m'); if (m) { logMode = m; loadLog(); } };
  function go(d) { st.day = d; $('dayPick').value = d; loadDay(); }
  function shift(n) { var d = new Date(st.day + 'T12:00:00'); d.setDate(d.getDate() + n); go(d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())); }
  $('prev').onclick = function () { shift(-1); };
  $('next').onclick = function () { shift(1); };
  $('todayBtn').onclick = function () { go(today()); };
  $('dayPick').onchange = function () { if ($('dayPick').value) go($('dayPick').value); };

  async function insertEntry(o) {
    var r = await sb.from('time_entries').insert(o);
    if (r.error) { err(r.error); return false; }
    return true;
  }
  $('mForm').onsubmit = async function (e) {
    e.preventDefault();
    var o = { project_id: $('mProj').value, task: $('mTask').value.trim(), entry_date: st.day, start_time: $('mStart').value, end_time: $('mEnd').value, ticket: $('mTicket').value.trim() || null, imputable: $('mImp').checked };
    if (await insertEntry(o)) { $('mTask').value = ''; $('mTicket').value = ''; toast('Guardado'); loadDay(); }
  };
  $('repeatBtn').onclick = async function () {
    var l = st.entries[st.entries.length - 1];
    if (!l) return toast('No hay una entrada previa en este día');
    $('mProj').value = l.project_id; $('mTask').value = l.task; $('mTicket').value = l.ticket || ''; $('mImp').checked = l.imputable;
    $('mStart').value = hm(l.end_time); $('mEnd').focus();
  };
  $('dailyBtn').onclick = async function () {
    var s = st.settings;
    var gen = st.projects.find(function (p) { return p.name === 'General' && !p.client_id; }) || st.projects[0];
    if (await insertEntry({ project_id: gen.id, task: 'Reunión daily', category: 'Daily', entry_date: st.day, start_time: s.daily_start, end_time: s.daily_end, imputable: false })) loadDay();
  };

  // ===== Proyectos =====
  $('pForm').onsubmit = async function (e) {
    e.preventDefault();
    var cn = $('pClient').value.trim(), cid = null;
    if (cn) cid = await ensureClient(cn);
    var r = await sb.from('projects').insert({ name: $('pName').value.trim(), client_id: cid });
    if (r.error) return err(r.error);
    $('pName').value = ''; await loadBase(); toast('Proyecto agregado');
  };
  async function ensureClient(name) {
    var c = st.clients.find(function (x) { return x.name.toLowerCase() === name.toLowerCase(); });
    if (c) return c.id;
    var r = await sb.from('clients').insert({ name: name }).select().single();
    if (r.error) throw r.error;
    st.clients.push(r.data); return r.data.id;
  }
  async function ensureProject(client, name) {
    var cid = client ? await ensureClient(client) : null;
    var p = st.projects.find(function (x) { return x.name.toLowerCase() === name.toLowerCase() && (x.client_id || null) === cid; });
    if (p) return p.id;
    var r = await sb.from('projects').insert({ name: name, client_id: cid }).select().single();
    if (r.error) throw r.error;
    st.projects.push(r.data); return r.data.id;
  }

  // ===== Cronómetro =====
  async function loadTimer() {
    var r = await sb.from('active_timer').select('*').maybeSingle();
    st.timer = r.data || null; renderTimer();
  }
  function renderTimer() {
    clearInterval(st.tick);
    $('timerIdle').hidden = !!st.timer; $('timerRun').hidden = !st.timer;
    if (!st.timer) return;
    $('tWhat').textContent = st.timer.task;
    var s0 = new Date(st.timer.started_at); $('tFrom2').value = pad(s0.getHours()) + ':' + pad(s0.getMinutes()); st.toEdited = false;
    var f = function () { var s = Math.max(0, Math.floor((Date.now() - new Date(st.timer.started_at)) / 1000)); $('tClock').textContent = pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60); };
    f(); st.tick = setInterval(function () { f(); if (!st.toEdited && document.activeElement !== $('tTo')) { var n = new Date(); $('tTo').value = pad(n.getHours()) + ':' + pad(n.getMinutes()); } }, 1000);
    var n0 = new Date(); $('tTo').value = pad(n0.getHours()) + ':' + pad(n0.getMinutes()); $('tTo').oninput = function () { st.toEdited = true; };
  }
  $('tStart').onclick = async function () {
    var task = $('tTask').value.trim();
    if (!task) return toast('Escribe qué vas a hacer');
    var row = { project_id: $('tProj').value, task: task };
    if ($('tFrom').value) { var p = $('tFrom').value.split(':'), sd = new Date(); sd.setHours(+p[0], +p[1], 0, 0); row.started_at = sd.toISOString(); }
    var r = await sb.from('active_timer').insert(row).select().single();
    if (r.error) return err(r.error);
    $('tTask').value = ''; st.timer = r.data; renderTimer();
  };
  function nowHM() { var n = new Date(); return pad(n.getHours()) + ':' + pad(n.getMinutes()); }
  $('tFrom').value = nowHM();
  function r15(m) { return Math.round(m / 15) * 15; }
  $('tStop').onclick = async function () {
    var t = st.timer, a = new Date(t.started_at), b = new Date();
    var pm = function (v, d) { if (!v) return d; var x = v.split(':'); return +x[0] * 60 + +x[1]; };
    var sm = r15(pm($('tFrom2').value, a.getHours() * 60 + a.getMinutes())), em = r15(pm($('tTo').value, b.getHours() * 60 + b.getMinutes()));
    if (em <= sm) em = sm + 15;
    var f = function (m) { return pad(Math.floor(m / 60)) + ':' + pad(m % 60); };
    var d = a.getFullYear() + '-' + pad(a.getMonth() + 1) + '-' + pad(a.getDate());
    var ok = await insertEntry({ project_id: t.project_id, task: t.task, entry_date: d, start_time: f(sm), end_time: f(em) });
    if (!ok) return;
    await sb.from('active_timer').delete().eq('user_id', st.user.id);
    st.timer = null; renderTimer(); go(d); toast('Guardado (' + f(sm) + '–' + f(em) + ')');
  };

  // ===== Importar semilla =====
  $('seedFile').onchange = async function (ev) {
    var file = ev.target.files[0]; if (!file) return;
    var txt = (await file.text()).replace(/^﻿/, '');
    var lines = txt.split(/\r?\n/).filter(Boolean), h = lines.shift().split(';'), rows = [];
    lines.forEach(function (l) { var c = l.split(';'), o = {}; h.forEach(function (k, i) { o[k] = c[i]; }); rows.push(o); });
    $('seedMsg').textContent = 'Importando ' + rows.length + ' filas…';
    var batch = [], impMin = 0, intMin = 0;
    try {
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var pid = await ensureProject(r.cliente, r.proyecto);
        var imp = r.imputable === 'SI', dur = +r.duracion_min;
        if (imp) impMin += dur; else intMin += dur;
        batch.push({ project_id: pid, task: r.tarea, category: r.categoria || 'Proyecto', ticket: r.ticket || null, entry_date: r.fecha, start_time: r.inicio, end_time: r.fin, imputable: imp });
      }
      var q = await sb.from('time_entries').insert(batch);
      if (q.error) throw q.error;
      $('seedMsg').textContent = 'Listo: ' + fmtH(impMin) + ' imputables (esperado 83,25 h) y ' + fmtH(intMin) + ' internas (esperado 6,25 h).';
      await loadBase(); loadDay(); renderDatos();
    } catch (e) { $('seedMsg').textContent = 'Error: ' + (e.message || e) + ' (no se guardó nada)'; }
    ev.target.value = '';
  };

  // ===== Modales, legal, contacto, confirmación =====
  document.addEventListener('click', function (e) {
    var c = e.target.closest('[data-close]'); if (c) $(c.dataset.close).hidden = true;
    var l = e.target.closest('[data-legal]'); if (l) openLegal(l.dataset.legal);
    if (e.target.closest('.contact-open')) { $('ctSt').textContent = ''; $('contactM').hidden = false; }
  });
  var LEGAL = {
    terms: { t: 'Términos de uso', p: ['Bitácora HH es una herramienta personal para registrar horas y actividades, administrada por JH. Al crear una cuenta aceptas estas condiciones.', 'Eres responsable de la información que registras. El servicio se ofrece tal cual, sin garantía de disponibilidad: conserva respaldo de lo importante.', 'Podemos suspender cuentas que hagan un uso abusivo del servicio.'] },
    privacy: { t: 'Política de privacidad', p: ['Responsable: JH (contacto desde el botón ✉ o ? de la app).', 'Datos que guardamos: nombre, usuario, correo, y las horas, tareas, tickets y proyectos que registras. Si usas el formulario de contacto, guardamos lo que escribas.', 'Para qué: administrar tu cuenta y mostrarte tu registro. No vendemos ni compartimos tus datos con terceros.', 'Dónde: en Supabase, con acceso restringido por cuenta. El administrador puede ver resúmenes y el detalle de horas del equipo.', 'Tus derechos: puedes pedir acceso, corrección o eliminación de tus datos desde el contacto.'] }
  };
  function openLegal(k) {
    $('lgT').textContent = LEGAL[k].t;
    $('lgB').innerHTML = LEGAL[k].p.map(function (x) { return '<p>' + esc(x) + '</p>'; }).join('') + '<p class="muted">Última actualización: octubre 2026.</p>';
    $('legalM').hidden = false;
  }
  $('lgX').onclick = function () { $('legalM').hidden = true; };
  function askConfirm(title, body, ok) {
    return new Promise(function (res) {
      $('cfT').textContent = title; $('cfB').innerHTML = typeof body === 'string' ? '<p class="muted">' + esc(body) + '</p>' : body.html;
      $('cfOk').textContent = ok || 'Aceptar'; $('confirmM').hidden = false;
      var done = function (v) { $('confirmM').hidden = true; $('cfOk').onclick = $('cfNo').onclick = null; res(v); };
      $('cfOk').onclick = function () { done(true); }; $('cfNo').onclick = function () { done(false); };
    });
  }
  $('resetF').onsubmit = async function (e) {
    e.preventDefault();
    var r = await sb.auth.updateUser({ password: $('rsPass').value });
    if (r.error) { $('rsMsg').textContent = r.error.message; return; }
    $('resetM').hidden = true; toast('Contraseña actualizada');
  };
  var lastContact = 0;
  $('contactF').onsubmit = async function (e) {
    e.preventDefault();
    if ($('ctHp').value) { $('contactM').hidden = true; return; }
    if (Date.now() - lastContact < 30000) { $('ctSt').textContent = 'Espera unos segundos antes de enviar otro mensaje.'; return; }
    var r = await sb.from('contact_messages').insert({ name: $('ctName').value.trim(), email: $('ctEmail').value.trim(), message: $('ctMsg').value.trim() });
    if (r.error) { $('ctSt').textContent = 'No se pudo enviar: ' + r.error.message; return; }
    lastContact = Date.now(); $('contactM').hidden = true; $('ctMsg').value = ''; toast('¡Mensaje enviado! Gracias por escribirme.');
  };

  // ===== Instalar y compartir =====
  var installEv = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installEv = e; });
  window.addEventListener('appinstalled', function () { document.querySelectorAll('.app-install').forEach(function (b) { b.hidden = true; }); toast('¡Bitácora HH instalada!'); });
  if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) document.querySelectorAll('.app-install').forEach(function (b) { b.hidden = true; });
  document.querySelectorAll('.app-share').forEach(function (b) {
    b.onclick = async function () {
      try { if (navigator.share) { await navigator.share({ title: 'Bitácora HH', text: 'Registro de horas y actividades', url: cfg.APP_URL }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
      try { await navigator.clipboard.writeText(cfg.APP_URL); toast('Link copiado'); } catch (e) { toast(cfg.APP_URL); }
    };
  });
  document.querySelectorAll('.app-install').forEach(function (b) {
    b.onclick = async function () {
      if (installEv) { installEv.prompt(); await installEv.userChoice.catch(function () {}); installEv = null; return; }
      var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      await askConfirm('Instalar Bitácora HH', { html: ios ? '<ol class="cf"><li>Toca Compartir (cuadrado con flecha).</li><li>Elige «Agregar a inicio».</li><li>Toca «Agregar».</li></ol>' : '<ol class="cf"><li>Toca el menú ⋮ de Chrome.</li><li>Elige «Instalar app» o «Agregar a la pantalla de inicio».</li><li>Confirma.</li></ol>' }, 'Entendido');
    };
  });

  // ===== Estadísticas y exportar =====
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  async function monthEntries() {
    var n = new Date(); var from = iso(new Date(n.getFullYear(), n.getMonth(), 1)), to = iso(new Date(n.getFullYear(), n.getMonth() + 1, 0));
    var r = await sb.from('time_entries').select('entry_date,start_time,end_time,duration_minutes,task,ticket,imputable,projects(name,client_id)').gte('entry_date', from).lte('entry_date', to).order('entry_date').order('start_time');
    return r.data || [];
  }
  $('statsBtn').onclick = async function () {
    var rows = await monthEntries(), n = new Date(), dow = (n.getDay() + 6) % 7, wk = new Date(n); wk.setDate(n.getDate() - dow);
    var wkIso = iso(wk), t = iso(n), m = 0, w = 0, d = 0, byP = {};
    rows.forEach(function (e) { if (!e.imputable) return; m += e.duration_minutes; if (e.entry_date >= wkIso) w += e.duration_minutes; if (e.entry_date === t) d += e.duration_minutes; var k = e.projects ? e.projects.name : '—'; byP[k] = (byP[k] || 0) + e.duration_minutes; });
    var card = function (a, b) { return '<div class="panel"><small class="muted">' + a + '</small><br><b style="font-size:1.4rem">' + b + '</b></div>'; };
    $('statsB').innerHTML = '<div class="grid3">' + card('Hoy', fmtH(d)) + card('Semana', fmtH(w)) + card('Mes', fmtH(m)) + '</div>' +
      Object.keys(byP).map(function (k) { return '<div class="row"><span class="grow">' + esc(k) + '</span><b>' + fmtH(byP[k]) + '</b></div>'; }).join('') + '<p class="muted">Solo horas imputables.</p>';
    $('statsM').hidden = false;
  };
  $('stCsv').onclick = async function () {
    var rows = await monthEntries(), q = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    var csv = '﻿' + [['fecha', 'inicio', 'fin', 'horas', 'proyecto', 'tarea', 'ticket', 'imputable']].concat(rows.map(function (e) { return [e.entry_date, hm(e.start_time), hm(e.end_time), (e.duration_minutes / 60).toFixed(2), e.projects ? e.projects.name : '', e.task, e.ticket, e.imputable ? 'SI' : 'NO']; })).map(function (r) { return r.map(q).join(';'); }).join('\r\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = 'bitacora-hh-mes.csv'; a.click(); toast('CSV descargado');
  };

  // ===== Admin: usuarios y mensajes =====
  $('usersBtn').onclick = async function () {
    var r = await sb.rpc('admin_users'); if (r.error) return err(r.error);
    $('usersB').innerHTML = (r.data || []).map(function (u) { return '<div class="panel"><b>' + esc(u.full_name || u.username) + '</b>' + (u.role === 'admin' ? ' · Admin' : '') + '<br><small class="muted">' + esc(u.email) + ' · ' + u.entries + ' entradas' + (u.last_entry ? ' · última ' + u.last_entry : '') + '</small></div>'; }).join('');
    $('usersM').hidden = false;
  };
  async function checkInbox() {
    var r = await sb.from('contact_messages').select('id', { count: 'exact', head: true }).eq('read', false);
    $('inboxDot').hidden = !(r.count > 0);
  }
  $('inboxBtn').onclick = async function () {
    var r = await sb.from('contact_messages').select('*').order('created_at', { ascending: false }).limit(50); if (r.error) return err(r.error);
    $('inboxB').innerHTML = (r.data || []).map(function (m) { return '<div class="panel"><b>' + esc(m.name) + '</b> · <small class="muted">' + esc(m.email) + '</small><p>' + esc(m.message) + '</p></div>'; }).join('') || '<p class="muted">Sin mensajes</p>';
    $('inboxM').hidden = false;
    await sb.from('contact_messages').update({ read: true }).eq('read', false); $('inboxDot').hidden = true;
  };

  // ===== Panel: KPIs, gráficas y Excel =====
  var pm = new Date(); pm = new Date(pm.getFullYear(), pm.getMonth(), 1);
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  async function loadMonthRows() {
    var from = pm.getFullYear() + '-' + pad(pm.getMonth() + 1) + '-01', last = new Date(pm.getFullYear(), pm.getMonth() + 1, 0).getDate();
    var to = pm.getFullYear() + '-' + pad(pm.getMonth() + 1) + '-' + pad(last);
    var r = await sb.from('time_entries').select('entry_date,start_time,end_time,duration_minutes,task,ticket,ticket_status,imputable,category,projects(name,client_id)').gte('entry_date', from).lte('entry_date', to).order('entry_date').order('start_time');
    if (r.error) { err(r.error); return []; }
    return (r.data || []).map(function (e) {
      var c = e.projects && st.clients.find(function (x) { return x.id === e.projects.client_id; });
      return { entry_date: e.entry_date, start_time: e.start_time, end_time: e.end_time, duration_minutes: e.duration_minutes, task: e.task, ticket: e.ticket, ticket_status: e.ticket_status, imputable: e.imputable, category: e.category, project: e.projects ? e.projects.name : '—', client: c ? c.name : '' };
    });
  }
  function kpi(label, val, sub, cls) { return '<div class="kpi ' + (cls || '') + '"><small>' + label + '</small><b>' + val + '</b>' + (sub ? '<em>' + sub + '</em>' : '') + '</div>'; }
  async function renderPanel() {
    $('mLabel').textContent = MESES[pm.getMonth()] + ' ' + pm.getFullYear();
    var rows = await loadMonthRows(), goal = st.settings ? st.settings.max_imputable_day_minutes : 480, R = window.BHHReport, S = R.stats(rows, goal);
    st.monthRows = rows;
    var X = R.extra(rows, goal, iso(new Date()), pm.getFullYear() + '-' + pad(pm.getMonth() + 1));
    var pct = function (v) { return Math.round(v * 100) + '%'; };
    $('kpis').innerHTML =
      kpi('Horas imputables', R.fh(S.imp), S.n + ' entradas', 'k1') + kpi('Horas internas', R.fh(S.int), 'daily y otras', 'k2') +
      kpi('Días con registro', S.days.length, S.okDays + ' cuadran con la meta', 'k3') + kpi('Promedio por día', R.fh(S.avg), 'imputable', 'k4') +
      kpi('Cumplimiento', pct(S.compliance), 'vs. ' + R.fh(goal) + ' por día', 'k5') + kpi('Mejor día', S.best ? S.best.slice(8) + '/' + S.best.slice(5, 7) : '—', S.best ? R.fh(S.byDay[S.best].imp) : '', 'k6') +
      kpi('Meta del mes', R.fh(X.goalMonth), X.workdays + ' días hábiles · ' + pct(X.progress) + ' logrado', 'k7') +
      kpi('Proyección a fin de mes', R.fh(X.projection), X.remaining + ' días hábiles por delante', 'k8') +
      kpi('Reuniones', R.fh(X.meetings), 'horas imputadas', 'k9') + kpi('Tareas distintas', X.tasksN, 'en el mes', 'k10') +
      kpi('Con ticket', pct(X.ticketPct), 'de las entradas imputables', 'k11') + kpi('Día más bajo', X.low ? X.low.slice(8) + '/' + X.low.slice(5, 7) : '—', X.low ? R.fh(S.byDay[X.low].imp) : '', 'k12');
    $('chDays').innerHTML = R.chartDays(S, goal);
    $('chProj').innerHTML = R.chartDonut(S);
    $('chWeeks').innerHTML = R.chartWeeks(S, 2400);
    $('chDow').innerHTML = R.chartDow(X, goal);
    $('chCat').innerHTML = R.chartCats(X);
    $('chTop').innerHTML = R.listTop(X);
  }
  $('mPrev').onclick = function () { pm = new Date(pm.getFullYear(), pm.getMonth() - 1, 1); renderPanel(); };
  $('mNext').onclick = function () { pm = new Date(pm.getFullYear(), pm.getMonth() + 1, 1); renderPanel(); };
  function save(wb, name) { if (!window.XLSX) return toast('No cargó el generador de Excel; revisa tu conexión'); XLSX.writeFile(wb, name); toast('Descargado: ' + name); }
  $('xPersonal').onclick = async function () {
    var rows = await loadMonthRows(); if (!rows.length) return toast('No hay horas este mes');
    save(window.BHHReport.personalWorkbook(XLSX, rows, st.settings ? st.settings.max_imputable_day_minutes : 480), 'Horas_personal_' + pm.getFullYear() + pad(pm.getMonth() + 1) + '.xlsx');
  };
  $('xBoss').onclick = async function () {
    var rows = await loadMonthRows(); if (!rows.length) return toast('No hay horas este mes');
    save(window.BHHReport.bossWorkbook(XLSX, rows), pm.getFullYear() + pad(pm.getMonth() + 1) + '_HH_Masisa_1_1.xlsx');
  };

  // ===== Informes: filtros, tabla, Excel y correo =====
  var pr = { mode: 'month', anchor: new Date() };
  function isoD(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function periodRange() {
    var a = new Date(pr.anchor.getFullYear(), pr.anchor.getMonth(), pr.anchor.getDate());
    if (pr.mode === 'day') return { from: isoD(a), to: isoD(a), label: DIAS[a.getDay()] + ' ' + a.getDate() + ' de ' + MESES[a.getMonth()] };
    if (pr.mode === 'week') { var s = new Date(a); s.setDate(a.getDate() - (a.getDay() + 6) % 7); var e = new Date(s); e.setDate(s.getDate() + 6); return { from: isoD(s), to: isoD(e), label: s.getDate() + ' ' + MESES[s.getMonth()].slice(0, 3) + ' – ' + e.getDate() + ' ' + MESES[e.getMonth()].slice(0, 3) + ' ' + e.getFullYear() }; }
    var f = new Date(a.getFullYear(), a.getMonth(), 1), l = new Date(a.getFullYear(), a.getMonth() + 1, 0);
    return { from: isoD(f), to: isoD(l), label: MESES[a.getMonth()] + ' ' + a.getFullYear() };
  }
  var DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  async function loadRange(from, to) {
    var r = await sb.from('time_entries').select('entry_date,start_time,end_time,duration_minutes,task,ticket,ticket_status,imputable,category,projects(name,client_id)').gte('entry_date', from).lte('entry_date', to).order('entry_date').order('start_time');
    if (r.error) { err(r.error); return []; }
    return (r.data || []).map(function (e) {
      var c = e.projects && st.clients.find(function (x) { return x.id === e.projects.client_id; });
      return { entry_date: e.entry_date, start_time: e.start_time, end_time: e.end_time, duration_minutes: e.duration_minutes, task: e.task, ticket: e.ticket, ticket_status: e.ticket_status, imputable: e.imputable, category: e.category, project: e.projects ? e.projects.name : '—', client: c ? c.name : '' };
    });
  }
  var infRows = [];
  function infGoal() { return st.settings ? st.settings.max_imputable_day_minutes : 480; }
  function fillInfSelects() {
    var F = window.BHHReport.FILES;
    if (!$('iFile').options.length) $('iFile').innerHTML = Object.keys(F).map(function (k) { return '<option value="' + k + '">' + F[k].label + '</option>'; }).join('');
    var cur = $('iSheet').value, sh = F[$('iFile').value].sheets;
    $('iSheet').innerHTML = Object.keys(sh).map(function (k) { return '<option value="' + k + '">Hoja: ' + sh[k] + '</option>'; }).join('');
    if (sh[cur]) $('iSheet').value = cur;
    if (!$('iProj').options.length) $('iProj').innerHTML = '<option value="">Todos los proyectos</option>' + st.projects.map(function (p) { return '<option value="' + esc(p.name) + '">' + esc(p.name) + '</option>'; }).join('');
  }
  function filtered() { var p = $('iProj').value; return p ? infRows.filter(function (e) { return e.project === p; }) : infRows; }
  var sortS = { col: -1, dir: 1 };
  function sortKey(v) {
    v = String(v == null ? '' : v);
    var m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if (m) return +(m[3] + m[2] + m[1]);
    m = v.match(/^[a-zá-ú]{3} (\d{2})\/(\d{2})\/(\d{4})$/i); if (m) return +(m[3] + m[2] + m[1]);
    m = v.match(/^(\d{2}):(\d{2})$/); if (m) return +m[1] * 60 + +m[2];
    if (/^[+\-]?\d+(,\d+)?%?$/.test(v)) return parseFloat(v.replace(',', '.'));
    return v.toLowerCase();
  }
  $('iTable').onclick = function (e) {
    var th = e.target.closest('th[data-c]'); if (!th) return;
    var c = +th.dataset.c;
    if (sortS.col === c) { if (sortS.dir === 1) sortS.dir = -1; else sortS.col = -1; } else { sortS.col = c; sortS.dir = 1; }
    drawTable();
  };
  function drawTable() {
    var T = window.BHHReport.table($('iFile').value, $('iSheet').value, filtered(), infGoal());
    if (sortS.col >= T.cols.length) sortS.col = -1;
    if (sortS.col >= 0) { var ci = sortS.col, dr = sortS.dir; T.rows.sort(function (x, y) { var a = sortKey(x[ci]), b = sortKey(y[ci]), r = (typeof a === 'number' && typeof b === 'number') ? a - b : String(a).localeCompare(String(b), 'es', { numeric: true }); return r * dr; }); }
    var h = '<thead><tr>' + T.cols.map(function (c, i) { var on = sortS.col === i; return '<th data-c="' + i + '" class="srt" aria-sort="' + (on ? (sortS.dir > 0 ? 'ascending' : 'descending') : 'none') + '">' + esc(c) + '<span>' + (on ? (sortS.dir > 0 ? ' ▲' : ' ▼') : ' ↕') + '</span></th>'; }).join('') + '</tr></thead><tbody>';
    h += T.rows.map(function (r) { return '<tr>' + r.map(function (v, i) { return '<td class="' + (/^[+\-]?\d+(,\d+)?%?$/.test(v) ? 'num' : '') + '">' + esc(v) + '</td>'; }).join('') + '</tr>'; }).join('');
    if (!T.rows.length) h += '<tr><td colspan="' + T.cols.length + '" class="muted">Sin datos en este período</td></tr>';
    h += '</tbody>';
    $('iTable').innerHTML = h;
    $('iInfo').textContent = T.rows.length + ' filas' + (T.total ? ' · ' + T.total.label + ': ' + T.total.value : '');
    return T;
  }
  async function renderInf() {
    fillInfSelects();
    var R = periodRange(); $('iLabel').textContent = R.label;
    infRows = await loadRange(R.from, R.to); drawTable();
  }
  $('pMode').onclick = function (e) { var b = e.target.closest('button'); if (!b) return; pr.mode = b.dataset.m; document.querySelectorAll('#pMode button').forEach(function (x) { x.classList.toggle('on', x === b); }); renderInf(); };
  function stepP(n) { var a = pr.anchor; pr.anchor = pr.mode === 'day' ? new Date(a.getFullYear(), a.getMonth(), a.getDate() + n) : pr.mode === 'week' ? new Date(a.getFullYear(), a.getMonth(), a.getDate() + 7 * n) : new Date(a.getFullYear(), a.getMonth() + n, 1); renderInf(); }
  $('iPrev').onclick = function () { stepP(-1); }; $('iNext').onclick = function () { stepP(1); };
  $('iNow').onclick = function () { pr.anchor = new Date(); renderInf(); };
  $('iFile').onchange = function () { sortS.col = -1; fillInfSelects(); drawTable(); };
  $('iSheet').onchange = function () { sortS.col = -1; drawTable(); }; $('iProj').onchange = drawTable;
  function fileName(all) {
    var R = periodRange(), f = $('iFile').value, per = R.from.replace(/-/g, '') + (R.from === R.to ? '' : '_' + R.to.replace(/-/g, ''));
    return (f === 'boss' ? 'HH_Masisa_' : 'Horas_personal_') + per + (all ? '' : '_' + $('iSheet').value) + '.xlsx';
  }
  function infBook(all) { return window.BHHReport.workbook(XLSX, $('iFile').value, all ? 'todas' : $('iSheet').value, filtered(), infGoal()); }
  function needData() { if (!window.XLSX) { toast('No cargó el generador de Excel'); return false; } if (!filtered().length) { toast('No hay horas en este período'); return false; } return true; }
  $('iXls').onclick = function () { if (needData()) { var n = fileName(false); XLSX.writeFile(infBook(false), n); toast('Descargado: ' + n); } };
  $('iAll').onclick = function () { if (needData()) { var n = fileName(true); XLSX.writeFile(infBook(true), n); toast('Descargado: ' + n); } };
  $('iMail').onclick = function () {
    if (!needData()) return;
    var R = periodRange(), S = window.BHHReport.stats(filtered(), infGoal()), who = (st.profile && st.profile.full_name) || '';
    var to = ''; try { to = localStorage.getItem('bhh-mailto') || ''; } catch (e) {}
    $('mTo').value = to;
    $('mSub').value = 'Reporte de horas ' + R.label + (who ? ' - ' + who : '');
    $('mBody').value = 'Hola,\n\nTe envío el reporte de horas de ' + R.label + ': ' + window.BHHReport.fh(S.imp) + ' imputables en ' + S.days.length + ' días.\nAdjunto el archivo Excel.\n\nSaludos' + (who ? ',\n' + who : '') + '.';
    $('mTip').textContent = navigator.canShare ? 'Se abrirá tu app de correo con el Excel adjunto.' : 'Se descargará el Excel y se abrirá tu correo: adjúntalo desde Descargas.';
    $('mailM').hidden = false;
  };
  $('mailF').onsubmit = async function (e) {
    e.preventDefault();
    var to = $('mTo').value.trim(), sub = $('mSub').value, body = $('mBody').value, name = fileName(true);
    try { localStorage.setItem('bhh-mailto', to); } catch (x) {}
    var wb = infBook(true), out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    var file = new File([out], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    $('mailM').hidden = true;
    try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: sub, text: body }); return; } } catch (x) { if (x && x.name === 'AbortError') return; }
    XLSX.writeFile(wb, name);
    location.href = 'mailto:' + encodeURIComponent(to) + '?subject=' + encodeURIComponent(sub) + '&body=' + encodeURIComponent(body + '\n\n(Archivo descargado: ' + name + ')');
    toast('Excel descargado: adjúntalo al correo', 6000);
  };

  // ===== Asistente (Claude) =====
  var chatHist = [];
  var CHIPS = ['¿Cuántas horas llevo esta semana?', 'Resume mi semana en 5 líneas', 'Redacta los comentarios del TMS de hoy', '¿Qué días no cuadran con las 8 h?', '¿Cuánto he dedicado a cada proyecto este mes?'];
  $('askChips').innerHTML = CHIPS.map(function (c) { return '<button type="button" class="chip">' + esc(c) + '</button>'; }).join('');
  function addMsg(role, text) {
    var d = document.createElement('div'); d.className = 'msg-' + role; d.textContent = text; $('askLog').appendChild(d); $('askLog').scrollTop = 1e6; return d;
  }
  $('askFab').onclick = function () { $('askM').hidden = false; if (!$('askLog').children.length) addMsg('bot', 'Hola, soy Claude. Puedo responder sobre tus horas registradas, resumir tu semana o ayudarte a redactar los comentarios del TMS. ¿Qué necesitas?'); setTimeout(function () { $('askQ').focus(); }, 50); };
  async function ask(q) {
    if (!q) return;
    $('askChips').hidden = true; addMsg('user', q); $('askQ').value = '';
    var w = addMsg('bot', 'Pensando…'); w.classList.add('wait');
    var r = await sb.functions.invoke('ask-claude', { body: { question: q, history: chatHist } });
    w.classList.remove('wait');
    var a = r.data && r.data.answer;
    if (r.error || !a) { var m = (r.data && r.data.error) || (r.error && r.error.message) || 'No pude responder ahora.'; w.textContent = 'No pude responder: ' + m; return; }
    w.textContent = a; chatHist.push({ role: 'user', content: q }, { role: 'assistant', content: a });
    $('askLog').scrollTop = 1e6;
  }
  $('askF').onsubmit = function (e) { e.preventDefault(); ask($('askQ').value.trim()); };
  $('askChips').onclick = function (e) { var b = e.target.closest('.chip'); if (b) ask(b.textContent); };

  // ===== Volver arriba =====
  function goTop() {
    document.querySelectorAll('.tbl-wrap').forEach(function (t) { t.scrollTop = 0; });
    var se = document.scrollingElement || document.documentElement, from = Math.max(se.scrollTop, window.scrollY || 0), t0 = performance.now(), dur = 300;
    function fin() { var hd = document.querySelector('#app > header'); if (hd) hd.scrollIntoView({ block: 'start' }); window.scrollTo(0, 0); se.scrollTop = 0; document.documentElement.scrollTop = 0; document.body.scrollTop = 0; }
    function step(t) {
      var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      window.scrollTo(0, from * (1 - e));
      if (k < 1) requestAnimationFrame(step); else { fin(); setTimeout(fin, 120); }
    }
    requestAnimationFrame(step);
  }
  $('toTop').onclick = goTop; $('footTop').onclick = goTop;
  window.addEventListener('scroll', function () { $('toTop').hidden = !(st.user && window.scrollY > 300); }, { passive: true });

  // ===== Datos: resumen y respaldo =====
  async function loadAll() {
    var all = [], from = 0, step = 1000;
    while (true) {
      var r = await sb.from('time_entries').select('entry_date,start_time,end_time,duration_minutes,task,ticket,ticket_status,imputable,category,projects(name,client_id)').order('entry_date').order('start_time').range(from, from + step - 1);
      if (r.error) { err(r.error); break; }
      all = all.concat(r.data || []); if (!r.data || r.data.length < step) break; from += step;
    }
    return all.map(function (e) {
      var c = e.projects && st.clients.find(function (x) { return x.id === e.projects.client_id; });
      return { entry_date: e.entry_date, start_time: e.start_time, end_time: e.end_time, duration_minutes: e.duration_minutes, task: e.task, ticket: e.ticket, ticket_status: e.ticket_status, imputable: e.imputable, category: e.category, project: e.projects ? e.projects.name : '—', client: c ? c.name : '' };
    });
  }
  async function renderDatos() {
    var rows = await loadAll(), imp = 0, int = 0, days = {};
    rows.forEach(function (e) { days[e.entry_date] = 1; if (e.imputable) imp += e.duration_minutes; else int += e.duration_minutes; });
    var ds = Object.keys(days).sort(), f = function (d) { return d ? d.slice(8) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : '—'; };
    $('dKpis').innerHTML = kpi('Registros', rows.length, 'entradas guardadas', 'k1') + kpi('Horas imputables', fmtH(imp), 'en total', 'k3') + kpi('Horas internas', fmtH(int), 'en total', 'k2') +
      kpi('Días con registro', ds.length, 'desde ' + f(ds[0]), 'k4') + kpi('Último registro', f(ds[ds.length - 1]), '', 'k5') + kpi('Proyectos', st.projects.length, st.clients.length + ' clientes', 'k6');
    st.allRows = rows;
  }
  function dl(name, text, type) { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type })); a.download = name; a.click(); toast('Descargado: ' + name); }
  $('bkCsv').onclick = async function () {
    var rows = st.allRows || await loadAll(), q = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    dl('bitacora-hh-todo.csv', '﻿' + [['fecha', 'inicio', 'fin', 'duracion_min', 'cliente', 'proyecto', 'tarea', 'ticket', 'imputable', 'categoria']].concat(rows.map(function (e) { return [e.entry_date, hm(e.start_time), hm(e.end_time), e.duration_minutes, e.client, e.project, e.task, e.ticket, e.imputable ? 'SI' : 'NO', e.category]; })).map(function (r) { return r.map(q).join(';'); }).join('\r\n'), 'text/csv;charset=utf-8');
  };
  $('bkJson').onclick = async function () { var rows = st.allRows || await loadAll(); dl('bitacora-hh-respaldo.json', JSON.stringify({ app: 'Bitácora HH', exportado: new Date().toISOString(), proyectos: st.projects, clientes: st.clients, entradas: rows }, null, 2), 'application/json'); };
  $('bkXls').onclick = async function () {
    var rows = st.allRows || await loadAll(); if (!rows.length) return toast('No hay datos');
    save(window.BHHReport.personalWorkbook(XLSX, rows, st.settings ? st.settings.max_imputable_day_minutes : 480), 'Bitacora_HH_todo.xlsx');
  };

  document.querySelector('.tabs').onclick = function (e) {
    var b = e.target.closest('button'); if (!b) return;
    document.querySelectorAll('.tabs button').forEach(function (x) { x.classList.toggle('on', x === b); });
    document.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('on', x.id === 'tab-' + b.dataset.tab); });
    scrollTo(0, 0);
    if (b.dataset.tab === 'panel') renderPanel();
    if (b.dataset.tab === 'inf') renderInf();
    if (b.dataset.tab === 'datos') renderDatos();
  };

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
  sb.auth.getSession().then(function (r) { if (!r.data.session) boot(null); });
})();

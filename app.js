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
    if (!session) { st.user = null; clearInterval(st.tick); $('app').hidden = true; $('auth').hidden = false; return; }
    if (st.user && st.user.id === session.user.id) return;
    st.user = session.user;
    $('auth').hidden = true; $('app').hidden = false;
    await loadBase();
    $('dayPick').value = st.day;
    await loadDay();
    await loadTimer();
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
  }

  // ===== Día =====
  async function loadDay() {
    var r = await sb.from('time_entries').select('*, projects(name, client_id)').eq('entry_date', st.day).order('start_time');
    if (r.error) return err(r.error);
    st.entries = r.data || [];
    render();
  }
  function render() {
    var imp = 0, int = 0;
    st.entries.forEach(function (e) { if (e.imputable) imp += e.duration_minutes; else int += e.duration_minutes; });
    var goal = st.settings ? st.settings.max_imputable_day_minutes : 480;
    $('tImp').textContent = fmtH(imp).replace(' h',''); $('tInt').textContent = fmtH(int); $('tGoal').textContent = fmtH(goal);
    $('bar').style.width = Math.min(100, imp / goal * 100) + '%';
    $('list').innerHTML = st.entries.map(function (e) {
      var pn = e.projects ? e.projects.name : '';
      return '<li class="' + (e.imputable ? '' : 'int') + '"><span class="t">' + hm(e.start_time) + '–' + hm(e.end_time) + '</span>' +
        '<span class="x">' + esc(e.task) + '<br><small class="muted">' + esc(pn) + (e.ticket ? ' · ' + esc(e.ticket) : '') + ' · ' + fmtH(e.duration_minutes) + '</small></span>' +
        '<button class="ico" data-del="' + e.id + '" aria-label="Eliminar" title="Eliminar">×</button></li>';
    }).join('') || '<li class="muted">Sin entradas este día</li>';
    var last = st.entries[st.entries.length - 1];
    if (last) { $('mStart').value = hm(last.end_time); }
  }
  $('list').onclick = async function (e) {
    var id = e.target.getAttribute('data-del');
    if (!id || !(await askConfirm('Eliminar entrada', '¿Seguro que quieres eliminarla?', 'Eliminar'))) return;
    var r = await sb.from('time_entries').delete().eq('id', id);
    if (r.error) return err(r.error);
    loadDay();
  };
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
    var f = function () { var s = Math.max(0, Math.floor((Date.now() - new Date(st.timer.started_at)) / 1000)); $('tClock').textContent = pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60); };
    f(); st.tick = setInterval(f, 1000);
  }
  $('tStart').onclick = async function () {
    var task = $('tTask').value.trim();
    if (!task) return toast('Escribe qué vas a hacer');
    var r = await sb.from('active_timer').insert({ project_id: $('tProj').value, task: task }).select().single();
    if (r.error) return err(r.error);
    $('tTask').value = ''; st.timer = r.data; renderTimer();
  };
  function r15(m) { return Math.round(m / 15) * 15; }
  $('tStop').onclick = async function () {
    var t = st.timer, a = new Date(t.started_at), b = new Date();
    var sm = r15(a.getHours() * 60 + a.getMinutes()), em = r15(b.getHours() * 60 + b.getMinutes());
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
      await loadBase(); loadDay();
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

  document.querySelector('.tabs').onclick = function (e) {
    var b = e.target.closest('button'); if (!b) return;
    document.querySelectorAll('.tabs button').forEach(function (x) { x.classList.toggle('on', x === b); });
    document.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('on', x.id === 'tab-' + b.dataset.tab); });
    scrollTo(0, 0);
  };

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
  sb.auth.getSession().then(function (r) { if (!r.data.session) boot(null); });
})();

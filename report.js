/* Bitácora HH · informes, gráficos y Excel. Funciona en el navegador y en Node (pruebas). */
(function (root) {
  'use strict';
  var PAL = ['#6366f1', '#14b8a6', '#f59e0b', '#ec4899', '#38bdf8', '#84cc16', '#f97316', '#a78bfa'];
  function pad(n) { return String(n).padStart(2, '0'); }
  function hm(t) { return String(t).slice(0, 5); }
  function mm(t) { var p = hm(t).split(':'); return +p[0] * 60 + +p[1]; }
  function fh(m) { return (m / 60).toFixed(2).replace('.', ',') + ' h'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // rows: {entry_date,start_time,end_time,duration_minutes,task,ticket,ticket_status,imputable,project,client}
  function stats(rows, goalDay) {
    var byDay = {}, byProj = {}, byWeek = {}, imp = 0, int = 0, best = null;
    rows.forEach(function (e) {
      var d = byDay[e.entry_date] || (byDay[e.entry_date] = { imp: 0, int: 0 });
      if (e.imputable) { d.imp += e.duration_minutes; imp += e.duration_minutes; var k = e.project || '—'; byProj[k] = (byProj[k] || 0) + e.duration_minutes; }
      else { d.int += e.duration_minutes; int += e.duration_minutes; }
    });
    var days = Object.keys(byDay).sort();
    days.forEach(function (d) {
      var dt = new Date(d + 'T12:00:00'), dow = (dt.getDay() + 6) % 7; dt.setDate(dt.getDate() - dow);
      var wk = dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
      byWeek[wk] = (byWeek[wk] || 0) + byDay[d].imp;
      if (!best || byDay[d].imp > byDay[best].imp) best = d;
    });
    var okDays = days.filter(function (d) { var m = byDay[d].imp; return m >= goalDay - 60 && m <= goalDay; }).length;
    return { imp: imp, int: int, days: days, byDay: byDay, byProj: byProj, byWeek: byWeek, n: rows.length, best: best,
      avg: days.length ? imp / days.length : 0, okDays: okDays, compliance: days.length ? imp / (days.length * goalDay) : 0 };
  }

  function chartDays(S, goalDay) {
    if (!S.days.length) return '<p class="muted">Sin datos este mes</p>';
    var W = 340, H = 150, pl = 8, pb = 18, pt = 8, n = S.days.length, bw = Math.min(22, (W - pl * 2) / n - 4);
    var max = Math.max(goalDay, Math.max.apply(null, S.days.map(function (d) { return S.byDay[d].imp + S.byDay[d].int; }))), sc = (H - pb - pt) / max;
    var out = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" role="img" aria-label="Horas por día">';
    var gy = H - pb - goalDay * sc;
    out += '<line x1="0" x2="' + W + '" y1="' + gy + '" y2="' + gy + '" stroke="var(--mut)" stroke-dasharray="3 3" opacity=".6"/>';
    S.days.forEach(function (d, i) {
      var x = pl + (i + .5) * (W - pl * 2) / n - bw / 2, a = S.byDay[d].imp * sc, b = S.byDay[d].int * sc, y = H - pb - a;
      out += '<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + a + '" rx="3" fill="var(--ac)"><title>' + d + ' · ' + fh(S.byDay[d].imp) + '</title></rect>';
      if (b > 0) out += '<rect x="' + x + '" y="' + (y - b) + '" width="' + bw + '" height="' + b + '" rx="3" fill="#f59e0b" opacity=".75"><title>' + d + ' internas · ' + fh(S.byDay[d].int) + '</title></rect>';
      out += '<text x="' + (x + bw / 2) + '" y="' + (H - 4) + '" text-anchor="middle" font-size="9" fill="var(--mut)">' + d.slice(8) + '</text>';
    });
    return out + '</svg><p class="legend"><i style="background:var(--ac)"></i>Imputable <i style="background:#f59e0b"></i>Interna <span>· línea punteada = meta ' + fh(goalDay) + '</span></p>';
  }

  function chartDonut(S) {
    var ks = Object.keys(S.byProj).sort(function (a, b) { return S.byProj[b] - S.byProj[a]; });
    if (!ks.length) return '<p class="muted">Sin datos este mes</p>';
    var R = 42, C = 2 * Math.PI * R, off = 0, out = '<div class="donut"><svg viewBox="0 0 120 120" role="img" aria-label="Horas por proyecto"><g transform="rotate(-90 60 60)">';
    ks.forEach(function (k, i) {
      var len = S.byProj[k] / S.imp * C;
      out += '<circle cx="60" cy="60" r="' + R + '" fill="none" stroke="' + PAL[i % PAL.length] + '" stroke-width="16" stroke-dasharray="' + len + ' ' + (C - len) + '" stroke-dashoffset="' + (-off) + '"><title>' + esc(k) + ' · ' + fh(S.byProj[k]) + '</title></circle>';
      off += len;
    });
    out += '</g><text x="60" y="58" text-anchor="middle" font-size="15" font-weight="700" fill="var(--fg)">' + (S.imp / 60).toFixed(1).replace('.', ',') + '</text><text x="60" y="72" text-anchor="middle" font-size="8" fill="var(--mut)">h imputables</text></svg><ul class="leg">';
    ks.forEach(function (k, i) { out += '<li><i style="background:' + PAL[i % PAL.length] + '"></i><span>' + esc(k) + '</span><b>' + fh(S.byProj[k]) + '</b> <small>' + Math.round(S.byProj[k] / S.imp * 100) + '%</small></li>'; });
    return out + '</ul></div>';
  }

  function chartWeeks(S, goalWeek) {
    var ks = Object.keys(S.byWeek).sort();
    if (!ks.length) return '<p class="muted">Sin datos este mes</p>';
    var max = Math.max(goalWeek, Math.max.apply(null, ks.map(function (k) { return S.byWeek[k]; })));
    return '<div class="hbars">' + ks.map(function (k) {
      var v = S.byWeek[k];
      return '<div class="hb"><span>Sem ' + k.slice(8) + '/' + k.slice(5, 7) + '</span><div class="track"><i style="width:' + (v / max * 100) + '%"></i><u style="left:' + (goalWeek / max * 100) + '%"></u></div><b>' + fh(v) + '</b></div>';
    }).join('') + '</div>';
  }

  /* ===== Excel ===== */
  var HEAD = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '4F46E5' } }, alignment: { vertical: 'center' } };
  function dateCell(s, f) { var p = s.split('-'); return { t: 'n', v: Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000 + 25569, z: f || 'dd-mm-yyyy' }; }
  function timeCell(t, f) { return { t: 'n', v: mm(t) / 1440, z: f || 'h:mm' }; }
  function durCell(min) { return { t: 'n', v: min / 1440, z: '[h]:mm:ss' }; }
  function sheet(X, rows, widths, headStyle) {
    var ws = X.utils.aoa_to_sheet(rows);
    ws['!cols'] = widths.map(function (w) { return { wch: w }; });
    if (headStyle) for (var c = 0; c < rows[0].length; c++) { var a = X.utils.encode_cell({ r: 0, c: c }); if (ws[a]) ws[a].s = headStyle; }
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    ws['!autofilter'] = { ref: X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: rows[0].length - 1 } }) };
    return ws;
  }

  // Formato de tu jefe: hojas "resumen" y "detalle" (solo horas imputables)
  function bossWorkbook(X, rows, ym) {
    var imp = rows.filter(function (e) { return e.imputable; }).sort(function (a, b) { return (a.entry_date + hm(a.start_time)) < (b.entry_date + hm(b.start_time)) ? -1 : 1; });
    var det = [['fecha', 'cliente', 'proyecto', 'tarea', 'concat', 'ticket', 'inicio', 'fin', 'total_hh']];
    imp.forEach(function (e) {
      det.push([dateCell(e.entry_date, 'mm-dd-yy'), e.client || '', e.project, e.task, e.project + ' | ' + e.task, e.ticket || '', timeCell(e.start_time, 'h:mm:ss'), timeCell(e.end_time, 'h:mm:ss'), durCell(e.duration_minutes)]);
    });
    var agg = {}, order = [];
    imp.forEach(function (e) {
      var k = e.entry_date + '|' + e.project + '|' + e.task;
      if (!agg[k]) { agg[k] = { e: e, min: 0, ticket: e.ticket || '', st: e.ticket_status || '' }; order.push(k); }
      agg[k].min += e.duration_minutes;
    });
    var res = [['mes', 'inicio', 'cliente', 'proyecto', 'tarea', 'total_hh', 'concat', 'ticket', 'estado_ticket']];
    order.forEach(function (k) {
      var a = agg[k], e = a.e;
      res.push([e.entry_date.slice(0, 7), dateCell(e.entry_date, 'mm-dd-yy'), e.client || '', e.project, e.task, durCell(a.min), e.project + ' | ' + e.task, a.ticket, a.st]);
    });
    var wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, sheet(X, res, [10, 12, 14, 26, 60, 11, 70, 12, 14], HEAD), 'resumen');
    X.utils.book_append_sheet(wb, sheet(X, det, [12, 14, 26, 60, 70, 12, 10, 10, 11], HEAD), 'detalle');
    return wb;
  }

  // Excel personal: detalle completo (con internas), resumen por día y resumen por proyecto/tarea
  function personalWorkbook(X, rows, goalDay) {
    var sorted = rows.slice().sort(function (a, b) { return (a.entry_date + hm(a.start_time)) < (b.entry_date + hm(b.start_time)) ? -1 : 1; });
    var det = [['Fecha', 'Cliente', 'Proyecto', 'Tarea', 'Ticket', 'Inicio', 'Fin', 'Horas', 'Tipo']];
    sorted.forEach(function (e) {
      det.push([dateCell(e.entry_date), e.client || '', e.project, e.task, e.ticket || '', timeCell(e.start_time), timeCell(e.end_time), { t: 'n', v: e.duration_minutes / 60, z: '0.00' }, e.imputable ? 'Imputable' : 'Interna']);
    });
    var S = stats(rows, goalDay), day = [['Fecha', 'Imputable (h)', 'Interna (h)', 'Total (h)', 'Meta (h)', 'Diferencia (h)', 'Estado']];
    S.days.forEach(function (d) {
      var i = S.byDay[d].imp / 60, n = S.byDay[d].int / 60, g = goalDay / 60;
      day.push([dateCell(d), { t: 'n', v: i, z: '0.00' }, { t: 'n', v: n, z: '0.00' }, { t: 'n', v: i + n, z: '0.00' }, { t: 'n', v: g, z: '0.00' }, { t: 'n', v: i - g, z: '+0.00;-0.00;0.00' }, i > g ? 'Sobre la meta' : (i >= g - 1 ? 'Cuadra' : 'Bajo la meta')]);
    });
    day.push(['Total', { t: 'n', v: S.imp / 60, z: '0.00' }, { t: 'n', v: S.int / 60, z: '0.00' }, { t: 'n', v: (S.imp + S.int) / 60, z: '0.00' }, '', '', '']);
    var pt = {}, po = [];
    rows.filter(function (e) { return e.imputable; }).forEach(function (e) { var k = e.project + '|' + e.task; if (!pt[k]) { pt[k] = { p: e.project, t: e.task, m: 0 }; po.push(k); } pt[k].m += e.duration_minutes; });
    po.sort(function (a, b) { return pt[a].p === pt[b].p ? pt[b].m - pt[a].m : (pt[a].p < pt[b].p ? -1 : 1); });
    var res = [['Proyecto', 'Tarea', 'Horas', '% del total']];
    po.forEach(function (k) { res.push([pt[k].p, pt[k].t, { t: 'n', v: pt[k].m / 60, z: '0.00' }, { t: 'n', v: S.imp ? pt[k].m / S.imp : 0, z: '0.0%' }]); });
    res.push(['Total imputable', '', { t: 'n', v: S.imp / 60, z: '0.00' }, { t: 'n', v: 1, z: '0.0%' }]);
    var wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, sheet(X, det, [12, 14, 26, 60, 12, 8, 8, 8, 11], HEAD), 'Detalle');
    X.utils.book_append_sheet(wb, sheet(X, day, [12, 14, 12, 11, 10, 14, 15], HEAD), 'Resumen por día');
    X.utils.book_append_sheet(wb, sheet(X, res, [26, 70, 9, 11], HEAD), 'Resumen');
    return wb;
  }


  /* ===== Tablas para ver en pantalla (mismas hojas que los Excel) ===== */
  var DOW = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  function dmy(d) { var p = d.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function sortRows(rows) { return rows.slice().sort(function (a, b) { return (a.entry_date + hm(a.start_time)) < (b.entry_date + hm(b.start_time)) ? -1 : 1; }); }
  function hrs(m) { return (m / 60).toFixed(2).replace('.', ','); }
  var FILES = {
    boss: { label: 'Formato jefe (HH)', sheets: { resumen: 'resumen', detalle: 'detalle' } },
    personal: { label: 'Personal', sheets: { detalle: 'Detalle', dia: 'Resumen por día', resumen: 'Resumen' } }
  };
  function table(file, sheet, rows, goalDay) {
    var out = { cols: [], rows: [], total: null }, i;
    if (file === 'boss') {
      var imp = sortRows(rows.filter(function (e) { return e.imputable; })), tot = 0;
      if (sheet === 'detalle') {
        out.cols = ['fecha', 'cliente', 'proyecto', 'tarea', 'ticket', 'inicio', 'fin', 'total_hh'];
        imp.forEach(function (e) { tot += e.duration_minutes; out.rows.push([dmy(e.entry_date), e.client || '', e.project, e.task, e.ticket || '', hm(e.start_time), hm(e.end_time), hrs(e.duration_minutes)]); });
      } else {
        out.cols = ['mes', 'inicio', 'cliente', 'proyecto', 'tarea', 'total_hh', 'ticket', 'estado_ticket'];
        var agg = {}, ord = [];
        imp.forEach(function (e) { var k = e.entry_date + '|' + e.project + '|' + e.task; if (!agg[k]) { agg[k] = { e: e, m: 0 }; ord.push(k); } agg[k].m += e.duration_minutes; });
        ord.forEach(function (k) { var a = agg[k], e = a.e; tot += a.m; out.rows.push([e.entry_date.slice(0, 7), dmy(e.entry_date), e.client || '', e.project, e.task, hrs(a.m), e.ticket || '', e.ticket_status || '']); });
      }
      out.total = { label: 'Total imputable', value: hrs(tot) + ' h', col: out.cols.length - (sheet === 'detalle' ? 1 : 3) };
      return out;
    }
    if (sheet === 'detalle') {
      out.cols = ['Fecha', 'Cliente', 'Proyecto', 'Tarea', 'Ticket', 'Inicio', 'Fin', 'Horas', 'Tipo'];
      var t = 0; sortRows(rows).forEach(function (e) { t += e.duration_minutes; out.rows.push([dmy(e.entry_date), e.client || '', e.project, e.task, e.ticket || '', hm(e.start_time), hm(e.end_time), hrs(e.duration_minutes), e.imputable ? 'Imputable' : 'Interna']); });
      out.total = { label: 'Total (incluye internas)', value: hrs(t) + ' h', col: 7 };
    } else if (sheet === 'dia') {
      out.cols = ['Fecha', 'Imputable (h)', 'Interna (h)', 'Total (h)', 'Meta (h)', 'Dif. (h)', 'Estado'];
      var S = stats(rows, goalDay), g = goalDay / 60;
      S.days.forEach(function (d) { var a = S.byDay[d].imp / 60, n = S.byDay[d].int / 60, dt = new Date(d + 'T12:00:00'); out.rows.push([DOW[dt.getDay()] + ' ' + dmy(d), a.toFixed(2).replace('.', ','), n.toFixed(2).replace('.', ','), (a + n).toFixed(2).replace('.', ','), g.toFixed(2).replace('.', ','), (a - g >= 0 ? '+' : '') + (a - g).toFixed(2).replace('.', ','), a > g ? 'Sobre la meta' : (a >= g - 1 ? 'Cuadra' : 'Bajo la meta')]); });
      out.total = { label: 'Total imputable', value: hrs(S.imp) + ' h', col: 1 };
    } else {
      out.cols = ['Proyecto', 'Tarea', 'Horas', '% del total'];
      var pt = {}, po = [], T = 0;
      rows.filter(function (e) { return e.imputable; }).forEach(function (e) { var k = e.project + '|' + e.task; if (!pt[k]) { pt[k] = { p: e.project, t: e.task, m: 0 }; po.push(k); } pt[k].m += e.duration_minutes; T += e.duration_minutes; });
      po.sort(function (a, b) { return pt[a].p === pt[b].p ? pt[b].m - pt[a].m : (pt[a].p < pt[b].p ? -1 : 1); });
      po.forEach(function (k) { out.rows.push([pt[k].p, pt[k].t, hrs(pt[k].m), (T ? Math.round(pt[k].m / T * 1000) / 10 : 0).toString().replace('.', ',') + '%']); });
      out.total = { label: 'Total imputable', value: hrs(T) + ' h', col: 2 };
    }
    return out;
  }
  // Libro con una sola hoja (o todas) a partir de los mismos constructores
  function workbook(X, file, sheet, rows, goalDay) {
    var wb = file === 'boss' ? bossWorkbook(X, rows) : personalWorkbook(X, rows, goalDay);
    if (sheet && sheet !== 'todas') {
      var name = FILES[file].sheets[sheet];
      wb.SheetNames.filter(function (n) { return n !== name; }).forEach(function (n) { delete wb.Sheets[n]; });
      wb.SheetNames = [name];
    }
    return wb;
  }

  var api = { FILES: FILES, table: table, workbook: workbook, stats: stats, chartDays: chartDays, chartDonut: chartDonut, chartWeeks: chartWeeks, bossWorkbook: bossWorkbook, personalWorkbook: personalWorkbook, fh: fh };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BHHReport = api;
})(typeof window !== 'undefined' ? window : globalThis);

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ setup: true, answer: "Falta configurar la clave del asistente (secreto ANTHROPIC_API_KEY en Supabase)." });

  const auth = req.headers.get("Authorization") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return json({ error: "No autorizado" }, 401);

  let body: { question?: string; history?: { role: string; content: string }[] };
  try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }
  const q = String(body.question ?? "").trim().slice(0, 1000);
  if (!q) return json({ error: "Falta la pregunta" }, 400);

  const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
  const { data: rows } = await sb.from("time_entries")
    .select("entry_date,start_time,end_time,duration_minutes,task,ticket,imputable,category,projects(name,clients(name))")
    .gte("entry_date", since).order("entry_date").order("start_time").limit(800);
  const ctx = (rows ?? []).map((e: any) =>
    `${e.entry_date} ${String(e.start_time).slice(0, 5)}-${String(e.end_time).slice(0, 5)} ${(e.duration_minutes / 60).toFixed(2)}h ${e.imputable ? "IMPUTABLE" : "interna"} | ${e.projects?.clients?.name ?? "-"} / ${e.projects?.name ?? "-"} | ${e.task}${e.ticket ? " | ticket " + e.ticket : ""}`
  ).join("\n");

  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
  const system = `Eres el asistente de Bitácora HH, la app de horas de Jesús (consultor de CP Soluciones que factura horas a Masisa). Responde en español, corto y directo, con pasos numerados si corresponde.
Reglas de su jornada: horario 9:00–18:30; almuerzo 14:00–15:00; daily 9:30–10:00 (no se imputa a Masisa pero cuenta en el día); la actualización de horas en el TMS no se imputa a Masisa; máximo imputable 8,00 h por día (en la práctica 7,50–7,75); el TMS acepta múltiplos de 0,25 h.
Para redactar comentarios del TMS: no menciones Jira, auditoría, informe de RRHH ni Tableau; no uses la palabra "levantamiento" (usa "revisión y comprensión"); di "Data Studio" para el dashboard.
Hoy es ${hoy}. Usa SOLO los registros de abajo; si no hay datos, dilo. No inventes horas ni tickets. Haz las sumas con cuidado.
REGISTROS (últimos 90 días):
${ctx || "(sin registros)"}`;

  const msgs = (body.history ?? []).slice(-6).filter((m) => (m.role === "user" || m.role === "assistant") && m.content)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 2000) }));
  msgs.push({ role: "user", content: q });

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-5-5", max_tokens: 1200, system, messages: msgs }),
  });
  const d = await r.json();
  if (!r.ok) return json({ error: d?.error?.message ?? "Error del asistente" }, 502);
  return json({ answer: (d.content ?? []).map((c: any) => c.text ?? "").join("").trim() });
});

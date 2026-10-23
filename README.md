# Bitácora HH
PWA para registrar horas y actividades. Frontend estático (HTML/CSS/JS) + Supabase (Auth, Postgres con RLS) + GitHub Pages.

- App: https://hernandezjxs-alt.github.io/bitacora-hh/
- SQL: `supabase/migrations/`
- Semilla: `seed/semilla_horas_oct2026.csv` (83,25 h imputables, 6,25 h internas)
- `config.js` solo lleva la clave *publishable*.

## Supabase → Authentication → URL Configuration
Site URL: `https://hernandezjxs-alt.github.io/bitacora-hh/` · Redirect URLs: la misma con `/**`.

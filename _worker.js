// Advanced mode de Cloudflare Pages: /api/testers + resto de la web estática
const ALLOWED_APPS = ["turismo-japon", "retro-rockets", "pasalibro", "europe-dominion"];
const EMAIL_RE = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[A-Za-z]{2,}$/;
const MAX_PER_HOUR = 5;

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function redirect(origin, path) {
  return new Response(null, { status: 303, headers: { Location: new URL(path, origin).toString(), "Cache-Control": "no-store" } });
}

function errorPage(message) {
  const body = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Revisa el formulario · Go4FunnyLife</title><link rel="stylesheet" href="/assets/g4fl.v1.css"></head><body><main class="center-page"><div class="wrap narrow stack" style="gap:24px"><p class="eyebrow">Programa de testers</p><h1 class="h2">Falta un detalle.</h1><p class="lead">${message}</p><div class="actions"><a class="btn btn-ink btn-shadow" href="/testers/">Volver al formulario</a></div></div></main></body></html>`;
  return new Response(body, { status: 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

async function handleTesters(request, env) {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  const origin = new URL(request.url).origin;
  let form;
  try { form = await request.formData(); } catch { return errorPage("No hemos podido leer el formulario. Inténtalo de nuevo."); }

  // Trampa para bots: un humano nunca rellena este campo
  if ((form.get("website") || "").toString().trim() !== "") return redirect(origin, "/testers/gracias/");

  const email = (form.get("email") || "").toString().trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) return errorPage("El correo no parece válido. Usa el de tu cuenta de Google.");
  if ((form.get("consent") || "").toString() !== "si") return errorPage("Necesitamos tu consentimiento para guardar el correo y enviarte la invitación.");

  const apps = [...new Set(form.getAll("apps").map(String).filter(a => ALLOWED_APPS.includes(a)))];
  const list = (apps.length ? apps : ALLOWED_APPS).join(",");   // sin marcar = cualquiera

  const ip = request.headers.get("CF-Connecting-IP") || "";
  const ipHash = ip ? await sha256(ip + (env.IP_SALT || "g4fl")) : null;
  const now = new Date().toISOString();

  if (ipHash) {
    const since = new Date(Date.now() - 3600_000).toISOString();
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM testers WHERE ip_hash = ?1 AND updated_at > ?2").bind(ipHash, since).first();
    if (row && row.n >= MAX_PER_HOUR) return errorPage("Hemos recibido muchas altas seguidas desde tu conexión. Prueba de nuevo dentro de un rato.");
  }

  await env.DB.prepare(
    `INSERT INTO testers (email, apps, consent_at, updated_at, ip_hash) VALUES (?1, ?2, ?3, ?3, ?4)
     ON CONFLICT(email) DO UPDATE SET apps = excluded.apps, updated_at = excluded.updated_at, ip_hash = excluded.ip_hash`
  ).bind(email, list, now, ipHash).run();

  return redirect(origin, "/testers/gracias/");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/testers") return handleTesters(request, env);
    return env.ASSETS.fetch(request);
  }
};

/* Jedyne miejsce z adresem Cloudflare Workera pośredniczącego w dostępie
   do prywatnych danych CSV. Zmień tu, jeśli Worker zmieni adres/domenę.
   UWAGA: dokładny subdomain *.workers.dev zależy od konta Cloudflare —
   zostanie zweryfikowany i w razie potrzeby poprawiony po `wrangler deploy`. */
export const WORKER_BASE = 'https://ferro-dashboard-proxy.karwan87.workers.dev';
export const DATA_BASE = `${WORKER_BASE}/data/`;

/* Jedyne miejsce z adresem Cloudflare Workera pośredniczącego w dostępie
   do prywatnych danych CSV. Zmień tu, jeśli Worker zmieni adres/domenę. */
export const WORKER_BASE = 'https://ferro-dashboard-proxy.damianuszynski.workers.dev';
export const DATA_BASE = `${WORKER_BASE}/data/`;

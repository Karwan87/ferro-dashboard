import { getDeliveredQtySince } from './deliveriesData.js';

/* ETAP 1 (frontend-only): stan koszyka/zamówień trzymany lokalnie w
   przeglądarce (localStorage). ŚWIADOME OGRANICZENIE — nie synchronizuje się
   między urządzeniami ani między czwórką użytkowników. To celowo tymczasowe,
   do sprawdzenia logiki UI/przepływu, zanim to samo przeniesie się na
   wspólny backend (Worker + baza), gdzie każdy zobaczy akcje pozostałych. */
const STORAGE_KEY = 'ferro_order_cart_v1';

function load(){
  try{ return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch(e){ return {}; }
}
// Powiadamia zainteresowane moduły (koszyk w topbarze, tabela "Do zamówienia",
// przycisk w modalu produktu) o zmianie stanu — bez zależności cyklicznych
// między nimi, tak samo jak core/data.js robi to zdarzeniem 'ferro:data-loaded'.
function save(state){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  document.dispatchEvent(new CustomEvent('ferro:cart-changed'));
}

function isoToday(){
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function record(state, id){
  return state[id] || { listedQty: 0, orderedQty: 0, orderedAt: null };
}

export function getOrderState(id){
  return record(load(), id);
}

/* "ZAMÓW" na wierszu tabeli / w modalu produktu — dokłada sztuki do koszyka
   (status "na liście do zamówienia"). Wielokrotne kliknięcie tego samego
   produktu sumuje ilość, nie nadpisuje. */
export function addToCart(id, qty){
  if(!(qty > 0)) return;
  const state = load();
  const r = record(state, id);
  r.listedQty += qty;
  state[id] = r;
  save(state);
}

export function removeFromCart(id){
  const state = load();
  const r = state[id];
  if(!r) return;
  r.listedQty = 0;
  if(r.orderedQty === 0) delete state[id];
  save(state);
}

export function getCartItems(){
  const state = load();
  return Object.entries(state)
    .filter(([, r]) => r.listedQty > 0)
    .map(([id, r]) => ({ id: Number(id), qty: r.listedQty }));
}

export function getCartCount(){
  return getCartItems().length;
}

/* Koszyk -> "Zamówione". Jeśli produkt ma już otwarte (niedostarczone)
   zamówienie z wcześniejszej tury, ilości SUMUJĄ SIĘ, a data zamówienia
   zostaje ta najwcześniejsza — żeby wykrywanie dostawy uwzględniało też
   wcześniejszą turę (potwierdzone: "nasłuch... powinien sumować się do
   zamówionej np. w dwóch turach liczby sztuk"). */
export function markOrdered(ids){
  const state = load();
  const today = isoToday();
  ids.forEach(id => {
    const r = record(state, id);
    if(r.listedQty <= 0) return;
    r.orderedQty += r.listedQty;
    r.listedQty = 0;
    if(!r.orderedAt) r.orderedAt = today;
    state[id] = r;
  });
  save(state);
}

export function getOrderedItems(){
  const state = load();
  return Object.entries(state)
    .filter(([, r]) => r.orderedQty > 0)
    .map(([id, r]) => ({ id: Number(id), qty: r.orderedQty, orderedAt: r.orderedAt }));
}

/* Ręczne usunięcie z listy "Zamówione" (np. po dostarczeniu, żeby nie
   zaśmiecało tabeli) — kasuje cały rekord zamówienia dla produktów. Zawsze
   jeden save() na całą paczkę (nie per produkt) — inaczej wielokrotne
   zdarzenie 'ferro:cart-changed' odpalało kilka nakładających się async
   renderów naraz, z których "wygrywał" ten, który akurat najdłużej czekał
   na dane o dostawach, czasem pokazując nieaktualny stan sprzed usunięcia. */
export function removeOrderRecords(ids){
  const state = load();
  ids.forEach(id => { delete state[id]; });
  save(state);
}

/* Status widoczny w kolumnie "Akcje"/"Status" głównej tabeli — bez sprawdzania
   dostaw (to osobne, async, patrz getDeliveryProgress), więc szybkie i
   synchroniczne do renderu tabeli ze wszystkimi produktami naraz. */
export function getProductCartStatus(id){
  const r = getOrderState(id);
  if(r.listedQty > 0) return 'listed';
  if(r.orderedQty > 0) return 'ordered';
  return 'none';
}

/* Postęp realizacji zamówienia — ile z zamówionych sztuk już przyszło w
   dostawach PO dacie zamówienia (włącznie). Reguła: dostarczono >= zamówiono
   (dla zamówienia 1 szt. wystarczy 1 szt. w dostawie — to nie jest osobny
   przypadek, tylko naturalny wynik tej samej nierówności). */
export async function getDeliveryProgress(id){
  const r = getOrderState(id);
  if(r.orderedQty <= 0) return null;
  const deliveredQty = await getDeliveredQtySince(id, new Date(r.orderedAt));
  return {
    orderedQty: r.orderedQty,
    deliveredQty,
    orderedAt: r.orderedAt,
    isComplete: deliveredQty >= r.orderedQty,
  };
}

import { getDeliveredQtySince } from './deliveriesData.js';
import { authedFetchJson } from './csv.js';
import { WORKER_BASE } from './config.js';

/* ETAP 2: stan koszyka/zamówień żyje we wspólnej bazie (Cloudflare D1, przez
   Worker) — widoczny natychmiast dla wszystkich 4 kont, nie tylko lokalnie
   w jednej przeglądarce (ETAP 1). Trzymamy tu lokalną KOPIĘ (cache) ostatnio
   pobranego stanu, żeby odczyty (getOrderState, getProductCartStatus,
   getCartItems...) mogły zostać synchroniczne — reszta apki (reorder.js,
   cart.js, modal.js) i tak już działa w oparciu wyłącznie o zdarzenie
   'ferro:cart-changed', nie o wartość zwracaną z akcji, więc te funkcje
   mogły zostać async (zapis w tle) bez zmiany jednego wiersza kodu wołającego. */
const CART_URL = `${WORKER_BASE}/cart`;

let state = {};

function setState(newState){
  state = newState || {};
  document.dispatchEvent(new CustomEvent('ferro:cart-changed'));
}

/* Ładowane przy każdym 'ferro:data-loaded' (patrz dół pliku) — czyli po
   zalogowaniu i po każdym ręcznym odświeżeniu, tak jak reszta danych. */
export async function loadCartState(){
  try{
    setState(await authedFetchJson(CART_URL));
  } catch(e){
    // Błąd sieci przy koszyku nie blokuje reszty apki — poprzedni stan
    // (albo pusty na starcie) zostaje, kolejna akcja i tak spróbuje ponownie.
  }
}

function record(id){
  return state[id] || { listedQty: 0, orderedQty: 0, orderedAt: null, deliveredDetectedAt: null };
}

export function getOrderState(id){
  return record(id);
}

/* "ZAMÓW" na wierszu tabeli / w modalu produktu — dokłada sztuki do koszyka
   (status "na liście do zamówienia"). Wielokrotne kliknięcie tego samego
   produktu sumuje ilość, nie nadpisuje (patrz Worker: /cart/add). */
export async function addToCart(id, qty){
  if(!(qty > 0)) return;
  try{ setState(await authedFetchJson(`${CART_URL}/add`, { method: 'POST', body: JSON.stringify({ productId: id, qty }) })); }
  catch(e){ /* patrz loadCartState — błąd sieci nie blokuje UI */ }
}

export async function removeFromCart(id){
  try{ setState(await authedFetchJson(`${CART_URL}/remove`, { method: 'POST', body: JSON.stringify({ productId: id }) })); }
  catch(e){ /* jw. */ }
}

export function getCartItems(){
  return Object.entries(state)
    .filter(([, r]) => r.listedQty > 0)
    .map(([id, r]) => ({ id: Number(id), qty: r.listedQty }));
}

export function getCartCount(){
  return getCartItems().length;
}

/* Koszyk -> "Zamówione". Jeśli produkt ma już otwarte (niedostarczone)
   zamówienie z wcześniejszej tury, ilości SUMUJĄ SIĘ, a data zamówienia
   zostaje ta najwcześniejsza (patrz Worker: /cart/mark-ordered). */
export async function markOrdered(ids){
  try{ setState(await authedFetchJson(`${CART_URL}/mark-ordered`, { method: 'POST', body: JSON.stringify({ productIds: ids }) })); }
  catch(e){ /* jw. */ }
}

export function getOrderedItems(){
  return Object.entries(state)
    .filter(([, r]) => r.orderedQty > 0)
    .map(([id, r]) => ({ id: Number(id), qty: r.orderedQty, orderedAt: r.orderedAt }));
}

/* Ręczne usunięcie z listy "Zamówione" (np. po dostarczeniu, żeby nie
   zaśmiecało tabeli) — zawsze jedna paczka (jedno wywołanie Workera na całe
   zaznaczenie), nie pojedyncze usunięcia w pętli — to samo uzasadnienie co
   dawne removeOrderRecords: unikamy nakładających się async renderów. */
export async function removeOrderRecords(ids){
  try{ setState(await authedFetchJson(`${CART_URL}/remove-orders`, { method: 'POST', body: JSON.stringify({ productIds: ids }) })); }
  catch(e){ /* jw. */ }
}

/* Status widoczny w kolumnie "Akcje"/"Status" głównej tabeli — bez sprawdzania
   dostaw (to osobne, async, patrz getDeliveryProgress), więc szybkie i
   synchroniczne do renderu tabeli ze wszystkimi produktami naraz. */
export function getProductCartStatus(id){
  const r = record(id);
  if(r.listedQty > 0) return 'listed';
  if(r.orderedQty > 0) return 'ordered';
  return 'none';
}

/* Wołane automatycznie (patrz getDeliveryProgress), gdy nasłuch dostaw
   pierwszy raz wykryje pełną realizację — zapisuje moment wykrycia w D1
   (idempotentnie, patrz Worker: /cart/mark-delivered). Dzięki temu badge
   "dostarczono" żyje do końca TEGO dnia (widoczne dla każdego, nie tylko
   w tej przeglądarce), a następnego dnia Worker sam kasuje wiersz przy
   pierwszym GET /cart — bez potrzeby crona. */
async function markDelivered(id){
  try{ setState(await authedFetchJson(`${CART_URL}/mark-delivered`, { method: 'POST', body: JSON.stringify({ productId: id }) })); }
  catch(e){ /* patrz loadCartState — błąd sieci nie blokuje UI, spróbuje przy kolejnym renderze */ }
}

/* Postęp realizacji zamówienia — ile z zamówionych sztuk już przyszło w
   dostawach PO dacie zamówienia (włącznie). Reguła: dostarczono >= zamówiono
   (dla zamówienia 1 szt. wystarczy 1 szt. w dostawie — to nie jest osobny
   przypadek, tylko naturalny wynik tej samej nierówności). */
export async function getDeliveryProgress(id){
  const r = record(id);
  if(r.orderedQty <= 0) return null;
  const deliveredQty = await getDeliveredQtySince(id, new Date(r.orderedAt));
  const isComplete = deliveredQty >= r.orderedQty;
  // Zapisujemy wykrycie tylko RAZ (dopóki nie jest jeszcze zapisane w D1) —
  // bez tego warunku każdy render tabeli odpalałby zapis od nowa.
  if(isComplete && !r.deliveredDetectedAt) markDelivered(id);
  return {
    orderedQty: r.orderedQty,
    deliveredQty,
    orderedAt: r.orderedAt,
    isComplete,
    deliveredDetectedAt: r.deliveredDetectedAt,
  };
}

document.addEventListener('ferro:data-loaded', loadCartState);

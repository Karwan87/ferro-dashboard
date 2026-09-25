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
  return state[id] || { listedQty: 0, pendingQty: 0, pendingBy: null, pendingConfirmed: false, orderedQty: 0, orderedAt: null, deliveredDetectedAt: null };
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

/* Ustawienie ilości WPROST (nie dodanie do istniejącej) — licznik +/- w
   tabeli koszyka potrzebuje umieć też ZMNIEJSZYĆ, czego addToCart (zawsze
   dokłada) nie robi. qty<=0 usuwa pozycję z koszyka (patrz Worker: /cart/set-qty). */
export async function setCartQty(id, qty){
  const safeQty = Math.max(0, Math.round(qty) || 0);
  try{ setState(await authedFetchJson(`${CART_URL}/set-qty`, { method: 'POST', body: JSON.stringify({ productId: id, qty: safeQty }) })); }
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

/* Koszyk -> "Do zatwierdzenia". Ilości z listedQty PRZENOSZĄ SIĘ do
   pendingQty (sumując się z ewentualną wcześniejszą turą), a pendingBy
   (login zgłaszającego) zostaje ten PIERWSZY, COALESCE — patrz Worker:
   /cart/mark-pending. */
export async function markPending(ids){
  try{ setState(await authedFetchJson(`${CART_URL}/mark-pending`, { method: 'POST', body: JSON.stringify({ productIds: ids }) })); }
  catch(e){ /* patrz loadCartState */ }
}

/* Ustawienie ILOŚCI DO ZATWIERDZENIA wprost (licznik +/- w tabeli "Do
   zatwierdzenia") — analogicznie do setCartQty, ale na pendingQty (patrz
   Worker: /cart/set-pending-qty). qty<=0 usuwa pozycję z tego etapu. */
export async function setPendingQty(id, qty){
  const safeQty = Math.max(0, Math.round(qty) || 0);
  try{ setState(await authedFetchJson(`${CART_URL}/set-pending-qty`, { method: 'POST', body: JSON.stringify({ productId: id, qty: safeQty }) })); }
  catch(e){ /* jw. */ }
}

export function getPendingItems(){
  return Object.entries(state)
    .filter(([, r]) => r.pendingQty > 0)
    .map(([id, r]) => ({ id: Number(id), qty: r.pendingQty, pendingBy: r.pendingBy, confirmed: r.pendingConfirmed }));
}

/* Usunięcie z "Do zatwierdzenia" (✕) — bez cofania do Koszyka, zwykłe
   skasowanie pozycji z tego etapu (patrz Worker: /cart/remove-pending). */
export async function removeFromPending(id){
  try{ setState(await authedFetchJson(`${CART_URL}/remove-pending`, { method: 'POST', body: JSON.stringify({ productId: id }) })); }
  catch(e){ /* jw. */ }
}

/* Zatwierdzenie (confirmed=true, domyślnie) LUB cofnięcie zatwierdzenia
   (confirmed=false) FINALNEJ ilości w "Do zatwierdzenia". Dopóki zatwierdzone:
   setPendingQty pozwala ją już tylko zmniejszać (patrz Worker:
   handleCartSetPendingQty), a markOrdered wymaga zatwierdzenia, żeby w
   ogóle przenieść pozycję do "Zamówione" (patrz Worker: /cart/confirm-pending).
   Cofnięcie to jedyny sposób odblokowania zwiększania ilości z powrotem. */
export async function confirmPending(ids, confirmed = true){
  try{ setState(await authedFetchJson(`${CART_URL}/confirm-pending`, { method: 'POST', body: JSON.stringify({ productIds: ids, confirmed }) })); }
  catch(e){ /* jw. */ }
}

/* "Do zatwierdzenia" -> "Zamówione" (źródłem jest TERAZ pendingQty, nie
   listedQty — patrz Worker: handleCartMarkOrdered). Jeśli produkt ma już
   otwarte (niedostarczone) zamówienie z wcześniejszej tury, ilości SUMUJĄ
   SIĘ, a data zamówienia zostaje ta najwcześniejsza (patrz Worker:
   /cart/mark-ordered). */
export async function markOrdered(ids){
  try{ setState(await authedFetchJson(`${CART_URL}/mark-ordered`, { method: 'POST', body: JSON.stringify({ productIds: ids }) })); }
  catch(e){ /* jw. */ }
}

/* Zmniejszenie ILOŚCI ZAMÓWIONEJ o 1 — WYŁĄCZNIE w dół (korekta pomyłki po
   wysyłce do dostawcy). Zwiększanie idzie przez koszyk (Zamów -> Zamów
   zaznaczone), nie tędy — stąd brak odpowiednika "increase" (patrz Worker:
   /cart/decrease-ordered). */
export async function decreaseOrderedQty(id){
  try{ setState(await authedFetchJson(`${CART_URL}/decrease-ordered`, { method: 'POST', body: JSON.stringify({ productId: id }) })); }
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
   synchroniczne do renderu tabeli ze wszystkimi produktami naraz.
   Kolejność ma znaczenie: listed > pending > ordered > none — produkt
   może mieć jednocześnie np. ordered (z poprzedniej tury) i listed (nowo
   dodany), a wtedy liczy się ten "najwcześniejszy" etap w przepływie. */
export function getProductCartStatus(id){
  const r = record(id);
  if(r.listedQty > 0) return 'listed';
  if(r.pendingQty > 0) return 'pending';
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
   przypadek, tylko naturalny wynik tej samej nierówności).

   UWAGA na parsowanie daty: orderedAt to zwykły string "YYYY-MM-DD" (Worker
   liczy go w UTC). `new Date("YYYY-MM-DD")` interpretuje TAKI string jako
   północ UTC — a core/deliveriesData.js (przez format.js:parseDate) liczy
   datę dostawy jako północ czasu LOKALNEGO. W Polsce (UTC+1/+2) to dwie
   różne chwile: północ lokalna wypada WCZEŚNIEJ niż północ UTC tego samego
   dnia, więc dostawa z tego samego dnia co zamówienie zawsze przegrywała
   porównanie `d < sinceDate` i była cicho odrzucana. Budujemy więc sinceDate
   ręcznie, tym samym sposobem (lokalnie) co parseDate, żeby obie strony
   porównania liczyły "ten sam dzień" identycznie. */
export async function getDeliveryProgress(id){
  const r = record(id);
  if(r.orderedQty <= 0) return null;
  const [oy, om, od] = r.orderedAt.split('-').map(Number);
  const sinceDate = new Date(oy, om - 1, od);
  const deliveredQty = await getDeliveredQtySince(id, sinceDate);
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

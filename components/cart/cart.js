import { products } from '../../core/data.js';
import { pushModalState, requestModalClose } from '../../core/router.js';
import { fmtPLN, imgUrl, PLACEHOLDER } from '../../core/format.js';
import {
  getCartItems, getCartCount, removeFromCart, markOrdered,
  getOrderedItems, removeOrderRecords, getDeliveryProgress,
} from '../../core/reorderCart.js';

/* Koszyk zamówień — ETAP 1 (patrz core/reorderCart.js): stan lokalny,
   niezsynchronizowany między urządzeniami/użytkownikami. Ikona w topbarze
   (widoczna na każdym ekranie), panel z dwiema zakładkami: "Koszyk" (jeszcze
   niewysłane do dostawcy) i "Zamówione" (wysłane, z postępem dostawy). */
let currentTab = 'listed';
let selectedSuppliers = new Set();
let supplierPanelOpen = false;
let checkedIds = new Set();

function productById(id){ return products.find(p => p.id === id); }
function fmtDatePl(iso){ return iso ? new Date(iso).toLocaleDateString('pl-PL') : '—'; }

export function updateCartBadge(){
  const badge = document.getElementById('cartBadge');
  if(badge) badge.textContent = String(getCartCount());
}

export function openOrderCart(){
  currentTab = 'listed';
  selectedSuppliers = new Set();
  supplierPanelOpen = false;
  checkedIds = new Set();
  setCartTabUI('listed');
  document.getElementById('overlayCart').classList.add('active');
  pushModalState();
  renderCartTabs();
}

export function closeOrderCart(){
  requestModalClose();
}

export function setCartTab(tab){
  currentTab = tab;
  checkedIds = new Set();
  setCartTabUI(tab);
  renderCartTabs();
}

function setCartTabUI(tab){
  document.querySelectorAll('#cartTabs .pill').forEach(btn => btn.classList.toggle('active', btn.dataset.key === tab));
  document.getElementById('cartListedView').style.display = tab === 'listed' ? '' : 'none';
  document.getElementById('cartOrderedView').style.display = tab === 'ordered' ? '' : 'none';
}

/* Wielowybór dostawców "po excelowemu" — ten sam wzorzec co w components/reorder/reorder.js. */
function getAllRelevantItems(){
  return [
    ...getCartItems().map(it => ({ ...productById(it.id), ...it })),
    ...getOrderedItems().map(it => ({ ...productById(it.id), ...it })),
  ];
}

export function toggleCartSupplierPanel(){
  supplierPanelOpen = !supplierPanelOpen;
  renderCartTabs();
}

export function toggleCartSupplier(s){
  if(selectedSuppliers.has(s)) selectedSuppliers.delete(s); else selectedSuppliers.add(s);
  renderCartTabs();
}

export function selectAllCartSuppliers(){
  selectedSuppliers = new Set(getAllRelevantItems().map(it => it.dostawca).filter(Boolean));
  renderCartTabs();
}

export function clearCartSuppliers(){
  selectedSuppliers = new Set();
  renderCartTabs();
}

function renderSupplierPanel(items){
  const panel = document.getElementById('cartSupplierFilterPanel');
  const btn = document.querySelector('#cartSupplierFilterWrap .ms-filter-btn');
  panel.classList.toggle('open', supplierPanelOpen);
  if(supplierPanelOpen){
    const suppliers = [...new Set(items.map(it => it.dostawca).filter(Boolean))].sort();
    panel.innerHTML = `
      <div class="ms-filter-actions">
        <button type="button" onclick="selectAllCartSuppliers()">Zaznacz wszystko</button>
        <button type="button" onclick="clearCartSuppliers()">Wyczyść</button>
      </div>
      ${suppliers.map(s => `
        <label class="ms-filter-option">
          <input type="checkbox" ${selectedSuppliers.has(s) ? 'checked' : ''} onchange="toggleCartSupplier('${s.replace(/'/g, "\\'")}')">
          ${s}
        </label>`).join('')}
    `;
  }
  btn.textContent = (selectedSuppliers.size === 0 ? 'Wszyscy dostawcy' : `Dostawca (${selectedSuppliers.size})`) + ' ▾';
}

document.addEventListener('click', e => {
  const wrap = document.getElementById('cartSupplierFilterWrap');
  if(supplierPanelOpen && wrap && !wrap.contains(e.target)){
    supplierPanelOpen = false;
    renderCartTabs();
  }
});

export function toggleCartCheck(id){
  if(checkedIds.has(id)) checkedIds.delete(id); else checkedIds.add(id);
  renderCartTabs();
}

export function cartRemoveItem(id){
  removeFromCart(id);
}

async function renderCartTabs(){
  if(!document.getElementById('overlayCart')?.classList.contains('active')){
    updateCartBadge();
    return;
  }

  const listedItems = getCartItems().map(it => ({ ...productById(it.id), ...it }));
  const orderedItems = getOrderedItems().map(it => ({ ...productById(it.id), ...it }));

  renderSupplierPanel([...listedItems, ...orderedItems]);

  document.getElementById('cartTabListedCount').textContent = String(listedItems.length);
  document.getElementById('cartTabOrderedCount').textContent = String(orderedItems.length);

  const bySupplier = it => selectedSuppliers.size === 0 || selectedSuppliers.has(it.dostawca);
  const listedFiltered = listedItems.filter(bySupplier);
  renderListedTable(listedFiltered);
  updateMessagePreview(listedFiltered);

  const orderedFiltered = orderedItems.filter(bySupplier);
  const progresses = await Promise.all(orderedFiltered.map(it => getDeliveryProgress(it.id)));
  renderOrderedTable(orderedFiltered.map((it, i) => ({ ...it, progress: progresses[i] })));

  updateCartBadge();
}

function renderListedTable(items){
  const tbody = document.getElementById('cartListedBody');
  const totalEl = document.getElementById('cartListedTotal');
  if(items.length === 0){
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Koszyk jest pusty.</td></tr>`;
    totalEl.textContent = '';
    return;
  }
  tbody.innerHTML = items.map(it => {
    const value = it.qty * (it.cenaZakupu || 0);
    return `<tr>
      <td><input type="checkbox" ${checkedIds.has(it.id) ? 'checked' : ''} onchange="toggleCartCheck(${it.id})"></td>
      <td><img class="prod-thumb" src="${imgUrl(it.img) || PLACEHOLDER}" referrerpolicy="no-referrer" onerror="this.src='${PLACEHOLDER}'"></td>
      <td><div class="prod-name">${it.name}</div><div class="prod-id">ID ${it.id}</div></td>
      <td>${it.dostawca || '—'}</td>
      <td class="num">${it.qty} szt.</td>
      <td class="num">${fmtPLN(value)}</td>
      <td><button class="reorder-action-btn-sm" onclick="cartRemoveItem(${it.id})">✕</button></td>
    </tr>`;
  }).join('');
  const total = items.filter(it => checkedIds.has(it.id)).reduce((s, it) => s + it.qty * (it.cenaZakupu || 0), 0);
  totalEl.textContent = checkedIds.size > 0
    ? `Wartość zaznaczonych: ${fmtPLN(total)}`
    : 'Zaznacz produkty, żeby wygenerować zamówienie.';
}

function renderOrderedTable(items){
  const tbody = document.getElementById('cartOrderedBody');
  if(items.length === 0){
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">Brak zamówionych produktów.</td></tr>`;
    return;
  }
  tbody.innerHTML = items.map(it => {
    const p = it.progress;
    const delivered = p ? p.deliveredQty : 0;
    const isComplete = p ? p.isComplete : false;
    return `<tr>
      <td><input type="checkbox" ${checkedIds.has(it.id) ? 'checked' : ''} onchange="toggleCartCheck(${it.id})"></td>
      <td><img class="prod-thumb" src="${imgUrl(it.img) || PLACEHOLDER}" referrerpolicy="no-referrer" onerror="this.src='${PLACEHOLDER}'"></td>
      <td><div class="prod-name">${it.name}</div><div class="prod-id">ID ${it.id}</div></td>
      <td>${it.dostawca || '—'}</td>
      <td class="num">${it.qty} szt.</td>
      <td>${fmtDatePl(it.orderedAt)}</td>
      <td class="num">${delivered} / ${it.qty}</td>
      <td><span class="reorder-badge ${isComplete ? 'reorder-badge-ok' : 'reorder-badge-ordered'}">${isComplete ? 'dostarczono' : 'zamówiono'}</span></td>
    </tr>`;
  }).join('');
}

/* Treść zamówienia — OSOBNY blok na każdego dostawcę (nie da się wysłać
   jednej wiadomości do dwóch różnych firm naraz), dokładnie w formacie z
   formuły w Panelu do zamówień. */
function buildOrderMessages(items){
  const bySupplier = new Map();
  items.forEach(it => {
    const key = it.dostawca || 'Nieznany dostawca';
    if(!bySupplier.has(key)) bySupplier.set(key, []);
    bySupplier.get(key).push(it);
  });
  return [...bySupplier.entries()].map(([supplier, list]) => {
    const lines = list.map(it =>
      `- ${it.name} | Kod: ${it.kod || '—'} | Nasze ID: ${it.id} | Ilość: ${it.qty} szt.\nLink: https://ferroboutique.pl/produkt/${it.id}`
    );
    return `— Dostawca: ${supplier} —\nDzień dobry, przesyłam zamówienie:\n\n${lines.join('\n')}\n\nProszę o potwierdzenie`;
  }).join('\n\n════════════════════\n\n');
}

/* Podgląd na żywo — aktualizuje się przy każdym zaznaczeniu/odznaczeniu
   checkboxa w zakładce "Koszyk" (patrz toggleCartCheck -> renderCartTabs).
   Gdy nic nie jest zaznaczone, ZOSTAWIA ostatnią wygenerowaną treść (np. tuż
   po "Zamów zaznaczone", żeby dało się ją jeszcze skopiować), zamiast czyścić
   pole na pusto. */
function updateMessagePreview(listedItems){
  const checkedListed = listedItems.filter(it => checkedIds.has(it.id));
  if(checkedListed.length === 0) return;
  document.getElementById('cartMessageOutput').value = buildOrderMessages(checkedListed);
}

/* Zaznaczone pozycje z koszyka -> status "zamówiono" (z dzisiejszą datą).
   Treść wiadomości jest już widoczna (podgląd na żywo) — tu tylko
   zatwierdzamy i przenosimy do zakładki "Zamówione". */
export function sendCartOrder(){
  const listedItems = getCartItems().map(it => ({ ...productById(it.id), ...it }));
  const items = listedItems.filter(it => checkedIds.has(it.id));
  if(items.length === 0){
    alert('Zaznacz produkty, które chcesz zamówić.');
    return;
  }
  markOrdered(items.map(it => it.id));
  checkedIds = new Set();
}

export function copyCartMessage(){
  const el = document.getElementById('cartMessageOutput');
  if(!el.value) return;
  el.select();
  navigator.clipboard?.writeText(el.value);
}

export function removeSelectedOrdered(){
  if(checkedIds.size === 0){
    alert('Zaznacz produkty do usunięcia z listy.');
    return;
  }
  removeOrderRecords([...checkedIds]);
  checkedIds = new Set();
}

document.addEventListener('ferro:cart-changed', renderCartTabs);

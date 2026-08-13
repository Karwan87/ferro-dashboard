import { products } from './data.js';
import { fmtPLN, imgUrl, PLACEHOLDER } from './format.js';
import { pushModalState, requestModalClose } from './router.js';
import { addToCart, getProductCartStatus, getOrderState } from './reorderCart.js';

let currentModalProductId = null;
let modalCartQtyFormOpen = false;

export function openModal(id, extended, extraHtml){
  const p = products.find(x=>x.id===id);
  currentModalProductId = id;
  modalCartQtyFormOpen = false;
  renderModalCartAction();
  const modalPhoto = document.getElementById('modalPhoto');
  modalPhoto.src = imgUrl(p.img) || PLACEHOLDER;
  modalPhoto.setAttribute('referrerpolicy','no-referrer');
  modalPhoto.onerror = function(){ this.src = PLACEHOLDER; };
  document.getElementById('modalId').textContent = 'ID ' + p.id + (p.kod? ' · kod '+p.kod : '');
  document.getElementById('modalName').textContent = p.name;

  // Sekcja 1: cena/marża na sztukę — dane "statyczne" (katalogowe), nie
  // zależą od okresu.
  const marzaPct = p.cena > 0 ? (p.cena - p.cenaZakupu) / p.cena * 100 : null;
  const financeSection = `
    <div class="modal-grid">
      <div><div class="modal-stat-label">Cena sprzedaży</div><div class="modal-stat-val">${fmtPLN(p.cena)}</div></div>
      <div><div class="modal-stat-label">Cena zakupu</div><div class="modal-stat-val">${fmtPLN(p.cenaZakupu)}</div></div>
      <div><div class="modal-stat-label">Marża / szt.</div><div class="modal-stat-val">${fmtPLN(p.narzut)}</div></div>
      <div><div class="modal-stat-label">% marży</div><div class="modal-stat-val">${marzaPct !== null ? marzaPct.toFixed(0) + '%' : '—'}</div></div>
    </div>
  `;

  // Sekcja 2: bieżący stan + sprzedaż/zwroty w ostatnich 30 dniach (rozbicie
  // po tygodniach i odsłony doklejane tylko w widoku rozszerzonym).
  const periodExtras = extended ? `
      <div><div class="modal-stat-label">Sprzedaż: dni 1-7</div><div class="modal-stat-val">${p.s7} szt.</div></div>
      <div><div class="modal-stat-label">Sprzedaż: dni 8-14</div><div class="modal-stat-val">${p.s14} szt.</div></div>
      <div><div class="modal-stat-label">Sprzedaż: dni 15-21</div><div class="modal-stat-val">${p.s21} szt.</div></div>
      <div><div class="modal-stat-label">Sprzedaż: dni 22-28</div><div class="modal-stat-val">${p.s28} szt.</div></div>
      <div><div class="modal-stat-label">Odsłony produktu</div><div class="modal-stat-val">${p.odslony}</div></div>
  ` : '';
  const periodSection = `
    <div class="modal-grid">
      <div><div class="modal-stat-label">Stan magazynowy</div><div class="modal-stat-val">${p.stan} szt.</div></div>
      <div><div class="modal-stat-label">Sprzedaż 30 dni</div><div class="modal-stat-val">${p.s30} szt.</div></div>
      <div><div class="modal-stat-label">% zwrotów</div><div class="modal-stat-val">${p.s30>0 ? Math.min(p.ret30/p.s30*100,100).toFixed(0)+'%':'—'}</div></div>
      ${periodExtras}
    </div>
  `;

  // Sekcja 3: cała historia produktu (tylko widok rozszerzony).
  const historySection = extended ? `
    <div class="modal-grid">
      <div><div class="modal-stat-label">Dostarczono (cała historia)</div><div class="modal-stat-val">${p.dostarczonoHist} szt.</div></div>
      <div><div class="modal-stat-label">Sprzedane (cała historia)</div><div class="modal-stat-val">${p.sprzedaneHist} szt.</div></div>
      <div><div class="modal-stat-label">Zwrócone (cała historia)</div><div class="modal-stat-val">${p.zwroconoHist} szt.</div></div>
      <div><div class="modal-stat-label">% zwrotów (cała historia)</div><div class="modal-stat-val">${p.sprzedaneHist>0 ? (p.zwroconoHist/p.sprzedaneHist*100).toFixed(0)+'%':'—'}</div></div>
    </div>
  ` : '';

  document.getElementById('modalGrid').innerHTML = financeSection + periodSection + historySection;
  document.getElementById('modalNote').textContent = 'Dane na żywo z arkusza Google Sheets. Kliknij „Odśwież" u góry, jeśli od chwili odsłony minęło już trochę czasu.';
  // Opcjonalna sekcja doklejana przez wywołującego (np. rozbicie alertów wg
  // wariantu/dnia w module "Do zamówienia") — pusta domyślnie, żeby nie
  // zostawała z poprzedniego otwarcia modala z innego miejsca.
  document.getElementById('modalExtra').innerHTML = extraHtml || '';
  document.getElementById('overlay').classList.add('active');
  pushModalState();
}

export function closeModal(){
  requestModalClose();
}

/* Akcja "Zamów" w prawym dolnym rogu zdjęcia modala — ten sam koszyk
   (core/reorderCart.js) co kolumna "Akcje" w module "Do zamówienia",
   dostępny z KAŻDEGO modala produktu w apce, nie tylko z tego modułu. */
function renderModalCartAction(){
  const el = document.getElementById('modalCartAction');
  if(!el || currentModalProductId == null) return;
  const id = currentModalProductId;

  if(modalCartQtyFormOpen){
    el.innerHTML = `
      <div class="modal-cart-qty-form">
        <input type="number" min="1" value="1" id="modalCartQtyInput">
        <button onclick="confirmModalCartQty()">OK</button>
        <button onclick="cancelModalCartQty()">✕</button>
      </div>`;
    document.getElementById('modalCartQtyInput').focus();
    return;
  }

  // Status (jeśli jest) to tylko INFORMACJA — przycisk "Zamów" zostaje
  // widoczny niezależnie od niego, bo zawsze można domówić kolejną turę,
  // nawet gdy poprzednia jest już w koszyku albo wysłana do dostawcy.
  const status = getProductCartStatus(id);
  const badge = status === 'listed'
    ? `<span class="modal-cart-badge">w koszyku: ${getOrderState(id).listedQty} szt.</span>`
    : status === 'ordered'
      ? `<span class="modal-cart-badge">w zamówieniu</span>`
      : '';
  el.innerHTML = `${badge}<button class="modal-cart-btn" onclick="toggleModalCartQty()">🛒 Zamów</button>`;
}

export function toggleModalCartQty(){
  modalCartQtyFormOpen = !modalCartQtyFormOpen;
  renderModalCartAction();
}
export function cancelModalCartQty(){
  modalCartQtyFormOpen = false;
  renderModalCartAction();
}
export function confirmModalCartQty(){
  const qty = Number(document.getElementById('modalCartQtyInput').value) || 0;
  if(qty > 0) addToCart(currentModalProductId, qty);
  modalCartQtyFormOpen = false;
  renderModalCartAction();
}

document.addEventListener('ferro:cart-changed', () => { if(!modalCartQtyFormOpen) renderModalCartAction(); });
document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeModal(); });

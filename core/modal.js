import { products } from './data.js';
import { fmtPLN, imgUrl, PLACEHOLDER } from './format.js';
import { pushModalState, requestModalClose } from './router.js';

export function openModal(id, extended, extraHtml){
  const p = products.find(x=>x.id===id);
  const modalPhoto = document.getElementById('modalPhoto');
  modalPhoto.src = imgUrl(p.img) || PLACEHOLDER;
  modalPhoto.setAttribute('referrerpolicy','no-referrer');
  modalPhoto.onerror = function(){ this.src = PLACEHOLDER; };
  document.getElementById('modalId').textContent = 'ID ' + p.id + (p.kod? ' · kod '+p.kod : '');
  document.getElementById('modalName').textContent = p.name;

  const extendedStats = extended ? `
    <div><div class="modal-stat-label">Sprzedaż: dni 1-7</div><div class="modal-stat-val">${p.s7} szt.</div></div>
    <div><div class="modal-stat-label">Sprzedaż: dni 8-14</div><div class="modal-stat-val">${p.s14} szt.</div></div>
    <div><div class="modal-stat-label">Sprzedaż: dni 15-21</div><div class="modal-stat-val">${p.s21} szt.</div></div>
    <div><div class="modal-stat-label">Sprzedaż: dni 22-28</div><div class="modal-stat-val">${p.s28} szt.</div></div>
    <div><div class="modal-stat-label">Odsłony produktu</div><div class="modal-stat-val">${p.odslony}</div></div>
    <div><div class="modal-stat-label">Sprzedane (cała historia)</div><div class="modal-stat-val">${p.sprzedaneHist} szt.</div></div>
  ` : '';

  document.getElementById('modalGrid').innerHTML = `
    <div><div class="modal-stat-label">Cena sprzedaży</div><div class="modal-stat-val">${fmtPLN(p.cena)}</div></div>
    <div><div class="modal-stat-label">Marża / szt.</div><div class="modal-stat-val">${fmtPLN(p.narzut)}</div></div>
    <div><div class="modal-stat-label">Stan magazynowy</div><div class="modal-stat-val">${p.stan} szt.</div></div>
    <div><div class="modal-stat-label">Sprzedaż 30 dni</div><div class="modal-stat-val">${p.s30} szt.</div></div>
    <div><div class="modal-stat-label">Zwroty 30 dni</div><div class="modal-stat-val">${p.ret30} szt.</div></div>
    <div><div class="modal-stat-label">% zwrotów</div><div class="modal-stat-val">${p.s30>0 ? Math.min(p.ret30/p.s30*100,100).toFixed(0)+'%':'—'}</div></div>
    ${extendedStats}
  `;
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

document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeModal(); });

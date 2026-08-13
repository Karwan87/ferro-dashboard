/* Mały, generyczny modal potwierdzenia (Anuluj / akcja) — dziś używany tylko
   przez koszyk (usuwanie niekompletnej dostawy, patrz components/cart/cart.js),
   ale celowo bez zależności od koszyka, żeby dało się użyć gdziekolwiek indziej.
   Bez integracji z historią przeglądarki (pushModalState) — to krótka,
   jednorazowa decyzja typu Anuluj/Potwierdź, nie ekran do cofania. */
let resolver = null;

export function showConfirm(title, message, confirmLabel = 'Usuń mimo to'){
  document.getElementById('confirmModalTitle').textContent = title;
  document.getElementById('confirmModalMessage').textContent = message;
  document.getElementById('confirmModalConfirmBtn').textContent = confirmLabel;
  document.getElementById('overlayConfirm').classList.add('active');
  return new Promise(resolve => { resolver = resolve; });
}

export function resolveConfirmModal(result){
  document.getElementById('overlayConfirm').classList.remove('active');
  const r = resolver;
  resolver = null;
  if(r) r(result);
}

document.addEventListener('keydown', e => {
  if(e.key === 'Escape' && document.getElementById('overlayConfirm')?.classList.contains('active')){
    resolveConfirmModal(false);
  }
});

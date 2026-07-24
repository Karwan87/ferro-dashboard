/* Stos ekranów — każda zakładka (sales, customers, ...) wchodzi głębiej przez
   navigateTo(), a "Wróć" zawsze cofa o jeden poziom przez goBack(), niezależnie
   od tego, ile poziomów ma dana ścieżka (np. Klienci ma 3: rok → raport → tabela).

   Każdy navigateTo() dokłada wpis do historii przeglądarki (history.pushState),
   a systemowy przycisk/gest "wstecz" na telefonie generuje zdarzenie popstate —
   obsługujemy je tak samo jak kliknięcie w "Wróć", żeby oba sposoby cofania
   zawsze schodziły o jeden poziom w TEJ SAMEJ, wewnętrznej hierarchii ekranów,
   zamiast wychodzić z aplikacji do strony sprzed jej otwarcia. */
let stack = [{ id: 'screen-home', crumb: '' }];
history.replaceState({ depth: 1 }, '');

function render(){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  const top = stack[stack.length - 1];
  document.getElementById(top.id).classList.add('active');
  document.getElementById('crumbTitle').textContent = top.crumb;

  const backBtn = document.getElementById('backBtn');
  backBtn.style.display = stack.length > 1 ? 'inline-flex' : 'none';
  backBtn.onclick = goBack;
}

export function navigateTo(screenId, crumb){
  stack.push({ id: screenId, crumb: crumb || '' });
  history.pushState({ depth: stack.length }, '');
  render();
}

export function goBack(){
  if(stack.length > 1) history.back();
}

/* Modal (core/modal.js, customers.js) dokłada własny wpis do historii przy
   otwarciu, żeby przycisk/gest "wstecz" na telefonie najpierw zamykał modal,
   a dopiero drugie cofnięcie zmieniało ekran — inaczej modal zostawał otwarty
   na nowym ekranie pod spodem. */
export function pushModalState(){
  history.pushState({ modal: true }, '');
}

export function requestModalClose(){
  if(history.state && history.state.modal){
    history.back();
  } else {
    document.querySelectorAll('.overlay.active').forEach(o=>o.classList.remove('active'));
  }
}

window.addEventListener('popstate', () => {
  const openOverlay = document.querySelector('.overlay.active');
  if(openOverlay){
    openOverlay.classList.remove('active');
    return;
  }
  if(stack.length > 1){
    stack.pop();
    render();
  }
});

export function goHome(){
  const depthToPop = stack.length - 1;
  stack = [{ id: 'screen-home', crumb: '' }];
  if(depthToPop > 0) history.go(-depthToPop);
  render();
}

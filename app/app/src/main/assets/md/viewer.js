// Czytnik/edytor .md w DSH Mobile (MdActivity). Plik czyta i zapisuje mostek Md — tylko ten jeden, otwarty przez apkę.
const $ = (id) => document.getElementById(id);
const view = $('view'), edit = $('edit'), save = $('save');
let saved = Md.text();   // treść zgodna z plikiem na dysku (po zapisie aktualizowana)
let mode = 'view';

$('name').textContent = Md.name();
edit.value = saved;
render();

function render() {
  // Surowy HTML z dokumentu: parsujemy poza stroną (DOMParser niczego nie uruchamia), wycinamy skrypty i on*, dopiero potem wstawiamy.
  // Główną blokadą jest CSP w viewer.html; to druga warstwa.
  const doc = new DOMParser().parseFromString(marked.parse(edit.value, { gfm: true }), 'text/html');
  doc.querySelectorAll('script,iframe,object,embed,form,link,meta,style,base').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((n) => [...n.attributes].forEach((a) => {
    if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) n.removeAttribute(a.name);
  }));
  view.replaceChildren(...doc.body.childNodes);
  // Pola list zadań są tylko do odczytu (stan zmienia się w edycji źródła).
  view.querySelectorAll('input[type=checkbox]').forEach((c) => { c.disabled = true; });
  // Kotwice nagłówków jak na GitHubie (#moj-naglowek), żeby działały linki ze spisów treści.
  const seen = {};
  view.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h) => {
    let id = h.textContent.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-');
    if (seen[id] !== undefined) id += '-' + (++seen[id]); else seen[id] = 0;
    h.id = id;
  });
}

function dirty() { return edit.value !== saved; }
function syncDirty() { save.hidden = !dirty(); Md.setDirty(dirty()); }

function setMode(m) {
  mode = m;
  $('tab-view').classList.toggle('on', m === 'view');
  $('tab-edit').classList.toggle('on', m === 'edit');
  view.hidden = m !== 'view';
  $('copy').hidden = m !== 'view';
  edit.hidden = m !== 'edit';
  if (m === 'view') render(); else edit.focus();
}

function toast(text) {
  const t = $('toast'); t.textContent = text; t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 2500);
}

// Wołane też z MdActivity (zapis przy wyjściu): zwraca true, gdy plik zapisany.
function doSave() {
  const err = Md.save(edit.value);
  if (err) { toast('Nie zapisano: ' + err); return false; }
  saved = edit.value; syncDirty(); toast('Zapisano'); return true;
}

$('tab-view').onclick = () => setMode('view');
$('tab-edit').onclick = () => setMode('edit');
save.onclick = doSave;
$('ext').onclick = () => Md.openExternal();
$('copy').onclick = () => {
  Md.copy(edit.value);   // całe źródło markdown (z niezapisanymi zmianami, jeśli są)
  const b = $('copy'); b.classList.add('done'); toast('Skopiowano dokument');
  clearTimeout(b.timer); b.timer = setTimeout(() => b.classList.remove('done'), 1500);
};
edit.addEventListener('input', syncDirty);
// Linki z dokumentu: zewnętrzne do przeglądarki, kotwice w obrębie strony.
view.addEventListener('click', (e) => {
  const a = e.target.closest('a'); if (!a) return;
  const href = a.getAttribute('href') || '';
  e.preventDefault();
  if (href.startsWith('#')) {
    const id = decodeURIComponent(href.slice(1));
    document.getElementById(id)?.scrollIntoView();
  } else Md.openLink(href);
});

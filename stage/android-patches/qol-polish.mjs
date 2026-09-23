// Łatka: polskie napisy w dsh-qol (plugin nie ma i18n — chińskie literały w bundlu) + selektor CSS ukrywania
// trybu dostępu dopasowany do polskiej/angielskiej etykiety. Użycie: node qol-polish.mjs <node_modules> (idempotentna)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const file = join(process.argv[2], 'dsh-qol/lib/client.js');
if (!existsSync(file)) { console.log('qol-polish: brak dsh-qol, pomijam'); process.exit(0); }
let s = readFileSync(file, 'utf8');
if (s.includes('[android] qol polish')) { console.log('qol-polish: już nałożona'); process.exit(0); }

const MAP = [
  // FEATURES: etykieta / podpowiedź
  ['侧栏滑动开合', 'Gest otwierania panelu bocznego'],
  ['全屏范围右滑展开、左滑收起侧边栏（不跟手，过阈值触发；输入框内除外）', 'Przesunięcie w prawo otwiera, w lewo zwija panel boczny (po przekroczeniu progu; nie działa w polu tekstowym)'],
  ['禁用触摸长按拖拽', 'Bez przeciągania po przytrzymaniu'],
  ['Android 长按会话行会触发系统拖拽且常使整页输入卡死（需刷新）；触摸时禁用原生拖拽，桌面鼠标拖拽排序不受影响', 'Na Androidzie przytrzymanie wiersza sesji uruchamia systemowe przeciąganie i często blokuje wpisywanie (wymaga odświeżenia); przy dotyku natywne przeciąganie jest wyłączone, sortowanie myszą na komputerze działa'],
  ['设置页全屏重写', 'Ustawienia na pełnym ekranie'],
  ['设置对话框在窄屏下全屏堆叠、标签横滚、右上角关闭与配置文件按钮', 'Na wąskim ekranie okno ustawień zajmuje cały ekran, zakładki przewijają się poziomo, przyciski zamknięcia i pliku konfiguracji są w prawym górnym rogu'],
  ['设置页记忆页签', 'Pamiętaj zakładkę ustawień'],
  ['打开设置时自动恢复上次选中的页签，避免每次重置回 General', 'Po otwarciu ustawień wraca do ostatnio wybranej zakładki zamiast do Ogólne'],
  ['输入法/键盘适配', 'Dopasowanie do klawiatury ekranowej'],
  ['viewport meta + 100dvh + 安全区 + iOS 兜底（不改元素尺寸/字号）', 'viewport meta, 100dvh, strefy bezpieczne i poprawki iOS (bez zmiany rozmiarów elementów i czcionek)'],
  ['按钮触摸反馈', 'Reakcja przycisków na dotyk'],
  ['touch-action + 关系统灰闪 + :active 按压反馈（不改元素尺寸）', 'touch-action, bez systemowego szarego mignięcia, efekt wciśnięcia :active (bez zmiany rozmiarów)'],
  ['代码块/表格内滚', 'Przewijanie kodu i tabel w miejscu'],
  ['长代码与表格在容器内横向滚动，正文换行不溢出', 'Długi kod i tabele przewijają się poziomo wewnątrz kontenera, tekst zawija się i nie wychodzi poza ekran'],
  ['隐藏权限选择下拉', 'Ukryj wybór trybu dostępu'],
  ['隐藏输入框内的权限（Access mode）下拉触发器，省横向空间；模型选择与上下文用量不受影响', 'Ukrywa w kompozytorze przycisk trybu dostępu, żeby oszczędzić miejsce; wybór modelu i wskaźnik kontekstu zostają'],
  ['切换会话收起侧栏', 'Zwiń panel po wyborze sesji'],
  ['在侧栏点选会话后自动收起，回到对话（仅窄屏）', 'Po wybraniu sesji w panelu bocznym panel zwija się i wracasz do rozmowy (tylko wąski ekran)'],
  ['切换会话不拉键盘', 'Bez klawiatury po zmianie sesji'],
  ['切换后不自动聚焦输入框，避免输入法弹出；点输入框仍可手动聚焦', 'Po zmianie sesji pole tekstowe nie dostaje fokusu, więc klawiatura nie wyskakuje; dotknięcie pola nadal działa'],
  ['页面顶部横向展示活跃会话 Tab，未读/运行中状态置顶，一键直达，防误拉键盘；新会话不占 tab；中键/×关闭', 'U góry strony poziomy pasek kart aktywnych sesji: nieprzeczytane i działające na początku, jeden dotyk przełącza, bez wyskakiwania klawiatury; nowa sesja nie zajmuje karty; × zamyka'],
  ['活跃会话 Tab Bar', 'Pasek kart aktywnych sesji'],
  ['侧栏覆盖不挤宽', 'Panel boczny jako nakładka'],
  ['移动端侧栏以浮层展开覆盖内容，不挤压主区域宽度导致重排', 'Na telefonie panel boczny otwiera się jako warstwa nad treścią, nie zwęża głównego obszaru i nie przebudowuje układu'],
  ['状态指示动画优化', 'Lżejsza animacja wskaźnika stanu'],
  ['将 SVG opacity 追逐点动画替换为 CSS transform 脉冲，走合成器线程，零主线程开销。rAF 实测 idle FPS 35→55', 'Zamienia animację kropek SVG na puls CSS transform liczony na kompozytorze, zero obciążenia głównego wątku; zmierzone FPS w bezczynności 35→55'],
  // pasek kart / panel
  ['Web 界面体验优化（以移动端为主）。每个功能可独立开关，即时生效。设置仅存于本浏览器。', 'Ulepszenia interfejsu WWW (głównie na telefon). Każda funkcja ma własny przełącznik i działa natychmiast. Ustawienia są zapisane tylko w tej przeglądarce.'],
  ['归档/关闭会话', 'Archiwizuj lub zamknij sesję'],
  ['新建会话', 'Nowa sesja'],
  ['展开侧栏', 'Otwórz panel boczny'],
  [' [未读]', ' [nieprzeczytane]'],
  [' [运行中]', ' [w toku]'],
  ['新会话', 'Nowa sesja'],
  // selektor CSS: etykieta aria trybu dostępu zależy od języka UI
  ['[aria-label^=\\"访问模式\\"]', ':is([aria-label^=\\"访问模式\\"],[aria-label^=\\"Access mode\\"],[aria-label^=\\"Tryb dostępu\\"])'],
];
for (const [zh, pl] of MAP) {
  if (!s.includes(zh)) throw new Error('qol-polish: nie znaleziono: ' + zh.slice(0, 40) + ' — plugin zmienił się upstream');
  s = s.split(zh).join(pl);
}
s = s.replace('var STORAGE_KEY = "dsh.qol.v1";', '// [android] qol polish\n    var STORAGE_KEY = "dsh.qol.v1";');
if (!s.includes('[android] qol polish')) throw new Error('qol-polish: brak markera STORAGE_KEY');
writeFileSync(file, s);
console.log('qol-polish: nałożona (' + MAP.length + ' napisów)');

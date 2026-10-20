// Zamykanie panelu bocznego dotknięciem obok niego na stronach dsh z komputera (Code → remote).
// Lokalny dsh ma to w pluginie tap-outside; strona z PC go nie ładuje, więc apka wstrzykuje ten odpowiednik.
// Każda decyzja idzie do konsoli z prefiksem [tap-outside] → dsh_log.txt.
(function () {
	if (window.__dshTapOutside) return;
	window.__dshTapOutside = true;
	var MOBILE = "(max-width: 768px)";
	var POPUP = '[role="menu"], [role="menuitem"], [role="listbox"], [role="option"], [role="dialog"], [role="alertdialog"], [data-radix-popper-content-wrapper]';
	// Bez dsh-qol kontener to AppFrame z core (klasa „<hash>_frame”), który traci data-sidebar-collapsed po wysunięciu panelu.
	function frame() {
		var col = document.querySelector("[class*=\"_sidebarCol\"]");
		return document.querySelector("[data-qol-appframe]") || (col && col.closest("[class$=\"_frame\"]")) || document.querySelector("[data-sidebar-collapsed]");
	}
	function sidebarOpen() { var f = frame(); return !!f && !f.hasAttribute("data-sidebar-collapsed"); }
	function toggleBtn() { return document.querySelector("[class*=\"_sidebarCol\"] [class*=\"_toggle\"]"); }
	console.log("[tap-outside] remote: frame=" + !!frame() + " qol=" + !!document.querySelector("[data-qol-appframe]") +
		" sidebarCol=" + !!document.querySelector("[class*=\"_sidebarCol\"]") + " toggle=" + !!toggleBtn() + " open=" + sidebarOpen());
	document.addEventListener("pointerdown", function (ev) {
		if (!window.matchMedia(MOBILE).matches || !sidebarOpen()) return;
		if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
		var t = ev.target;
		if (!t || !t.closest || t.closest("[class*=\"_sidebarCol\"]") || t.closest(POPUP)) return;
		if (t.closest("[class*=\"_toggle\"], [aria-label*=\"panel boczny\"], [aria-label*=\"sidebar\"]")) return;
		var btn = toggleBtn();
		console.log("[tap-outside] remote: dotknięcie obok panelu, przycisk zwijania " + (btn ? "kliknięty" : "NIE ZNALEZIONY"));
		if (!btn) return;
		ev.preventDefault(); ev.stopPropagation();
		btn.click();
	}, true);
})();

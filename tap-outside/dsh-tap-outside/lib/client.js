window.__ModuleLoader__.load({
	id: "@dsh-local/tap-outside",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		// Zamykanie lewego panelu bocznego dotknięciem obok niego (wąski ekran, panel jako nakładka z dsh-qol).
		// Stan panelu: AppFrame ma `data-sidebar-collapsed`, gdy panel jest zwinięty (tak samo czyta to dsh-qol).
		const MOBILE = "(max-width: 768px)";
		const inject = ["slots"];
		function frame() { return document.querySelector("[data-qol-appframe]") || document.querySelector("[data-sidebar-collapsed], [class*=\"_appFrame\"]"); }
		function sidebarOpen() { const f = frame(); return !!f && !f.hasAttribute("data-sidebar-collapsed"); }
		function insideSidebar(el) { return !!(el && el.closest && el.closest("[class*=\"_sidebarCol\"]")); }
		function modalOpen() { return document.querySelector('[role="dialog"][aria-modal="true"]') !== null; }
		function apply(ctx) {
			let layout;
			const collapse = () => {
				try { layout = layout || ctx.get("layout"); } catch (e) { layout = undefined; }
				if (layout && typeof layout.toggleSidebar === "function") { layout.toggleSidebar(); return; }
				const btn = document.querySelector("[class*=\"_sidebarCol\"] [class*=\"_toggle\"]");
				if (btn) btn.click();
			};
			const onDown = (ev) => {
				if (!window.matchMedia(MOBILE).matches) return;
				if (!sidebarOpen() || modalOpen()) return;
				const t = ev.target;
				if (insideSidebar(t)) return;
				if (t && t.closest && t.closest("[class*=\"_toggle\"], [aria-label*=\"panel boczny\"], [aria-label*=\"sidebar\"]")) return;
				// dotknięcie poza panelem: tylko zamyka panel, nie trafia w element pod spodem
				ev.preventDefault(); ev.stopPropagation();
				collapse();
			};
			document.addEventListener("pointerdown", onDown, true);
			ctx.effect(() => () => document.removeEventListener("pointerdown", onDown, true), "tap-outside: listener");
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

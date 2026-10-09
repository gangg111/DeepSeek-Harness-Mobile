// dsh-code: ekran „Code” w pasku bocznym DSH na telefonie (format ladowarki modulow klienta DSH).
// Lista komputerow z wtyczka dsh-remote-control i ich sesji; dotkniecie sesji otwiera ja z komputera
// (pelny interfejs DSH z historia, zalacznikami, wyborem modelu i zatrzymywaniem).
window.__ModuleLoader__.load({
  id: '@dsh-local/dsh-code',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    const NS = 'dsh-code'
    const PANEL = 'code'
    const POLL_MS = 5000

    const en = {
      code: 'Code', devices: 'Devices', addDevice: 'Add device', address: 'Computer address in Tailscale', add: 'Add', cancel: 'Cancel',
      sessions: 'Sessions', all: 'All', connected: 'Connected', disconnected: 'Disconnected', newSession: 'New session',
      untitled: 'Untitled session', waiting: 'Waiting for your approval', remove: 'Remove',
      noDevices: 'Add a computer running the dsh-remote-control plugin by its Tailscale address, e.g. dsh-pc.tail1234.ts.net',
      noSessions: 'No sessions yet', offline: 'This computer is not reachable right now.', computer: 'Computer', workspace: 'Workspace',
      firstMessage: 'First message (optional)', create: 'Create', now: 'now', loading: 'Loading…',
      tailscale: 'Tailscale', tsRunning: 'built-in node signed in', tsNeedsLogin: 'built-in node needs sign-in', tsLogin: 'Sign in to Tailscale',
      tsStarting: 'built-in node starting…', tsVpn: 'via Tailscale app (VPN)', tsStopped: 'built-in node not running',
      searching: 'Looking for computers on the Tailscale network…',
    }
    const pl = {
      code: 'Code', devices: 'Urządzenia', addDevice: 'Dodaj urządzenie', address: 'Adres komputera w Tailscale', add: 'Dodaj', cancel: 'Anuluj',
      sessions: 'Sesje', all: 'Wszystkie', connected: 'Połączono', disconnected: 'Rozłączono', newSession: 'Nowa sesja',
      untitled: 'Sesja bez tytułu', waiting: 'Czeka na Twoje zatwierdzenie', remove: 'Usuń',
      noDevices: 'Dodaj komputer z wtyczką dsh-remote-control, podając jego adres z Tailscale, np. dsh-pc.tail1234.ts.net',
      noSessions: 'Brak sesji', offline: 'Ten komputer jest teraz niedostępny.', computer: 'Komputer', workspace: 'Obszar roboczy',
      firstMessage: 'Pierwsza wiadomość (opcjonalnie)', create: 'Utwórz', now: 'teraz', loading: 'Wczytywanie…',
      tailscale: 'Tailscale', tsRunning: 'wbudowany węzeł zalogowany', tsNeedsLogin: 'wbudowany węzeł wymaga logowania', tsLogin: 'Zaloguj Tailscale',
      tsStarting: 'wbudowany węzeł startuje…', tsVpn: 'przez apkę Tailscale (VPN)', tsStopped: 'wbudowany węzeł nie działa',
      searching: 'Szukam komputerów w sieci Tailscale…',
    }

    // Ikony SVG w kolorze tekstu (bez emoji).
    const svg = (size, children, extra) => h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, ...extra }, ...children)
    const CodeIcon = ({ size = 20 }) => svg(size, [h('polyline', { key: 1, points: '8 7 3 12 8 17' }), h('polyline', { key: 2, points: '16 7 21 12 16 17' }), h('line', { key: 3, x1: 14, y1: 4, x2: 10, y2: 20 })])
    const LaptopIcon = ({ size = 16, off }) => svg(size, [
      h('rect', { key: 1, x: 4, y: 5, width: 16, height: 11, rx: 1.5 }), h('path', { key: 2, d: 'M2 19h20' }),
      off ? h('line', { key: 3, x1: 3, y1: 3, x2: 21, y2: 21 }) : null,
    ])
    const CloseIcon = ({ size = 16 }) => svg(size, [h('line', { key: 1, x1: 6, y1: 6, x2: 18, y2: 18 }), h('line', { key: 2, x1: 18, y1: 6, x2: 6, y2: 18 })])
    const PlusIcon = ({ size = 18 }) => svg(size, [h('line', { key: 1, x1: 12, y1: 5, x2: 12, y2: 19 }), h('line', { key: 2, x1: 5, y1: 12, x2: 19, y2: 12 })])
    const Spinner = ({ size = 20 }) => svg(size, [h('path', { key: 1, d: 'M12 3a9 9 0 1 0 9 9' }, h('animateTransform', { attributeName: 'transform', type: 'rotate', from: '0 12 12', to: '360 12 12', dur: '0.9s', repeatCount: 'indefinite' }))])

    const GREEN = '#22a35a'
    const S = {
      page: { height: '100%', overflowY: 'auto', padding: '16px 16px 96px', boxSizing: 'border-box', maxWidth: 760, margin: '0 auto' },
      title: { textAlign: 'center', fontSize: 20, fontWeight: 600, margin: '4px 0 20px' },
      section: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', opacity: 0.6, fontSize: 14, margin: '20px 4px 12px' },
      row: { display: 'flex', flexWrap: 'wrap', gap: 8 },
      pill: { display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderRadius: 999, border: '1px solid rgba(127,127,127,0.25)', background: 'rgba(127,127,127,0.08)', color: 'inherit', font: 'inherit', fontSize: 15, cursor: 'pointer' },
      card: { display: 'block', width: '100%', textAlign: 'left', color: 'inherit', font: 'inherit', padding: 16, marginBottom: 10, borderRadius: 22, border: '1px solid rgba(127,127,127,0.18)', background: 'rgba(127,127,127,0.06)', cursor: 'pointer', boxSizing: 'border-box' },
      head: { display: 'flex', gap: 12, alignItems: 'flex-start' },
      iconBox: { flex: '0 0 auto', width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(127,127,127,0.12)' },
      name: { fontSize: 17, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      status: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, marginTop: 4, minWidth: 0, whiteSpace: 'nowrap' },
      time: { marginLeft: 'auto', opacity: 0.6, fontSize: 14, whiteSpace: 'nowrap', paddingLeft: 8 },
      preview: { marginTop: 12, padding: '12px 14px', borderRadius: 12, background: 'rgba(127,127,127,0.12)', fontSize: 15, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' },
      // CanvasText/Canvas to kolory systemowe biezacego motywu: jasny przycisk w ciemnym motywie i odwrotnie.
      fab: { position: 'fixed', right: 20, bottom: 24, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '14px 22px', borderRadius: 999, border: 'none', background: 'CanvasText', color: 'Canvas', font: 'inherit', fontSize: 16, fontWeight: 600, cursor: 'pointer', boxShadow: '0 6px 20px rgba(0,0,0,0.35)', zIndex: 5 },
      input: { width: '100%', boxSizing: 'border-box', padding: '12px 14px', borderRadius: 12, border: '1px solid rgba(127,127,127,0.3)', background: 'rgba(127,127,127,0.08)', color: 'inherit', font: 'inherit', fontSize: 16 },
      error: { color: '#e5484d', fontSize: 14, marginTop: 8 },
      sheetBack: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 10, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' },
      sheet: { width: '100%', maxWidth: 760, boxSizing: 'border-box', padding: 20, borderRadius: '20px 20px 0 0', background: 'var(--dsw-alias-bg-primary, #1f1f22)', color: 'inherit' },
      empty: { opacity: 0.7, fontSize: 15, padding: '8px 4px', lineHeight: 1.5 },
    }

    function ago(ms, t) {
      if (!ms) return ''
      const s = Math.max(0, (Date.now() - ms) / 1000)
      if (s < 60) return t('now')
      if (s < 3600) return `${Math.floor(s / 60)} min`
      if (s < 86400) return `${Math.floor(s / 3600)} godz.`
      if (s < 7 * 86400) return `${Math.floor(s / 86400)} d`
      return new Date(ms).toLocaleDateString(navigator.language || 'pl-PL', { day: 'numeric', month: 'short' })
    }

    async function api(path, init) {
      const res = await fetch(`/api/dsh-code${path}`, { credentials: 'same-origin', cache: 'no-store', ...init, headers: { 'content-type': 'application/json', ...(init && init.headers) } })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      return body
    }

    function makePage(t) {
      return function CodePage() {
        const [data, setData] = useState(null)
        const [error, setError] = useState(null)
        const [filter, setFilter] = useState('all')
        const [adding, setAdding] = useState(false)
        // Pola tekstowe są niekontrolowane (defaultValue + onInput): kontrolowane `value` + odświeżanie listy co 5 s
        // psuło kompozycję tekstu klawiatury Androida (pierwsza litera zaznaczona, następna ją zastępowała).
        const [address, setAddress] = useState('')
        const [busy, setBusy] = useState(false)
        const [formError, setFormError] = useState(null)
        const [sheet, setSheet] = useState(null)
        const alive = useRef(true)

        const refresh = useCallback(async () => {
          try { const d = await api('/state'); if (alive.current) { setData(d); setError(null) } } catch (e) { if (alive.current) setError(e.message) }
        }, [])

        useEffect(() => {
          alive.current = true
          refresh()
          const timer = setInterval(() => { if (document.visibilityState === 'visible') refresh() }, POLL_MS)
          return () => { alive.current = false; clearInterval(timer) }
        }, [refresh])

        const addDevice = async () => {
          setBusy(true); setFormError(null)
          try { setData(await api('/devices', { method: 'POST', body: JSON.stringify({ url: address }) })); setAdding(false); setAddress('') } catch (e) { setFormError(e.message) } finally { setBusy(false) }
        }
        const removeDevice = async (id) => { try { setData(await api(`/devices/${encodeURIComponent(id)}`, { method: 'DELETE' })) } catch (e) { setError(e.message) } }
        // openUrl z serwera: przez lokalny pośrednik wbudowanego węzła (http://127.0.0.1:<port>/?dshrk=…) albo wprost https://<pc> (VPN).
        const open = (s) => { if (!s.connected) { setError(t('offline')); return } window.location.href = s.openUrl || `${s.deviceUrl}?dshOpen=${encodeURIComponent(s.sessionId)}` }

        const devices = data ? data.devices : []
        const sessions = data ? data.sessions.filter((s) => filter === 'all' || s.deviceId === filter) : []
        const online = devices.filter((d) => d.connected)

        const ts = data ? data.tailscale : null
        const tsText = !ts ? '' : ts.via === 'tsnet' ? t('tsRunning') : ts.backendState === 'NeedsLogin' ? t('tsNeedsLogin') : ts.backendState === 'Starting' ? t('tsStarting') : ts.backendState === 'Unavailable' ? t('tsVpn') : ts.backendState === 'Stopped' ? t('tsStopped') : `${t('tsVpn')} (${ts.backendState})`
        return h('div', { style: S.page },
          h('div', { style: S.title }, t('code')),
          h(TransferDock, { all: true }),
          ts ? h('div', { style: { ...S.status, justifyContent: 'center', opacity: 0.8, marginBottom: 8, flexWrap: 'wrap', whiteSpace: 'normal' } },
            h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, color: ts.via === 'tsnet' ? GREEN : 'inherit' } }, h(LaptopIcon, { off: ts.via !== 'tsnet' }), `${t('tailscale')}: ${tsText}`),
            ts.authURL ? h('a', { href: ts.authURL, target: '_blank', rel: 'noopener', style: { ...S.pill, padding: '6px 12px', textDecoration: 'none' } }, t('tsLogin')) : null,
            ts.error && ts.backendState !== 'NeedsLogin' ? h('span', { style: { opacity: 0.6 } }, ts.error) : null,
          ) : null,
          h('div', { style: S.section }, h('span', null, t('devices'))),
          h('div', { style: S.row },
            ...devices.map((d) => h('span', { key: d.id, style: S.pill, title: d.error || d.url },
              h('span', { style: { color: d.connected ? GREEN : 'inherit', opacity: d.connected ? 1 : 0.5, display: 'inline-flex' } }, h(LaptopIcon, { off: !d.connected })),
              d.name,
              h('button', { onClick: () => removeDevice(d.id), 'aria-label': `${t('remove')} ${d.name}`, title: t('remove'), style: { ...S.pill, padding: '0 2px', border: 'none', background: 'none', opacity: 0.6 } }, h(CloseIcon)),
            )),
            adding ? null : h('button', { style: S.pill, onClick: () => { setAdding(true); setFormError(null) } }, h(PlusIcon), t('addDevice')),
          ),
          adding ? h('div', { style: { marginTop: 12 } },
            h('input', { style: S.input, defaultValue: '', autoComplete: 'off', placeholder: 'dsh-pc.tail1234.ts.net', 'aria-label': t('address'), autoFocus: true, inputMode: 'url', autoCapitalize: 'none', autoCorrect: 'off', onInput: (e) => setAddress(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') addDevice() } }),
            formError ? h('div', { style: S.error }, formError) : null,
            h('div', { style: { ...S.row, marginTop: 10 } },
              h('button', { style: S.pill, disabled: busy || !address.trim(), onClick: addDevice }, busy ? h(Spinner, { size: 16 }) : h(PlusIcon, { size: 16 }), t('add')),
              h('button', { style: S.pill, onClick: () => setAdding(false) }, t('cancel')),
            ),
          ) : null,
          h('div', { style: S.section },
            h('span', null, t('sessions')),
            devices.length > 1 ? h('select', { value: filter, onChange: (e) => setFilter(e.target.value), style: { background: 'none', color: 'inherit', border: 'none', font: 'inherit', fontSize: 14 } },
              h('option', { value: 'all' }, t('all')), ...devices.map((d) => h('option', { key: d.id, value: d.id }, d.name))) : null,
          ),
          error ? h('div', { style: { ...S.error, margin: '0 4px 12px' } }, error) : null,
          !data ? h('div', { style: S.empty }, t('loading'))
            : devices.length === 0 && data.discovering ? h('div', { style: { ...S.empty, display: 'flex', alignItems: 'center', gap: 10 } }, h(Spinner, { size: 18 }), t('searching'))
            : devices.length === 0 ? h('div', { style: S.empty }, t('noDevices'))
              : sessions.length === 0 ? h('div', { style: S.empty }, t('noSessions'))
                : sessions.map((s) => h('div', { key: `${s.deviceId}/${s.sessionId}`, role: 'button', tabIndex: 0, style: { ...S.card, opacity: s.connected ? 1 : 0.75 }, onClick: () => open(s), onKeyDown: (e) => { if (e.key === 'Enter') open(s) } },
                  h('div', { style: S.head },
                    h('div', { style: S.iconBox }, s.running && s.connected ? h(Spinner) : h(CodeIcon)),
                    h('div', { style: { minWidth: 0, flex: 1 } },
                      h('div', { style: { display: 'flex', alignItems: 'baseline' } },
                        h('div', { style: S.name }, s.title || t('untitled')),
                        h('div', { style: S.time }, ago(s.updatedAt, t)),
                      ),
                      h('div', { style: S.status },
                        h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, color: s.connected ? GREEN : 'inherit', opacity: s.connected ? 1 : 0.6 } }, h(LaptopIcon, { off: !s.connected }), s.connected ? t('connected') : t('disconnected')),
                        h('span', { style: { opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 } }, `• ${s.deviceName}${s.workspace ? ` • ${s.workspace}` : ''}`),
                      ),
                    ),
                  ),
                  s.waiting ? h('div', { style: { ...S.preview, fontWeight: 600 } }, t('waiting'))
                    : s.last ? h('div', { style: S.preview }, s.last.text) : null,
                )),
          online.length > 0 ? h('button', { style: S.fab, onClick: () => setSheet({ device: online[0].id }) }, h(PlusIcon), t('newSession')) : null,
          sheet ? h(NewSessionSheet, { t, devices: online, initial: sheet.device, onClose: () => setSheet(null) }) : null,
        )
      }
    }

    function NewSessionSheet({ t, devices, initial, onClose }) {
      const [device, setDevice] = useState(initial)
      const [workspaces, setWorkspaces] = useState(null)
      const [workspaceId, setWorkspaceId] = useState('')
      const [text, setText] = useState('')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      useEffect(() => {
        let live = true
        setWorkspaces(null); setError(null)
        api(`/workspaces?device=${encodeURIComponent(device)}`).then((r) => { if (live) { setWorkspaces(r.workspaces); setWorkspaceId(r.workspaces[0] ? r.workspaces[0].id : '') } }, (e) => { if (live) setError(e.message) })
        return () => { live = false }
      }, [device])
      const create = async () => {
        setBusy(true); setError(null)
        try {
          const r = await api('/sessions', { method: 'POST', body: JSON.stringify({ device, workspaceId: workspaceId || undefined, text }) })
          window.location.href = r.openUrl
        } catch (e) { setError(e.message); setBusy(false) }
      }
      const select = { ...S.input, marginTop: 6 }
      return h('div', { style: S.sheetBack, onClick: onClose },
        h('div', { style: S.sheet, onClick: (e) => e.stopPropagation() },
          h('div', { style: { ...S.title, margin: '0 0 16px' } }, t('newSession')),
          devices.length > 1 ? h('label', { style: { display: 'block', marginBottom: 12 } }, t('computer'),
            h('select', { style: select, value: device, onChange: (e) => setDevice(e.target.value) }, ...devices.map((d) => h('option', { key: d.id, value: d.id }, d.name)))) : null,
          h('label', { style: { display: 'block', marginBottom: 12 } }, t('workspace'),
            workspaces ? h('select', { style: select, value: workspaceId, onChange: (e) => setWorkspaceId(e.target.value) }, ...workspaces.map((w) => h('option', { key: w.id, value: w.id }, w.name)))
              : h('div', { style: S.empty }, t('loading'))),
          h('textarea', { style: { ...S.input, minHeight: 90, resize: 'vertical' }, placeholder: t('firstMessage'), defaultValue: '', onInput: (e) => setText(e.target.value) }),
          error ? h('div', { style: S.error }, error) : null,
          h('div', { style: { ...S.row, marginTop: 14, justifyContent: 'flex-end' } },
            h('button', { style: S.pill, onClick: onClose }, t('cancel')),
            h('button', { style: { ...S.pill, fontWeight: 600 }, disabled: busy || !workspaces, onClick: create }, busy ? h(Spinner, { size: 16 }) : h(PlusIcon, { size: 16 }), t('create')),
          ),
        ),
      )
    }

    // --- Ikona „Eksportuj na komputer” przy wierszu sesji (ten sam slot, rozmiar i kolory co ikona „Eksportuj na telefon”
    // z dsh-remote-control na PC). Serwer (POST /api/dsh-code/export) robi natywny eksport sesji i wysyła ją do bramy
    // komputera; ikona jest ukryta, gdy żaden komputer nie zgłasza obsługi przenoszenia (GET /api/dsh-code/transfer).
    const XFER_COPY = {
      pl: {
        send: 'Eksportuj na komputer', sending: 'Wysyłanie na komputer…', done: 'Wysłano na komputer', failed: 'Nie udało się wysłać sesji na komputer',
        ownerHere: 'Synchronizowane z komputerem, piszesz tutaj (dotknij, aby odłączyć)', mirror: 'Lustro sesji z komputera, tylko do odczytu (dotknij, aby odłączyć)',
        diverged: 'Synchronizacja wstrzymana (dotknij, aby odłączyć)', unlinkConfirm: 'Odłączyć synchronizację tej sesji? Obie kopie zostaną, ale przestaną się aktualizować.',
        blocked: 'Ta sesja jest lustrem rozmowy z komputera. Przejmij pisanie, aby kontynuować tutaj.',
        bannerMirror: 'Lustro sesji z komputera: nowe tury pojawiają się tu same.', claim: 'Przejmij pisanie tutaj', claimFailed: 'Nie udało się przejąć pisania',
        paused: 'Synchronizacja wstrzymana', resume: 'Wznów synchronizację', resumeFailed: 'Nie udało się wznowić synchronizacji',
        receiving: 'Odbieram', sendingTo: 'Wysyłam', from: 'z', to: 'na', newSession: 'nową sesję',
      },
      en: {
        send: 'Export to computer', sending: 'Sending to the computer…', done: 'Sent to the computer', failed: 'Could not send the session to the computer',
        ownerHere: 'Synced with the computer, you write here (tap to unlink)', mirror: 'Mirror of the computer session, read-only (tap to unlink)',
        diverged: 'Sync paused (tap to unlink)', unlinkConfirm: 'Unlink sync for this session? Both copies stay but stop updating.',
        blocked: 'This session mirrors a conversation on the computer. Take over writing to continue here.',
        bannerMirror: 'Mirror of the computer session: new turns appear here on their own.', claim: 'Take over writing here', claimFailed: 'Could not take over writing',
        paused: 'Sync paused', resume: 'Resume sync', resumeFailed: 'Could not resume sync',
        receiving: 'Receiving', sendingTo: 'Sending', from: 'from', to: 'to', newSession: 'a new session',
      },
    }
    const xferCopy = () => ((document.documentElement.lang || '').toLowerCase().startsWith('pl') ? XFER_COPY.pl : XFER_COPY.en)
    /** Wspólny stan: komputery do eksportu + powiązania sesji telefonu (synchronizacja), z GET /api/dsh-code/transfer. */
    const transferStore = (() => {
      let state = { targets: [], links: new Map(), active: [] }
      let raw = ''
      const listeners = new Set()
      let timer = null
      async function refresh() {
        try {
          const res = await fetch('/api/dsh-code/transfer', { credentials: 'same-origin', cache: 'no-store' })
          if (!res.ok) { console.warn(`[dsh-code] transfer: HTTP ${res.status}`); return }
          const body = await res.json()
          const next = JSON.stringify([body.targets ?? [], body.links ?? [], body.active ?? []])
          if (next !== raw) {
            if (JSON.stringify(body.targets ?? []) !== JSON.stringify(state.targets)) console.log(`[dsh-code] komputery do eksportu: ${(body.targets ?? []).map((d) => d.name).join(', ') || 'brak'}`)
            raw = next
            state = { targets: body.targets ?? [], links: new Map((body.links ?? []).map((l) => [l.phoneSessionId, l])), active: body.active ?? [] }
            for (const l of listeners) l()
          }
        } catch (error) { console.warn(`[dsh-code] transfer: ${error}`) }
      }
      return {
        refresh,
        /** Szybkie odświeżanie od razu (np. po kliknięciu eksportu), zanim zwykły obieg zauważy transfer. */
        kick() { if (listeners.size > 0) { window.clearTimeout(timer); timer = null; const tick = () => { void refresh().finally(() => { if (listeners.size > 0) timer = window.setTimeout(tick, state.active.length ? 400 : 5000) }) }; tick() } },
        subscribe(listener) {
          listeners.add(listener)
          // W trakcie transferu co 0,4 s (postęp), bez znanych komputerów co 3 s (pierwsze /info trwa kilka sekund),
          // z powiązaniami co 5 s, inaczej co 30 s.
          if (listeners.size === 1) { const tick = () => { void refresh().finally(() => { if (listeners.size > 0) timer = window.setTimeout(tick, state.active.length ? 400 : !state.targets.length ? 3000 : state.links.size ? 5000 : 30000) }) }; tick() }
          return () => { listeners.delete(listener); if (listeners.size === 0 && timer !== null) { window.clearTimeout(timer); timer = null } }
        },
        snapshot: () => state,
      }
    })()
    const useTransfer = () => React.useSyncExternalStore(transferStore.subscribe, transferStore.snapshot)
    const linkStateOf = (link) => (link.diverged || link.paused ? 'diverged' : link.owner === 'phone' ? 'owner' : 'mirror')
    // Puste obiegi synchronizacji nie migają: transfer widać od 300 ms trwania albo od 2 KB.
    const visibleTransfer = (e) => e.ms >= 300 || (e.total ?? e.bytes) > 2048
    const percentOf = (e) => (e.total ? Math.min(100, Math.round((e.bytes / e.total) * 100)) : null)
    const STYLE_ID = 'dsh-code-transfer-style'
    function ensureTransferStyle() {
      if (document.getElementById(STYLE_ID)) return
      const st = document.createElement('style'); st.id = STYLE_ID
      st.textContent = '@keyframes dshcodeFlowIn{0%{transform:translateY(-3px);opacity:.2}60%{opacity:1}100%{transform:translateY(2px);opacity:.2}}' +
        '@keyframes dshcodeFlowOut{0%{transform:translateY(2px);opacity:.2}60%{opacity:1}100%{transform:translateY(-3px);opacity:.2}}' +
        '.dshcode-flow-in{animation:dshcodeFlowIn 1s ease-in-out infinite}.dshcode-flow-out{animation:dshcodeFlowOut 1s ease-in-out infinite}' +
        '@media (prefers-reduced-motion: reduce){.dshcode-flow-in,.dshcode-flow-out{animation:none}}'
      document.head.appendChild(st)
    }
    /** Cienki pasek postępu (bez rozmiaru: tylko pulsujący pasek ruchu). */
    function ProgressBar({ entry, width = '100%' }) {
      const pct = percentOf(entry)
      return h('span', { style: { display: 'block', width, height: 2, borderRadius: 1, background: 'var(--dsw-alias-fill-secondary, rgba(127,127,127,.25))', overflow: 'hidden' } },
        h('span', { className: pct === null ? `dshcode-flow-${entry.dir}` : undefined, style: { display: 'block', height: '100%', width: pct === null ? '100%' : `${pct}%`, background: 'var(--dsw-alias-state-business-primary)', transition: 'width .3s' } }))
    }

    /** Komputer: strzałka w górę (wyślij), haczyk (wysłano), dwie strzałki (piszesz tutaj), kłódka (lustro), wykrzyknik (wstrzymane). */
    function ComputerIcon({ state, size = 14 }) {
      const common = { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
      const screen = h('rect', { x: 1.5, y: 2.5, width: 13, height: 9, rx: 1.4 })
      const stand = h('path', { d: 'M5.5 14h5M8 11.5V14' })
      const marks = {
        done: 'M5.6 7l1.6 1.6 3.2-3.3',
        owner: 'M5.2 6.2h5.2l-1.4-1.3M10.8 7.8H5.6l1.4 1.3',
        mirror: 'M6.2 7.4h3.6v2.4H6.2zM6.9 7.4V6.5a1.1 1.1 0 0 1 2.2 0v.9',
        diverged: 'M8 4.6v3M8 9.4v.1',
        in: 'M8 4.6v4.4M5.9 6.9L8 9l2.1-2.1',    // z komputera do telefonu
        out: 'M8 9.2V4.8M5.9 6.8L8 4.7l2.1 2.1', // z telefonu na komputer
      }
      const flow = state === 'in' || state === 'out'
      if (flow) ensureTransferStyle()
      return h('svg', common, screen, stand, h('path', { d: marks[state] ?? 'M8 9.2V4.8M5.9 6.8L8 4.7l2.1 2.1', className: flow ? `dshcode-flow-${state}` : undefined }))
    }

    function rowButton({ label, state, busy, onClick, hover, setHover, transfer }) {
      if (transfer) {   // transfer w toku: strzałka do/z telefonu + pasek pod ikoną, procent w podpisie
        const c = xferCopy(), pct = percentOf(transfer)
        const text = `${transfer.dir === 'in' ? c.receiving : c.sendingTo}${pct === null ? '…' : ` ${pct}%`}${transfer.device ? ` (${transfer.dir === 'in' ? c.from : c.to} ${transfer.device})` : ''}`
        return h('span', { title: text, 'aria-label': text, role: 'progressbar', 'aria-valuenow': pct ?? undefined, style: { flex: 'none', display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 1, width: 16, color: 'var(--dsw-alias-state-business-primary)' } },
          h(ComputerIcon, { state: transfer.dir }), h(ProgressBar, { entry: transfer, width: 14 }))
      }
      const accent = state === 'busy' || state === 'done' || state === 'owner'
      const color = state === 'diverged' ? 'var(--dsw-alias-state-error-primary, #e5484d)' : accent ? 'var(--dsw-alias-state-business-primary)' : hover ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-tertiary)'
      return h('button', {
        type: 'button', title: label, 'aria-label': label, 'aria-busy': busy, onClick,
        onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false),
        style: {
          flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 16, height: 16, padding: 0, border: 'none', borderRadius: 'var(--dsw-radius-xs)',
          background: 'transparent', cursor: busy ? 'progress' : 'pointer', color, opacity: busy ? 0.5 : 1,
        },
      }, h(ComputerIcon, { state }))
    }

    function ExportToComputerButton({ sessionId }) {
      const { targets, links, active } = useTransfer()
      const [state, setState] = useState('idle')
      const [hover, setHover] = useState(false)
      const link = links.get(sessionId)
      const transfer = active.find((e) => e.sessionId === sessionId && visibleTransfer(e))
      const shownRow = transfer ? transfer.dir : null
      const lastRow = useRef(null)
      useEffect(() => { if (lastRow.current !== shownRow) { if (shownRow || lastRow.current) console.log(`[dsh-code] wiersz sesji ${sessionId}: ${shownRow ? `transfer ${shownRow}` : 'koniec transferu'}`); lastRow.current = shownRow } }, [shownRow])
      if (transfer) return rowButton({ transfer })
      const c = xferCopy()
      if (link) {
        const ls = linkStateOf(link)
        const label = (ls === 'owner' ? c.ownerHere : ls === 'mirror' ? c.mirror : c.diverged) + ` — ${link.deviceName}${link.error ? `: ${link.error}` : ''}`
        const onClick = async (event) => {
          event.preventDefault(); event.stopPropagation()
          if (state === 'busy' || !window.confirm(c.unlinkConfirm)) return
          setState('busy')
          try {
            const res = await fetch(`/api/dsh-code/links/${link.linkId}`, { method: 'DELETE', credentials: 'same-origin' })
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
            await transferStore.refresh()
          } catch (error) { window.alert(error.message) } finally { setState('idle') }
        }
        return rowButton({ label, state: state === 'busy' ? 'busy' : ls, busy: state === 'busy', onClick, hover, setHover })
      }
      if (targets.length === 0) return null
      const label = (state === 'busy' ? c.sending : state === 'done' ? c.done : c.send) + ` (${targets[0].name})`
      async function onClick(event) {
        event.preventDefault(); event.stopPropagation()
        if (state === 'busy') return
        setState('busy')
        transferStore.kick()   // postęp wysyłki widać od razu
        try {
          const res = await fetch('/api/dsh-code/export', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId }) })
          const body = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
          setState('done'); window.setTimeout(() => setState('idle'), 4000)
          void transferStore.refresh()
        } catch (error) {
          setState('idle')
          window.alert(`${c.failed}: ${error.message}`)
        }
      }
      return rowButton({ label, state, busy: state === 'busy', onClick, hover, setHover })
    }

    const sessionIdOf = (session) => session?.sessionId ?? session?.id ?? session?.header?.id

    /** Ikona „Code” w pasku bocznym: w trakcie transferu animowana strzałka (ruch widać z każdego miejsca apki). */
    function CodeNavIcon(props) {
      const { active } = useTransfer()
      const e = active.find(visibleTransfer)
      const shown = e ? e.dir : 'code'
      const last = useRef(null)
      useEffect(() => { if (last.current !== shown) { console.log(`[dsh-code] ikona Code w pasku bocznym: ${shown === 'code' ? 'zwykła' : `strzałka ${shown}`}`); last.current = shown } }, [shown])
      return e ? h(ComputerIcon, { state: e.dir, size: props?.size ?? 20 }) : h(CodeIcon, props)
    }

    /** Transfery bez wiersza na liście (nowa sesja z komputera, jeszcze nie zaimportowana): pasek nad polem pisania. */
    function TransferDock({ all = false } = {}) {
      const { active } = useTransfer()
      const rows = active.filter((e) => (all || !e.sessionId) && visibleTransfer(e))   // all: ekran Code (tam nie ma pola pisania ani wierszy sesji telefonu)
      const lastDock = useRef(0)
      useEffect(() => { if ((rows.length > 0) !== (lastDock.current > 0)) console.log(`[dsh-code] pasek transferu (${all ? 'ekran Code' : 'nad polem pisania'}): ${rows.length ? rows.map((e) => `${e.dir} ${e.title ?? e.sessionId ?? ''}`).join('; ') : 'koniec'}`); lastDock.current = rows.length }, [rows.length])
      if (rows.length === 0) return null
      const c = xferCopy()
      return h('div', { role: 'status', style: { display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 12px', marginBottom: 8, borderRadius: 'var(--dsw-radius-md, 10px)', fontSize: 13, color: 'var(--dsw-alias-label-secondary)', background: 'var(--dsw-alias-fill-secondary, transparent)' } },
        ...rows.map((e, i) => {
          const pct = percentOf(e)
          return h('div', { key: i, style: { display: 'flex', flexDirection: 'column', gap: 4 } },
            h('span', { style: { display: 'flex', alignItems: 'center', gap: 8 } }, h(ComputerIcon, { state: e.dir }),
              `${e.dir === 'in' ? c.receiving : c.sendingTo} ${e.title ? `„${e.title}”` : c.newSession}${e.device ? ` ${e.dir === 'in' ? c.from : c.to} ${e.device}` : ''}${pct === null ? '…' : ` — ${pct}%`}`),
            h(ProgressBar, { entry: e }))
        }))
    }

    /** Pasek nad polem pisania w lustrze: informacja + „Przejmij pisanie tutaj” (dociągnięcie z PC, potem zmiana właściciela). */
    function MirrorBanner({ session }) {
      const { links } = useTransfer()
      const link = links.get(sessionIdOf(session))
      const [busy, setBusy] = useState(false)
      if (!link || (link.owner !== 'pc' && !link.paused)) return null
      const c = xferCopy()
      async function act(path, failed) {
        setBusy(true)
        try {
          const res = await fetch(`/api/dsh-code/links/${link.linkId}/${path}`, { method: 'POST', credentials: 'same-origin' })
          const body = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
          await transferStore.refresh()
        } catch (error) { window.alert(`${failed}: ${error.message}`) } finally { setBusy(false) }
      }
      const claim = () => act('claim', c.claimFailed)
      const resume = () => act('resume', c.resumeFailed)
      return h('div', {
        role: 'status',
        style: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', marginBottom: 8, borderRadius: 'var(--dsw-radius-md, 10px)', fontSize: 13, color: 'var(--dsw-alias-label-secondary)', background: 'var(--dsw-alias-fill-secondary, transparent)', border: '1px solid var(--dsw-alias-border-secondary, transparent)' },
      },
      h(ComputerIcon, { state: link.diverged || link.paused ? 'diverged' : 'mirror' }),
      h('span', { style: { flex: 1 } }, link.paused ? `${c.paused}: ${link.paused.message}` : link.diverged ? link.error : c.bannerMirror),
      link.diverged ? null : h('button', {
        type: 'button', disabled: busy, onClick: link.paused ? resume : claim,
        style: { flex: 'none', padding: '4px 10px', borderRadius: 'var(--dsw-radius-sm, 6px)', cursor: busy ? 'progress' : 'pointer', font: 'inherit', fontSize: 13, border: 'none', background: 'var(--dsw-alias-state-business-primary)', color: 'var(--dsw-alias-label-on-color, #fff)' },
      }, link.paused ? c.resume : c.claim))
    }

    /** Blokada pola pisania dla luster (jak na PC: conversation.blocks), podnoszona i zdejmowana ze stanem powiązań. */
    function syncComposerBlocks(ctx) {
      const blocked = new Set()
      const apply = () => {
        const blocks = ctx.conversation?.blocks
        if (!blocks) return
        const now = new Set()
        for (const [id, link] of transferStore.snapshot().links) if (link.owner === 'pc') now.add(id)
        for (const id of now) if (!blocked.has(id)) blocks.set(id, { reason: xferCopy().blocked })
        for (const id of blocked) if (!now.has(id)) blocks.set(id, undefined)
        blocked.clear()
        for (const id of now) blocked.add(id)
      }
      const unsubscribe = transferStore.subscribe(apply)
      ctx.effect(() => () => { unsubscribe(); for (const id of blocked) ctx.conversation?.blocks?.set(id, undefined) }, 'dsh-code: blokady luster')
    }

    return {
      inject: ['slots', 'locale', 'layout', 'conversation'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh: en }), 'dsh-code: locale en/zh')
        ctx.effect(() => ctx.locale.register(NS, 'pl', pl), 'dsh-code: locale pl')
        const t = ctx.locale.bind(NS)
        const Page = makePage(t)
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL, locale: NS }, Page))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 5, label: () => t('code'), locale: NS }, CodeNavIcon))
        try {
          ctx.slots.inject('sidebar.workspaces.session.row.action', () => ctx.slots.register({ name: 'sidebar.workspaces.session.row.action', id: 'dsh-code.export-to-computer', order: 50 }, ExportToComputerButton))
          ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'dsh-code.mirror-banner', order: 50 }, MirrorBanner))
          ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'dsh-code.transfer-dock', order: 40 }, TransferDock))
          syncComposerBlocks(ctx)
        } catch (error) { console.error(`[dsh-code] slot ikony: ${error?.stack ?? error}`) }
      },
    }
  },
})

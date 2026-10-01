// dsh-code: ekran „Code” w pasku bocznym DSH na telefonie (format ladowarki modulow klienta DSH).
// Lista komputerow z wtyczka dsh-remote-tailscale i ich sesji; dotkniecie sesji otwiera ja z komputera
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
      noDevices: 'Add a computer running the dsh-remote-tailscale plugin by its Tailscale address, e.g. pc.tail1234.ts.net',
      noSessions: 'No sessions yet', offline: 'This computer is not reachable right now.', computer: 'Computer', workspace: 'Workspace',
      firstMessage: 'First message (optional)', create: 'Create', now: 'now', loading: 'Loading…',
    }
    const pl = {
      code: 'Code', devices: 'Urządzenia', addDevice: 'Dodaj urządzenie', address: 'Adres komputera w Tailscale', add: 'Dodaj', cancel: 'Anuluj',
      sessions: 'Sesje', all: 'Wszystkie', connected: 'Połączono', disconnected: 'Rozłączono', newSession: 'Nowa sesja',
      untitled: 'Sesja bez tytułu', waiting: 'Czeka na Twoje zatwierdzenie', remove: 'Usuń',
      noDevices: 'Dodaj komputer z wtyczką dsh-remote-tailscale, podając jego adres z Tailscale, np. pc.tail1234.ts.net',
      noSessions: 'Brak sesji', offline: 'Ten komputer jest teraz niedostępny.', computer: 'Komputer', workspace: 'Obszar roboczy',
      firstMessage: 'Pierwsza wiadomość (opcjonalnie)', create: 'Utwórz', now: 'teraz', loading: 'Wczytywanie…',
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
        const open = (s) => { if (!s.connected) { setError(t('offline')); return } window.location.href = `${s.deviceUrl}?dshOpen=${encodeURIComponent(s.sessionId)}` }

        const devices = data ? data.devices : []
        const sessions = data ? data.sessions.filter((s) => filter === 'all' || s.deviceId === filter) : []
        const online = devices.filter((d) => d.connected)

        return h('div', { style: S.page },
          h('div', { style: S.title }, t('code')),
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
            h('input', { style: S.input, value: address, placeholder: 'pc.tail1234.ts.net', 'aria-label': t('address'), autoFocus: true, inputMode: 'url', autoCapitalize: 'none', autoCorrect: 'off', onChange: (e) => setAddress(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') addDevice() } }),
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
          h('textarea', { style: { ...S.input, minHeight: 90, resize: 'vertical' }, placeholder: t('firstMessage'), value: text, onChange: (e) => setText(e.target.value) }),
          error ? h('div', { style: S.error }, error) : null,
          h('div', { style: { ...S.row, marginTop: 14, justifyContent: 'flex-end' } },
            h('button', { style: S.pill, onClick: onClose }, t('cancel')),
            h('button', { style: { ...S.pill, fontWeight: 600 }, disabled: busy || !workspaces, onClick: create }, busy ? h(Spinner, { size: 16 }) : h(PlusIcon, { size: 16 }), t('create')),
          ),
        ),
      )
    }

    return {
      inject: ['slots', 'locale', 'layout'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh: en }), 'dsh-code: locale en/zh')
        ctx.effect(() => ctx.locale.register(NS, 'pl', pl), 'dsh-code: locale pl')
        const t = ctx.locale.bind(NS)
        const Page = makePage(t)
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL, locale: NS }, Page))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 5, label: () => t('code'), locale: NS }, CodeIcon))
      },
    }
  },
})

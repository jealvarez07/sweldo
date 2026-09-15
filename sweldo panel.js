/**
 * sweldo-panel.js — the Sweldo Check section of the founder dashboard.
 *
 * Drop-in. Two edits to metrics.html and nothing else:
 *
 *   1. put this where the section should appear:
 *        <div id="sweldo-panel"></div>
 *   2. before </body>:
 *        <script type="module" src="./sweldo-panel.js"></script>
 *
 * It brings its own styles, scoped under #sweldo-panel, so it cannot collide
 * with the dashboard's CSS. It calls ONE function on the Sweldo project —
 * sweldo_metrics() — which returns aggregates only. No row of decoder_events
 * is readable by this page or any other.
 *
 * Every number here is honest about its sample. A metric with too few
 * observations prints "waiting", never a figure dressed up as a finding.
 */

const CONFIG = {
  url: 'https://fhcowwnpdvqjsrrhfhfa.supabase.co',
  key: 'sb_publishable_ti6eVGMkou37JNugRR1a_Q_4vlqbKst',
};

/* ------------------------------------------------------------------ */
/* Hypotheses — the point of the panel                                 */
/* ------------------------------------------------------------------ */

/**
 * Each one is a claim that can be wrong, a number that decides it, and the
 * sample below which the number means nothing. `read` returns the current
 * value or null. Order is the order they matter in.
 */
const HYPOTHESES = [
  {
    id: 'H1',
    claim: 'A payslip explainer makes people come back. Not just read once and leave.',
    metric: 'Share of visits that are return visits',
    target: 15, unit: '%', minSample: 200, sampleLabel: 'visits',
    read: d => d.return_pct, sample: d => d.events,
    ifFalse: 'The decoder is a leaflet, not a product. Stop building on it.',
  },
  {
    id: 'H2',
    claim: 'People will tell us one thing about themselves in exchange for an answer.',
    metric: 'Visits that answered the question',
    target: 30, unit: '%', minSample: 100, sampleLabel: 'visits',
    read: d => d.answer_pct, sample: d => d.events,
    ifFalse: 'The salary database never gets built. Drop it from the roadmap.',
  },
  {
    id: 'H3',
    claim: 'Enough people share a job family to publish a real pay range.',
    metric: 'Job families with 5 or more reports',
    target: 3, unit: ' families', minSample: 1, sampleLabel: 'visits',
    read: d => (d.pay_by_family || []).length, sample: d => d.events,
    ifFalse: 'Saturate two job families instead of spreading across eleven.',
  },
  {
    id: 'H4',
    claim: 'Comparing two offers is a real job, not a feature we imagined.',
    metric: 'Calculations done in Two offers',
    target: 10, unit: '%', minSample: 150, sampleLabel: 'visits',
    read: d => d.events ? round1(100 * d.mode_cmp / d.events) : null,
    sample: d => d.events,
    ifFalse: 'Cut the compare tab. One screen, one job.',
  },
  {
    id: 'H5',
    claim: 'Allowances are common enough to have been worth building.',
    metric: 'Entries that split out an allowance',
    target: 20, unit: '%', minSample: 100, sampleLabel: 'entries with basic pay',
    read: d => d.allowance_pct, sample: d => d.with_basic,
    ifFalse: 'Fold the allowance box away by default and stop maintaining it.',
  },
  {
    id: 'H6',
    claim: 'People come back around payday, which is what a payday product needs.',
    metric: 'Median days between first and return visit',
    target: 30, unit: ' days', minSample: 30, sampleLabel: 'returners',
    read: d => d.median_return_days, sample: d => d.returners,
    band: [12, 35],   // a window, not a floor: 15th and 30th are both paydays
    ifFalse: 'They come back for a reason other than payday. Find out which.',
  },
];

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const round1 = n => Math.round(n * 10) / 10;
const num = n => (n == null ? '—' : Number(n).toLocaleString('en-PH'));
const peso = n => (n == null ? '—' : '₱' + Number(n).toLocaleString('en-PH', { maximumFractionDigits: 0 }));
const pct = n => (n == null ? '—' : round1(n) + '%');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

function verdictFor(h, d) {
  const value = h.read(d);
  const n = h.sample(d) || 0;
  if (n < h.minSample) {
    return { state: 'waiting', label: 'Waiting', value,
      note: `${num(n)} of ${num(h.minSample)} ${h.sampleLabel}` };
  }
  if (value == null) return { state: 'waiting', label: 'Waiting', value, note: 'no reading yet' };
  const ok = h.band
    ? (value >= h.band[0] && value <= h.band[1])
    : (value >= h.target);
  return { state: ok ? 'pass' : 'fail', label: ok ? 'Holding' : 'Not holding', value, note: '' };
}

/* ------------------------------------------------------------------ */
/* Styles — scoped, both themes, brand tokens                          */
/* ------------------------------------------------------------------ */

const CSS = `
#sweldo-panel{
  --sp-bg:#F5F7F4; --sp-surface:#FFFFFF; --sp-surface-2:#ECF0EA;
  --sp-ink:#16211A; --sp-ink-2:#2A3230; --sp-ink-3:#68705F;
  --sp-line:#E8ECE6; --sp-line-soft:#F0F3EF;
  --sp-good:#0E8A5F; --sp-warn:#B07C13; --sp-bad:#C4485E;
  --sp-bar:#0E8A5F; --sp-grid:#E8ECE6;
  --sp-font:'Onest','Helvetica Neue',system-ui,sans-serif;
  --sp-mono:'IBM Plex Mono',ui-monospace,Menlo,monospace;
  font-family:var(--sp-font); color:var(--sp-ink);
  margin-block:40px;
}
@media (prefers-color-scheme: dark){
  #sweldo-panel{
    --sp-bg:#0F1613; --sp-surface:#171E1A; --sp-surface-2:#1F2723;
    --sp-ink:#E8ECE6; --sp-ink-2:#B4BEB7; --sp-ink-3:#9AA394;
    --sp-line:rgba(255,255,255,.12); --sp-line-soft:rgba(255,255,255,.07);
    --sp-good:#3FCF9A; --sp-warn:#EAC77A; --sp-bad:#E8808F;
    --sp-bar:#3FCF9A; --sp-grid:rgba(255,255,255,.12);
  }
}
html[data-theme="dark"] #sweldo-panel{
  --sp-bg:#0F1613; --sp-surface:#171E1A; --sp-surface-2:#1F2723;
  --sp-ink:#E8ECE6; --sp-ink-2:#B4BEB7; --sp-ink-3:#9AA394;
  --sp-line:rgba(255,255,255,.12); --sp-line-soft:rgba(255,255,255,.07);
  --sp-good:#3FCF9A; --sp-warn:#EAC77A; --sp-bad:#E8808F;
  --sp-bar:#3FCF9A; --sp-grid:rgba(255,255,255,.12);
}
#sweldo-panel *{box-sizing:border-box}
#sweldo-panel .sp-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:4px}
#sweldo-panel h2{
  font-size:20px;font-weight:800;letter-spacing:-.02em;margin:0;color:var(--sp-ink);
}
#sweldo-panel .sp-by{
  font-family:var(--sp-mono);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--sp-ink-3);
}
#sweldo-panel .sp-sub{font-size:13.5px;color:var(--sp-ink-2);margin:0 0 18px;max-width:70ch}

#sweldo-panel .sp-tiles{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:22px}
#sweldo-panel .sp-tile{
  background:var(--sp-surface);border:1px solid var(--sp-line);border-radius:12px;padding:13px 15px;
}
#sweldo-panel .sp-tile .k{
  font-family:var(--sp-mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;
  color:var(--sp-ink-3);display:block;margin-bottom:6px;
}
#sweldo-panel .sp-tile .v{
  font-family:var(--sp-mono);font-variant-numeric:tabular-nums;font-size:24px;font-weight:600;
  letter-spacing:-.02em;display:block;line-height:1.1;
}
#sweldo-panel .sp-tile .s{font-size:12px;color:var(--sp-ink-3);display:block;margin-top:4px}

#sweldo-panel h3{
  font-family:var(--sp-mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;
  color:var(--sp-ink-3);font-weight:600;margin:26px 0 10px;
}
#sweldo-panel .sp-hyp{display:grid;gap:8px}
#sweldo-panel .sp-h{
  background:var(--sp-surface);border:1px solid var(--sp-line);border-radius:12px;
  padding:13px 15px;display:grid;gap:8px;grid-template-columns:1fr auto;align-items:start;
}
#sweldo-panel .sp-h .claim{font-size:14.5px;font-weight:600;letter-spacing:-.01em;margin:0 0 3px}
#sweldo-panel .sp-h .id{
  font-family:var(--sp-mono);font-size:10.5px;color:var(--sp-ink-3);margin-right:7px;
}
#sweldo-panel .sp-h .mx{font-size:12.5px;color:var(--sp-ink-3);margin:0}
#sweldo-panel .sp-h .fail-note{font-size:12.5px;color:var(--sp-ink-2);margin:6px 0 0}
#sweldo-panel .sp-read{text-align:right;white-space:nowrap}
#sweldo-panel .sp-read .now{
  font-family:var(--sp-mono);font-variant-numeric:tabular-nums;font-size:19px;font-weight:600;display:block;
}
#sweldo-panel .sp-read .tgt{font-family:var(--sp-mono);font-size:11px;color:var(--sp-ink-3);display:block;margin-top:2px}
#sweldo-panel .pill{
  display:inline-block;font-family:var(--sp-mono);font-size:9.5px;font-weight:600;
  letter-spacing:.1em;text-transform:uppercase;padding:3px 8px;border-radius:999px;margin-top:6px;
}
#sweldo-panel .pill.pass{background:rgba(14,138,95,.12);color:var(--sp-good)}
#sweldo-panel .pill.fail{background:rgba(196,72,94,.12);color:var(--sp-bad)}
#sweldo-panel .pill.waiting{background:var(--sp-surface-2);color:var(--sp-ink-3)}

#sweldo-panel .sp-chart{
  background:var(--sp-surface);border:1px solid var(--sp-line);border-radius:12px;padding:16px 16px 10px;
}
#sweldo-panel .sp-bars{display:flex;align-items:flex-end;gap:2px;height:132px;position:relative}
#sweldo-panel .sp-bars{padding-left:30px}
#sweldo-panel .sp-bars .gl{
  position:absolute;left:30px;right:0;border-top:1px solid var(--sp-grid);opacity:.7;
}
#sweldo-panel .sp-bars .gl .tick{
  position:absolute;right:calc(100% + 6px);top:-7px;
  font-family:var(--sp-mono);font-size:9.5px;color:var(--sp-ink-3);white-space:nowrap;
}
#sweldo-panel .sp-col{
  flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:stretch;
  height:100%;position:relative;cursor:default;
}
#sweldo-panel .sp-bar{
  background:var(--sp-bar);border-radius:4px 4px 0 0;min-height:2px;
}
#sweldo-panel .sp-col .lab{
  font-family:var(--sp-mono);font-size:9.5px;color:var(--sp-ink-3);text-align:center;
  margin-top:6px;white-space:nowrap;
}
#sweldo-panel .sp-col .val{
  font-family:var(--sp-mono);font-size:10.5px;font-weight:600;color:var(--sp-ink);
  text-align:center;margin-bottom:4px;
}
#sweldo-panel .sp-tip{
  position:absolute;z-index:20;background:var(--sp-ink);color:var(--sp-bg);
  font-family:var(--sp-mono);font-size:11px;padding:6px 9px;border-radius:7px;
  pointer-events:none;white-space:nowrap;transform:translate(-50%,-115%);opacity:0;transition:opacity .1s;
}
#sweldo-panel .sp-tip.on{opacity:1}

#sweldo-panel .sp-axisnote{font-size:11.5px;color:var(--sp-ink-3);margin:4px 0 8px}
#sweldo-panel .sp-tw{overflow-x:auto}
#sweldo-panel table{border-collapse:collapse;width:100%;font-size:13.5px;table-layout:auto}
#sweldo-panel table.wide{min-width:460px}
#sweldo-panel td:first-child{word-break:break-word}
#sweldo-panel th,#sweldo-panel td{
  text-align:left;padding:8px 10px;border-bottom:1px solid var(--sp-line);
}
#sweldo-panel th{
  font-family:var(--sp-mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--sp-ink-3);font-weight:600;
}
#sweldo-panel td.n{font-family:var(--sp-mono);font-variant-numeric:tabular-nums;text-align:right}
#sweldo-panel tbody tr:last-child td{border-bottom:0}
#sweldo-panel .sp-empty{
  background:var(--sp-surface-2);border-radius:12px;padding:18px 20px;
  font-size:14px;color:var(--sp-ink-2);line-height:1.5;
}
#sweldo-panel .sp-stamp{
  font-family:var(--sp-mono);font-size:10.5px;color:var(--sp-ink-3);margin-top:14px;
}
#sweldo-panel .sp-cols{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(290px,1fr))}
#sweldo-panel .sp-full{margin-top:8px}
@media (prefers-reduced-motion: reduce){#sweldo-panel *{transition:none!important}}
`;

/* ------------------------------------------------------------------ */
/* Render                                                              */
/* ------------------------------------------------------------------ */

function tiles(d) {
  const t = [
    ['Visits, 30 days', num(d.events_30d), `${num(d.events_7d)} in the last 7`],
    ['Return rate', pct(d.return_pct), `${num(d.returns)} of ${num(d.events)} visits`],
    ['Gave an answer', pct(d.answer_pct), `${num(d.answered)} answers`],
    ['Median pay seen', peso(d.median_gross), 'monthly, rounded to ₱100'],
  ];
  return `<div class="sp-tiles">` + t.map(([k, v, s]) =>
    `<div class="sp-tile"><span class="k">${k}</span><span class="v">${v}</span><span class="s">${esc(s)}</span></div>`
  ).join('') + `</div>`;
}

function board(d) {
  return `<h3>Hypotheses</h3><div class="sp-hyp">` + HYPOTHESES.map(h => {
    const v = verdictFor(h, d);
    const shown = v.value == null ? '—'
      : (h.unit === '%' ? pct(v.value) : num(v.value) + h.unit);
    const targetText = h.band
      ? `between ${h.band[0]} and ${h.band[1]} days`
      : `target ${h.target}${h.unit}`;
    return `<div class="sp-h">
      <div>
        <p class="claim"><span class="id">${h.id}</span>${esc(h.claim)}</p>
        <p class="mx">${esc(h.metric)} · ${esc(targetText)}</p>
        ${v.state === 'fail' ? `<p class="fail-note"><strong>If this stays false:</strong> ${esc(h.ifFalse)}</p>` : ''}
      </div>
      <div class="sp-read">
        <span class="now">${shown}</span>
        <span class="tgt">${v.note ? esc(v.note) : targetText}</span>
        <span class="pill ${v.state}">${v.label}</span>
      </div>
    </div>`;
  }).join('') + `</div>`;
}

function weekly(d) {
  const rows = (d.weekly || []).slice().reverse();   // oldest left
  if (!rows.length) return '';
  const max = Math.max(20, ...rows.map(r => Number(r.return_pct) || 0));
  const last = rows.length - 1;
  const bars = rows.map((r, i) => {
    const v = Number(r.return_pct) || 0;
    const h = Math.max(2, Math.round((v / max) * 100));
    const d8 = new Date(r.week);
    const lab = d8.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
    return `<div class="sp-col" data-week="${esc(lab)}" data-v="${v}" data-n="${r.events}">
        ${i === last ? `<span class="val">${v}%</span>` : ''}
        <div class="sp-bar" style="height:${h}%"></div>
      </div>`;
  }).join('');
  const labels = rows.map((r, i) => {
    const d8 = new Date(r.week);
    const lab = (i === 0 || i === last) ? d8.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) : '';
    return `<div class="sp-col"><span class="lab">${lab}</span></div>`;
  }).join('');

  const halfLabel = Math.round(max / 2);
  return `<h3>Return rate by week</h3>
    <div class="sp-chart">
      <div class="sp-bars" id="sp-bars">
        <div class="gl" style="bottom:100%"><span class="tick">${max}%</span></div>
        <div class="gl" style="bottom:50%"><span class="tick">${halfLabel}%</span></div>
        ${bars}
        <div class="sp-tip" id="sp-tip"></div>
      </div>
      <div class="sp-bars" style="height:auto;align-items:flex-start">${labels}</div>
      <p class="sp-axisnote">Share of that week's visits that came from a device which had been here before.</p>
    </div>`;
}

function tableBlock(title, head, rows, empty, wide) {
  if (!rows.length) return `<div><h3>${title}</h3><div class="sp-empty">${empty}</div></div>`;
  return `<div><h3>${title}</h3><div class="sp-tw"><table class="${wide ? 'wide' : ''}">
    <thead><tr>${head.map((h, i) => `<th${i ? ' class="n"' : ''}>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td${i ? ' class="n"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div></div>`;
}

function render(root, d) {
  if (!d.events) {
    root.innerHTML = `<div class="sp-head"><h2>Sweldo Check</h2><span class="sp-by">by IponPal</span></div>
      <p class="sp-sub">The payslip decoder. This panel reads aggregates only — no row of anyone's salary is readable from here.</p>
      <div class="sp-empty"><strong>Nothing recorded yet.</strong> The page is live and the table is connected;
      no one has used it. That is the expected state until the first post goes out.</div>`;
    return;
  }

  root.innerHTML = `
    <div class="sp-head"><h2>Sweldo Check</h2><span class="sp-by">by IponPal</span></div>
    <p class="sp-sub">The payslip decoder. This panel reads aggregates only — no row of anyone's salary is
      readable from here, including by this page. Groups smaller than ${d.k} are never reported.</p>
    ${tiles(d)}
    ${board(d)}
    ${weekly(d)}
    <div class="sp-full">
      ${tableBlock('Pay by job family', ['Family', 'Reports', 'p25', 'Median', 'p75'],
        (d.pay_by_family || []).map(r => [esc(r.bucket), num(r.n), peso(r.p25), peso(r.p50), peso(r.p75)]),
        `No family has reached ${d.k} reports yet. Nothing can be published until one does.`, true)}
    </div>
    <div class="sp-cols" style="margin-top:8px">
      ${tableBlock('Which question gets answered', ['Question', 'Answers'],
        (d.answers || []).map(r => [esc(r.key), num(r.n)]),
        'No one has answered the question yet.')}
      ${tableBlock('Where they came from', ['Source', 'Visits'],
        (d.sources || []).map(r => [esc(r.source), num(r.n)]),
        'No referrers recorded.')}
      ${tableBlock('How it was used', ['Mode', 'Visits'], [
        ['My pay', num(d.mode_take)],
        ['Worked backwards', num(d.mode_rev)],
        ['Two offers', num(d.mode_cmp)],
        ['Semi-monthly', num(d.semi_monthly)],
        ['Minimum wage', num(d.mwe)],
      ], '')}
    </div>
    <p class="sp-stamp">First visit ${d.first_seen ? new Date(d.first_seen).toLocaleDateString('en-PH') : '—'} ·
      last ${d.last_seen ? new Date(d.last_seen).toLocaleString('en-PH') : '—'} ·
      read ${new Date(d.generated_at).toLocaleString('en-PH')}</p>`;

  hoverBars(root);
}

/** A bar chart in a browser is interactive. Give it the tooltip. */
function hoverBars(root) {
  const wrap = root.querySelector('#sp-bars');
  const tip = root.querySelector('#sp-tip');
  if (!wrap || !tip) return;
  wrap.addEventListener('pointermove', e => {
    const col = e.target.closest('.sp-col');
    if (!col || !col.dataset.week) { tip.classList.remove('on'); return; }
    const r = wrap.getBoundingClientRect(), c = col.getBoundingClientRect();
    tip.textContent = `${col.dataset.week} · ${col.dataset.v}% of ${col.dataset.n}`;
    tip.style.left = (c.left - r.left + c.width / 2) + 'px';
    tip.style.top = (c.top - r.top) + 'px';
    tip.classList.add('on');
  });
  wrap.addEventListener('pointerleave', () => tip.classList.remove('on'));
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

(async function boot() {
  const root = document.getElementById('sweldo-panel');
  if (!root) return;

  if (!document.getElementById('sweldo-panel-css')) {
    const st = document.createElement('style');
    st.id = 'sweldo-panel-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  root.innerHTML = `<div class="sp-head"><h2>Sweldo Check</h2></div><p class="sp-sub">Reading…</p>`;

  try {
    const res = await fetch(`${CONFIG.url}/rest/v1/rpc/sweldo_metrics`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: CONFIG.key,
        Authorization: `Bearer ${CONFIG.key}`,
      },
      body: '{}',
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    render(root, await res.json());
  } catch (err) {
    root.innerHTML = `<div class="sp-head"><h2>Sweldo Check</h2></div>
      <div class="sp-empty"><strong>Could not read the Sweldo project.</strong>
      ${esc(String(err.message || err))}. Check that <code>003_sweldo_metrics.sql</code> has been run,
      and that the URL and key at the top of this file match the Sweldo project.</div>`;
  }
})();

/* Token Radar — the dashboard's behaviour. No network, no fetch: every
   figure comes from window.RADAR, the dataset main.ts generated from the
   sealed snapshot. */

const R = window.RADAR;
const rows = R.rows;
const bySlug = new Map(rows.map((r) => [r.slug, r]));

const state = {
  sort: 'implied_value_usd',
  dir: -1,
  q: '',
  category: '',
  chain: '',
  band: '',
  watchlistOnly: false,
};

/* ---- formatting (en-US, fixed everywhere) ---- */

function fmtCompact(v) {
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + v.toLocaleString('en-US');
}

function fmtFull(v) {
  return '$' + v.toLocaleString('en-US');
}

function fmtChange(c) {
  if (c === null) return '<span class="muted">—</span>';
  if (c > 0) return '<span class="up">+' + c.toFixed(1) + '%</span>';
  if (c < 0) return '<span class="down">' + c.toFixed(1) + '%</span>';
  return '<span class="muted">0.0%</span>';
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const VERDICT_ORDER = { 'Farm now': 0, Watch: 1, Skip: 2 };
const VERDICT_CLASS = { 'Farm now': 'verdict-farm', Watch: 'verdict-watch', Skip: 'verdict-skip' };

function verdictBadge(v) {
  return '<span class="verdict ' + VERDICT_CLASS[v] + '">' + esc(v) + '</span>';
}

/* ---- the board ---- */

function filteredRows() {
  const q = state.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (state.watchlistOnly && !r.watchlist) return false;
    if (state.category && r.category !== state.category) return false;
    if (state.chain && !r.chains.includes(state.chain)) return false;
    if (state.band === 'farm' && r.implied_value_usd < 50000000) return false;
    if (state.band === 'watch' && (r.implied_value_usd < 10000000 || r.implied_value_usd >= 50000000)) return false;
    if (state.band === 'low' && r.implied_value_usd >= 10000000) return false;
    if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.toLowerCase().indexOf(q) === -1) return false;
    return true;
  });
}

function sortedRows(list) {
  const key = state.sort;
  const dir = state.dir;
  return list.slice().sort((a, b) => {
    let av = a[key];
    let bv = b[key];
    if (key === 'verdict') {
      av = VERDICT_ORDER[a.verdict];
      bv = VERDICT_ORDER[b.verdict];
    }
    if (key === 'name') {
      return dir * (av < bv ? -1 : av > bv ? 1 : 0);
    }
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (av !== bv) return dir * (av < bv ? -1 : 1);
    return a.slug < b.slug ? -1 : 1;
  });
}

function renderBoard() {
  const list = sortedRows(filteredRows());
  const body = document.getElementById('board-body');
  body.innerHTML = list
    .map((r) => {
      const age = r.age_days + 'd' + (r.age_estimated ? ' *' : '');
      const badge = r.watchlist ? '<span class="watch-badge">watchlist</span>' : '';
      return (
        '<tr>' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><span class="name"><a href="#/protocol/' + esc(r.slug) + '">' + esc(r.name) + '</a></span>' +
        '<span class="slug">' + esc(r.slug) + '</span>' + badge + '</td>' +
        '<td class="num"><b>' + fmtCompact(r.implied_value_usd) + '</b></td>' +
        '<td class="num">' + fmtCompact(r.tvl_usd) + '</td>' +
        '<td class="num">' + fmtChange(r.change_7d) + '</td>' +
        '<td class="num">' + age + '</td>' +
        '<td>' + verdictBadge(r.verdict) + '</td>' +
        '</tr>'
      );
    })
    .join('');
  document.getElementById('result-count').textContent =
    'Showing ' + list.length + ' of ' + rows.length + ' protocols' +
    (state.watchlistOnly ? ' — watchlist only' : '') + '.';
  document.querySelectorAll('#board th[data-sort]').forEach((th) => {
    th.removeAttribute('aria-sort');
    if (th.getAttribute('data-sort') === state.sort) {
      th.setAttribute('aria-sort', state.dir === 1 ? 'ascending' : 'descending');
    }
  });
}

/* ---- the detail view ---- */

function renderDetail(slug) {
  const r = bySlug.get(slug);
  const host = document.getElementById('detail');
  if (!r) {
    host.innerHTML = '<h2>Protocol not found</h2><p>No ranked protocol has the slug “' + esc(slug) + '”.</p>';
    return;
  }
  const w = r.walkthrough;
  const shownChains = r.chains.length > 4 ? r.chains.slice(0, 4).join(', ') + ' +' + (r.chains.length - 4) + ' more' : r.chains.join(', ');
  const meta = [
    '<span>TVL <b>' + fmtFull(r.tvl_usd) + '</b></span>',
    '<span>Category <b>' + esc(r.category === null ? 'Not reported' : r.category) + '</b></span>',
    '<span>Chains <b>' + esc(shownChains) + '</b></span>',
    '<span>Listed <b>' + esc(r.listed_at === null ? 'Not reported' : r.listed_at) + '</b></span>',
    '<span>7-day change <b>' + (r.change_7d === null ? 'Not reported' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(2) + '%') + '</b></span>',
    r.watchlist ? '<span><b>On the watchlist</b></span>' : '',
  ].join('');
  const verdictClass = r.verdict === 'Farm now' ? '' : r.verdict === 'Watch' ? ' watch' : ' skip';
  host.innerHTML =
    '<div class="detail-head">' +
    '<h2>' + esc(r.name) + '</h2>' +
    '<p class="detail-meta">' + meta + '</p>' +
    '</div>' +
    '<p><strong>Rank ' + r.rank + ' of ' + rows.length + '</strong> · implied value <strong>' + fmtFull(r.implied_value_usd) + '</strong> · ' + verdictBadge(r.verdict) + '</p>' +
    '<p class="verdict-line' + verdictClass + '"><strong>' + esc(r.verdict) + '.</strong> ' + esc(r.verdict_reason) + '</p>' +
    '<h3>How the value is built</h3>' +
    '<ol class="walk">' +
    '<li>' + esc(w.tvlLine) + '</li>' +
    '<li>' + esc(w.multipleLine) + '</li>' +
    '<li>' + esc(w.momentumLine) + '</li>' +
    '<li>' + esc(w.maturityLine) + '</li>' +
    '<li>' + esc(w.resultLine) + '</li>' +
    '</ol>' +
    (r.age_estimated ? '<p class="muted">* Age estimated: this protocol reports no listing date, so the median age of the ranked protocols (' + R.coverage.median_age_days + ' days) is used.</p>' : '') +
    '<h3>Farm plan</h3>' +
    '<ol class="farm">' +
    r.farm_steps.map((s) => '<li>' + esc(s) + '</li>').join('') +
    '</ol>';
}

/* ---- live tokens ---- */

function renderLive() {
  document.getElementById('live-body').innerHTML = R.live_tokens
    .map((p, i) => {
      return (
        '<tr>' +
        '<td class="num">' + (i + 1) + '</td>' +
        '<td><span class="name">' + esc(p.name) + '</span><span class="slug">' + esc(p.slug) + '</span></td>' +
        '<td class="num"><b>' + fmtCompact(p.mcap_usd) + '</b></td>' +
        '<td class="num">' + fmtCompact(p.tvl_usd) + '</td>' +
        '<td class="num">' + fmtChange(p.change_7d) + '</td>' +
        '</tr>'
      );
    })
    .join('');
}

/* ---- methodology ---- */

function renderMethodology() {
  document.getElementById('global-median').textContent = R.comparables.global_median.toFixed(3);
  document.getElementById('global-n').textContent = String(R.comparables.global_n);
  document.getElementById('comparables-body').innerHTML = R.comparables.table
    .map((c) => {
      return (
        '<tr>' +
        '<td>' + esc(c.category) + '</td>' +
        '<td class="num">' + c.median.toFixed(3) + '</td>' +
        '<td class="num">' + c.n + '</td>' +
        '<td>' + (c.source === 'category' ? 'Category median' : 'Global median') + '</td>' +
        '</tr>'
      );
    })
    .join('');
  const cov = R.coverage;
  document.getElementById('coverage-note').textContent =
    'The board ranks ' + cov.board_rows + ' protocols: all ' + cov.watchlist_total +
    ' watchlist protocols, plus ' + cov.early_count + ' early candidates found beyond it. ' +
    'Median age of the ranked protocols is ' + cov.median_age_days + ' days.';
}

/* ---- routing ---- */

function show(viewId) {
  document.querySelectorAll('.view').forEach((v) => {
    v.hidden = v.id !== viewId;
  });
  window.scrollTo(0, 0);
}

function route() {
  const hash = window.location.hash || '#/';
  if (hash.indexOf('#/protocol/') === 0) {
    renderDetail(decodeURIComponent(hash.slice('#/protocol/'.length)));
    show('view-detail');
  } else if (hash === '#/live') {
    renderLive();
    show('view-live');
  } else if (hash === '#/methodology') {
    renderMethodology();
    show('view-methodology');
  } else {
    renderBoard();
    show('view-board');
  }
}

/* ---- setup ---- */

function fillSelect(id, values) {
  const sel = document.getElementById(id);
  values.forEach((v) => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  });
}

function init() {
  const cov = R.coverage;
  document.getElementById('coverage').innerHTML =
    '<strong>' + cov.watchlist_covered + '/' + cov.watchlist_total + '</strong> watchlist covered · ' +
    '<strong>' + cov.early_count + '</strong> early candidates found beyond it · ' +
    cov.board_rows + ' protocols ranked';

  const categories = [...new Set(rows.map((r) => r.category).filter((c) => c !== null))].sort();
  fillSelect('f-category', categories);
  const chains = [...new Set(rows.flatMap((r) => r.chains))].sort();
  fillSelect('f-chain', chains);

  document.getElementById('q').addEventListener('input', (e) => {
    state.q = e.target.value;
    renderBoard();
  });
  document.getElementById('f-category').addEventListener('change', (e) => {
    state.category = e.target.value;
    renderBoard();
  });
  document.getElementById('f-chain').addEventListener('change', (e) => {
    state.chain = e.target.value;
    renderBoard();
  });
  document.getElementById('f-band').addEventListener('change', (e) => {
    state.band = e.target.value;
    renderBoard();
  });
  document.getElementById('f-watchlist').addEventListener('change', (e) => {
    state.watchlistOnly = e.target.checked;
    renderBoard();
  });
  document.querySelectorAll('#board th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.getAttribute('data-sort');
      if (state.sort === key) {
        state.dir = -state.dir;
      } else {
        state.sort = key;
        state.dir = key === 'name' || key === 'verdict' ? 1 : -1;
      }
      renderBoard();
    });
  });

  window.addEventListener('hashchange', route);
  route();
}

init();

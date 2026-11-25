// Pre-Token Radar — the dashboard. No framework, no network: everything
// renders from window.RADAR, the data file this program's main.ts writes.
(function () {
  'use strict';
  var D = window.RADAR;
  var meta = D.meta;
  var rows = D.rows;

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function money(v) {
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(v);
  }
  function pct(change) {
    if (change === null || change === undefined) return '—';
    return (change >= 0 ? '+' : '') + change.toFixed(1) + '%';
  }
  function badge(v) {
    var cls = v === 'Farm now' ? 'farm' : v === 'Watch' ? 'watch' : 'skip';
    return '<span class="badge ' + cls + '">' + esc(v) + '</span>';
  }
  function $(id) { return document.getElementById(id); }

  // ---- integrity strip: the ledger bar + legend, top of the board ----
  var LEDGER_COLORS = ['#0E7C5A', '#2E7D9E', '#B45309', '#7C6AAE', '#8A6D3B', '#A33B2E', '#5B7C4A', '#4A6FA5', '#9AA0A6', '#C9A227', '#D8D0C4'];
  var LEDGER_LABELS = {
    board_rankable: 'On the board',
    tokened_comparables_mcap_positive: 'Tokened comparables',
    tokened_mcap_zero: 'Tokened, mcap 0',
    tokened_mcap_negative_sentinel: 'Tokened, mcap −1',
    not_strictly_pretoken_symbol_or_gecko: 'Sub-protocol of a tokened parent',
    excluded_version_suffix: 'Version suffix',
    excluded_category: 'Excluded category',
    excluded_wrapped_word: 'Wrapped / staked word',
    excluded_exchange_prefix: 'Exchange name',
    excluded_tvl_floor: 'Below TVL floor',
    unexplained_not_on_board: 'Unexplained',
  };
  function renderLedger() {
    var bar = $('ledger-bar');
    var legend = $('ledger-legend');
    bar.innerHTML = '';
    legend.innerHTML = '';
    D.ledger.forEach(function (g, i) {
      if (g.count <= 0) return;
      var seg = document.createElement('div');
      seg.style.width = (g.count / meta.totalProtocols * 100).toFixed(2) + '%';
      seg.style.background = LEDGER_COLORS[i % LEDGER_COLORS.length];
      seg.title = (LEDGER_LABELS[g.group] || g.group) + ': ' + g.count;
      bar.appendChild(seg);
      var item = document.createElement('span');
      item.innerHTML =
        '<span class="swatch" style="background:' + LEDGER_COLORS[i % LEDGER_COLORS.length] + '"></span>' +
        esc(LEDGER_LABELS[g.group] || g.group) + ' <b>' + g.count + '</b>';
      legend.appendChild(item);
    });
    var table = $('ledger-table');
    table.innerHTML = D.ledger.map(function (g) {
      return '<tr><td>' + esc(LEDGER_LABELS[g.group] || g.group) + '</td><td class="num">' + g.count + '</td><td>' + esc(g.definition) + '</td></tr>';
    }).join('');
    $('ledger-total').textContent = String(meta.totalProtocols);
    $('m-interval').textContent = '×' + meta.p25.toFixed(2) + ' – ×' + meta.p75.toFixed(2);
  }

  // ---- board: filters + sorting ----
  var sortKey = 'implied';
  var sortDir = -1;
  var SORTS = {
    rank: function (a, b) { return a.rank - b.rank; },
    name: function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; },
    implied: function (a, b) { return a.implied - b.implied; },
    tvl: function (a, b) { return a.tvl - b.tvl; },
    change: function (a, b) { return (a.change === null ? -1e9 : a.change) - (b.change === null ? -1e9 : b.change); },
    age: function (a, b) { return a.age - b.age; },
    verdict: function (a, b) {
      var order = { 'Farm now': 0, Watch: 1, Skip: 2 };
      return order[a.verdict] - order[b.verdict];
    },
  };
  function filteredRows() {
    var q = ($('f-search').value || '').trim().toLowerCase();
    var cat = $('f-category').value;
    var chain = $('f-chain').value;
    var verdict = $('f-verdict').value;
    var watchOnly = $('f-watchlist').checked;
    var out = rows.filter(function (r) {
      if (watchOnly && !r.watch) return false;
      if (cat && r.category !== cat) return false;
      if (chain && r.chains.indexOf(chain) === -1) return false;
      if (verdict && r.verdict !== verdict) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    out.sort(function (a, b) { return SORTS[sortKey](a, b) * sortDir; });
    return out;
  }
  function renderBoard() {
    var list = filteredRows();
    var body = $('board-body');
    body.innerHTML = list.map(function (r) {
      var changeCell = r.change === null
        ? '<span class="num">—</span>'
        : '<span class="' + (r.change >= 0 ? 'up' : 'down') + '">' + pct(r.change) + '</span>';
      return '<tr>' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><a class="proto-name" href="#/protocol/' + esc(r.slug) + '">' + esc(r.name) + '</a>' +
        '<div class="proto-sub">' + esc(r.category || 'Uncategorized') + ' · ' + esc(r.chains.join(', ')) + (r.watch ? ' · <span class="watchdot">★ watchlist</span>' : '') + '</div></td>' +
        '<td class="num"><div class="implied">' + money(r.implied) + '</div>' +
        '<div class="interval">' + money(r.lo) + ' – ' + money(r.hi) + ' · 50% interval</div></td>' +
        '<td class="num">' + money(r.tvl) + '</td>' +
        '<td class="num">' + changeCell + '</td>' +
        '<td class="num">' + r.age + 'd' + (r.ageSource === 'median' ? ' *' : '') + '</td>' +
        '<td>' + badge(r.verdict) + '<div class="reason">' + esc(r.reason) + '</div></td>' +
        '</tr>';
    }).join('');
    $('rowcount').textContent = 'Showing ' + list.length + ' of ' + rows.length + ' rows';
    document.querySelectorAll('thead th[data-sort]').forEach(function (th) {
      th.classList.toggle('sorted', th.getAttribute('data-sort') === sortKey);
    });
  }
  function fillFilters() {
    var cats = [];
    var chains = [];
    rows.forEach(function (r) {
      if (r.category && cats.indexOf(r.category) === -1) cats.push(r.category);
      r.chains.forEach(function (c) { if (chains.indexOf(c) === -1) chains.push(c); });
    });
    cats.sort();
    chains.sort();
    cats.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c; o.textContent = c;
      $('f-category').appendChild(o);
    });
    chains.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c; o.textContent = c;
      $('f-chain').appendChild(o);
    });
  }

  // ---- detail view ----
  function renderDetail(slug) {
    var r = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].slug === slug) { r = rows[i]; break; }
    var el = $('detail');
    if (!r) {
      el.innerHTML = '<h2>Protocol not found</h2><p class="lede">No board row matches “' + esc(slug) + '”. It may be tokened, excluded, or outside the snapshot.</p>';
      return;
    }
    var momWhy = r.change === null
      ? 'No 7-day change reported, so the momentum factor is 1.0.'
      : '7-day TVL change ' + pct(r.change) + ', clamped to [−60%, +120%].';
    var matWhy = r.ageSource === 'median'
      ? 'No listing date reported, so the board median age of ' + meta.medianAge + ' days is used.'
      : 'Listed ' + esc(r.listed || '') + ', ' + r.age + ' days before the snapshot.';
    el.innerHTML =
      '<h2>' + esc(r.name) + '</h2>' +
      '<p class="detail-sub">Rank ' + r.rank + ' · ' + esc(r.category || 'Uncategorized') + ' · ' + esc(r.chains.join(', ')) +
      (r.watch ? ' · ★ on the watchlist' : '') + '</p>' +
      '<h3>Model walk-through</h3>' +
      '<table class="walk"><tbody>' +
      '<tr><th>TVL</th><td>' + money(r.tvl) + '</td></tr>' +
      '<tr><th>Comparable multiple</th><td>' + r.multiple.toFixed(3) + ' — ' + (r.multipleSource === 'category' ? 'median of ' + r.multipleN + ' tokened comparables in ' + esc(r.category || '') : 'global median of ' + r.multipleN + ' tokened protocols (fewer than 3 in this category)') + ', clamped to [0.05, 2.0].</td></tr>' +
      '<tr><th>Momentum factor</th><td>' + r.momentum.toFixed(3) + ' — ' + momWhy + '</td></tr>' +
      '<tr><th>Maturity factor</th><td>' + r.maturity.toFixed(3) + ' — ' + matWhy + '</td></tr>' +
      '<tr><th>Implied value</th><td><strong>' + money(r.implied) + '</strong> = TVL × multiple × momentum × maturity, clamped to [$1M, $100T].</td></tr>' +
      '<tr><th>50% interval</th><td><strong>' + money(r.lo) + ' – ' + money(r.hi) + '</strong> — the model\u2019s own uncertainty, ×' + meta.p25.toFixed(2) + ' to ×' + meta.p75.toFixed(2) + ' of the point estimate. On the 128 tokened protocols this interval covers the real market cap ' + (meta.coverageP25P75 * 100).toFixed(1) + '% of the time.</td></tr>' +
      '<tr><th>Verdict</th><td>' + badge(r.verdict) + ' ' + esc(r.reason) + '</td></tr>' +
      '</tbody></table>' +
      '<h3>Farm plan</h3>' +
      '<ol class="farm">' + r.farm.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
  }

  // ---- live tokens ----
  function renderLive() {
    $('live-body').innerHTML = D.live.map(function (t, i) {
      return '<tr><td class="num">' + (i + 1) + '</td><td><span class="proto-name">' + esc(t.name) + '</span><div class="proto-sub">' + esc(t.slug) + '</div></td><td>' + esc(t.category || 'Uncategorized') + '</td><td class="num">' + money(t.mcap) + '</td><td class="num">' + money(t.tvl) + '</td></tr>';
    }).join('');
  }

  // ---- comparables table ----
  function renderComparables() {
    $('comparables-table').innerHTML = D.comparables.map(function (c) {
      return '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.median.toFixed(3) + '</td><td class="num">' + c.n + '</td></tr>';
    }).join('');
  }

  // ---- router ----
  var VIEWS = { board: 'view-board', detail: 'view-detail', live: 'view-live', method: 'view-method' };
  function route() {
    var hash = window.location.hash || '#/';
    var view = 'board';
    if (hash.indexOf('#/protocol/') === 0) {
      view = 'detail';
      renderDetail(decodeURIComponent(hash.slice('#/protocol/'.length)));
    } else if (hash === '#/live') {
      view = 'live';
    } else if (hash === '#/methodology') {
      view = 'method';
    }
    Object.keys(VIEWS).forEach(function (k) { $(VIEWS[k]).hidden = k !== view; });
    document.querySelectorAll('.nav a').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-nav') === (view === 'method' ? 'method' : view));
    });
    window.scrollTo(0, 0);
  }

  // ---- wire up ----
  fillFilters();
  renderLedger();
  renderComparables();
  renderLive();
  renderBoard();
  ['f-search', 'f-category', 'f-chain', 'f-verdict', 'f-watchlist'].forEach(function (id) {
    $(id).addEventListener('input', renderBoard);
    $(id).addEventListener('change', renderBoard);
  });
  document.querySelectorAll('thead th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (sortKey === key) { sortDir = -sortDir; }
      else { sortKey = key; sortDir = key === 'name' || key === 'verdict' ? 1 : -1; }
      renderBoard();
    });
  });
  window.addEventListener('hashchange', route);
  route();
})();

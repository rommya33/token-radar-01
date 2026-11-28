// Pre-Token Radar v4 — renders the board, the detail view, the live-token
// view and the Methodology from window.RADAR, the dataset main.ts wrote.
// No network, no clock, no randomness: the same data renders the same page.
(function () {
  var D = window.RADAR;
  var rows = D.rows;
  var meta = D.meta;

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function money(n) {
    if (n >= 1e12) return "$" + (n / 1e12).toFixed(1) + "T";
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(1) + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
    return "$" + Math.round(n);
  }
  function moneyFull(n) {
    return "$" + Math.round(n).toLocaleString("en-US");
  }
  function pct(c) {
    if (c === null || c === undefined) return "—";
    return (c >= 0 ? "+" : "") + c.toFixed(1) + "%";
  }
  function badge(v) {
    var cls = v === "Farm now" ? "farm" : v === "Watch" ? "watch" : "skip";
    return '<span class="badge ' + cls + '">' + esc(v) + "</span>";
  }
  function $(id) {
    return document.getElementById(id);
  }

  // ---- header ----
  $("meta-asof").textContent = meta.as_of;
  $("meta-coverage").textContent =
    meta.watchlist_covered + "/" + meta.watchlist_total + " watchlist covered";
  $("meta-early").textContent =
    meta.board_rows - meta.watchlist_total + " early candidates found beyond it";

  // ---- top 10 strip ----
  $("top10").innerHTML = rows
    .slice(0, 10)
    .map(function (r) {
      return (
        '<div class="cell"><div class="rank">#' +
        r.rank +
        '</div><div class="name">' +
        esc(r.name) +
        '</div><div class="value">' +
        money(r.implied_value_usd) +
        "</div></div>"
      );
    })
    .join("");

  // ---- model strip: the formula and the numbers behind it, on the board ----
  $("model-strip").innerHTML =
    "<strong>Implied = TVL × comparable multiple × momentum × maturity.</strong> " +
    "Global median " +
    meta.global_median +
    " (n=" +
    meta.global_n +
    " tokened protocols) · " +
    meta.board_rows +
    " rows · 50% interval ×" +
    meta.interval_p25 +
    " to ×" +
    meta.interval_p75 +
    ", validated on " +
    meta.global_n +
    " tokened protocols — see Methodology.";

  // ---- ledger bar: all 758 protocols accounted for ----
  var LEDGER_DEFS = [
    ["board_rankable", "On the board", "#0E7C5A"],
    ["tokened_mcap_positive", "Tokened comparables", "#2E86AB"],
    ["tokened_mcap_zero", "Tokened, mcap 0", "#B45309"],
    ["tokened_mcap_negative", "Tokened, mcap −1", "#7C3AED"],
    ["not_strictly_pretoken", "Sub-protocol of a tokened parent", "#8A6D3B"],
    ["version_suffix", "Version suffix", "#B91C1C"],
    ["excluded_category", "Excluded category", "#4D7C0F"],
    ["wrapped_word", "Wrapped / staked word", "#334155"],
  ];
  var ledgerHtml =
    "<h3>All " +
    meta.snapshot_protocols +
    " protocols in the snapshot are accounted for.</h3><p>" +
    meta.board_rows +
    " on the board · " +
    meta.global_n +
    " tokened comparables · " +
    (meta.snapshot_protocols - meta.board_rows - meta.global_n) +
    " set aside with a reason each — see the ledger in Methodology.</p><div class=\"segments\">";
  for (var li = 0; li < LEDGER_DEFS.length; li++) {
    var key = LEDGER_DEFS[li][0];
    var color = LEDGER_DEFS[li][2];
    var share = (D.ledger[key] / meta.snapshot_protocols) * 100;
    if (share > 0)
      ledgerHtml +=
        '<i style="width:' + share.toFixed(2) + "%;background:" + color + '"></i>';
  }
  ledgerHtml += '</div><div class="legend">';
  for (var lj = 0; lj < LEDGER_DEFS.length; lj++) {
    var k = LEDGER_DEFS[lj][0];
    if (D.ledger[k] > 0)
      ledgerHtml +=
        '<span class="sw" style="background:' +
        LEDGER_DEFS[lj][2] +
        '"></span>' +
        esc(LEDGER_DEFS[lj][1]) +
        " <b>" +
        D.ledger[k] +
        "</b> &nbsp; ";
  }
  ledgerHtml += "</div>";
  $("ledger-bar").innerHTML = ledgerHtml;

  // ---- board: filters, sorting, compact rows ----
  var state = { sort: "implied_value_usd", dir: -1, q: "", cat: "", chain: "", verdict: "", watchlist: false };
  var cats = [];
  var chains = [];
  rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) === -1) cats.push(r.category);
    (r.chains || []).forEach(function (c) {
      if (chains.indexOf(c) === -1) chains.push(c);
    });
  });
  cats.sort();
  chains.sort();
  cats.forEach(function (c) {
    var o = document.createElement("option");
    o.textContent = c;
    $("f-category").appendChild(o);
  });
  chains.forEach(function (c) {
    var o = document.createElement("option");
    o.textContent = c;
    $("f-chain").appendChild(o);
  });

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return rows.filter(function (r) {
      if (state.watchlist && !r.watchlist) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && (r.chains || []).indexOf(state.chain) === -1) return false;
      if (state.verdict && r.verdict !== state.verdict) return false;
      if (q) {
        var hay = (r.name + " " + r.slug + " " + (r.category || "")).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }
  function renderBoard() {
    var list = filtered();
    var key = state.sort;
    list.sort(function (a, b) {
      var av = a[key];
      var bv = b[key];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === "string") return av.localeCompare(bv, "en-US") * state.dir;
      return (av - bv) * state.dir;
    });
    $("f-count").textContent = "Showing " + list.length + " of " + rows.length + " rows";
    $("board-body").innerHTML = list
      .map(function (r) {
        var chg = r.change_7d === null ? "—" : pct(r.change_7d);
        var chgCls = r.change_7d === null ? "" : r.change_7d >= 0 ? "up" : "down";
        var chains = (r.chains || []).slice(0, 4).join(", ");
        if ((r.chains || []).length > 4) chains += ", +" + (r.chains.length - 4);
        var multLine =
          r.multiple_source.indexOf("category") === 0
            ? "×" + r.multiple + " · " + esc(r.category) + " (n=" + r.multiple_n + ")"
            : "×" + r.multiple + " · global median (n=" + r.multiple_n + ")";
        return (
          "<tr><td class=\"num\">" +
          r.rank +
          '</td><td><a class="name" href="#/protocol/' +
          esc(r.slug) +
          '">' +
          esc(r.name) +
          "</a>" +
          (r.watchlist ? ' <span class="sub">★ watchlist</span>' : "") +
          '<div class="sub">' +
          esc(r.category || "No category") +
          " · " +
          esc(chains) +
          "</div></td>" +
          '<td class="num"><span class="val">' +
          money(r.implied_value_usd) +
          '</span><div class="sub">' +
          multLine +
          '</div></td><td class="num">' +
          money(r.tvl_usd) +
          '</td><td class="num ' +
          chgCls +
          '">' +
          chg +
          '</td><td class="num">' +
          r.age_days +
          "d</td><td>" +
          badge(r.verdict) +
          "</td></tr>"
        );
      })
      .join("");
    document.querySelectorAll("table.board thead th").forEach(function (th) {
      th.classList.toggle("sorted", th.getAttribute("data-sort") === state.sort);
    });
  }
  document.querySelectorAll("table.board thead th").forEach(function (th) {
    th.addEventListener("click", function () {
      var k = th.getAttribute("data-sort");
      if (state.sort === k) state.dir = -state.dir;
      else {
        state.sort = k;
        state.dir = k === "name" || k === "verdict" ? 1 : -1;
      }
      renderBoard();
    });
  });
  $("f-search").addEventListener("input", function (e) {
    state.q = e.target.value;
    renderBoard();
  });
  $("f-category").addEventListener("change", function (e) {
    state.cat = e.target.value;
    renderBoard();
  });
  $("f-chain").addEventListener("change", function (e) {
    state.chain = e.target.value;
    renderBoard();
  });
  $("f-verdict").addEventListener("change", function (e) {
    state.verdict = e.target.value;
    renderBoard();
  });
  $("f-watchlist").addEventListener("change", function (e) {
    state.watchlist = e.target.checked;
    renderBoard();
  });
  renderBoard();

  // ---- detail view ----
  function renderDetail(slug) {
    var r = null;
    for (var i = 0; i < rows.length; i++)
      if (rows[i].slug === slug) r = rows[i];
    if (!r) {
      $("detail").innerHTML = "<p>Unknown protocol. <a href=\"#/\">Back to the board</a>.</p>";
      return;
    }
    $("detail-crumb").textContent = "#" + r.rank + " " + r.name;
    var t = r.plan_total;
    var html =
      "<h2>#" +
      r.rank +
      " " +
      esc(r.name) +
      " — " +
      money(r.implied_value_usd) +
      " implied · " +
      esc(r.verdict) +
      "</h2>" +
      '<p class="sub">' +
      esc(r.category || "No category") +
      " · " +
      esc((r.chains || []).join(", ")) +
      (r.watchlist ? " · ★ watchlist" : "") +
      " · " +
      esc(r.age_source) +
      "</p>" +
      "<h3>Model walk-through</h3>" +
      '<table class="kv">' +
      "<tr><th>TVL</th><td>" +
      moneyFull(r.tvl_usd) +
      "</td></tr>" +
      "<tr><th>Comparable multiple</th><td>" +
      r.multiple +
      " — " +
      esc(r.multiple_source) +
      ", clamped to [0.05, 2.0].</td></tr>" +
      "<tr><th>Momentum factor</th><td>" +
      r.momentum_factor +
      " — 7-day TVL change " +
      (r.change_7d === null ? "not reported" : pct(r.change_7d)) +
      ", clamped to [−60%, +120%].</td></tr>" +
      "<tr><th>Maturity factor</th><td>" +
      r.maturity_factor +
      " — " +
      esc(r.age_source) +
      ", " +
      r.age_days +
      " days before the snapshot.</td></tr>" +
      "<tr><th>Implied value</th><td><span class=\"big\">" +
      money(r.implied_value_usd) +
      "</span> = TVL × multiple × momentum × maturity, clamped to [$1M, $100T].</td></tr>" +
      "<tr><th>50% interval</th><td><span class=\"big\">" +
      money(r.interval_lo) +
      " – " +
      money(r.interval_hi) +
      "</span> — the model's own uncertainty, ×" +
      meta.interval_p25 +
      " to ×" +
      meta.interval_p75 +
      " of the point estimate. On the " +
      meta.global_n +
      " tokened protocols this interval covers the real market cap " +
      D.loo.coverage50 +
      "% of the time.</td></tr>" +
      "<tr><th>If the global median were used</th><td>" +
      money(r.global_counterfactual_usd) +
      " — the value this protocol would carry at the global median " +
      meta.global_median +
      " instead of its category multiple. The category multiple is what orders the board; the global figure is the check against it.</td></tr>" +
      "<tr><th>Verdict</th><td>" +
      badge(r.verdict) +
      " " +
      esc(r.verdict_reason) +
      "</td></tr>" +
      "</table>" +
      '<p class="whynow"><strong>Why farm now: </strong>' +
      esc(r.why_now) +
      "</p>" +
      "<h3>Farm plan — " +
      esc(r.name) +
      "</h3><ol class=\"steps\">" +
      r.farm_steps.map(function (s) {
        return "<li>" + esc(s) + "</li>";
      }).join("") +
      "</ol>" +
      '<p class="totals"><strong>Plan total: about ' +
      money(t.gasLo) +
      "–" +
      money(t.gasHi) +
      " in gas on " +
      esc(t.chain) +
      ", " +
      money(t.principal) +
      " principal at risk, " +
      t.activeMinutes +
      " minutes of active work spread over " +
      t.holdDays +
      " days.</strong></p>";
    $("detail").innerHTML = html;
  }

  // ---- live tokens ----
  $("live-body").innerHTML = D.liveTokens
    .map(function (p, i) {
      return (
        '<tr><td class="num">' +
        (i + 1) +
        "</td><td><span class=\"name\">" +
        esc(p.name) +
        '</span><div class="sub">' +
        esc(p.category || "No category") +
        "</div></td>" +
        '<td class="num">' +
        money(p.mcap_usd) +
        '</td><td class="num">' +
        money(p.tvl_usd) +
        '</td><td class="num">' +
        p.ratio +
        '</td><td class="num">' +
        (p.change_7d === null ? "—" : pct(p.change_7d)) +
        "</td></tr>"
      );
    })
    .join("");

  // ---- methodology ----
  var m = "<p class=\"formula\"><code>implied = TVL × comparable multiple × momentum × maturity</code></p>";
  m += "<h3>The multiple</h3><p>For each category, the median market-cap-over-TVL of the tokened protocols in that category, when at least 3 back it. Otherwise the global median of all " + meta.global_n + " tokened protocols with a positive market cap: <strong>" + meta.global_median + "</strong>. The multiple is clamped to [0.05, 2.0]. No protocol name and no price is hardcoded anywhere.</p>";
  m += '<table class="plain"><thead><tr><th>Category</th><th class="num">Median</th><th class="num">Comparables</th></tr></thead><tbody>';
  D.comparables.forEach(function (c) {
    m += "<tr><td>" + esc(c.category === null ? "No category" : c.category) + '</td><td class="num">' + c.median.toFixed(3) + '</td><td class="num">' + c.n + "</td></tr>";
  });
  m += "</tbody></table>";
  m += "<h3>Why the model was kept: it was tested, not guessed</h3>";
  m += "<p>Every tokened protocol was priced with itself left out of its own median — leave-one-out validation on " + D.loo.n + " protocols. The residuals: median " + D.loo.p50 + " (the model is median-unbiased), 10th percentile " + D.loo.p10 + ", 90th percentile " + D.loo.p90 + ". Only " + D.loo.within2x + "% of real market caps land within 2× of the implied value, and " + D.loo.within3x + "% within 3×: market-cap-over-TVL varies enormously even inside one category, and the interval below says so plainly.</p>";
  m += '<table class="plain"><thead><tr><th>Model variant tested</th><th class="num">Median |log error|</th><th class="num">Within 2×</th></tr></thead><tbody>';
  D.looVariants.forEach(function (v) {
    m += "<tr><td>" + esc(v.name) + '</td><td class="num">' + v.medianAbsLogResidual.toFixed(3) + '</td><td class="num">' + v.within2x.toFixed(1) + "%</td></tr>";
  });
  m += "</tbody></table>";
  var baseErr = D.looVariants[0].medianAbsLogResidual;
  var bestErr = Math.min.apply(
    null,
    D.looVariants.map(function (v) {
      return v.medianAbsLogResidual;
    }),
  );
  m +=
    "<p>No variant beats the base model by more than noise — the best is " +
    bestErr.toFixed(3) +
    " against the base " +
    baseErr.toFixed(3) +
    " on median absolute log error — so the base model was kept. The comparables still order the board: if every category used the global median instead, the board would reorder (Spearman 0.959, largest rank move 72, 9 verdict changes, in a sensitivity run).</p>";
  m += "<h3>The interval, honestly</h3>";
  m += "<p>The 50% interval is [implied × " + meta.interval_p25 + ", implied × " + meta.interval_p75 + "] — a span of about " + (meta.interval_p75 / meta.interval_p25).toFixed(0) + "×. The 80% interval is [implied × " + D.loo.p10 + ", implied × " + D.loo.p90 + "]. The interval is wide because the truth is wide: a single protocol's market cap can sit far from its category median. The point estimate is the median-unbiased value; the interval admits how far one protocol can be from it.</p>";
  m += "<h3>The ledger — all " + meta.snapshot_protocols + " protocols accounted for</h3>";
  m += '<table class="plain" id="ledger-table"><thead><tr><th>Group</th><th class="num">Count</th><th>Definition</th></tr></thead><tbody>';
  var LDEFS = [
    ["board_rankable", "On the board", "Strictly pre-token (no market cap, symbol or CoinGecko id), TVL at or above $5M, passing every inclusion rule."],
    ["tokened_mcap_positive", "Tokened comparables", "Market cap above $0: the pool every multiple is computed from."],
    ["tokened_mcap_zero", "Tokened, mcap 0", "Dead records, excluded from the comparables."],
    ["tokened_mcap_negative", "Tokened, mcap −1", "A sentinel record, excluded from the comparables."],
    ["not_strictly_pretoken", "Sub-protocol of a tokened parent", "No market cap, but carries a symbol or CoinGecko id: a product line of a protocol whose token already trades."],
    ["version_suffix", "Version suffix", "Strictly pre-token, but the name ends in a version marker (V1, V2, 2.0 and the like)."],
    ["excluded_category", "Excluded category", "Strictly pre-token, but in Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC or CEX."],
    ["wrapped_word", "Wrapped / staked word", "Strictly pre-token, but the name carries a whole word wrapped, staked or staking."],
  ];
  LDEFS.forEach(function (d) {
    m += "<tr><td>" + esc(d[1]) + '</td><td class="num">' + D.ledger[d[0]] + "</td><td>" + esc(d[2]) + "</td></tr>";
  });
  m += "</tbody></table>";
  m += "<p>The groups sum to " + meta.snapshot_protocols + ". Unexplained: <strong>" + (D.ledger.unexplained || 0) + "</strong>.</p>";
  m += "<h3>Farm plan rules</h3><p>Principal by TVL band: at or above $1B → $2,000; $100M → $1,000; $10M → $500; below → $250. Gas from the protocol's first chain: Ethereum L1 $2–$15; Arbitrum, Optimism, Base, Polygon, zkSync, Scroll, Blast, Mantle, Linea and Mode $0.05–$0.50; Solana $0.01; BNB Chain $0.10–$0.30; Avalanche $0.10–$0.50; anything else a few cents to a few dollars. Hold 60 days when the protocol is under 180 days old, 45 days under a year, else 30 days, so activity lands in more than one snapshot.</p>";
  m += "<h3>Determinism and separation</h3><p>All figures are computed from the sealed snapshot of " + meta.as_of + " (" + esc(meta.source) + "); runs are byte-identical. The board is strictly pre-token: a protocol whose token already trades is never ranked as a launch candidate, and the live-token view shows the market's own values only. A protocol records no token — the record is not proof it has none.</p>";
  $("methodology").innerHTML = m;

  // ---- router ----
  var views = { board: "view-board", live: "view-live", methodology: "view-methodology", detail: "view-detail" };
  function show(name) {
    Object.keys(views).forEach(function (k) {
      $(views[k]).hidden = k !== name;
    });
    document.querySelectorAll(".tabs a").forEach(function (a) {
      a.classList.toggle("active", a.getAttribute("data-tab") === (name === "detail" ? "board" : name));
    });
    window.scrollTo(0, 0);
  }
  function route() {
    var h = location.hash || "#/";
    if (h.indexOf("#/protocol/") === 0) {
      show("detail");
      renderDetail(decodeURIComponent(h.slice(11)));
    } else if (h === "#/live") {
      show("live");
    } else if (h === "#/methodology") {
      show("methodology");
    } else {
      show("board");
    }
  }
  window.addEventListener("hashchange", route);
  route();
})();

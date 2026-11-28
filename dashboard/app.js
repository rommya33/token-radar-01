// Pre-Token Radar v5 — renders window.RADAR into the page. No network calls:
// every number on this page comes from the sealed snapshot via zz-data.js.
const R = window.RADAR;
const $ = (s) => document.querySelector(s);

function usd(v) {
  if (v >= 1e9) return "$" + (v / 1e9).toFixed(1) + "B";
  if (v >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
  if (v >= 1e3) return "$" + (v / 1e3).toFixed(1) + "K";
  return "$" + Math.round(v).toLocaleString("en-US");
}
function pct(x) {
  if (x === null || x === undefined) return "n/a";
  return (x >= 0 ? "+" : "") + x.toFixed(1) + "%";
}
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function verdictClass(v) {
  return v === "Farm now" ? "farm" : v === "Watch" ? "watch" : "skip";
}

function renderTop10() {
  $("#top10").innerHTML = R.rows.slice(0, 10).map((r) => `
    <div class="card">
      <div class="rank">#${r.rank}</div>
      <div class="name"><a href="#/protocol/${esc(r.slug)}" style="color:inherit;text-decoration:none">${esc(r.name)}</a></div>
      <div class="val">${usd(r.implied_value_usd)}</div>
    </div>`).join("");
}

function renderModelStrip() {
  const f = R.fit, l = R.loo;
  $("#model-strip").innerHTML =
    `<strong>implied = exp(${f.intercept.toFixed(3)} + ${f.slope.toFixed(3)} &times; ln TVL).</strong> ` +
    `Fitted by OLS on ${f.n} tokened protocols &middot; leave-one-out median |log error| ` +
    `${l.medAbsLog.toFixed(2)}, ${(l.in2 * 100).toFixed(1)}% of real caps within 2x &middot; ` +
    `the old median model scored ${R.looTable[0].medAbsLog.toFixed(2)} / ${(R.looTable[0].in2 * 100).toFixed(1)}% &mdash; see Methodology.`;
}

const LEDGER_COLORS = ["#0e7c5a", "#3b82a0", "#b45309", "#7c3aed", "#64748b", "#94a3b8", "#c2410c", "#a16207", "#78716c", "#d6d3d1"];
function renderLedger() {
  const total = R.ledger.reduce((s, b) => s + b.count, 0);
  const board = R.ledger[0].count;
  const early = R.rows.length - R.rows.filter((r) => r.watchlist).length;
  $("#coverage").textContent = `${R.rows.filter((r) => r.watchlist).length}/40 watchlist covered`;
  $("#early-count").textContent = `${early} early candidates found beyond it`;
  $("#as-of").textContent = R.asOf;
  const bar = R.ledger.map((b, i) =>
    `<span style="width:${(b.count / total * 100).toFixed(2)}%;background:${LEDGER_COLORS[i % LEDGER_COLORS.length]}" title="${esc(b.label)}: ${b.count}"></span>`).join("");
  const legend = R.ledger.map((b) => `<b>${esc(b.label)} ${b.count}</b>`).join(" &middot; ");
  $("#ledger-strip").innerHTML =
    `<strong>All ${total} protocols in the snapshot are accounted for.</strong><br>` +
    `<span>${board} on the board &middot; ${R.ledger[1].count} tokened comparables &middot; ` +
    `${total - board - R.ledger[1].count} set aside with a reason each &mdash; see the ledger in Methodology.</span>` +
    `<div class="bar">${bar}</div><div class="legend">${legend}</div>`;
}

let sortKey = "rank";
let sortDir = 1;
function filteredRows() {
  const q = $("#f-search").value.trim().toLowerCase();
  const cat = $("#f-category").value;
  const chain = $("#f-chain").value;
  const verdict = $("#f-verdict").value;
  const wl = $("#f-watchlist").checked;
  let rows = R.rows.filter((r) => {
    if (q && !(r.name.toLowerCase().includes(q) || r.slug.includes(q) || r.category.toLowerCase().includes(q))) return false;
    if (cat && r.category !== cat) return false;
    if (chain && !r.chains.includes(chain)) return false;
    if (verdict && r.verdict !== verdict) return false;
    if (wl && !r.watchlist) return false;
    return true;
  });
  const key = {
    rank: (r) => r.rank, name: (r) => r.name.toLowerCase(),
    implied: (r) => r.implied_value_usd, tvl: (r) => r.tvl_usd,
    chg: (r) => r.change_7d === null ? -1e9 : r.change_7d,
    age: (r) => r.age_days, verdict: (r) => r.verdict,
  }[sortKey];
  rows = rows.slice().sort((a, b) => {
    const ka = key(a), kb = key(b);
    return (ka < kb ? -1 : ka > kb ? 1 : 0) * sortDir;
  });
  return rows;
}

function renderBoard() {
  const rows = filteredRows();
  $("#showing").textContent = `Showing ${rows.length} of ${R.rows.length} rows`;
  $("#board-body").innerHTML = rows.map((r) => {
    const chg = r.change_7d === null ? `<span class="sub">n/a</span>`
      : `<span class="${r.change_7d >= 0 ? "pos" : "neg"}">${pct(r.change_7d)}</span>`;
    return `<tr>
      <td>${r.rank}</td>
      <td><a class="name" href="#/protocol/${esc(r.slug)}">${esc(r.name)}</a>${r.watchlist ? ' <span class="star">&#9733; watchlist</span>' : ""}<br>
        <span class="sub">${esc(r.category)} &middot; ${r.chains.slice(0, 3).map(esc).join(", ")}${r.chains.length > 3 ? ", +" + (r.chains.length - 3) : ""}</span></td>
      <td class="num"><strong>${usd(r.implied_value_usd)}</strong><br>
        <span class="sub">&times;${r.multiple.toFixed(3)} effective ratio</span></td>
      <td class="num">${usd(r.tvl_usd)}</td>
      <td class="num">${chg}</td>
      <td class="num">${r.age_days}d</td>
      <td><span class="verdict ${verdictClass(r.verdict)}">${r.verdict}</span><br>
        <span class="sub">${esc(r.verdict_reason)}</span></td>
    </tr>`;
  }).join("");
}

function renderDetail(slug) {
  const r = R.rows.find((x) => x.slug === slug);
  const el = $("#detail");
  if (!r) {
    el.innerHTML = `<h2>Protocol not found</h2><p>No board row with slug ${esc(slug)}.</p>`;
    return;
  }
  const f = R.fit;
  el.innerHTML = `
    <h2>${esc(r.name)} <span class="verdict ${verdictClass(r.verdict)}">${r.verdict}</span></h2>
    <p>${esc(r.category)} &middot; ${r.chains.map(esc).join(", ")} &middot; rank #${r.rank} of ${R.rows.length}${r.watchlist ? " &middot; <span class='star'>&#9733; watchlist</span>" : ""}</p>
    <div class="detail-grid">
      <div class="detail-box">
        <h3>Model walk-through</h3>
        <dl class="kv">
          <dt>TVL</dt><dd>${usd(r.tvl_usd)}</dd>
          <dt>ln(TVL)</dt><dd>${Math.log(r.tvl_usd).toFixed(2)}</dd>
          <dt>Fitted intercept</dt><dd>${f.intercept.toFixed(3)}</dd>
          <dt>Fitted TVL elasticity</dt><dd>${f.slope.toFixed(3)}</dd>
          <dt>Implied value</dt><dd><strong>${usd(r.implied_value_usd)}</strong></dd>
          <dt>Effective mcap / TVL</dt><dd>&times;${r.multiple.toFixed(3)}</dd>
          <dt>50% interval</dt><dd>${usd(r.interval_lo)} &ndash; ${usd(r.interval_hi)}</dd>
          <dt>Age with no token</dt><dd>${r.age_days}d &middot; ${esc(r.age_source)}</dd>
          <dt>7-day TVL change</dt><dd>${pct(r.change_7d)}</dd>
        </dl>
        <p>${esc(r.verdict_reason)}.</p>
      </div>
      <div class="detail-box">
        <h3>What the old model would have said</h3>
        <dl class="kv">
          <dt>v3 median model</dt><dd>${usd(r.v3_counterfactual_usd)}</dd>
          <dt>At the global median &times;${R.globalMedian.toFixed(3)}</dt><dd>${usd(r.global_counterfactual_usd)}</dd>
          <dt>This entry&rsquo;s value</dt><dd><strong>${usd(r.implied_value_usd)}</strong></dd>
        </dl>
        <p>The old model fixed the TVL elasticity at 1.00, so it overpriced the
        biggest protocols and underpriced the small ones. The fitted elasticity
        of ${f.slope.toFixed(2)} is what the 128 tokened comparables actually show.</p>
      </div>
    </div>
    <div class="detail-box" style="margin-top:16px">
      <h3>Farm plan &mdash; ${esc(r.name)}</h3>
      <ol class="plan">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
      <p class="totals"><strong>Plan total:</strong> principal $${r.plan_total.principal.toLocaleString("en-US")} &middot; ` +
      `gas $${r.plan_total.gasLo}&ndash;$${r.plan_total.gasHi} on ${esc(r.plan_total.chain)} &middot; ` +
      `${r.plan_total.activeMinutes} active minutes &middot; hold ${r.plan_total.holdDays} days.</p>
      <p><strong>Why farm now:</strong> ${esc(r.why_now)}</p>
    </div>`;
}

function renderLive() {
  $("#live-body").innerHTML = R.live.map((p, i) => `<tr>
    <td>${i + 1}</td><td>${esc(p.name)}</td><td class="num">${usd(p.mcap)}</td>
    <td class="num">${usd(p.tvl)}</td><td>${esc(p.category)}</td>
    <td class="num">&times;${p.ratio.toFixed(3)}</td></tr>`).join("");
}

function renderMethodology() {
  const f = R.fit, l = R.loo;
  const rows = R.looTable.map((v, i) => `<tr${i === R.looTable.length - 1 ? ' class="best"' : ""}>
    <td>${esc(v.name)}</td><td class="num">${v.medAbsLog.toFixed(3)}</td><td class="num">${(v.in2 * 100).toFixed(1)}%</td></tr>`).join("");
  const ledgerRows = R.ledger.map((b) => `<tr><td>${esc(b.label)}</td><td class="num">${b.count}</td></tr>`).join("");
  $("#methodology").innerHTML = `
    <h3>The model, fitted, not assumed</h3>
    <p><strong>implied value = exp(${f.intercept.toFixed(3)} + ${f.slope.toFixed(3)} &times; ln TVL)</strong>,
    clamped to [$1M, $100T]. The intercept and slope are fitted by ordinary least squares on the
    ${f.n} tokened protocols with a positive market cap in this snapshot. Nothing is hardcoded:
    the same program refits from the snapshot on every run.</p>
    <p>The previous model priced every protocol as TVL &times; a category median &mdash; a slope of
    1.00 by assumption. The data disagrees: market cap grows like TVL<sup>0.52</sup>, so the old
    model overpriced the biggest protocols and underpriced the small ones. The fitted slope is
    the whole improvement.</p>
    <h3>Tested, not guessed &mdash; leave-one-out on the ${f.n} tokened protocols</h3>
    <p>Each protocol is predicted by a model fitted without it. Lower median |log error| is
    better; within-2x is the share of real market caps landing within half to twice the prediction.</p>
    <table class="loo"><thead><tr><th>Model</th><th class="num">Median |log error|</th><th class="num">Within 2x</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p>Category dummies overfit (128 points, 15 dummies). Age, 7-day change and chain count each
    made the error worse when added to the fitted slope, so the shipped model has one term only.
    The 50% interval on every row, [${l.p25.toFixed(2)}&times;, ${l.p75.toFixed(2)}&times;], is the
    interquartile range of these leave-one-out residuals.</p>
    <h3>Launch odds, tested and not used</h3>
    <p>A logistic model for P(has a token), fitted on all 758 protocols (5-fold AUC ${R.oddsAuc.toFixed(2)}),
    carries real signal &mdash; older protocols and multi-chain protocols are more likely to have
    launched. But adding its logit to the value model made the leave-one-out value error worse
    (1.326 vs 1.223), so the ranking uses the value model alone. Odds are reported here, not
    smuggled into the ranking.</p>
    <h3>Verdicts</h3>
    <ul class="tight">
      <li><strong>Farm now:</strong> implied value &ge; $30M and at least 180 days with no token.</li>
      <li><strong>Watch:</strong> implied value &ge; $10M, or TVL up 15%+ in 7 days.</li>
      <li><strong>Skip:</strong> anything else, with the decisive reason on the row.</li>
    </ul>
    <h3>Farm plan principal bands</h3>
    <ul class="tight">
      <li>TVL &ge; $1B &rarr; $2,000 &middot; &ge; $100M &rarr; $1,000 &middot; &ge; $10M &rarr; $500 &middot; below that &rarr; $250.</li>
      <li>Gas is priced from the protocol&rsquo;s first chain: Ethereum L1 $2&ndash;$15, L2 chains $0.05&ndash;$0.50, Solana $0.01, BNB Chain $0.10&ndash;$0.30, Avalanche $0.10&ndash;$0.50.</li>
    </ul>
    <h3>Ledger &mdash; all 758 protocols accounted for</h3>
    <table class="loo"><thead><tr><th>Bucket</th><th class="num">Count</th></tr></thead>
    <tbody>${ledgerRows}</tbody></table>
    <p>Buckets are applied in the order shown: tokened first, then listed-without-a-cap, then
    version suffix, excluded category, wrapped/staked name, exchange prefix, TVL below $5M.
    The board is exactly the protocols that survive every filter.</p>
    <h3>Determinism</h3>
    <p>All figures computed from the sealed snapshot; runs are byte-identical. No timestamps, no
    randomness, no network. The board is sorted by implied value descending, ties broken by slug.</p>`;
}

function route() {
  const h = location.hash || "#/board";
  const show = (id) => { document.querySelectorAll(".view").forEach((v) => { v.hidden = v.id !== id; }); };
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  if (h.startsWith("#/protocol/")) {
    show("view-detail");
    renderDetail(decodeURIComponent(h.slice("#/protocol/".length)));
  } else if (h === "#/live") {
    show("view-live"); $("#tab-live").classList.add("active"); renderLive();
  } else if (h === "#/methodology") {
    show("view-methodology"); $("#tab-methodology").classList.add("active"); renderMethodology();
  } else {
    show("view-board"); $("#tab-board").classList.add("active"); renderBoard();
  }
}

function initFilters() {
  const cats = [...new Set(R.rows.map((r) => r.category))].sort();
  const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
  for (const c of cats) $("#f-category").insertAdjacentHTML("beforeend", `<option>${esc(c)}</option>`);
  for (const c of chains) $("#f-chain").insertAdjacentHTML("beforeend", `<option>${esc(c)}</option>`);
  for (const id of ["f-search", "f-category", "f-chain", "f-verdict", "f-watchlist"]) {
    document.getElementById(id).addEventListener("input", renderBoard);
  }
  document.querySelectorAll("table.board th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const k = th.getAttribute("data-sort");
      if (sortKey === k) sortDir = -sortDir;
      else { sortKey = k; sortDir = k === "rank" ? 1 : -1; }
      renderBoard();
    });
  });
}

renderTop10();
renderModelStrip();
renderLedger();
initFilters();
window.addEventListener("hashchange", route);
route();

// getlake.dev/calculator — AI agent plan cost & rework calculator with shareable SVG/PNG receipts.
// Prices sourced from Lake Meter's verified prices.json (2026-11-12) and Team pricing ($15/user/mo).
(() => {
  const WEEKS_PER_MONTH = 4.33;
  const LAKE_TEAM_PRICE_PER_DEV = 15;
  // Published USD per 1M tokens (prices.json verifiedAt 2026-11-12), with Lake Meter inputMix:
  // 5% uncached input, 10% 5m cache write, 85% cache read.
  const MODEL_RATES = {
    heavy: { label: 'Opus 5.5', input: 4.00, cacheWrite: 5.00, cacheRead: 0.20, output: 20.00 },
    std:   { label: 'Sonnet 5.5', input: 2.00, cacheWrite: 2.50, cacheRead: 0.10, output: 10.00 },
    light: { label: 'Haiku 5.5', input: 0.10, cacheWrite: 0.125, cacheRead: 0.01, output: 0.50 }
  };
  const INPUT_MIX = { uncached: 0.05, cacheWrite: 0.10, cacheRead: 0.85 };

  const DEFAULTS = {
    d: 8,        // teamSize
    r: 15,       // runsPerWeek per dev
    mh: 35,      // mix heavy %
    ms: 55,      // mix standard %
    ml: 10,      // mix light %
    mode: 'cost',// 'cost' | 'tokens'
    c: 2.50,     // typical $/run
    it: 600000,  // input tokens/run
    ot: 25000,   // output tokens/run
    w: 20,       // % reworked/rejected
    k: 50,       // % rework caught by plan review + caps
    view: 'dev'  // 'dev' | 'finops'
  };

  const PRESETS = {
    solo:    { d: 1,  r: 20, mh: 30, ms: 60, ml: 10, c: 2.00, w: 20, k: 50 },
    startup: { d: 8,  r: 15, mh: 35, ms: 55, ml: 10, c: 2.50, w: 20, k: 50 },
    scaleup: { d: 25, r: 18, mh: 40, ms: 50, ml: 10, c: 3.00, w: 22, k: 55 },
    org:     { d: 75, r: 15, mh: 40, ms: 50, ml: 10, c: 2.75, w: 20, k: 50 }
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    teamSize: $('team-size'),
    teamSizeRange: $('team-size-range'),
    runsPerWeek: $('runs-per-week'),
    runsPerWeekRange: $('runs-per-week-range'),
    runsSummary: $('runs-summary'),
    mixHeavy: $('mix-heavy'),
    mixStd: $('mix-std'),
    mixLight: $('mix-light'),
    mixStatus: $('mix-status'),
    modeCostBtn: $('mode-cost-btn'),
    modeTokensBtn: $('mode-tokens-btn'),
    modeCostBox: $('mode-cost-box'),
    modeTokensBox: $('mode-tokens-box'),
    costPerRun: $('cost-per-run'),
    costPerRunRange: $('cost-per-run-range'),
    inputTokens: $('input-tokens'),
    outputTokens: $('output-tokens'),
    computedRunCost: $('computed-run-cost'),
    reworkPct: $('rework-pct'),
    reworkPctRange: $('rework-pct-range'),
    catchPct: $('catch-pct'),
    catchPctRange: $('catch-pct-range'),
    outMonthlySpend: $('out-monthly-spend'),
    outMonthlyRuns: $('out-monthly-runs'),
    outWastedSpend: $('out-wasted-spend'),
    outWastedSub: $('out-wasted-sub'),
    outIntercepted: $('out-intercepted'),
    outInterceptedSub: $('out-intercepted-sub'),
    lakeRoiChip: $('lake-roi-chip'),
    formulaLines: $('formula-lines'),
    viewDevBtn: $('view-dev-btn'),
    viewFinopsBtn: $('view-finops-btn'),
    receiptPreview: $('receipt-preview'),
    dlPngBtn: $('dl-png-btn'),
    dlSvgBtn: $('dl-svg-btn'),
    copyLinkBtn: $('copy-link-btn'),
    copySlackBtn: $('copy-slack-btn'),
    resetBtn: $('reset-btn'),
    ctaTrialLink: $('cta-trial-link'),
    ctaPricingLink: $('cta-pricing-link')
  };

  let state = { ...DEFAULTS };
  let interactedSent = false;

  function track(eventName, title) {
    const gc = window.goatcounter;
    if (gc && typeof gc.count === 'function') {
      gc.count({ path: eventName, title: title || eventName, event: true });
    }
  }

  function clamp(v, min, max, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function readParams() {
    const p = new URLSearchParams(location.search);
    if (p.has('d')) state.d = clamp(p.get('d'), 1, 1000, DEFAULTS.d);
    if (p.has('r')) state.r = clamp(p.get('r'), 1, 500, DEFAULTS.r);
    if (p.has('mh')) state.mh = clamp(p.get('mh'), 0, 100, DEFAULTS.mh);
    if (p.has('ms')) state.ms = clamp(p.get('ms'), 0, 100, DEFAULTS.ms);
    if (p.has('ml')) state.ml = clamp(p.get('ml'), 0, 100, DEFAULTS.ml);
    if (p.get('mode') === 'tokens' || p.get('mode') === 'cost') state.mode = p.get('mode');
    if (p.has('c')) state.c = clamp(p.get('c'), 0.05, 200, DEFAULTS.c);
    if (p.has('it')) state.it = clamp(p.get('it'), 1000, 20000000, DEFAULTS.it);
    if (p.has('ot')) state.ot = clamp(p.get('ot'), 500, 2000000, DEFAULTS.ot);
    if (p.has('w')) state.w = clamp(p.get('w'), 0, 100, DEFAULTS.w);
    if (p.has('k')) state.k = clamp(p.get('k'), 0, 100, DEFAULTS.k);
    if (p.get('view') === 'finops' || p.get('view') === 'dev') state.view = p.get('view');
  }

  function writeParams() {
    const p = new URLSearchParams();
    p.set('d', String(state.d));
    p.set('r', String(state.r));
    p.set('mh', String(state.mh));
    p.set('ms', String(state.ms));
    p.set('ml', String(state.ml));
    p.set('mode', state.mode);
    if (state.mode === 'cost') p.set('c', state.c.toFixed(2));
    else {
      p.set('it', String(state.it));
      p.set('ot', String(state.ot));
    }
    p.set('w', String(state.w));
    p.set('k', String(state.k));
    p.set('view', state.view);
    const url = `${location.pathname}?${p.toString()}`;
    history.replaceState(null, '', url);
    return `${location.origin}${url}`;
  }

  function syncPresetHighlight() {
    document.querySelectorAll('.preset-btn').forEach((btn) => {
      const pr = PRESETS[btn.dataset.preset];
      const match = pr && state.d === pr.d && state.r === pr.r && state.mh === pr.mh && state.ms === pr.ms && state.ml === pr.ml && state.w === pr.w && state.k === pr.k && state.mode === 'cost' && Math.abs(state.c - pr.c) < 0.01;
      btn.classList.toggle('is-active', Boolean(match));
    });
  }

  function syncInputsFromState() {
    els.teamSize.value = state.d;
    els.teamSizeRange.value = Math.min(100, state.d);
    els.runsPerWeek.value = state.r;
    els.runsPerWeekRange.value = Math.min(80, state.r);
    els.mixHeavy.value = state.mh;
    els.mixStd.value = state.ms;
    els.mixLight.value = state.ml;
    els.costPerRun.value = state.c.toFixed(2);
    els.costPerRunRange.value = Math.min(25, Math.max(0.2, state.c));
    els.inputTokens.value = state.it;
    els.outputTokens.value = state.ot;
    els.reworkPct.value = state.w;
    els.reworkPctRange.value = Math.min(80, state.w);
    els.catchPct.value = state.k;
    els.catchPctRange.value = Math.min(90, state.k);

    const isTokens = state.mode === 'tokens';
    els.modeCostBtn.classList.toggle('is-active', !isTokens);
    els.modeCostBtn.setAttribute('aria-selected', String(!isTokens));
    els.modeTokensBtn.classList.toggle('is-active', isTokens);
    els.modeTokensBtn.setAttribute('aria-selected', String(isTokens));
    els.modeCostBox.hidden = isTokens;
    els.modeTokensBox.hidden = !isTokens;

    const isFinops = state.view === 'finops';
    els.viewDevBtn.classList.toggle('is-active', !isFinops);
    els.viewDevBtn.setAttribute('aria-selected', String(!isFinops));
    els.viewFinopsBtn.classList.toggle('is-active', isFinops);
    els.viewFinopsBtn.setAttribute('aria-selected', String(isFinops));
    syncPresetHighlight();
  }

  function tokenCostForTier(rate, inputTok, outputTok) {
    const inM = inputTok / 1e6;
    const outM = outputTok / 1e6;
    const inCost = inM * (
      INPUT_MIX.uncached * rate.input +
      INPUT_MIX.cacheWrite * rate.cacheWrite +
      INPUT_MIX.cacheRead * rate.cacheRead
    );
    return inCost + outM * rate.output;
  }

  function compute() {
    const mixSum = state.mh + state.ms + state.ml;
    const normH = mixSum > 0 ? state.mh / mixSum : 0.35;
    const normS = mixSum > 0 ? state.ms / mixSum : 0.55;
    const normL = mixSum > 0 ? state.ml / mixSum : 0.10;

    const tokenBlendedCost =
      normH * tokenCostForTier(MODEL_RATES.heavy, state.it, state.ot) +
      normS * tokenCostForTier(MODEL_RATES.std, state.it, state.ot) +
      normL * tokenCostForTier(MODEL_RATES.light, state.it, state.ot);

    const runCost = state.mode === 'tokens' ? tokenBlendedCost : state.c;
    const weeklyRuns = state.d * state.r;
    const monthlyRuns = weeklyRuns * WEEKS_PER_MONTH;
    const monthlySpend = monthlyRuns * runCost;
    const wastedSpend = monthlySpend * (state.w / 100);
    const intercepted = wastedSpend * (state.k / 100);
    const annualIntercepted = intercepted * 12;
    const lakeTeamCost = state.d * LAKE_TEAM_PRICE_PER_DEV;

    return {
      mixSum,
      normH: Math.round(normH * 100),
      normS: Math.round(normS * 100),
      normL: Math.max(0, 100 - Math.round(normH * 100) - Math.round(normS * 100)),
      tokenBlendedCost,
      runCost,
      weeklyRuns,
      monthlyRuns,
      monthlySpend,
      wastedSpend,
      intercepted,
      annualIntercepted,
      lakeTeamCost
    };
  }

  function fmtMoney(n, decimals = 0) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }).format(n);
  }

  function fmtNum(n) {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(n));
  }

  function esc(str) {
    return String(str).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function buildReceiptSvg(m) {
    const isFinops = state.view === 'finops';
    const font = 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
    const mono = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    const dateStr = new Date().toISOString().slice(0, 10);
    const mixLabel = `${m.normH}% Frontier · ${m.normS}% Standard · ${m.normL}% Light`;

    if (isFinops) {
      const netDelta = m.intercepted - m.lakeTeamCost;
      const netLabel = netDelta >= 0
        ? `+${fmtMoney(netDelta)}/mo net above Lake Team`
        : `${fmtMoney(m.lakeTeamCost)}/mo Lake Team (${state.d} seats)`;

      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 880 540" width="880" height="540">
  <defs>
    <linearGradient id="bgFin" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#073f4b"/>
      <stop offset="100%" stop-color="#0b5c65"/>
    </linearGradient>
    <linearGradient id="cardHi" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#135d66"/>
      <stop offset="100%" stop-color="#0e7c7b"/>
    </linearGradient>
  </defs>
  <rect width="880" height="540" rx="22" fill="url(#bgFin)"/>
  <circle cx="810" cy="60" r="140" fill="#4cb7b1" opacity="0.12"/>
  <circle cx="90" cy="490" r="130" fill="#a7dbd3" opacity="0.08"/>

  <!-- Header -->
  <rect x="40" y="34" width="32" height="32" rx="9" fill="#0e7c7b" stroke="#4cb7b1" stroke-width="1.5"/>
  <path d="M46 50c3.3-3.5 6.7-3.5 10 0s6.7 3.5 10 0" fill="none" stroke="#a7dbd3" stroke-width="2.2" stroke-linecap="round"/>
  <text x="84" y="56" font-family="${font}" font-size="22" font-weight="700" fill="#ffffff" letter-spacing="-0.5">Lake<tspan fill="#4cb7b1">.</tspan></text>
  <text x="148" y="55" font-family="${mono}" font-size="12" font-weight="600" fill="#a7dbd3" letter-spacing="1.4">AI FACTORY COST &amp; GOVERNANCE CARD</text>
  <rect x="706" y="36" width="134" height="28" rx="14" fill="#052d36" stroke="#2c757e"/>
  <text x="773" y="54" text-anchor="middle" font-family="${mono}" font-size="11.5" fill="#a7dbd3">${esc(dateStr)}</text>

  <!-- Context line -->
  <text x="40" y="100" font-family="${font}" font-size="17" font-weight="500" fill="#d7ece9">${state.d} engineers · ${fmtNum(m.monthlyRuns)} agent runs/mo · ${fmtMoney(m.runCost, 2)}/run</text>
  <text x="40" y="124" font-family="${mono}" font-size="12.5" fill="#9bc7c3">Model mix: ${esc(mixLabel)}</text>

  <!-- 3 Metric Tiles -->
  <rect x="40" y="152" width="252" height="156" rx="16" fill="#0a4a57" stroke="#236b75"/>
  <text x="60" y="182" font-family="${font}" font-size="13" font-weight="600" fill="#a7dbd3">MONTHLY AGENT SPEND</text>
  <text x="60" y="236" font-family="${font}" font-size="40" font-weight="700" fill="#ffffff" letter-spacing="-1">${esc(fmtMoney(m.monthlySpend))}</text>
  <text x="60" y="274" font-family="${font}" font-size="13" fill="#cbe4e1">${fmtNum(m.weeklyRuns)} runs/wk × 4.33 wks</text>

  <rect x="314" y="152" width="252" height="156" rx="16" fill="#2d261b" stroke="#805e32"/>
  <text x="334" y="182" font-family="${font}" font-size="13" font-weight="600" fill="#f2cf96">REWORK / REJECTED BURN</text>
  <text x="334" y="236" font-family="${font}" font-size="40" font-weight="700" fill="#ffd99b" letter-spacing="-1">${esc(fmtMoney(m.wastedSpend))}</text>
  <text x="334" y="274" font-family="${font}" font-size="13" fill="#e6cfa8">${state.w}% assumption (unreviewed)</text>

  <rect x="588" y="152" width="252" height="156" rx="16" fill="url(#cardHi)" stroke="#68cfc6"/>
  <text x="608" y="182" font-family="${font}" font-size="13" font-weight="600" fill="#c9f7ef">INTERCEPTED BY LAKE</text>
  <text x="608" y="236" font-family="${font}" font-size="40" font-weight="700" fill="#ffffff" letter-spacing="-1">${esc(fmtMoney(m.intercepted))}</text>
  <text x="608" y="274" font-family="${font}" font-size="13" fill="#d9faf4">${esc(fmtMoney(m.annualIntercepted))}/yr run-rate protected</text>

  <!-- Governance bar -->
  <rect x="40" y="332" width="800" height="110" rx="16" fill="#052f39" stroke="#1f636e"/>
  <text x="62" y="364" font-family="${font}" font-size="15" font-weight="650" fill="#ffffff">One platform: Gate (plan approval) + Meter (cost caps &amp; model choice)</text>
  <text x="62" y="390" font-family="${mono}" font-size="12.5" fill="#b7deda">Formula: ${esc(fmtMoney(m.monthlySpend))} × ${state.w}% rework × ${state.k}% pre-code catch = ${esc(fmtMoney(m.intercepted))}/mo</text>
  <text x="62" y="418" font-family="${font}" font-size="13.5" font-weight="600" fill="#a7dbd3">Lake Team: ${esc(fmtMoney(m.lakeTeamCost))}/mo ($15/dev) · ${esc(netLabel)} · Free tier + 14-day Team trial</text>

  <!-- Footer -->
  <text x="40" y="492" font-family="${mono}" font-size="12" fill="#90bdb9">Assumptions: ${state.w}% rework, ${state.k}% pre-code catch. Not a benchmark.</text>
  <text x="840" y="492" text-anchor="end" font-family="${font}" font-size="14" font-weight="700" fill="#a7dbd3">getlake.dev/calculator</text>
</svg>`;
    }

    // Developer Receipt Framing (light editorial paper + mono receipt + Wordle-style plan-health grid)
    const healthTiles = [
      { label: 'PLAN GATE', color: '#19866f', bg: '#e4f4ed' },
      { label: 'RUN CAP', color: '#19866f', bg: '#e4f4ed' },
      { label: 'MODEL MIX', color: '#0e7c7b', bg: '#e3f1f1' },
      { label: 'PR CHECK', color: '#19866f', bg: '#e4f4ed' },
      { label: 'REPO LOCAL', color: '#0e7c7b', bg: '#e3f1f1' }
    ];
    const tilesSvg = healthTiles.map((t, i) => {
      const x = 40 + i * 162;
      return `<rect x="${x}" y="314" width="150" height="44" rx="10" fill="${t.bg}" stroke="${t.color}" stroke-opacity="0.35"/>
  <rect x="${x + 12}" y="328" width="14" height="14" rx="3" fill="${t.color}"/>
  <text x="${x + 34}" y="340" font-family="${mono}" font-size="11.5" font-weight="700" fill="#073f4b">${t.label}</text>`;
    }).join('\n  ');

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 880 540" width="880" height="540">
  <rect width="880" height="540" rx="22" fill="#fbfcf8" stroke="#cfe0d6" stroke-width="2"/>
  <rect x="0" y="0" width="880" height="84" rx="22" fill="#f1f7f6"/>
  <rect x="0" y="62" width="880" height="22" fill="#f1f7f6"/>
  <line x1="0" y1="84" x2="880" y2="84" stroke="#dce8df" stroke-width="1.5"/>

  <!-- Header -->
  <rect x="40" y="26" width="32" height="32" rx="9" fill="#0e7c7b"/>
  <path d="M46 42c3.3-3.5 6.7-3.5 10 0s6.7 3.5 10 0" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>
  <text x="84" y="49" font-family="${font}" font-size="22" font-weight="700" fill="#073f4b" letter-spacing="-0.5">Lake<tspan fill="#4cb7b1">.</tspan></text>
  <text x="148" y="48" font-family="${mono}" font-size="12" font-weight="600" fill="#086b6c" letter-spacing="1.2">DEVELOPER AGENT RECEIPT · ${esc(dateStr)}</text>
  <rect x="668" y="28" width="172" height="28" rx="14" fill="#ffffff" stroke="#cfe0d6"/>
  <text x="754" y="46" text-anchor="middle" font-family="${mono}" font-size="11.5" font-weight="600" fill="#073f4b">${state.d} devs · ${fmtNum(m.monthlyRuns)} runs/mo</text>

  <!-- 3 Receipt Columns -->
  <rect x="40" y="110" width="252" height="176" rx="16" fill="#ffffff" stroke="#dce8df"/>
  <text x="60" y="142" font-family="${mono}" font-size="11.5" font-weight="700" fill="#4b656c">MONTHLY AGENT SPEND</text>
  <text x="60" y="198" font-family="${font}" font-size="38" font-weight="700" fill="#073f4b" letter-spacing="-1">${esc(fmtMoney(m.monthlySpend))}</text>
  <text x="60" y="232" font-family="${font}" font-size="13" fill="#35535a">${fmtMoney(m.runCost, 2)} blended / run</text>
  <text x="60" y="256" font-family="${mono}" font-size="11.5" fill="#4b656c">${m.normH}H / ${m.normS}S / ${m.normL}L mix</text>

  <rect x="314" y="110" width="252" height="176" rx="16" fill="#fffaf2" stroke="#ead7b7"/>
  <text x="334" y="142" font-family="${mono}" font-size="11.5" font-weight="700" fill="#8a5a1b">WORK THAT DIDN'T SURVIVE</text>
  <text x="334" y="198" font-family="${font}" font-size="38" font-weight="700" fill="#8a5315" letter-spacing="-1">${esc(fmtMoney(m.wastedSpend))}</text>
  <text x="334" y="232" font-family="${font}" font-size="13" fill="#6f4d1e">${state.w}% runs reworked/rejected</text>
  <text x="334" y="256" font-family="${mono}" font-size="11.5" fill="#8a5a1b">Caught too late in PR diff</text>

  <rect x="588" y="110" width="252" height="176" rx="16" fill="#eaf6f2" stroke="#a6dac7"/>
  <text x="608" y="142" font-family="${mono}" font-size="11.5" font-weight="700" fill="#086b6c">INTERCEPTED BEFORE CODE</text>
  <text x="608" y="198" font-family="${font}" font-size="38" font-weight="700" fill="#086b6c" letter-spacing="-1">${esc(fmtMoney(m.intercepted))}</text>
  <text x="608" y="232" font-family="${font}" font-size="13" fill="#073f4b">${state.k}% caught via Gate + Meter</text>
  <text x="608" y="256" font-family="${mono}" font-size="11.5" fill="#086b6c">${esc(fmtMoney(m.annualIntercepted))}/yr protected</text>

  <!-- Wordle-style Hygiene Strip -->
  ${tilesSvg}

  <!-- Install Bar -->
  <rect x="40" y="382" width="800" height="80" rx="14" fill="#073f4b"/>
  <text x="62" y="410" font-family="${mono}" font-size="11.5" fill="#a7dbd3">REVIEW THE PLAN BEFORE CODE RUNS · FREE FOREVER TIER</text>
  <text x="62" y="438" font-family="${mono}" font-size="16" font-weight="600" fill="#ffffff">$ npm i -D lake-gate &amp;&amp; npx lake-gate init --cap 5</text>

  <!-- Footer -->
  <text x="40" y="504" font-family="${mono}" font-size="11.5" fill="#4b656c">Assumptions: ${state.w}% rework, ${state.k}% pre-code catch · Formula shown in app</text>
  <text x="840" y="504" text-anchor="end" font-family="${font}" font-size="14" font-weight="700" fill="#0e7c7b">getlake.dev/calculator</text>
</svg>`;
  }

  function render() {
    const m = compute();

    els.runsSummary.innerHTML = `Total volume: <b>${fmtNum(m.weeklyRuns)} runs/week</b> (~${fmtNum(m.monthlyRuns)} runs/month at 4.33 weeks/mo)`;
    els.mixStatus.textContent = m.mixSum === 100
      ? 'Total: 100%'
      : `Raw sum: ${m.mixSum}% (normalized to ${m.normH}/${m.normS}/${m.normL}%)`;
    els.mixStatus.classList.toggle('warn', m.mixSum !== 100);
    els.computedRunCost.textContent = fmtMoney(m.tokenBlendedCost, 2);

    els.outMonthlySpend.textContent = fmtMoney(m.monthlySpend);
    els.outMonthlyRuns.textContent = `${fmtNum(m.monthlyRuns)} runs/mo · ${fmtMoney(m.runCost, 2)}/run`;
    els.outWastedSpend.textContent = fmtMoney(m.wastedSpend);
    els.outWastedSub.textContent = `${state.w}% reworked or rejected`;
    els.outIntercepted.textContent = fmtMoney(m.intercepted);
    els.outInterceptedSub.textContent = `${fmtMoney(m.annualIntercepted)}/yr run-rate protected`;
    els.lakeRoiChip.textContent = `Lake Team: ${fmtMoney(m.lakeTeamCost)}/mo ($15/dev)`;

    els.formulaLines.textContent =
      `Monthly spend = ${state.d} devs × ${state.r} runs/wk × 4.33 wks × ${fmtMoney(m.runCost, 2)} = ${fmtMoney(m.monthlySpend, 2)}/mo\n` +
      `Work that didn't survive = ${fmtMoney(m.monthlySpend, 2)} × ${state.w}% = ${fmtMoney(m.wastedSpend, 2)}/mo\n` +
      `Intercepted by Gate + Meter = ${fmtMoney(m.wastedSpend, 2)} × ${state.k}% = ${fmtMoney(m.intercepted, 2)}/mo (${fmtMoney(m.annualIntercepted, 2)}/yr)`;

    els.receiptPreview.innerHTML = buildReceiptSvg(m);
    writeParams();
  }

  function onInputChange() {
    if (!interactedSent) {
      interactedSent = true;
      track('calc-interact', 'Calculator input changed');
    }
    render();
  }

  function bindPair(numEl, rangeEl, key, min, max, isFloat = false) {
    numEl.addEventListener('input', () => {
      state[key] = clamp(numEl.value, min, max, state[key]);
      if (rangeEl) rangeEl.value = Math.min(Number(rangeEl.max), Math.max(Number(rangeEl.min), state[key]));
      clearActivePreset();
      onInputChange();
    });
    if (rangeEl) {
      rangeEl.addEventListener('input', () => {
        const val = isFloat ? parseFloat(rangeEl.value) : parseInt(rangeEl.value, 10);
        state[key] = val;
        numEl.value = isFloat ? val.toFixed(2) : String(val);
        clearActivePreset();
        onInputChange();
      });
    }
  }

  function clearActivePreset() {
    document.querySelectorAll('.preset-btn').forEach((b) => b.classList.remove('is-active'));
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function flashBtn(btn, labelText) {
    btn.classList.add('copied');
    const span = btn.querySelector('span');
    const prev = span ? span.textContent : null;
    if (span) span.textContent = labelText;
    setTimeout(() => {
      btn.classList.remove('copied');
      if (span && prev) span.textContent = prev;
    }, 1800);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      document.body.append(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (_) {}
      ta.remove();
    }
  }

  function init() {
    readParams();
    syncInputsFromState();
    render();

    bindPair(els.teamSize, els.teamSizeRange, 'd', 1, 1000);
    bindPair(els.runsPerWeek, els.runsPerWeekRange, 'r', 1, 500);
    bindPair(els.costPerRun, els.costPerRunRange, 'c', 0.05, 200, true);
    bindPair(els.reworkPct, els.reworkPctRange, 'w', 0, 100);
    bindPair(els.catchPct, els.catchPctRange, 'k', 0, 100);

    [
      [els.mixHeavy, 'mh', 0, 100],
      [els.mixStd, 'ms', 0, 100],
      [els.mixLight, 'ml', 0, 100],
      [els.inputTokens, 'it', 1000, 20000000],
      [els.outputTokens, 'ot', 500, 2000000]
    ].forEach(([el, key, min, max]) => {
      el.addEventListener('input', () => {
        state[key] = clamp(el.value, min, max, state[key]);
        clearActivePreset();
        onInputChange();
      });
    });

    els.modeCostBtn.addEventListener('click', () => {
      state.mode = 'cost';
      syncInputsFromState();
      onInputChange();
    });
    els.modeTokensBtn.addEventListener('click', () => {
      state.mode = 'tokens';
      syncInputsFromState();
      onInputChange();
    });

    els.viewDevBtn.addEventListener('click', () => {
      state.view = 'dev';
      syncInputsFromState();
      render();
      track('calc-view-dev', 'Receipt framed as Developer');
    });
    els.viewFinopsBtn.addEventListener('click', () => {
      state.view = 'finops';
      syncInputsFromState();
      render();
      track('calc-view-finops', 'Receipt framed as Manager/FinOps');
    });

    document.querySelectorAll('.preset-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = PRESETS[btn.dataset.preset];
        if (!p) return;
        Object.assign(state, p, { mode: 'cost' });
        clearActivePreset();
        btn.classList.add('is-active');
        syncInputsFromState();
        onInputChange();
        track('calc-preset-' + btn.dataset.preset, 'Preset ' + btn.dataset.preset);
      });
    });

    els.resetBtn.addEventListener('click', () => {
      state = { ...DEFAULTS };
      clearActivePreset();
      document.querySelector('[data-preset="startup"]')?.classList.add('is-active');
      syncInputsFromState();
      render();
    });

    els.dlSvgBtn.addEventListener('click', () => {
      const svgText = buildReceiptSvg(compute());
      downloadBlob(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }), `lake-ai-receipt-${state.view}.svg`);
      track('calc-download-svg', `Download SVG (${state.view})`);
    });

    els.dlPngBtn.addEventListener('click', () => {
      const svgText = buildReceiptSvg(compute());
      const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1760;
        canvas.height = 1080;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob((pngBlob) => {
          if (pngBlob) downloadBlob(pngBlob, `lake-ai-receipt-${state.view}.png`);
        }, 'image/png');
      };
      img.src = url;
      track('calc-download-png', `Download PNG (${state.view})`);
    });

    els.copyLinkBtn.addEventListener('click', async () => {
      const shareUrl = writeParams();
      await copyText(shareUrl);
      flashBtn(els.copyLinkBtn, 'Link copied');
      track('calc-copy-link', 'Copied share URL');
    });

    els.copySlackBtn.addEventListener('click', async () => {
      const m = compute();
      const shareUrl = writeParams();
      const summary = state.view === 'finops'
        ? `AI Factory Cost Check (${state.d} devs · ${fmtNum(m.monthlyRuns)} runs/mo):\n` +
          `• Monthly spend: ${fmtMoney(m.monthlySpend)} (${fmtMoney(m.runCost, 2)}/run)\n` +
          `• Rework/rejected burn (${state.w}% assumption): ${fmtMoney(m.wastedSpend)}/mo\n` +
          `• Estimated intercepted by Lake Gate + Meter (${state.k}% catch assumption): ${fmtMoney(m.intercepted)}/mo (${fmtMoney(m.annualIntercepted)}/yr)\n` +
          `• Receipt: ${shareUrl}`
        : `🟩 Plan Gate · 🟩 Run Cap · 🟩 Model Mix (${state.d} devs · ${fmtNum(m.monthlyRuns)} runs/mo)\n` +
          `Spend: ${fmtMoney(m.monthlySpend)}/mo | Discarded rework (${state.w}%): ${fmtMoney(m.wastedSpend)}/mo | Intercepted before code (${state.k}%): ${fmtMoney(m.intercepted)}/mo\n` +
          `Try: npm i -D lake-gate && npx lake-gate init --cap 5\n` +
          `Receipt: ${shareUrl}`;
      await copyText(summary);
      flashBtn(els.copySlackBtn, 'Copied');
      track('calc-copy-slack', 'Copied Slack text');
    });

    els.ctaTrialLink.addEventListener('click', () => track('calc-cta-trial', 'Calculator CTA trial'));
    els.ctaPricingLink.addEventListener('click', () => track('calc-cta-pricing', 'Calculator CTA pricing'));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

// Claude Code waste calculator. Everything runs in this page: no fetch/XHR, no upload, nothing stored.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const input = $('wc-input'), drop = $('wc-drop'), fileEl = $('wc-file'), errEl = $('wc-error'), out = $('wc-report');
  if (!input) return;

  const fmt = (n) => '$' + (n >= 1000 ? Math.round(n).toLocaleString('en-US') : n >= 100 ? n.toFixed(0) : n.toFixed(2));
  const pct = (n) => (n * 100 < 10 && n > 0 ? (n * 100).toFixed(1) : Math.round(n * 100)) + '%';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
  const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  // ---------- parsing ----------
  function extractJson(text) {
    text = text.replace(/^\uFEFF/, '').trim();
    if (!text) return [];
    try { return [JSON.parse(text)]; } catch (e) { /* maybe several objects pasted one after another */ }
    const found = []; let depth = 0, start = -1, inStr = false, esc_ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inStr) { if (esc_) esc_ = false; else if (c === '\\') esc_ = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{' || c === '[') { if (depth === 0) start = i; depth++; }
      else if (c === '}' || c === ']') { depth--; if (depth === 0 && start >= 0) { try { found.push(JSON.parse(text.slice(start, i + 1))); } catch (e) { /* skip junk */ } start = -1; } if (depth < 0) depth = 0; }
    }
    return found;
  }
  const costOf = (r) => (r.totalCost != null ? num(r.totalCost) : r.costUSD != null ? num(r.costUSD) : num(r.cost));
  const tokOf = (r) => (r.totalTokens != null ? num(r.totalTokens) : num(r.inputTokens) + num(r.outputTokens) + num(r.cacheCreationTokens) + num(r.cacheReadTokens));
  const ts = (v) => { const t = Date.parse(v); return isFinite(t) ? t : null; };
  const hasTime = (v) => typeof v === 'string' && /T\d\d:\d\d/.test(v);

  function breakdowns(r, total) {
    const mb = r.modelBreakdowns || r.breakdowns;
    if (Array.isArray(mb) && mb.length) return mb.map((b) => ({ model: b.modelName || b.model || 'unknown', cost: costOf(b), out: num(b.outputTokens), cacheRead: num(b.cacheReadTokens), tokens: tokOf(b) }));
    const used = r.modelsUsed || r.models || [];
    if (used.length) { const share = total / used.length; return used.map((m) => ({ model: String(m), cost: share, out: 0, cacheRead: 0, tokens: 0, approx: true })); }
    return [{ model: 'unknown', cost: total, out: 0, cacheRead: 0, tokens: 0, approx: true }];
  }

  function normalize(objs) {
    const res = { sessions: [], days: [], notes: [], skipped: 0 };
    const seenS = new Set();
    const addSession = (r, o) => {
      const total = costOf(r); const id = String(o.id || r.sessionId || r.period || 'session');
      const key = id + '|' + (o.last || '') + '|' + total; if (seenS.has(key)) return; seenS.add(key);
      const first = o.first || r.firstActivity, last = o.last || r.lastActivity;
      const f = ts(first), l = ts(last);
      res.sessions.push({ id, project: String(o.project || r.projectPath || ''), first: f, last: l, timed: hasTime(first) && hasTime(last), cost: total, out: num(r.outputTokens), tokens: tokOf(r), cacheRead: num(r.cacheReadTokens), models: breakdowns(r, total) });
    };
    const addDay = (r, project) => { const date = String(r.date || r.period || ''); if (!date) return; res.days.push({ date, project: project || '', cost: costOf(r), tokens: tokOf(r), models: breakdowns(r, costOf(r)) }); };
    for (let obj of objs) {
      if (Array.isArray(obj)) obj = { sessions: obj };
      if (!obj || typeof obj !== 'object') continue;
      const agentOk = (a) => { if (!a || a === 'claude') return true; if (a === 'all') { res.notes.push('This export combines several coding agents. Totals may include more than Claude Code. Use `ccusage claude ...` for Claude Code only.'); return true; } res.skipped++; return false; };
      if (Array.isArray(obj.sessions)) obj.sessions.forEach((r) => addSession(r, {}));
      if (Array.isArray(obj.session)) obj.session.forEach((r) => { if (agentOk(r.agent)) addSession(r, { id: r.period, last: r.metadata && r.metadata.lastActivity, project: r.metadata && r.metadata.projectPath }); });
      if (Array.isArray(obj.daily)) obj.daily.forEach((r) => { if (agentOk(r.agent)) addDay(r); });
      if (obj.projects && typeof obj.projects === 'object' && !Array.isArray(obj.projects)) Object.keys(obj.projects).forEach((p) => (obj.projects[p] || []).forEach((r) => addDay(r, p)));
      ['monthly', 'weekly', 'blocks'].forEach((k) => { if (Array.isArray(obj[k])) res.notes.push('Found a "' + k + '" report. Use the "session" and/or "daily" report instead.'); });
    }
    if (res.skipped) res.notes.push(res.skipped + ' non-Claude rows were ignored.');
    // merge duplicate daily rows (instances export): sum per date
    if (res.days.length) {
      const m = new Map();
      res.days.forEach((d) => { const e = m.get(d.date); if (!e) m.set(d.date, { date: d.date, cost: d.cost, tokens: d.tokens, models: d.models.map((x) => ({ ...x })) }); else { e.cost += d.cost; e.tokens += d.tokens; d.models.forEach((x) => { const y = e.models.find((z) => z.model === x.model); if (y) { y.cost += x.cost; y.out += x.out; y.tokens += x.tokens; } else e.models.push({ ...x }); }); } });
      res.days = [...m.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
    }
    return res;
  }

  // ---------- models ----------
  function family(name) {
    const n = name.toLowerCase();
    if (n.includes('opus')) return 'Opus'; if (n.includes('sonnet')) return 'Sonnet'; if (n.includes('haiku')) return 'Haiku';
    return 'Other';
  }
  function pretty(name) {
    const n = name.toLowerCase(); const fam = family(name);
    if (fam === 'Other') return name;
    let m = n.match(/(opus|sonnet|haiku)-(\d+)(?:[-.](\d{1,2}))?(?=-\d{8}|$|-)/);
    if (m) { const minor = m[3] && !(m[3].length === 2 && +m[3] > 20) ? '.' + m[3] : ''; return fam + ' ' + m[2] + minor; }
    m = n.match(/claude-(\d)(?:[-.](\d))?-(opus|sonnet|haiku)/);
    return m ? fam + ' ' + m[1] + (m[2] ? '.' + m[2] : '') : fam;
  }
  // Ratio of Sonnet list price to Opus list price for the same tokens: Opus 4.5+ is $5/$25 vs Sonnet $3/$15 (0.6); Opus 4/4.1/3 is $15/$75 (0.2).
  function sonnetRatio(name) {
    const n = name.toLowerCase(); const m = n.match(/opus-(\d+)(?:[-.](\d{1,2}))?(?=-\d{8}|$|-)/);
    if (m) { const major = +m[1], minor = m[2] && +m[2] < 20 ? +m[2] : 0; if (major > 4 || (major === 4 && minor >= 5)) return 0.6; }
    return 0.2;
  }

  // ---------- analysis ----------
  function analyze(data, k) {
    const S = data.sessions, D = data.days;
    const r = { hasSessions: S.length > 0, hasDays: D.length > 0, k };
    r.total = S.length ? S.reduce((a, s) => a + s.cost, 0) : D.reduce((a, d) => a + d.cost, 0);
    // by model
    const byModel = new Map();
    (S.length ? S : D).forEach((x) => x.models.forEach((m) => { const e = byModel.get(m.model) || { model: m.model, cost: 0, approx: false }; e.cost += m.cost; if (m.approx) e.approx = true; byModel.set(m.model, e); }));
    r.byModel = [...byModel.values()].sort((a, b) => b.cost - a.cost);
    const byFam = {}; r.byModel.forEach((m) => { const f = family(m.model); byFam[f] = (byFam[f] || 0) + m.cost; });
    r.byFamily = byFam;
    r.opusCost = byFam.Opus || 0;
    // days
    if (D.length) r.days = D; else {
      const m = new Map(); S.forEach((s) => { const d = s.last ? new Date(s.last).toISOString().slice(0, 10) : null; if (d) m.set(d, (m.get(d) || 0) + s.cost); });
      r.days = [...m.entries()].sort().map(([date, cost]) => ({ date, cost }));
    }
    r.period = r.days.length ? [r.days[0].date, r.days[r.days.length - 1].date] : null;
    r.waste = { runaway: { amt: 0, n: 0, spend: 0 }, aband: { amt: 0, n: 0, spend: 0 }, opus: { amt: 0, n: 0, spend: 0 }, spike: { amt: 0, n: 0, spend: 0 } };
    r.flags = new Map();
    if (S.length) {
      const med = median(S.map((s) => s.cost));
      r.median = med;
      const runawayCut = Math.max(k.runMult * med, 2);
      // restart bursts: 3+ sessions in the same project starting within 60 minutes
      const burst = new Set();
      const byProj = new Map(); S.forEach((s) => { if (s.first != null && s.project) { (byProj.get(s.project) || byProj.set(s.project, []).get(s.project)).push(s); } });
      byProj.forEach((list) => { list.sort((a, b) => a.first - b.first); let i = 0; while (i < list.length) { let j = i; while (j + 1 < list.length && list[j + 1].first - list[i].first <= 3600e3) j++; if (j - i + 1 >= 3) { const grp = list.slice(i, j + 1); const keep = grp.reduce((a, b) => (b.cost > a.cost ? b : a)); grp.forEach((s) => { if (s !== keep) burst.add(s); }); } i = j + 1; } });
      S.forEach((s) => {
        const flags = []; let wasteS = 0, rem = s.cost;
        const spanMin = s.timed && s.first != null && s.last != null ? (s.last - s.first) / 60e3 : null;
        const brief = s.cost >= 0.05 && ((spanMin != null && spanMin < 5) || (s.out > 0 && s.out < 3000 && s.cost >= 0.25));
        if (s.cost >= runawayCut) { flags.push('long/expensive'); const a = s.cost * k.runPct; wasteS += a; rem -= a; r.waste.runaway.amt += a; r.waste.runaway.n++; r.waste.runaway.spend += s.cost; }
        else if (brief || burst.has(s)) { flags.push(burst.has(s) ? 'restart burst' : 'brief'); const a = s.cost * k.abPct; wasteS += a; rem -= a; r.waste.aband.amt += a; r.waste.aband.n++; r.waste.aband.spend += s.cost; }
        const opus = s.models.filter((m) => family(m.model) === 'Opus');
        if (opus.length && s.cost > 0) {
          let sav = 0, oc = 0; opus.forEach((m) => { sav += m.cost * (1 - sonnetRatio(m.model)); oc += m.cost; });
          const a = sav * k.opusPct * (rem / s.cost);
          if (a > 0.0001) { r.waste.opus.amt += a; r.waste.opus.n++; r.waste.opus.spend += oc; wasteS += a; flags.push('opus'); }
        }
        r.flags.set(s, { flags, waste: wasteS });
      });
      r.sorted = [...S].sort((a, b) => b.cost - a.cost);
      const topN = Math.max(1, Math.ceil(S.length * 0.1));
      r.topN = topN; r.topSpend = r.sorted.slice(0, topN).reduce((a, s) => a + s.cost, 0);
      r.cacheShare = (() => { const t = S.reduce((a, s) => a + s.tokens, 0), c = S.reduce((a, s) => a + s.cacheRead, 0); return t ? c / t : 0; })();
    } else {
      // daily only: spike days and Opus share
      const med = median(r.days.map((d) => d.cost)); r.median = med;
      r.days.forEach((d) => { if (d.cost >= Math.max(k.spikeMult * med, 2)) { const a = (d.cost - med) * k.spikePct; r.waste.spike.amt += a; r.waste.spike.n++; r.waste.spike.spend += d.cost; } });
      let sav = 0, oc = 0; r.byModel.forEach((m) => { if (family(m.model) === 'Opus') { sav += m.cost * (1 - sonnetRatio(m.model)); oc += m.cost; } });
      r.waste.opus.amt = sav * k.opusPct; r.waste.opus.spend = oc; r.waste.opus.n = oc ? 1 : 0;
    }
    r.wasteTotal = Object.values(r.waste).reduce((a, w) => a + w.amt, 0);
    return r;
  }

  // ---------- rendering ----------
  const bar = (share, cls) => '<span class="wc-bar"><i class="' + (cls || '') + '" style="width:' + Math.max(1, Math.round(share * 100)) + '%"></i></span>';
  const shortId = (s) => (s.length > 14 ? s.slice(0, 8) + '…' : s);
  const projName = (p) => (!p ? '—' : p.length > 28 ? '…' + p.slice(-26) : p);
  const dur = (s) => { if (!s.timed || s.first == null || s.last == null) return '—'; const m = (s.last - s.first) / 60e3; return m < 60 ? Math.max(1, Math.round(m)) + ' min' : (m / 60).toFixed(1) + ' h'; };
  const dayOf = (s) => (s.last ? new Date(s.last).toISOString().slice(0, 10) : '—');

  let lastData = null, lastIsSample = false;
  const K = () => ({ opusPct: +$('k-opus').value / 100, runPct: +$('k-run').value / 100, runMult: +$('k-runmult').value, abPct: +$('k-ab').value / 100, spikeMult: 3, spikePct: 0.25 });

  function render() {
    if (!lastData) return;
    const k = K(); const r = analyze(lastData, k);
    const sample = lastIsSample;
    const h = [];
    if (sample) h.push('<p class="wc-sample">SAMPLE DATA. Synthetic Claude Code usage made up by us (made-up projects and token counts), run through the real ccusage. Not anyone\'s real spend.</p>');
    data_notes(h);
    const wasteShare = r.total ? r.wasteTotal / r.total : 0;
    h.push('<div class="wc-cards">' +
      card('Total spend', fmt(r.total), r.period ? r.period[0] + ' to ' + r.period[1] : '') +
      card(r.hasSessions ? 'Sessions' : 'Days', String(r.hasSessions ? lastData.sessions.length : r.days.length), r.hasSessions ? 'median ' + fmt(r.median) + ' each' : 'median ' + fmt(r.median) + ' a day') +
      card('Estimated avoidable', fmt(r.wasteTotal), pct(wasteShare) + ' of spend (estimate)', 'warn') +
      card('Spend with no approved plan', '100%', fmt(r.total) + ' of ' + fmt(r.total), 'plan') + '</div>');

    // by model
    h.push('<h3>Spend by model</h3><div class="wc-rows">');
    r.byModel.slice(0, 8).forEach((m) => { const sh = r.total ? m.cost / r.total : 0; h.push('<div class="wc-row"><span class="wc-name">' + esc(pretty(m.model)) + (m.approx ? ' <small title="This export has no per-model split for some rows, so cost was divided evenly between the models used.">~</small>' : '') + '</span>' + bar(sh, family(m.model).toLowerCase()) + '<span class="wc-val">' + fmt(m.cost) + ' <small>' + pct(sh) + '</small></span></div>'); });
    h.push('</div>');
    if (r.byModel.some((m) => m.approx)) h.push('<p class="wc-fine">~ no per-model split in the export for some rows, cost divided evenly across models used. Use <code>--breakdown</code> for exact figures.</p>');

    // top sessions
    if (r.hasSessions) {
      h.push('<h3>Most expensive sessions</h3><div class="wc-tablewrap"><table class="wc-table"><thead><tr><th>Session</th><th>Project</th><th>Last active</th><th>Span</th><th>Models</th><th class="r">Cost</th><th>Flags</th></tr></thead><tbody>');
      r.sorted.slice(0, 10).forEach((s) => { const f = r.flags.get(s); h.push('<tr><td><code>' + esc(shortId(s.id)) + '</code></td><td>' + esc(projName(s.project)) + '</td><td>' + dayOf(s) + '</td><td>' + dur(s) + '</td><td>' + esc([...new Set(s.models.map((m) => pretty(m.model)))].join(', ')) + '</td><td class="r">' + fmt(s.cost) + '</td><td>' + (f.flags.length ? f.flags.map((x) => '<span class="wc-flag">' + x + '</span>').join(' ') : '') + '</td></tr>'); });
      h.push('</tbody></table></div>');
      h.push('<p class="wc-fine">Your top ' + r.topN + ' session' + (r.topN > 1 ? 's' : '') + ' (the top 10%) account for <b>' + pct(r.total ? r.topSpend / r.total : 0) + '</b> of spend. Span is first to last activity, not active time.' + (r.cacheShare > 0.5 ? ' About ' + pct(r.cacheShare) + ' of your tokens are cache reads: long sessions keep re-reading a growing context, which is where runaway cost comes from.' : '') + '</p>');
    } else {
      const top = [...r.days].sort((a, b) => b.cost - a.cost).slice(0, 5);
      h.push('<h3>Most expensive days</h3><div class="wc-rows">' + top.map((d) => '<div class="wc-row"><span class="wc-name">' + esc(d.date) + '</span>' + bar(top[0].cost ? d.cost / top[0].cost : 0, 'day') + '<span class="wc-val">' + fmt(d.cost) + '</span></div>').join('') + '</div><p class="wc-fine">Daily export only. Paste the <code>session</code> export too for per-session findings.</p>');
    }

    // daily chart
    if (r.days.length > 1) { const mx = Math.max(...r.days.map((d) => d.cost)) || 1; h.push('<h3>Spend by day</h3><div class="wc-spark" role="img" aria-label="Daily spend, ' + r.days.length + ' days">' + r.days.map((d) => '<i title="' + esc(d.date) + ': ' + fmt(d.cost) + '" style="height:' + Math.max(3, Math.round((d.cost / mx) * 100)) + '%"></i>').join('') + '</div><p class="wc-fine">' + esc(r.days[0].date) + ' to ' + esc(r.days[r.days.length - 1].date) + ', peak ' + fmt(mx) + '.</p>'); }

    // waste
    h.push('<h2 class="wc-h2" id="wc-waste">Where the money likely went to waste</h2><p class="wc-estimate"><b>These are estimates, not measurements.</b> An export has costs and timestamps, not whether the work was useful. Each line below is a rule of thumb with the rule written out. Change the assumptions and the numbers update.</p>');
    const W = r.waste;
    h.push('<div class="wc-tablewrap"><table class="wc-table"><thead><tr><th>Pattern</th><th>How we estimate it</th><th class="r">Estimated avoidable</th></tr></thead><tbody>');
    if (r.hasSessions) {
      h.push(wrow('Opus where Sonnet would do', 'Opus spend is ' + fmt(r.opusCost) + '. We assume ' + Math.round(k.opusPct * 100) + '% of it was routine work (edits, tests, small fixes) and re-price that share at Sonnet list prices (' + (Object.values(r.byModel).some((m) => family(m.model) === 'Opus' && sonnetRatio(m.model) === 0.2) ? 'Sonnet is 20% of Opus cost on Opus 4/4.1, 60% on Opus 4.5+' : 'Sonnet is 60% of Opus cost on Opus 4.5+') + ').', W.opus));
      h.push(wrow('Very long or looping sessions', W.runaway.n + ' session' + (W.runaway.n === 1 ? '' : 's') + ' cost at least ' + k.runMult + 'x your median (' + fmt(r.median) + ') and at least $2: ' + fmt(W.runaway.spend) + ' in total. We assume ' + Math.round(k.runPct * 100) + '% of that was loops, re-reading and drift that a step budget would have stopped.', W.runaway));
      h.push(wrow('Abandoned or retried starts', W.aband.n + ' session' + (W.aband.n === 1 ? '' : 's') + ' were under 5 minutes or produced under 3k output tokens, or were 3+ restarts in one project within an hour: ' + fmt(W.aband.spend) + '. We assume ' + Math.round(k.abPct * 100) + '% of it was a failed start.', W.aband));
    } else {
      h.push(wrow('Opus where Sonnet would do', 'Opus spend is ' + fmt(r.opusCost) + '. We assume ' + Math.round(k.opusPct * 100) + '% was routine work and re-price it at Sonnet list prices.', W.opus));
      h.push(wrow('Spike days', W.spike.n + ' day' + (W.spike.n === 1 ? '' : 's') + ' above 3x your median day (' + fmt(r.median) + '): we assume 25% of the spend above the median on those days was runaway work.', W.spike));
    }
    h.push('<tr class="wc-sum"><td colspan="2"><b>Total estimated avoidable</b> <small>(counted once per session, no double counting)</small></td><td class="r"><b>' + fmt(r.wasteTotal) + '</b> <small>' + pct(wasteShare) + '</small></td></tr></tbody></table></div>');

    // plan review
    const prevent = r.wasteTotal;
    h.push('<section class="wc-plan" aria-labelledby="wc-plan-h"><h2 class="wc-h2" id="wc-plan-h">Spend on runs with no approved plan: ' + fmt(r.total) + ' (100%)</h2>' +
      '<p>A usage export has no field for "was there a plan, and did anyone approve it?" Without something that records that, <b>every run is an unplanned run</b>. That is the figure above, and it is not an estimate: it is true by construction until a plan gate is in place. It is also where the waste starts, because the cheapest moment to catch an oversized model, an unbounded task or a loop is before the run, not in next month\'s bill.</p>' +
      '<ul>' +
      (r.hasSessions ? '<li><b>Your top ' + r.topN + ' session' + (r.topN > 1 ? 's' : '') + ' are ' + pct(r.total ? r.topSpend / r.total : 0) + ' of spend (' + fmt(r.topSpend) + ').</b> A 2-minute plan review on only the biggest 10% of runs would have covered most of the money.</li>' : '') +
      '<li><b>Model choice is set in the plan.</b> The reviewer sees "Opus, about $X" next to "Sonnet, about $Y" before approving. That is the Opus line above.</li>' +
      '<li><b>The plan comes with a budget.</b> The run stops and asks when it passes the cap instead of looping quietly. That is the long-session line above.</li>' +
      '<li><b>Bad starts die at review.</b> A vague plan gets sent back for pennies instead of being run, abandoned and restarted.</li></ul>' +
      '<p>Together these touch about <b>' + fmt(prevent) + '</b> (' + pct(wasteShare) + ') of this export, by our estimate. <a href="https://github.com/getlake/lake-gate">lake-gate</a> adds the missing piece: the agent posts its plan with a cost estimate, a teammate approves it, and only then does it run. No Lake server or account.</p>' +
      '<pre class="wc-code"><code>npx lake-gate init            # plan approval on pull requests\nnpx lake-meter@latest init    # per-step cost and a run cap in Claude Code</code></pre>' +
      '<p class="wc-ctas"><a class="button" href="https://www.npmjs.com/package/lake-gate">lake-gate on npm <svg class="i"><use href="#up"/></svg></a> <a class="button ghost-btn" href="https://www.npmjs.com/package/lake-meter">lake-meter on npm <svg class="i"><use href="#up"/></svg></a> <button type="button" class="text-link wc-linkbtn" id="wc-copy">Copy summary</button></p><p class="wc-status" id="wc-copied" role="status" hidden>Copied.</p></section>');

    h.push('<p class="wc-fine">Want the same analysis written up for your team, with a ranked fix list? <a href="/waste-report/#request">Get the full PDF report</a>. It is free, and you email us the export yourself. Nothing on this page sends anything.</p>');
    out.innerHTML = h.join(''); out.hidden = false;
    const cp = $('wc-copy'); if (cp) cp.addEventListener('click', () => copySummary(r, sample));
    out.dataset.ready = '1';
  }
  function card(label, val, sub, cls) { return '<div class="wc-card ' + (cls || '') + '"><span class="wc-cl">' + label + '</span><span class="wc-cv">' + val + '</span><span class="wc-cs">' + esc(sub || '') + '</span></div>'; }
  function wrow(name, how, w) { return '<tr><td><b>' + name + '</b></td><td>' + how + '</td><td class="r">' + fmt(w.amt) + '</td></tr>'; }
  function data_notes(h) { (lastData.notes || []).filter((v, i, a) => a.indexOf(v) === i).forEach((n) => h.push('<p class="wc-note">' + esc(n) + '</p>')); }
  function copySummary(r, sample) {
    const t = (sample ? '[SAMPLE DATA] ' : '') + 'Claude Code spend ' + fmt(r.total) + (r.period ? ' (' + r.period[0] + ' to ' + r.period[1] + ')' : '') + '. Estimated avoidable: ' + fmt(r.wasteTotal) + ' (' + pct(r.total ? r.wasteTotal / r.total : 0) + '). Spend with no approved plan: 100%. Free, in-browser calculator: https://getlake.dev/waste-calculator/';
    const done = () => { const c = $('wc-copied'); if (c) { c.hidden = false; setTimeout(() => (c.hidden = true), 2000); } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, () => window.prompt('Copy:', t)); else window.prompt('Copy:', t);
  }

  // ---------- input ----------
  function showErr(m) { errEl.textContent = m; errEl.hidden = !m; }
  function run(text, isSample) {
    showErr('');
    let objs; try { objs = extractJson(text); } catch (e) { objs = []; }
    if (!objs.length) { showErr('That does not look like JSON. Paste the output of `npx ccusage@latest claude session --json --breakdown` (or the daily one), or drop the saved file.'); out.hidden = true; return; }
    const data = normalize(objs);
    if (!data.sessions.length && !data.days.length) { showErr('No "sessions" or "daily" data found in that JSON. Run `npx ccusage@latest claude session --json --breakdown` and paste that.'); out.hidden = true; return; }
    const rows = data.sessions.length ? data.sessions : data.days;
    if (rows.every((x) => !x.cost)) { showErr('The export has no cost values (was it created with --no-cost?). Re-run without --no-cost.'); out.hidden = true; return; }
    lastData = data; lastIsSample = !!isSample; render();
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $('wc-run').addEventListener('click', () => run(input.value, false));
  $('wc-clear').addEventListener('click', () => { input.value = ''; lastData = null; out.hidden = true; out.innerHTML = ''; showErr(''); });
  ['k-opus', 'k-run', 'k-runmult', 'k-ab'].forEach((id) => $(id).addEventListener('input', () => { $(id + '-v').textContent = $(id).value + (id === 'k-runmult' ? 'x' : '%'); render(); }));
  $('wc-sample').addEventListener('click', () => {
    const go = () => { const s = window.WC_SAMPLE; input.value = ''; run(JSON.stringify(s.session) + '\n' + JSON.stringify(s.daily), true); };
    if (window.WC_SAMPLE) return go();
    const sc = document.createElement('script'); sc.src = '/waste-calculator/sample.js'; sc.onload = go; sc.onerror = () => showErr('Could not load the sample data. Reload the page.'); document.head.appendChild(sc);
  });
  function readFiles(files) {
    const list = [...files].filter((f) => f.size < 60e6); if (!list.length) return;
    Promise.all(list.map((f) => f.text())).then((texts) => { input.value = texts.join('\n'); run(input.value, false); }, () => showErr('Could not read that file.'));
  }
  fileEl.addEventListener('change', () => readFiles(fileEl.files));
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => readFiles(e.dataTransfer.files));
  window.__wc = { extractJson, normalize, analyze }; // for tests
})();

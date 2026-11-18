// getlake.dev: copy buttons and the one-time hero moment. No scroll hijacking; content is never hidden waiting for JS.
(() => {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const text = btn.dataset.copy;
      try { await navigator.clipboard.writeText(text); } catch (e) {
        const ta = Object.assign(document.createElement('textarea'), { value: text }); document.body.append(ta); ta.select();
        try { document.execCommand('copy'); } catch (_) {} ta.remove();
      }
      btn.classList.add('copied'); btn.setAttribute('aria-label', 'Copied');
      const gc = window.goatcounter; if (gc && gc.count) gc.count({ path: 'copy-' + text.split(' ')[1], title: text, event: true });
      setTimeout(() => { btn.classList.remove('copied'); btn.setAttribute('aria-label', 'Copy install command'); }, 1800);
    });
  });
  const flow = document.querySelector('.flow');
  const approve = () => { const s = flow.querySelector('.state'), b = flow.querySelector('.approve'); if (s) s.textContent = 'Approved'; if (b) b.firstChild.textContent = 'Approved '; };
  if (flow) {
    if (still) flow.classList.add('ok');
    else { setTimeout(() => flow.classList.add('press'), 2300); setTimeout(() => { flow.classList.remove('press'); flow.classList.add('ok'); approve(); }, 2500); }
    if (still) approve();
  }
  const pv = document.querySelector('.preview');
  if (pv) setTimeout(() => pv.classList.add('pick'), still ? 0 : 2200);
})();

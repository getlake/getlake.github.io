// Waste report request: composes a mailto (no upload backend) and counts a GoatCounter event.
(() => {
  const TO = 'lake.research1@gmail.com';
  const gcQueue = [];
  let gcTimer = null;
  const gcFlush = () => { const gc = window.goatcounter; if (!(gc && gc.count)) return false; while (gcQueue.length) gc.count(gcQueue.shift()); return true; };
  const gcEvent = (path, title) => {
    gcQueue.push({ path, title: title || path, event: true });
    if (gcFlush() || gcTimer) return;
    let n = 0;
    gcTimer = setInterval(() => { if (gcFlush() || ++n > 60) { clearInterval(gcTimer); gcTimer = null; } }, 250);
  };
  const form = document.getElementById('wr-form');
  if (!form) return;
  const err = document.getElementById('wr-error');
  const status = document.getElementById('wr-status');
  document.querySelectorAll('a[href$="sample-report.pdf"]').forEach((a) => a.addEventListener('click', () => gcEvent('waste-report-sample', 'Waste report sample PDF')));
  const f = form.elements;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = f['name'].value.trim();
    const email = f['email'].value.trim();
    const team = f['team'].value;
    const file = f['file'].files && f['file'].files[0] ? f['file'].files[0].name : '';
    const missing = [];
    if (!name) missing.push('name');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) missing.push('a valid work email');
    if (!team) missing.push('team size');
    if (missing.length) { err.textContent = 'Please add ' + missing.join(', ') + '.'; err.hidden = false; return; }
    err.hidden = true;
    const body = [
      'Hi Lake,', '',
      'Please send me a Claude Code waste report.', '',
      'Name: ' + name,
      'Work email: ' + email,
      'Team size: ' + team,
      'Export file: ' + (file || '(attached)'), '',
      'I have attached my usage export (token and cost metadata only) to this email.'
    ].join('\n');
    const href = 'mailto:' + TO + '?subject=' + encodeURIComponent('Waste report request') + '&body=' + encodeURIComponent(body);
    gcEvent('waste-report-submit', 'Waste report request composed');
    status.textContent = 'Your email app should open now. Attach ' + (file ? '"' + file + '"' : 'your export file') + ' before you send. If nothing opened, email ' + TO + ' directly.';
    status.hidden = false;
    setTimeout(() => { window.location.href = href; }, 150);
  });
})();

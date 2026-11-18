// GoatCounter events. count.js loads async, so queue until window.goatcounter.count exists (polls for up to 15 s).
const gcQueue = [];
let gcTimer = null;
const gcFlush = () => { const gc = window.goatcounter; if (!(gc && gc.count)) return false; while (gcQueue.length) gc.count(gcQueue.shift()); return true; };
function gcEvent(path, title) {
  gcQueue.push({ path, title: title || path, event: true });
  if (gcFlush() || gcTimer) return;
  let n = 0;
  gcTimer = setInterval(() => { if (gcFlush() || ++n > 60) { clearInterval(gcTimer); gcTimer = null; } }, 250);
}

// Both CTAs take their href from window.LAKE_PLATFORM_DISCUSSION (set in index.html).
const discussion = window.LAKE_PLATFORM_DISCUSSION || "";
document.querySelectorAll("[data-platform-waitlist-cta]").forEach((el) => {
  if (discussion && !discussion.includes("DISCUSSION_ID")) el.href = discussion;
  el.addEventListener("click", () => {
    gcEvent("platform-waitlist-click", "Join the design-partner list");
  });
});

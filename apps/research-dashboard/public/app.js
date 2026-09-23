// App shell: hash router, top bar, bottom navigation, and a tiny API client.
// Views only call this app's own /api routes; all pick data stays in the browser.

import { hideTooltip } from "./chart.js";
import { el, icon } from "./dom.js";
import { renderDashboard } from "./dashboard.js";
import { renderGames } from "./games.js";
import { renderPicks, renderPickForm } from "./picks.js";
import { renderSettings } from "./settings.js";
import { onExternalChange } from "./store.js";
import { request } from "./transport.js";

let meta = null;
let renderToken = 0;

export function api(path) {
  return request(path);
}

export async function getMeta() {
  if (!meta) meta = await api("/api/meta");
  return meta;
}

export function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

let toastTimer;
export function toast(message) {
  const node = document.getElementById("toast");
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (node.hidden = true), 2600);
}

/** Top bar title + optional back link. */
export function setChrome({ title, back = null }) {
  document.getElementById("page-title").textContent = title;
  document.title = `${title} · Odds Research Dashboard`;
  const backBtn = document.getElementById("back-btn");
  backBtn.hidden = !back;
  if (back) backBtn.setAttribute("href", back);
}

/** True while `token` is still the latest render (guards async views). */
export const isCurrent = (token) => token === renderToken;

const ROUTES = [
  [/^#\/dashboard$/, "dashboard", (view, token) => renderDashboard(view, token)],
  [/^#\/games$/, "games", (view, token) => renderGames(view, token, {})],
  [/^#\/games\/([\w-]+)$/, "games", (view, token, m) => renderGames(view, token, { eventId: m[1] })],
  [/^#\/picks$/, "picks", (view, token) => renderPicks(view, token)],
  [/^#\/picks\/new$/, "picks", (view, token) => renderPickForm(view, token, {})],
  [/^#\/picks\/edit\/([\w-]+)$/, "picks", (view, token, m) => renderPickForm(view, token, { id: m[1] })],
  [/^#\/settings$/, "settings", (view, token) => renderSettings(view, token)]
];

function route() {
  hideTooltip();
  const hash = location.hash || "#/dashboard";
  const match = ROUTES.map(([re, nav, fn]) => [hash.match(re), nav, fn]).find(([m]) => m);
  if (!match) {
    location.replace("#/dashboard");
    return;
  }
  const [m, nav, render] = match;
  for (const link of document.querySelectorAll("[data-nav]")) {
    if (link.dataset.nav === nav) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  const view = document.getElementById("view");
  view.dataset.view = nav;
  renderToken += 1;
  const token = renderToken;
  Promise.resolve()
    .then(() => render(view, token, m))
    .catch((error) => {
      if (!isCurrent(token)) return;
      view.replaceChildren(
        el("section", { class: "card empty-state" }, [el("h2", {}, "Something went wrong"), el("p", {}, error.message)])
      );
    });
}

async function init() {
  for (const slot of document.querySelectorAll("[data-icon]")) slot.replaceChildren(icon(slot.dataset.icon));
  document.getElementById("back-btn").replaceChildren(icon("back"));
  window.addEventListener("hashchange", () => {
    route();
    window.scrollTo(0, 0);
  });
  // Re-render when picks/settings change in another tab.
  onExternalChange(() => {
    if (!document.activeElement || !document.activeElement.closest("form")) route();
  });
  route();
  try {
    const { provider } = await getMeta();
    const pill = document.getElementById("data-pill");
    pill.textContent = provider.live ? "Live data" : "Mock data";
    pill.classList.toggle("live", provider.live);
  } catch {
    // Each view shows its own error.
  }
}

init();

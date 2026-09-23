// Tiny DOM helpers. Text is always set with textContent (never innerHTML) so
// names coming from a live data provider can't inject markup.

export const SPORT_LABELS = { nfl: "NFL", nba: "NBA", mlb: "MLB", soccer: "Soccer", ufc: "UFC" };

/**
 * el("button", { class: "x", onclick: fn, style: { color: "red" } }, ["text", childNode])
 * Boolean attributes: pass true to set, false/null/undefined to omit.
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2), value);
    } else if (key === "style" && typeof value === "object") {
      for (const [prop, v] of Object.entries(value)) node.style.setProperty(prop, v);
    } else if (key === "selected" || key === "hidden" || key === "disabled") {
      node[key] = Boolean(value);
    } else {
      node.setAttribute(key, value === true ? "" : String(value));
    }
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

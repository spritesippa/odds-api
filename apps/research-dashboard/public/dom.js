// Tiny DOM helpers. Text is always set with textContent (never innerHTML) so
// names coming from a data provider can't inject markup.

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
    } else if (["selected", "hidden", "disabled", "checked", "required"].includes(key)) {
      node[key] = Boolean(value);
    } else if (key === "value") {
      node.value = value;
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

const SVG_NS = "http://www.w3.org/2000/svg";
const ICONS = {
  dashboard: ["M3 3h7v9H3z", "M14 3h7v5h-7z", "M14 12h7v9h-7z", "M3 16h7v5H3z"],
  games: ["M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", "M3 12h18", "M12 4v16"],
  picks: ["M9 3h6v4H9z", "M7 5H5v16h14V5h-2", "M8 12l2 2 4-4", "M8 17h8"],
  settings: ["M4 7h9", "M17 7h3", "M4 17h3", "M11 17h9", "M15 5v4", "M9 15v4", "M4 12h16"],
  back: ["M15 18l-6-6 6-6"],
  chevron: ["M9 6l6 6-6 6"],
  plus: ["M12 5v14", "M5 12h14"],
  trash: ["M4 7h16", "M9 7V4h6v3", "M6 7l1 13h10l1-13"],
  edit: ["M4 20h4L19 9l-4-4L4 16z"]
};

/** Stroke icon from the fixed set above. Decorative unless a label is given. */
export function icon(name, label) {
  const node = document.createElementNS(SVG_NS, "svg");
  node.setAttribute("viewBox", "0 0 24 24");
  node.setAttribute("class", `icon icon-${name}`);
  if (label) {
    node.setAttribute("role", "img");
    node.setAttribute("aria-label", label);
  } else {
    node.setAttribute("aria-hidden", "true");
  }
  for (const d of ICONS[name] || []) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    node.appendChild(path);
  }
  return node;
}

/** A row of toggle buttons; calls onChange(value). */
export function segmented(options, current, onChange, { label, className = "" } = {}) {
  return el(
    "div",
    { class: `segmented ${className}`, role: "group", "aria-label": label },
    options.map(([value, text]) =>
      el(
        "button",
        {
          type: "button",
          "aria-pressed": String(value === current),
          "data-value": value,
          onclick: () => onChange(value)
        },
        text
      )
    )
  );
}

export function card(children, className = "") {
  return el("section", { class: `card ${className}` }, children);
}

export function sectionHead(title, aside) {
  return el("div", { class: "section-head" }, [el("h2", {}, title), aside || null]);
}

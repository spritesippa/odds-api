// Minimal SVG line chart with a crosshair tooltip. No dependencies.
// Labels come from provider data, so all text goes through textContent.

const SVG_NS = "http://www.w3.org/2000/svg";

function svg(tag, attrs = {}, parent) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (parent) parent.appendChild(node);
  return node;
}

function niceTicks(min, max, count = 4) {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || raw;
  const start = Math.floor(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

/** Value of a series at x: exact for points, last-known for step lines. */
function valueAt(series, x) {
  let found = null;
  for (const point of series.points) {
    if (point.x <= x) found = point;
    else break;
  }
  return found;
}

const tooltip = () => document.getElementById("tooltip");

function showTooltip(title, rows, clientX, clientY) {
  const tip = tooltip();
  tip.replaceChildren();
  const head = document.createElement("div");
  head.className = "tt-title";
  head.textContent = title;
  tip.appendChild(head);
  for (const row of rows) {
    const line = document.createElement("div");
    line.className = "tt-row";
    const key = document.createElement("span");
    key.className = "tt-key";
    key.style.background = row.color;
    const value = document.createElement("strong");
    value.textContent = row.value;
    const name = document.createElement("span");
    name.className = "tt-name";
    name.textContent = row.name;
    line.append(key, value, name);
    tip.appendChild(line);
  }
  tip.hidden = false;
  const { innerWidth } = window;
  const rect = tip.getBoundingClientRect();
  const left = clientX + 16 + rect.width > innerWidth ? clientX - rect.width - 16 : clientX + 16;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${Math.max(8, clientY - rect.height / 2)}px`;
}

export function hideTooltip() {
  const tip = tooltip();
  if (tip) tip.hidden = true;
}

/**
 * @param {HTMLElement} container
 * @param {{
 *   series: { id: string, name: string, color: string, points: { x: number, y: number, note?: string }[] }[],
 *   yFormat: (v: number) => string,
 *   xFormat: (x: number) => string,
 *   tooltipFormat?: (point: any, series: any) => string,
 *   step?: boolean,
 *   zeroLine?: boolean,
 *   height?: number,
 *   ariaLabel: string,
 *   directLabels?: boolean,
 *   yPadding?: number
 * }} options
 */
export function lineChart(container, options) {
  const draw = () => render(container, options);
  draw();
  if (container._resizeObserver) container._resizeObserver.disconnect();
  let lastWidth = container.clientWidth;
  container._resizeObserver = new ResizeObserver(() => {
    if (Math.abs(container.clientWidth - lastWidth) > 4) {
      lastWidth = container.clientWidth;
      draw();
    }
  });
  container._resizeObserver.observe(container);
}

function render(container, options) {
  const series = options.series.filter((s) => s.points.length > 0);
  container.replaceChildren();
  if (series.length === 0) {
    const empty = document.createElement("div");
    empty.className = "chart-empty";
    empty.textContent = options.emptyText || "No data yet.";
    container.appendChild(empty);
    return;
  }

  const width = Math.max(280, container.clientWidth || 640);
  const height = options.height || 240;
  const labelSpace = options.directLabels ? 96 : 12;
  const margin = { top: 12, right: labelSpace, bottom: 26, left: 52 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const xs = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b);
  const ys = series.flatMap((s) => s.points.map((p) => p.y));
  let yMin = Math.min(...ys, options.zeroLine ? 0 : Infinity);
  let yMax = Math.max(...ys, options.zeroLine ? 0 : -Infinity);
  const pad = options.yPadding ?? (yMax - yMin) * 0.08;
  yMin -= pad;
  yMax += pad;
  const ticks = niceTicks(yMin, yMax);
  yMin = Math.min(yMin, ticks[0]);
  yMax = Math.max(yMax, ticks[ticks.length - 1]);

  const xMin = xs[0];
  const xMax = xs[xs.length - 1] === xMin ? xMin + 1 : xs[xs.length - 1];
  const sx = (x) => margin.left + ((x - xMin) / (xMax - xMin)) * innerW;
  const sy = (y) => margin.top + (1 - (y - yMin) / (yMax - yMin)) * innerH;

  const root = svg("svg", {
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": options.ariaLabel,
    tabindex: 0
  });

  for (const tick of ticks) {
    if (tick < yMin || tick > yMax) continue;
    svg("line", { class: "gridline", x1: margin.left, x2: width - margin.right, y1: sy(tick), y2: sy(tick) }, root);
    const label = svg("text", { class: "tick", x: margin.left - 8, y: sy(tick) + 4, "text-anchor": "end" }, root);
    label.textContent = options.yFormat(tick);
  }
  if (options.zeroLine && yMin < 0 && yMax > 0) {
    svg("line", { class: "zero", x1: margin.left, x2: width - margin.right, y1: sy(0), y2: sy(0) }, root);
  }
  svg("line", { class: "baseline", x1: margin.left, x2: width - margin.right, y1: margin.top + innerH, y2: margin.top + innerH }, root);

  const xTickCount = Math.min(xs.length, Math.max(2, Math.floor(innerW / 110)));
  for (let i = 0; i < xTickCount; i += 1) {
    const x = xMin + ((xMax - xMin) * i) / Math.max(1, xTickCount - 1);
    const anchor = i === 0 ? "start" : i === xTickCount - 1 ? "end" : "middle";
    const label = svg("text", { class: "tick", x: sx(x), y: height - 6, "text-anchor": anchor }, root);
    label.textContent = options.xFormat(x);
  }

  for (const s of series) {
    let d = "";
    s.points.forEach((p, i) => {
      if (i === 0) d += `M${sx(p.x)},${sy(p.y)}`;
      else if (options.step) d += `H${sx(p.x)}V${sy(p.y)}`;
      else d += `L${sx(p.x)},${sy(p.y)}`;
    });
    // Colors go through CSSOM (not attributes) so CSS variables resolve and CSP allows them.
    svg("path", { class: "series", d }, root).style.stroke = s.color;
  }

  // End markers + selective direct labels (only when few series).
  const ends = series.map((s) => {
    const last = s.points[s.points.length - 1];
    return { s, x: sx(last.x), y: sy(last.y), last };
  });
  for (const end of ends) {
    svg("circle", { class: "end-dot", cx: end.x, cy: end.y, r: 4 }, root).style.fill = end.s.color;
  }
  if (options.directLabels) {
    const placed = [...ends].sort((a, b) => a.y - b.y);
    let prev = -Infinity;
    for (const end of placed) {
      const y = Math.max(end.y + 4, prev + 13);
      prev = y;
      const text = svg("text", { class: "end-label", x: end.x + 8, y }, root);
      text.textContent = end.s.name;
    }
  }

  const cross = svg("line", { class: "crosshair", y1: margin.top, y2: margin.top + innerH, visibility: "hidden" }, root);
  const hit = svg("rect", { x: margin.left, y: margin.top, width: innerW, height: innerH, fill: "transparent" }, root);

  let activeIndex = xs.length - 1;
  const showAt = (index, clientX, clientY) => {
    activeIndex = Math.max(0, Math.min(xs.length - 1, index));
    const x = xs[activeIndex];
    cross.setAttribute("x1", sx(x));
    cross.setAttribute("x2", sx(x));
    cross.setAttribute("visibility", "visible");
    const rows = series
      .map((s) => {
        const point = options.step ? valueAt(s, x) : s.points.find((p) => p.x === x);
        if (!point) return null;
        return {
          color: s.color,
          name: s.name,
          value: options.tooltipFormat ? options.tooltipFormat(point, s) : options.yFormat(point.y)
        };
      })
      .filter(Boolean);
    showTooltip(options.xFormat(x, true), rows, clientX, clientY);
  };
  const nearestIndex = (clientX) => {
    const box = root.getBoundingClientRect();
    const scale = width / box.width;
    const x = xMin + (((clientX - box.left) * scale - margin.left) / innerW) * (xMax - xMin);
    let best = 0;
    xs.forEach((value, i) => {
      if (Math.abs(value - x) < Math.abs(xs[best] - x)) best = i;
    });
    return best;
  };
  const hide = () => {
    cross.setAttribute("visibility", "hidden");
    hideTooltip();
  };

  hit.addEventListener("pointermove", (e) => showAt(nearestIndex(e.clientX), e.clientX, e.clientY));
  hit.addEventListener("pointerleave", hide);
  root.addEventListener("focus", () => {
    const box = root.getBoundingClientRect();
    showAt(activeIndex, box.left + (sx(xs[activeIndex]) / width) * box.width, box.top + box.height / 2);
  });
  root.addEventListener("blur", hide);
  root.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = activeIndex + (e.key === "ArrowRight" ? 1 : -1);
    const box = root.getBoundingClientRect();
    const clamped = Math.max(0, Math.min(xs.length - 1, next));
    showAt(clamped, box.left + (sx(xs[clamped]) / width) * box.width, box.top + box.height / 2);
  });

  container.appendChild(root);
}

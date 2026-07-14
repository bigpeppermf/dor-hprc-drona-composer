/**
 * <drona-chart> — a time-series chart driven entirely by declarative markup.
 *
 * Retriever scripts emit only DATA:
 *
 *   <drona-chart chart-title="Resource utilization"
 *                series='[{"label":"CPU","color":"#3b82f6","points":[1.2,…]},…]'
 *                x-span="240"></drona-chart>
 *
 * Why this works from a shell retriever: staticText renders retriever output
 * through dangerouslySetInnerHTML. Setting innerHTML never executes a <script>,
 * but the browser DOES upgrade custom elements that are already registered — so
 * the shell keeps emitting inert markup while vetted code does the drawing.
 *
 * Security: series data is read from an attribute and parsed as JSON, then every
 * node is built with createElement/createElementNS. Retriever output is never
 * interpreted as HTML or JS.
 *
 * Registered via a side-effect import in src/index.js, so it ships in
 * main.bundle.js and exists on every page before any retriever HTML lands.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

// Ink + surface tokens mirror the shared dm-* design system (light-only, as the
// app is pinned to data-theme="light").
const INK = "#0f172a";
const MUTED = "#64748b";
const FAINT = "#94a3b8";
const GRID = "#e2e8f0";
const SURFACE = "#ffffff";

const VIEW_W = 600;
const VIEW_H = 180;
const PAD_L = 36;
const PAD_R = 52;
const PAD_T = 14;
const PAD_B = 24;
const PLOT_W = VIEW_W - PAD_L - PAD_R;
const PLOT_H = VIEW_H - PAD_T - PAD_B;
const LABEL_MIN_GAP = 11;

function svgEl(name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  for (const key in attrs) node.setAttribute(key, attrs[key]);
  return node;
}

function formatSpan(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return "";
  if (s < 90) return `-${Math.round(s)}s`;
  if (s < 5400) return `-${Math.round(s / 60)}m`;
  return `-${(s / 3600).toFixed(1)}h`;
}

class DronaChart extends HTMLElement {
  static get observedAttributes() {
    return ["series", "chart-title", "x-span"];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    if (this.isConnected) this.render();
  }

  /** Parsed, validated series. Anything malformed yields [] rather than throwing. */
  get seriesData() {
    let parsed;
    try {
      parsed = JSON.parse(this.getAttribute("series") || "[]");
    } catch (err) {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s) =>
        s &&
        Array.isArray(s.points) &&
        s.points.length > 1 &&
        s.points.every((p) => Number.isFinite(Number(p)))
    );
  }

  render() {
    const series = this.seriesData;
    this.textContent = "";

    if (!series.length) {
      const empty = document.createElement("div");
      empty.className = "dm-empty";
      empty.textContent = "Collecting samples… the chart appears once there are at least two.";
      this.appendChild(empty);
      return;
    }

    const pointCount = Math.max(...series.map((s) => s.points.length));
    const x = (i) => PAD_L + (i / (pointCount - 1)) * PLOT_W;
    // Both series are percentages, so they share one 0-100 axis. Never dual-axis.
    const y = (v) => PAD_T + (1 - Math.min(Math.max(Number(v), 0), 100) / 100) * PLOT_H;

    const wrap = document.createElement("div");
    wrap.className = "dm-chart";
    wrap.appendChild(this._buildHead(series));

    const svg = svgEl("svg", {
      viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
      class: "dm-chart-svg",
      role: "img",
      "aria-label": `${series.map((s) => s.label).join(" and ")} utilization over time`,
    });

    this._drawGrid(svg);
    this._drawSeries(svg, series, x, y);
    const hover = this._drawHoverLayer(svg, series, x, y);
    this._drawEndLabels(svg, series, x, y);

    wrap.appendChild(svg);
    wrap.appendChild(this._buildAxisLabels());

    const tip = document.createElement("div");
    tip.className = "dm-chart-tip";
    tip.hidden = true;
    wrap.appendChild(tip);

    this._bindPointer(svg, tip, series, x, y, hover, pointCount);
    this.appendChild(wrap);
  }

  _buildHead(series) {
    const head = document.createElement("div");
    head.className = "dm-chart-head";

    const title = document.createElement("span");
    title.className = "dm-chart-title";
    title.textContent = this.getAttribute("chart-title") || "Utilization";
    head.appendChild(title);

    // A legend is always present for >=2 series; a single series is named by the title.
    if (series.length >= 2) {
      const legend = document.createElement("span");
      legend.className = "dm-chart-legend";
      series.forEach((s) => {
        const key = document.createElement("span");
        key.className = "dm-key";
        const swatch = document.createElement("i");
        swatch.style.background = s.color;
        key.appendChild(swatch);
        key.appendChild(document.createTextNode(s.label));
        legend.appendChild(key);
      });
      head.appendChild(legend);
    }
    return head;
  }

  _buildAxisLabels() {
    const foot = document.createElement("div");
    foot.className = "dm-chart-foot";
    const start = document.createElement("span");
    start.textContent = formatSpan(this.getAttribute("x-span"));
    const now = document.createElement("span");
    now.textContent = "now";
    foot.appendChild(start);
    foot.appendChild(now);
    return foot;
  }

  _drawGrid(svg) {
    for (let g = 0; g <= 100; g += 25) {
      const gy = PAD_T + (1 - g / 100) * PLOT_H;
      svg.appendChild(
        svgEl("line", { x1: PAD_L, y1: gy, x2: PAD_L + PLOT_W, y2: gy, stroke: GRID, "stroke-width": 1 })
      );
      const label = svgEl("text", {
        x: PAD_L - 6, y: gy + 3, "text-anchor": "end",
        "font-size": 9, fill: FAINT, "font-family": "monospace",
      });
      label.textContent = `${g}%`;
      svg.appendChild(label);
    }
  }

  _drawSeries(svg, series, x, y) {
    const pointsOf = (s) => s.points.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

    // Area washes first, then lines on top, so lines never sit under a fill.
    series.forEach((s) => {
      const last = s.points.length - 1;
      svg.appendChild(
        svgEl("polygon", {
          points: `${x(0).toFixed(1)},${y(0).toFixed(1)} ${pointsOf(s)} ${x(last).toFixed(1)},${y(0).toFixed(1)}`,
          fill: s.color,
          "fill-opacity": 0.1,
        })
      );
    });
    series.forEach((s) => {
      svg.appendChild(
        svgEl("polyline", {
          points: pointsOf(s), fill: "none", stroke: s.color, "stroke-width": 2,
          "stroke-linejoin": "round", "stroke-linecap": "round",
        })
      );
    });
  }

  _drawHoverLayer(svg, series, x, y) {
    const crosshair = svgEl("line", {
      y1: PAD_T, y2: PAD_T + PLOT_H, stroke: FAINT, "stroke-width": 1, opacity: 0,
    });
    svg.appendChild(crosshair);
    const dots = series.map((s) => {
      const dot = svgEl("circle", {
        r: 4, fill: s.color, stroke: SURFACE, "stroke-width": 2, opacity: 0,
      });
      svg.appendChild(dot);
      return dot;
    });
    return { crosshair, dots };
  }

  _drawEndLabels(svg, series, x, y) {
    // Both series hues fall under 3:1 on white, so direct labels are required —
    // identity must never rest on color alone. Text wears ink tokens, not the
    // series color; the colored end-dot beside it carries identity.
    const placed = [];
    series.forEach((s, idx) => {
      const last = s.points.length - 1;
      svg.appendChild(
        svgEl("circle", {
          cx: x(last), cy: y(s.points[last]), r: 4,
          fill: s.color, stroke: SURFACE, "stroke-width": 2,
        })
      );

      let labelY = y(s.points[last]);
      // Nudge apart only on genuine collision, so labels stay attached to their line.
      placed.forEach((usedY) => {
        if (Math.abs(labelY - usedY) < LABEL_MIN_GAP) labelY = usedY + LABEL_MIN_GAP;
      });
      placed.push(labelY);

      const text = svgEl("text", {
        x: x(last) + 8, y: labelY + 3, "font-size": 10, "font-weight": 700,
        fill: idx === 0 ? INK : MUTED, "font-family": "monospace",
      });
      text.textContent = `${Number(s.points[last]).toFixed(1)}%`;
      svg.appendChild(text);
    });
  }

  _bindPointer(svg, tip, series, x, y, hover, pointCount) {
    const hide = () => {
      tip.hidden = true;
      hover.crosshair.setAttribute("opacity", 0);
      hover.dots.forEach((d) => d.setAttribute("opacity", 0));
    };

    svg.addEventListener("pointerleave", hide);
    svg.addEventListener("pointermove", (ev) => {
      const rect = svg.getBoundingClientRect();
      if (!rect.width) return;
      const localX = (ev.clientX - rect.left) * (VIEW_W / rect.width);
      const i = Math.max(0, Math.min(pointCount - 1, Math.round(((localX - PAD_L) / PLOT_W) * (pointCount - 1))));

      hover.crosshair.setAttribute("x1", x(i));
      hover.crosshair.setAttribute("x2", x(i));
      hover.crosshair.setAttribute("opacity", 1);

      tip.textContent = "";
      series.forEach((s, k) => {
        const v = Number(s.points[Math.min(i, s.points.length - 1)]);
        hover.dots[k].setAttribute("cx", x(i));
        hover.dots[k].setAttribute("cy", y(v));
        hover.dots[k].setAttribute("opacity", 1);

        const row = document.createElement("div");
        row.className = "dm-tip-row";
        const swatch = document.createElement("i");
        swatch.style.background = s.color;
        row.appendChild(swatch);
        row.appendChild(document.createTextNode(`${s.label} ${v.toFixed(1)}%`));
        tip.appendChild(row);
      });

      tip.hidden = false;
      const px = (x(i) / VIEW_W) * rect.width;
      tip.style.left = `${Math.min(Math.max(px, 8), rect.width - 8)}px`;
    });
  }
}

if (!customElements.get("drona-chart")) {
  customElements.define("drona-chart", DronaChart);
}

export default DronaChart;

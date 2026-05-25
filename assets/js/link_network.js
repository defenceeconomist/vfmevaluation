const DEFAULT_WIDTH = 1100;
const DEFAULT_HEIGHT = 760;

const palette = {
  internal: {
    fill: "#0f766e",
    stroke: "#115e59",
    edge: "rgba(15, 118, 110, 0.25)",
  },
  external: {
    fill: "#d97706",
    stroke: "#92400e",
    edge: "rgba(217, 119, 6, 0.25)",
  },
  muted: "#cbd5e1",
  text: "#172033",
};

const shell = document.getElementById("link-graph-shell");
const svgHost = document.getElementById("link-graph-svg");
const internalToggle = document.getElementById("toggle-internal");
const externalToggle = document.getElementById("toggle-external");
const resetButton = document.getElementById("reset-link-graph");
const searchInput = document.getElementById("link-graph-search");
const nodeOptions = document.getElementById("link-graph-node-options");

if (shell && svgHost && internalToggle && externalToggle && resetButton && searchInput && nodeOptions) {
  initialise().catch((error) => {
    svgHost.innerHTML = `<p><code>${String(error.message || error)}</code></p>`;
  });
}

async function initialise() {
  const graphSource = shell.dataset.graphSrc;
  if (!graphSource) {
    throw new Error("Link graph source is missing.");
  }

  const response = await fetch(graphSource, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Link graph request failed (${response.status}).`);
  }

  const graph = await response.json();
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error("Link graph payload is missing.");
  }

  let viewportWidth = DEFAULT_WIDTH;
  let viewportHeight = DEFAULT_HEIGHT;

  const svg = d3
    .select(svgHost)
    .append("svg")
    .attr("viewBox", `0 0 ${viewportWidth} ${viewportHeight}`)
    .attr("class", "link-graph-svg-inner")
    .attr("role", "img")
    .attr("aria-label", "Interactive value for money evaluation notes link network");

  const nodes = graph.nodes.map((node) => ({ ...node }));
  const links = graph.edges.map((edge) => ({ ...edge }));

  const zoomLayer = svg.append("g").attr("class", "zoom-layer");
  const linkLayer = zoomLayer.append("g").attr("class", "link-layer");
  const nodeLayer = zoomLayer.append("g").attr("class", "node-layer");
  const popup = createPopup(shell);

  const simulation = d3
    .forceSimulation(nodes)
    .force(
      "link",
      d3
        .forceLink(links)
        .id((d) => d.id)
        .distance((d) => (d.kind === "external" ? 120 : 80))
        .strength((d) => (d.kind === "external" ? 0.18 : 0.32))
    )
    .force("charge", d3.forceManyBody().strength((d) => -120 - d.degree * 12))
    .force("center", d3.forceCenter(viewportWidth / 2, viewportHeight / 2))
    .force("collision", d3.forceCollide().radius((d) => nodeRadius(d) + 4));

  const link = linkLayer
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("class", "graph-link")
    .attr("stroke", (d) => palette[d.kind].edge)
    .attr("stroke-width", (d) => (d.kind === "external" ? 1.4 : 1.8));

  const node = nodeLayer
    .selectAll("g")
    .data(nodes)
    .join("g")
    .attr("class", "graph-node")
    .style("cursor", "grab")
    .call(drag(simulation));

  node
    .append("circle")
    .attr("r", (d) => nodeRadius(d))
    .attr("fill", (d) => palette[d.kind].fill)
    .attr("stroke", (d) => palette[d.kind].stroke)
    .attr("stroke-width", 1.5);

  node
    .append("text")
    .attr("class", "graph-label")
    .attr("x", (d) => nodeRadius(d) + 6)
    .attr("y", 4)
    .text((d) => d.label);

  node.append("title").text((d) => nodeTitle(d));

  const zoom = d3
    .zoom()
    .scaleExtent([0.35, 3.5])
    .on("zoom", (event) => zoomLayer.attr("transform", event.transform));

  svg.call(zoom);

  populateNodeOptions(nodes);

  for (let i = 0; i < 220; i += 1) {
    simulation.tick();
  }
  renderPositions();

  simulation.on("tick", () => {
    renderPositions();
  });

  function renderPositions() {
    link
      .attr("x1", (d) => d.source.x)
      .attr("y1", (d) => d.source.y)
      .attr("x2", (d) => d.target.x)
      .attr("y2", (d) => d.target.y);

    node.attr("transform", (d) => `translate(${d.x},${d.y})`);
  }

  let selectedId = null;

  node
    .on("mouseenter", (_, datum) => highlight(datum.id))
    .on("mouseleave", () => {
      if (selectedId) {
        highlight(selectedId);
      } else {
        clearHighlight();
      }
    })
    .on("click", (event, datum) => {
      event.stopPropagation();
      selectedId = datum.id;
      highlight(datum.id);
      showPopup(datum, event);
    });

  svg.on("click", () => {
    selectedId = null;
    clearHighlight();
    hidePopup();
  });

  internalToggle.addEventListener("change", applyVisibility);
  externalToggle.addEventListener("change", applyVisibility);
  resetButton.addEventListener("click", () => {
    hidePopup();
    resetView(true);
  });
  searchInput.addEventListener("input", onSearchInput);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hidePopup();
    }
  });

  const resizeObserver = new ResizeObserver(() => {
    updateViewport();
  });

  resizeObserver.observe(svgHost);

  applyVisibility();
  clearHighlight();
  updateViewport(true);

  function applyVisibility() {
    const visibleKinds = new Set();
    if (internalToggle.checked) visibleKinds.add("internal");
    if (externalToggle.checked) visibleKinds.add("external");

    node.attr("display", (d) => (visibleKinds.has(d.kind) ? null : "none"));
    link.attr("display", (d) => {
      const sourceVisible = visibleKinds.has(nodeKind(d.source));
      const targetVisible = visibleKinds.has(nodeKind(d.target));
      return sourceVisible && targetVisible ? null : "none";
    });

    if (selectedId) {
      const activeNode = nodes.find((item) => item.id === selectedId);
      if (activeNode && !visibleKinds.has(activeNode.kind)) {
        selectedId = null;
        hidePopup();
        clearHighlight();
      } else {
        highlight(selectedId);
      }
    }
  }

  function highlight(nodeId) {
    const adjacency = adjacentNodes(nodeId, links);

    node.attr("data-faded", (d) => (!adjacency.has(d.id) ? "true" : "false"));
    node.attr("data-selected", (d) => (d.id === nodeId ? "true" : "false"));
    link.attr("data-faded", (d) => {
      const sourceId = edgeEndpointId(d.source);
      const targetId = edgeEndpointId(d.target);
      return sourceId === nodeId || targetId === nodeId ? "false" : "true";
    });
    link.attr("data-selected", (d) => {
      const sourceId = edgeEndpointId(d.source);
      const targetId = edgeEndpointId(d.target);
      return sourceId === nodeId || targetId === nodeId ? "true" : "false";
    });
  }

  function clearHighlight() {
    node.attr("data-faded", "false");
    node.attr("data-selected", "false");
    link.attr("data-faded", "false");
    link.attr("data-selected", "false");
  }

  function updateSearchMatches(query) {
    const normalized = query.trim().toLowerCase();
    node.attr("data-search-match", (d) => {
      if (!normalized) return "false";
      const haystack = `${d.label} ${d.id}`.toLowerCase();
      return haystack.includes(normalized) ? "true" : "false";
    });
  }

  function focusNode(nodeId, zoomToNode = false) {
    const found = nodes.find((item) => item.id === nodeId);
    if (!found) return;
    selectedId = found.id;
    highlight(found.id);
    hidePopup();
    if (zoomToNode) {
      svg
        .transition()
        .duration(350)
        .call(
          zoom.transform,
          d3.zoomIdentity
            .translate(viewportWidth / 2, viewportHeight / 2)
            .scale(1.35)
            .translate(-found.x, -found.y)
        );
    }
  }

  function onSearchInput(event) {
    const query = event.target.value;
    updateSearchMatches(query);
    const match = nodes.find((item) => {
      const haystack = `${item.label} ${item.id}`.toLowerCase();
      return query.trim() && haystack.includes(query.trim().toLowerCase());
    });
    if (match) {
      focusNode(match.id, true);
    }
  }

  function updateViewport(initial = false) {
    const bounds = svgHost.getBoundingClientRect();
    viewportWidth = Math.max(360, Math.round(bounds.width || DEFAULT_WIDTH));
    viewportHeight = Math.max(360, Math.round(bounds.height || DEFAULT_HEIGHT));
    svg.attr("viewBox", `0 0 ${viewportWidth} ${viewportHeight}`);
    simulation.force("center", d3.forceCenter(viewportWidth / 2, viewportHeight / 2));
    resetView(initial);
  }

  function resetView(immediate = false) {
    const visibleNodes = nodes.filter((item) => {
      if (item.kind === "internal") return internalToggle.checked;
      if (item.kind === "external") return externalToggle.checked;
      return true;
    });
    const targetNodes = visibleNodes.length ? visibleNodes : nodes;
    const extent = nodeExtent(targetNodes);
    const padding = 50;
    const width = Math.max(1, extent.x1 - extent.x0 + padding * 2);
    const height = Math.max(1, extent.y1 - extent.y0 + padding * 2);
    const scale = Math.max(0.35, Math.min(1.6, 0.95 / Math.max(width / viewportWidth, height / viewportHeight)));
    const translateX = viewportWidth / 2 - scale * ((extent.x0 + extent.x1) / 2);
    const translateY = viewportHeight / 2 - scale * ((extent.y0 + extent.y1) / 2);
    const transform = d3.zoomIdentity.translate(translateX, translateY).scale(scale);
    const selection = immediate ? svg : svg.transition().duration(450);
    selection.call(zoom.transform, transform);
  }

  function populateNodeOptions(items) {
    nodeOptions.innerHTML = "";
    items
      .slice()
      .sort((a, b) => a.label.localeCompare(b.label))
      .forEach((item) => {
        const option = document.createElement("option");
        option.value = item.label;
        nodeOptions.appendChild(option);
      });
  }

  function showPopup(datum, event) {
    const action = nodeAction(datum);
    const title = datum.title || datum.label || datum.id;
    const subtitle = datum.kind === "internal" ? datum.path : datum.url || datum.citation_key || datum.id;
    const connectedCount = adjacentNodes(datum.id, links).size - 1;
    const actionLabel = datum.kind === "external" ? "Open source" : "Open page";

    popup.innerHTML = `
      <button class="link-graph-popup-close" type="button" aria-label="Close node details">x</button>
      <div class="link-graph-popup-kind"><span class="kind-pill ${escapeAttribute(datum.kind)}">${escapeHtml(datum.kind)}</span></div>
      <h3>${escapeHtml(title)}</h3>
      ${subtitle ? `<p class="link-graph-popup-subtitle">${escapeHtml(subtitle)}</p>` : ""}
      <dl class="link-graph-popup-meta">
        <div><dt>Incoming</dt><dd>${Number(datum.incoming || 0)}</dd></div>
        <div><dt>Outgoing</dt><dd>${Number(datum.outgoing || 0)}</dd></div>
        <div><dt>Connected</dt><dd>${Number(connectedCount)}</dd></div>
      </dl>
      ${
        action.href
          ? `<a class="link-graph-popup-action" href="${escapeAttribute(action.href)}"${action.external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${actionLabel}</a>`
          : ""
      }
    `;

    popup.querySelector(".link-graph-popup-close").addEventListener("click", (closeEvent) => {
      closeEvent.stopPropagation();
      hidePopup();
    });

    positionPopup(event);
    popup.hidden = false;
  }

  function hidePopup() {
    popup.hidden = true;
  }

  function positionPopup(event) {
    const bounds = shell.getBoundingClientRect();
    const popupWidth = Math.min(320, Math.max(260, bounds.width - 24));
    const left = clamp(event.clientX - bounds.left + 14, 12, bounds.width - popupWidth - 12);
    const top = clamp(event.clientY - bounds.top + 14, 12, bounds.height - 220);
    popup.style.inlineSize = `${popupWidth}px`;
    popup.style.left = `${left}px`;
    popup.style.top = `${Math.max(12, top)}px`;
  }
}

function nodeRadius(node) {
  return Math.max(6, Math.min(18, 6 + Math.sqrt(node.degree || 1) * 2.4));
}

function nodeTitle(node) {
  const parts = [node.label, node.kind === "internal" ? node.path : node.url || node.citation_key || node.id];
  parts.push(`Incoming: ${node.incoming || 0}`);
  parts.push(`Outgoing: ${node.outgoing || 0}`);
  return parts.filter(Boolean).join("\n");
}

function createPopup(host) {
  let popup = host.querySelector(".link-graph-popup");
  if (!popup) {
    popup = document.createElement("aside");
    popup.className = "link-graph-popup";
    popup.hidden = true;
    popup.setAttribute("aria-live", "polite");
    host.appendChild(popup);
  }
  return popup;
}

function nodeAction(node) {
  if (node.kind === "external") {
    return { href: node.url, external: true };
  }

  if (node.kind === "internal" && node.path) {
    const htmlPath = node.path.replace(/\.qmd$/i, ".html");
    return { href: new URL(`../${htmlPath}`, window.location.href).href, external: false };
  }

  return { href: "", external: false };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function clamp(value, min, max) {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}

function adjacentNodes(nodeId, links) {
  const adjacency = new Set([nodeId]);
  links.forEach((link) => {
    const source = edgeEndpointId(link.source);
    const target = edgeEndpointId(link.target);
    if (source === nodeId) adjacency.add(target);
    if (target === nodeId) adjacency.add(source);
  });
  return adjacency;
}

function edgeEndpointId(value) {
  return typeof value === "string" ? value : value.id;
}

function nodeKind(value) {
  return typeof value === "string" ? undefined : value.kind;
}

function nodeExtent(nodes) {
  return nodes.reduce(
    (extent, node) => ({
      x0: Math.min(extent.x0, node.x || 0),
      x1: Math.max(extent.x1, node.x || 0),
      y0: Math.min(extent.y0, node.y || 0),
      y1: Math.max(extent.y1, node.y || 0),
    }),
    { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity }
  );
}

function drag(simulation) {
  function dragstarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
  }

  function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
  }

  function dragended(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
  }

  return d3.drag().on("start", dragstarted).on("drag", dragged).on("end", dragended);
}

(function () {
  const figureIds = [
    "fig-opm-vfm-concept-map",
    "fig-verian-vfi-concept-map",
  ];

  function enhanceFigure(figure) {
    if (!figure || figure.dataset.panZoomReady === "true") {
      return;
    }

    const svg = figure.querySelector("svg.mermaid-js");
    if (!svg) {
      return;
    }

    figure.dataset.panZoomReady = "true";

    const controls = document.createElement("div");
    controls.className = "concept-map-zoom-controls";
    controls.innerHTML = [
      '<button type="button" data-zoom="in" aria-label="Zoom in">+</button>',
      '<button type="button" data-zoom="out" aria-label="Zoom out">-</button>',
      '<button type="button" data-zoom="reset" aria-label="Reset zoom">Reset</button>',
    ].join("");

    const viewport = document.createElement("div");
    viewport.className = "concept-map-zoom-viewport";
    viewport.setAttribute("tabindex", "0");
    viewport.setAttribute(
      "aria-label",
      "Interactive concept map. Drag to pan, use the mouse wheel or controls to zoom."
    );

    const parent = svg.parentElement;
    parent.insertBefore(controls, svg);
    parent.insertBefore(viewport, svg);
    viewport.appendChild(svg);

    const initialViewBox = svg.viewBox && svg.viewBox.baseVal;
    if (!initialViewBox || initialViewBox.width === 0 || initialViewBox.height === 0) {
      return;
    }

    const original = {
      x: initialViewBox.x,
      y: initialViewBox.y,
      width: initialViewBox.width,
      height: initialViewBox.height,
    };

    const state = {
      viewBox: { ...original },
      minScale: 0.45,
      maxScale: 3,
      dragging: false,
      startX: 0,
      startY: 0,
      originViewBox: { ...original },
    };

    function currentScale() {
      return original.width / state.viewBox.width;
    }

    function applyViewBox() {
      const { x, y, width, height } = state.viewBox;
      svg.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);
    }

    function clampScale(value) {
      return Math.min(state.maxScale, Math.max(state.minScale, value));
    }

    function zoomAt(nextScale, clientX, clientY) {
      const oldScale = currentScale();
      const scale = clampScale(nextScale);
      if (scale === oldScale) {
        return;
      }

      const rect = viewport.getBoundingClientRect();
      const relativeX = (clientX - rect.left) / rect.width;
      const relativeY = (clientY - rect.top) / rect.height;
      const focusX = state.viewBox.x + state.viewBox.width * relativeX;
      const focusY = state.viewBox.y + state.viewBox.height * relativeY;
      const nextWidth = original.width / scale;
      const nextHeight = original.height / scale;

      state.viewBox = {
        x: focusX - nextWidth * relativeX,
        y: focusY - nextHeight * relativeY,
        width: nextWidth,
        height: nextHeight,
      };
      applyViewBox();
    }

    function reset() {
      state.viewBox = { ...original };
      applyViewBox();
    }

    controls.addEventListener("click", (event) => {
      const action = event.target && event.target.dataset.zoom;
      if (!action) {
        return;
      }

      const rect = viewport.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      if (action === "in") {
        zoomAt(currentScale() * 1.2, centerX, centerY);
      } else if (action === "out") {
        zoomAt(currentScale() / 1.2, centerX, centerY);
      } else {
        reset();
      }
    });

    viewport.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
        zoomAt(currentScale() * factor, event.clientX, event.clientY);
      },
      { passive: false }
    );

    viewport.addEventListener("pointerdown", (event) => {
      state.dragging = true;
      state.startX = event.clientX;
      state.startY = event.clientY;
      state.originViewBox = { ...state.viewBox };
      viewport.setPointerCapture(event.pointerId);
      viewport.classList.add("is-panning");
    });

    viewport.addEventListener("pointermove", (event) => {
      if (!state.dragging) {
        return;
      }
      const rect = viewport.getBoundingClientRect();
      const dx = ((event.clientX - state.startX) / rect.width) * state.originViewBox.width;
      const dy = ((event.clientY - state.startY) / rect.height) * state.originViewBox.height;
      state.viewBox.x = state.originViewBox.x - dx;
      state.viewBox.y = state.originViewBox.y - dy;
      applyViewBox();
    });

    function stopDragging(event) {
      if (!state.dragging) {
        return;
      }
      state.dragging = false;
      viewport.classList.remove("is-panning");
      if (event.pointerId !== undefined) {
        viewport.releasePointerCapture(event.pointerId);
      }
    }

    viewport.addEventListener("pointerup", stopDragging);
    viewport.addEventListener("pointercancel", stopDragging);

    viewport.addEventListener("keydown", (event) => {
      const panStep = 40;
      const rect = viewport.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      if (event.key === "+" || event.key === "=") {
        zoomAt(currentScale() * 1.2, centerX, centerY);
      } else if (event.key === "-" || event.key === "_") {
        zoomAt(currentScale() / 1.2, centerX, centerY);
      } else if (event.key === "0" || event.key === "Home") {
        reset();
      } else if (event.key === "ArrowLeft") {
        state.viewBox.x -= panStep / currentScale();
        applyViewBox();
      } else if (event.key === "ArrowRight") {
        state.viewBox.x += panStep / currentScale();
        applyViewBox();
      } else if (event.key === "ArrowUp") {
        state.viewBox.y -= panStep / currentScale();
        applyViewBox();
      } else if (event.key === "ArrowDown") {
        state.viewBox.y += panStep / currentScale();
        applyViewBox();
      } else {
        return;
      }
      event.preventDefault();
    });

    svg.removeAttribute("height");
    svg.removeAttribute("width");
    applyViewBox();
  }

  function enhanceConceptMaps() {
    for (const id of figureIds) {
      enhanceFigure(document.getElementById(id));
    }
  }

  window.addEventListener("load", () => {
    enhanceConceptMaps();
    window.setTimeout(enhanceConceptMaps, 250);
  });
})();

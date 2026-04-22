/*
 * NoScript - a Firefox extension for whitelist driven safe JavaScript execution
 *
 * Copyright (C) 2005-2026 Giorgio Maone <https://maone.net>
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option) any later
 * version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with
 * this program. If not, see <https://www.gnu.org/licenses/>.
 */


"use strict";
(async () => {
  if (!navigator.maxTouchPoints) {
    return;
  }
  const createHTMLElement =
    tagName => document.createElementNS("http://www.w3.org/1999/xhtml", tagName);

  let configuration = await Messages.send("fetchGestureConfiguration");
  Messages.addHandler({
    configureGesture(msg) {
      configuration = msg;
      configure();
    }
  });

  let path = [];
  let canvas, ctx, logo, theme;
  const GESTURE_MIN_HEIGHT = 24;
  const OPACITY_MAX = 0.8;
  const Z_INDEX = 2147483647;
  const COLORS = {
    outline: "#ee0000",
    fill: "#ffffff",
  };
  const LABEL_SIZE = 24;

  const ACTIVE = { passive: false, capture: true };
  const PASSIVE = { passive: true, capture: true };

  function getPathMetrics(p) {
    if (p.length === 0) {
      return { directions: [], minX: 0, maxX: 0, minY: 0, maxY: 0 };
    }

    let directions = [];
    let lastX = p[0].x;
    let minX = p[0].x, maxX = p[0].x;
    let minY = p[0].y, maxY = p[0].y;

    for (let i = 1; i < p.length; i++) {
      const { x, y } = p[i];
      const diff = x - lastX;

      if (Math.abs(diff) > 15) {
        const dir = Math.sign(diff);
        if (directions.length === 0 || directions[directions.length - 1] !== dir) {
          directions.push(dir);
        }
        lastX = x;
      }

      if (x < minX) { minX = x; }
      if (x > maxX) { maxX = x; }
      if (y < minY) { minY = y; }
      if (y > maxY) { maxY = y; }
    }

    return { directions, minX, maxX, minY, maxY };
  }

  async function setupLogo() {
    if (logo) {
      return;
    }
    if (!theme) {
      try {
        theme = await Messages.send("getTheme");
      } catch (e) {
        return;
      }
    }
    logo = createHTMLElement("div");
    logo.className = "__NoScript_Theme__";
    if (theme?.vintage) {
      logo.classList.add("vintage");
    }
    Object.assign(logo.style, {
      position: "fixed",
      background: "var(--img-logo) no-repeat center",
      backgroundSize: "contain",
      zIndex: Z_INDEX - 1,
      pointerEvents: "none",
      opacity: 0,
      transition: "all 0.15s ease-out",
    });

    document.documentElement.appendChild(logo);
  }

  function setupCanvas() {
    if (canvas) {
      return;
    }
    canvas = createHTMLElement("canvas");
    Object.assign(canvas.style, {
      position: "fixed",
      top: 0,
      left: 0,
      width: "100vw",
      height: "100vh",
      zIndex: Z_INDEX,
      pointerEvents: "none",
      opacity: 0,
      transition: "opacity 0.4s ease",
    });
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    document.documentElement.appendChild(canvas);

    ctx = canvas.getContext("2d");
    ctx.lineCap = "round";
    ctx.font = `bold ${LABEL_SIZE}px sans-serif`;
    ctx.textBaseline = "bottom";
    canvas.labelX = (canvas.width - ctx.measureText(configuration.label).width) / 2;
  }

  function drawPath(metrics) {
    if (!ctx || path.length < 2) {
      return;
    }
    canvas.style.opacity = 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) {
      ctx.lineTo(path[i].x, path[i].y);
    }

    const { label } = configuration;

    ctx.strokeStyle = COLORS.outline;
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.strokeStyle = COLORS.fill;
    ctx.stroke();

    if (logo) {
      metrics ??= getPathMetrics(path);
      ctx.beginPath();
      ctx.strokeStyle = COLORS.fill;
      ctx.fillStyle = COLORS.outline + "80";
      const pad = 10;
      ctx.roundRect(canvas.labelX - pad, metrics.minY - LABEL_SIZE - pad,
        canvas.width - canvas.labelX * 2 + pad * 2, LABEL_SIZE + pad * 2, [pad]);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = COLORS.fill;
      ctx.fillText(label, canvas.labelX, metrics.minY, canvas.width);

      const width = metrics.maxX - metrics.minX;
      const height = metrics.maxY - metrics.minY;
      const progress = (Math.min(1, height / GESTURE_MIN_HEIGHT) * 0.4) +
        (Math.min(1, metrics.directions.length / 3) * 0.4);
      const size = Math.max(width, height);

      Object.assign(logo.style, {
        left: `${metrics.minX - (size - width) / 2}px`,
        top: `${metrics.minY - (size - height) / 2}px`,
        width: `${size}px`,
        height: `${size}px`,
        opacity: Math.min(OPACITY_MAX, progress),
      });
    }
  }

  function cleanup(success) {
    if (!success) console.debug("Aborted gesture", new Error().stack); // DEV_ONLY

    setActive(false);

    if (ctx) {
      if (success) {
        ctx.strokeStyle = "#ffffff";
        drawPath();
      }
      ctx = null;
    }

    if (canvas) {
      canvas.style.opacity = 0;
      const oldCanvas = canvas;
      setTimeout(() => oldCanvas.remove(), 400);
      canvas = null;
    }

    if (logo) {
      logo.style.opacity = 0;
      const oldLogo = logo;
      setTimeout(() => oldLogo.remove(), 400);
      logo = null;
    }
  }

  function processGesture(e) {
    if (e && !e.isTrusted) {
      return;
    }
    console.debug("processGesture", e); // DEV_ONLY
    if (path.length < 5) {
      cleanup(false);
      return;
    }

    const metrics = getPathMetrics(path);
    const height = metrics.maxY - metrics.minY;
    const width = metrics.maxX - metrics.minX;

    let isS = metrics.directions.length == 3 &&
      height > GESTURE_MIN_HEIGHT;

    if (isS) {
      Messages.send("openPopup");
      cleanup(true);
    } else {
      cleanup(false);
    }
    if (active && e?.type == "touchend") {
      e.preventDefault();
    }
  }

  const onTouchStart = e => {
    if (!e.isTrusted || e.touches.length > 1) {
      return;
    }
    path = [];
    console.debug("NoScript gesture processing touch event", e); // DEV_ONLY

    if (ns?.canScript && e.target instanceof HTMLCanvasElement) {
      console.debug("Input to a drawing app? Bailing out."); // DEV_ONLY
      return;
    }

    setupLogo();
    setupCanvas();

    const { clientX, clientY } = e.touches[0];
    path.push({ x: clientX, y: clientY });
  };

  const onTouchMove = e => {
    if (!(e.isTrusted && canvas && path.length)) {
      return;
    }
    path.push({ x: e.touches[0].clientX, y: e.touches[0].clientY });
    const pathLength = path.length;
    if (pathLength < 2) {
      return;
    }
    const metrics = getPathMetrics(path);
    const { directions } = metrics;
    console.debug("Directions", active, directions, metrics, e); // DEV_ONLY
    if (directions.length < 1) {
      setActive(true);
      return;
    }
    if (directions[0] != -1 || directions.length > 3) {
      return cleanup(false);
    }

    if (directions.length < 2) {
      const height = metrics.maxY - metrics.minY;
      const width = metrics.maxX - metrics.minX;
      if (width < 20 || height < 20) {
        return;
      }
      if (height / width > 2) {
        return cleanup(false);
      }
    }

    e.preventDefault();

    drawPath(metrics);
  };

  let active = false;
  function setActive(value, force = false) {
    if (!force && active === value) {
      return;
    }
    [PASSIVE, ACTIVE].forEach(state => {
      removeEventListener("touchmove", onTouchMove, state);
      removeEventListener("touchend", processGesture, state);
    });
    if (configuration.enabled) {
      const state = value ? ACTIVE : PASSIVE;
      addEventListener("touchmove", onTouchMove, state);
      addEventListener("touchend", processGesture, state);
    }
    active = value;
  }

  function configure() {
    let { enabled } = configuration;
    const act = window[`${enabled ? "add" : "remove" }EventListener`].bind(window);
    act("touchstart", onTouchStart, PASSIVE);
    act("touchcancel", processGesture, PASSIVE);
    setActive(false, true);
    if (!enabled) {
      cleanup(false);
    }
  }

  configure();

})();

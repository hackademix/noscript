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
if (navigator.maxTouchPoints) {
  let path = [];
  let canvas, ctx, logo, theme;
  const GESTURE_MIN_HEIGHT = 24;
  const OPACITY_MAX = 0.8;
  const Z_INDEX = 2147483647;


  /**
  * Helper to calculate metrics used by both drawPath and processGesture.
  * Consolidates bounding box and horizontal direction changes.
  */
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
    logo = document.createElement("div");
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
    canvas = document.createElement("canvas");
    Object.assign(canvas.style, {
      position: "fixed",
      top: 0,
      left: 0,
      width: "100vw",
      height: "100vh",
      zIndex: Z_INDEX,
      pointerEvents: "none",
      opacity: 1,
      transition: "opacity 0.4s ease",
    });
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    document.documentElement.appendChild(canvas);

    ctx = canvas.getContext("2d");
    ctx.lineCap = "round";
  }

  function drawPath() {
    if (!ctx || path.length < 2) {
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) {
      ctx.lineTo(path[i].x, path[i].y);
    }

    ctx.strokeStyle = "#ff2222";
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();

    if (logo) {
      const metrics = getPathMetrics(path);
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

    if (path.length < 5) {
      cleanup(false);
      return;
    }

    const metrics = getPathMetrics(path);
    const height = metrics.maxY - metrics.minY;
    const width = metrics.maxX - metrics.minX;

    let isS = metrics.directions.length >= 3 &&
      height > GESTURE_MIN_HEIGHT;

    if (isS) {
      Messages.send("openPopup");
      cleanup(true);
    } else {
      cleanup(false);
    }
  }

  window.addEventListener("touchstart", e => {
    if (!e.isTrusted || e.touches.length > 1) {
      return;
    }
    setupLogo();
    setupCanvas();
    path = [{ x: e.touches[0].clientX, y: e.touches[0].clientY }];
  }, { passive: true });

  window.addEventListener("touchmove", e => {
    if (!(e.isTrusted && canvas)) {
      return;
    }
    path.push({ x: e.touches[0].clientX, y: e.touches[0].clientY });
    const pathLength = path.length;
    if (pathLength < 2) {
      return;
    }
    if (pathLength < 5) {
      const lastX = path[pathLength - 2].x, lastY = path[pathLength - 2].y;
      const { x, y } = path[pathLength - 1];
      const dx = x - lastX, dy = y - lastY;
      const verticality = Math.abs(dy / dx);
      console.debug("Verticality", verticality); // DEV_ONLY
      if (dx >= 0 || verticality > 2 || verticality < .5) {
        cleanup(false);
        return;
      }
    }
    e.preventDefault();
    drawPath();
  }, { passive: false });

  window.addEventListener("touchend", processGesture, { passive: false });
  window.addEventListener("touchcancel", processGesture, { passive: true });
}

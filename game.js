(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const scoreEl = document.getElementById("score");
  const livesEl = document.getElementById("lives");
  const cargoEl = document.getElementById("cargo");
  const deliveriesEl = document.getElementById("deliveries");
  const muteBtn = document.getElementById("muteBtn");

  const TILE = 64;
  const COLS = canvas.width / TILE;
  const ROWS = canvas.height / TILE;
  const DELIVERY_TARGET = 5;

  const ROAD_ROWS = new Set([1, 2, 4, 5, 7]);
  const SAFE_ROWS = new Set([0, 3, 6, 8, 9]);

  const dropOffCols = [1, 7, 13];
  const stashZone = { minCol: 6, maxCol: 8, row: 8 };

  const game = {
    score: 0,
    lives: 3,
    deliveries: 0,
    hasCargo: false,
    isOver: false,
    message: "Grab cargo at the stash near bottom center.",
    lastMoveAt: 0,
    cars: [],
    cashPickup: null,
    cashRespawnAt: 0,
    dropFx: [],
  };

  const player = {
    col: 7,
    row: 9,
    x: 7 * TILE + TILE * 0.2,
    y: 9 * TILE + TILE * 0.14,
    w: TILE * 0.58,
    h: TILE * 0.72,
  };

  class MusicLoop {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.step = 0;
      this.timer = null;
      this.started = false;
      this.muted = false;
      this.bass = [55, 55, 82.41, 65.41, 55, 55, 98, 82.41];
      this.lead = [220, 246.94, 293.66, 246.94, 329.63, 293.66, 246.94, 196];
    }

    start() {
      if (this.started) return;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      this.ctx = new AudioCtx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.08;
      this.master.connect(this.ctx.destination);

      this.timer = setInterval(() => this.tick(), 240);
      this.started = true;
    }

    tick() {
      if (!this.ctx || !this.master) return;
      if (this.ctx.state === "suspended") {
        this.ctx.resume();
      }

      const now = this.ctx.currentTime;
      const s = this.step;
      const bassNote = this.bass[s % this.bass.length];
      const leadNote = this.lead[s % this.lead.length];

      this.playTone(bassNote, now, 0.16, "square", 0.12);

      if (s % 2 === 0) {
        this.playTone(leadNote, now + 0.03, 0.11, "triangle", 0.08);
      }
      if (s % 4 === 3) {
        this.playTone(leadNote * 2, now + 0.07, 0.08, "sine", 0.05);
      }

      this.step += 1;
    }

    playTone(freq, start, duration, type, gainValue) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

      osc.connect(gain);
      gain.connect(this.master);

      osc.start(start);
      osc.stop(start + duration + 0.02);
    }

    toggleMute() {
      this.muted = !this.muted;
      if (this.master) {
        this.master.gain.value = this.muted ? 0.0001 : 0.08;
      }
      muteBtn.textContent = `Mute Music: ${this.muted ? "On" : "Off"}`;
    }
  }

  const music = new MusicLoop();

  function buildTraffic() {
    game.cars = [
      laneCars(1, 180, 1, "#eb5757"),
      laneCars(2, -220, 2, "#5fd3ff"),
      laneCars(4, 250, 1.3, "#f3a95d"),
      laneCars(5, -160, 1.5, "#7ef099"),
      laneCars(7, 280, 1, "#ff6ce0"),
    ].flat();
  }

  function laneCars(row, speed, sizeTiles, color) {
    const cars = [];
    const spacing = TILE * 3.5;
    for (let i = 0; i < 5; i += 1) {
      const w = TILE * sizeTiles;
      const h = TILE * 0.6;
      const dir = Math.sign(speed) || 1;
      const base = dir > 0 ? -w : canvas.width + w;
      cars.push({
        row,
        x: base + i * spacing * -dir,
        y: row * TILE + TILE * 0.2,
        w,
        h,
        speed,
        color,
      });
    }
    return cars;
  }

  function resetPlayer() {
    player.col = 7;
    player.row = 9;
    syncPlayerPixelPosition();
  }

  function syncPlayerPixelPosition() {
    player.x = player.col * TILE + TILE * 0.2;
    player.y = player.row * TILE + TILE * 0.14;
  }

  function restartGame() {
    game.score = 0;
    game.lives = 3;
    game.deliveries = 0;
    game.hasCargo = false;
    game.isOver = false;
    game.message = "Grab cargo at the stash near bottom center.";
    game.dropFx = [];
    game.cashPickup = null;
    game.cashRespawnAt = performance.now() + 1200;
    buildTraffic();
    resetPlayer();
    updateHud();
  }

  function updateHud() {
    scoreEl.textContent = String(game.score);
    livesEl.textContent = String(game.lives);
    cargoEl.textContent = game.hasCargo ? "Package" : "None";
    deliveriesEl.textContent = `${game.deliveries} / ${DELIVERY_TARGET}`;
  }

  function onKeyDown(event) {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "a", "s", "d", "W", "A", "S", "D", "r", "R"].includes(event.key)) {
      event.preventDefault();
    }

    if (!music.started) music.start();

    if (game.isOver) {
      if (event.key.toLowerCase() === "r") {
        restartGame();
      }
      return;
    }

    const now = performance.now();
    if (now - game.lastMoveAt < 110) return;
    game.lastMoveAt = now;

    const key = event.key.toLowerCase();
    if (key === "arrowup" || key === "w") movePlayer(0, -1);
    if (key === "arrowdown" || key === "s") movePlayer(0, 1);
    if (key === "arrowleft" || key === "a") movePlayer(-1, 0);
    if (key === "arrowright" || key === "d") movePlayer(1, 0);
  }

  function movePlayer(dx, dy) {
    const nextCol = clamp(player.col + dx, 0, COLS - 1);
    const nextRow = clamp(player.row + dy, 0, ROWS - 1);
    player.col = nextCol;
    player.row = nextRow;
    syncPlayerPixelPosition();
    evaluateTileActions();
  }

  function evaluateTileActions() {
    if (player.row === stashZone.row && player.col >= stashZone.minCol && player.col <= stashZone.maxCol && !game.hasCargo) {
      game.hasCargo = true;
      game.score += 25;
      game.message = "Cargo acquired. Deliver it to one of the top drop zones.";
      updateHud();
    }

    if (player.row === 0 && game.hasCargo && dropOffCols.includes(player.col)) {
      game.hasCargo = false;
      game.deliveries += 1;
      game.score += 200;
      game.message = "Drop complete. Return for more cargo.";
      game.dropFx.push({
        x: player.col * TILE + TILE / 2,
        y: player.row * TILE + TILE / 2,
        ttl: 500,
      });
      if (game.deliveries >= DELIVERY_TARGET) {
        game.isOver = true;
        game.message = "You finished all runs. Press R to play again.";
      }
      updateHud();
    }

    if (
      game.cashPickup &&
      player.col === game.cashPickup.col &&
      player.row === game.cashPickup.row
    ) {
      game.score += 120;
      game.message = "Stolen cash collected.";
      game.cashPickup = null;
      game.cashRespawnAt = performance.now() + 3000;
      updateHud();
    }
  }

  function spawnCashIfNeeded(now) {
    if (game.cashPickup || now < game.cashRespawnAt || game.isOver) return;
    const rows = [1, 2, 3, 4, 5, 6, 7];
    const row = rows[Math.floor(Math.random() * rows.length)];
    const col = Math.floor(Math.random() * COLS);
    game.cashPickup = { row, col };
  }

  function updateCars(dt) {
    for (const car of game.cars) {
      car.x += car.speed * dt;
      if (car.speed > 0 && car.x > canvas.width + car.w) {
        car.x = -car.w - Math.random() * TILE * 3;
      } else if (car.speed < 0 && car.x < -car.w - TILE) {
        car.x = canvas.width + Math.random() * TILE * 3;
      }
    }
  }

  function checkCarHits() {
    if (!ROAD_ROWS.has(player.row) || game.isOver) return;
    for (const car of game.cars) {
      if (car.row !== player.row) continue;
      if (intersects(player, car)) {
        game.lives -= 1;
        game.hasCargo = false;
        game.message = game.lives > 0 ? "Traffic smashed you. Try again." : "Busted. Press R to restart.";
        resetPlayer();
        updateHud();
        if (game.lives <= 0) game.isOver = true;
        return;
      }
    }
  }

  function intersects(a, b) {
    return (
      a.x < b.x + b.w &&
      a.x + a.w > b.x &&
      a.y < b.y + b.h &&
      a.y + a.h > b.y
    );
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function draw() {
    drawMap();
    drawCars();
    drawCash();
    drawDropEffects();
    drawPlayer();
    drawMessage();
    if (game.isOver) {
      drawOverlay();
    }
  }

  function drawMap() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let row = 0; row < ROWS; row += 1) {
      const y = row * TILE;
      if (row === 0) {
        ctx.fillStyle = "#243628";
      } else if (ROAD_ROWS.has(row)) {
        ctx.fillStyle = "#2b2a33";
      } else {
        ctx.fillStyle = "#1f3d4c";
      }
      ctx.fillRect(0, y, canvas.width, TILE);

      if (ROAD_ROWS.has(row)) {
        ctx.strokeStyle = "#d8d9dd";
        ctx.setLineDash([14, 18]);
        ctx.beginPath();
        ctx.moveTo(0, y + TILE / 2);
        ctx.lineTo(canvas.width, y + TILE / 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Stash bay near bottom center.
    ctx.fillStyle = "#ffd166";
    ctx.fillRect(stashZone.minCol * TILE, stashZone.row * TILE, (stashZone.maxCol - stashZone.minCol + 1) * TILE, TILE);
    ctx.fillStyle = "#402f00";
    ctx.fillText("STASH", stashZone.minCol * TILE + 10, stashZone.row * TILE + 24);

    // Drop zones at the top.
    for (const col of dropOffCols) {
      ctx.fillStyle = "#6fe3c6";
      ctx.fillRect(col * TILE + 8, 6, TILE - 16, TILE - 12);
      ctx.fillStyle = "#083327";
      ctx.fillText("DROP", col * TILE + 12, 28);
    }

    if (!SAFE_ROWS.has(player.row) && !ROAD_ROWS.has(player.row)) {
      // This should never happen, but keeps row grouping explicit.
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(0, player.row * TILE, canvas.width, TILE);
    }
  }

  function drawCars() {
    for (const car of game.cars) {
      ctx.fillStyle = car.color;
      ctx.fillRect(car.x, car.y, car.w, car.h);

      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillRect(car.x + 6, car.y + car.h - 12, car.w - 12, 8);
      ctx.fillStyle = "#c4d2f6";
      ctx.fillRect(car.x + 8, car.y + 6, car.w - 16, 10);
    }
  }

  function drawPlayer() {
    ctx.fillStyle = "#f4c05e";
    ctx.fillRect(player.x, player.y, player.w, player.h);
    ctx.fillStyle = "#201b17";
    ctx.fillRect(player.x + 8, player.y + 8, player.w - 16, 12);
    if (game.hasCargo) {
      ctx.fillStyle = "#9b5de5";
      ctx.fillRect(player.x + player.w - 12, player.y + 6, 10, 14);
    }
  }

  function drawCash() {
    if (!game.cashPickup) return;
    const x = game.cashPickup.col * TILE + TILE * 0.3;
    const y = game.cashPickup.row * TILE + TILE * 0.25;
    ctx.fillStyle = "#71f79f";
    ctx.fillRect(x, y, TILE * 0.4, TILE * 0.35);
    ctx.fillStyle = "#0d4020";
    ctx.fillText("$", x + TILE * 0.15, y + TILE * 0.22);
  }

  function drawDropEffects() {
    const now = performance.now();
    for (let i = game.dropFx.length - 1; i >= 0; i -= 1) {
      const fx = game.dropFx[i];
      const age = 1 - fx.ttl / 500;
      ctx.strokeStyle = `rgba(111, 227, 198, ${Math.max(0, 1 - age)})`;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, 8 + age * 34, 0, Math.PI * 2);
      ctx.stroke();
      fx.ttl -= now - (fx.prev || now);
      fx.prev = now;
      if (fx.ttl <= 0) game.dropFx.splice(i, 1);
    }
  }

  function drawMessage() {
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, canvas.height - 30, canvas.width, 30);
    ctx.fillStyle = "#f3f8ff";
    ctx.font = "16px Trebuchet MS";
    ctx.fillText(game.message, 10, canvas.height - 10);
  }

  function drawOverlay() {
    ctx.fillStyle = "rgba(3,5,10,0.7)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffd166";
    ctx.font = "bold 40px Trebuchet MS";
    ctx.fillText(
      game.deliveries >= DELIVERY_TARGET ? "RUN COMPLETE" : "GAME OVER",
      canvas.width / 2 - 150,
      canvas.height / 2 - 10,
    );
    ctx.font = "22px Trebuchet MS";
    ctx.fillStyle = "#f0f3ff";
    ctx.fillText("Press R to restart", canvas.width / 2 - 90, canvas.height / 2 + 30);
  }

  let lastFrame = performance.now();

  function frame(now) {
    const dt = Math.min(0.04, (now - lastFrame) / 1000);
    lastFrame = now;

    spawnCashIfNeeded(now);
    updateCars(dt);
    checkCarHits();
    draw();
    requestAnimationFrame(frame);
  }

  muteBtn.addEventListener("click", () => {
    if (!music.started) music.start();
    music.toggleMute();
  });

  window.addEventListener("keydown", onKeyDown);
  canvas.addEventListener("pointerdown", () => {
    if (!music.started) music.start();
  });

  restartGame();
  requestAnimationFrame(frame);
})();

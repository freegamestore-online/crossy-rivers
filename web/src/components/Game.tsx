import { useEffect, useMemo, useRef, useState } from "react";
import { useGameSounds, useLeaderboard } from "@freegamestore/games";
import {
  CROC_BODY,
  CROC_SNOUT,
  CROC_TOOTH,
  EYE_PUPIL,
  EYE_WHITE,
  FROG_BELLY,
  FROG_BODY,
  FROG_EYE,
  FROG_LEG,
  FROG_SMILE,
  ROAD_FALLBACK,
  ROAD_PALETTE,
  SAFE_LANE_ALT_EVEN,
  SAFE_LANE_ALT_ODD,
  SAFE_LANE_BASE,
  SKY_BOTTOM,
  SKY_TOP,
  SNAKE_BODY,
  SNAKE_HEAD,
  SNAKE_TONGUE,
} from "../lib/palette";

interface GameProps {
  onScore: (n: number) => void;
  onGameOver: () => void;
  paused: boolean;
  restartToken: number;
  onRestartRequest: () => void;
}

type Lane = {
  kind: "safe" | "road";
  speed: number;
  dir: 1 | -1;
  cars: number;
  carLength: number;
  phase: number;
  color: string;
};

type GameState = {
  col: number;
  row: number;
  scroll: number;
  score: number;
  over: boolean;
};

const GRID_COLS = 9;
const GRID_ROWS = 12;
const CAMERA_ROW = 7;

function hash32(n: number): number {
  let x = n | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

function laneAt(worldY: number): Lane {
  if (worldY <= 0) {
    return {
      kind: "safe",
      speed: 0,
      dir: 1,
      cars: 0,
      carLength: 0,
      phase: 0,
      color: SAFE_LANE_BASE,
    };
  }

  const h = hash32(worldY * 1013 + 19);
  const safe = h % 100 < 25;
  if (safe) {
    return {
      kind: "safe",
      speed: 0,
      dir: 1,
      cars: 0,
      carLength: 0,
      phase: 0,
      color: worldY % 2 === 0 ? SAFE_LANE_ALT_EVEN : SAFE_LANE_ALT_ODD,
    };
  }

  const speed = 1.2 + ((h >>> 3) % 100) / 80;
  const cars = 2 + ((h >>> 9) % 3);
  const carLength = 1 + ((h >>> 13) % 2);
  const dir: 1 | -1 = (h & 1) === 0 ? 1 : -1;
  const phase = ((h >>> 17) % 1000) / 1000;

  const color = ROAD_PALETTE[(h >>> 21) % ROAD_PALETTE.length] ?? ROAD_FALLBACK;

  return {
    kind: "road",
    speed,
    dir,
    cars,
    carLength,
    phase,
    color,
  };
}

function wrap(value: number, size: number): number {
  const mod = value % size;
  return mod < 0 ? mod + size : mod;
}

export function Game({
  onScore,
  onGameOver,
  paused,
  restartToken,
  onRestartRequest,
}: GameProps) {
  const sounds = useGameSounds();
  const { submitScore } = useLeaderboard("cross-the-roads");

  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const viewportRef = useRef({ width: 0, height: 0 });
  const stateRef = useRef<GameState>({
    col: Math.floor(GRID_COLS / 2),
    row: GRID_ROWS - 1,
    scroll: 0,
    score: 0,
    over: false,
  });

  const elapsedRef = useRef(0);
  const lastTsRef = useRef<number | null>(null);
  const submittedRef = useRef(false);

  const [isOver, setIsOver] = useState(false);
  const [submitState, setSubmitState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const visibleScore = useMemo(() => stateRef.current.score, [restartToken, isOver]);

  const draw = (timeSec: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = viewportRef.current.width || canvas.clientWidth;
    const height = viewportRef.current.height || canvas.clientHeight;
    const cell = Math.min(width / GRID_COLS, height / GRID_ROWS);
    const offsetX = (width - cell * GRID_COLS) / 2;
    const offsetY = (height - cell * GRID_ROWS) / 2;

    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, SKY_TOP);
    sky.addColorStop(1, SKY_BOTTOM);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(offsetX, offsetY);

    const state = stateRef.current;

    for (let row = 0; row < GRID_ROWS; row += 1) {
      const worldY = state.scroll + (GRID_ROWS - 1 - row);
      const lane = laneAt(worldY);

      ctx.fillStyle = lane.kind === "road" ? lane.color : lane.color;
      ctx.fillRect(0, row * cell, GRID_COLS * cell, cell);

      if (lane.kind === "road") {
        // Water ripples.
        ctx.fillStyle = "rgba(220, 242, 255, 0.22)";
        for (let ripple = 0; ripple < GRID_COLS; ripple += 1) {
          const waveX = ripple * cell + ((timeSec * 28 + row * 11) % cell) * 0.35;
          ctx.beginPath();
          ctx.ellipse(waveX, row * cell + cell * 0.52, cell * 0.2, cell * 0.05, 0, 0, Math.PI * 2);
          ctx.fill();
        }

        const cycle = GRID_COLS + 6;
        const spacing = cycle / lane.cars;

        for (let i = 0; i < lane.cars; i += 1) {
          const progress = lane.phase * cycle + i * spacing + lane.dir * timeSec * lane.speed;
          const x = wrap(progress, cycle) - 3;
          const isCroc = i % 2 === 0;

          const carX = x * cell;
          const carY = row * cell + cell * 0.22;
          const carW = lane.carLength * cell;
          const carH = cell * 0.56;

          if (isCroc) {
            // Crocodile body.
            ctx.fillStyle = CROC_BODY;
            ctx.beginPath();
            ctx.roundRect(carX + carW * 0.02, carY, carW * 0.96, carH, cell * 0.2);
            ctx.fill();

            // Crocodile snout.
            const snoutX = lane.dir === 1 ? carX + carW * 0.92 : carX + carW * 0.08;
            ctx.fillStyle = CROC_SNOUT;
            ctx.beginPath();
            ctx.ellipse(snoutX, carY + carH * 0.52, carW * 0.12, carH * 0.23, 0, 0, Math.PI * 2);
            ctx.fill();

            // Eyes.
            ctx.fillStyle = EYE_WHITE;
            ctx.beginPath();
            ctx.arc(carX + carW * 0.3, carY + carH * 0.18, cell * 0.045, 0, Math.PI * 2);
            ctx.arc(carX + carW * 0.66, carY + carH * 0.18, cell * 0.045, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = EYE_PUPIL;
            ctx.beginPath();
            ctx.arc(carX + carW * 0.3, carY + carH * 0.18, cell * 0.02, 0, Math.PI * 2);
            ctx.arc(carX + carW * 0.66, carY + carH * 0.18, cell * 0.02, 0, Math.PI * 2);
            ctx.fill();

            // Teeth.
            ctx.fillStyle = CROC_TOOTH;
            for (let tooth = 0; tooth < 4; tooth += 1) {
              const tx = carX + carW * (0.22 + tooth * 0.16);
              ctx.beginPath();
              ctx.moveTo(tx, carY + carH * 0.75);
              ctx.lineTo(tx + carW * 0.05, carY + carH * 0.75);
              ctx.lineTo(tx + carW * 0.025, carY + carH * 0.9);
              ctx.closePath();
              ctx.fill();
            }
          } else {
            // Snake body.
            ctx.strokeStyle = SNAKE_BODY;
            ctx.lineWidth = Math.max(2, cell * 0.12);
            ctx.lineCap = "round";
            ctx.beginPath();
            for (let segment = 0; segment <= 8; segment += 1) {
              const t = segment / 8;
              const sx = carX + t * carW;
              const sy = carY + carH * 0.55 + Math.sin(t * Math.PI * 3 + timeSec * 6) * carH * 0.25;
              if (segment === 0) {
                ctx.moveTo(sx, sy);
              } else {
                ctx.lineTo(sx, sy);
              }
            }
            ctx.stroke();

            // Snake head.
            const headX = lane.dir === 1 ? carX + carW * 0.95 : carX + carW * 0.05;
            const headY = carY + carH * 0.55;
            ctx.fillStyle = SNAKE_HEAD;
            ctx.beginPath();
            ctx.ellipse(headX, headY, carW * 0.09, carH * 0.2, 0, 0, Math.PI * 2);
            ctx.fill();

            // Tongue.
            ctx.strokeStyle = SNAKE_TONGUE;
            ctx.lineWidth = Math.max(1, cell * 0.025);
            ctx.beginPath();
            const tongueDir = lane.dir === 1 ? 1 : -1;
            ctx.moveTo(headX, headY);
            ctx.lineTo(headX + tongueDir * carW * 0.1, headY - carH * 0.06);
            ctx.moveTo(headX + tongueDir * carW * 0.1, headY - carH * 0.06);
            ctx.lineTo(headX + tongueDir * carW * 0.13, headY - carH * 0.1);
            ctx.moveTo(headX + tongueDir * carW * 0.1, headY - carH * 0.06);
            ctx.lineTo(headX + tongueDir * carW * 0.13, headY - carH * 0.02);
            ctx.stroke();
          }
        }
      }
    }

    const px = state.col * cell;
    const py = state.row * cell;

    // Frog body.
    ctx.fillStyle = FROG_BODY;
    ctx.beginPath();
    ctx.roundRect(px + cell * 0.14, py + cell * 0.24, cell * 0.72, cell * 0.6, cell * 0.28);
    ctx.fill();

    // Frog belly.
    ctx.fillStyle = FROG_BELLY;
    ctx.beginPath();
    ctx.ellipse(px + cell * 0.5, py + cell * 0.57, cell * 0.2, cell * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();

    // Frog head bump.
    ctx.fillStyle = FROG_BODY;
    ctx.beginPath();
    ctx.arc(px + cell * 0.5, py + cell * 0.28, cell * 0.23, 0, Math.PI * 2);
    ctx.fill();

    // Eyes.
    ctx.fillStyle = FROG_EYE;
    ctx.beginPath();
    ctx.arc(px + cell * 0.34, py + cell * 0.18, cell * 0.09, 0, Math.PI * 2);
    ctx.arc(px + cell * 0.66, py + cell * 0.18, cell * 0.09, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = EYE_PUPIL;
    ctx.beginPath();
    ctx.arc(px + cell * 0.34, py + cell * 0.19, cell * 0.035, 0, Math.PI * 2);
    ctx.arc(px + cell * 0.66, py + cell * 0.19, cell * 0.035, 0, Math.PI * 2);
    ctx.fill();

    // Frog smile.
    ctx.strokeStyle = FROG_SMILE;
    ctx.lineWidth = Math.max(1, cell * 0.03);
    ctx.beginPath();
    ctx.arc(px + cell * 0.5, py + cell * 0.42, cell * 0.12, 0.2, Math.PI - 0.2);
    ctx.stroke();

    // Legs.
    ctx.strokeStyle = FROG_LEG;
    ctx.lineWidth = Math.max(1, cell * 0.05);
    ctx.beginPath();
    ctx.moveTo(px + cell * 0.34, py + cell * 0.78);
    ctx.lineTo(px + cell * 0.24, py + cell * 0.92);
    ctx.moveTo(px + cell * 0.66, py + cell * 0.78);
    ctx.lineTo(px + cell * 0.76, py + cell * 0.92);
    ctx.stroke();

    ctx.restore();
  };

  const checkCollision = (timeSec: number) => {
    const state = stateRef.current;
    const worldY = state.scroll + (GRID_ROWS - 1 - state.row);
    const lane = laneAt(worldY);

    if (lane.kind !== "road") return;

    const cycle = GRID_COLS + 6;
    const spacing = cycle / lane.cars;
    const playerLeft = state.col + 0.12;
    const playerRight = state.col + 0.88;

    for (let i = 0; i < lane.cars; i += 1) {
      const progress = lane.phase * cycle + i * spacing + lane.dir * timeSec * lane.speed;
      const carLeft = wrap(progress, cycle) - 3;
      const carRight = carLeft + lane.carLength;

      if (playerRight > carLeft && playerLeft < carRight) {
        state.over = true;
        setIsOver(true);
        sounds.playGameOver();
        onGameOver();
        return;
      }
    }
  };

  const resizeCanvas = () => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;

    const rect = root.getBoundingClientRect();
    viewportRef.current.width = rect.width;
    viewportRef.current.height = rect.height;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    draw(elapsedRef.current);
  };

  const movePlayer = (dir: "up" | "down" | "left" | "right") => {
    const state = stateRef.current;
    if (state.over || paused) return;

    let moved = false;

    if (dir === "left" && state.col > 0) {
      state.col -= 1;
      moved = true;
    } else if (dir === "right" && state.col < GRID_COLS - 1) {
      state.col += 1;
      moved = true;
    } else if (dir === "up") {
      if (state.row > CAMERA_ROW) {
        state.row -= 1;
      } else {
        state.scroll += 1;
      }
      moved = true;
    } else if (dir === "down") {
      if (state.row === CAMERA_ROW && state.scroll > 0) {
        state.scroll -= 1;
        moved = true;
      } else if (state.row < GRID_ROWS - 1) {
        state.row += 1;
        moved = true;
      }
    }

    if (!moved) return;

    sounds.playMove();

    const nextScore = state.scroll + (GRID_ROWS - 1 - state.row);
    if (nextScore > state.score) {
      state.score = nextScore;
      onScore(nextScore);
      sounds.playScore();
      if (nextScore % 10 === 0) {
        sounds.playLevelUp();
      }
    }

    draw(elapsedRef.current);
    checkCollision(elapsedRef.current);
  };

  useEffect(() => {
    const state = stateRef.current;
    state.col = Math.floor(GRID_COLS / 2);
    state.row = GRID_ROWS - 1;
    state.scroll = 0;
    state.score = 0;
    state.over = false;

    submittedRef.current = false;
    elapsedRef.current = 0;
    lastTsRef.current = null;
    setSubmitState("idle");
    setIsOver(false);
    onScore(0);

    resizeCanvas();
  }, [restartToken, onScore]);

  useEffect(() => {
    if (!isOver || submittedRef.current) return;

    submittedRef.current = true;
    setSubmitState("saving");

    submitScore(stateRef.current.score)
      .then((result) => {
        if (result.ok) {
          setSubmitState("saved");
          sounds.playLevelUp();
        } else {
          setSubmitState("error");
        }
      })
      .catch(() => {
        setSubmitState("error");
      });
  }, [isOver, submitScore, sounds]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowUp" || event.key.toLowerCase() === "w") {
        event.preventDefault();
        movePlayer("up");
      } else if (event.key === "ArrowDown" || event.key.toLowerCase() === "s") {
        event.preventDefault();
        movePlayer("down");
      } else if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") {
        event.preventDefault();
        movePlayer("left");
      } else if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") {
        event.preventDefault();
        movePlayer("right");
      } else if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        onRestartRequest();
      }
    };

    window.addEventListener("keydown", onKeyDown, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  });

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const observer = new ResizeObserver(() => resizeCanvas());
    observer.observe(root);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const tick = (ts: number) => {
      if (lastTsRef.current == null) {
        lastTsRef.current = ts;
      }

      const dt = Math.min((ts - (lastTsRef.current ?? ts)) / 1000, 0.05);
      lastTsRef.current = ts;

      if (!paused && !stateRef.current.over) {
        elapsedRef.current += dt;
        checkCollision(elapsedRef.current);
      }

      draw(elapsedRef.current);
      rafRef.current = window.requestAnimationFrame(tick);
    };

    rafRef.current = window.requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
      }
    };
  }, [paused]);

  return (
    <div className="relative h-full w-full px-3 pb-24 pt-2 sm:pb-3">
      <div
        ref={rootRef}
        className="mx-auto h-full w-full max-w-3xl overflow-hidden rounded-2xl border"
        style={{ borderColor: "var(--line-strong)", background: "var(--panel)" }}
      >
        <canvas ref={canvasRef} className="h-full w-full" />

        {isOver ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/55 p-6">
            <div className="w-full max-w-sm rounded-2xl border bg-white/95 p-5 text-center shadow-2xl dark:bg-zinc-900/95">
              <h2 className="text-2xl font-bold" style={{ fontFamily: "Fraunces, serif" }}>
                Crash!
              </h2>
              <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
                Final score: {visibleScore}
              </p>
              <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                {submitState === "saving" && "Submitting score..."}
                {submitState === "saved" && "Score submitted to leaderboard."}
                {submitState === "error" && "Could not submit score right now."}
              </p>
              <button
                type="button"
                onClick={onRestartRequest}
                className="mt-4 rounded-xl px-4 py-2 font-semibold"
                style={{ background: "var(--accent)", color: "white" }}
              >
                Play again
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2">
        <div className="pointer-events-auto grid grid-cols-3 gap-2 rounded-2xl border p-2 backdrop-blur"
          style={{ background: "var(--glass)", borderColor: "var(--line)" }}
        >
          <button type="button" className="rounded-lg border px-3 py-2" onClick={() => movePlayer("up")}>↑</button>
          <button type="button" className="rounded-lg border px-3 py-2" onClick={() => movePlayer("left")}>←</button>
          <button type="button" className="rounded-lg border px-3 py-2" onClick={() => movePlayer("right")}>→</button>
          <button type="button" className="col-span-3 rounded-lg border px-3 py-2" onClick={() => movePlayer("down")}>↓</button>
        </div>
      </div>
    </div>
  );
}

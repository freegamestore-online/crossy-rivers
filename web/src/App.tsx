import { useState } from "react";
import { GameShell, GameTopbar, GameAuth } from "@freegamestore/games";
import { Game } from "./components/Game";

export default function App() {
  const [score, setScore] = useState(0);
  const [paused, setPaused] = useState(false);
  const [restartToken, setRestartToken] = useState(0);

  const restartGame = () => {
    setPaused(false);
    setScore(0);
    setRestartToken((prev) => prev + 1);
  };

  return (
    <GameShell
      topbar={
        <GameTopbar
          title="cross the roads"
          score={score}
          paused={paused}
          onPlayPause={() => setPaused((prev) => !prev)}
          onRestart={restartGame}
          rules={
            <div className="space-y-2 text-sm leading-6">
              <p>Hop upstream, avoid crocs and snakes, and survive as long as possible.</p>
              <p>Controls: Arrow keys or WASD. Press R to restart.</p>
              <p>Forward hops increase score. Sign in to save leaderboard runs.</p>
            </div>
          }
        />
      }
    >
      <GameAuth />
      <Game
        onScore={setScore}
        onGameOver={() => setPaused(true)}
        paused={paused}
        restartToken={restartToken}
        onRestartRequest={restartGame}
      />
      <a
        href="https://freegamestore.online"
        target="_blank"
        rel="noreferrer"
        className="absolute bottom-2 right-3 text-xs underline"
        style={{ color: "var(--muted)" }}
      >
        Built for freegamestore.online
      </a>
    </GameShell>
  );
}

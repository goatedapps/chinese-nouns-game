const app = document.getElementById("app");

const SOUNDS = {
  button: "assets/sounds/button.mp3",
  correct: "assets/sounds/correct.mp3",
  wrong: "assets/sounds/wrong-answer.mp3",
  goodResult: "assets/sounds/good-result.mp3",
  ticker: "assets/sounds/ticker.mp3",
  countdown: "assets/sounds/countdown.mp3",
};

function playSound(name) {
  const src = SOUNDS[name];
  if (!src) return;
  new Audio(src).play().catch(() => {});
}

// Ticker and countdown are reused (not fire-and-forget) so they can be cut
// off immediately instead of ringing out on their own after their screen ends.
const tickerAudio = new Audio(SOUNDS.ticker);
const countdownAudio = new Audio(SOUNDS.countdown);

function playTicker() {
  tickerAudio.currentTime = 0;
  tickerAudio.play().catch(() => {});
}

function stopTicker() {
  tickerAudio.pause();
  tickerAudio.currentTime = 0;
}

function playCountdownSound() {
  countdownAudio.currentTime = 0;
  countdownAudio.play().catch(() => {});
}

function stopCountdownSound() {
  countdownAudio.pause();
  countdownAudio.currentTime = 0;
}

// Delegated so it survives every re-render (app's innerHTML is replaced, app itself isn't).
// Buttons that already play a more specific sound (judge Correct/Wrong) opt out via data-silent.
app.addEventListener("click", (e) => {
  const btn = e.target.closest(".btn");
  if (btn && !btn.dataset.silent) playSound("button");
});

const state = {
  screen: "loading",
  loadError: null,
  lists: [],       // [{id, label, nouns:[...]}]
  players: [],      // [{name, score}]
  selectedListIds: new Set(),
  studySeconds: 30,
  answerSeconds: 5,
  describeSeconds: 20,
  memorize: null,   // {pages, pageIndex, timeLeft, timerId}
  play: null,       // {pool, turnIndex, phase, timeLeft, timerId} — round 1
  memory: null,     // {cards, firstIndex, secondIndex, busy, turnIndex, matchesFound, totalPairs} — round 2
  taboo: null,      // {pool, turnIndex, phase, timeUp, timeLeft, timerId} — round 3
};

const MIN_PLAYERS = 3; // round 3 (Taboo) needs a speaker plus at least 2 guessers

// ---------- data loading ----------

// Image filenames follow a fixed convention (no per-noun lookup table):
// take the first name before "/", lowercase it, replace spaces with "-".
function imageSlug(english) {
  const first = english.split("/")[0].trim();
  return first
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-");
}

function slugifyLabel(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function parseNouns(text) {
  const lines = text.split(/\r?\n/);
  const lists = [];
  let current = null;
  let order = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const heading = line.match(/^##\s*(.+)$/);
    if (heading) {
      const label = heading[1].replace(/^List\s+\d+\s*[—-]\s*/i, "").trim();
      current = { id: slugifyLabel(label), label, nouns: [] };
      lists.push(current);
      continue;
    }

    if (!current || !line.startsWith("|")) continue;

    let cells = line.split("|").map((c) => c.trim());
    if (cells[0] === "") cells.shift();
    if (cells[cells.length - 1] === "") cells.pop();
    if (cells.length < 3) continue;
    if (cells[0].toLowerCase() === "english") continue; // header row
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue; // separator row

    const [english, chinese, pinyin] = cells;
    const slug = imageSlug(english);
    current.nouns.push({
      english,
      chinese,
      pinyin,
      listId: current.id,
      listLabel: current.label,
      image: `assets/images/${slug}.png`,
      order: order++,
    });
  }

  return lists;
}

async function loadNouns() {
  try {
    const res = await fetch("nouns.txt");
    if (!res.ok) throw new Error(`Could not load nouns.txt (${res.status})`);
    const text = await res.text();
    state.lists = parseNouns(text);
    state.screen = "setup";
  } catch (err) {
    state.loadError = err.message || String(err);
    state.screen = "load-error";
  }
  render();
}

// ---------- helpers ----------

function shuffled(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function allSelectedNouns() {
  return state.lists
    .filter((l) => state.selectedListIds.has(l.id))
    .flatMap((l) => l.nouns);
}

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// ---------- render dispatcher ----------

function render() {
  document.body.classList.toggle("bg-vivid", state.screen === "setup");
  app.innerHTML = "";
  if (state.screen === "loading") app.appendChild(renderLoading());
  else if (state.screen === "load-error") app.appendChild(renderLoadError());
  else if (state.screen === "setup") app.appendChild(renderSetup());
  else if (state.screen === "memorize") app.appendChild(renderMemorize());
  else if (state.screen === "countdown") app.appendChild(renderCountdown());
  else if (state.screen === "play") app.appendChild(renderPlay());
  else if (state.screen === "round1-tally") app.appendChild(renderRound1Tally());
  else if (state.screen === "memory") app.appendChild(renderMemory());
  else if (state.screen === "round2-tally") app.appendChild(renderRound2Tally());
  else if (state.screen === "taboo") app.appendChild(renderTaboo());
  else if (state.screen === "results") app.appendChild(renderResults());
}

function renderLoading() {
  return el(`<div class="screen"><h1 class="title">Loading nouns…</h1></div>`);
}

function renderLoadError() {
  return el(`
    <div class="screen">
      <h1 class="title">Chinese Nouns Game</h1>
      <div class="card-panel">
        <p><strong>Could not load nouns.txt.</strong></p>
        <p>${state.loadError}</p>
        <p class="answer-hint">This page needs to be served over http(s), not opened directly as a file.
        From this folder, run <code>npx serve .</code> (or <code>python -m http.server</code>) and open the printed link.</p>
      </div>
    </div>
  `);
}

// ---------- setup screen ----------

function renderSetup() {
  if (state.players.length === 0) {
    state.players = [{ name: "", score: 0 }, { name: "", score: 0 }, { name: "", score: 0 }];
  }

  const wrap = el(`<div class="screen"></div>`);
  wrap.appendChild(el(`
    <div class="home-banner">
      <h1 class="title">Chinese Nouns Game</h1>
      <span class="cn-seal">中文</span>
    </div>
  `));
  wrap.appendChild(el(`<p class="subtitle banner-subtitle">Study together, then play three rounds — guess the picture, match the pairs, then describe &amp; guess.</p>`));

  const woodPanel = el(`
    <div class="wood-panel">
      <div class="wood-corner tl"></div>
      <div class="wood-corner tr"></div>
      <div class="wood-corner bl"></div>
      <div class="wood-corner br"></div>
    </div>
  `);
  const panel = el(`<div class="card-panel setup-grid"></div>`);
  woodPanel.appendChild(panel);

  // players count
  const stepper = el(`
    <div>
      <span class="field-label">👥 How many players?</span>
      <div class="stepper">
        <button class="btn btn-step" id="dec-player" type="button">−</button>
        <span class="stepper-value">${state.players.length}</span>
        <button class="btn btn-step" id="inc-player" type="button">+</button>
      </div>
      <p class="answer-hint" style="margin-top:0.4rem">Round 3 (Taboo) needs at least ${MIN_PLAYERS} players.</p>
    </div>
  `);
  stepper.querySelector("#dec-player").onclick = () => {
    if (state.players.length > MIN_PLAYERS) {
      state.players.pop();
      render();
    }
  };
  stepper.querySelector("#inc-player").onclick = () => {
    if (state.players.length < 8) {
      state.players.push({ name: "", score: 0 });
      render();
    }
  };
  panel.appendChild(stepper);

  // player names
  const namesWrap = el(`<div><span class="field-label">🧑 Player names</span><div class="player-names"></div></div>`);
  const namesGrid = namesWrap.querySelector(".player-names");
  state.players.forEach((p, i) => {
    const input = el(`<input type="text" placeholder="Player ${i + 1}" value="${p.name.replace(/"/g, "&quot;")}">`);
    input.oninput = (e) => (state.players[i].name = e.target.value);
    namesGrid.appendChild(input);
  });
  panel.appendChild(namesWrap);

  // list selection
  const listsWrap = el(`<div><span class="field-label">📖 Which lists?</span><div class="list-options"></div></div>`);
  const listsGrid = listsWrap.querySelector(".list-options");
  state.lists.forEach((l) => {
    const opt = el(`
      <label class="list-option">
        <input type="checkbox" ${state.selectedListIds.has(l.id) ? "checked" : ""}>
        <span class="list-check">✓</span>
        <span class="list-icon">${listIcon(l.id)}</span>
        <span>${l.label}<br>(${l.nouns.length})</span>
      </label>
    `);
    opt.querySelector("input").onchange = (e) => {
      if (e.target.checked) state.selectedListIds.add(l.id);
      else state.selectedListIds.delete(l.id);
      render();
    };
    listsGrid.appendChild(opt);
  });
  panel.appendChild(listsWrap);

  // timers
  const timers = el(`
    <div class="timers-grid">
      <div class="timer-field">
        <label>🕐 Study time per page (seconds)</label>
        <div class="value" id="study-value">${state.studySeconds}s</div>
        <input type="range" min="10" max="90" step="5" value="${state.studySeconds}" id="study-range">
      </div>
      <div class="timer-field">
        <label>⚡ Answer time (seconds)</label>
        <div class="value" id="answer-value">${state.answerSeconds}s</div>
        <input type="range" min="3" max="15" step="1" value="${state.answerSeconds}" id="answer-range">
      </div>
      <div class="timer-field">
        <label>🗣️ Describe time (seconds)</label>
        <div class="value" id="describe-value">${state.describeSeconds}s</div>
        <input type="range" min="10" max="45" step="5" value="${state.describeSeconds}" id="describe-range">
      </div>
    </div>
  `);
  timers.querySelector("#study-range").oninput = (e) => {
    state.studySeconds = Number(e.target.value);
    timers.querySelector("#study-value").textContent = `${state.studySeconds}s`;
  };
  timers.querySelector("#answer-range").oninput = (e) => {
    state.answerSeconds = Number(e.target.value);
    timers.querySelector("#answer-value").textContent = `${state.answerSeconds}s`;
  };
  timers.querySelector("#describe-range").oninput = (e) => {
    state.describeSeconds = Number(e.target.value);
    timers.querySelector("#describe-value").textContent = `${state.describeSeconds}s`;
  };
  panel.appendChild(timers);

  const selectedCount = allSelectedNouns().length;
  const numPlayers = state.players.length;
  const totalTurns = Math.floor(selectedCount / numPlayers) * numPlayers;

  if (totalTurns === 0) {
    panel.appendChild(el(`<div class="setup-error">Pick at least ${numPlayers} noun(s) across your selected lists so every player gets a turn.</div>`));
  } else {
    panel.appendChild(el(`<p class="answer-hint">🎲 ${totalTurns} turns total — ${totalTurns / numPlayers} per player.</p>`));
  }

  const playBtn = el(`<button class="btn btn-primary btn-lg btn-block">▶ Play Game</button>`);
  playBtn.disabled = totalTurns === 0;
  playBtn.onclick = () => startGame();
  panel.appendChild(playBtn);

  wrap.appendChild(woodPanel);
  return wrap;
}

function startGame() {
  state.players.forEach((p, i) => {
    if (!p.name.trim()) p.name = `Player ${i + 1}`;
    p.score = 0;
  });
  state.memory = null;
  state.taboo = null;

  const selected = allSelectedNouns();
  const numPlayers = state.players.length;
  const totalTurns = Math.floor(selected.length / numPlayers) * numPlayers;
  const pool = shuffled(selected).slice(0, totalTurns);

  const studyOrder = pool.slice().sort((a, b) => a.order - b.order);
  const pages = chunk(studyOrder, 10);

  state.memorize = { pages, pageIndex: 0, timeLeft: state.studySeconds, timerId: null, pool };
  state.screen = "memorize";
  render();
  startMemorizeTimer();
}

// ---------- memorize screen ----------

function startMemorizeTimer() {
  const m = state.memorize;
  clearInterval(m.timerId);
  m.timerId = setInterval(() => {
    playTicker();
    m.timeLeft -= 1;
    if (m.timeLeft <= 0) {
      stopTicker();
      if (m.pageIndex < m.pages.length - 1) {
        m.pageIndex += 1;
        m.timeLeft = state.studySeconds;
        render();
      } else {
        clearInterval(m.timerId);
        beginCountdown(() => beginPlay(m.pool));
      }
    } else {
      render();
    }
  }, 1000);
}

const CARD_COLORS = ["c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9"];

const LIST_ICONS = {
  "tools": "🔧",
  "in-the-kitchen": "🍳",
  "furniture": "🪑",
  "bathroom": "🛁",
  "cleaning": "🧹",
};
function listIcon(id) {
  return LIST_ICONS[id] || "📚";
}

function renderMemorize() {
  const m = state.memorize;
  const page = m.pages[m.pageIndex];
  const pct = m.timeLeft / state.studySeconds;

  const wrap = el(`<div class="screen"></div>`);
  const header = el(`
    <div class="memorize-header">
      <span class="page-indicator">Page ${m.pageIndex + 1} of ${m.pages.length}</span>
      <div class="ring" style="--pct:${pct}"><span>${m.timeLeft}s</span></div>
    </div>
  `);
  wrap.appendChild(header);

  const grid = el(`<div class="noun-grid"></div>`);
  page.forEach((n, i) => {
    const card = el(`
      <div class="noun-card" style="background:var(--${CARD_COLORS[i % CARD_COLORS.length]})">
        <div class="noun-img"><img src="${n.image}" alt="" draggable="false"></div>
        <div class="noun-text">
          <div class="cn">${n.chinese}</div>
          <div class="py">${n.pinyin}</div>
          <div class="en">${n.english}</div>
        </div>
      </div>
    `);
    const img = card.querySelector("img");
    img.onerror = () => (img.closest(".noun-img").style.display = "none");
    grid.appendChild(card);
  });
  wrap.appendChild(grid);

  const skip = el(`<button class="btn btn-ghost">Skip to play →</button>`);
  skip.onclick = () => {
    clearInterval(m.timerId);
    stopTicker();
    beginCountdown(() => beginPlay(m.pool));
  };
  wrap.appendChild(skip);

  wrap.appendChild(renderExitButton());
  return wrap;
}

// ---------- countdown screen ----------

const COUNTDOWN_START = 3;

function beginCountdown(onDone) {
  state.screen = "countdown";
  state.countdown = { label: String(COUNTDOWN_START) };
  render();
  playCountdownSound();
  runCountdownStep(COUNTDOWN_START, onDone);
}

function runCountdownStep(n, onDone) {
  setTimeout(() => {
    if (n > 1) {
      state.countdown.label = String(n - 1);
      render();
      runCountdownStep(n - 1, onDone);
    } else {
      state.countdown.label = "Let's Start!";
      render();
      setTimeout(() => {
        stopCountdownSound();
        onDone();
      }, 700);
    }
  }, 1000);
}

function renderCountdown() {
  const wrap = el(`
    <div class="screen countdown-screen">
      <div class="countdown-number">${state.countdown.label}</div>
    </div>
  `);
  wrap.appendChild(renderExitButton());
  return wrap;
}

// ---------- play screen ----------

function beginPlay(pool) {
  state.play = {
    pool: shuffled(pool),
    turnIndex: 0,
    phase: "question", // "question" | "revealed"
    timeLeft: state.answerSeconds,
    timerId: null,
  };
  state.screen = "play";
  render();
  startPlayTimer();
  document.addEventListener("keydown", handlePlayKeydown);
}

function startPlayTimer() {
  const p = state.play;
  clearInterval(p.timerId);
  p.timerId = setInterval(() => {
    playTicker();
    p.timeLeft -= 1;
    if (p.timeLeft <= 0) {
      clearInterval(p.timerId);
      stopTicker();
      p.phase = "revealed";
    }
    render();
  }, 1000);
}

function handlePlayKeydown(e) {
  if (state.screen !== "play") return;
  if (e.key === "ArrowRight") judge(true);
  else if (e.key === "ArrowLeft") judge(false);
}

function judge(correct) {
  stopTicker();
  playSound(correct ? "correct" : "wrong");

  const p = state.play;
  const currentPlayer = state.players[p.turnIndex % state.players.length];
  if (correct) currentPlayer.score += 1;

  clearInterval(p.timerId);
  p.turnIndex += 1;

  if (p.turnIndex >= p.pool.length) {
    document.removeEventListener("keydown", handlePlayKeydown);
    state.screen = "round1-tally";
    render();
    return;
  }

  p.phase = "question";
  p.timeLeft = state.answerSeconds;
  render();
  startPlayTimer();
}

function renderPlay() {
  const p = state.play;
  const noun = p.pool[p.turnIndex];
  const currentPlayerIndex = p.turnIndex % state.players.length;
  const currentPlayer = state.players[currentPlayerIndex];
  const flipped = p.phase === "revealed";
  const pct = p.timeLeft / state.answerSeconds;

  const wrap = el(`<div class="screen"></div>`);
  wrap.appendChild(el(`<span class="round-badge">Round 1 · Guess the Picture</span>`));
  wrap.appendChild(el(`
    <div class="play-header">
      <span class="turn-label">${currentPlayer.name}'s turn — Turn ${p.turnIndex + 1}/${p.pool.length}</span>
      <div class="ring" style="--pct:${Math.max(pct, 0)}"><span>${Math.max(p.timeLeft, 0)}s</span></div>
    </div>
  `));

  const scene = el(`
    <div class="flip-scene">
      <div class="flip-card ${flipped ? "flipped" : ""}">
        <div class="flip-face flip-front">
          <img src="${noun.image}" alt="" draggable="false">
        </div>
        <div class="flip-face flip-back">
          <div class="cn">${noun.chinese}</div>
          <div class="py">${noun.pinyin}</div>
          <div class="en">${noun.english}</div>
        </div>
      </div>
    </div>
  `);
  const img = scene.querySelector("img");
  img.onerror = () => {
    const front = scene.querySelector(".flip-front");
    front.innerHTML = `<div class="placeholder">${noun.chinese}<br>${noun.pinyin}</div>`;
  };
  wrap.appendChild(scene);

  wrap.appendChild(el(`<p class="answer-hint">Say the Chinese name out loud — the judge scores it below.</p>`));

  const buttons = el(`
    <div class="judge-buttons">
      <button class="btn btn-success btn-lg" id="btn-correct" data-silent="true">✅ Correct</button>
      <button class="btn btn-error btn-lg" id="btn-wrong" data-silent="true">❌ Wrong</button>
    </div>
  `);
  buttons.querySelector("#btn-correct").onclick = () => judge(true);
  buttons.querySelector("#btn-wrong").onclick = () => judge(false);
  wrap.appendChild(buttons);

  const scores = el(`<div class="score-row"></div>`);
  state.players.forEach((pl, i) => {
    scores.appendChild(el(`<span class="score-chip ${i === currentPlayerIndex ? "active" : ""}">${pl.name} ${pl.score}</span>`));
  });
  wrap.appendChild(scores);

  wrap.appendChild(renderExitButton());
  return wrap;
}

// ---------- exit mid-game ----------

function renderExitButton() {
  const btn = el(`<button class="btn btn-ghost exit-btn">✕ Exit</button>`);
  btn.onclick = () => {
    if (!confirm("Exit the game? Current scores will be lost.")) return;
    exitToSetup();
  };
  return btn;
}

function exitToSetup() {
  if (state.memorize) clearInterval(state.memorize.timerId);
  if (state.play) clearInterval(state.play.timerId);
  if (state.taboo) clearInterval(state.taboo.timerId);
  stopTicker();
  stopCountdownSound();
  document.removeEventListener("keydown", handlePlayKeydown);
  state.memory = null;
  state.taboo = null;
  state.players = [];
  state.screen = "setup";
  render();
}

// ---------- shared scoreboard ----------

function computeLeaders() {
  const maxScore = Math.max(...state.players.map((p) => p.score));
  const leaders = state.players.filter((p) => p.score === maxScore);
  return { maxScore, leaders };
}

function renderLeaderboard() {
  const { maxScore } = computeLeaders();
  const ranked = state.players.slice().sort((a, b) => b.score - a.score);

  const board = el(`<div class="leaderboard"></div>`);
  ranked.forEach((p) => {
    const width = maxScore > 0 ? Math.round((p.score / maxScore) * 100) : 0;
    const isTop = maxScore > 0 && p.score === maxScore;
    board.appendChild(el(`
      <div class="leader-row ${isTop ? "leader-row-top" : ""}">
        <span class="leader-name">${p.name}</span>
        <div class="leader-bar-track"><div class="leader-bar-fill" style="width:${width}%"></div></div>
        <span class="leader-score">${p.score}</span>
      </div>
    `));
  });
  return board;
}

// ---------- round 1 tally ----------

function renderRound1Tally() {
  const { maxScore, leaders } = computeLeaders();

  const wrap = el(`<div class="screen"></div>`);
  wrap.appendChild(el(`<span class="round-badge">Round 1 complete</span>`));
  wrap.appendChild(el(`<div class="trophy">📊</div>`));

  const line =
    maxScore === 0
      ? "No points yet — it's all to play for in round 2!"
      : leaders.length === 1
        ? `${leaders[0].name} is leading with ${maxScore} point${maxScore === 1 ? "" : "s"}!`
        : `${leaders.map((l) => l.name).join(" and ")} are tied for the lead at ${maxScore} points!`;
  wrap.appendChild(el(`<div class="winner-line">${line}</div>`));

  wrap.appendChild(renderLeaderboard());

  const cta = el(`<button class="btn btn-primary btn-lg">Continue to Round 2 →</button>`);
  cta.onclick = () => beginCountdown(() => beginMemoryGame());
  wrap.appendChild(cta);

  wrap.appendChild(renderExitButton());
  return wrap;
}

// ---------- round 2: memory match ----------

const MAX_MEMORY_PAIRS = 20;

function beginMemoryGame() {
  const selected = allSelectedNouns();
  const nouns = shuffled(selected).slice(0, Math.min(MAX_MEMORY_PAIRS, selected.length));
  state.memory = {
    cards: buildMemoryCards(nouns),
    firstIndex: null,
    secondIndex: null,
    busy: false,
    turnIndex: 0,
    matchesFound: 0,
    totalPairs: nouns.length,
  };
  state.screen = "memory";
  render();
}

// Picks a landscape-ish rows/cols split for n cards (n is always even: 2 per pair).
// e.g. 20 -> 5x4, 40 -> 8x5, matching how a physical card layout would be dealt.
function gridDims(n) {
  let best = null;
  for (let rows = 1; rows <= n; rows++) {
    if (n % rows !== 0) continue;
    const cols = n / rows;
    if (cols < rows) continue;
    const score = Math.abs(cols / rows - 1.4);
    if (!best || score < best.score) best = { cols, rows, score };
  }
  if (best) return { cols: best.cols, rows: best.rows };
  const cols = Math.ceil(Math.sqrt(n * 1.4));
  return { cols, rows: Math.ceil(n / cols) };
}

function buildMemoryCards(nouns) {
  const cards = [];
  nouns.forEach((noun, pairId) => {
    const useImage = Math.random() < 0.5;
    cards.push({ pairId, kind: "chinese", noun });
    cards.push({ pairId, kind: useImage ? "image" : "english", noun });
  });
  return shuffled(cards).map((c) => ({ ...c, revealed: false, matched: false }));
}

function handleCardClick(idx) {
  const g = state.memory;
  if (!g || g.busy) return;
  const card = g.cards[idx];
  if (!card || card.matched || card.revealed) return;

  card.revealed = true;
  playSound("button");

  if (g.firstIndex === null) {
    g.firstIndex = idx;
    render();
    return;
  }

  g.secondIndex = idx;
  g.busy = true;
  render();

  const first = g.cards[g.firstIndex];
  const second = g.cards[g.secondIndex];
  const isMatch = first.pairId === second.pairId;

  setTimeout(() => {
    if (state.screen !== "memory") return;
    if (isMatch) {
      first.matched = true;
      second.matched = true;
      playSound("correct");
      state.players[g.turnIndex % state.players.length].score += 1;
      g.matchesFound += 1;
      g.firstIndex = null;
      g.secondIndex = null;
      g.busy = false;
      render();
      if (g.matchesFound === g.totalPairs) finishMemoryGame();
    } else {
      playSound("wrong");
      setTimeout(() => {
        if (state.screen !== "memory") return;
        first.revealed = false;
        second.revealed = false;
        g.firstIndex = null;
        g.secondIndex = null;
        g.busy = false;
        g.turnIndex += 1;
        render();
      }, 900);
    }
  }, 700);
}

function finishMemoryGame() {
  state.screen = "round2-tally";
  render();
}

function renderMemory() {
  const g = state.memory;
  const currentPlayerIndex = g.turnIndex % state.players.length;
  const currentPlayer = state.players[currentPlayerIndex];

  const wrap = el(`<div class="screen screen-wide"></div>`);
  wrap.appendChild(el(`<span class="round-badge">Round 2 · Memory Match</span>`));
  wrap.appendChild(el(`
    <div class="play-header">
      <span class="turn-label">${currentPlayer.name}'s turn</span>
      <div class="pairs-badge">${g.matchesFound}/${g.totalPairs} pairs</div>
    </div>
  `));

  const { cols, rows } = gridDims(g.cards.length);
  const grid = el(`<div class="memory-grid" style="grid-template-columns:repeat(${cols},1fr);grid-template-rows:repeat(${rows},1fr)"></div>`);
  g.cards.forEach((card, idx) => {
    const shown = card.revealed || card.matched;
    const cardEl = el(`
      <div class="mem-card ${shown ? "flipped" : ""} ${card.matched ? "matched" : ""}">
        <div class="mem-inner">
          <div class="mem-face mem-back">?</div>
          <div class="mem-face mem-front"></div>
        </div>
      </div>
    `);
    const front = cardEl.querySelector(".mem-front");
    if (card.kind === "chinese") {
      front.innerHTML = `<div class="mem-cn">${card.noun.chinese}</div>`;
    } else if (card.kind === "english") {
      front.innerHTML = `<div class="mem-en">${card.noun.english}</div>`;
    } else {
      front.innerHTML = `<img src="${card.noun.image}" alt="" draggable="false">`;
      front.querySelector("img").onerror = () => {
        front.innerHTML = `<div class="mem-en">${card.noun.english}</div>`;
      };
    }
    if (!card.matched) cardEl.onclick = () => handleCardClick(idx);
    grid.appendChild(cardEl);
  });
  wrap.appendChild(grid);

  wrap.appendChild(renderExitButton());
  return wrap;
}

// ---------- round 2 tally ----------

function renderRound2Tally() {
  const { maxScore, leaders } = computeLeaders();

  const wrap = el(`<div class="screen"></div>`);
  wrap.appendChild(el(`<span class="round-badge">Round 2 complete</span>`));
  wrap.appendChild(el(`<div class="trophy">📊</div>`));

  const line =
    maxScore === 0
      ? "No points yet — it's all to play for in round 3!"
      : leaders.length === 1
        ? `${leaders[0].name} is leading with ${maxScore} point${maxScore === 1 ? "" : "s"}!`
        : `${leaders.map((l) => l.name).join(" and ")} are tied for the lead at ${maxScore} points!`;
  wrap.appendChild(el(`<div class="winner-line">${line}</div>`));

  wrap.appendChild(renderLeaderboard());

  const cta = el(`<button class="btn btn-primary btn-lg">Continue to Round 3 →</button>`);
  cta.onclick = () => beginCountdown(() => beginTabooGame());
  wrap.appendChild(cta);

  wrap.appendChild(renderExitButton());
  return wrap;
}

// ---------- round 3: taboo ----------

function beginTabooGame() {
  const selected = allSelectedNouns();
  const numPlayers = state.players.length;
  const totalTurns = Math.floor(selected.length / numPlayers) * numPlayers;
  const pool = shuffled(selected).slice(0, totalTurns);

  state.taboo = {
    pool,
    turnIndex: 0,
    phase: "reveal", // "reveal" | "describing"
    timeUp: false,
    timeLeft: state.describeSeconds,
    timerId: null,
  };
  state.screen = "taboo";
  render();
}

function startDescribing() {
  const t = state.taboo;
  t.phase = "describing";
  t.timeUp = false;
  t.timeLeft = state.describeSeconds;
  render();

  clearInterval(t.timerId);
  t.timerId = setInterval(() => {
    playTicker();
    t.timeLeft -= 1;
    if (t.timeLeft <= 0) {
      clearInterval(t.timerId);
      stopTicker();
      t.timeUp = true;
    }
    render();
  }, 1000);
}

// guesserIndex is a player index, or null when nobody guessed correctly.
function awardTabooPoint(guesserIndex) {
  const t = state.taboo;
  clearInterval(t.timerId);
  stopTicker();

  const speakerIndex = t.turnIndex % state.players.length;
  if (guesserIndex !== null) {
    state.players[speakerIndex].score += 1;
    state.players[guesserIndex].score += 1;
    playSound("correct");
  } else {
    playSound("wrong");
  }

  t.turnIndex += 1;
  if (t.turnIndex >= t.pool.length) {
    finishTabooGame();
    return;
  }

  t.phase = "reveal";
  t.timeUp = false;
  t.timeLeft = state.describeSeconds;
  render();
}

function finishTabooGame() {
  state.screen = "results";
  playSound("goodResult");
  render();
}

function renderTaboo() {
  const t = state.taboo;
  const noun = t.pool[t.turnIndex];
  const speakerIndex = t.turnIndex % state.players.length;
  const speaker = state.players[speakerIndex];
  const pct = t.timeLeft / state.describeSeconds;

  const wrap = el(`<div class="screen"></div>`);
  wrap.appendChild(el(`<span class="round-badge">Round 3 · Taboo</span>`));

  if (t.phase === "reveal") {
    wrap.appendChild(el(`
      <div class="play-header">
        <span class="turn-label">Pass to ${speaker.name}!</span>
      </div>
    `));

    const card = el(`
      <div class="taboo-reveal">
        <p class="taboo-warning">🙈 Everyone else, look away — only ${speaker.name} should see this!</p>
        <div class="taboo-word-img"><img src="${noun.image}" alt="" draggable="false"></div>
        <div class="cn">${noun.chinese}</div>
        <div class="py">${noun.pinyin}</div>
        <div class="en">${noun.english}</div>
      </div>
    `);
    const img = card.querySelector("img");
    img.onerror = () => (img.closest(".taboo-word-img").style.display = "none");
    wrap.appendChild(card);

    wrap.appendChild(el(`<p class="answer-hint">Describe it in Chinese without saying the word itself. Everyone else: guess out loud!</p>`));

    const startBtn = el(`<button class="btn btn-primary btn-lg">Got it — hide &amp; start ${state.describeSeconds}s ▶</button>`);
    startBtn.onclick = () => startDescribing();
    wrap.appendChild(startBtn);
  } else {
    wrap.appendChild(el(`
      <div class="play-header">
        <span class="turn-label">${speaker.name} is describing…</span>
        <div class="ring" style="--pct:${Math.max(pct, 0)}"><span>${Math.max(t.timeLeft, 0)}s</span></div>
      </div>
    `));

    const scene = el(`
      <div class="flip-scene">
        <div class="flip-card ${t.timeUp ? "flipped" : ""}">
          <div class="flip-face flip-front taboo-speaking-face">🗣️</div>
          <div class="flip-face flip-back">
            <div class="cn">${noun.chinese}</div>
            <div class="py">${noun.pinyin}</div>
            <div class="en">${noun.english}</div>
          </div>
        </div>
      </div>
    `);
    wrap.appendChild(scene);

    wrap.appendChild(el(`<p class="answer-hint">Who guessed it? The judge picks the winner below.</p>`));

    const guessButtons = el(`<div class="guess-buttons"></div>`);
    state.players.forEach((p, i) => {
      if (i === speakerIndex) return;
      const btn = el(`<button class="btn btn-success" data-silent="true">✅ ${p.name} guessed it!</button>`);
      btn.onclick = () => awardTabooPoint(i);
      guessButtons.appendChild(btn);
    });
    wrap.appendChild(guessButtons);

    const noGuess = el(`<button class="btn btn-error btn-block" data-silent="true">❌ No one guessed</button>`);
    noGuess.onclick = () => awardTabooPoint(null);
    wrap.appendChild(noGuess);
  }

  const scores = el(`<div class="score-row"></div>`);
  state.players.forEach((pl, i) => {
    scores.appendChild(el(`<span class="score-chip ${i === speakerIndex ? "active" : ""}">${pl.name} ${pl.score}</span>`));
  });
  wrap.appendChild(scores);

  wrap.appendChild(renderExitButton());
  return wrap;
}

// ---------- results screen ----------

function renderResults() {
  const { maxScore, leaders: winners } = computeLeaders();

  const wrap = el(`<div class="screen"></div>`);
  wrap.appendChild(el(`<span class="round-badge">Final Results</span>`));
  wrap.appendChild(el(`<div class="trophy">🏆</div>`));

  const line =
    winners.length === 1
      ? `${winners[0].name} wins with ${maxScore} point${maxScore === 1 ? "" : "s"}!`
      : `${winners.map((w) => w.name).join(" and ")} tie at ${maxScore} points!`;
  wrap.appendChild(el(`<div class="winner-line">${line}</div>`));

  wrap.appendChild(renderLeaderboard());

  const actions = el(`
    <div class="results-actions">
      <button class="btn btn-primary btn-lg" id="btn-again">Play Again</button>
      <button class="btn btn-ghost btn-lg" id="btn-new">New Players</button>
    </div>
  `);
  actions.querySelector("#btn-again").onclick = () => startGame();
  actions.querySelector("#btn-new").onclick = () => {
    state.memory = null;
    state.taboo = null;
    state.players = [];
    state.screen = "setup";
    render();
  };
  wrap.appendChild(actions);

  return wrap;
}

// ---------- boot ----------

loadNouns();

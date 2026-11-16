const app = document.getElementById("app");
const socket = io({ autoConnect: false });
const sessionKey = "chinese-nouns-room";
const incomingCode = new URLSearchParams(location.search).get("room")?.toUpperCase() ?? "";
const entry = { name: "", code: incomingCode };
const colors = ["c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9"];
const listIcons = {
  tools: "🛠️",
  "in-the-kitchen": "🍳",
  furniture: "🪑",
  bathroom: "🛁",
  cleaning: "🧹",
  "hawker-market": "🍜",
  "at-the-bus-stop": "🚌",
  "on-the-mrt": "🚇",
  "the-park": "🌳",
  playground: "🛝",
  "void-deck-hdb": "🏢",
  "on-the-road": "🚦",
  "the-neighbourhood": "🏘️",
  "beach-seaside": "🏖️",
  "construction-site": "🚧",
  stationery: "📎",
  "home-appliances": "🧺",
  "personal-items": "👓",
  "outdoors-bikes": "🚲",
  "around-the-house": "🔑",
};
const roundNames = { picture: "Guess the Picture", memory: "Memory Match", taboo: "Taboo" };
const soundFiles = {
  correct: "correct", wrong: "wrong-answer", countdown: "countdown", results: "good-result", button: "button",
};

let session = loadSession();
let mode = incomingCode ? "join" : "home";
let room;
let settings;
let lists = [];
let listsFailed = false;
let pending = false;
let message = "";
let localDeadline = 0;

function loadSession() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(sessionKey));
    if (saved?.code && saved.token && (!incomingCode || incomingCode === saved.code)) return saved;
  } catch {
    // A browser may disable storage.
  }
  return null;
}

function saveSession(value) {
  session = value;
  try {
    if (value) sessionStorage.setItem(sessionKey, JSON.stringify(value));
    else sessionStorage.removeItem(sessionKey);
  } catch {
    // Keep the seat in memory for the lifetime of this page.
  }
}

function updateRoomUrl(code) {
  const url = new URL(location.href);
  if (code) url.searchParams.set("room", code);
  else url.searchParams.delete("room");
  history.replaceState(null, "", url);
}

function escapeHtml(value) {
  const escapes = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(value).replace(/[&<>"']/g, (symbol) => escapes[symbol]);
}

function isHost() {
  return room.selfId === room.hostId;
}

function isMyTurn() {
  return room.selfId === room.activeId;
}

function playSound(name) {
  if (soundFiles[name]) new Audio(`assets/sounds/${soundFiles[name]}.mp3`).play().catch(() => {});
}

function request(event, data, done) {
  if (pending || !socket.connected) return;
  pending = true;
  message = "";
  updateStatus();
  socket.timeout(8000).emit(event, data, (error, response) => {
    pending = false;
    if (error || !response?.ok) message = response?.message ?? "The server did not respond. Try again.";
    done?.(response);
    updateStatus();
  });
}

function enter(type) {
  request("enter-room", { ...entry, type, ...(type === "resume" ? session : {}) }, (response) => {
    if (response?.ok) {
      saveSession({ code: response.code, token: response.token });
      updateRoomUrl(response.code);
    } else if (type === "resume" && response) {
      resetRoom(message);
    }
  });
}

function action(type, details) {
  request("game-action", { type, revision: room.revision, ...details });
}

function resetRoom(reason = "") {
  saveSession(null);
  updateRoomUrl(null);
  room = settings = null;
  entry.code = "";
  mode = "home";
  message = reason;
  render();
}

socket.on("connect", () => {
  message = "";
  if (session) enter("resume");
  updateStatus();
});
socket.on("disconnect", () => updateStatus());
socket.on("room-closed", resetRoom);
socket.on("room-state", (state) => {
  const previous = room;
  room = state;
  localDeadline = room.deadline ? performance.now() + room.deadline - room.serverTime : 0;
  if (room.phase === "lobby" && !settings) settings = structuredClone(room.settings);
  if (room.phase !== "lobby") settings = null;
  if (previous && previous.revision !== room.revision) playSound(room.feedback);
  if (previous && previous.phase !== room.phase) {
    if (room.phase === "countdown") playSound("countdown");
    if (room.phase === "results") playSound("results");
  }
  render();
});

async function loadLists() {
  listsFailed = false;
  try {
    const response = await fetch("/api/lists");
    if (!response.ok) throw new Error("Could not load word lists");
    lists = await response.json();
  } catch {
    listsFailed = true;
  }
  if (room?.phase === "lobby" && isHost()) render();
}

function heading() {
  return `<header class="home-banner"><h1 class="title">Chinese Nouns Game</h1><span class="cn-seal" lang="zh">中文</span></header>`;
}

function woodPanel(content) {
  return `<div class="wood-panel">
    <div class="wood-corner tl"></div><div class="wood-corner tr"></div>
    <div class="wood-corner bl"></div><div class="wood-corner br"></div>
    <div class="card-panel setup-grid">${content}</div>
  </div>`;
}

function button(label, type, style = "primary", attributes = "") {
  return `<button type="button" class="btn btn-${style}" data-action="${type}" ${attributes}>${label}</button>`;
}

function renderEntry() {
  if (session) {
    return `${heading()}<div class="card-panel entry-panel">
      <h2>Rejoining room ${escapeHtml(session.code)}…</h2>
      ${button("Back to home", "reset", "ghost")}
    </div>`;
  }

  if (mode === "home") {
    return `${heading()}${woodPanel(`
      <div class="room-intro">
        <h2>Play Mandarin together</h2>
        <p>Study everyday words and play three rounds with 3–8 people. Everyone uses their own device.</p>
      </div>
      <div class="room-actions">${button("Host a game", "show-create")}${button("Join a game", "show-join", "ghost")}</div>
    `)}`;
  }

  const joining = mode === "join";
  return `${heading()}${woodPanel(`
    <h2>${joining ? "Join a game" : "Host a game"}</h2>
    <form id="entry-form" class="entry-form">
      <label for="player-name">Your name</label>
      <input id="player-name" name="name" required maxlength="24" autocomplete="nickname" value="${escapeHtml(entry.name)}">
      ${joining ? `<label for="room-code">Room code</label>
        <input id="room-code" name="code" required minlength="6" maxlength="6" pattern="[A-Za-z2-9]{6}"
          autocapitalize="characters" spellcheck="false" autocomplete="off" value="${escapeHtml(entry.code)}">` : ""}
      <button class="btn btn-primary" data-network type="submit">${joining ? "Join room" : "Create room"}</button>
      ${button("Back", "home", "ghost")}
    </form>
  `)}`;
}

function inviteUrl() {
  const url = new URL("/", location.origin);
  url.searchParams.set("room", room.code);
  return url.href;
}

function playerList() {
  return `<ul class="player-list">${room.players.map((player) => `
    <li><span><strong>${escapeHtml(player.name)}</strong>
      ${player.id === room.hostId ? '<small class="player-role">Host</small>' : ""}
      ${player.id === room.selfId ? '<small class="player-role">You</small>' : ""}
    </span>
    ${player.online ? "" : `<small>Disconnected</small>
      ${isHost() ? button("Remove", "remove-player", "ghost", `data-player="${player.id}" data-network`) : ""}`}
    </li>`).join("")}</ul>`;
}

function settingsPanel() {
  if (listsFailed) return `<div class="card-panel setup-grid"><p>Couldn’t load the word lists.</p>${button("Try again", "retry-lists")}</div>`;
  if (!lists.length) return '<div class="card-panel"><p>Loading word lists…</p></div>';

  const timers = [
    ["studySeconds", "Study time per page", 10, 90, 5],
    ["answerSeconds", "Picture answer time", 3, 15, 1],
    ["describeSeconds", "Taboo speaking time", 10, 45, 5],
  ];

  return `<section class="card-panel setup-grid">
    <h2>Game settings</h2>
    <fieldset class="word-lists"><legend class="field-label">Word lists</legend>
      <div class="list-options">${lists.map(({ id, count, label }) => `
        <label class="list-option">
          <input type="checkbox" value="${id}" ${settings.listIds.includes(id) ? "checked" : ""}>
          <span class="list-icon" aria-hidden="true">${listIcons[id] ?? "📖"}</span>
          <span>${escapeHtml(label)}<br><small>${count} words</small></span>
        </label>`).join("")}</div>
    </fieldset>
    <div class="timers-grid">${timers.map(([id, label, min, max, step]) => `
      <div class="timer-field">
        <label for="${id}">${label}</label>
        <output class="value" for="${id}">${settings[id]}s</output>
        <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${settings[id]}">
      </div>`).join("")}
    </div>
    <p id="start-hint" class="answer-hint"></p>
    ${button("Start game", "start", "primary", "data-network")}
  </section>`;
}

function renderLobby() {
  return `${heading()}
    <div class="lobby-grid ${isHost() ? "host-lobby" : ""}">
      ${isHost() ? `<section class="card-panel invite-panel">
        <h2>Invite players</h2>
        <div class="room-code" aria-label="Room code ${room.code.split("").join(" ")}">${room.code}</div>
        <img class="invite-qr" src="/api/rooms/${room.code}/qr" alt="Scan to join room ${room.code}" width="160" height="160">
        <p>Scan the QR code or enter the code on the game’s home page.</p>
        ${button("Copy invite link", "copy", "ghost")}
        <input class="invite-link" aria-label="Invite link" value="${escapeHtml(inviteUrl())}" readonly hidden>
      </section>` : ""}
      <section class="card-panel roster-panel">
        <h2>Room ${room.code}</h2>
        <p class="field-label">Players (${room.players.length}/8)</p>
        ${playerList()}
        ${isHost() ? "" : "<p>Waiting for the host to start.</p>"}
      </section>
      ${isHost() ? settingsPanel() : ""}
    </div>
    <p class="voice-note">Speak aloud during the game. If you’re playing remotely, join a voice call together.</p>`;
}

function timer() {
  return room.deadline ? '<div class="ring" aria-label="Time remaining"><span data-time></span></div>' : "";
}

function nounText(noun) {
  return `<div class="cn" lang="zh">${escapeHtml(noun.chinese)}</div>
    <div class="py">${escapeHtml(noun.pinyin)}</div><div class="en">${escapeHtml(noun.english)}</div>`;
}

function renderStudy() {
  return `<div class="memorize-header"><h2>Study the words</h2>
    <span class="page-indicator">Page ${room.page} of ${room.pages}</span>${timer()}</div>
    <div class="noun-grid">${room.nouns.map((noun, index) => `
      <article class="noun-card" style="background:var(--${colors[index]})">
        <div class="noun-img"><img src="${escapeHtml(noun.image)}" alt=""></div>
        <div class="noun-text">${nounText(noun)}</div>
      </article>`).join("")}</div>
    ${isHost() ? button("Skip to round 1", "skip-study", "ghost", "data-network") : ""}`;
}

function scores() {
  return `<div class="score-row" aria-label="Scores">${room.players.map((p) => `
    <span class="score-chip ${p.id === room.activeId ? "active" : ""}">${escapeHtml(p.name)} ${p.score}</span>
  `).join("")}</div>`;
}

function roundHeader(round, label, details = "") {
  return `<h2 class="round-badge">${round}</h2>
    <div class="play-header"><span class="turn-label">${label}</span>${timer()}${details}</div>`;
}

function wordCard(noun, includeImage = false) {
  return `<div class="prompt-card prompt-answer">
    ${includeImage ? `<img src="${escapeHtml(noun.image)}" alt="">` : ""}
    ${nounText(noun)}
  </div>`;
}

function renderPicture(active) {
  const revealed = room.phase === "picture-answer";
  return `${roundHeader("Round 1 · Guess the Picture", isMyTurn() ? "Your turn" : `${active}’s turn`)}
    <span class="page-indicator">Turn ${room.turn} of ${room.turns}</span>
    ${revealed ? wordCard(room.prompt) : `<div class="prompt-card"><img src="${escapeHtml(room.prompt.image)}" alt="Object to guess"></div>`}
    <p class="answer-hint">${revealed ? "Time’s up." : isMyTurn() ? "Say the Mandarin name out loud." : `Listen to ${active}’s answer.`}
      ${isHost() ? "Mark the spoken answer below." : ""}</p>
    ${isHost() ? `<div class="judge-buttons">
      ${button("Correct", "picture-correct", "success", "data-network")}
      ${button("Incorrect", "picture-wrong", "error", "data-network")}
    </div>` : ""}
    ${scores()}`;
}

function renderMemory(active) {
  const canFlip = isMyTurn() && room.phase === "memory";
  const current = room.players.find((p) => p.id === room.activeId);
  const columns = room.cards.length <= 20 ? 5 : 8;
  return `${roundHeader("Round 2 · Memory Match", isMyTurn() ? "Your turn" : `${active}’s turn`,
    `<span class="pairs-badge">${room.matches}/${room.cards.length / 2} pairs</span>`)}
    <div class="online-memory" style="--columns:${columns}">${room.cards.map(({ face, value, matched }, index) => {
      const hidden = face === "hidden";
      const content = hidden ? "?" : face === "image"
        ? `<img src="${escapeHtml(value)}" alt="${escapeHtml(value.split("/").pop().replace(/\.(png|webp)$/, "").replaceAll("-", " "))}">`
        : `<span class="memory-${face}" ${face === "chinese" ? 'lang="zh"' : ""}>${escapeHtml(value)}</span>`;
      return `<button type="button" class="online-card ${hidden ? "face-down" : ""} ${matched ? "is-matched" : ""}"
        data-action="flip" data-index="${index}" data-network ${!hidden || !canFlip ? "data-locked" : ""}
        ${hidden ? `aria-label="Card ${index + 1}, face down"` : ""}>${content}</button>`;
    }).join("")}</div>
    <p class="answer-hint">${current.online ? "Pair a Chinese word with its picture or English meaning." : `${active} is disconnected.`}</p>
    ${isHost() && !current.online && room.phase === "memory" ? button("Pass turn", "pass-memory", "ghost", "data-network") : ""}
    ${scores()}`;
}

function renderTaboo(active) {
  const mine = isMyTurn();
  const speaker = room.players.find((p) => p.id === room.activeId);
  const speaking = room.phase === "taboo-speak" || room.phase === "taboo-answer";
  const help = {
    "taboo-ready": mine ? "Open your secret word when you’re ready." : `Waiting for ${active} to get ready.`,
    "taboo-secret": mine ? "Describe this in Mandarin without saying the word itself." : `${active} is reading the secret word.`,
    "taboo-speak": mine ? "Describe the word in Mandarin." : "Guess the Mandarin word out loud.",
    "taboo-answer": "Time’s up. The host records who guessed it.",
  };
  return `${roundHeader("Round 3 · Taboo", mine ? "You’re the speaker" : `${active} is the speaker`)}
    <span class="page-indicator">Turn ${room.turn} of ${room.turns}</span>
    ${room.prompt ? wordCard(room.prompt, room.phase === "taboo-secret") : ""}
    <p class="answer-hint">${help[room.phase]}</p>
    ${room.phase === "taboo-ready" && mine ? button("Reveal my word", "reveal-taboo", "primary", "data-network") : ""}
    ${room.phase === "taboo-secret" && mine ? button("Hide word and start timer", "start-taboo", "primary", "data-network") : ""}
    ${isHost() && (speaking || !speaker.online) ? `<div class="guess-buttons">
      ${speaking ? room.players.filter((p) => p.id !== room.activeId).map((p) =>
        button(`${escapeHtml(p.name)} guessed it`, "award-taboo", "success", `data-player="${p.id}" data-network`)).join("") : ""}
      ${button(speaking ? "No one guessed" : "Pass turn", "pass-taboo", "error", "data-network")}
    </div>` : ""}
    ${scores()}`;
}

function renderTally() {
  const ranked = room.players.slice().sort((a, b) => b.score - a.score);
  const best = ranked[0].score;
  const leaders = ranked.filter((p) => p.score === best).map((p) => p.name);
  const final = room.phase === "results";
  const round = room.phase === "picture-tally" ? 1 : 2;
  const result = final ? "finished first" : leaders.length === 1 ? "leads" : "share the lead";
  return `<h2 class="round-badge">${final ? "Final results" : `Round ${round} complete`}</h2>
    <div class="trophy" aria-hidden="true">${final ? "🏆" : "📊"}</div>
    <p class="winner-line">${escapeHtml(leaders.join(" and "))} ${result} with ${best} ${best === 1 ? "point" : "points"}.</p>
    <ol class="leaderboard">${ranked.map((p) => `
      <li class="leader-row ${p.score === best ? "leader-row-top" : ""}">
        <span class="leader-name">${escapeHtml(p.name)}</span>
        <div class="leader-bar-track" aria-hidden="true"><div class="leader-bar-fill" style="width:${best ? p.score / best * 100 : 0}%"></div></div>
        <span class="leader-score">${p.score}</span>
      </li>`).join("")}</ol>
    ${isHost() ? final ? button("Return to lobby", "lobby", "primary", "data-network")
      : button(`Continue to round ${round + 1}`, "continue", "primary", "data-network")
      : '<p class="answer-hint">Waiting for the host to continue.</p>'}`;
}

function renderGame() {
  const active = escapeHtml(room.players.find((p) => p.id === room.activeId)?.name ?? "");
  switch (room.phase) {
    case "study": return renderStudy();
    case "countdown":
      return `<h2 class="round-badge">${roundNames[room.next]}</h2><p class="countdown-number" data-time></p>`;
    case "picture":
    case "picture-answer": return renderPicture(active);
    case "memory":
    case "memory-miss": return renderMemory(active);
    case "taboo-ready":
    case "taboo-secret":
    case "taboo-speak":
    case "taboo-answer": return renderTaboo(active);
    default: return renderTally();
  }
}

function render() {
  document.body.classList.toggle("bg-vivid", !room);
  const memory = room?.phase.startsWith("memory") && room.cards;
  app.innerHTML = `<main class="screen ${memory ? "screen-wide" : ""} ${!room ? "entry-screen" : ""}">
    ${room ? room.phase === "lobby" ? renderLobby() : renderGame() : renderEntry()}
    <p class="connection-status" role="status" hidden></p>
    <p class="room-error" role="alert" hidden></p>
    ${room ? button(isHost() ? "Close room" : "Leave room", "leave", "ghost", "data-network") : ""}
  </main>`;
  updateStatus();
  updateTimer();
}

function updateStatus() {
  const online = socket.connected;
  const status = app.querySelector(".connection-status");
  const error = app.querySelector(".room-error");
  if (!status) return;
  status.textContent = !online ? (session ? "Connection lost. Reconnecting…" : "Connecting to the game server…")
    : room && !room.players.find((player) => player.id === room.hostId).online ? "The host is disconnected." : "";
  status.hidden = !status.textContent;
  error.textContent = message;
  error.hidden = !message;
  app.querySelectorAll("[data-network]").forEach((control) => {
    control.disabled = !online || pending || control.hasAttribute("data-locked");
  });
  updateStart();
}

function updateStart() {
  const start = app.querySelector('[data-action="start"]');
  if (!start) return;
  const selected = lists.filter((list) => settings.listIds.includes(list.id)).reduce((sum, list) => sum + list.count, 0);
  const size = room.players.length;
  const turns = Math.floor(selected / size);
  const allOnline = room.players.every((player) => player.online);
  start.disabled = !socket.connected || pending || !allOnline || size < 3 || !turns;
  app.querySelector("#start-hint").textContent = size < 3 ? "Invite at least three players, including the host."
    : !allOnline ? "Wait for disconnected players to return or remove them."
      : !turns ? "Choose enough words for everyone to take a turn." : `${turns} picture and Taboo turns per player.`;
}

function updateTimer() {
  const time = app.querySelector("[data-time]");
  if (!time || !localDeadline) return;
  const remaining = Math.max(0, localDeadline - performance.now());
  const seconds = Math.ceil(remaining / 1000);
  time.textContent = room.phase === "countdown" ? (seconds || "Go!") : `${seconds}s`;
  time.closest(".ring")?.style.setProperty("--pct", remaining / room.duration);
}

app.addEventListener("submit", (event) => {
  if (event.target.id !== "entry-form") return;
  event.preventDefault();
  enter(mode);
});

app.addEventListener("input", (event) => {
  const control = event.target;
  if (control.closest("#entry-form")) entry[control.name] = control.value;
  if (control.matches('.timer-field input[type="range"]')) {
    settings[control.id] = Number(control.value);
    control.previousElementSibling.value = `${control.value}s`;
  }
  if (control.matches('.list-option input[type="checkbox"]')) {
    settings.listIds = [...app.querySelectorAll(".list-option input:checked")].map((input) => input.value);
    updateStart();
  }
});

document.addEventListener("keydown", (event) => {
  if (!room || !isHost() || !["picture", "picture-answer"].includes(room.phase)) return;
  if (event.repeat || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  action("judge-picture", { correct: event.key === "ArrowRight" });
});

app.addEventListener("click", async (event) => {
  const control = event.target.closest("[data-action]");
  if (!control) return;
  const type = control.dataset.action;
  playSound("button");
  switch (type) {
    case "show-create":
    case "show-join":
    case "home":
      mode = type.replace("show-", "");
      message = "";
      render();
      app.querySelector("#player-name")?.focus();
      break;
    case "reset":
      if (!pending) resetRoom();
      break;
    case "retry-lists": loadLists(); break;
    case "copy": {
      const url = inviteUrl();
      try {
        await navigator.clipboard.writeText(url);
        control.textContent = "Link copied";
      } catch {
        const input = control.nextElementSibling;
        input.hidden = false;
        input.select();
      }
      break;
    }
    case "leave":
      if (isHost() && !confirm("Close this room for everyone?")) break;
      request("leave-room", {}, (response) => { if (response?.ok) resetRoom(); });
      break;
    case "start": action("start", { settings }); break;
    case "remove-player": action(type, { playerId: control.dataset.player }); break;
    case "picture-correct":
    case "picture-wrong": action("judge-picture", { correct: type === "picture-correct" }); break;
    case "flip": action(type, { index: Number(control.dataset.index) }); break;
    case "award-taboo":
    case "pass-taboo": action("judge-taboo", { guesserId: control.dataset.player ?? null }); break;
    default: action(type);
  }
});

render();
loadLists();
socket.connect();
setInterval(updateTimer, 100);

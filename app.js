const app = document.getElementById("app");
const idiomAnimation = document.getElementById("idiom-animation");
const idiomAnimationFrame = idiomAnimation.querySelector(".idiom-animation-frame");
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
const roundNames = { picture: "Guess the Picture", memory: "Memory Match", taboo: "Taboo", listen: "Listen & Tap" };
const soundFiles = {
  correct: "correct", wrong: "wrong-answer", countdown: "countdown", results: "good-result", button: "button",
};
const motion = window.gsap;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const effectAudio = new Audio();
const speech = window.speechSynthesis;
const missingVoiceNotice = "No Mandarin voice is available. Enable Mandarin text-to-speech on your device, then tap Replay word.";

let session = loadSession();
let mode = incomingCode ? "join" : "home";
let room;
let settings;
let lists = [];
let listsFailed = false;
let pending = false;
let message = "";
let localDeadline = 0;
let audioQuestion;
let audioNotice = "";
let activeWord;
let testUtterance;
let audioTestResult;
let lastReportedAudio;
let roundIntro;
let countdownMotion;
let countdownBeat;
let scoreMotion;
let standingsMotion;

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

function imageName(source) {
  return source.split("/").pop().replace(/\.(png|webp)$/, "").replaceAll("-", " ");
}

function isHost() {
  return room.selfId === room.hostId;
}

function isMyTurn() {
  return room.selfId === room.activeId;
}

function playSound(name) {
  if (!soundFiles[name] || activeWord) return;
  effectAudio.src = `assets/sounds/${soundFiles[name]}.mp3`;
  effectAudio.play().catch(() => {});
}

function mandarinVoice() {
  const voices = (speech?.getVoices() ?? []).flatMap((voice) => {
    const [language, ...subtags] = voice.lang.toLowerCase().split("-");
    if (language !== "cmn" && (language !== "zh" || subtags.some((tag) => ["yue", "hk", "mo"].includes(tag)))) return [];
    const priority = subtags.includes("sg") ? 0 : subtags.includes("cn") || subtags.includes("hans") ? 1 : 2;
    return [{ voice, priority }];
  });
  voices.sort((a, b) => a.priority - b.priority || Number(b.voice.localService) - Number(a.voice.localService));
  return voices[0]?.voice;
}

function audioStatus() {
  if (!window.SpeechSynthesisUtterance || !mandarinVoice()) return "unavailable";
  return ["ready", "unavailable"].includes(audioTestResult) ? audioTestResult : "untested";
}

function reportAudioStatus() {
  if (!socket.connected || room?.phase !== "lobby" || room.mode !== "nouns") return;
  const status = audioStatus();
  const key = `${room.code}:${status}`;
  if (lastReportedAudio === key) return;
  lastReportedAudio = key;
  socket.timeout(4000).emit("audio-status", { status }, (error, response) => {
    if ((error || !response?.ok) && lastReportedAudio === key) lastReportedAudio = null;
  });
}

function updateAudioTest() {
  const notice = app.querySelector("#audio-test-status");
  if (!notice) return;
  const labels = {
    ready: "Test played. If you couldn’t hear it, check your volume or use reading clues.",
    unavailable: "Mandarin audio isn’t available on this device. The room will use reading clues.",
    untested: "Play a sample to check your voice and volume.",
    playing: "Playing a sample…",
  };
  notice.textContent = labels[audioTestResult === "playing" ? "playing" : audioStatus()];
}

function testMandarinAudio() {
  const voice = mandarinVoice();
  if (!voice || !window.SpeechSynthesisUtterance) {
    updateAudioTest();
    reportAudioStatus();
    return;
  }
  if (testUtterance) speech.cancel();
  const word = new SpeechSynthesisUtterance("你好！欢迎来练习中文。");
  word.voice = voice;
  word.lang = voice.lang;
  word.rate = 0.9;
  testUtterance = word;
  const finish = (result) => {
    if (testUtterance !== word) return;
    testUtterance = null;
    audioTestResult = result;
    updateAudioTest();
    reportAudioStatus();
  };
  word.onend = () => finish("ready");
  word.onerror = () => finish("unavailable");
  audioTestResult = "playing";
  updateAudioTest();
  effectAudio.pause();
  speech.speak(word);
}

function stopAudioTest() {
  if (!testUtterance) return;
  testUtterance = null;
  audioTestResult = null;
  speech.cancel();
}

function showAudioNotice(notice) {
  audioNotice = notice;
  const status = app.querySelector(".audio-notice");
  if (status) {
    status.textContent = notice;
    status.hidden = !notice;
  }
}

function stopWord() {
  if (!activeWord) return;
  activeWord = null;
  speech.cancel();
}

function replayWord() {
  if (!audioQuestion || !room?.spokenWord) return;
  if (!speech || !window.SpeechSynthesisUtterance) {
    showAudioNotice("This browser cannot speak the clue. Open the game in a browser with Mandarin text-to-speech.");
    return;
  }
  stopWord();
  const voice = mandarinVoice();
  if (!voice) {
    showAudioNotice(missingVoiceNotice);
    return;
  }

  effectAudio.pause();
  const word = new SpeechSynthesisUtterance(room.spokenWord);
  word.voice = voice;
  word.lang = voice.lang;
  word.rate = 0.9;
  activeWord = word;
  showAudioNotice("");
  word.onend = () => {
    if (activeWord === word) activeWord = null;
  };
  word.onerror = ({ error }) => {
    if (activeWord !== word) return;
    activeWord = null;
    if (error === "language-unavailable" || error === "voice-unavailable") {
      showAudioNotice(missingVoiceNotice);
    } else {
      showAudioNotice(error === "not-allowed" ? "Tap Replay word to hear the clue." : "The clue couldn’t play. Tap Replay word to try again.");
    }
  };
  speech.speak(word);
}

function updateWordAudio() {
  if (room?.questionId === audioQuestion) return;
  audioQuestion = room?.questionId;
  audioNotice = "";
  stopWord();
  if (room?.phase === "listen-question") replayWord();
}

speech?.addEventListener("voiceschanged", () => {
  if (room?.phase === "listen-question" && audioNotice === missingVoiceNotice && mandarinVoice()) replayWord();
  updateAudioTest();
  reportAudioStatus();
});
speech?.getVoices();

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
  stopAudioTest();
  updateWordAudio();
  render();
}

socket.on("connect", () => {
  message = "";
  lastReportedAudio = null;
  if (session) enter("resume");
  updateStatus();
});
socket.on("disconnect", () => updateStatus());
socket.on("room-closed", resetRoom);
socket.on("room-state", (state) => {
  const previous = room;
  room = state;
  localDeadline = room.deadline ? performance.now() + room.deadline - room.serverTime : 0;
  if (room.phase === "lobby" && room.settings && !settings) settings = structuredClone(room.settings);
  if (room.phase !== "lobby") settings = null;
  if (room.phase !== "lobby" || room.mode !== "nouns") stopAudioTest();
  updateWordAudio();
  if (previous && previous.revision !== room.revision) playSound(room.feedback);
  if (previous && previous.phase !== room.phase) {
    if (room.phase === "countdown") playSound("countdown");
    if (room.phase === "results") playSound("results");
  }
  if (["listen-answer", "idiom-answer"].includes(room.phase) &&
      previous?.phase === room.phase.replace("-answer", "-question") && room.choice !== null) {
    playSound(room.choice === room.correctIndex ? "correct" : "wrong");
  }
  render(previous);
  reportAudioStatus();
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
        <h2>Practise Mandarin</h2>
        <p>Practise everyday Mandarin words or try the <span lang="zh">成语</span> quiz. Play solo or invite friends.</p>
      </div>
      <div class="room-actions">
        ${button("Start a room", "show-create")}
        ${button("Join a game", "show-join", "ghost")}
      </div>
    `)}`;
  }

  const joining = mode === "join";
  return `${heading()}${woodPanel(`
    <h2>${joining ? "Join a game" : "Start a room"}</h2>
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
  const audioLabels = { ready: "Audio tested", unavailable: "Reading clues", untested: "Audio untested" };
  return `<ul class="player-list">${room.players.map((player) => `
    <li><span><strong>${escapeHtml(player.name)}</strong>
      ${player.id === room.hostId ? '<small class="player-role">Host</small>' : ""}
      ${player.id === room.selfId ? '<small class="player-role">You</small>' : ""}
    </span>
    ${player.online ? room.mode === "nouns" ? `<small>${audioLabels[player.audio ?? "untested"]}</small>` : "" : `<small>Disconnected</small>
      ${isHost() ? button("Remove", "remove-player", "ghost", `data-player="${player.id}" data-network`) : ""}`}
    </li>`).join("")}</ul>`;
}

function renderIdiomStudy(review = false) {
  return `<details class="idiom-study" data-collection="${review ? "review" : "study"}">
    <summary>${review ? `Review missed idioms (${room.idiomReview.length})` : "Learn idioms"}</summary>
    <div class="idiom-study-page"></div>
  </details>`;
}

function idiomEntries(book) {
  return book.dataset.collection === "review" ? room.idiomReview : room.idiomStudy;
}

function showIdiomComic(book, index) {
  const entries = idiomEntries(book);
  const { chinese, pinyin, meaning, comic, caption, comicAlt, scenario, translation, reason } = entries[index];
  const page = book.querySelector(".idiom-study-page");
  book.dataset.index = index;
  page.innerHTML = `<div class="idiom-comic-heading">
      <h3 class="idiom-study-title" tabindex="-1"><span lang="zh">${escapeHtml(chinese)}</span> <span>${escapeHtml(pinyin)}</span></h3>
      <span>${index + 1} of ${entries.length}</span>
    </div>
    <p>${escapeHtml(meaning)}</p>
    ${reason ? `<div class="review-reason">
      <p lang="zh">${escapeHtml(scenario)}</p>
      <p>${escapeHtml(translation)}</p>
      <p><strong>${escapeHtml(reason)}</strong></p>
    </div>` : ""}
    <figure class="idiom-comic">
      <div class="comic-strip"><img src="/assets/idiom-comics/${escapeHtml(comic)}.webp" alt="${escapeHtml(comicAlt)}" width="960" height="320" decoding="async"></div>
      <div class="comic-panels" role="group" aria-label="Comic panels">
        <button type="button" class="btn btn-ghost" data-action="comic-panel-prev" aria-label="Previous comic panel" disabled>‹</button>
        <span role="status">Panel 1 of 3</span>
        <button type="button" class="btn btn-ghost" data-action="comic-panel-next" aria-label="Next comic panel">›</button>
      </div>
      <figcaption lang="zh">${escapeHtml(caption)}</figcaption>
    </figure>
    ${button("Play animation", "idiom-study-play", "ghost", 'aria-haspopup="dialog"')}
    <div class="idiom-study-nav">
      ${button("Previous idiom", "idiom-study-previous", "ghost", index === 0 ? "disabled" : "")}
      ${button("Next idiom", "idiom-study-next", "ghost", index === entries.length - 1 ? "disabled" : "")}
    </div>`;
}

function changeComicPanel(controls, delta) {
  const strip = controls.previousElementSibling;
  const focused = document.activeElement;
  const index = Number(strip.dataset.panel ?? 0) + delta;
  strip.dataset.panel = index;
  strip.style.setProperty("--panel-offset", `${-index * 100 / 3}%`);
  controls.children[0].disabled = index === 0;
  controls.children[1].textContent = `Panel ${index + 1} of 3`;
  controls.children[2].disabled = index === 2;
  if (controls.contains(focused) && focused.disabled) controls.children[index === 0 ? 2 : 0].focus();
}

function playIdiomAnimation(book) {
  const { chinese, comic, caption, comicAlt } = idiomEntries(book)[Number(book.dataset.index)];
  idiomAnimation.querySelector("h2").textContent = chinese;
  idiomAnimation.querySelector("figcaption").textContent = caption;
  const image = new Image(320, 320);
  image.alt = comicAlt;
  image.addEventListener("error", () => {
    if (!image.isConnected) return;
    const notice = document.createElement("p");
    notice.setAttribute("role", "alert");
    notice.textContent = "The animation couldn’t load. Close it to return to the comic.";
    image.replaceWith(notice);
  }, { once: true });
  idiomAnimation.showModal();
  idiomAnimationFrame.replaceChildren(image);
  image.src = `/assets/idiom-animations/${comic}.webp`;
}

idiomAnimation.addEventListener("close", () => {
  if (!idiomAnimation.open) idiomAnimationFrame.replaceChildren();
});

const gameModes = { nouns: "Nouns", idioms: '<span lang="zh">成语</span> Idioms' };

function modePanel() {
  return `<section class="card-panel setup-grid setup-panel">
    <h2 id="game-mode-heading">Choose a game</h2>
    <div class="mode-options" role="group" aria-labelledby="game-mode-heading">
      ${Object.entries(gameModes).map(([id, name]) => button(name, "select-mode", "ghost",
        `data-mode="${id}" aria-pressed="${room.mode === id}" data-network`)).join("")}
    </div>
    ${room.mode ? `<div class="start-game-row">
      ${button(room.mode === "idioms" ? "Start quiz" : "Start game", "start", "primary", "data-network")}
      <p id="start-hint" class="answer-hint"></p>
    </div>${settingsPanel()}` : ""}
  </section>`;
}

function settingsPanel() {
  if (room.mode === "idioms") {
    return renderIdiomStudy();
  }
  if (listsFailed) return `<div class="setup-grid"><p>Couldn’t load the word lists.</p>${button("Try again", "retry-lists")}</div>`;
  if (!lists.length) return "<p>Loading word lists…</p>";

  const timers = [["answerSeconds", "Picture answer time", 3, 15, 1]];
  if (room.players.length > 1) timers.unshift(["studySeconds", "Study time per page", 10, 90, 5]);
  if (room.eligibleRounds.includes("taboo")) timers.push(["describeSeconds", "Taboo speaking time", 10, 45, 5]);

  return `<div class="setup-options">
    <details data-lobby-details="word-lists">
      <summary>Word lists <span id="selected-list-count">${settings.listIds.length} selected</span></summary>
      <fieldset class="word-lists" aria-label="Select word lists">
      <div class="list-options">${lists.map(({ id, count, label }) => `
        <label class="list-option">
          <input type="checkbox" value="${id}" ${settings.listIds.includes(id) ? "checked" : ""}>
          <span class="list-icon" aria-hidden="true">${listIcons[id] ?? "📖"}</span>
          <span>${escapeHtml(label)}<br><small>${count} words</small></span>
        </label>`).join("")}</div>
      </fieldset>
    </details>
    <details data-lobby-details="timers">
      <summary>Timer settings</summary>
      <div class="timers-grid">${timers.map(([id, label, min, max, step]) => `
      <div class="timer-field">
        <label for="${id}">${label}</label>
        <output class="value" for="${id}">${settings[id]}s</output>
        <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${settings[id]}">
      </div>`).join("")}
      </div>
    </details>
  </div>`;
}

function audioPanel() {
  const needsReading = room.players.some((player) => player.online && player.audio === "unavailable");
  return `<section class="card-panel audio-check">
    <h2>Mandarin audio</h2>
    ${button("Test Mandarin audio", "test-audio", "ghost")}
    <p id="audio-test-status" role="status"></p>
    ${needsReading ? '<p class="reading-notice">This room will play Read &amp; Tap if it’s drawn.</p>' : ""}
    ${isHost() ? `<label class="reading-option"><input type="checkbox" id="reading-clues" ${settings.readingClues ? "checked" : ""}> Use reading clues for everyone</label>` : ""}
    <p class="voice-tip">For spoken rounds, talk in person or use a separate voice call.</p>
  </section>`;
}

function renderLobby() {
  const idiomLobby = room.mode === "idioms";
  return `${heading()}
    <div class="lobby-grid">
      <section class="card-panel room-panel">
        <header class="room-heading">
          <h2>Room <span class="room-code" aria-label="${room.code.split("").join(" ")}">${room.code}</span></h2>
          ${isHost() ? button("Invite", "invite", "ghost", 'aria-controls="invite-panel" aria-expanded="false"') : ""}
        </header>
        <details data-lobby-details="players" ${isHost() && room.players.some((player) => !player.online) ? "open" : ""}>
          <summary>${room.players.length} / 8 players</summary>
          ${playerList()}
        </details>
        ${isHost() ? `<div class="invite-panel" id="invite-panel" hidden>
          <img class="invite-qr" alt="Scan to join room ${room.code}" width="160" height="160">
          <p>Scan the QR code or share the room code.</p>
          ${button("Copy invite link", "copy", "ghost")}
          <input class="invite-link" aria-label="Invite link" value="${escapeHtml(inviteUrl())}" readonly hidden>
        </div>` : ""}
      </section>
      ${isHost() ? modePanel() : `<section class="card-panel setup-panel">
        ${room.mode ? `<h2>${gameModes[room.mode]}</h2><p>Waiting for the host to start.</p>` : "<p>Waiting for the host to choose what to practise.</p>"}
        ${idiomLobby ? renderIdiomStudy() : ""}
      </section>`}
      ${room.mode === "nouns" ? audioPanel() : ""}
    </div>`;
}

function timer() {
  return room.deadline ? '<div class="ring" aria-label="Time remaining"><span data-time></span></div>' : "";
}

function nounText(noun) {
  return `<div class="cn" lang="zh">${escapeHtml(noun.chinese)}</div>
    <div class="py">${escapeHtml(noun.pinyin)}</div><div class="en">${escapeHtml(noun.english)}</div>`;
}

function renderStudy() {
  const solo = room.players.length === 1;
  return `<header class="memorize-header"><div><h2>Study the words</h2>
    <p class="page-indicator">Page ${room.page} of ${room.pages}</p></div>${timer()}</header>
    <div class="noun-grid">${room.nouns.map((noun, index) => `
      <article class="noun-card" style="background:var(--${colors[index]})">
        <div class="noun-img"><img src="${escapeHtml(noun.image)}" alt=""></div>
        <div class="noun-text">${nounText(noun)}</div>
      </article>`).join("")}</div>
    ${isHost() ? `<div class="round-actions study-actions">
      ${solo ? button(room.page === room.pages ? "Start round 1" : "Next words", "next-study", "primary", "data-network") : ""}
      ${!(solo && room.page === room.pages) ? button("Skip study", "skip-study", "ghost", "data-network") : ""}
    </div>` : ""}`;
}

function scores() {
  return `<div class="score-row" aria-label="Scores">${room.players.map((p) => `
    <span class="score-chip ${p.id === room.activeId ? "active" : ""}" data-score-for="${p.id}">${escapeHtml(p.name)} ${p.score}</span>
  `).join("")}</div>`;
}

function roundTitle() {
  if (room.mode === "idioms") return '<span lang="zh">情境选成语</span>';
  return `Round ${room.roundIndex + 1} · ${roundName(room.rounds[room.roundIndex])}`;
}

function roundName(round) {
  return escapeHtml(round === "listen" && room.readingClues ? "Read & Tap" : roundNames[round]);
}

function roundHeader(label, details = "", showTimer = true) {
  return `<h2 class="round-badge">${roundTitle()}</h2>
    <div class="play-header"><span class="turn-label">${label}</span>${showTimer ? timer() : ""}${details}</div>`;
}

function wordCard(noun, includeImage = false) {
  return `<div class="prompt-card prompt-answer">
    ${includeImage ? `<img src="${escapeHtml(noun.image)}" alt="">` : ""}
    ${nounText(noun)}
  </div>`;
}

function renderPicture(active) {
  const review = room.phase === "picture-review";
  const revealed = room.phase !== "picture";
  const solo = room.players.length === 1;
  const hint = review ? room.pictureCorrect ? "Correct!" : "Remember this word for next time."
    : revealed ? solo ? "Check your answer and mark how you did." : "Time’s up."
    : isMyTurn() ? "Say the Mandarin name out loud." : `Listen to ${active}’s answer.`;
  return `${roundHeader(review ? "Remember the word" : isMyTurn() ? "Your turn" : `${active}’s turn`, "", !review)}
    <span class="page-indicator">Turn ${room.turn} of ${room.turns}</span>
    ${revealed ? wordCard(room.prompt, review) : `<div class="prompt-card"><img src="${escapeHtml(room.prompt.image)}" alt="Object to guess"></div>`}
    <p class="answer-hint" role="status">${hint}</p>
    ${solo && !revealed ? button("Reveal answer", "reveal-picture", "primary", "data-network") : ""}
    ${isHost() && !review && (!solo || revealed) ? `<div class="judge-buttons round-actions" role="group" aria-label="Score the spoken answer">
      ${button(solo ? "I got it" : "Correct", "picture-correct", "success", "data-network")}
      ${button(solo ? "I missed it" : "Incorrect", "picture-wrong", "error", "data-network")}
    </div>` : ""}
    ${scores()}`;
}

function renderMemory(active) {
  const current = room.players.find((p) => p.id === room.activeId);
  const complete = room.phase === "memory-complete";
  const hint = room.phase === "memory-miss" ? "Those cards don’t match."
    : !current.online ? `${active} is disconnected.`
      : isMyTurn() ? "Flip two cards. Match the Chinese word to its picture or meaning." : `Watch ${active}’s cards for your next turn.`;
  return `${roundHeader(complete ? "All pairs matched" : isMyTurn() ? "Your turn" : `${active}’s turn`,
    `<span class="pairs-badge">${room.matches}/${room.cards.length / 2} pairs</span>`, false)}
    ${complete ? "" : `<p class="answer-hint" role="status">${hint}</p>`}
    <div class="online-memory" style="--columns:4"></div>
    ${scores()}
    ${isHost() && !current.online && room.phase === "memory" ? button("Pass turn", "pass-memory", "ghost", "data-network") : ""}`;
}

function renderTaboo(active) {
  const mine = isMyTurn();
  const speaker = room.players.find((p) => p.id === room.activeId);
  const speaking = room.phase === "taboo-speak" || room.phase === "taboo-answer";
  const help = {
    "taboo-ready": mine ? "Open your secret word when you’re ready." : `Waiting for ${active} to get ready.`,
    "taboo-speak": mine ? "Describe the word in Mandarin without saying it." : `Listen to ${active} and guess the Mandarin word aloud.`,
    "taboo-answer": isHost() ? "Mark who guessed the word." : "Time’s up. Here’s the word.",
  };
  return `${roundHeader(mine ? "You’re the speaker" : "You’re guessing")}
    <span class="page-indicator">Turn ${room.turn} of ${room.turns}</span>
    ${mine && room.prompt ? wordCard(room.prompt, room.phase === "taboo-speak") : ""}
    <p class="answer-hint">${help[room.phase]}</p>
    ${!mine && room.prompt ? wordCard(room.prompt) : ""}
    ${room.phase === "taboo-ready" && mine ? button("Reveal my word", "reveal-taboo", "primary", "data-network") : ""}
    ${isHost() && (speaking || !speaker.online) ? `<div class="guess-buttons round-actions" role="group" aria-label="Record who guessed">
      ${speaking ? room.players.filter((p) => p.id !== room.activeId).map((p) =>
        button(`${escapeHtml(p.name)} guessed it`, "award-taboo", "success", `data-player="${p.id}" data-network`)).join("") : ""}
      ${button(speaking ? "No one guessed" : "Pass turn", "pass-taboo", "error", "data-network")}
    </div>` : ""}
    ${scores()}`;
}

function renderListenRecap() {
  if (!room.listenRecap) return "";
  const { noun, correct } = room.listenRecap;
  return `<div class="listen-recap">
    <p>Previous word · <strong>${correct ? "Correct" : "Incorrect"}</strong></p>
    <p><b lang="zh">${escapeHtml(noun.chinese)}</b> ${escapeHtml(noun.pinyin)} · ${escapeHtml(noun.english)}</p>
  </div>`;
}

function renderListen() {
  const revealed = room.phase === "listen-answer";
  const locked = room.choice !== null;
  const progress = revealed
    ? !locked ? "Time’s up. Here’s the word." : room.choice === room.correctIndex ? "Correct!" : "Here’s the correct word."
    : locked ? "Answer locked in." : room.readingClues ? "Read the word and choose the matching picture." : "Listen and choose the matching picture.";
  return `${roundHeader(`Word ${room.turn} of ${room.turns}`)}
    ${room.readingClues ? !revealed ? `<p class="reading-clue" lang="zh">${escapeHtml(room.readingClue)}</p>` : ""
      : button("🔊 Replay word", "replay-word", "ghost")}
    <p class="audio-notice answer-hint" role="status" ${audioNotice ? "" : "hidden"}>${escapeHtml(audioNotice)}</p>
    <div class="listen-choices" aria-label="Picture choices">${room.choices.map((source, index) => {
      const selected = room.choice === index;
      const correct = revealed && room.correctIndex === index;
      const marker = correct ? "✓ Correct" : selected ? revealed ? "Your choice" : "Locked in" : "";
      return `<button type="button" class="listen-choice${selected ? " is-selected" : ""}${correct ? " is-correct" : ""}"
        data-action="listen-choose" data-index="${index}" data-network ${locked || revealed ? "data-locked" : ""}
        aria-label="Picture ${index + 1}, ${escapeHtml(imageName(source))}${marker ? `, ${marker}` : ""}">
        <img src="${escapeHtml(source)}" alt="" draggable="false">
        ${marker ? `<span class="choice-marker">${marker}</span>` : ""}
      </button>`;
    }).join("")}</div>
    <p class="answer-hint">${progress}${!revealed && room.players.length > 1 ? ` ${room.answered}/${room.players.length} answered.` : ""}</p>
    ${revealed ? `<div class="listen-solution">${nounText(room.prompt)}</div>` : ""}
    ${renderListenRecap()}
    ${scores()}`;
}

function renderIdiomQuiz() {
  const revealed = room.phase === "idiom-answer";
  const locked = room.choice !== null;
  const status = revealed ? !locked ? "Time’s up." : room.choice === room.correctIndex ? "Correct!" : "Here’s the best fit."
    : locked ? "Answer locked in." : "Which idiom fits this situation?";
  return `${roundHeader(`Scenario ${room.turn} of ${room.turns}`)}
    <section class="card-panel idiom-scenario" aria-label="Scenario" tabindex="-1">
      <p lang="zh">${escapeHtml(room.scenario)}</p>
      <p>${escapeHtml(room.translation)}</p>
    </section>
    <div class="idiom-choices" role="group" aria-label="Idiom choices">${room.choices.map((choice, index) => {
      const selected = room.choice === index;
      const correct = revealed && room.correctIndex === index;
      const tag = correct ? "✓ Correct" : selected ? revealed ? "Your choice" : "Locked in" : "";
      return `<button type="button" class="idiom-choice${correct ? " is-correct" : ""}${selected ? " is-selected" : ""}"
        data-action="idiom-choose" data-index="${index}" data-network ${revealed || locked ? "data-locked" : ""}>
        <strong lang="zh">${escapeHtml(choice)}</strong>
        ${tag ? `<span>${tag}</span>` : ""}
      </button>`;
    }).join("")}</div>
    <p class="answer-hint" role="status">${status}${!revealed && room.players.length > 1 ? ` ${room.answered}/${room.players.length} answered.` : ""}</p>
    ${revealed ? `<section class="card-panel idiom-explanation" aria-label="Explanation" tabindex="-1">
      <p><strong lang="zh">${escapeHtml(room.prompt.chinese)}</strong> <span>${escapeHtml(room.prompt.pinyin)}</span></p>
      <p>${escapeHtml(room.prompt.meaning)}</p>
      <p>${escapeHtml(room.prompt.reason)}</p>
    </section>
    ${isHost() ? button(room.turn === room.turns ? "See results" : "Next scenario", "next-idiom", "primary", "data-network")
      : '<p class="answer-hint">Waiting for the host to continue.</p>'}` : ""}
    ${scores()}`;
}

function renderCountdown() {
  return `<section class="round-countdown">
    <h2 class="round-badge">${roundTitle()}</h2>
    ${room.rounds.length > 1 && room.roundIndex === 0 ? `<ol class="round-lineup" aria-label="Rounds in this game">${room.rounds.map((round, index) => `
      <li class="round-card ${index === room.roundIndex ? "is-current" : ""}" ${index === room.roundIndex ? 'aria-current="step"' : ""}>
        <div class="round-card-inner">
          <div class="round-card-front"><span>${index + 1}</span><strong>${roundName(round)}</strong></div>
          <div class="round-card-back" aria-hidden="true"></div>
        </div>
      </li>`).join("")}</ol>` : ""}
    <p class="countdown-number" data-time></p>
  </section>`;
}

function renderTally() {
  const ranked = room.players.slice().sort((a, b) => b.score - a.score);
  const best = ranked[0].score;
  const leaders = ranked.filter((p) => p.score === best).map((p) => p.name);
  const final = room.phase === "results";
  const round = room.roundIndex + 1;
  const result = final ? "finished first" : leaders.length === 1 ? "leads" : "share the lead";
  const points = `${best} ${best === 1 ? "point" : "points"}`;
  const summary = ranked.length === 1 ? `You ${final ? "scored" : "have"} ${points}.`
    : `${leaders.join(" and ")} ${result} with ${points}.`;
  let rank = 1;
  return `<h2 class="round-badge">${final ? "Final results" : `Round ${round} complete`}</h2>
    ${final ? '<div class="trophy" aria-hidden="true">🏆</div>' : ""}
    <p class="winner-line">${escapeHtml(summary)}</p>
    ${renderListenRecap()}
    <ol class="standings" aria-label="Cumulative standings" style="--standings-columns:${Math.min(ranked.length, 4)}">${ranked.map((player, index) => {
      if (index && player.score !== ranked[index - 1].score) rank = index + 1;
      const height = player.score ? Math.max(2, Math.round(player.score / best * 60)) : 0;
      return `<li class="standing-card${rank === 1 && best > 0 ? " standing-leader" : ""}">
        <span class="standing-rank">Rank ${rank}</span>
        <div class="standing-stage" aria-hidden="true">
          ${height ? `<div class="standing-stack" style="--stack-height:${height}px">
            <img src="/assets/images/score-counter.webp" alt="" width="240" height="88">
          </div>` : ""}
        </div>
        <span class="standing-name">${escapeHtml(player.name)}${player.id === room.selfId ? '<small class="standing-you">You</small>' : ""}</span>
        <span class="standing-score" data-score-for="${player.id}">${player.score}<small> ${room.mode === "nouns" ? "total" : player.score === 1 ? "point" : "points"}</small></span>
        ${room.mode === "nouns" ? `<small class="standing-round">+${player.roundPoints} this round</small>` : ""}
      </li>`;
    }).join("")}</ol>
    ${room.idiomReview?.length ? renderIdiomStudy(true) : ""}
    ${isHost() ? final ? button("Return to lobby", "lobby", "primary", "data-network")
      : button(`Continue to round ${round + 1}`, "continue", "primary", "data-network")
      : '<p class="answer-hint">Waiting for the host to continue.</p>'}`;
}

function renderGame() {
  const active = escapeHtml(room.players.find((p) => p.id === room.activeId)?.name ?? "");
  switch (room.phase) {
    case "study": return renderStudy();
    case "countdown": return renderCountdown();
    case "picture":
    case "picture-answer":
    case "picture-review": return renderPicture(active);
    case "memory":
    case "memory-miss":
    case "memory-complete": return renderMemory(active);
    case "taboo-ready":
    case "taboo-speak":
    case "taboo-answer": return renderTaboo(active);
    case "listen-question":
    case "listen-answer": return renderListen();
    case "idiom-question":
    case "idiom-answer": return renderIdiomQuiz();
    default: return renderTally();
  }
}

function animationsEnabled() {
  return Boolean(motion) && !reducedMotion.matches;
}

function stopMemoryMotion(board) {
  if (!board || !motion) return;
  const targets = board.querySelectorAll(".memory-motion, .memory-inner");
  motion.killTweensOf(targets);
  motion.set(targets, { clearProps: "transform" });
  board.querySelectorAll(".face-down .memory-answer").forEach((face) => face.replaceChildren());
}

function syncMemoryBoard(board, previous) {
  if (!board.childElementCount) {
    board.innerHTML = room.cards.map((_, index) => `
      <button type="button" class="online-card" data-action="flip" data-index="${index}" data-network>
        <span class="memory-motion"><span class="memory-inner">
          <span class="memory-face memory-cover" aria-hidden="true">?</span>
          <span class="memory-face memory-answer"></span>
        </span></span>
      </button>`).join("");
  }

  const canFlip = isMyTurn() && room.phase === "memory";
  const animate = animationsEnabled();
  const matches = [];
  const misses = [];
  room.cards.forEach(({ face, value, matched }, index) => {
    const tile = board.children[index];
    const spinner = tile.querySelector(".memory-inner");
    const answer = tile.querySelector(".memory-answer");
    const hidden = face === "hidden";
    const before = previous?.cards?.[index];
    const wasHidden = before?.face === "hidden";
    const rotate = animate && before && hidden !== wasHidden;
    const from = rotate && motion.isTweening(spinner) ? motion.getProperty(spinner, "rotationY") : wasHidden ? 0 : 180;
    const mismatch = room.phase === "memory-miss" && !hidden && !matched;

    if (!hidden && (face !== before?.face || value !== before?.value)) {
      answer.innerHTML = face === "image"
        ? `<img src="${escapeHtml(value)}" alt="${escapeHtml(imageName(value))}" draggable="false">`
        : `<span class="memory-${face}" ${face === "chinese" ? 'lang="zh"' : ""}>${escapeHtml(value)}</span>`;
    }
    tile.classList.toggle("face-down", hidden);
    tile.classList.toggle("is-revealed", !hidden);
    tile.classList.toggle("is-matched", Boolean(matched));
    tile.classList.toggle("is-mismatch", mismatch);
    tile.toggleAttribute("data-locked", !hidden || !canFlip);
    answer.setAttribute("aria-hidden", String(hidden));
    if (hidden) tile.setAttribute("aria-label", `Card ${index + 1}, face down`);
    else tile.removeAttribute("aria-label");

    if (rotate) {
      motion.fromTo(spinner, { rotationY: from }, {
        rotationY: hidden ? 0 : 180, duration: 0.24, ease: "power2.inOut",
        overwrite: true, clearProps: "transform",
        onComplete: () => { if (hidden) answer.replaceChildren(); },
      });
    } else if (hidden && !wasHidden) {
      answer.replaceChildren();
    }
    if (before && matched && !before.matched) matches.push(tile.firstElementChild);
    if (mismatch && previous?.phase === "memory") misses.push(tile.firstElementChild);
  });

  if (!animate) return;
  if (matches.length) {
    motion.fromTo(matches, { scale: 0.96 }, {
      scale: 1, duration: 0.3, delay: 0.16, ease: "back.out(2.2)", overwrite: true, clearProps: "transform",
    });
  }
  if (misses.length) {
    motion.to(misses, {
      keyframes: [{ x: -3, duration: 0.06 }, { x: 3, duration: 0.08 }, { x: 0, duration: 0.09 }],
      delay: 0.22, overwrite: true, clearProps: "transform",
    });
  }
}

function stopCountdownMotion() {
  roundIntro?.revert();
  countdownMotion?.revert();
  roundIntro = countdownMotion = null;
}

function animateRoundReveal(scene) {
  if (!animationsEnabled() || localDeadline - performance.now() < 750) return;
  roundIntro = motion.context(() => {
    const cards = scene.querySelectorAll(".round-card");
    if (!cards.length) {
      motion.from(scene.querySelector("h2"), { y: 7, opacity: 0.45, duration: 0.22, ease: "power2.out" });
      return;
    }
    motion.timeline()
      .fromTo(cards, { x: -24, y: 14, rotation: -5, opacity: 0 }, {
        x: 0, y: 0, rotation: 0, opacity: 1, stagger: 0.065, duration: 0.28, ease: "power2.out",
      })
      .fromTo(scene.querySelectorAll(".round-card-inner"), { rotationY: 0 }, {
        rotationY: 180, stagger: 0.09, duration: 0.3, ease: "power2.inOut",
      }, 0.15);
  });
}

function animateStandings() {
  if (!animationsEnabled()) return;
  standingsMotion = motion.context(() => {
    const cards = app.querySelectorAll(".standing-card");
    const stacks = app.querySelectorAll(".standing-stack");
    const timeline = motion.timeline();
    timeline.from(cards, { y: 12, opacity: 0.5, duration: 0.3, stagger: 0.055, ease: "power2.out" });
    if (stacks.length) {
      timeline.from(stacks, { scaleY: 0, duration: 0.45, stagger: 0.055, ease: "back.out(1.1)" }, 0.1);
    }
  });
}

function showScoreGains(previous) {
  const announcement = document.getElementById("score-announcement");
  if (previous?.code !== room?.code || !previous) {
    announcement.textContent = "";
    return;
  }
  const gains = room.players.flatMap((player) => {
    const before = previous.players.find((p) => p.id === player.id);
    return before && player.score > before.score ? [{ player, points: player.score - before.score }] : [];
  });
  if (!gains.length) return;
  announcement.textContent = gains.map(({ player, points }) =>
    `${player.name} earned ${points} ${points === 1 ? "point" : "points"}. Total ${player.score}.`).join(" ");
  const elements = gains.flatMap(({ player, points }) => {
    const score = app.querySelector(`[data-score-for="${player.id}"]`);
    if (!score) return [];
    const gain = document.createElement("span");
    gain.className = "score-gain";
    gain.textContent = `+${points}`;
    gain.setAttribute("aria-hidden", "true");
    score.append(gain);
    return [{ score, gain }];
  });
  if (!animationsEnabled() || !elements.length) return;
  scoreMotion = motion.context(() => {
    const effects = motion.timeline();
    effects.fromTo(elements.map(({ score }) => score), { scale: 0.95 }, {
      scale: 1, duration: 0.35, ease: "back.out(3)",
    }, 0);
    effects.fromTo(elements.map(({ gain }) => gain), { y: 7, opacity: 0 }, {
      y: 0, opacity: 1, duration: 0.2, ease: "power2.out",
    }, 0);
    effects.to(elements.map(({ gain }) => gain), {
      y: -8, opacity: 0, duration: 0.22, ease: "power1.in",
      onComplete: () => elements.forEach(({ gain }) => gain.remove()),
    }, 0.52);
  });
}

function render(previous) {
  if (idiomAnimation.open && (!["lobby", "results"].includes(room?.phase) || room.mode !== "idioms" ||
    (previous && previous.phase !== room.phase))) idiomAnimation.close();
  document.body.classList.toggle("bg-vivid", !room);
  const memory = Boolean(room?.cards);
  const board = app.querySelector(".online-memory");
  const countdown = app.querySelector(".round-countdown");
  const study = app.querySelector(".idiom-study");
  const openDetails = [...app.querySelectorAll("details[data-lobby-details][open]")].map((detail) => detail.dataset.lobbyDetails);
  const inviteOpen = app.querySelector('[data-action="invite"]')?.getAttribute("aria-expanded") === "true";
  const focused = document.activeElement;
  const modeFocus = focused?.dataset.mode;
  const keepCountdown = countdown && room?.phase === "countdown" && previous?.deadline === room.deadline;
  if (!memory) stopMemoryMotion(board);
  if (!keepCountdown) stopCountdownMotion();
  scoreMotion?.revert();
  scoreMotion = null;
  standingsMotion?.revert();
  standingsMotion = null;

  const page = document.createElement("template");
  page.innerHTML = `<main class="screen ${memory ? "screen-wide" : ""} ${!room ? "entry-screen" : ""}">
    ${room ? room.phase === "lobby" ? renderLobby() : renderGame() : renderEntry()}
    <p class="connection-status" role="status" hidden></p>
    <p class="room-error" role="alert" hidden></p>
    ${room ? button(isHost() ? "Close room" : "Leave room", "leave", "ghost", "data-network") : ""}
  </main>`;
  if (memory && board) page.content.querySelector(".online-memory").replaceWith(board);
  if (keepCountdown) page.content.querySelector(".round-countdown").replaceWith(countdown);
  const nextStudy = page.content.querySelector(".idiom-study");
  const keepStudy = study && nextStudy && study.dataset.collection === nextStudy.dataset.collection;
  if (keepStudy) nextStudy.replaceWith(study);
  for (const key of openDetails) {
    const details = page.content.querySelector(`[data-lobby-details="${key}"]`);
    if (details) details.open = true;
  }
  app.replaceChildren(page.content);
  if (inviteOpen && app.querySelector("#invite-panel")) showInvite(true);
  updateStatus();
  updateAudioTest();
  if (previous && (previous.phase !== room?.phase && ["lobby", "study", "countdown", "results", "round-tally"].includes(room?.phase) ||
    room?.phase === "study" && room.page !== previous.page)) window.scrollTo(0, 0);
  if (modeFocus) app.querySelector(`[data-mode="${modeFocus}"]`)?.focus({ preventScroll: true });
  if (keepStudy && study.contains(focused)) focused.focus({ preventScroll: true });
  if (memory) syncMemoryBoard(app.querySelector(".online-memory"), board ? previous : null);
  if (!keepCountdown && room?.phase === "countdown") animateRoundReveal(app.querySelector(".round-countdown"));
  if (room?.phase !== previous?.phase && ["round-tally", "results"].includes(room?.phase)) animateStandings();
  if (room?.phase === "idiom-question" && room.questionId !== previous?.questionId) app.querySelector(".idiom-scenario").focus();
  if (room?.phase === "idiom-answer" && previous?.phase === "idiom-question") app.querySelector(".idiom-explanation").focus();
  showScoreGains(previous);
  updateTimer();
}

reducedMotion.addEventListener("change", ({ matches }) => {
  if (!matches) return;
  stopCountdownMotion();
  stopMemoryMotion(app.querySelector(".online-memory"));
  scoreMotion?.revert();
  scoreMotion = null;
  standingsMotion?.revert();
  standingsMotion = null;
});

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
  const idiomLobby = room.mode === "idioms";
  const size = room.players.length;
  const enoughWords = idiomLobby || lists.filter((list) => settings.listIds.includes(list.id))
    .reduce((sum, list) => sum + list.count, 0) >= size;
  const allOnline = room.players.every((player) => player.online);
  start.disabled = !socket.connected || pending || !allOnline || !enoughWords;
  app.querySelector("#start-hint").textContent = !allOnline ? "Wait for disconnected players to return or remove them."
    : idiomLobby ? `${room.idiomStudy.length} scenarios. ${size === 1 ? "Take your time." : "Answer within 25 seconds."}`
      : !lists.length ? "Word lists are unavailable."
      : !enoughWords ? "Choose enough words for everyone to take a turn."
        : size === 1 ? "Study at your own pace, then play three rounds."
          : "Study together, then play three rounds.";
}

function showInvite(open) {
  const control = app.querySelector('[data-action="invite"]');
  const panel = app.querySelector("#invite-panel");
  control.setAttribute("aria-expanded", String(open));
  panel.hidden = !open;
  const qr = panel.querySelector(".invite-qr");
  if (open && !qr.hasAttribute("src")) qr.src = `/api/rooms/${room.code}/qr`;
}

function updateTimer() {
  const time = app.querySelector("[data-time]");
  if (!time || !localDeadline) return;
  const remaining = Math.max(0, localDeadline - performance.now());
  const seconds = Math.ceil(remaining / 1000);
  const countingDown = room.phase === "countdown";
  const label = countingDown ? String(seconds || "Go!") : `${seconds}s`;
  if (time.textContent !== label) time.textContent = label;
  if (countingDown) {
    const beat = `${room.deadline}:${seconds}`;
    if (beat !== countdownBeat) {
      countdownBeat = beat;
      countdownMotion?.revert();
      if (animationsEnabled()) {
        countdownMotion = motion.context(() => {
          motion.fromTo(time, { scale: 0.86 }, { scale: 1, duration: 0.28, ease: "back.out(2)" });
        });
      }
    }
  }
  time.closest(".ring")?.style.setProperty("--pct", remaining / room.duration);
}

app.addEventListener("submit", (event) => {
  if (event.target.id !== "entry-form") return;
  event.preventDefault();
  enter(mode);
});

app.addEventListener("toggle", (event) => {
  const book = event.target;
  if (book.matches(".idiom-study") && book.open && book.dataset.index === undefined) showIdiomComic(book, 0);
}, true);

app.addEventListener("input", (event) => {
  const control = event.target;
  if (control.closest("#entry-form")) entry[control.name] = control.value;
  if (control.matches('.timer-field input[type="range"]')) {
    settings[control.id] = Number(control.value);
    control.previousElementSibling.value = `${control.value}s`;
  }
  if (control.matches('.list-option input[type="checkbox"]')) {
    settings.listIds = [...app.querySelectorAll(".list-option input:checked")].map((input) => input.value);
    app.querySelector("#selected-list-count").textContent = `${settings.listIds.length} selected`;
    updateStart();
  }
  if (control.id === "reading-clues") settings.readingClues = control.checked;
});

document.addEventListener("keydown", (event) => {
  if (!room || !isHost() || !["picture", "picture-answer"].includes(room.phase)) return;
  if (room.players.length === 1 && room.phase === "picture") return;
  if (event.repeat || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  action("judge-picture", { correct: event.key === "ArrowRight" });
});

app.addEventListener("click", async (event) => {
  const control = event.target.closest("[data-action]");
  if (!control) return;
  const type = control.dataset.action;
  if (type === "replay-word") {
    replayWord();
    return;
  }
  if (type !== "listen-choose") playSound("button");
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
    case "invite": showInvite(control.getAttribute("aria-expanded") !== "true"); break;
    case "test-audio": testMandarinAudio(); break;
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
      if (isHost() && !confirm(room.players.length === 1 ? "End this session?" : "Close this room for everyone?")) break;
      request("leave-room", {}, (response) => { if (response?.ok) resetRoom(); });
      break;
    case "select-mode": action(type, { mode: control.dataset.mode }); break;
    case "idiom-study-play": playIdiomAnimation(control.closest(".idiom-study")); break;
    case "comic-panel-prev":
    case "comic-panel-next": changeComicPanel(control.closest(".comic-panels"), type === "comic-panel-next" ? 1 : -1); break;
    case "idiom-study-previous":
    case "idiom-study-next": {
      const book = control.closest(".idiom-study");
      const direction = type === "idiom-study-next" ? 1 : -1;
      showIdiomComic(book, Number(book.dataset.index) + direction);
      book.querySelector(".idiom-study-title").focus();
      break;
    }
    case "start": action("start", { settings }); break;
    case "remove-player": action(type, { playerId: control.dataset.player }); break;
    case "picture-correct":
    case "picture-wrong": action("judge-picture", { correct: type === "picture-correct" }); break;
    case "flip": action(type, { index: Number(control.dataset.index) }); break;
    case "listen-choose": action("listen-answer", { questionId: room.questionId, index: Number(control.dataset.index) }); break;
    case "idiom-choose": action("idiom-answer", { questionId: room.questionId, index: Number(control.dataset.index) }); break;
    case "award-taboo":
    case "pass-taboo": action("judge-taboo", { guesserId: control.dataset.player ?? null }); break;
    default: action(type);
  }
});

render();
loadLists();
socket.connect();
setInterval(updateTimer, 100);

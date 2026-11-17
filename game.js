const { randomInt, randomUUID } = require("node:crypto");
const { idioms } = require("./idioms");

const MIN_PLAYERS = 1;
const MAX_PLAYERS = 8;
const DEFAULT_SETTINGS = { studySeconds: 15, answerSeconds: 5, describeSeconds: 20 };
const TIMER_LIMITS = { studySeconds: [10, 90], answerSeconds: [3, 15], describeSeconds: [10, 45] };
const ROUND_MIN_PLAYERS = { picture: 1, memory: 1, taboo: 3, listen: 1 };

class GameError extends Error {}

function requireGame(condition, message) {
  if (!condition) throw new GameError(message);
}

function shuffled(items) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function turnPool(nouns, playerCount) {
  const size = nouns.length - (nouns.length % playerCount);
  return shuffled(nouns).slice(0, size);
}

function activePlayer(room) {
  return room.players[room.turn % room.players.length];
}

function changePhase(room, phase, duration = 0) {
  room.phase = phase;
  room.duration = duration;
  room.deadline = duration ? Date.now() + duration : null;
}

function countdown(room) {
  room.roundStartScores = new Map(room.players.map((player) => [player.id, player.score]));
  changePhase(room, "countdown", 3000);
}

function eligibleRounds(playerCount) {
  return Object.keys(ROUND_MIN_PLAYERS).filter((round) => playerCount >= ROUND_MIN_PLAYERS[round]);
}

function startNouns(room, lists, settings) {
  const listIds = Array.isArray(settings?.listIds) ? [...new Set(settings.listIds)] : [];
  const selected = lists.filter((list) => listIds.includes(list.id)).flatMap((list) => list.nouns);
  requireGame(selected.length >= room.players.length, "Choose enough words for everyone to take a turn.");

  const timers = {};
  for (const [name, [min, max]] of Object.entries(TIMER_LIMITS)) {
    const seconds = settings[name];
    requireGame(Number.isInteger(seconds) && seconds >= min && seconds <= max, "Check the timer settings.");
    timers[name] = seconds;
  }

  room.settings = { listIds, ...timers, readingClues: settings.readingClues === true };
  room.players.forEach((player) => { player.score = 0; });
  room.selected = selected;
  room.rounds = shuffled(eligibleRounds(room.players.length)).slice(0, 3);
  room.roundIndex = 0;
  room.listenRecap = null;
  room.readingClues = room.settings.readingClues || room.players.some((player) => player.audio === "unavailable");
  room.studyPool = turnPool(selected, room.players.length);
  const studyOrder = room.studyPool.slice().sort((a, b) => a.order - b.order);
  room.pages = [];
  for (let i = 0; i < studyOrder.length; i += 4) room.pages.push(studyOrder.slice(i, i + 4));
  room.page = 0;
  changePhase(room, "study", room.players.length === 1 ? 0 : timers.studySeconds * 1000);
}

function startIdioms(room) {
  room.players.forEach((player) => {
    player.score = 0;
    player.missedIdioms = [];
  });
  room.rounds = ["idioms"];
  room.roundIndex = 0;
  room.idiomPool = shuffled(idioms);
  countdown(room);
}

function beginMemory(room) {
  const nouns = shuffled(room.selected).slice(0, 8);
  room.cards = shuffled(nouns.flatMap((noun) => [
    { noun, kind: "chinese", matched: false },
    { noun, kind: randomInt(2) ? "image" : "english", matched: false },
  ]));
  room.flipped = [];
  room.matches = 0;
  room.turn = 0;
  changePhase(room, "memory");
}

function finishRound(room) {
  changePhase(room, room.roundIndex + 1 === room.rounds.length ? "results" : "round-tally");
}

function beginRound(room) {
  room.turn = 0;
  switch (room.rounds[room.roundIndex]) {
    case "picture":
      room.pool = shuffled(room.studyPool);
      changePhase(room, "picture", room.settings.answerSeconds * 1000);
      break;
    case "memory":
      beginMemory(room);
      break;
    case "taboo":
      room.pool = turnPool(room.selected, room.players.length);
      changePhase(room, "taboo-ready");
      break;
    case "listen":
      room.listenPool = shuffled(room.studyPool).slice(0, 8);
      beginListenQuestion(room);
      break;
    case "idioms":
      beginIdiomQuestion(room);
      break;
  }
}

function beginIdiomQuestion(room) {
  const idiom = room.idiomPool[room.turn];
  const distractors = shuffled(idioms.filter((option) => option !== idiom)).slice(0, 3);
  const choices = shuffled([idiom, ...distractors]);
  room.idiomQuestion = { id: randomUUID(), idiom, choices, answers: new Map() };
  changePhase(room, "idiom-question", room.players.length === 1 ? 0 : 25000);
}

function scoreChoices(players, answers, correctIndex) {
  for (const player of players) {
    if (answers.get(player.id) === correctIndex) player.score++;
  }
}

function submitChoice(room, player, action, question) {
  const { id, choices, answers } = question;
  requireGame(action.questionId === id && (room.deadline === null || Date.now() < room.deadline), "This question has closed.");
  requireGame(!answers.has(player.id), "Your answer is already locked in.");
  requireGame(Number.isInteger(action.index) && action.index >= 0 && action.index < choices.length, "Choose an answer.");
  answers.set(player.id, action.index);
  return room.players.every((p) => answers.has(p.id));
}

function revealIdiomAnswer(room) {
  const { idiom, choices, answers } = room.idiomQuestion;
  const correct = choices.indexOf(idiom);
  scoreChoices(room.players, answers, correct);
  for (const player of room.players) {
    if (answers.get(player.id) !== correct) player.missedIdioms.push(idiom);
  }
  changePhase(room, "idiom-answer");
}

function beginListenQuestion(room) {
  const noun = room.listenPool[room.turn];
  const alternatives = shuffled(room.studyPool.filter((item) => item !== noun));
  const sameList = alternatives.filter((item) => item.listId === noun.listId);
  const otherLists = alternatives.filter((item) => item.listId !== noun.listId);
  const choices = shuffled([noun, ...sameList.concat(otherLists).slice(0, 3)]);
  room.listening = { id: randomUUID(), noun, choices, answers: new Map() };
  changePhase(room, "listen-question", 12000);
}

function nextListenQuestion(room) {
  room.turn++;
  if (room.turn === room.listenPool.length) finishRound(room);
  else beginListenQuestion(room);
}

function revealListenAnswer(room, advance = false) {
  const { noun, choices, answers } = room.listening;
  const correctIndex = choices.indexOf(noun);
  scoreChoices(room.players, answers, correctIndex);
  if (advance) {
    room.listenRecap = { noun, correct: answers.get(room.hostId) === correctIndex };
    nextListenQuestion(room);
  } else {
    room.listenRecap = null;
    changePhase(room, "listen-answer", 3200);
  }
}

function nextPicture(room) {
  room.turn++;
  if (room.turn === room.pool.length) finishRound(room);
  else changePhase(room, "picture", room.settings.answerSeconds * 1000);
}

function nextStudyPage(room) {
  if (++room.page === room.pages.length) countdown(room);
  else changePhase(room, "study", room.players.length === 1 ? 0 : room.settings.studySeconds * 1000);
}

function nextTaboo(room) {
  room.turn++;
  if (room.turn === room.pool.length) finishRound(room);
  else changePhase(room, "taboo-ready");
}

function elapse(room) {
  switch (room.phase) {
    case "study":
      nextStudyPage(room);
      break;
    case "countdown":
      beginRound(room);
      break;
    case "picture":
      changePhase(room, "picture-answer");
      break;
    case "picture-review":
      nextPicture(room);
      break;
    case "memory-miss":
      room.flipped = [];
      room.turn++;
      changePhase(room, "memory");
      break;
    case "memory-complete":
      finishRound(room);
      break;
    case "listen-question":
      revealListenAnswer(room);
      break;
    case "listen-answer":
      nextListenQuestion(room);
      break;
    case "idiom-question":
      revealIdiomAnswer(room);
      break;
    case "taboo-speak":
      changePhase(room, "taboo-answer");
      break;
  }
}

function play(room, player, action, lists) {
  const host = () => requireGame(player.id === room.hostId, "Only the host can do that.");
  const phase = (...phases) => requireGame(phases.includes(room.phase), "That action is unavailable right now.");
  const yourTurn = () => requireGame(player === activePlayer(room), "It is another player's turn.");

  switch (action.type) {
    case "select-mode":
      host();
      phase("lobby");
      requireGame(action.mode === "nouns" || action.mode === "idioms", "Choose a game mode.");
      room.mode = action.mode;
      break;
    case "start":
      host();
      phase("lobby");
      requireGame(room.mode, "Choose a game mode before starting.");
      requireGame(room.players.length >= MIN_PLAYERS && room.players.every((p) => p.socketId),
        "Players must be connected. Remove any disconnected players before starting.");
      if (room.mode === "idioms") startIdioms(room);
      else startNouns(room, lists, action.settings);
      break;
    case "skip-study":
      host();
      phase("study");
      countdown(room);
      break;
    case "next-study":
      host();
      phase("study");
      requireGame(room.players.length === 1, "Study pages advance together in this room.");
      nextStudyPage(room);
      break;
    case "reveal-picture":
      host();
      phase("picture");
      requireGame(room.players.length === 1, "The answer is revealed when time runs out.");
      changePhase(room, "picture-answer");
      break;
    case "judge-picture":
      host();
      if (room.players.length === 1) phase("picture-answer");
      else phase("picture", "picture-answer");
      if (action.correct === true) {
        activePlayer(room).score++;
      } else {
        requireGame(action.correct === false, "Choose Correct or Incorrect.");
      }
      room.feedback = action.correct ? "correct" : "wrong";
      room.pictureCorrect = action.correct;
      changePhase(room, "picture-review", 2400);
      break;
    case "continue":
      host();
      phase("round-tally");
      room.roundIndex++;
      countdown(room);
      break;
    case "flip": {
      phase("memory");
      yourTurn();
      const index = action.index;
      const card = Number.isInteger(index) ? room.cards[index] : null;
      requireGame(card && !card.matched && !room.flipped.includes(index), "Choose a face-down card.");
      room.flipped.push(index);
      if (room.flipped.length === 1) break;

      const first = room.cards[room.flipped[0]];
      if (first.noun === card.noun) {
        first.matched = card.matched = true;
        room.flipped = [];
        room.matches++;
        player.score++;
        room.feedback = "correct";
        if (room.matches * 2 === room.cards.length) changePhase(room, "memory-complete", 650);
      } else {
        room.feedback = "wrong";
        changePhase(room, "memory-miss", 1600);
      }
      break;
    }
    case "pass-memory":
      host();
      phase("memory");
      requireGame(!activePlayer(room).socketId, "The current player is connected.");
      room.flipped = [];
      room.turn++;
      break;
    case "reveal-taboo":
      phase("taboo-ready");
      yourTurn();
      changePhase(room, "taboo-speak", room.settings.describeSeconds * 1000);
      break;
    case "judge-taboo": {
      host();
      phase("taboo-ready", "taboo-speak", "taboo-answer");
      const speaker = activePlayer(room);
      if (action.guesserId !== null) {
        phase("taboo-speak", "taboo-answer");
        const guesser = room.players.find((p) => p.id === action.guesserId);
        requireGame(guesser && guesser !== speaker, "Choose one of the guessers.");
        guesser.score++;
        speaker.score++;
      } else if (room.phase === "taboo-ready") {
        requireGame(!speaker.socketId, "The speaker is connected.");
      }
      room.feedback = action.guesserId === null ? "wrong" : "correct";
      nextTaboo(room);
      break;
    }
    case "listen-answer":
      phase("listen-question");
      if (submitChoice(room, player, action, room.listening)) revealListenAnswer(room, room.players.length === 1);
      break;
    case "idiom-answer":
      phase("idiom-question");
      if (submitChoice(room, player, action, room.idiomQuestion)) revealIdiomAnswer(room);
      break;
    case "next-idiom":
      host();
      phase("idiom-answer");
      room.turn++;
      if (room.turn === room.idiomPool.length) finishRound(room);
      else beginIdiomQuestion(room);
      break;
    case "lobby":
      host();
      phase("results");
      room.players = room.players.filter((p) => p.socketId);
      room.players.forEach((p) => { p.score = 0; });
      changePhase(room, "lobby");
      break;
    default:
      throw new GameError("Unrecognized action.");
  }
}

function idiomStudyCard({ chinese, pinyin, meaning, comic, caption, comicAlt }) {
  return { chinese, pinyin, meaning, comic, caption, comicAlt };
}

function viewFor(room, player) {
  const view = {
    code: room.code,
    mode: room.mode,
    selfId: player.id,
    hostId: room.hostId,
    players: room.players.map(({ id, name, socketId, score, audio }) => ({ id, name, online: Boolean(socketId), score, audio })),
    phase: room.phase,
    deadline: room.deadline,
    duration: room.duration,
    serverTime: Date.now(),
    revision: room.revision,
    feedback: room.feedback,
  };

  const phase = room.phase;
  if (phase === "lobby") {
    if (room.mode === "idioms") {
      view.idiomStudy = idioms.map(idiomStudyCard);
    } else if (room.mode === "nouns") {
      view.settings = room.settings;
      view.eligibleRounds = eligibleRounds(room.players.length);
    }
  }
  if (phase === "study") {
    view.nouns = room.pages[room.page];
    view.page = room.page + 1;
    view.pages = room.pages.length;
  }
  if (phase !== "lobby" && phase !== "study") {
    view.rounds = room.rounds;
    view.roundIndex = room.roundIndex;
    if (room.rounds[room.roundIndex] === "listen" && room.listenRecap) view.listenRecap = room.listenRecap;
  }
  if (phase === "round-tally" || phase === "results") {
    for (const standing of view.players) standing.roundPoints = standing.score - room.roundStartScores.get(standing.id);
    if (room.mode === "idioms") {
      view.idiomReview = player.missedIdioms.map((idiom) => ({
        ...idiomStudyCard(idiom), scenario: idiom.scenario, translation: idiom.translation, reason: idiom.reason,
      }));
    }
  }
  if (room.mode === "nouns" && phase !== "lobby") view.readingClues = room.readingClues;
  if (phase.startsWith("picture")) {
    const noun = room.pool[room.turn];
    view.activeId = activePlayer(room).id;
    view.turn = room.turn + 1;
    view.turns = room.pool.length;
    view.prompt = phase === "picture" ? { image: noun.image } : noun;
    if (phase === "picture-review") view.pictureCorrect = room.pictureCorrect;
  }
  if (phase.startsWith("memory")) {
    view.activeId = activePlayer(room).id;
    view.matches = room.matches;
    view.cards = room.cards.map(({ noun, kind, matched }, index) => {
      if (!matched && !room.flipped.includes(index)) return { face: "hidden" };
      return { face: kind, value: noun[kind], matched };
    });
  }
  if (phase.startsWith("taboo")) {
    view.activeId = activePlayer(room).id;
    view.turn = room.turn + 1;
    view.turns = room.pool.length;
    if (phase === "taboo-answer" || (phase === "taboo-speak" && view.activeId === player.id)) {
      view.prompt = room.pool[room.turn];
    }
  }
  if (phase.startsWith("listen")) {
    const { id, noun, choices, answers } = room.listening;
    view.questionId = id;
    if (phase === "listen-question") view[room.readingClues ? "readingClue" : "spokenWord"] = noun.chinese;
    view.turn = room.turn + 1;
    view.turns = room.listenPool.length;
    view.choices = choices.map(({ image }) => image);
    view.answered = answers.size;
    view.choice = answers.get(player.id) ?? null;
    if (phase === "listen-answer") {
      view.correctIndex = choices.indexOf(noun);
      view.prompt = noun;
    }
  }
  if (phase.startsWith("idiom")) {
    const { id, idiom, choices, answers } = room.idiomQuestion;
    const { chinese, pinyin, meaning, scenario, translation, reason } = idiom;
    view.questionId = id;
    view.turn = room.turn + 1;
    view.turns = room.idiomPool.length;
    view.scenario = scenario;
    view.translation = translation;
    view.choices = choices.map((option) => option.chinese);
    view.answered = answers.size;
    view.choice = answers.get(player.id) ?? null;
    if (phase === "idiom-answer") {
      view.correctIndex = choices.indexOf(idiom);
      view.prompt = { chinese, pinyin, meaning, reason };
    }
  }
  return view;
}

module.exports = { MIN_PLAYERS, MAX_PLAYERS, DEFAULT_SETTINGS, GameError, requireGame, play, elapse, viewFor };

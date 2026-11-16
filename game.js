const { randomInt } = require("node:crypto");

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 8;
const DEFAULT_SETTINGS = { studySeconds: 30, answerSeconds: 5, describeSeconds: 20 };
const TIMER_LIMITS = { studySeconds: [10, 90], answerSeconds: [3, 15], describeSeconds: [10, 45] };

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

function countdown(room, next) {
  room.next = next;
  changePhase(room, "countdown", 3000);
}

function start(room, lists, settings) {
  requireGame(room.players.length >= MIN_PLAYERS && room.players.every((p) => p.socketId),
    "At least three players must be connected. Remove any disconnected players before starting.");
  const listIds = Array.isArray(settings?.listIds) ? [...new Set(settings.listIds)] : [];
  const selected = lists.filter((list) => listIds.includes(list.id)).flatMap((list) => list.nouns);
  requireGame(selected.length >= room.players.length, "Choose enough words for everyone to take a turn.");

  const timers = {};
  for (const [name, [min, max]] of Object.entries(TIMER_LIMITS)) {
    const seconds = settings[name];
    requireGame(Number.isInteger(seconds) && seconds >= min && seconds <= max, "Check the timer settings.");
    timers[name] = seconds;
  }

  room.settings = { listIds, ...timers };
  room.players.forEach((player) => { player.score = 0; });
  room.selected = selected;
  room.pool = turnPool(selected, room.players.length);
  const studyOrder = room.pool.slice().sort((a, b) => a.order - b.order);
  room.pages = [];
  for (let i = 0; i < studyOrder.length; i += 10) room.pages.push(studyOrder.slice(i, i + 10));
  room.page = 0;
  changePhase(room, "study", timers.studySeconds * 1000);
}

function beginMemory(room) {
  const nouns = shuffled(room.selected).slice(0, 20);
  room.cards = shuffled(nouns.flatMap((noun) => [
    { noun, kind: "chinese", matched: false },
    { noun, kind: randomInt(2) ? "image" : "english", matched: false },
  ]));
  room.flipped = [];
  room.matches = 0;
  room.turn = 0;
  changePhase(room, "memory");
}

function nextPicture(room) {
  room.turn++;
  if (room.turn === room.pool.length) changePhase(room, "picture-tally");
  else changePhase(room, "picture", room.settings.answerSeconds * 1000);
}

function nextTaboo(room) {
  room.turn++;
  changePhase(room, room.turn === room.pool.length ? "results" : "taboo-ready");
}

function elapse(room) {
  switch (room.phase) {
    case "study":
      if (room.page + 1 < room.pages.length) {
        room.page++;
        changePhase(room, "study", room.settings.studySeconds * 1000);
      } else countdown(room, "picture");
      break;
    case "countdown":
      if (room.next === "picture") {
        room.pool = shuffled(room.pool);
        room.turn = 0;
        changePhase(room, "picture", room.settings.answerSeconds * 1000);
      } else if (room.next === "memory") {
        beginMemory(room);
      } else {
        room.pool = turnPool(room.selected, room.players.length);
        room.turn = 0;
        changePhase(room, "taboo-ready");
      }
      break;
    case "picture":
      changePhase(room, "picture-answer");
      break;
    case "memory-miss":
      room.flipped = [];
      room.turn++;
      changePhase(room, "memory");
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
    case "start":
      host();
      phase("lobby");
      start(room, lists, action.settings);
      break;
    case "skip-study":
      host();
      phase("study");
      countdown(room, "picture");
      break;
    case "judge-picture":
      host();
      phase("picture", "picture-answer");
      if (action.correct === true) {
        activePlayer(room).score++;
      } else {
        requireGame(action.correct === false, "Choose Correct or Incorrect.");
      }
      room.feedback = action.correct ? "correct" : "wrong";
      nextPicture(room);
      break;
    case "continue":
      host();
      phase("picture-tally", "memory-tally");
      countdown(room, room.phase === "picture-tally" ? "memory" : "taboo");
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
        if (room.matches * 2 === room.cards.length) changePhase(room, "memory-tally");
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
      changePhase(room, "taboo-secret");
      break;
    case "start-taboo":
      phase("taboo-secret");
      yourTurn();
      changePhase(room, "taboo-speak", room.settings.describeSeconds * 1000);
      break;
    case "judge-taboo": {
      host();
      phase("taboo-ready", "taboo-secret", "taboo-speak", "taboo-answer");
      const speaker = activePlayer(room);
      if (action.guesserId !== null) {
        phase("taboo-speak", "taboo-answer");
        const guesser = room.players.find((p) => p.id === action.guesserId);
        requireGame(guesser && guesser !== speaker, "Choose one of the guessers.");
        guesser.score++;
        speaker.score++;
      } else if (room.phase === "taboo-ready" || room.phase === "taboo-secret") {
        requireGame(!speaker.socketId, "The speaker is connected.");
      }
      room.feedback = action.guesserId === null ? "wrong" : "correct";
      nextTaboo(room);
      break;
    }
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

function viewFor(room, player) {
  const view = {
    code: room.code,
    selfId: player.id,
    hostId: room.hostId,
    players: room.players.map(({ id, name, socketId, score }) => ({ id, name, online: Boolean(socketId), score })),
    phase: room.phase,
    deadline: room.deadline,
    duration: room.duration,
    serverTime: Date.now(),
    revision: room.revision,
    feedback: room.feedback,
  };

  const phase = room.phase;
  if (phase === "lobby") view.settings = room.settings;
  if (phase === "study") {
    view.nouns = room.pages[room.page];
    view.page = room.page + 1;
    view.pages = room.pages.length;
  }
  if (phase === "countdown") view.next = room.next;
  if (phase.startsWith("picture") && phase !== "picture-tally") {
    const noun = room.pool[room.turn];
    view.activeId = activePlayer(room).id;
    view.turn = room.turn + 1;
    view.turns = room.pool.length;
    view.prompt = phase === "picture-answer" ? noun : { image: noun.image };
  }
  if (phase === "memory" || phase === "memory-miss") {
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
    if (phase === "taboo-answer" || (phase === "taboo-secret" && view.activeId === player.id)) {
      view.prompt = room.pool[room.turn];
    }
  }
  return view;
}

module.exports = { MIN_PLAYERS, MAX_PLAYERS, DEFAULT_SETTINGS, GameError, requireGame, play, elapse, viewFor };

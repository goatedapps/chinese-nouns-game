const assert = require("node:assert/strict");
const { test } = require("node:test");
const { DEFAULT_SETTINGS, GameError, play, elapse, viewFor } = require("../game");
const { idioms } = require("../idioms");

const nouns = Array.from({ length: 10 }, (_, order) => ({
  chinese: "词" + order,
  listId: "sample",
  image: "assets/images/word-" + order + ".webp",
  order,
}));
const lists = [{ id: "sample", nouns }];

function startRoom(playerCount = 3) {
  const players = ["host", "guest", "friend"].slice(0, playerCount).map((id) => ({ id, name: id, socketId: id, score: 0 }));
  const room = { code: "ABC234", hostId: "host", players, phase: "lobby", mode: "nouns" };
  play(room, players[0], { type: "start", settings: { ...DEFAULT_SETTINGS, listIds: ["sample"] } }, lists);
  return room;
}

function startRound(round, last = false, playerCount = 3) {
  const room = startRoom(playerCount);
  room.rounds = ["picture", "memory", "taboo", "listen"]
    .filter((type) => type !== round && (playerCount >= 3 || type !== "taboo"))
    .slice(0, 2);
  if (last) room.rounds.push(round);
  else room.rounds.unshift(round);
  room.roundIndex = last ? 2 : 0;
  play(room, room.players[0], { type: "skip-study" }, lists);
  elapse(room);
  return room;
}

test("a new session draws three distinct rounds for the shared countdown", () => {
  const room = startRoom();
  const [host, guest] = room.players;
  assert.equal(room.rounds.length, 3);
  assert.equal(new Set(room.rounds).size, 3);
  play(room, host, { type: "skip-study" }, lists);
  assert.deepEqual(viewFor(room, guest).rounds, room.rounds);
  assert.equal(viewFor(room, guest).roundIndex, 0);
});

test("solo and two-player rooms start with all three compatible rounds", () => {
  for (const playerCount of [1, 2]) {
    const room = startRoom(playerCount);
    assert.equal(room.phase, "study");
    assert.deepEqual(room.rounds.slice().sort(), ["listen", "memory", "picture"]);
  }
});

test("solo picture play reveals the word before self-scoring", () => {
  const room = startRound("picture", false, 1);
  const [host] = room.players;
  const correct = { type: "judge-picture", correct: true };
  assert.equal(viewFor(room, host).prompt.chinese, undefined);
  assert.throws(() => play(room, host, correct, lists), GameError);
  play(room, host, { type: "reveal-picture" }, lists);
  assert.equal(room.phase, "picture-answer");
  assert(viewFor(room, host).prompt.chinese);
  play(room, host, correct, lists);
  assert.equal(host.score, 1);
  assert.equal(room.turn, 0);
  assert.equal(room.phase, "picture-review");
  assert.equal(viewFor(room, host).pictureCorrect, true);
  elapse(room);
  assert.equal(room.turn, 1);
  assert.equal(room.phase, "picture");
  elapse(room);
  assert.equal(room.phase, "picture-answer");
});

test("Listen & Tap locks choices privately and scores on reveal", () => {
  const room = startRound("listen");
  const [host, guest, friend] = room.players;
  const questionId = room.listening.id;
  const correct = room.listening.choices.indexOf(room.listening.noun);
  const wrong = (correct + 1) % room.listening.choices.length;
  const choose = (player, index, id = questionId) => play(room, player, {
    type: "listen-answer", questionId: id, index,
  }, lists);

  assert.equal(viewFor(room, guest).choices.length, 4);
  assert.equal(viewFor(room, guest).spokenWord, room.listening.noun.chinese);
  assert.equal(viewFor(room, host).spokenWord, viewFor(room, guest).spokenWord);
  assert.equal(viewFor(room, guest).prompt, undefined);
  assert.equal(viewFor(room, guest).correctIndex, undefined);
  assert.throws(() => choose(host, correct, "stale"), GameError);
  choose(host, correct);
  assert.throws(() => choose(host, wrong), GameError);
  assert.equal(viewFor(room, host).choice, correct);
  assert.equal(viewFor(room, guest).choice, null);
  assert.equal(host.score, 0);
  choose(guest, wrong);
  choose(friend, correct);
  assert.equal(room.phase, "listen-answer");
  assert.deepEqual(room.players.map((player) => player.score), [1, 0, 1]);
  assert.equal(viewFor(room, guest).correctIndex, correct);
  elapse(room);
  assert.notEqual(room.listening.id, questionId);
  assert.throws(() => choose(guest, correct), GameError);
});

test("a final Listen & Tap round reveals on timeout and ends at results", () => {
  const room = startRound("listen", true);
  room.turn = room.listenPool.length - 1;
  elapse(room);
  assert.equal(room.phase, "listen-answer");
  assert.deepEqual(room.players.map((player) => player.score), [0, 0, 0]);
  elapse(room);
  assert.equal(room.phase, "results");
});

test("solo Listen & Tap advances on submission and keeps the previous word for review", () => {
  const room = startRound("listen", true, 1);
  const [player] = room.players;
  const first = room.listening;
  const answer = (question, index) => play(room, player, {
    type: "listen-answer", questionId: question.id, index,
  }, lists);

  answer(first, first.choices.indexOf(first.noun));
  assert.equal(room.phase, "listen-question");
  assert.equal(room.turn, 1);
  assert.notEqual(room.listening.id, first.id);
  assert.equal(player.score, 1);
  assert.deepEqual(viewFor(room, player).listenRecap, { noun: first.noun, correct: true });
  assert.equal(viewFor(room, player).prompt, undefined);
  assert.throws(() => answer(first, 0), GameError);

  room.turn = room.listenPool.length - 1;
  const last = room.listening;
  answer(last, (last.choices.indexOf(last.noun) + 1) % last.choices.length);
  assert.equal(room.phase, "results");
  assert.equal(player.score, 1);
  assert.deepEqual(viewFor(room, player).listenRecap, { noun: last.noun, correct: false });
});

test("Taboo starts the timer when the speaker reveals their private word", () => {
  const room = startRound("taboo");
  const [speaker, guest] = room.players;
  assert.throws(() => play(room, guest, { type: "reveal-taboo" }, lists), GameError);
  play(room, speaker, { type: "reveal-taboo" }, lists);
  assert.equal(room.phase, "taboo-speak");
  assert.equal(room.duration, DEFAULT_SETTINGS.describeSeconds * 1000);
  assert.equal(viewFor(room, speaker).prompt, room.pool[0]);
  assert.equal(viewFor(room, guest).prompt, undefined);
  elapse(room);
  assert.equal(viewFor(room, guest).prompt, room.pool[0]);
});

test("the final memory match stays visible for feedback before advancing", () => {
  const room = startRound("memory");
  const [host] = room.players;
  const noun = room.cards[0].noun;
  const pair = room.cards.findIndex((card, index) => index > 0 && card.noun === noun);
  room.cards.forEach((card, index) => { card.matched = index !== 0 && index !== pair; });
  room.matches = room.cards.length / 2 - 1;
  play(room, host, { type: "flip", index: 0 }, lists);
  play(room, host, { type: "flip", index: pair }, lists);
  assert.equal(host.score, 1);
  assert.equal(room.phase, "memory-complete");
  assert(viewFor(room, host).cards.every((card) => card.matched));
  elapse(room);
  assert.equal(room.phase, "round-tally");
});

test("Guess the Picture can finish a shuffled session", () => {
  const room = startRound("picture", true);
  const [host, guest] = room.players;
  assert.deepEqual(Object.keys(viewFor(room, guest).prompt), ["image"]);
  elapse(room);
  assert(viewFor(room, guest).prompt.chinese);
  for (const word of room.pool) {
    play(room, host, { type: "judge-picture", correct: true }, lists);
    assert.equal(viewFor(room, guest).prompt, word);
    elapse(room);
  }
  assert.equal(room.phase, "results");
  assert.deepEqual(room.players.map((player) => player.score), [3, 3, 3]);
  assert.deepEqual(viewFor(room, guest).players.map((player) => player.roundPoints), [3, 3, 3]);
});

test("study uses short pages and only the solo player advances manually", () => {
  const solo = startRoom(1);
  const [host] = solo.players;
  assert.equal(solo.deadline, null);
  assert.deepEqual(solo.pages.map((page) => page.length), [4, 4, 2]);
  for (let i = 0; i < 3; i++) play(solo, host, { type: "next-study" }, lists);
  assert.equal(solo.phase, "countdown");
  const group = startRoom(2);
  assert.throws(() => play(group, group.players[0], { type: "next-study" }, lists), GameError);
  assert(group.deadline > Date.now());
  elapse(group);
  assert.equal(group.page, 1);
});

test("one unavailable audio device switches Listen & Tap to the same reading clue for the room", () => {
  const room = startRoom(2);
  const [host, guest] = room.players;
  guest.audio = "unavailable";
  room.phase = "lobby";
  play(room, host, { type: "start", settings: room.settings }, lists);
  room.rounds = ["listen"];
  play(room, host, { type: "skip-study" }, lists);
  elapse(room);
  const view = viewFor(room, guest);
  assert.equal(view.readingClues, true);
  assert.equal(view.readingClue, viewFor(room, host).readingClue);
  assert.equal(view.spokenWord, undefined);
  assert.equal(view.prompt, undefined);
  elapse(room);
  assert.equal(viewFor(room, guest).readingClue, undefined);
});

function idiomRoom(playerCount) {
  const players = ["host", "guest"].slice(0, playerCount).map((id) => ({ id, name: id, socketId: id, score: 0 }));
  const room = { code: "IDI234", mode: null, hostId: "host", players, phase: "lobby" };
  play(room, players[0], { type: "select-mode", mode: "idioms" });
  const study = viewFor(room, players[0]).idiomStudy;
  assert.equal(study.length, 10);
  assert(study.every((idiom) => idiom.pinyin && idiom.meaning && idiom.comic && idiom.comicAlt &&
    idiom.caption && !Object.hasOwn(idiom, "scenario")));
  play(room, players[0], { type: "start" });
  elapse(room);
  return room;
}

test("only the host can pick or switch games in the shared lobby", () => {
  const players = ["host", "guest"].map((id) => ({ id, name: id, socketId: id, score: 0 }));
  const [host, guest] = players;
  const room = { code: "ABC234", hostId: host.id, players, phase: "lobby", mode: null };
  const choose = (player, mode) => play(room, player, { type: "select-mode", mode }, lists);
  assert.equal(viewFor(room, guest).mode, null);
  assert.throws(() => play(room, host, { type: "start" }, lists), GameError);
  assert.throws(() => choose(guest, "idioms"), GameError);
  assert.throws(() => choose(host, "unknown"), GameError);
  choose(host, "idioms");
  assert.equal(viewFor(room, guest).idiomStudy.length, 10);
  choose(host, "nouns");
  assert.equal(viewFor(room, guest).mode, "nouns");
  assert.equal(viewFor(room, guest).idiomStudy, undefined);
  play(room, host, { type: "start", settings: { ...DEFAULT_SETTINGS, listIds: ["sample"] } }, lists);
  assert.throws(() => choose(host, "idioms"), GameError);
});

test("solo idiom play is untimed and presents each of the ten terms once", () => {
  const room = idiomRoom(1);
  const [host] = room.players;
  const seen = new Set();
  for (let turn = 1; turn <= idioms.length; turn++) {
    const question = viewFor(room, host);
    const { idiom } = room.idiomQuestion;
    assert.equal(question.turn, turn);
    assert.equal(question.deadline, null);
    assert.equal(question.phase, "idiom-question");
    assert.equal(question.correctIndex, undefined);
    assert.equal(question.prompt, undefined);
    assert.equal(new Set(question.choices).size, 4);
    seen.add(idiom.chinese);
    play(room, host, { type: "idiom-answer", questionId: question.questionId, index: question.choices.indexOf(idiom.chinese) });
    const revealed = viewFor(room, host);
    assert.equal(revealed.phase, "idiom-answer");
    assert.deepEqual(revealed.prompt, { chinese: idiom.chinese, pinyin: idiom.pinyin, meaning: idiom.meaning, reason: idiom.reason });
    play(room, host, { type: "next-idiom" });
  }
  assert.equal(seen.size, 10);
  assert.equal(host.score, 10);
  assert.equal(room.phase, "results");
  assert.deepEqual(viewFor(room, host).idiomReview, []);
});

test("group idiom answers stay private and score when the timer closes", () => {
  const room = idiomRoom(2);
  const [host, guest] = room.players;
  const { id, idiom, choices } = room.idiomQuestion;
  const answer = { type: "idiom-answer", questionId: id, index: choices.indexOf(idiom) };
  assert.equal(room.duration, 25000);
  assert.throws(() => play(room, host, { ...answer, questionId: "old" }), GameError);
  play(room, host, answer);
  assert.throws(() => play(room, host, answer), GameError);
  assert.equal(viewFor(room, guest).choice, null);
  assert.equal(host.score, 0);
  room.deadline = Date.now() - 1;
  assert.throws(() => play(room, guest, answer), GameError);
  elapse(room);
  assert.equal(room.phase, "idiom-answer");
  assert.deepEqual(room.players.map((player) => player.score), [1, 0]);
  assert.throws(() => play(room, guest, { type: "next-idiom" }), GameError);
  assert.equal(viewFor(room, guest).idiomReview, undefined);
  room.idiomPool = [idiom];
  play(room, host, { type: "next-idiom" });
  assert.equal(room.phase, "results");
  assert.deepEqual(viewFor(room, host).idiomReview, []);
  assert.deepEqual(viewFor(room, guest).idiomReview.map((entry) => entry.chinese), [idiom.chinese]);
  assert.equal(viewFor(room, guest).idiomReview[0].reason, idiom.reason);
});

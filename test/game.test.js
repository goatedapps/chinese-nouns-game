const assert = require("node:assert/strict");
const { readFileSync, statSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { DEFAULT_SETTINGS, GameError, play, elapse, viewFor } = require("../game");
const { parseNouns } = require("../nouns");

const nouns = Array.from({ length: 10 }, (_, order) => ({
  chinese: "词" + order,
  listId: "sample",
  image: "assets/images/word-" + order + ".webp",
  order,
}));
const lists = [{ id: "sample", nouns }];

function startRoom(playerCount = 3) {
  const players = ["host", "guest", "friend"].slice(0, playerCount).map((id) => ({ id, name: id, socketId: id, score: 0 }));
  const room = { code: "ABC234", hostId: "host", players, phase: "lobby" };
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
  assert.equal(room.turn, 1);
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
  for (const _ of room.pool) play(room, host, { type: "judge-picture", correct: true }, lists);
  assert.equal(room.phase, "results");
  assert.deepEqual(room.players.map((player) => player.score), [3, 3, 3]);
});

test("every vocabulary entry has a bundled audio clip", () => {
  const root = path.join(__dirname, "..");
  const catalog = parseNouns(readFileSync(path.join(root, "nouns.txt"), "utf8"));
  for (const { nouns } of catalog) {
    for (const { english, image } of nouns) {
      const clip = path.join(root, "audio", path.parse(image).name + ".mp3");
      assert(statSync(clip).size > 1000, `Audio clip is too small for ${english}`);
    }
  }
});

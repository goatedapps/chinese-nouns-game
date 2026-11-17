const { randomBytes, randomInt, randomUUID } = require("node:crypto");
const { readFileSync, readdirSync } = require("node:fs");
const { createServer } = require("node:http");
const path = require("node:path");
const express = require("express");
const QRCode = require("qrcode");
const { Server } = require("socket.io");
const { parseNouns } = require("./nouns");
const { MAX_PLAYERS, DEFAULT_SETTINGS, GameError, requireGame, play, elapse, viewFor } = require("./game");

const imageFiles = new Set(readdirSync(path.join(__dirname, "assets", "images")));
const lists = parseNouns(readFileSync(path.join(__dirname, "nouns.txt"), "utf8"), imageFiles);
const catalog = lists.map(({ id, label, nouns }) => ({ id, label, count: nouns.length }));
const codes = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const codePattern = new RegExp(`^[${codes}]{6}$`);
const rooms = new Map();
const maxRooms = 500;
const roomIdleTime = 2 * 60 * 60 * 1000;

const app = express();
app.disable("x-powered-by");
if (process.env.RENDER === "true") app.set("trust proxy", 1);
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "game.html")));
app.get(["/app.js", "/style.css"], (req, res) => res.sendFile(path.join(__dirname, req.path)));
app.get("/gsap.min.js", (_req, res) => res.sendFile(require.resolve("gsap/dist/gsap.min.js")));
app.use("/assets", express.static(path.join(__dirname, "assets"), { maxAge: "1d" }));
app.get("/health", (_req, res) => res.send("OK"));
app.get("/api/lists", (_req, res) => res.json(catalog));
app.get("/api/rooms/:code/qr", async (req, res) => {
  if (!codePattern.test(req.params.code) || !rooms.has(req.params.code)) return res.sendStatus(404);
  const invite = new URL("/", `${req.protocol}://${req.get("host")}`);
  invite.searchParams.set("room", req.params.code);
  const qr = await QRCode.toBuffer(invite.href, { width: 240, margin: 3 });
  res.set("Cache-Control", "private, max-age=300").type("png").send(qr);
});

const server = createServer(app);
const io = new Server(server, { maxHttpBufferSize: 8192 });

function makeRoom() {
  let code;
  do {
    code = Array.from({ length: 6 }, () => codes[randomInt(codes.length)]).join("");
  } while (rooms.has(code));
  return {
    code,
    players: [],
    phase: "lobby",
    settings: { ...DEFAULT_SETTINGS, listIds: lists.slice(0, 1).map((list) => list.id) },
    revision: 0,
    lastActive: Date.now(),
  };
}

function getRoom(rawCode) {
  const code = typeof rawCode === "string" ? rawCode.trim().toUpperCase() : "";
  requireGame(codePattern.test(code), "Enter the six-character room code.");
  const room = rooms.get(code);
  requireGame(room, "This room has closed or the code is incorrect.");
  return room;
}

function updatePlayers(room) {
  for (const player of room.players) {
    io.sockets.sockets.get(player.socketId)?.emit("room-state", viewFor(room, player));
  }
}

function updateGame(room) {
  clearTimeout(room.timer);
  room.revision++;
  updatePlayers(room);
  if (room.deadline) {
    room.timer = setTimeout(() => {
      room.feedback = null;
      elapse(room);
      updateGame(room);
    }, Math.max(0, room.deadline - Date.now()));
  }
}

function closeRoom(room, message) {
  clearTimeout(room.timer);
  rooms.delete(room.code);
  for (const player of room.players) {
    const socket = io.sockets.sockets.get(player.socketId);
    if (!socket) continue;
    delete socket.data.code;
    delete socket.data.playerId;
    socket.emit("room-closed", message);
  }
}

setInterval(() => {
  for (const room of rooms.values()) {
    if (Date.now() - room.lastActive > roomIdleTime) closeRoom(room, "This room expired after two hours without activity.");
  }
}, 60000).unref();

function addPlayer(room, rawName) {
  const name = typeof rawName === "string" ? rawName.trim().replace(/\s+/g, " ") : "";
  requireGame(name && name.length <= 24, "Enter a name between 1 and 24 characters.");
  requireGame(!room.players.some((p) => p.name.toLowerCase() === name.toLowerCase()),
    "That name is already in use. Choose a different one.");
  const player = { id: randomUUID(), token: randomBytes(32).toString("base64url"), name, score: 0 };
  room.players.push(player);
  return player;
}

function attach(socket, room, player, reply) {
  const previous = io.sockets.sockets.get(player.socketId);
  if (previous && previous !== socket) {
    delete previous.data.code;
    delete previous.data.playerId;
    previous.emit("room-closed", "You opened this seat on another tab.");
  }
  socket.data.code = room.code;
  socket.data.playerId = player.id;
  player.socketId = socket.id;
  room.lastActive = Date.now();
  reply({ ok: true, code: room.code, token: player.token });
  updatePlayers(room);
}

function membership(socket) {
  const room = rooms.get(socket.data.code);
  const player = room?.players.find((p) => p.id === socket.data.playerId && p.socketId === socket.id);
  requireGame(player, "Join a room to play.");
  return { room, player };
}

io.on("connection", (socket) => {
  function handle(event, handler) {
    socket.on(event, (data, reply) => {
      if (typeof reply !== "function") return;
      try {
        handler(data ?? {}, reply);
      } catch (error) {
        if (!(error instanceof GameError)) console.error(error);
        reply({ ok: false, message: error instanceof GameError ? error.message : "The server could not complete that action." });
      }
    });
  }

  handle("enter-room", (data, reply) => {
    requireGame(!socket.data.code, "Leave your current room before joining another.");
    if (data.type === "create") {
      requireGame(rooms.size < maxRooms, "The server is full. Try again later.");
      const room = makeRoom();
      const player = addPlayer(room, data.name);
      room.hostId = player.id;
      rooms.set(room.code, room);
      attach(socket, room, player, reply);
      return;
    }

    const room = getRoom(data.code);
    if (data.type === "resume") {
      requireGame(typeof data.token === "string" && /^[A-Za-z0-9_-]{43}$/.test(data.token), "Your seat is no longer in this room.");
      const player = room.players.find((p) => p.token === data.token);
      requireGame(player, "Your seat is no longer in this room.");
      attach(socket, room, player, reply);
      return;
    }

    requireGame(data.type === "join", "Choose how to enter the room.");
    requireGame(room.phase === "lobby", "This game has already started. Ask the host to let you know when the lobby reopens.");
    requireGame(room.players.length < MAX_PLAYERS, "This room is full.");
    attach(socket, room, addPlayer(room, data.name), reply);
  });

  handle("game-action", (action, reply) => {
    const { room, player } = membership(socket);
    if (action.type === "remove-player") {
      requireGame(player.id === room.hostId && room.phase === "lobby", "Only the host can remove a player in the lobby.");
      const target = room.players.find((p) => p.id === action.playerId);
      requireGame(target && !target.socketId, "You can only remove a disconnected player.");
      room.players = room.players.filter((p) => p !== target);
      updatePlayers(room);
    } else {
      requireGame(action.type === "listen-answer" || action.revision === room.revision, "The game has moved on. Try the current turn.");
      const previousFeedback = room.feedback;
      room.feedback = null;
      try {
        play(room, player, action, lists);
      } catch (error) {
        room.feedback = previousFeedback;
        throw error;
      }
      updateGame(room);
    }
    room.lastActive = Date.now();
    reply({ ok: true });
  });

  handle("leave-room", (_data, reply) => {
    const { room, player } = membership(socket);
    reply({ ok: true });
    delete socket.data.code;
    delete socket.data.playerId;
    if (player.id === room.hostId) {
      closeRoom(room, "The host closed the room.");
      return;
    }
    delete player.socketId;
    delete player.token;
    if (room.phase === "lobby") room.players = room.players.filter((p) => p !== player);
    updatePlayers(room);
  });

  socket.on("disconnect", () => {
    const room = rooms.get(socket.data.code);
    const player = room?.players.find((p) => p.id === socket.data.playerId && p.socketId === socket.id);
    if (!player) return;
    delete player.socketId;
    updatePlayers(room);
  });
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, "0.0.0.0", () => {
  console.log(`Chinese Nouns Game listening on port ${server.address().port}`);
});

// Server för Dodge! multiplayer med lobby & två lägen (normal/advanced)
// Kör lokalt: node server.js
// På Render: Start Command = node server.js

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" }
});

// Spelkonstanter
const WIDTH = 640, HEIGHT = 480;
const ENEMY_SIZE = 30;
const TICK_MS = 50;          // uppdateringstakt
const SPAWN_MS = 700;        // fiendespawn
const SPEED_MIN = 2;
const SPEED_MAX = 5;

// Rum per MP-läge
const rooms = {
  normal: makeEmptyRoom("normal"),
  advanced: makeEmptyRoom("advanced"),
};

function makeEmptyRoom(mode) {
  return {
    mode,
    players: {},          // id -> { x, y, alive, ready }
    enemies: [],          // {x,y,speed}
    started: false,
    firstDeathId: null,
    tickTimer: null,
    spawnTimer: null,
  };
}

function resetRoom(room) {
  if (room.tickTimer) clearInterval(room.tickTimer);
  if (room.spawnTimer) clearInterval(room.spawnTimer);
  room.enemies = [];
  room.started = false;
  room.firstDeathId = null;
  room.tickTimer = null;
  room.spawnTimer = null;
  // Spelare ligger kvar i rummet men flaggor nollas
  for (const id of Object.keys(room.players)) {
    const p = room.players[id];
    if (!p) continue;
    p.alive = true;
    p.ready = false;
    // Standardstartpositioner
    if (room.mode === "normal") {
      p.x = WIDTH/2 - 25; p.y = HEIGHT - 20;
    } else {
      p.x = WIDTH/2 - ENEMY_SIZE/2; p.y = HEIGHT - ENEMY_SIZE - 10;
    }
  }
}

function broadcastRoomState(roomName) {
  const room = rooms[roomName];
  io.to(roomName).emit("stateUpdate", {
    players: room.players,
    enemies: room.enemies
  });
}

function startMatchIfReady(roomName) {
  const room = rooms[roomName];
  if (room.started) return;

  const ids = Object.keys(room.players);
  if (ids.length !== 2) return; // kräver exakt 2 spelare
  const [a, b] = ids;
  if (!room.players[a]?.ready || !room.players[b]?.ready) return;

  // Starta match
  room.started = true;
  room.enemies = [];
  room.firstDeathId = null;

  // Timers
  room.tickTimer = setInterval(() => {
    // Flytta fiender
    room.enemies = room.enemies.map(e => ({ ...e, y: e.y + e.speed }));
    // Ta bort fiender utanför banan
    room.enemies = room.enemies.filter(e => e.y < HEIGHT + ENEMY_SIZE);

    // Kollisioner (server-bestämd)
    for (const pid of Object.keys(room.players)) {
      const p = room.players[pid];
      if (!p.alive) continue;
      if (collidesWithAnyEnemy(p, room.enemies)) {
        p.alive = false;
        if (!room.firstDeathId) {
          // Första död → direkt LOSER till den spelaren
          room.firstDeathId = pid;
          io.to(pid).emit("you_lost");
        } else {
          // Andra död → WINNER till den som inte dog först
          const winnerId = (pid === room.firstDeathId) ? otherId(room, pid) : room.firstDeathId;
          if (winnerId) io.to(winnerId).emit("you_won");
          // Match över
          io.to(roomName).emit("matchOver");
          resetRoom(room);
        }
      }
    }
    broadcastRoomState(roomName);
  }, TICK_MS);

  room.spawnTimer = setInterval(() => {
    // Spawna fiende
    room.enemies.push({
      x: Math.floor(Math.random() * (WIDTH - ENEMY_SIZE)),
      y: -ENEMY_SIZE,
      speed: SPEED_MIN + Math.random() * (SPEED_MAX - SPEED_MIN)
    });
  }, SPAWN_MS);

  // Sänd matchStart till båda
  io.to(roomName).emit("matchStart", {
    mode: room.mode,
    players: room.players,
    enemies: room.enemies
  });
}

function otherId(room, id) {
  const ids = Object.keys(room.players).filter(x => x !== id);
  return ids[0] || null;
}

function rectsIntersect(x1,y1,w1,h1,x2,y2,w2,h2){
  return !(x1+w1 <= x2 || x1 >= x2+w2 || y1+h1 <= y2 || y1 >= y2+h2);
}

function collidesWithAnyEnemy(p, enemies) {
  const w = (p.h && p.w) ? p.w : ENEMY_SIZE;
  const h = (p.h && p.w) ? p.h : ENEMY_SIZE;
  for (const e of enemies) {
    if (rectsIntersect(e.x, e.y, ENEMY_SIZE, ENEMY_SIZE, p.x, p.y, w, h)) {
      return true;
    }
  }
  return false;
}

io.on("connection", (socket) => {
  // Klienten väljer lobby/mode
  socket.on("joinLobby", ({ mode }) => {
    const roomName = mode === "advanced" ? "advanced" : "normal";
    const room = rooms[roomName];

    // Begränsa till 2 spelare
    if (Object.keys(room.players).length >= 2 && !room.players[socket.id]) {
      socket.emit("room_full", { mode: roomName });
      return;
    }

    socket.join(roomName);

    // Lägg/uppdatera spelare i rummet
    room.players[socket.id] = {
      x: room.mode === "normal" ? WIDTH/2 - 25 : WIDTH/2 - ENEMY_SIZE/2,
      y: room.mode === "normal" ? HEIGHT - 20 : HEIGHT - ENEMY_SIZE - 10,
      w: room.mode === "normal" ? 50 : ENEMY_SIZE,
      h: room.mode === "normal" ? 10 : ENEMY_SIZE,
      alive: true,
      ready: false
    };

    // Skicka lobby-status
    socket.emit("joined", { mode: roomName });
    io.to(roomName).emit("lobby", {
      mode: roomName,
      players: room.players,
      started: room.started
    });
  });

  socket.on("setReady", ({ mode, ready }) => {
    const roomName = mode === "advanced" ? "advanced" : "normal";
    const room = rooms[roomName];
    if (!room.players[socket.id]) return;
    room.players[socket.id].ready = !!ready;

    io.to(roomName).emit("lobby", {
      mode: roomName,
      players: room.players,
      started: room.started
    });

    startMatchIfReady(roomName);
  });

  socket.on("playerMove", ({ mode, x, y }) => {
    const roomName = mode === "advanced" ? "advanced" : "normal";
    const room = rooms[roomName];
    const p = room.players[socket.id];
    if (!p) return;
    if (!room.started) return;
    // Klient skickar sin position (server kan clamp:a lite)
    p.x = Math.max(0, Math.min(WIDTH - p.w, x));
    p.y = Math.max(0, Math.min(HEIGHT - p.h, y));
  });

  socket.on("disconnect", () => {
    // Ta bort spelare från alla rum
    for (const roomName of ["normal","advanced"]) {
      const room = rooms[roomName];
      if (room.players[socket.id]) {
        const wasAlive = room.players[socket.id].alive;
        delete room.players[socket.id];
        // Om match pågår och någon lämnar → andra vinner direkt
        if (room.started) {
          const remainingIds = Object.keys(room.players);
          if (remainingIds.length === 1) {
            io.to(remainingIds[0]).emit("you_won");
            io.to(roomName).emit("matchOver");
          }
          resetRoom(room);
        } else {
          io.to(roomName).emit("lobby", {
            mode: roomName,
            players: room.players,
            started: room.started
          });
        }
      }
    }
  });
});

app.get("/", (req, res) => {
  res.send("Dodge! multiplayer server körs 🚀");
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server körs på port ${PORT}`);
});

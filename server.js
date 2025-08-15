// Enkel Socket.IO-server för Dodge! multiplayer
// Kör med: node server.js

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" } // Tillåter anslutningar från alla domäner (för test)
});

let players = {};
let enemies = [];
let gameStarted = false;

// Skicka uppdateringar till alla spelare var 50ms
setInterval(() => {
  if (gameStarted) {
    io.emit("stateUpdate", { players, enemies });
  }
}, 50);

io.on("connection", (socket) => {
  console.log(`Ny spelare anslöt: ${socket.id}`);

  // Lägg till spelare
  players[socket.id] = {
    x: 300,
    y: 400,
    alive: true
  };

  // Skicka nuvarande spelstatus
  socket.emit("init", { id: socket.id, players, enemies });

  socket.on("playerMove", (data) => {
    if (players[socket.id]) {
      players[socket.id].x = data.x;
      players[socket.id].y = data.y;
    }
  });

  socket.on("playerDied", () => {
    if (players[socket.id]) {
      players[socket.id].alive = false;
    }
  });

  socket.on("disconnect", () => {
    console.log(`Spelare frånkopplad: ${socket.id}`);
    delete players[socket.id];
  });
});

// Enkel start av fiender (kan byggas ut)
setInterval(() => {
  if (gameStarted) {
    enemies.push({
      x: Math.random() * 600,
      y: 0,
      speed: 2 + Math.random() * 3
    });
    // Flytta fiender
    enemies = enemies.map(e => ({ ...e, y: e.y + e.speed }));
    // Ta bort fiender som är utanför banan
    enemies = enemies.filter(e => e.y < 500);
  }
}, 500);

app.get("/", (req, res) => {
  res.send("Dodge! multiplayer server körs 🚀");
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server körs på port ${PORT}`);
});

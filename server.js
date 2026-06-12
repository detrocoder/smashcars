const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Game rooms: roomId -> { players: {socketId: playerData}, state, interval }
const rooms = {};

function makePlayer(id, slot) {
  return {
    id, slot,
    x: slot === 0 ? 80 : 600,
    y: 210,
    vx: 0, vy: 0,
    angle: slot === 0 ? 0 : Math.PI,
    hp: 100,
    ammo: 10,
    weapon: 'rocket',
    shielded: 0,
    score: 0,
    keys: {}
  };
}

function makeRoom(roomId) {
  return {
    id: roomId,
    players: {},
    bullets: [],
    pickups: [],
    frame: 0,
    gameOver: false,
    interval: null
  };
}

function spawnPickups(room) {
  const weapons = ['rocket', 'laser', 'bomb', 'shield'];
  while (room.pickups.length < 4) {
    room.pickups.push({
      id: Math.random().toString(36).slice(2),
      x: 120 + Math.random() * 440,
      y: 40 + Math.random() * 340,
      type: weapons[Math.floor(Math.random() * weapons.length)]
    });
  }
}

const WALLS = [
  { x: 334, y: 80, w: 12, h: 260 },
  { x: 60, y: 202, w: 120, h: 16 },
  { x: 500, y: 202, w: 120, h: 16 }
];
const W = 680, H = 420;

function collidesWall(car) {
  for (const w of WALLS) {
    if (car.x + 14 > w.x && car.x - 14 < w.x + w.w &&
        car.y + 9 > w.y && car.y - 9 < w.y + w.h) {
      car.vx *= -0.5; car.vy *= -0.5;
      if (car.x < w.x + w.w / 2) car.x = w.x - 14;
      else car.x = w.x + w.w + 14;
    }
  }
  if (car.x < 14) { car.x = 14; car.vx *= -0.5; }
  if (car.x > W - 14) { car.x = W - 14; car.vx *= -0.5; }
  if (car.y < 9) { car.y = 9; car.vy *= -0.5; }
  if (car.y > H - 9) { car.y = H - 9; car.vy *= -0.5; }
}

function tickRoom(room) {
  if (room.gameOver) return;
  const plist = Object.values(room.players);
  if (plist.length < 2) return;

  room.frame++;

  for (const car of plist) {
    const k = car.keys;
    if (k['a'] || k['A']) car.angle -= 0.055;
    if (k['d'] || k['D']) car.angle += 0.055;
    if (k['w'] || k['W']) { car.vx += Math.cos(car.angle) * 0.4; car.vy += Math.sin(car.angle) * 0.4; }
    if (k['s'] || k['S']) { car.vx -= Math.cos(car.angle) * 0.2; car.vy -= Math.sin(car.angle) * 0.2; }
    if (k['ArrowLeft']) car.angle -= 0.055;
    if (k['ArrowRight']) car.angle += 0.055;
    if (k['ArrowUp']) { car.vx += Math.cos(car.angle) * 0.4; car.vy += Math.sin(car.angle) * 0.4; }
    if (k['ArrowDown']) { car.vx -= Math.cos(car.angle) * 0.2; car.vy -= Math.sin(car.angle) * 0.2; }

    const spd = Math.sqrt(car.vx * car.vx + car.vy * car.vy);
    if (spd > 2.8) { car.vx = car.vx / spd * 2.8; car.vy = car.vy / spd * 2.8; }
    car.vx *= 0.85; car.vy *= 0.85;
    car.x += car.vx; car.y += car.vy;
    collidesWall(car);
    if (car.shielded > 0) car.shielded--;
  }

  // Car-car collision
  const [c1, c2] = plist;
  const dx = c1.x - c2.x, dy = c1.y - c2.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 26 && dist > 0) {
    const nx = dx / dist, ny = dy / dist;
    c1.vx += nx * 1.5; c1.vy += ny * 1.5;
    c2.vx -= nx * 1.5; c2.vy -= ny * 1.5;
    if (!c1.shielded) c1.hp = Math.max(0, c1.hp - 2);
    if (!c2.shielded) c2.hp = Math.max(0, c2.hp - 2);
  }

  // Bullets
  room.bullets = room.bullets.filter(b => {
    b.x += b.vx; b.y += b.vy; b.life--;
    if (b.life <= 0 || b.x < 0 || b.x > W || b.y < 0 || b.y > H) return false;
    const target = plist.find(p => p.id !== b.ownerId);
    if (!target) return false;
    const bdx = b.x - target.x, bdy = b.y - target.y;
    if (Math.sqrt(bdx * bdx + bdy * bdy) < 18) {
      if (!target.shielded) {
        const dmg = b.type === 'rocket' ? 22 : b.type === 'laser' ? 12 : b.type === 'bomb' ? 35 : 5;
        target.hp = Math.max(0, target.hp - dmg);
      }
      b.hit = { x: b.x, y: b.y, type: b.type, shielded: !!target.shielded };
      return false;
    }
    return true;
  });

  // Pickups
  room.pickups = room.pickups.filter(pu => {
    for (const car of plist) {
      const pdx = car.x - pu.x, pdy = car.y - pu.y;
      if (Math.sqrt(pdx * pdx + pdy * pdy) < 20) {
        if (pu.type === 'shield') { car.shielded = 180; car.hp = Math.min(100, car.hp + 20); }
        else { car.weapon = pu.type; car.ammo = 10; }
        pu.pickedBy = car.id;
        return false;
      }
    }
    return true;
  });

  if (room.pickups.length < 2 && room.frame % 120 === 0) spawnPickups(room);

  // Win check
  for (const car of plist) {
    if (car.hp <= 0) {
      room.gameOver = true;
      const winner = plist.find(p => p.hp > 0) || plist[0];
      winner.score++;
      io.to(room.id).emit('gameOver', { winnerId: winner.id, winnerSlot: winner.slot });
      clearInterval(room.interval);
      room.interval = null;
      break;
    }
  }

  // Ammo regen
  for (const car of plist) {
    if (car.ammo === 0 && room.frame % 180 === 0) car.ammo = 10;
  }

  io.to(room.id).emit('state', {
    players: plist.map(p => ({
      id: p.id, slot: p.slot, x: p.x, y: p.y,
      vx: p.vx, vy: p.vy, angle: p.angle,
      hp: p.hp, ammo: p.ammo, weapon: p.weapon,
      shielded: p.shielded, score: p.score
    })),
    bullets: room.bullets,
    pickups: room.pickups,
    frame: room.frame
  });
}

io.on('connection', socket => {
  let currentRoom = null;
  let mySlot = null;

  socket.on('joinRoom', ({ roomId }) => {
    if (!rooms[roomId]) rooms[roomId] = makeRoom(roomId);
    const room = rooms[roomId];
    const playerCount = Object.keys(room.players).length;
    if (playerCount >= 2) { socket.emit('roomFull'); return; }

    mySlot = playerCount;
    currentRoom = roomId;
    room.players[socket.id] = makePlayer(socket.id, mySlot);
    socket.join(roomId);
    socket.emit('joined', { slot: mySlot, roomId });

    if (Object.keys(room.players).length === 2) {
      spawnPickups(room);
      room.gameOver = false;
      io.to(roomId).emit('startGame', { players: Object.values(room.players).map(p => ({ id: p.id, slot: p.slot, score: p.score })) });
      room.interval = setInterval(() => tickRoom(room), 1000 / 60);
    } else {
      socket.emit('waiting');
    }
  });

  socket.on('keys', (keyState) => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const player = rooms[currentRoom].players[socket.id];
    if (player) player.keys = keyState;
  });

  socket.on('shoot', () => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];
    const car = room.players[socket.id];
    if (!car || car.ammo <= 0 || car.shielded > 0 || room.gameOver) return;
    car.ammo = Math.max(0, car.ammo - 1);
    const spd = car.weapon === 'laser' ? 9 : car.weapon === 'rocket' ? 6 : 5;
    room.bullets.push({
      id: Math.random().toString(36).slice(2),
      x: car.x + Math.cos(car.angle) * 20,
      y: car.y + Math.sin(car.angle) * 20,
      vx: Math.cos(car.angle) * spd,
      vy: Math.sin(car.angle) * spd,
      ownerId: socket.id,
      type: car.weapon,
      life: car.weapon === 'laser' ? 20 : car.weapon === 'bomb' ? 90 : 60
    });
  });

  socket.on('restartGame', () => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];
    if (Object.keys(room.players).length < 2) return;
    const scores = {};
    Object.values(room.players).forEach(p => scores[p.id] = p.score);
    Object.values(room.players).forEach((p, i) => {
      p.x = i === 0 ? 80 : 600; p.y = 210;
      p.vx = 0; p.vy = 0;
      p.angle = i === 0 ? 0 : Math.PI;
      p.hp = 100; p.ammo = 10;
      p.weapon = 'rocket'; p.shielded = 0;
      p.keys = {};
      p.score = scores[p.id];
    });
    room.bullets = []; room.pickups = []; room.frame = 0; room.gameOver = false;
    spawnPickups(room);
    io.to(room.id).emit('startGame', { players: Object.values(room.players).map(p => ({ id: p.id, slot: p.slot, score: p.score })) });
    if (room.interval) clearInterval(room.interval);
    room.interval = setInterval(() => tickRoom(room), 1000 / 60);
  });

  socket.on('disconnect', () => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];
    delete room.players[socket.id];
    if (room.interval) { clearInterval(room.interval); room.interval = null; }
    io.to(currentRoom).emit('playerLeft');
    if (Object.keys(room.players).length === 0) delete rooms[currentRoom];
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`SmashCars running on port ${PORT}`));

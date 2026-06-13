const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};
const W = 680, H = 420;

const WALLS = [
  { x: 310, y: 60,  w: 60,  h: 14 },
  { x: 310, y: 346, w: 60,  h: 14 },
  { x: 60,  y: 180, w: 14,  h: 60 },
  { x: 606, y: 180, w: 14,  h: 60 },
  { x: 200, y: 120, w: 14,  h: 50 },
  { x: 466, y: 250, w: 14,  h: 50 },
];

function makePlayer(id, slot, name) {
  const starts = [
    { x: 80,     y: H/2, angle: 0 },
    { x: W - 80, y: H/2, angle: Math.PI }
  ];
  return {
    id, slot, name: name || `Player ${slot + 1}`,
    x: starts[slot].x, y: starts[slot].y,
    vx: 0, vy: 0,
    angle: starts[slot].angle,
    hp: 100, maxHp: 100,
    ammo: 10, maxAmmo: 10,
    weapon: 'rocket',
    shielded: 0,
    score: 0,
    keys: {},
    ammoRegen: 0,
    invincible: 0
  };
}

function makeRoom(roomId) {
  return { id: roomId, players: {}, bullets: [], pickups: [], particles: [], frame: 0, gameOver: false, interval: null, chat: [] };
}

function spawnPickups(room) {
  const types = ['rocket','laser','bomb','shield','speed','health','mine'];
  const spots = [
    {x:160,y:120},{x:500,y:120},{x:160,y:290},{x:500,y:290},
    {x:340,y:210},{x:260,y:170},{x:420,y:250}
  ];
  while (room.pickups.length < 5) {
    const spot = spots[Math.floor(Math.random() * spots.length)];
    const already = room.pickups.find(p => Math.abs(p.x - spot.x) < 30 && Math.abs(p.y - spot.y) < 30);
    if (!already) {
      room.pickups.push({
        id: Math.random().toString(36).slice(2),
        x: spot.x + (Math.random() - 0.5) * 20,
        y: spot.y + (Math.random() - 0.5) * 20,
        type: types[Math.floor(Math.random() * types.length)]
      });
    } else break;
  }
}

function wallCollide(car) {
  for (const w of WALLS) {
    if (car.x + 14 > w.x && car.x - 14 < w.x + w.w &&
        car.y + 9  > w.y && car.y - 9  < w.y + w.h) {
      car.vx *= -0.6; car.vy *= -0.6;
      const overlapL = (car.x + 14) - w.x;
      const overlapR = (w.x + w.w) - (car.x - 14);
      const overlapT = (car.y + 9) - w.y;
      const overlapB = (w.y + w.h) - (car.y - 9);
      const min = Math.min(overlapL, overlapR, overlapT, overlapB);
      if (min === overlapL) car.x = w.x - 14;
      else if (min === overlapR) car.x = w.x + w.w + 14;
      else if (min === overlapT) car.y = w.y - 9;
      else car.y = w.y + w.h + 9;
    }
  }
  if (car.x < 14)     { car.x = 14;     car.vx *= -0.5; }
  if (car.x > W - 14) { car.x = W - 14; car.vx *= -0.5; }
  if (car.y < 9)      { car.y = 9;      car.vy *= -0.5; }
  if (car.y > H - 9)  { car.y = H - 9;  car.vy *= -0.5; }
}

// Simple AI bot
function tickBot(bot, target, room) {
  const dx = target.x - bot.x, dy = target.y - bot.y;
  const dist = Math.sqrt(dx*dx + dy*dy);
  const angleToTarget = Math.atan2(dy, dx);
  let da = angleToTarget - bot.angle;
  while (da > Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;

  bot.keys = {};
  if (Math.abs(da) < 0.15) {
    bot.keys['w'] = true;
    if (dist < 120 && Math.abs(da) < 0.2 && bot.ammo > 0 && room.frame % 40 === 0) {
      fireBullet(room, bot);
    }
  } else if (da > 0) {
    bot.keys['d'] = true; bot.keys['w'] = true;
  } else {
    bot.keys['a'] = true; bot.keys['w'] = true;
  }
  if (dist < 50) bot.keys['s'] = true;
}

function fireBullet(room, car) {
  if (car.ammo <= 0 || car.shielded > 0) return;
  const spd = car.weapon === 'laser' ? 9 : car.weapon === 'rocket' ? 6 : 5;
  room.bullets.push({
    id: Math.random().toString(36).slice(2),
    x: car.x + Math.cos(car.angle) * 20,
    y: car.y + Math.sin(car.angle) * 20,
    vx: Math.cos(car.angle) * spd,
    vy: Math.sin(car.angle) * spd,
    ownerId: car.id,
    type: car.weapon,
    life: car.weapon === 'laser' ? 18 : car.weapon === 'bomb' ? 90 : 60,
    r: car.weapon === 'bomb' ? 7 : 4
  });
  car.ammo = Math.max(0, car.ammo - 1);
}

function tickRoom(room) {
  if (room.gameOver) return;
  const plist = Object.values(room.players);
  if (plist.length === 0) return;

  room.frame++;

  // AI tick
  if (plist.length === 2) {
    const bot = plist.find(p => p.isBot);
    const human = plist.find(p => !p.isBot);
    if (bot && human) tickBot(bot, human, room);
  }

  // Move players
  for (const car of plist) {
    const k = car.keys;
    const spd = car.speedBoost > 0 ? 4.2 : 2.8;
    if (k['a']||k['A']||k['ArrowLeft'])  car.angle -= 0.058;
    if (k['d']||k['D']||k['ArrowRight']) car.angle += 0.058;
    if (k['w']||k['W']||k['ArrowUp'])   { car.vx += Math.cos(car.angle)*0.42; car.vy += Math.sin(car.angle)*0.42; }
    if (k['s']||k['S']||k['ArrowDown']) { car.vx -= Math.cos(car.angle)*0.22; car.vy -= Math.sin(car.angle)*0.22; }

    const s = Math.sqrt(car.vx*car.vx + car.vy*car.vy);
    if (s > spd) { car.vx = car.vx/s*spd; car.vy = car.vy/s*spd; }
    car.vx *= 0.84; car.vy *= 0.84;
    car.x += car.vx; car.y += car.vy;
    wallCollide(car);
    if (car.shielded > 0) car.shielded--;
    if (car.invincible > 0) car.invincible--;
    if (car.speedBoost > 0) car.speedBoost--;
    if (car.ammo === 0) {
      car.ammoRegen++;
      if (car.ammoRegen >= 180) { car.ammo = 10; car.ammoRegen = 0; }
    }
  }

  // Car-car collision
  if (plist.length === 2) {
    const [c1, c2] = plist;
    const dx = c1.x - c2.x, dy = c1.y - c2.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist < 28 && dist > 0) {
      const nx = dx/dist, ny = dy/dist;
      c1.vx += nx*1.8; c1.vy += ny*1.8;
      c2.vx -= nx*1.8; c2.vy -= ny*1.8;
      if (!c1.shielded && !c1.invincible) c1.hp = Math.max(0, c1.hp - 3);
      if (!c2.shielded && !c2.invincible) c2.hp = Math.max(0, c2.hp - 3);
    }
  }

  // Mines check
  room.bullets = room.bullets.filter(b => {
    if (b.type === 'mine' && b.placed) {
      for (const car of plist) {
        if (car.id === b.ownerId) continue;
        const dx = b.x - car.x, dy = b.y - car.y;
        if (Math.sqrt(dx*dx+dy*dy) < 22) {
          if (!car.shielded && !car.invincible) car.hp = Math.max(0, car.hp - 30);
          b.exploded = true;
          return false;
        }
      }
      b.life--;
      return b.life > 0;
    }
    b.x += b.vx; b.y += b.vy; b.life--;
    if (b.life <= 0 || b.x < 0 || b.x > W || b.y < 0 || b.y > H) return false;
    const target = plist.find(p => p.id !== b.ownerId);
    if (!target) return false;
    const bdx = b.x - target.x, bdy = b.y - target.y;
    if (Math.sqrt(bdx*bdx + bdy*bdy) < 18) {
      if (!target.shielded && !target.invincible) {
        const dmg = b.type==='rocket'?22 : b.type==='laser'?12 : b.type==='bomb'?35 : 8;
        target.hp = Math.max(0, target.hp - dmg);
      }
      b.hit = { x: b.x, y: b.y, type: b.type };
      return false;
    }
    return true;
  });

  // Pickups
  room.pickups = room.pickups.filter(pu => {
    for (const car of plist) {
      const dx = car.x - pu.x, dy = car.y - pu.y;
      if (Math.sqrt(dx*dx+dy*dy) < 22) {
        if (pu.type === 'shield')  { car.shielded = 200; }
        else if (pu.type === 'health') { car.hp = Math.min(100, car.hp + 35); car.invincible = 60; }
        else if (pu.type === 'speed')  { car.speedBoost = 240; }
        else { car.weapon = pu.type; car.ammo = 12; }
        pu.taken = true; return false;
      }
    }
    return true;
  });

  if (room.pickups.length < 3 && room.frame % 150 === 0) spawnPickups(room);

  // Win check
  for (const car of plist) {
    if (car.hp <= 0 && !room.gameOver) {
      room.gameOver = true;
      const winner = plist.find(p => p.hp > 0) || plist[0];
      winner.score++;
      clearInterval(room.interval); room.interval = null;
      io.to(room.id).emit('gameOver', { winnerId: winner.id, winnerSlot: winner.slot, winnerName: winner.name });
      break;
    }
  }

  io.to(room.id).emit('state', {
    players: plist.map(p => ({
      id: p.id, slot: p.slot, name: p.name,
      x: p.x, y: p.y, angle: p.angle,
      hp: p.hp, ammo: p.ammo, weapon: p.weapon,
      shielded: p.shielded, score: p.score,
      speedBoost: p.speedBoost || 0, invincible: p.invincible || 0,
      ammoRegen: p.ammoRegen || 0, isBot: p.isBot || false
    })),
    bullets: room.bullets,
    pickups: room.pickups,
    frame: room.frame
  });
}

io.on('connection', socket => {
  let currentRoom = null;

  socket.on('joinRoom', ({ roomId, playerName, vsBot }) => {
    const rid = roomId.toLowerCase().replace(/\s+/g,'').slice(0,20);
    if (!rooms[rid]) rooms[rid] = makeRoom(rid);
    const room = rooms[rid];
    if (Object.keys(room.players).length >= 2) { socket.emit('roomFull'); return; }

    const slot = Object.keys(room.players).length;
    currentRoom = rid;
    room.players[socket.id] = makePlayer(socket.id, slot, playerName || `Player ${slot+1}`);
    socket.join(rid);
    socket.emit('joined', { slot, roomId: rid });

    if (vsBot && slot === 0) {
      // Add AI bot
      const botId = 'bot_' + rid;
      room.players[botId] = makePlayer(botId, 1, '🤖 Bot');
      room.players[botId].isBot = true;
      spawnPickups(room);
      io.to(rid).emit('startGame', { players: Object.values(room.players).map(p => ({ id: p.id, slot: p.slot, name: p.name, isBot: p.isBot })) });
      room.interval = setInterval(() => tickRoom(room), 1000/60);
    } else if (Object.keys(room.players).length === 2) {
      spawnPickups(room);
      io.to(rid).emit('startGame', { players: Object.values(room.players).map(p => ({ id: p.id, slot: p.slot, name: p.name, isBot: p.isBot })) });
      room.interval = setInterval(() => tickRoom(room), 1000/60);
    } else {
      socket.emit('waiting');
    }
  });

  socket.on('keys', k => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const p = rooms[currentRoom].players[socket.id];
    if (p) p.keys = k;
    socket.emit('keysAck');
  });

  socket.on('shoot', () => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];
    const car = room.players[socket.id];
    if (!car || room.gameOver) return;
    if (car.weapon === 'mine') {
      room.bullets.push({ id: Math.random().toString(36).slice(2), x: car.x, y: car.y, vx:0, vy:0, ownerId: car.id, type:'mine', placed:true, life:600 });
      car.ammo = Math.max(0, car.ammo - 1);
    } else {
      fireBullet(room, car);
    }
  });

  socket.on('chat', ({ msg }) => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];
    const p = room.players[socket.id];
    if (!p || !msg) return;
    const entry = { name: p.name, msg: msg.slice(0, 80), slot: p.slot, t: Date.now() };
    room.chat.push(entry);
    if (room.chat.length > 20) room.chat.shift();
    io.to(currentRoom).emit('chat', entry);
  });

  socket.on('restartGame', () => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];
    const scores = {};
    Object.values(room.players).forEach(p => scores[p.id] = p.score);
    Object.values(room.players).forEach((p, i) => {
      const starts = [{x:80,y:H/2,angle:0},{x:W-80,y:H/2,angle:Math.PI}];
      const s = starts[p.slot];
      p.x=s.x; p.y=s.y; p.angle=s.angle;
      p.vx=0; p.vy=0; p.hp=100; p.ammo=10;
      p.weapon='rocket'; p.shielded=0; p.speedBoost=0; p.invincible=0;
      p.ammoRegen=0; p.keys={}; p.score=scores[p.id];
    });
    room.bullets=[]; room.pickups=[]; room.frame=0; room.gameOver=false;
    spawnPickups(room);
    io.to(room.id).emit('startGame', { players: Object.values(room.players).map(p => ({ id:p.id, slot:p.slot, name:p.name, isBot:p.isBot })) });
    if (room.interval) clearInterval(room.interval);
    room.interval = setInterval(() => tickRoom(room), 1000/60);
  });

  socket.on('disconnect', () => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];
    delete room.players[socket.id];
    // Remove bot if human leaves
    Object.keys(room.players).forEach(k => { if (room.players[k].isBot) delete room.players[k]; });
    if (room.interval) { clearInterval(room.interval); room.interval = null; }
    io.to(currentRoom).emit('playerLeft');
    if (Object.keys(room.players).length === 0) delete rooms[currentRoom];
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`SmashCars v2 on port ${PORT}`));

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { createServer as createViteServer } from "vite";
import { Player, GameState, Block, OnlineUser } from "./src/shared/types.js";
import { LEVELS } from "./src/shared/levels.js";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const PORT = 3000;

// Game State & Constants
const TICK_RATE = 1000 / 60; // 60 FPS update
const GRAVITY = 0.5;
const JUMP_FORCE = -11; 
const MOVE_SPEED = 5; 
const PLAYER_SIZE = 30;
const FRICTION = 0.8; 

const rooms: Record<string, GameState> = {};
const playerRoomMap: Record<string, string> = {};
const onlineUsers: Record<string, OnlineUser> = {};

function broadcastOnlineUsers() {
   io.emit("onlineUsers", Object.values(onlineUsers));
}

function generateStitchedMap(numMaps: number): { blocks: Block[], finishLine: any, width: number, height: number, bgTheme: string } {
    const blocks: Block[] = [];
    let currentXOffset = 0;
    let finalWidth = 0;
    let maxHeight = 0;
    
    // Pick first map randomly for theme
    const firstMapIndex = Math.floor(Math.random() * LEVELS.length);
    const bgTheme = LEVELS[firstMapIndex].bgTheme;
    
    let lastFinishLine: any = null;

    for (let i = 0; i < numMaps; i++) {
        const levelIndex = (i === 0) ? firstMapIndex : Math.floor(Math.random() * LEVELS.length);
        const level = LEVELS[levelIndex];
        
        if (i > 0) {
            blocks.push({
                x: currentXOffset - 150,
                y: 550,
                width: 300,
                height: 50
            });
        }
        
        // Copy and shift blocks
        for (const block of level.blocks) {
            blocks.push({
                ...block,
                x: block.x + currentXOffset
            });
        }
        
        lastFinishLine = {
            ...level.finishLine,
            x: level.finishLine.x + currentXOffset
        };
        
        currentXOffset += level.width;
        finalWidth = currentXOffset;
        maxHeight = Math.max(maxHeight, level.height);
    }
    
    return {
        blocks,
        finishLine: lastFinishLine,
        width: finalWidth,
        height: maxHeight,
        bgTheme
    };
}

function createRoom(): GameState {
  const roomId = Math.random().toString(36).substring(2, 9);
  const stitched = generateStitchedMap(3);
  
  let cp1 = 50;
  let cp2X = stitched.width * 0.33;
  let cp2 = 50;
  for (const b of stitched.blocks) {
      if (b.x <= cp2X && b.x > cp2 && b.y >= 200) cp2 = b.x + 10;
  }
  let cp3X = stitched.width * 0.66;
  let cp3 = cp2;
  for (const b of stitched.blocks) {
      if (b.x <= cp3X && b.x > cp3 && b.y >= 200) cp3 = b.x + 10;
  }
  
  const state: GameState = {
    id: roomId,
    players: {},
    blocks: stitched.blocks,
    finishLine: stitched.finishLine,
    mapWidth: stitched.width,
    mapHeight: stitched.height,
    currentLevel: 1,
    raceCount: 1,
    totalRaces: 1,
    finishCounter: 1,
    countdown: null,
    status: 'waiting',
    waitTimer: 312,
    bgTheme: stitched.bgTheme,
    checkpoints: [cp1, cp2, cp3],
  };
  
  rooms[roomId] = state;
  return state;
}

function createSinglePlayerRoom(): GameState {
  const roomId = "sp_" + Math.random().toString(36).substring(2, 9);
  const stitched = generateStitchedMap(10);
  
  const state: GameState = {
    id: roomId,
    players: {},
    blocks: stitched.blocks,
    finishLine: stitched.finishLine,
    mapWidth: stitched.width,
    mapHeight: stitched.height,
    currentLevel: 1,
    raceCount: 1,
    totalRaces: 1,
    finishCounter: 1,
    countdown: null,
    status: 'playing',
    waitTimer: null,
    bgTheme: stitched.bgTheme,
    checkpoints: [50],
    isSinglePlayer: true
  };
  
  rooms[roomId] = state;
  return state;
}

function nextLevel(room: GameState) {
    // Save placements
    Object.values(room.players).forEach(p => {
        if (p.currentPlacement !== null) {
            p.placements.push(p.currentPlacement);
        } else {
            p.placements.push(room.finishCounter); // The last place
        }
    });

    if (room.raceCount >= room.totalRaces) {
        room.status = 'finished';
        room.countdown = null;
        return;
    }

    let currentLevelIndex = room.currentLevel - 1;
    currentLevelIndex = (currentLevelIndex + 1) % LEVELS.length;
    
    room.blocks = LEVELS[currentLevelIndex].blocks;
    room.finishLine = LEVELS[currentLevelIndex].finishLine;
    room.mapWidth = LEVELS[currentLevelIndex].width;
    room.mapHeight = LEVELS[currentLevelIndex].height;
    room.currentLevel = currentLevelIndex + 1;
    room.raceCount++;
    room.finishCounter = 1;
    room.countdown = null;
    room.bgTheme = LEVELS[currentLevelIndex].bgTheme;

    Object.values(room.players).forEach(p => {
      p.x = 50 + (Math.random() * 50);
      p.y = 100;
      p.vx = 0;
      p.vy = 0;
      p.finished = false;
      p.currentPlacement = null;
    });
    
    io.to(room.id).emit("stateUpdate", room);
}

const colors = ["#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#6366f1", "#ec4899"];
let colorIndex = 0;

// AABB Collision Detection
function checkCollision(r1: {x: number, y: number, width: number, height: number}, r2: {x: number, y: number, width: number, height: number}) {
  return (
    r1.x < r2.x + r2.width &&
    r1.x + r1.width > r2.x &&
    r1.y < r2.y + r2.height &&
    r1.y + r1.height > r2.y
  );
}

type ActionStep = { left: boolean, right: boolean, jump: boolean, frames: number };

// Predictive AI Simulation (Model Predictive Control)
function predictOutcome(player: Player, room: GameState, sequence: ActionStep[]): number {
    let { x, y, vx, vy, isGrounded } = player;
    
    for (const step of sequence) {
        for (let f = 0; f < step.frames; f++) {
            // Apply input
            if (step.left) vx = -MOVE_SPEED;
            else if (step.right) vx = MOVE_SPEED;
            else vx *= FRICTION;
            
            // Jump only allowed on first frame of a step if grounded
            if (f === 0 && step.jump && isGrounded) {
                vy = JUMP_FORCE;
                isGrounded = false;
            }
            
            vy += GRAVITY;
            x += vx;
            
            for (const block of room.blocks) {
                if (checkCollision({ x, y, width: player.width, height: player.height }, block)) {
                    if (vx > 0) x = block.x - player.width;
                    else if (vx < 0) x = block.x + block.width;
                    vx = 0;
                }
            }
            
            if (x < 0) { x = 0; vx = 0; }
            if (x + player.width > room.mapWidth) { x = room.mapWidth - player.width; vx = 0; }
            
            y += vy;
            isGrounded = false;
            
            for (const block of room.blocks) {
                if (checkCollision({ x, y, width: player.width, height: player.height }, block)) {
                    if (vy > 0) {
                        y = block.y - player.height;
                        isGrounded = true;
                    } else if (vy < 0) {
                        y = block.y + block.height;
                    }
                    vy = 0;
                }
            }
            
            if (y > room.mapHeight + 100) return -9999; // Death penalty
        }
    }
    
    let score = x;
    // Small incentive to climb higher
    score -= (y * 0.1);
    
    // Apply stuck penalty only if it ends the simulation stuck
    if (vx === 0) score -= 500; 
    
    return score;
}

// Game Loop
setInterval(() => {
  for (const roomId in rooms) {
    const room = rooms[roomId];
    
    if (room.status === 'waiting') {
      if (Object.keys(room.players).length >= 4) {
         room.status = 'playing';
         room.waitTimer = null;
      } else if (room.waitTimer !== null) {
         room.waitTimer--;
         if (room.waitTimer <= 0) {
             const numBots = Math.max(0, 4 - Object.keys(room.players).length);
             for (let i = 0; i < numBots; i++) {
                 const botId = "bot_" + Math.random().toString(36).substring(2, 9);
                 const color = colors[colorIndex % colors.length];
                 colorIndex++;
                 
                 // Give bots some skins occasionally!
                 const botsSkins = ["", "", "", "skin_cowboy", "skin_robot", "skin_alien", "skin_devil", "skin_king"];
                 const randomSkin = botsSkins[Math.floor(Math.random() * botsSkins.length)];
                 
                 room.players[botId] = {
                     id: botId,
                     x: 50 + (Math.random() * 50),
                     y: 100,
                     vx: 0,
                     vy: 0,
                     width: PLAYER_SIZE,
                     height: PLAYER_SIZE,
                     color,
                     isGrounded: false,
                     finished: false,
                     isBot: true,
                     displayName: "Bot " + (i + 1),
                     skin: randomSkin !== "" ? randomSkin : undefined,
                     placements: [],
                     currentPlacement: null,
                     input: { left: false, right: false, jump: false }
                 };
             }
             room.status = 'playing';
             room.waitTimer = null;
         }
      }
    }

    const players = Object.values(room.players);
    let anyoneFinished = false;

    // Apply forces
    for (const player of players) {
      if (player.finished) {
          anyoneFinished = true;
          continue;
      }

      if (room.status === 'playing') {
        // Bot logic
        if (player.isBot) {
           // @ts-ignore
           player.aiCooldown = (player.aiCooldown || 0) - 1;
           // @ts-ignore
           if (player.aiCooldown > 0) {
               // Skip heavy AI evaluation to save CPU, keep using previous inputs
           } else {
               // @ts-ignore
               player.aiCooldown = 4; // Evaluate every 4 frames (saves 75% CPU)

               // PREDICTIVE AI: Evaluate sequences of actions (MPC)
               const rightSequences = [
               [{ right: true, left: false, jump: false, frames: 30 }], 
               [{ right: true, left: false, jump: true, frames: 30 }],  
               [{ right: true, left: false, jump: false, frames: 10 }, { right: true, left: false, jump: true, frames: 20 }], 
               [{ right: true, left: false, jump: false, frames: 20 }, { right: true, left: false, jump: true, frames: 10 }]  
           ];
           const leftSequences = [
               [{ right: false, left: true, jump: false, frames: 30 }], 
               [{ right: false, left: true, jump: true, frames: 30 }],  
               [{ right: false, left: true, jump: false, frames: 10 }, { right: false, left: true, jump: true, frames: 20 }],
               [{ right: false, left: true, jump: false, frames: 20 }, { right: false, left: true, jump: true, frames: 10 }]
           ];
           const idleSequences = [
               [{ right: false, left: false, jump: false, frames: 30 }], 
               [{ right: false, left: false, jump: true, frames: 10 }, { right: true, left: false, jump: false, frames: 20 }], 
               [{ right: false, left: false, jump: true, frames: 10 }, { right: false, left: true, jump: false, frames: 20 }]  
           ];
           
           let scoreRight = -Infinity;
           let bestRightSeq = rightSequences[0];
           for (const seq of rightSequences) {
               const s = predictOutcome(player, room, seq);
               if (s > scoreRight) { scoreRight = s; bestRightSeq = seq; }
           }
           
           let scoreLeft = -Infinity;
           let bestLeftSeq = leftSequences[0];
           for (const seq of leftSequences) {
               const s = predictOutcome(player, room, seq);
               if (s > scoreLeft) { scoreLeft = s; bestLeftSeq = seq; }
           }
           
           let scoreIdle = -Infinity;
           let bestIdleSeq = idleSequences[0];
           for (const seq of idleSequences) {
               const s = predictOutcome(player, room, seq);
               if (s > scoreIdle) { scoreIdle = s; bestIdleSeq = seq; }
           }
           
           if (player.isGrounded) {
               // Grounded: Pick absolute best without hysteresis
               let bestScore = scoreRight;
               let bestAction = bestRightSeq[0];
               
               if (scoreLeft > bestScore) {
                   bestScore = scoreLeft;
                   bestAction = bestLeftSeq[0];
               }
               if (scoreIdle > bestScore) {
                   bestScore = scoreIdle;
                   bestAction = bestIdleSeq[0];
               }
               
               player.input.left = bestAction.left;
               player.input.right = bestAction.right;
               player.input.jump = bestAction.jump;
               
               // 5% chance to make a mistake
               if (Math.random() < 0.05) {
                   if (Math.random() < 0.5) {
                       player.input.jump = !player.input.jump;
                   } else {
                       player.input.right = false;
                   }
               }
           } else {
               // Mid-air: Require hysteresis to change direction
               if (scoreLeft > scoreRight + 50 && scoreLeft > scoreIdle) {
                   player.input.left = true;
                   player.input.right = false;
               } else if (scoreIdle > scoreRight + 50) {
                   player.input.left = false;
                   player.input.right = false;
               } else {
                   player.input.left = false;
                   player.input.right = true;
               }
               player.input.jump = false;
            }
           }
        }
        
        // Input horizontal
        if (player.input.left) {
          player.vx = -MOVE_SPEED;
        } else if (player.input.right) {
          player.vx = MOVE_SPEED;
        } else {
          player.vx *= FRICTION; // simple friction
        }

        // Input jump
        if ((player.input.jump || player.jumpBuffered) && player.isGrounded) {
          player.vy = JUMP_FORCE;
          player.isGrounded = false;
        }
        player.jumpBuffered = false; // Always consume buffer each physics frame
      } else {
        player.vx *= FRICTION;
      }

      // Apply gravity
      player.vy += GRAVITY;

      // Move X
      player.x += player.vx;

      
      // Check map block collision X
      for (const block of room.blocks) {
        if (checkCollision({ x: player.x, y: player.y, width: player.width, height: player.height }, block)) {
          if (player.vx > 0) player.x = block.x - player.width;
          else if (player.vx < 0) player.x = block.x + block.width;
          player.vx = 0;
        }
      }
      // Check player-player collision X
      for (const other of players) {
        if (other.id !== player.id && !player.finished && !other.finished && checkCollision(player, other)) {
           if (player.vx > 0) player.x = other.x - player.width;
           else if (player.vx < 0) player.x = other.x + other.width;
           player.vx = 0;
        }
      }
      // Boundaries X
      if (player.x < 0) { player.x = 0; player.vx = 0; }
      if (player.x + player.width > room.mapWidth) { player.x = room.mapWidth - player.width; player.vx = 0; }

      // Move Y
      player.y += player.vy;
      player.isGrounded = false;

      // Check map block collision Y
      for (const block of room.blocks) {
        if (checkCollision({ x: player.x, y: player.y, width: player.width, height: player.height }, block)) {
          if (player.vy > 0) { // falling
            player.y = block.y - player.height;
            player.isGrounded = true;
          } else if (player.vy < 0) { // jumping up into block
            player.y = block.y + block.height;
          }
          player.vy = 0;
        }
      }
      // Check player-player collision Y (allowing stacking)
      for (const other of players) {
        if (other.id !== player.id && !player.finished && !other.finished && checkCollision(player, other)) {
          if (player.vy > 0) {
            player.y = other.y - player.height;
            player.isGrounded = true;
          } else if (player.vy < 0) {
            player.y = other.y + other.height;
          }
          player.vy = 0;
        }
      }
      // Boundaries Y
      if (player.y > room.mapHeight + 100) { // fell off
        if (room.isSinglePlayer) {
             room.status = 'finished';
             player.finished = true;
        } else {
             player.y = 100;
             let respawnX = room.checkpoints[0];
             for (const cp of room.checkpoints) {
                 if (player.x > cp) {
                     respawnX = cp;
                 }
             }
             player.x = respawnX;
             player.vy = 0;
             player.vx = 0;
        }
      }

      if (room.isSinglePlayer) {
          player.score = Math.floor(player.x / 10);
          
          if (player.x > room.mapWidth - 3000) {
              const randomLevel = LEVELS[Math.floor(Math.random() * LEVELS.length)];
              
              room.blocks.push({
                  x: room.mapWidth - 150,
                  y: 550,
                  width: 300,
                  height: 50
              });
              
              for (const block of randomLevel.blocks) {
                  room.blocks.push({
                      ...block,
                      x: block.x + room.mapWidth
                  });
              }
              room.mapWidth += randomLevel.width;
              room.mapHeight = Math.max(room.mapHeight, randomLevel.height);
              io.to(room.id).emit("stateUpdate", room);
          }
      }

      // Check finish line
      if (checkCollision(player, room.finishLine)) {
        if (!player.finished) {
           player.currentPlacement = room.finishCounter++;
        }
        player.finished = true;
        anyoneFinished = true;
      }
    }

    if (anyoneFinished && room.countdown === null) {
        room.countdown = 20 * 60; // 20 seconds at 60 fps
    }

    if (room.countdown !== null) {
        room.countdown--;
        if (room.countdown <= 0) {
            nextLevel(room);
        }
    }

    const emitRoom = { ...room, blocks: [], finishLine: undefined };
    io.to(roomId).emit("stateUpdate", emitRoom);
  }
}, TICK_RATE);


io.on("connection", (socket) => {
  socket.on("auth", (user) => {
    onlineUsers[socket.id] = {
       ...user,
       socketId: socket.id,
       status: 'idle'
    };
    broadcastOnlineUsers();
  });

  const enterGame = (room: GameState, displayName?: string, skin?: string) => {
    const startX = 50 + (Math.random() * 50);
    const color = colors[colorIndex % colors.length];
    colorIndex++;

    room.players[socket.id] = {
      id: socket.id,
      x: startX,
      y: 100,
      vx: 0,
      vy: 0,
      width: PLAYER_SIZE,
      height: PLAYER_SIZE,
      color,
      isGrounded: false,
      finished: false,
      placements: [],
      currentPlacement: null,
      input: { left: false, right: false, jump: false },
      displayName: displayName,
      skin: skin
    };
    
    playerRoomMap[socket.id] = room.id;
    socket.join(room.id);

    if (onlineUsers[socket.id]) {
        onlineUsers[socket.id].status = 'playing';
        broadcastOnlineUsers();
    }
    socket.emit("stateUpdate", room);
  };

  socket.on("findGame", (data: { displayName?: string; skin?: string } = {}) => {
    if (playerRoomMap[socket.id]) {
      const oldRoomId = playerRoomMap[socket.id];
      if (rooms[oldRoomId] && rooms[oldRoomId].players[socket.id]) {
          delete rooms[oldRoomId].players[socket.id];
      }
    }

    if (onlineUsers[socket.id]) {
        onlineUsers[socket.id].status = 'searching';
        broadcastOnlineUsers();
    }

    socket.emit("searching");
    setTimeout(() => {
      // Find room in rooms with < 4 players and no countdown and status is waiting
      let foundRoom = Object.values(rooms).find(r => Object.keys(r.players).length < 4 && r.countdown === null && r.status === 'waiting' && !r.isSinglePlayer);
      if (!foundRoom) {
          foundRoom = createRoom();
      }
      
      enterGame(foundRoom, data.displayName, data.skin);
    }, 1500); 
  });

  socket.on("startSinglePlayer", (data: { displayName?: string; skin?: string } = {}) => {
    if (playerRoomMap[socket.id]) {
      const oldRoomId = playerRoomMap[socket.id];
      if (rooms[oldRoomId] && rooms[oldRoomId].players[socket.id]) {
          delete rooms[oldRoomId].players[socket.id];
      }
    }

    if (onlineUsers[socket.id]) {
        onlineUsers[socket.id].status = 'playing';
        broadcastOnlineUsers();
    }

    const newRoom = createSinglePlayerRoom();
    enterGame(newRoom, data.displayName, data.skin);
  });

  socket.on("inviteUser", (targetSocketId) => {
     let roomId = playerRoomMap[socket.id];
     if (!roomId) {
         // Create a room specifically for this party
         const newRoom = createRoom();
         enterGame(newRoom, onlineUsers[socket.id]?.displayName);
         roomId = newRoom.id;
     }

     const sender = onlineUsers[socket.id];
     if (sender && onlineUsers[targetSocketId]) {
         io.to(targetSocketId).emit("inviteReceived", sender, roomId);
     }
  });

  socket.on("acceptInvite", (roomId, data) => {
     if (rooms[roomId]) {
         enterGame(rooms[roomId], data?.displayName || onlineUsers[socket.id]?.displayName, data?.skin);
     }
  });

  socket.on("declineInvite", (targetSocketId) => {
     const decliner = onlineUsers[socket.id];
     if (decliner) {
         io.to(targetSocketId).emit("inviteDeclined", decliner.displayName);
     }
  });

  socket.on("input", (input) => {
    const roomId = playerRoomMap[socket.id];
    if (roomId && rooms[roomId] && rooms[roomId].players[socket.id]) {
      const p = rooms[roomId].players[socket.id];
      // Buffer jump if it was pressed, so fast taps aren't lost between ticks
      if (!p.input.jump && input.jump) {
          p.jumpBuffered = true;
      }
      p.input = input;
    }
  });

  socket.on("leaveGame", () => {
    const roomId = playerRoomMap[socket.id];
    if (roomId && rooms[roomId]) {
      if (rooms[roomId].status === 'playing' || rooms[roomId].status === 'finished') {
          const p = rooms[roomId].players[socket.id];
          if (p) {
              p.isBot = true;
              p.displayName = (p.displayName ? p.displayName.split(' ')[0] : "Player") + " (Bot)";
          }
      } else {
          delete rooms[roomId].players[socket.id];
      }
      socket.leave(roomId);
      delete playerRoomMap[socket.id];
    }
    if (onlineUsers[socket.id]) {
        onlineUsers[socket.id].status = 'idle';
        broadcastOnlineUsers();
    }
  });

  socket.on("disconnect", () => {
    const roomId = playerRoomMap[socket.id];
    if (roomId && rooms[roomId]) {
      if (rooms[roomId].status === 'playing' || rooms[roomId].status === 'finished') {
          const p = rooms[roomId].players[socket.id];
          if (p) {
              p.isBot = true;
              p.displayName = (p.displayName ? p.displayName.split(' ')[0] : "Player") + " (Bot)";
          }
      } else {
          delete rooms[roomId].players[socket.id];
          if (Object.keys(rooms[roomId].players).length === 0) {
              delete rooms[roomId];
          }
      }
      delete playerRoomMap[socket.id];
    }
    if (onlineUsers[socket.id]) {
        delete onlineUsers[socket.id];
        broadcastOnlineUsers();
    }
  });
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();


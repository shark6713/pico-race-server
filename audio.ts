import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { GameState, PlayerInput } from "./shared/types";
import { Trophy, RotateCcw, Zap, LogIn, LogOut } from "lucide-react";
import { audioManager } from "./audio";
import { auth, googleProvider, getUserProfile, updateUserProfile } from "./firebase";
import { UserProfile, STORE_ITEMS } from "./shared/types";
import { signInWithPopup, User, onAuthStateChanged, signOut, signInAnonymously } from "firebase/auth";
import { Capacitor } from '@capacitor/core';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const prevMeRef = useRef<any>(null);
  const localInputRef = useRef<PlayerInput>({ left: false, right: false, jump: false });
  const [socket, setSocket] = useState<Socket | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [myId, setMyId] = useState<string>("");
  const [isSearching, setIsSearching] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  
  const [onlineUsers, setOnlineUsers] = useState<any[]>([]);
  const [showLobby, setShowLobby] = useState(false);
  const [showStore, setShowStore] = useState(false);
  const [invitation, setInvitation] = useState<{ from: any, roomId: string } | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    if (user && !user.uid.startsWith("guest_")) {
        getUserProfile(user.uid).then(profile => {
            setUserProfile(profile);
        });
    }
  }, [user]);

  useEffect(() => {
    if (user && socket && isConnected) {
       socket.emit("auth", {
          uid: user.uid,
          displayName: user.displayName,
          email: user.email,
          photoURL: user.photoURL
       });
    }
  }, [user, socket, isConnected]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => {
      setUser(u);
    });
    return unsub;
  }, []);

  const handleLogin = async () => {
    try {
      if (Capacitor.isNativePlatform()) {
        // Firebase gerektirmeden sahte bir kullanıcı oluştur
        const fakeId = "guest_" + Math.random().toString(36).substring(2, 9);
        setUser({
          uid: fakeId,
          displayName: "Misafir",
          email: null,
          photoURL: null
        } as any);
      } else {
        await signInWithPopup(auth, googleProvider);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };


  const [energy, setEnergy] = useState<number>(() => {
    const saved = localStorage.getItem("picoEnergy");
    return saved !== null ? parseInt(saved, 10) : 30;
  });

  const lastTickRef = useRef<number>((() => {
    const saved = localStorage.getItem("picoEnergyTime");
    return saved !== null ? parseInt(saved, 10) : Date.now();
  })());

  const [timeUntilNext, setTimeUntilNext] = useState<number | null>(null);

  const [adWatchesLeft, setAdWatchesLeft] = useState<number>(() => {
    const saved = localStorage.getItem("picoAdWatches");
    return saved !== null ? parseInt(saved, 10) : 2;
  });

  const [isWatchingAd, setIsWatchingAd] = useState(false);

  useEffect(() => {
    localStorage.setItem("picoEnergy", energy.toString());
    localStorage.setItem("picoEnergyTime", lastTickRef.current.toString());
    localStorage.setItem("picoAdWatches", adWatchesLeft.toString());
  }, [energy, adWatchesLeft]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (energy >= 30) {
         lastTickRef.current = Date.now();
         setTimeUntilNext(null);
         return;
      }
      
      const now = Date.now();
      const diff = now - lastTickRef.current;
      const minutes30 = 30 * 60 * 1000; // 30 minutes in ms
      
      if (diff >= minutes30) {
          const ticks = Math.floor(diff / minutes30);
          lastTickRef.current = now - (diff % minutes30);
          localStorage.setItem("picoEnergyTime", lastTickRef.current.toString());
          setEnergy(e => Math.min(30, e + ticks));
      } else {
          setTimeUntilNext(Math.ceil((minutes30 - diff) / 1000));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [energy]);


  const isInGame = gameState?.players[myId] !== undefined;

  const handleJoinGame = () => {
    if (!user) return; // Need login
    audioManager.init();
    audioManager.resume();
    // Unlimited energy
    socket?.emit("findGame", { 
        displayName: user.displayName || undefined,
        skin: userProfile?.equippedSkin || undefined
    });
  };

  const handleWatchAd = () => {
    if (adWatchesLeft > 0) {
        setIsWatchingAd(true);
        setTimeout(() => {
            setIsWatchingAd(false);
            setEnergy(e => Math.min(30, e + 15));
            setAdWatchesLeft(a => a - 1);
        }, 3000); // simulate 3 sec ad
    }
  };

  const handleLeaveGame = () => {
    socket?.emit("leaveGame");
    setGameState(null);
  };

  const handleInvite = (targetSocketId: string) => {
    socket?.emit("inviteUser", targetSocketId);
  };

  const handleAcceptInvite = () => {
    if (invitation) {
       audioManager.init();
       audioManager.resume();
       socket?.emit("acceptInvite", invitation.roomId, { 
          displayName: user?.displayName || undefined,
          skin: userProfile?.equippedSkin || undefined
       });
       setInvitation(null);
    }
  };

  const handleDeclineInvite = () => {
    if (invitation) {
       socket?.emit("declineInvite", invitation.from.socketId);
       setInvitation(null);
    }
  };

  useEffect(() => {
    // Determine the protocol based on the current window location
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    
    // Connect to the socket server using env var if available (for Android/Capacitor)
    const serverUrl = import.meta.env.VITE_SERVER_URL || `${protocol}//${host}`;
    const newSocket = io(serverUrl, {
      transports: ["websocket"],
      reconnectionAttempts: 5,
      extraHeaders: {
        "Bypass-Tunnel-Reminder": "true"
      }
    });
    
    setSocket(newSocket);

    newSocket.on("connect", () => {
      setIsConnected(true);
      if (newSocket.id) setMyId(newSocket.id);
    });

    newSocket.on("disconnect", () => {
      setIsConnected(false);
      setIsSearching(false);
    });

    newSocket.on("searching", () => {
      setIsSearching(true);
    });

    newSocket.on("onlineUsers", (users: any[]) => {
      setOnlineUsers(users);
    });

    newSocket.on("inviteReceived", (from: any, roomId: string) => {
      setInvitation({ from, roomId });
    });

    newSocket.on("inviteDeclined", (by: string) => {
       alert(`${by} declined your invite.`);
    });

    newSocket.on("stateUpdate", (state: GameState) => {
      setGameState(state);
      setIsSearching(false);
      
      if (newSocket.id) {
        const me = state.players[newSocket.id];
        if (me && prevMeRef.current) {
          if (prevMeRef.current.isGrounded && !me.isGrounded && me.vy < -5) {
            audioManager.playJump();
          }
          if (!prevMeRef.current.isGrounded && me.isGrounded) {
            audioManager.playLand();
          }
          if (!prevMeRef.current.finished && me.finished) {
            audioManager.playWin();
            if (me.currentPlacement && userProfile && !user?.uid.startsWith("guest_")) {
                let coinsWon = 10;
                if (me.currentPlacement === 1) coinsWon = 100;
                else if (me.currentPlacement === 2) coinsWon = 50;
                else if (me.currentPlacement === 3) coinsWon = 20;
                
                const newCoins = userProfile.coins + coinsWon;
                setUserProfile({ ...userProfile, coins: newCoins });
                updateUserProfile(userProfile.uid, { coins: newCoins });
            }
          }
        }
        prevMeRef.current = me || null;
      }
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  // Handle inputs
  useEffect(() => {
    if (!socket) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "a") localInputRef.current.left = true;
      if (e.key === "ArrowRight" || e.key === "d") localInputRef.current.right = true;
      if (e.key === "ArrowUp" || e.key === "w" || e.key === " ") localInputRef.current.jump = true;
      socket.emit("input", { ...localInputRef.current });
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "a") localInputRef.current.left = false;
      if (e.key === "ArrowRight" || e.key === "d") localInputRef.current.right = false;
      if (e.key === "ArrowUp" || e.key === "w" || e.key === " ") localInputRef.current.jump = false;
      socket.emit("input", { ...localInputRef.current });
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [socket]);

  // Render loop
  useEffect(() => {
    if (!canvasRef.current || !gameState) return;
    const canvas = canvasRef.current;
    
    // Make canvas fully responsive while keeping logical height at 600
    const rect = canvas.parentElement?.getBoundingClientRect();
    if (rect && rect.height > 0) {
       const aspect = rect.width / rect.height;
       const targetWidth = Math.floor(600 * aspect);
       if (canvas.width !== targetWidth) canvas.width = targetWidth;
       if (canvas.height !== 600) canvas.height = 600;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Camera logic
    const me = gameState.players[myId];
    
    // Default camera at start
    let cameraX = 0;
    
    // Only center on player if they are in the game
    if (me) {
      cameraX = me.x - canvas.width / 2 + me.width / 2;
    }
    
    // Clamp camera to map bounds
    if (cameraX < 0) cameraX = 0;
    if (gameState.mapWidth) {
      if (cameraX + canvas.width > gameState.mapWidth) cameraX = gameState.mapWidth - canvas.width;
    }

    ctx.save();
    
    // Clear the whole logical canvas in case there's something outside bounds
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const theme = gameState.bgTheme || 'space';
    let topColor = "#09090b";
    let bottomColor = "#1e1b4b";
    let starColor = "#ffffff";
    
    if (theme === "cyberpunk") { topColor = "#020617"; bottomColor = "#3b0764"; }
    else if (theme === "neon") { topColor = "#172554"; bottomColor = "#0f172a"; }
    else if (theme === "retro") { topColor = "#2a0646"; bottomColor = "#831843"; }
    else if (theme === "matrix") { topColor = "#022c22"; bottomColor = "#064e3b"; starColor = "#10b981"; }
    else if (theme === "synthwave") { topColor = "#581c87"; bottomColor = "#be185d"; starColor = "#fbcfe8"; }
    else if (theme === "ocean") { topColor = "#083344"; bottomColor = "#1e3a8a"; starColor = "#67e8f9"; }
    else if (theme === "lavender") { topColor = "#312e81"; bottomColor = "#7e22ce"; starColor = "#e9d5ff"; }
    else if (theme === "crimson") { topColor = "#450a0a"; bottomColor = "#7f1d1d"; starColor = "#fecaca"; }
    else if (theme === "gold") { topColor = "#422006"; bottomColor = "#854d0e"; starColor = "#fef08a"; }

    // Draw dynamic gradient background (stationary)
    const bgGradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    bgGradient.addColorStop(0, topColor); 
    bgGradient.addColorStop(1, bottomColor); 
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw Parallax Stars/Particles (based on cameraX)
    ctx.fillStyle = starColor;
    const numStars = theme === "matrix" ? 250 : 150;
    for (let i = 0; i < numStars; i++) {
        // pseudo-random using index
        const randX = Math.sin(i * 12.3) * 10000;
        const randY = Math.cos(i * 45.6) * 10000;
        const starX = Math.abs(randX % canvas.width);
        
        // Matrix has falling code-like particles, so they can be lower
        const starY = theme === "matrix" ? Math.abs(randY % canvas.height) : Math.abs(randY % (canvas.height - 100)); 
        
        // Speed mapping based on star depth
        const speed = 0.05 + (i % 4) * 0.15; 
        const size = 1 + (i % 3) * (theme === "matrix" ? 2 : 1.2);
        
        const parallaxX = (starX - (cameraX * speed)) % canvas.width;
        const finalX = parallaxX < 0 ? parallaxX + canvas.width : parallaxX;
        
        let alpha = 0.2 + (Math.sin((Date.now() + i * 1234) / 500) + 1) * 0.4;
        if (theme === "matrix") { // Matrix code pulse effect
            alpha = (Math.sin((Date.now() + i * 500) / 200) + 1) * 0.5;
        }
        ctx.globalAlpha = alpha;
        
        if (theme === "matrix") {
           // draw small rectangles mimicking code snippets
           ctx.fillRect(finalX, (starY + (Date.now() * speed * 0.05)) % canvas.height, 2, size * 3);
        } else {
           ctx.fillRect(finalX, starY, size, size);
        }
    }
    ctx.globalAlpha = 1.0;
    
    ctx.translate(-cameraX, 0);

    // Draw Map boundary (optional dark area if player somehow sees it, though clamped)
    // Draw Finish Line
    ctx.fillStyle = "#A855F7"; // Purple finish line
    ctx.globalAlpha = 0.5;
    ctx.fillRect(
      gameState.finishLine.x,
      gameState.finishLine.y,
      gameState.finishLine.width,
      gameState.finishLine.height
    );
    ctx.globalAlpha = 1.0;
    
    // Draw Finish Line Pattern (Checkered)
    const fl = gameState.finishLine;
    const sqSize = 10;
    for(let i = 0; i < fl.width / sqSize; i++) {
        for(let j = 0; j < fl.height / sqSize; j++) {
            if((i + j) % 2 === 0) {
                ctx.fillStyle = "rgba(255,255,255,0.8)";
                ctx.fillRect(fl.x + i * sqSize, fl.y + j * sqSize, sqSize, sqSize);
            }
        }
    }

    let blockBody = "#0f172a";
    let blockHighlight = "#22d3ee";
    if (theme === "retro") { blockBody = "#170511"; blockHighlight = "#ec4899"; }
    else if (theme === "matrix") { blockBody = "#02120b"; blockHighlight = "#10b981"; }
    else if (theme === "synthwave") { blockBody = "#2e1065"; blockHighlight = "#c026d3"; }
    else if (theme === "ocean") { blockBody = "#082f49"; blockHighlight = "#0284c7"; }
    else if (theme === "gold") { blockBody = "#291802"; blockHighlight = "#eab308"; }

    // Draw map blocks
    gameState.blocks.forEach((block) => {
      // Main block body
      ctx.fillStyle = blockBody;
      ctx.fillRect(block.x, block.y, block.width, block.height);
      
      // Top border highlight
      ctx.fillStyle = blockHighlight;
      ctx.fillRect(block.x, block.y, block.width, 4);
      
      // Left border outline
      ctx.fillRect(block.x, block.y, 4, block.height);
      
      // Right border outline
      ctx.fillRect(block.x + block.width - 4, block.y, 4, block.height);
      
      // Inner grid pattern
      ctx.strokeStyle = blockHighlight;
      ctx.globalAlpha = 0.1;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for(let i = 0; i < block.width; i+= 20) {
          ctx.moveTo(block.x + i, block.y);
          ctx.lineTo(block.x + i, block.y + block.height);
      }
      for(let j = 0; j < block.height; j+= 20) {
          ctx.moveTo(block.x, block.y + j);
          ctx.lineTo(block.x + block.width, block.y + j);
      }
      ctx.stroke();
      ctx.globalAlpha = 1.0;
    });

    // Draw players
    const players = Object.values(gameState.players) as any[];
    players.forEach((player) => {
      // Body shadow/glow
      ctx.shadowColor = player.color;
      ctx.shadowBlur = 15;
      
      // Body
      ctx.fillStyle = player.color;
      
      // If player is finished, make them pulse or float slightly
      let yOffset = 0;
      if (player.finished) {
          yOffset = Math.sin(Date.now() / 200) * 4;
          ctx.globalAlpha = 0.7;
      }
      
      // Simple rounded rect for player
      ctx.beginPath();
      ctx.roundRect(player.x, player.y + yOffset, player.width, player.height, 6);
      ctx.fill();
      ctx.globalAlpha = 1.0;
      
      // Stop shadow for border and details
      ctx.shadowBlur = 0;
      
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Eyes
      ctx.fillStyle = "#000000";
      ctx.beginPath();
      // Adjust eyes depending on direction (default right)
      const lookRight = player.input.left ? false : true;
      const eyeOffsetX = lookRight ? 18 : 6;
      ctx.arc(player.x + eyeOffsetX, player.y + yOffset + 10, 3.5, 0, Math.PI * 2); // left eye
      ctx.arc(player.x + eyeOffsetX + 6, player.y + yOffset + 10, 3.5, 0, Math.PI * 2); // right eye
      ctx.fill();
      
      // Highlight self
      if (player.id === myId) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(player.x + player.width/2 - 6, player.y + yOffset - 15);
        ctx.lineTo(player.x + player.width/2 + 6, player.y + yOffset - 15);
        ctx.lineTo(player.x + player.width/2, player.y + yOffset - 5);
        ctx.closePath();
        ctx.fillStyle = "#ffffff";
        ctx.fill();
      }

      // Display Name
      ctx.fillStyle = "#e2e8f0"; // slate-200
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "center";
      
      let displayName = player.displayName 
           ? player.displayName.split(' ')[0] 
           : (player.isBot ? "Bot" : `Player-${player.id.substring(0, 4)}`);
           
      if (player.id === myId) {
          displayName = player.displayName ? `${player.displayName.split(' ')[0]} (Me)` : "Me";
      }

      if (player.currentPlacement !== null && player.currentPlacement !== undefined) {
          ctx.fillStyle = "#fbbf24";
          ctx.font = "bold 16px monospace";
          let suffix = "th";
          if (player.currentPlacement === 1) suffix = "st";
          else if (player.currentPlacement === 2) suffix = "nd";
          else if (player.currentPlacement === 3) suffix = "rd";
          ctx.fillText(player.currentPlacement + suffix, player.x + player.width / 2, player.y + yOffset - (player.id === myId ? 45 : 30));
          ctx.fillStyle = "#e2e8f0";
          ctx.font = "bold 10px monospace";
      }

      ctx.fillText(displayName, player.x + player.width / 2, player.y + yOffset - (player.id === myId ? 25 : 10));

      // Draw Emoji Skin
      if (player.skin) {
         const skinItem = STORE_ITEMS.find(i => i.id === player.skin);
         if (skinItem) {
             ctx.font = "20px sans-serif";
             ctx.fillText(skinItem.emoji, player.x + player.width/2, player.y + yOffset + player.height/2 + 7);
         }
      }
    });

    ctx.restore();
  }, [gameState, myId]);

  const handleMobileInputStart = (type: keyof PlayerInput) => {
    if (!socket) return;
    localInputRef.current[type] = true;
    socket.emit("input", { ...localInputRef.current });
  };
  
  const handleMobileInputEnd = (type: keyof PlayerInput) => {
    if (!socket) return;
    localInputRef.current[type] = false;
    socket.emit("input", { ...localInputRef.current });
  };

  return (
    <div className="min-h-screen bg-[#0F172A] relative flex flex-col items-center p-4 lg:p-8 font-sans text-white overflow-hidden">
      {/* Decorative Grid Background */}
      <div className="absolute inset-0 opacity-5 pointer-events-none" style={{ backgroundImage: "radial-gradient(#94A3B8 1px, transparent 1px)", backgroundSize: "40px 40px" }}></div>
      
      <div className="max-w-5xl w-full relative z-10 flex flex-col h-full">
        {/* Header */}
        <div className="w-full bg-[#1E293B] border-t-4 border-b-4 border-[#334155] rounded-t-xl flex flex-col sm:flex-row items-center justify-between p-4 px-6 mb-0 z-20 shadow-md">
          <div className="mb-4 sm:mb-0">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-wider uppercase text-white flex items-center gap-3">
              <Trophy className="w-8 h-8 text-pink-500 drop-shadow-[0_0_10px_rgba(236,72,153,0.5)]" />
              Pico Race {gameState?.raceCount ? `- Race ${gameState.raceCount} / ${gameState.totalRaces}` : ''}
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 font-mono font-bold uppercase tracking-wider mt-2">
              {isConnected ? (
                <span className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-green-400 border border-white animate-pulse"></span>
                  Connected • {gameState ? Object.keys(gameState.players).length : 0} Players Online
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-400 border border-white"></span>
                  Connecting...
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-4">
            {user && (
              <div className="flex items-center gap-2 pl-2 pr-1 py-1 bg-[#0F172A] border-2 border-slate-700 rounded-lg shadow-inner mr-2">
                {user.photoURL && <img src={user.photoURL} alt="avatar" className="w-8 h-8 rounded-md" referrerPolicy="no-referrer" />}
                <span className="text-sm font-bold font-mono text-slate-300 truncate max-w-[100px] hidden sm:inline-block">{user.displayName?.split(' ')[0]}</span>
                <button title="Sign out" onClick={handleLogout} className="p-2 ml-1 hover:bg-slate-800 rounded-md transition-colors">
                  <LogOut className="w-4 h-4 text-red-400" />
                </button>
              </div>
            )}
            <div className="flex items-center gap-2 px-4 py-2.5 bg-[#0F172A] border-2 border-slate-700 rounded-lg shadow-inner">
               <Zap className="w-5 h-5 text-yellow-500 fill-yellow-500" />
               <span className="font-bold text-yellow-500 font-mono tracking-widest">∞ E</span>
               {timeUntilNext !== null && (
                 <span className="text-xs text-slate-400 font-mono ml-2 border-l-2 border-slate-700 pl-2">
                   {String(Math.floor(timeUntilNext / 60)).padStart(2, '0')}:{String(timeUntilNext % 60).padStart(2, '0')}
                 </span>
               )}
            </div>
            {user && (
              <>
                {userProfile && (
                  <button
                    onClick={() => setShowStore(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-bold uppercase tracking-wider transition-colors border-2 bg-yellow-600 text-white shadow-[2px_2px_0px_0px_rgba(0,0,0,0.3)] hover:bg-yellow-500 active:translate-y-[2px] active:translate-x-[2px] active:shadow-none border-white/20"
                  >
                    <span>Store ({userProfile.coins} 🪙)</span>
                  </button>
                )}
                <button
                  onClick={() => setShowLobby(!showLobby)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-bold uppercase tracking-wider transition-colors border-2 bg-blue-600 text-white shadow-[2px_2px_0px_0px_rgba(0,0,0,0.3)] hover:bg-blue-500 active:translate-y-[2px] active:translate-x-[2px] active:shadow-none border-white/20"
                >
                  <span>Lobby ({onlineUsers.length})</span>
                </button>
              </>
            )}
            <button
              onClick={handleLeaveGame}
              disabled={!isInGame && !isSearching}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-bold uppercase tracking-wider transition-colors border-2 ${
                  (isInGame || isSearching)
                  ? 'bg-red-500 text-white shadow-[2px_2px_0px_0px_rgba(0,0,0,0.3)] hover:bg-red-400 active:translate-y-[2px] active:translate-x-[2px] active:shadow-none border-white/20'
                  : 'bg-slate-700 text-slate-500 border-slate-600 cursor-not-allowed opacity-50'
              }`}
            >
              <RotateCcw className="w-4 h-4" />
              <span>Leave</span>
            </button>
          </div>
        </div>

        {/* Game Canvas Container */}
        <div className="relative bg-[#0F172A] w-full border-x-4 border-b-4 border-[#334155] rounded-b-xl shadow-[0_10px_30px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col flex-grow z-10 w-full">
          {gameState && gameState.countdown !== null && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-red-600 text-white px-6 py-2 rounded-full font-black text-xl lg:text-3xl tracking-widest uppercase border-4 border-[#0F172A] shadow-2xl z-30 animate-pulse">
              {gameState.raceCount >= gameState.totalRaces ? `Tournament Complete!` : `Next Race in ${Math.ceil(gameState.countdown / 60)}s`}
            </div>
          )}
          {gameState && gameState.status === 'finished' && (
            <div className="absolute top-0 left-0 w-full h-full bg-[#0F172A]/90 backdrop-blur-md z-40 flex items-center justify-center p-4">
              <div className="bg-[#1E293B] p-8 rounded-2xl border-4 border-yellow-500 shadow-[0_0_50px_rgba(234,179,8,0.3)] max-w-lg w-full">
                <h2 className="text-3xl font-black text-white text-center mb-6 uppercase tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-yellow-600">
                  Tournament Results
                </h2>
                <div className="space-y-4">
                  {Object.values(gameState.players)
                    .map((p: any) => {
                       const sum = p.placements.reduce((a:number,b:number)=>a+b, 0);
                       const avg = p.placements.length > 0 ? (sum / p.placements.length).toFixed(1) : "N/A";
                       return { ...p, avgNum: parseFloat(avg) || 999, avgStr: avg };
                    })
                    .sort((a,b) => a.avgNum - b.avgNum)
                    .map((p, index) => (
                      <div key={p.id} className={`flex justify-between items-center p-4 rounded-xl bg-[#0F172A] border-2 ${index===0 ? 'border-yellow-400' : 'border-slate-700'}`}>
                         <span className="text-white font-bold flex items-center gap-3 font-mono text-lg">
                           {index === 0 && <Trophy className="w-6 h-6 text-yellow-400" />}
                           {index + 1}. {p.displayName || "Player"}
                         </span>
                         <span className="text-yellow-400 font-mono font-bold text-xl">Avg: {p.avgStr}</span>
                      </div>
                  ))}
                </div>
                <button 
                  onClick={() => window.location.reload()}
                  className="w-full mt-8 bg-pink-600 hover:bg-pink-500 text-white font-black text-lg py-4 rounded-xl uppercase tracking-widest border-b-4 border-pink-800 active:border-b-0 active:translate-y-1 transition-all"
                >
                  Play Again
                </button>
              </div>
            </div>
          )}
          {gameState && gameState.status === 'waiting' && gameState.countdown === null && (
            <div className="absolute top-0 left-0 w-full h-full bg-[#0F172A]/90 backdrop-blur-sm z-30 flex items-center justify-center">
              <div className="bg-[#1E293B] p-8 rounded-2xl border-2 border-[#334155] shadow-2xl flex flex-col items-center">
                 <div className="w-16 h-16 border-4 border-yellow-500 border-t-transparent rounded-full animate-spin mb-6"></div>
                 <h2 className="text-2xl font-black text-white uppercase tracking-widest mb-2">Waiting for Players</h2>
                 <p className="text-xl font-mono text-yellow-400 font-bold mb-4">{Object.keys(gameState.players).length} / 4 Players</p>
                 {gameState.waitTimer !== null && (
                   <p className="text-sm font-mono text-slate-400">Bots will fill in {Math.ceil(gameState.waitTimer / 60)}s</p>
                 )}
              </div>
            </div>
          )}
          {!isInGame && (
            <div className="absolute inset-0 bg-[#0F172A]/80 backdrop-blur-sm z-30 flex items-center justify-center p-4">
              <div className="bg-[#1E293B] p-8 rounded-2xl border-t-4 border-l-4 border-[#334155] shadow-2xl flex flex-col items-center max-w-md w-full relative overflow-hidden">
                <div className="absolute -right-10 -top-10 opacity-5">
                  <Zap className="w-64 h-64 text-yellow-500" />
                </div>
                {isSearching ? (
                  <>
                    <div className="w-16 h-16 border-4 border-pink-500 border-t-transparent rounded-full animate-spin mb-6 relative z-10"></div>
                    <h2 className="text-3xl font-black uppercase tracking-widest text-white mb-2 text-center relative z-10">Searching...</h2>
                    <p className="text-slate-400 font-mono text-sm text-center mb-8 relative z-10">Finding a lobby for you...</p>
                  </>
                ) : (
                  <>
                    <Trophy className="w-16 h-16 text-pink-500 mb-6 drop-shadow-[0_0_10px_rgba(236,72,153,0.5)] relative z-10" />
                    <h2 className="text-3xl font-black uppercase tracking-widest text-white mb-2 text-center relative z-10">Join Race</h2>
                    <p className="text-slate-400 font-mono text-sm text-center mb-8 relative z-10">Dodge obstacles, reach the green zone first. Costs energy to enter.</p>
                    
                    {!user ? (
                      <button 
                        onClick={handleLogin}
                        className="w-full flex items-center justify-center gap-3 px-6 py-4 rounded-xl font-bold uppercase tracking-wider text-lg transition-all relative z-10 bg-white text-slate-800 border-b-4 border-r-4 border-slate-400 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.5)] hover:bg-gray-100 active:border-b-0 active:border-r-0 active:translate-x-[4px] active:translate-y-[4px] active:shadow-none"
                      >
                        <LogIn className="w-6 h-6 text-[#0F172A]" />
                        <span>{Capacitor.isNativePlatform() ? "Misafir Olarak Oyna" : "Sign In with Google"}</span>
                      </button>
                    ) : (
                      <>
                        <button 
                          onClick={handleJoinGame}
                          className="w-full flex items-center justify-center gap-3 px-6 py-4 rounded-xl font-bold uppercase tracking-wider text-lg transition-all relative z-10 bg-yellow-500 text-[#0F172A] border-b-4 border-r-4 border-yellow-700 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.5)] hover:bg-yellow-400 active:border-b-0 active:border-r-0 active:translate-x-[4px] active:translate-y-[4px] active:shadow-none"
                        >
                          <Zap className="w-6 h-6 fill-[#0F172A]" />
                          <span>Join Game</span>
                        </button>
                        {energy < 30 && adWatchesLeft > 0 && (
                          <button 
                            onClick={handleWatchAd}
                            disabled={isWatchingAd}
                            className={`mt-4 px-4 py-3 border-2 text-yellow-500 rounded-lg shadow-sm transition-all font-bold uppercase tracking-wider text-sm w-full relative z-10 flex items-center justify-center gap-2 ${
                              isWatchingAd ? "bg-slate-700 border-slate-600 cursor-not-allowed opacity-80" : "bg-[#0F172A] border-slate-600 hover:bg-slate-800 active:scale-95"
                            }`}
                          >
                            {isWatchingAd ? (
                              <div className="w-4 h-4 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin"></div>
                            ) : (
                              <Zap className="w-4 h-4 text-yellow-500" />
                            )}
                            {isWatchingAd ? "Watching Ad..." : `Watch Ad (+15 E) - ${adWatchesLeft} left`}
                          </button>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
          <div className="absolute top-4 right-4 bg-[#0F172A]/80 backdrop-blur-md px-4 py-2 rounded-xl text-xs font-mono font-bold text-slate-300 border-2 border-slate-700 shadow-lg z-20 hidden md:block">
            <span className="uppercase tracking-widest text-[10px] block mb-1 text-slate-500">Controls</span>
            Use WASD or Arrows to move & jump
          </div>
          
          <div className="w-full h-full min-h-[65vh] lg:min-h-[500px] relative bg-[#0F172A] flex-grow">
             <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full object-fill pointer-events-none"
                style={{ imageRendering: "pixelated" }}
              />
          </div>
        </div>

        {/* Mobile Controls (Visible only on smaller screens) */}
        {isInGame && (
          <div className="md:hidden mt-2 flex justify-between gap-2 select-none touch-none z-20 relative w-full mb-1 px-2">
              <div className="flex gap-2">
                  <button
                      onTouchStart={(e) => { e.preventDefault(); handleMobileInputStart('left'); }}
                      onTouchEnd={(e) => { e.preventDefault(); handleMobileInputEnd('left'); }}
                      onTouchCancel={(e) => { e.preventDefault(); handleMobileInputEnd('left'); }}
                      onPointerDown={(e) => { handleMobileInputStart('left'); }}
                      onPointerUp={(e) => { handleMobileInputEnd('left'); }}
                      onPointerOut={(e) => { handleMobileInputEnd('left'); }}
                      onContextMenu={(e) => e.preventDefault()}
                      className="w-12 h-12 bg-[#1E293B] border-b-4 border-l-4 border-[#334155] rounded-xl flex items-center justify-center text-2xl font-black text-white active:bg-[#334155] active:border-b-2 active:border-l-2 active:translate-x-[2px] active:translate-y-[2px] shadow-lg touch-manipulation focus:outline-none"
                  >
                    ←
                  </button>
                  <button
                      onTouchStart={(e) => { e.preventDefault(); handleMobileInputStart('right'); }}
                      onTouchEnd={(e) => { e.preventDefault(); handleMobileInputEnd('right'); }}
                      onTouchCancel={(e) => { e.preventDefault(); handleMobileInputEnd('right'); }}
                      onPointerDown={(e) => { handleMobileInputStart('right'); }}
                      onPointerUp={(e) => { handleMobileInputEnd('right'); }}
                      onPointerOut={(e) => { handleMobileInputEnd('right'); }}
                      onContextMenu={(e) => e.preventDefault()}
                      className="w-12 h-12 bg-[#1E293B] border-b-4 border-l-4 border-[#334155] rounded-xl flex items-center justify-center text-2xl font-black text-white active:bg-[#334155] active:border-b-2 active:border-l-2 active:translate-x-[2px] active:translate-y-[2px] shadow-lg touch-manipulation focus:outline-none"
                  >
                    →
                  </button>
              </div>
              <button
                  onTouchStart={(e) => { e.preventDefault(); handleMobileInputStart('jump'); }}
                  onTouchEnd={(e) => { e.preventDefault(); handleMobileInputEnd('jump'); }}
                  onTouchCancel={(e) => { e.preventDefault(); handleMobileInputEnd('jump'); }}
                  onPointerDown={(e) => { handleMobileInputStart('jump'); }}
                  onPointerUp={(e) => { handleMobileInputEnd('jump'); }}
                  onPointerOut={(e) => { handleMobileInputEnd('jump'); }}
                  onContextMenu={(e) => e.preventDefault()}
                  className="w-20 h-12 bg-pink-500 border-b-4 border-r-4 border-pink-700 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.3)] rounded-xl text-white font-bold text-lg uppercase tracking-wider active:border-b-0 active:border-r-0 active:translate-x-[4px] active:translate-y-[4px] active:shadow-none touch-manipulation focus:outline-none"
              >
                JUMP
              </button>
          </div>
        )}

        {/* Instructions */}
        {!isInGame && (
          <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6 text-center z-20 relative">
               <div className="bg-[#1E293B] p-5 rounded-xl border-t-4 border-l-4 border-[#334155] shadow-lg relative overflow-hidden">
                   <div className="w-12 h-12 bg-pink-500 text-white rounded-lg flex items-center justify-center mx-auto mb-4 text-2xl shadow-[0_0_15px_rgba(236,72,153,0.4)] border-2 border-white/20 z-10 relative">🏃</div>
                   <h3 className="font-bold text-white uppercase tracking-wider text-sm mb-2 relative z-10">Race to the Goal</h3>
                   <p className="text-xs text-slate-400 font-mono relative z-10 leading-relaxed">Navigate obstacles and reach the green finish line first.</p>
               </div>
               <div className="bg-[#1E293B] p-5 rounded-xl border-t-4 border-l-4 border-[#334155] shadow-lg relative overflow-hidden">
                   <div className="w-12 h-12 bg-blue-500 text-white rounded-lg flex items-center justify-center mx-auto mb-4 text-2xl shadow-[0_0_15px_rgba(59,130,246,0.4)] border-2 border-white/20 z-10 relative">🤝</div>
                   <h3 className="font-bold text-white uppercase tracking-wider text-sm mb-2 relative z-10">Physics & Pushing</h3>
                   <p className="text-xs text-slate-400 font-mono relative z-10 leading-relaxed">Players collide with each other! Jump on heads or push friends.</p>
               </div>
               <div className="bg-[#1E293B] p-5 rounded-xl border-t-4 border-l-4 border-[#334155] shadow-lg relative overflow-hidden">
                   <div className="w-12 h-12 bg-green-500 text-white rounded-lg flex items-center justify-center mx-auto mb-4 text-2xl shadow-[0_0_15px_rgba(34,197,94,0.4)] border-2 border-white/20 z-10 relative">🌐</div>
                   <h3 className="font-bold text-white uppercase tracking-wider text-sm mb-2 relative z-10">Real-Time Multiplayer</h3>
                   <p className="text-xs text-slate-400 font-mono relative z-10 leading-relaxed">Share the link with friends to join the same screen instantly.</p>
               </div>
          </div>
        )}
      </div>

      {showLobby && (
        <div className="absolute inset-0 bg-[#0F172A]/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-[#1E293B] p-6 rounded-2xl border-4 border-[#334155] shadow-2xl max-w-md w-full relative">
             <button onClick={() => setShowLobby(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white">✕</button>
             <h2 className="text-2xl font-black text-white uppercase tracking-widest mb-4">Lobby ({onlineUsers.length})</h2>
             <div className="max-h-[300px] overflow-y-auto pr-2 flex flex-col gap-2">
                 {onlineUsers.filter(u => u.uid !== user?.uid).map(u => (
                    <div key={u.socketId} className="flex flex-row items-center justify-between bg-[#0F172A] p-3 rounded-lg border-2 border-[#334155]">
                        <div className="flex items-center gap-3">
                           {u.photoURL && <img src={u.photoURL} alt="avatar" className="w-10 h-10 rounded-md" referrerPolicy="no-referrer" />}
                           <div>
                              <div className="font-bold font-mono text-slate-200">{u.displayName}</div>
                              <div className="text-xs text-slate-500 uppercase">{u.status}</div>
                           </div>
                        </div>
                        <button 
                           onClick={() => { handleInvite(u.socketId); alert(`Invited ${u.displayName}`); }}
                           disabled={u.status === 'playing'}
                           className={`px-3 py-1.5 rounded uppercase font-bold text-xs tracking-wider border-2 ${
                              u.status === 'playing' ? "bg-slate-700 text-slate-500 border-slate-600 opacity-50 cursor-not-allowed" : "bg-pink-600 text-white border-pink-800 hover:bg-pink-500"
                           }`}
                        >
                           Invite
                        </button>
                    </div>
                 ))}
                 {onlineUsers.filter(u => u.uid !== user?.uid).length === 0 && (
                    <div className="text-slate-400 text-center text-sm font-mono py-8">No other players online</div>
                 )}
             </div>
          </div>
        </div>
      )}

      {invitation && (
        <div className="absolute inset-x-4 top-20 max-w-sm mx-auto bg-[#1E293B] p-5 rounded-2xl border-4 border-yellow-500 shadow-[0_0_20px_rgba(234,179,8,0.5)] z-50 flex flex-col items-center animate-bounce">
            <h3 className="text-lg font-black text-white uppercase tracking-widest mb-1">Game Invite!</h3>
            <p className="text-sm text-yellow-100 font-mono text-center mb-4"><span className="font-bold text-yellow-500">{invitation.from.displayName}</span> invited you to a game.</p>
            <div className="flex gap-4 w-full">
               <button onClick={handleDeclineInvite} className="flex-1 px-4 py-2 bg-slate-700 border-2 border-slate-600 rounded-lg font-bold text-white uppercase tracking-wider hover:bg-slate-600">Decline</button>
               <button onClick={handleAcceptInvite} className="flex-1 px-4 py-2 bg-yellow-500 border-2 border-yellow-700 rounded-lg font-bold text-slate-900 uppercase tracking-wider hover:bg-yellow-400 shadow-[2px_2px_0px_rgba(0,0,0,0.5)]">Accept</button>
            </div>
        </div>
      )}

      {showStore && userProfile && (
        <div className="absolute inset-0 bg-[#0F172A]/90 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-[#1E293B] p-6 md:p-8 rounded-3xl border-4 border-[#334155] shadow-2xl max-w-3xl w-full relative flex flex-col">
             <button onClick={() => setShowStore(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white bg-slate-800 rounded-full w-8 h-8 flex items-center justify-center">✕</button>
             
             <div className="flex justify-between items-center mb-8 border-b-2 border-slate-700 pb-4">
                 <h2 className="text-3xl font-black text-white uppercase tracking-widest flex items-center gap-3">
                     Store 🛍️
                 </h2>
                 <div className="bg-slate-800 px-4 py-2 rounded-xl border-2 border-yellow-500/50 flex items-center gap-2 shadow-inner">
                     <span className="text-yellow-400 font-bold text-xl font-mono">{userProfile.coins}</span>
                     <span className="text-2xl">🪙</span>
                 </div>
             </div>

             <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 overflow-y-auto max-h-[60vh] p-2">
                 {STORE_ITEMS.map(item => {
                     const isOwned = userProfile.inventory.includes(item.id);
                     const isEquipped = userProfile.equippedSkin === item.id;
                     const canAfford = userProfile.coins >= item.price;
                     
                     return (
                         <div key={item.id} className={`flex flex-col items-center p-4 rounded-2xl border-4 transition-transform ${isEquipped ? 'border-green-500 bg-green-500/10 scale-105 shadow-[0_0_15px_rgba(34,197,94,0.3)]' : isOwned ? 'border-blue-500 bg-blue-500/10' : 'border-slate-700 bg-slate-800 hover:scale-105'}`}>
                             <div className="text-5xl mb-3 drop-shadow-lg">{item.emoji}</div>
                             <div className="font-bold text-white uppercase tracking-wider mb-2 text-center text-sm">{item.name}</div>
                             
                             {isEquipped ? (
                                 <button onClick={() => {
                                     setUserProfile({...userProfile, equippedSkin: null});
                                     updateUserProfile(userProfile.uid, { equippedSkin: null });
                                 }} className="w-full mt-auto py-2 bg-red-500 hover:bg-red-400 rounded-lg font-bold text-white uppercase text-xs">Unequip</button>
                             ) : isOwned ? (
                                 <button onClick={() => {
                                     setUserProfile({...userProfile, equippedSkin: item.id});
                                     updateUserProfile(userProfile.uid, { equippedSkin: item.id });
                                 }} className="w-full mt-auto py-2 bg-green-500 hover:bg-green-400 rounded-lg font-bold text-white uppercase text-xs">Equip</button>
                             ) : (
                                 <button 
                                    onClick={() => {
                                        if (canAfford) {
                                            const newProfile = {
                                                ...userProfile,
                                                coins: userProfile.coins - item.price,
                                                inventory: [...userProfile.inventory, item.id],
                                                equippedSkin: item.id
                                            };
                                            setUserProfile(newProfile);
                                            updateUserProfile(userProfile.uid, {
                                                coins: newProfile.coins,
                                                inventory: newProfile.inventory,
                                                equippedSkin: newProfile.equippedSkin
                                            });
                                        }
                                    }}
                                    disabled={!canAfford}
                                    className={`w-full mt-auto py-2 rounded-lg font-bold uppercase text-xs flex items-center justify-center gap-1 ${canAfford ? 'bg-yellow-500 text-slate-900 hover:bg-yellow-400' : 'bg-slate-700 text-slate-500 cursor-not-allowed'}`}
                                 >
                                     {item.price} 🪙
                                 </button>
                             )}
                         </div>
                     )
                 })}
             </div>
          </div>
        </div>
      )}

    </div>
  );
}

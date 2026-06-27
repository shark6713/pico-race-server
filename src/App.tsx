import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { GameState, PlayerInput } from "./shared/types";
import { Trophy, RotateCcw, Zap, LogIn, LogOut, Edit2, Volume2, VolumeX, ListOrdered, ShieldAlert, Trash2, Users, Store } from "lucide-react";
import { audioManager } from "./audio";
import { auth, googleProvider, getUserProfile, updateUserProfile, addFriendByCode, db } from "./firebase";
import { doc, onSnapshot, collection, query, orderBy, limit, getDocs, updateDoc, increment, deleteDoc } from "firebase/firestore";
import { UserProfile, STORE_ITEMS } from "./shared/types";
import { signInWithPopup, User, onAuthStateChanged, signOut, signInAnonymously, signInWithCredential, GoogleAuthProvider, OAuthProvider, deleteUser } from "firebase/auth";
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { AdMob, RewardAdOptions, AdLoadInfo, RewardAdPluginEvents, InterstitialAdPluginEvents, MaxAdContentRating } from '@capacitor-community/admob';

export default function App() {
  const [appAlert, setAppAlert] = useState<string | null>(null);
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
  const [friendCodeInput, setFriendCodeInput] = useState("");
  const [friendMessage, setFriendMessage] = useState("");
  const [isEditingName, setIsEditingName] = useState(false);
  const [newNameInput, setNewNameInput] = useState("");

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    if (user) {
        getUserProfile(user.uid).then(profile => {
            setUserProfile(profile);

            unsubscribe = onSnapshot(doc(db, "users", user.uid), (docSnap) => {
               if (docSnap.exists()) {
                  // Keep local modifications intact if any, but replace with real data
                  setUserProfile(docSnap.data() as UserProfile);
               }
            }, (error) => {
               console.error("onSnapshot error:", error);
            });
        });
    }
    return () => {
       if (unsubscribe) unsubscribe();
    };
  }, [user]);

  useEffect(() => {
    if (!socket || !user) return;
    socket.emit("auth", {
        uid: user.uid,
        displayName: userProfile?.displayName || user.displayName || "Guest",
        photoURL: user.photoURL
    });
  }, [socket, user, userProfile?.displayName]);

  // Global audio init on first interaction
  useEffect(() => {
    const initAudio = () => {
      audioManager.init();
      audioManager.resume();
      window.removeEventListener("pointerdown", initAudio);
      window.removeEventListener("keydown", initAudio);
    };
    window.addEventListener("pointerdown", initAudio);
    window.addEventListener("keydown", initAudio);
    return () => {
      window.removeEventListener("pointerdown", initAudio);
      window.removeEventListener("keydown", initAudio);
    };
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => {
      setUser(u);
    });
    return unsub;
  }, []);

  const handleGuestLogin = () => {
    let fakeId = localStorage.getItem("picoGuestId");
    if (!fakeId) {
        fakeId = "guest_" + Math.random().toString(36).substring(2, 9);
        localStorage.setItem("picoGuestId", fakeId);
    }
    setUser({
      uid: fakeId,
      displayName: "Guest",
      email: null,
      photoURL: null
    } as any);
  };

  const handleLogin = async () => {
    try {
      if (Capacitor.isNativePlatform()) {
          const result = await FirebaseAuthentication.signInWithGoogle({ skipNativeAuth: true });
          if (!result.credential?.idToken) {
              throw new Error("Google Sign-In failed or cancelled.");
          }
          const credential = GoogleAuthProvider.credential(result.credential.idToken);
          await signInWithCredential(auth, credential);
      } else {
          await signInWithPopup(auth, googleProvider);
      }
    } catch (e) {
      console.error(e);
      setAppAlert("Login failed: " + (e as Error).message);
    }
  };

  const handleAppleLogin = async () => {
    try {
      if (Capacitor.isNativePlatform()) {
          const result = await FirebaseAuthentication.signInWithApple({ skipNativeAuth: true });
          
          if (!result.credential?.idToken) {
              throw new Error("Apple Sign-In failed or cancelled.");
          }
          
          const provider = new OAuthProvider('apple.com');
          const credential = provider.credential({
              idToken: result.credential.idToken,
              rawNonce: result.credential.nonce
          });
          
          await signInWithCredential(auth, credential);
      } else {
          const provider = new OAuthProvider('apple.com');
          await signInWithPopup(auth, provider);
      }
    } catch (e) {
      console.error(e);
      setAppAlert("Apple login failed: " + (e as Error).message);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setUser(null);
  };

  const handleDeleteAccount = async () => {
    if (!user) return;
    const confirmDelete = window.confirm("Warning! Are you sure you want to delete your account? This action cannot be undone. All your scores, coins, and purchased items will be permanently deleted.");
    if (!confirmDelete) return;

    try {
      // 1. Delete user document from Firestore
      await deleteDoc(doc(db, "users", user.uid));
      // 2. Delete user from Firebase Auth
      await deleteUser(user);
      setUser(null);
      setAppAlert("Your account has been successfully deleted.");
    } catch (e: any) {
      console.error("Error deleting account:", e);
      if (e.code === 'auth/requires-recent-login') {
         setAppAlert("For security reasons, please sign out and sign back in before deleting your account.");
         await handleLogout();
      } else {
         setAppAlert("An error occurred while deleting your account: " + e.message);
      }
    }
  };

  const handleSaveName = async () => {
     if (!user) return;
     const newName = newNameInput.trim();
     if (newName) {
         await updateUserProfile(user.uid, { displayName: newName });
         setUserProfile(prev => prev ? { ...prev, displayName: newName } : null);
     }
     setIsEditingName(false);
  };


  const [localEnergy, setLocalEnergy] = useState<number>(100);
  const lastTickRef = useRef<number>(Date.now());
  const [timeUntilNext, setTimeUntilNext] = useState<number | null>(null);

  const [isAdLoaded, setIsAdLoaded] = useState(false);
  const [isWatchingAd, setIsWatchingAd] = useState(false);
  const isInterstitialLoadedRef = useRef(false);
  
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [topPlayers, setTopPlayers] = useState<UserProfile[]>([]);
  
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [audioRender, setAudioRender] = useState(0);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userProfileRef = useRef<UserProfile | null>(null);
  const pendingRewardTypeRef = useRef<'energy' | 'coins'>('energy');
  const rewardGivenRef = useRef(false);
  const singlePlayerRewardGivenRef = useRef(false);

  useEffect(() => {
    if (gameState?.status === 'finished' && gameState.isSinglePlayer) {
        if (!singlePlayerRewardGivenRef.current) {
            singlePlayerRewardGivenRef.current = true;
            const me = gameState.players[myId];
            if (me && me.score && userProfile) {
                const coinsEarned = Math.floor(me.score * 0.05);
                if (coinsEarned > 0) {
                    updateUserProfile(userProfile.uid, { coins: (userProfile.coins || 0) + coinsEarned });
                    setAppAlert(`Run Ended! You earned ${coinsEarned} Coins!`);
                }
            }
        }
    } else if (gameState?.status === 'playing') {
        singlePlayerRewardGivenRef.current = false;
    }
  }, [gameState?.status, gameState?.players, gameState?.isSinglePlayer, myId, userProfile]);

  const giveAdReward = (type: 'energy' | 'coins') => {
      if (rewardGivenRef.current) return;
      rewardGivenRef.current = true;
      if (type === 'energy') {
         setLocalEnergy(e => {
             const newE = Math.min(100, e + 33);
             const uid = auth.currentUser?.uid || userProfileRef.current?.uid;
             if (uid) updateUserProfile(uid, { energy: newE, lastEnergyUpdateTime: lastTickRef.current }).catch(err => console.log(err));
             return newE;
         });
         setAppAlert("+33 Energy added!");
      } else {
         const currentProfile = userProfileRef.current;
         if (currentProfile && currentProfile.uid) {
             const currentCoins = Number(currentProfile.coins) || 0;
             const newCoins = currentCoins + 50;
             setUserProfile({ ...currentProfile, coins: newCoins });
             updateUserProfile(currentProfile.uid, { coins: newCoins }).catch(err => console.log(err));
             setAppAlert("+50 Coins added!");
         } else {
             setAppAlert("Error: Profile not found. Coins not added.");
         }
      }
  };

  useEffect(() => {
    userProfileRef.current = userProfile;
  }, [userProfile]);

  const fetchAllUsers = async () => {
    try {
      setAdminLoading(true);
      const q = query(collection(db, "users"), orderBy("coins", "desc"));
      const snapshot = await getDocs(q);
      const players = snapshot.docs.map(doc => doc.data() as UserProfile);
      setAllUsers(players);
    } catch (e) {
      console.error("Admin fetch error:", e);
    } finally {
      setAdminLoading(false);
    }
  };

  const handleSendCoins = async (targetUid: string, amount: number) => {
    if (!userProfile?.isAdmin) return;
    try {
      await updateDoc(doc(db, "users", targetUid), {
        coins: increment(amount)
      });
      // Update local state to reflect UI instantly
      setAllUsers(prev => prev.map(p => p.uid === targetUid ? { ...p, coins: (p.coins || 0) + amount } : p));
      setAppAlert(`${amount} coins successfully sent!`);
    } catch (e) {
      console.error("Coin send error:", e);
      setAppAlert("Error: Could not send coins. Please make sure the Firestore rules are updated.");
    }
  };

  const fetchLeaderboard = async () => {
    try {
      const q = query(collection(db, "users"), orderBy("highScore", "desc"), limit(60));
      const snapshot = await getDocs(q);
      const players = snapshot.docs.map(doc => doc.data() as UserProfile);
      setTopPlayers(players.filter(p => !p.isAdmin).slice(0, 50));
    } catch (e) {
      console.error("Leaderboard fetch error:", e);
    }
  };

  useEffect(() => {
    if (userProfile && userProfile.energy !== undefined) {
       setLocalEnergy(userProfile.energy);
       lastTickRef.current = userProfile.lastEnergyUpdateTime || Date.now();
    }
  }, [userProfile?.energy, userProfile?.lastEnergyUpdateTime]);

  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      if (localEnergy >= 100) {
         lastTickRef.current = Date.now();
         setTimeUntilNext(null);
         return;
      }
      
      const now = Date.now();
      const diff = now - lastTickRef.current;
      const minutes1 = 1 * 60 * 1000;
      
      if (diff >= minutes1) {
          const ticks = Math.floor(diff / minutes1);
          const newEnergy = Math.min(100, localEnergy + (ticks * 1));
          const newLastTick = now - (diff % minutes1);
          
          setLocalEnergy(newEnergy);
          lastTickRef.current = newLastTick;
          
          updateUserProfile(user.uid, { 
             energy: newEnergy, 
             lastEnergyUpdateTime: newLastTick 
          });
      } else {
          setTimeUntilNext(Math.ceil((minutes1 - diff) / 1000));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [localEnergy, user]);

  useEffect(() => {
    const initAdMob = async () => {
       if (Capacitor.isNativePlatform()) {
         try {
          if (Capacitor.getPlatform() === 'ios') {
             await AdMob.requestTrackingAuthorization();
          }
          await AdMob.initialize({
            tagForChildDirectedTreatment: true,
            tagForUnderAgeOfConsent: true,
            maxAdContentRating: MaxAdContentRating.General
          });
          
          AdMob.addListener(RewardAdPluginEvents.Loaded, () => setIsAdLoaded(true));
          AdMob.addListener(RewardAdPluginEvents.Rewarded, () => {
             giveAdReward(pendingRewardTypeRef.current);
          });
          AdMob.addListener(RewardAdPluginEvents.Dismissed, () => {
             setIsWatchingAd(false);
             loadAd();
          });
          AdMob.addListener(RewardAdPluginEvents.FailedToLoad, () => {
             setIsAdLoaded(false);
             setTimeout(loadAd, 30000);
          });
          
          AdMob.addListener(InterstitialAdPluginEvents.Loaded, () => {
             isInterstitialLoadedRef.current = true;
          });
          AdMob.addListener(InterstitialAdPluginEvents.Dismissed, () => {
             isInterstitialLoadedRef.current = false;
             loadInterstitial();
          });
          AdMob.addListener(InterstitialAdPluginEvents.FailedToLoad, () => {
             isInterstitialLoadedRef.current = false;
             setTimeout(loadInterstitial, 30000);
          });
          
          loadAd();
          loadInterstitial();
        } catch(e) { console.error(e); }
      }
    };
    const loadAd = async () => {
       const platform = Capacitor.getPlatform();
       let adId = "ca-app-pub-5681334667848041/3250836094"; // Default Android
       if (platform === 'ios') {
           adId = "ca-app-pub-5681334667848041/7280060533"; // iOS
       }
       await AdMob.prepareRewardVideoAd({ adId, isTesting: false }).catch(e => console.error(e));
    };
    const loadInterstitial = async () => {
       let adId = "ca-app-pub-5681334667848041/1249496894"; // Android Interstitial
       if (Capacitor.getPlatform() === 'ios') {
           adId = "ca-app-pub-5681334667848041/7679173876"; // iOS Interstitial
       }
       await AdMob.prepareInterstitial({ adId, isTesting: false }).catch(e => console.error(e));
    };
    initAdMob();
  }, []);


  const isInGame = gameState?.players[myId] !== undefined;

  useEffect(() => {
    audioManager.setGameState(isInGame);
  }, [isInGame]);

  const handleJoinGame = () => {
    if (!user) return; // Need login
    
    if (!isConnected || !socket?.connected) {
        setAppAlert("Could not connect to the server. Please check your internet connection and try again.");
        return;
    }

    audioManager.init();
    audioManager.resume();
    
    if (!userProfile?.isAdmin) {
      if (localEnergy < 33) {
          setAppAlert("Not enough energy! Wait a few minutes or watch an ad to get more.");
          return;
      }
      const wasFull = localEnergy >= 100;
      const newEnergy = localEnergy - 33;
      setLocalEnergy(newEnergy);
      if (wasFull) lastTickRef.current = Date.now();
      updateUserProfile(user.uid, { energy: newEnergy, ...(wasFull && { lastEnergyUpdateTime: Date.now() }) }).catch(e => console.log("Guest profile not saved:", e));
    }
    
    setIsSearching(true);
    
    socket?.emit("findGame", { 
        displayName: userProfile?.displayName || user?.displayName || "Guest", 
        skin: userProfile?.equippedSkin || undefined 
    });
  };

  const handleSinglePlayer = () => {
    if (!user) return; // Need login
    
    if (!isConnected || !socket?.connected) {
        setAppAlert("Could not connect to the server. Please check your internet connection and try again.");
        return;
    }

    audioManager.init();
    audioManager.resume();
    
    if (!userProfile?.isAdmin) {
      if (localEnergy < 10) {
          setAppAlert("Not enough energy! Wait a few minutes or watch an ad to get more.");
          return;
      }
      const wasFull = localEnergy >= 100;
      const newEnergy = localEnergy - 10;
      setLocalEnergy(newEnergy);
      if (wasFull) lastTickRef.current = Date.now();
      updateUserProfile(user.uid, { energy: newEnergy, ...(wasFull && { lastEnergyUpdateTime: Date.now() }) }).catch(e => console.log("Guest profile not saved:", e));
    }
    
    setIsSearching(true);
    
    socket?.emit("startSinglePlayer", { 
        displayName: userProfile?.displayName || user?.displayName || "Guest", 
        skin: userProfile?.equippedSkin || undefined 
    });
  };

  const handleWatchAd = async (rewardType: 'energy' | 'coins' = 'energy') => {
    pendingRewardTypeRef.current = rewardType;
    rewardGivenRef.current = false;
    const rewardText = rewardType === 'energy' ? "+33 Energy" : "+50 Coins";

    if (!Capacitor.isNativePlatform()) {
       setIsWatchingAd(true);
       setTimeout(() => {
          setIsWatchingAd(false);
          giveAdReward(rewardType);
       }, 3000);
       return;
    }

    if (isAdLoaded) {
       setIsWatchingAd(true);
       try {
           await AdMob.showRewardVideoAd();
       } catch (e) {
           console.error("AdMob Error:", e);
           // Often closing ad throws an exception on Android, but we don't abort.
       } finally {
           setIsWatchingAd(false);
           // Guarantee the reward is delivered
           setTimeout(() => {
               giveAdReward(pendingRewardTypeRef.current);
           }, 500);
       }
    } else {
       setAppAlert(`Reklam henüz hazır değil. Lütfen birkaç saniye bekleyip tekrar dene.`);
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
      if (invitation && socket) {
         if (!userProfile?.isAdmin) {
           if (localEnergy < 33) return;
           const wasFull = localEnergy >= 100;
           const newEnergy = localEnergy - 33;
           setLocalEnergy(newEnergy);
           if (wasFull) lastTickRef.current = Date.now();
           updateUserProfile(user.uid, { energy: newEnergy, ...(wasFull && { lastEnergyUpdateTime: Date.now() }) });
         }

        socket.emit("acceptInvite", invitation.roomId, {
          displayName: userProfile?.displayName || user?.displayName || "Guest",
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
       setAppAlert(`${by} declined your invite.`);
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
            const currentProfile = userProfileRef.current;
            if (me.currentPlacement && currentProfile) {
                let coinsWon = 10;
                if (me.currentPlacement === 1) coinsWon = 100;
                else if (me.currentPlacement === 2) coinsWon = 50;
                else if (me.currentPlacement === 3) coinsWon = 20;
                
                const currentCoins = Number(currentProfile.coins) || 0;
                const newCoins = currentCoins + coinsWon;
                setUserProfile({ ...currentProfile, coins: newCoins });
                updateUserProfile(currentProfile.uid, { coins: newCoins });
                
                setAppAlert(`Congratulations! You finished #${me.currentPlacement} and won ${coinsWon} Coins! 🏆`);
                
                if (Capacitor.isNativePlatform() && isInterstitialLoadedRef.current) {
                    AdMob.showInterstitial().catch(e => console.error("Interstitial error:", e));
                }
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
             ctx.font = "24px sans-serif";
             ctx.textAlign = "center";
             ctx.fillText(skinItem.emoji, player.x + player.width/2, player.y + yOffset - 30);
         } else {
             // Red box: player.skin exists but not found in STORE_ITEMS
             ctx.fillStyle = "red";
             ctx.fillRect(player.x + player.width/2 - 10, player.y + yOffset - 40, 20, 20);
         }
      } else {
         // Yellow box: player.skin is completely falsy/undefined (Server not sending it)
         ctx.fillStyle = "yellow";
         ctx.fillRect(player.x + player.width/2 - 10, player.y + yOffset - 40, 20, 20);
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
    <div 
      className="min-h-screen bg-[#0F172A] relative flex flex-col items-center p-4 lg:p-8 font-sans text-white overflow-hidden"
      style={{
        paddingTop: 'calc(1rem + env(safe-area-inset-top))',
        paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))'
      }}
    >
      {appAlert && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-[#1E293B] p-6 rounded-2xl border-4 border-red-500 shadow-2xl max-w-sm w-full flex flex-col items-center text-center animate-bounce-short">
             <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mb-4">
                <span className="text-red-500 text-3xl">⚠️</span>
             </div>
             <h3 className="text-xl font-black text-white uppercase tracking-widest mb-2">Alert</h3>
             <p className="text-slate-300 font-mono text-sm mb-6">{appAlert}</p>
             <button 
                onClick={() => setAppAlert(null)}
                className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-3 px-4 rounded-xl transition-colors uppercase tracking-widest"
             >
               OK
             </button>
          </div>
        </div>
      )}
      {/* Decorative Grid Background */}
      <div className="absolute inset-0 opacity-5 pointer-events-none" style={{ backgroundImage: "radial-gradient(#94A3B8 1px, transparent 1px)", backgroundSize: "40px 40px" }}></div>
      
      <div className="max-w-5xl w-full relative z-10 flex flex-col h-full">
        {/* Header */}
        <div className="w-full bg-[#1E293B] border-t-4 border-b-4 border-[#334155] rounded-t-xl flex flex-col items-center justify-between p-3 sm:p-4 px-4 sm:px-6 mb-0 z-20 shadow-md gap-3">
          <div className="w-full flex items-center justify-between">
            <h1 className="text-xl sm:text-3xl font-bold tracking-wider uppercase text-white flex items-center gap-2 sm:gap-3">
              <Trophy className="w-6 h-6 sm:w-8 sm:h-8 text-pink-500 drop-shadow-[0_0_10px_rgba(236,72,153,0.5)]" />
              Pico Race <span className="hidden sm:inline">{gameState?.raceCount ? `- Race ${gameState.raceCount} / ${gameState.totalRaces}` : ''}</span>
            </h1>
            <div className="flex items-center gap-3 text-xs sm:text-sm font-mono text-slate-400">
              {isConnected ? (
                <span className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 bg-green-500 rounded-full shadow-[0_0_8px_rgba(34,197,94,0.8)] animate-pulse"></div> <span className="hidden sm:inline">CONNECTED</span></span>
              ) : (
                <span className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 bg-red-500 rounded-full shadow-[0_0_8px_rgba(239,68,68,0.8)]"></div> <span className="hidden sm:inline">OFFLINE</span></span>
              )}
              <span className="hidden sm:inline">•</span>
              <span>{onlineUsers.length} <span className="hidden sm:inline">PLAYERS ONLINE</span></span>
            </div>
          </div>
          
                    <div className="flex flex-row flex-wrap justify-between items-center gap-2 w-full mt-2">
            {/* Left: User Profile */}
            {user && (
               <div className="flex items-center gap-2 bg-[#0F172A] px-2 py-1.5 rounded-lg border border-slate-700 shadow-inner">
                 {user.photoURL && <img src={user.photoURL} alt="avatar" className="w-6 h-6 rounded-md" referrerPolicy="no-referrer" />}
                 {isEditingName ? (
                    <input
                        type="text"
                        value={newNameInput}
                        onChange={(e) => setNewNameInput(e.target.value)}
                        onBlur={handleSaveName}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName(); }}
                        className="bg-[#1E293B] text-xs font-mono font-bold text-white px-1.5 py-0.5 rounded outline-none w-20"
                        autoFocus
                    />
                 ) : (
                    <div className="flex items-center gap-1 group">
                        <span className="text-xs font-bold font-mono text-slate-300 truncate max-w-[80px] inline-block">
                           {(userProfile?.displayName || user.displayName || 'Guest').split(' ')[0]}
                        </span>
                        <button onClick={() => { setNewNameInput(userProfile?.displayName || user.displayName || 'Guest'); setIsEditingName(true); }} className="p-0.5 hover:text-white text-slate-400">
                            <Edit2 className="w-3 h-3" />
                        </button>
                    </div>
                 )}
                 <div className="relative">
                   <button onClick={() => setShowUserMenu(v => !v)} className="p-0.5 hover:bg-slate-800 rounded-md transition-colors">
                     <LogOut className="w-3 h-3 text-red-400" />
                   </button>
                   {showUserMenu && (
                     <div className="absolute right-0 top-6 bg-[#1E293B] border-2 border-slate-600 rounded-xl shadow-2xl z-50 min-w-[160px] overflow-hidden">
                       <button
                         onClick={() => { handleLogout(); setShowUserMenu(false); }}
                         className="w-full flex items-center gap-2 px-4 py-3 text-sm text-slate-200 hover:bg-slate-700 transition-colors"
                       >
                         <LogOut className="w-4 h-4 text-red-400" />
                         <span>Sign Out</span>
                       </button>
                       <div className="border-t border-slate-700" />
                       <button
                         onClick={() => { handleDeleteAccount(); setShowUserMenu(false); }}
                         className="w-full flex items-center gap-2 px-4 py-3 text-sm text-red-400 hover:bg-red-900/40 transition-colors"
                       >
                         <Trash2 className="w-4 h-4 text-red-500" />
                         <span>Delete Account</span>
                       </button>
                     </div>
                   )}
                 </div>
               </div>
            )}

            {/* Right: Energy, Coins, Actions */}
            <div className="flex items-center gap-1.5 ml-auto">
               {/* Energy & Coins Combined */}
               <div className="flex items-center gap-1.5 px-2 py-1.5 bg-[#0F172A] border border-slate-700 rounded-lg shadow-inner">
                  <div className="flex items-center gap-1 text-yellow-500 font-bold font-mono text-xs">
                     <Zap className="w-3 h-3 fill-yellow-500" /> {localEnergy}/100
                  </div>
                  {timeUntilNext !== null && localEnergy < 100 && (
                    <span className="text-[10px] text-slate-400 font-mono ml-1 hidden sm:block">
                      {String(Math.floor(timeUntilNext / 60)).padStart(2, '0')}:{String(timeUntilNext % 60).padStart(2, '0')}
                    </span>
                  )}
                  <div className="w-px h-3 bg-slate-600 mx-1"></div>
                  <div className="flex items-center gap-1 text-yellow-400 font-bold font-mono text-xs cursor-pointer" onClick={() => setShowStore(true)}>
                     {userProfile?.coins || 0} 🪙
                  </div>
               </div>

               {/* Action Icons */}
               {user && userProfile && (
                 <div className="flex items-center gap-1">
                   {userProfile.isAdmin && (
                     <button onClick={() => { setShowAdminPanel(true); fetchAllUsers(); }} className="p-1.5 rounded border bg-red-600 text-white hover:bg-red-500 border-white/20 transition-colors" title="Admin">
                       <ShieldAlert className="w-3 h-3" />
                     </button>
                   )}
                   <button onClick={() => { setShowLeaderboard(true); fetchLeaderboard(); }} className="p-1.5 rounded border bg-purple-600 text-white hover:bg-purple-500 border-white/20 transition-colors" title="Top 50">
                     <ListOrdered className="w-3 h-3" />
                   </button>
                   <button onClick={() => { audioManager.toggleMute(); setAudioRender(r => r + 1); }} className="p-1.5 rounded border bg-slate-600 text-white hover:bg-slate-500 border-white/20 transition-colors" title="Toggle Sound">
                     {audioManager.isMuted ? <VolumeX className="w-3 h-3 text-red-400" /> : <Volume2 className="w-3 h-3" />}
                   </button>
                   {(isInGame || isSearching) && (
                     <button onClick={handleLeaveGame} className="flex items-center gap-1 p-1.5 rounded border bg-red-500 text-white hover:bg-red-400 border-white/20 transition-colors font-bold uppercase tracking-wider text-[10px]">
                       <RotateCcw className="w-3 h-3" /> <span className="hidden sm:inline">Leave</span>
                     </button>
                   )}
                 </div>
               )}
            </div>
          </div>

        </div>

        {/* Game Canvas Container */}
        <div className="relative bg-[#0F172A] w-full border-x-4 border-b-4 border-[#334155] rounded-b-xl shadow-[0_10px_30px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col flex-grow z-10 w-full">
          {gameState && gameState.countdown !== null && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-red-600 text-white px-6 py-2 rounded-full font-black text-xl lg:text-3xl tracking-widest uppercase border-4 border-[#0F172A] shadow-2xl z-30 animate-pulse">
              {gameState.raceCount >= gameState.totalRaces ? `Tournament Complete!` : `Next Race in ${Math.ceil(gameState.countdown / 60)}s`}
            </div>
          )}
          {gameState && gameState.status === 'finished' && gameState.isSinglePlayer && (
            <div className="fixed inset-0 w-full h-full bg-[#0F172A]/95 backdrop-blur-xl z-[100] flex items-center justify-center p-4 sm:p-8">
              <div className="bg-[#1E293B] p-8 sm:p-12 rounded-3xl border-8 border-green-500 shadow-[0_0_100px_rgba(34,197,94,0.5)] max-w-4xl w-full max-h-full overflow-y-auto">
                <h2 className="text-4xl sm:text-6xl font-black text-white text-center mb-8 sm:mb-12 uppercase tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-green-600 drop-shadow-2xl">
                  Run Ended!
                </h2>
                <div className="space-y-6">
                  {Object.values(gameState.players).map((p: any) => (
                      <div key={p.id} className={`flex flex-col justify-center items-center p-6 rounded-2xl bg-[#0F172A] border-4 border-green-400 shadow-[0_0_20px_rgba(34,197,94,0.4)] gap-4`}>
                         <span className="text-slate-400 font-bold uppercase tracking-widest text-xl">Distance Traveled</span>
                         <span className="text-green-400 font-mono font-bold text-5xl">{p.score || 0}</span>
                         <span className="text-yellow-400 font-mono font-bold text-2xl mt-4">Earned: +{Math.floor((p.score || 0) * 0.05)} Coins</span>
                      </div>
                  ))}
                </div>
                <button 
                  onClick={handleLeaveGame}
                  className="w-full mt-12 bg-pink-600 hover:bg-pink-500 text-white font-black text-2xl sm:text-4xl py-6 rounded-2xl uppercase tracking-widest border-b-8 border-pink-800 active:border-b-0 active:translate-y-2 transition-all shadow-2xl"
                >
                  Return to Menu
                </button>
              </div>
            </div>
          )}
          {gameState && gameState.status === 'finished' && !gameState.isSinglePlayer && (
            <div className="fixed inset-0 w-full h-full bg-[#0F172A]/95 backdrop-blur-xl z-[100] flex items-center justify-center p-4 sm:p-8">
              <div className="bg-[#1E293B] p-8 sm:p-12 rounded-3xl border-8 border-yellow-500 shadow-[0_0_100px_rgba(234,179,8,0.5)] max-w-4xl w-full max-h-full overflow-y-auto">
                <h2 className="text-4xl sm:text-6xl font-black text-white text-center mb-8 sm:mb-12 uppercase tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-yellow-600 drop-shadow-2xl">
                  Tournament Results
                </h2>
                <div className="space-y-6">
                  {Object.values(gameState.players)
                    .map((p: any) => {
                       const sum = p.placements.reduce((a:number,b:number)=>a+b, 0);
                       const avg = p.placements.length > 0 ? (sum / p.placements.length).toFixed(1) : "N/A";
                       return { ...p, avgNum: parseFloat(avg) || 999, avgStr: avg };
                    })
                    .sort((a,b) => a.avgNum - b.avgNum)
                    .map((p, index) => (
                      <div key={p.id} className={`flex justify-between items-center p-6 rounded-2xl bg-[#0F172A] border-4 ${index===0 ? 'border-yellow-400 shadow-[0_0_20px_rgba(234,179,8,0.4)]' : 'border-slate-700'}`}>
                         <span className="text-white font-bold flex items-center gap-4 font-mono text-2xl sm:text-3xl">
                           {index === 0 && <Trophy className="w-10 h-10 text-yellow-400 drop-shadow-[0_0_10px_rgba(234,179,8,1)]" />}
                           {index + 1}. {p.displayName || "Player"}
                         </span>
                         <span className="text-yellow-400 font-mono font-bold text-2xl sm:text-3xl">Avg: {p.avgStr}</span>
                      </div>
                  ))}
                </div>
                <button 
                  onClick={handleLeaveGame}
                  className="w-full mt-12 bg-pink-600 hover:bg-pink-500 text-white font-black text-2xl sm:text-4xl py-6 rounded-2xl uppercase tracking-widest border-b-8 border-pink-800 active:border-b-0 active:translate-y-2 transition-all shadow-2xl"
                >
                  Play Again
                </button>
              </div>
            </div>
          )}
          {gameState && gameState.status === 'waiting' && gameState.countdown === null && (
            <div className="absolute top-24 left-1/2 -translate-x-1/2 bg-[#1E293B]/90 backdrop-blur-md px-6 py-4 rounded-full border-2 border-yellow-500/50 shadow-[0_0_15px_rgba(234,179,8,0.3)] z-30 flex items-center gap-4 animate-bounce-short">
                 <div className="w-6 h-6 border-4 border-yellow-500 border-t-transparent rounded-full animate-spin"></div>
                 <div className="flex flex-col">
                   <h2 className="text-sm font-black text-white uppercase tracking-widest leading-none">Waiting for Players</h2>
                   <p className="text-xs font-mono text-yellow-400 font-bold mt-1">
                     {Object.keys(gameState.players).length} / 4 Players
                     {gameState.waitTimer !== null && ` • Bots in ${Math.ceil(gameState.waitTimer / 60)}s`}
                   </p>
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
                                      <>
                    <h2 className="text-3xl font-black uppercase tracking-widest text-white mb-6 text-center relative z-10 drop-shadow-[0_2px_10px_rgba(255,255,255,0.2)]">Pico Race</h2>
                    
                    {!user ? (
                      <div className="w-full flex flex-col gap-3 relative z-10">
                        <button 
                          onClick={handleLogin}
                          className="w-full flex items-center justify-center gap-3 px-6 py-4 rounded-xl font-bold uppercase tracking-wider text-base sm:text-lg transition-all bg-white text-slate-800 border-b-4 border-r-4 border-slate-400 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.5)] hover:bg-gray-100 active:border-b-0 active:border-r-0 active:translate-x-[4px] active:translate-y-[4px] active:shadow-none"
                        >
                          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-6 h-6" alt="Google" />
                          <span>Sign in with Google</span>
                        </button>
                        <button 
                          onClick={handleAppleLogin}
                          className="w-full flex items-center justify-center gap-3 px-6 py-4 rounded-xl font-bold uppercase tracking-wider text-base sm:text-lg transition-all bg-black text-white border-b-4 border-r-4 border-gray-700 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.5)] hover:bg-gray-900 active:border-b-0 active:border-r-0 active:translate-x-[4px] active:translate-y-[4px] active:shadow-none"
                        >
                          <svg viewBox="0 0 384 512" className="w-6 h-6 fill-white"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.1-44.6-35.9-2.8-74.3 22.7-93.1 22.7-18.9 0-46.5-22.7-76.3-22.7-44.8 0-87.1 27.5-111.4 69.8-51.2 88.5-13.3 221.7 34.6 291 23.3 33.6 51 69.8 87.5 68.3 35.1-1.5 48.7-22.7 91.1-22.7 42.4 0 54.9 22.7 91.7 22.1 38.3-.6 62.4-33.1 84.8-67.6 26.2-39.7 37-78.1 37.6-80.1-1-1-72.2-27.1-72.4-111.3zM250.7 77.2c20.4-24.8 34.1-59.5 30.4-94.2-30.8 1.2-66.8 20.6-88.3 45.4-17.7 20.3-33.8 55.7-29.2 89.8 34.1 2.6 66.8-16.1 87.1-41z"/></svg>
                          <span>Sign in with Apple</span>
                        </button>
                        <button 
                          onClick={handleGuestLogin}
                          className="w-full flex items-center justify-center gap-3 px-6 py-4 rounded-xl font-bold uppercase tracking-wider text-base sm:text-lg transition-all bg-[#334155] text-white border-b-4 border-r-4 border-[#0F172A] shadow-[2px_2px_0px_0px_rgba(0,0,0,0.5)] hover:bg-[#475569] active:border-b-0 active:border-r-0 active:translate-x-[4px] active:translate-y-[4px] active:shadow-none"
                        >
                          <LogIn className="w-6 h-6 text-white" />
                          <span>Continue as Guest</span>
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 gap-3 w-full relative z-10 mb-4">
                            <button 
                              onClick={handleJoinGame}
                              className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl font-bold uppercase tracking-wider transition-all bg-yellow-500 text-[#0F172A] border-b-4 border-yellow-700 hover:bg-yellow-400 hover:translate-y-[2px] hover:border-b-2 active:border-b-0 active:translate-y-[4px]"
                            >
                              <Users className="w-6 h-6 fill-[#0F172A]" />
                              <div className="flex flex-col items-center">
                                <span className="text-sm">Multiplayer</span>
                                <span className="text-[10px] font-mono opacity-80 mt-1">(-33⚡)</span>
                              </div>
                            </button>
                            <button 
                              onClick={handleSinglePlayer}
                              className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl font-bold uppercase tracking-wider transition-all bg-green-500 text-[#0F172A] border-b-4 border-green-700 hover:bg-green-400 hover:translate-y-[2px] hover:border-b-2 active:border-b-0 active:translate-y-[4px]"
                            >
                              <span className="text-2xl leading-none">🏃‍♂️</span>
                              <div className="flex flex-col items-center">
                                <span className="text-sm">Single Player</span>
                                <span className="text-[10px] font-mono opacity-80 mt-1">(-10⚡)</span>
                              </div>
                            </button>
                        </div>
                        <div className="grid grid-cols-3 gap-2 w-full relative z-10 mb-4">
                            <button 
                              onClick={() => setShowStore(true)}
                              className="flex flex-col items-center justify-center gap-1 p-3 rounded-lg bg-orange-600 text-white border-b-4 border-orange-800 hover:bg-orange-500 hover:translate-y-[2px] hover:border-b-2 active:border-b-0 active:translate-y-[4px] transition-all"
                            >
                              <Store className="w-5 h-5" />
                              <span className="text-[10px] uppercase font-bold tracking-wider text-center">Store</span>
                            </button>
                            <button 
                              onClick={() => { setShowLeaderboard(true); fetchLeaderboard(); }}
                              className="flex flex-col items-center justify-center gap-1 p-3 rounded-lg bg-purple-600 text-white border-b-4 border-purple-800 hover:bg-purple-500 hover:translate-y-[2px] hover:border-b-2 active:border-b-0 active:translate-y-[4px] transition-all"
                            >
                              <ListOrdered className="w-5 h-5" />
                              <span className="text-[10px] uppercase font-bold tracking-wider text-center">Top 50</span>
                            </button>
                            <button 
                              onClick={() => setShowLobby(!showLobby)}
                              className="flex flex-col items-center justify-center gap-1 p-3 rounded-lg bg-blue-600 text-white border-b-4 border-blue-800 hover:bg-blue-500 hover:translate-y-[2px] hover:border-b-2 active:border-b-0 active:translate-y-[4px] transition-all relative"
                            >
                              <Users className="w-5 h-5" />
                              <span className="text-[10px] uppercase font-bold tracking-wider text-center">Lobby</span>
                              {onlineUsers.length > 0 && (
                                  <span className="absolute -top-2 -right-2 bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full border-2 border-blue-800">{onlineUsers.length}</span>
                              )}
                            </button>
                        </div>
                        <div className="flex gap-2 w-full relative z-10">
                            {localEnergy < 100 && (
                              <button 
                                onClick={() => handleWatchAd('energy')}
                                disabled={isWatchingAd}
                                className={`flex-1 py-2 px-1 border-2 text-yellow-500 rounded-lg shadow-sm transition-all font-bold uppercase tracking-wider text-[10px] flex flex-col items-center justify-center gap-1 ${
                                  isWatchingAd ? "bg-slate-700 border-slate-600 cursor-not-allowed opacity-80" : "bg-[#0F172A] border-slate-600 hover:bg-slate-800 active:scale-95"
                                }`}
                              >
                                <Zap className={`w-4 h-4 ${isWatchingAd ? 'animate-spin' : ''}`} />
                                <span>Ad (+33⚡)</span>
                              </button>
                            )}
                            <button 
                              onClick={() => handleWatchAd('coins')}
                              disabled={isWatchingAd}
                              className={`flex-1 py-2 px-1 border-2 text-yellow-400 rounded-lg shadow-sm transition-all font-bold uppercase tracking-wider text-[10px] flex flex-col items-center justify-center gap-1 ${
                                isWatchingAd ? "bg-slate-700 border-slate-600 cursor-not-allowed opacity-80" : "bg-yellow-900 border-yellow-600 hover:bg-yellow-800 active:scale-95"
                              }`}
                            >
                               {isWatchingAd ? (
                                 <div className="w-4 h-4 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin"></div>
                               ) : (
                                 <span className="text-sm leading-none">🪙</span>
                               )}
                               <span>Ad (+50💰)</span>
                            </button>
                        </div>
                      </>
                    )}
                  </>
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
          <div className="2xl:hidden mt-2 flex justify-between gap-2 select-none touch-none z-20 relative w-full mb-1 px-2">
              <div className="flex gap-4">
                  <button
                                            onPointerDown={(e) => { handleMobileInputStart('left'); }}
                      onPointerUp={(e) => { handleMobileInputEnd('left'); }}
                      onPointerOut={(e) => { handleMobileInputEnd('left'); }}
                      onContextMenu={(e) => e.preventDefault()}
                      className="w-24 h-16 bg-slate-700 border-b-4 border-r-4 border-slate-900 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.3)] rounded-xl text-white font-bold text-2xl uppercase tracking-wider active:border-b-0 active:border-r-0 active:translate-x-[4px] active:translate-y-[4px] active:shadow-none touch-none focus:outline-none"
                  >
                    ←
                  </button>
                  <button
                                            onPointerDown={(e) => { handleMobileInputStart('right'); }}
                      onPointerUp={(e) => { handleMobileInputEnd('right'); }}
                      onPointerOut={(e) => { handleMobileInputEnd('right'); }}
                      onContextMenu={(e) => e.preventDefault()}
                      className="w-24 h-16 bg-slate-700 border-b-4 border-r-4 border-slate-900 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.3)] rounded-xl text-white font-bold text-2xl uppercase tracking-wider active:border-b-0 active:border-r-0 active:translate-x-[4px] active:translate-y-[4px] active:shadow-none touch-none focus:outline-none"
                  >
                    →
                  </button>
              </div>
              <button
                                    onPointerDown={(e) => { handleMobileInputStart('jump'); }}
                  onPointerUp={(e) => { handleMobileInputEnd('jump'); }}
                  onPointerOut={(e) => { handleMobileInputEnd('jump'); }}
                  onContextMenu={(e) => e.preventDefault()}
                  className="w-28 h-16 bg-pink-500 border-b-4 border-r-4 border-pink-700 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.3)] rounded-xl text-white font-bold text-xl uppercase tracking-wider active:border-b-0 active:border-r-0 active:translate-x-[4px] active:translate-y-[4px] active:shadow-none touch-none focus:outline-none"
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
          <div className="bg-[#1E293B] p-6 rounded-2xl border-4 border-[#334155] shadow-2xl max-w-md w-full relative flex flex-col max-h-[80vh]">
             <button onClick={() => setShowLobby(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white">✕</button>
             <h2 className="text-2xl font-black text-white uppercase tracking-widest mb-4">Lobby ({onlineUsers.length})</h2>
             
             {userProfile && (
                 <div className="mb-4 bg-[#0F172A] p-3 rounded-lg border-2 border-[#334155]">
                    <div className="text-xs text-slate-400 uppercase tracking-widest mb-1">Your Friend ID:</div>
                    <div className="flex items-center gap-2">
                        <div className="text-xl font-mono font-bold text-yellow-400 tracking-widest flex-1">{userProfile.friendCode}</div>
                        <button 
                           onClick={() => navigator.clipboard.writeText(userProfile.friendCode || "")} 
                           className="px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs font-bold text-white uppercase"
                        >Copy</button>
                    </div>
                 </div>
             )}

             <div className="mb-4 flex flex-col gap-2">
                 <div className="flex gap-2">
                     <input 
                         type="text" 
                         value={friendCodeInput} 
                         onChange={e => setFriendCodeInput(e.target.value.toUpperCase())}
                         placeholder="ENTER FRIEND ID" 
                         className="flex-1 bg-[#0F172A] border-2 border-slate-600 rounded-lg px-3 py-2 text-white font-mono uppercase focus:outline-none focus:border-pink-500"
                         maxLength={6}
                     />
                     <button 
                         onClick={async () => {
                             if (!user || !friendCodeInput || friendCodeInput.length !== 6) return;
                             setFriendMessage("Adding...");
                             const res = await addFriendByCode(user.uid, friendCodeInput);
                             setFriendMessage(res.message);
                             if (res.success) {
                                 setFriendCodeInput("");
                                 // refresh profile to get new friend list
                                 const updated = await getUserProfile(user.uid);
                                 setUserProfile(updated);
                             }
                             setTimeout(() => setFriendMessage(""), 3000);
                         }}
                         disabled={friendCodeInput.length !== 6}
                         className="px-4 py-2 bg-pink-600 hover:bg-pink-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold uppercase rounded-lg border-b-2 border-pink-800 active:border-b-0 active:translate-y-[2px]"
                     >
                         Add
                     </button>
                 </div>
                 {friendMessage && <div className="text-xs font-mono text-yellow-400">{friendMessage}</div>}
             </div>

             <div className="overflow-y-auto pr-2 flex flex-col gap-4 flex-1 min-h-[150px]">
                 {/* Online Friends */}
                 <div>
                     <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 border-b-2 border-slate-700 pb-1">Online Friends</h3>
                     <div className="flex flex-col gap-2">
                         {onlineUsers.filter(u => u.uid !== user?.uid && userProfile?.friends?.includes(u.uid)).map(u => (
                            <div key={u.socketId} className="flex flex-row items-center justify-between bg-[#0F172A] p-3 rounded-lg border-2 border-yellow-500/30">
                                <div className="flex items-center gap-3">
                                   {u.photoURL ? <img src={u.photoURL} alt="avatar" className="w-8 h-8 rounded-md" referrerPolicy="no-referrer" /> : <div className="w-8 h-8 bg-slate-700 rounded-md"></div>}
                                   <div>
                                      <div className="font-bold font-mono text-yellow-400 text-sm flex items-center gap-1">⭐ {u.displayName}</div>
                                      <div className="text-[10px] text-slate-500 uppercase">{u.status}</div>
                                   </div>
                                </div>
                                <button 
                                   onClick={() => { handleInvite(u.socketId); }}
                                   disabled={u.status === 'playing'}
                                   className={`px-3 py-1.5 rounded uppercase font-bold text-xs tracking-wider border-2 ${
                                      u.status === 'playing' ? "bg-slate-700 text-slate-500 border-slate-600 opacity-50 cursor-not-allowed" : "bg-yellow-600 text-white border-yellow-800 hover:bg-yellow-500"
                                   }`}
                                >
                                   Invite
                                </button>
                            </div>
                         ))}
                         {onlineUsers.filter(u => u.uid !== user?.uid && userProfile?.friends?.includes(u.uid)).length === 0 && (
                            <div className="text-slate-500 text-xs font-mono italic">No friends online</div>
                         )}
                     </div>
                 </div>

                 {/* Other Players */}
                 <div>
                     <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 border-b-2 border-slate-700 pb-1">Global Online</h3>
                     <div className="flex flex-col gap-2">
                         {onlineUsers.filter(u => u.uid !== user?.uid && !userProfile?.friends?.includes(u.uid)).map(u => (
                            <div key={u.socketId} className="flex flex-row items-center justify-between bg-[#0F172A] p-2 rounded-lg border border-[#334155]">
                                <div className="flex items-center gap-2">
                                   {u.photoURL ? <img src={u.photoURL} alt="avatar" className="w-6 h-6 rounded-md" referrerPolicy="no-referrer" /> : <div className="w-6 h-6 bg-slate-700 rounded-md"></div>}
                                   <div>
                                      <div className="font-bold font-mono text-slate-300 text-xs">{u.displayName}</div>
                                      <div className="text-[9px] text-slate-500 uppercase">{u.status}</div>
                                   </div>
                                </div>
                                <button 
                                   onClick={() => { handleInvite(u.socketId); }}
                                   disabled={u.status === 'playing'}
                                   className={`px-2 py-1 rounded uppercase font-bold text-[10px] tracking-wider border ${
                                      u.status === 'playing' ? "bg-slate-700 text-slate-500 border-slate-600 opacity-50 cursor-not-allowed" : "bg-slate-600 text-white border-slate-500 hover:bg-slate-500"
                                   }`}
                                >
                                   Invite
                                </button>
                            </div>
                         ))}
                         {onlineUsers.filter(u => u.uid !== user?.uid && !userProfile?.friends?.includes(u.uid)).length === 0 && (
                            <div className="text-slate-500 text-xs font-mono italic">No other players online</div>
                         )}
                     </div>
                 </div>
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

      {showLeaderboard && (
        <div className="absolute inset-0 bg-[#0F172A]/90 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-[#1E293B] p-6 md:p-8 rounded-3xl border-4 border-[#334155] shadow-2xl max-w-2xl w-full max-h-full overflow-y-auto relative flex flex-col">
             <button onClick={() => setShowLeaderboard(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white bg-slate-800 rounded-full w-8 h-8 flex items-center justify-center">✕</button>
             
             <div className="flex justify-center items-center mb-8 border-b-2 border-slate-700 pb-4">
                 <h2 className="text-3xl font-black text-white uppercase tracking-widest flex items-center gap-3">
                    <Trophy className="w-8 h-8 text-yellow-500" />
                    Top 50 High Scores
                 </h2>
             </div>
             <div className="flex-grow space-y-3">
               {topPlayers.length === 0 ? (
                 <div className="text-center text-slate-400 py-10 font-mono">Loading...</div>
               ) : (
                 topPlayers.map((p, index) => (
                   <div key={p.uid} className={`flex items-center justify-between p-4 rounded-xl bg-slate-800 border-2 ${index === 0 ? 'border-yellow-400' : index === 1 ? 'border-slate-300' : index === 2 ? 'border-amber-700' : 'border-slate-700'}`}>
                     <div className="flex items-center gap-4">
                       <span className={`font-black text-xl w-6 text-center ${index === 0 ? 'text-yellow-400' : index === 1 ? 'text-slate-300' : index === 2 ? 'text-amber-700' : 'text-slate-500'}`}>
                         #{index + 1}
                       </span>
                       <span className="text-white font-bold font-mono flex items-center gap-2">
                         {p.isAdmin && <span className="text-yellow-400">👑</span>}
                         {p.displayName || "Misafir"}
                       </span>
                     </div>
                     <span className="text-yellow-400 font-black font-mono tracking-wider flex items-center gap-1">
                       {p.highScore || 0} <span className="text-sm">⭐</span>
                     </span>
                   </div>
                 ))
               )}
             </div>
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

      {showAdminPanel && userProfile?.isAdmin && (
        <div className="absolute inset-0 bg-[#0F172A]/90 backdrop-blur-md z-[60] flex items-center justify-center p-4">
          <div className="bg-[#1E293B] p-6 md:p-8 rounded-3xl border-4 border-red-900 shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto relative flex flex-col">
             <button onClick={() => setShowAdminPanel(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white bg-slate-800 rounded-full w-8 h-8 flex items-center justify-center">✕</button>
             
             <div className="flex justify-between items-center mb-6 border-b-2 border-red-900 pb-4">
                 <h2 className="text-2xl sm:text-3xl font-black text-red-500 uppercase tracking-widest flex items-center gap-3">
                    <ShieldAlert className="w-8 h-8" />
                    Admin Panel
                 </h2>
             </div>
             <div className="flex-grow space-y-3">
               {adminLoading ? (
                 <div className="text-center text-slate-400 py-10 font-mono">Loading data...</div>
               ) : (
                 allUsers.map((p) => (
                   <div key={p.uid} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-xl bg-slate-800 border-2 border-slate-700 gap-4">
                     <div className="flex items-center gap-3">
                       <span className="text-white font-bold font-mono">
                         {p.isAdmin && <span className="text-yellow-400 mr-2">👑</span>}
                         {p.displayName || "Misafir"}
                       </span>
                       <span className="text-yellow-400 font-black font-mono tracking-wider bg-slate-900 px-2 py-1 rounded-md text-sm">
                         {p.coins || 0} 🪙
                       </span>
                     </div>
                     <div className="flex gap-2 w-full sm:w-auto">
                       <button
                         onClick={() => handleSendCoins(p.uid, 1000)}
                         className="flex-1 sm:flex-none px-3 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg font-bold text-sm shadow-md active:translate-y-1 transition-all"
                       >
                         +1000
                       </button>
                       <button
                         onClick={() => handleSendCoins(p.uid, 5000)}
                         className="flex-1 sm:flex-none px-3 py-2 bg-yellow-600 hover:bg-yellow-500 text-white rounded-lg font-bold text-sm shadow-md active:translate-y-1 transition-all"
                       >
                         +5000
                       </button>
                     </div>
                   </div>
                 ))
               )}
             </div>
          </div>
        </div>
      )}
    </div>
  );
}





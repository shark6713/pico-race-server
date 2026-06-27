class AudioManager {
  private ctx: AudioContext | null = null;
  private isInitialized = false;
  public isMuted = false;

  private menuAudio: HTMLAudioElement | null = null;
  private gameAudio: HTMLAudioElement | null = null;
  public isInGame = false;
  private wasPlayingBeforeHide = false;

  constructor() {
    this.isMuted = localStorage.getItem("picoMuted") === "true";
    if (typeof window !== "undefined") {
        this.menuAudio = new Audio('/music/menu.mp3');
        this.menuAudio.loop = true;
        this.menuAudio.volume = 0.5;
        this.gameAudio = new Audio('/music/in-game.mp3');
        this.gameAudio.loop = true;
        this.gameAudio.volume = 0.5;
    }
    this.setupVisibilityListener();
  }

  private setupVisibilityListener() {
    if (typeof window !== "undefined" && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
          // Pause currently playing music without changing state
          this.menuAudio?.pause();
          this.gameAudio?.pause();
          if (this.ctx && this.ctx.state === 'running') {
            this.ctx.suspend();
          }
        } else {
          if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
          }
          if (!this.isMuted) {
            this.playBGM();
          }
        }
      });
      // Handle autoplay block by starting music on first interaction
      document.addEventListener("click", () => {
          if (!this.isMuted && this.isInitialized) {
              this.playBGM();
          }
      }, { once: true });
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    localStorage.setItem("picoMuted", this.isMuted.toString());
    
    // Stop or start BGM based on new mute state
    if (this.isMuted) {
       this.stopBGM();
    } else {
       this.playBGM();
    }
    return this.isMuted;
  }

  init() {
    if (this.isInitialized) return;
    try {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.isInitialized = true;
      if (!this.isMuted) {
          this.playBGM();
      }
    } catch (e) {
      console.error("Web Audio API not supported", e);
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }
  
  setGameState(inGame: boolean) {
      this.isInGame = inGame;
      if (this.isInitialized && !this.isMuted) {
          this.playBGM();
      } else if (this.isInitialized && this.isMuted) {
          this.stopBGM(); // ensure correct track is ready but paused
      }
  }

  playBGM() {
    if (this.isMuted) return;
    
    if (this.isInGame) {
        this.menuAudio?.pause();
        this.gameAudio?.play().catch(e => console.log("Autoplay blocked", e));
    } else {
        this.gameAudio?.pause();
        if (this.gameAudio) this.gameAudio.currentTime = 0; // restart game music when leaving game
        this.menuAudio?.play().catch(e => console.log("Autoplay blocked", e));
    }
  }

  stopBGM() {
    this.menuAudio?.pause();
    this.gameAudio?.pause();
  }

  playJump() {
    if (!this.ctx || this.isMuted) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'sine';
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    const now = this.ctx.currentTime;
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.1);
    
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
    
    osc.start(now);
    osc.stop(now + 0.1);
  }

  playLand() {
    if (!this.ctx || this.isMuted) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'square';
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    const now = this.ctx.currentTime;
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.05);
    
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
    
    osc.start(now);
    osc.stop(now + 0.05);
  }

  playWin() {
    if (!this.ctx || this.isMuted) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'triangle';
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    const now = this.ctx.currentTime;
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.setValueAtTime(600, now + 0.1);
    osc.frequency.setValueAtTime(800, now + 0.2);
    osc.frequency.setValueAtTime(1200, now + 0.3);
    
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.05);
    gain.gain.setValueAtTime(0.2, now + 0.3);
    gain.gain.linearRampToValueAtTime(0, now + 0.5);
    
    osc.start(now);
    osc.stop(now + 0.5);
  }
}

export const audioManager = new AudioManager();

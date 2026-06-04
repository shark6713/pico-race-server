class AudioManager {
  private ctx: AudioContext | null = null;
  private isInitialized = false;
  public isMuted = false;

  private bgmInterval: number | null = null;
  private bgmOscs: OscillatorNode[] = [];
  private bgmGain: GainNode | null = null;
  private wasPlayingBeforeHide = false;

  constructor() {
    this.isMuted = localStorage.getItem("picoMuted") === "true";
    this.setupVisibilityListener();
  }

  private setupVisibilityListener() {
    if (typeof window !== "undefined" && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
          if (this.bgmInterval) {
            this.wasPlayingBeforeHide = true;
            this.stopBGM();
          } else {
            this.wasPlayingBeforeHide = false;
          }
          if (this.ctx && this.ctx.state === 'running') {
            this.ctx.suspend();
          }
        } else {
          if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
          }
          if (this.wasPlayingBeforeHide && !this.isMuted) {
            this.playBGM();
          }
        }
      });
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

  playBGM() {
    if (!this.ctx || this.isMuted || this.bgmInterval) return;
    
    this.bgmGain = this.ctx.createGain();
    this.bgmGain.gain.value = 0.05; // low volume
    this.bgmGain.connect(this.ctx.destination);
    
    // Simple retro C major arpeggio
    const notes = [261.63, 329.63, 392.00, 523.25, 392.00, 329.63];
    let step = 0;
    
    const playNote = () => {
        if (!this.ctx || !this.bgmGain) return;
        const osc = this.ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = notes[step % notes.length];
        osc.connect(this.bgmGain);
        
        const now = this.ctx.currentTime;
        osc.start(now);
        osc.stop(now + 0.15); // short note
        
        this.bgmOscs.push(osc);
        // cleanup old oscs
        if (this.bgmOscs.length > 10) {
            this.bgmOscs.shift();
        }
        step++;
    };
    
    playNote();
    this.bgmInterval = window.setInterval(playNote, 250);
  }

  stopBGM() {
    if (this.bgmInterval) {
        clearInterval(this.bgmInterval);
        this.bgmInterval = null;
    }
    this.bgmOscs.forEach(o => {
        try { o.stop(); } catch(e){}
    });
    this.bgmOscs = [];
    if (this.bgmGain) {
        this.bgmGain.disconnect();
        this.bgmGain = null;
    }
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

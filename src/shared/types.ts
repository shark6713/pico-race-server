export interface Vector {
  x: number;
  y: number;
}

export interface PlayerInput {
  left: boolean;
  right: boolean;
  jump: boolean;
}

export interface Player {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  color: string;
  isGrounded: boolean;
  input: PlayerInput;
  finished: boolean;
  isBot?: boolean;
  jumpBuffered?: boolean;
  displayName?: string;
  skin?: string;
  placements: number[];
  currentPlacement: number | null;
  score?: number;
}

export interface Block {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GameState {
  id: string;
  players: Record<string, Player>;
  blocks: Block[];
  finishLine: { x: number, y: number, width: number, height: number };
  mapWidth: number;
  mapHeight: number;
  currentLevel: number;
  raceCount: number;
  totalRaces: number;
  finishCounter: number;
  countdown: number | null;
  status: 'waiting' | 'playing' | 'finished';
  waitTimer: number | null;
  bgTheme: string;
  checkpoints: number[];
  isSinglePlayer?: boolean;
}

export interface OnlineUser {
  socketId: string;
  uid: string;
  displayName: string;
  email: string;
  photoURL?: string;
  status: 'idle' | 'searching' | 'playing';
}

export interface StoreItem {
  id: string;
  name: string;
  emoji: string;
  price: number;
}

export const STORE_ITEMS: StoreItem[] = [
  { id: "skin_cowboy", name: "Cowboy", emoji: "🤠", price: 500 },
  { id: "skin_devil", name: "Devil", emoji: "😈", price: 1000 },
  { id: "skin_robot", name: "Robot", emoji: "🤖", price: 1500 },
  { id: "skin_alien", name: "Alien", emoji: "👽", price: 2000 },
  { id: "skin_ghost", name: "Ghost", emoji: "👻", price: 2500 },
  { id: "skin_wizard", name: "Wizard", emoji: "🧙‍♂️", price: 3000 },
  { id: "skin_rocket", name: "Rocket", emoji: "🚀", price: 4000 },
  { id: "skin_king", name: "King", emoji: "👑", price: 5000 },
  { id: "skin_fire", name: "Fire", emoji: "🔥", price: 7500 },
  { id: "skin_diamond", name: "Diamond", emoji: "💎", price: 10000 },
  { id: "skin_ninja", name: "Ninja", emoji: "🥷", price: 15000 },
  { id: "skin_dragon", name: "Dragon", emoji: "🐉", price: 25000 }
];

export interface UserProfile {
  uid: string;
  coins: number;
  highScore?: number;
  inventory: string[];
  equippedSkin: string | null;
  friendCode?: string;
  friends?: string[];
  displayName?: string;
  isAdmin?: boolean;
  energy?: number;
  lastEnergyUpdateTime?: number;
}

export interface ClientEvents {
  auth: (user: { uid: string; displayName: string; email: string; photoURL?: string }) => void;
  findGame: (data?: { displayName?: string; skin?: string }) => void;
  startSinglePlayer: (data?: { displayName?: string; skin?: string }) => void;
  input: (input: PlayerInput) => void;
  leaveGame: () => void;
  inviteUser: (targetSocketId: string) => void;
  acceptInvite: (roomId: string, data?: { displayName?: string; skin?: string }) => void;
  declineInvite: (targetSocketId: string) => void;
}

export interface ServerEvents {
  stateUpdate: (state: GameState) => void;
  searching: () => void;
  onlineUsers: (users: OnlineUser[]) => void;
  inviteReceived: (from: OnlineUser, roomId: string) => void;
  inviteDeclined: (by: string) => void;
}

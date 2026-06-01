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
  displayName?: string;
  placements: number[];
  currentPlacement: number | null;
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
}

export interface OnlineUser {
  socketId: string;
  uid: string;
  displayName: string;
  email: string;
  photoURL?: string;
  status: 'idle' | 'searching' | 'playing';
}

export interface ClientEvents {
  auth: (user: { uid: string; displayName: string; email: string; photoURL?: string }) => void;
  findGame: (data?: { displayName?: string }) => void;
  input: (input: PlayerInput) => void;
  leaveGame: () => void;
  inviteUser: (targetSocketId: string) => void;
  acceptInvite: (roomId: string, data?: { displayName?: string }) => void;
  declineInvite: (targetSocketId: string) => void;
}

export interface ServerEvents {
  stateUpdate: (state: GameState) => void;
  searching: () => void;
  onlineUsers: (users: OnlineUser[]) => void;
  inviteReceived: (from: OnlineUser, roomId: string) => void;
  inviteDeclined: (by: string) => void;
}

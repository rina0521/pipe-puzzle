// src/game/pieces.ts
// Piece definitions + bitmask rotation utilities (Phaser-independent)

export type PieceId = "I2" | "L2" | "T3" | "X4" | "STOP1" | "ARROW";
export type TileKind = "PIPE" | "ARROW";
export type Rot = 0 | 1 | 2 | 3;

// Bit order: U R D L (4 bits)
export const DirBit = {
  U: 1 << 0,
  R: 1 << 1,
  D: 1 << 2,
  L: 1 << 3,
} as const;

export type DirBit = typeof DirBit[keyof typeof DirBit];

export const ALL_DIRS = [DirBit.U, DirBit.R, DirBit.D, DirBit.L] as const;
export type AnyDir = (typeof ALL_DIRS)[number];

export const OPPOSITE: Record<AnyDir, AnyDir> = {
  [DirBit.U]: DirBit.D,
  [DirBit.R]: DirBit.L,
  [DirBit.D]: DirBit.U,
  [DirBit.L]: DirBit.R,
};

export const DIR_OFFSET: Record<AnyDir, { dx: number; dy: number }> = {
  [DirBit.U]: { dx: 0, dy: -1 },
  [DirBit.R]: { dx: 1, dy: 0 },
  [DirBit.D]: { dx: 0, dy: 1 },
  [DirBit.L]: { dx: -1, dy: 0 },
};

export type PieceDef = {
  id: PieceId;
  kind: TileKind;
  baseMask: number; // mask at rot=0
};

export const PIECE_DEFS: Record<PieceId, PieceDef> = {
  I2:    { id: "I2",    kind: "PIPE", baseMask: DirBit.U | DirBit.D },              // pipe_i: 上下
  L2:    { id: "L2",    kind: "PIPE", baseMask: DirBit.U | DirBit.R },              // pipe_l: 上+右
  T3:    { id: "T3",    kind: "PIPE", baseMask: DirBit.L | DirBit.R | DirBit.D },   // pipe_t: 左右+下
  X4:    { id: "X4",    kind: "PIPE", baseMask: DirBit.U | DirBit.R | DirBit.D | DirBit.L },
  STOP1: { id: "STOP1", kind: "PIPE", baseMask: DirBit.U },                         // pipe_stop: 上だけ
  ARROW: { id: "ARROW", kind: "ARROW", baseMask: DirBit.R },
};

export function rotateMask(mask: number, rot: Rot): number {
  let m = mask & 0b1111;
  for (let i = 0; i < rot; i++) {
    // U->R, R->D, D->L, L->U (clockwise)
    const u = (m & DirBit.U) ? DirBit.R : 0;
    const r = (m & DirBit.R) ? DirBit.D : 0;
    const d = (m & DirBit.D) ? DirBit.L : 0;
    const l = (m & DirBit.L) ? DirBit.U : 0;
    m = u | r | d | l;
  }
  return m;
}

export function pieceMask(pieceId: PieceId, rot: Rot): number {
  const base = PIECE_DEFS[pieceId].baseMask;
  return rotateMask(base, rot);
}

export function rotCW(rot: Rot): Rot {
  return (((rot + 1) % 4) as Rot);
}

export function rotCCW(rot: Rot): Rot {
  return (((rot + 3) % 4) as Rot);
}

export function hasBit(mask: number, bit: DirBit): boolean {
  return (mask & bit) !== 0;
}

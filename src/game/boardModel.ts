// src/game/boardModel.ts
// Pure game logic for pipe drop puzzle (A reachable clear + optional B sealed rule)

import type { PieceId, TileKind, Rot } from "./pieces";
import {
  DirBit,
  DIR_OFFSET,
  OPPOSITE,
  ALL_DIRS,
  PIECE_DEFS,
  pieceMask,
  rotCW,
  hasBit,
} from "./pieces";
import { XorShift32 } from "./rng";


export type Pos = { x: number; y: number };

export type Tile = {
  kind: TileKind;
  pieceId: PieceId;
  rot: Rot;
};

export type FaucetMode = "ANY_EDGE" | "MASKED" | "SINGLE";

export type StageConfig = {
  version: number;
  id: string;
  name: string;

  board: { width: number; height: number };

  rules: {
    clearMode: "A_REACHABLE";
    branchSealRequired: boolean;
    spawns: {
      pipeSetSize: number;
      allowRotateBeforeDrop: boolean;
    };
  };

  faucets: {
    mode: FaucetMode;
    left: { enabledRows: "ALL" | number[] };
    right: { enabledRows: "ALL" | number[] };
  };

  deck: {
    enabledPieces: Record<PieceId, boolean>;
    weights: Record<PieceId, number>;
    rng: { seed: number | null };
  };

  initialFill?: {
    mode: "RANDOM_ROWS";
    rowsFromBottom: number;
    useInitialWeights: boolean;
    initialWeights?: Partial<Record<PieceId, number>>;
  };

  goal: {
    waterFlowsToClear: number;
  };
};

export type WaterCell = { x: number; y: number; dist: number };

export type ResolveStep =
  | { type: "WATER"; cells: WaterCell[] }   // 水が流れる演出
  | { type: "CLEAR"; cells: Pos[] }         // パイプ消去
  | { type: "DROP"; moves: { from: Pos; to: Pos; tile: Tile }[] } // 落下
  | { type: "SHIFT"; moves: { from: Pos; to: Pos; tile: Tile }[] } // 盤面スライド（将来用）
  | { type: "FLOW_COUNT"; delta: number };  // 水量カウント


export type ResolveResult = {
  steps: ResolveStep[];
  flowsGained: number;
};


function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n | 0));
}

export class BoardModel {
  public stage: StageConfig;

  readonly width: number;
  readonly height: number;

  private grid: (Tile | null)[][];
  private rng: XorShift32;

  waterFlows: number = 0;

  currentPiece: Tile | null = null;
  aimColumn: number = 0;

  constructor(stage: StageConfig) {
    this.stage = stage;

    this.width = stage.board.width;
    this.height = stage.board.height;

    this.grid = Array.from({ length: this.height }, () =>
      Array.from({ length: this.width }, () => null)
    );

    const seed = stage.deck.rng.seed ?? ((Date.now() ^ (Math.random() * 0xffffffff)) | 0);
    this.rng = new XorShift32(seed);

    this.aimColumn = Math.floor(this.width / 2);

    this.applyInitialFill();
    // 初期生成後は自動resolveしない（必要なら Scene 側で制御）
  }

  // ---------- Public read helpers ----------
  getCell(x: number, y: number): Tile | null {
    if (!this.inBounds(x, y)) return null;
    return this.grid[y][x];
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  // ---------- Spawn / input ----------
  spawnNextPiece(): Tile {
    const pieceId = this.rng.pickWeighted<PieceId>(this.stage.deck.weights, this.stage.deck.enabledPieces);
    const def = PIECE_DEFS[pieceId];
    const rot = (this.rng.nextInt(4) as Rot);
    const tile: Tile = { kind: def.kind, pieceId, rot };
    this.currentPiece = tile;
    return tile;
  }

  refillFromTop(): { from: Pos; to: Pos; tile: Tile }[] {
  const moves: { from: Pos; to: Pos; tile: Tile }[] = [];

  for (let x = 0; x < this.width; x++) {
    for (let y = 0; y < this.height; y++) {
      if (this.grid[y][x] !== null) continue;

      // 新しいタイル生成
      const pieceId = this.rng.pickWeighted<PieceId>(
        this.stage.deck.weights,
        this.stage.deck.enabledPieces
      );
      const def = PIECE_DEFS[pieceId];
      const rot = (this.rng.nextInt(4) as Rot);
      const tile: Tile = { kind: def.kind, pieceId, rot };

      // 上空から落ちてくる演出用
      this.grid[y][x] = tile;
      moves.push({
        from: { x, y: -1 }, // 画面外
        to: { x, y },
        tile: { ...tile },
      });
    }
  }

  return moves;
}


  moveAimColumn(dx: -1 | 1): void {
    this.aimColumn = clampInt(this.aimColumn + dx, 0, this.width - 1);
  }

  getDropRow(col: number): number | null {
    if (col < 0 || col >= this.width) return null;
    for (let y = this.height - 1; y >= 0; y--) {
      if (this.grid[y][col] === null) return y;
    }
    return null;
  }

  // BoardModel に追加
  rotateCellCW(x: number, y: number) {
    const t = this.getCell(x, y);
    if (!t) return;
    t.rot = rotCW(t.rot);
  }



  
  shiftAlongPath(path: Pos[]): { from: Pos; to: Pos; tile: Tile }[] {
    if (path.length < 2) return [];

    // 盤内チェック
    for (const p of path) {
      if (!this.inBounds(p.x, p.y)) return [];
    }

    const tiles = path.map(p => this.grid[p.y][p.x]);

    // 全部埋まってる前提（空マス許すならここを調整）
    if (tiles.some(t => t === null)) return [];

    // 先頭を末尾へ回す（掴んだパイプを運ぶ感覚）
    const rotated = tiles.slice(1).concat(tiles[0]);

    const moves: { from: Pos; to: Pos; tile: Tile }[] = [];

    for (let i = 0; i < path.length; i++) {
      const from = path[(i + 1) % path.length];
      const to = path[i];
      const tile = rotated[i]!;

      this.grid[to.y][to.x] = tile;
      moves.push({ from, to, tile: { ...tile } });
    }

    return moves;
  }



  canPlaceAny(): boolean {
    for (let x = 0; x < this.width; x++) {
      if (this.getDropRow(x) !== null) return true;
    }
    return false;
  }

  dropCurrent(): Pos | null {
    if (!this.currentPiece) return null;
    const y = this.getDropRow(this.aimColumn);
    if (y === null) return null;

    const placed: Tile = { ...this.currentPiece };
    this.grid[y][this.aimColumn] = placed;
    this.currentPiece = null;
    return { x: this.aimColumn, y };
  }

  // ---------- Resolve loop ----------
  resolveAll(): ResolveResult {
    const steps: ResolveStep[] = [];
    let flows = 0;

    const keyToPos = (key: string): Pos => {
      const [x, y] = key.split(",").map(Number);
      return { x, y };
    };

    while (true) {
      let clearedThisPass = false;

      // ★ 左端の各行を「別の供給口」として、入口ごとに判定する
      for (let startY = 0; startY < this.height; startY++) {
        if (!this.isLeftRowEnabled(startY)) continue;

        const network = this.collectNetworkFromStart(startY);
        if (network.size === 0) continue;

        // 右端に到達していないなら、この入口ネットワークは消去対象外
        if (!this.networkReachesRight(network)) continue;

        // 健全性チェック（リーク禁止）
        const chk = this.checkNetworkValid(network);
        if (!chk.ok) {
          // デバッグしたいならここでログ
          // console.log("[resolve blocked]", startY, chk.reason);
          continue;
        }

        // --- ここまで来たら「この入口ネットワークだけ」消す ---
        const cells = Array.from(network).map(keyToPos);

        steps.push({
          type: "WATER",
          cells: cells.map(c => ({ ...c, dist: 0 })), // dist 演出したければ別途 dist 計算に差し替え
        });

        this.clearCells(cells);
        steps.push({ type: "CLEAR", cells });

        flows += 1;
        this.waterFlows += 1;
        steps.push({ type: "FLOW_COUNT", delta: 1 });

        // 落下
        const gravityMoves = this.applyGravity();
        if (gravityMoves.length > 0) {
          steps.push({ type: "DROP", moves: gravityMoves });
        }

        // ★ 補充（盤面を満杯に戻す）
        const refillMoves = this.refillFromTop();
        if (refillMoves.length > 0) {
          steps.push({ type: "DROP", moves: refillMoves });
        }

        clearedThisPass = true;
        break; // 盤面が変わったので、入口走査は最初からやり直す
      }

      if (!clearedThisPass) break;
    }

    return { steps, flowsGained: flows };
  }



  triggerArrowAt(pos: Pos): ResolveStep[] {
    const tile = this.getCell(pos.x, pos.y);
    if (!tile || tile.kind !== "ARROW") return [];

    const mask = pieceMask(tile.pieceId, tile.rot);

    const dir = ALL_DIRS.find(d => hasBit(mask, d));
    if (!dir) return [];

    const toClear: Pos[] = [{ x: pos.x, y: pos.y }];

    const off = DIR_OFFSET[dir];
    let x = pos.x + off.dx;
    let y = pos.y + off.dy;
    while (this.inBounds(x, y)) {
      if (this.grid[y][x] !== null) toClear.push({ x, y });
      x += off.dx;
      y += off.dy;
    }

    this.clearCells(toClear);
    const steps: ResolveStep[] = [{ type: "CLEAR", cells: toClear }];

    const moves = this.applyGravity();
    if (moves.length > 0) steps.push({ type: "DROP", moves });

    return steps;
  }

// BoardModel class に追加
debugWhyNotClearing(): {
  reachedRight: boolean;
  leakOk: boolean;
  reachableCount: number;
  firstLeak?: {
    x: number; y: number; dir: number;
    reason: "OUT_OF_BOUNDS" | "EMPTY_NEIGHBOR" | "NEIGHBOR_NOT_REACHABLE" | "NO_OPPOSITE";
    nx?: number; ny?: number;
  };
} {
  const water = this.computeReachableFromLeft();

  // reachedRight が false の時点で「右まで届いてない」
  if (!water.reachedRight) {
    return {
      reachedRight: false,
      leakOk: false,
      reachableCount: water.reachable.size,
    };
  }

  // reachable ネットワークの「最初の漏れ」を探して返す
  const reachable = water.reachable;

  for (const key of reachable) {
    const [x, y] = key.split(",").map(Number);
    const t = this.grid[y][x];
    if (!t) continue;

    const m = pieceMask(t.pieceId, t.rot);

    for (const dir of ALL_DIRS) {
      if (!hasBit(m, dir)) continue;

      const off = DIR_OFFSET[dir];
      const nx = x + off.dx;
      const ny = y + off.dy;

      if (!this.inBounds(nx, ny)) {
        const okLeft = (x === 0 && dir === DirBit.L && this.isLeftRowEnabled(y));
        const okRight = (x === this.width - 1 && dir === DirBit.R && this.isRightRowEnabled(y));
        if (okLeft || okRight) continue;

        return {
          reachedRight: true,
          leakOk: false,
          reachableCount: reachable.size,
          firstLeak: { x, y, dir, nx, ny, reason: "OUT_OF_BOUNDS" },
        };
      }

      const nt = this.grid[ny][nx];
      if (!nt) {
        return {
          reachedRight: true,
          leakOk: false,
          reachableCount: reachable.size,
          firstLeak: { x, y, dir, nx, ny, reason: "EMPTY_NEIGHBOR" },
        };
      }

      const nKey = `${nx},${ny}`;
      if (!reachable.has(nKey)) {
        return {
          reachedRight: true,
          leakOk: false,
          reachableCount: reachable.size,
          firstLeak: { x, y, dir, nx, ny, reason: "NEIGHBOR_NOT_REACHABLE" },
        };
      }

      const nm = pieceMask(nt.pieceId, nt.rot);
      if (!hasBit(nm, OPPOSITE[dir])) {
        return {
          reachedRight: true,
          leakOk: false,
          reachableCount: reachable.size,
          firstLeak: { x, y, dir, nx, ny, reason: "NO_OPPOSITE" },
        };
      }
    }
  }

  // ここまで来たら漏れなし
  return {
    reachedRight: true,
    leakOk: true,
    reachableCount: reachable.size,
  };
}

private collectNetworkFromStart(startY: number): Set<string> {
  const visited = new Set<string>();
  const q: Pos[] = [];

  const t0 = this.grid[startY][0];
  if (!t0) return visited;
  const m0 = pieceMask(t0.pieceId, t0.rot);
  if (!hasBit(m0, DirBit.L)) return visited; // 供給口に接続してない

  const startKey = `0,${startY}`;
  visited.add(startKey);
  q.push({ x: 0, y: startY });

  while (q.length > 0) {
    const cur = q.shift()!;
    const curTile = this.grid[cur.y][cur.x]!;
    const curMask = pieceMask(curTile.pieceId, curTile.rot);

    for (const dir of ALL_DIRS) {
      if (!hasBit(curMask, dir)) continue;

      const off = DIR_OFFSET[dir];
      const nx = cur.x + off.dx;
      const ny = cur.y + off.dy;
      if (!this.inBounds(nx, ny)) continue;

      const nt = this.grid[ny][nx];
      if (!nt) continue;

      const nm = pieceMask(nt.pieceId, nt.rot);
      if (!hasBit(nm, OPPOSITE[dir])) continue;

      const nk = `${nx},${ny}`;
      if (visited.has(nk)) continue;

      visited.add(nk);
      q.push({ x: nx, y: ny });
    }
  }

  return visited;
}


private leakReason(network: Set<string>): string | null {
  const dirName = (d: number) =>
    d === DirBit.U ? "U" : d === DirBit.R ? "R" : d === DirBit.D ? "D" : "L";

  for (const key of network) {
    const [x, y] = key.split(",").map(Number);
    const t = this.grid[y][x];
    if (!t) return `network cell is null at ${key}`;

    const m = pieceMask(t.pieceId, t.rot);

    for (const dir of ALL_DIRS) {
      if (!hasBit(m, dir)) continue;

      const off = DIR_OFFSET[dir];
      const nx = x + off.dx;
      const ny = y + off.dy;

      // 盤外に向いた口
      if (!this.inBounds(nx, ny)) {
        const okLeft = (x === 0 && dir === DirBit.L);
        const okRight = (x === this.width - 1 && dir === DirBit.R);
        if (okLeft || okRight) continue;
        return `LEAK_OUTSIDE at (${x},${y}) dir=${dirName(dir)}`;
      }

      // 盤内：空
      const nt = this.grid[ny][nx];
      if (!nt) return `LEAK_EMPTY at (${x},${y})->(${nx},${ny}) dir=${dirName(dir)}`;

      // 盤内：相手が閉じてる
      const nm = pieceMask(nt.pieceId, nt.rot);
      if (!hasBit(nm, OPPOSITE[dir])) {
        return `LEAK_CLOSED_NEIGHBOR at (${x},${y})->(${nx},${ny}) dir=${dirName(dir)}`;
      }

      // 盤内：ネットワーク外に口が向いてる（分岐の取りこぼし等）
      const nk = `${nx},${ny}`;
      if (!network.has(nk)) {
        return `LEAK_TO_NON_NETWORK at (${x},${y})->(${nx},${ny}) dir=${dirName(dir)}`;
      }
    }
  }
  return null;
}



private networkReachesRight(network: Set<string>): boolean {
  for (const key of network) {
    const [x, y] = key.split(",").map(Number);

    // 右端の列だけ見る
    if (x !== this.width - 1) continue;

    const t = this.grid[y][x];
    if (!t) continue;

    const m = pieceMask(t.pieceId, t.rot);

    // 右方向に開いていれば排水に到達
    if (hasBit(m, DirBit.R)) {
      return true;
    }
  }
  return false;
}


private isNetworkValid(network: Set<string>): boolean {
  for (const key of network) {
    const [x, y] = key.split(",").map(Number);
    const t = this.grid[y][x]!;
    const m = pieceMask(t.pieceId, t.rot);

    for (const dir of ALL_DIRS) {
      if (!hasBit(m, dir)) continue;

      const off = DIR_OFFSET[dir];
      const nx = x + off.dx;
      const ny = y + off.dy;

      // 盤外
      if (!this.inBounds(nx, ny)) {
        const okLeft = (x === 0 && dir === DirBit.L);
        const okRight = (x === this.width - 1 && dir === DirBit.R);
        if (okLeft || okRight) continue;
        return false;
      }

      // 盤内
      const nt = this.grid[ny][nx];
      if (!nt) return false;

      const nm = pieceMask(nt.pieceId, nt.rot);
      if (!hasBit(nm, OPPOSITE[dir])) return false;

      const nk = `${nx},${ny}`;
      if (!network.has(nk)) return false;
    }
  }
  return true;
}


  private applyInitialFill(): void {
    const fill = this.stage.initialFill;
    if (!fill) return;
    if (fill.mode !== "RANDOM_ROWS") return;

    const rows = clampInt(fill.rowsFromBottom, 0, this.height);
    if (rows <= 0) return;

    const startY = this.height - rows;
    const initialWeights = fill.useInitialWeights ? this.buildInitialWeights(fill.initialWeights) : null;

    for (let y = startY; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const pieceId = initialWeights
          ? this.rng.pickWeighted<PieceId>(initialWeights, this.stage.deck.enabledPieces)
          : this.rng.pickWeighted<PieceId>(this.stage.deck.weights, this.stage.deck.enabledPieces);

        const def = PIECE_DEFS[pieceId];
        const rot = (this.rng.nextInt(4) as Rot);
        this.grid[y][x] = { kind: def.kind, pieceId, rot };
      }
    }
  }

  private buildInitialWeights(override?: Partial<Record<PieceId, number>>): Record<PieceId, number> {
    const base: Record<PieceId, number> = {
      I2: 50,
      L2: 40,
      T3: 10,
      X4: 0,
      STOP1: 0,
      ARROW: 0,
    };
    if (override) {
      for (const k of Object.keys(override) as PieceId[]) {
        const v = override[k];
        if (typeof v === "number") base[k] = v;
      }
    }
    return base;
  }

  // ---------- Water logic ----------
  private isLeftRowEnabled(y: number): boolean {
    const { mode, left } = this.stage.faucets;
    if (mode === "ANY_EDGE") return true;
    const rows = left.enabledRows;
    if (rows === "ALL") return true;
    return rows.includes(y);
  }

  private isRightRowEnabled(y: number): boolean {
    const { mode, right } = this.stage.faucets;
    if (mode === "ANY_EDGE") return true;
    const rows = right.enabledRows;
    if (rows === "ALL") return true;
    return rows.includes(y);
  }

private computeReachableFromLeft(): {
  reachable: Set<string>;
  dist: Map<string, number>;
  reachedRight: boolean;
} {
  const reachable = new Set<string>();
  const dist = new Map<string, number>();
  const q: { x: number; y: number }[] = [];

  const x0 = 0;
  for (let y = 0; y < this.height; y++) {
    if (!this.isLeftRowEnabled(y)) continue;

    const t = this.grid[y][x0];
    if (!t) continue;

    const m = pieceMask(t.pieceId, t.rot);

    // ★ 左タンクは盤外（左側）にあるので、左向き(L)の口が必要
    if (!hasBit(m, DirBit.L)) continue;

    const key = `${x0},${y}`;
    reachable.add(key);
    dist.set(key, 0);
    q.push({ x: x0, y });
  }

  let reachedRight = false;

  while (q.length > 0) {
    const cur = q.shift()!;
    const curKey = `${cur.x},${cur.y}`;
    const curTile = this.grid[cur.y][cur.x];
    if (!curTile) continue;

    const curMask = pieceMask(curTile.pieceId, curTile.rot);
    const curDist = dist.get(curKey) ?? 0;

    // ★ 右端で右向き(R)が開いてれば排水に到達
    if (cur.x === this.width - 1 && this.isRightRowEnabled(cur.y) && hasBit(curMask, DirBit.R)) {
      reachedRight = true;
    }

    for (const dir of ALL_DIRS) {
      if (!hasBit(curMask, dir)) continue;

      const off = DIR_OFFSET[dir];
      const nx = cur.x + off.dx;
      const ny = cur.y + off.dy;
      if (!this.inBounds(nx, ny)) continue;

      const nt = this.grid[ny][nx];
      if (!nt) continue;

      const nMask = pieceMask(nt.pieceId, nt.rot);
      if (!hasBit(nMask, OPPOSITE[dir])) continue;

      const nKey = `${nx},${ny}`;
      if (reachable.has(nKey)) continue;

      reachable.add(nKey);
      dist.set(nKey, curDist + 1);
      q.push({ x: nx, y: ny });
    }
  }

  return { reachable, dist, reachedRight };
}

  // ---------- Mutations ----------
  private clearCells(cells: Pos[]): void {
    for (const c of cells) {
      if (!this.inBounds(c.x, c.y)) continue;
      this.grid[c.y][c.x] = null;
    }
  }

  private applyGravity(): { from: Pos; to: Pos; tile: Tile }[] {
    const moves: { from: Pos; to: Pos; tile: Tile }[] = [];

    for (let x = 0; x < this.width; x++) {
      let writeY = this.height - 1;
      for (let y = this.height - 1; y >= 0; y--) {
        const t = this.grid[y][x];
        if (!t) continue;
        if (y !== writeY) {
          this.grid[writeY][x] = t;
          this.grid[y][x] = null;
          moves.push({ from: { x, y }, to: { x, y: writeY }, tile: { ...t } });
        }
        writeY--;
      }
    }

    return moves;
  }
  private checkNetworkValid(network: Set<string>): { ok: true } | { ok: false; reason: string } {
  for (const key of network) {
    const [x, y] = key.split(",").map(Number);
    const t = this.grid[y][x];
    if (!t) return { ok: false, reason: `network cell is null at ${key}` };

    const m = pieceMask(t.pieceId, t.rot);

    for (const dir of ALL_DIRS) {
      if (!hasBit(m, dir)) continue;

      const off = DIR_OFFSET[dir];
      const nx = x + off.dx;
      const ny = y + off.dy;

      // 盤外
      if (!this.inBounds(nx, ny)) {
        const okLeft  = (x === 0 && dir === DirBit.L && this.isLeftRowEnabled(y));
        const okRight = (x === this.width - 1 && dir === DirBit.R && this.isRightRowEnabled(y));
        if (okLeft || okRight) continue;
        return { ok: false, reason: `leak to OUTSIDE at (${x},${y}) dir=${dir}` };
      }


      // 盤内
      const nt = this.grid[ny][nx];
      if (!nt) return { ok: false, reason: `leak to EMPTY at (${x},${y})->(${nx},${ny}) dir=${dir}` };

      const nm = pieceMask(nt.pieceId, nt.rot);
      if (!hasBit(nm, OPPOSITE[dir])) {
        return { ok: false, reason: `neighbor closed at (${x},${y})->(${nx},${ny}) dir=${dir}` };
      }

      const nk = `${nx},${ny}`;
      if (!network.has(nk)) {
        return { ok: false, reason: `leak to NON-NETWORK at (${x},${y})->(${nx},${ny}) dir=${dir}` };
      }
    }
  }
  return { ok: true };
}

}

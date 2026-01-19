import Phaser from "phaser";
import type { BoardModel, Pos, ResolveStep } from "../game/boardModel";
import type { PieceId } from "../game/pieces";

// ★ 必須（ここに OPPOSITE を追加）
import {
  pieceMask,
  hasBit,
  DirBit,
} from "../game/pieces";


type Rect = { x: number; y: number; width: number; height: number };

type CellSprite = {
  base?: Phaser.GameObjects.Image;       // pipe sprite
  water?: Phaser.GameObjects.Rectangle;  // water highlight behind
};

export class BoardView {
  private scene: Phaser.Scene;
  private model: BoardModel;

  private cellSize: number;
  private offsetX: number;
  private offsetY: number;

  private cells: CellSprite[][];
  private ghost: Phaser.GameObjects.Image;

  // ★ デバッグ用
  private debugG: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, model: BoardModel, area: Rect) {
    this.scene = scene;
    this.model = model;
    

    // Fit grid in area
    const cs = Math.floor(Math.min(area.width / model.width, area.height / model.height));
    this.cellSize = cs;
    this.offsetX = area.x + Math.floor((area.width - cs * model.width) / 2);
    this.offsetY = area.y + Math.floor((area.height - cs * model.height) / 2);

    this.cells = Array.from({ length: model.height }, () =>
      Array.from({ length: model.width }, () => ({}))
    );

    // background grid + water layer
    for (let y = 0; y < model.height; y++) {
      for (let x = 0; x < model.width; x++) {
        const { px, py } = this.cellCenter(x, y);

        const water = scene.add
          .rectangle(px, py, this.cellSize - 6, this.cellSize - 6, 0x1e90ff, 1)
          .setAlpha(0)
          .setDepth(0);


        scene.add
          .image(px, py, "pipe_blank")
          .setDisplaySize(this.cellSize, this.cellSize)
          .setAlpha(0.35)
          .setDepth(1);

        this.cells[y][x].water = water;
      }
    }

    // ghost piece preview
    this.ghost = scene.add.image(0, 0, "pipe_i").setDepth(10).setAlpha(0.6);
    this.ghost.setVisible(false);
    // ★ デバッグ用 Graphics（必ず初期化）
    this.debugG = this.scene.add.graphics().setDepth(20);

    // --- grid lines (thin gray) ---
    const g = scene.add.graphics().setDepth(1.5);
    g.lineStyle(1, 0xaaaaaa, 0.25);

    // outer box + inner lines
    const left = this.offsetX;
    const top = this.offsetY;
    const right = this.offsetX + this.cellSize * model.width;
    const bottom = this.offsetY + this.cellSize * model.height;

    // vertical lines
    for (let x = 0; x <= model.width; x++) {
      const px = left + x * this.cellSize;
      g.lineBetween(px, top, px, bottom);
    }
    // horizontal lines
    for (let y = 0; y <= model.height; y++) {
      const py = top + y * this.cellSize;
      g.lineBetween(left, py, right, py);
    }


  }

  // ---------- Public ----------
syncAll() {
  for (let y = 0; y < this.model.height; y++) {
    for (let x = 0; x < this.model.width; x++) {
      this.placeFromModel(x, y);
    }
  }
  this.drawDebugConnections(); // ★毎回必ず更新
}


  syncCells(cells: {x:number;y:number}[]) {
    for (const c of cells) this.placeFromModel(c.x, c.y);
     this.drawDebugConnections(); 
  }


  rotateCellAnim(x: number, y: number) {
    const cell = this.cells[y][x];
    if (!cell.base) return;

    this.scene.tweens.add({
      targets: cell.base,
      angle: cell.base.angle + 90,   // Phaserはdeg(度)でもいける
      duration: 80,
      ease: "Sine.easeInOut",
    });
  }


  placeFromModel(x: number, y: number) {
    const tile = this.model.getCell(x, y);
    const cell = this.cells[y][x];
    const { px, py } = this.cellCenter(x, y);
    

    if (!tile) {
      if (cell.base) {
        cell.base.destroy();
        cell.base = undefined;
      }
      return;
    }
    

    const tex = textureForPiece(tile.pieceId);
    if (!cell.base) {
      cell.base = this.scene.add.image(px, py, tex).setDepth(2);
      cell.base.setDisplaySize(this.cellSize, this.cellSize);
    } else {
      cell.base.setTexture(tex);
      cell.base.setPosition(px, py);
    }
    cell.base.setRotation((Math.PI / 2) * tile.rot);
    
  }

  showGhost(model: BoardModel) {
    const p = model.currentPiece;
    if (!p) {
      this.ghost.setVisible(false);
      return;
    }

    const x = model.aimColumn;
    const y = 0; // just show at top row visually
    const { px, py } = this.cellCenter(x, y);

    this.ghost.setVisible(true);
    this.ghost.setTexture(textureForPiece(p.pieceId));
    this.ghost.setPosition(px, py);
    this.ghost.setDisplaySize(this.cellSize, this.cellSize);
    this.ghost.setRotation((Math.PI / 2) * p.rot);
  }

  async playSteps(steps: ResolveStep[]) {
    for (const step of steps) {
      switch (step.type) {

        case "WATER": {
          await this.playWaterHighlight(step.cells);
          break;
        }

        case "CLEAR": {
          this.applyClear(step.cells);
          break;
        }

        case "DROP": {
          await this.playDrops(step.moves);
          break;
        }

        case "SHIFT": {
          // 今は未使用（ドラッグ中は即反映する想定）
          // もし resolve 内で盤面移動を演出したくなったら使う
          await this.playShifts(step.moves);
          break;
        }

        case "FLOW_COUNT": {
          // UI演出用（今は何もしない）
          break;
        }
      }
    }
  }

  private async playShifts(
    moves: { from: Pos; to: Pos; tile: any }[]
  ) {
    if (moves.length === 0) return;

    const temps: Phaser.GameObjects.Image[] = [];

    for (const m of moves) {
      const from = this.cellCenter(m.from.x, m.from.y);
      const to = this.cellCenter(m.to.x, m.to.y);

      const tex = textureForPiece(m.tile.pieceId);
      const img = this.scene.add.image(from.px, from.py, tex).setDepth(5);
      img.setDisplaySize(this.cellSize, this.cellSize);
      img.setRotation((Math.PI / 2) * (m.tile.rot ?? 0));

      temps.push(img);

      this.scene.tweens.add({
        targets: img,
        x: to.px,
        y: to.py,
        duration: 80,
        ease: "Sine.easeInOut",
      });
    }

    await wait(this.scene, 90);

    for (const t of temps) t.destroy();
    this.syncAll();
  }

private drawDebugConnections() {
  if (!this.debugG) {
    this.debugG = this.scene.add.graphics().setDepth(999);
  }

  this.debugG.clear();

  const targetX = this.model.width - 1;
  const targetY = this.model.height - 3;

  const t = this.model.getCell(targetX, targetY);
  if (!t) {
    console.log("TARGET CELL EMPTY", { targetX, targetY });
    return;
  }

  const mask = pieceMask(t.pieceId, t.rot);

  // ★ これだけ見る
  console.log("TARGET CELL", {
    x: targetX,
    y: targetY,
    pieceId: t.pieceId,
    rot: t.rot,
    mask,
  });

  const { px, py } = this.cellCenter(targetX, targetY);
  const r = this.cellSize * 0.45;

  for (const dir of [DirBit.U, DirBit.R, DirBit.D, DirBit.L] as const) {
    if (!hasBit(mask, dir)) continue;

    this.debugG.lineStyle(6, 0x00ff00, 1);

    if (dir === DirBit.U) this.debugG.lineBetween(px, py, px, py - r);
    if (dir === DirBit.R) this.debugG.lineBetween(px, py, px + r, py);
    if (dir === DirBit.D) this.debugG.lineBetween(px, py, px, py + r);
    if (dir === DirBit.L) this.debugG.lineBetween(px, py, px - r, py);
  }
}





  // ---------- Effects ----------
  private async playWaterHighlight(cells: { x: number; y: number; dist: number }[]) {
    const grouped = new Map<number, { x: number; y: number }[]>();
    for (const c of cells) {
      const arr = grouped.get(c.dist) ?? [];
      arr.push({ x: c.x, y: c.y });
      grouped.set(c.dist, arr);
    }

    const dists = Array.from(grouped.keys()).sort((a, b) => a - b);
    for (const d of dists) {
      const arr = grouped.get(d)!;
      for (const p of arr) this.setWater(p.x, p.y, 0.6);
      await wait(this.scene, 45);
    }
    await wait(this.scene, 120);
    for (const c of cells) this.setWater(c.x, c.y, 0);
  }

  private applyClear(cells: { x: number; y: number }[]) {
    for (const c of cells) {
      const cell = this.cells[c.y][c.x];
      if (cell.base) {
        cell.base.destroy();
        cell.base = undefined;
      }
      this.setWater(c.x, c.y, 0);
    }
  }

  private async playDrops(moves: { from: Pos; to: Pos; tile: any }[]) {
    if (moves.length === 0) return;

    // Create temp sprites at "from", tween to "to"
    const temps: Phaser.GameObjects.Image[] = [];

    for (const m of moves) {
      // to は盤内のはずだが念のため
      if (m.to.x < 0 || m.to.x >= this.model.width || m.to.y < 0 || m.to.y >= this.model.height) {
        continue;
      }
      const from = this.cellCenter(m.from.x, m.from.y);
      const to = this.cellCenter(m.to.x, m.to.y);

      // Hide any existing sprite at from (we'll resync later)
      const fy = m.from.y;
      const fx = m.from.x;
      if (fy >= 0 && fy < this.model.height && fx >= 0 && fx < this.model.width) {
        const fromCell = this.cells[fy][fx];
        if (fromCell.base) {
          fromCell.base.destroy();
          fromCell.base = undefined;
        }
      }

      const tex = textureForPiece(m.tile.pieceId as PieceId);
      const img = this.scene.add.image(from.px, from.py, tex).setDepth(5);
      img.setDisplaySize(this.cellSize, this.cellSize);
      img.setRotation((Math.PI / 2) * (m.tile.rot ?? 0));

      temps.push(img);

      // Tween to destination
      this.scene.tweens.add({
        targets: img,
        x: to.px,
        y: to.py,
        duration: 140,
        ease: "Sine.easeInOut",
      });
    }

    await wait(this.scene, 150);

    // Cleanup temps and redraw final state from model
    for (const t of temps) t.destroy();
    this.syncAll();
  }

  // ---------- Helpers ----------
  private cellCenter(x: number, y: number) {
    const px = this.offsetX + x * this.cellSize + this.cellSize / 2;
    const py = this.offsetY + y * this.cellSize + this.cellSize / 2;
    return { px, py };
  }

  private setWater(x: number, y: number, alpha: number) {
    const w = this.cells[y][x].water;
    if (!w) return;
    w.setAlpha(alpha);
  }
  
public logCell(x: number, y: number) {
  const t = this.model.getCell(x, y);
  const s = this.cells[y]?.[x]?.base;

  const q = s ? Math.round(s.rotation / (Math.PI / 2)) : null;
  const spriteRotQuarter = q === null ? null : ((q % 4) + 4) % 4;


  console.log("[CELL]", {
    x, y,
    pieceId: t?.pieceId,
    modelRot: t?.rot,
    spriteRotQuarter,
    mask: t ? pieceMask(t.pieceId, t.rot) : null,
  });
}




}



function textureForPiece(pieceId: PieceId): string {
  switch (pieceId) {
    case "I2": return "pipe_i";
    case "L2": return "pipe_l";
    case "T3": return "pipe_t";
    case "X4": return "pipe_x";
    case "STOP1": return "pipe_stop";
    case "ARROW": return "pipe_i"; // 使うなら後で専用画像
    default: return "pipe_i";
  }
}



function wait(scene: Phaser.Scene, ms: number) {
  return new Promise<void>((resolve) => scene.time.delayedCall(ms, () => resolve()));
}


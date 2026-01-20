import Phaser from "phaser";
import type { BoardModel, Pos, ResolveStep } from "../game/boardModel";
import type { PieceId } from "../game/pieces";

// ★ 必須（ここに OPPOSITE を追加）
import {
  pieceMask,
} from "../game/pieces";


type Rect = { x: number; y: number; width: number; height: number };

type CellSprite = {
  blank?: Phaser.GameObjects.Image;      // ← 追加：常に存在する入力面
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


        const blank = scene.add
          .image(px, py, "pipe_blank")
          .setDisplaySize(this.cellSize, this.cellSize)
          .setAlpha(0.35)
          .setDepth(1);

        this.cells[y][x].water = water;
        this.cells[y][x].blank = blank;

      }
    }

    // ghost piece preview
    this.ghost = scene.add.image(0, 0, "pipe_i").setDepth(10).setAlpha(0.6);
    this.ghost.setVisible(false);

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
}


  syncCells(cells: {x:number;y:number}[]) {
    for (const c of cells) this.placeFromModel(c.x, c.y);
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

// BoardView.ts（置き換え）
async playSteps(
  steps: ResolveStep[],
  opt: {
    stepDelayMs?: number;        // 各ステップ間の待ち
    waterStepMs?: number;        // 水distごとの待ち（A）
    waterTailMs?: number;        // WATER最後の余韻（A）
    enableWaterParticle?: boolean; // B
    waterHopMs?: number;         // B 粒が1マス進む時間
    enableWaterNotes?: boolean;  // C
  } = {}
) {
  const stepDelayMs = opt.stepDelayMs ?? 0;

  for (const step of steps) {
    switch (step.type) {
      case "WATER": {
        await this.playWaterHighlight(step.cells, opt);
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
        await this.playShifts(step.moves);
        break;
      }
      case "FLOW_COUNT": {
        break;
      }
    }

    if (stepDelayMs > 0) {
      await wait(this.scene, stepDelayMs);
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

  // ---------- Effects ----------
private async playWaterHighlight(
  cells: { x: number; y: number; dist: number }[],
  opt: {
    waterStepMs?: number;        // 波の進み
    waterTailMs?: number;        // 最後の余韻
    enableWaterParticle?: boolean;
    waterHopMs?: number;         // 白点の移動
    enableWaterNotes?: boolean;
    waterFadeOutMs?: number;     // ★追加：消える速さ（左から引く感じ）
    waterAlpha?: number;         // ★追加：点灯の濃さ
    waterEndHoldMs?: number; // ★追加：流れ切った後の停止時間

  } = {}
) {
  const waterStepMs = opt.waterStepMs ?? 140;
  const hopMs = opt.waterHopMs ?? 220;

  const waterAlpha = opt.waterAlpha ?? 0.65;
  const fadeOutMs = opt.waterFadeOutMs ?? 420;

  // 1) distでグルーピング
  const grouped = new Map<number, { x: number; y: number }[]>();
  for (const c of cells) {
    const arr = grouped.get(c.dist) ?? [];
    arr.push({ x: c.x, y: c.y });
    grouped.set(c.dist, arr);
  }

  // distが全部0だと波にならないので、順序用に「擬似dist」を作る保険
  // （本当は BoardModel 側で dist をちゃんと出すのが理想）
  const hasMultipleDist = grouped.size > 1;
  let dists: number[];

  if (hasMultipleDist) {
    dists = Array.from(grouped.keys()).sort((a, b) => a - b);
  } else {
    // 擬似dist：左→右（同じxなら上→下）で進める
    const sorted = [...cells].sort((a, b) => (a.x - b.x) || (a.y - b.y));
    grouped.clear();
    sorted.forEach((c, i) => {
      grouped.set(i, [{ x: c.x, y: c.y }]);
    });
    dists = Array.from(grouped.keys()); // 0..n-1
  }

  // 2) 白点（任意）
  let dot: Phaser.GameObjects.Arc | null = null;
  if (opt.enableWaterParticle && dists.length > 0) {
    const p0 = grouped.get(dists[0])![0];
    const c0 = this.cellCenter(p0.x, p0.y);
    dot = this.scene.add
      .circle(c0.px, c0.py, Math.max(2, Math.floor(this.cellSize * 0.12)), 0xffffff, 1)
      .setDepth(6);
  }

  // 3) 波：distごとに “追加で” 点灯していく（右まで一瞬にならない）
  const lit: { x: number; y: number }[] = [];
  let sfxStep = 0; // ★追加：音程上げる用（点灯したマス数カウント）

  for (const d of dists) {
    const arr = grouped.get(d)!;

    for (const p of arr) {
      this.setWater(p.x, p.y, waterAlpha);
      lit.push(p);

      // ★追加：このマスが満たされたタイミングで鳴らす
      this.playFillSfx(sfxStep);
      sfxStep++;
    }

    if (dot) {
      const target = arr[0];
      const to = this.cellCenter(target.x, target.y);
      await this.tweenPromise(dot, { x: to.px, y: to.py, duration: hopMs, ease: "Linear" });

      if (opt.enableWaterNotes) this.playWaterNote(d);
    }

    await wait(this.scene, waterStepMs);
  }


const endHold = opt.waterEndHoldMs ?? 250;
await wait(this.scene, endHold);

await this.fadeOutWater(lit, fadeOutMs);

  dot?.destroy();
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

  private playFillSfx(stepIndex: number) {
    const baseRate = 0.95;
    const rateStep = 0.02;
    const rate = Math.min(1.35, baseRate + stepIndex * rateStep);

    this.scene.sound.play("blip", {
      volume: 0.35,
      rate,
  });
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
  
  private tweenPromise(
    targets: any,
    cfg: Omit<Phaser.Types.Tweens.TweenBuilderConfig, "targets">
  ): Promise<void> {
    return new Promise((resolve) => {
      this.scene.tweens.add({
        targets,
        ...cfg,
        onComplete: () => resolve(),
      });
    });
  }

  private async fadeOutWater(cells: { x: number; y: number }[], durationMs: number) {
  if (cells.length === 0) return;

  // 左→右に引いていく（x優先）
  const sorted = [...cells].sort((a, b) => (a.x - b.x) || (a.y - b.y));

  // グループ数を少し粗くして負荷を下げる（5x5なら何でもOK）
  const groups = 6;
  const chunkSize = Math.max(1, Math.ceil(sorted.length / groups));
  const stepMs = Math.max(16, Math.floor(durationMs / groups));

  for (let i = 0; i < sorted.length; i += chunkSize) {
    const chunk = sorted.slice(i, i + chunkSize);
    for (const p of chunk) this.setWater(p.x, p.y, 0);
    await wait(this.scene, stepMs);
  }
}


  private playWaterNote(stepIndex: number) {
    // detune: 100 = 半音。上がりすぎ防止。
    const detune = Math.min(stepIndex, 24) * 80;

    this.scene.sound.play("blip", {
      volume: 0.35,
      detune,
    } as any);
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

public getCellSpritesFlat(): Phaser.GameObjects.Image[] {
  const out: Phaser.GameObjects.Image[] = [];

  for (let y = 0; y < this.model.height; y++) {
    for (let x = 0; x < this.model.width; x++) {
      const img = this.cells[y][x].base;
      if (img) out.push(img);
    }
  }

  return out;
}

public getInputSpritesFlat(): Phaser.GameObjects.Image[] {
  const out: Phaser.GameObjects.Image[] = [];

  for (let y = 0; y < this.model.height; y++) {
    for (let x = 0; x < this.model.width; x++) {
      const img = this.cells[y][x].blank;
      if (img) out.push(img);
    }
  }

  return out;
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


import Phaser from "phaser";
import { UIButton } from "./uiButton";

type ControlPadOpts = {
  x: number;
  y: number;
  width: number;
  height: number;
  onLeft: () => void;
  onRight: () => void;
  onRotate: () => void;
  onDrop: () => void;
};

export function createControlPad(scene: Phaser.Scene, opts: ControlPadOpts) {
  const bg = scene.add.rectangle(
    opts.x + opts.width / 2,
    opts.y + opts.height / 2,
    opts.width,
    opts.height,
    0x000000,
    0.35
  );

  const padY = opts.y + 20;

  const btnW = Math.floor(opts.width / 4) - 14;
  const btnH = 56;

  const left = new UIButton(scene, opts.x + 10, padY, btnW, btnH, "◀", opts.onLeft);
  const right = new UIButton(scene, opts.x + 20 + btnW, padY, btnW, btnH, "▶", opts.onRight);
  const rot = new UIButton(scene, opts.x + 30 + btnW * 2, padY, btnW, btnH, "⟳", opts.onRotate);
  const drop = new UIButton(scene, opts.x + 40 + btnW * 3, padY, btnW, btnH, "DROP", opts.onDrop);

  // help text
  scene.add.text(opts.x + 12, opts.y + 90, "Left/Right: aim  Rotate: ⟳  Drop: place", {
    fontSize: "14px",
    color: "#cccccc",
  });

  return { bg, left, right, rot, drop };
}

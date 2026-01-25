import Phaser from "phaser";
import { GameScene } from "./scenes/GameScene";

const BASE_W = 390;  // iPhone系の気持ち
const BASE_H = 844;  // 19.5:9 近い

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "app",
  width: BASE_W,
  height: BASE_H,
  backgroundColor: "#2b2d31",
  scene: [GameScene],
  dom: {
    createContainer: true,
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

new Phaser.Game(config);

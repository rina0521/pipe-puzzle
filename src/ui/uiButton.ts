import Phaser from "phaser";

export class UIButton {
  private scene: Phaser.Scene;
  private bg: Phaser.GameObjects.Rectangle;
  private label: Phaser.GameObjects.Text;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    w: number,
    h: number,
    text: string,
    onClick: () => void
  ) {
    this.scene = scene;

    this.bg = scene
      .add
      .rectangle(x + w / 2, y + h / 2, w, h, 0x222222, 1)
      .setStrokeStyle(2, 0x555555, 1);

    this.label = scene
      .add
      .text(x + w / 2, y + h / 2, text, {
        fontSize: "18px",
        color: "#ffffff",
      })
      .setOrigin(0.5, 0.5);

    this.bg.setInteractive({ useHandCursor: true });
    this.bg.on("pointerdown", () => {
      onClick();
      this.pulse();
    });
  }

  private pulse() {
    this.scene.tweens.add({
      targets: [this.bg, this.label],
      scaleX: 0.96,
      scaleY: 0.96,
      duration: 60,
      yoyo: true,
      ease: "Sine.easeInOut",
    });
  }
}

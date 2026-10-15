export interface GameState {
  day: number;
  hour: number;
}

/** Time of day, toasts and the controls hint. */
export class Hud {
  private readonly clockEl: HTMLElement;
  private readonly toasts: HTMLElement;
  private shownMinute = -1;

  constructor(root: HTMLElement, private readonly state: GameState) {
    const bar = el('div', 'hud-bar');
    this.clockEl = el('div', 'hud-stat');
    bar.append(this.clockEl);

    this.toasts = el('div', 'toasts');

    const help = el('details', 'help');
    help.innerHTML = `
      <summary>Controls</summary>
      <ul>
        <li><b>Left-drag</b> or <b>WASD</b>: pan</li>
        <li><b>Right-drag</b> or <b>Q / E</b>: rotate</li>
        <li><b>Wheel</b>: zoom</li>
        <li><b>Click animal</b>: inspect</li>
        <li><b>G</b>: toggle graphics quality</li>
      </ul>`;

    root.append(bar, this.toasts, help);
  }

  update(): void {
    const s = this.state;
    const minute = Math.floor(s.hour * 60);
    if (minute === this.shownMinute) return;
    this.shownMinute = minute;
    const h = Math.floor(s.hour);
    this.clockEl.textContent = `${s.hour >= 6 && s.hour < 19 ? '☀️' : '🌙'} ${pad(h)}:${pad(minute % 60)}`;
  }

  toast(message: string, kind: 'info' | 'warn' | 'good' = 'info'): void {
    const t = el('div', `toast ${kind}`);
    t.textContent = message;
    this.toasts.append(t);
    setTimeout(() => t.classList.add('out'), 3200);
    setTimeout(() => t.remove(), 3700);
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

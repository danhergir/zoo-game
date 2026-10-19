import { weatherIcon, weatherNow } from '../weather';

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
        <li><b>P</b>: switch 2D / 3D view</li>
        <li><b>+ / − / 0</b>: zoom in, out, whole zoo (2D)</li>
        <li><b>1–9</b> or the map: jump to a place (2D)</li>
      </ul>`;

    root.append(bar, this.toasts, help);
  }

  update(): void {
    const s = this.state;
    const minute = Math.floor(s.hour * 60);
    if (minute === this.shownMinute) return;
    const icon = weatherIcon(s.hour, weatherNow);
    this.shownMinute = minute;
    const h = Math.floor(s.hour);
    this.clockEl.textContent = `${icon} ${pad(h)}:${pad(minute % 60)}`;
  }

  /** A message that fades after a few seconds; with an action, it gets a button and stays a little longer. */
  toast(message: string, kind: 'info' | 'warn' | 'good' = 'info', action?: { label: string; onClick: () => void }): void {
    const t = el('div', `toast ${kind}`);
    t.textContent = message;
    if (action) {
      const b = el('button', 'toast-action');
      b.textContent = action.label;
      b.addEventListener('click', () => {
        action.onClick();
        t.classList.add('out');
        setTimeout(() => t.remove(), 500);
      });
      t.append(b);
    }
    this.toasts.append(t);
    const life = action ? 7000 : 3200;
    setTimeout(() => t.classList.add('out'), life);
    setTimeout(() => t.remove(), life + 500);
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

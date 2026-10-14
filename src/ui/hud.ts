export interface GameState {
  money: number;
  day: number;
  hour: number;
}

/** Top bar (money, clock, happiness, guests), toasts and the controls hint. */
export class Hud {
  private readonly moneyEl: HTMLElement;
  private readonly clockEl: HTMLElement;
  private readonly moodEl: HTMLElement;
  private readonly guestsEl: HTMLElement;
  private readonly toasts: HTMLElement;
  private shownMoney = NaN;

  constructor(root: HTMLElement, private readonly state: GameState) {
    const bar = el('div', 'hud-bar');
    this.moneyEl = el('div', 'hud-stat money');
    this.clockEl = el('div', 'hud-stat');
    this.moodEl = el('div', 'hud-stat');
    this.guestsEl = el('div', 'hud-stat');
    this.moodEl.title = 'Average animal happiness';
    this.guestsEl.title = 'Guests in the zoo';
    bar.append(this.moneyEl, this.clockEl, this.moodEl, this.guestsEl);

    this.toasts = el('div', 'toasts');

    const help = el('details', 'help');
    help.innerHTML = `
      <summary>Controls</summary>
      <ul>
        <li><b>Left-drag</b> or <b>WASD</b>: pan</li>
        <li><b>Right-drag</b> or <b>Q / E</b>: rotate</li>
        <li><b>Wheel</b>: zoom</li>
        <li><b>Click animal</b>: inspect</li>
        <li><b>Click feeder</b>: refill</li>
        <li><b>G</b>: toggle graphics quality</li>
      </ul>`;

    root.append(bar, this.toasts, help);
  }

  update(avgHappiness: number, guests: number): void {
    const s = this.state;
    if (Math.round(s.money) !== this.shownMoney) {
      if (s.money > this.shownMoney) this.flash(this.moneyEl);
      this.shownMoney = Math.round(s.money);
      this.moneyEl.textContent = `💰 $${this.shownMoney.toLocaleString()}`;
    }
    const h = Math.floor(s.hour);
    const m = Math.floor((s.hour - h) * 60);
    const open = s.hour >= 9 && s.hour < 18 ? 'Open' : 'Closed';
    this.clockEl.textContent = `${s.hour >= 6 && s.hour < 19 ? '☀️' : '🌙'} Day ${s.day.toLocaleString()} · ${pad(h)}:${pad(m)} · ${open}`;
    const face = avgHappiness > 0.75 ? '😄' : avgHappiness > 0.5 ? '🙂' : avgHappiness > 0.3 ? '😐' : '😟';
    this.moodEl.textContent = `${face} ${Math.round(avgHappiness * 100)}%`;
    this.guestsEl.textContent = `🧑‍🤝‍🧑 ${guests}`;
  }

  toast(message: string, kind: 'info' | 'warn' | 'good' = 'info'): void {
    const t = el('div', `toast ${kind}`);
    t.textContent = message;
    this.toasts.append(t);
    setTimeout(() => t.classList.add('out'), 3200);
    setTimeout(() => t.remove(), 3700);
  }

  private flash(node: HTMLElement): void {
    node.classList.remove('flash');
    void node.offsetWidth; // restart the animation
    node.classList.add('flash');
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

export interface GameState {
  money: number;
  day: number;
  hour: number;
  speed: number;
  paused: boolean;
}

const SPEEDS = [1, 2, 4];

/** Top bar (money, clock, happiness, speed), toasts and the controls hint. */
export class Hud {
  private readonly moneyEl: HTMLElement;
  private readonly clockEl: HTMLElement;
  private readonly moodEl: HTMLElement;
  private readonly guestsEl: HTMLElement;
  private readonly speedButtons: HTMLButtonElement[] = [];
  private readonly pauseButton: HTMLButtonElement;
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
    const speed = el('div', 'hud-speed');
    this.pauseButton = button('⏸', () => this.togglePause());
    this.pauseButton.title = 'Pause (Space)';
    speed.append(this.pauseButton);
    for (const s of SPEEDS) {
      const b = button(`${s}×`, () => this.setSpeed(s));
      b.title = `Speed ${s}× (${SPEEDS.indexOf(s) + 1})`;
      this.speedButtons.push(b);
      speed.append(b);
    }
    bar.append(this.moneyEl, this.clockEl, this.moodEl, this.guestsEl, speed);

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
        <li><b>Space</b>: pause · <b>1–3</b>: speed</li>
        <li><b>G</b>: toggle graphics quality</li>
      </ul>`;

    root.append(bar, this.toasts, help);

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        // Otherwise a focused button would also get "clicked" on keyup.
        (document.activeElement as HTMLElement | null)?.blur();
        this.togglePause();
      }
      const idx = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
      if (idx >= 0) this.setSpeed(SPEEDS[idx]);
    });
    this.syncSpeed();
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
    this.clockEl.textContent = `${s.hour >= 6 && s.hour < 19 ? '☀️' : '🌙'} Day ${s.day} · ${pad(h)}:${pad(m)} · ${open}`;
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

  private togglePause(): void {
    this.state.paused = !this.state.paused;
    this.syncSpeed();
  }

  private setSpeed(speed: number): void {
    this.state.speed = speed;
    this.state.paused = false;
    this.syncSpeed();
  }

  private syncSpeed(): void {
    this.pauseButton.classList.toggle('active', this.state.paused);
    this.speedButtons.forEach((b, i) =>
      b.classList.toggle('active', !this.state.paused && SPEEDS[i] === this.state.speed),
    );
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

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

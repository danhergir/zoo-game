import type { Animal } from '../animals/Animal';

/** Side panel with the selected animal's needs. */
export class Inspector {
  private readonly panel = document.createElement('div');
  private readonly titleEl: HTMLElement;
  private readonly subEl: HTMLElement;
  private readonly stateEl: HTMLElement;
  private readonly bars: Record<'hunger' | 'energy' | 'happiness', HTMLElement>;
  private readonly followBtn: HTMLButtonElement;
  private animal: Animal | null = null;

  constructor(
    root: HTMLElement,
    callbacks: { onClose: () => void; onFollow: (animal: Animal) => void },
  ) {
    this.panel.className = 'inspector hidden';
    this.panel.innerHTML = `
      <button class="close" aria-label="Close">×</button>
      <div class="ins-title"></div>
      <div class="ins-sub"></div>
      <div class="ins-state"></div>
      ${['hunger', 'energy', 'happiness']
        .map(
          (k) => `<div class="need"><span>${k === 'hunger' ? 'Fullness' : k[0].toUpperCase() + k.slice(1)}</span>
            <div class="bar"><i data-need="${k}"></i></div></div>`,
        )
        .join('')}
      <button class="follow">🎥 Follow</button>`;
    root.append(this.panel);

    this.titleEl = this.panel.querySelector('.ins-title')!;
    this.subEl = this.panel.querySelector('.ins-sub')!;
    this.stateEl = this.panel.querySelector('.ins-state')!;
    const bar = (k: string) => this.panel.querySelector<HTMLElement>(`[data-need="${k}"]`)!;
    this.bars = { hunger: bar('hunger'), energy: bar('energy'), happiness: bar('happiness') };
    this.followBtn = this.panel.querySelector('.follow')!;

    this.panel.querySelector('.close')!.addEventListener('click', () => callbacks.onClose());
    this.followBtn.addEventListener('click', () => this.animal && callbacks.onFollow(this.animal));
  }

  get selected(): Animal | null {
    return this.animal;
  }

  show(animal: Animal): void {
    this.animal = animal;
    this.titleEl.textContent = animal.name;
    this.subEl.textContent = `${animal.male ? '♂' : '♀'} ${animal.species.label} · ${animal.enclosure.name}`;
    this.panel.classList.remove('hidden');
    this.update(false);
  }

  hide(): void {
    this.animal = null;
    this.panel.classList.add('hidden');
  }

  update(following: boolean): void {
    const a = this.animal;
    if (!a) return;
    this.stateEl.textContent = `${a.stateLabel} · ${a.mood}`;
    for (const k of ['hunger', 'energy', 'happiness'] as const) {
      const v = a[k];
      const bar = this.bars[k];
      bar.style.width = `${Math.round(v * 100)}%`;
      bar.className = v < 0.25 ? 'bad' : v < 0.5 ? 'warn' : '';
    }
    this.followBtn.classList.toggle('active', following);
    this.followBtn.textContent = following ? '🎥 Following' : '🎥 Follow';
  }
}

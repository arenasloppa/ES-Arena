export class SettingsTabs {
  private current = 'graphics';
  private readonly names = ['graphics','audio','controls'];
  constructor(private readonly root: HTMLElement) {
    for(const button of root.querySelectorAll<HTMLElement>('[data-settings-tab]')) {
      button.addEventListener('click',()=>this.select(button.dataset.settingsTab!));
    }
    this.select(this.current);
  }
  select(name: string): void {
    if(!this.names.includes(name))return;this.current=name;
    for(const button of this.root.querySelectorAll<HTMLElement>('[data-settings-tab]')){
      const active=button.dataset.settingsTab===name;button.setAttribute('aria-selected',String(active));button.classList.toggle('option',active);
    }
    for(const panel of this.root.querySelectorAll<HTMLElement>('[data-settings-panel]'))panel.hidden=panel.dataset.settingsPanel!==name;
  }
  step(delta: number): boolean {
    const i=this.names.indexOf(this.current);this.select(this.names[(i+Math.sign(delta)+this.names.length)%this.names.length]);
    this.root.querySelector<HTMLElement>(`[data-settings-tab="${this.current}"]`)?.focus();return true;
  }
}

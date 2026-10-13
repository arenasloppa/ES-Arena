import * as THREE from 'three';

/** Immediate preparation while gameplay distinguishes a tap from a held power attack. */
export class WeaponPressMotion {
  private amount = 0;
  update(charging: boolean, dt: number): void {
    // No onset timer; the first positive frame moves. Fade back into the selected swing.
    this.amount += (Number(charging)-this.amount)*(1-Math.exp(-24*Math.max(0,dt)));
    if(this.amount<1e-8)this.amount=0;
  }
  apply(position: THREE.Vector3, rotation: THREE.Quaternion): void {
    if(!this.amount)return;
    position.z+=.035*this.amount;
    rotation.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),.065*this.amount));
  }
}

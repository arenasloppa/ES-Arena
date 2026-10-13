export interface WalkingCameraPose {side:number;lift:number;roll:number;}
/** Small distance-driven head movement; stopping, jumping and aiming soften it smoothly. */
export class WalkingCameraMotion {
  private previousWalked=0;
  private phase=0;
  private amount=0;
  value:WalkingCameraPose={side:0,lift:0,roll:0};
  update(dt:number,walked:number,state:{grounded:boolean;sprinting:boolean;sneaking:boolean;aiming:boolean}):WalkingCameraPose {
    if(dt<=0)return this.value;
    const delta=walked-this.previousWalked;this.previousWalked=walked;
    const moved=delta>0&&delta<.5?delta:0;
    const active=state.grounded&&moved>1e-6;
    const target=active?(state.sneaking?.4:state.sprinting?1.45:1)*(state.aiming?.35:1):0;
    this.amount+=(target-this.amount)*(1-Math.exp(-dt*9));
    if(active)this.phase+=moved*Math.PI/1.1;
    this.value={side:Math.sin(this.phase)*.0045*this.amount,lift:(Math.cos(this.phase*2)-1)*.003*this.amount,roll:Math.sin(this.phase)*.005*this.amount};
    return this.value;
  }
}

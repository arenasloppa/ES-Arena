/** Remove the clipped lead-in present in Arena's effects and silence buffer boundaries. */
export function declickSamples(samples: Float32Array, sampleRate: number): Float32Array {
  const out=new Float32Array(samples);
  // Several original VOCs contain ten near-full-negative samples followed by silence.
  // Keep the timeline intact; this prefix is a click, not part of the swing/impact.
  if(out.length>10&&Array.from(out.subarray(0,10)).every(v=>v<=-.9)&&Math.abs(out[10])<.03)out.fill(0,0,10);
  const edge=Math.min(Math.floor(sampleRate*.004),Math.floor(out.length/2));
  for(let i=0;i<edge;i++){
    const gain=.5-.5*Math.cos(Math.PI*i/Math.max(1,edge-1));
    out[i]*=gain;out[out.length-1-i]*=gain;
  }
  return out;
}

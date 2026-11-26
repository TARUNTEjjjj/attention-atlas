import { convolve2d, convolutionWindow, rnnSequence, attention } from './math.js';
const { cos, sin, abs, max, min, hypot, tan, exp, PI } = Math;

export const SCENE_DEFAULTS = {
  cnn: { input: [[0,0,1,1,1],[0,0,1,1,1],[0,0,1,1,1],[0,0,1,1,1],[0,0,1,1,1]], kernel: [[-1,0,1],[-1,0,1],[-1,0,1]], stride: 1, padding: 0, focusRow: 0, focusCol: 0 },
  rnn: { inputs: [1,.5,-1,.8], wx: .8, wh: .7, bias: 0, h0: 0, selectedStep: 0 },
  attention: { Q: [[1,0],[0,1],[1,1],[.5,1]], K: [[1,0],[0,1],[1,1],[-1,1]], V: [[1,0],[0,2],[1,1],[2,-1]], tokens: ['The','cat','sat','down'], queryIndex: 1, causal: false, scale: true, temperature: 1 },
};

export const clamp = (v, lo, hi) => max(lo, min(hi, v));
export const vec3Dot = (a, b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const vec3Sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
export const vec3Add = (a, b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
export const vec3Scale = (v, s) => [v[0]*s, v[1]*s, v[2]*s];
export const vec3Cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
export const vec3Length = v => hypot(v[0], v[1], v[2]);
export const vec3Normalize = v => { const l = vec3Length(v); return l > 1e-12 ? [v[0]/l, v[1]/l, v[2]/l] : [0,0,1]; };

/** Column-major 3x3 proper rotation matrix R = R_y(yaw) * R_x(-pitch) in SO(3); positive pitch elevates camera (+Y). */
export function orbitRotationMatrix(yaw, pitch) {
  const cy = cos(yaw), sy = sin(yaw), cp = cos(pitch), sp = -sin(pitch);
  return [cy,0,-sy, sy*sp,cp,cy*sp, sy*cp,-sp,cy*cp];
}
export const mulMat3Vec3 = (m, v) => [m[0]*v[0]+m[3]*v[1]+m[6]*v[2], m[1]*v[0]+m[4]*v[1]+m[7]*v[2], m[2]*v[0]+m[5]*v[1]+m[8]*v[2]];
export function orbitCameraPosition(yaw, pitch, dist, target = [0,0,0]) {
  const rot = orbitRotationMatrix(yaw, pitch);
  return { eye: vec3Add(target, mulMat3Vec3(rot, [0,0,dist])), up: mulMat3Vec3(rot, [0,1,0]), rot };
}
export function lookAtViewMatrix(eye, target = [0,0,0], up = [0,1,0]) {
  const z = vec3Normalize(vec3Sub(eye, target)), x = vec3Normalize(vec3Cross(up, z)), y = vec3Cross(z, x);
  return [x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0, -vec3Dot(x,eye),-vec3Dot(y,eye),-vec3Dot(z,eye),1];
}
export function perspectiveMatrix(fovY, aspect, near, far) {
  const f = 1/tan(fovY/2), nf = 1/(near-far);
  return [f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,2*far*near*nf,0];
}
export function mulMat4(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0; for (let k = 0; k < 4; k++) s += a[k*4+r]*b[c*4+k]; out[c*4+r] = s;
  }
  return out;
}
export function projectPoint(mvp, p) {
  const x=mvp[0]*p[0]+mvp[4]*p[1]+mvp[8]*p[2]+mvp[12], y=mvp[1]*p[0]+mvp[5]*p[1]+mvp[9]*p[2]+mvp[13];
  const z=mvp[2]*p[0]+mvp[6]*p[1]+mvp[10]*p[2]+mvp[14], w=mvp[3]*p[0]+mvp[7]*p[1]+mvp[11]*p[2]+mvp[15];
  return { x, y, z, w, ndc: [x/w, y/w, z/w] };
}

export function createBoxGeometry() {
  const faces = [[[0,0,1],[-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5]],[[0,0,-1],[.5,-.5,-.5],[-.5,-.5,-.5],[-.5,.5,-.5],[.5,.5,-.5]],[[0,1,0],[-.5,.5,.5],[.5,.5,.5],[.5,.5,-.5],[-.5,.5,-.5]],[[0,-1,0],[-.5,-.5,-.5],[.5,-.5,-.5],[.5,-.5,.5],[-.5,-.5,.5]],[[1,0,0],[.5,-.5,.5],[.5,-.5,-.5],[.5,.5,-.5],[.5,.5,.5]],[[-1,0,0],[-.5,-.5,-.5],[-.5,-.5,.5],[-.5,.5,.5],[-.5,.5,-.5]]];
  const pos = [], norm = [], idx = [];
  faces.forEach(([n,...vs], f) => { vs.forEach(v => { pos.push(...v); norm.push(...n); }); const b=f*4; idx.push(b,b+1,b+2,b,b+2,b+3); });
  return { positions: new Float32Array(pos), normals: new Float32Array(norm), indices: new Uint16Array(idx) };
}

export function createSphereGeometry(sub = 2) {
  let tris = [[[1,0,0],[0,1,0],[0,0,1]],[[0,1,0],[-1,0,0],[0,0,1]],[[-1,0,0],[0,-1,0],[0,0,1]],[[0,-1,0],[1,0,0],[0,0,1]],[[0,1,0],[1,0,0],[0,0,-1]],[[-1,0,0],[0,1,0],[0,0,-1]],[[0,-1,0],[-1,0,0],[0,0,-1]],[[1,0,0],[0,-1,0],[0,0,-1]]];
  const mid = (a, b) => vec3Normalize([(a[0]+b[0])*.5, (a[1]+b[1])*.5, (a[2]+b[2])*.5]);
  for (let s = 0; s < sub; s++) tris = tris.flatMap(([a,b,c]) => { const ab=mid(a,b),bc=mid(b,c),ca=mid(c,a); return [[a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]]; });
  const positions = new Float32Array(tris.length*9), normals = new Float32Array(tris.length*9), indices = new Uint16Array(tris.length*3);
  let vi = 0; for (const t of tris) for (const v of t) { positions.set(v, vi*3); normals.set(v, vi*3); indices[vi] = vi++; }
  return { positions, normals, indices };
}

export const MESH_VERTEX_SHADER = `#version 300 es
precision highp float;layout(location=0) in vec3 aPosition;layout(location=1) in vec3 aNormal;layout(location=2) in vec3 aOffset;layout(location=3) in vec3 aScale;layout(location=4) in vec4 aColor;layout(location=5) in float aGlow;
uniform mat4 uViewProj;uniform vec3 uCameraPos;uniform float uTime;out vec3 vWorldPos,vNormal;out vec4 vColor;out float vGlow,vDepth;
void main(){vec3 wp=aOffset+aPosition*aScale;gl_Position=uViewProj*vec4(wp,1.);vNormal=normalize(aNormal/max(abs(aScale),vec3(.0001)));vWorldPos=wp;vColor=aColor;vGlow=aGlow;vDepth=length(uCameraPos-wp);}`;

export const MESH_FRAGMENT_SHADER = `#version 300 es
precision highp float;in vec3 vWorldPos,vNormal;in vec4 vColor;in float vGlow,vDepth;uniform vec3 uCameraPos;uniform float uTime;out vec4 fragColor;
void main(){vec3 N=normalize(vNormal),V=normalize(uCameraPos-vWorldPos),L1=normalize(vec3(3.5,6.,4.5)),L2=normalize(vec3(-4.,2.5,-3.5));
float d1=max(dot(N,L1),0.),d2=max(dot(N,L2),0.),sp=pow(max(dot(N,normalize(L1+V)),0.),28.),fr=pow(1.-max(dot(N,V),0.),2.4),pl=.92+.08*sin(uTime*2.2+vWorldPos.x*1.4+vWorldPos.z*1.1);
vec3 lit=vColor.rgb*(.34+.56*d1+.22*d2)+vec3(.98,.96,.91)*(.28*sp+.36*fr*(.45+.55*vGlow))+vColor.rgb*(.42*vGlow*pl);
fragColor=vec4(mix(lit,vec3(.09,.114,.102),clamp((vDepth-4.5)/14.,0.,.55)),vColor.a);}`;

export const LINE_VERTEX_SHADER = `#version 300 es
precision highp float;layout(location=0) in vec3 aPosition;layout(location=1) in vec4 aColor;layout(location=2) in float aProgress;
uniform mat4 uViewProj;uniform vec3 uCameraPos;uniform float uTime;out vec4 vColor;out float vProgress,vDepth;out vec3 vWorldPos;
void main(){gl_Position=uViewProj*vec4(aPosition,1.);vColor=aColor;vProgress=aProgress;vWorldPos=aPosition;vDepth=length(uCameraPos-aPosition);}`;

export const LINE_FRAGMENT_SHADER = `#version 300 es
precision highp float;in vec4 vColor;in float vProgress,vDepth;in vec3 vWorldPos;uniform float uTime;out vec4 fragColor;
void main(){float rf=vProgress<0.?clamp(1.-length(vWorldPos.xz)/5.,.06,1.):1.,pk=vProgress>=0.?.78+.38*exp(-18.*pow(fract(vProgress-uTime*.45)-.5,2.)):1.,at=clamp(1.2-vDepth*.075,.25,1.);
fragColor=vec4(vColor.rgb*pk*at,clamp(vColor.a*rf*at,0.,1.));}`;

const PAL = { red:[.86,.28,.2,1], coral:[.95,.45,.34,1], green:[.27,.56,.41,1], sage:[.55,.72,.58,1], ivory:[.95,.93,.87,1], slate:[.26,.3,.28,1], amber:[.93,.68,.3,1], grid:[.42,.48,.44,.36], axis:[.76,.42,.34,.45] };
const addLine = (a, from, to, color, p0 = -1, p1 = p0) => a.push({ from, to, color, progressStart: p0, progressEnd: p1 });
const addNode = (a, offset, scale, color, glow = .5) => a.push({ offset, scale, color, glow });

function addWireBox(lines, [cx,cy,cz], [sx,sy,sz], color, p = -1) {
  const hx=sx/2, hy=sy/2, hz=sz/2, c=[[cx-hx,cy-hy,cz-hz],[cx+hx,cy-hy,cz-hz],[cx+hx,cy-hy,cz+hz],[cx-hx,cy-hy,cz+hz],[cx-hx,cy+hy,cz-hz],[cx+hx,cy+hy,cz-hz],[cx+hx,cy+hy,cz+hz],[cx-hx,cy+hy,cz+hz]];
  for (const [a,b] of [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]]) addLine(lines, c[a], c[b], color, p);
}
function addRing(lines, y, r, color, segs = 28) {
  for (let s=0; s<segs; s++) { const a0=(s/segs)*PI*2, a1=((s+1)/segs)*PI*2; addLine(lines, [r*cos(a0),y,r*sin(a0)], [r*cos(a1),y,r*sin(a1)], color); }
}
export function buildStageGridLines(radius = 3.6, step = .6) {
  const lines = [];
  for (let d=-radius; d<=radius+1e-6; d+=step) {
    const c = abs(d)<1e-6 ? PAL.axis : PAL.grid;
    addLine(lines, [d,-1.16,-radius], [d,-1.16,radius], c); addLine(lines, [-radius,-1.16,d], [radius,-1.16,d], c);
  }
  return lines;
}

export function buildCnnVolumeScene(opts = {}) {
  const { input, kernel, stride, padding, focusRow, focusCol } = { ...SCENE_DEFAULTS.cnn, ...opts };
  const output = convolve2d(input, kernel, { stride, padding }), row = clamp(focusRow, 0, output.length-1), col = clamp(focusCol, 0, output[0].length-1);
  const win = convolutionWindow(input, kernel, row, col, { stride, padding }), boxes = [], lines = buildStageGridLines(), pitch = .42;
  const inH=input.length, inW=input[0].length, kH=kernel.length, kW=kernel[0].length, posAt=(ox,y,r,c,rows,cols)=>[ox+(c-(cols-1)*.5)*pitch,y,(r-(rows-1)*.5)*pitch];
  const rS=row*stride-padding, cS=col*stride-padding, windowCoords=[];

  for (let i=0; i<inH; i++) for (let j=0; j<inW; j++) {
    const v=input[i][j], inWdw=i>=rS&&i<rS+kH&&j>=cS&&j<cS+kW, h=v>0?.42:.14;
    if (inWdw) windowCoords.push([i,j]);
    addNode(boxes, posAt(-1.18,-.58+h*.5,i,j,inH,inW), [.33,h,.33], inWdw?(v>0?PAL.coral:[.46,.34,.31,1]):(v>0?PAL.green:PAL.slate), inWdw?.9:(v>0?.35:.05));
  }
  addWireBox(lines, posAt(-1.18,.24,rS+(kH-1)*.5,cS+(kW-1)*.5,inH,inW), [kW*pitch-.04,.22,kH*pitch-.04], PAL.amber, .4);
  const outRows=output.length, outCols=output[0].length, activeOut=posAt(1.38,.38,row,col,outRows,outCols);
  for (let ki=0; ki<kH; ki++) for (let kj=0; kj<kW; kj++) {
    const i=rS+ki, j=cS+kj, w=kernel[ki][kj], inside=i>=0&&i<inH&&j>=0&&j<inW, kPos=posAt(-1.18,.24,i,j,inH,inW), mag=abs((inside?input[i][j]:0)*w);
    addNode(boxes, kPos, [.16,.11+min(abs(w),2)*.05,.16], w>0?PAL.sage:w<0?PAL.red:PAL.ivory, inside?.72:.2);
    if (!inside) addWireBox(lines, posAt(-1.18,-.51,i,j,inH,inW), [.3,.12,.3], [.7,.65,.55,.35]);
    addLine(lines, kPos, activeOut, w<0?[0.95,.45,.34,mag>0?.92:.26]:[.55,.84,.62,mag>0?.92:.26], 0, 1);
  }
  const maxAbs = max(1, ...output.flat().map(abs));
  for (let r=0; r<outRows; r++) for (let c=0; c<outCols; c++) {
    const val=output[r][c], active=r===row&&c===col, h=.16+.46*(abs(val)/maxAbs), pos=posAt(1.38,.2+h*.5,r,c,outRows,outCols);
    addNode(boxes, pos, [.34,h,.34], val>0?PAL.green:val<0?PAL.red:PAL.ivory, active?1:.28);
    if (active) addWireBox(lines, pos, [.41,h+.08,.41], PAL.amber, .5);
  }
  return { mode:'cnn', boxes, spheres:[], lines, telemetry:{ outRows, outCols, activeRow:row, activeCol:col, windowCoords, windowSum:win.sum, output }, readout:`CNN · Window (${row+1}, ${col+1}) · stride ${stride} · pad ${padding} → Σ = ${Number(win.sum.toFixed(3))}` };
}

export const eigenEnvelopeRadius = (wh, step, baseRadius = .62) => baseRadius * (abs(wh) ** step);

export function buildRnnHelixScene(opts = {}) {
  const { inputs, wx, wh, bias, h0, selectedStep, time = 0 } = { ...SCENE_DEFAULTS.rnn, ...opts };
  const states = rnnSequence(inputs, { wx, wh, bias, h0 }), totalSteps = states.length;
  const spheres=[], boxes=[], lines=buildStageGridLines(), stepAngle=1.15, phase=time*.28;
  const steps = Array.from({ length: totalSteps+1 }, (_, t) => {
    const hidden=t===0?h0:states[t-1].hidden, eigenRadius=eigenEnvelopeRadius(wh,t,.62), visRadius=clamp(eigenRadius,.16,1.75), theta=t*stepAngle+phase;
    return { t, hidden, localDerivative:t===0?1:states[t-1].localDerivative, gradientToInitial:t===0?1:states[t-1].gradientToInitial, eigenMagnitude:abs(wh)**t, eigenRadius, visRadius, pos:[visRadius*cos(theta),-.82+1.68*(t/max(totalSteps,1))+.16*hidden,visRadius*sin(theta)] };
  });
  addLine(lines, [0,-1.05,0], [0,1.05,0], [.76,.74,.68,.32]);
  addRing(lines, steps[0].pos[1], steps[0].visRadius, [.95,.93,.87,.25]);
  addRing(lines, steps.at(-1).pos[1], steps.at(-1).visRadius, abs(wh)>1?[.95,.45,.34,.55]:[.45,.78,.58,.55]);

  for (let t=0; t<steps.length; t++) {
    const pt=steps[t], sel=t>0&&t-1===clamp(selectedStep,0,max(totalSteps-1,0)), s=t===0?.085:.095+.048*abs(pt.hidden), col=t===0?PAL.ivory:pt.hidden>=0?PAL.green:PAL.coral;
    addNode(spheres, pt.pos, [s,s,s], col, sel?1:(t===0?.3:.6));
    addLine(lines, [0,pt.pos[1],0], pt.pos, [col[0],col[1],col[2],.42], 0, 1);
    if (t>0) {
      const prev=steps[t-1], lerp=u=>{const r=prev.visRadius+(pt.visRadius-prev.visRadius)*u,th=(t-1+u)*stepAngle+phase;return[r*cos(th),prev.pos[1]+(pt.pos[1]-prev.pos[1])*u,r*sin(th)];};
      for (let k=0; k<6; k++) addLine(lines, lerp(k/6), lerp((k+1)/6), PAL.amber, (t-1+k/6)/totalSteps, (t-1+(k+1)/6)/totalSteps);
      const dir=vec3Normalize(vec3Sub(pt.pos,prev.pos)), base=vec3Sub(pt.pos,vec3Scale(dir,.2)), side=vec3Normalize(vec3Cross(dir,[0,1,0]));
      addLine(lines, prev.pos, pt.pos, [.95,.93,.87,.68], 0, 1);
      addLine(lines, pt.pos, vec3Add(base,vec3Scale(side,.07)), PAL.amber, .8, 1);
      addLine(lines, pt.pos, vec3Sub(base,vec3Scale(side,.07)), PAL.amber, .8, 1);
    }
  }
  const activePt = steps[clamp(selectedStep+1,0,steps.length-1)];
  addNode(boxes, [activePt.pos[0],activePt.pos[1]+.16,activePt.pos[2]], [.06,.06,.06], PAL.amber, 1);
  const absWh=abs(wh), regime=absWh<1?'decay':absWh>1?'growth':'unitary', last=states.at(-1);
  return { mode:'rnn', boxes, spheres, lines, telemetry:{ regime, wh, wx, steps }, readout:`RNN · |wₕ| = ${absWh.toFixed(2)} (${regime}) · h${totalSteps} = ${last?last.hidden.toFixed(3):'0.000'} · |wₕ|^${totalSteps} = ${(absWh**totalSteps).toFixed(3)}` };
}

export function buildAttentionManifoldScene(opts = {}) {
  const { Q, K, V, tokens, queryIndex, causal, scale, temperature, time = 0 } = { ...SCENE_DEFAULTS.attention, ...opts };
  const result = attention(Q, K, V, { causal, scale, temperature }), n = Q.length, qIdx = clamp(queryIndex, 0, n-1);
  const spheres=[], boxes=[], lines=buildStageGridLines(), qPos=[], kPos=[];
  for (let i=0; i<n; i++) {
    const a = (i/n)*PI*2 - PI*.35 + time*.12;
    qPos.push([1.22*cos(a)+clamp(Q[i][0]*.06,-.18,.18), .62, 1.22*sin(a)+clamp(Q[i][1]*.06,-.18,.18)]);
    kPos.push([1.48*cos(a)+clamp(K[i][0]*.06,-.18,.18), -.60, 1.48*sin(a)+clamp(K[i][1]*.06,-.18,.18)]);
  }
  addRing(lines, .62, 1.22, [.95,.45,.34,.28], 32); addRing(lines, -.60, 1.48, [.45,.72,.56,.28], 32);
  const pPts = Array.from({length:4}, (_,k) => { const a=time*.55+k*PI*.5; return [.3*cos(a),.02,.3*sin(a)]; });
  for (let k=0; k<4; k++) { addLine(lines,pPts[k],pPts[(k+1)%4],PAL.amber,0,1); addLine(lines,[0,.36,0],pPts[k],PAL.coral,0,1); addLine(lines,[0,-.32,0],pPts[k],PAL.sage,0,1); }
  addNode(spheres, [0,.02,0], [.13,.19,.13], PAL.amber, .95);

  for (let i=0; i<n; i++) {
    const act=i===qIdx, w=result.weights[qIdx][i], mask=result.scores[qIdx][i]===-Infinity, ks=mask?.07:.1+.06*w, vh=.08+clamp(hypot(...V[i])*.09,.04,.36);
    addNode(spheres, qPos[i], act?[.15,.15,.15]:[.1,.1,.1], act?PAL.red:PAL.coral, act?1:.4);
    addNode(spheres, kPos[i], [ks,ks,ks], mask?PAL.slate:PAL.green, mask?.05:.35+.65*w);
    addNode(boxes, [kPos[i][0]*1.15,-.6+vh*.5,kPos[i][2]*1.15], [.1,vh,.1], mask?PAL.slate:PAL.sage, mask?.05:.25+.6*w);
  }
  addNode(boxes, [qPos[qIdx][0],qPos[qIdx][1]+.25,qPos[qIdx][2]], [.12,clamp(.1+hypot(...result.output[qIdx])*.09,.1,.32),.12], PAL.ivory, .9);

  for (let i=0; i<n; i++) for (let j=0; j<n; j++) {
    const sel=i===qIdx, w=result.weights[i][j];
    if (result.scores[i][j]===-Infinity || w<=1e-4 || (!sel&&w<.22)) continue;
    const strands=sel?max(1,Math.round(1+w*4)):1, p0=qPos[i], p2=kPos[j], mid=[(p0[0]+p2[0])*.22,.04+(sel?w*.35:-.1),(p0[2]+p2[2])*.22];
    const col = sel ? [.95,.35+.45*w,.24+.2*w,clamp(.28+.72*w,.28,1)] : [.68,.72,.66,.14];
    for (let st=0; st<strands; st++) {
      const sp=(st-(strands-1)*.5)*.045, p1=[mid[0]+sp,mid[1]+abs(sp)*.6,mid[2]-sp];
      const bez=u=>{const m=1-u;return[m*m*p0[0]+2*m*u*p1[0]+u*u*p2[0],m*m*p0[1]+2*m*u*p1[1]+u*u*p2[1],m*m*p0[2]+2*m*u*p1[2]+u*u*p2[2]];};
      for (let s=0; s<10; s++) addLine(lines, bez(s/10), bez((s+1)/10), col, s/10, (s+1)/10);
    }
  }
  const row=result.weights[qIdx], maxW=max(...row), maxKey=tokens[row.indexOf(maxW)]??`k${row.indexOf(maxW)}`, rowSum=row.reduce((a,b)=>a+b,0);
  return { mode:'attention', boxes, spheres, lines, telemetry:{ queryIndex:qIdx, weights:result.weights, scores:result.scores, output:result.output, rowSum }, readout:`Attention · Q="${tokens[qIdx]??qIdx}" → peak ${maxKey} (${(maxW*100).toFixed(1)}%) · Σ=${rowSum.toFixed(3)} · ${scale?'÷√dₖ':'unscaled'}` };
}

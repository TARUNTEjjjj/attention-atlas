import {
  SCENE_DEFAULTS, clamp, orbitCameraPosition, lookAtViewMatrix, perspectiveMatrix, mulMat4,
  createBoxGeometry, createSphereGeometry,
  MESH_VERTEX_SHADER, MESH_FRAGMENT_SHADER, LINE_VERTEX_SHADER, LINE_FRAGMENT_SHADER,
  buildCnnVolumeScene, buildRnnHelixScene, buildAttentionManifoldScene,
} from './scene3d-math.js';

const KERNELS = { edge: [[-1,0,1],[-1,0,1],[-1,0,1]], blur: Array.from({length:3},()=>[1/9,1/9,1/9]), identity: [[0,0,0],[0,1,0],[0,0,0]], sharpen: [[0,-1,0],[-1,5,-1],[0,-1,0]] };
const DEFAULT_CAM = { yaw: .58, pitch: .42, distance: 5.3 };

function linkProg(gl, vsSrc, fsSrc) {
  const mk = (t, src) => { const s=gl.createShader(t); if(!s)return null; gl.shaderSource(s,src); gl.compileShader(s); if(gl.getShaderParameter(s,gl.COMPILE_STATUS))return s; gl.deleteShader(s); return null; };
  const vs = mk(gl.VERTEX_SHADER, vsSrc), fs = mk(gl.FRAGMENT_SHADER, fsSrc);
  if (!vs || !fs) { vs&&gl.deleteShader(vs); fs&&gl.deleteShader(fs); return null; }
  const p = gl.createProgram(); gl.attachShader(p,vs); gl.attachShader(p,fs); gl.linkProgram(p);
  gl.deleteShader(vs); gl.deleteShader(fs);
  if (gl.getProgramParameter(p, gl.LINK_STATUS)) return p;
  gl.deleteProgram(p); return null;
}

const attr = (gl, l, sz, st=0, off=0, div=0) => { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l,sz,gl.FLOAT,false,st,off); if(div)gl.vertexAttribDivisor(l,div); };

function instMesh(gl, g) {
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const mk = (t, d) => { const b=gl.createBuffer(); gl.bindBuffer(t,b); if(d)gl.bufferData(t,d,gl.STATIC_DRAW); return b; };
  const pB=mk(gl.ARRAY_BUFFER,g.positions); attr(gl,0,3); const nB=mk(gl.ARRAY_BUFFER,g.normals); attr(gl,1,3);
  const iB=mk(gl.ELEMENT_ARRAY_BUFFER,g.indices), xB=mk(gl.ARRAY_BUFFER,null);
  for (const [l,s,o] of [[2,3,0],[3,3,12],[4,4,24],[5,1,40]]) attr(gl,l,s,44,o,1);
  gl.bindVertexArray(null);
  return { vao, xB, count: g.indices.length, bufs: [pB, nB, iB, xB] };
}

export function createWebGL2Renderer(canvas) {
  const gl = canvas?.getContext?.('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
  if (!gl) return null;
  const mp = linkProg(gl, MESH_VERTEX_SHADER, MESH_FRAGMENT_SHADER), lp = linkProg(gl, LINE_VERTEX_SHADER, LINE_FRAGMENT_SHADER);
  if (!mp || !lp) { mp&&gl.deleteProgram(mp); lp&&gl.deleteProgram(lp); return null; }
  const boxM = instMesh(gl, createBoxGeometry()), sphM = instMesh(gl, createSphereGeometry(2));
  const lVao = gl.createVertexArray(), lBuf = gl.createBuffer();
  gl.bindVertexArray(lVao); gl.bindBuffer(gl.ARRAY_BUFFER, lBuf);
  for (const [l,s,o] of [[0,3,0],[1,4,12],[2,1,28]]) attr(gl,l,s,32,o);
  gl.bindVertexArray(null);
  const uLoc = p => ({ vp: gl.getUniformLocation(p,'uViewProj'), cam: gl.getUniformLocation(p,'uCameraPos'), t: gl.getUniformLocation(p,'uTime') });
  const mU = uLoc(mp), lU = uLoc(lp);
  const drawM = (m, items) => {
    if (!items.length) return;
    const d = new Float32Array(items.length * 11);
    items.forEach((it, i) => d.set([...it.offset,...it.scale,...it.color,it.glow], i*11));
    gl.bindVertexArray(m.vao); gl.bindBuffer(gl.ARRAY_BUFFER, m.xB); gl.bufferData(gl.ARRAY_BUFFER, d, gl.DYNAMIC_DRAW);
    gl.drawElementsInstanced(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0, items.length);
  };
  return {
    render(sc, cam, time, dpr = 1) {
      const w = Math.max(1, Math.round((canvas.clientWidth||canvas.width||560)*dpr)), h = Math.max(1, Math.round((canvas.clientHeight||canvas.height||390)*dpr));
      if (canvas.width!==w || canvas.height!==h) { canvas.width=w; canvas.height=h; }
      gl.viewport(0,0,w,h); gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(.09,.114,.102,1); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      const { eye, up } = orbitCameraPosition(cam.yaw, cam.pitch, cam.distance);
      const vp = new Float32Array(mulMat4(perspectiveMatrix(.74, w/h, .1, 40), lookAtViewMatrix(eye, [0,0,0], up)));
      if (sc.lines.length) {
        const ld = new Float32Array(sc.lines.length * 16);
        sc.lines.forEach((ln, i) => ld.set([...ln.from,...ln.color,ln.progressStart,...ln.to,...ln.color,ln.progressEnd], i*16));
        gl.useProgram(lp); gl.uniformMatrix4fv(lU.vp,false,vp); gl.uniform3fv(lU.cam,eye); gl.uniform1f(lU.t,time);
        gl.bindVertexArray(lVao); gl.bindBuffer(gl.ARRAY_BUFFER, lBuf); gl.bufferData(gl.ARRAY_BUFFER, ld, gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.LINES, 0, sc.lines.length * 2);
      }
      gl.useProgram(mp); gl.uniformMatrix4fv(mU.vp,false,vp); gl.uniform3fv(mU.cam,eye); gl.uniform1f(mU.t,time);
      drawM(boxM, sc.boxes); drawM(sphM, sc.spheres); gl.bindVertexArray(null);
    },
    dispose() {
      for (const b of [...boxM.bufs,...sphM.bufs,lBuf]) gl.deleteBuffer(b);
      for (const v of [boxM.vao,sphM.vao,lVao]) gl.deleteVertexArray(v);
      gl.deleteProgram(mp); gl.deleteProgram(lp);
    },
  };
}

function readCnn(doc, fb) {
  const lab=doc.getElementById('cnn-lab'), btns=lab?.querySelectorAll('#pixels [data-pixel]');
  if (!lab || btns.length!==25) return fb;
  const input = Array.from({length:5},()=>Array(5).fill(0));
  for (const b of btns) { const [r,c]=b.dataset.pixel.split(',').map(Number); input[r][c]=b.getAttribute('aria-pressed')==='true'?1:0; }
  const act=lab.querySelector('#feature-map .active'), [focusRow,focusCol]=act?.dataset?.output?act.dataset.output.split(',').map(Number):[0,0];
  return { input, focusRow, focusCol, kernel:KERNELS[lab.querySelector('#kernel')?.value??'edge']??KERNELS.edge, stride:Number(lab.querySelector('#stride')?.value??1), padding:Number(lab.querySelector('#padding')?.value??0) };
}
function readRnn(doc, fb) {
  const lab=doc.getElementById('rnn-lab'); if (!lab) return fb;
  const ti=lab.querySelector('input[type="text"]'); let inputs=fb.inputs;
  if (ti && ti.getAttribute('aria-invalid')!=='true') { const p=ti.value.split(',').map(s=>Number(s.trim().replaceAll('−','-'))); if(p.length>=1&&p.length<=10&&p.every(Number.isFinite))inputs=p; }
  const sl=lab.querySelectorAll('input[type="range"]'), act=lab.querySelector('.state-node.is-active');
  return { inputs, wx:sl[0]?Number(sl[0].value):fb.wx, wh:sl[1]?Number(sl[1].value):fb.wh, bias:0, h0:0, selectedStep:act?Number(act.dataset.index):0 };
}
const mm2=(M,W)=>M.map(r=>[r[0]*W[0][0]+r[1]*W[1][0],r[0]*W[0][1]+r[1]*W[1][1]]);
function readAttn(doc, fb) {
  const lab=doc.getElementById('attention-lab'); if (!lab) return fb;
  const inputs=[...lab.querySelectorAll('[data-matrix]')]; let { Q,K,V }=fb;
  if (inputs.length && inputs.every(el=>el.getAttribute('aria-invalid')!=='true')) {
    const n={ Q:Q.map(r=>r.slice()), K:K.map(r=>r.slice()), V:V.map(r=>r.slice()) };
    for (const el of inputs) n[el.dataset.matrix][Number(el.dataset.i)][Number(el.dataset.j)]=Number(el.value);
    ({ Q,K,V }=n);
  }
  const isB=lab.querySelector('#attention-head')?.value==='second', actQ=lab.querySelector('[data-query][aria-pressed="true"]');
  return { Q:isB?mm2(Q,[[1,0],[0,-1]]):Q, K:isB?mm2(K,[[0,1],[1,0]]):K, V:isB?mm2(V,[[.5,0],[0,1]]):V, tokens:fb.tokens, queryIndex:actQ?Number(actQ.dataset.query):fb.queryIndex, causal:Boolean(lab.querySelector('#causal')?.checked), scale:lab.querySelector('#scaled')?Boolean(lab.querySelector('#scaled').checked):true, temperature:Number(lab.querySelector('#temperature')?.value??1) };
}

function mountTilt(doc, isRM) {
  const cards = doc.querySelectorAll('.architecture-card, .guided-experiment');
  const clear = el => { el.classList.remove('is-tilting'); el.style.removeProperty?.('--tilt-x'); el.style.removeProperty?.('--tilt-y'); };
  for (const c of cards) {
    c.addEventListener('pointermove', e => {
      if (isRM() || !c.getBoundingClientRect) return;
      const r = c.getBoundingClientRect(); if (!r.width || !r.height) return;
      const nx=clamp(((e.clientX-r.left)/r.width)*2-1,-1,1), ny=clamp(((e.clientY-r.top)/r.height)*2-1,-1,1);
      c.classList.add('is-tilting');
      c.style.setProperty?.('--tilt-x',`${(-ny*4.5).toFixed(2)}deg`); c.style.setProperty?.('--tilt-y',`${(nx*4.5).toFixed(2)}deg`);
      c.style.setProperty?.('--sheen-x',`${(((nx+1)*.5)*100).toFixed(1)}%`); c.style.setProperty?.('--sheen-y',`${(((ny+1)*.5)*100).toFixed(1)}%`);
    });
    for (const t of ['pointerleave','pointercancel']) c.addEventListener(t, () => clear(c));
  }
  return () => cards.forEach(clear);
}

function mountReveals(doc, win, isRM) {
  const Obs = win?.IntersectionObserver ?? globalThis.IntersectionObserver;
  if (typeof Obs!=='function' || isRM()) return () => {};
  const vh=win?.innerHeight??800, pend=[];
  for (const s of doc.querySelectorAll('.section')) if ((s.getBoundingClientRect?.().top??0)>vh*.92) { s.classList.add('reveal-item'); pend.push(s); }
  if (!pend.length) return () => {};
  const revealAll = () => pend.forEach(s => s.classList.add('is-revealed'));
  const io = new Obs(es => { for(const e of es) if(e.isIntersecting){ e.target.classList.add('is-revealed'); io.unobserve(e.target); } }, { threshold:.06, rootMargin:'0px 0px -30px 0px' });
  pend.forEach(s => io.observe(s));
  win?.addEventListener?.('hashchange', revealAll);
  doc.addEventListener('click', e => { if(e.target?.closest?.('a[href]')) revealAll(); });
  return revealAll;
}

export function mountScene3D({ documentRef = globalThis.document, windowRef = globalThis.window } = {}) {
  const stage = documentRef?.getElementById('hero-3d-stage'); if (!stage) return null;
  stage.classList.add('has-js');
  const mq = windowRef?.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null, isRM = () => Boolean(mq?.matches);
  let paused = isRM(), mode = 'cnn', time = 0, cam = { ...DEFAULT_CAM, velYaw: 0, velPitch: 0 };
  let cnnSt = readCnn(documentRef, SCENE_DEFAULTS.cnn), rnnSt = readRnn(documentRef, SCENE_DEFAULTS.rnn), attnSt = readAttn(documentRef, SCENE_DEFAULTS.attention);
  const $id = id => documentRef.getElementById(id), canvas = $id('hero-3d-canvas'), vp = $id('stage-viewport');
  const badge = $id('stage-badge'), readout = $id('stage-readout'), stepBtn = $id('stage-step'), motionBtn = $id('stage-motion-toggle');
  const hud = stage.querySelector('.stage-hud'), renderer = createWebGL2Renderer(canvas);
  if (renderer) { stage.classList.add('has-webgl2'); if (hud) hud.hidden = false; }

  const STEPS = { cnn:'Next window', rnn:'Decay ↔ Growth', attention:'Next query' };
  const BADGES = { cnn:'CNN · 3×3 KERNEL', rnn:'RNN · HELIX FLOW', attention:'ATTENTION · SOFTMAX' };

  function drawFrame() {
    const sc = mode==='cnn' ? buildCnnVolumeScene(cnnSt) : mode==='rnn' ? buildRnnHelixScene({...rnnSt,time}) : buildAttentionManifoldScene({...attnSt,time});
    for (const b of stage.querySelectorAll('.stage-mode-btn')) b.setAttribute('aria-selected', String(b.dataset.mode===mode));
    if (badge) badge.textContent=BADGES[mode]; if (stepBtn) stepBtn.textContent=STEPS[mode]; if (readout) readout.textContent=sc.readout;
    if (motionBtn) { motionBtn.setAttribute('aria-pressed',String(paused)); motionBtn.textContent=paused?'Resume':'Pause'; motionBtn.setAttribute('aria-label',paused?'Resume 3D motion':'Pause 3D motion'); }
    if (renderer) renderer.render(sc, cam, time, Math.min(windowRef?.devicePixelRatio||1, 2));
    return sc;
  }
  const setMode = m => { if(['cnn','rnn','attention'].includes(m)){ mode=m; drawFrame(); } };
  const setPaused = p => { paused=Boolean(p); if(paused){ cam.velYaw=0; cam.velPitch=0; } drawFrame(); };

  for (const b of stage.querySelectorAll('.stage-mode-btn')) b.addEventListener('click', () => setMode(b.dataset.mode));
  stepBtn?.addEventListener('click', () => {
    if (mode==='cnn') {
      const cs=[...documentRef.querySelectorAll('#cnn-lab [data-output]')];
      if(cs.length) cs[(cs.findIndex(el=>el.classList.contains('active'))+1)%cs.length].click(); else { cnnSt={...cnnSt,focusCol:(cnnSt.focusCol+1)%3}; drawFrame(); }
    } else if (mode==='rnn') {
      const nw=Math.abs(rnnSt.wh)<1?1.2:.7, sl=documentRef.querySelectorAll('#rnn-lab input[type="range"]')[1];
      if(sl){ sl.value=String(nw); sl.dispatchEvent(typeof windowRef?.Event==='function'?new windowRef.Event('input',{bubbles:true}):{type:'input',bubbles:true,preventDefault(){},stopPropagation(){}}); }
      else { rnnSt={...rnnSt,wh:nw}; drawFrame(); }
    } else {
      const nq=(attnSt.queryIndex+1)%attnSt.Q.length, qb=documentRef.querySelector(`#attention-lab [data-query="${nq}"]`);
      if(qb) qb.click(); else { attnSt={...attnSt,queryIndex:nq}; drawFrame(); }
    }
  });

  $id('stage-zoom-in')?.addEventListener('click', () => { cam.distance=clamp(cam.distance-.45,2.8,9); drawFrame(); });
  $id('stage-zoom-out')?.addEventListener('click', () => { cam.distance=clamp(cam.distance+.45,2.8,9); drawFrame(); });
  $id('stage-reset')?.addEventListener('click', () => { cam={...DEFAULT_CAM,velYaw:0,velPitch:0}; drawFrame(); });
  motionBtn?.addEventListener('click', () => setPaused(!paused));

  if (vp) {
    let drag=false, lx=0, ly=0;
    vp.addEventListener('pointerdown', e => { if(e.target?.closest?.('button'))return; drag=true; lx=e.clientX??0; ly=e.clientY??0; cam.velYaw=0; cam.velPitch=0; vp.setPointerCapture?.(e.pointerId); });
    vp.addEventListener('pointermove', e => {
      if(!drag)return; const dx=(e.clientX??0)-lx, dy=(e.clientY??0)-ly; lx=e.clientX??0; ly=e.clientY??0;
      cam.yaw-=dx*.008; cam.pitch=clamp(cam.pitch+dy*.007,-1.25,1.25);
      if(!paused&&!isRM()){ cam.velYaw=-dx*.004; cam.velPitch=dy*.0035; } drawFrame();
    });
    for (const t of ['pointerup','pointercancel']) vp.addEventListener(t, () => { drag=false; });
    const keys = {
      ArrowLeft:()=>{cam.yaw-=.14;}, ArrowRight:()=>{cam.yaw+=.14;},
      ArrowUp:()=>{cam.pitch=clamp(cam.pitch+.12,-1.25,1.25);}, ArrowDown:()=>{cam.pitch=clamp(cam.pitch-.12,-1.25,1.25);},
      '+':()=>{cam.distance=clamp(cam.distance-.45,2.8,9);}, '=':()=>{cam.distance=clamp(cam.distance-.45,2.8,9);},
      '-':()=>{cam.distance=clamp(cam.distance+.45,2.8,9);}, '_':()=>{cam.distance=clamp(cam.distance+.45,2.8,9);},
      r:()=>{cam={...DEFAULT_CAM,velYaw:0,velPitch:0};}, R:()=>{cam={...DEFAULT_CAM,velYaw:0,velPitch:0};}, ' ':()=>setPaused(!paused),
    };
    vp.addEventListener('keydown', e => { if(keys[e.key]){ e.preventDefault(); keys[e.key](); if(e.key!==' ')drawFrame(); } });
  }

  for (const [id,lm,rd] of [['cnn-lab','cnn',()=>{cnnSt=readCnn(documentRef,cnnSt);}],['rnn-lab','rnn',()=>{rnnSt=readRnn(documentRef,rnnSt);}],['attention-lab','attention',()=>{attnSt=readAttn(documentRef,attnSt);}]]) {
    const el=$id(id); if(el) for(const evt of ['click','input','change']) el.addEventListener(evt, ()=>{ rd(); mode=lm; drawFrame(); });
  }

  const RO = windowRef?.ResizeObserver ?? globalThis.ResizeObserver;
  const ro = typeof RO==='function'&&vp&&renderer ? new RO(()=>drawFrame()) : null; ro?.observe(vp);
  const clearTilt=mountTilt(documentRef,isRM), revealAll=mountReveals(documentRef,windowRef,isRM);
  mq?.addEventListener?.('change', () => { if(isRM()){ clearTilt(); revealAll(); time=0; setPaused(true); } });

  let rafId=0, lastStamp=0;
  const raf=windowRef?.requestAnimationFrame, cancelRaf=windowRef?.cancelAnimationFrame;
  function tick(stamp) {
    if (!lastStamp) lastStamp=stamp; const dt=Math.min((stamp-lastStamp)/1000,.05); lastStamp=stamp;
    if (!paused&&!isRM()) { time+=dt; cam.yaw+=.14*dt+cam.velYaw; cam.pitch=clamp(cam.pitch+cam.velPitch,-1.25,1.25); const d=Math.exp(-6.5*dt); cam.velYaw*=d; cam.velPitch*=d; drawFrame(); }
    if (typeof raf==='function') rafId=raf(tick);
  }
  drawFrame(); if (renderer && typeof raf==='function') rafId=raf(tick);
  return { getState:()=>({mode,paused,camera:{...cam},time}), setMode, setPaused, destroy:()=>{ if(rafId&&typeof cancelRaf==='function')cancelRaf(rafId); ro?.disconnect(); renderer?.dispose(); } };
}

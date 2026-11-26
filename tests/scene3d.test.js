import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FakeDocument, FakeEvent } from './fake-dom.js';
import { convolve2d, convolutionWindow, rnnSequence, attention } from '../src/math.js';
import {
  LINE_FRAGMENT_SHADER,
  LINE_VERTEX_SHADER,
  MESH_FRAGMENT_SHADER,
  MESH_VERTEX_SHADER,
  SCENE_DEFAULTS,
  buildAttentionManifoldScene,
  buildCnnVolumeScene,
  buildRnnHelixScene,
  createBoxGeometry,
  createSphereGeometry,
  eigenEnvelopeRadius,
  lookAtViewMatrix,
  mulMat4,
  orbitCameraPosition,
  orbitRotationMatrix,
  perspectiveMatrix,
  projectPoint,
} from '../src/scene3d-math.js';
import { mountScene3D } from '../src/scene3d.js';

function assertClose(actual, expected, tol, message) {
  assert.ok(Math.abs(actual - expected) <= tol, `${message}: expected ${expected} ± ${tol}, got ${actual}`);
}

function lcg(seed = 20261126) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function mat3Det(m) {
  return (
    m[0] * (m[4] * m[8] - m[7] * m[5]) -
    m[3] * (m[1] * m[8] - m[7] * m[2]) +
    m[6] * (m[1] * m[5] - m[4] * m[2])
  );
}

test('scene3d-math: SO(3) orbit rotation matrices and lookAt/perspective projections satisfy matrix invariants', () => {
  const rand = lcg(42);
  for (let i = 0; i < 120; i++) {
    const yaw = (rand() - 0.5) * 4 * Math.PI;
    const pitch = (rand() - 0.5) * 2.4;
    const distance = 2.8 + rand() * 5.0;
    const aspect = 0.6 + rand() * 2.0;

    const R = orbitRotationMatrix(yaw, pitch);
    assertClose(mat3Det(R), 1, 1e-12, `det(R) at sample ${i}`);

    // R^T * R == I
    for (let c = 0; c < 3; c++) {
      for (let r = 0; r < 3; r++) {
        const dot = R[c * 3] * R[r * 3] + R[c * 3 + 1] * R[r * 3 + 1] + R[c * 3 + 2] * R[r * 3 + 2];
        assertClose(dot, c === r ? 1 : 0, 1e-12, `R^T R[${r},${c}] at sample ${i}`);
      }
    }

    const { eye, up } = orbitCameraPosition(yaw, pitch, distance);
    const radius = Math.hypot(eye[0], eye[1], eye[2]);
    assertClose(radius, distance, 1e-11, `camera orbit radius at sample ${i}`);

    const view = lookAtViewMatrix(eye, [0, 0, 0], up);
    const proj = perspectiveMatrix(0.74, aspect, 0.1, 40);
    const vp = mulMat4(proj, view);
    const center = projectPoint(vp, [0, 0, 0]);
    assert.ok(center.w > 0, `positive clip w at sample ${i}`);
    assertClose(center.ndc[0], 0, 1e-11, `center ndc.x at sample ${i}`);
    assertClose(center.ndc[1], 0, 1e-11, `center ndc.y at sample ${i}`);
    assert.ok(center.ndc[2] > -1 && center.ndc[2] < 1, `center ndc.z inside [-1, 1] at sample ${i}`);
  }
});

test('scene3d-math: closed box and icosahedral/octahedral sphere meshes satisfy topology and unit-normal invariants', () => {
  const box = createBoxGeometry();
  assert.equal(box.positions.length, 24 * 3);
  assert.equal(box.indices.length, 12 * 3);
  for (let i = 0; i < box.normals.length; i += 3) {
    assertClose(Math.hypot(box.normals[i], box.normals[i + 1], box.normals[i + 2]), 1, 1e-6, 'box normal length');
  }

  for (const sub of [0, 1, 2]) {
    const sphere = createSphereGeometry(sub);
    const expectedTris = 8 * 4 ** sub;
    assert.equal(sphere.indices.length, expectedTris * 3, `triangle count at subdivision ${sub}`);
    for (let i = 0; i < sphere.positions.length; i += 3) {
      const len = Math.hypot(sphere.positions[i], sphere.positions[i + 1], sphere.positions[i + 2]);
      assertClose(len, 1, 1e-6, `unit sphere radius sub=${sub}`);
    }
  }
});

test('scene3d-math: differential parity between 3D geometry telemetry and core src/math.js calculations', () => {
  const cnnOpts = {
    input: SCENE_DEFAULTS.cnn.input,
    kernel: [[1, 0, -1], [2, 0, -2], [1, 0, -1]],
    stride: 1,
    padding: 1,
    focusRow: 2,
    focusCol: 1,
  };
  const expectedConv = convolve2d(cnnOpts.input, cnnOpts.kernel, { stride: 1, padding: 1 });
  const expectedWin = convolutionWindow(cnnOpts.input, cnnOpts.kernel, 2, 1, { stride: 1, padding: 1 });
  const cnnScene = buildCnnVolumeScene(cnnOpts);
  assert.deepEqual(cnnScene.telemetry.output, expectedConv);
  assertClose(cnnScene.telemetry.windowSum, expectedWin.sum, 1e-12, 'CNN window dot product');
  assert.equal(cnnScene.telemetry.windowCoords.length, 9);

  for (const wh of [0.65, 1.0, 1.25]) {
    const rnnOpts = { ...SCENE_DEFAULTS.rnn, wh };
    const seq = rnnSequence(rnnOpts.inputs, { wx: rnnOpts.wx, wh, bias: rnnOpts.bias, h0: rnnOpts.h0 });
    const rnnScene = buildRnnHelixScene(rnnOpts);
    assert.equal(rnnScene.telemetry.regime, wh < 1 ? 'decay' : wh > 1 ? 'growth' : 'unitary');
    for (let t = 1; t < rnnScene.telemetry.steps.length; t++) {
      assertClose(rnnScene.telemetry.steps[t].hidden, seq[t - 1].hidden, 1e-12, `RNN h_${t}`);
      assertClose(rnnScene.telemetry.steps[t].eigenRadius, eigenEnvelopeRadius(wh, t, 0.62), 1e-12, `RNN envelope step ${t}`);
    }
  }

  for (const causal of [false, true]) {
    for (const scale of [true, false]) {
      const attnOpts = { ...SCENE_DEFAULTS.attention, causal, scale, queryIndex: 2 };
      const refAttn = attention(attnOpts.Q, attnOpts.K, attnOpts.V, { causal, scale, temperature: attnOpts.temperature });
      const attnScene = buildAttentionManifoldScene(attnOpts);
      assert.deepEqual(attnScene.telemetry.weights, refAttn.weights);
      assertClose(attnScene.telemetry.rowSum, 1, 1e-12, `Attention simplex sum (causal=${causal}, scale=${scale})`);
    }
  }
});

test('scene3d: GLSL shaders contain valid WebGL2 headers and mountScene3D handles FakeDocument, reduced-motion, and keyboard orbit', async () => {
  for (const shader of [MESH_VERTEX_SHADER, MESH_FRAGMENT_SHADER, LINE_VERTEX_SHADER, LINE_FRAGMENT_SHADER]) {
    assert.match(shader, /^#version 300 es/);
    assert.match(shader, /void main\(\)/);
  }

  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const doc = new FakeDocument(html);
  let reduced = true;
  const fakeWindow = {
    devicePixelRatio: 2,
    matchMedia: () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {},
    removeEventListener() {},
  };

  const controller = mountScene3D({ documentRef: doc, windowRef: fakeWindow });
  assert.ok(controller, 'mountScene3D returns controller on index.html');
  assert.equal(controller.getState().paused, true, 'starts paused under prefers-reduced-motion');
  assert.equal(controller.getState().mode, 'cnn');

  controller.setMode('attention');
  assert.equal(controller.getState().mode, 'attention');
  assert.match(doc.getElementById('stage-readout').textContent, /Attention/);

  const vp = doc.getElementById('stage-viewport');
  const beforeYaw = controller.getState().camera.yaw;
  vp.dispatchEvent(new FakeEvent('keydown', { key: 'ArrowRight' }));
  assert.ok(controller.getState().camera.yaw > beforeYaw, 'ArrowRight orbits camera yaw');

  controller.setPaused(false);
  assert.equal(controller.getState().paused, false);
  controller.destroy();
});

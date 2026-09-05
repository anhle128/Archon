/* Archon run-view HITL mockup — complex-graph edition.
 *
 * Graph: layered DAG layout (longest-path layering, DFS back-edge detection for
 * retry loops, barycenter crossing reduction), SVG edges + HTML node cards in a
 * pan/zoom viewport. Handles depends_on edges, conditional `when:` edges,
 * trigger_rule joins, route_loop routes, and loop-back edges.
 *
 * Data model: state.runs is a flat list of NODE RUNS. A normal node produces one
 * run; a loop node produces one run PER ITERATION; a node re-executed via a
 * route_loop back-edge produces a fresh set of runs. Log items live on the run
 * entry, never on the node — runs are never merged. The Logs tab renders
 * state.runs 1:1. The shared right panel always shows ONE run; chips switch
 * between a node's runs.
 */
'use strict';

// ---------- tiny helpers ----------
const qs = (s, r = document) => r.querySelector(s);
const qsa = (s, r = document) => [...r.querySelectorAll(s)];
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function esc(s) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function md(s) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}
function fmtDur(ms) {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's';
}
function fmtClock(sec) {
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}

// auto-play mode (?auto=1): cards answer/approve themselves after a short pause,
// so the whole demo runs hands-free.
const AUTO = new URLSearchParams(location.search).has('auto');

// ---------- workflow definition: speckit-ralph-native-feature (real shape) ----------
// kinds: bash, prompt, loop, gate (plannotator_gate), router (route_loop), command
const NODES = [
  { id: 'setup', kind: 'bash' },
  { id: 'specify', kind: 'prompt' },
  { id: 'clarify', kind: 'prompt', ask: true },
  { id: 'clarify-file-check', kind: 'bash' },
  { id: 'clarify-respond', kind: 'prompt' },
  { id: 'clarify-gate', kind: 'gate' },
  { id: 'clarify-apply', kind: 'prompt' },
  { id: 'red-team', kind: 'prompt' },
  { id: 'red-team-respond', kind: 'prompt' },
  { id: 'red-team-gate', kind: 'gate' },
  { id: 'red-team-apply', kind: 'prompt' },
  { id: 'plan', kind: 'prompt' },
  { id: 'tasks', kind: 'prompt' },
  { id: 'analyze', kind: 'prompt' },
  { id: 'analyze-respond', kind: 'prompt' },
  { id: 'analyze-apply', kind: 'prompt' },
  { id: 'ralph-tasks-to-ralph', kind: 'bash', join: 'one_success' },
  { id: 'ralph-native-preflight', kind: 'bash' },
  { id: 'ralph-loop-run', kind: 'loop', maxIter: 100 },
  { id: 'ralph-sync-back', kind: 'prompt' },
  { id: 'speckit-converge', kind: 'prompt' },
  { id: 'speckit-converge-gate', kind: 'router' },
  { id: 'speckit-converge-review-gate', kind: 'gate' },
  { id: 'speckit-final-ralph-tasks-to-ralph', kind: 'bash' },
  { id: 'speckit-final-ralph-native-preflight', kind: 'bash' },
  { id: 'speckit-final-ralph-loop-run', kind: 'loop', maxIter: 100 },
  { id: 'speckit-final-ralph-sync-back', kind: 'prompt' },
  { id: 'speckit-final-cargo-clean-before-pr', kind: 'bash' },
  { id: 'cargo-clean-before-pr', kind: 'bash' },
  { id: 'update-bmad-sprint-status', kind: 'prompt', join: 'one_success' },
  { id: 'create-pull-request', kind: 'command' },
];

// depends_on edges. meta: { when } conditional, { join } trigger_rule on target.
const DEP_EDGES = [
  ['setup', 'specify'],
  ['specify', 'clarify'],
  ['clarify', 'clarify-file-check'],
  ['clarify-file-check', 'clarify-respond', { when: "output == 'HAS_QUESTIONS'" }],
  ['clarify-respond', 'clarify-gate'],
  ['clarify-gate', 'clarify-apply'],
  ['clarify-file-check', 'red-team'],
  ['clarify-respond', 'red-team'],
  ['clarify-gate', 'red-team'],
  ['clarify-apply', 'red-team', { join: 'none_failed_min_one_success' }],
  ['red-team', 'red-team-respond'],
  ['red-team-respond', 'red-team-gate'],
  ['red-team-gate', 'red-team-apply'],
  ['red-team-apply', 'plan'],
  ['plan', 'tasks'],
  ['tasks', 'analyze'],
  ['analyze', 'analyze-respond'],
  ['analyze-respond', 'analyze-apply'],
  ['analyze-apply', 'ralph-tasks-to-ralph', { join: 'one_success' }],
  ['ralph-tasks-to-ralph', 'ralph-native-preflight'],
  ['ralph-native-preflight', 'ralph-loop-run'],
  ['ralph-loop-run', 'ralph-sync-back'],
  ['ralph-sync-back', 'speckit-converge'],
  ['speckit-converge', 'speckit-converge-gate'],
  ['speckit-converge-gate', 'speckit-final-ralph-tasks-to-ralph'],
  ['speckit-final-ralph-tasks-to-ralph', 'speckit-final-ralph-native-preflight'],
  ['speckit-final-ralph-native-preflight', 'speckit-final-ralph-loop-run'],
  ['speckit-final-ralph-loop-run', 'speckit-final-ralph-sync-back'],
  ['speckit-final-ralph-sync-back', 'speckit-final-cargo-clean-before-pr'],
  ['cargo-clean-before-pr', 'update-bmad-sprint-status', { join: 'one_success' }],
  ['speckit-final-cargo-clean-before-pr', 'update-bmad-sprint-status', { join: 'one_success' }],
  ['update-bmad-sprint-status', 'create-pull-request'],
];

// route_loop routes (drawn as colored route edges, included in layout)
const ROUTE_EDGES = [
  ['speckit-converge-gate', 'cargo-clean-before-pr', { route: 'positive', label: 'PASS' }],
  ['speckit-converge-gate', 'speckit-converge-review-gate', { route: 'negative', label: 'FAIL' }],
  ['speckit-converge-gate', 'speckit-final-ralph-tasks-to-ralph', { route: 'exhausted', label: 'exhausted' }],
];

// the retry loop: review-gate feeds back into ralph-tasks-to-ralph (one_success join).
// Declared as a normal dependency in the YAML; the layout detects it as a back-edge.
const LOOPBACK_EDGES = [['speckit-converge-review-gate', 'ralph-tasks-to-ralph', { join: 'one_success', loopback: true }]];

const ASKS = {
  clarify: {
    requestId: 'req_c41f',
    questions: [
      {
        id: 'q1',
        kind: 'single',
        text: 'Spec depth for the attach-first-writer feature?',
        options: ['Full SDD spec', 'Lightweight spec', 'Skip straight to plan'],
      },
      {
        id: 'q2',
        kind: 'multi',
        text: 'Which context docs should `specify` read first?',
        options: ['harness API contract', 'existing writer service', 'grill-me notes'],
      },
    ],
  },
};

const GATES = {
  'clarify-gate': {
    title: 'Clarification answers ready for live review',
    doc: 'specs/014-attach-first-writer/visual/speckit-clarify-explainer.html',
    url: 'http://minis-mac-mini.taildae6a9.ts.net:19431',
    note: 'After Approve, next step runs `$speckit-clarifybatch --apply`.',
  },
  'red-team-gate': {
    title: 'Red-team resolutions ready for live review',
    doc: 'specs/014-attach-first-writer/visual/speckit-red-team-explainer.html',
    url: 'http://minis-mac-mini.taildae6a9.ts.net:19432',
    note: 'After Approve: `/speckit.red-team.apply --allow-historical-edits`.',
  },
  'speckit-converge-review-gate': {
    title: 'Converge added tasks — review before retry',
    doc: 'specs/014-attach-first-writer/tasks.md',
    url: 'http://minis-mac-mini.taildae6a9.ts.net:19433',
    note: 'After Approve: re-run `ralph-tasks-to-ralph` and the Ralph implementation loop.',
  },
};

// ---------- state ----------
const state = {
  t0: Date.now(),
  view: 'starter',
  nodeStatus: {}, // id -> { status, runs: count }
  runs: [], // { hid, nodeId, seq, iter, passDetail, status, startMs, durMs, items[] }
  hidSeq: 0,
  selected: null, // nodeId shown in the panel
  panelRun: {}, // nodeId -> hid of the run being viewed
  panelOpen: false,
  answers: {}, // nodeId -> { lines }
  gateDecisions: {}, // nodeId -> 'approved' | 'annotations'
  timers: [],
  convergePass: 0,
};

function nodeDef(id) {
  return NODES.find(n => n.id === id);
}
function runsOf(id) {
  return state.runs.filter(r => r.nodeId === id);
}
function latestRun(id) {
  const rs = runsOf(id);
  return rs[rs.length - 1] || null;
}
function runByHid(hid) {
  return state.runs.find(r => r.hid === hid) || null;
}
function runLabel(r) {
  let l = r.nodeId;
  if (r.iter) l += ' ×' + r.iter;
  if (r.seq > 1 && !r.iter) l += ' #' + r.seq;
  return l;
}
function elapsedSec() {
  return Math.floor((Date.now() - state.t0) / 1000);
}
function at(ms, fn) {
  state.timers.push(setTimeout(fn, ms));
}

// ---------- layered DAG layout ----------
const NODE_W = 208;
const NODE_H = 58;
const GAP_X = 34;
const GAP_Y = 46;

function computeLayout() {
  const ids = NODES.map(n => n.id);
  const allEdges = [...DEP_EDGES, ...ROUTE_EDGES, ...LOOPBACK_EDGES].map(([from, to, meta]) => ({ from, to, meta: meta || {} }));

  // 1. cycle-break: DFS, edge to a grey (on-stack) node = back-edge
  const adj = new Map(ids.map(id => [id, []]));
  for (const e of allEdges) adj.get(e.from).push(e);
  const color = new Map(ids.map(id => [id, 0])); // 0 white, 1 grey, 2 black
  const backEdges = new Set();
  function dfs(u) {
    color.set(u, 1);
    for (const e of adj.get(u)) {
      if (e.meta.loopback) {
        backEdges.add(e);
        continue;
      }
      const c = color.get(e.to);
      if (c === 1) backEdges.add(e);
      else if (c === 0) dfs(e.to);
    }
    color.set(u, 2);
  }
  for (const id of ids) if (color.get(id) === 0) dfs(id);

  // 2. longest-path layering over forward edges
  const fwd = allEdges.filter(e => !backEdges.has(e));
  const layer = new Map(ids.map(id => [id, 0]));
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 200) {
    changed = false;
    for (const e of fwd) {
      if (layer.get(e.to) < layer.get(e.from) + 1) {
        layer.set(e.to, layer.get(e.from) + 1);
        changed = true;
      }
    }
  }

  // 3. group by layer, order by barycenter (2 sweeps)
  const layers = [];
  for (const id of ids) {
    const l = layer.get(id);
    (layers[l] = layers[l] || []).push(id);
  }
  const posInLayer = new Map();
  const reorder = () => {
    layers.forEach((l, i) => l.forEach((id, k) => posInLayer.set(id, k)));
  };
  reorder();
  const depsOf = id => fwd.filter(e => e.to === id).map(e => e.from);
  const succOf = id => fwd.filter(e => e.from === id).map(e => e.to);
  for (let sweep = 0; sweep < 2; sweep++) {
    for (let i = 1; i < layers.length; i++) {
      layers[i].sort((a, b) => bary(depsOf(a)) - bary(depsOf(b)));
      layers[i].forEach((id, k) => posInLayer.set(id, k));
    }
    for (let i = layers.length - 2; i >= 0; i--) {
      layers[i].sort((a, b) => bary(succOf(a)) - bary(succOf(b)));
      layers[i].forEach((id, k) => posInLayer.set(id, k));
    }
  }
  function bary(neighbors) {
    if (!neighbors.length) return 0;
    return neighbors.reduce((s, n) => s + (posInLayer.get(n) || 0), 0) / neighbors.length;
  }

  // 4. coordinates — center each layer horizontally
  const pos = new Map();
  let maxW = 0;
  layers.forEach(l => (maxW = Math.max(maxW, l.length)));
  const fullW = maxW * (NODE_W + GAP_X) - GAP_X;
  layers.forEach((l, i) => {
    const layerW = l.length * (NODE_W + GAP_X) - GAP_X;
    const x0 = (fullW - layerW) / 2;
    l.forEach((id, k) => pos.set(id, { x: x0 + k * (NODE_W + GAP_X), y: i * (NODE_H + GAP_Y), layer: i }));
  });

  return {
    pos,
    edges: fwd,
    backEdges: [...backEdges],
    width: fullW,
    height: layers.length * (NODE_H + GAP_Y) - GAP_Y,
  };
}

// ---------- graph rendering + viewport ----------
let LAYOUT = null;
const view = { x: 0, y: 0, k: 1 };

function buildGraph() {
  LAYOUT = computeLayout();
  const world = qs('#graph-world');
  world.innerHTML = '';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('id', 'edges');
  svg.setAttribute('width', LAYOUT.width);
  svg.setAttribute('height', LAYOUT.height);
  const MARKERS = [
    ['arr', 'arr-fill'],
    ['arr-taken', 'arr-taken'],
    ['arr-hl', 'arr-hl'],
    ['arr-pos', 'arr-pos'],
    ['arr-neg', 'arr-neg'],
    ['arr-exh', 'arr-exh'],
    ['arr-loop', 'arr-loop'],
  ];
  // long, sharp, swallowtail-notched head — reads as a direction, not a dot
  svg.innerHTML =
    '<defs>' +
    MARKERS.map(
      ([id, cls]) =>
        `<marker id="${id}" viewBox="0 0 20 14" refX="18.5" refY="7" markerWidth="20" markerHeight="14" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0,0 L19,7 L0,14 L5.5,7 z" class="${cls}"/></marker>`
    ).join('') +
    '</defs>';
  world.appendChild(svg);

  for (const e of LAYOUT.edges) svg.appendChild(edgePath(e));
  for (const e of LAYOUT.backEdges) svg.appendChild(backEdgePath(e));

  for (const n of NODES) {
    const p = LAYOUT.pos.get(n.id);
    const card = el('div', 'gnode status-pending kind-' + n.kind);
    card.dataset.node = n.id;
    card.style.left = p.x + 'px';
    card.style.top = p.y + 'px';
    card.style.width = NODE_W + 'px';
    const head = el('div', 'gn-head');
    head.appendChild(el('span', 'type-pill type-' + n.kind, kindLabel(n)));
    if (n.join) {
      const j = el('span', 'gn-join', n.join === 'one_success' ? '≥1' : 'all-ok');
      j.title = 'trigger_rule: ' + n.join;
      head.appendChild(j);
    }
    head.appendChild(el('span', 'gn-iter'));
    card.appendChild(head);
    card.appendChild(el('div', 'gn-name', n.id));
    card.appendChild(el('div', 'gn-status', 'pending'));
    card.addEventListener('click', ev => {
      ev.stopPropagation();
      openPanel(n.id);
    });
    card.addEventListener('mouseenter', () => setHoverNode(n.id));
    card.addEventListener('mouseleave', () => setHoverNode(null));
    world.appendChild(card);
  }
  applyView();
}

function kindLabel(n) {
  if (n.kind === 'gate') return 'GATE';
  if (n.kind === 'router') return 'ROUTE';
  if (n.kind === 'loop') return 'LOOP';
  return n.kind.toUpperCase();
}

// Curved bezier routing with distance-aware ports:
//  - short edge (adjacent layers), e.g. a route_loop fan-out → curve into the
//    TOP of the target, arriving vertically — symmetric and clean
//  - long edge (spans multiple layers) with a clear side offset → smooth
//    S-curve entering horizontally through the SIDE facing the source, so a
//    cross-graph connection never sweeps behind intermediate nodes
function edgePath(e) {
  const a = LAYOUT.pos.get(e.from);
  const b = LAYOUT.pos.get(e.to);
  const x1 = a.x + NODE_W / 2;
  const y1 = a.y + NODE_H; // source bottom
  const x2 = b.x + NODE_W / 2;
  const dx = x2 - x1;
  const dl = b.layer - a.layer;
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('class', 'edge-g' + (e.meta.route ? ' eg-route-' + e.meta.route : '') + (e.meta.when ? ' eg-cond' : ''));
  g.dataset.from = e.from;
  g.dataset.to = e.to;
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  let d;
  let labelPos;
  if (dl <= 1 || Math.abs(dx) <= NODE_W * 0.75) {
    // into the top, arriving vertically
    const y2 = b.y - 2; // arrow tip touches the top border
    const bend = Math.max(18, (y2 - y1) * 0.45);
    d = `M${x1},${y1} C${x1},${y1 + bend} ${x2},${y2 - bend} ${x2},${y2}`;
    labelPos = { x: (x1 + x2) / 2 + 8, y: (y1 + y2) / 2, anchor: 'start' };
  } else {
    // into the side facing the source, arriving horizontally
    const dir = Math.sign(dx);
    const ex = dir > 0 ? b.x : b.x + NODE_W; // left / right border
    const ey = b.y + NODE_H / 2; // mid-height
    const k1 = Math.max(24, (ey - y1) * 0.5);
    const k2 = Math.max(40, Math.abs(dx) * 0.35);
    d = `M${x1},${y1} C${x1},${y1 + k1} ${ex - dir * k2},${ey} ${ex},${ey}`;
    labelPos = { x: (x1 + ex) / 2, y: (y1 + ey) / 2 - 8, anchor: 'middle' };
  }
  p.setAttribute('d', d);
  p.setAttribute('class', 'edge');
  p.setAttribute('marker-end', 'url(#arr)');
  g.appendChild(p);
  const label = e.meta.when || e.meta.label;
  if (label) {
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', labelPos.x);
    t.setAttribute('y', labelPos.y);
    t.setAttribute('text-anchor', labelPos.anchor);
    t.setAttribute('class', 'edge-label' + (e.meta.route ? ' edge-label-' + e.meta.route : ''));
    t.textContent = label;
    g.appendChild(t);
  }
  return g;
}

function backEdgePath(e) {
  const a = LAYOUT.pos.get(e.from);
  const b = LAYOUT.pos.get(e.to);
  const x1 = a.x; // left side of source
  const y1 = a.y + NODE_H / 2;
  const x2 = b.x; // left side of target
  const y2 = b.y + NODE_H / 2;
  const lane = Math.min(x1, x2) - 46; // route around the left flank
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('class', 'edge-g eg-loopback');
  g.dataset.from = e.from;
  g.dataset.to = e.to;
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute(
    'd',
    `M${x1},${y1} C${lane},${y1} ${lane},${y2} ${x2 - 4},${y2}`
  );
  p.setAttribute('class', 'edge');
  p.setAttribute('marker-end', 'url(#arr-loop)');
  g.appendChild(p);
  const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  t.setAttribute('x', lane + 4);
  t.setAttribute('y', (y1 + y2) / 2);
  t.setAttribute('class', 'edge-label edge-label-loopback');
  t.textContent = 'retry loop';
  g.appendChild(t);
  return g;
}

// taken = the run actually flowed through this edge (target started)
function paintEdges() {
  qsa('.edge-g').forEach(g => {
    const to = g.dataset.to;
    let taken;
    if (g.classList.contains('eg-loopback')) {
      taken = runsOf(to).length > 1; // retry loop only "taken" on a re-run
    } else {
      const ns = state.nodeStatus[to];
      taken = !!ns && ns.status !== 'pending';
    }
    g.classList.toggle('edge-taken', taken);
  });
}

// hover a node → light up its in/out edges, dim everything else
function setHoverNode(id) {
  qsa('.edge-g').forEach(g => {
    const touches = !!id && (g.dataset.from === id || g.dataset.to === id);
    g.classList.toggle('edge-hl', touches);
    g.classList.toggle('edge-dim', !!id && !touches);
  });
}

// viewport: pan + zoom
function applyView() {
  qs('#graph-world').style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
}
function fitGraph() {
  const pane = qs('#graph-pane');
  const pad = 32;
  const k = Math.min(
    1.2,
    Math.min((pane.clientWidth - pad) / LAYOUT.width, (pane.clientHeight - pad) / LAYOUT.height)
  );
  view.k = k;
  view.x = (pane.clientWidth - LAYOUT.width * k) / 2;
  view.y = pad / 2;
  applyView();
}
function bindViewport() {
  const pane = qs('#graph-pane');
  let drag = null;
  pane.addEventListener('pointerdown', e => {
    if (e.target.closest('.gnode')) return;
    drag = { x: e.clientX - view.x, y: e.clientY - view.y };
    pane.setPointerCapture(e.pointerId);
    pane.classList.add('panning');
  });
  pane.addEventListener('pointermove', e => {
    if (!drag) return;
    view.x = e.clientX - drag.x;
    view.y = e.clientY - drag.y;
    applyView();
  });
  pane.addEventListener('pointerup', () => {
    drag = null;
    pane.classList.remove('panning');
  });
  pane.addEventListener(
    'wheel',
    e => {
      e.preventDefault();
      const rect = pane.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const k2 = Math.min(2.5, Math.max(0.15, view.k * (e.deltaY < 0 ? 1.12 : 0.89)));
      view.x = cx - ((cx - view.x) / view.k) * k2;
      view.y = cy - ((cy - view.y) / view.k) * k2;
      view.k = k2;
      applyView();
    },
    { passive: false }
  );
  qs('#zoom-in').addEventListener('click', () => zoomBy(1.25));
  qs('#zoom-out').addEventListener('click', () => zoomBy(0.8));
  qs('#zoom-fit').addEventListener('click', fitGraph);
}
function zoomBy(f) {
  const pane = qs('#graph-pane');
  const cx = pane.clientWidth / 2;
  const cy = pane.clientHeight / 2;
  const k2 = Math.min(2.5, Math.max(0.15, view.k * f));
  view.x = cx - ((cx - view.x) / view.k) * k2;
  view.y = cy - ((cy - view.y) / view.k) * k2;
  view.k = k2;
  applyView();
}

const STATUS_TEXT = {
  pending: 'pending',
  running: 'running',
  awaiting: 'awaiting input',
  completed: 'completed',
  failed: 'failed',
  skipped: 'skipped',
};

function paintGraphNode(id) {
  const card = qs('.gnode[data-node="' + id + '"]');
  if (!card) return;
  const ns = state.nodeStatus[id] || { status: 'pending' };
  card.classList.remove('status-pending', 'status-running', 'status-awaiting', 'status-completed', 'status-failed', 'status-skipped');
  card.classList.add('status-' + ns.status);
  const d = nodeDef(id);
  const rs = runsOf(id);
  let text = STATUS_TEXT[ns.status];
  if (d.kind === 'loop' && rs.length > 0) {
    const last = rs[rs.length - 1];
    text =
      ns.status === 'running'
        ? 'iteration ' + last.iter + ' · max ' + d.maxIter
        : text + ' · ' + rs.length + ' iteration' + (rs.length > 1 ? 's' : '');
  } else if (rs.length > 1 && ns.status !== 'running') {
    text += ' · ran ' + rs.length + '×';
  }
  qs('.gn-status', card).textContent = text;
  qs('.gn-iter', card).textContent = d.kind === 'loop' && ns.status === 'running' ? '↻ ' + rs[rs.length - 1].iter : '';
  paintEdges();
}

function paintGraphSelection() {
  qsa('.gnode').forEach(c => c.classList.toggle('selected', state.panelOpen && c.dataset.node === state.selected));
}

// ---------- run lifecycle ----------
function startRun(nodeId, opts = {}) {
  const d = nodeDef(nodeId);
  const rs = runsOf(nodeId);
  const r = {
    hid: ++state.hidSeq,
    nodeId,
    seq: rs.length + 1,
    iter: d.kind === 'loop' ? rs.length + 1 : 0,
    passDetail: opts.passDetail || null,
    status: 'running',
    startMs: Date.now(),
    durMs: null,
    items: [],
  };
  state.runs.push(r);
  const ns = state.nodeStatus[nodeId] || (state.nodeStatus[nodeId] = { status: 'pending' });
  ns.status = 'running';
  renderLogsRow(r);
  paintGraphNode(nodeId);
  return r;
}

function setRunStatus(r, status) {
  r.status = status;
  if (status === 'completed' || status === 'failed') r.durMs = Date.now() - r.startMs;
  const ns = state.nodeStatus[r.nodeId];
  if (ns) ns.status = status;
  paintLogsRow(r);
  paintGraphNode(r.nodeId);
  syncAwaitingBanner();
  if (state.panelOpen && state.selected === r.nodeId) renderPanel();
}

function addItem(r, item) {
  r.items.push(item);
  if (state.panelOpen && state.selected === r.nodeId && state.panelRun[r.nodeId] === r.hid) {
    const body = qs('#panel-body');
    if (body) {
      const empty = qs('.panel-empty', body);
      if (empty) empty.remove();
      body.appendChild(renderItem(r, item));
      body.scrollTop = body.scrollHeight;
    }
  }
}

// ---------- logs tab (one row per RUN) ----------
function renderLogsRow(r) {
  const list = qs('#logs-list');
  const empty = qs('.logs-empty', list);
  if (empty) empty.remove();
  const d = nodeDef(r.nodeId);
  const row = el('button', 'logrun status-' + r.status);
  row.id = 'logrun-' + r.hid;
  row.type = 'button';
  row.title = 'Open this run in the side panel';

  const icon = el('span', 'lr-icon', '●');
  const name = el('span', 'lr-name', r.nodeId);
  if (r.iter) name.appendChild(el('span', 'lr-iter', '×' + r.iter));
  if (r.seq > 1 && !r.iter) name.appendChild(el('span', 'lr-iter lr-rerun', '#' + r.seq));
  const type = el('span', 'type-pill type-' + d.kind, kindLabel(d));
  const status = el('span', 'lr-status', STATUS_TEXT[r.status]);
  const dur = el('span', 'lr-dur mono', '');
  const start = el('span', 'lr-start mono', fmtClock(Math.floor((r.startMs - state.t0) / 1000)));

  row.append(icon, name, type, status, dur, start);
  row.addEventListener('click', () => openPanel(r.nodeId, r.hid));
  list.appendChild(row);
}

function paintLogsRow(r) {
  const row = qs('#logrun-' + r.hid);
  if (!row) return;
  row.classList.remove('status-pending', 'status-running', 'status-awaiting', 'status-completed', 'status-failed', 'status-skipped');
  row.classList.add('status-' + r.status);
  let text = STATUS_TEXT[r.status];
  if (r.status === 'awaiting' && ASKS[r.nodeId]) {
    const qn = ASKS[r.nodeId].questions.length;
    text += ' — AskHuman — ' + qn + ' question' + (qn > 1 ? 's' : '');
  }
  if (r.status === 'awaiting' && GATES[r.nodeId]) text += ' — live review';
  if (r.status === 'completed' && state.answers[r.nodeId]) text += ' — answer delivered';
  if (r.status === 'completed' && state.gateDecisions[r.nodeId]) text += ' — ' + state.gateDecisions[r.nodeId];
  qs('.lr-status', row).textContent = text;
  qs('.lr-dur', row).textContent = r.durMs ? fmtDur(r.durMs) : '';
}

// ---------- shared node panel ----------
function openPanel(nodeId, hid) {
  state.selected = nodeId;
  if (hid == null) {
    const latest = latestRun(nodeId);
    hid = latest ? latest.hid : null;
  }
  state.panelRun[nodeId] = hid;
  state.panelOpen = true;
  syncPanelLayout();
  renderPanel();
  paintGraphSelection();
}

function closePanel() {
  state.panelOpen = false;
  state.selected = null;
  syncPanelLayout();
  paintGraphSelection();
}

function syncPanelLayout() {
  qs('#node-panel').classList.toggle('closed', !state.panelOpen);
  qs('#split-handle').classList.toggle('hidden', !state.panelOpen);
}

function renderPanel() {
  const id = state.selected;
  const d = nodeDef(id);
  const r = runByHid(state.panelRun[id]);
  const rs = runsOf(id);

  const head = qs('#panel-header');
  head.innerHTML = '';
  const row = el('div', 'ph-row');
  row.appendChild(el('span', 'type-pill type-' + d.kind, kindLabel(d)));
  const name = el('span', 'ph-name', id);
  if (d.kind === 'loop' && r && r.iter) name.appendChild(el('span', 'ph-iter', '×' + r.iter));
  row.appendChild(name);
  const st = r ? r.status : 'pending';
  row.appendChild(el('span', 'node-badge nb-' + st, STATUS_TEXT[st]));
  const close = el('button', 'panel-close', '✕');
  close.type = 'button';
  close.title = 'Close panel';
  close.addEventListener('click', closePanel);
  row.appendChild(close);
  head.appendChild(row);

  const meta = el('div', 'ph-meta');
  if (r) {
    let m = 'started ' + fmtClock(Math.floor((r.startMs - state.t0) / 1000)) + (r.durMs ? ' · ' + fmtDur(r.durMs) : ' · running…');
    if (r.passDetail) m += ' · ' + r.passDetail;
    meta.textContent = m;
  } else {
    meta.textContent = 'not started yet';
  }
  head.appendChild(meta);

  // one chip per RUN of this node — never a merged view
  if (rs.length > 1) {
    const chips = el('div', 'iter-chips');
    chips.appendChild(el('span', 'ic-label', d.kind === 'loop' ? 'iterations' : 'runs'));
    for (const run of rs) {
      const viewing = run.hid === state.panelRun[id];
      const label = d.kind === 'loop' ? String(run.iter) : String(run.seq);
      const c = el('button', 'iter-chip' + (viewing ? ' viewing' : ''), label);
      c.type = 'button';
      c.disabled = viewing;
      c.title = 'started ' + fmtClock(Math.floor((run.startMs - state.t0) / 1000)) + (run.passDetail ? ' · ' + run.passDetail : '');
      c.addEventListener('click', () => {
        state.panelRun[id] = run.hid;
        renderPanel();
      });
      chips.appendChild(c);
    }
    head.appendChild(chips);
  }

  const body = qs('#panel-body');
  body.innerHTML = '';
  if (!r) {
    body.appendChild(el('div', 'panel-empty', 'Node has not started yet.'));
    return;
  }
  if (r.items.length === 0 && r.status !== 'awaiting') {
    body.appendChild(el('div', 'panel-empty', 'No output yet…'));
  }
  for (const item of r.items) body.appendChild(renderItem(r, item));

  if (r.status === 'awaiting' && ASKS[id]) body.appendChild(askSummary(id));
  if (r.status === 'awaiting' && GATES[id]) body.appendChild(gateSummary(id));
}

// ---------- panel item renderers ----------
function renderItem(r, item) {
  switch (item.kind) {
    case 'msg': {
      const w = el('div', 'pmsg');
      w.appendChild(el('div', 'pmsg-role', item.role));
      const t = el('div', 'pmsg-text');
      t.innerHTML = md(item.text);
      w.appendChild(t);
      return w;
    }
    case 'tool': {
      const w = el('div', 'ptool');
      const head = el('div', 'ptool-head');
      head.appendChild(el('span', 'ptool-name mono', item.name));
      head.appendChild(el('span', 'ptool-sum', item.summary || ''));
      w.appendChild(head);
      if (item.input) w.appendChild(ioBlock('input', item.input));
      if (item.output) w.appendChild(ioBlock('output', item.output));
      return w;
    }
    case 'bash': {
      const w = el('div', 'pbash');
      w.appendChild(el('div', 'pbash-cmd mono', '$ ' + item.cmd));
      const out = el('div', 'pbash-out mono');
      out.innerHTML = md(item.out.join('\n'));
      w.appendChild(out);
      return w;
    }
    case 'sys':
      return el('div', 'psys', item.text);
    case 'answer': {
      const w = el('div', 'panswer');
      w.appendChild(el('div', 'panswer-title', 'Answer delivered'));
      const t = el('div', 'panswer-text');
      t.innerHTML = md(item.text);
      w.appendChild(t);
      return w;
    }
    case 'route': {
      const w = el('div', 'proute proute-' + item.route);
      w.appendChild(el('div', 'proute-title', 'Route decision — ' + item.route));
      const t = el('div', 'proute-text');
      t.innerHTML = md(item.text);
      w.appendChild(t);
      return w;
    }
    default:
      return el('div', 'psys', JSON.stringify(item));
  }
}

function ioBlock(label, text) {
  const w = el('div', 'ptool-io');
  w.appendChild(el('div', 'ptool-io-label', label));
  const pre = el('pre', 'mono');
  pre.textContent = text;
  w.appendChild(pre);
  return w;
}

function askSummary(id) {
  const spec = ASKS[id];
  const w = el('div', 'pask');
  w.appendChild(el('div', 'pask-title', 'Awaiting input — AskHuman (' + spec.requestId + ')'));
  for (const [i, q] of spec.questions.entries()) {
    const qw = el('div', 'pask-q');
    qw.appendChild(el('span', 'ask-q-num', 'Q' + (i + 1)));
    const qt = el('span', 'pask-q-text');
    qt.innerHTML = md(q.text);
    qw.appendChild(qt);
    w.appendChild(qw);
  }
  const go = el('button', 'btn btn-primary ask-goto', 'Answer in Chat tab →');
  go.type = 'button';
  go.addEventListener('click', () => {
    switchTab('chat');
    const card = qs('#ask-' + id);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  w.appendChild(go);
  return w;
}

function gateSummary(id) {
  const g = GATES[id];
  const w = el('div', 'pask pgate');
  w.appendChild(el('div', 'pask-title', 'Awaiting decision — plannotator_gate'));
  const t = el('div', 'pask-q-text');
  t.innerHTML = md('**' + g.title + '**\nDoc: `' + g.doc + '`');
  w.appendChild(t);
  const go = el('button', 'btn btn-primary ask-goto', 'Review in Chat tab →');
  go.type = 'button';
  go.addEventListener('click', () => {
    switchTab('chat');
    const card = qs('#gate-' + id);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  w.appendChild(go);
  return w;
}

// ---------- chat tab ----------
function addChat(entry) {
  const stream = qs('#chat-stream');
  const empty = qs('.chat-empty', stream);
  if (empty) empty.remove();
  let node;
  if (entry.kind === 'user') {
    node = el('div', 'cmsg cuser');
    node.appendChild(el('div', 'cmsg-who', entry.who));
    const t = el('div', 'cmsg-text');
    t.innerHTML = md(entry.text);
    node.appendChild(t);
  } else if (entry.kind === 'sys') {
    node = el('div', 'cmsg csys', entry.text);
  } else if (entry.kind === 'node') {
    node = el('div', 'cmsg cnode');
    const chip = el('button', 'cn-chip mono', runLabel(entry.run));
    chip.type = 'button';
    chip.title = 'Open this run in the side panel';
    chip.addEventListener('click', () => openPanel(entry.run.nodeId, entry.run.hid));
    node.appendChild(chip);
    const t = el('span', 'cnode-text');
    t.innerHTML = ' ' + md(entry.text);
    node.appendChild(t);
  } else if (entry.kind === 'card') {
    node = askCard(entry.nodeId);
  } else if (entry.kind === 'gate') {
    node = gateCard(entry.nodeId);
  }
  stream.appendChild(node);
  stream.scrollTop = stream.scrollHeight;
}

function chatNodeEntry(r, text) {
  addChat({ kind: 'node', run: r, text });
}

// ---------- ask card (interactive, lives in chat) ----------
function askCard(nodeId) {
  const spec = ASKS[nodeId];
  const ans = state.answers[nodeId];
  const card = el('div', 'ask-card' + (ans ? ' answered' : ''));
  card.id = 'ask-' + nodeId;

  const head = el('div', 'ask-head');
  head.appendChild(el('span', 'ask-title', ans ? 'Ask — answered' : 'Agent is asking'));
  head.appendChild(el('span', 'ask-reqid mono', spec.requestId));
  const chip = el('button', 'cn-chip mono', nodeId);
  chip.type = 'button';
  chip.addEventListener('click', () => openPanel(nodeId));
  head.appendChild(chip);
  card.appendChild(head);

  if (ans) {
    const done = el('div', 'ask-answered-summary');
    for (const line of ans.lines) {
      const l = el('div', 'ask-answered-line');
      l.innerHTML = md(line);
      done.appendChild(l);
    }
    card.appendChild(done);
    return card;
  }

  for (const [qi, q] of spec.questions.entries()) {
    const qw = el('div', 'ask-q');
    const qt = el('div', 'ask-q-text');
    qt.appendChild(el('span', 'ask-q-num', 'Q' + (qi + 1)));
    const span = el('span', '');
    span.innerHTML = ' ' + md(q.text);
    qt.appendChild(span);
    qw.appendChild(qt);
    const opts = el('div', 'ask-opts');
    for (const opt of q.options) {
      const label = el('label', 'ask-opt');
        const input = document.createElement('input');
      input.type = q.kind === 'single' ? 'radio' : 'checkbox';
      input.name = 'ask-' + nodeId + '-' + q.id;
      input.value = opt;
      label.appendChild(input);
      label.appendChild(el('span', '', opt));
      opts.appendChild(label);
    }
    qw.appendChild(opts);
    card.appendChild(qw);
  }

  const foot = el('div', 'ask-foot');
  const submit = el('button', 'btn btn-primary ask-submit', 'Submit answer');
  submit.type = 'button';
  foot.appendChild(submit);
  foot.appendChild(el('span', 'ask-hint', 'delivered as a tool result'));
  card.appendChild(foot);

  if (state.view === 'teammate') {
    submit.disabled = true;
    foot.appendChild(el('span', 'ask-note', 'Only the starter (dale) can answer'));
  }

  submit.addEventListener('click', () => {
    const lines = [];
    for (const q of spec.questions) {
      const name = 'ask-' + nodeId + '-' + q.id;
      const picked =
        q.kind === 'single'
          ? [qs('input[name="' + name + '"]:checked', card)?.value].filter(Boolean)
          : qsa('input[name="' + name + '"]:checked', card).map(i => i.value);
      if (picked.length === 0) {
        card.classList.add('ask-invalid');
        setTimeout(() => card.classList.remove('ask-invalid'), 600);
      return;
    }
      lines.push('**' + q.text + '** → ' + picked.join(', '));
    }
    state.answers[nodeId] = { lines };
    card.replaceWith(askCard(nodeId));
    const r = latestRun(nodeId);
    if (r) {
      addItem(r, { kind: 'answer', text: lines.map(l => l.replace(/\*\*/g, '')).join('\n') });
      setRunStatus(r, 'completed');
      chatNodeEntry(r, 'completed — answer delivered');
    }
    syncAwaitingBanner();
    continueAfterClarify();
  });

  if (AUTO) {
    at(2600, () => {
      if (!card.isConnected || state.answers[nodeId]) return;
      const radioNames = new Set([...card.querySelectorAll('input[type=radio]')].map(r => r.name));
      for (const name of radioNames) card.querySelector('input[type=radio][name="' + name + '"]')?.click();
      const cbs = [...card.querySelectorAll('input[type=checkbox]')];
      if (cbs.length) cbs[0].click();
      submit.click();
    });
  }
  return card;
}

// ---------- gate card (plannotator_gate, lives in chat) ----------
function gateCard(nodeId) {
  const g = GATES[nodeId];
  const decision = state.gateDecisions[nodeId];
  const card = el('div', 'approval-card' + (decision ? ' decided' : ''));
  card.id = 'gate-' + nodeId;

  const head = el('div', 'ask-head');
  head.appendChild(el('span', 'ask-title', decision ? 'Gate — ' + decision : 'Live review ready'));
  const chip = el('button', 'cn-chip mono', nodeId);
  chip.type = 'button';
  chip.addEventListener('click', () => openPanel(nodeId));
  head.appendChild(chip);
  card.appendChild(head);

  const body = el('div', 'ap-body');
  body.innerHTML = md('**' + g.title + '**\n' + g.note);
  card.appendChild(body);

  const urlRow = el('div', 'ap-meta mono');
  urlRow.textContent = 'review URL: ' + g.url;
  card.appendChild(urlRow);
  const docRow = el('div', 'ap-meta mono');
  docRow.textContent = 'doc: ' + g.doc;
  card.appendChild(docRow);

  if (decision) return card;

  const comment = document.createElement('input');
  comment.type = 'text';
  comment.className = 'ap-comment';
  comment.placeholder = 'Annotations / comment (optional)…';
  card.appendChild(comment);

  const foot = el('div', 'ask-foot');
  const approve = el('button', 'btn btn-primary', 'Approve');
  const annotate = el('button', 'btn', 'Send annotations');
  approve.type = annotate.type = 'button';
  foot.append(approve, annotate);
  card.appendChild(foot);

  if (state.view === 'teammate') {
    approve.disabled = annotate.disabled = true;
    foot.appendChild(el('span', 'ask-note', 'Owner only — teammates may close without ending the session'));
  }

  approve.addEventListener('click', () => {
    state.gateDecisions[nodeId] = 'approved';
    const r = latestRun(nodeId);
    addItem(r, { kind: 'answer', text: 'Approved' + (comment.value ? ' — “' + comment.value + '”' : '') });
    setRunStatus(r, 'completed');
    chatNodeEntry(r, 'approved' + (comment.value ? ' — “' + comment.value + '”' : ''));
    card.replaceWith(gateCard(nodeId));
    continueAfterGate(nodeId);
  });
  annotate.addEventListener('click', () => {
    state.gateDecisions[nodeId] = 'annotations sent';
    const r = latestRun(nodeId);
    addItem(r, { kind: 'answer', text: 'Annotations sent — rework applied' + (comment.value ? ': “' + comment.value + '”' : '') });
    setRunStatus(r, 'completed');
    chatNodeEntry(r, 'annotations sent — rework applied');
    card.replaceWith(gateCard(nodeId));
    continueAfterGate(nodeId);
  });

  if (AUTO) {
    at(3200, () => {
      if (!card.isConnected || state.gateDecisions[nodeId]) return;
      approve.click();
    });
  }
  return card;
}

// ---------- awaiting banner ----------
function syncAwaitingBanner() {
  const awaiting = state.runs.filter(r => r.status === 'awaiting');
  const banner = qs('#awaiting-banner');
  banner.classList.toggle('hidden', awaiting.length === 0);
  qs('#awaiting-count').textContent = String(awaiting.length);
  const chips = qs('#awaiting-chips');
  chips.innerHTML = '';
  for (const r of awaiting) {
    const c = el('button', 'ab-chip mono', runLabel(r));
    c.type = 'button';
    c.addEventListener('click', () => {
      switchTab('chat');
      const card = qs('#ask-' + r.nodeId) || qs('#gate-' + r.nodeId);
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    chips.appendChild(c);
  }
}

// ---------- simulation: walks the real speckit-ralph-native-feature shape ----------
function quick(r, items, doneNote) {
  items.forEach((item, k) => at(250 + k * 320, () => addItem(r, item)));
  at(250 + items.length * 320 + 150, () => {
    setRunStatus(r, 'completed');
    if (doneNote) chatNodeEntry(r, doneNote);
  });
}

function simulate() {
  addChat({ kind: 'user', who: 'dale', text: 'speckit ralph native — https://github.com/oceanlabs-holding/x10.gigo.harness-service/issues/123' });

  at(300, () => {
    const r = startRun('setup');
    quick(r, [{ kind: 'bash', cmd: 'setup', out: ['FEATURE_SLUG=attach-first-writer', 'HEAD=5139f867', 'Starting Step 1 of 7: Generating feature specification...'] }]);
  });

  at(1200, () => {
    const r = startRun('specify');
    addItem(r, { kind: 'msg', role: 'assistant', text: 'Reading the issue + origin context, spawning sub-agents for the harness contract.' });
    at(500, () => addItem(r, { kind: 'tool', name: 'Read', summary: 'harness API contract', output: 'docs/harness-api.md — 214 lines' }));
    at(900, () => addItem(r, { kind: 'tool', name: 'Write', summary: 'specs/014-attach-first-writer/spec.md', output: 'spec written (FR-001…FR-014)' }));
    at(1500, () => setRunStatus(r, 'completed'));
  });

  at(2900, () => {
    const r = startRun('clarify');
    addItem(r, { kind: 'msg', role: 'assistant', text: 'Spec drafted. Two things need your call before I lock the clarification file.' });
    at(800, () => {
      setRunStatus(r, 'awaiting');
      chatNodeEntry(r, 'is awaiting input — AskHuman — 2 questions');
      addChat({ kind: 'card', nodeId: 'clarify' });
    });
  });
}

function continueAfterClarify() {
  at(400, () => {
    const r = startRun('clarify-file-check');
    quick(r, [{ kind: 'bash', cmd: 'clarify-file-check', out: ['HAS_QUESTIONS'] }]);
  });
  at(1400, () => {
    const r = startRun('clarify-respond');
    quick(r, [
      { kind: 'msg', role: 'assistant', text: 'Drafting answers — KISS/YAGNI stance, skipping non-problems.' },
      { kind: 'tool', name: 'Edit', summary: 'clarification-questions.md', output: '3 answers drafted' },
    ]);
  });
  at(3000, () => {
    const r = startRun('clarify-gate');
    addItem(r, { kind: 'tool', name: 'Write', summary: 'visual/speckit-clarify-explainer.html', output: 'explainer written (18 KB)' });
    at(600, () => {
      setRunStatus(r, 'awaiting');
      chatNodeEntry(r, 'is awaiting decision — live Plannotator review');
      addChat({ kind: 'gate', nodeId: 'clarify-gate' });
    });
  });
}

function continueAfterGate(gateId) {
  if (gateId === 'clarify-gate') {
    at(400, () => {
      const r = startRun('clarify-apply');
      quick(r, [{ kind: 'bash', cmd: '$speckit-clarifybatch --apply', out: ['3 answers applied to spec.md'] }]);
    });
    at(1400, () => {
      const r = startRun('red-team');
      addItem(r, { kind: 'msg', role: 'assistant', text: 'Adversarial pass over the spec — probing FR-003 writer-attach ordering.' });
      at(500, () => addItem(r, { kind: 'tool', name: 'Write', summary: 'red-team-findings-2026-09-05-01.md', output: '5 findings (2 spec-fix, 1 new-OQ)' }));
      at(1100, () => setRunStatus(r, 'completed'));
    });
    at(3000, () => {
      const r = startRun('red-team-respond');
      quick(r, [
        { kind: 'msg', role: 'assistant', text: 'Verifying each finding against the spec before proposing resolutions.' },
        { kind: 'tool', name: 'Edit', summary: 'findings Status column', output: '5/5 resolved' },
      ]);
    });
    at(4600, () => {
      const r = startRun('red-team-gate');
      addItem(r, { kind: 'tool', name: 'Write', summary: 'visual/speckit-red-team-explainer.html', output: 'explainer written (22 KB)' });
      at(600, () => {
        setRunStatus(r, 'awaiting');
        chatNodeEntry(r, 'is awaiting decision — live Plannotator review');
        addChat({ kind: 'gate', nodeId: 'red-team-gate' });
      });
    });
    return;
  }

  if (gateId === 'red-team-gate') {
    const chain = [
      ['red-team-apply', [{ kind: 'bash', cmd: '/speckit.red-team.apply --allow-historical-edits', out: ['2 spec-fixes applied, 1 OQ appended'] }]],
      ['plan', [
        { kind: 'msg', role: 'assistant', text: 'Writing plan.md — phases, contracts, test strategy.' },
        { kind: 'tool', name: 'Write', summary: 'plan.md', output: 'plan written' },
      ]],
      ['tasks', [{ kind: 'tool', name: 'Write', summary: 'tasks.md', output: '23 tasks across 4 stories' }]],
      ['analyze', [
        { kind: 'msg', role: 'assistant', text: 'Cross-checking spec ↔ plan ↔ tasks consistency.' },
        { kind: 'tool', name: 'Write', summary: 'analyze-findings-2026-09-05-01.md', output: '2 findings' },
      ]],
      ['analyze-respond', [{ kind: 'tool', name: 'Edit', summary: 'findings resolutions', output: '2/2 resolved (1 spec-fix, 1 skipped)' }]],
      ['analyze-apply', [{ kind: 'bash', cmd: '$speckit-analyzebatch --apply', out: ['1 spec-fix applied'] }]],
    ];
    let t = 400;
    for (const [id, items] of chain) {
      at(t, () => quick(startRun(id), items));
      t += 1100;
    }
    at(t, () => startRalphPass(1));
    return;
  }

  if (gateId === 'speckit-converge-review-gate') {
    chatSys('Retry loop — re-running Ralph with the reviewed tasks');
    at(400, () => startRalphPass(2));
  }
}

function startRalphPass(pass) {
  const detail = pass === 1 ? 'pass 1' : 'pass 2 — after reviewed tasks';
  at(0, () => {
    const r = startRun('ralph-tasks-to-ralph', { passDetail: detail });
    quick(r, [{ kind: 'bash', cmd: 'tasks-to-prd.sh', out: ['ralph-prd.json written — ' + (pass === 1 ? '3' : '4') + ' user stories'] }]);
  });
  at(900, () => {
    const r = startRun('ralph-native-preflight', { passDetail: detail });
    quick(r, [{ kind: 'bash', cmd: 'preflight', out: ['PRD valid — stories: ' + (pass === 1 ? 3 : 4)] }]);
  });
  at(1800, () => runRalphIterations(pass, pass === 1 ? 3 : 2));
}

function runRalphIterations(pass, count) {
  const detail = pass === 1 ? 'pass 1' : 'pass 2 — after reviewed tasks';
  const stories = pass === 1 ? ['US-1 attach endpoint', 'US-2 writer ordering', 'US-3 regression tests'] : ['US-4 converge-added tasks', 'final green pass'];
  let i = 0;
  const next = () => {
    const r = startRun('ralph-loop-run', { passDetail: detail });
    chatNodeEntry(r, 'started — ' + stories[i]);
    addItem(r, { kind: 'sys', text: 'until_bash: all userStories completed && all tasks pass' });
    at(400, () => addItem(r, { kind: 'msg', role: 'assistant', text: 'Implementing **' + stories[i] + '**.' }));
    at(800, () => addItem(r, { kind: 'tool', name: 'Edit', summary: 'src/writer/attach.ts', output: (pass === 1 ? 18 + i * 9 : 11) + ' insertions' }));
    at(1200, () =>
      addItem(r, {
        kind: 'bash',
        cmd: 'bun run test:ralph',
        out: i + 1 < count || pass === 2 ? ['story tasks passing', 'exit 0'] : ['2 tasks still failing', 'exit 1'],
      })
    );
    at(1700, () => {
      setRunStatus(r, 'completed');
      chatNodeEntry(r, 'completed — ' + stories[i]);
      i += 1;
      if (i < count) at(500, next);
      else at(500, () => afterRalphLoop(pass));
    });
  };
  next();
}

function afterRalphLoop(pass) {
  const detail = pass === 1 ? 'pass 1' : 'pass 2';
  const r = startRun('ralph-sync-back', { passDetail: detail });
  quick(r, [{ kind: 'tool', name: 'Edit', summary: 'tasks.md checkboxes', output: 'progress synced' }]);
  at(1100, () => {
    const c = startRun('speckit-converge', { passDetail: detail });
    addItem(c, { kind: 'msg', role: 'assistant', text: 'Convergence check — scanning for gaps between spec and implementation.' });
    at(600, () => {
      if (pass === 1) {
        addItem(c, { kind: 'tool', name: 'Edit', summary: 'tasks.md', output: '+2 tasks (error-path coverage)' });
        setRunStatus(c, 'completed');
        chatNodeEntry(c, 'gate: **FAIL** — 2 tasks added');
        at(400, () => routeDecision('negative', "gate == 'FAIL' → review added tasks before retry", 1));
      } else {
        addItem(c, { kind: 'sys', text: 'no gaps found' });
        setRunStatus(c, 'completed');
        chatNodeEntry(c, 'gate: **PASS** — 0 tasks added');
        at(400, () => routeDecision('positive', "gate == 'PASS' → cargo-clean-before-pr", 2));
      }
    });
  });
}

function routeDecision(route, note, pass) {
  const r = startRun('speckit-converge-gate', { passDetail: 'decision ' + pass });
  addItem(r, { kind: 'sys', text: "condition: $speckit-converge.output.gate == 'PASS' · max_iterations 3 · decision " + pass + ' of 3' });
  at(400, () => {
    addItem(r, { kind: 'route', route, text: note });
    setRunStatus(r, 'completed');
    chatNodeEntry(r, 'route: **' + route + '** — ' + note);
    if (route === 'negative') {
      at(500, () => {
        const g = startRun('speckit-converge-review-gate');
        addItem(g, { kind: 'tool', name: 'Read', summary: 'tasks.md', output: 'handing tasks.md to live review' });
  at(600, () => {
          setRunStatus(g, 'awaiting');
          chatNodeEntry(g, 'is awaiting decision — review added tasks');
          addChat({ kind: 'gate', nodeId: 'speckit-converge-review-gate' });
        });
      });
    }
    if (route === 'positive') {
      at(500, () => {
        const r2 = startRun('cargo-clean-before-pr');
        quick(r2, [{ kind: 'bash', cmd: 'cargo clean', out: ['no Cargo.toml — skipped'] }]);
      });
      at(1500, () => {
        const r2 = startRun('update-bmad-sprint-status');
        quick(r2, [{ kind: 'tool', name: 'Edit', summary: 'sprint-status.yaml', output: 'story 014 → done' }]);
      });
      at(2600, () => {
        const r2 = startRun('create-pull-request');
        addItem(r2, { kind: 'msg', role: 'command', text: '/archon-create-pr' });
        at(500, () => addItem(r2, { kind: 'tool', name: 'Bash', summary: 'gh pr create', output: 'PR #129 opened — attach-first-writer' }));
        at(1100, () => {
          setRunStatus(r2, 'completed');
          chatNodeEntry(r2, 'opened PR #129');
          finishRun('completed');
    });
  });
}
  });
}

function chatSys(text) {
  addChat({ kind: 'sys', text });
}

function finishRun(status) {
  const badge = qs('#run-status');
  badge.classList.remove('status-running');
  badge.classList.add(status === 'completed' ? 'status-completed' : 'status-failed');
  qs('.sb-label', badge).textContent = status === 'completed' ? 'Completed' : 'Failed';
  addChat({
    kind: 'sys',
    text:
      status === 'completed'
        ? 'Run completed — ' + state.runs.length + ' node runs, 1 ask answered, 3 gates approved, 1 retry loop'
        : 'Run failed',
  });
}

// ---------- chrome: tabs, toggle, replay, composer, split ----------
function switchTab(name) {
  qsa('#tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  qsa('.tab-page').forEach(p => p.classList.add('hidden'));
  qs('#tab-' + name).classList.remove('hidden');
  if (name === 'graph' && LAYOUT) fitGraph();
}

function bindChrome() {
  qsa('#tabs .tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));

  qsa('#view-toggle .vt-btn').forEach(b =>
    b.addEventListener('click', () => {
      state.view = b.dataset.view;
      qsa('#view-toggle .vt-btn').forEach(x => x.classList.toggle('active', x === b));
      qsa('.ask-card').forEach(c => c.replaceWith(askCard(c.id.slice(4))));
      qsa('.approval-card').forEach(c => c.replaceWith(gateCard(c.id.slice(5))));
    })
  );

  qs('#btn-replay').addEventListener('click', replay);

  qs('#chat-composer').addEventListener('submit', e => {
    e.preventDefault();
    const input = qs('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    addChat({ kind: 'user', who: state.view === 'teammate' ? 'teammate' : 'dale', text });
    at(600, () => addChat({ kind: 'sys', text: "Message queued — the run's agent sees it on the next resume." }));
  });

  const handle = qs('#split-handle');
  const panel = qs('#node-panel');
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    const move = ev => {
      const w = Math.min(720, Math.max(320, window.innerWidth - ev.clientX));
      panel.style.width = w + 'px';
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}

function replay() {
  state.timers.forEach(clearTimeout);
  state.timers = [];
  state.t0 = Date.now();
  state.nodeStatus = {};
  state.runs = [];
  state.hidSeq = 0;
  state.selected = null;
  state.panelRun = {};
  state.panelOpen = false;
  state.answers = {};
  state.gateDecisions = {};
  state.convergePass = 0;

  qs('#logs-list').innerHTML = '<div class="logs-empty">No node runs yet — the run is starting…</div>';
  qs('#chat-stream').innerHTML = '';
  qs('#panel-header').innerHTML = '';
  qs('#panel-body').innerHTML = '';
  syncPanelLayout();

  const badge = qs('#run-status');
  badge.classList.remove('status-completed', 'status-failed');
  badge.classList.add('status-running');
  qs('.sb-label', badge).textContent = 'Running';

  buildGraph();
  fitGraph();
  syncAwaitingBanner();
  simulate();
}

// ---------- boot ----------
function boot() {
  bindChrome();
  bindViewport();
  qs('#logs-list').innerHTML = '<div class="logs-empty">No node runs yet — the run is starting…</div>';
  buildGraph();
  fitGraph();
  setInterval(() => {
    qs('#elapsed').textContent = fmtClock(elapsedSec());
  }, 1000);
  simulate();
}

boot();

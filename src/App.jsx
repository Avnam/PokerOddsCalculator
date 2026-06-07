import { useState, useEffect, useRef, useCallback } from "react";

// ═══════════════════════════════════════════
// POKER ENGINE (runs on main thread, chunked)
// ═══════════════════════════════════════════

const RANKS_STR = "23456789TJQKA";
const SUITS_STR = "cdhs";

function cardToInt(s) {
  return RANKS_STR.indexOf(s[0].toUpperCase()) * 4 + SUITS_STR.indexOf(s[1].toLowerCase());
}

// 5-card evaluator: returns int score, LOWER = BETTER
function eval5(c0, c1, c2, c3, c4) {
  const r0 = c0 >> 2, r1 = c1 >> 2, r2 = c2 >> 2, r3 = c3 >> 2, r4 = c4 >> 2;
  const isFlush = (c0 & 3) === (c1 & 3) && (c1 & 3) === (c2 & 3) && (c2 & 3) === (c3 & 3) && (c3 & 3) === (c4 & 3);
  let a = r0, b = r1, c = r2, d = r3, e = r4, t;
  if (a < b) { t = a; a = b; b = t } if (d < e) { t = d; d = e; e = t } if (a < c) { t = a; a = c; c = t }
  if (b < c) { t = b; b = c; c = t } if (a < d) { t = a; a = d; d = t } if (c < d) { t = c; c = d; d = t }
  if (b < d) { t = b; b = d; d = t } if (b < c) { t = b; b = c; c = t } if (d < e) { t = d; d = e; e = t }
  if (c < d) { t = c; c = d; d = t } if (d < e) { t = d; d = e; e = t }

  const counts = [0,0,0,0,0,0,0,0,0,0,0,0,0];
  counts[r0]++; counts[r1]++; counts[r2]++; counts[r3]++; counts[r4]++;

  let isStraight = false, straightHi = 0;
  let nUniq = 1;
  if (b !== a) nUniq++; if (c !== b) nUniq++; if (d !== c) nUniq++; if (e !== d) nUniq++;
  if (nUniq === 5) {
    if (a - e === 4) { isStraight = true; straightHi = a }
    else if (a === 12 && b === 3 && c === 2 && d === 1 && e === 0) { isStraight = true; straightHi = 3 }
  }

  const groups = [];
  for (let r = 12; r >= 0; r--) if (counts[r] > 0) groups.push(counts[r], r);
  const gl = groups.length;
  for (let i = 0; i < gl - 2; i += 2) {
    for (let j = i + 2; j < gl; j += 2) {
      if (groups[j] > groups[i] || (groups[j] === groups[i] && groups[j+1] > groups[i+1])) {
        t = groups[i]; groups[i] = groups[j]; groups[j] = t;
        t = groups[i+1]; groups[i+1] = groups[j+1]; groups[j+1] = t;
      }
    }
  }
  const gc0 = groups[0], gr0 = groups[1], gr1 = gl > 2 ? groups[3] : 0, gr2 = gl > 4 ? groups[5] : 0, gr3 = gl > 6 ? groups[7] : 0;

  if (isStraight && isFlush) return (12 - straightHi);
  if (gc0 === 4) return 1000000 + (12 - gr0) * 13 + (12 - gr1);
  if (gc0 === 3 && gl >= 4 && groups[2] === 2) return 2000000 + (12 - gr0) * 13 + (12 - gr1);
  if (isFlush) return 3000000 + (12-a)*28561 + (12-b)*2197 + (12-c)*169 + (12-d)*13 + (12-e);
  if (isStraight) return 4000000 + (12 - straightHi);
  if (gc0 === 3) return 5000000 + (12-gr0)*169 + (12-gr1)*13 + (12-gr2);
  if (gc0 === 2 && gl >= 4 && groups[2] === 2) {
    const hp = gr0 > gr1 ? gr0 : gr1, lp = gr0 > gr1 ? gr1 : gr0;
    return 6000000 + (12-hp)*169 + (12-lp)*13 + (12-gr2);
  }
  if (gc0 === 2) return 7000000 + (12-gr0)*2197 + (12-gr1)*169 + (12-gr2)*13 + (12-gr3);
  return 8000000 + (12-a)*28561 + (12-b)*2197 + (12-c)*169 + (12-d)*13 + (12-e);
}

// Combo generators
function combos2(arr) {
  const r = [], n = arr.length;
  for (let i = 0; i < n-1; i++) for (let j = i+1; j < n; j++) r.push([arr[i], arr[j]]);
  return r;
}
function combos3(arr) {
  const r = [], n = arr.length;
  for (let i = 0; i < n-2; i++) for (let j = i+1; j < n-1; j++) for (let k = j+1; k < n; k++) r.push([arr[i], arr[j], arr[k]]);
  return r;
}
function combos5(arr) {
  const r = [], n = arr.length;
  for (let i = 0; i < n-4; i++) for (let j = i+1; j < n-3; j++) for (let k = j+1; k < n-2; k++) for (let l = k+1; l < n-1; l++) for (let m = l+1; m < n; m++) r.push([arr[i], arr[j], arr[k], arr[l], arr[m]]);
  return r;
}

function comb(n, r) {
  if (r > n || r < 0) return 0;
  if (r === 0 || r === n) return 1;
  if (r > n - r) r = n - r;
  let v = 1;
  for (let i = 0; i < r; i++) v = v * (n - i) / (i + 1);
  return Math.round(v);
}

function evalBest5(cards) {
  const cs = combos5(cards);
  let best = Infinity;
  for (let i = 0; i < cs.length; i++) {
    const cc = cs[i];
    const s = eval5(cc[0], cc[1], cc[2], cc[3], cc[4]);
    if (s < best) best = s;
  }
  return best;
}

function evalOmahaHi(hole, board) {
  const h2s = combos2(hole), b3s = combos3(board);
  let best = Infinity;
  for (let i = 0; i < h2s.length; i++) {
    const h = h2s[i];
    for (let j = 0; j < b3s.length; j++) {
      const b = b3s[j];
      const s = eval5(h[0], h[1], b[0], b[1], b[2]);
      if (s < best) best = s;
    }
  }
  return best;
}

function evalLow5(c0, c1, c2, c3, c4) {
  const cards = [c0, c1, c2, c3, c4];
  let mask = 0;
  const vals = [];
  for (let i = 0; i < 5; i++) {
    const r = cards[i] >> 2;
    let v;
    if (r === 12) v = 1;
    else if (r <= 6) v = r + 2;
    else return -1;
    if (mask & (1 << v)) return -1;
    mask |= (1 << v);
    vals.push(v);
  }
  vals.sort((a, b) => a - b);
  return vals[4]*10000 + vals[3]*1000 + vals[2]*100 + vals[1]*10 + vals[0];
}

function evalOmahaLow(hole, board) {
  const h2s = combos2(hole), b3s = combos3(board);
  let best = -1;
  for (let i = 0; i < h2s.length; i++) {
    const h = h2s[i];
    for (let j = 0; j < b3s.length; j++) {
      const b = b3s[j];
      const s = evalLow5(h[0], h[1], b[0], b[1], b[2]);
      if (s > 0 && (best < 0 || s < best)) best = s;
    }
  }
  return best;
}

// Variant configs
const VCFG = {
  holdem: { hole: 2, board: 5, hiLo: false, twoLine: false, omaha: false },
  omaha4: { hole: 4, board: 5, hiLo: false, twoLine: false, omaha: true },
  omaha5: { hole: 5, board: 5, hiLo: false, twoLine: false, omaha: true },
  omaha4_hilo: { hole: 4, board: 5, hiLo: true, twoLine: false, omaha: true },
  omaha5_hilo: { hole: 5, board: 5, hiLo: true, twoLine: false, omaha: true },
  omaha4_2line: { hole: 4, board: 5, hiLo: false, twoLine: true, omaha: true },
};

function evalPlayerHi(cfg, hole, board) {
  return cfg.omaha ? evalOmahaHi(hole, board) : evalBest5(hole.concat(board));
}
function evalPlayerLo(cfg, hole, board) {
  if (!cfg.omaha) {
    const cs = combos5(hole.concat(board));
    let best = -1;
    for (let i = 0; i < cs.length; i++) {
      const cc = cs[i];
      const s = evalLow5(cc[0], cc[1], cc[2], cc[3], cc[4]);
      if (s > 0 && (best < 0 || s < best)) best = s;
    }
    return best;
  }
  return evalOmahaLow(hole, board);
}

function winners(scores, np) {
  let best = Infinity;
  for (let i = 0; i < np; i++) if (scores[i] < best) best = scores[i];
  const w = [];
  for (let i = 0; i < np; i++) if (scores[i] === best) w.push(i);
  return w;
}
function lowWinners(scores, np) {
  let best = -1;
  for (let i = 0; i < np; i++) { const s = scores[i]; if (s > 0 && (best < 0 || s < best)) best = s }
  if (best < 0) return [];
  const w = [];
  for (let i = 0; i < np; i++) if (scores[i] === best) w.push(i);
  return w;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.random() * (i + 1) | 0;
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
}

function getInfo(variant, players, board, board2, dead) {
  const cfg = VCFG[variant];
  const used = new Set();
  for (const p of players) for (const c of p) used.add(c);
  for (const c of board) used.add(c);
  for (const c of board2) used.add(c);
  for (const c of dead) used.add(c);
  const remaining = 52 - used.size;
  const boardNeeded = cfg.board - board.length;
  const board2Needed = cfg.twoLine ? cfg.board - board2.length : 0;
  let totalCombos;
  if (cfg.twoLine) {
    if (boardNeeded > 0 && board2Needed > 0) totalCombos = comb(remaining, boardNeeded) * comb(remaining - boardNeeded, board2Needed);
    else totalCombos = Math.max(comb(remaining, boardNeeded), comb(remaining, board2Needed));
  } else totalCombos = boardNeeded > 0 ? comb(remaining, boardNeeded) : 1;
  const speeds = { holdem: 150000, omaha4: 40000, omaha5: 15000, omaha4_hilo: 20000, omaha5_hilo: 8000, omaha4_2line: 20000 };
  const speed = Math.round((speeds[variant] || 20000) * (2 / Math.max(players.length, 2)));
  const estSec = totalCombos / speed;
  // Evals per sim per player
  const holeN = cfg.hole;
  let evalsPerPlayer, evalFormula;
  if (cfg.omaha) {
    // C(hole,2) * C(5,3) = hole combos * board combos
    const h2 = comb(holeN, 2), b3 = comb(5, 3);
    evalsPerPlayer = h2 * b3;
    evalFormula = { holeN, holeK: 2, boardN: 5, boardK: 3, h2, b3 };
  } else {
    // Hold'em: C(7,5) with full board, but changes with board size
    const totalCards = holeN + 5; // max cards available
    evalsPerPlayer = comb(totalCards, 5);
    evalFormula = { totalCards, chooseK: 5, result: evalsPerPlayer };
  }
  let evalMultiplier = cfg.hiLo ? 2 : cfg.twoLine ? 2 : 1;
  const totalEvalsPerSim = evalsPerPlayer * evalMultiplier * players.length;
  let strategy = "exact", recIter = null;
  if (totalCombos > 500000) { strategy = "monte_carlo"; recIter = Math.min(200000, totalCombos) }
  else if (totalCombos > 50000) strategy = "exact_slow";
  const totalEvals = totalCombos * totalEvalsPerSim;
  return { totalCombos, remaining, boardNeeded, board2Needed, speed, estSec: Math.round(estSec * 10) / 10, strategy, recIter, evalFormula, evalsPerPlayer, evalMultiplier, totalEvalsPerSim, totalEvals, np: players.length, isOmaha: cfg.omaha };
}

// Chunked async calculator — yields control every CHUNK_MS ms
const CHUNK_SIZE = 2000; // sims per chunk before yielding

function runCalculation(variant, players, board, board2, dead, maxIter, onProgress, onDone, cancelRef) {
  const cfg = VCFG[variant];
  const np = players.length;
  const used = new Set();
  for (const p of players) for (const c of p) used.add(c);
  for (const c of board) used.add(c);
  for (const c of board2) used.add(c);
  for (const c of dead) used.add(c);
  const deck = [];
  for (let i = 0; i < 52; i++) if (!used.has(i)) deck.push(i);

  const boardNeeded = cfg.board - board.length;
  const board2Needed = cfg.twoLine ? cfg.board - board2.length : 0;
  const totalCombos = cfg.twoLine
    ? (boardNeeded > 0 && board2Needed > 0 ? comb(deck.length, boardNeeded) * comb(deck.length - boardNeeded, board2Needed) : Math.max(comb(deck.length, boardNeeded), comb(deck.length, board2Needed)))
    : (boardNeeded > 0 ? comb(deck.length, boardNeeded) : 1);

  const useMC = maxIter != null && maxIter < totalCombos;
  const iters = useMC ? maxIter : totalCombos;

  // Accumulators
  let totalSims = 0;
  const z = () => new Float64Array(np);
  let winsA, tiesA, hiWins, hiTies, loWins, loTies, scoopsA, noLo = 0;
  let l1Wins, l1Ties, l2Wins, l2Ties;
  if (cfg.twoLine) { l1Wins = z(); l1Ties = z(); l2Wins = z(); l2Ties = z() }
  else if (cfg.hiLo) { hiWins = z(); hiTies = z(); loWins = z(); loTies = z(); scoopsA = z() }
  else { winsA = z(); tiesA = z() }

  const hiS = new Float64Array(np);
  const loS = new Float64Array(np);
  const hiS2 = new Float64Array(np);

  function processBoard(fullBoard, fullBoard2) {
    totalSims++;
    if (cfg.twoLine) {
      for (let i = 0; i < np; i++) { hiS[i] = evalPlayerHi(cfg, players[i], fullBoard); hiS2[i] = evalPlayerHi(cfg, players[i], fullBoard2) }
      const w1 = winners(hiS, np), w2 = winners(hiS2, np);
      if (w1.length === 1) l1Wins[w1[0]]++; else { const sh = 1/w1.length; for (const x of w1) l1Ties[x] += sh }
      if (w2.length === 1) l2Wins[w2[0]]++; else { const sh = 1/w2.length; for (const x of w2) l2Ties[x] += sh }
    } else if (cfg.hiLo) {
      for (let i = 0; i < np; i++) { hiS[i] = evalPlayerHi(cfg, players[i], fullBoard); loS[i] = evalPlayerLo(cfg, players[i], fullBoard) }
      const hw = winners(hiS, np), lw = lowWinners(loS, np);
      if (hw.length === 1) hiWins[hw[0]]++; else { const sh = 1/hw.length; for (const x of hw) hiTies[x] += sh }
      if (!lw.length) {
        noLo++;
        // No qualifying low — hi winner scoops entire pot
        if (hw.length === 1) scoopsA[hw[0]]++;
      } else {
        if (lw.length === 1) loWins[lw[0]]++; else { const sh = 1/lw.length; for (const x of lw) loTies[x] += sh }
        // Scoop = win both hi and lo
        const hs = new Set(hw), ls = new Set(lw);
        for (const x of hs) if (ls.has(x)) scoopsA[x]++;
      }
    } else {
      for (let i = 0; i < np; i++) hiS[i] = evalPlayerHi(cfg, players[i], fullBoard);
      const w = winners(hiS, np);
      if (w.length === 1) winsA[w[0]]++; else { const sh = 1/w.length; for (const x of w) tiesA[x] += sh }
    }
  }

  function buildResult() {
    const tot = totalSims;
    const r2 = v => Math.round(v * 100) / 100;
    const result = { totalSims: tot };
    if (cfg.twoLine) {
      result.type = "two_line"; result.players = [];
      for (let i = 0; i < np; i++) {
        const l1e = (l1Wins[i]+l1Ties[i])/tot*100, l2e = (l2Wins[i]+l2Ties[i])/tot*100;
        result.players.push({ player: i+1, line1_equity: r2(l1e), line2_equity: r2(l2e), total_equity: r2((l1e+l2e)/2) });
      }
    } else if (cfg.hiLo) {
      result.type = "hi_lo"; const loP = tot - noLo;
      result.no_lo_pct = r2(noLo/tot*100); result.players = [];
      for (let i = 0; i < np; i++) {
        const hiE = (hiWins[i]+hiTies[i])/tot*100;
        const loE = (loWins[i]+loTies[i])/tot*100;
        const hiPS = (hiWins[i]+hiTies[i])/tot;
        const loPS = (loWins[i]+loTies[i])/tot;
        const noLoF = noLo/tot, loF = loP/tot;
        const totE = (hiPS*(noLoF+loF*0.5)+loPS*0.5)*100;
        result.players.push({ player: i+1, hi_equity: r2(hiE), lo_equity: r2(loE), scoop_pct: r2(scoopsA[i]/tot*100), total_equity: r2(totE) });
      }
    } else {
      result.type = "standard"; result.players = [];
      for (let i = 0; i < np; i++) {
        const eq = (winsA[i]+tiesA[i])/tot*100;
        result.players.push({ player: i+1, equity: r2(eq), win: r2(winsA[i]/tot*100), tie: r2(tiesA[i]/tot*100) });
      }
    }
    return result;
  }

  // Board complete case
  if (boardNeeded === 0 && board2Needed === 0) {
    processBoard(board, board2);
    onDone(buildResult());
    return;
  }

  // Monte Carlo chunked
  if (useMC) {
    const d = deck.slice();
    let i = 0;
    const startTime = performance.now();
    function mcChunk() {
      if (cancelRef.current) return;
      const end = Math.min(i + CHUNK_SIZE, iters);
      while (i < end) {
        shuffle(d);
        if (cfg.twoLine) {
          processBoard(board.concat(d.slice(0, boardNeeded)), board2.concat(d.slice(boardNeeded, boardNeeded + board2Needed)));
        } else {
          processBoard(board.concat(d.slice(0, boardNeeded)), null);
        }
        i++;
      }
      const elapsed = (performance.now() - startTime) / 1000;
      onProgress({ done: totalSims, total: iters, elapsed: Math.round(elapsed*10)/10, rate: Math.round(totalSims / Math.max(elapsed, 0.001)) });
      if (i < iters) setTimeout(mcChunk, 0);
      else onDone(buildResult());
    }
    setTimeout(mcChunk, 0);
    return;
  }

  // Exact enumeration chunked
  // Build all combos as array first for simple chunking (only feasible if ≤500K)
  const startTime = performance.now();
  if (!cfg.twoLine) {
    // Generate combos lazily with index tracking
    const n = deck.length, r = boardNeeded;
    const idx = new Int32Array(r);
    for (let i = 0; i < r; i++) idx[i] = i;
    let done = false;

    function exactChunk() {
      if (cancelRef.current) return;
      let count = 0;
      while (!done && count < CHUNK_SIZE) {
        const fb = new Array(board.length + r);
        for (let i = 0; i < board.length; i++) fb[i] = board[i];
        for (let i = 0; i < r; i++) fb[board.length + i] = deck[idx[i]];
        processBoard(fb, null);
        count++;
        // advance combo
        let k = r - 1;
        while (k >= 0 && idx[k] === k + n - r) k--;
        if (k < 0) { done = true; break; }
        idx[k]++;
        for (let j = k + 1; j < r; j++) idx[j] = idx[j-1] + 1;
      }
      const elapsed = (performance.now() - startTime) / 1000;
      onProgress({ done: totalSims, total: totalCombos, elapsed: Math.round(elapsed*10)/10, rate: Math.round(totalSims / Math.max(elapsed, 0.001)) });
      if (!done) setTimeout(exactChunk, 0);
      else onDone(buildResult());
    }
    setTimeout(exactChunk, 0);
  } else {
    // 2-line exact — nested combos
    const n = deck.length, r1 = boardNeeded, r2n = board2Needed;
    const idx1 = new Int32Array(r1);
    for (let i = 0; i < r1; i++) idx1[i] = i;
    let done1 = false;
    let d2 = null, idx2 = null, done2 = true;

    function nextCombo(idx, r, n) {
      let k = r - 1;
      while (k >= 0 && idx[k] === k + n - r) k--;
      if (k < 0) return false;
      idx[k]++;
      for (let j = k + 1; j < r; j++) idx[j] = idx[j-1] + 1;
      return true;
    }

    function twoLineChunk() {
      if (cancelRef.current) return;
      let count = 0;
      while (count < CHUNK_SIZE) {
        if (done2) {
          if (done1) break;
          // Setup new c1
          const c1 = [];
          const c1s = new Set();
          for (let i = 0; i < r1; i++) { c1.push(deck[idx1[i]]); c1s.add(deck[idx1[i]]) }
          d2 = deck.filter(x => !c1s.has(x));
          idx2 = new Int32Array(r2n);
          for (let i = 0; i < r2n; i++) idx2[i] = i;
          done2 = false;
        }
        // Process current c2
        const b1 = new Array(board.length + r1);
        for (let i = 0; i < board.length; i++) b1[i] = board[i];
        for (let i = 0; i < r1; i++) b1[board.length + i] = deck[idx1[i]];
        const b2f = new Array(board2.length + r2n);
        for (let i = 0; i < board2.length; i++) b2f[i] = board2[i];
        for (let i = 0; i < r2n; i++) b2f[board2.length + i] = d2[idx2[i]];
        processBoard(b1, b2f);
        count++;
        // Advance c2
        if (!nextCombo(idx2, r2n, d2.length)) {
          done2 = true;
          if (!nextCombo(idx1, r1, n)) done1 = true;
        }
      }
      const elapsed = (performance.now() - startTime) / 1000;
      onProgress({ done: totalSims, total: totalCombos, elapsed: Math.round(elapsed*10)/10, rate: Math.round(totalSims / Math.max(elapsed, 0.001)) });
      if (!done1 || !done2) setTimeout(twoLineChunk, 0);
      else onDone(buildResult());
    }
    setTimeout(twoLineChunk, 0);
  }
}

// ═══════════════════════════════════════════
// UI CONSTANTS
// ═══════════════════════════════════════════
const VARIANTS = {
  holdem: { name: "Hold'em", short: "HE", hole: 2, board: 5, hiLo: false, twoLine: false },
  omaha4: { name: "Omaha 4", short: "O4", hole: 4, board: 5, hiLo: false, twoLine: false },
  omaha5: { name: "Omaha 5", short: "O5", hole: 5, board: 5, hiLo: false, twoLine: false },
  omaha4_hilo: { name: "O4 Hi/Lo", short: "O4HL", hole: 4, board: 5, hiLo: true, twoLine: false },
  omaha5_hilo: { name: "O5 Hi/Lo", short: "O5HL", hole: 5, board: 5, hiLo: true, twoLine: false },
  omaha4_2line: { name: "2-Line", short: "2L", hole: 4, board: 5, hiLo: false, twoLine: true },
};

const RANKS_DISPLAY = ["A","K","Q","J","T","9","8","7","6","5","4","3","2"];
const SUITS_DISPLAY = ["s","h","d","c"];
const SUIT_SYM = { s: "♠", h: "♥", d: "♦", c: "♣" };
const SUIT_CLR = { s: "#c8ccd4", h: "#ef4444", d: "#3b82f6", c: "#22c55e" };
const P_COLORS = ["#f59e0b","#6366f1","#ec4899","#14b8a6","#f97316","#8b5cf6","#06b6d4","#84cc16","#e11d48","#a855f7"];

// ═══════════════════════════════════════════
// COMPONENTS
// ═══════════════════════════════════════════
function MiniCard({ card, onRemove, ghost, onGhostClick, size = 40 }) {
  const h = Math.round(size * 1.4), fs = Math.round(size * 0.32), ss = Math.round(size * 0.34);
  if (ghost) return (
    <div onClick={onGhostClick} style={{
      width: size, height: h, borderRadius: 5, border: "1.5px dashed #3a3a5c",
      background: "#0f0f20", display: "flex", alignItems: "center", justifyContent: "center",
      cursor: "pointer", color: "#3a3a5c", fontSize: fs + 2, fontWeight: 700,
    }}>+</div>
  );
  const clr = SUIT_CLR[card[1]];
  return (
    <div onClick={onRemove} style={{
      width: size, height: h, borderRadius: 5, background: "#1a1a2e",
      border: "1px solid #2a2a4a", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", cursor: onRemove ? "pointer" : "default",
      boxShadow: "0 2px 6px #0004", userSelect: "none",
    }}>
      <span style={{ fontSize: fs, fontWeight: 800, color: clr, lineHeight: 1, fontFamily: "'Space Mono', monospace" }}>{card[0]}</span>
      <span style={{ fontSize: ss, color: clr, lineHeight: 1, marginTop: 1 }}>{SUIT_SYM[card[1]]}</span>
    </div>
  );
}

function CardPicker({ usedCards, onSelect, onDeselect, onClose, title, pickerCards }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000b", zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div style={{
        background: "#111125", borderRadius: "18px 18px 0 0", padding: "14px 8px 28px",
        width: "100%", maxWidth: 440, maxHeight: "70vh", overflowY: "auto", borderTop: "1px solid #2a2a4a",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", position: "relative", marginBottom: 10 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "#3a3a5c" }} />
          <button onClick={onClose} style={{
            position: "absolute", right: 4, top: -4, background: "none", border: "none",
            color: "#6a6a8a", fontSize: 20, cursor: "pointer", lineHeight: 1, padding: "4px 8px",
          }}>×</button>
        </div>
        <div style={{ textAlign: "center", color: "#6a6a8a", fontSize: 11, marginBottom: 10, fontFamily: "'Space Mono', monospace", letterSpacing: 1.5, textTransform: "uppercase" }}>{title}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {SUITS_DISPLAY.map(suit => (
            <div key={suit} style={{ display: "flex", gap: 3, justifyContent: "center" }}>
              {RANKS_DISPLAY.map(rank => {
                const card = rank + suit;
                const used = usedCards.has(card);
                const isCurrentPicker = pickerCards.has(card);
                return (
                  <div key={card} onClick={() => {
                    if (isCurrentPicker) onDeselect(card);
                    else if (!used) onSelect(card);
                  }} style={{
                    width: 30, height: 40, borderRadius: 4,
                    background: isCurrentPicker ? "#2a1a08" : used ? "#0a0a18" : "#1a1a2e",
                    border: isCurrentPicker ? "1.5px solid #f59e0b" : used ? "1px solid #1a1a2e" : "1px solid #2a2a4a",
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    cursor: (used && !isCurrentPicker) ? "default" : "pointer",
                    opacity: (used && !isCurrentPicker) ? 0.2 : 1,
                  }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: SUIT_CLR[suit], fontFamily: "'Space Mono', monospace", lineHeight: 1 }}>{rank}</span>
                    <span style={{ fontSize: 11, color: SUIT_CLR[suit], lineHeight: 1 }}>{SUIT_SYM[suit]}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EquityBar({ value, color, label, height = 20 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
      {label && <span style={{ fontSize: 9, color: "#5a5a7a", width: 24, textAlign: "right", fontFamily: "'Space Mono', monospace", fontWeight: 600 }}>{label}</span>}
      <div style={{ flex: 1, height, background: "#0a0a18", borderRadius: 3, overflow: "hidden", position: "relative" }}>
        <div style={{
          width: `${Math.max(value, 0.3)}%`, height: "100%",
          background: `linear-gradient(90deg, ${color}66, ${color})`,
          borderRadius: 3, transition: "width 0.5s cubic-bezier(.4,0,.2,1)",
          minWidth: value > 0 ? 2 : 0,
        }} />
        <span style={{
          position: "absolute", right: 5, top: "50%", transform: "translateY(-50%)",
          fontSize: 10, fontWeight: 700, color: "#e0e0f0", fontFamily: "'Space Mono', monospace", textShadow: "0 1px 4px #000",
        }}>{value.toFixed(1)}%</span>
      </div>
    </div>
  );
}

function Binom({ n, k }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", verticalAlign: "middle", margin: "0 2px",
      fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#c0c0d8",
    }}>
      <span style={{ fontSize: 20, fontWeight: 200, lineHeight: 1, color: "#5a5a7a" }}>(</span>
      <span style={{
        display: "inline-flex", flexDirection: "column", alignItems: "center",
        padding: "0 2px", lineHeight: 1.1,
      }}>
        <span style={{ fontWeight: 700 }}>{n}</span>
        <span style={{ fontWeight: 700 }}>{k}</span>
      </span>
      <span style={{ fontSize: 20, fontWeight: 200, lineHeight: 1, color: "#5a5a7a" }}>)</span>
    </span>
  );
}

function LegendDot({ color, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <div style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
      <span style={{ fontSize: 9, color: "#5a5a7a", fontFamily: "'Space Mono', monospace" }}>{label}</span>
    </div>
  );
}

// ═══════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════
export default function PokerCalc() {
  const [variant, setVariant] = useState("holdem");
  const [players, setPlayers] = useState([[], []]);
  const [board, setBoard] = useState([]);
  const [board2, setBoard2] = useState([]);
  const [deadCards, setDeadCards] = useState([]);
  const [results, setResults] = useState(null);
  const [calcStatus, setCalcStatus] = useState("idle");
  const [progress, setProgress] = useState(null);
  const [info, setInfo] = useState(null);
  const [picker, setPicker] = useState(null);
  const [history, setHistory] = useState([]);
  const cancelRef = useRef(false);
  const cfg = VARIANTS[variant];

  const usedCards = new Set();
  players.forEach(p => p.forEach(c => usedCards.add(c)));
  board.forEach(c => usedCards.add(c));
  board2.forEach(c => usedCards.add(c));
  deadCards.forEach(c => usedCards.add(c));

  useEffect(() => {
    setPlayers([[], []]); setBoard([]); setBoard2([]); setDeadCards([]);
    setResults(null); setInfo(null); setCalcStatus("idle"); setProgress(null);
  }, [variant]);

  const allFull = players.length >= 2 && players.every(p => p.length === cfg.hole);

  useEffect(() => {
    if (!allFull) { setInfo(null); return }
    const pInts = players.map(p => p.map(cardToInt));
    setInfo(getInfo(variant, pInts, board.map(cardToInt), board2.map(cardToInt), deadCards.map(cardToInt)));
  }, [players, board, board2, deadCards, variant, allFull]);

  const startCalc = (forceExact) => {
    if (!allFull) return;
    cancelRef.current = false;
    setCalcStatus("running"); setResults(null); setProgress(null);
    const maxIter = forceExact ? null : (info?.totalCombos > 50000 ? Math.min(200000, info.totalCombos) : null);
    runCalculation(
      variant,
      players.map(p => p.map(cardToInt)),
      board.map(cardToInt), board2.map(cardToInt), deadCards.map(cardToInt),
      maxIter,
      prog => setProgress(prog),
      res => {
        setResults(res); setCalcStatus("done");
        setHistory(h => {
          // Check if same setup already exists
          const key = variant + "|" + players.map(p => p.join(",")).join("|") + "|" + board.join(",") + "|" + board2.join(",");
          const filtered = h.filter(e => {
            const ek = e.variant + "|" + e.players.map(p => p.join(",")).join("|") + "|" + e.board.join(",") + "|" + e.board2.join(",");
            return ek !== key;
          });
          const entry = {
            id: Date.now(),
            variant,
            variantName: VARIANTS[variant].short,
            players: players.map(p => [...p]),
            board: [...board],
            board2: [...board2],
            results: res,
          };
          return [entry, ...filtered].slice(0, 10);
        });
      },
      cancelRef
    );
  };

  const cancelCalc = () => {
    cancelRef.current = true;
    setCalcStatus("cancelled");
  };

  const selectCard = card => {
    if (!picker) return;
    const { type, index } = picker;
    if (type === "player") {
      const cur = players[index];
      if (cur.length < cfg.hole) {
        const updated = [...cur, card];
        setPlayers(p => { const n = p.map(x => [...x]); n[index] = updated; return n });
        if (updated.length >= cfg.hole) setPicker(null);
      }
    } else if (type === "board") {
      if (board.length < cfg.board) {
        const updated = [...board, card];
        setBoard(updated);
        if (updated.length === 3 || updated.length === 4 || updated.length >= cfg.board) setPicker(null);
      }
    } else if (type === "board2") {
      if (board2.length < cfg.board) {
        const updated = [...board2, card];
        setBoard2(updated);
        if (updated.length === 3 || updated.length === 4 || updated.length >= cfg.board) setPicker(null);
      }
    } else if (type === "dead") {
      setDeadCards(d => [...d, card]);
    }
    setResults(null);
  };

  const removeCard = (type, idx, ci) => {
    if (type === "player") setPlayers(p => { const n = p.map(x => [...x]); n[idx].splice(ci, 1); return n });
    else if (type === "board") setBoard(b => { const n = [...b]; n.splice(ci, 1); return n });
    else if (type === "board2") setBoard2(b => { const n = [...b]; n.splice(ci, 1); return n });
    else if (type === "dead") setDeadCards(d => { const n = [...d]; n.splice(ci, 1); return n });
    setResults(null);
  };

  const deselectCard = card => {
    if (!picker) return;
    const { type, index } = picker;
    if (type === "player") setPlayers(p => { const n = p.map(x => [...x]); n[index] = n[index].filter(c => c !== card); return n });
    else if (type === "board") setBoard(b => b.filter(c => c !== card));
    else if (type === "board2") setBoard2(b => b.filter(c => c !== card));
    else if (type === "dead") setDeadCards(d => d.filter(c => c !== card));
    setResults(null);
  };

  // Cards belonging to the current picker target (highlighted in picker)
  const pickerCards = new Set();
  if (picker) {
    const { type, index } = picker;
    if (type === "player" && players[index]) players[index].forEach(c => pickerCards.add(c));
    else if (type === "board") board.forEach(c => pickerCards.add(c));
    else if (type === "board2") board2.forEach(c => pickerCards.add(c));
    else if (type === "dead") deadCards.forEach(c => pickerCards.add(c));
  }

  return (
    <div style={{
      minHeight: "100vh", background: "#0b0b18", color: "#d0d0e8",
      fontFamily: "'Outfit', sans-serif", maxWidth: 460, margin: "0 auto", paddingBottom: 80,
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&family=Space+Mono:wght@400;700&display=swap');
        *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
        body{margin:0;background:#0b0b18}
      `}</style>

      {/* HEADER */}
      <div style={{ padding: "20px 16px 14px", background: "linear-gradient(180deg, #13132a 0%, #0b0b18 100%)" }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, letterSpacing: -1, color: "#f59e0b" }}>♠♥ Poker Odds</h1>
      </div>

      {/* VARIANT SELECTOR */}
      <div style={{ padding: "10px 16px 6px", display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 5 }}>
        {Object.entries(VARIANTS).map(([k, v]) => (
          <button key={k} onClick={() => setVariant(k)} style={{
            padding: "7px 2px", border: "none", borderRadius: 6,
            background: variant === k ? "#f59e0b18" : "#0f0f22",
            color: variant === k ? "#f59e0b" : "#4a4a6a",
            fontSize: 10, fontWeight: 700, cursor: "pointer",
            outline: variant === k ? "1.5px solid #f59e0b44" : "1px solid #1a1a32",
            fontFamily: "'Outfit', sans-serif", lineHeight: 1.2,
          }}>{v.short}</button>
        ))}
      </div>
      <div style={{ textAlign: "center", fontSize: 11, color: "#5a5a7a", padding: "2px 0 8px", fontWeight: 500 }}>
        {cfg.name} · {cfg.hole} hole cards
      </div>

      {/* PLAYERS */}
      <div style={{ padding: "0 12px" }}>
        {players.map((hand, pi) => {
          const pr = results?.players?.[pi];
          const pc = P_COLORS[pi % P_COLORS.length];
          return (
            <div key={pi} style={{
              background: "#0f0f22", borderRadius: 10, padding: "8px 10px",
              marginBottom: 6, border: "1px solid #1a1a32",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                <div style={{ width: 6, height: 6, borderRadius: 3, background: pc, boxShadow: `0 0 6px ${pc}66` }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: "#6a6a8a", fontFamily: "'Space Mono', monospace" }}>P{pi + 1}</span>
                <div style={{ flex: 1 }} />
                {players.length > 2 && (
                  <button onClick={() => { setPlayers(p => p.filter((_, i) => i !== pi)); setResults(null) }} style={{
                    background: "none", border: "none", color: "#4a2a2a", fontSize: 14, cursor: "pointer", padding: "0 2px", lineHeight: 1,
                  }}>×</button>
                )}
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {hand.map((card, ci) => <MiniCard key={ci} card={card} onRemove={() => removeCard("player", pi, ci)} />)}
                {hand.length < cfg.hole && <MiniCard ghost onGhostClick={() => setPicker({ type: "player", index: pi })} />}
              </div>
              {pr && (
                <div style={{ marginTop: 6 }}>
                  {results.type === "standard" && <EquityBar value={pr.equity} color={pc} height={20} />}
                  {results.type === "hi_lo" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <EquityBar value={pr.hi_equity} color="#22c55e" label="HI" height={16} />
                      <EquityBar value={pr.lo_equity} color="#3b82f6" label="LO" height={16} />
                      <EquityBar value={pr.total_equity} color="#a855f7" label="POT" height={20} />
                      {pr.scoop_pct > 0 && <div style={{ fontSize: 9, color: "#f59e0b", fontFamily: "'Space Mono', monospace", paddingLeft: 30 }}>scoop {pr.scoop_pct}%</div>}
                    </div>
                  )}
                  {results.type === "two_line" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <EquityBar value={pr.line1_equity} color="#22c55e" label="L1" height={16} />
                      <EquityBar value={pr.line2_equity} color="#3b82f6" label="L2" height={16} />
                      <EquityBar value={pr.total_equity} color="#a855f7" label="POT" height={20} />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {players.length < 10 && (
          <button onClick={() => { setPlayers(p => [...p, []]); setResults(null) }} style={{
            width: "100%", padding: 7, border: "1px dashed #1e1e38", borderRadius: 8,
            background: "none", color: "#3a3a5c", fontSize: 11, cursor: "pointer",
            fontFamily: "'Outfit', sans-serif", fontWeight: 600,
          }}>+ Player</button>
        )}
      </div>

      {/* BOARD */}
      <div style={{ padding: "8px 12px 4px" }}>
        <div style={{ background: "#0f0f22", borderRadius: 10, padding: "8px 10px", border: "1px solid #1a1a32" }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#3a3a5c", marginBottom: 5, fontFamily: "'Space Mono', monospace", letterSpacing: 1 }}>
            BOARD{cfg.twoLine ? " · LINE 1" : ""}
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            {board.map((c, i) => <MiniCard key={i} card={c} onRemove={() => removeCard("board", null, i)} />)}
            {board.length < cfg.board && <MiniCard ghost onGhostClick={() => setPicker({ type: "board" })} />}
          </div>
        </div>
        {cfg.twoLine && (
          <div style={{ background: "#0f0f22", borderRadius: 10, padding: "8px 10px", marginTop: 6, border: "1px solid #1a1a32" }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#3a3a5c", marginBottom: 5, fontFamily: "'Space Mono', monospace", letterSpacing: 1 }}>BOARD · LINE 2</div>
            <div style={{ display: "flex", gap: 4 }}>
              {board2.map((c, i) => <MiniCard key={i} card={c} onRemove={() => removeCard("board2", null, i)} />)}
              {board2.length < cfg.board && <MiniCard ghost onGhostClick={() => setPicker({ type: "board2" })} />}
            </div>
          </div>
        )}
      </div>

      {/* DEAD CARDS */}
      <div style={{ padding: "4px 12px" }}>
        <div style={{ background: "#0f0f22", borderRadius: 10, padding: "8px 10px", border: "1px solid #1a1a32" }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#3a3a5c", marginBottom: 5, fontFamily: "'Space Mono', monospace", letterSpacing: 1 }}>DEAD</div>
          <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
            {deadCards.map((c, i) => <MiniCard key={i} card={c} size={30} onRemove={() => removeCard("dead", null, i)} />)}
            <MiniCard ghost size={30} onGhostClick={() => setPicker({ type: "dead" })} />
          </div>
        </div>
      </div>

      {/* INFO */}
      {info && (
        <div style={{
          margin: "6px 12px", padding: "8px 10px", background: "#0f0f22", borderRadius: 8,
          border: "1px solid #1a1a32", fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#5a5a7a",
        }}>
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
            <span style={{ color: "#6a6a8a" }}>Boards:</span>
            {info.boardNeeded > 0 && <Binom n={info.remaining} k={info.boardNeeded} />}
            {info.board2Needed > 0 && info.boardNeeded > 0 && (
              <><span style={{ color: "#4a4a6a" }}>×</span><Binom n={info.remaining - info.boardNeeded} k={info.board2Needed} /></>
            )}
            {info.boardNeeded === 0 && info.board2Needed === 0 && <span style={{ color: "#8a8aa0" }}>1</span>}
            <span style={{ color: "#4a4a6a" }}>=</span>
            <span style={{ color: "#f59e0b", fontWeight: 700 }}>{info.totalCombos?.toLocaleString()}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
            <span style={{ color: "#6a6a8a", minWidth: 60 }}>Per hand:</span>
            {info.isOmaha ? (
              <>
                <Binom n={info.evalFormula.holeN} k={2} />
                <span style={{ color: "#4a4a6a" }}>×</span>
                <Binom n={5} k={3} />
                <span style={{ color: "#4a4a6a" }}>=</span>
                <span style={{ color: "#8a8aa0", fontWeight: 700 }}>{info.evalsPerPlayer}</span>
              </>
            ) : (
              <>
                <Binom n={info.evalFormula.totalCards} k={5} />
                <span style={{ color: "#4a4a6a" }}>=</span>
                <span style={{ color: "#8a8aa0", fontWeight: 700 }}>{info.evalsPerPlayer}</span>
              </>
            )}
            <span style={{ color: "#3a3a5c" }}>evals</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
            <span style={{ color: "#6a6a8a", minWidth: 60 }}>Per sim:</span>
            <span style={{ color: "#8a8aa0" }}>{info.evalsPerPlayer}</span>
            {info.evalMultiplier > 1 && <><span style={{ color: "#4a4a6a" }}>×</span><span style={{ color: "#8a8aa0" }}>{info.evalMultiplier}</span><span style={{ color: "#3a3a5c", fontSize: 8 }}>{VCFG[variant]?.hiLo ? "hi+lo" : "2 lines"}</span></>}
            <span style={{ color: "#4a4a6a" }}>×</span>
            <span style={{ color: "#8a8aa0" }}>{info.np}</span>
            <span style={{ color: "#3a3a5c", fontSize: 8 }}>players</span>
            <span style={{ color: "#4a4a6a" }}>=</span>
            <span style={{ color: "#8a8aa0", fontWeight: 700 }}>{info.totalEvalsPerSim.toLocaleString()}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2, paddingTop: 4, borderTop: "1px solid #1a1a32" }}>
            <span style={{ color: "#6a6a8a" }}>Total evals</span>
            <span style={{ color: "#f59e0b", fontWeight: 700 }}>{info.totalEvals.toLocaleString()}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
            <span>Est. time</span>
            <span style={{ color: "#8a8aa0" }}>
              {info.strategy === "monte_carlo"
                ? `MC ~${Math.ceil((info.recIter || 200000) / info.speed)}s`
                : info.estSec < 1 ? "<1s" : info.estSec < 60 ? `~${Math.ceil(info.estSec)}s` : `~${Math.ceil(info.estSec / 60)}m`}
            </span>
          </div>
          {info.strategy === "monte_carlo" && (
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
              <span>Full exact</span>
              <span style={{ color: "#6a4a2a" }}>
                {info.estSec < 60 ? `~${Math.ceil(info.estSec)}s` : info.estSec < 3600 ? `~${Math.ceil(info.estSec / 60)}m` : `~${(info.estSec / 3600).toFixed(1)}h`}
              </span>
            </div>
          )}
        </div>
      )}

      {/* LEGEND */}
      {results && (results.type === "hi_lo" || results.type === "two_line") && (
        <div style={{ margin: "4px 12px", display: "flex", gap: 12, justifyContent: "center", padding: "6px 0" }}>
          {results.type === "hi_lo" ? (
            <><LegendDot color="#22c55e" label="HI 50%" /><LegendDot color="#3b82f6" label="LO 50%" /><LegendDot color="#a855f7" label="TOTAL" /></>
          ) : (
            <><LegendDot color="#22c55e" label="LINE 1" /><LegendDot color="#3b82f6" label="LINE 2" /><LegendDot color="#a855f7" label="TOTAL" /></>
          )}
        </div>
      )}
      {results?.type === "hi_lo" && results.no_lo_pct != null && (
        <div style={{
          margin: "0 12px 6px", padding: "5px 10px", background: "#18120a", borderRadius: 6,
          fontSize: 10, color: "#f59e0b", textAlign: "center", fontFamily: "'Space Mono', monospace", border: "1px solid #2a1a08",
        }}>No qualifying low on {results.no_lo_pct}% of boards — hi scoops</div>
      )}

      {/* PROGRESS */}
      {calcStatus === "running" && progress && (
        <div style={{ margin: "6px 12px", padding: "8px 10px", background: "#0f0f22", borderRadius: 8, border: "1px solid #1a1a32" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#5a5a7a", marginBottom: 4, fontFamily: "'Space Mono', monospace" }}>
            <span>{progress.done?.toLocaleString()} / {progress.total?.toLocaleString()} sims</span>
            <span>{progress.rate?.toLocaleString()} /s · {progress.elapsed}s</span>
          </div>
          <div style={{ width: "100%", height: 4, background: "#0a0a18", borderRadius: 2, overflow: "hidden" }}>
            <div style={{
              width: `${progress.total > 0 ? (progress.done / progress.total * 100) : 0}%`,
              height: "100%", background: "linear-gradient(90deg, #f59e0b, #ef4444)", borderRadius: 2, transition: "width 0.3s",
            }} />
          </div>
          {info && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "#3a3a5c", marginTop: 3, fontFamily: "'Space Mono', monospace" }}>
              <span>{(progress.done * info.totalEvalsPerSim).toLocaleString()} evals</span>
              <span>of {(progress.total * info.totalEvalsPerSim).toLocaleString()}</span>
            </div>
          )}
        </div>
      )}

      {results && (
        <div style={{ textAlign: "center", fontSize: 9, color: "#3a3a5c", fontFamily: "'Space Mono', monospace", padding: "3px 0" }}>
          {results.totalSims?.toLocaleString()} sims
          {info ? ` · ${(results.totalSims * info.totalEvalsPerSim).toLocaleString()} evals` : ""}
          {info ? ` / ${info.totalEvals.toLocaleString()}` : ""}
          {" · "}{calcStatus === "cancelled" ? "CANCELLED" : "DONE"}
        </div>
      )}

      {/* CALCULATE */}
      <div style={{ padding: "8px 12px", display: "flex", gap: 6 }}>
        {calcStatus === "running" ? (
          <button onClick={cancelCalc} style={{
            flex: 1, padding: 13, border: "none", borderRadius: 10,
            background: "linear-gradient(135deg, #991b1b, #dc2626)",
            color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Outfit', sans-serif",
          }}>✕ Cancel</button>
        ) : (
          <>
            <button onClick={() => startCalc(false)} disabled={!allFull} style={{
              flex: 1, padding: 13, border: "none", borderRadius: 10,
              background: allFull ? "linear-gradient(135deg, #f59e0b, #ef4444)" : "#1a1a32",
              color: allFull ? "#0b0b18" : "#3a3a5c",
              fontSize: 14, fontWeight: 800, cursor: allFull ? "pointer" : "default",
              fontFamily: "'Outfit', sans-serif", transition: "all 0.2s",
            }}>{allFull ? (info?.totalCombos > 50000 ? "Monte Carlo" : "Calculate") : `Deal ${cfg.hole} cards × ${players.length} players`}</button>
            {allFull && info?.totalCombos > 50000 && (
              <button onClick={() => startCalc(true)} style={{
                flex: 1, padding: 13, border: "none", borderRadius: 10,
                background: "#1a1a32", color: "#8a8aa0",
                fontSize: 14, fontWeight: 700, cursor: "pointer",
                fontFamily: "'Outfit', sans-serif", transition: "all 0.2s",
                border: "1px solid #2a2a4a",
              }}>Full Exact</button>
            )}
          </>
        )}
      </div>

      {(usedCards.size > 0 || results) && (
        <div style={{ textAlign: "center", padding: "2px 0 8px" }}>
          <button onClick={() => {
            cancelRef.current = true;
            setPlayers(players.map(() => [])); setBoard([]); setBoard2([]); setDeadCards([]);
            setResults(null); setInfo(null); setCalcStatus("idle"); setProgress(null);
          }} style={{
            background: "none", border: "none", color: "#3a3a5c", fontSize: 11,
            cursor: "pointer", textDecoration: "underline", fontFamily: "'Outfit', sans-serif",
          }}>Reset all</button>
        </div>
      )}

      {/* HISTORY */}
      {history.length > 0 && (
        <div style={{ padding: "12px 12px 4px" }}>
          <div style={{
            fontSize: 10, fontWeight: 600, color: "#3a3a5c", marginBottom: 6,
            fontFamily: "'Space Mono', monospace", letterSpacing: 1,
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span>HISTORY ({history.length}/10)</span>
            <span style={{ fontSize: 8, color: "#2a2a4a", fontWeight: 400, letterSpacing: 0.5 }}>session only</span>
          </div>
          {history.map((h, hi) => (
            <div key={h.id} onClick={() => {
              setVariant(h.variant);
              setTimeout(() => {
                setPlayers(h.players.map(p => [...p]));
                setBoard([...h.board]);
                setBoard2([...h.board2]);
                setDeadCards([]);
                setResults(h.results);
                setCalcStatus("done");
              }, 0);
            }} style={{
              background: "#0f0f22", borderRadius: 8, padding: "6px 10px",
              marginBottom: 4, border: "1px solid #1a1a32", cursor: "pointer",
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <span style={{
                fontSize: 9, fontWeight: 700, color: "#f59e0b",
                fontFamily: "'Space Mono', monospace", minWidth: 30,
              }}>{h.variantName}</span>
              <div style={{ flex: 1, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                {h.players.map((p, pi) => (
                  <div key={pi} style={{ display: "flex", alignItems: "center", gap: 2 }}>
                    <div style={{ width: 4, height: 4, borderRadius: 2, background: P_COLORS[pi % P_COLORS.length] }} />
                    <span style={{ fontSize: 9, color: "#6a6a8a", fontFamily: "'Space Mono', monospace" }}>
                      {p.map(c => c[0] + SUIT_SYM[c[1]]).join("")}
                    </span>
                    <span style={{ fontSize: 9, color: "#8a8aa0", fontWeight: 700, fontFamily: "'Space Mono', monospace" }}>
                      {h.results.type === "standard"
                        ? `${h.results.players[pi]?.equity}%`
                        : `${h.results.players[pi]?.total_equity}%`}
                    </span>
                  </div>
                ))}
              </div>
              {h.board.length > 0 && (
                <span style={{ fontSize: 8, color: "#3a3a5c", fontFamily: "'Space Mono', monospace" }}>
                  {h.board.map(c => c[0] + SUIT_SYM[c[1]]).join("")}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {picker && (
        <CardPicker usedCards={usedCards} onSelect={selectCard} onDeselect={deselectCard} onClose={() => setPicker(null)}
          pickerCards={pickerCards}
          title={picker.type === "player" ? `Player ${picker.index + 1}` : picker.type === "board" ? "Board" : picker.type === "board2" ? "Board Line 2" : "Dead card"} />
      )}
    </div>
  );
}

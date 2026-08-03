import { useState, useRef, useEffect, useCallback } from "react";
import * as ort from "onnxruntime-web";

// ═══════════════════════════════════════════════════════════════
// CardScanner (onnxruntime-web) — desktop image-upload test build
//
// Runs a YOLOv8 playing-card model (ONNX) fully client-side.
// No API calls, no tokens. For now it just DISPLAYS detected cards
// so we can judge detection quality before wiring into the calculator.
//
// Model file expected at:  /public/model/yolov8s_playing_cards.onnx
// Input:  1×3×416×416 (RGB, 0..1, letterboxed)
// Output: 1×56×3549  (56 = 4 bbox + 52 class scores; 3549 anchors)
// ═══════════════════════════════════════════════════════════════

const MODEL_URL = "./model/yolov8s_playing_cards.onnx";
const MODEL_INPUT = 416;
const NUM_CLASSES = 52;
const CONF_THRESHOLD = 0.40; // tweak in the UI slider
const IOU_THRESHOLD = 0.45;

// Class order from the training dataset's data.yaml: alphabetical by
// rank-string then suit → 10C,10D,10H,10S,2C,2D,2H,2S,3C,... AS,JC,... QS
const RANKS_ORDER = ["10", "2", "3", "4", "5", "6", "7", "8", "9", "A", "J", "K", "Q"];
const SUITS_ORDER = ["C", "D", "H", "S"];
const CLASS_NAMES = [];
for (const r of RANKS_ORDER) for (const s of SUITS_ORDER) CLASS_NAMES.push(r + s);

function labelToCard(label) {
  const suit = label.slice(-1).toLowerCase();
  let rank = label.slice(0, -1).toUpperCase();
  if (rank === "10") rank = "T";
  return rank + suit; // e.g. "Tc","Ah","Kd"
}

const SUIT_SYM = { s: "♠", h: "♥", d: "♦", c: "♣" };
const SUIT_CLR = { s: "#c8ccd4", h: "#ef4444", d: "#3b82f6", c: "#22c55e" };

// Building the session parses ~43 MB, so build it once at module scope and
// share it — the scanner is opened and closed repeatedly, and paying that on
// every mount would make reopening it feel broken.
let sessionPromise = null;
function getSession() {
  if (!sessionPromise) {
    sessionPromise = ort.InferenceSession
      .create(MODEL_URL, { executionProviders: ["wasm"], graphOptimizationLevel: "all" })
      .catch(e => { sessionPromise = null; throw e; }); // let a retry rebuild it
  }
  return sessionPromise;
}

export default function CardScanner({ onConfirm, onClose }) {
  const [phase, setPhase] = useState("loading"); // loading|ready|detecting|review|error
  const [errorMsg, setErrorMsg] = useState("");
  const [detected, setDetected] = useState([]);
  const [conf, setConf] = useState(CONF_THRESHOLD);
  const [lastImage, setLastImage] = useState(null); // keep for re-run on slider change
  const [drawData, setDrawData] = useState(null);   // {img, dets, scale, dx, dy} for canvas draw

  const sessionRef = useRef(null);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);

  // ─── Load model once ───
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await getSession();
        if (cancelled) return;
        sessionRef.current = session;
        setPhase("ready");
      } catch (e) {
        if (cancelled) return;
        setErrorMsg(
          "Couldn't load the model. Make sure yolov8s_playing_cards.onnx is in /public/model/. " +
          "Details: " + (e?.message || e)
        );
        setPhase("error");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ─── Letterbox image into a Float32 CHW tensor ───
  function preprocess(img) {
    const c = document.createElement("canvas");
    c.width = MODEL_INPUT; c.height = MODEL_INPUT;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "rgb(114,114,114)"; // YOLO gray pad
    ctx.fillRect(0, 0, MODEL_INPUT, MODEL_INPUT);
    const scale = Math.min(MODEL_INPUT / img.width, MODEL_INPUT / img.height);
    const nw = Math.round(img.width * scale), nh = Math.round(img.height * scale);
    const dx = Math.floor((MODEL_INPUT - nw) / 2), dy = Math.floor((MODEL_INPUT - nh) / 2);
    ctx.drawImage(img, dx, dy, nw, nh);
    const { data } = ctx.getImageData(0, 0, MODEL_INPUT, MODEL_INPUT);
    const chw = new Float32Array(3 * MODEL_INPUT * MODEL_INPUT);
    const area = MODEL_INPUT * MODEL_INPUT;
    for (let i = 0; i < area; i++) {
      chw[i] = data[i * 4] / 255;               // R
      chw[area + i] = data[i * 4 + 1] / 255;     // G
      chw[2 * area + i] = data[i * 4 + 2] / 255; // B
    }
    return { tensor: new ort.Tensor("float32", chw, [1, 3, MODEL_INPUT, MODEL_INPUT]), scale, dx, dy };
  }

  function iou(a, b) {
    const ix1 = Math.max(a.x1, b.x1), iy1 = Math.max(a.y1, b.y1);
    const ix2 = Math.min(a.x2, b.x2), iy2 = Math.min(a.y2, b.y2);
    const iw = Math.max(0, ix2 - ix1), ih = Math.max(0, iy2 - iy1);
    const inter = iw * ih;
    const aA = (a.x2 - a.x1) * (a.y2 - a.y1), aB = (b.x2 - b.x1) * (b.y2 - b.y1);
    return inter / (aA + aB - inter + 1e-9);
  }

  function decode(output, threshold) {
    // output.dims = [1,56,3549]; data is Float32Array flattened
    const dims = output.dims;
    const nAttr = dims[1];     // 56
    const nAnchor = dims[2];   // 3549
    const d = output.data;
    // Access element [0, a, k] = d[a*nAnchor + k]
    const boxes = [];
    for (let k = 0; k < nAnchor; k++) {
      const cx = d[0 * nAnchor + k];
      const cy = d[1 * nAnchor + k];
      const bw = d[2 * nAnchor + k];
      const bh = d[3 * nAnchor + k];
      let best = 0, bestC = -1;
      for (let c = 0; c < NUM_CLASSES; c++) {
        const s = d[(4 + c) * nAnchor + k];
        if (s > best) { best = s; bestC = c; }
      }
      if (best < threshold) continue;
      boxes.push({
        x1: cx - bw / 2, y1: cy - bh / 2, x2: cx + bw / 2, y2: cy + bh / 2,
        score: best, cls: bestC,
      });
    }
    boxes.sort((a, b) => b.score - a.score);
    const keep = [];
    const sup = new Array(boxes.length).fill(false);
    for (let i = 0; i < boxes.length; i++) {
      if (sup[i]) continue;
      keep.push(boxes[i]);
      for (let j = i + 1; j < boxes.length; j++)
        if (!sup[j] && iou(boxes[i], boxes[j]) > IOU_THRESHOLD) sup[j] = true;
    }
    // dedupe per card, keep best
    const byCard = new Map();
    for (const b of keep) {
      const card = labelToCard(CLASS_NAMES[b.cls]);
      const prev = byCard.get(card);
      if (!prev || b.score > prev.conf)
        byCard.set(card, { card, conf: b.score, box: b });
    }
    return [...byCard.values()].sort((a, b) => b.conf - a.conf);
  }

  const runDetection = useCallback(async (img, threshold) => {
    if (!sessionRef.current) return;
    setPhase("detecting");
    try {
      const { tensor, scale, dx, dy } = preprocess(img);
      const feeds = {};
      feeds[sessionRef.current.inputNames[0]] = tensor;
      const results = await sessionRef.current.run(feeds);
      const output = results[sessionRef.current.outputNames[0]];
      const dets = decode(output, threshold);

      // Stash everything needed to draw; the actual draw happens in an
      // effect once the review canvas is mounted (canvasRef exists there).
      setDrawData({ img, dets, scale, dx, dy });
      setDetected(dets);
      setPhase("review");
    } catch (e) {
      setErrorMsg("Detection failed: " + (e?.message || e));
      setPhase("error");
    }
  }, []);

  // Draw the review image + boxes once the canvas is on screen
  useEffect(() => {
    if (phase !== "review" || !drawData) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { img, dets, scale, dx, dy } = drawData;
    const maxW = 420;
    const dispScale = Math.min(1, maxW / img.width);
    canvas.width = img.width * dispScale;
    canvas.height = img.height * dispScale;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const dobj of dets) {
      const b = dobj.box;
      const ox1 = (b.x1 - dx) / scale, oy1 = (b.y1 - dy) / scale;
      const ox2 = (b.x2 - dx) / scale, oy2 = (b.y2 - dy) / scale;
      const rx1 = ox1 * dispScale, ry1 = oy1 * dispScale;
      const rx2 = ox2 * dispScale, ry2 = oy2 * dispScale;
      ctx.strokeStyle = "#f59e0b"; ctx.lineWidth = 2;
      ctx.strokeRect(rx1, ry1, rx2 - rx1, ry2 - ry1);
      ctx.fillStyle = "#f59e0b"; ctx.font = "bold 13px monospace";
      ctx.fillText(dobj.card[0] + SUIT_SYM[dobj.card[1]], rx1 + 2, Math.max(12, ry1 - 4));
    }
  }, [phase, drawData]);

  const onFilePicked = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => { setLastImage(img); runDetection(img, conf); };
    img.src = URL.createObjectURL(file);
  }, [runDetection, conf]);

  // re-run when threshold changes (if we have an image)
  const onConfChange = (v) => {
    setConf(v);
    if (lastImage) runDetection(lastImage, v);
  };

  const removeCard = (card) => setDetected(d => d.filter(x => x.card !== card));
  const confirmCards = () => {
    const cards = detected.map(d => d.card[0].toUpperCase() + d.card[1].toLowerCase());
    if (onConfirm) onConfirm(cards);
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#0b0b18", zIndex: 300,
      display: "flex", flexDirection: "column", maxWidth: 460, margin: "0 auto",
      fontFamily: "'Outfit', sans-serif", color: "#d0d0e8",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "14px 16px", borderBottom: "1px solid #1a1a32" }}>
        <span style={{ fontSize: 15, fontWeight: 800, color: "#f59e0b" }}>Scan cards (test)</span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#6a6a8a",
          fontSize: 22, cursor: "pointer", lineHeight: 1, padding: "0 4px" }}>×</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {phase === "loading" && <Centered><Spinner /><p style={dim}>Loading model…</p>
          <p style={hint}>~40 MB, one-time from your local folder</p></Centered>}

        {phase === "error" && <Centered>
          <div style={{ fontSize: 30 }}>⚠️</div>
          <p style={{ ...dim, textAlign: "center", lineHeight: 1.5 }}>{errorMsg}</p>
          <button onClick={onClose} style={btnSecondary}>Close</button>
        </Centered>}

        {(phase === "ready" || phase === "detecting" || phase === "review") && (
          <div>
            <button onClick={() => fileInputRef.current?.click()} style={{ ...btnPrimary, width: "100%" }}>
              {phase === "review" ? "Pick another image" : "Upload card image"}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*"
              onChange={onFilePicked} style={{ display: "none" }} />

            {phase === "detecting" && <Centered><Spinner /><p style={dim}>Detecting…</p></Centered>}

            {(phase === "review") && (
              <>
                <canvas ref={canvasRef} style={{ width: "100%", borderRadius: 12,
                  display: "block", margin: "12px 0", border: "1px solid #1a1a32" }} />

                <div style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10,
                    color: "#6a6a8a", fontFamily: "'Space Mono', monospace", marginBottom: 4 }}>
                    <span>confidence ≥ {(conf * 100).toFixed(0)}%</span>
                    <span>{detected.length} found</span>
                  </div>
                  <input type="range" min="0.1" max="0.9" step="0.05" value={conf}
                    onChange={e => onConfChange(parseFloat(e.target.value))}
                    style={{ width: "100%", accentColor: "#f59e0b" }} />
                </div>

                {detected.length === 0 && <p style={{ ...hint, textAlign: "center" }}>
                  No cards above threshold. Lower the slider or try a clearer image.</p>}

                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
                  {detected.map(d => (
                    <div key={d.card} style={{ display: "flex", alignItems: "center", gap: 6,
                      background: "#0f0f22", border: "1px solid #2a2a4a", borderRadius: 8, padding: "6px 8px" }}>
                      <span style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: 14,
                        color: SUIT_CLR[d.card[1]] }}>{d.card[0]}{SUIT_SYM[d.card[1]]}</span>
                      <span style={{ fontSize: 9, color: "#4a4a6a", fontFamily: "'Space Mono', monospace" }}>
                        {Math.round(d.conf * 100)}%</span>
                      <button onClick={() => removeCard(d.card)} style={{ background: "none", border: "none",
                        color: "#6a3a3a", fontSize: 14, cursor: "pointer", lineHeight: 1, padding: 0 }}>✕</button>
                    </div>
                  ))}
                </div>

                {onConfirm && detected.length > 0 && (
                  <button onClick={confirmCards} style={{ ...btnPrimary, width: "100%" }}>
                    Use {detected.length} card{detected.length === 1 ? "" : "s"}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Centered({ children }) {
  return <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", minHeight: 240, gap: 4 }}>{children}</div>;
}
function Spinner() {
  return <div style={{ width: 30, height: 30, borderRadius: "50%", border: "3px solid #1a1a32",
    borderTopColor: "#f59e0b", animation: "spin .8s linear infinite" }}>
    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style></div>;
}
const dim = { color: "#6a6a8a", fontSize: 13, marginTop: 12 };
const hint = { color: "#3a3a5c", fontSize: 11 };
const btnPrimary = { padding: 13, border: "none", borderRadius: 10,
  background: "linear-gradient(135deg,#f59e0b,#ef4444)", color: "#0b0b18",
  fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: "'Outfit',sans-serif" };
const btnSecondary = { padding: "13px 16px", border: "1px solid #2a2a4a", borderRadius: 10,
  background: "#1a1a32", color: "#8a8aa0", fontSize: 14, fontWeight: 700, cursor: "pointer",
  fontFamily: "'Outfit',sans-serif", marginTop: 12 };

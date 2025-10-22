// deno-lint-ignore-file no-unused-vars
import "./style.css";

document.body.innerHTML = `
  <h1>Draw the Thing!</h1>

  <div id="sketch-wrap">
    <canvas id="sketchpad" style="border:1px solid black;"></canvas>

    <body>Controls:</body>
    <div id="controls">
      <button style="margin-top:8px;" id="clearBtn">Clear</button>
      <button style="margin-top:8px;" id="undoBtn">Undo</button>
      <button style="margin-top:8px;" id="redoBtn">Redo</button>
      <button style="margin-top:8px;" id="exportBtn">Export PNG</button>
    </div><br>

    <body>Line Tools:</body>
    <div id="lineTools">
      <button style="margin-top:8px;" id="thinBtn">Thin</button>
      <button style="margin-top:8px;" id="thickBtn">Thick</button>
    </div><br>

    <body>Stickers:</body>
    <div id="stickers"></div>
    <br>
  </div>
`;

const canvas = document.getElementById("sketchpad") as HTMLCanvasElement;
canvas.width = 256;
canvas.height = 256;
document.body.append(canvas);

const ctx = canvas.getContext("2d")!;

// Any object that can be part of the display list should implement
// display(ctx). Commands that can be interactively moved should also
// implement drag(x,y).
interface Displayable {
  display(ctx: CanvasRenderingContext2D): void;
  drag?(x: number, y: number): void;
  toJSON?(): unknown;
  clone?(): Displayable;
}

const strokes: Displayable[] = [];
const redoStrokes: Displayable[] = [];
let currentStroke: Displayable | null = null;

// Current drawing width (used for new strokes). Keep this separate from ctx so
// existing strokes retain their original width when redrawing.
let currentLineWidth = 1;

const cursor = { active: false, x: 0, y: 0 };

// Tool preview interface and implementation. Any preview must expose draw(ctx).
type ToolPreview = { draw(ctx: CanvasRenderingContext2D): void };

class BrushPreview implements ToolPreview {
  x: number;
  y: number;
  color: string;
  width: number;

  constructor(x: number, y: number, color = "#000", width = 3) {
    this.x = x;
    this.y = y;
    this.color = color;
    this.width = width;
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.fillStyle = this.color;
    const radius = Math.max(1, this.width / 2);
    ctx.beginPath();
    ctx.arc(this.x, this.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// Nullable global preview reference. When non-null, redrawAll will render it.
let currentPreview: ToolPreview | null = null;

// Single mutable detail object and a single CustomEvent instance for "tool-moved".
// We reuse the same event object and update its detail object's properties before
// dispatch so we don't allocate a new CustomEvent every time.
const TOOL_MOVED_DETAIL: {
  x: number | null;
  y: number | null;
  width: number | null;
  emoji: string | null;
} = { x: 0, y: 0, width: currentLineWidth, emoji: null };
const TOOL_MOVED_EVENT = new CustomEvent("tool-moved", {
  detail: TOOL_MOVED_DETAIL,
});

class DecalPreview implements ToolPreview {
  x: number;
  y: number;
  emoji: string;
  size: number;

  constructor(x: number, y: number, emoji = "👻", size = 36) {
    this.x = x;
    this.y = y;
    this.emoji = emoji;
    this.size = size;
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.save();
    // Use a font-based draw so emoji render crisply; center the emoji
    ctx.font = `${this.size}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(this.emoji, this.x, this.y);
    ctx.restore();
  }
}

const clearBtn = document.getElementById("clearBtn") as HTMLButtonElement;
clearBtn.onclick = () => {
  // Clear the model and redraw
  strokes.length = 0;
  currentStroke = null;
  // Clearing the canvas invalidates the redo stack
  redoStrokes.length = 0;
  // Notify observers that the drawing changed
  canvas.dispatchEvent(new CustomEvent("drawing-changed"));
};

const undoBtn = document.getElementById("undoBtn") as HTMLButtonElement;
undoBtn.onclick = () => {
  if (strokes.length === 0) return;
  const stroke = strokes.pop();
  if (stroke) {
    // Push the removed stroke onto the redo stack
    redoStrokes.push(stroke);
    canvas.dispatchEvent(new CustomEvent("drawing-changed"));
  }
};

const redoBtn = document.getElementById("redoBtn") as HTMLButtonElement;
redoBtn.onclick = () => {
  if (redoStrokes.length === 0) return;
  const stroke = redoStrokes.pop();
  if (stroke) {
    strokes.push(stroke);
    canvas.dispatchEvent(new CustomEvent("drawing-changed"));
  }
};

const thinBtn = document.getElementById("thinBtn")!;
const thickBtn = document.getElementById("thickBtn")!;

// Tighter, nicer feeling strokes: thin is visible, thick is pleasantly bold
const THIN_WIDTH = 2;
const THICK_WIDTH = 10;

let currentTool: "thin" | "thick" | "sticker" = "thin";
currentLineWidth = THIN_WIDTH;

// If a sticker tool is selected, this holds the emoji; otherwise null.
let currentSticker: string | null = null;

// Helper to clear selected UI state for all tools
function clearAllSelections() {
  thinBtn.classList.remove("selectedTool");
  thickBtn.classList.remove("selectedTool");
  // Remove selection class from any generated sticker buttons
  const stickerButtons = document.querySelectorAll<HTMLButtonElement>(
    "#stickers button",
  );
  for (const b of stickerButtons) b.classList.remove("selectedTool");
}

thinBtn.onclick = () => {
  currentTool = "thin";
  currentLineWidth = THIN_WIDTH;
  currentSticker = null;
  clearAllSelections();
  thinBtn.classList.add("selectedTool");
};

thickBtn.onclick = () => {
  currentTool = "thick";
  currentLineWidth = THICK_WIDTH;
  currentSticker = null;
  clearAllSelections();
  thickBtn.classList.add("selectedTool");
};

// Data-driven sticker definitions (JSON friendly). Edit this array to change
// which stickers are available. Each entry stores the emoji as a hex code
// string (e.g. "1F308"). These examples are chosen to feel friendly and
// expressive.
const STICKERS: { id: string; emoji: string; label?: string }[] = [
  { id: "demon", emoji: "1F479", label: "demon" },
  { id: "alien", emoji: "1F47D", label: "alien" },
  { id: "ghost", emoji: "1F47B", label: "ghost" },
];

// Helpers to convert between hex-code strings and actual emoji characters.
function isHexCodeString(s: string) {
  return /^[0-9a-fA-F]{4,6}$/.test(s.replace(/^0x|^U\+/i, ""));
}

function normalizeHex(s: string) {
  return s.replace(/^0x/i, "").replace(/^U\+/i, "").toUpperCase();
}

function emojiFromHexOrLiteral(s: string) {
  const trimmed = s.trim();
  if (trimmed.length === 0) return "";
  if (
    isHexCodeString(trimmed) || /^0x[0-9a-fA-F]+$/.test(trimmed) ||
    /^U\+[0-9A-Fa-f]+$/.test(trimmed)
  ) {
    const hex = normalizeHex(trimmed);
    return String.fromCodePoint(parseInt(hex, 16));
  }
  // Otherwise assume the input contains an actual emoji/character; take the first code point.
  const cp = Array.from(trimmed)[0];
  if (!cp) return "";
  return cp;
}

function hexFromInput(s: string) {
  const trimmed = s.trim();
  if (trimmed.length === 0) return null;
  if (
    isHexCodeString(trimmed) || /^0x[0-9a-fA-F]+$/.test(trimmed) ||
    /^U\+[0-9A-Fa-f]+$/.test(trimmed)
  ) {
    return normalizeHex(trimmed);
  }
  const cp = Array.from(trimmed)[0];
  if (!cp) return null;
  return cp.codePointAt(0)!.toString(16).toUpperCase();
}

// Generate the sticker buttons from the single source of truth above.
const stickersContainer = document.getElementById("stickers")!;
function addStickerButton(s: { id: string; emoji: string; label?: string }) {
  const btn = document.createElement("button");
  btn.style.marginTop = "8px";
  btn.id = `${s.id}Sticker`;
  btn.textContent = emojiFromHexOrLiteral(s.emoji);
  btn.title = s.label ?? s.emoji;
  btn.onclick = () => {
    currentTool = "sticker";
    // Store the raw hex-or-literal value in currentSticker; conversions
    // to actual character happen when rendering/placing.
    currentSticker = s.emoji;
    clearAllSelections();
    btn.classList.add("selectedTool");
    TOOL_MOVED_DETAIL.emoji = emojiFromHexOrLiteral(String(currentSticker));
    TOOL_MOVED_DETAIL.x = null;
    TOOL_MOVED_DETAIL.y = null;
    TOOL_MOVED_DETAIL.width = null;
    canvas.dispatchEvent(TOOL_MOVED_EVENT);
  };
  stickersContainer.appendChild(btn);
  return btn;
}

for (const s of STICKERS) {
  addStickerButton(s);
}

// Button to add a custom sticker via prompt()
const addStickerBtn = document.createElement("button");
addStickerBtn.style.marginTop = "8px";
addStickerBtn.id = "addStickerBtn";
addStickerBtn.textContent = "Add Your Own!";
addStickerBtn.title = "Create a custom sticker (emoji or text)";
addStickerBtn.onclick = () => {
  const input = prompt("Enter custom sticker (emoji or text):", "⭐");
  if (input === null) return; // user cancelled
  const trimmed = input.trim();
  if (trimmed.length === 0) return; // ignore empty
  const newId = `custom-${Date.now()}`;
  // Store custom stickers as hex strings when possible, matching the
  // STICKERS array format.
  const hex = hexFromInput(trimmed) ?? trimmed;
  const entry = { id: newId, emoji: hex };
  STICKERS.push(entry);
  const newBtn = addStickerButton(entry);
  // Select the newly created sticker and notify listeners
  newBtn.click();
};
stickersContainer.appendChild(addStickerBtn);

// Export button: render the display list into a 1024x1024 canvas and download
const exportBtn = document.createElement("button");
exportBtn.style.marginTop = "8px";
exportBtn.id = "exportBtn";
exportBtn.textContent = "Export PNG";
exportBtn.title = "Export a 1024x1024 PNG of the drawing";
exportBtn.onclick = () => {
  // Create offscreen canvas
  const outSize = 1024;
  const outCanvas = document.createElement("canvas");
  outCanvas.width = outSize;
  outCanvas.height = outSize;
  const outCtx = outCanvas.getContext("2d")!;

  // Scale so that the original 256x256 content maps to 1024x1024 (4x)
  const scaleFactor = outSize / canvas.width; // should be 4
  outCtx.save();
  outCtx.scale(scaleFactor, scaleFactor);

  // Draw each displayable in the strokes list. Skip any preview objects
  for (const item of strokes) {
    // Only call display — previews are not stored in strokes so this is safe
    if (typeof item.display === "function") {
      item.display(outCtx as CanvasRenderingContext2D);
    }
  }

  outCtx.restore();

  // Convert to PNG and trigger download
  outCanvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sticker-sketchpad.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
};

// Attach the export handler to the Export button already placed in the
// Controls HTML so there's a single Export control in the UI.
const exportBtnExisting = document.getElementById("exportBtn") as
  | HTMLButtonElement
  | null;
if (exportBtnExisting) exportBtnExisting.onclick = exportBtn.onclick;

// Redraw helper: clears canvas and draws all strokes from the model
function redrawAll() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const m of strokes) {
    m.display(ctx);
  }
  // Render a preview on top of strokes if present
  if (currentPreview) {
    currentPreview.draw(ctx);
  }
}

// Observe changes and redraw only when model changes
canvas.addEventListener("drawing-changed", () => {
  redrawAll();
});

canvas.addEventListener("mousedown", (e) => {
  cursor.x = e.offsetX;
  cursor.y = e.offsetY;
  cursor.active = true;

  // Hide preview while the mouse is pressed
  currentPreview = null;

  redoStrokes.length = 0;
  if (currentTool === "sticker" && currentSticker) {
    // Place a decal command into the model. currentStroke holds the live
    // decal so subsequent drag calls will reposition it.
    const s = new Decal(
      cursor.x,
      cursor.y,
      // convert stored hex-or-literal to an actual glyph
      emojiFromHexOrLiteral(String(currentSticker)),
      40,
    );
    currentStroke = s;
    strokes.push(s);
  } else {
    currentStroke = new BrushStroke(
      cursor.x,
      cursor.y,
      "#000",
      currentLineWidth,
    );
    strokes.push(currentStroke);
  }
  canvas.dispatchEvent(new CustomEvent("drawing-changed"));
});

canvas.addEventListener("mousemove", (e) => {
  cursor.x = e.offsetX;
  cursor.y = e.offsetY;

  if (cursor.active && currentStroke) {
    // Update the stroke being drawn (only if the object supports drag)
    if (typeof currentStroke.drag === "function") {
      currentStroke.drag(e.offsetX, e.offsetY);
    }
    canvas.dispatchEvent(new CustomEvent("drawing-changed"));
    return;
  }

  // Mouse is moved while not drawing: show a preview and emit tool-moved
  if (currentTool === "sticker" && currentSticker) {
    currentPreview = new DecalPreview(
      cursor.x,
      cursor.y,
      emojiFromHexOrLiteral(String(currentSticker)),
      36,
    );
  } else {
    currentPreview = new BrushPreview(
      cursor.x,
      cursor.y,
      "#000",
      currentLineWidth,
    );
  }
  TOOL_MOVED_DETAIL.x = cursor.x;
  TOOL_MOVED_DETAIL.y = cursor.y;
  TOOL_MOVED_DETAIL.width = currentLineWidth;
  TOOL_MOVED_DETAIL.emoji = currentTool === "sticker" ? currentSticker : null;
  canvas.dispatchEvent(TOOL_MOVED_EVENT);
  canvas.dispatchEvent(new CustomEvent("drawing-changed"));
});

canvas.addEventListener("mouseup", (e) => {
  cursor.active = false;
  currentStroke = null;
  // Clear preview on mouseup: preview is only shown when mouse isn't down
  currentPreview = null;
});

// Also handle mouseleave to end stroke if the user drags out of canvas
canvas.addEventListener("mouseleave", () => {
  cursor.active = false;
  currentStroke = null;
  // Remove preview when cursor leaves the canvas
  currentPreview = null;
});

type Point = { x: number; y: number };

export class BrushStroke {
  points: Point[];
  color: string;
  width: number;

  constructor(startX: number, startY: number, color = "#000", width = 3) {
    this.points = [{ x: startX, y: startY }];
    this.color = color;
    this.width = width;
  }

  // Called by render loop: draw the line on the given 2D context
  display(ctx: CanvasRenderingContext2D) {
    if (this.points.length === 0) return;

    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = this.color;
    ctx.lineWidth = this.width;

    ctx.beginPath();
    const p0 = this.points[0];
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < this.points.length; i++) {
      const p = this.points[i];
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Called by the active command while the user drags.
  drag(x: number, y: number) {
    // Simple append; you could add point thinning, sampling, smoothing here.
    this.points.push({ x, y });
  }

  // Return a shallow serializable representation
  toJSON() {
    return {
      type: "BrushStroke",
      points: this.points,
      color: this.color,
      width: this.width,
    };
  }

  static fromJSON(
    obj: { color?: string; width?: number; points?: Point[] },
  ): BrushStroke {
    const ml = new BrushStroke(0, 0, obj.color, obj.width);
    ml.points = obj.points ?? [];
    return ml;
  }

  // Provide a clone for safe pushing to undo stack
  clone(): BrushStroke {
    const copy = new BrushStroke(0, 0, this.color, this.width);
    copy.points = this.points.map((p) => ({ x: p.x, y: p.y }));
    return copy;
  }
}

// Sticker command: placed as a single object; drag(x,y) repositions it.
export class Decal implements Displayable {
  x: number;
  y: number;
  emoji: string;
  size: number;

  constructor(x: number, y: number, emoji = "👻", size = 24) {
    this.x = x;
    this.y = y;
    this.emoji = emoji;
    this.size = size;
  }

  display(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.font = `${this.size}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(this.emoji, this.x, this.y);
    ctx.restore();
  }

  // Reposition the sticker rather than recording a path
  drag(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  toJSON() {
    return {
      type: "Decal",
      x: this.x,
      y: this.y,
      emoji: this.emoji,
      size: this.size,
    };
  }

  static fromJSON(
    obj: { x?: number; y?: number; emoji?: string; size?: number },
  ) {
    return new Decal(
      obj.x ?? 0,
      obj.y ?? 0,
      obj.emoji ?? "👻",
      obj.size ?? 24,
    );
  }

  clone() {
    return new Decal(this.x, this.y, this.emoji, this.size);
  }
}

// deno-lint-ignore-file no-unused-vars
import "./style.css";

document.body.innerHTML = `
  <h1>Draw the Thing!</h1>

  <div id="sketch-wrap">
    <canvas id="sketchpad" style="border:1px solid black;"></canvas>
    <button style="margin-top:8px;" id="clearBtn">Clear</button>
    <button style="margin-top:8px;" id="undoBtn">Undo</button>
    <button style="margin-top:8px;" id="redoBtn">Redo</button>
    <button style="margin-top:8px;" id="thinBtn">Thin</button>
    <button style="margin-top:8px;" id="thickBtn">Thick</button>
  </div>
`;

const canvas = document.getElementById("sketchpad") as HTMLCanvasElement;
canvas.width = 256;
canvas.height = 256;
document.body.append(canvas);

const ctx = canvas.getContext("2d")!;

const strokes: MarkerLine[] = [];
const redoStrokes: MarkerLine[] = [];
let currentStroke: MarkerLine | null = null;

// Current drawing width (used for new strokes). Keep this separate from ctx so
// existing strokes retain their original width when redrawing.
let currentLineWidth = 1;

const cursor = { active: false, x: 0, y: 0 };

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

const THIN_WIDTH = 1;
const THICK_WIDTH = 5;

let currentTool: "thin" | "thick" = "thin";
currentLineWidth = THIN_WIDTH;

thinBtn.onclick = () => {
  currentTool = "thin";
  currentLineWidth = THIN_WIDTH;
  thinBtn.classList.add("selectedTool");
  thickBtn.classList.remove("selectedTool");
};

thickBtn.onclick = () => {
  currentTool = "thick";
  currentLineWidth = THICK_WIDTH;
  thickBtn.classList.add("selectedTool");
  thinBtn.classList.remove("selectedTool");
};

// Redraw helper: clears canvas and draws all strokes from the model
function redrawAll() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const m of strokes) {
    m.display(ctx);
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

  redoStrokes.length = 0;
  currentStroke = new MarkerLine(cursor.x, cursor.y, "#000", currentLineWidth);
  strokes.push(currentStroke);
  canvas.dispatchEvent(new CustomEvent("drawing-changed"));
});

canvas.addEventListener("mousemove", (e) => {
  if (cursor.active && currentStroke) {
    currentStroke.drag(e.offsetX, e.offsetY);
    cursor.x = e.offsetX;
    cursor.y = e.offsetY;
    canvas.dispatchEvent(new CustomEvent("drawing-changed"));
  }
});

canvas.addEventListener("mouseup", (e) => {
  cursor.active = false;
  currentStroke = null;
});

// Also handle mouseleave to end stroke if the user drags out of canvas
canvas.addEventListener("mouseleave", () => {
  cursor.active = false;
  currentStroke = null;
});

type Point = { x: number; y: number };

export class MarkerLine {
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
      type: "MarkerLine",
      points: this.points,
      color: this.color,
      width: this.width,
    };
  }

  static fromJSON(
    obj: { color?: string; width?: number; points?: Point[] },
  ): MarkerLine {
    const ml = new MarkerLine(0, 0, obj.color, obj.width);
    ml.points = obj.points ?? [];
    return ml;
  }

  // Provide a clone for safe pushing to undo stack
  clone(): MarkerLine {
    const copy = new MarkerLine(0, 0, this.color, this.width);
    copy.points = this.points.map((p) => ({ x: p.x, y: p.y }));
    return copy;
  }
}

// deno-lint-ignore-file no-unused-vars
import "./style.css";

document.body.innerHTML = `
  <h1>Draw the Thing!</h1>

  <div id="sketch-wrap">
    <canvas id="sketchpad" style="border:1px solid black;"></canvas>
    <button style="margin-top:8px;" id="clearBtn">Clear</button>
    <button style="margin-top:8px;" id="undoBtn">Undo</button>
    <button style="margin-top:8px;" id="redoBtn">Redo</button>
  </div>
`;

const canvas = document.getElementById("sketchpad") as HTMLCanvasElement;
canvas.width = 256;
canvas.height = 256;
document.body.append(canvas);

const ctx = canvas.getContext("2d")!;

// Data model: an array of strokes. Each stroke is an array of points { x, y }.
const strokes: Array<Array<{ x: number; y: number }>> = [];
const redoStrokes: Array<Array<{ x: number; y: number }>> = [];
let currentStroke: Array<{ x: number; y: number }> | null = null;

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

// Redraw helper: clears canvas and draws all strokes from the model
function redrawAll() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 1;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = "#000";

  for (const stroke of strokes) {
    if (stroke.length === 0) continue;
    ctx.beginPath();
    ctx.moveTo(stroke[0].x, stroke[0].y);
    for (let i = 1; i < stroke.length; i++) {
      const p = stroke[i];
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
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

  // Start a new stroke and add the first point
  // Starting a new stroke should clear the redo stack (new branch)
  redoStrokes.length = 0;
  currentStroke = [{ x: cursor.x, y: cursor.y }];
  strokes.push(currentStroke);
  // Notify observers (redraw) after the new point
  canvas.dispatchEvent(new CustomEvent("drawing-changed"));
});

canvas.addEventListener("mousemove", (e) => {
  if (cursor.active && currentStroke) {
    // Append new point to the current stroke
    const pt = { x: e.offsetX, y: e.offsetY };
    currentStroke.push(pt);
    // Update cursor
    cursor.x = pt.x;
    cursor.y = pt.y;
    // Notify observers that the drawing changed (causes redraw)
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

import "./style.css";

document.body.innerHTML = `
  <h1>Draw the Thing!</h1>

  <div id="sketch-wrap">
    <canvas id="sketchpad" style="border:1px solid black;"></canvas>
    <button style="margin-top:8px;" id="clearBtn">Clear</button>
  </div>
`;

const canvas = document.getElementById("sketchpad") as HTMLCanvasElement;

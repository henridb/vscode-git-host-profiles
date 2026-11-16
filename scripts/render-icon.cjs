// Export the editable SVG with an isolated headless Chrome/Edge profile.
// No additional npm dependency or changes to the installed browser are needed.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function findBrowser() {
  if (process.env.GHP_BROWSER_PATH) {
    const explicit = path.resolve(process.env.GHP_BROWSER_PATH);
    if (!fs.existsSync(explicit)) throw new Error('GHP_BROWSER_PATH does not point to a browser executable.');
    return explicit;
  }
  const candidates = process.platform === 'win32'
    ? [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]
      .filter(Boolean).flatMap(directory => [
        path.join(directory, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(directory, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ])
    : [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      ...(process.env.PATH || '').split(path.delimiter).flatMap(directory =>
        ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']
          .map(name => path.join(directory, name))),
    ];
  const browser = candidates.find(candidate => fs.existsSync(candidate));
  if (!browser) throw new Error('Install Chrome/Chromium/Edge or set GHP_BROWSER_PATH to its executable.');
  return browser;
}

// This function runs in the browser; its source is embedded in the export page.
async function rasterize(encodedSvg) {
  const result = document.getElementById('result');
  try {
    const svg = new DOMParser().parseFromString(atob(encodedSvg), 'image/svg+xml');
    if (svg.querySelector('parsererror')) throw new Error('The SVG is not valid XML.');
    const background = svg.getElementById('background');
    const viewBox = svg.documentElement.viewBox.baseVal;
    if (!background || viewBox.width !== viewBox.height || viewBox.width <= 0) {
      throw new Error('Expected a square SVG with a background rectangle.');
    }
    const size = 256;
    const image = new Image();
    image.src = 'data:image/svg+xml;base64,' + encodedSvg;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, size, size);

    // Check the whole tile, not a few sample pixels. Ignore a one-pixel band
    // along the rounded outline, where antialiasing intentionally changes alpha.
    const scale = size / viewBox.width;
    const left = (Number(background.getAttribute('x') || 0) - viewBox.x) * scale;
    const top = (Number(background.getAttribute('y') || 0) - viewBox.y) * scale;
    const width = Number(background.getAttribute('width')) * scale;
    const height = Number(background.getAttribute('height')) * scale;
    const radius = Number(background.getAttribute('rx')) * scale;
    const pixels = context.getImageData(0, 0, size, size).data;
    let interiorPixels = 0;
    let exteriorPixels = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = Math.max(left + radius - x - 0.5, 0, x + 0.5 - (left + width - radius));
        const dy = Math.max(top + radius - y - 0.5, 0, y + 0.5 - (top + height - radius));
        const distance = Math.hypot(dx, dy);
        const alpha = pixels[(y * size + x) * 4 + 3];
        if (distance < radius - 1) {
          if (alpha !== 255) throw new Error('Unexpected interior transparency at ' + x + ',' + y);
          interiorPixels++;
        } else if (distance > radius + 1) {
          if (alpha !== 0) throw new Error('Unexpected opaque corner pixel at ' + x + ',' + y);
          exteriorPixels++;
        }
      }
    }
    if (!interiorPixels || !exteriorPixels) throw new Error('The tile geometry could not be checked.');
    result.textContent = JSON.stringify({
      png: canvas.toDataURL('image/png'), interiorPixels, exteriorPixels,
    });
  } catch (error) {
    result.textContent = JSON.stringify({ error: String(error) });
  }
}

function main() {
  const browser = findBrowser();
  const svgPath = path.join(root, 'media', 'icon.svg');
  const destination = path.join(root, 'media', 'icon.png');
  const encoded = fs.readFileSync(svgPath).toString('base64');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-profiles-icon-'));
  try {
    const html = path.join(directory, 'export.html');
    fs.writeFileSync(html, '<!doctype html><meta charset="utf-8"><body>' +
      '<pre id="result">pending</pre><script>(' + rasterize.toString() + ')(' +
      JSON.stringify(encoded) + ');</script></body>');
    const rendered = spawnSync(browser, [
      '--headless', '--disable-gpu', '--disable-extensions', '--disable-background-networking',
      '--disable-component-update', '--no-first-run', '--no-default-browser-check',
      '--user-data-dir=' + path.join(directory, 'browser-profile'),
      '--dump-dom', '--virtual-time-budget=10000', pathToFileURL(html).href,
    ], { encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
    if (rendered.error) throw rendered.error;
    if (rendered.status !== 0) {
      throw new Error('Browser export failed: ' + rendered.stderr.slice(-2000));
    }
    const match = rendered.stdout.match(/<pre id="result">([^<]*)<\/pre>/);
    if (!match || match[1] === 'pending') throw new Error('The browser did not finish rendering the icon.');
    const result = JSON.parse(match[1]);
    if (result.error) throw new Error(result.error);
    fs.writeFileSync(destination, Buffer.from(result.png.split(',')[1], 'base64'));
    console.log('Exported media/icon.png (256 x 256). Verified ' + result.interiorPixels +
      ' opaque interior pixels and ' + result.exteriorPixels + ' transparent exterior pixels.');
  } finally {
    // Delete only the temporary directory created by this invocation.
    if (path.dirname(directory) !== path.resolve(os.tmpdir()) ||
        !path.basename(directory).startsWith('smart-profiles-icon-')) {
      throw new Error('Refusing to remove an unexpected temporary directory.');
    }
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }

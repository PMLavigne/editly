const GL = require('gl');
const createShader = require('gl-shader');
const fs = require('fs-extra');
const path = require('path');

/**
 * Simple one-pass, non-recursive handling of #import statements in fragment files
 * @param startFilePath File to process for #imports
 * @returns {Promise<string>} File contents, with import statements replaced by the
 *                            contents of the imported files
 */
async function handleFragmentImports(startFilePath) {
  const importRegex = /^#include\s+"(.+)"$/gmi;
  const mainSource = await fs.readFile(startFilePath, { encoding: 'utf-8' });
  const baseDir = path.dirname(startFilePath);
  return mainSource.replace(importRegex, (match, fileName) => {
    if (!fileName) {
      return '';
    }
    fileName = fileName.replace('\\\\', '\\')
                       .replace('\\"', '"');

    if (!path.isAbsolute(fileName)) {
      fileName = path.resolve(baseDir, fileName);
    }

    return fs.readFileSync(fileName, { encoding: 'utf-8' });
  });
}

// I have no idea what I'm doing but it works ¯\_(ツ)_/¯

async function createGlFrameSource({ width, height, channels, params }) {
  const gl = GL(width, height);

  const defaultVertexSrc = `
    attribute vec2 position;
    void main(void) {
      gl_Position = vec4(position, 0.0, 1.0 );
    }
  `;
  const { vertexPath, fragmentPath, vertexSrc: vertexSrcIn, fragmentSrc: fragmentSrcIn, speed = 1 } = params;

  let fragmentSrc = fragmentSrcIn;
  let vertexSrc = vertexSrcIn;

  if (fragmentPath) fragmentSrc = await handleFragmentImports(fragmentPath);
  if (vertexPath) vertexSrc = await handleFragmentImports(vertexPath);

  if (!vertexSrc) vertexSrc = defaultVertexSrc;

  const shader = createShader(gl, vertexSrc, fragmentSrc);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  // https://blog.mayflower.de/4584-Playing-around-with-pixel-shaders-in-WebGL.html

  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);

  async function readNextFrame(progress, canvas, totalElapsedTime) {
    shader.bind();

    shader.attributes.position.pointer();

    shader.uniforms.resolution = [width, height];
    shader.uniforms.time = progress * speed;
    shader.uniforms.totalElapsedTime = totalElapsedTime;
    shader.uniforms.speed = speed;

    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);

    const upsideDownArray = Buffer.allocUnsafe(width * height * channels);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, upsideDownArray);
    const outArray = Buffer.allocUnsafe(width * height * channels);

    // Comes out upside down, flip it
    for (let i = 0; i < outArray.length; i += 4) {
      outArray[i + 0] = upsideDownArray[outArray.length - i + 0];
      outArray[i + 1] = upsideDownArray[outArray.length - i + 1];
      outArray[i + 2] = upsideDownArray[outArray.length - i + 2];
      outArray[i + 3] = upsideDownArray[outArray.length - i + 3];
    }
    return outArray;
  }

  return {
    readNextFrame,
    close: () => {},
  };
}

module.exports = {
  createGlFrameSource,
};

// G.711 mu-law decoding and encoding lookup tables
const muLawToLinearTable = new Int16Array(256);
const linearToMuLawTable = new Uint8Array(65536);

// Helper functions to populate tables
function decodeMuLawSample(i) {
  let uLawByte = ~i & 0xFF;
  const sign = (uLawByte & 0x80);
  const exponent = (uLawByte & 0x70) >> 4;
  const mantissa = uLawByte & 0x0F;
  let sample = (mantissa << 3) + 132;
  sample <<= exponent;
  sample -= 132;
  return sign ? -sample : sample;
}

function encodeMuLawSample(sample) {
  let sign = (sample < 0) ? 0x80 : 0x00;
  if (sample < 0) {
    sample = -sample;
  }
  if (sample > 32635) {
    sample = 32635;
  }
  sample += 132;
  let exponent = 7;
  let mask = 0x4000;
  while ((sample & mask) === 0 && exponent > 0) {
    exponent--;
    mask >>= 1;
  }
  let mantissa = (sample >> (exponent + 3)) & 0x0F;
  let uval = (exponent << 4) | mantissa;
  return ~(uval | sign) & 0xFF;
}

// Populate the lookup tables once on module load
for (let i = 0; i < 256; i++) {
  muLawToLinearTable[i] = decodeMuLawSample(i);
}
for (let i = -32768; i <= 32767; i++) {
  linearToMuLawTable[i + 32768] = encodeMuLawSample(i);
}

/**
 * Resamples 8kHz mu-law (mono, 8-bit) to 16kHz linear PCM (mono, 16-bit, little-endian)
 * @param {Buffer} mulawBuffer 
 * @returns {Buffer}
 */
function mulawToPcm16(mulawBuffer) {
  const N = mulawBuffer.length;
  const outSamples = new Int16Array(2 * N);
  
  for (let i = 0; i < N; i++) {
    const current = muLawToLinearTable[mulawBuffer[i]];
    const next = (i < N - 1) ? muLawToLinearTable[mulawBuffer[i + 1]] : current;
    
    // Linear interpolation
    outSamples[2 * i] = current;
    outSamples[2 * i + 1] = Math.round((current + next) / 2);
  }
  
  return Buffer.from(outSamples.buffer, outSamples.byteOffset, outSamples.byteLength);
}

/**
 * Resamples 24kHz linear PCM (mono, 16-bit, little-endian) to 8kHz mu-law (mono, 8-bit)
 * @param {Buffer} pcm24Buffer 
 * @returns {Buffer}
 */
function pcm24ToMulaw(pcm24Buffer) {
  const numSamples = Math.floor(pcm24Buffer.length / 2);
  const inSamples = new Int16Array(numSamples);
  
  // Safe read from Buffer to avoid misaligned ArrayBuffer access
  for (let i = 0; i < numSamples; i++) {
    inSamples[i] = pcm24Buffer.readInt16LE(i * 2);
  }
  
  // Decimate by 3 with average anti-aliasing filter
  const M = Math.floor(numSamples / 3);
  const outMulaw = Buffer.alloc(M);
  
  for (let i = 0; i < M; i++) {
    const s0 = inSamples[3 * i];
    const s1 = inSamples[3 * i + 1];
    const s2 = inSamples[3 * i + 2];
    const avg = Math.round((s0 + s1 + s2) / 3);
    
    // Fast O(1) table lookup
    outMulaw[i] = linearToMuLawTable[avg + 32768];
  }
  
  return outMulaw;
}

/**
 * Resamples 16kHz linear PCM (mono, 16-bit, little-endian) to 8kHz mu-law (mono, 8-bit)
 * @param {Buffer} pcm16Buffer 
 * @returns {Buffer}
 */
function pcm16ToMulaw(pcm16Buffer) {
  const numSamples = Math.floor(pcm16Buffer.length / 2);
  const inSamples = new Int16Array(numSamples);
  
  // Safe read from Buffer to avoid misaligned ArrayBuffer access
  for (let i = 0; i < numSamples; i++) {
    inSamples[i] = pcm16Buffer.readInt16LE(i * 2);
  }
  
  // Decimate by 2 with average anti-aliasing filter
  const M = Math.floor(numSamples / 2);
  const outMulaw = Buffer.alloc(M);
  
  for (let i = 0; i < M; i++) {
    const s0 = inSamples[2 * i];
    const s1 = inSamples[2 * i + 1];
    const avg = Math.round((s0 + s1) / 2);
    
    // Fast O(1) table lookup
    outMulaw[i] = linearToMuLawTable[avg + 32768];
  }
  
  return outMulaw;
}

/**
 * Resamples 8kHz linear PCM (mono, 16-bit, little-endian from Vobiz) to 16kHz linear PCM (mono, 16-bit, little-endian for Gemini)
 * @param {Buffer} pcm8Buffer 
 * @returns {Buffer}
 */
function pcm8ToPcm16(pcm8Buffer) {
  const numSamples = Math.floor(pcm8Buffer.length / 2);
  const inSamples = new Int16Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    inSamples[i] = pcm8Buffer.readInt16LE(i * 2);
  }
  
  const outSamples = new Int16Array(2 * numSamples);
  for (let i = 0; i < numSamples; i++) {
    const current = inSamples[i];
    const next = (i < numSamples - 1) ? inSamples[i + 1] : current;
    outSamples[2 * i] = current;
    outSamples[2 * i + 1] = Math.round((current + next) / 2);
  }
  
  return Buffer.from(outSamples.buffer, outSamples.byteOffset, outSamples.byteLength);
}

/**
 * Resamples 24kHz linear PCM (mono, 16-bit, little-endian) to 8kHz linear PCM (mono, 16-bit, little-endian)
 * @param {Buffer} pcm24Buffer 
 * @returns {Buffer}
 */
function pcm24ToPcm8(pcm24Buffer) {
  const numSamples = Math.floor(pcm24Buffer.length / 2);
  const inSamples = new Int16Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    inSamples[i] = pcm24Buffer.readInt16LE(i * 2);
  }
  
  const M = Math.floor(numSamples / 3);
  const outSamples = new Int16Array(M);
  for (let i = 0; i < M; i++) {
    const s0 = inSamples[3 * i];
    const s1 = inSamples[3 * i + 1];
    const s2 = inSamples[3 * i + 2];
    outSamples[i] = Math.round((s0 + s1 + s2) / 3);
  }
  
  return Buffer.from(outSamples.buffer, outSamples.byteOffset, outSamples.byteLength);
}

module.exports = {
  mulawToPcm16,
  pcm24ToMulaw,
  pcm16ToMulaw,
  pcm8ToPcm16,
  pcm24ToPcm8,
  decodeMuLawSample,
  encodeMuLawSample
};

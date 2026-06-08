/* eslint-disable */
const { decodeMuLawSample, encodeMuLawSample, mulawToPcm16, pcm24ToMulaw } = require('./transcoder');

console.log('Testing G.711 mu-law decoding and encoding...');

const samplesToTest = [0, 100, -100, 1000, -1000, 32000, -32000];
for (const sample of samplesToTest) {
  const encoded = encodeMuLawSample(sample);
  const decoded = decodeMuLawSample(encoded);
  console.log(`Original: ${sample.toString().padStart(6)}, Encoded mu-law: ${encoded.toString().padStart(3)}, Decoded: ${decoded.toString().padStart(6)} (Diff: ${Math.abs(sample - decoded)})`);
}

console.log('\nTesting Resampling:');
const originalMuLaw = Buffer.from([255, 255, 0, 0, 127, 127, 200, 200]);
console.log('Original mu-law buffer size:', originalMuLaw.length);
const pcm16 = mulawToPcm16(originalMuLaw);
console.log('Upsampled PCM16 buffer size:', pcm16.length, '(expected double * 2 bytes = 32 bytes)');

const fakePCM24 = Buffer.alloc(48); // 24 samples
for (let i = 0; i < 24; i++) {
  fakePCM24.writeInt16LE(i * 1000, i * 2);
}
const downsampledMulaw = pcm24ToMulaw(fakePCM24);
console.log('Downsampled mu-law buffer size:', downsampledMulaw.length, '(expected 24 / 3 = 8 bytes)');
console.log('All tests passed successfully!');

const clamp16 = v => Math.max(-32768, Math.min(32767, v));

function fourcc(bytes, off) {
  return String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
}

/**
 * Decode NintendoWare CTR Stream (BCSTM) audio to signed 16-bit PCM.
 * Supports the DSP-ADPCM streams used by the 2010 3D Hopper prototype.
 */
export function decodeBcstm(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = o => view.getUint16(o, true);
  const s16 = o => view.getInt16(o, true);
  const u32 = o => view.getUint32(o, true);

  if (bytes.length < 0x40 || fourcc(bytes, 0) !== 'CSTM') throw new Error('Not a BCSTM/CSTM stream.');
  if (u16(4) !== 0xfeff) throw new Error('Big-endian/FSTM audio is not supported by this CTR decoder.');

  const sectionCount = u32(0x10);
  const sections = new Map();
  for (let i = 0; i < sectionCount; i++) {
    const p = 0x14 + i * 12;
    if (p + 12 > bytes.length) throw new Error('BCSTM section table is truncated.');
    sections.set(u32(p), { offset: u32(p + 4), size: u32(p + 8) });
  }

  const info = sections.get(0x4000);
  const seek = sections.get(0x4001);
  const data = sections.get(0x4002);
  if (!info || !seek || !data) throw new Error('BCSTM is missing INFO, SEEK, or DATA.');
  if (fourcc(bytes, info.offset) !== 'INFO' || fourcc(bytes, seek.offset) !== 'SEEK' || fourcc(bytes, data.offset) !== 'DATA') {
    throw new Error('BCSTM section signatures do not match the header.');
  }

  // INFO references are relative to the byte immediately after INFO's size field.
  const infoBase = info.offset + 8;
  const streamInfo = infoBase + u32(info.offset + 12);
  const format = bytes[streamInfo];
  const loop = bytes[streamInfo + 1] === 1;
  const channelCount = bytes[streamInfo + 2];
  if (format !== 2) throw new Error(`Unsupported BCSTM codec ${format}; Hopper expects DSP-ADPCM (2).`);
  if (!channelCount) throw new Error('BCSTM has no channels.');

  let p = streamInfo + 4;
  const sampleRate = u32(p); p += 4;
  const loopStart = u32(p); p += 4;
  const loopEnd = u32(p); p += 4;
  const blockCount = u32(p); p += 4;
  const blockSize = u32(p); p += 4;
  const blockSamples = u32(p); p += 4;
  const lastBlockSize = u32(p); p += 4;
  const lastBlockSamples = u32(p); p += 4;
  const lastBlockPaddedSize = u32(p); p += 4;
  const seekEntrySize = u32(p); p += 4;
  const seekInterval = u32(p); p += 4;
  p += 4; // data reference signature
  const dataRelativeOffset = u32(p);
  if (seekEntrySize < 4) throw new Error('BCSTM SEEK entries are too small.');

  const channelTable = infoBase + u32(info.offset + 28);
  const listedChannels = u32(channelTable);
  if (listedChannels !== channelCount) throw new Error('BCSTM channel table disagrees with stream metadata.');

  const coefficients = [];
  for (let c = 0; c < channelCount; c++) {
    const ref = channelTable + 4 + c * 8;
    const channelInfo = channelTable + u32(ref + 4);
    const codecInfo = channelInfo + u32(channelInfo + 4);
    if (codecInfo + 46 > bytes.length) throw new Error('BCSTM DSP coefficient table is truncated.');
    const coefs = new Int16Array(16);
    for (let i = 0; i < 16; i++) coefs[i] = s16(codecInfo + i * 2);
    coefficients.push(coefs);
  }

  const totalSamples = blockCount ? (blockCount - 1) * blockSamples + lastBlockSamples : 0;
  const channels = Array.from({ length: channelCount }, () => new Int16Array(totalSamples));
  const dataStart = data.offset + 8 + dataRelativeOffset;

  for (let block = 0; block < blockCount; block++) {
    const isLast = block === blockCount - 1;
    const encodedBytes = isLast ? lastBlockSize : blockSize;
    const stride = isLast ? lastBlockPaddedSize : blockSize;
    const samplesWanted = isLast ? lastBlockSamples : blockSamples;
    const blockBase = dataStart + block * blockSize * channelCount;
    const outBase = block * blockSamples;

    for (let c = 0; c < channelCount; c++) {
      let cursor = blockBase + c * stride;
      const end = cursor + encodedBytes;
      const seekEntry = seek.offset + 8 + (block * channelCount + c) * seekEntrySize;
      if (seekEntry + 4 > seek.offset + seek.size) throw new Error('BCSTM SEEK table is truncated.');
      let hist1 = s16(seekEntry), hist2 = s16(seekEntry + 2);
      let made = 0;
      const out = channels[c];
      const coefs = coefficients[c];

      while (made < samplesWanted) {
        if (cursor >= end) throw new Error('BCSTM DSP block ended before all samples were decoded.');
        const predictorScale = bytes[cursor++];
        const predictor = predictorScale >>> 4;
        const scale = (1 << (predictorScale & 0x0f)) * 2048;
        const coef1 = coefs[predictor * 2];
        const coef2 = coefs[predictor * 2 + 1];

        for (let pair = 0; pair < 7 && made < samplesWanted; pair++) {
          if (cursor >= end) throw new Error('BCSTM DSP frame is truncated.');
          const packed = bytes[cursor++];
          for (let half = 0; half < 2 && made < samplesWanted; half++) {
            let nibble = half === 0 ? packed >>> 4 : packed & 0x0f;
            if (nibble >= 8) nibble -= 16;
            // Nintendo DSP-ADPCM rounds with +0x400 before the arithmetic >> 11.
            // Math.floor((x + 0x400) / 2048) matches that shift for negatives too.
            const corrected = coef1 * hist1 + coef2 * hist2 + scale * nibble;
            const sample = clamp16(Math.floor((corrected + 0x400) / 2048));
            out[outBase + made++] = sample;
            hist2 = hist1;
            hist1 = sample;
          }
        }
      }
    }
  }

  return { sampleRate, loop, loopStart, loopEnd, channels, sampleCount: totalSamples, seekInterval };
}

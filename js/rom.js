const td = new TextDecoder();

function u16(v, o) { return v.getUint16(o, true); }
function u32(v, o) { return v.getUint32(o, true); }

function ascii(bytes, off, len) {
  return String.fromCharCode(...bytes.subarray(off, off + len));
}

export class HopperRom {
  constructor(buffer) {
    this.buffer = buffer;
    this.bytes = new Uint8Array(buffer);
    this.view = new DataView(buffer);
    this.files = new Map();
    this.meta = {};
    this.#parse();
  }

  #parse() {
    if (this.bytes.length < 0x200 || ascii(this.bytes, 0x100, 4) !== 'NCCH') {
      throw new Error('This is not a Nintendo 3DS NCCH/CXI .app image.');
    }

    const header = this.view;
    const rawRomfsOffset = u32(header, 0x1B0);
    const rawRomfsSize = u32(header, 0x1B4);
    const flags = this.bytes.subarray(0x188, 0x190);
    const mediaUnit = 0x200 << flags[6];

    const candidates = [
      [rawRomfsOffset, rawRomfsSize, 'prototype byte offsets'],
      [rawRomfsOffset * mediaUnit, rawRomfsSize * mediaUnit, 'standard media units'],
    ];

    let found = null;
    for (const [off, size, mode] of candidates) {
      if (off >= 0 && size > 0 && off + size <= this.bytes.length && ascii(this.bytes, off, 4) === 'ROFS') {
        found = { off, size, mode };
        break;
      }
    }
    if (!found) {
      throw new Error('No early-3DS ROFS filesystem was found in this image.');
    }

    this.meta = {
      ncchVersion: u16(header, 0x112),
      productCode: td.decode(this.bytes.subarray(0x150, 0x160)).replace(/\0+$/, ''),
      romfsOffset: found.off,
      romfsSize: found.size,
      offsetMode: found.mode,
    };

    this.#parseRofs(found.off, found.size);
  }

  #parseRofs(rofsOffset, rofsSize) {
    const rofs = this.bytes.subarray(rofsOffset, rofsOffset + rofsSize);
    const view = new DataView(rofs.buffer, rofs.byteOffset, rofs.byteLength);
    if (ascii(rofs, 0, 4) !== 'ROFS') throw new Error('ROFS magic mismatch.');

    const headerSize = u32(view, 0x08);
    const fdiOffset = u32(view, 0x0C);
    const fdiSize = u32(view, 0x14);
    const bodyOffset = headerSize;
    const fdiCount = Math.floor(fdiSize / 8);

    const readFse = (index) => {
      const o = bodyOffset + index * 8;
      if (o + 8 > rofs.length) throw new Error(`Bad ROFS directory index ${index}.`);
      return {
        entryDataOffset: u32(view, o),
        startingFdiIndex: u16(view, o + 4),
        parentOrCount: rofs[o + 6],
        unknown: rofs[o + 7],
      };
    };

    const readFdi = (index) => {
      if (index < 0 || index >= fdiCount) throw new Error(`Bad ROFS file index ${index}.`);
      const o = bodyOffset + fdiOffset + index * 8;
      return { start: u32(view, o), end: u32(view, o + 4) };
    };

    const visited = new Set();
    const walk = (prefix, dirIndex) => {
      const guardKey = `${prefix}:${dirIndex}`;
      if (visited.has(guardKey)) return;
      visited.add(guardKey);
      const fse = readFse(dirIndex);
      let p = bodyOffset + fse.entryDataOffset;
      let fdiIndex = fse.startingFdiIndex;
      let entries = 0;
      while (p < rofs.length) {
        const control = rofs[p++];
        if (control === 0) break;
        const isDir = (control & 0x80) !== 0;
        const nameLen = control & 0x7F;
        if (p + nameLen > rofs.length) throw new Error('ROFS entry name runs past the image.');
        const name = td.decode(rofs.subarray(p, p + nameLen));
        p += nameLen;
        if (isDir) {
          if (p + 2 > rofs.length) throw new Error('ROFS directory entry is truncated.');
          const child = u16(view, p) & 0x0FFF;
          p += 2;
          walk(`${prefix}${name}/`, child);
        } else {
          const { start, end } = readFdi(fdiIndex++);
          if (start > end || end > rofs.length) throw new Error(`ROFS file ${prefix}${name} has invalid bounds.`);
          this.files.set(`${prefix}${name}`, rofs.subarray(start, end));
        }
        if (++entries > 100000) throw new Error('ROFS entry loop guard tripped.');
      }
    };

    walk('', 0);
  }

  has(path) { return this.files.has(path); }
  get(path) {
    const f = this.files.get(path);
    if (!f) throw new Error(`ROM asset not found: ${path}`);
    return f;
  }
  list(prefix = '') { return [...this.files.keys()].filter((p) => p.startsWith(prefix)).sort(); }
}

export async function loadHopperRom(file) {
  const buffer = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  return new HopperRom(buffer);
}

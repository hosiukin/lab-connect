// Minimal ZIP writer (store method, UTF-8 names, Unix modes).
// No dependencies: runs in the browser and in Node 18+.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((date.getSeconds() & 0x1f) >> 1);
  const day =
    (((year - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f);
  return { time, day };
}

class Writer {
  constructor() {
    this.chunks = [];
    this.length = 0;
  }
  bytes(data) {
    this.chunks.push(data);
    this.length += data.length;
  }
  u16(value) {
    this.bytes(new Uint8Array([value & 0xff, (value >>> 8) & 0xff]));
  }
  u32(value) {
    this.bytes(
      new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]),
    );
  }
  concat() {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

/**
 * @param {{name: string, text: string, mode?: number}[]} files
 * @param {Date} [date]
 * @returns {Uint8Array}
 */
export function makeZip(files, date = new Date()) {
  const encoder = new TextEncoder();
  const { time, day } = dosDateTime(date);
  const local = new Writer();
  const central = new Writer();
  const entries = [];

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.text);
    const crc = crc32(data);
    const mode = (file.mode ?? 0o644) & 0xffff;
    const offset = local.length;

    local.u32(0x04034b50);
    local.u16(20);
    local.u16(0x0800);
    local.u16(0);
    local.u16(time);
    local.u16(day);
    local.u32(crc);
    local.u32(data.length);
    local.u32(data.length);
    local.u16(name.length);
    local.u16(0);
    local.bytes(name);
    local.bytes(data);

    entries.push({ name, crc, size: data.length, offset, mode });
  }

  for (const entry of entries) {
    central.u32(0x02014b50);
    central.u16(0x0314); // made by Unix, version 2.0
    central.u16(20);
    central.u16(0x0800);
    central.u16(0);
    central.u16(time);
    central.u16(day);
    central.u32(entry.crc);
    central.u32(entry.size);
    central.u32(entry.size);
    central.u16(entry.name.length);
    central.u16(0);
    central.u16(0);
    central.u16(0);
    central.u16(0);
    central.u32((entry.mode << 16) >>> 0);
    central.u32(entry.offset);
    central.bytes(entry.name);
  }

  const centralBytes = central.concat();
  const eocd = new Writer();
  eocd.u32(0x06054b50);
  eocd.u16(0);
  eocd.u16(0);
  eocd.u16(entries.length);
  eocd.u16(entries.length);
  eocd.u32(centralBytes.length);
  eocd.u32(local.length);
  eocd.u16(0);

  const out = new Uint8Array(local.length + centralBytes.length + eocd.length);
  out.set(local.concat(), 0);
  out.set(centralBytes, local.length);
  out.set(eocd.concat(), local.length + centralBytes.length);
  return out;
}

export function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
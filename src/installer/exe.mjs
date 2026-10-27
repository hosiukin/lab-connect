// Builds a single-file Windows .exe by appending the configured PowerShell
// installer to a precompiled NSIS launcher. The launcher reads the footer,
// copies the payload to %TEMP%, and runs it with Windows PowerShell.

import {base64ToBytes} from "./zip.mjs";

const FOOTER_MAGIC = "SPRK";
const FOOTER_SIZE = 13; // 4-byte magic + 8 decimal digits + LF

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * @param {string} stubBase64 base64 of assets/spark-install-stub.exe
 * @param {string} script PowerShell installer text
 * @returns {Uint8Array}
 */
export function buildWindowsExe(stubBase64, script) {
  if (!stubBase64) throw new Error("Windows stub is missing");
  const stub = base64ToBytes(stubBase64);
  if (stub.length < 2 || stub[0] !== 0x4d || stub[1] !== 0x5a) {
    throw new Error("Windows stub is not a PE executable");
  }
  const text = "\uFEFF" + String(script).replace(/\r?\n/g, "\r\n");
  const payload = new TextEncoder().encode(text);
  if (payload.length > 99_999_999) throw new Error("Windows payload is too large");
  const footer = new TextEncoder().encode(
    FOOTER_MAGIC + String(payload.length).padStart(8, "0") + "\n",
  );
  return concatBytes([stub, payload, footer]);
}

/**
 * Test/diagnostic helper: split a generated EXE back into stub + script.
 * @param {Uint8Array} bytes
 * @returns {{stub: Uint8Array, script: string}}
 */
export function splitWindowsExe(bytes) {
  if (bytes.length < FOOTER_SIZE + 2 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
    throw new Error("not a PE file");
  }
  const footerStart = bytes.length - FOOTER_SIZE;
  const footer = new TextDecoder().decode(bytes.subarray(footerStart));
  if (!footer.startsWith(FOOTER_MAGIC) || !footer.endsWith("\n")) {
    throw new Error("missing Spark payload footer");
  }
  const digits = footer.slice(4, 12);
  if (!/^\d{8}$/.test(digits)) throw new Error("bad Spark payload length");
  const length = Number(digits);
  const payloadStart = footerStart - length;
  if (payloadStart < 2) throw new Error("bad Spark payload offset");
  return {
    stub: bytes.subarray(0, payloadStart),
    // ignoreBOM keeps the UTF-8 BOM in the returned string; Windows
    // PowerShell 5.1 needs those bytes in the temporary .ps1 file.
    script: new TextDecoder("utf-8", {ignoreBOM: true}).decode(bytes.subarray(payloadStart, footerStart)),
  };
}

/**
 * Minimal, dependency-free ZIP reader (central-directory based).
 * Used for Office Open XML (.docx/.xlsx/.pptx), OpenDocument, and EPUB.
 */

import { inflateRawSync } from 'zlib';

export interface ZipEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  method: number;
  localHeaderOffset: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

export class ZipReader {
  private entries = new Map<string, ZipEntry>();

  constructor(private buf: Buffer) {
    this.parseCentralDirectory();
    if (this.entries.size === 0) this.parseLocalHeadersFallback();
  }

  names(): string[] {
    return Array.from(this.entries.keys());
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  read(name: string): Buffer | null {
    const e = this.entries.get(name);
    if (!e) return null;
    const b = this.buf;
    const off = e.localHeaderOffset;
    if (off + 30 > b.length || b.readUInt32LE(off) !== SIG_LOC) return null;
    const nameLen = b.readUInt16LE(off + 26);
    const extraLen = b.readUInt16LE(off + 28);
    const dataStart = off + 30 + nameLen + extraLen;
    const data = b.subarray(dataStart, dataStart + e.compressedSize);
    try {
      if (e.method === 0) return Buffer.from(data);
      if (e.method === 8) return inflateRawSync(data);
    } catch {
      return null;
    }
    return null;
  }

  readText(name: string): string | null {
    const b = this.read(name);
    return b ? b.toString('utf8') : null;
  }

  private parseCentralDirectory(): void {
    const b = this.buf;
    // Find EOCD (search backwards, allow up to 64KB comment)
    const minPos = Math.max(0, b.length - 22 - 65_536);
    let eocd = -1;
    for (let i = b.length - 22; i >= minPos; i--) {
      if (b.readUInt32LE(i) === SIG_EOCD) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) return;
    const count = b.readUInt16LE(eocd + 10);
    let ptr = b.readUInt32LE(eocd + 16);
    for (let i = 0; i < count && ptr + 46 <= b.length; i++) {
      if (b.readUInt32LE(ptr) !== SIG_CEN) break;
      const method = b.readUInt16LE(ptr + 10);
      const compressedSize = b.readUInt32LE(ptr + 20);
      const uncompressedSize = b.readUInt32LE(ptr + 24);
      const nameLen = b.readUInt16LE(ptr + 28);
      const extraLen = b.readUInt16LE(ptr + 30);
      const commentLen = b.readUInt16LE(ptr + 32);
      const localHeaderOffset = b.readUInt32LE(ptr + 42);
      const name = b.toString('utf8', ptr + 46, ptr + 46 + nameLen);
      this.entries.set(name, { name, compressedSize, uncompressedSize, method, localHeaderOffset });
      ptr += 46 + nameLen + extraLen + commentLen;
    }
  }

  /** Fallback for truncated archives without a central directory. */
  private parseLocalHeadersFallback(): void {
    const b = this.buf;
    let i = 0;
    while (i + 30 <= b.length) {
      if (b.readUInt32LE(i) !== SIG_LOC) {
        i++;
        continue;
      }
      const method = b.readUInt16LE(i + 8);
      const compressedSize = b.readUInt32LE(i + 18);
      const uncompressedSize = b.readUInt32LE(i + 22);
      const nameLen = b.readUInt16LE(i + 26);
      const extraLen = b.readUInt16LE(i + 28);
      const name = b.toString('utf8', i + 30, i + 30 + nameLen);
      this.entries.set(name, { name, compressedSize, uncompressedSize, method, localHeaderOffset: i });
      i = i + 30 + nameLen + extraLen + compressedSize;
      if (compressedSize === 0) i++;
    }
  }
}

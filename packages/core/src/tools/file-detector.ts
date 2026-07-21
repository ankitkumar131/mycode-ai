/**
 * File Type Detector — Magic bytes and extension-based detection
 * Detects PDF, images, and other binary files to prevent garbled readFile output.
 */

import { readFileSync, statSync } from 'fs';

export type FileCategory = 'text' | 'pdf' | 'image' | 'audio' | 'video' | 'binary';

export interface FileInfo {
  category: FileCategory;
  mimeType: string;
  extension: string;
  size: number;
  sizeLabel: string;
}

// Magic byte signatures for common binary formats
const MAGIC_SIGNATURES: Array<{ bytes: number[]; category: FileCategory; mime: string }> = [
  // PDF
  { bytes: [0x25, 0x50, 0x44, 0x46], category: 'pdf', mime: 'application/pdf' },
  // PNG
  { bytes: [0x89, 0x50, 0x4E, 0x47], category: 'image', mime: 'image/png' },
  // JPEG
  { bytes: [0xFF, 0xD8, 0xFF], category: 'image', mime: 'image/jpeg' },
  // GIF87a / GIF89a
  { bytes: [0x47, 0x49, 0x46, 0x38], category: 'image', mime: 'image/gif' },
  // WebP (RIFF...WEBP)
  { bytes: [0x52, 0x49, 0x46, 0x46], category: 'image', mime: 'image/webp' },
  // BMP
  { bytes: [0x42, 0x4D], category: 'image', mime: 'image/bmp' },
  // TIFF (little-endian)
  { bytes: [0x49, 0x49, 0x2A, 0x00], category: 'image', mime: 'image/tiff' },
  // TIFF (big-endian)
  { bytes: [0x4D, 0x4D, 0x00, 0x2A], category: 'image', mime: 'image/tiff' },
  // ZIP / DOCX / XLSX / JAR
  { bytes: [0x50, 0x4B, 0x03, 0x04], category: 'binary', mime: 'application/zip' },
  // EXE / DLL
  { bytes: [0x4D, 0x5A], category: 'binary', mime: 'application/x-executable' },
  // MP3 (ID3)
  { bytes: [0x49, 0x44, 0x33], category: 'audio', mime: 'audio/mpeg' },
  // MP4 (ftyp)
  { bytes: [0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70], category: 'video', mime: 'video/mp4' },
  // WAV
  { bytes: [0x52, 0x49, 0x46, 0x46], category: 'audio', mime: 'audio/wav' },
];

// Extension-based fallback mapping
const EXTENSION_MAP: Record<string, { category: FileCategory; mime: string }> = {
  '.pdf': { category: 'pdf', mime: 'application/pdf' },
  '.png': { category: 'image', mime: 'image/png' },
  '.jpg': { category: 'image', mime: 'image/jpeg' },
  '.jpeg': { category: 'image', mime: 'image/jpeg' },
  '.gif': { category: 'image', mime: 'image/gif' },
  '.webp': { category: 'image', mime: 'image/webp' },
  '.bmp': { category: 'image', mime: 'image/bmp' },
  '.tiff': { category: 'image', mime: 'image/tiff' },
  '.svg': { category: 'image', mime: 'image/svg+xml' },
  '.ico': { category: 'image', mime: 'image/x-icon' },
  '.mp3': { category: 'audio', mime: 'audio/mpeg' },
  '.wav': { category: 'audio', mime: 'audio/wav' },
  '.ogg': { category: 'audio', mime: 'audio/ogg' },
  '.mp4': { category: 'video', mime: 'video/mp4' },
  '.avi': { category: 'video', mime: 'video/x-msvideo' },
  '.mov': { category: 'video', mime: 'video/quicktime' },
  '.zip': { category: 'binary', mime: 'application/zip' },
  '.tar': { category: 'binary', mime: 'application/x-tar' },
  '.gz': { category: 'binary', mime: 'application/gzip' },
  '.rar': { category: 'binary', mime: 'application/x-rar-compressed' },
  '.7z': { category: 'binary', mime: 'application/x-7z-compressed' },
  '.exe': { category: 'binary', mime: 'application/x-executable' },
  '.dll': { category: 'binary', mime: 'application/x-sharedlib' },
  '.so': { category: 'binary', mime: 'application/x-sharedlib' },
  '.wasm': { category: 'binary', mime: 'application/wasm' },
  '.bin': { category: 'binary', mime: 'application/octet-stream' },
  '.dat': { category: 'binary', mime: 'application/octet-stream' },
  '.docx': { category: 'binary', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  '.xlsx': { category: 'binary', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  '.pptx': { category: 'binary', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
};

/**
 * Detect the type of a file by magic bytes first, then extension fallback.
 */
export function detectFileType(filePath: string): FileInfo {
  const ext = filePath.match(/\.[^.]+$/)?.[0]?.toLowerCase() || '';
  let size = 0;

  try {
    size = statSync(filePath).size;
  } catch {
    // Ignore stat errors
  }

  // Try magic bytes first
  try {
    const buffer = Buffer.alloc(16);
    const fd = require('fs').openSync(filePath, 'r');
    require('fs').readSync(fd, buffer, 0, 16, 0);
    require('fs').closeSync(fd);

    for (const sig of MAGIC_SIGNATURES) {
      let match = true;
      for (let i = 0; i < sig.bytes.length; i++) {
        if (buffer[i] !== sig.bytes[i]) {
          match = false;
          break;
        }
      }
      if (match) {
        return {
          category: sig.category,
          mimeType: sig.mime,
          extension: ext,
          size,
          sizeLabel: formatBytes(size),
        };
      }
    }
  } catch {
    // Fall through to extension-based detection
  }

  // Extension-based fallback
  const extInfo = EXTENSION_MAP[ext];
  if (extInfo) {
    return {
      category: extInfo.category,
      mimeType: extInfo.mime,
      extension: ext,
      size,
      sizeLabel: formatBytes(size),
    };
  }

  // Default to text
  return {
    category: 'text',
    mimeType: 'text/plain',
    extension: ext,
    size,
    sizeLabel: formatBytes(size),
  };
}

/**
 * Quick check: is this file binary?
 */
export function isBinaryFile(filePath: string): boolean {
  const info = detectFileType(filePath);
  return info.category !== 'text';
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Built-in document text extraction — no external binaries.
 *
 * Supported:
 *   PDF                      (.pdf)                       via pdf-parse (bundled dependency)
 *   Word                     (.docx, .docm, .dotx)        OOXML
 *   Excel                    (.xlsx, .xlsm)               OOXML — every sheet, shared strings, inline strings
 *   PowerPoint               (.pptx, .ppsx)               OOXML — slides + speaker notes
 *   OpenDocument             (.odt, .ods, .odp)
 *   EPUB                     (.epub)
 *   Rich Text                (.rtf)
 *   HTML/XML                 (.html, .htm, .xhtml, .xml, .svg)
 *   Delimited                (.csv, .tsv)
 *   Jupyter                  (.ipynb)
 *   Plain / code             everything else that is valid UTF-8
 *
 * Legacy binary Office (.doc/.xls/.ppt) get a best-effort string scrape.
 */

import { readFileSync, statSync } from 'fs';
import { basename, extname } from 'path';
import { ZipReader } from './zip.js';

export interface DocumentSection {
  /** Page / slide / sheet / chapter label, e.g. "Page 3", "Sheet: Sales" */
  label: string;
  text: string;
}

export interface ExtractedDocument {
  format: string;
  file: string;
  sizeBytes: number;
  sections: DocumentSection[];
  metadata: Record<string, string>;
  /** Warnings encountered (e.g. scanned PDF, unsupported parts) */
  warnings: string[];
}

export const DOCUMENT_EXTENSIONS = new Set([
  '.pdf', '.docx', '.docm', '.dotx', '.doc', '.xlsx', '.xlsm', '.xls', '.pptx', '.ppsx', '.ppt',
  '.odt', '.ods', '.odp', '.epub', '.rtf', '.html', '.htm', '.xhtml', '.csv', '.tsv', '.ipynb',
]);

export function isDocumentFile(path: string): boolean {
  return DOCUMENT_EXTENSIONS.has(extname(path).toLowerCase());
}

// ─── XML helpers ─────────────────────────────────────────────────────────────

const ENTITY_MAP: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeXmlEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITY_MAP[e.toLowerCase()] ?? m;
  });
}

function stripTags(s: string): string {
  return decodeXmlEntities(s.replace(/<[^>]+>/g, ''));
}

function collapse(s: string): string {
  return s
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── DOCX ────────────────────────────────────────────────────────────────────

function extractDocx(zip: ZipReader): { sections: DocumentSection[]; warnings: string[] } {
  const warnings: string[] = [];
  const xml = zip.readText('word/document.xml');
  if (!xml) return { sections: [], warnings: ['word/document.xml missing'] };

  const body = xml
    // Tables: cells separated by tab, rows by newline
    .replace(/<\/w:tc>/g, '\t')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<w:cr\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n');

  // Headings → markdown-ish
  const paras = body.split('\n').map(p => {
    const style = p.match(/<w:pStyle w:val="([^"]+)"/)?.[1] ?? '';
    const text = stripTags(p.replace(/<w:t[^>]*>/g, '').replace(/<\/w:t>/g, ''));
    const isList = /<w:numPr>/.test(p);
    const h = style.match(/^Heading(\d)$/i) || style.match(/^Title$/i);
    if (h && text.trim()) return `${'#'.repeat(h[1] ? Number(h[1]) : 1)} ${text.trim()}`;
    if (isList && text.trim()) return `- ${text.trim()}`;
    return text;
  });

  const main = collapse(paras.join('\n'));
  const sections: DocumentSection[] = [{ label: 'Document', text: main }];

  // Footnotes / endnotes / comments
  for (const [part, label] of [
    ['word/footnotes.xml', 'Footnotes'],
    ['word/endnotes.xml', 'Endnotes'],
    ['word/comments.xml', 'Comments'],
  ] as const) {
    const x = zip.readText(part);
    if (!x) continue;
    const t = collapse(stripTags(x.replace(/<\/w:p>/g, '\n')));
    if (t) sections.push({ label, text: t });
  }

  const props = zip.readText('docProps/core.xml');
  return { sections, warnings: warnings.concat(props ? [] : []) };
}

function extractCoreProps(zip: ZipReader): Record<string, string> {
  const meta: Record<string, string> = {};
  const props = zip.readText('docProps/core.xml') || zip.readText('meta.xml');
  if (!props) return meta;
  const grab = (tag: string) => stripTags(props.match(new RegExp(`<[a-z]*:?${tag}[^>]*>([\\s\\S]*?)</[a-z]*:?${tag}>`, 'i'))?.[1] ?? '');
  for (const [k, tag] of [['title', 'title'], ['author', 'creator'], ['created', 'created'], ['modified', 'modified'], ['subject', 'subject']]) {
    const v = grab(tag);
    if (v) meta[k] = v;
  }
  return meta;
}

// ─── XLSX ────────────────────────────────────────────────────────────────────

function colToIndex(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function extractXlsx(zip: ZipReader): { sections: DocumentSection[]; warnings: string[] } {
  const warnings: string[] = [];
  const shared: string[] = [];
  const ss = zip.readText('xl/sharedStrings.xml');
  if (ss) {
    for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      shared.push(stripTags(m[1].replace(/<\/t>/g, '')));
    }
  }

  // Sheet names from workbook.xml + rels
  const wb = zip.readText('xl/workbook.xml') ?? '';
  const rels = zip.readText('xl/_rels/workbook.xml.rels') ?? '';
  const relMap = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) relMap.set(m[1], m[2]);
  for (const m of rels.matchAll(/<Relationship[^>]*Target="([^"]+)"[^>]*Id="([^"]+)"/g)) relMap.set(m[2], m[1]);

  const sheets: Array<{ name: string; path: string }> = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const tag = m[0];
    const name = decodeXmlEntities(tag.match(/name="([^"]*)"/)?.[1] ?? 'Sheet');
    const rid = tag.match(/r:id="([^"]+)"/)?.[1] ?? '';
    let target = relMap.get(rid) ?? '';
    if (target && !target.startsWith('xl/')) target = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    if (target) sheets.push({ name, path: target });
  }
  if (sheets.length === 0) {
    sheets.push(
      ...zip
        .names()
        .filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
        .sort()
        .map((p, i) => ({ name: `Sheet${i + 1}`, path: p }))
    );
  }

  const sections: DocumentSection[] = [];
  for (const sh of sheets) {
    const xml = zip.readText(sh.path);
    if (!xml) continue;
    const rows: string[][] = [];
    for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const cm of rm[1].matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cm[1];
        const inner = cm[2] ?? '';
        const ref = attrs.match(/r="([A-Z]+)\d+"/)?.[1];
        const type = attrs.match(/t="([^"]+)"/)?.[1] ?? '';
        let val = '';
        if (type === 's') {
          const idx = parseInt(inner.match(/<v>([^<]*)<\/v>/)?.[1] ?? '', 10);
          val = shared[idx] ?? '';
        } else if (type === 'inlineStr') {
          val = stripTags(inner);
        } else if (type === 'b') {
          val = inner.match(/<v>1<\/v>/) ? 'TRUE' : 'FALSE';
        } else {
          val = decodeXmlEntities(inner.match(/<v>([^<]*)<\/v>/)?.[1] ?? '');
        }
        if (ref) {
          const idx = colToIndex(ref);
          while (cells.length < idx) cells.push('');
          cells[idx] = val;
        } else cells.push(val);
      }
      if (cells.some(c => c !== '')) rows.push(cells);
      if (rows.length > 5000) {
        warnings.push(`${sh.name}: truncated at 5000 rows`);
        break;
      }
    }
    if (rows.length === 0) continue;
    const width = Math.max(...rows.map(r => r.length));
    const table = rows.map(r => {
      const padded = [...r];
      while (padded.length < width) padded.push('');
      return padded.map(c => c.replace(/\|/g, '\\|')).join(' | ');
    });
    // Markdown table header separator after first row
    if (table.length > 1) table.splice(1, 0, Array(width).fill('---').join(' | '));
    sections.push({ label: `Sheet: ${sh.name} (${rows.length} rows)`, text: table.join('\n') });
  }
  return { sections, warnings };
}

// ─── PPTX ────────────────────────────────────────────────────────────────────

function extractPptx(zip: ZipReader): { sections: DocumentSection[]; warnings: string[] } {
  const slides = zip
    .names()
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const sections: DocumentSection[] = [];
  for (const path of slides) {
    const n = path.match(/slide(\d+)\.xml/)![1];
    const xml = zip.readText(path) ?? '';
    const paras: string[] = [];
    for (const pm of xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)) {
      const runs = Array.from(pm[1].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)).map(r => decodeXmlEntities(r[1]));
      const t = runs.join('').trim();
      if (t) paras.push(t);
    }
    let text = paras.join('\n');
    const notes = zip.readText(`ppt/notesSlides/notesSlide${n}.xml`);
    if (notes) {
      const nt = Array.from(notes.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)).map(r => decodeXmlEntities(r[1])).join(' ').trim();
      if (nt) text += `\n\n[Speaker notes] ${nt}`;
    }
    if (text.trim()) sections.push({ label: `Slide ${n}`, text: collapse(text) });
  }
  return { sections, warnings: slides.length ? [] : ['No slides found'] };
}

// ─── OpenDocument ────────────────────────────────────────────────────────────

function extractOdf(zip: ZipReader, kind: 'odt' | 'ods' | 'odp'): { sections: DocumentSection[]; warnings: string[] } {
  const xml = zip.readText('content.xml');
  if (!xml) return { sections: [], warnings: ['content.xml missing'] };
  if (kind === 'ods') {
    const sections: DocumentSection[] = [];
    for (const tm of xml.matchAll(/<table:table\b([^>]*)>([\s\S]*?)<\/table:table>/g)) {
      const name = decodeXmlEntities(tm[1].match(/table:name="([^"]*)"/)?.[1] ?? 'Sheet');
      const rows: string[] = [];
      for (const rm of tm[2].matchAll(/<table:table-row\b[^>]*>([\s\S]*?)<\/table:table-row>/g)) {
        const cells = Array.from(rm[1].matchAll(/<table:table-cell\b[^>]*?(?:\/>|>([\s\S]*?)<\/table:table-cell>)/g)).map(c =>
          stripTags((c[1] ?? '').replace(/<\/text:p>/g, ' '))
            .trim()
        );
        if (cells.some(Boolean)) rows.push(cells.join(' | '));
      }
      if (rows.length) sections.push({ label: `Sheet: ${name}`, text: rows.join('\n') });
    }
    return { sections, warnings: [] };
  }
  if (kind === 'odp') {
    const sections: DocumentSection[] = [];
    let i = 0;
    for (const pm of xml.matchAll(/<draw:page\b[^>]*>([\s\S]*?)<\/draw:page>/g)) {
      i++;
      const t = collapse(stripTags(pm[1].replace(/<\/text:p>/g, '\n').replace(/<text:line-break\/>/g, '\n')));
      if (t) sections.push({ label: `Slide ${i}`, text: t });
    }
    return { sections, warnings: [] };
  }
  const text = collapse(
    stripTags(
      xml
        .replace(/<text:h\b[^>]*>/g, '\n## ')
        .replace(/<\/text:(p|h)>/g, '\n')
        .replace(/<text:tab\/>/g, '\t')
        .replace(/<text:line-break\/>/g, '\n')
        .replace(/<text:s(?:\s+text:c="(\d+)")?\/>/g, (_m, c) => ' '.repeat(Number(c || 1)))
    )
  );
  return { sections: [{ label: 'Document', text }], warnings: [] };
}

// ─── EPUB ────────────────────────────────────────────────────────────────────

function extractEpub(zip: ZipReader): { sections: DocumentSection[]; warnings: string[] } {
  const container = zip.readText('META-INF/container.xml') ?? '';
  const opfPath = container.match(/full-path="([^"]+)"/)?.[1];
  const sections: DocumentSection[] = [];
  if (!opfPath) return { sections, warnings: ['container.xml missing'] };
  const opf = zip.readText(opfPath) ?? '';
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const manifest = new Map<string, string>();
  for (const m of opf.matchAll(/<item\b[^>]*>/g)) {
    const id = m[0].match(/\bid="([^"]+)"/)?.[1];
    const href = m[0].match(/\bhref="([^"]+)"/)?.[1];
    if (id && href) manifest.set(id, decodeXmlEntities(href));
  }
  const spine = Array.from(opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/g)).map(m => m[1]);
  let i = 0;
  for (const id of spine) {
    const href = manifest.get(id);
    if (!href) continue;
    const html = zip.readText(base + href) ?? zip.readText(href);
    if (!html) continue;
    i++;
    const title = stripTags(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim();
    const text = htmlToText(html);
    if (text) sections.push({ label: `Chapter ${i}${title ? `: ${title}` : ''}`, text });
  }
  return { sections, warnings: [] };
}

// ─── HTML / RTF / CSV / IPYNB ────────────────────────────────────────────────

export function htmlToText(html: string): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  s = s
    .replace(/<h([1-6])[^>]*>/gi, (_m, n) => `\n${'#'.repeat(Number(n))} `)
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|blockquote|pre)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, '');
  return collapse(decodeXmlEntities(s).replace(/[ \t]{2,}/g, ' '));
}

export function rtfToText(rtf: string): string {
  let s = rtf
    .replace(/\{\\\*\\[^{}]*(\{[^{}]*\})*[^{}]*\}/g, '') // destination groups (\*\...)
    .replace(/\{\\fonttbl[\s\S]*?\}\}/g, '')
    .replace(/\{\\colortbl[\s\S]*?\}/g, '')
    .replace(/\{\\stylesheet[\s\S]*?\}\}/g, '')
    .replace(/\{\\info[\s\S]*?\}\}/g, '');
  s = s
    .replace(/\\par[d]?\b/g, '\n')
    .replace(/\\line\b/g, '\n')
    .replace(/\\tab\b/g, '\t')
    .replace(/\\'([0-9a-f]{2})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u(-?\d+)\??/g, (_m, n) => String.fromCharCode((Number(n) + 65536) % 65536))
    .replace(/\\[a-z]+-?\d*\s?/gi, '')
    .replace(/[{}]/g, '')
    .replace(/\\\\/g, '\\');
  return collapse(s);
}

function csvToText(content: string, ext: string): string {
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return '';
  const delim = ext === '.tsv' ? '\t' : lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  const parse = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const rows = lines.slice(0, 5000).map(parse);
  const width = Math.max(...rows.map(r => r.length));
  const md = rows.map(r => {
    const p = [...r];
    while (p.length < width) p.push('');
    return p.map(c => c.trim().replace(/\|/g, '\\|')).join(' | ');
  });
  if (md.length > 1) md.splice(1, 0, Array(width).fill('---').join(' | '));
  return `${lines.length} rows × ${width} columns\n\n${md.join('\n')}`;
}

function ipynbToText(content: string): string {
  try {
    const nb = JSON.parse(content);
    const cells: any[] = nb.cells ?? [];
    const lang = nb.metadata?.kernelspec?.language ?? nb.metadata?.language_info?.name ?? 'python';
    return cells
      .map((c, i) => {
        const src = Array.isArray(c.source) ? c.source.join('') : String(c.source ?? '');
        if (c.cell_type === 'markdown') return `<!-- cell ${i + 1} (markdown) -->\n${src}`;
        const outs = (c.outputs ?? [])
          .map((o: any) => {
            if (o.text) return Array.isArray(o.text) ? o.text.join('') : o.text;
            if (o.data?.['text/plain']) return Array.isArray(o.data['text/plain']) ? o.data['text/plain'].join('') : o.data['text/plain'];
            if (o.ename) return `${o.ename}: ${o.evalue}`;
            return '';
          })
          .filter(Boolean)
          .join('\n');
        return `<!-- cell ${i + 1} (code) -->\n\`\`\`${lang}\n${src}\n\`\`\`${outs ? `\nOutput:\n${outs.slice(0, 2000)}` : ''}`;
      })
      .join('\n\n');
  } catch {
    return content;
  }
}

/** Best-effort printable-string scrape for legacy binary formats. */
function scrapeStrings(buf: Buffer, min = 4): string {
  const out: string[] = [];
  let cur = '';
  // UTF-16LE scrape (common in .doc)
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const code = buf.readUInt16LE(i);
    if (code >= 32 && code < 0xd800) cur += String.fromCharCode(code);
    else {
      if (cur.length >= min) out.push(cur);
      cur = '';
    }
  }
  if (cur.length >= min) out.push(cur);
  cur = '';
  for (const b of buf) {
    if (b >= 32 && b < 127) cur += String.fromCharCode(b);
    else {
      if (cur.length >= min + 2) out.push(cur);
      cur = '';
    }
  }
  return collapse(out.filter(s => /[a-z]{3,}/i.test(s)).join('\n'));
}

// ─── PDF ─────────────────────────────────────────────────────────────────────

async function extractPdf(buf: Buffer): Promise<{ sections: DocumentSection[]; metadata: Record<string, string>; warnings: string[] }> {
  const warnings: string[] = [];
  const origWarn = console.warn;
  const origErr = console.error;
  try {
    console.warn = () => {};
    console.error = () => {};
    const mod: any = await import('pdf-parse' as any);
    const pdfParse = mod.default ?? mod;
    const pages: string[] = [];
    const data = await pdfParse(buf, {
      pagerender: (pageData: any) =>
        pageData.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false }).then((tc: any) => {
          let lastY: number | null = null;
          let text = '';
          for (const item of tc.items) {
            const y = item.transform?.[5];
            if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2) text += '\n';
            else if (text && !text.endsWith(' ') && !text.endsWith('\n')) text += ' ';
            text += item.str;
            if (y !== undefined) lastY = y;
          }
          pages.push(text);
          return text;
        }),
    });
    const metadata: Record<string, string> = { pages: String(data.numpages ?? pages.length) };
    if (data.info?.Title) metadata.title = String(data.info.Title);
    if (data.info?.Author) metadata.author = String(data.info.Author);
    if (data.info?.CreationDate) metadata.created = String(data.info.CreationDate);

    const sections = (pages.length ? pages : [data.text ?? '']).map((t, i) => ({ label: `Page ${i + 1}`, text: collapse(t) }));
    const totalChars = sections.reduce((n, s) => n + s.text.length, 0);
    if (totalChars < 20 && (data.numpages ?? 0) > 0) {
      warnings.push('PDF has no extractable text layer — it is probably scanned. OCR is required to read it.');
    }
    return { sections, metadata, warnings };
  } catch (err: any) {
    if (/Cannot find module|ERR_MODULE_NOT_FOUND/.test(err?.message ?? '')) {
      throw new Error('PDF support requires the pdf-parse dependency (npm install pdf-parse).');
    }
    throw new Error(`PDF parse failed: ${err?.message ?? err}`);
  } finally {
    console.warn = origWarn;
    console.error = origErr;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function extractDocument(filePath: string): Promise<ExtractedDocument> {
  const st = statSync(filePath);
  const ext = extname(filePath).toLowerCase();
  const buf = readFileSync(filePath);
  const base: ExtractedDocument = { format: ext.slice(1).toUpperCase() || 'TEXT', file: basename(filePath), sizeBytes: st.size, sections: [], metadata: {}, warnings: [] };

  const isZip = buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;
  const isPdf = buf.subarray(0, 5).toString('latin1') === '%PDF-';

  if (isPdf || ext === '.pdf') {
    const r = await extractPdf(buf);
    return { ...base, format: 'PDF', ...r };
  }

  if (isZip) {
    const zip = new ZipReader(buf);
    const names = zip.names();
    let r: { sections: DocumentSection[]; warnings: string[] };
    let format: string;
    if (names.includes('word/document.xml')) {
      r = extractDocx(zip);
      format = 'Word (DOCX)';
    } else if (names.includes('xl/workbook.xml')) {
      r = extractXlsx(zip);
      format = 'Excel (XLSX)';
    } else if (names.some(n => n.startsWith('ppt/slides/'))) {
      r = extractPptx(zip);
      format = 'PowerPoint (PPTX)';
    } else if (names.includes('META-INF/container.xml')) {
      r = extractEpub(zip);
      format = 'EPUB';
    } else if (names.includes('content.xml')) {
      const mime = zip.readText('mimetype') ?? '';
      const kind = mime.includes('spreadsheet') || ext === '.ods' ? 'ods' : mime.includes('presentation') || ext === '.odp' ? 'odp' : 'odt';
      r = extractOdf(zip, kind);
      format = `OpenDocument (${kind.toUpperCase()})`;
    } else {
      return { ...base, format: 'ZIP', sections: [{ label: 'Archive listing', text: names.join('\n') }], warnings: ['ZIP archive — not a recognised document; listing entries'] };
    }
    return { ...base, format, sections: r.sections, warnings: r.warnings, metadata: extractCoreProps(zip) };
  }

  // OLE compound (legacy .doc/.xls/.ppt)
  if (buf.length > 8 && buf.readUInt32LE(0) === 0xe011cfd0 && buf.readUInt32LE(4) === 0xe11ab1a1) {
    return {
      ...base,
      format: `Legacy Office (${ext.slice(1).toUpperCase() || 'OLE'})`,
      sections: [{ label: 'Extracted strings', text: scrapeStrings(buf) }],
      warnings: ['Legacy binary Office format — text extracted heuristically; convert to .docx/.xlsx/.pptx for full fidelity.'],
    };
  }

  const text = buf.toString('utf8');
  switch (ext) {
    case '.rtf':
      return { ...base, format: 'Rich Text (RTF)', sections: [{ label: 'Document', text: rtfToText(text) }] };
    case '.html':
    case '.htm':
    case '.xhtml': {
      const title = stripTags(text.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim();
      return { ...base, format: 'HTML', metadata: title ? { title } : {}, sections: [{ label: 'Document', text: htmlToText(text) }] };
    }
    case '.csv':
    case '.tsv':
      return { ...base, format: ext.slice(1).toUpperCase(), sections: [{ label: 'Table', text: csvToText(text, ext) }] };
    case '.ipynb':
      return { ...base, format: 'Jupyter Notebook', sections: [{ label: 'Notebook', text: ipynbToText(text) }] };
    default:
      if (text.includes('\uFFFD') && buf.subarray(0, 8000).includes(0)) {
        return { ...base, format: 'Binary', sections: [{ label: 'Extracted strings', text: scrapeStrings(buf) }], warnings: ['Binary file — showing printable strings only'] };
      }
      return { ...base, format: ext ? `${ext} text` : 'Plain text', sections: [{ label: 'Document', text }] };
  }
}

/**
 * Render an extracted document as a single string with optional paging.
 * @param page   1-based section (page/slide/sheet) number — returns just that section
 * @param offset character offset into the concatenated text
 * @param maxChars maximum characters to return
 */
export function renderDocument(
  doc: ExtractedDocument,
  opts: { page?: number; offset?: number; maxChars?: number } = {}
): string {
  const maxChars = opts.maxChars ?? 100_000;
  const head: string[] = [`File: ${doc.file} (${doc.format}, ${(doc.sizeBytes / 1024).toFixed(1)} KB)`];
  for (const [k, v] of Object.entries(doc.metadata)) head.push(`${k[0].toUpperCase()}${k.slice(1)}: ${v}`);
  if (doc.sections.length > 1) head.push(`Sections: ${doc.sections.length} (${doc.sections[0].label.split(/[\s:]/)[0]}s)`);
  for (const w of doc.warnings) head.push(`Warning: ${w}`);

  let sections = doc.sections;
  if (opts.page && opts.page >= 1) {
    if (opts.page > sections.length) return `${head.join('\n')}\n\nError: page ${opts.page} out of range (1-${sections.length}).`;
    sections = [sections[opts.page - 1]];
  }

  const body = sections
    .map(s => (doc.sections.length > 1 ? `--- ${s.label} ---\n${s.text}` : s.text))
    .join('\n\n');
  const totalChars = body.length;
  head.push(`Length: ${totalChars} characters`);

  const offset = Math.max(0, opts.offset ?? 0);
  const slice = body.slice(offset, offset + maxChars);
  const more = offset + maxChars < totalChars;
  const footer = more
    ? `\n\n... [Showing characters ${offset}–${offset + slice.length} of ${totalChars}. Call again with offset=${offset + slice.length}${doc.sections.length > 1 ? ' or page=<n>' : ''} to continue]`
    : offset > 0
      ? `\n\n[End of document — characters ${offset}–${totalChars}]`
      : '';

  return `${head.join('\n')}\n\n--- Document Content ---\n${slice}${footer}`;
}

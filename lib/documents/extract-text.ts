// Cap how much extracted text we store per document — plenty for search,
// keeps table rows small even for huge decks/reports.
export const MAX_CONTENT_LENGTH = 200_000;

/**
 * Pulls the plain text out of a slide/document XML part. PowerPoint and
 * Word XML both wrap visible text in a small set of tags — grabbing
 * everything between those tags and stripping the rest of the markup is
 * enough to get searchable content without a full OOXML parser.
 */
function textFromXml(xml: string) {
   const matches =
        xml.match(/<a:t[^>]*>([^<]*)<\/a:t>|<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
   return matches.map((tag) => tag.replace(/<[^>]+>/g, "")).join(" ");
}

async function extractFromPptx(buffer: Buffer): Promise<string> {
   const JSZip = (await import("jszip")).default;
   const zip = await JSZip.loadAsync(buffer);
   const slideFiles = Object.keys(zip.files)
     .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
     .sort((a, b) => {
            const na = parseInt(a.match(/(\d+)/)?.[1] || "0", 10);
            const nb = parseInt(b.match(/(\d+)/)?.[1] || "0", 10);
            return na - nb;
     });

  const parts: string[] = [];
   for (const name of slideFiles) {
        const xml = await zip.files[name].async("text");
        parts.push(textFromXml(xml));
   }
   return parts.join("\n");
}

async function extractFromDocx(buffer: Buffer): Promise<string> {
   const mammoth = await import("mammoth");
   const result = await mammoth.extractRawText({ buffer });
   return result.value;
}

async function extractFromPdf(buffer: Buffer): Promise<string> {
   // unpdf wraps a current build of Mozilla's own pdf.js and is built for
  // serverless/edge runtimes — more reliable across real-world PDFs than
  // older pure-JS parsers, which choke on newer PDF structures (e.g.
  // compressed cross-reference streams).
  const { extractText } = await import("unpdf");
   const result = await extractText(new Uint8Array(buffer), { mergePages: true });
   return result.text;
}

// Record types from the legacy PowerPoint binary format ([MS-PPT]) that
// hold plain text: TextCharsAtom stores UTF-16LE text, TextBytesAtom
// stores single-byte "compressed" text (each byte is a Latin-1 code
// point). Everything else is either irrelevant or a container we need to
// walk into.
const PPT_TEXT_CHARS_ATOM = 0x0fa0;
const PPT_TEXT_BYTES_ATOM = 0x0fa8;

/**
 * Recursively walks a PowerPoint Document stream's record hierarchy,
 * collecting text from every TextCharsAtom/TextBytesAtom it finds. Per
 * [MS-PPT], a record's 4-bit version nibble is 0xF exactly when that
 * record is a container — that's how we tell "recurse into this" apart
 * from "this is a leaf atom, skip past it" without needing the full
 * record-type classification table.
 */
function walkPptRecords(buf: Buffer, start: number, end: number, out: string[]) {
   let pos = start;
   while (pos + 8 <= end) {
        const header = buf.readUInt16LE(pos);
        const recVer = header & 0x0f;
        const recType = buf.readUInt16LE(pos + 2);
        const recLen = buf.readUInt32LE(pos + 4);
        const dataStart = pos + 8;
        const dataEnd = Math.min(dataStart + recLen, end);

     if (recType === PPT_TEXT_CHARS_ATOM) {
            out.push(buf.toString("utf16le", dataStart, dataEnd));
     } else if (recType === PPT_TEXT_BYTES_ATOM) {
            out.push(buf.toString("latin1", dataStart, dataEnd));
     } else if (recVer === 0x0f) {
            walkPptRecords(buf, dataStart, dataEnd, out);
     }
        pos = dataEnd;
   }
}

async function extractFromPpt(buffer: Buffer): Promise<string> {
   // Legacy .ppt files are OLE2 compound-file containers (the same format
  // old .doc/.xls used) rather than the zip-of-XML that .pptx is. `cfb`
  // (SheetJS's standalone compound-file reader) unpacks that container
  // in pure JS — no native deps, safe for serverless — so we can get at
  // the raw "PowerPoint Document" stream and walk its binary records.
  const cfb = await import("cfb");
   const container = cfb.parse(buffer, { type: "buffer" });
   const entry = cfb.find(container, "PowerPoint Document");
   if (!entry || !entry.content) return "";
   const stream = Buffer.from(entry.content as Uint8Array);
   const parts: string[] = [];
   walkPptRecords(stream, 0, stream.length, parts);
   return parts.join(" ");
}

/**
 * Extracts plain text from a supported file's raw bytes. Returns null for
 * types we can't reliably parse — legacy binary .doc (no dependency-free
 * parser) and images (no text layer without OCR) — so those documents
 * just stay searchable by file name only.
 */
export async function extractText(
   buffer: Buffer,
   fileType: string | null
 ): Promise<string | null> {
   const ext = (fileType || "").toLowerCase();
   try {
        if (ext === "pdf") return await extractFromPdf(buffer);
        if (ext === "docx") return await extractFromDocx(buffer);
        if (ext === "pptx") return await extractFromPptx(buffer);
        if (ext === "ppt") return await extractFromPpt(buffer);
        return null;
   } catch (err) {
        console.error(`Text extraction failed for .${ext}:`, err);
        return null;
   }
}

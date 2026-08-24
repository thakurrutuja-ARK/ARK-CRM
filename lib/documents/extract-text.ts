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


                                                                                     /**
                                                                                      * Extracts plain text from a supported file's raw bytes. Returns null for
                                                                                       * types we can't reliably parse — legacy binary .doc/.ppt (no
                                                                                        * dependency-free parser) and images (no text layer without OCR) — so
                                                                                         * those documents just stay searchable by file name only.
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
                                                                                                                  return null;
                                                                                                                    } catch (err) {
                                                                                                                        console.error(`Text extraction failed for .${ext}:`, err);
                                                                                                                            return null;
                                                                                                                              }
                                                                                                                              }
                                                                                                                              

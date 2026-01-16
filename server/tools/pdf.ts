import { readFile } from 'fs/promises';
import PDFParser from 'pdf2json';

// Suppress pdf2json verbose warnings globally
const originalWarn = console.warn;
const suppressedPatterns = ['Setting up fake worker', 'TT: undefined', 'Unsupported:', 'NOT valid'];
console.warn = (...args: any[]) => {
  const message = args[0]?.toString() || '';
  if (suppressedPatterns.some(p => message.includes(p))) {
    return; // Suppress this warning
  }
  originalWarn.apply(console, args);
};

/**
 * Parse PDF file and extract text content
 */
export async function parsePDF(filePath: string): Promise<string> {
  try {
    const dataBuffer = await readFile(filePath);
    return await extractTextFromPDF(dataBuffer);
  } catch (error) {
    console.error('PDF parsing error:', error);
    throw new Error(`Failed to parse PDF: ${error}`);
  }
}

/**
 * Parse PDF from buffer
 */
export async function parsePDFBuffer(buffer: Buffer): Promise<string> {
  try {
    return await extractTextFromPDF(buffer);
  } catch (error) {
    console.error('PDF parsing error:', error);
    throw new Error(`Failed to parse PDF buffer: ${error}`);
  }
}

/**
 * Safely decode URI component, returning original if malformed
 */
function safeDecodeURI(encoded: string): string {
  try {
    return decodeURIComponent(encoded);
  } catch {
    // Return original if decoding fails
    return encoded;
  }
}

/**
 * Extract text from PDF using pdf2json
 * Warnings are suppressed globally at module level
 */
async function extractTextFromPDF(data: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();
    
    pdfParser.on('pdfParser_dataError', (errData: any) => {
      reject(new Error(errData.parserError));
    });
    
    pdfParser.on('pdfParser_dataReady', (pdfData: any) => {
      try {
        // Extract text from all pages
        const text = pdfData.Pages
          .map((page: any) => 
            page.Texts
              .map((textItem: any) => 
                textItem.R
                  .map((r: any) => safeDecodeURI(r.T))
                  .join('')
              )
              .join(' ')
          )
          .join('\n\n');
        
        resolve(text);
      } catch (error) {
        reject(error);
      }
    });
    
    pdfParser.parseBuffer(data);
  });
}

/**
 * Extract sections from CV text (basic heuristic)
 */
export function extractCVSections(text: string): Record<string, string> {
  const sections: Record<string, string> = {};
  
  // Common CV section headers
  const sectionHeaders = [
    'education',
    'experience',
    'work experience',
    'research experience',
    'publications',
    'skills',
    'technical skills',
    'projects',
    'awards',
    'certifications',
    'summary',
    'objective',
    'about',
    'contact',
  ];
  
  const lines = text.split('\n');
  let currentSection = 'header';
  let currentContent: string[] = [];
  
  for (const line of lines) {
    const lowerLine = line.toLowerCase().trim();
    
    // Check if this line is a section header
    const isHeader = sectionHeaders.some(
      (header) => lowerLine === header || lowerLine.startsWith(header + ':')
    );
    
    if (isHeader) {
      // Save previous section
      if (currentContent.length > 0) {
        sections[currentSection] = currentContent.join('\n').trim();
      }
      
      // Start new section
      currentSection = lowerLine.replace(':', '').trim();
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }
  
  // Save last section
  if (currentContent.length > 0) {
    sections[currentSection] = currentContent.join('\n').trim();
  }
  
  return sections;
}

import { z } from 'zod';

export interface MaterialPdfWarningReceipt {
  pageNumber: number | null;
  code: 'ANNOTATION_BORDER_WIDTH_NORMALIZED' | 'UNKNOWN';
  count: number;
  disposition: 'BLOCKING' | 'APPEARANCE_AND_RAW_WIDTH_PRESERVED';
}

const annotationAppearance = z
  .array(
    z.object({
      hasAppearance: z.literal(true),
      borderStyle: z.object({
        rawWidth: z.number().finite(),
        width: z.number().finite(),
      }),
    })
  )
  .min(1);
const borderWidthWarning =
  /^Warning: AnnotationBorderStyle\.setWidth - ignoring width: ((?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)$/;

/** Only one reviewed PDF.js 6.4.299 recovery is eligible, after page evidence is complete. */
export class MaterialPdfWarnings {
  private pageNumber: number | null = null;
  private version: string | null = null;
  private receipts: MaterialPdfWarningReceipt[] = [];

  setLibraryVersion(version: string): void {
    this.version = version;
  }
  enterPage(pageNumber: number): void {
    this.pageNumber = pageNumber;
  }
  leavePage(): void {
    this.pageNumber = null;
  }

  observe(method: string, values: readonly unknown[]): void {
    const match =
      method === 'warn' && values.length === 1 && typeof values[0] === 'string'
        ? values[0].match(borderWidthWarning)
        : null;
    const reviewed =
      this.version === '6.4.299' &&
      this.pageNumber !== null &&
      match !== null &&
      Number.isFinite(Number(match[1])) &&
      Number(match[1]) > 0;
    const code = reviewed ? 'ANNOTATION_BORDER_WIDTH_NORMALIZED' : 'UNKNOWN';
    const existing = this.receipts.find(
      (receipt) => receipt.pageNumber === this.pageNumber && receipt.code === code
    );
    if (existing) {
      existing.count += 1;
      return;
    }
    this.receipts.push({
      pageNumber: this.pageNumber,
      code,
      count: 1,
      disposition: 'BLOCKING',
    });
  }

  finalizePage(pageNumber: number, annotations: unknown, evidenceComplete: boolean): void {
    const receipt = this.receipts.find(
      (value) =>
        value.pageNumber === pageNumber && value.code === 'ANNOTATION_BORDER_WIDTH_NORMALIZED'
    );
    if (!receipt || !evidenceComplete || !annotationAppearance.safeParse(annotations).success)
      return;
    receipt.disposition = 'APPEARANCE_AND_RAW_WIDTH_PRESERVED';
  }

  get unknownCount(): number {
    return this.receipts
      .filter((receipt) => receipt.code === 'UNKNOWN')
      .reduce((sum, receipt) => sum + receipt.count, 0);
  }
  get hasBlockingWarnings(): boolean {
    return this.receipts.some((receipt) => receipt.disposition === 'BLOCKING');
  }
  pageBlocks(pageNumber: number): boolean {
    return this.receipts.some(
      (receipt) => receipt.pageNumber === pageNumber && receipt.disposition === 'BLOCKING'
    );
  }
  snapshot(): MaterialPdfWarningReceipt[] {
    return this.receipts.map((receipt) => ({ ...receipt }));
  }
}

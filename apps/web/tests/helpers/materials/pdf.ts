export function syntheticMaterialPdf(
  pages: string[],
  options: {
    width?: number;
    height?: number;
    ink?: boolean;
    borderWidth?: number;
    savedAppearance?: boolean;
  } = {}
) {
  const objects = new Map<number, string>();
  const kids = pages.map((_, index) => `${4 + index * 2} 0 R`).join(' ');
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objects.set(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objects.set(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (const [index, content] of pages.entries()) {
    const id = 4 + index * 2;
    const annotations = options.ink && index === 0 ? `/Annots [${4 + pages.length * 2} 0 R]` : '';
    objects.set(
      id,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${options.width ?? 120} ${options.height ?? 120}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R ${annotations} >>`
    );
    objects.set(
      id + 1,
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`
    );
  }
  if (options.ink) {
    const id = 4 + pages.length * 2;
    objects.set(
      id,
      `<< /Type /Annot /Subtype /Ink /Rect [10 10 110 110] /InkList [[10 10 110 110]] /C [1 0 0] /F 4 ${options.borderWidth === undefined ? '' : `/BS << /W ${options.borderWidth} >>`} ${options.savedAppearance === false ? '' : `/AP << /N ${id + 1} 0 R >>`} >>`
    );
    const appearance = '1 0 0 RG 8 w 0 0 m 100 100 l S';
    objects.set(
      id + 1,
      `<< /Type /XObject /Subtype /Form /BBox [0 0 100 100] /Resources << >> /Length ${appearance.length} >>\nstream\n${appearance}\nendstream`
    );
  }
  let document = '%PDF-1.7\n';
  const offsets = [0];
  for (let id = 1; id <= objects.size; id += 1) {
    offsets.push(Buffer.byteLength(document));
    document += `${id} 0 obj\n${objects.get(id)}\nendobj\n`;
  }
  const xref = Buffer.byteLength(document);
  document += `xref\n0 ${objects.size + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    document += `${String(offset).padStart(10, '0')} 00000 n \n`;
  document += `trailer\n<< /Size ${objects.size + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(document);
}

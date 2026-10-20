/** A real, small PDF with identifiable pages, usable by the actual PDF renderer. */
export function originalPdf(
  pages = 2,
  options: { text?: boolean; width?: number; height?: number; ink?: boolean } = {}
): Buffer {
  const pageIds = Array.from({ length: pages }, (_, index) => 3 + index * 2);
  const fontId = 3 + pages * 2;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages} >>`,
  ];
  for (const [index, id] of pageIds.entries()) {
    const content =
      options.text === false
        ? '0.2 0.4 0.8 rg 20 20 100 100 re f'
        : `BT /F1 18 Tf 30 100 Td (Original page ${index + 1}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${options.width ?? 200} ${options.height ?? 160}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${id + 1} 0 R ${options.ink ? `/Annots [${fontId + 1} 0 R]` : ''} >>`,
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`
    );
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  if (options.ink)
    objects.push(
      '<< /Type /Annot /Subtype /Ink /Rect [0 0 200 160] /InkList [[20 20 180 140]] /C [1 0 0] /BS << /W 5 >> >>'
    );
  let pdf = '%PDF-1.7\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(pdf);
}

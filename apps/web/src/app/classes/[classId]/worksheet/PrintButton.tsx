'use client';

import { FileDown } from 'lucide-react';
import styles from './worksheet.module.css';

export function PrintButton() {
  return (
    <button
      type="button"
      className={styles.printButton}
      onClick={() => window.print()}
      aria-label="Save this iPad workbook as a PDF"
    >
      <FileDown aria-hidden="true" size={16} strokeWidth={2} />
      Save as PDF
    </button>
  );
}

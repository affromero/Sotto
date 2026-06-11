'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import styles from './page.module.css';

export function ExportButton() {
  const [isExporting, setIsExporting] = useState(false);

  async function handleExport() {
    setIsExporting(true);

    try {
      const response = await fetch('/api/v1/admin/waitlist/export');

      if (!response.ok) {
        throw new Error('Failed to export waitlist');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `waitlist-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to export');
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <button
      onClick={handleExport}
      disabled={isExporting}
      className={styles.exportButton}
      aria-label="Export waitlist as CSV"
    >
      <Download size={16} aria-hidden="true" />
      {isExporting ? 'Exporting...' : 'Export CSV'}
    </button>
  );
}

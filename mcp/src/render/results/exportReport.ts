// The view of `results_export_report`: how many files of the report were saved, what the archive
// lacked and which links were not followed, then where the report is, as the last line. No text of
// the report itself: the files are saved as they are and only their numbers and paths are shown.

import type { Translator } from '../../context.js';
import { decimal, num } from '../primitives.js';

export interface ExportData {
  /** The handle of the run (`e-1a2b3c4d`) and its UUID. */
  readonly run: string;
  readonly run_id: string;
  /** `loadcraft/reports/<run>/index.html`, relative to the workspace. */
  readonly path: string;
  readonly files: number;
  readonly bytes: number;
  /** How many files the report names that the archive lacks (their names are not shown). */
  readonly missingCount: number;
  readonly skippedLinks: number;
  readonly truncated: boolean;
}

const KIB = 1024;
const MIB = 1024 * 1024;

export function renderExportReport(data: ExportData, t: Translator): string {
  const { locale } = t;
  const lines = [
    t('results_export_report.saved', {
      run: data.run,
      files: num(data.files, locale),
      kb: num(Math.ceil(data.bytes / KIB), locale),
    }),
  ];
  if (data.missingCount > 0) {
    lines.push(t('results_export_report.missing', { count: num(data.missingCount, locale) }));
  }
  if (data.skippedLinks > 0) {
    lines.push(t('results_export_report.skipped', { count: num(data.skippedLinks, locale) }));
  }
  if (data.truncated) {
    lines.push(
      t('results_export_report.truncated', {
        files: num(data.files, locale),
        mb: decimal(data.bytes / MIB, 1, locale),
      }),
    );
  }
  lines.push(t('results_export_report.ignored'));
  lines.push(t('results_export_report.open', { path: data.path }));
  return lines.join('\n');
}

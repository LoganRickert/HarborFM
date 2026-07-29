import {
  BlobReader,
  TextWriter,
  ZipReader,
  type Entry,
  type FileEntry,
} from '@zip.js/zip.js';
import {
  validateProjectZipClient,
  type ProjectZipKind,
  type ProjectZipManifest,
} from '@harborfm/shared';

/**
 * Inspect a HarborFM project zip in the browser without loading the whole
 * archive into memory. Reads the central directory and only extracts
 * harborfm-project.json.
 */
export async function validateProjectZipFile(
  file: File,
  expectedKind: ProjectZipKind,
): Promise<void> {
  if (!file.name.toLowerCase().endsWith('.zip') && file.type !== 'application/zip') {
    throw new Error(
      expectedKind === 'segment'
        ? 'File must be a .zip segment project export'
        : 'File must be a .zip project export',
    );
  }
  if (file.size === 0) {
    throw new Error('Empty zip file');
  }

  const reader = new ZipReader(new BlobReader(file));
  try {
    const entries = await reader.getEntries();
    const entryNames = entries
      .map((e) => e.filename)
      .filter((n): n is string => typeof n === 'string' && n.length > 0);

    const manifestEntry = entries.find(
      (e): e is FileEntry =>
        isFileEntry(e) && normalizeName(e.filename) === 'harborfm-project.json',
    );

    let manifest: ProjectZipManifest | null = null;
    if (manifestEntry) {
      try {
        const text = await manifestEntry.getData(new TextWriter());
        manifest = JSON.parse(text) as ProjectZipManifest;
      } catch {
        throw new Error('Invalid harborfm-project.json');
      }
    }

    const error = validateProjectZipClient(manifest, entryNames, expectedKind);
    if (error) throw new Error(error);
  } finally {
    await reader.close().catch(() => {});
  }
}

function normalizeName(raw: string): string {
  return raw.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function isFileEntry(entry: Entry): entry is FileEntry {
  return !entry.directory && typeof (entry as FileEntry).getData === 'function';
}

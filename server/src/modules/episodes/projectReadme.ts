import { APP_NAME } from "../../config.js";

/** Standard README.md written into every project export zip. */
export function projectZipReadmeMarkdown(formatVersion: number): string {
  const app = APP_NAME;
  return `# ${app} episode project

This zip holds one episode's project files for ${app}: metadata,
segment audio, finals (if present), and optional multitrack
recordings.

Use it as a backup, edit the audio offline, then choose
**Import Project** on a show's Episodes page. Import always creates
a **new draft** episode with new ids.

Format version: ${formatVersion}

## What's inside

- \`harborfm-project.json\`: format version and export metadata
  (do not remove)
- \`README.md\`: this file
- \`episode/\`: title, description, artwork, finals, show notes,
  poll
- \`segments/\`: one folder per segment, in order
- \`library/\`: reusable library audio embedded for this project

### Each segment folder

Typical layout:

\`\`\`
segments/
  000_intro/
    segment.json      # optional if you add a segment by hand
    audio.mp3         # or audio.wav (required)
    waveform.json     # optional; regenerated on import
    recordings/       # optional multitrack takes
\`\`\`

Folder names are sorted alphabetically on import
(\`000_\`, \`001_\`, …). Use a numeric prefix so order stays
correct.

## Editing existing audio

1. Unzip the project.
2. Replace \`segments/<folder>/audio.mp3\` or \`audio.wav\` with
   your edited file (**same filename**).
3. You do **not** need to update \`segment.json\` hashes or
   \`waveform.json\`.
4. Zip the folder again (include \`harborfm-project.json\` at the
   root) and use **Import Project** on the show's Episodes page.

On import, ${app} compares file hashes from the export. If audio
changed, it regenerates the waveform (when waveform tools are
available), updates duration, and drops markers that fall past the
new end. If you change a file under \`recordings/\`, ${app}
regenerates track waveforms and remakes the mixed segment audio.

## Adding a new segment by hand

You can add a segment without writing JSON:

1. Create a new folder under \`segments/\`, e.g. \`002_cold_open\`.
2. Put your file in that folder as **\`audio.mp3\`** or
   **\`audio.wav\`** (those exact names).
3. Do **not** worry about \`segment.json\` or \`waveform.json\`.
   Leave them out; import will create what it needs.
4. Re-zip and import.

Tips:

- Prefer \`audio.mp3\`. If you only have a WAV, name it
  \`audio.wav\` and import will transcode it to MP3.
- The segment name defaults from the folder name
  (e.g. \`002_cold_open\` to "cold open").
- Position follows folder sort order. Use \`000_\`, \`001_\`,
  \`002_\` prefixes.
- Optional: add a \`segment.json\` if you want markers, trim
  ranges, or a custom \`name\` (see below).

### Optional \`segment.json\` (advanced)

Only needed if you want to set metadata yourself. Minimal example:

\`\`\`json
{
  "type": "recorded",
  "name": "Cold open",
  "position": 2,
  "durationSec": 0,
  "trimRanges": null,
  "markers": null,
  "audioEq": null,
  "disabled": false,
  "audioFile": "audio.mp3"
}
\`\`\`

\`durationSec\` can be \`0\`; import will probe the file. You still
do not need to invent \`audioSha256\`, \`waveformSha256\`, or
\`waveform.json\`.

## Re-zipping for import

- Keep the same root layout (\`harborfm-project.json\`,
  \`episode/\`, \`segments/\`, …).
- Zip the **contents** of the project folder (or the folder itself
  so those paths are at the zip root).
- Import requires manager/owner on the destination show. The
  result is always a **draft**.

## What import does not keep from publish state

Imported episodes are drafts. RSS guids/slugs are new.
Votes/analytics/Stripe data are not included. Cast is matched by
name on the destination show when possible.

## Multitrack \`recordings/\`

If present, leave \`tracks_manifest.json\` and the track audio
files together. Edit track files if you need to; import will remake
the mix when hashes change. You do not need to regenerate track
waveforms yourself.

To remove a track from the mix, delete its audio file under
\`recordings/\` and leave \`tracks_manifest.json\` as-is. Import
treats a missing file as deleted: that entry is dropped and the
mix is remade from the remaining tracks.
`;
}

/** README.md for a single-segment project export zip. */
export function segmentProjectZipReadmeMarkdown(formatVersion: number): string {
  const app = APP_NAME;
  return `# ${app} segment project

This zip holds one segment for ${app}: audio, optional waveform,
and optional multitrack recordings.

Use **Manage segment > Import Segment** on that segment to
overwrite it in place (same segment id and position). Do not use
**Import Project** on a show's Episodes page; episode import
rejects segment zips.

Format version: ${formatVersion}

## What's inside

- \`harborfm-project.json\`: format version, \`kind: "segment"\`,
  and source ids (do not remove)
- \`README.md\`: this file
- \`segment/\`: audio and metadata for this segment
- \`library/\`: reusable library audio when the segment used one

### Segment folder

\`\`\`
segment/
  segment.json      # optional for hand edits
  audio.mp3         # or audio.wav (required)
  waveform.json     # optional; regenerated on import
  recordings/       # optional multitrack takes
\`\`\`

## Editing audio

1. Unzip the project.
2. Replace \`segment/audio.mp3\` or \`segment/audio.wav\` (**same
   filename**).
3. You do not need to update hashes or \`waveform.json\`.
4.    Re-zip (keep \`harborfm-project.json\` at the root) and use
   **Import Segment** on that segment.

On import, ${app} regenerates waveforms when audio hashes change,
updates duration, and drops markers past the new end. Changed
\`recordings/\` tracks remake the mixed segment audio. Delete a
track file under \`recordings/\` (keep the manifest entry) to drop
it from the remade mix.

## Re-zipping

Keep \`harborfm-project.json\`, \`segment/\`, and optional
\`library/\` at the zip root. Import requires editor, manager, or
owner on the episode and overwrites the current segment only.
`;
}

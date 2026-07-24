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
    host_ducking.json # exclusive host gates (optional)
    audacity.lof      # open in Audacity (File > Open)
    labels.txt        # File > Import > Labels in Audacity
    segment.rpp       # open in Reaper
    timeline.otio     # OpenTimelineIO for Resolve (this folder)
\`\`\`

Folder names are sorted alphabetically on import
(\`000_\`, \`001_\`, …). Use a numeric prefix so order stays
correct.

## Editing with DAWs

Import into ${app} looks at audio file hashes (\`audio.*\` and
\`recordings/*\`). When \`timeline.otio\` is present and its hash
differs from \`segment.json\` (\`timelineOtioSha256\`), import
applies that timeline first: it rebuilds \`tracks_manifest.json\`
from clip cuts/trims (gaps and \`source_range\`) and remakes the
mixed segment audio. Before that overwrite, HarborFM keeps a one-time
backup as \`recordings/tracks_manifest.json.original\` so
**Restore Original Mix** can remake the pre-OTIO / pre-Reaper mix.
Resolve Fairlight FX are not re-imported.
Otherwise, when \`segment.rpp\` is present and its hash differs
(\`segmentRppSha256\`), import applies that Reaper sidecar
(layout, volume, mute, and supported FX) the same way. If the
chosen sidecar cannot be read, import ignores it and remakes from
\`tracks_manifest.json\` instead. Reaper media paths must stay under
the segment folder (no \`..\`); Resolve absolute media paths are
matched by basename under \`recordings/\`. When host ducking is
enabled and \`host_ducking.json\` is present, exclusive host gates
are applied on remake. Other sidecars (\`audacity.lof\`,
\`labels.txt\`) are still ignored on import.

### Audacity

1. Unzip the project.
2. **File > Open** the segment's \`audacity.lof\` (same folder as
   \`segment.rpp\` / \`timeline.otio\`). Use Open, not drag-and-drop
   onto the Audacity icon. If prompted, choose "List of files in
   basic text format". Tracks share one window; each \`offset\` is
   that track's \`startMs\` (seconds). Stubs under 2KB are omitted.
3. File > Import > Labels… and choose \`labels.txt\` if present
   (markers and trim regions).
4. Edit in Audacity. **File > Save Project** writes an Audacity
   \`.aup3\` only; it does **not** overwrite the zip audio files.
5. When finished, **Export** (or Export Multiple) back over the
   same filenames (\`audio.mp3\` / \`audio.wav\`, or files under
   \`recordings/\`).
6. Re-zip (keep \`harborfm-project.json\` at the root) and use
   **Import Project**.

### Reaper

1. Unzip the project.
2. Open that segment's \`segment.rpp\` (paths relative to the
   segment folder). Tracks are named \`Name_0\` /
   \`soundboard_<id>\`; reconnects share one track. Items use
   \`startMs\`. Stubs under 2KB are omitted.
3. Edit layout (move, trim, duplicate, or add clips), track or
   item volume, play rate, loop, fades, pitch, and track ReaEQ /
   ReaGate / ReaComp (Cockos). Those settings are stored in
   \`tracks_manifest.json\` and round-trip on the next export.
   Bypassed plugins are ignored for remake. Other FX are ignored.
   Keep **new** media under the segment folder (for example
   \`Media/yourfile.mp3\` next to \`segment.rpp\`) and include
   that folder in the zip. Do not point clips at absolute paths
   outside the segment folder. You may also replace source files
   in place with the same names.
4. Re-zip and **Import Project**, or on an existing segment use
   **Import Reaper** with only \`segment.rpp\` (existing
   recordings/mix on the server). A changed \`segment.rpp\`
   rebuilds the multitrack layout (including volume / playback /
   ReaEQ / ReaGate / ReaComp) and remakes the segment mix.
   Relative track balance from Reaper faders is kept; the finished
   mix is still loudness-normalized (about -18 LUFS), so overall
   level will not match a hot Reaper master.

### DaVinci Resolve (OpenTimelineIO)

1. Unzip the project.
2. In a segment folder, import \`timeline.otio\` (Resolve OTIO /
   timeline import). Media paths are relative to that folder
   (\`recordings/…\` or \`audio.*\`). If Resolve asks for media
   location, point it at that same segment folder.
3. Tracks match Reaper (\`Logan_0\`, \`soundboard_<assetId>\`),
   participants above soundboard, sorted by start; reconnects
   share a track. Stubs under 2KB are omitted.
4. Edit cuts and trims in Resolve, then **overwrite**
   \`timeline.otio\` in the zip (export OTIO from Resolve) and
   re-zip for **Import Project**, or on an existing segment use
   **Import OTIO** with only \`timeline.otio\` (existing
   recordings/mix on the server). When the OTIO hash differs (or
   you use Import OTIO), ${app} rebuilds the multitrack layout
   from clip timing and remakes the segment mix. Fairlight
   volume/EQ/pan are not applied on import.

## Editing existing audio (any tool)

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
A changed \`segment.rpp\` hash also remakes the mix from the
timeline layout.

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
do not need to invent \`audioSha256\`, \`waveformSha256\`,
DAW sidecar hashes (\`segmentRppSha256\`, \`audacityLofSha256\`,
\`timelineOtioSha256\`), or \`waveform.json\`.

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
  host_ducking.json # exclusive host gates (optional)
  audacity.lof      # open in Audacity (File > Open)
  labels.txt        # File > Import > Labels in Audacity
  segment.rpp       # open in Reaper
  timeline.otio     # OpenTimelineIO for Resolve
\`\`\`

## Editing with DAWs

Import cares about hashes of \`segment/audio.*\` and
\`segment/recordings/*\`. When \`segment/timeline.otio\` is present
and its hash differs (\`timelineOtioSha256\`), import applies that
timeline first (cuts/trims; Resolve FX ignored) and remakes the
mix. Otherwise, when \`segment/segment.rpp\` differs
(\`segmentRppSha256\`), import applies the Reaper sidecar
(layout, volume, mute, supported FX). If the chosen sidecar
cannot be read, import ignores it and remakes from
\`tracks_manifest.json\`. Reaper media paths must stay under
\`segment/\` (no \`..\`); Resolve absolute paths match by basename
under \`recordings/\`. When host ducking is enabled and
\`host_ducking.json\` is present, exclusive host gates are applied
on remake. Other sidecars (\`.lof\`, labels) are ignored on import.

### Audacity

1. Unzip.
2. **File > Open** \`segment/audacity.lof\` (same folder as
   \`segment.rpp\` / \`timeline.otio\`). Prefer Open over
   drag-and-drop onto the Audacity icon. Each \`offset\` is
   \`startMs\`; stubs under 2KB are omitted.
3. File > Import > Labels… > \`segment/labels.txt\` if present
   (markers, trims, and track-start labels).
4. Edit. **Save Project** does not update the zip audio; **Export**
   back over the same filenames under \`segment/\` (and
   \`recordings/\` if you edited multitrack).
5. Re-zip and **Import Segment**.

### Reaper

1. Open \`segment/segment.rpp\`. Tracks are \`Name_0\` /
   \`soundboard_<id>\` (reconnects combined); item \`POSITION\` is
   \`startMs\`. Stubs under 2KB are omitted.
2. Edit layout (move, trim, duplicate, or add clips), track or
   item volume, play rate, loop, fades, pitch, and track ReaEQ /
   ReaGate / ReaComp (Cockos). Those settings are stored in
   \`tracks_manifest.json\` and round-trip on the next export.
   Bypassed plugins are ignored for remake. Other FX are ignored.
   Keep **new** media under \`segment/\` (for example
   \`segment/Media/yourfile.mp3\`) and include that folder in the
   zip. Do not point clips at absolute paths outside the segment
   folder. You may also replace source files in place.
3. Re-zip and **Import Segment**, or upload only \`segment.rpp\`
   via **Import Reaper** on Manage Segment (uses this segment's
   existing \`recordings/\` or mix audio; clips for media the
   server does not have are skipped). A changed \`segment.rpp\`
   rebuilds the multitrack layout (including volume / playback /
   ReaEQ / ReaGate / ReaComp) and remakes the segment mix.
   Relative track balance from Reaper faders is kept; the finished
   mix is still loudness-normalized (about -18 LUFS), so overall
   level will not match a hot Reaper master.

### DaVinci Resolve (OpenTimelineIO)

1. Import \`segment/timeline.otio\`. Paths are relative to
   \`segment/\` (\`recordings/…\` or \`audio.*\`). If Resolve asks
   for media location, choose the \`segment/\` folder.
2. Tracks match Reaper naming and layout (participants then
   soundboard, reconnects on one track). Edit cuts and trims,
   then overwrite \`segment/timeline.otio\` (Resolve OTIO export)
   in the zip. You may also replace source files in place.
3. Re-zip and **Import Segment**, or upload only
   \`timeline.otio\` via **Import OTIO** on Manage Segment (uses
   this segment's existing \`recordings/\` or mix audio; clips for
   media the server does not have are skipped). A changed
   \`timeline.otio\` rebuilds the multitrack layout from clip
   timing and remakes the segment mix. Fairlight FX are not
   re-imported.

## Editing audio (any tool)

1. Unzip the project.
2. Replace \`segment/audio.mp3\` or \`segment/audio.wav\` (**same
   filename**).
3. You do not need to update hashes or \`waveform.json\`.
4. Re-zip (keep \`harborfm-project.json\` at the root) and use
   **Import Segment** on that segment.

On import, ${app} regenerates waveforms when audio hashes change,
updates duration, and drops markers past the new end. Changed
\`recordings/\` tracks remake the mixed segment audio. Delete a
track file under \`recordings/\` (keep the manifest entry) to drop
it from the remade mix. A changed \`timeline.otio\` or
\`segment.rpp\` hash also remakes the mix from that timeline
(OTIO takes precedence when both changed).

## Re-zipping

Keep \`harborfm-project.json\`, \`segment/\`, and optional
\`library/\` at the zip root. Import requires editor, manager, or
owner on the episode and overwrites the current segment only.
`;
}

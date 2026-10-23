# Cybiko converters in the browser

[`index.html`](index.html) is a page that does what the
[Python tools](../tools/README.md) do, in the browser: open, convert and
make every Cybiko Xtreme format worked out in
[file-formats.md](../file-formats.md). Nothing is uploaded; the files never
leave the computer.

- **Online:** https://sovgvd.github.io/cybiko-docs/ (once GitHub Pages is
  on, see [Publishing](#publishing)).
- **Offline:** open `web/index.html` straight from a clone or a downloaded
  ZIP of this repository. It needs no server and no build step; only
  turning a video's sound into MP3 (MXD clips) loads a library from the
  web.

The converters give the **same bytes** as the Python tools for the same
input and options; [`test/compare.js`](test/compare.js) checks that (see
[Testing](#testing)). The exceptions are said below: things the Python tools
hand to ffmpeg, and picture formats only the browser reads.

| Tab | Formats | Python tool |
| --- | --- | --- |
| [Packs and archives](#packs-and-archives) | EZ Loader packs (`.cap`, `.csu`), CyOS archives (`.app`, `.dl`), flash dumps | `cybiko_cap.py` |
| [Pictures](#pictures) | `.pic`, `.xpic` to and from PNG, BMP, PGM/PPM, JPEG... | `cybiko_pic.py` |
| [Melodies](#melodies) | `.mus`, `.music` to and from text and MIDI, played, to WAV | `cybiko_music.py` |
| [Envelopes](#envelopes) | `.amp` to and from Converter's `.a` text | `cybiko_amp.py` |
| [Recordings](#recordings) | CyRecord's IMA ADPCM `.wav` to and from PCM WAV | `cybiko_wav.py` |
| [MXD clips](#mxd-clips) | MXD video clips: play, make from a video | `cybiko_mxd.py` |

Every tab takes files by its file button or by dragging them onto it, and
gives its results as **Save** links (several files come as one ZIP).

## Packs and archives

Choose a `.cap`, `.csu`, `.app`, `.dl` or a dump of the Cybiko's flash; the
page tells which it is.

- **A pack** (`cybiko_cap.py list` / `extract`): the entries with their
  sizes. Each file can be saved as the Cybiko stores it (an application is
  one `.app` archive); the `install.js` scripts come out as text. *Save all
  as ZIP* is `extract`.
- **An archive** (`app`): its parts with the way each is stored (method 0
  plain, 2 compressed) and size. *Save all parts as ZIP* is `app FILE DIR`.
- **A flash dump** (`flash`): the archives CyOS keeps in its flash, by
  offset (the melody player with the sound envelopes is at `026310` in
  CyOS 1.5). The ZIP has a folder for each offset.

Parts in a format the page knows (pictures, melodies, envelopes, recordings,
nested archives and packs, MXD clips) have an **Open** button that takes
them to their tab; `root.inf`, `install.js` and other text has **Text**.

**Make an archive** is `cybiko_cap.py pack`: choose the files (or a folder:
its files, not its subfolders), tick **store** for parts to keep
uncompressed, give the name, *Make archive*. Parts are compressed with CyOS's
method 2 unless stored or not smaller, and `root.inf` goes first.

## Pictures

**Cybiko picture to PNG** (`cybiko_pic.py info` / `to-png`): the kind, size
and images of a `.pic` or `.xpic`, shown enlarged. *Save as PNG* draws every
image at its place (`to-png`); for a file with several images (icons, sprite
sets) *Save each image as PNG* is `to-png --each`. Pixel values 13-15 in an
`.xpic` are drawn black with a warning, as Photo Viewer can't show them.

**Picture to Cybiko** (`from-image`): choose a picture; the result shows at
once and changes with the options:

| Option | Python | What |
| --- | --- | --- |
| Kind | the output's extension | `.pic`, 4 greys, or `.xpic`, 13 greys (for Photo Viewer) |
| Size | `--size WxH` | up to 255 x 255; empty: the picture's own size, scaled down to fit the 160 x 100 screen |
| Fit | `--fit` | pad (white bars), crop, or stretch |
| Dither | `--dither` | Floyd-Steinberg or none (plain rounding) |
| Brightness | `--brightness` | -255 to 255 |
| Contrast | `--contrast` | 1 keeps it |
| Gamma | `--gamma` | below 1 lightens |

PNG (8 bits a channel or less, not interlaced), BMP (8, 24, 32-bit) and
PGM/PPM are read by the page itself, the same way as the Python tool, so the
result is byte for byte the tool's. Other pictures the browser can open
(JPEG, GIF, WebP, AVIF...) go through the browser's decoder, which the Python
tool doesn't have.

## Melodies

Choose a `.mus` or `.music` (the same format), a MIDI file, or a melody as
text.

- A melody shows its version, number of events and length (`info`), and
  appears as text in the editor (`to-text`).
- **A MIDI file** shows its tracks and the options of Cybiko Converter's
  music box (`from-midi`): the tracks to keep (`--tracks`; the drum channel
  is always left out), *Transpose* in semitones, which note plays when
  notes overlap (`--style high|last`), and the *Version*: 1 as Converter
  writes, 0 for the older form (notes F2 to C8 only), 2 with a sound
  *Envelope* (1-60, 0 for none), *Pulse* in microseconds and *Volume*
  (0-255). *Convert* puts the melody in the editor.

The editor holds the melody as text, one item a line, in the format
[`tools/README.md`](../tools/README.md#cybiko_musicpy-melodies) describes;
edit it and then:

- **Play** plays it the way the Cybiko's speaker does (a pulse wave), at the
  chosen sample rate.
- **Save as .music** (`from-text`), **Save as MIDI** (`to-midi`) and **Save
  as WAV** (`to-wav --rate`).

Version 2 melodies need CyOS's sound envelopes to sound right. They are
Cybiko's and not part of the page: open *CyOS's sound envelopes* and choose a
dump of the Cybiko's flash (the page takes `1.amp` to `60.amp` out of the
melody player's archive in it), the melody player's archive, or `.amp`
files. That is `--amp-dir`. Without them those melodies play as plain tones,
with a warning.

## Envelopes

`cybiko_amp.py`. Choose an `.amp`: it shows the time between points, the
levels and a plot (`info`), puts Converter's `.a` text in the editor
(`to-text`) and offers it as *Save as .a text*. Or choose an `.a` file, or
write one in the editor (its format is in
[`tools/README.md`](../tools/README.md#cybiko_amppy-sound-envelopes)), and
*Make .amp* (`from-text`).

## Recordings

`cybiko_wav.py`. Choose a sound file:

- **A CyRecord or CyTalk recording** (IMA ADPCM): its format and length
  (`info`), a player, and *Save as 16-bit PCM WAV* (`to-pcm`).
- **A PCM WAV** (8 or 16-bit, any rate, mono or stereo): it becomes a
  Cybiko recording, mono 8000 Hz IMA ADPCM with CyOS's header
  (`to-cybiko`), with a player to hear how it will sound. *Gain* is
  `--gain`.
- **Anything else the browser plays** (MP3, OGG, AAC, other WAV codecs) is
  decoded by the browser into a 16-bit PCM WAV first and then converted;
  the Python tool wants you to do that with ffmpeg.

## MXD clips

**Play a clip**: an MXD clip (`.app`) plays in the page, its frames over its
sound. *Save the sound* gives its MP3; *Make a ZIP of the frames* gives
every frame as a PNG. (The Python tool's `CLIP.app OUT.mp4` turns a clip into
a video with ffmpeg instead.)

**Make a clip** (`cybiko_mxd.py VIDEO OUT.app`): choose the video. The
clip's player program (`main.e`) is the free one from
[player/](../player/README.md); *Player: Cybiko's, from a CD clip* takes
Cybiko's own from one of the MP3 cartridge CD's clips (`flavor.app`,
`free.app`...) instead, like the Python tool's `--template`. The options are
the tool's: *Name* (`--name`, the desktop name; default the video's file name),
*Frames a second* (`--fps`, 1-5), *Start* and *Length* in seconds
(`--start`, `--duration`), *Fit* (`--fit crop|pad-white|pad-black`: fill the screen, or keep the whole picture with white or black bars), *Dither*
(`--dither fs|bayer|none`), *Gamma* and *Sound*:

- *the video's, 64 kbps 22 kHz mono* (`--audio small`) or *128 kbps 44.1
  kHz stereo* (`--audio hifi`): the browser decodes the video's sound and
  [lamejs](https://github.com/zhuker/lamejs) (LGPL, loaded from jsDelivr
  the first time) makes the MP3.
- *an MP3 file*: used as it is (ID3 tags and a Xing/Info frame are taken
  off), without cutting it to *Start* and *Length*. Works offline.
- *none* (`--audio none`): a silent clip, with no `music.mp3`. The free
  player plays it without sound; Cybiko's player has not been tried with
  one.

The clip is built exactly as the Python tool builds it, but the frames come
from the browser's video decoder and scaler, and the MP3 from lamejs, where
the Python tool uses ffmpeg for both; so the picture can differ by a shade
here and there and the sound file differs. Given the same frames and MP3,
the clip is the same bytes. The browser must be able to play the video
(MP4/H.264 and WebM work in current browsers).

## Files

| File | What |
| --- | --- |
| `index.html`, `style.css`, `app.js` | the page |
| `lib/util.js` | Python's rounding and number formats, bytes, CRC-32, PNG and ZIP writing |
| `lib/bzip2.js` | bzip2 decompression, for EZ Loader packs |
| `lib/cap.js` | packs, archives, CyOS's method 2 (both ways), flash dumps |
| `lib/pic.js`, `lib/music.js`, `lib/amp.js`, `lib/wav.js`, `lib/mxd.js` | the other formats |
| `lib/mxdplayer.js` | the free clip player, made by `player/build.sh` |
| `test/compare.js` | checks the libraries against the Python tools |

The libraries are plain scripts that put everything under one global,
`Cybiko` (`Cybiko.cap.cyEntries(bytes)`, `Cybiko.pic.load(bytes)`...); they
work in Node too (`require` them in the order above, after `util.js`).

## Testing

```sh
node web/test/compare.js SAMPLES_DIR [--quick]
```

Needs Node 18+, Python 3 and ffmpeg. It runs both versions on every Cybiko
file it finds in `SAMPLES_DIR` and its subfolders (packs, archives, a flash
dump as `*.bin`, pictures, melodies, envelopes, recordings) and on inputs it
makes up (pictures in every PNG, BMP and PGM/PPM kind, a MIDI file with
several tracks, tempo changes and drums, WAV files of every sort, a video
for MXD clips), and compares the outputs byte for byte (PNGs by their
pixels, since zlib's output can differ). The Cybiko files are not in this
repository; take them from the Xtreme CD and a flash dump (`cybiko_cap.py
extract` and `app` unpack them). `--quick` uses a few of each.

Last run, with the Xtreme CD's packs and all their applications, the MP3
cartridge's software and clips and a CyOS 1.5 flash dump (191 melodies, 115
pictures, 60 envelopes, 57 archives): 3382 checks, all the same.

## Publishing

`.github/workflows/pages.yml` publishes this folder with GitHub Pages on
every push to `main` that changes it. It needs Pages switched on once:
**Settings → Pages → Build and deployment → Source: GitHub Actions**. The
page is then at https://sovgvd.github.io/cybiko-docs/.

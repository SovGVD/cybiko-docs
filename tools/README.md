# Converters for Cybiko formats

Python 3 tools for every Cybiko Xtreme file format worked out in
[file-formats.md](../file-formats.md). They need nothing beyond Python 3,
except `cybiko_mxd.py`, which uses ffmpeg. Each one prints its full help
when run with no arguments or `--help`.

The same converters run in the browser, with nothing to install:
[web/](../web/README.md) (online at https://sovgvd.github.io/cybiko-docs/).
They give the same bytes as these tools.

| Tool | Formats |
| --- | --- |
| [`cybiko_cap.py`](#cybiko_cappy-packs-and-archives) | EZ Loader packs (`.cap`, `.csu`), CyOS archives (`.app`, `.dl`), flash dumps |
| [`cybiko_pic.py`](#cybiko_picpy-pictures) | pictures (`.pic`, `.xpic`) to and from PNG, BMP, PGM/PPM |
| [`cybiko_music.py`](#cybiko_musicpy-melodies) | melodies (`.mus`, `.music`) to and from text and MIDI, and to WAV |
| [`cybiko_amp.py`](#cybiko_amppy-sound-envelopes) | sound envelopes (`.amp`) to and from Converter's text (`.a`) |
| [`cybiko_wav.py`](#cybiko_wavpy-recordings) | CyRecord's recordings (IMA ADPCM `.wav`) to and from PCM WAV |
| [`cybiko_mxd.py`](#cybiko_mxdpy-mxd-video-clips) | MXD video clips for the MP3 cartridge to and from video |

No Cybiko software or ROM is in this repository; the examples use files
from the Xtreme CD and from a dump of the Cybiko's flash.

Getting files onto a Cybiko: put them in an archive with
`cybiko_cap.py pack` or copy them to the disk with EZ Loader (or, in the
[Dragonfruit](https://github.com/SovGVD/Dragonfruit-JC4827W543-esp32)
emulator, drop them in `/Cybiko/apps` on the SD card).

## cybiko_cap.py: packs and archives

```text
cybiko_cap.py list PACK.cap              what the pack holds
cybiko_cap.py extract PACK.cap DIR       write its files to DIR
cybiko_cap.py app FILE.app [DIR]         list (or unpack) the parts of an archive
cybiko_cap.py pack DIR OUT.app [--store NAME ...]
cybiko_cap.py flash FLASH.bin [DIR]      find (and unpack) the archives in a flash dump
```

- **`list` / `extract`** read EZ Loader's `.cap` and `.csu` packs, the way
  software came on the CDs and from the web site. `extract` writes the
  files as the Cybiko stores them (an application comes out as one `.app`
  archive); the `install.js` scripts come out as text.
- **`app`** lists the parts of a CyOS archive (an application, a library,
  an MXD clip) with their compression method and size, and with a folder
  unpacks them.
- **`pack`** makes an archive of every file in a folder, compressing each
  with method 2 unless it is named after `--store` or doesn't get smaller.
  `root.inf` goes first. The compressor stays within CyOS's 8 KB window.
- **`flash`** finds the archives CyOS keeps in its flash (its own
  applications: the melody player with the sound envelopes, the Calculator,
  fonts) and with a folder unpacks each into a subfolder named by its
  offset.

```sh
python3 cybiko_cap.py extract CyTalk.cap cytalk/      # CyTalk.app, sound.dl, ...
python3 cybiko_cap.py app cytalk/CyTalk.app parts/    # main.e, root.inf, icons, ...
python3 cybiko_cap.py pack parts/ CyTalk2.app         # and back into an archive
python3 cybiko_cap.py flash flash.bin cyos/           # cyos/026310/1.amp ... 60.amp
```

## cybiko_pic.py: pictures

```text
cybiko_pic.py info FILE.pic|.xpic
cybiko_pic.py to-png FILE.pic|.xpic OUT.png [--each]
cybiko_pic.py from-image IN.png|.bmp|.pgm|.ppm OUT.pic|OUT.xpic [options]
```

- **`info`** gives the kind, size and the images in the file.
- **`to-png`** draws every image at its place on one grey PNG. `--each`
  writes one PNG per image instead (`OUT-0.png`, `OUT-1.png`, ...), handy
  for icon files and sprite sets. 1-bit pictures some applications carry
  are read too.
- **`from-image`** makes a `.pic` (4 greys) or an `.xpic` (13 greys, for
  Photo Viewer) from a PNG (grey, colour, palette or with transparency, 8
  bits or less), a BMP (8, 24 or 32-bit) or a PGM/PPM. The output's
  extension picks the kind. Options:
  - `--size WxH`: the picture's size, up to 255 x 255. By default the
    input's size, scaled down to fit the 160 x 100 screen.
  - `--fit pad|crop|stretch`: keep the whole picture with white bars
    (default), fill the size and cut the rest, or ignore the shape.
  - `--dither fs|none`: Floyd-Steinberg dithering (default) or plain
    rounding to the nearest grey.
  - `--brightness B` (-255 to 255), `--contrast C` (1.0 keeps it),
    `--gamma G` (below 1 lightens): adjustments made before the greys are
    picked, like Converter's sliders.

```sh
python3 cybiko_pic.py from-image photo.png photo.xpic --size 160x100 --fit crop
python3 cybiko_pic.py from-image logo.png logo.pic --dither none
python3 cybiko_pic.py to-png intro.pic intro.png
python3 cybiko_pic.py to-png filetype.pic icon.png --each
```

## cybiko_music.py: melodies

```text
cybiko_music.py info FILE.music
cybiko_music.py to-text FILE.music [OUT.txt]
cybiko_music.py from-text IN.txt OUT.music
cybiko_music.py to-midi FILE.music OUT.mid
cybiko_music.py from-midi IN.mid OUT.music [options]
cybiko_music.py to-wav FILE.music OUT.wav [--amp-dir DIR] [--rate HZ]
```

`.mus` and `.music` are the same format; the commands take either.

- **`info`**: the version, number of events, length in seconds and, for
  version 2, the envelope settings.
- **`to-text` / `from-text`**: the melody as text you can edit, and back.
  Every melody on the Xtreme CD survives the round trip byte for byte.
- **`to-midi`**: a one-track MIDI file (repeats unrolled, glides and
  vibrato as pitch bends), to hear or edit a melody in any MIDI program.
- **`from-midi`**: what Cybiko Converter's music box does. Options:
  - `--tracks 0,2`: the tracks to keep, counted from 0 (default: all;
    drum channel 10 is always left out).
  - `--transpose N`: shift by N semitones (12 is an octave). Notes that
    end up outside 0-127 are left out and counted.
  - `--style high|last`: when several notes sound at once, play the
    highest one (Converter's "high-tone envelope", default) or the one
    pressed last ("last pressed note").
  - `--version 0|1|2`: 1 (default) is what Converter writes. 0 is the
    older form most CD games use (notes F2 to C8 only). 2 adds a sound
    envelope, set with `--envelope N` (CyOS's `N.amp`, 1-60; 0 for none),
    `--pulse US` (the pulse time in microseconds, default 1000) and
    `--volume V` (0-255, default 128).
- **`to-wav`**: plays the melody into an 8-bit WAV file the way the
  Cybiko's speaker does: a pulse wave whose width follows the envelope.
  For version 2 melodies pass the folder with CyOS's `1.amp` to `60.amp`
  (from `cybiko_cap.py flash`) as `--amp-dir`; without it they play as
  plain tones. `--rate` sets the sample rate (default 22050).

The text form, one item a line; `;` (or `#` after a space) starts a
comment:

```text
version 2          0, 1 or 2; versions 0 and 1 have no lines like the next three
pulse 1703         the envelope's pulse time, microseconds
volume 10          0-255
envelope 34        CyOS's 34.amp; 0 for none
C#5 10             a note (C4 is middle C, MIDI 60) for 10 ticks of 10 ms (1-255)
glide D5           after a note: slide from it to D5 over its length
rest 5             silence, 50 ms
A4 30
vibrato 1          after a note: wobble around it, up to 1 semitone
loop 0 3           start of a part played 3 + 1 times; slots 0-4, may nest
E4 5
next 0             end of the part in slot 0
raw 0xf8 0         any two bytes, as they are
```

```sh
python3 cybiko_music.py from-midi song.mid song.music --tracks 1 --transpose -12
python3 cybiko_music.py from-midi song.mid song.music --version 2 --envelope 59 --pulse 2000
python3 cybiko_music.py to-text title.music title.txt     # edit, then:
python3 cybiko_music.py from-text title.txt title.music
python3 cybiko_music.py to-wav title.music title.wav --amp-dir cyos/026310
```

## cybiko_amp.py: sound envelopes

```text
cybiko_amp.py info FILE.amp
cybiko_amp.py to-text FILE.amp [OUT.a]
cybiko_amp.py from-text IN.a OUT.amp
```

- **`info`**: the time between points and the points as levels 0.0-1.0.
- **`to-text`**: the envelope as Cybiko Converter's `.a` text, with
  straight runs written as one line (CyOS's own envelopes come out as the
  few lines they were written as).
- **`from-text`**: what Converter does with an `.a` file. The format:

```text
Version   0        ; always 0
Tdiscret  1.000    ; milliseconds between points (0.001 to 65.535)
      0.0          ; the first level, 0.0 (silent) to 1.0 (loudest)
1     1.0          ; the next point
3     0.0          ; 3 points on, the 2 before it on a straight line
end
```

CyOS only uses the envelopes in its melody player, numbered 1-60; a new
`.amp` is only heard by replacing one of those, so this tool is mostly
for reading them.

```sh
python3 cybiko_amp.py to-text cyos/026310/59.amp
python3 cybiko_amp.py from-text fade.a fade.amp
```

## cybiko_wav.py: recordings

```text
cybiko_wav.py info FILE.wav
cybiko_wav.py to-pcm FILE.wav OUT.wav
cybiko_wav.py to-cybiko IN.wav OUT.wav [--gain G]
```

- **`info`**: the WAV's format; for IMA ADPCM, its length and whether it is
  what CyRecord writes.
- **`to-pcm`**: decodes a CyRecord or CyTalk recording into 16-bit PCM,
  for programs that don't read IMA ADPCM.
- **`to-cybiko`**: turns any 8 or 16-bit PCM WAV (any rate, mono or
  stereo) into CyRecord's format: mono, 8000 Hz, IMA ADPCM in 256-byte
  blocks, with the header CyOS writes. `--gain` scales the level first.
  Convert MP3s and the like to WAV first (for example with ffmpeg).

```sh
python3 cybiko_wav.py to-cybiko speech.wav speech_cy.wav
python3 cybiko_wav.py to-pcm 2001-05-01--12-00-00.wav recording.wav
```

## cybiko_mxd.py: MXD video clips

```text
cybiko_mxd.py VIDEO OUT.app [--template CLIP.app] [options]
cybiko_mxd.py CLIP.app OUT.mp4 [--zoom N]
```

Makes a clip for the MP3 cartridge from any video ffmpeg reads, or plays a
clip back into a video. The clip's player program is the free one from
[player/](../player/README.md) (`cybiko_mxd_player.e`, which must stay next
to the script); `--template` takes Cybiko's own from one of the CD's clips
(`flavor.app`, `free.app`, ...) instead. Either needs the MP3 cartridge's
software on the Cybiko. Options: `--name` (the desktop name), `--fps 1-5`,
`--start S`, `--duration S`, `--fit crop|pad-white|pad-black` (bars in
white or black; `pad` is `pad-white`), `--dither fs|bayer|none`,
`--audio small|hifi|none` (none: a silent clip), `--gamma G`. Needs ffmpeg with libmp3lame.

```sh
python3 cybiko_mxd.py trailer.mp4 trailer.app --duration 30
python3 cybiko_mxd.py trailer.mp4 trailer.app --template flavor.app
python3 cybiko_mxd.py flavor.app flavor.mp4
```

## Not here

- **CyOS modules (`main.e`)**: building one needs a compiler for the H8S;
  [`player/mkmodule.py`](../player/mkmodule.py) (used to build the clip
  player) and [cybiko-browser](https://github.com/SovGVD/cybiko-browser)'s
  `tools/cybiko_mkapp.py` turn GNU H8 tools' output into one.
- **`.boot` update images**: their packing is not known yet.

# Cybiko Xtreme file formats

The formats of Cybiko Xtreme software as it was shipped and as CyOS stores
it: EZ Loader packs, CyOS archives (applications, libraries, video clips)
with their compression, CyOS modules, CyOS update images, pictures,
melodies and their sound envelopes, sound recordings and MXD video clips. The RAM disk's own format is in [cyos.md](cyos.md#the-ram-disk).

All of it was worked out from the files on the Xtreme and MP3 cartridge
CDs, by running them in an emulator and by disassembly. Nothing comes from
Cybiko documents. Marks: **Verified** (CyOS loads or plays it, or a tool
built from this reads every sample), **Guess** (reasoned, not proven).

All multi-byte numbers in the CyOS formats are **big-endian**, as on the
H8S. The EZ Loader pack is a PC format and is **little-endian**.

## Contents

- [EZ Loader packs (`.cap`, `.csu`)](#ez-loader-packs-cap-csu)
- [CyOS archives (`.app`, `.dl`)](#cyos-archives-app-dl)
- [Method 2 compression](#method-2-compression)
- [Application parts: `root.inf`, icons, help](#application-parts-rootinf-icons-help)
- [CyOS modules (`main.e`)](#cyos-modules-maine)
- [CyOS update images (`.boot`)](#cyos-update-images-boot)
- [Pictures (`.pic`, `.xpic`)](#pictures-pic-xpic)
- [Melodies (`.mus`, `.music`)](#melodies-mus-music)
- [Sound envelopes (`.amp`, `.a`)](#sound-envelopes-amp-a)
- [Recordings (`.wav`)](#recordings-wav)
- [MXD clips](#mxd-clips)
- [Tools](#tools)
- [Open questions](#open-questions)

## EZ Loader packs (`.cap`, `.csu`)

EZ Loader was the PC program that installed software over the USB cable.
`.cap` holds an application or a set of them; `.csu` is a system update and
has the same format. (**Verified** for the CD's packs.)

```text
offset  size  field
0       3     "CAP"
3       20    unknown (version 1, a timestamp-like value, a check value)
0x17    4     number of entries (u32 LE)
0x1b    ...   entries, then one bzip2 stream with all the entries' data
```

Each entry:

```text
u32 LE  type: 1 folder, 2 file, 3 script
u32 LE  size of its data in the bzip2 stream, XOR 0x55555555
u32 LE  time (unknown encoding)
u32 LE  attributes
...     name: UTF-16 LE, under the 16-bit XOR chain with key 0x8228, no terminator
u32 LE  unknown
```

The name has no length field. A reader finds its end by trying lengths
until the bytes after the name and the u32 look like the next entry's type
(1 to 3, then three zero bytes), or like "BZh" after the last entry.

**The XOR chain:** each plain unit is the cipher unit XOR the previous
plain unit, and the first is XORed with the key: `p[0] = c[0] ^ key`,
`p[i] = c[i] ^ p[i-1]`. It runs on 16-bit units with key 0x8228 for names
and scripts, and on bytes with key 0x82 for files.

After bunzip2, the entries' data follow one another in order. Each one
starts with a 12-byte header: a 32-bit value that is not a CRC32 or a sum
of the data (unknown), then zeros. After the header:

- A **file** (type 2) is bytes under the 8-bit chain with key 0x82. Undone,
  it gives the file exactly as the Cybiko stores it: a CyOS archive, an
  inner `.cap`, or a `.boot` image starting `ff c0 ff ab`.
- A **script** (type 3) is UTF-16 LE text under the 16-bit chain with key
  0x8228. It is JScript that EZ Loader ran on the PC (`install.js`,
  `update.js`). The scripts say where each file goes on the Cybiko's disk.
- A **folder** (type 1) starts a group of the entries that follow.

## CyOS archives (`.app`, `.dl`)

Applications, libraries and MXD clips are all one container.
(**Verified**: CyOS loads archives written this way.)

```text
offset  size     field
0       2        "Cy"
2       2        n: number of parts
4       2        size of the directory below, in bytes = (offset of the first part's data) - 6
6       10 × n   directory: u16 name offset, u32 data offset, u32 stored size
...              names, each NUL-terminated
...              the parts' data, one after another
```

Offsets count from the start of the file. Each part's stored data starts
with a method byte:

- **0, stored:** the part's bytes follow.
- **2, compressed:** a u32 with the unpacked size follows, then the bit
  stream described below.

CyOS's own files in flash (its fonts among them) are kept in the same
container: the browser project reads CyOS's fonts out of a flash dump this
way.

The order of the parts is free. Names are not sorted, and the CD's MXD
clips put `music.mp3` first.

## Method 2 compression

LZ77 with fixed prefix codes. Bits are read **least significant bit
first** from each byte. A field of several bits is put together **most
significant bit first** from successive bits: for n bits,
`v = (v << 1) | next_bit()`, n times. The decoder loops until the unpacked
size is reached:

```text
bit 0  ->  literal: the next 8 bits are a byte
bit 1  ->  match: a length code, then an offset code;
           distance = offset + length; copy `length` bytes from `distance` back
```

Since the distance is at least the length, a match never overlaps itself.
Lengths run from 2 to 256 and offsets from 0 to 8191. In the code tables
below, "prefix" is the bits as read, followed by the extra bits as a number:

| Length prefix | Value | | Offset prefix | Value |
| --- | --- | --- | --- | --- |
| `0` + 1 bit | 2-3 | | `000` + 10 bits | 1024-2047 |
| `10` + 1 bit | 4-5 | | `001` + 9 bits | 512-1023 |
| `1100` | 6 | | `010` + 8 bits | 256-511 |
| `1101` + 1 bit | 8-9 | | `011` + 6 bits | 64-127 |
| `11100` | 7 | | `100` + 7 bits | 128-255 |
| `11101` + 1 bit | 10-11 | | `1010` + 11 bits | 2048-4095 |
| `1111000` | 12 | | `1011` + 12 bits | 4096-8191 |
| `1111001` | 13 | | `1100` + 5 bits | 32-63 |
| `1111010` + 2 bits | 20-23 | | `1101` + 4 bits | 16-31 |
| `1111011` + 1 bit | 16-17 | | `11100` + 1 bit | 0-1 |
| `1111100` + 3 bits | 24-31 | | `11101` + 2 bits | 6-9 |
| `1111101` | 14 | | `111100` + 1 bit | 4-5 |
| `11111100` + 5 bits | 32-63 | | `111101` | 2 |
| `11111101` + 1 bit | 18-19 | | `111110` + 2 bits | 12-15 |
| `11111110` | 15 | | `1111110` | 3 |
| `111111110` + 6 bits | 64-127 | | `1111111` + 1 bit | 10-11 |
| `1111111110` + 7 bits | 128-255 | | | |
| `1111111111` | 256 | | | |

CyOS's decompressor keeps an **8 KB window**: an encoder must make no back
reference further than 8191 bytes (offset plus length), or large
applications load corrupted (**Verified**). A greedy encoder that keeps to
this comes within 4% of Cybiko's own compressor, and CyOS loads its output.
So although the codes allow a distance of up to 8191 + 256, only
distances up to 8191 are safe. Reference code: `cy_unpack` and `cy_pack` in
[cybiko-doom's `tools/cybiko_cap.py`](https://github.com/SovGVD/cybiko-doom/blob/main/tools/cybiko_cap.py)
(it keeps to the window).

## Application parts: `root.inf`, icons, help

An application archive holds its program (`main.e`), its description
(`root.inf`), a desktop icon (`0.ico`) and optionally a help page
(`0.help`, CRLF text). CyOS's own applications and the CD's clips also
carry other parts (data, sound, pictures) that the program reads from its
own archive.

**`root.inf`** is CRLF text, one field per line. For the MXD clip "flavor":

```text
root
flavor            <- the name under the icon (followed by a space on the CD)
(empty)
(empty)
sound.dl          <- library the clip needs
(empty)
Video clip        <- the application type shown in File Manager
21.1.1            <- version of sound.dl needed
1.5.1             <- CyOS version needed (guess)
sound.dl<21.1.1>
```

The first line is where the application shows up: `root` puts it on the
main desktop, `app` and `game` in those folders (**Verified** with native
apps; the Xtreme's WAP browser 21.1.17 needs the first line set to `root`,
and an empty category, to show on the main desktop).

**`0.ico`** (the desktop icon), `root.ico`, `*.pic` parts and the like are
pictures in the `.pic` format ([below](#pictures-pic-xpic)): an icon is
one 2-bit image, 25 x 18 on the CD's clips.

## CyOS modules (`main.e`)

The program part of an application or library. The format (CyOS 1.5, found
in the Xtreme's own applications; **Verified**: CyOS runs modules written
this way):

```text
0   u16  91af            magic
2   u16  2               (always 2)
4   u32  image size      code and data, loaded from offset 2c
8   u32  bss size        zeroed bytes after the image (keep it small)
c   u32  0
10  u32  names size      library names after the image, NUL-terminated;
                         the first is "ordinals" (the kernel)
14  u32  fixups size     4-byte records after the names
18  u32  entry           offset of main(int argc, char **argv, bool start)
1c  4u32 (C++ static constructor and destructor tables)
```

A fixup record is a type byte and a 24-bit offset into the image:

- type 3 adds the load address to the 32-bit word there;
- type 2 adds it to the 24-bit address of a `jsr`/`jmp`;
- `80`+n puts the address of export number (the word's low 24 bits) of
  library n there. CyOS's own applications call kernel exports this way
  (`jsr @N` with a type 80 fixup). Library 0 is the kernel ("ordinals"),
  the others are named in the names list (for example `CyWin.dl`).

The export numbers are in [cyos.md](cyos.md#kernel-exports).

## CyOS update images (`.boot`)

CyOS updates (`ccyph*.boot`) and the radio AVR's firmware (`avr*.boot`).
(**Verified** with `ccyphRU1.5.08r.boot` and `avr50c6f.boot`.)

```text
u32  ffc0ffab   magic
u32  size of the data
u32  size of the data again
...  the data, packed
```

The data is packed (not LZSS and not readable as is). CyOS's flash loader
unpacks it into an installer that programs the flash
([cyos.md](cyos.md#cyos-updates)). The packing itself is not worked out.

## Pictures (`.pic`, `.xpic`)

Cybiko pictures come in two kinds, one container:

- **`.pic`**: four shades, 2 bits a pixel. Icons and the pictures inside
  applications (`intro.pic`, `filetype.pic`) are in this format too.
- **`.xpic`**: "photo" pictures, 4 bits a pixel, 13 shades. Photo Viewer
  (Photo_Viewer.app 21.1.11, on the Xtreme CD) shows them.

Both were made on a PC with **Cybiko Converter** (`Converter_Setup.exe` on
the Xtreme CD): it turns a `.bmp` into a `.pic` ("Four" palette) or an
`.xpic` ("Photo" palette) with brightness, contrast, noise and zoom
sliders and a frame to pick the part of the picture, and turns `.pic` and
`.xpic` back into `.bmp`. File names must be at most 40 characters and not
start or end with `-`, `+` or `.`. (It also converts MIDI files into
[`.music` melodies](#melodies-mus-music) and a text description into
[`.amp` envelopes](#sound-envelopes-amp-a).)

The format (**Verified**: read from Converter's load and save code, and
pictures written this way open in Photo Viewer in an emulator):

```text
u8   bits per pixel: 2 (.pic) or 4 (.xpic); Converter refuses anything else
u8   number of images
u8   width  of the whole picture (the largest x + w of its images)
u8   height of the whole picture (the largest y + h)
then for each image:
  u8 x, u8 y      where it goes (0, 0 for a single picture)
  u8 w, u8 h      its size
  h rows of (w * bpp + 7) / 8 bytes, top row first
```

- **`.pic` pixels**: four to a byte, the leftmost in the top two bits;
  0 white, 1 light grey, 2 dark grey, 3 black. The same layout as the
  screen's memory.
- **`.xpic` pixels**: two to a byte, the leftmost in the top four bits;
  0 white to **12 black**. Converter only writes 0-12 (it quantises with
  12 thresholds and previews them as 255, 235, ..., 15). Photo Viewer gets
  the shades by showing four 2-bit pictures in turn, about every 20 ms;
  pixel value *v* averages out to *v*/4 of the way to black. Values 13-15
  overflow there and come out light again, so they must not be used.
- A `.pic` can hold several images: Photo Viewer flips through them with
  Left/Right (from its manual), and `filetype.pic` in Photo Viewer holds
  two 14 x 14 icons.
- Some applications also carry **1-bit pictures** in the same container
  (first byte 1, eight pixels to a byte, 1 black): Run Reader's
  `big_font.pic` holds 224 glyphs this way. Converter doesn't make them.
- The header's width and height are the whole picture's; some files give
  more than their images cover, so a tool rewriting a file keeps them.
- Photo Viewer lists `*.xpic` and `*.pic` files on the Cybiko's disk and on
  the MP3 cartridge's card.

A 160 x 100 `.xpic` is 8008 bytes; a `.pic` 4008.

## Melodies (`.mus`, `.music`)

Short tunes for the speaker: games' sound effects and title music, the
Calculator's key clicks, CyOS's own alarms. Applications keep them as
parts of their archive (`title.music`, `1.mus`); the two extensions are the
same format. CyOS plays them with its melody player `mplayer.app` (in the
flash; applications import its export 5 to load a melody by name, 1 to
play it and 7 to drop it). Cybiko Converter makes `.music` files from MIDI
files.

(**Verified**: read from `mplayer.app`'s code and Converter's MIDI
writer, all 225 melodies on the Xtreme CD and in CyOS's flash read this
way, and melodies made by hand were played by `mplayer.app` in an emulator
with the speaker's pitch and duty cycle logged.)

```text
u8      version: 0, 1 or 2 (the player refuses anything above 2)
u8      1
u16 BE  size of the events in bytes (even, not 0)
version 2 only:
  u16 BE  pulse time, microseconds
  u8      volume, 0-255 (0x80 is the usual value)
  u16 BE  envelope number: N.amp of mplayer.app, 0 for none
then the events, two bytes each
```

The Xtreme CD's files are version 0 (101 files) and 2 (124); Converter
writes version 1, which is version 0 with the other note code below.

**Events** are pairs of bytes. Lengths count ticks of 10 ms (measured in an
emulator: 40 ticks took 400 ms; whole melodies ran about 2% longer, the
player's own time between events).

| First byte | Second byte | Meaning |
| --- | --- | --- |
| `00`-`43` | length | note: MIDI note 41 + byte (F2 to C8). Version 0 files use these |
| `44`-`c3` | length | note: MIDI note byte - 0x44 (0-127). Versions 1 and 2 use these |
| `ff` | length | rest |
| `f9` | note code | after a note: glide from it to this note over the note's length |
| `f8` | depth | after a note: vibrato of up to *depth* semitones (0: none) |
| `fa`-`fe` | count | start of a part to repeat; slot 0-4 |
| `fa`-`fe` | 0 | end of the part in that slot |

- **Notes** the player can sound are MIDI 29 (F1) to 127 (G9); others play
  as its lowest tone (about 35 Hz). The player turns a note into a timer
  period at 2.304 MHz: period = *T*[n mod 12] >> (n / 12), with *T* =
  44ccf, 40f07, 3d4b6, 39dab, 369b7, 338ad, 30a64, 2deb4, 2b578, 28e8c,
  269cf, 24722 (hex). A4 (69) gets 5236, 440 Hz.
- A length of **0** counts down from 65536 ticks: the note plays for 11
  minutes. Converter never writes 0; long notes are split into 255-tick
  pieces.
- A **glide** (`f9`) or **vibrato** (`f8`) pair belongs to the note before
  it and takes no time. A glide moves the period in a straight line, one
  step a tick. A vibrato cycles through 8 periods, 2 ticks each: a period
  1/8 of the way towards the note *depth* semitones down, halfway back,
  the note, the same upwards, the note again (6 Hz).
- **Repeats**: `fa`+*n* remembers where it is and sets slot 0's counter to
  *n*; `fa 00` jumps back while the counter, counted down each time, was
  not 0. The part plays *n* + 1 times. The five slots `fa` to `fe` can
  nest.
- The melody ends after its last event; the player then stops the sound.

**Version 2's envelope** shapes each note's loudness by the pulse width
([hardware.md](hardware.md#9-sound)). For every note the player builds a
table of high times, one per pulse of the tone, and the timer takes the
next value at the end of each pulse, keeping the last one:

- With an envelope *N* (`N.amp`, [below](#sound-envelopes-amp-a)) of
  points *p* spaced *t* µs apart, the table has ((count - 1) × *t* +
  *X* - 1) / *X* + 1 entries for the pulse time *X*: entry *k* is the
  envelope's level at *k* × *X* µs (a straight line between points),
  times (0x900 × *X* / 1000) × volume / 256, divided by 65536, and at
  least 10. 0x900 × *X* / 1000 is *X* µs in timer ticks, so a level of
  1.0 at volume 256 makes each pulse *X* µs high. If the envelope's *t* is
  0 the pulse time is used, and the other way round.
- With envelope 0 the table is one entry: (0x1200 × *X* / 1000) × volume /
  256, twice that width, for the whole note.
- Versions 0 and 1 have no table: a square wave.

The envelope's time runs at one point per pulse, so it is *X* µs a step
only for a note whose period is *X*; Cybiko's files use pulse times of 0.3
to 9 ms. (**Verified**: the duty cycle the emulator logged matches this
table pulse by pulse.)

A worked example, Mountaineer's `left.music`:

```text
02 01 00 04        version 2, 4 event bytes
06 a7 0a 00 22     pulse 1703 us, volume 10, envelope 34 (34.amp)
8d 0a              C#5 (0x8d - 0x44 = 73) for 10 ticks
f9 8e              gliding to D5
```

**Converter** (MIDI to `.music`) keeps the chosen tracks, transposes, and
makes one line of notes from them: "high-tone envelope" plays the highest
of the notes sounding at a time, "last pressed note" the newest. Notes
outside 0-127 after transposing are left out and counted. It writes
version 1 with no repeats, glides or vibrato.

## Sound envelopes (`.amp`, `.a`)

The loudness shapes of version 2 melodies. CyOS keeps 60 of them, `1.amp`
to `60.amp`, in `mplayer.app`'s archive in the flash: fades in and out,
tremolos, steps. A melody picks one by number. (**Verified**: read from
Converter's code and `mplayer.app`'s, and all 60 read this way.)

```text
u8      version (0)
u16 BE  Tdiscret: microseconds between points
u16 BE  number of points
then the points: u16 BE each, 0 (silent) to 65535 (loudest)
```

With more than one point Tdiscret must not be 0. CyOS's envelopes have 1
to 34 points 7 to 65 ms apart.

Converter writes them from a **text source**, `.a`. Its own template:

```text
;
; This is source text of *.a file for convert it to
; binary amplitude of sound destination *.amp file.
;
Version   0  ; format version for dst *.amp file
Tdiscret  1.000  ; float data discret. time in milliseconds
;
; <first number> 1 : +point number for start point of data
;              >=1 : add to previous = current point number
;         [absent] : 1
; <second number on string> : float t/T = 1/Q
;
      0.0 ; start point
1     1.0
3     0.0
end
```

Each line after the header is an optional step (1 when left out) and a
level from 0.0 to 1.0, stored as level × 65535 rounded. A step *s* of 2 or
more adds *s* points on a straight line from the previous level:
previous + (level - previous) × *k* / *s* for *k* = 1 to *s*, the
division rounded towards 0. The template above gives 0, 1.0, 0.67, 0.33,
0: `00 03e8 0005 0000 ffff aaaa 5555 0000`. CyOS's envelopes come out of
such files exactly: `59.amp`'s 34 points are the three lines `0.0`,
`3 1.0`, `30 0.100008`. The level is "t/T", the share of the pulse that is
high ([above](#melodies-mus-music)).

## Recordings (`.wav`)

CyRecord (the voice recorder) and CyTalk (its Rec button) record from the
Xtreme's built-in microphone into ordinary WAV files: IMA ADPCM, 8000 Hz,
mono, 4 bits a sample, in blocks of 256 bytes (505 samples), with a `fact`
chunk (**from the code**: `sound.dl` 21.1.1 holds this header and writes
it). CyRecord shows them as "32 kbps". `sound.dl` also knows 8 and 16-bit
PCM WAV files. Any WAV tool reads them; the header is:

```text
RIFF size WAVE
fmt  20: 0011 (IMA ADPCM), 1 channel, 8000 Hz, 4055 bytes/s, block 256,
         4 bits, extra 2 bytes: 505 samples a block
fact 4: the number of samples
data ...
```

CyTalk names its recordings `YYYY-MM-DD--HH-MM-SS.wav` in the folder
`WTRecord` on the disk. Whether CyRecord plays other sample rates was not
tried.

## MXD clips

An MXD clip is a short video in four greys with an MP3 sound track, made
for the MP3 cartridge ([mp3-cartridge.md](mp3-cartridge.md)). It is a
CyOS application whose archive holds five parts. (**Verified** by playing
all six clips from the cartridge's CD, and newly made clips, in an
emulator.)

| Part | Method on the CD | Contents |
| --- | --- | --- |
| `music.mp3` | 0 | the sound track: a plain MP3 file |
| `clip.pic` | 2 | the frames |
| `main.e` | 2 | the player program: on the CD 4311 bytes, the same in every clip |
| `root.inf` | 2 | the application's description (above) |
| `0.ico` | 0 or 2 | the desktop icon (above) |

**`music.mp3`** is an MP3 stream that the cartridge decodes. The CD's clips
use 128 kbps 44.1 kHz stereo, or 64 kbps 22.05 kHz mono (`free.app`). An ID3
tag at the start is fine. It is read from the card and streamed to the
decoder like any MP3 file.

**`clip.pic`** is close to a `.pic`, but not one:

```text
u16 BE  frame period, in units of 0.1 ms (2000 = 200 ms = 5 frames a second)
u8      width  (160)
u8      height (100)
then for each frame:
  u8, u8  0, 0   (x, y? always 0)
  u8, u8  160, 100 (width, height again)
  4000 bytes     the picture
```

The picture is 160 × 100 pixels at 2 bits per pixel, row by row from the
top. Each byte holds four pixels, the leftmost in the top two bits. Values
run from 0 (white) to 3 (black). That is the same layout as the Cybiko's
screen memory.

The **frame period** is what the player waits between frames. It was tested
by changing it: 4000 gave 400 ms frames. At 1000 (10 fps) the Cybiko could
not keep up and showed a frame every 500-700 ms, so 5 fps is the practical
maximum. The CD's clips use 2000, 1818 and 1905, and are about 150 frames
for 30 s. The frames are not synced to the music: picture and sound start
together and run side by side. (**Verified** in an emulator whose CPU runs
at the real speed.)

**`main.e`** is the clip player. It reads `clip.pic` and `music.mp3` from
its own archive and plays the music through `sound.dl` (21.1.1, from the
cartridge's software); how is in
[mp3-cartridge.md](mp3-cartridge.md#21-sounddl-as-the-clip-player-uses-it).
It starts the sound, then shows each frame when its time comes (frame *n*
at start + *n* × period), and stops the sound after the last frame. The
CD's player is Cybiko's code. [player/](player/README.md) has two free
ones that do the same, a simple one (which also stops at Esc) and one that
also pauses, seeks and changes the volume, so new clips don't need a CD
file; the [tools](tools/README.md#cybiko_mxdpy-mxd-video-clips) use one of
them unless given a CD clip as a template. (**Verified** in an emulator: the
same frames at the same times and the same sound as the CD's player.)

**Smaller frames.** A frame can be smaller than the screen: its x, y,
width and height place it, rows padded to whole bytes, over what the
screen already shows. The free player draws them (**verified** in an
emulator); whether Cybiko's player does is not known, and the CD's clips
don't use them.

Clips of 30-40 s are what Cybiko shipped and what was tested. Longer ones
should work, since nothing in the format limits the length, but they have
not been tried.

## Tools

[`tools/`](tools/) has a Python converter for each of these formats (pack
and archive tools, pictures, melodies, envelopes, recordings, MXD clips);
[tools/README.md](tools/README.md) says how to use them.

## Open questions

- What unit of time Converter's MIDI reader works in (it divides it by
  10400 to get ticks); the player's tick is 10 ms.
- How sound.dl reaches the speaker and the microphone.

- The pack header (bytes 3-0x16), the per-entry time and trailing u32, and
  the 32-bit value in each file's 12-byte header.
- The packing of `.boot` data.
- Whether Cybiko's clip player draws frames smaller than the screen.

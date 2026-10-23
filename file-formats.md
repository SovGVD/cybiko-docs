# Cybiko Xtreme file formats

The formats of Cybiko Xtreme software as it was shipped and as CyOS stores
it: EZ Loader packs, CyOS archives (applications, libraries, video clips)
with their compression, CyOS modules, CyOS update images and MXD video
clips. The RAM disk's own format is in [cyos.md](cyos.md#the-ram-disk).

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
- [MXD clips](#mxd-clips)
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
Cybiko `.music` melodies and a text description into `.amp` sounds; those
formats are not worked out.)

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
- Photo Viewer lists `*.xpic` and `*.pic` files on the Cybiko's disk and on
  the MP3 cartridge's card.

A 160 x 100 `.xpic` is 8008 bytes; a `.pic` 4008.

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
| `main.e` | 2 | the player program: 4311 bytes, the same in every clip |
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
its own archive and uses `sound.dl` (21.1.1, from the cartridge's software)
to start the cartridge. It is Cybiko's code, so a new clip needs a copy of
it from a CD clip.

Clips of 30-40 s are what Cybiko shipped and what was tested. Longer ones
should work, since nothing in the format limits the length, but they have
not been tried.

## Open questions

- Converter's `.music` (from MIDI) and `.amp`/`.a` sound formats.

- The pack header (bytes 3-0x16), the per-entry time and trailing u32, and
  the 32-bit value in each file's 12-byte header.
- The packing of `.boot` data.
- What the clip player in `main.e` does beyond reading its parts (a free
  clip player would mean clips need no CD file).
- Whether clip frames can be smaller than full screen, using the per-frame
  x, y, width and height fields.

# CyOS on the Cybiko Xtreme

How CyOS (1.5.08, the last Xtreme version) boots, installs updates, stores
files, and runs native applications. The hardware underneath is in
[hardware.md](hardware.md); the file formats in
[file-formats.md](file-formats.md).

Statements are marked as in [hardware.md](hardware.md): **Verified** (seen
CyOS or the boot ROM do it in an emulator, or checked against a dump),
**MAME / datasheet**, or **Guess**. "Export N" is CyOS kernel export number
N, as the Cybiko SDK 2.1 headers number them (`__cyos N`).

## Contents

- [Boot sequence](#boot-sequence)
- [CyOS updates](#cyos-updates)
- [Russian CyOS](#russian-cyos)
- [The RAM disk](#the-ram-disk)
- [File system names](#file-system-names)
- [Native applications](#native-applications)
- [Kernel exports](#kernel-exports)
- [Messages and processes](#messages-and-processes)

## Boot sequence

What the boot loader prints on SCI1 with the `cybikoxt` dumps
(**Verified**):

```
Starting CyOS boot loader v1.5.0
Detecting DRAM interface settings... 10-bit shift
Detecting DRAM size... 2048K
Scanning flash: plain image found
Preparing to load CyOS
Got header: magic 1234ABCD : plain image
Starting 0x6001c8...
Got header: magic = 1C0FFAB, compressed_size = 117922, plain_size = 216348: LZSS compressed image
decompressing...
Got header: magic = 1234ABCD, compressed_size = 4865016, plain_size = 6297700: plain image
Starting 0x4a3bf8...
```

So there are three stages:

1. **Boot ROM** (000000): sets up the bus, sizes the DRAM, scans the flash
   for an image header and jumps into flash at 6001c8. Images start with a
   magic word: `1234ABCD` for a plain image, `1C0FFAB` for an LZSS-compressed
   one.
2. **Flash loader** (6001c8): finds the LZSS-compressed kernel in flash
   (118 KB packed, 216 KB unpacked; its header is at 601864 in the 1.5.08
   dump), unpacks it into RAM and jumps to it.
3. **CyOS kernel** (4a3bf8): starts its objects, scans the RAM disk
   ([below](#the-ram-disk)), and opens the desktop or, on a blank RAM disk,
   the first-run setup (welcome, nickname, contrast, clock).

The sizes in the third header look like garbage (**Guess**: a header the
loader prints without using). The kernel lives in RAM at 480000-4b4000 once
booted. The boot ROM also uses a shift-and-add 32-bit multiply to
unscramble data.

## CyOS updates

CyOS updates came as `.boot` files that EZ Loader sent to the Xtreme over
USB, for example the Russian `ccyphRU1.5.08r.boot` (CyOS 1.5.08, 494 KB).
Their format is in [file-formats.md](file-formats.md#cyos-update-images-boot).

The flash loader knows the update format (magic `FFC0FFAB`). When it finds
one where the kernel's header would be, it unpacks it in RAM into an
installer (a plain image at 4801fa). The installer prints a section table
on SCI1 (`signature=0xB1C3F0D1, target_addr=0x00600000, data_size=...`),
erases and programs the flash from 600000, and restarts. The ID record at
7f800 ([hardware.md](hardware.md#12-flash-and-the-unit-id)) is left alone.
**Verified** with `ccyphRU1.5.08r.boot`, placed where the kernel's header
was: about 17 s to unpack, programming done before 40 s, then the new CyOS
boots from the new flash.

`avr*.boot` files (about 7 KB, for example `avr50c6f.boot`) have the same
format, but their installer targets address 0 with 2 KB of data (the radio
AVR's program) and then waits for that chip. The boot ROM itself also
checks for `FFC0FFAB` (its USB download path). When it scans the flash and
finds one at 600000, it refuses it ("no valid image found").

## Russian CyOS

The Russian CyOS 1.5.08 (`ccyphRU1.5.08r.boot`) has the whole first-run
setup and the desktop in Russian. Letters type as Cyrillic on the ЙЦУКЕН
layout (the `G L E B` keys give `П Д У И`), the desktop's title bar shows
`абв`, and Fn+Space switches to Latin letters and back. A blank RAM disk
gives the first-run setup in Russian. (**Verified** in an emulator.)

## The RAM disk

CyOS keeps every user file (applications, games, messages, settings) in a
RAM disk: the first 512 KB of DRAM, at 400000, kept alive by the backup
battery. When the battery runs flat everything is gone. CyOS 1.5.08 creates
its RAM disk driver with "2000 blocks of 256 bytes, 512 KB at 400000". The
format matches MAME's imgtool `cybikoxt` module and was **Verified** against
a RAM disk CyOS wrote.

The disk is a row of **258-byte pages** from offset 0. Each page is a 16-bit
big-endian checksum and a 256-byte block. The checksum, over the 256 bytes
*b[0..255]*:

```c
uint32_t v = 0;
for (i = 0; i < 256; i++) {
    v = (v ^ b[i] ^ i) << 1;
    v |= (v >> 16) & 1;
}
checksum = (uint16_t)v;
```

The first 5 pages are not used for files. A block is in use when bit 7 of
its first byte is set and the checksum matches. A file block:

| Offset | Size | Meaning |
|---|---|---|
| 0 | 1 | flags; bit 7 = in use |
| 1 | 1 | number of data bytes in this block |
| 2 | 2 | file ID, big endian, the same in every block of a file: the number of its first block, counted from the first file page |
| 4 | 2 | part number, 0 for the first block |
| *part 0 only:* | | |
| 6 | 1 | attributes (20 for a plain file) |
| 7 | | file name, NUL terminated (up to about 58 characters) |
| 45 | 1 | always 7b in files CyOS wrote (meaning unknown) |
| 46 | 2 | parent folder ID, ffff at the top level |
| 4a | 4 | date: seconds since 1900-01-01, big endian |
| 4e | 178 | data |
| *later parts:* | | |
| 6 | 250 | data |

Blocks of a file can be anywhere on the disk and in any order; the part
numbers put them back together. CyOS rebuilds its tables by scanning every
page at start-up, so a file written into a RAM disk image while the machine
is off shows up on the next boot. The checksum of every page is the bulk of
start-up time (about half of all instructions until the desktop appears).

The disk's base, size and block count are constants in the kernel's RAM
disk set-up code. Patched after the loader has unpacked the kernel, they
give CyOS a bigger disk in the same format (an emulator can use the free
addresses 800000-dfffff for up to 6 MB; **Verified** in an emulator).

Applications (`.app`) and libraries (`.dl`) on the disk are CyOS archives
([file-formats.md](file-formats.md#cyos-archives-app-dl)).

## File system names

- The RAM disk is the root. EZ Loader install scripts put applications and
  some libraries in the root and other libraries in `Libraries/`; CyOS
  1.5.08 also finds them all in the root. (**Verified**)
- The MP3 cartridge's card is `/MP3/` (File Manager calls it "Removable
  Disk"), but only with the cartridge software installed: CyOS 1.5.08's own
  memory card scan is a stub. With the newer software set (`sdflash.dl`
  21.1.4, the "MP3Soft" pack) the card mounts; an older set (`sdflash.dl`
  21.1.3, "AddPack") stopped after reading the card's CSD. (**Verified** in
  an emulator; see [mp3-cartridge.md](mp3-cartridge.md#3-the-software-on-the-cybiko).)
- CyOS hides files whose long names have characters outside ASCII (Latin-1
  letters were tried).

## Native applications

A native application is H8S code in a CyOS module (`main.e`) inside an
application archive ([file-formats.md](file-formats.md)). These facts come
from writing three of them (a Doom port, a web browser and the MXD clip
player in [player/](player/README.md), built with the GNU H8 tools `gcc-h8300-hms`/`binutils-h8300-hms`) and running them in an
emulator; the Doom port has since run on a real Cybiko Xtreme too.

- **Calling CyOS.** A module imports kernel exports by number; CyOS's own
  applications do the same. The export numbers are in the SDK headers
  (`__cyos N`). Library exports work the same way, by the library's place
  in the module's list of library names. See
  [file-formats.md](file-formats.md#cyos-modules-maine) for the fixups.
- **Starting.** CyOS calls `main(argc, argv, start)`; with `start` 0 it
  should just return. The browser builds a window application object
  (`cWinApp_ctor`, export 324 of `CyWin.dl`) or a `Process` (export 237:
  object, name, stack size), copies its vtable (the pointer at +10) and
  puts its own thread function in the copied vtable, starts it with export
  1175 (`(thread, 0)`), asks for the focus (export 1034) and returns 0. The
  thread then loops on `Queue_get_message` (export 687) on the queue at
  offset 6c of its process object. Which vtable slot runs the thread
  differs between those two objects (the browser uses slot 7 with
  `cWinApp`; an earlier version used slot 4 with a plain `Process`).
- **Waiting.** `Queue_get_message` with timeout 0 waits until a message
  comes. To look without waiting, use `Queue_peek_message(queue, 1, min,
  max)` (export 940; 1 takes the message off the queue).
- **Ending.** When the thread function returns, the application ends. A
  `cWinApp` application should set bit 2 of the 16-bit word at +4c of its
  object first (Cybiko's clip player does it in its constructor); without
  it the desktop is not drawn again and the screen keeps the
  application's last picture. (Verified in an emulator with the clip
  player.)
- **Data.** The loader zeroes only a small bss area: keep zeroed data
  inside the image (the archive's compression removes the zeros).
- **Alignment.** COFF objects cap data alignment at 4, so tables that need
  32-byte alignment go in a section at a fixed address or are aligned at
  run time.
- **Compression window.** CyOS's archive decompressor has an 8 KB window:
  a back reference further than 8191 bytes loads a corrupted app
  ([file-formats.md](file-formats.md#method-2-compression)).
- **On-chip RAM.** ffdc00-fffbff (8 KB) takes one state per access against
  DRAM's three, for instruction fetches too. CyOS uses it (and the DTC
  keeps descriptors there), so a program that takes it over must save
  CyOS's contents, switch the DTC off (DTCER) and put both back before
  calling CyOS or exiting. The Doom port keeps its stack there (about
  1.1 KB, so no deep recursion), its hot tables and its inner loops.
- **16-bit int.** With `-ms`, gcc-h8300-hms makes `int` 16 bits, so
  arithmetic that a PC build (32-bit `int`) gets right can overflow on the
  Cybiko: `i * 640` with `i` up to 400 wrapped and gave the Doom port
  wrong wall shading, and an `add.w` on a pointer in hand-written code
  wrapped at 64 KB. Cast to `long` where products can pass 32767, and use
  `.l` for addresses. (Found on a real Cybiko.)
- **Memory.** Take what the program needs from CyOS (`malloc`, export 876)
  while CyOS still runs it normally: called from a program that has moved
  to its own stack with interrupts off, `malloc` failed (seen in an
  emulator).
- **Interrupts off.** A program may turn interrupts off to have the whole
  CPU; then it must kick the watchdog itself, `REG16(ffffbc) = 5a00`, and
  give CyOS its interrupts back (and its stack) to call it.
- **Screen.** A program can draw straight to the LCD controller
  ([hardware.md](hardware.md#7-screen-hd66421)) or into CyOS's screen buffer
  (160x100, 2 bits a pixel, rows of 40 bytes, leftmost pixel in the top
  bits, 3 black) and have CyOS show it (`DisplayGraphics_show`, export
  1163).
- **Files.** `FileInput` (exports 250 ctor, 914 open) with `Input_read`
  988, `Input_seek` 1064, `Input_dtor` 119; `FileOutput` 174/912, seek
  1065, write 1282, dtor 85. `Input_*` are not in the SDK headers (its
  bytecode runtime provides them); these are the numbers CyOS's own
  applications import.
- **The application's own parts.** `Archive_open_Ex(archive, name)`
  (export 917) opens a part of the application's archive as a stream; the
  archive is the pointer at +50 of the process object. The stream is not a
  `FileInput`: `Input_read` 988 crashes on it. Call its methods instead, in
  the table that the pointer at +4 of the stream points to: slot 2
  (`+8`) reads a block, `(stream, buffer, length)`, giving the count; slot
  3 (`+c`) reads a byte, -1 at the end. To delete it, take the object the
  stream's first word points to and call slot 3 of the table at +8 of that
  object with `(object, 3)`. Parts stored compressed (method 2) are
  unpacked as they are read. (Verified with the clip player; this is what
  Cybiko's clip player does.)

## Kernel exports

Numbers used by the native applications above (from the SDK headers unless
noted):

| Export | Function |
| --- | --- |
| 85 | `FileOutput` dtor |
| 107 | `Buffer_dtor` |
| 116 | `Process_dtor` |
| 119 | `Input_dtor` (not in the headers) |
| 124 | the current thread |
| 174, 912 | `FileOutput` ctor, open |
| 222 | `Buffer_ctor(b, size, increment)` |
| 237 | `Process_ctor(process, name, stack size)` |
| 250 | `FileInput_ctor` |
| 265 | `Message_delete(m)` |
| 270 | `Message_new(size)` (size = 48) |
| 373 | `Message_attach_buffer(m, b)`: the buffer goes with the message and is freed with it |
| 413 | `Message_check_delivery(m)`: `DL_NONE` 0, `DL_INQUEUE` 1, `DL_WAIT` 2, `DL_ABORT` 3, `DL_TIMEOUT` 4, `DL_SUCCESS` 5 |
| 450 | the time, in the unit MXD clips' frame period counts in (0.1 ms) |
| 468, 469 | the "cool" font, bold and normal (12 dots high, the desktop's) |
| 484 | `cyid2str`: an ID as 7 letters ([radio-protocol.md](radio-protocol.md#5-cybiko-ids)) |
| 501 | `Message_deliver(m, target, cyid, timeout)` |
| 532, 533 | `Graphics_draw_text`, `_Ex` |
| 587 | `TGraph_fill_screen` |
| 610 | `free` |
| 640 | `Message_get_buffer(m)` |
| 649, 651 | `Font_get_char_height`, `Font_get_char_width` |
| 666 | `Process_get_display` |
| 687 | `Queue_get_message(queue, timeout, min, max)`: the next message with min <= msgid <= max, or 0 after timeout ms |
| 701 | the own Cybiko ID |
| 728 | `Buffer_get_size(b)` |
| 739 | `Graphics_string_width_Ex` |
| 757 | `Message_has_buffer(m)` |
| 758 | `Process_has_focus` |
| 851 | `Buffer_load(b, data, offset, length)` |
| 876 | `malloc` |
| 891, 892 | the "mini" font, bold and normal (9 dots high) |
| 914 | `FileInput_open` |
| 917 | `Archive_open_Ex(archive, part name)`: a part of an archive as a stream (see above) |
| 939 | `SystemThread_pause(thread, ms)` |
| 940 | `Queue_peek_message(queue, remove, min, max)`: like 687 without waiting |
| 943 | `Message_post(m, target, cyid)`: without delivery tracking |
| 988 | `Input_read` (not in the headers) |
| 1034 | `Process_request_focus` |
| 1064 | `Input_seek` (not in the headers) |
| 1065, 1282 | `FileOutput` seek, write |
| 1108 | `TGraph_set_color` |
| 1126 | `Graphics_set_font` |
| 1163 | `DisplayGraphics_show` |
| 1170 | `sprintf` |
| 1175 | `Thread_start(thread, 0)` |
| 1196 | `Buffer_store(b, data, offset, length)` |
| 1212 | `strlen` |
| 1340 | the best gate's ID, 0 if none ([cywig.md](cywig.md#2-finding-the-gate)) |

The radio's exports (channels, people around, pings) are listed where they
are used in [radio-protocol.md](radio-protocol.md).

## Messages and processes

Applications talk to each other, on the same Cybiko or over the radio, with
messages ([radio-protocol.md](radio-protocol.md#9-messages) has how they go
over the air). An application sees a message as a `struct Message` (48
bytes):

| Offset | Field |
| --- | --- |
| 0 | `struct Buffer *buffer`: the data, if any |
| 4 | `char procname[12]` |
| 10 | `struct Message *next` |
| 14 | `char *dst_name`: the target, a process name or a port number below 256 |
| 18 | `cyid_t cyid_from` |
| 1c | `cyid_t cyid_to` |
| 20 | `u8 deleted`, `u8 pad` |
| 22 | `short msgid` |
| 24 | `long param[2]`: p0 and p1 |
| 2c | `void *session` |

A `struct Buffer` is 40 bytes, opaque.

To send to a port, the target is the port number cast to a pointer:
`Message_deliver(m, (char *)0x93, gate, timeout)`. The timeout is in ms
(the WAP browser uses at most 60000); OR-ing in `MSG_AUTODELETE`
(80000000) makes CyOS delete the message once it is delivered.

A process's queue is at offset 6c of its `Process` object. A message that
comes over the radio to a process name lands in that process's queue with
msgid, p0 and p1 as sent, and the data in an attached buffer. CyOS tells
applications about people appearing and leaving on the radio with
`MSG_DEVICE` (43).

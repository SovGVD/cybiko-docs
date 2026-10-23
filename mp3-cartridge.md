# The Cybiko Xtreme MP3 cartridge

The MP3 player cartridge (model CY45P01, sold in 2001) plugs into the Cybiko
Xtreme's expansion port. It holds an SD/MMC card slot, an MP3 decoder chip and
a headphone jack. With it the Cybiko plays MP3 files from the card, runs games
and apps from the card, and plays MXD clips: short videos in four greys with
an MP3 sound track. Cybiko published nothing about how the cartridge works,
and its software was only on the cartridge's CD.

This document covers the hardware as the Cybiko sees it (pins, buses,
protocols and timing) and the software CyOS runs for it, in enough detail to
build an emulator, a replacement cartridge, or new content. The file formats
(EZ Loader packs, CyOS archives, MXD clips) are in
[file-formats.md](file-formats.md); the Cybiko itself in
[hardware.md](hardware.md).

All of it was worked out from the files on the CD. The method was to run the
CD's drivers (`CartMan.dl`, `sddisk.dl`, `00000000.dl` and the others) in an
emulator, disassemble them, and model the hardware until the original MP3
Player and MXD clips worked. Nothing comes from Cybiko or chip documentation,
and nothing has been checked against a real cartridge yet.

Each statement is marked by how sure it is:

- **Verified:** the original software works against this model in the
  emulator.
- **Observed:** this is what the software does, but nothing depends on it yet.
- **Guess:** reasoned from the evidence, not proven. These are called out
  where they appear.

Contents:

1. [The hardware](#1-the-hardware)
2. [The software on the Cybiko](#2-the-software-on-the-cybiko)
3. [Building your own: pitfalls](#3-building-your-own-pitfalls)
4. [Open questions](#4-open-questions)

## 1. The hardware

### 1.1 Overview

The Cybiko Xtreme's CPU is a Hitachi H8S/2323. The cartridge has no
processor of its own; CyOS drives every part of it directly through the
expansion port:

| Signal | H8S resource | Direction | Use |
| --- | --- | --- | --- |
| Cartridge ID | ADC channel 3 | in | which cartridge is plugged in |
| I2C SCL | P2.1 | out (open drain) | decoder control clock |
| I2C SDA | P2.3 | in/out (open drain) | decoder control data |
| SD chip select | P2.2 | out | low selects the card |
| Card detect | P2.0 | in | low while a card is in the slot |
| MPEG data | SCI0, clocked synchronous | out | compressed audio to the decoder |
| DEMAND | P6.6 and IRQ2 | in | the decoder wants more data |
| SD card | SCI1, clocked synchronous | in/out | the card in SPI mode |

Port 3 is also set up when the cartridge starts (P3DDR 0x33 / 0x11 and data
0x0c / 0x2e are written). Those bits set the SCI pin directions; nothing on
the cartridge seemed to need modelling for them. (Observed.)

### 1.2 Detection

`CartMan.dl` reads ADC channel 3 (Verified):

- **0x3ff (full scale):** the slot is empty. The pin is pulled up.
- **Below about 15:** cartridge ID 0, the MP3 player. The cartridge
  presumably ties the pin to ground through a resistor that sets its ID.
  Other IDs were apparently planned.

### 1.3 The decoder and its I2C control port

The decoder is a Micronas MAS35xx MP3 decoder, controlled over I2C. CyOS
bit-bangs the I2C on P2.1 (SCL) and P2.3 (SDA). It releases a line by making
the pin an input and drives it low by making it an output that is low. That
is open drain, so a released line reads high unless the decoder pulls it
low. The decoder answers at address **0x3c** for writes and **0x3d** for
reads. (Verified.)

The manual gives the decoding range: MPEG 1, 2 and 2.5, layers 2 and 3,
8-320 kbps, 8-48 kHz. That fits the MAS 3507D, but the codec-register
writes below look more like the later MAS 3529/3539/3587 family. The exact
part is a guess either way.

Each message is a start condition, the address byte 0x3c, a subaddress, the
data, then a stop condition. Subaddresses work like the MAS family's: 0x68 is
a DSP data write, 0x69 a DSP data read, 0x6a a control register write, and
0x6c a codec register write. The sequence the software sends (Observed;
exact order from `--cart-log`):

```text
3c 6a 80 00                   control register (meaning unknown; sent 6 times)
3c 6a 8c 00                   control register (meaning unknown; sent twice)
3c 68 70 00, then 3c 69, 3d   read the chip version (4 bytes; 0s are accepted)
3c 6c 00 00 00 01             codec register 0x00 = 0x0001
3c 6c 00 06 00 00             codec register 0x06 = 0x0000
3c 6c 00 07 40 00             codec register 0x07 = 0x4000
3c 6c 00 01 00 08             codec register 0x01 = 0x0008
3c 68 e0 00 00 01 03 4b 00 00 00 0c    DSP memory D0:0x34b = 0x0000c (one word)
3c 68 e0 00 00 01 03 46 00 00 00 25    DSP memory D0:0x346 = 0x00025
3c 6c 00 14 00 00             bass   = 0
3c 6c 00 15 00 00             treble = 0
3c 6c 00 1e 00 00             loudness off
3c 6c 00 11 00 00             balance = centre
3c 6c 00 10 6a 00             volume = 0x6a (the default)
3c 6c 00 10 00 00             volume = 0 (mute; sent 6 times, around starting and stopping)
```

**Codec register writes** take the form `6c 00 rr hh ll`, which writes
`hhll` to register `rr`. The registers the player uses (Verified that the
player writes them; their effect is a guess):

| Register | Meaning | Values seen |
| --- | --- | --- |
| 0x10 | volume, in the high byte | 0x00 mutes, 0x6a is the default, and the slider moves it in steps |
| 0x11 | balance | 0x00 is centre |
| 0x14 | bass | 0x00 |
| 0x15 | treble | 0x00 |
| 0x1e | loudness | 0x00 |

The real chip's volume curve is not known (1 dB per step relative to 0x6a,
with 0 meaning silence, sounds right).

**Reads:** the version read is the only read the software makes. The player
accepts zeros, so a model can ACK every byte sent to 0x3c/0x3d and answer
zeros.

**Power:** a model can keep the decoder's DEMAND line (below) low until the
first I2C message is ACKed, as "the decoder is on" (**Guess** for the real
chip).

### 1.4 Audio data: SCI0, DEMAND and IRQ2

The compressed MPEG stream goes to the decoder on **SCI0 in clocked
synchronous mode**, as plain bytes of the MP3 file. The decoder has a
**DEMAND** line, read on **P6.6** (bit 6 of port 6, address 0xffff55), that
is high while it can take more data. The same line drives **IRQ2**, set by
CyOS to trigger on the rising edge (ISCRL = 0xa0). (Verified.)

The driver works like this. Its IRQ2 handler is in `00000000.dl`, around
0x166e in the disassembly. (Verified against the emulator.)

1. The player task fills a ring buffer with MPEG data read from the card.
2. When DEMAND rises, IRQ2 fires. The handler sends **32-byte bursts** on
   SCI0, polling TDRE between bytes, for as long as P6.6 reads high.
3. If the ring buffer is empty while DEMAND is high, the handler sends
   **zeros** (from a zero buffer around 0x52a4) and sets SCI0's BRR to 1.
   The decoder skips them as junk.
4. The handler returns when DEMAND goes low. The next rising edge starts
   the next round.

A model has to behave like a real decoder in a few ways:

- **Lower DEMAND before the buffer fills, while a full burst still fits.**
  The handler checks DEMAND between bursts, not between bytes, so bytes
  sent into a full buffer are lost. A 2 KB FIFO that lowers DEMAND when
  fewer than 64 bytes are free and raises it again when half empty works,
  and gives the rising edge IRQ2 needs.
- **Consume the data at the stream's real bit rate, junk included.** CyOS
  feeds zeros while its buffer is empty and stops only when the decoder
  stops asking. A decoder that skips junk instantly keeps DEMAND high
  forever, the handler never returns, and the watchdog resets the Cybiko.
  A model should play skipped bytes as silence for as long as they would
  last at the last bit rate seen (128 kbps before the first frame).
- **Take the data at playback speed in the emulated machine's time**, not
  in real time. If the decoder takes it faster, the player skips ahead. If
  it takes it slower, playback stutters. An emulator that runs slower than
  the real machine and still drains the data in real time starves the
  player: the IRQ2 handler then feeds zeros without end, and the watchdog
  resets the Cybiko. Pace the decoder's input by emulated time, and let the
  sound have gaps when the emulation falls behind.

### 1.5 The SD card: SPI over SCI1 with DMA

The card is used in **SPI mode** on **SCI1** in clocked synchronous mode.
SCMR is set so bytes go MSB first, as SPI needs. Chip select is **P2.2**,
active low. Card detect is **P2.0**, which reads low while a card is in.
(Verified.)

**Start-up** (Verified):

1. With chip select high, at least 80 clocks: 10 bytes of 0xff.
2. CMD0 with chip select low. The card answers R1 = 0x01 (idle).
3. CMD55 + ACMD41, repeated until R1 = 0x00. MMC cards use CMD1 instead
   of ACMD41; whether the driver falls back to CMD1 for an MMC was not
   tested.
4. CMD9: read the CSD (a 16-byte data block) to get the card's size.
   Other paths may use CMD10 (CID), CMD13, CMD16 (block length 512), CMD58
   and CMD59; none was seen.

**Reading** (Verified):

- Addresses are **byte addresses** (SD version 1). The argument of CMD17
  or CMD18 is the block number × 512. SDHC block addressing is not known
  to the driver, so cards over 2 GB cannot work.
- Single blocks use **CMD17**. Runs use **CMD18**, followed by **CMD12**
  after the last block. The player was seen reading music in runs of 9
  blocks.
- The card's reply: R1, then 0xff bytes until the start token **0xfe**,
  then 512 data bytes, then 2 CRC bytes. The driver's token wait treats any
  byte of 0x0f or below as a data error token.
- CRCs are not checked by the driver.

**Writing** (**Guess**: the standard SD protocol; nothing tested so far
writes):

- **CMD24** writes one block and **CMD25** writes several. Each block is
  token 0xfe (0xfc for CMD25), 512 data bytes and 2 CRC bytes. The card
  answers with a data response of 0x05 (accepted), then busy.
- Formatting the card on the Cybiko and copying files to it presumably
  use writes (a guess).

**DMA.** The driver moves block data with the H8S DMA controller (Verified):

- **Channel 0A** copies each received byte from SCI1's RDR to the buffer.
  SCI1's RXI triggers it.
- **Channel 0B** keeps the clock running. It is in **idle mode** (DTIE
  set): it writes a fixed 0xff to TDR again and again, with the memory
  address held fixed, and counts ETCR down. When the count ends it raises
  **DEND0B**.
- The DEND0B handler (around 0xee6 in the disassembly) clears
  DTE0B and DTIE0B, writes **SCR = 0** to stop SCI1, and sets a "done" flag
  that the read routine polls.

Three details of the H8S matter here. Getting any of them wrong breaks
reads:

- **Idle mode must count and end.** If channel 0B never raises DEND, the
  driver times out after about a second, then retries with CMD12 and a CMD9
  with argument 0xffffffff.
- **Switching a channel into idle mode reloads the full ETCR count.**
- **Writing SCR = 0 while a byte is being clocked must still finish that
  byte.** The last data byte would be lost otherwise, because the DEND
  handler stops the SCI before RXI has fired for it.

**Size limits:**

- The driver knows only byte addressing, so a CSD of version 1.0 (which can
  describe at most 2 GB, 1 GB with 512-byte blocks) is what it can use.
- CyOS reads the card as FAT16. It reads 16 KB clusters correctly; at 32 KB
  clusters (which FAT16 needs above 1 GB) it reads wrong data. Tried in the
  emulator with a 2 GB card and a CSD using 1024-byte blocks.
- So **1 GB** is the practical limit. The manual's "any capacity" meant the
  cards of 2001: 8 to 128 MB.

**File system** (Verified with generated FAT16 card images):

- An MBR with one partition (type 4 or 6) and FAT16 in it. Long file names
  are supported.
- CyOS mounts the card as `/MP3/`. File Manager shows it as "Removable
  Disk".
- The MP3 Player lists the `.mp3` files at the top level. Subfolders are
  readable but not in its playlist.
- A long name with any character outside ASCII hides the file. Latin-1
  letters were tried.
- Applications (`.app`) on the card get desktop shortcuts and run from the
  card. That includes MXD clips.

## 2. The software on the Cybiko

`MP3.cap` on the CD (an EZ Loader pack, [file-formats.md](file-formats.md#ez-loader-packs-cap-csu))
holds the cartridge's software. The descriptions below come from the files' names,
their imports, and what they were seen doing. Most of them are a guess:

| File | Role |
| --- | --- |
| `00000000.dl` | low-level driver loaded first: IRQ2 handler, SCI0 feeding, ring buffer |
| `CartMan.dl` | cartridge manager: reads the ADC ID and loads the drivers for it |
| `DeviceMan.dl`, `InterfaceMan.dl` | device and interface registry for add-ons |
| `sddisk.dl` | SD/MMC card driver: SPI commands, DMA, block reads and writes. Its function table, as loaded in the emulator at 0x581c, has the command send at +0x1c, the token wait at +0x28, the CSD read at +0x34 and command-with-data at +0x38 |
| `sdflash.dl` | FAT file system on the card (mounted as `/MP3/`) |
| `FSAgent.dl` | hooks the card into CyOS's file system and desktop |
| `format_rd.dl` | formats the card ("Format..." in File Manager) |
| `mp3init.dl` | start-up hook that brings the cartridge up |
| `MP3AudioStream.dl`, `MP3Player.dl`, `CyPlayer.dl` | the decoder control (I2C) and the streaming player engine |
| `sound.dl` | the sound library MXD clips use (version 21.1.1) |
| `Mp3Player.app` | the MP3 Player application |
| `root.ico`, `install.js` | the pack's icon, and the EZ Loader install script |

### 2.1 sound.dl, as the clip player uses it

Worked out from the CD's clip player and checked by writing a free one
([player/](player/README.md)), in an emulator. `sound.dl`'s export 0
returns the sound system, a C++ object. Every object here has its method
table at its first word; the numbers below are byte offsets into it, and
the object itself is the first argument.

| Object | Offset | Method |
| --- | --- | --- |
| system | 3c | `(":music.mp3")`: opens a part of the application's archive (or a file) as a source; 0 if not there |
| system | 18 | `(device)`: an output, `"MP3AudioOutput"` for the cartridge's decoder or `"speaker"` |
| system | 44 | `(object)`: releases a source, output or converter |
| source, output | 48 | its format |
| format | c | the format's name: `"MP3"`, `"IMAADPCM"` |
| format | 8 | `(other format)`: a converter between them |
| converter | 48, 4c | its output and input formats |
| output | 18 | ready: false when the decoder is in use ("The music codec is busy. Please try later") |
| output, source | 88 | `(source)`: connects them; `(0)` disconnects |
| source | 80 | `(format)`: sets the source's format (after a converter) |
| output | c, 10, 14 | start, stop, playing |
| output | 1c, 90 | close, disconnect |

The clip player opens `:music.mp3` (or `:music.wav`), takes the output for
the source's format (`MP3AudioOutput` for MP3, `speaker` for IMA ADPCM),
gives up if the output isn't ready, connects them (through a converter when
the two formats' names differ), waits 200 ms and starts it. At the end it
stops it, waits while it is playing, closes and disconnects it and releases
the source, the output and the converter.

### 2.2 Installing

`install.js` puts `*.app`, `InterfaceMan.dl`, `mp3init.dl`, `CyPlayer.dl` and
`format_rd.dl` in the root of the Cybiko's disk, and the other `.dl` files in
`Libraries/`. CyOS 1.5.08 also finds them when they are all in the root.
(Verified.)

CyOS itself (1.5.08 in flash) has no cartridge code that works on its own:
its memory card scan is a stub. Everything comes from these files. An older
set of them (`sdflash.dl` 21.1.3, in the "AddPack" pack) did not mount the
card in the emulator: its card start stopped after reading the CSD. The
newer set (`sdflash.dl` 21.1.4, "MP3Soft") works.

## 3. Building your own: pitfalls

These cost the most time while bringing the cartridge up. They apply to any
emulator of the cartridge, and some to the Cybiko in general:

- **The MP3 Player takes about 10 seconds to open.** Key presses before then
  are lost. "No sound" was this more than once.
- **Nested DTC transfers.** The H8S data transfer controller can start a
  transfer while another one's memory access is in progress. Keep the "DMA
  access in progress" state per transfer, saved and restored around nested
  ones. Otherwise the outer transfer is cut short, and SD block reads stall
  for a second until the driver's timeout.
- **DMA idle mode** must count down and raise DEND (see
  [1.5](#15-the-sd-card-spi-over-sci1-with-dma)).
- **SCR = 0 mid-byte** must complete the byte (see
  [1.5](#15-the-sd-card-spi-over-sci1-with-dma)).
- **DEMAND hysteresis and pacing** (see
  [1.4](#14-audio-data-sci0-demand-and-irq2)): without them bytes are lost,
  or the watchdog fires.
- **Test with several FAT layouts.** Cluster size and layout change which
  code paths the driver takes. The nested DTC bug only showed with some
  images.

## 4. Open questions

- **The decoder part number**, and the meaning of control register values
  0x8000 / 0x8c00 and DSP words D0:0x346 / 0x34b. A MAS 3507D or MAS 3587F
  datasheet would settle it.
- **The volume curve** of codec register 0x10.
- **The pack and clip formats:** see [file-formats.md](file-formats.md#open-questions).
- **SD writes on real cards** (formatting, copying to the card) are
  untested.

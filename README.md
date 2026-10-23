# Cybiko docs

Technical documentation of the **Cybiko Xtreme** (2001): its hardware,
CyOS, file formats, radio and chat protocol, the Internet gate (CyWIG) and
the MP3 cartridge. It is meant for anyone writing an emulator, a native
application, a gate, or another device that talks to Cybikos.

Cybiko Inc. published little of this. Everything here was worked out from
MAME's `cybikoxt` driver, chip datasheets, the Cybiko SDK 2.1 headers, the
software on the Xtreme and MP3 cartridge CDs, and by running CyOS 1.5.08 in
an emulator and watching what it does. Each document marks how sure each
statement is (verified, from the code or a datasheet, or a guess). **None
of it has been checked on a real Cybiko yet**: if you have one and can
check something, please open an issue.

| Document | What |
| --- | --- |
| [hardware.md](hardware.md) | CPU, memory map, bus timing, interrupts, pins, keyboard matrix, screen, clock, sound, serial ports, radio co-processor (and CyTalk's voice mode), flash and unit ID, standby |
| [cyos.md](cyos.md) | Boot sequence, CyOS updates, Russian CyOS, the RAM disk format, native applications, kernel exports, messages and processes |
| [file-formats.md](file-formats.md) | EZ Loader packs (`.cap`, `.csu`), CyOS archives (`.app`, `.dl`) and their compression, `root.inf` and icons, CyOS modules (`main.e`), update images (`.boot`), pictures (`.pic`, `.xpic`), melodies (`.mus`, `.music`), sound envelopes (`.amp`), recordings (`.wav`), MXD video clips |
| [radio-protocol.md](radio-protocol.md) | Packets, CRCs and Reed-Solomon parity, Cybiko IDs, channels, pings, delivery, messages, Chat |
| [cywig.md](cywig.md) | The Cybiko Wireless Internet Gate: finding a gate, packed messages, the WAP browser's requests, the original VCyWIG gate |
| [tools/](tools/README.md) | Python converters for these formats: packs and archives, pictures, melodies (with MIDI), envelopes, recordings, MXD clips |
| [web/](web/README.md) | The same converters in the browser, nothing to install: [sovgvd.github.io/cybiko-docs](https://sovgvd.github.io/cybiko-docs/) |
| [mp3-cartridge.md](mp3-cartridge.md) | The MP3 cartridge (CY45P01): detection, the decoder's I2C and data lines, the SD card over SPI with DMA, its software, pitfalls |

## Projects that use this

- [Dragonfruit](https://github.com/SovGVD/Dragonfruit-JC4827W543-esp32):
  a Palm OS and Cybiko Xtreme emulator for the JC4827W543 ESP32-S3 board,
  where most of this was found. Its own docs cover how the emulator models
  the machine, the radio over ESP-NOW, and the MP3 cartridge's card.
- [cybiko-browser](https://github.com/SovGVD/cybiko-browser): a web
  browser for the Cybiko (a native CyOS app) and a gate for it.
- [cybiko-doom](https://github.com/SovGVD/cybiko-doom): a Doom port for
  the Cybiko Xtreme.

No ROM, flash dump or Cybiko software is in this repository.

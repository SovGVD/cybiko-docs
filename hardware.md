# Cybiko Xtreme hardware

A technical reference to the Cybiko Xtreme (2001): the chips, the memory
map, and how the screen, keys, clock, sound, serial ports, radio and flash
are wired. It is written for anyone who wants to write an emulator, poke at
a real machine or just understand the thing. How CyOS boots and stores
files is in [cyos.md](cyos.md); the radio's packets in
[radio-protocol.md](radio-protocol.md); the MP3 cartridge in
[mp3-cartridge.md](mp3-cartridge.md); USB in [usb.md](usb.md).

Nothing here comes from Cybiko Inc. documents. The sources are MAME's
`cybikoxt` driver and its H8 peripheral models (Tim Schuerewegen, Olivier
Galibert), the Hitachi H8S/2323 hardware manual, the chip datasheets, MAME's
imgtool, and running CyOS 1.5.08 in an emulator and watching what it does.
Each statement is marked:

- **Verified**: CyOS 1.5.08 or the boot ROM was seen doing this in the
  emulator, or it was checked against a dump.
- **MAME / datasheet**: taken from MAME or a datasheet and not contradicted by
  CyOS so far, but not separately checked.
- **Guess**: a reasonable reading that nothing has confirmed.

None of it has been checked on a real Cybiko yet.

## Contents

1. [The machine at a glance](#1-the-machine-at-a-glance)
2. [Memory map](#2-memory-map)
3. [Bus timing](#3-bus-timing)
4. [Interrupts](#4-interrupts)
5. [I/O ports and pins](#5-io-ports-and-pins)
6. [Keyboard](#6-keyboard)
7. [Screen: HD66421](#7-screen-hd66421)
8. [Real-time clock: PCF8593](#8-real-time-clock-pcf8593)
9. [Sound](#9-sound)
10. [Serial ports and the debug console](#10-serial-ports-and-the-debug-console)
11. [Radio](#11-radio)
12. [Flash and the unit ID](#12-flash-and-the-unit-id)
13. [Power and standby](#13-power-and-standby)
14. [Other on-chip peripherals](#14-other-on-chip-peripherals)
15. [Open questions](#15-open-questions)

## 1. The machine at a glance

| Part | Chip | Notes |
|---|---|---|
| CPU | Hitachi H8S/2323 | 18.432 MHz, advanced mode (24-bit addresses), mode 7 |
| Boot ROM | 32 KB | `cyrom150.bin`, boot loader v1.5.0 |
| RAM | 2 MB DRAM | at 400000; the first 512 KB is kept alive by the backup battery |
| Flash | SST39VF400A, 512 KB | `cyos_v1508.bin`: CyOS, its loader and the unit ID |
| Screen | Hitachi HD66421 | 160×100, 2 bits a pixel (four shades) |
| Clock | Philips PCF8593 | on a bit-banged I2C bus |
| Radio | AT90S2313 AVR plus an RF2915 transceiver | the AVR talks to the H8S over SCI2 |
| Speaker | piezo on P15 | square waves from TPU channel 1 or from software |
| Keyboard | matrix read through the bus | at e00000 |
| Cartridge | rear connector on port 2 | the MP3 player module ([mp3-cartridge.md](mp3-cartridge.md)) |

**MAME / datasheet** for the chip list. The clock rate, mode and RAM size are
**Verified**: the boot ROM prints the detected DRAM size, and CyOS's timing
(clock, sound pitch, radio baud rate) only comes out right at 18.432 MHz.

The CPU is an H8S/2000 core: sixteen 16-bit registers that pair into eight
32-bit ones (ER0-ER7, ER7 is the stack pointer), big-endian, with a 16 MB
address space. Every peripheral (timers, serial ports, A/D, DMA, interrupt
controller) is part of the chip; the board adds only the devices in the
table.

The original Cybiko (the Classic) is a different machine; programs for it
do not run on the Xtreme. This document is about the Xtreme only.

## 2. Memory map

| Address | Size | What |
|---|---|---|
| 000000-03ffff | 32 KB, mirrored | boot ROM |
| 100000-100001 | 2 bytes | HD66421 LCD: 100000 index register, 100001 data |
| 200000-200003 | | USBN9604 USB controller: 200003 register number, 200000 value ([usb.md](usb.md)) |
| 400000-5fffff | 2 MB | DRAM. 400000-47ffff is the RAM disk |
| 600000-7fffff | 512 KB, mirrored | SST39VF400A flash, 16 bits wide |
| 800000-dfffff | | nothing (an emulator can put a bigger RAM disk here, see [cyos.md](cyos.md#the-ram-disk)) |
| e00000-efffff | | keyboard matrix ([§6](#6-keyboard)) |
| ffdc00-fffbff | 8 KB | on-chip RAM |
| fffe80-ffffff | | on-chip I/O registers |

**MAME / datasheet**, with the flash and RAM ranges **Verified** (the boot
ROM scans flash at 600000, CyOS runs from RAM at 4xxxxx).

The address space is split into eight 2 MB "areas" for bus timing (area *n*
starts at *n* × 200000). Area 0 is the ROM, area 2 the DRAM, area 3 the
flash.

Notable I/O registers outside the peripherals (H8S/2323 manual):

| Address | Register |
|---|---|
| fffec4-fffece | IPRA-IPRK, interrupt priorities |
| fffed0 / fffed1 | ABWCR, ASTCR (bus width, 2/3-state access per area) |
| fffed2-fffed3 | WCRH/WCRL (wait states per area) |
| fffed4-fffed5 | BCRH/BCRL (BCRH low bits pick area 2 as DRAM) |
| fffeb0-fffebf | port data direction registers (write only) |
| ffff2c-ffff2f | ISCR (IRQ edge/level), IER, ISR |
| ffff38 | SBYCR (standby control) |
| ffff39 | SYSCR |
| ffff3b | MDCR, reads 87: mode 7 |
| ffff3c-ffff3d | MSTPCR (module stop: 1 = peripheral switched off) |
| ffff50-ffff5f | port input pins (PORT1-PORTG) |
| ffff60-ffff6f | port output registers (DR) |

## 3. Bus timing

How long a memory access takes is set per area by three registers:

- **ABWCR** bit *n*: area *n* is 8 bits wide (a 16-bit access takes two
  cycles).
- **ASTCR** bit *n*: area *n* uses 3-state cycles, otherwise 2-state.
- **WCR** two bits per area: 0-3 wait states added to a 3-state cycle.

After reset every area is 8-bit, 3-state with 3 waits (all registers ff),
which is why the boot ROM's first job is to set the bus up. Area 2 becomes
DRAM when BCRH says so; DRAM with fast page mode takes 2 states within a row
and 4 on a row change (3 on average is a fair approximation, **Guess**).
The boot ROM and on-chip RAM take one state. **MAME / datasheet** for the
rules; the DRAM detection is **Verified** in that the boot ROM prints
"10-bit shift" and "2048K".

Getting these costs right matters to an emulator: CyOS's busy-wait delays
and sound pitch depend on them. For a program on the machine it means the
8 KB of on-chip RAM is about three times faster than DRAM, for instruction
fetches too ([cyos.md](cyos.md#native-applications)).

## 4. Interrupts

The H8S has 92 vectors, each a 32-bit address in a table at 000000 (so in
the boot ROM). Priorities come from the IPR registers, a 3-bit level per
group; the CPU takes an interrupt when its level is above the I2/I1/I0 mask
in EXR (interrupt control mode 2) or simply when not masked by CCR (mode 0).

| Vector | Source | Used for |
|---|---|---|
| 0 | reset | |
| 7 | NMI | |
| 8-11 | TRAPA #0-3 | software traps |
| 16-23 | IRQ0-IRQ7 pins | IRQ2: MP3 cartridge; IRQ7: On/Off button |
| 25 | WOVI | watchdog interval |
| 28 | ADI | A/D conversion done |
| 32-59 | TPU channels 0-5 | timers; channel 1 makes sound |
| 64-71 | TMR0, TMR1 | TMR1: the radio driver's receive timing ([§11](#11-radio)) |
| 80-91 | SCI0-SCI2, four each (ERI, RXI, TXI, TEI) | cartridge audio, console, radio |

IRQ pins can be level or edge triggered (ISCR, two bits per pin: low level,
falling, rising, both). The On/Off button is wired to PA7, which doubles as
IRQ7 (**MAME / datasheet**); it is the only way out of software standby
([§13](#13-power-and-standby)). Interrupts can also start DTC or DMA
transfers instead of running code ([§14](#14-other-on-chip-peripherals)).

## 5. I/O ports and pins

| Pin | Direction | Connected to |
|---|---|---|
| P15 | out | speaker ([§9](#9-sound)) |
| port 2 | both | cartridge connector: I2C to the MP3 decoder, SD chip select, card detect |
| P32 | in | MP3 cartridge: the card's write-protect switch, 1 = protected |
| P66 | in | MP3 decoder DEMAND line |
| PA6 | in | 1 = battery charged |
| PA7 | in | On/Off button, 0 = pressed (also IRQ7) |
| PF1 | out | RTC I2C clock (SCL) |
| PF6 | both | RTC I2C data (SDA): pulled low while PF6 outputs 1 or floats |
| A/D channel 0 | in | radio received signal strength ([§11](#11-radio)) |
| A/D channel 3 | in | cartridge detect: 0 with a cartridge in, 3ff without |

The I2C wiring of the RTC (an inverted data line) follows MAME and is
**Verified** in that CyOS reads and sets the time correctly. Port 2 and
P66 are described pin by pin in
[mp3-cartridge.md](mp3-cartridge.md#2-the-hardware). Pins a port does
not have read as 1 (port 3 bits 6-7, port 5 bits 4-7, port G bits 5-7).

## 6. Keyboard

The keyboard is a matrix read through the address bus. A 16-bit read at
e00000 + 2 × *sel* returns the keys of every row whose bit in *sel* is 0,
ANDed together, active low (a pressed key reads 0). CyOS scans rows 0 to 9
one at a time by clearing a single bit in the low ten bits of *sel*; higher
bits are left 0. **Verified.**

| Row | Bit 0 | Others |
|---|---|---|
| 0 | F7 | M 8, ) 9, "," 10, K 11, I 12, O 13, L 14 |
| 1 | F6 | G 1, B 2, N 3, H 4, Y 5, U 6, J 7 |
| 2 | F5 | D 8, C 9, ( 10, V 11, F 12, R 13, T 14 |
| 3 | F4 | Q 1, A 2, Z 3, X 4, S 5, W 6, E 7 |
| 4 | F3 | Enter 3, Select 4, Menu 5, Space 6 |
| 5 | F2 | Tab 7, Del 8, Ins 9, Esc 10 |
| 6 | F1 | Up 11, Right 12, Down 13, Left 14 |
| 7 | | Fn 15 |
| 8 | | Shift 15 |
| 9 | Help | . 1, ! 2, ; 3, P 4 |

MAME puts Help, "." and P on address line A13 (row 13). On CyOS that cannot
work: because CyOS leaves the higher address bits low while scanning, a key
in row 13 shows up in every row it scans. Row 9 is the only place they
behave, so they are in row 9 here (**Verified** that row 9 works; the real
wiring is a **Guess**).

Menu, Ins, `( ) , ; !` are not in MAME. They were found by pressing every
free position of rows 0-9 in a CyOS text field and seeing what it typed
(**Verified**); no other free position does anything. Ins is the key MAME
calls "As". What Fn and Shift add on these keys:

| Key | Fn | Shift |
|---|---|---|
| . | / | \ |
| , | ' | ~ |
| ; | : | \| |
| ! | ? | ^ |
| ( | [ | ` |
| ) | ] | a smiley |

With Fn, the letter row Q-P types the digits, and the other letters the
symbols `@ } (C) $ % * + - _ = > < & { # "` (**Verified** in CyOS 1.5.08).
On/Off is not in the matrix: it is PA7/IRQ7.

### Reading the matrix on a real Cybiko

**A single CPU read does not work on real hardware.** The rows are selected
by address lines, which need the address held on the bus for a while before
the keys can be read. A lone `mov.w @e00000+2*sel` between instruction
fetches from DRAM reads noise or no key at all. Emulators (MAME, Dragonfruit)
answer at once, so code that works there can still see no key on a real
Cybiko. (**Verified** on a real Xtreme with
[cybiko-doom](https://github.com/SovGVD/cybiko-doom): with single CPU reads
no key worked and the reads looked like random keys. With the DMA reads
below every key works.)

CyOS 1.5.08 reads every row with the DMA controller (its routine was at
4a019c in RAM in the emulator, called with the row's address):

1. Clear bit 0 of DRAMCR (fffed7), which stops the refresh timer.
2. Stop DMA channel 1: clear bits 6 and 7 of DMABCRL (ffff07).
3. Set MAR1A (fffef0) to the row's address, e00000 + 2 × *sel*. Set MAR1B
   (fffef8) to a word of on-chip RAM (CyOS uses ffdc00). Set ETCR1A
   (fffef6) to 12.
4. Set bits 7 and 3 of DMABCRH (ffff06) for full address mode. Clear bit 3
   of DMABCRL.
5. Write 80 to DMACR1A (ffff04): words, with source and destination fixed.
   Write 07 to DMACR1B (ffff05): auto request, burst.
6. Set bits 7 and 6 of DMABCRL to start. Wait while bit 6 is set.
7. OR 11 into DRAMCR. The word in on-chip RAM is the row: the last of 12
   back-to-back reads of the same address.

The destination must be on-chip RAM, so that no other address appears on
the external bus during the burst. A read with *sel* = 0 (all rows) first
tells cheaply whether any key is down. The same sequence in C is
`key_read_dma` in cybiko-doom's `cybiko/hw_cybiko.c`. Its Doom Test app
shows the single CPU read, 12 CPU reads in a row and the DMA read side by
side.

## 7. Screen: HD66421

The HD66421 is a 160×100 controller with 2 bits per pixel. It has an index
register at 100000 and a data port at 100001: write the register number to
100000, then read or write its value at 100001.

| Register | Meaning |
|---|---|
| 0 | control; bit 6 = display on |
| 1 | control; bit 1 picks auto-increment of x (1) or y (0) |
| 2 | x address, in bytes (0-39) |
| 3 | y address, in rows (0-99) |
| 4 | display RAM data: writes go to (x, y), then the address steps |
| c-f | palette: the drive level for pixel values 0-3 |
| 10 | contrast |

Display RAM is 100 rows of 40 bytes, four pixels to a byte with the leftmost
pixel in the top two bits. **RAM row 0 is the bottom line of the screen**
(**Verified**: CyOS's screens come out upside down otherwise). When x passes
39 it wraps to 0 and y steps; y wraps from 99 to 0. With bit 6 of register 0
clear the screen is blank.

The shade of each pixel value is its palette level against the contrast.
`level = 31 − (palette − contrast + 3)`, clamped to 0-31, with 0 black and
31 white, gives four distinct shades at every contrast setting CyOS offers,
which is all that has been checked: the formula is a **Guess**.

## 8. Real-time clock: PCF8593

The PCF8593 sits on a software I2C bus (PF1 clock, PF6 data). Its registers
1-6 hold hundredths, seconds, minutes, hours, day plus year-mod-4, and month
plus weekday, all in BCD; bit 7 of the hours register selects 12-hour mode.
The chip only knows the year modulo 4, so CyOS keeps the rest itself.
**MAME / datasheet**, **Verified** that CyOS shows the right date and time.

## 9. Sound

The speaker is on P15, which is also TPU channel 1's output TIOCB1.
CyOS makes tones two ways (**Verified**):

- **TPU**: channel 1 in PWM mode 2 (TGRA period, TGRB high time) or
  toggling TIOCB1 on each compare match. The frequency is the timer clock
  divided by the period (halved when toggling).
- **Software**: flipping P15 in a loop.

The tone is a pulse wave, and its **high time sets the loudness**: CyOS's
melody player runs the TPU at 18.432 MHz / 8 = 2.304 MHz with the note's
period in TGRA, and for a melody with a sound envelope it changes TGRB on
every pulse, from a table of high times (**Verified** in an emulator: the
duty cycle follows the envelope pulse by pulse). Kernel export 1354 starts
such a tone (the period, then a pointer to the table of high times and its
length; no table means a square wave) and export 1355 stops it (**from the
code** of `mplayer.app`). The melody and envelope files are in
[file-formats.md](file-formats.md#melodies-mus-music).

The Xtreme also plays and records speech: CyRecord and CyTalk use
`sound.dl`, which reads and writes 8 kHz IMA ADPCM WAV files
([file-formats.md](file-formats.md#recordings-wav)) and knows a `speaker`
and `mic8`/`mic16` devices and a "soundblaster" sound device. How the
built-in microphone is read and how sampled sound reaches the speaker are
not worked out (**Guess**: the A/D converter and the same PWM output). The
MP3 cartridge has its own decoder and headphone output.

## 10. Serial ports and the debug console

The H8S has three serial ports (SCI0-2), each asynchronous or clocked
synchronous, with the baud rate from SMR and BRR.

| Port | Used for |
|---|---|
| SCI0 | MP3 cartridge: MPEG data to the decoder (clocked) |
| SCI1 | debug console (async); in clocked mode, the cartridge's SD card |
| SCI2 | the radio AVR, 36 kbaud 8N1, fed by the DTC |

On SCI1 in async mode the boot loader prints its progress and CyOS prints
log lines. The boot text is in [cyos.md](cyos.md#boot-sequence).

**Don't write to SCI1 once the MP3 cartridge's card driver has used it.**
The driver leaves it in clocked mode (SMR bit 7 set) with SCR = 0. On a
real Cybiko, cybiko-doom sent its fps line there once a second. After the
first map it could load nothing more from the card until the Cybiko was
restarted. That the debug line caused this, and how, is a **Guess**: the
write probably leaves TDRE clear for the driver. Only send when SCI1 is asynchronous with its transmitter on
(SMR bit 7 clear, SCR bit 5 set).
**Verified.** On the real machine these pins come out on the serial/USB
connector (**Guess** for which pins).

## 11. Radio

The radio is an Atmel AT90S2313 microcontroller that drives the RF2915
transceiver and talks to the H8S over SCI2 at 36 kbaud, 8N1. CyOS's RF
driver is a kernel object called `rfdriver` (in RAM at 49b900-49c760 once
the kernel runs). CyOS sends to the AVR with the DTC. Worked out from CyOS
1.5.08, so the byte values are **Verified**, the meanings partly **Guess**
as marked:

From the H8S to the AVR:

| Bytes | Meaning |
|---|---|
| `01 02 ch` | tune to RF channel *ch*, 2-9 (2 is the base channel, 4 is Chat's) |
| `01 03 xx xx` | unknown setting (CyOS sends `00 00`) |
| `01 07 00 00` | sent when CyTalk starts talking; see below |
| `30 f` + 51 bytes | send a short packet: 50 bytes plus a spare byte the DTC count includes; *f* is 0 or 1, meaning unknown |
| `cf f` + 201 bytes | send a long packet: 200 bytes plus the spare byte |

From the AVR to the H8S:

| Bytes | Meaning |
|---|---|
| `03` | the packet went out. CyOS waits up to 50 ms for a short packet and 100 ms for a long one, from the start |
| `32` + 50 bytes | a short packet was heard |
| `c8` + 200 bytes | a long packet was heard |
| `13` / `11` | XOFF / XON while CyOS is sending |

A heard packet comes from the AVR at the speed it comes over the air,
about 2400 bytes a second. CyOS expects the last byte within 50 ms (short)
or 115 ms (long) of the first. 15 ms into each packet the driver's TMR1
interrupt (state 4 of the object at `*(4b49fe)`) reads A/D channel 0, which
is the received signal strength; that reading ranks the senders, gates
included ([cywig.md](cywig.md#2-finding-the-gate)). The AVR doesn't hear while
it sends. (**Verified** in that CyOS only takes a gate when packets arrive
paced like this and channel 0 reads a signal.)

Every packet starts with the 4-byte destination ID (`ffffffff` for
broadcast) and the 4-byte sender ID. The packets themselves, and everything
CyOS builds on them (pings, acknowledgements, messages, chat, gates), are in
[radio-protocol.md](radio-protocol.md). The AVR passes them through: what
it does on the air (modulation, preamble, framing) is not known. Its
program came with CyOS updates as `avr*.boot` files
([file-formats.md](file-formats.md#cyos-update-images-boot)).

**The status LED** blinks red while the radio sends and green while it
receives, and is steady red on mains or USB power (the Xtreme quick start
guide's FAQ). Which pins drive it is not known. CyOS changes no port pin
while it sends a packet, so red is probably the AVR's or the charger's.
`rfdriver` raises P17 for the ~20 ms a heard packet takes to come in
(49c364 sets it, 49c4c2 clears it), which may be the green LED or a signal
to the AVR. (**Guess**; the timing is **Verified** in an emulator.)

**CyTalk, the walkie-talkie,** takes the radio away from packets. About
3.5 s after Talk is pressed, CyOS sends `01 02 02` and `01 07 00 00` to
the AVR, then switches SCI2 off (SCR2 = 0 and its module stop bit set) and
changes port 2 bits 4 and 5 (P2DR 50, then 70, then 60). No packets are
sent while it talks. (**Verified** in an emulator, where no other Cybiko
answers; the voice itself was not seen.) So the voice doesn't travel as
CyOS packets: **Guess**: `01 07` puts the AVR and the RF chip into a voice
mode and port 2 bits 4-5 route the audio, so a gate or an ESP32 can't
carry CyTalk without knowing the AVR's air protocol. CyTalk's own strings
name the switch "CommonRF -> Walkie-Talkie"; it offers three channels and
"Invite Partner", which goes through normal CyOS messages.

## 12. Flash and the unit ID

The SST39VF400A is a 512 KB, 16-bit NOR flash. Its commands are the usual
JEDEC unlock sequences at word addresses 5555 and 2aaa: `aa 55 a0` then a
word programs it, `aa 55 80 aa 55 10` erases the chip, `aa 55 80 aa 55 30`
erases a sector, `aa 55 90` reads the ID (maker 00bf, device 2780).
**MAME / datasheet**; CyOS's own writes work.

The flash holds the second-stage loader, the compressed CyOS image and, at
the top, a per-machine record:

| Offset | What |
|---|---|
| 7f800 | magic `ba0bab15` |
| 7f818 | the unit's 32-bit Cybiko ID (its radio address) |
| 7fffc | CRC-32 over the record (7f800..7fffb) |

The boot ROM and the kernel both check the CRC; a bad one stops the boot.
**Verified.** Every machine needs its own ID or they cannot tell each other
apart on the radio (CyOS drops packets that carry its own ID as the
sender). Xtreme IDs seen start with `4c`. How IDs are written as text is
in [radio-protocol.md](radio-protocol.md#5-cybiko-ids).

## 13. Power and standby

When the user switches the Cybiko off, CyOS does not cut the power: it sets
bit 7 of SBYCR and executes `SLEEP`, which puts the H8S in **software
standby**. All clocks stop, the DRAM keeps its contents, and only an
external interrupt (IRQ7, the On/Off button) starts the chip again.
**MAME / datasheet** for the mechanism; switching CyOS off and on has not
been checked step by step.

The watchdog (WDT) resets the machine if software stops servicing it; the
WOVF flag survives that reset. CyOS services it itself; a program that
turns interrupts off must kick it: `REG16(ffffbc) = 5a00`
([cyos.md](cyos.md#native-applications)).

## 14. Other on-chip peripherals

All **MAME / datasheet**, used by CyOS as noted.

- **TPU** (6 channels, 16-bit): channel 1 makes sound; CyOS's system tick
  probably comes from another channel (**Guess**).
- **TMR** (2 channels, 8-bit, can chain into 16 bits). TMR1 times the
  radio's received packets.
- **WDT**: watchdog or interval timer (vector 25).
- **A/D**: 8 channels, 10 bits. Channel 0 is the radio signal strength,
  channel 3 detects the cartridge. One of the others presumably reads the
  battery (**Guess**).
- **DMA controller**: 2 channels, each two short-address subchannels (A, B)
  or one full-address channel, started by software, a peripheral interrupt
  or the DREQ pin. The cartridge's SD card uses it. Registers at fffee0 +
  16*c* (MAR, IOAR, ETCR for A and B), DMAWER ff00, DMATCR ff01, DMACR
  ff02+2*c*, DMABCR ff06.
- **DTC** (data transfer controller): moves a byte per interrupt using a
  descriptor in on-chip RAM, so a serial port can be fed without running
  code. CyOS feeds the radio's SCI2 with it. A DTC transfer can start while
  another one's memory access is in progress (nested transfers; seen with
  the MP3 cartridge).
- **Module stop** (MSTPCR): a set bit switches a peripheral off. CyOS uses
  it, so a stopped peripheral does nothing (the radio only receives while
  SCI2 is running and listening).

## 15. Open questions

- The real wiring of Help, "." and P (row 9 works, MAME says A13).
- What the radio's flag byte *f* and the `01 03` and `01 07` commands mean.
- How CyTalk's voice goes over the air, and how the microphone is read.
- The AVR's air protocol.
- Which A/D channel reads the battery, and its scale.
- The exact HD66421 shade formula.
- Which pins of the serial/USB connector carry SCI1.
- How CyOS's Multi Channel Protocol frames data on USB ([usb.md](usb.md#8-open-questions)).

If you have a real Cybiko and can check any of these, please open an issue.

# USB on the Cybiko Xtreme

What the Xtreme's USB port is, what CyOS 1.5.08 runs on it, and what the PC
side (EZ Loader) sends. It is the starting point for talking to a real
Xtreme from a PC or another USB host without changing its firmware, for
example to give it a gate ([cywig.md](cywig.md)) over the cable.

Sources: MAME's `cybikoxt` board notes, the USBN9604 register map, the
EZ Loader software on the Xtreme Installation CD (`soft/EZLoader_Setup.exe`,
an MSI; its `Data.Cab` holds the drivers and COM DLLs), and CyOS 1.5.08's
kernel as it sits in RAM after booting in an emulator. Marks as in
[hardware.md](hardware.md): **Verified**, **From the code** (read in the
disassembly, not run), **Guess**. Nothing here has been run over a real USB
cable yet; "Verified" below means run against CyOS in Dragonfruit's
emulator, which models the USB chip since October 2026.

## Contents

1. [The chip](#1-the-chip)
2. [What the PC sees](#2-what-the-pc-sees)
3. [The PC software](#3-the-pc-software)
4. [The CyOS console](#4-the-cyos-console)
5. [Pipes and the Multi Channel Protocol](#5-pipes-and-the-multi-channel-protocol)
6. [Using a pipe from an application](#6-using-a-pipe-from-an-application)
7. [A gate over USB](#7-a-gate-over-usb)
8. [Control requests and WinUSB without Zadig](#8-control-requests-and-winusb-without-zadig)
9. [Open questions](#9-open-questions)

## 1. The chip

The Xtreme has a **National Semiconductor USBN9604** full-speed USB device
controller (MAME's board listing: `USBN9604-28M`; the MP3 player board has
the older USBN9603, which has the same registers). It sits on the bus at
200000-200003 in the non-multiplexed mode: CyOS writes a **register number
to 200003** and then reads or writes the **register's value at 200000**.
(**From the code**: every access in the driver is that pair.)

CyOS's start-up sequence (kernel at 4ac47a in 1.5.08) matches the
USBN960x register map:

| Register | Name | Value written |
| --- | --- | --- |
| 1b | | 6c |
| 00 | MCNTRL | 01 (software reset), then c0 |
| 0f | NAKMSK | 10 |
| 0d | RXMSK | 07 |
| 0b | TXMSK | 07 |
| 09 | ALTMSK | d2 |
| 07 | MAMSK | d6 |
| 05 | NFSR | 00 (reset state) |
| 04 | FAR | 00 |
| 20 | EPC0 | 00 |
| 23 | TXC0 | 08 (flush) |
| 27 | RXC0 | 01 (receive on) |
| 04 | FAR | 80 (address enable) |
| 05 | NFSR | 02 (operational) |

(**From the code**. The names are from the USBN9603/9604 datasheet; the
interrupt line and the meaning of register 1b were not checked.)

MAME maps only a write handler there that does nothing, so CyOS in MAME
never sees a USB host. Dragonfruit's emulator models the chip
(`cy_usb.c`), and its PC build can plug an emulated PC into it.

## 2. What the PC sees

CyOS 1.5.08 keeps its USB descriptors in the kernel (at 4838c2):

```text
device   12 01 10 01 ff ff ff 08 66 0b 41 00 01 00 04 1c 00 01
config   09 02 2e 00 01 01 38 80 96
iface    09 04 00 00 04 ff ff ff 00
ep       07 05 81 02 40 00 00     bulk IN  1, 64 bytes
ep       07 05 02 02 40 00 00     bulk OUT 2, 64 bytes
ep       07 05 83 02 40 00 00     bulk IN  3, 64 bytes
ep       07 05 04 02 40 00 00     bulk OUT 4, 64 bytes
```

- USB 1.1, full speed, vendor class (ff/ff/ff), EP0 8 bytes.
- **VID 0B66, PID 0041**: "Cybiko Xtreme USB Device" (CyOS running).
- **PID 0040**: "Cybiko Xtreme boot USB Device", the boot ROM's own USB
  mode, used to load a CyOS update when the flash has none
  ([cyos.md](cyos.md#cyos-updates)).
- One interface with two pairs of bulk endpoints, 64-byte packets.
- Bus powered, up to 300 mA (it charges from USB).

(**From the code** for the descriptors; the VID/PIDs and names are in the
drivers' `.inf` files, **Verified**.) Being vendor class, no operating
system binds a driver to it by itself; any program can claim it through
libusb (on Windows after giving it the WinUSB driver, for example with
Zadig, or with an application that adds Microsoft OS descriptors, see
[section 8](#8-control-requests-and-winusb-without-zadig)). cybiko-cywig's
USB Gate shows up as **PID 0042** while it runs. The original drivers (`cybiko15.sys`, `cy15boot.sys`, 2001) are
Windows 98/2000 WDM drivers.

## 3. The PC software

EZ Loader's files from `Data.Cab` (**Verified**):

| File | What |
| --- | --- |
| `cybiko15.sys`, `cybiko15.inf` | the driver for PID 0041 |
| `cy15boot.sys`, `cy15boot.inf` | the driver for PID 0040 |
| `Cybiko15.dll` | the Xtreme device (COM classes `CyPort15`, `CyFactory15`): device detection, file lists, copy, delete, `Command` |
| `CyUpdate15.dll` | CyOS updates |
| `CySyncMail15.dll`, `CySyncCTX15.dll`, `CySyncFiles1X.dll`, `CyBackuper1X.dll` | mail, contacts, file sync and backup over the cable |
| `CyPort10.dll`, `Cybiko10.dll` | the same for the Classic, over its serial cable |

`Cybiko15.dll` talks to the Xtreme by sending it **command lines** and
reading the answers on numbered **pipes**. The command lines it uses:

```text
id $pipe=15
sysinfo $pipe=15 "/%s"
ls $pipe=15 -L "%s/*"          (also /*, %s/.../*, and once $pipe=25)
cp $pipe=15 -f -v -m "%s" "%s"
rm $pipe=15 -f "%s/.../*"
mkdir $pipe=15 "%s"
rcv $data_pipe=...             send a file to the Xtreme
upl $data_pipe=...             fetch a file from the Xtreme
```

`$pipe=N` sends the command's output to pipe N; `$data_pipe=N` names the
pipe that carries a file's bytes. Its COM interface has `Command(command,
response)` and, for a port, the pipe numbers `nConsoleIn`, `nConsoleOut`,
`nDataIn`, `nDataOut`. The class that makes pipes is `XMCPPipeFactory`,
the same name as in CyOS. The Classic's `Cybiko10.dll` uses a different,
text-tagged framing over serial (`<Command>|pc on|`, `<Command>|ls -l -t
"%s"|`, `rcv %s %d`, `upl %s`).

CyNotify on the same CD only shows cybiko.com news on the PC; it does not
talk to the Cybiko.

## 4. The CyOS console

CyOS 1.5.08 has a command console (the kernel's start-up prints `Init
console I/O`, `Multi Channel Protocol...`, then `Starting CyOS console`;
**From the code**). It prompts `Ready >`, runs `autostart.cmd` at start-up
unless told not to, and offers a start-up menu (`Press 1 to safe mode, 2 to
ignore autostart, 3 to normal mode`).

Built into the kernel:

| Command | What |
| --- | --- |
| `id` | `My CyID is %ld 0x%08lX @%s` |
| `ver`, `os_kind` | the CyOS version and build |
| `channel` | the current radio channel |
| `format`, `sformat` | format a file device; `sformat` asks first (`ALL INFORMATION WILL BE LOST!`) |
| `reboot` | restart |
| `lcd params` | |
| `rcv`, `upl` | receive a file into / send a file from the Cybiko over `$data_pipe` (`receiving file %s (%ld)...`, `upload successfull, %ld bytes/sec`); `rcv` of a system archive replaces it |
| `sa` | |
| `open_notify`, `close_notify` | start or stop a notification process that writes to a pipe |

Command modules in the flash: `ls.e`, `cp.e`, `rm.e`,
`mkdir.e`, `chmod.e`, `sysinfo.e`, `cfg.e`, `rtc.e`, `fdoctor.e`. The
desktop adds `pc` (`pc on`, `pc off`: `pc mode on`, `pc mode off`; it
tells its listeners the PC is attached), `sysinfo`, `tsync` and
`rootinfo`.

Any other word is taken as a **module to run**: the loader accepts `.e`,
`.app` and `.dl` names and two modifiers, **`pipe`** and **`timeout`**
(`$pipe=N`, `$timeout=ms`). With `$pipe=N` it asks the pipe factory for
pipe N, sets the pipe's read and write timeouts (1000 ms unless
`$timeout` says otherwise) and attaches the pipe to the new module
(module object +1c, then +310). (**From the code**, kernel 4a6d16.) So the
PC can start an application on the Xtreme and give it a USB pipe in one
command line.

## 5. Pipes and the Multi Channel Protocol

The kernel's "Multi Channel Protocol" (MCP) carries many numbered,
two-way byte streams ("pipes") over the USB link. The classes are named
`IPipe`, `XPipeFactory` and `XMCPPipeFactory`; the USB side is a kernel
object named `USB_blockdriver`. A pipe object has a table of methods at +8:
slot 7 (`+1c`) says whether it is broken or closed, slot 4 (`+10`) gives
its input stream and slot 5 (`+14`) its output stream; each stream keeps
its timeout at +4. (**From the code**.)

### Frames

**Verified** in an emulator (Dragonfruit's `cybiko_host --usb`, which
models the USBN9604 and plays the PC), decoded from the kernel (receiver
4aa984-4ab300, sender 4a9f80). Every frame, in both directions, goes over
**bulk OUT 2** (PC to Xtreme) and **bulk IN 1** (Xtreme to PC); endpoints
3 and 4 are not used (an OUT on 4 is thrown away and answered with an
empty packet on IN 3).

```text
'M' 'M' type pipe seq len_hi len_lo body[len] crc32 (4 bytes, big endian)
```

- `type`: **11** data (body up to 512 bytes), **12** control (body up to 4
  bytes; CyOS always sends 4, only the first two mean anything).
- `pipe`: 1-255, one direction each (below).
- `seq`: the data frame's number, 8 bits, counting from 0 on each pipe.
  0 in control frames.
- The CRC is the usual CRC-32 (reflected, start ffffffff, final
  complement; the table is in the boot ROM at 0x4e0) over everything from
  the first `M` to the end of the body.
- A transfer may hold several frames or part of one; CyOS ends its own
  transfers with a short packet.

### Flow control

The same in both directions. The receiving end asks for data frame N with
a control frame `02 N`; the sending end sends frame N **only when asked**,
and takes `02 N+1` (or `03 N`) as the acknowledgement. CyOS asks again
about every 3 s while it waits. When nobody asks for a frame within the
stream's timeout (3 s for the console), CyOS gives that write up, so a PC
has to keep asking on every pipe it reads. CyOS sends `05` on a pipe when
it closes it (the next user starts again at frame 0) and takes `04` as a
reset. Links count as up while frames arrive: CyOS stops sending 5 s
after the last frame from the PC.

### Pipe numbers

| Pipe | Direction | What |
| --- | --- | --- |
| 1 | PC to Xtreme | console command lines, each ending in a **NUL** byte (not CR) |
| 2 | Xtreme to PC | console output: an echo (`>> ver`), the answer, `Ready >` |
| 2N-1 | PC to Xtreme | input of a program started with `$pipe=N` |
| 2N | Xtreme to PC | its output |

So pipe numbers in command lines (`$pipe=15`) are "logical" pipes, each a
pair of MCP pipes: `id $pipe=15` answers on MCP pipe 30. The kernel's pipe
for the console is opened by name, `std`, as logical pipe 1.

A whole session, as the emulator ran it:

```text
PC -> 12 02 00  02 00              ask for console frame 0
   <- 11 02 00  "\nReady >\n \0"
PC -> 12 02 00  02 01              got it, ask for 1
PC -> 11 01 00  "ver\0"            a command line
   <- 12 01 00  02 01 xx xx        got it
   <- 11 02 01  "\n>> ver"         (each answered with 02 N+1 as above)
   <- 11 02 02  "\nCyOS v. 1.5.08 built Jul 26 2002 19:02:01"
   <- 11 02 03  "\nReady >\n "
```

A PC-side implementation (C, libusb or the emulator underneath) is in
cybiko-browser's `usb/` folder (`cymcp.c`, `cymcp_link.c`).

## 6. Using a pipe from an application

The whole pipe API is in the kernel's export table (CyOS 1.5.08, table at
48412a; **From the code**), so an ordinary native application can use the
USB link with no change to CyOS:

| Export | Address | What |
| --- | --- | --- |
| 1481 | 486f8c | the pipe attached to a process's module (`$pipe=N`), or 0 |
| 1648-1687 | 4ae3a6-4aed6e | pipe and pipe factory methods; 1680 (4ae75c) makes or opens pipe N, 1672 (4ae95a) releases one |
| 1781 | 4aeec6 | makes the MCP pipe factory |
| 1784 | 4b4c96 | data: the kernel's MCP pipe factory (`mcp_pipe_factory`) |
| 1785-1787 | 4b4c9a-4b4ca2 | data: what the factory was made with |
| 1593, 1594 | 4ad81c, 4ad826 | in the USB block driver |

The SDK headers don't name these numbers; the meanings above come from how
the kernel's own console and loader call them. Two ways for an application
to get a pipe:

- Be started from the console with `$pipe=N` and fetch it with export 1481
  on its own process.
- Open a pipe by number itself through the factory (exports 1784 and
  1680).

## 7. A gate over USB

Everything a PC-side gate ([cywig.md](cywig.md)) needs is in stock CyOS
1.5.08, so a plain Xtreme can be a gate with no change to its flash. The
USB Gate application and its PC program
([cybiko-cywig](https://github.com/SovGVD/cybiko-cywig)) do this; all of the
below is **Verified** in Dragonfruit's emulator (a radio Cybiko loaded pages
and chatted through it), not yet on a real cable.

| Export | Address | What |
| --- | --- | --- |
| 1152 | 49ff44 | `set_gate_mode(on)`: a byte at 4b4ab6 |
| 718 | 49ff4c | reads that byte back |
| 1079 | 49db50 | sends a ping: (radio, RF channel) |
| 888 | 4b4a8e | data: the radio object those take |
| 1109 | 49fc70 | radio power: (on) wakes the radio when it sleeps |
| 1044 | 4b49fe | data: the radio's channel object |
| 1161 | 49ca04 | sets the working channel: (channel object, RF channel 2-9) |
| 1072 | 49ca66 | reads it: (channel object) |
| 1140 | 49dc60 | (radio, on): allows CyOS's own pings |
| 237 | 49785e | `Process_ctor(memory, name, stack)` |
| 940 | | `Queue_peek_message(queue, remove, min msgid, max msgid)` |
| 943 | 49ddf4 | `Message_post` |
| 501 | 49dfb4 | `Message_deliver` |
| 1604, 1607 | | MCP input: bytes waiting; `read(stream, buffer, length)` (-1: no PC) |
| 1621, 1622, 1628 | | MCP output: room; flush; `write(stream, buffer, length)` |

- **Gate mode.** With the byte from export 1152 set, CyOS's packet builder
  (49c864) sets **flag 04 in byte 9** of everything it sends, pings and
  acknowledgements included. Others then take the Xtreme for a gate
  ([cywig.md](cywig.md#2-finding-the-gate)).
- **Being heard.** An idle Xtreme doesn't ping (its radio task, 49d6bc,
  only pings while the radio is "on", state 1 at 4b4aaa, and goes to sleep
  waiting for nothing otherwise), so a gate nobody hears isn't one. The
  application pings itself every 3 s with export 1079 on the base channel.
  A ping goes out with flag 04 and the working channel in byte 8.
- **Port 93.** A process made with a port number for its name
  (`Process_ctor(memory, (char *)0x93, stack)`, never started) gets that
  port's messages in its queue (+6c). CyOS keeps the queues that take
  messages in a ring: `*(radio + b8c)` is the last one, `+34` the next,
  `+28` the port or name. The first queue for a port from the start of the
  ring gets the message.
- **The cable.** The application opens logical pipe 40 through the factory
  (exports 1784 and 1680), takes its streams from the pipe's methods (slots
  4 and 5 at pipe + 8) and sets their timeouts at `*(stream) + 4`. CyOS
  only asks the PC for data inside a blocking read, so a thread of its own
  sits in the read.
- **Answers.** `Message_deliver` with the target's process name (the WAP
  browser's is `WAP`) and its ID; `Message_check_delivery` says when it's
  done.
- **Chat.** Chat's rooms are on RF channel 4 (export 1161 moves the radio
  there; Cybikos then send to the gate on channel 4 too, as its pings say).
  Port 25 already has a queue from start-up, owned by a resident part of
  CyOS; a second queue for port 25 gets nothing, and moving that one aside
  or putting another in front of it in the ring stalls CyOS (the USB link
  stops, then the watchdog resets it). Taking only the chat lines from it
  with `Queue_peek_message(queue, 1, 0x1002, 0x1002)` works. A line to
  everyone goes out with `Message_post` to `ffffffff` and port 25
  (`Message_deliver` waits for an answer that never comes and doesn't send
  it).
- **Installing and starting it.** The PC starts the application with a
  console line (`USBGate.app`). Copying it over the cable (`rcv`) is still
  to be worked out; EZ Loader does it.

## 8. Control requests and WinUSB without Zadig

CyOS 1.5.08 answers control requests on endpoint 0 in its USB interrupt;
the kernel and its tables are in RAM (**From the code**, **Verified** in
the emulator):

| Address | What |
| --- | --- |
| 4acc00 | endpoint 0 receive handler: on a SETUP it copies the 8 bytes to its control state + 6 (er0 is the state) |
| 4accb2 | `(bmRequestType & 60) != 0` (class or vendor): straight to 4acd56, which sends whatever is in the FIFO (nothing: an empty data stage, never a STALL) |
| 4accba | standard: switch on bRequest 1-9 through the table at 48384a |
| 4aca10 | GET_DESCRIPTOR: switch on the type 1-5 through 483836; other types get an empty answer |
| 4838c2 | device descriptor, then the configuration (4838d4) |
| 48388a | string descriptors: **index N is the descriptor at 48388a + N** (a byte offset, not a number: 0 is the language list, 04 the manufacturer, 1c the product); index 38 is one built at 4b4c68 |
| 4ace26 | endpoint 0 transmit handler: the next 8 bytes of a descriptor |

GET_DESCRIPTOR keeps its answer in the control state: +0f set while
sending, +10 the data, +14 bytes sent, +16 its length (cut to the
request's wLength, of which only the low byte is used); the first 8 bytes
go into TXD0 (register 21) at once and 4acd56 sends them as DATA1, the
transmit handler sends the rest. CyOS never stalls, and as far as the
USBN9604 datasheet goes, clearing EPC0's STALL bit after a SETUP is left to
software (**Guess**; Dragonfruit's model clears it on a SETUP).

Windows loads WinUSB for a device by itself only when the device has
**Microsoft OS 1.0 descriptors** ("WCID": string descriptor `ee` =
`MSFT100` and a vendor request code, then that vendor request with wIndex
4 gives the compatible ID `WINUSB`, wIndex 5 the extended properties), it
says **USB 2.0** (Windows doesn't ask a USB 1.1 device), and Windows
hasn't seen that VID/PID/release before (it keeps the answer under
`HKLM\SYSTEM\CurrentControlSet\Control\usbflags`). CyOS has none of it
(string `ee` is whatever happens to be at 483978), so cybiko-cywig's USB
Gate, an ordinary application, adds it while it runs, all in RAM:

- It replaces the 8 bytes at 4accb2 with a `jmp` to code of its own that
  calls a C function with the control state, answers string `ee`, the two
  vendor requests (code 47) and, as a full speed USB 2.0 device must,
  stalls GET_DESCRIPTOR 06/07 (lifting the stall at the next SETUP), the
  way GET_DESCRIPTOR answers (state +0f/+10/+14/+16 and 8 bytes into TXD0,
  then on to 4acd56); everything else goes on to the original check.
- It writes `0200` (bcdUSB) and PID `0042` into the device descriptor at
  4838c2.
- It clears **MCNTRL.NAT** (register 00 bit 3; CyOS writes `c8`) for
  400 ms: the pull-up goes, the host sees the device leave and come back,
  resets it and reads the new descriptors.
- On exit it puts the 8 bytes and the descriptor back and drops off the
  bus again. It checks those bytes before changing anything.

Register writes from an application go to 200003 (the register number)
then 200000 with interrupts off (`orc #80,ccr`), since the USB interrupt
uses the same pair. The MCP pipes keep their sequence numbers across the
drop: a PC program that opens the device again has to take up the
Xtreme's numbers (cybiko-browser `usb/cymcp_link.c` does). **Verified** in
Dragonfruit's emulator (its USB host asks for the descriptors like Windows
and logs them); not yet on a real Xtreme with Windows.

## 9. Open questions

- What control `03` is sent for, and bytes 2-3 of CyOS's control frames
  (`00 64` or leftovers).
- The exact arguments of exports 1648-1687.
- Whether CyOS needs VBUS (USB power) to switch the controller on, and
  what the `pc on` listeners do (radio off during sync?).
- Register 1b and the interrupt wiring of the USBN9604.
- The boot ROM's USB mode (PID 0040) and its protocol.
- What the resident owner of port 25 (and 2c) is, and why it must keep the
  port; the `rcv` protocol for copying files.

If you have a real Xtreme and a USB analyser (or Windows 98 with EZ
Loader), a capture of EZ Loader listing files would answer most of these.

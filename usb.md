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
cable yet: the emulators so far ignore the USB chip.

## Contents

1. [The chip](#1-the-chip)
2. [What the PC sees](#2-what-the-pc-sees)
3. [The PC software](#3-the-pc-software)
4. [The CyOS console](#4-the-cyos-console)
5. [Pipes and the Multi Channel Protocol](#5-pipes-and-the-multi-channel-protocol)
6. [Using a pipe from an application](#6-using-a-pipe-from-an-application)
7. [A gate over USB](#7-a-gate-over-usb)
8. [Open questions](#8-open-questions)

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
never sees a USB host. The Dragonfruit emulator does the same.

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
Zadig). The original drivers (`cybiko15.sys`, `cy15boot.sys`, 2001) are
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

How MCP frames pipes into the bulk endpoints is **not worked out yet**.
Both sides are available to read it from: CyOS (kernel 4ac300-4ad9xx for
the USB driver, 4ae300-4af9xx for the pipes and MCP) and `Cybiko15.dll` /
`cybiko15.sys`. **Guess**: one endpoint pair for the console and one for
data, as the descriptors and `nConsoleIn`/`nDataIn` suggest.

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
1.5.08, so a plain Xtreme can be a gate with no change to its flash:

- **Gate mode is a kernel switch.** Export **1152** (49ff44) stores a byte
  at 4b4ab6, and export **718** (49ff4c) reads it back. CyOS's packet
  builder (49c864) sets **flag 04 in byte 9** of the packet when that byte
  is not 0, which is the gate flag other Cybikos look for
  ([cywig.md](cywig.md#2-finding-the-gate)). (**From the code**. Not yet
  run; whether every packet, pings and acknowledgements included, goes
  through that builder still has to be checked.)
- **The cable**: an application on the Xtreme opens a pipe (section 6),
  takes the gate's requests from the radio (port 93) and passes them to the
  PC, and sends the PC's answers back over the radio.
- **Installing and starting it**: the PC can copy the application with
  `rcv` and start it with a command line, so nothing has to be done on the
  Xtreme itself.

## 8. Open questions

- MCP's framing on the bulk endpoints: headers, pipe numbers, flow
  control, acknowledgements. Which endpoint pair carries what.
- The console's own pipe numbers and how the PC reaches the prompt.
- The exact arguments of exports 1648-1687.
- Whether CyOS needs VBUS (USB power) to switch the controller on, and
  what the `pc on` listeners do (radio off during sync?).
- Register 1b and the interrupt wiring of the USBN9604.
- The boot ROM's USB mode (PID 0040) and its protocol.

If you have a real Xtreme and a USB analyser (or Windows 98 with EZ
Loader), a capture of EZ Loader listing files would answer most of these.

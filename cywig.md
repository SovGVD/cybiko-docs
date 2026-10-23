# CyWIG: the Cybiko Wireless Internet Gate

How a Cybiko Xtreme gets to the Internet through a Cybiko Wireless Internet
Gate (CyWIG): how CyOS finds a gate, what it sends to it, and how the
Xtreme's WAP browser asks for pages and gets them back. It covers the Cybiko
side only: the gate is whatever answers on the radio as described here.
The packets, delivery and messages underneath are in
[radio-protocol.md](radio-protocol.md).

Sources: CyOS 1.5.08 (kernel in RAM at 480000-4b4000 once booted), WAP
Browser 21.1.17 for the Xtreme, the Classic's VCyWIG 1.0 and its gateway
boot image (US119.boot), the Cybiko SDK 2.1.13 headers, and packet traces
taken on an emulated radio with a new gate answering. Things that are
inferred rather than seen are marked as such.

Conventions: numbers in hex unless they have units; all multi-byte fields
on the radio are big-endian; "export N" is CyOS kernel export number N.

## Contents

1. [Layers](#1-layers)
2. [Finding the gate](#2-finding-the-gate)
3. [Port 93 and packed messages](#3-port-93-and-packed-messages)
4. [The WAP exchange](#4-the-wap-exchange)
5. [Timing](#5-timing)
6. [The original gate](#6-the-original-gate)
7. [Other gate clients](#7-other-gate-clients)
8. [Open questions](#8-open-questions)

## 1. Layers

```
 application   WAP browser (process "WAP"), WML pages
 ─────────────────────────────────────────────────────────────────────
 service       msg 1022 to port 93 of the gate, replies to the process
 ─────────────────────────────────────────────────────────────────────
 messages      CyOS messages: msg id, p0, p1, target, data
               split into packets, acknowledged, numbered
 ─────────────────────────────────────────────────────────────────────
 packets       50 or 200 bytes: 16-byte header, data, Reed-Solomon parity
 ─────────────────────────────────────────────────────────────────────
 radio         AVR co-processor on SCI2, RF chip, channel 2
```

## 2. Finding the gate

Every packet a Cybiko hears updates its list of people around
([radio-protocol.md](radio-protocol.md#6-finding-each-other-pings-and-people-around)),
and **bit 04 of byte 9** of each packet sets or clears that sender's gate
flag in the list. A gate therefore has to set it on everything it sends,
acknowledgements included: one packet without it and the Cybiko stops
taking the sender for a gate.

The best gate is kept at `G+9fc` (with `G = *(4b4a02)` in CyOS 1.5.08): the
gate in the list with the highest signal. The signal is A/D channel 0,
read 15 ms into each packet ([hardware.md](hardware.md#11-radio)), so a
gate's packets must arrive at air speed with a signal for CyOS to rank it.
Export 1340 (`get_gate_cyid`) returns the best gate's ID, or 0 when there
is none. The WAP browser polls it and shows "Wait until CyWig is found"
until it isn't 0.

Only Cybikos that hear the gate directly can use it: Cybikos don't relay
packets, and a Cybiko that hears a gate doesn't pass it on
([radio-protocol.md](radio-protocol.md#10-mesh-gates-and-the-internet)).

A gate makes itself heard with pings: type 00 with flag 04 (byte 9 =
`04`), bytes a-b as a running counter, data all zeros. Any packet with flag
04 does the same job, but pings keep the gate in the list while it is
quiet; every 3 s is enough (verified).

## 3. Port 93 and packed messages

Gates take their requests on **port 93**. Two kinds of message go there.

**Msg 1022**: the browsers' page requests ([section 4](#4-the-wap-exchange)).

**Msg 47** (`MSG_PACKED`, "packed message for retransmitting"): when an
application sends a message to one Cybiko that is *not* in the people list
and a gate is visible, CyOS wraps the whole message and sends it to the
gate instead (from the code). A Cybiko that receives a packed message for
its own ID unpacks it and delivers it as if it had come straight from the
sender. That is how mail and messages to people out of range were meant to
travel: through the gate and whatever network is behind it. The data of a
packed message:

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 4 | final destination ID |
| 4 | 4 | original sender ID |
| 8 | 2 | msg id |
| a | 1 | flags: 20 p0 follows, 10 p1 follows, 80 the target is a process name, 40 data follows |
| b | 1 | 0 |
| c | | p0 (4), p1 (4), the target (a 2-byte port or a NUL-ended name), then for data a 4-byte length and the data |

CyOS also sends a packed message about every 10 s to port 93 of its best
gate, without asking for an acknowledgement (byte 9 = `20`, message number
0), verified:

    10 00 00 47 00 93 11  ff ff ff 02  4c 80 51 a3  10 22  80 00  43 57 49 47 00

That is flags 10, msg id 47, port 93, 17 bytes of data: a packed msg 1022
from the Cybiko's own ID (`4c8051a3`) to the process "CWIG" at `ffffff02`
(flags 80: a process name). `ffffff02` is the web gate service and
`ffffff01` the mail gate. It looks like a registration or keep-alive for the
gate's msg 1022 service. Neither browser waits for an answer to it, and a
gate that ignores it works.

## 4. The WAP exchange

The WAP browser (process `WAP`):

1. Waits until export 1340 gives a gate.
2. Sends msg 1022 to port 93 of that gate: p0 = 1 (a page; 7 is its other
   request kind, believed to be a post), p1 = its request number, data =
   the URL, NUL-ended. The request number goes up by 10 for each page.
3. Gets the page back as msg 1022 messages to process `WAP`:
   - a part of the page: p0 = `number << 16 | 6`, p1 = `page size << 16 |
     part size`, data = the part. The first part carries the request's
     number and each later one the next number. A part with any other
     number is dropped, and so is a part that comes twice.
   - an error: p0 = `number << 16 | 5`, p1 = an HTTP status. 404 shows
     "Page not found."; others show "error processing URL: %d".
4. Shows the page once it has all of it. A page is at most 5000 bytes
   (checked at offset 1388 of the browser's `main.e`).

While a page comes in, the browser checks every 5 s that the gate is still
the best one, and says "No connection" if not.

The page is WML as text, parsed by the browser itself. It knows `wml`,
`card`, `p`, `br`, `b`, `big`, `small`, `a`, `anchor`, `go` (with
`postfield`), `input` (text and password), `select`, `option`, `timer`,
`onevent` and others. WML variables are `$(name)`, so a literal `$` is
written `$$`. The browser drops the spaces next to tags, so a gate writes
spaces there as `&nbsp;`. Its address field opens with Shift+Tab. Its Home
is `http://www.cybiko.com/wap/index.asp` (long gone).

A gate can send its parts with message number 0 and count its packets in
byte a: each packet is then handed over at once and answered with code 0,
one round trip per packet instead of two, which halves the time per part
([radio-protocol.md](radio-protocol.md#7-delivery-acknowledgements-and-queries)).

## 5. Timing

| What | Time |
| --- | --- |
| a short packet on the air | about 21 ms (50 bytes at 2400 B/s) |
| a long packet on the air | about 83 ms |
| a gate's answer part (83-87 bytes) and its acknowledgement | about 300-360 ms |
| page data through the radio | about 240-275 bytes a second |
| a full 5000-byte WAP deck | about 18-20 s |
| CyOS's packed message to the gate | every 10 s |
| gate pings | every 3 s is enough |

With p0, p1, a 7-character process name and the length byte, a long packet
leaves 104 - 21 = 83 bytes of data.

## 6. The original gate

On the Classic, the CyWIG was a Cybiko on a PC's serial port. The PC's
VCyWIG program restarts it with a boot image (US119.boot, an LZSS-packed
mini CyOS 1.2.50 loaded at 200000) that makes it the gate on the radio,
and fetches the pages itself with WinInet, asking for `text/vnd.wap.wml`,
`application/vnd.wap.wmlc` and `image/vnd.wap.wbmp` (no HTML). It answers
to process `WAP` with msg 1022, in parts of 1024 bytes (128 when it serves
more than one Cybiko). It also relayed CyOS mail over UDP to
mail1.cybiko.com, ports 15170 and 15171; that server is long gone. The
Xtreme CD and EZ Loader have no Xtreme gateway.

## 7. Other gate clients

The same service can carry other request kinds. The
[cybiko-browser](https://github.com/SovGVD/cybiko-browser) project's
Browser app, a native CyOS application, asks with p0 = `21` and gets pages
laid out for the Cybiko's screen instead of WML; its request kinds, page
format and the gate's short URLs are in that repository's
[`docs/cywig-spec.md`](https://github.com/SovGVD/cybiko-browser/blob/main/docs/cywig-spec.md).

## 8. Open questions

- What the packed message to "CWIG" is for, and whether the original gate
  answered it.
- WAP request kind 7: believed to be a post (the URL, a NUL, then the form
  data), not traced.
- `application/vnd.wap.wmlc` (compiled WML) and WBMP pictures: the original
  gate asked for them, so the WAP browser probably shows them, but this
  wasn't tried.
- Mail through a gate end to end.

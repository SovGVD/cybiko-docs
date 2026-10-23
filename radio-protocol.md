# The Cybiko radio and chat protocol

How Cybiko Xtremes find each other on the radio, deliver messages and chat,
and how they reach the Internet through a gate, in enough detail to write a
chat client for another device.

The protocol is CyOS's own (CyOS calls its network layer CyDP). Everything
here comes from CyOS 1.5.08 on the Cybiko Xtreme:

- packet traces of two and three emulated Cybikos chatting;
- the disassembly of the kernel's radio code and of the Chat application
  (Chat++) as they sit in RAM;
- the Cybiko SDK 2.1 headers (`cyber-rf.h`, `cyber-message.h`) for names;
- a radio-only chat partner written from this document, which talked to an
  emulated Cybiko in every way described here.

**Verified** means seen in traces or tested with that chat partner; **from
the code** means read in CyOS's code but not exercised; **guess** is
marked. The open questions are in [section 12](#12-open-questions). The
gate (CyWIG) and web browsing are in [cywig.md](cywig.md); the radio
hardware and the H8S's serial link to it in
[hardware.md](hardware.md#11-radio).

Conventions: numbers are hex unless they have units; every multi-byte field
on the radio is big-endian; "export N" is CyOS kernel export N as the SDK
numbers them (`__cyos N`).

## Contents

1. [What can talk to what](#1-what-can-talk-to-what)
2. [Layers](#2-layers)
3. [Packets](#3-packets)
4. [Cybiko IDs](#4-cybiko-ids)
5. [Channels](#5-channels)
6. [Finding each other: pings and people around](#6-finding-each-other-pings-and-people-around)
7. [Delivery: acknowledgements and queries](#7-delivery-acknowledgements-and-queries)
8. [Messages](#8-messages)
9. [Chat](#9-chat)
10. [Mesh, gates and the Internet](#10-mesh-gates-and-the-internet)
11. [Earlier readings](#11-earlier-readings)
12. [Open questions](#12-open-questions)

## 1. What can talk to what

A real Cybiko's radio is an RF2915 transceiver driven by an AT90S2313 AVR
(see [hardware.md](hardware.md#11-radio)). The AVR's own air protocol
(modulation, preamble, how it frames the bytes) is not known. Everything
above the AVR, which is all of this document, is CyOS's: the AVR takes
whole packets from CyOS and hands whole packets back.

So anything that can carry these packets between Cybikos, or between a
Cybiko and another device, can join in. Emulated Cybikos can be linked by
any transport that delivers each packet to the machines tuned to its RF
channel; for one, the Dragonfruit ESP32 emulator carries them as ESP-NOW
broadcasts and has a small C library for other ESP32 devices
([Dragonfruit's radio doc](https://github.com/SovGVD/Dragonfruit-JC4827W543-esp32/blob/main/docs/cybiko-radio-protocol.md)).
A real Cybiko can only be reached through its own RF hardware.

## 2. Layers

```
 applications   Chat (msg 1002, port 25)    Finder (msg 1000, port 2)
                WAP and Browser (msg 1022 to the gate's port 93)
 ───────────────────────────────────────────────────────────────────────
 messages       msg id, p0, p1, target (port or process name), data;
                split into parts, numbered, acknowledged
 ───────────────────────────────────────────────────────────────────────
 packets        50 or 200 bytes: 16-byte header, body, Reed-Solomon parity
                pings, messages, acknowledgements, queries
 ───────────────────────────────────────────────────────────────────────
 radio          RF channels 2-9; one hop: every packet goes only as far as
                the sender's radio reaches
 ───────────────────────────────────────────────────────────────────────
 transport      real Cybiko: AVR + RF2915
                emulators: any link that delivers whole packets per RF channel
```

## 3. Packets

Two sizes, both protected by Reed-Solomon parity:

| | Total | Header | Body | Parity | Corrects |
| --- | --- | --- | --- | --- | --- |
| short | 50 | 16 | 14 | 20 | 10 bad bytes |
| long | 200 | 16 | 104 | 80 | 40 bad bytes |

CyOS sends pings, acknowledgements and queries as short packets and every
message as a long one, however small (verified). Both are accepted.

### Header

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 4 | destination Cybiko ID, `ffffffff` for everyone |
| 4 | 4 | sender's Cybiko ID |
| 8 | 1 | `c0` OR the sender's current RF channel (section 5) |
| 9 | 1 | type and flags |
| a | 1 | part: 0 for a message in one packet, else 1, 2, ... (section 8) |
| b | 1 | message number: 0, or 1-255 for a message whose delivery is tracked |
| c | 2 | CRC-16 of the body (14 or 104 bytes) |
| e | 2 | CRC-16 of bytes 0-d, computed after c-d are filled in |

Byte 8: the top two bits are always set; CyOS drops a packet without them
(from the code). The low bits tell everyone which RF channel the sender is
working on, so they know where to reach it.

Byte 9:

| Bits | Meaning |
| --- | --- |
| e0 | type: `00` ping, `20` message, `40` acknowledgement, `60` query ("was it delivered?") |
| 10 | (messages) acknowledge this packet |
| 08 | not seen set |
| 04 | the sender is a CyWIG gate (section 10). A Cybiko that hears a packet from someone without it stops taking them for a gate |
| 02 | not seen set |
| 01 | (pings) the ping carries the owner's details |

### CRC-16

Both CRCs are CRC-16/MODBUS: polynomial 8005 reflected (`a001`), initial
value `ffff`, no final XOR, stored big-endian.

```c
uint16_t crc16(const uint8_t *p, size_t n)
{
    uint16_t c = 0xffff;
    while (n--) {
        c ^= *p++;
        for (int k = 0; k < 8; k++) c = c & 1 ? (c >> 1) ^ 0xa001 : c >> 1;
    }
    return c;
}
```

### Reed-Solomon parity

Reed-Solomon over GF(256) with the field polynomial x^8+x^4+x^3+x^2+1
(`11d`) and primitive element a = 2, the tables in the Cybiko's boot ROM
(exp at 170, log at 270, decoder at 180c). As a codeword, parity byte j
(packet byte k + j, k = 30 or 120) is the coefficient of x^j and data byte
i (packet byte i, header included) is that of x^(n+i), n being 20 or 80.
The generator is (x - a^1)(x - a^2)...(x - a^n), and the parity is the
remainder of data(x)·x^n divided by it. In C, with `gen`
holding g's coefficients from x^0 and `gf_mul` multiplying in GF(256):

```c
uint8_t r[80] = { 0 };
for (int d = k - 1; d >= 0; d--) {          /* highest coefficient first */
    uint8_t fb = pkt[d] ^ r[n - 1];
    memmove(r + 1, r, n - 1);
    r[0] = 0;
    if (fb) for (int i = 0; i < n; i++) r[i] ^= gf_mul(fb, gen[i]);
}
memcpy(pkt + k, r, n);
```

A packet is sealed in this order: body CRC, header CRC, parity.

## 4. Cybiko IDs

Every Cybiko has a 32-bit ID (its CyID), stored in its flash at 7f818 and
covered by the flash record's CRC-32 (see
[hardware.md](hardware.md#12-flash-and-the-unit-id)). Export 701 gives a
Cybiko its own ID. Xtreme IDs start with `4c`.

- CyOS drops packets that carry its own ID as the sender, so every device
  needs its own. A new device can pick `4c` and three bytes of its own
  (for example the end of a MAC address).
- `00000000`, `fffffffe` and `ffffffff` are not IDs; `ffffffff` is
  "everyone". `ffffff01` is the mail gate and `ffffff02` the web gate
  service (section 10).

CyOS shows an ID as 7 letters and digits (export 484, `cyid2str`), for
example `4c8051a3` is XEAMGVB. Chat shows a sender it has no nickname for
as `@` and this form. Bits are taken from the low end; the alphabet has
no I, O, 0 or 1:

```c
static const char a[] = "ABCDEFGHKLMNPRSTUVWXYZQJ23456789";
s[6] = a[(id & 1) + (id >> 31 ? 2 : 0)];
for (int i = 5, v = id >> 1; i >= 0; i--, v >>= 5) s[i] = a[v & 31];
```

## 5. Channels

The radio has eight RF channels, 2 to 9 (export 1161 refuses others).

- **The base channel** is RF channel 2 (it can be changed, export 1150, but
  nothing seen does). A Cybiko listens there whenever no application has
  picked another channel: on the desktop, in most applications.
- **Application channels** 0-29 are what applications ask for
  (`set_appchannel`, export 1091). CyOS turns them into RF channels with a
  table (verified in RAM):

  | Application channel | 0 | 1 | 2 | 3 | 4 | 5 | 6-29 |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | RF channel | base (2) | 4 | 3 | 5 | 7 | 9 | 2 |

- **Channel groups** (`get_groupchannel(group, i)`, export 675) give each
  kind of application its channels. The chat group (`RF_GROUP_CHAT`, 1)
  has 7 entries, all application channel 1. So **every chat room is on RF
  channel 4**; rooms are told apart by a field in the message
  (section 9), not by channel.

| Group | SDK name | Application channels |
| --- | --- | --- |
| 0 | `RF_GROUP_DEFAULT` | 0 |
| 1 | `RF_GROUP_CHAT` | 1 ×7 |
| 2 | `RF_GROUP_CYLAND` | 0 |
| 3 | `RF_GROUP_LABYRINTH` | 0-3 |
| 4-7, 9 | server, files, games, applications, system | 0-4 |
| 8 | other | 0 |

Who sends where (verified):

- A Cybiko tunes its radio to its working channel (the base channel, or
  Chat's channel 4 while Chat is open) and hears only that channel.
- Byte 8 of everything it sends says its working channel. Other Cybikos
  remember it in their people list (`get_appchannel_of`, export 630).
- **Broadcasts** go out on the sender's own working channel.
- **Messages to one Cybiko** go out on the receiver's working channel, as
  the receiver last announced it: a Cybiko on the desktop (channel 2) sent
  its Finder profile to a device that pinged with byte 8 = `c4` on RF
  channel 4, with byte 8 still `c2`.
- **Pings** go out on the base channel, and also on the working channel
  when that is a different one, so that everyone on the base channel keeps
  hearing a Cybiko that went into Chat.

## 6. Finding each other: pings and people around

### People around

Every packet a Cybiko hears, of any type and for anyone, refreshes the
sender in its list of people around (`get_people_around`, export 704): 100
entries holding the ID, when it was last heard, the signal strength, the
working channel and whether it is a gate. In CyOS 1.5.08's RAM the list is
at `G = *(4b4a02)`, entries of 18 bytes: +0 the ID, +4 the time last heard,
+e the signal strength (A/D channel 0, [hardware.md](hardware.md#11-radio)),
+12 the gate flag. CyOS tells applications about
people appearing and leaving with `MSG_DEVICE` (43). That is the whole of
discovery: there is no "hello" or "join" message. To be seen, a device
sends something, and pings are what it sends when it has nothing to say.

### Pings

A ping is a short packet of type 00 to `ffffffff`. Byte a is CyOS's
estimate of how busy its channel is (export 647; 0-3 seen), byte b is 0.
With flag 01 in byte 9 the body carries the owner's details, set by the
Finder application (export 1459):

| Body offset | Size | Field |
| --- | --- | --- |
| 0 | 1 | version: a random number at start-up, plus one each time the details change, never 0 |
| 1 | 3 | 0 |
| 4 | 8 | nickname, NUL-padded (not NUL-ended when it is 8 characters long) |
| c | 1 | bit 7: female; bits 0-6: age, `7f` if not given |
| d | 1 | 0 |

For example `2a 00 00 00 41 6c 69 63 65 00 00 00 13 00` is Alice, male,
19. CyOS leaves junk after the nickname's NUL; read up to the first NUL.

When CyOS pings (verified in traces, the rules in the code are only partly
followed): an idle Cybiko on the desktop sent no pings at all for minutes.
Once it has sent something of its own (a chat line, its Finder profile), it
pings about every 10 s for as long as it stays active. A Cybiko that only
listens never pings, so it is invisible until it says something.

A device that wants to be seen should ping on the base channel and on its
own working channel every 3-10 s, with its nickname. That is what makes its
nickname appear in Chat instead of `@XXXXXXX`.

### Finder profiles

Finder (CyOS's "people matching" application, always running) answers a
ping from someone new by sending its owner's full profile to them, and also
broadcasts it every 10-20 s on its working channel while it is active: msg
1000 to port 2, 90 bytes of data, delivered with an acknowledgement
(section 7). So pinging is also a way to find the Cybikos around that never
ping. The 90 bytes start with the nickname (9 bytes, NUL-ended), and hold
the "About me" and "About you" answers; the rest is not decoded. A device
that doesn't do Finder must still acknowledge these messages (any code 4
answer will do) or the Cybiko keeps resending them.

## 7. Delivery: acknowledgements and queries

### Broadcasts

A message to `ffffffff` is never acknowledged (byte 9 = `20`). Chat sends
each line three times, about 120-250 ms apart, as three separate messages
with the same content; receivers drop the copies (section 9).

### Messages to one Cybiko

Byte 9 is `30` (a message, acknowledge it). The receiver answers each packet
with an acknowledgement: a short packet of type 40, to the sender, copying
bytes a and b, whose first body byte has the answer code in its top four
bits (the other body bytes are leftovers of an earlier packet; ignore them):

| Code | Meaning |
| --- | --- |
| 0 | taken: a part that isn't the last, or a message number 0 handed over |
| 2 | got it: the message arrived, it will be handed over later |
| 3 | got it again: a repeat of one being worked on |
| 4 | delivered (`DL_SUCCESS`) |
| 5 | nobody took it: no such process or port (`DL_ABORT`) |

A receiver sends each acknowledgement about three times, 50-100 ms apart,
so a sender must not count them.

Two ways a numbered message (byte b 1-255) is finished, both verified:

- **At once.** If the message's byte 1 (section 8) has bit 80, the
  receiver hands it over straight away and answers the last packet with 4
  (or 5). Chat sends private lines this way.
- **In two steps.** Without it, the receiver answers 2 and holds the
  message. The sender asks with a query (a short packet of type 60 to the
  receiver, copying bytes a and b, body zero) until the answer is 4 or 5.
  The message is handed over when the receiver answers 4. CyOS queries
  every ~100 ms.

A sender resends a packet that gets no answer (every ~400 ms works) and
gives up after its timeout (Chat allows about 30 s). A receiver must
recognise a repeat (same sender, number and body CRC) and answer it again
without handing the message over twice. CyOS numbers its messages 1, 2,
3... per sender. Message number 0 with flag 10 means "answer 0 when handed
over", one round trip per packet; a gate can use it to halve the time per part ([cywig.md](cywig.md)).

## 8. Messages

A message is what CyOS applications send each other: a msg id, two 32-bit
parameters p0 and p1, a target (a port number, or the name of a process
created with that name), and optional data. The body of a message packet:

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 1 | flags (below) |
| 1 | 1 | `80`: hand over at once (section 7); otherwise 0 |
| 2 | 2 | msg id |
| | 4 | p0, if flag 08 |
| | 4 | p1, if flag 04 |
| | 2 or n | the target: a port, or with flag 20 a NUL-ended process name (up to 11 characters) |
| | 1 | data length, if flag 10 and not 02 |
| | n | the data |

| Flag | Meaning |
| --- | --- |
| 20 | the target is a process name |
| 10 | data follows |
| 08 | p0 follows |
| 04 | p1 follows |
| 02 | the message goes on in more packets: no length byte, the data runs to the end of the body |
| 01 | (parts after the first) the last part |

CyOS leaves out p0 and p1 when they are 0. A message to a port nobody
listens on, or to a process name the Cybiko doesn't have, is answered 5.

### Messages in parts

A message too big for one long packet (104 bytes of body) is sent in parts
(verified with 2 and 3 parts, both ways):

- Every part has its index in byte a (1, 2, ...) and the message's number
  in byte b (0 for broadcasts). Nothing says how many parts there are.
- Part 1 is the start of the body as above, with flag 02, so it has no
  length byte and its data fills the packet.
- A middle part's body is `02 00` and 102 bytes of data.
- The last part's body is `03 00`, the length of its data (one byte), then
  the data. Bytes after it are padding (CyOS leaves junk there).
- A message to one Cybiko has every part acknowledged on its own: 0 for the
  parts before the last, and the code of section 7 for the last one. The
  sender waits for each part's answer before sending the next.

A middle part that starts with anything other than `02 00` makes the
Cybiko drop the whole message (tested).

## 9. Chat

Chat (Chat++, `chat_*.app`) has six fixed rooms and user-defined ones. All
of them are on RF channel 4 (application channel 1); a line carries its
room.

### A chat line

Msg **1002** to port **25**:

| Field | Value |
| --- | --- |
| p0 | the sender's clock (`clock()`, milliseconds since start-up). Receivers use it to tell the three copies of a broadcast line apart from a new line |
| p1 | the room code (below); left out for General (0) |
| data | the text, NUL-ended: at most 99 characters and the NUL |
| byte 1 | `80` for private lines, 0 for lines to everyone |

| Room | General | Romance | Computing | Sports | Games | Music |
| --- | --- | --- | --- | --- | --- | --- |
| Code (p1) | 0 | 1 | 2 | 3 | 4 | 5 |

(Chat's room list shows them as General, Games, Music, Computing, Sports,
Romance; the codes are verified both ways.) A Cybiko shows a line only
while the receiver has that room open.

**To everyone in a room**: send to `ffffffff` with byte 9 = `20`, message
number 0, three times (section 7). A line of up to 92 characters (88
outside General) fits one packet: `18 00 1002 <p0> 0025 <len> <text> 00`, or `1c 00 1002 <p0> <p1>
0025 ...` outside General. A longer one goes in two parts.

**To one person**: Chat's private lines go to the person's ID with byte 9 =
`30`, the next message number, byte 1 = `80`, and are answered 4 (section
8). The receiver shows them in the open room like any other line.

The text is plain ASCII as typed on the Cybiko's keyboard. Before sending,
Chat refuses lines with words from a list of swear words ("This message
won't be sent"); that is the sender's business only. Receivers drop lines
from people on their ignore list, and broadcast lines while "Ignore
Broadcast" is on.

Example, Alice (`4c8051a3`) to everyone in General, the body of a long
packet with header `ffffffff 4c8051a3 c4 20 00 00 <crc> <crc>`:

    18 00 10 02 00 01 b1 e8 00 25 0f 48 69 2c 20 65 76 65 72 79 62 6f 64 79 21 00
    flags msgid  p0=0001b1e8  port len "Hi, everybody!"                       NUL

### Names

Chat shows each line's sender by the nickname from their latest ping, or
`@` and the 7-letter ID (section 4) when it has heard no ping from them. It
shows its own lines as `▶all` or `▶name` for the person they went to.

### Other Chat messages

The Chat code also handles msg **2001** (its data is a NUL-ended string
followed by more data; believed to be user-defined rooms or invitations,
not traced) and msg **31** (dropped). These are not needed to chat in the
six rooms.

### Writing a chat client

What a device needs to do to chat with Cybikos (the radio-only chat
partner this document was tested with does this):

1. Pick an ID (section 4) and a nickname of up to 8 characters.
2. Listen to RF channel 4. Check both CRCs of every packet (section 3).
3. Every 3-10 s, ping with your nickname, byte 8 = `c4`, on RF channels 2
   and 4.
4. For each message packet to you or to everyone: put the parts together
   (section 8). If it is to you and byte 9 has flag 10, answer each packet
   (0 for a part that isn't the last, else 4); answer a query with 4.
5. A message with msg id 1002 and port 25 is a chat line. Drop copies with
   the same sender and p0. Show it with the sender's nickname from their
   pings, and the room from p1.
6. Other messages (Finder's msg 1000 to port 2 and others) can be ignored
   once acknowledged; log them rather than dropping them silently.
7. To say something to a room, send the line three times to `ffffffff` on
   RF channel 4. To say something to one person, send it with an
   acknowledgement, the next message number and byte 1 = `80`, and resend
   until it is answered.

## 10. Mesh, gates and the Internet

### No relaying between Cybikos

Cybikos don't pass packets on for each other. In the kernel's receive loop
(`49ac7e` on), a packet for someone else (not this Cybiko's ID or
`ffffffff`) only refreshes the people list; nothing is retransmitted.
Tested with three emulated Cybikos in a row (B hears A and C,
A and C don't hear each other), all three in Chat's General room, each
saying a line: A showed only B's line, C showed only B's, and only B showed
everyone's. B never sent a packet with another Cybiko's ID as the sender.
The
manual's "wireless local virtual network" of "up to 99 friends" is everyone
within radio range (50 m indoors, 300 m outdoors for chat, about 20 m for
files and games).

### Gates

A CyWIG (Cybiko Wireless Internet Gate) is a device on the radio that sets
flag 04 in byte 9 of everything it sends. Every Cybiko keeps the gate it
hears best (`get_gate_cyid`, export 1340; the signal strength decides) and
uses it for two things:

- **Web pages**: the WAP browser sends msg 1022 to port 93 of the gate with
  a URL, and the gate answers with the page in parts.
- **Store and forward** (from the code): when an application sends a
  message to one Cybiko that is *not* in the people list and a gate is
  visible, CyOS wraps the whole message in a packed message (msg **47**,
  `MSG_PACKED`) and sends it to the gate instead. That is how mail and
  messages to people out of range travel: through the gate and whatever
  network is behind it.

Both, with the packed message's format, are in [cywig.md](cywig.md).

A gate is no different: every Cybiko that hears the gate directly can use
it, and no Cybiko passes it on further. Tested with the same three Cybikos
in a row (A-B-C) and a gate heard by B and C but not A: B and C both
loaded pages through it, and A found no gate. With the gate heard by C
only, B showed no gate either. A Cybiko that hears a gate doesn't set the
gate flag on its own packets, and A never sent anything to the gate's ID.

### What this means for a mesh

The Cybiko protocol has no routing: one hop, plus gates that forward what
they are given. A mesh between boards, or between Cybikos and other
devices, has to be added by the boards, for example by gates that pass
packed messages to each other over Wi-Fi. That is a design for later.

## 11. Earlier readings

A few things were first read differently from the WAP traces (one Cybiko
talking to a gate) and later settled with chat traces and tests:

- **Byte 1 of a message body.** First seen as "unknown: 00 in everything
  traced, 80 seen once". It is the "hand over at once" flag of
  [section 7](#7-delivery-acknowledgements-and-queries): Chat's private
  lines set it (verified).
- **Byte b of a message in parts.** First read as the number of parts,
  from a two-part message where it was 2. Messages of three parts show it
  is the message's number (0 for broadcasts), the same in every part, and
  nothing says how many parts there are (verified).
- **Middle parts** were at first only inferred; they are `02 00` and 102
  bytes of data (verified).

## 12. Open questions

- The AVR's air protocol, so that a real Cybiko could be reached: its
  firmware (`avr*.boot`, shipped with CyOS updates) could be read, or a
  real Cybiko's AVR and RF chip driven from another microcontroller's
  serial port with the serial protocol of
  [hardware.md](hardware.md#11-radio).
- Exactly when CyOS starts and stops pinging, and how long a silent device
  stays in the people list (CyOS pings every ~10 s; pinging every 3-10 s
  is safe).
- The 90 bytes of a Finder profile past the nickname.
- Chat's msg 2001 and user-defined rooms; invitations to chat or to games.
- Byte 9 bits 08 and 02, and the low bits of byte 8 above the RF channel.
- Mail through a gate end to end (only the packing was read in the code).
- The rest of the data of CyOS's own pings past the nickname (version
  byte, the bytes after the NUL).
- File transfer and multiplayer games (other ports and channel groups).

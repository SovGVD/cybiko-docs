# Free MXD clip players

MXD clips (the MP3 cartridge's video clips, see
[file-formats.md](../file-formats.md#mxd-clips)) carry their own player
program, `main.e`. The CD's clips all have the same one, Cybiko's. These are
players written from scratch that do the same, so a new clip needs no file
from the CD:

- **simple** (`simple.c`, 7 KB): plays the clip; Esc stops it.
- **controls** (`controls.c`, 14 KB): the same, with keys to pause, seek
  and change the volume, and a time bar.
- **both** (`both.c`, 10 KB, experimental): the simple one for **both
  Cybikos**, the Xtreme with the MP3 cartridge and the Classic with its MP3
  player (CY65P10). See [Classic + Xtreme](#classic--xtreme-experimental).

The [converters](../tools/README.md#cybiko_mxdpy-mxd-video-clips)
([and the web page](../web/README.md#mxd-clips)) put the simple one in the
clips they make, the one with controls when asked (`--player controls`), or
Cybiko's own when given a CD clip to take it from.

What it does, like Cybiko's:

- plays `music.mp3` (or an IMA ADPCM `music.wav`) from the clip through
  the cartridge's `sound.dl`, which therefore has to be installed (the
  cartridge's software, `MP3.cap` on its CD);
- shows the frames of `clip.pic`, frame *n* at start + *n* × the frame
  period, and stops the sound after the last frame;
- says "The music codec is busy. Please try later" when the decoder is in
  use.

And beyond it:

- **Esc** stops the clip.
- **Keys** (controls only): Space (or Enter) pauses and resumes, Left and
  Right go back and forward 5 seconds, Up and Down change the volume.
  After a key a bar at the bottom shows the time, the clip's length and the
  volume for 2 seconds (all the time while paused). Seeking takes a moment:
  the frames up to the new place have to be unpacked (about 40 ms each, so
  about 1 s for 5 s forward), and going back reads the clip from the start.
  The sound waits for the picture, so the two stay together.
- Frames **smaller than the screen** are drawn at their x and y.
- A clip **without sound** (no `music.mp3` or `music.wav`) plays silently.
  It checks first, because `sound.dl` crashes when asked for a part that
  isn't there.

**Tested** in Dragonfruit's PC runner (`cybiko_host`, with the MP3
cartridge emulated): with the CD clip `hungry.app`'s frames and music, the
same frames appear at the same times (within 2 ms) as with Cybiko's player,
the sound plays for the same time at the same level, Esc stops picture and
sound, and the desktop comes back at the end. Clips made by `cybiko_mxd.py`
at 3 fps play at 3 fps. The controls player's pausing, seeking and volume were checked there
too (the sound's position and the decoder's volume register). It has not
run on a real Cybiko yet.

## Classic + Xtreme (experimental)

One clip file that plays on both models, made with `cybiko_mxd.py --player
both` (or the web page's "Classic + Xtreme" player).

- **Starting on both.** A module names the libraries it imports, and CyOS
  won't start it when one is missing ("Necessary components are not
  found"); `root.inf` lists libraries too. So the player names none but the
  kernel and `CyWin.dl` (both models have them), its `root.inf` lists none,
  and at run time it asks CyOS for `sound.dl` (the Xtreme's cartridge
  software) and `MP3.dl` (the Classic player's) with kernel export 843,
  which loads a library by name and gives 0 when there is none
  ([cyos.md](../cyos.md#libraries-at-run-time)). The archive and module
  formats and the kernel's export numbers are the same on both models.
- **On the Xtreme** (`sound.dl` found) it plays like the simple one.
- **On the Classic** (`MP3.dl` found) the Classic has no MP3 decoder, and
  the player plays only files on its own SmartMedia card; it can't be fed a
  stream. So the clip must be on the player's card (it runs from there:
  File Manager, SMC, or the desktop's SMC folder). The converter puts
  `music.mp3`'s data on a 512-byte block of the clip's file, with its
  offset in the part `music.ofs`; the player finds its own file on the card
  (commands 38 and 39, by the application's name) and tells the MP3 player
  to play that file from that block (13), shows the frames by the clock as
  on the Xtreme, and stops it (14) after the last frame or at Esc. The
  frames come from the same file through CyOS, which reads the card while
  the music plays.
- **Neither** (or a Classic clip that isn't on the card, which it says):
  the frames without sound.
- `root.inf` asks for CyOS 1.5.1, as the CD's clips: the Xtreme asks before
  it runs anything that asks for less ("an application for the previous
  version of Cybiko"), and the Classic compares only the last number.

**Tested** in Dragonfruit's PC runner only: on the Xtreme (CyOS 1.5.08, the
cartridge's software) and on the Classic (CyOS 1.2.57 with `MP3.app`,
`MP3.dl` and `mp3_control.dl`, the clip on the emulated player's card),
picture at 5 frames a second and sound on both. The Classic's MP3 player is
emulated from what its software sends, since its firmware was never dumped,
so what a real player does with a file that isn't an MP3 file, and whether
it serves CyOS's reads while it plays, is not known. If it doesn't work, make
the clip with the simple player (Xtreme only).

## Building

```sh
player/build.sh
```

Needs the GNU H8 tools (`binutils-h8300-hms`, `gcc-h8300-hms` on Debian and
Ubuntu) and Python 3. It builds both into `build/player/` and copies them to
where the converters take them from: `tools/cybiko_mxd_player.e` (simple),
`tools/cybiko_mxd_player_controls.e`, `tools/cybiko_mxd_player_both.e` and
`web/lib/mxdplayer.js` (all three, in base64). Commit those after changing a player.

| File | What |
| --- | --- |
| `simple.c`, `controls.c`, `both.c` | the players |
| `cyos.ld` | the CyOS functions it calls, by export number |
| `link.ld`, `rt.s` | the module's layout and gcc's runtime helpers (from [cybiko-browser](https://github.com/SovGVD/cybiko-browser)) |
| `mkmodule.py` | turns the linked program into a CyOS module ([format](../file-formats.md#cyos-modules-maine)); names only the libraries the program imports |

How it talks to `sound.dl` is in
[mp3-cartridge.md](../mp3-cartridge.md#21-sounddl-as-the-clip-player-uses-it);
the CyOS calls it needs (reading its own archive, waiting for messages,
ending) are in [cyos.md](../cyos.md#native-applications).

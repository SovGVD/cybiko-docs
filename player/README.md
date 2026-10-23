# Free MXD clip players

MXD clips (the MP3 cartridge's video clips, see
[file-formats.md](../file-formats.md#mxd-clips)) carry their own player
program, `main.e`. The CD's clips all have the same one, Cybiko's. These are
players written from scratch that do the same, so a new clip needs no file
from the CD:

- **simple** (`simple.c`, 7 KB): plays the clip; Esc stops it.
- **controls** (`controls.c`, 14 KB): the same, with keys to pause, seek
  and change the volume, and a time bar.

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

## Building

```sh
player/build.sh
```

Needs the GNU H8 tools (`binutils-h8300-hms`, `gcc-h8300-hms` on Debian and
Ubuntu) and Python 3. It builds both into `build/player/` and copies them to
where the converters take them from: `tools/cybiko_mxd_player.e` (simple),
`tools/cybiko_mxd_player_controls.e` and `web/lib/mxdplayer.js` (both, in
base64). Commit those after changing a player.

| File | What |
| --- | --- |
| `simple.c`, `controls.c` | the players |
| `cyos.ld` | the CyOS functions it calls, by export number |
| `link.ld`, `rt.s` | the module's layout and gcc's runtime helpers (from [cybiko-browser](https://github.com/SovGVD/cybiko-browser)) |
| `mkmodule.py` | turns the linked program into a CyOS module ([format](../file-formats.md#cyos-modules-maine)) |

How it talks to `sound.dl` is in
[mp3-cartridge.md](../mp3-cartridge.md#21-sounddl-as-the-clip-player-uses-it);
the CyOS calls it needs (reading its own archive, waiting for messages,
ending) are in [cyos.md](../cyos.md#native-applications).

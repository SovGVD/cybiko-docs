/* A free player for MXD clips that runs on both Cybikos (experimental):
 * the Xtreme with the MP3 cartridge, as simple.c, and the Classic with its
 * MP3 player (CY65P10). It names no sound library in its module, so CyOS
 * starts it on either; at run time it asks CyOS for the one it has (kernel
 * export 843, which loads a library by name):
 *
 * - sound.dl (the Xtreme's cartridge software): as simple.c, music.mp3
 *   streamed to the cartridge's decoder.
 * - MP3.dl (the Classic's player software): the player plays music.mp3
 *   itself, from the clip's own file on its SmartMedia card. The converter
 *   puts music.mp3's data on a 512-byte block of the file and its offset in
 *   the part music.ofs; the player is told to play the clip's file from
 *   that block (command 13). So the clip must be on the player's card.
 * - neither: the frames, without sound.
 *
 * Esc stops it. Built with the GNU H8 tools: see build.sh. */

typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned long u32;

#define CLR_WHITE 0
#define CLR_BLACK 255
#define MSG_KEYDOWN 1
#define MSG_QUIT 0x31
#define MSG_GOTFOCUS 0x41
#define MSG_SHUTUP 0x101a
#define KEY_ESC 0x107

struct Process;
struct Queue;
struct DisplayGraphics;
struct Font;
struct Input;

struct Message {
    void *buffer;
    char procname[12];
    struct Message *next;
    char *dst_name;
    long cyid_from;
    long cyid_to;
    u8 deleted;
    u8 pad;
    short msgid;
    long param[2];
    void *session;
};

/* The process's message queue and its module's archive, inside the Process */
#define PROCESS_QUEUE(p) ((struct Queue *)((char *)(p) + 108))
#define PROCESS_ARCHIVE(p) (*(void **)((char *)(p) + 0x50))
/* The screen buffer of a graphics context: 160 x 100, 2 bits a pixel */
#define GFX_BUF(g) (*(u8 **)((char *)(g) + 12))
/* CyWin's application object; its thread runs slot 7 of the table at +0x10 */
#define CWINAPP_SIZE 0xf4
#define CWINAPP_WINDOW(a) ((void *)((char *)(a) + 0xac))
#define PROCESS_FLAGS(p) (*(u16 *)((char *)(p) + 0x4c))
#define PROCESS_VTABLE(p) (*(void ***)((char *)(p) + 0x10))

extern struct Process *cy_current_thread;
extern struct Font *cy_cool_normal_font;
struct DisplayGraphics *cy_Process_get_display(void);
struct Process *cy_Process_request_focus(struct Process *p);
void cy_DisplayGraphics_show(struct DisplayGraphics *g);
struct Message *cy_Queue_get_message(struct Queue *q, long timeout, int min, int max);
struct Message *cy_Queue_peek_message(struct Queue *q, int remove, int min, int max);
void cy_Message_delete(struct Message *m);
void cy_Thread_start(struct Process *p, int flag);
void cy_SystemThread_pause(struct Process *t, long ms);
u32 cy_clock(void);
struct Input *cy_Archive_open_Ex(void *archive, const char *name);
void cy_TGraph_set_color(void *g, int color);
void cy_TGraph_fill_screen(void *g, int color);
void cy_Graphics_set_font(void *g, struct Font *f);
void cy_Graphics_draw_text(void *g, const char *s, int x, int y);
int cy_strcmp(const char *a, const char *b);
void *cy_cWinApp_ctor(void *app, const char *name, int stack);
void cy_module_get(void **holder, const char *name);
void cy_holder_release(void **holder, int mode);
void *cy_malloc(long n);

#define W 160
#define H 100
#define SCREEN (W / 4 * H)

/* sound.dl's objects are C++ objects: a method is a slot of the table the
 * object's first word points to (offsets in bytes, as Cybiko's player
 * calls them). */
#define SLOT(o, off) ((*(void ***)(o))[(off) / 4])
#define M0(o, off) ((void *(*)(void *))SLOT(o, off))(o)
#define M1(o, off, a) ((void *(*)(void *, void *))SLOT(o, off))(o, (void *)(a))
#define B0(o, off) ((u8 (*)(void *))SLOT(o, off))(o)
#define SYS_OPEN_INPUT 0x3c         /* (system, ":part"): a source */
#define SYS_OPEN_OUTPUT 0x18        /* (system, device name) */
#define SYS_RELEASE 0x44            /* (system, object) */
#define FMT_NAME 0x0c               /* (format): "MP3", "IMAADPCM"... */
#define FMT_CONVERTER 0x08          /* (format, other format): a converter */
#define OUT_READY 0x18              /* (output): the codec is free */
#define OUT_START 0x0c
#define OUT_STOP 0x10
#define OUT_PLAYING 0x14
#define OUT_CLOSE 0x1c
#define OUT_DISCONNECT 0x90
#define ANY_FORMAT 0x48             /* (stream): its format */
#define ANY_CONNECT 0x88            /* (output, source) */
#define IN_SET_FORMAT 0x80
#define CONV_OUT_FORMAT 0x48
#define CONV_IN_FORMAT 0x4c

static u32 proc_mem[CWINAPP_SIZE / 4 + 4];
static void *vtable[20];
static struct Process *me;
static struct DisplayGraphics *gfx;
static u32 frame_words[SCREEN / 4];
#define frame ((u8 *)frame_words)
static void *sys, *src, *out, *conv;
static void **sound_dl, **mp3_dl;         /* the library holders (export 843) */
static char argv0[40];
static u8 quit;

/* clip.pic comes as an archive stream (CyOS's Input class). Its block read
 * is slot 2 of the method table at +4 (slot 3, which Cybiko's player uses
 * for the header, reads a byte); the kernel's Input_read export crashes on
 * an archive's stream. Returns how many bytes it got. */
static long get(struct Input *in, void *buf, long n)
{
    long (*rd)(struct Input *, void *, long) =
        (long (*)(struct Input *, void *, long))(*(void ***)((char *)in + 4))[2];
    return rd(in, buf, n);
}

/* Deletes the stream, the way Cybiko's player does: its first word points
 * to the object that owns it, whose destructor is slot 3 of the table at +8
 * (3: destroy and free). */
static void drop(struct Input *in)
{
    void *o = *(void **)in;
    ((void (*)(void *, int))(*(void ***)((char *)o + 8))[3])(o, 3);
}

static void say(const char *a, const char *b)
{
    cy_TGraph_fill_screen(gfx, CLR_WHITE);
    cy_TGraph_set_color(gfx, CLR_BLACK);
    cy_Graphics_set_font(gfx, cy_cool_normal_font);
    cy_Graphics_draw_text(gfx, a, 4, 34);
    if (b) cy_Graphics_draw_text(gfx, b, 4, 50);
    cy_DisplayGraphics_show(gfx);
}

/* Messages, waiting up to wait ms for the first (0: not at all; a get
 * with timeout 0 would wait for ever). Esc or a quit request ends the clip. */
static void poll(long wait)
{
    struct Message *m = wait ? cy_Queue_get_message(PROCESS_QUEUE(me), wait, 0, 0x7fff)
                             : cy_Queue_peek_message(PROCESS_QUEUE(me), 1, 0, 0x7fff);
    for (; m; m = cy_Queue_peek_message(PROCESS_QUEUE(me), 1, 0, 0x7fff)) {
        if (m->msgid == MSG_GOTFOCUS) {
            void *w = CWINAPP_WINDOW(me);
            ((u8 (*)(void *, struct Message *))(*(void ***)((char *)w + 0x10))[6])(w, m);
        } else if (m->msgid == MSG_KEYDOWN && *(int *)m->param == KEY_ESC) quit = 1;
        else if (m->msgid == MSG_QUIT || m->msgid == MSG_SHUTUP) quit = 1;
        cy_Message_delete(m);
    }
}


/* A library by name, or 0 if CyOS has none: export 843 fills a holder with
 * the library's module (and counts a use); the module's table of exports is
 * the pointer at +5c. */
static void **library(const char *name)
{
    void **h = cy_malloc(4);
    if (!h) return 0;
    *h = 0;
    cy_module_get(h, name);
    return h;
}

static void *export_of(void **h, int n)
{
    return (*(void ***)((char *)*h + 0x5c))[n];
}

static void library_release(void **h)
{
    if (h && *h) cy_holder_release(h, 3);   /* 3: let the library go and free the holder */
}

/* ---- the Classic's MP3 player, through MP3.dl's exports:
 * 1 take the bus (u8: done), 2 let it go, 3 send a command (command, data,
 * length), 4 read the answer (status, data, length): 0 OK, 2 busy (again
 * after a while), 5 no answer. Numbers on the wire are big-endian. */

static u8 ans[520];
static u16 ans_len;

static int mp3_cmd(u16 cmd, const void *data, u16 len)
{
    u8 (*take)(void) = (u8 (*)(void))export_of(mp3_dl, 1);
    void (*let_go)(void) = (void (*)(void))export_of(mp3_dl, 2);
    int (*send)(int, const void *, int) = (int (*)(int, const void *, int))export_of(mp3_dl, 3);
    int (*recv)(u16 *, void *, u16 *) = (int (*)(u16 *, void *, u16 *))export_of(mp3_dl, 4);
    int tries, r = 5;
    u16 status;
    for (tries = 0; tries < 20; tries++) {
        if (!take()) return 5;
        r = send(cmd, data, len);
        if (!r) r = recv(&status, ans, &ans_len);
        let_go();
        if (r != 2) break;
        cy_SystemThread_pause(cy_current_thread, 500);
    }
    if (r) ans_len = 0;
    return r;
}

static void put32(u8 *b, u32 v) { b[0] = v >> 24; b[1] = v >> 16; b[2] = v >> 8; b[3] = v; }
static u32 get32(const u8 *b) { return (u32)b[0] << 24 | (u32)b[1] << 16 | (u32)b[2] << 8 | b[3]; }

static int lower(int c) { return c >= 'A' && c <= 'Z' ? c + 32 : c; }

/* name is argv[0] (the application's name), or argv[0] with ".app" */
static int same_name(const u8 *name, int n)
{
    int i;
    for (i = 0; i < n && argv0[i]; i++)
        if (lower(name[i]) != lower(argv0[i])) return 0;
    if (i == n) return !argv0[i];
    return !argv0[i] && n - i == 4 && name[i] == '.' && lower(name[i + 1]) == 'a'
        && lower(name[i + 2]) == 'p' && lower(name[i + 3]) == 'p';
}

/* The clip's own file on the player's card: the top folder's files (38),
 * each one's name (39). 0xffffffff if not there. */
static u32 own_file(void)
{
    static u8 q[12], ids[0x80 * 4];
    u32 from = 0;
    for (;;) {
        u16 n, i;
        q[0] = 0; q[1] = 0x32;            /* at most 0x32 at a time, as MP3.app */
        q[2] = 0; q[3] = 0;               /* every kind of file */
        put32(q + 4, from);
        put32(q + 8, 0xfffffffe);         /* the top folder */
        if (mp3_cmd(0x38, q, 12)) return 0xffffffff;
        n = ans_len / 4;
        for (i = 0; i < n * 4; i++) ids[i] = ans[i];
        for (i = 0; i < n; i++) {
            u32 id = get32(ids + 4 * i);
            put32(q, id);
            if (!mp3_cmd(0x39, q, 4) && ans_len > 9 && same_name(ans + 9, ans_len - 9)) return id;
        }
        if (n < 0x32) return 0xffffffff;
        from += n;
    }
}

/* 0: no sound (no music.mp3, or the clip is not on the card), 1: playing */
static int classic_play(void)
{
    static u8 q[6];
    struct Input *in = cy_Archive_open_Ex(PROCESS_ARCHIVE(me), "music.ofs");
    u32 ofs, id;
    if (!in) return 0;
    if (get(in, q, 4) != 4) { drop(in); return 0; }
    drop(in);
    ofs = get32(q);
    id = own_file();
    if (id == 0xffffffff) {
        say("No sound: the clip is not", "on the MP3 player's card");
        poll(2500);
        return 0;
    }
    q[0] = 0; q[1] = 0;
    mp3_cmd(0x1f, q, 2);                  /* MP3 mode */
    mp3_cmd(0x14, 0, 0);                  /* stop what plays */
    put32(q, id);
    q[4] = (u8)(ofs >> 17); q[5] = (u8)(ofs >> 9);
    return !mp3_cmd(0x13, q, 6);          /* play the file from music.mp3's block */
}

static void classic_stop(void)
{
    mp3_cmd(0x14, 0, 0);
}

/* sound.dl isn't asked for a part the clip doesn't have: it crashes. */
static int has_part(const char *name)
{
    struct Input *in = cy_Archive_open_Ex(PROCESS_ARCHIVE(me), name);
    if (!in) return 0;
    drop(in);
    return 1;
}

/* Opens music.mp3 (or music.wav) and connects it to the cartridge's
 * decoder (or the speaker). 0: no sound (the clip has none), 1: ready,
 * 2: the codec is busy. */
static int sound_open(void)
{
    const char *name, *device, *part;
    void *fi, *fo;
    if (!has_part("music.mp3")) {
        if (!has_part("music.wav")) return 0;     /* a silent clip */
        part = ":music.wav";
    } else part = ":music.mp3";
    sound_dl = library("sound.dl");
    if (!sound_dl || !*sound_dl) return 0;
    sys = ((void *(*)(void))export_of(sound_dl, 0))();   /* the sound system object */
    if (!sys) return 0;
    src = M1(sys, SYS_OPEN_INPUT, part);
    if (!src) return 0;
    fi = M0(src, ANY_FORMAT);
    name = fi ? M0(fi, FMT_NAME) : 0;
    if (name && !cy_strcmp(name, "MP3")) device = "MP3AudioOutput";
    else if (name && !cy_strcmp(name, "IMAADPCM")) device = "speaker";
    else return 0;
    out = M1(sys, SYS_OPEN_OUTPUT, device);
    if (!out || !B0(out, OUT_READY)) return 2;
    fo = M0(out, ANY_FORMAT);
    if (fi && fo && cy_strcmp(M0(fi, FMT_NAME), M0(fo, FMT_NAME))) {
        conv = ((void *(*)(void *, void *))SLOT(fi, FMT_CONVERTER))(fi, fo);
        if (conv) {
            M1(out, ANY_CONNECT, M0(conv, CONV_OUT_FORMAT));
            M1(src, IN_SET_FORMAT, M0(conv, CONV_IN_FORMAT));
        }
    } else M1(out, ANY_CONNECT, src);
    return 1;
}

static void sound_close(void)
{
    if (out) {
        if (B0(out, OUT_PLAYING)) M0(out, OUT_STOP);
        while (B0(out, OUT_PLAYING)) cy_SystemThread_pause(cy_current_thread, 160);
        M0(out, OUT_CLOSE);
        M0(out, OUT_DISCONNECT);
    }
    if (src) M1(src, ANY_CONNECT, 0);
    if (sys) {
        if (src) M1(sys, SYS_RELEASE, src);
        if (out) M1(sys, SYS_RELEASE, out);
        if (conv) M1(sys, SYS_RELEASE, conv);
    }
    library_release(sound_dl);
}

/* A frame smaller than the screen, at x, y: 2 bits a pixel, rows padded to
 * whole bytes, leftmost pixel in the top bits (as the screen). */
static void blit(u8 *scr, int x, int y, int w, int h)
{
    int r, c, stride = (w + 3) / 4;
    for (r = 0; r < h && y + r < H; r++)
        for (c = 0; c < w && x + c < W; c++) {
            int v = frame[r * stride + c / 4] >> (6 - 2 * (c & 3)) & 3;
            int at = (y + r) * (W / 4) + (x + c) / 4, sh = 6 - 2 * ((x + c) & 3);
            scr[at] = (scr[at] & ~(3 << sh)) | v << sh;
        }
}

static void run(struct Process *p)
{
    struct Input *pic;
    u8 head[4];
    u16 period;
    u32 next;
    int snd;
    gfx = cy_Process_get_display();
    cy_Process_request_focus(p);
    cy_SystemThread_pause(cy_current_thread, 300);
    pic = cy_Archive_open_Ex(PROCESS_ARCHIVE(p), "clip.pic");
    if (!pic || get(pic, head, 4) != 4) {
        say("Bad picture", 0);
        poll(3000);
        if (pic) drop(pic);
        return;
    }
    period = head[0] << 8 | head[1];
    mp3_dl = library("MP3.dl");
    if (mp3_dl && *mp3_dl) snd = 3;       /* the Classic's player: started below */
    else snd = sound_open();
    if (snd == 2) {
        say("The music codec is busy.", "Please try later");
        poll(3000);
        sound_close();
        drop(pic);
        return;
    }
    cy_SystemThread_pause(cy_current_thread, 200);
    next = cy_clock();
    if (snd == 3) {
        if (!classic_play()) snd = 0;
        next = cy_clock();
    } else if (snd) M0(out, OUT_START);
    while (!quit) {
        u8 *scr = GFX_BUF(gfx);
        int x, y, w, h, size;
        if (get(pic, head, 4) != 4) break;
        x = head[0]; y = head[1]; w = head[2]; h = head[3];
        size = (w + 3) / 4 * h;
        if (size > SCREEN || get(pic, frame, size) != size) break;
        /* into the screen only at the frame's time: the screen buffer is
         * what the display shows */
        while (!quit && (long)(cy_clock() - next) < 0) poll(0);
        if (x == 0 && y == 0 && w == W && h == H) {
            u32 *d = (u32 *)scr, *e = d + SCREEN / 4, *f = (u32 *)frame;
            while (d < e) *d++ = *f++;
        } else blit(scr, x, y, w, h);
        cy_DisplayGraphics_show(gfx);
        next += period;
        poll(0);
    }
    if (snd == 3) classic_stop();
    else sound_close();
    library_release(mp3_dl);
    drop(pic);
}

long main(int argc, char **argv, char start)
{
    void **kvt;
    int i;
    if (!start) return 0;
    if (argc > 0 && argv[0])
        for (i = 0; i < (int)sizeof argv0 - 1 && argv[0][i]; i++) argv0[i] = argv[0][i];
    me = cy_cWinApp_ctor(proc_mem, "avi", 0x1000);
    /* as Cybiko's player: without it the desktop doesn't come back when
     * the clip ends */
    PROCESS_FLAGS(me) |= 4;
    kvt = PROCESS_VTABLE(me);
    for (i = 0; i < 20; i++) vtable[i] = kvt[i];
    vtable[7] = (void *)run;
    PROCESS_VTABLE(me) = vtable;
    cy_Thread_start(me, 0);
    return 0;
}

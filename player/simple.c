/* A free player for MXD clips (the MP3 cartridge's video clips), in place
 * of Cybiko's own main.e. It does what Cybiko's does, as worked out from
 * its code: it plays music.mp3 from its own archive through the
 * cartridge's sound library (sound.dl) and shows the frames of clip.pic,
 * one each frame period, until the frames run out. Unlike Cybiko's, Esc
 * stops it; controls.c is the same with pause, seek and volume. Like
 * Cybiko's, it needs the cartridge's software installed (sound.dl). The formats are in file-formats.md ("MXD clips").
 *
 * Built with the GNU H8 tools: see build.sh. */

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
void *cy_sound_system(void);

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
    sys = cy_sound_system();
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
    snd = sound_open();
    if (snd == 2) {
        say("The music codec is busy.", "Please try later");
        poll(3000);
        sound_close();
        drop(pic);
        return;
    }
    cy_SystemThread_pause(cy_current_thread, 200);
    next = cy_clock();
    if (snd) M0(out, OUT_START);
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
    sound_close();
    drop(pic);
}

long main(int argc, char **argv, char start)
{
    void **kvt;
    int i;
    (void)argc;
    (void)argv;
    if (!start) return 0;
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

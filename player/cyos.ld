/* The CyOS functions the clip player uses. A call of (or a reference to)
 * 0xf00000 + k * 0x10000 + N becomes an import of export N of library k
 * when player/mkmodule.py builds main.e: 0 the kernel, 1 CyWin.dl,
 * 2 sound.dl. Kernel numbers are the Cybiko SDK's (__cyos N) where it
 * has them; the others are named after what Cybiko's own clip player and
 * other applications do with them. */
_cy_current_thread = 0xf00000 + 124;
_cy_Process_get_display = 0xf00000 + 666;
_cy_Process_request_focus = 0xf00000 + 1034;
_cy_DisplayGraphics_show = 0xf00000 + 1163;
_cy_Queue_get_message = 0xf00000 + 687;
_cy_Queue_peek_message = 0xf00000 + 940;
_cy_Message_delete = 0xf00000 + 265;
_cy_Thread_start = 0xf00000 + 1175;
_cy_SystemThread_pause = 0xf00000 + 939;   /* (thread, ms) */
_cy_clock = 0xf00000 + 450;                /* time in the unit of clip.pic's frame period */
_cy_Archive_open_Ex = 0xf00000 + 917;      /* (archive, part name): an Input */
_cy_TGraph_set_color = 0xf00000 + 1108;
_cy_TGraph_fill_screen = 0xf00000 + 587;
_cy_Graphics_set_font = 0xf00000 + 1126;
_cy_Graphics_draw_text = 0xf00000 + 532;
_cy_cool_normal_font = 0xf00000 + 469;
_cy_mini_normal_font = 0xf00000 + 892;
_cy_strcmp = 0xf00000 + 1208;
/* CyWin.dl */
_cy_cWinApp_ctor = 0xf10000 + 324;         /* (app, name, stack size) */
/* sound.dl (the MP3 cartridge's sound library) */
_cy_sound_system = 0xf20000 + 0;           /* the sound system object */

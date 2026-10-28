/*
 * v5 (2026-10-24): TEST watch words. job[18] = address A, job[62] = address B (0 = the raw pad word at hook entry).
 *   Every recorded update (first 210) stores V32(A), V32(B) in pal_watch; copied to SC64 buffer 0x1970 at the end.
 * v4 (2026-10-24): tas.c keeps the agent's Start bit in the raw pad buffer after the game reads it (Snapper reads
 * the raw buffer later in the frame, so an agent Start never paused in v3); a Start seen in the raw buffer within 8
 * updates of an agent Start is ignored by the cancel check (it is the agent's own leftover). Nothing else changed.
 * SC64 punch-cancel agent v3 for the PAL Snapper Practice ROM (Test10 base), for native console lag tests.
 * v3 (Claude 2026-10-24) adds RAM writes for test fixtures:
 *   K_POKE: job[2] = n | (size<<16) (size 1/2/4 bytes, 0 = 4), job[3+2i] = address, job[4+2i] = value (n <= 29).
 *   K_CALL: job[2] = function address, job[3..6] = a0..a3; the return value comes back in result word 29.
 *   TEST timed pokes: job[52] = n (<= 3), job[53+3i] = VI since the action phase began, job[54+3i] = address,
 *     job[55+3i] = 32-bit value; written once each, in the controller hook, when that VI is reached (action, pre-B or
 *     run phase). With timed pokes, at most 16 segments (words 20..51).
 *
 * The PC writes a job into the SummerCart64 data buffer (PI 0x1FFE0000 / USB 0x05000000, 8 KiB):
 *   job words 0..63 at 0x000 (sequence word 63 written last), result words 0..63 at 0x100 (done word 63 last),
 *   trace at 0x200 (5 words per game update from the B update on).
 * Everything runs in the controller hook, once per game update. The PI is only touched while idle (one read
 * of the sequence word per update) and once when a test ends, never during a try.
 * Without an SC64 (emulator) the mailbox is pal_box[] in RDRAM, so a Lua harness can drive it.
 *
 * TEST: full native placement at the pre spot (x, floor y, z, yaw) as Practice does, settle, then the x/z of
 * the punch origin are written (4 position copies, same as the BizHawk DIAGNOSTIC placement), settle, written
 * again, 2 updates, then B / A / Z by real VI time since the B update (practice_vi_count, the viMgr hook).
 */
typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;
typedef int s32;
#define V8(a) (*(volatile u8 *)(a))
#define V32(a) (*(volatile u32 *)(a))
#define VF(a) (*(volatile float *)(a))

#define PAL_VERSION 6u
#define SC64_REG_IDENT  0xBFFF000Cu
#define SC64_REG_KEY    0xBFFF0010u
#define SC64_BUF        0xBFFE0000u
#define PI_STATUS       0xA4600010u

/* PAL RAM */
#define POS_X    0x8037cf70u
#define POS_Y    0x8037cf74u
#define POS_Z    0x8037cf78u
#define YAW      0x8037d060u
#define PSTATE   0x8037db34u
#define DT_VI    0x80384e64u
#define HITS     0x8037cc4du
#define CUR_MAP  0x80383fb4u
#define GS_MODE  0x8037f2b4u
#define ITEMS    0x80386910u

#define JOB_MAGIC 0x504C4A31u /* PLJ1 */
#define RES_MAGIC 0x504C5231u /* PLR1 */
enum { K_PING=0, K_ROOM=1, K_TEST=2, K_END=3, K_PEEK=4, K_POKE=5, K_CALL=6 };
enum { F_REFILL=1, F_MEASURE=2, F_EGGS=4, F_REPLACE=8, F_FORCE=16 };
enum { S_OK=1, S_TIMEOUT=2, S_CANCEL=3, S_BADJOB=4, S_BADSTATE=5 };
enum { P_OFF=0, P_IDLE, P_LOAD, P_SETTLE1, P_SETTLE2, P_ACT, P_PRE, P_RUN, P_DONE };

#define RES_OFF   0x100u
#define TRACE_OFF 0x200u
#define TRACE_UPD 300u
#define TW 5u

extern volatile u32 practice_vi_count;

volatile u32 pal_box[128];
volatile u32 pal_job[64];
volatile u32 pal_res[64];
volatile u32 pal_trace[TRACE_UPD*TW];
#define WATCH_OFF 0x1970u
#define WATCH_UPD 210u
volatile u32 pal_watch[WATCH_UPD*2];
static u32 cur_physical;

struct PalState {
    u32 present, session, phase, last_seq, polls, jobs, cancel, cancel_release;
    u32 updates, count, phase_vi, vi_b, last_vi, n, mask, ended, below, vi_act, n_b;
    u32 dtring[16], dtpos;
    u32 miny_key;
    u32 poked, pokes_done;
    u32 dt_patched, forced;     /* v6 */
};
volatile struct PalState pal;

/* ---- PI access, interrupts off while the PI is ours ---- */
static u32 int_off(void) {
    u32 s; __asm__ volatile("mfc0 %0,$12\n\tnop":"=r"(s)::"memory");
    __asm__ volatile("mtc0 %0,$12\n\tnop\n\tnop"::"r"(s&~1u):"memory");
    return s;
}
static void int_restore(u32 s) { __asm__ volatile("mtc0 %0,$12\n\tnop\n\tnop"::"r"(s):"memory"); }
static void pi_idle(void) { while(V32(PI_STATUS)&3) ; }
static u32 io_rd(u32 a) { u32 s=int_off(); pi_idle(); u32 v=V32(a); pi_idle(); int_restore(s); return v; }
static void io_wr(u32 a,u32 v) { u32 s=int_off(); pi_idle(); V32(a)=v; pi_idle(); int_restore(s); }
static void io_wr_block(u32 a,volatile u32 *src,u32 words) {
    while(words) {
        u32 n=words>32?32:words, s=int_off();
        for(u32 i=0;i<n;i++) { pi_idle(); V32(a)=src[i]; a+=4; }
        pi_idle(); int_restore(s); src+=n; words-=n;
    }
}
static void detect(void) {
    io_wr(SC64_REG_KEY,0x00000000u);
    io_wr(SC64_REG_KEY,0x5F554E4Cu);
    io_wr(SC64_REG_KEY,0x4F434B5Fu);
    pal.present = io_rd(SC64_REG_IDENT)==0x53437632u ? 1 : 2;
}
static u32 box_rd(u32 off) { return pal.present==1 ? io_rd(SC64_BUF+off) : pal_box[off>>2]; }

static u32 fkey(u32 b) { return (b&0x80000000u) ? ~b : (b|0x80000000u); }
static float fb(u32 b) { union { u32 u; float f; } x; x.u=b; return x.f; }
static u32 room_map=0x79;          /* v6: target room, set by K_ROOM job[4] (0 = 0x79) */
static int in_room(void) { return V32(GS_MODE)==3 && V32(CUR_MAP)==room_map; }

static void flag(u32 i,u32 v) { ((void(*)(u32,u32))0x803203f4)(i,v); }
static void item_set(u32 i,u32 v) { ((void(*)(u32,u32))0x80346864)(i,v); }
static void warp765(void) {
    /* v6: job[3] = entry (0 = 1), job[4] = map (0 = 0x79), job[5] = note-door open flag to clear (0 = 0x39 as before;
       note doors use FILEPROG_39 + door index, e.g. 0x3C = 260 door in map 0x71, 0x40 = 765) */
    room_map = pal_job[4] ? (pal_job[4]&0xff) : 0x79;
    flag(pal_job[5] ? pal_job[5] : 0x39, 0);
    if(room_map==0x79) { flag(0x53,1); flag(0x54,1); }   /* CCW puzzle switch as Practice leaves it */
    V8(0x8037f2c5)=(u8)room_map; V8(0x8037f2c6)=(u8)(pal_job[3]?pal_job[3]:1); V8(0x8037f2c7)=0; V8(0x8037f2c8)=0; V8(0x8037f2c4)=1;
}
static void refill(void) {
    u32 mx=V32(ITEMS+0x15*4);
    if(mx && V32(ITEMS+0x14*4)<mx) item_set(0x14,mx);
    if(V32(ITEMS+0x16*4)<10) item_set(0x16,10);
    if(pal_job[2]&F_EGGS) item_set(0x0d,100);
}
/* Native placement, same calls as Practice place(1) (standing state, rotation, velocities, position). */
static void place_full(u32 xb,u32 yb,u32 zb,u32 yawb) {
    float pos[3]={fb(xb),fb(yb),fb(zb)}, rot[3]={0,fb(yawb),0};
    u32 state=V32(PSTATE);
    if(state==0x98||state==0x9a) ((void(*)(void))0x802be798)();
    ((void(*)(u32))0x8029a56c)(1);
    ((void(*)(float*))0x8028f6c4)(rot);
    ((void(*)(float*))0x8029784c)(0);
    ((void(*)(float*))0x80297770)(0);
    ((void(*)(float))0x802977b0)(0);
    ((void(*)(float))0x802977e0)(0);
    ((void(*)(float*))0x8028f67c)(pos);
    VF(0x8037cec4)=fb(yawb);
}
/* DIAGNOSTIC x/z write (4 copies) + yaw, like the BizHawk scans. */
static void place_xz(u32 xb,u32 zb,u32 yawb) {
    static const u32 c[4]={0x8037cf70u,0x8037cf80u,0x8037cbf8u,0x8037cbe8u};
    for(u32 i=0;i<4;i++) { V32(c[i])=xb; V32(c[i]+8)=zb; }
    V32(0x8037d060u)=yawb; V32(0x8037d064u)=yawb;
}

static void res_clear(void) { for(int i=0;i<64;i++) pal_res[i]=0; }
static void finish(u32 status) {
    pal.mask=0;
    pal_res[0]=RES_MAGIC; pal_res[1]=pal_job[63]; pal_res[2]=status; pal_res[3]=PAL_VERSION;
    pal_res[4]=V32(CUR_MAP); pal_res[5]=V32(GS_MODE); pal_res[6]=V32(PSTATE);
    pal_res[7]=V32(POS_X); pal_res[8]=V32(POS_Y); pal_res[9]=V32(POS_Z);
    pal_res[15]=V32(ITEMS+0x14*4); pal_res[16]=pal.updates; pal_res[17]=pal.polls; pal_res[18]=pal.jobs;
    pal_res[19]=practice_vi_count; pal_res[20]=pal.present;
    u32 nt=pal.n>TRACE_UPD?TRACE_UPD:pal.n;
    if(pal.present==1) {
        if(pal_job[1]==K_TEST && nt) io_wr_block(SC64_BUF+TRACE_OFF,pal_trace,nt*TW);
        if(pal_job[1]==K_TEST && nt && pal_job[18]) io_wr_block(SC64_BUF+WATCH_OFF,pal_watch,(nt<WATCH_UPD?nt:WATCH_UPD)*2);
        if(pal_job[1]==K_PEEK) {
            u32 a=pal_job[3], w=pal_job[4]>1024?1024:pal_job[4];
            io_wr_block(SC64_BUF+TRACE_OFF,(volatile u32 *)a,w);
        }
        io_wr_block(SC64_BUF+RES_OFF,pal_res,63);
        io_wr(SC64_BUF+RES_OFF+63*4,pal_job[63]);
    } else {
        if(pal_job[1]==K_PEEK) { u32 a=pal_job[3], w=pal_job[4]>TRACE_UPD*TW?TRACE_UPD*TW:pal_job[4]; for(u32 i=0;i<w;i++) pal_trace[i]=((volatile u32*)a)[i]; }
        for(int i=0;i<63;i++) pal_box[64+i]=pal_res[i];
        pal_box[127]=pal_job[63];
    }
    pal.phase = pal.session ? P_IDLE : P_OFF;
}


/* v6 F_FORCE (DIAGNOSTIC forced lag): time_setDeltaReal_frames (PAL 0x8033E154, US 0x8033DD04) is replaced by
   pal_setframes. In a TEST with F_FORCE, the first frame that starts at least job[53] VI after the B update gets
   job[54] frames (default 3 = the 0.06 s cap) instead of the console's own count, once. Otherwise identical to the
   game's function: frames clamped 1..15, seconds = frames * (1/50) capped at 0.06 (PAL). (The v3 timed pokes of
   0x80384E60/64 were overwritten by this function at the next frame start and never changed a step.) */
void pal_setframes(s32 f) {
    if((pal_job[2]&F_FORCE) && pal_job[1]==K_TEST && pal.phase==P_RUN && !pal.forced && practice_vi_count-pal.vi_b>=pal_job[53]) {
        f=(s32)(pal_job[54]?pal_job[54]:3); pal.forced=practice_vi_count-pal.vi_b; pal_res[30]=pal.forced;
    }
    if(f>15) f=15; if(f<1) f=1;
    V32(0x80384E64u)=(u32)f;
    V32(0x80384E60u)= f==1 ? 0x3CA3D70Au : f==2 ? 0x3D23D70Au : 0x3D75C28Fu;   /* 0.02, 0.04, 0.06 (cap) as f32 bits */
}
static void dt_patch(void) {
    if(pal.dt_patched) return;
    if(V32(0x8033E154u)!=0x27BDFFE8u) return;               /* not the expected PAL code: leave the game alone */
    u32 s0=int_off();
    V32(0x8033E154u)=0x08000000u|(((u32)pal_setframes>>2)&0x3FFFFFFu); V32(0x8033E158u)=0;
    for(u32 a=0x8033E140u;a<0x8033E180u;a+=16) __asm__ volatile(".set push\n\t.set mips3\n\tcache 0x10,0(%0)\n\t.set pop"::"r"(a));
    int_restore(s0);
    pal.dt_patched=1;
}
static void start_job(void) {
    u32 kind=pal_job[1];
    pal.jobs++; res_clear(); pal.n=0;
    if(pal_job[0]!=JOB_MAGIC || kind>K_CALL) { finish(S_BADJOB); return; }
    if(kind==K_PING || kind==K_PEEK) { finish(S_OK); return; }
    if(kind==K_POKE) {
        u32 n=pal_job[2]&0xffff, sz=(pal_job[2]>>16)&0xff; if(n>29) n=29;
        for(u32 i=0;i<n;i++) {
            u32 a=pal_job[3+2*i], v=pal_job[4+2*i];
            if(a<0x80000000u || a>=0x80800000u) continue;
            if(sz==1) V8(a)=(u8)v; else if(sz==2) *(volatile u16 *)(a&~1u)=(u16)v; else V32(a&~3u)=v;
        }
        pal.pokes_done+=n; finish(S_OK); return;
    }
    if(kind==K_CALL) {
        u32 f=pal_job[2];
        if(f>=0x80000400u && f<0x80800000u && !(f&3)) pal_res[29]=((u32(*)(u32,u32,u32,u32))f)(pal_job[3],pal_job[4],pal_job[5],pal_job[6]);
        finish(S_OK); return;
    }
    if(kind==K_END) { pal.session=0; finish(S_OK); return; }
    pal.session=1;
    if(V32(GS_MODE)!=3) { finish(S_BADSTATE); return; }
    if(kind==K_ROOM) { warp765(); pal.phase=P_LOAD; pal.phase_vi=practice_vi_count; return; }
    /* TEST */
    if(pal_job[2]&F_FORCE) dt_patch();
    pal.forced=0; pal_res[30]=0;
    if(!in_room()) { finish(S_BADSTATE); return; }
    if(pal_job[2]&F_REFILL) refill();
    place_full(pal_job[3],pal_job[5],pal_job[4],pal_job[6]);
    pal.poked=0;
    pal.count=0; pal.phase=P_SETTLE1; pal.mask=0; pal.ended=0; pal.below=0; pal.miny_key=0xffffffffu;
}

static void record(u32 vi_now,u32 dvi) {
    if(pal.n>=TRACE_UPD) return;
    volatile u32 *t=&pal_trace[pal.n*TW];
    t[0]=V32(POS_X); t[1]=V32(POS_Y); t[2]=V32(POS_Z);
    t[3]=((V32(DT_VI)&0xff)<<24)|((V32(PSTATE)&0xff)<<16)|((V8(HITS)&0xff)<<8)|((dvi&0xf)<<4)|
         ((pal.mask&0x40000000u)?1:0)|((pal.mask&0x80000000u)?2:0)|((pal.mask&0x20000000u)?4:0);
    t[4]=vi_now-pal.vi_act;
    if(pal_job[18] && pal.n<WATCH_UPD) {
        u32 a=pal_job[18], b=pal_job[62];
        pal_watch[2*pal.n]=(a>=0x80000000u && a<0x80800000u) ? V32(a&~3u) : 0;
        pal_watch[2*pal.n+1]=(b>=0x80000000u && b<0x80800000u) ? V32(b&~3u) : cur_physical;
    }
    pal.n++;
}

/* job[19] segments (max 16) at job[20+2i]: (start<<16)|len in VI since the action phase began, job[21+2i] = pad word */
static u32 segmask(u32 v) {
    u32 m=0, n=pal_job[19]>16?16:pal_job[19];
    for(u32 i=0;i<n;i++) { u32 a=pal_job[20+2*i], st=a>>16, ln=a&0xffff; if(v>=st && v<st+ln) m|=pal_job[21+2*i]; }
    return m;
}

/* Controller hook: once per game update, before the game reads the pad. Returns 1 when the session owns input. */
static u32 start_quiet;   /* v4: updates after an agent Start during which a Start in the raw buffer is our own leftover */
int pal_joy(u32 physical,u32 *pad) {
    u32 vi=practice_vi_count, dvi=vi-pal.last_vi; pal.last_vi=vi;
    cur_physical=physical;
    if(start_quiet) start_quiet--;
    pal.updates++;
    pal.dtring[pal.dtpos++&15]=dvi;
    if(!pal.present) { detect(); pal.last_seq=box_rd(63*4); }
    if(pal.cancel_release) {
        if((physical>>16)&0x1000) { *pad=0; return 1; }
        pal.cancel_release=0;
    }
    if(pal.session && ((physical>>16)&0x1000) && !start_quiet) {   /* Start on the controller cancels (not our own leftover) */
        u32 ph=pal.phase; pal.session=0; pal.cancel_release=1; pal.mask=0;
        if(ph>=P_LOAD && ph<=P_DONE) finish(S_CANCEL); else pal.phase=P_OFF;
        *pad=0; return 1;
    }
    switch(pal.phase) {
    case P_OFF: case P_IDLE: {
        pal.polls++;
        u32 seq=box_rd(63*4);
        if(seq!=pal.last_seq) {
            pal.last_seq=seq;
            for(u32 i=0;i<63;i++) pal_job[i]=box_rd(i*4);
            pal_job[63]=seq;
            start_job();
        }
        break; }
    case P_LOAD:
        if(in_room() && vi-pal.phase_vi>=120) { pal_res[21]=vi-pal.phase_vi; finish(S_OK); }
        else if(vi-pal.phase_vi>3000) finish(S_TIMEOUT);
        break;
    case P_SETTLE1:
        if(++pal.count>=pal_job[9]) {
            if(!(pal_job[2]&F_MEASURE)) place_xz(pal_job[7],pal_job[8],pal_job[6]);
            pal.count=0; pal.phase=P_SETTLE2;
        }
        break;
    case P_SETTLE2:
        if(++pal.count>=pal_job[10]) {
            if(!(pal_job[2]&F_MEASURE)) place_xz(pal_job[7],pal_job[8],pal_job[6]);
            else V32(0x8037d060u)=V32(0x8037d064u)=pal_job[6];
            pal.count=0; pal.n=0; pal.vi_act=vi; pal.n_b=0;
            pal.phase = pal_job[17] ? P_ACT : P_PRE;
        }
        break;
    case P_ACT:
        if(vi-pal.vi_act>=pal_job[17]) {
            if((pal_job[2]&F_REPLACE) && !(pal_job[2]&F_MEASURE)) place_xz(pal_job[7],pal_job[8],pal_job[6]);
            pal.count=0; pal.phase=P_PRE;
        }
        break;
    case P_PRE:
        if(++pal.count>=2) {
            pal.phase=P_RUN; pal.vi_b=vi; pal.n_b=pal.n;
            pal_res[27]=vi-pal.vi_act; pal_res[28]=pal.n;
            pal_res[10]=V32(POS_X); pal_res[11]=V32(POS_Z); pal_res[12]=V32(YAW);
            pal_res[13]=0; pal_res[14]=0;
            for(u32 i=0;i<16;i++) { u32 d=pal.dtring[(pal.dtpos+i)&15]&0xf; if(i<8) pal_res[13]|=d<<(i*4); else pal_res[14]|=d<<((i-8)*4); }
            pal_res[22]=V32(DT_VI); pal_res[23]=V32(PSTATE);
        }
        break;
    case P_RUN: break;
    case P_DONE: finish(S_OK); break;
    }
    if(pal.phase==P_ACT || pal.phase==P_PRE) {
        pal.mask=segmask(vi-pal.vi_act);
        record(vi,dvi);
    }
    if(pal.phase==P_RUN) {
        u32 v=vi-pal.vi_b, m=segmask(vi-pal.vi_act);
        if(v<pal_job[11]) m|=0x40000000u;                                         /* B */
        if(v>=pal_job[12] && v<pal_job[12]+pal_job[13]) m|=0x80000000u;          /* A */
        if(pal_job[14] && v>=pal_job[14] && v<pal_job[14]+pal_job[15]) m|=0x20000000u;  /* Z */
        pal.mask=m;
        record(vi,dvi);
        u32 k=fkey(V32(POS_Y)); if(k<pal.miny_key) pal.miny_key=k;
        float y=fb(V32(POS_Y)), fy=fb(pal_job[5]);
        if(y<fy-300.0f) pal.below++;
        u32 runmax=pal_job[16]?pal_job[16]:140;
        if(pal.below>=10 || v>=runmax) {
            u32 mk=pal.miny_key; pal_res[24]=(mk&0x80000000u)?(mk&0x7fffffffu):~mk;
            pal_res[25]=pal.n; pal_res[26]=pal.below>=10;
            pal.mask=0; pal.phase=P_DONE;
        }
    }
    if(pal_job[1]==K_TEST && (pal.phase==P_ACT || pal.phase==P_PRE || pal.phase==P_RUN)) {
        u32 np=pal_job[52]>3?3:pal_job[52], v=vi-pal.vi_act;
        for(u32 i=0;i<np;i++) {
            u32 a=pal_job[54+3*i];
            if(!(pal.poked&(1u<<i)) && v>=pal_job[53+3*i] && a>=0x80000000u && a<0x80800000u) { V32(a&~3u)=pal_job[55+3*i]; pal.poked|=1u<<i; pal.pokes_done++; }
        }
    }
    if(pal.mask&0x10000000u) start_quiet=8;
    if(!pal.session && pal.phase!=P_RUN) return 0;
    *pad=pal.mask;
    return 1;
}

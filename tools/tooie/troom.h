// Claude 2026-11-11: load a tcol room (mkroom.py text) on the host
#include <stdio.h>
#include <stdlib.h>
static TModel *load_model(FILE *f) {
  char w[16]; if (fscanf(f, "%15s", w) != 1) return 0; if (!strcmp(w, "NOMODEL")) return 0;
  TModel *M = (TModel *)calloc(1, sizeof(TModel)); int gn; if (fscanf(f, "%d %d %d %d", &M->nv, &M->nt, &M->ncell, &gn) != 4) exit(3); M->gn = (float)(unsigned short)gn;
  for (int i = 0; i < 11; i++) { int x; if (fscanf(f, "%d", &x) != 1) exit(3); M->h[i] = (short)x; }
  short *V = (short *)malloc(6 * M->nv + 6); unsigned short *T = (unsigned short *)malloc(6 * M->nt + 6); unsigned *TF = (unsigned *)malloc(4 * M->nt + 4); unsigned short *C = (unsigned short *)malloc(4 * M->ncell + 4);
  for (int i = 0; i < 3 * M->nv; i++) { int x; if (fscanf(f, "%d", &x) != 1) exit(3); V[i] = (short)x; }
  for (int i = 0; i < M->nt; i++) { int a, b, c; unsigned fl; if (fscanf(f, "%d %d %d %u", &a, &b, &c, &fl) != 4) exit(3); T[3 * i] = a; T[3 * i + 1] = b; T[3 * i + 2] = c; TF[i] = fl; }
  for (int i = 0; i < 2 * M->ncell; i++) { int x; if (fscanf(f, "%d", &x) != 1) exit(3); C[i] = (unsigned short)x; }
  short *BB = (short *)malloc(12 * M->nt + 12);
  for (int i = 0; i < M->nt; i++) for (int c = 0; c < 3; c++) { short lo = V[3 * T[3 * i] + c], hi = lo;
      for (int j = 1; j < 3; j++) { short q = V[3 * T[3 * i + j] + c]; if (q < lo) lo = q; if (hi < q) hi = q; } BB[6 * i + 2 * c] = lo; BB[6 * i + 2 * c + 1] = hi; }
  float *TV = (float *)malloc(36 * (size_t)M->nt + 36);   // corners as floats (see triverts)
  for (int i = 0; i < M->nt; i++) for (int j = 0; j < 3; j++) for (int c = 0; c < 3; c++) TV[9 * i + 3 * j + c] = (float)V[3 * T[3 * i + j] + c];
  TF4 *TB = (TF4 *)malloc(32 * (size_t)M->nt + 32), *TV4 = (TF4 *)malloc(48 * (size_t)M->nt + 48);   // see tcol.h
  for (int i = 0; i < M->nt; i++) { float fl; memcpy(&fl, &TF[i], 4); TB[2 * i].x = BB[6 * i]; TB[2 * i].y = BB[6 * i + 1]; TB[2 * i].z = BB[6 * i + 2]; TB[2 * i].w = BB[6 * i + 3];
    TB[2 * i + 1].x = BB[6 * i + 4]; TB[2 * i + 1].y = BB[6 * i + 5]; TB[2 * i + 1].z = fl; TB[2 * i + 1].w = 0.0f;
    const float *q = TV + 9 * i; TV4[3 * i].x = q[0]; TV4[3 * i].y = q[1]; TV4[3 * i].z = q[2]; TV4[3 * i].w = q[3]; TV4[3 * i + 1].x = q[4]; TV4[3 * i + 1].y = q[5];
    TV4[3 * i + 1].z = q[6]; TV4[3 * i + 1].w = q[7]; TV4[3 * i + 2].x = q[8]; TV4[3 * i + 2].y = 0.0f; TV4[3 * i + 2].z = 0.0f; TV4[3 * i + 2].w = 0.0f; }
  M->V = V; M->T = T; M->TF = TF; M->C = C; M->BB = BB; M->TV = TV; M->TB = TB; M->TV4 = TV4;
  for (int lv = 0; lv < 2; lv++) { M->boff[lv] = 0; M->bseg[lv] = 0; M->bk[lv] = 0; }
  // finer index (tcol.h FOR_QUERY_TRIS): per level, bins [ix*S, ix*S+B] x [iz*S, iz*S+B]; entries in cell order, then the cell's order
  if (M->h[9] != 0 && M->nt > 0 && !getenv("TC_NOBINS")) {
    int nx = (unsigned short)M->h[6], nxy = (unsigned short)M->h[7], nz = nxy ? M->ncell / nxy : 0, ny = nx ? nxy / nx : 0;
    // an occurrence of a triangle in cell (cx, cz) is listed only where its box meets that cell (+-1): a query (inside the grid, see
    // bin_find) whose cell range has that cell overlaps the closed cell, so by 1-D Helly it meets box, cell and bin together
    int s = M->h[9], mnx = M->h[0] * s, mxx = (M->h[3] + 1) * s, mnz = M->h[2] * s, mxz = (M->h[5] + 1) * s;
    for (int lv = 0; lv < 2; lv++) { int S = lv ? 64 : 32, Bw = lv ? 192 : 64;
      #define FDIV(a, b) ((a) >= 0 ? (a) / (b) : -((-(a) + (b) - 1) / (b)))   /* floor division */
      int ix0 = FDIV(mnx - Bw, S), ix1 = FDIV(mxx, S), iz0 = FDIV(mnz - Bw, S), iz1 = FDIV(mxz, S); int bnx = ix1 - ix0 + 1, bnz = iz1 - iz0 + 1; long nb = (long)bnx * bnz;
      // pass 1: count entries per bin; pass 2: fill (cell order, then the cell's order), then cut each bin's list into cell segments
      int *off = (int *)calloc(nb + 1, sizeof(int)); long tot = 0; int *kk = 0; int *cc = 0;
      for (int pass = 0; pass < 2; pass++) {
        int *fill = 0;
        if (pass) { kk = (int *)malloc(sizeof(int) * (tot + 1)); cc = (int *)malloc(sizeof(int) * (tot + 1)); fill = (int *)malloc(sizeof(int) * (nb + 1));
          long acc = 0; for (long q = 0; q < nb; q++) { long c = off[q]; off[q] = (int)acc; fill[q] = (int)acc; acc += c; } off[nb] = (int)acc; }
        for (int cz = 0; cz < nz; cz++) for (int cy = 0; cy < ny; cy++) for (int cx = 0; cx < nx; cx++) { int ci = cz * nxy + cy * nx + cx; int st = C[2 * ci], cn = C[2 * ci + 1];
          int rx0 = (cx + M->h[0]) * s - 1, rx1 = (cx + M->h[0] + 1) * s + 1, rz0 = (cz + M->h[2]) * s - 1, rz1 = (cz + M->h[2] + 1) * s + 1;
          for (int k = st; k < st + cn; k++) { int bx0 = BB[6 * k], bx1 = BB[6 * k + 1], bz0 = BB[6 * k + 4], bz1 = BB[6 * k + 5];
            if (bx0 < rx0) bx0 = rx0; if (bx1 > rx1) bx1 = rx1; if (bz0 < rz0) bz0 = rz0; if (bz1 > rz1) bz1 = rz1; if (bx0 > bx1 || bz0 > bz1) continue;
            int ja = -FDIV(-(bx0 - Bw), S), jb = FDIV(bx1, S), ka = -FDIV(-(bz0 - Bw), S), kb = FDIV(bz1, S);   // ceil((b0 - B) / S) .. floor(b1 / S)
            for (int ix = ja; ix <= jb; ix++) for (int iz = ka; iz <= kb; iz++) { long q = (long)(ix - ix0) * bnz + (iz - iz0);
              if (!pass) { off[q]++; tot++; } else { kk[fill[q]] = k; cc[fill[q]] = cx | (cy << 8) | (cz << 16); fill[q]++; } } } }
        if (pass) free(fill); }
      int *soff = (int *)calloc(nb + 1, sizeof(int)); long nseg = 0;
      for (long q = 0; q < nb; q++) { soff[q] = (int)nseg; for (int e = off[q]; e < off[q + 1]; e++) if (e == off[q] || cc[e] != cc[e - 1]) nseg++; } soff[nb] = (int)nseg;
      TBS *seg = (TBS *)malloc(sizeof(TBS) * (nseg + 1)); long g = 0;
      for (long q = 0; q < nb; q++) for (int e = off[q]; e < off[q + 1]; e++) { if (e == off[q] || cc[e] != cc[e - 1]) { seg[g].c = cc[e]; seg[g].st = e; seg[g].n = 0; seg[g].pad = 0; g++; } seg[g - 1].n++; }
      free(cc); free(off); M->bseg[lv] = seg; M->bk[lv] = kk; off = soff; M->bnseg[lv] = nseg; M->bnent[lv] = tot;
      M->boff[lv] = off; M->bix0[lv] = ix0; M->biz0[lv] = iz0; M->bnx[lv] = bnx; M->bnz[lv] = bnz; M->bgx0 = (float)mnx; M->bgx1 = (float)mxx; M->bgz0 = (float)mnz; M->bgz1 = (float)mxz;
      if (getenv("TC_BINLOG")) fprintf(stderr, "finer index level %d: %d x %d bins, %ld entries, %ld cell segments\n", lv, bnx, bnz, tot, nseg); } }
  return M; }
static void load_world(const char *fn, TWorld *w) { FILE *f = fopen(fn, "r"); if (!f) { fprintf(stderr, "no room %s\n", fn); exit(2); } w->m[0] = load_model(f); w->m[1] = load_model(f); fclose(f); }

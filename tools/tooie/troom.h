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
  M->V = V; M->T = T; M->TF = TF; M->C = C; return M; }
static void load_world(const char *fn, TWorld *w) { FILE *f = fopen(fn, "r"); if (!f) { fprintf(stderr, "no room %s\n", fn); exit(2); } w->m[0] = load_model(f); w->m[1] = load_model(f); fclose(f); }

/* Claude 2026-11-11: freestanding math for the WebAssembly build (each maps to one IEEE instruction: f32.sqrt, f32.floor, ...) */
#pragma once
static inline float sqrtf(float x) { return __builtin_sqrtf(x); }
static inline float floorf(float x) { return __builtin_floorf(x); }
static inline float fabsf(float x) { return __builtin_fabsf(x); }
static inline double sqrt(double x) { return __builtin_sqrt(x); }
static inline double floor(double x) { return __builtin_floor(x); }
static inline double fabs(double x) { return __builtin_fabs(x); }
static inline double fmin(double a, double b) { return a < b ? a : b; }
static inline double fmax(double a, double b) { return a > b ? a : b; }
/* fmaf for the Xbox 360 build (-DTX360): wasm has no scalar fused multiply-add, so a*b+c is formed in double and corrected when the
   double result is an inexact exact-halfway case between two floats (the musl algorithm): the result is the correctly rounded fmaf. */
static inline float fmaf(float x, float y, float z) {
  double xy = (double)x * y, result = xy + z; union { double f; unsigned long long i; } u; u.f = result; int e = (int)(u.i >> 52 & 0x7ff);
  if ((u.i & 0x1fffffff) != 0x10000000 || e == 0x7ff || (result - xy == z && result - z == xy)) return (float)result;
  double err; int neg = (int)(u.i >> 63);
  if (neg == (z > xy)) err = xy - result + z; else err = z - result + xy;
  if (neg == (err < 0)) u.i++; else u.i--;
  return (float)u.f; }

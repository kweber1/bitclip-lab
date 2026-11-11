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

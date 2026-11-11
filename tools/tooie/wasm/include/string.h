/* Claude 2026-11-11: freestanding memcpy / memset for the WebAssembly build */
#pragma once
typedef __SIZE_TYPE__ size_t;
extern "C" void *memcpy(void *d, const void *s, size_t n);
extern "C" void *memset(void *d, int c, size_t n);

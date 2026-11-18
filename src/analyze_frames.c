#define _POSIX_C_SOURCE 199309L
#include <stdio.h>
#include <stdlib.h>
#include <math.h>

// Reads a sequence of raw RGBA F32 frame dumps and reports per-frame mean
// luminance plus the largest frame-to-frame jump. A sudden "flip bright"
// when crossing the beam would show as a large discontinuity here.
int main(int argc, char** argv) {
    if (argc < 4) {
        fprintf(stderr, "usage: %s prefix count pixels\n", argv[0]);
        return 1;
    }
    const char* prefix = argv[1];
    int count = atoi(argv[2]);
    int pixels = atoi(argv[3]);
    float* buf = malloc(sizeof(float) * 4 * pixels);
    double prev = -1, maxJump = 0;
    printf("frame meanLum\n");
    for (int f = 0; f < count; f++) {
        char path[400];
        snprintf(path, sizeof path, "%s_%03d.png.f32.bin", prefix, f);
        FILE* fp = fopen(path, "rb");
        if (!fp) { snprintf(path, sizeof path, "%s_%03d.f32.bin", prefix, f); fp = fopen(path, "rb"); }
        if (!fp) { fprintf(stderr, "missing frame %d\n", f); return 1; }
        size_t got = fread(buf, 4, 4 * pixels, fp);
        if (got != (size_t)(4 * pixels)) { fprintf(stderr, "short frame %d\n", f); return 1; }
        fclose(fp);
        double lum = 0;
        for (int i = 0; i < pixels; i++)
            lum += 0.2126 * buf[i*4] + 0.7152 * buf[i*4+1] + 0.0722 * buf[i*4+2];
        lum /= pixels;
        double jump = prev < 0 ? 0 : fabs(lum - prev);
        if (jump > maxJump) maxJump = jump;
        printf("%5d %.6f jump=%.6f\n", f, lum, jump);
        prev = lum;
    }
    printf("MAX_FRAME_JUMP=%.6f\n", maxJump);
    free(buf);
    return 0;
}

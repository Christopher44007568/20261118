#define _POSIX_C_SOURCE 199309L
#include "vk_engine.h"
#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "../third_party/stb_image_write.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// Loads two rendered float dumps (saved as raw RGBA F32) and reports
// RMS / max / mean absolute error. The host app writes these via --dump-f32.
static float* load_f32(const char* path, int expectPixels) {
    FILE* f = fopen(path, "rb");
    if (!f) { fprintf(stderr, "missing %s\n", path); exit(1); }
    float* buf = malloc(sizeof(float) * 4 * expectPixels);
    size_t got = fread(buf, 4, 4 * expectPixels, f);
    if ((int)got != 4 * expectPixels) { fprintf(stderr, "short read %s\n", path); exit(1); }
    fclose(f);
    return buf;
}

int main(int argc, char** argv) {
    if (argc < 4) {
        fprintf(stderr, "usage: %s ref.bin test.bin pixelCount [label]\n", argv[0]);
        return 1;
    }
    int n = atoi(argv[3]);
    float* a = load_f32(argv[1], n);
    float* b = load_f32(argv[2], n);
    double se = 0, sae = 0, maxe = 0;
    for (int i = 0; i < n * 3; i++) {
        double d = (double)a[i] - (double)b[i];
        se += d * d; sae += fabs(d);
        if (fabs(d) > maxe) maxe = fabs(d);
    }
    double rms = sqrt(se / (n * 3));
    double mae = sae / (n * 3);
    // PSNR against the [0,1] range of the tonemapped output.
    double psnr = rms > 1e-9 ? 10.0 * log10(1.0 / (se / (n * 3))) : 99.0;
    printf("%sRMS=%.6f MAE=%.6f MAX=%.6f PSNR=%.2fdB\n",
           argc > 4 ? argv[4] : "", rms, mae, maxe, psnr);
    free(a); free(b);
    return 0;
}

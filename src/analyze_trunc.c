#define _POSIX_C_SOURCE 199309L
#include <stdio.h>
#include <stdlib.h>
#include <math.h>

// Compares mean in-scatter of two screen-space rectangular regions given as
// x0 y0 x1 y1 (normalized 0..1). A natural rock truncation must darken the
// occluded region relative to the free-space beam.
int main(int argc, char** argv) {
    if (argc < 4) {
        fprintf(stderr, "usage: %s frame.f32.bin W H\n", argv[0]);
        return 1;
    }
    int W = atoi(argv[2]), H = atoi(argv[3]);
    FILE* fp = fopen(argv[1], "rb");
    if (!fp) { perror("open"); return 1; }
    float* buf = malloc(sizeof(float) * 4 * W * H);
    if (fread(buf, 4, 4 * W * H, fp) != (size_t)(4 * W * H)) { fprintf(stderr, "short\n"); return 1; }
    fclose(fp);

    // Free-space beam core (upper-center, above the rock line) vs right-side
    // region where the rock cluster cuts into the cone.
    struct { const char* name; float x0, y0, x1, y1; } regions[] = {
        {"beam-core-free ", 0.46f, 0.30f, 0.54f, 0.45f},
        {"rock-occluded  ", 0.60f, 0.40f, 0.78f, 0.58f},
        {"outside-cone    ", 0.08f, 0.30f, 0.20f, 0.50f},
    };
    for (int r = 0; r < 3; r++) {
        int xa = regions[r].x0 * W, xb = regions[r].x1 * W;
        int ya = regions[r].y0 * H, yb = regions[r].y1 * H;
        double sum = 0; long cnt = 0;
        for (int y = ya; y < yb; y++)
            for (int x = xa; x < xb; x++) {
                int i = (y * W + x) * 4;
                sum += 0.2126*buf[i] + 0.7152*buf[i+1] + 0.0722*buf[i+2];
                cnt++;
            }
        printf("%s meanLum=%.5f\n", regions[r].name, sum / cnt);
    }
    free(buf);
    return 0;
}

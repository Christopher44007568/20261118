#ifndef SHADER_UTIL_H
#define SHADER_UTIL_H

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// GLSL ES has no #include. This loader inlines any line of the form
//   #include "sss_common.glsl"
// using files found next to the shader directory. Shaders stay identical
// between the native harness and the WebGL2 viewer.
static char *load_text_file(const char *path) {
    FILE *f = fopen(path, "rb");
    if (!f) {
        fprintf(stderr, "cannot open %s\n", path);
        return NULL;
    }
    fseek(f, 0, SEEK_END);
    long len = ftell(f);
    fseek(f, 0, SEEK_SET);
    char *buf = (char *)malloc((size_t)len + 1);
    size_t rd = fread(buf, 1, (size_t)len, f);
    buf[rd] = '\0';
    fclose(f);
    return buf;
}

static char *resolve_includes(const char *src, const char *shaderDir) {
    size_t cap = strlen(src) + 1;
    char *out = (char *)malloc(cap);
    out[0] = '\0';

    char *dup = strdup(src);
    char *save = NULL;
    char *line = strtok_r(dup, "\n", &save);
    while (line) {
        const char *inc = strstr(line, "#include");
        if (inc) {
            const char *q1 = strchr(inc, '"');
            const char *q2 = q1 ? strchr(q1 + 1, '"') : NULL;
            if (q1 && q2) {
                size_t nlen = (size_t)(q2 - q1 - 1);
                char path[512];
                snprintf(path, sizeof(path), "%s/%.*s", shaderDir,
                         (int)nlen, q1 + 1);
                char *incSrc = load_text_file(path);
                if (incSrc) {
                    size_t need = strlen(out) + strlen(incSrc) + 2;
                    if (need > cap) {
                        cap = need * 2;
                        out = (char *)realloc(out, cap);
                    }
                    strcat(out, incSrc);
                    strcat(out, "\n");
                    free(incSrc);
                }
            }
        } else {
            size_t need = strlen(out) + strlen(line) + 2;
            if (need > cap) {
                cap = need * 2;
                out = (char *)realloc(out, cap);
            }
            strcat(out, line);
            strcat(out, "\n");
        }
        line = strtok_r(NULL, "\n", &save);
    }
    free(dup);
    return out;
}

static char *load_shader(const char *path, const char *shaderDir) {
    char *raw = load_text_file(path);
    if (!raw) return NULL;
    char *resolved = resolve_includes(raw, shaderDir);
    free(raw);
    return resolved;
}

#endif

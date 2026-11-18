#ifndef EGL_APP_H
#define EGL_APP_H

#include <EGL/egl.h>
#include <GLES3/gl3.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    EGLDisplay dpy;
    EGLConfig  config;
    EGLSurface surface;
    EGLContext context;
    int width;
    int height;
} EglApp;

static EglApp g_app;

static int egl_app_init(int width, int height) {
    g_app.width = width;
    g_app.height = height;
    g_app.dpy = eglGetDisplay(EGL_DEFAULT_DISPLAY);
    EGLint maj = 0, min = 0;
    if (!eglInitialize(g_app.dpy, &maj, &min)) {
        fprintf(stderr, "eglInitialize failed: 0x%x\n", eglGetError());
        return 0;
    }
    EGLint cfgAttribs[] = {
        EGL_SURFACE_TYPE, EGL_PBUFFER_BIT,
        EGL_RENDERABLE_TYPE, EGL_OPENGL_ES3_BIT,
        EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8,
        EGL_ALPHA_SIZE, 8,
        EGL_DEPTH_SIZE, 24,
        EGL_NONE
    };
    EGLint numConfigs = 0;
    if (!eglChooseConfig(g_app.dpy, cfgAttribs, &g_app.config, 1,
                         &numConfigs) || numConfigs < 1) {
        fprintf(stderr, "eglChooseConfig failed\n");
        return 0;
    }
    EGLint surfAttribs[] = {
        EGL_WIDTH, width, EGL_HEIGHT, height, EGL_NONE
    };
    g_app.surface = eglCreatePbufferSurface(g_app.dpy, g_app.config,
                                            surfAttribs);
    EGLint ctxAttribs[] = { EGL_CONTEXT_CLIENT_VERSION, 3, EGL_NONE };
    g_app.context = eglCreateContext(g_app.dpy, g_app.config,
                                     EGL_NO_CONTEXT, ctxAttribs);
    if (!eglMakeCurrent(g_app.dpy, g_app.surface, g_app.surface,
                        g_app.context)) {
        fprintf(stderr, "eglMakeCurrent failed: 0x%x\n", eglGetError());
        return 0;
    }
    fprintf(stderr, "[egl] %s | %dx%d\n", glGetString(GL_VERSION),
            width, height);
    return 1;
}

static GLuint compile_shader(GLenum type, const char *src) {
    GLuint shader = glCreateShader(type);
    glShaderSource(shader, 1, &src, NULL);
    glCompileShader(shader);
    GLint ok = 0;
    glGetShaderiv(shader, GL_COMPILE_STATUS, &ok);
    if (!ok) {
        char log[4096];
        glGetShaderInfoLog(shader, sizeof(log), NULL, log);
        fprintf(stderr, "Shader compile error (type 0x%x):\n%s\n",
                (unsigned)type, log);
        fprintf(stderr, "--- source ---\n%s\n------------\n", src);
        exit(2);
    }
    return shader;
}

static GLuint link_program(const char *vsSrc, const char *fsSrc) {
    GLuint vs = compile_shader(GL_VERTEX_SHADER, vsSrc);
    GLuint fs = compile_shader(GL_FRAGMENT_SHADER, fsSrc);
    GLuint prog = glCreateProgram();
    glAttachShader(prog, vs);
    glAttachShader(prog, fs);
    glLinkProgram(prog);
    GLint ok = 0;
    glGetProgramiv(prog, GL_LINK_STATUS, &ok);
    if (!ok) {
        char log[4096];
        glGetProgramInfoLog(prog, sizeof(log), NULL, log);
        fprintf(stderr, "Program link error:\n%s\n", log);
        exit(2);
    }
    glDeleteShader(vs);
    glDeleteShader(fs);
    return prog;
}

#endif

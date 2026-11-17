#include "gl_loader.h"
#include <GL/osmesa.h>
#include <cstdio>
#include <cstdlib>

namespace gl_loader {

#define DECL(t, name) t name = nullptr
DECL(PFNGLGENVERTEXARRAYSPROC, GenVertexArrays);
DECL(PFNGLBINDVERTEXARRAYPROC, BindVertexArray);
DECL(PFNGLDELETEVERTEXARRAYSPROC, DeleteVertexArrays);
DECL(PFNGLGENBUFFERSPROC, GenBuffers);
DECL(PFNGLBINDBUFFERPROC, BindBuffer);
DECL(PFNGLBUFFERDATAPROC, BufferData);
DECL(PFNGLBUFFERSUBDATAPROC, BufferSubData);
DECL(PFNGLDELETEBUFFERSPROC, DeleteBuffers);
DECL(PFNGLENABLEVERTEXATTRIBARRAYPROC, EnableVertexAttribArray);
DECL(PFNGLVERTEXATTRIBPOINTERPROC, VertexAttribPointer);
DECL(PFNGLVERTEXATTRIBDIVISORPROC, VertexAttribDivisor);
DECL(PFNGLDRAWARRAYSINSTANCEDPROC, DrawArraysInstanced);
DECL(PFNGLCREATESHADERPROC, CreateShader);
DECL(PFNGLSHADERSOURCEPROC, ShaderSource);
DECL(PFNGLCOMPILESHADERPROC, CompileShader);
DECL(PFNGLGETSHADERIVPROC, GetShaderiv);
DECL(PFNGLGETSHADERINFOLOGPROC, GetShaderInfoLog);
DECL(PFNGLCREATEPROGRAMPROC, CreateProgram);
DECL(PFNGLATTACHSHADERPROC, AttachShader);
DECL(PFNGLLINKPROGRAMPROC, LinkProgram);
DECL(PFNGLGETPROGRAMIVPROC, GetProgramiv);
DECL(PFNGLGETPROGRAMINFOLOGPROC, GetProgramInfoLog);
DECL(PFNGLUSEPROGRAMPROC, UseProgram);
DECL(PFNGLDELETESHADERPROC, DeleteShader);
DECL(PFNGLDELETEPROGRAMPROC, DeleteProgram);
DECL(PFNGLGETUNIFORMLOCATIONPROC, GetUniformLocation);
DECL(PFNGLUNIFORM1FPROC, Uniform1f);
DECL(PFNGLUNIFORM1IPROC, Uniform1i);
DECL(PFNGLUNIFORM3FPROC, Uniform3f);
DECL(PFNGLUNIFORM4FPROC, Uniform4f);
DECL(PFNGLUNIFORMMATRIX4FVPROC, UniformMatrix4fv);
DECL(PFNGLDEBUGMESSAGECALLBACKPROC, DebugMessageCallback);
#undef DECL

static void* resolve(const char* name) {
    void* p = (void*)OSMesaGetProcAddress(name);
    if (!p) {
        std::fprintf(stderr, "gl_loader: missing entry point %s\n", name);
        std::exit(2);
    }
    return p;
}

#define LOAD(name) name = (decltype(name))resolve("gl" #name)

void load() {
    LOAD(GenVertexArrays); LOAD(BindVertexArray); LOAD(DeleteVertexArrays);
    LOAD(GenBuffers); LOAD(BindBuffer); LOAD(BufferData); LOAD(BufferSubData);
    LOAD(DeleteBuffers);
    LOAD(EnableVertexAttribArray); LOAD(VertexAttribPointer);
    LOAD(VertexAttribDivisor); LOAD(DrawArraysInstanced);
    LOAD(CreateShader); LOAD(ShaderSource); LOAD(CompileShader);
    LOAD(GetShaderiv); LOAD(GetShaderInfoLog);
    LOAD(CreateProgram); LOAD(AttachShader); LOAD(LinkProgram);
    LOAD(GetProgramiv); LOAD(GetProgramInfoLog); LOAD(UseProgram);
    LOAD(DeleteShader); LOAD(DeleteProgram);
    LOAD(GetUniformLocation); LOAD(Uniform1f); LOAD(Uniform1i);
    LOAD(Uniform3f); LOAD(Uniform4f); LOAD(UniformMatrix4fv);
    LOAD(DebugMessageCallback);
}

} // namespace gl_loader

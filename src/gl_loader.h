#pragma once
#include <GL/gl.h>
#include <GL/glext.h>

// Resolve the GL 3.x/4.x entry points we use. Called once after a GL context
// is current. OSMesa provides OSMesaGetProcAddress; real platforms would swap
// in eglGetProcAddress/wglGetProcAddress/etc.
namespace gl_loader {

// --- raw function pointer declarations (subset of GL 4.5) ---
extern PFNGLGENVERTEXARRAYSPROC   GenVertexArrays;
extern PFNGLBINDVERTEXARRAYPROC   BindVertexArray;
extern PFNGLDELETEVERTEXARRAYSPROC DeleteVertexArrays;
extern PFNGLGENBUFFERSPROC        GenBuffers;
extern PFNGLBINDBUFFERPROC        BindBuffer;
extern PFNGLBUFFERDATAPROC        BufferData;
extern PFNGLBUFFERSUBDATAPROC     BufferSubData;
extern PFNGLDELETEBUFFERSPROC     DeleteBuffers;
extern PFNGLENABLEVERTEXATTRIBARRAYPROC EnableVertexAttribArray;
extern PFNGLVERTEXATTRIBPOINTERPROC VertexAttribPointer;
extern PFNGLVERTEXATTRIBDIVISORPROC VertexAttribDivisor;
extern PFNGLDRAWARRAYSINSTANCEDPROC DrawArraysInstanced;
extern PFNGLCREATESHADERPROC      CreateShader;
extern PFNGLSHADERSOURCEPROC      ShaderSource;
extern PFNGLCOMPILESHADERPROC     CompileShader;
extern PFNGLGETSHADERIVPROC       GetShaderiv;
extern PFNGLGETSHADERINFOLOGPROC  GetShaderInfoLog;
extern PFNGLCREATEPROGRAMPROC     CreateProgram;
extern PFNGLATTACHSHADERPROC      AttachShader;
extern PFNGLLINKPROGRAMPROC       LinkProgram;
extern PFNGLGETPROGRAMIVPROC      GetProgramiv;
extern PFNGLGETPROGRAMINFOLOGPROC GetProgramInfoLog;
extern PFNGLUSEPROGRAMPROC        UseProgram;
extern PFNGLDELETESHADERPROC      DeleteShader;
extern PFNGLDELETEPROGRAMPROC     DeleteProgram;
extern PFNGLGETUNIFORMLOCATIONPROC GetUniformLocation;
extern PFNGLUNIFORM1FPROC         Uniform1f;
extern PFNGLUNIFORM1IPROC         Uniform1i;
extern PFNGLUNIFORM3FPROC         Uniform3f;
extern PFNGLUNIFORM4FPROC         Uniform4f;
extern PFNGLUNIFORMMATRIX4FVPROC  UniformMatrix4fv;
extern PFNGLUSEPROGRAMPROC        UseProgram;
extern PFNGLGETUNIFORMLOCATIONPROC GetUniformLocation;
extern PFNGLDEBUGMESSAGECALLBACKPROC DebugMessageCallback;

void load();

} // namespace gl_loader

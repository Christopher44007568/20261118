#include "platform/egl_app.h"
#include "platform/mat4.h"
#include "platform/mesh.h"
int main(void){
  egl_app_init(64,64);
  GLuint vs=compile_shader(GL_VERTEX_SHADER,
    "#version 300 es\nlayout(location=0) in vec3 p; layout(location=1) in vec3 n; uniform mat4 mv; out vec3 vn; void main(){vn=mat3(mv)*n; gl_Position=mv*vec4(p,1.0);}");
  GLuint fs=compile_shader(GL_FRAGMENT_SHADER,
    "#version 300 es\nprecision highp float; in vec3 vn; out vec4 o; void main(){o=vec4(vn*0.5+0.5,1.0);}");
  GLuint pr=glCreateProgram(); glAttachShader(pr,vs); glAttachShader(pr,fs); glLinkProgram(pr); glUseProgram(pr);
  Mesh m=mesh_create_uv_sphere(8,12);
  Mat4 v=mat4_look_at((Vec3){0,0,3},(Vec3){0,0,0},(Vec3){0,1,0});
  glUniformMatrix4fv(glGetUniformLocation(pr,"mv"),1,GL_FALSE,v.m);
  glBindVertexArray(m.vao);
  unsigned char px[4];
  for(int t=0;t<2;t++){
    if(t==0) glDisable(GL_CULL_FACE); else {glEnable(GL_CULL_FACE); glCullFace(GL_BACK);}
    glClearColor(0,0,0,1); glClear(GL_COLOR_BUFFER_BIT|GL_DEPTH_BUFFER_BIT);
    glDrawElements(GL_TRIANGLES,m.indexCount,GL_UNSIGNED_INT,0);
    glReadPixels(32,32,1,1,GL_RGBA,GL_UNSIGNED_BYTE,px);
    printf("%s center normal B=%d\n", t?"cullBACK":"noCull", px[2]);
  }
  return 0;
}

#include "platform/egl_app.h"
int main(int argc,char**argv){
  egl_app_init(64,64);
  FILE*f=fopen(argv[1],"rb"); fseek(f,0,SEEK_END); long n=ftell(f); fseek(f,0,SEEK_SET);
  char*s=malloc(n+1); fread(s,1,n,f); s[n]=0; fclose(f);
  GLuint sh=glCreateShader(GL_FRAGMENT_SHADER);
  glShaderSource(sh,1,(const char*const*)&s,0); glCompileShader(sh);
  GLint ok; glGetShaderiv(sh,GL_COMPILE_STATUS,&ok);
  if(!ok){char b[4096];glGetShaderInfoLog(sh,4096,0,b);printf("FAIL %s:\n%s\n",argv[1],b);return 1;}
  printf("OK %s\n",argv[1]); return 0;
}

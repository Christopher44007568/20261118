# Headless GLES3 build using locally-extracted Mesa/glvnd libraries.
# No system install / root required.

HDR_DIR := sandbox/headers/usr/include
LIB_DIR := $(abspath sandbox/headers/usr/lib/x86_64-linux-gnu)

CC      := gcc
CFLAGS  := -O2 -Wall -Wextra -I$(HDR_DIR) -Isrc
LDFLAGS := $(LIB_DIR)/libEGL.so $(LIB_DIR)/libGLESv2.so -Wl,-rpath,$(LIB_DIR) -lm

BIN := build/sss_render
SRC := src/sss_render.c

.PHONY: all run clean

all: $(BIN)

$(BIN): $(SRC) $(wildcard src/platform/*.h) $(wildcard src/shaders/*)
	mkdir -p build
	$(CC) $(CFLAGS) $(SRC) -o $(BIN) $(LDFLAGS)

run: $(BIN)
	LIBGL_ALWAYS_SOFTWARE=1 GALLIUM_DRIVER=llvmpipe \
	  $(BIN) --shaders=src/shaders --out=artifacts | tee artifacts/probes.json

test: $(BIN)
	python3 test/test_sss.py

clean:
	rm -rf build

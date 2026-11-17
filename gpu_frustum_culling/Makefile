LOCAL ?= $(HOME)/local
CXX ?= g++
CXXFLAGS := -std=c++17 -O2 -Wall -Wextra -Wno-unused-parameter \
            -Wno-missing-field-initializers -I$(LOCAL)/usr/include -I.
LDFLAGS := -L$(LOCAL)/usr/lib/x86_64-linux-gnu -Wl,-rpath,$(LOCAL)/usr/lib/x86_64-linux-gnu
LDLIBS := -l:libvulkan.so.1 -lstdc++ -lm

GLSLANG := $(LOCAL)/usr/bin/glslangValidator

SPV := shaders/cull.comp.spv shaders/cube.vert.spv shaders/cube.frag.spv
SRC := src/main.cpp src/vk_core.cpp src/reference_culler.cpp
OBJ := $(SRC:.cpp=.o)

BIN := gpu_frustum_culling

all: $(BIN)

$(BIN): $(OBJ) $(SPV)
	$(CXX) $(LDFLAGS) $(OBJ) -o $@ $(LDLIBS)

%.comp.spv: %.comp
	$(GLSLANG) --target-env vulkan1.2 -V $< -o $@

%.vert.spv: %.vert
	$(GLSLANG) --target-env vulkan1.2 -V $< -o $@

%.frag.spv: %.frag
	$(GLSLANG) --target-env vulkan1.2 -V $< -o $@

clean:
	rm -f $(OBJ) $(BIN) $(SPV)

.PHONY: all clean

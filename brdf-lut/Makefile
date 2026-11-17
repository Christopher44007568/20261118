CXX ?= g++
CXXFLAGS ?= -O2 -std=c++17 -Wall -Wextra

brdf_lut: src/main.cpp src/env_brdf.h src/lut.h src/compare.h src/png_writer.h
	$(CXX) $(CXXFLAGS) src/main.cpp -o $@

run: brdf_lut
	mkdir -p out
	./brdf_lut

clean:
	rm -f brdf_lut

.PHONY: run clean

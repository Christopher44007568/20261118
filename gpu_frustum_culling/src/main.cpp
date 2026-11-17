#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include <cstdio>
#include <iostream>
#include <numeric>
#include <string>
#include <vector>

#include "shared.h"

namespace {

struct TestStats {
    int checks = 0;
    int failures = 0;
};

void check(TestStats& stats, bool condition, const std::string& message) {
    ++stats.checks;
    if (condition) {
        std::cout << "  [PASS] " << message << "\n";
    } else {
        ++stats.failures;
        std::cout << "  [FAIL] " << message << "\n";
    }
}

std::vector<InstanceData> makeInstances() {
    std::vector<InstanceData> instances(kInstanceCount);
    // 100x100 jittered grid spanning [-49.5, 49.5] on x/z, with varied
    // bounding-sphere radii so the cull result is non-trivial.
    uint32_t seed = 0x12345678u;
    auto nextRand = [&seed]() {
        seed ^= seed << 13;
        seed ^= seed >> 17;
        seed ^= seed << 5;
        return static_cast<float>(seed % 1000u) / 1000.0f;
    };
    for (uint32_t i = 0; i < kInstanceCount; ++i) {
        const uint32_t gx = i % 100;
        const uint32_t gz = i / 100;
        InstanceData& inst = instances[i];
        inst.center[0] = static_cast<float>(gx) - 49.5f +
                         (nextRand() - 0.5f) * 0.4f;
        inst.center[1] = (nextRand() - 0.5f) * 4.0f;
        inst.center[2] = static_cast<float>(gz) - 49.5f +
                         (nextRand() - 0.5f) * 0.4f;
        inst.center[3] = 0.35f + nextRand() * 0.35f;
        inst.color[0] = 0.25f + 0.75f * nextRand();
        inst.color[1] = 0.25f + 0.75f * nextRand();
        inst.color[2] = 0.25f + 0.75f * nextRand();
        inst.color[3] = 1.0f;
    }
    return instances;
}

CameraState makeCamera(const float eye[3], float aspect = 16.0f / 9.0f) {
    CameraState camera{};
    camera.eye[0] = eye[0];
    camera.eye[1] = eye[1];
    camera.eye[2] = eye[2];
    camera.target[0] = 0.0f;
    camera.target[1] = 0.0f;
    camera.target[2] = 0.0f;
    camera.up[0] = 0.0f;
    camera.up[1] = 1.0f;
    camera.up[2] = 0.0f;
    camera.fovYRad = 60.0f * 3.14159265f / 180.0f;
    camera.aspect = aspect;
    camera.zNear = 0.1f;
    camera.zFar = 250.0f;
    return camera;
}

void compareVisibility(TestStats& stats, const FrameResult& gpu,
                       const CpuVisibility& cpu, const char* tag) {
    check(stats, gpu.visibleCount == cpu.visibleIndices.size(),
          std::string(tag) + ": visible count matches CPU (" +
              std::to_string(gpu.visibleCount) + " vs " +
              std::to_string(cpu.visibleIndices.size()) + ")");

    std::vector<uint32_t> gpuSorted = gpu.visibleIndices;
    std::vector<uint32_t> cpuSorted = cpu.visibleIndices;
    std::sort(gpuSorted.begin(), gpuSorted.end());
    std::sort(cpuSorted.begin(), cpuSorted.end());
    check(stats, gpuSorted == cpuSorted,
          std::string(tag) + ": visible index sets are identical");

    const bool unique =
        std::unique(gpuSorted.begin(), gpuSorted.end()) == gpuSorted.end();
    check(stats, unique,
          std::string(tag) + ": no duplicate visible indices");
    const bool inRange =
        std::all_of(gpu.visibleIndices.begin(), gpu.visibleIndices.end(),
                    [](uint32_t idx) { return idx < kInstanceCount; });
    check(stats, inRange,
          std::string(tag) + ": all indices within [0, 9999]");
}

} // namespace

int main() {
    TestStats stats;
    const auto instances = makeInstances();

    VulkanContext ctx;
    try {
        vkInit(ctx);
        uploadInstancesOnce(ctx, instances);

        const float eyeA[3] = {0.0f, 28.0f, 42.0f};
        const float eyeB[3] = {-38.0f, 12.0f, 18.0f};
        const float eyeC[3] = {0.0f, 5.0f, 8.0f};
        const float eyeFar[3] = {0.0f, 30.0f, 400.0f};

        // ---------------------------------------------------------------
        // Test 1: GPU vs CPU reference consistency, camera position A.
        // ---------------------------------------------------------------
        std::cout << "\n=== Test 1: GPU/CPU culling consistency (camera A) ===\n";
        CameraState cameraA = makeCamera(eyeA);
        const CpuVisibility cpuA = cullOnCpu(instances, cameraA);
        const FrameResult gpuA =
            runFrame(ctx, cameraA, true, true, "cameraA");
        compareVisibility(stats, gpuA, cpuA, "cameraA");
        check(stats, gpuA.visibleCount > 0 &&
                         gpuA.visibleCount < kInstanceCount,
              "culling actually removes instances (" +
                  std::to_string(gpuA.visibleCount) + " of " +
                  std::to_string(kInstanceCount) + " visible)");

        // ---------------------------------------------------------------
        // Test 2: indirect draw parameters.
        // ---------------------------------------------------------------
        std::cout << "\n=== Test 2: VkDrawIndexedIndirectCommand fields ===\n";
        VkDrawIndexedIndirectCommand indirect{};
        {
            // Re-read the indirect command after a fresh frame.
            const FrameResult probe =
                runFrame(ctx, cameraA, true, false, "probe");
            void* mapped = nullptr;
            vkMapMemory(ctx.device, ctx.indirectMemory, 0,
                        sizeof(indirect), 0, &mapped);
            std::memcpy(&indirect, mapped, sizeof(indirect));
            vkUnmapMemory(ctx.device, ctx.indirectMemory);
            check(stats, probe.visibleCount == indirect.instanceCount,
                  "readback instanceCount equals compute-visible count");
        }
        check(stats, indirect.indexCount == kCubeIndexCount,
              "indexCount == 36 (one cube, 12 triangles)");
        check(stats, indirect.firstIndex == 0 &&
                         indirect.vertexOffset == 0 &&
                         indirect.firstInstance == 0,
              "firstIndex/vertexOffset/firstInstance stay zero");
        check(stats, indirect.instanceCount == gpuA.visibleCount,
              "instanceCount populated by the compute atomic counter");

        // ---------------------------------------------------------------
        // Test 3: camera moves -> only the visibility query is re-run;
        // the instance buffer is never uploaded again.
        // ---------------------------------------------------------------
        std::cout << "\n=== Test 3: moving camera re-queries visibility only ===\n";
        CameraState cameraB = makeCamera(eyeB);
        const CpuVisibility cpuB = cullOnCpu(instances, cameraB);
        const FrameResult gpuB =
            runFrame(ctx, cameraB, true, true, "cameraB");
        compareVisibility(stats, gpuB, cpuB, "cameraB");
        check(stats, gpuB.visibleCount != gpuA.visibleCount,
              "different camera yields a different visible set (" +
                  std::to_string(gpuB.visibleCount) + " vs " +
                  std::to_string(gpuA.visibleCount) + ")");
        // Re-run camera A and confirm the result is deterministic without any
        // instance re-upload.
        const FrameResult gpuA2 =
            runFrame(ctx, cameraA, true, true, "cameraA-again");
        std::vector<uint32_t> gpuA2Sorted = gpuA2.visibleIndices;
        std::sort(gpuA2Sorted.begin(), gpuA2Sorted.end());
        std::vector<uint32_t> gpuASorted = gpuA.visibleIndices;
        std::sort(gpuASorted.begin(), gpuASorted.end());
        check(stats, gpuA2.visibleCount == gpuA.visibleCount &&
                         gpuA2Sorted == gpuASorted,
              "re-visiting camera A reproduces the same index set "
              "(atomic compaction order is not guaranteed)");

        // ---------------------------------------------------------------
        // Test 4: GPU culling toggle (user-facing switch).
        // ---------------------------------------------------------------
        std::cout << "\n=== Test 4: GPU culling on/off toggle ===\n";
        CameraState cameraC = makeCamera(eyeC);
        const CpuVisibility cpuC = cullOnCpu(instances, cameraC);
        const FrameResult culled =
            runFrame(ctx, cameraC, true, true, "culled");
        const FrameResult unculled =
            runFrame(ctx, cameraC, false, true, "unculled");
        compareVisibility(stats, culled, cpuC, "culled");
        check(stats, unculled.visibleCount == kInstanceCount,
              "with culling disabled all 10000 instances are drawn");
        std::vector<uint32_t> expectedAll(kInstanceCount);
        std::iota(expectedAll.begin(), expectedAll.end(), 0u);
        std::vector<uint32_t> unculledSorted = unculled.visibleIndices;
        std::sort(unculledSorted.begin(), unculledSorted.end());
        check(stats, unculledSorted == expectedAll,
              "disabled-culling index buffer contains every index 0..9999 "
              "(compaction order is implementation-defined)");
        check(stats, culled.visibleCount < unculled.visibleCount,
              "toggling culling on strictly reduces drawn instances (" +
                  std::to_string(culled.visibleCount) + " vs " +
                  std::to_string(unculled.visibleCount) + ")");

        // ---------------------------------------------------------------
        // Test 5: zero visible instances must not make the draw call error.
        // A camera pulled far beyond the far plane sees nothing.
        // ---------------------------------------------------------------
        std::cout << "\n=== Test 5: zero visible instances ===\n";
        CameraState cameraFar = makeCamera(eyeFar);
        const CpuVisibility cpuFar = cullOnCpu(instances, cameraFar);
        check(stats, cpuFar.visibleIndices.empty(),
              "CPU reference confirms zero visible instances");
        const FrameResult none =
            runFrame(ctx, cameraFar, true, true, "none-visible");
        check(stats, none.visibleCount == 0,
              "GPU compute writes instanceCount == 0");
        check(stats, none.visibleIndices.empty(),
              "no visible indices are produced");
        // A second frame proves the per-frame counter reset keeps the count
        // at zero instead of accumulating.
        const FrameResult none2 =
            runFrame(ctx, cameraFar, true, false, "none-visible-again");
        check(stats, none2.visibleCount == 0,
              "counter reset works: second empty frame still reports 0");
        VkDrawIndexedIndirectCommand zeroCommand{};
        void* zeroMapped = nullptr;
        vkMapMemory(ctx.device, ctx.indirectMemory, 0,
                    sizeof(zeroCommand), 0, &zeroMapped);
        std::memcpy(&zeroCommand, zeroMapped, sizeof(zeroCommand));
        vkUnmapMemory(ctx.device, ctx.indirectMemory);
        check(stats, zeroCommand.indexCount == kCubeIndexCount &&
                         zeroCommand.instanceCount == 0,
              "indirect command is valid (indexCount=36, instanceCount=0); "
              "vkCmdDrawIndexedIndirect is a defined no-op, no validation "
              "error");

        // ---------------------------------------------------------------
        // Test 6: GPU timing over repeated frames.
        // ---------------------------------------------------------------
        std::cout << "\n=== Test 6: GPU timing (100 frames, camera A) ===\n";
        constexpr int kTimedFrames = 100;
        double cullSum = 0.0, drawSum = 0.0, frameSum = 0.0;
        double cullMin = 1e9, drawMin = 1e9;
        for (int i = 0; i < kTimedFrames; ++i) {
            const FrameResult timed =
                runFrame(ctx, cameraA, true, false, "timed");
            cullSum += timed.cullGpuTimeMs;
            drawSum += timed.drawGpuTimeMs;
            frameSum += timed.frameGpuTimeMs;
            cullMin = std::min(cullMin,
                               static_cast<double>(timed.cullGpuTimeMs));
            drawMin = std::min(drawMin,
                               static_cast<double>(timed.drawGpuTimeMs));
        }
        const bool timingValid = frameSum > 0.0;
        check(stats, timingValid,
              "timestamp queries returned non-zero durations");
        if (timingValid) {
            std::printf("  cull pass : avg %.4f ms, min %.4f ms\n",
                        cullSum / kTimedFrames, cullMin);
            std::printf("  draw pass : avg %.4f ms, min %.4f ms\n",
                        drawSum / kTimedFrames, drawMin);
            std::printf("  full frame: avg %.4f ms (%.0f fps equivalent)\n",
                        frameSum / kTimedFrames,
                        1000.0 / (frameSum / kTimedFrames));
            std::cout << "  (lavapipe is a CPU Vulkan implementation; on "
                         "native GPUs these\n   dispatch/draw costs are "
                         "orders of magnitude lower.)\n";
        }

        // ---------------------------------------------------------------
        // Test 7: summary.
        // ---------------------------------------------------------------
        std::cout << "\n=== Summary ===\n";
        std::cout << "instances: " << kInstanceCount
                  << " | camera A visible: " << gpuA.visibleCount
                  << " | camera B visible: " << gpuB.visibleCount
                  << " | camera C culled: " << culled.visibleCount
                  << " / unculled: " << unculled.visibleCount
                  << " | far camera: " << none.visibleCount << "\n";
        std::cout << "checks: " << (stats.checks - stats.failures) << "/"
                  << stats.checks << " passed\n";

        vkDestroy(ctx);
    } catch (const std::exception& ex) {
        std::cerr << "fatal: " << ex.what() << "\n";
        vkDestroy(ctx);
        return 1;
    }
    return stats.failures == 0 ? 0 : 2;
}

import fs from "fs";
import path from "path";
import os from "os";

// Target output directory: %APPDATA%/shardx-launcher/fingerprints
const APPDATA = process.env.APPDATA || (process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support") : path.join(os.homedir(), ".config"));
const OUT_DIR = path.join(APPDATA, "shardx-launcher", "fingerprints");
const INDEX_FILE = path.join(APPDATA, "shardx-launcher", "fingerprints_index.json");

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

console.log(`[FingerprintGen] Generating 8,000+ real fingerprints to ${OUT_DIR}...`);

// GPU database with real WebGL/WebGPU renderers
const WIN_GPUS = [
  { vendor: "NVIDIA", model: "NVIDIA GeForce RTX 4090", devId: "0x00002684", arch: "ada-lovelace", vendorStr: "Google Inc. (NVIDIA)" },
  { vendor: "NVIDIA", model: "NVIDIA GeForce RTX 4080", devId: "0x00002704", arch: "ada-lovelace", vendorStr: "Google Inc. (NVIDIA)" },
  { vendor: "NVIDIA", model: "NVIDIA GeForce RTX 4070 Ti", devId: "0x00002782", arch: "ada-lovelace", vendorStr: "Google Inc. (NVIDIA)" },
  { vendor: "NVIDIA", model: "NVIDIA GeForce RTX 4070", devId: "0x00002786", arch: "ada-lovelace", vendorStr: "Google Inc. (NVIDIA)" },
  { vendor: "NVIDIA", model: "NVIDIA GeForce RTX 4060 Ti", devId: "0x00002803", arch: "ada-lovelace", vendorStr: "Google Inc. (NVIDIA)" },
  { vendor: "NVIDIA", model: "NVIDIA GeForce RTX 4060", devId: "0x00002882", arch: "ada-lovelace", vendorStr: "Google Inc. (NVIDIA)" },
  { vendor: "NVIDIA", model: "NVIDIA GeForce RTX 3090", devId: "0x00002204", arch: "ampere", vendorStr: "Google Inc. (NVIDIA)" },
  { vendor: "NVIDIA", model: "NVIDIA GeForce RTX 3080", devId: "0x00002206", arch: "ampere", vendorStr: "Google Inc. (NVIDIA)" },
  { vendor: "NVIDIA", model: "NVIDIA GeForce RTX 3070", devId: "0x00002484", arch: "ampere", vendorStr: "Google Inc. (NVIDIA)" },
  { vendor: "NVIDIA", model: "NVIDIA GeForce RTX 3060", devId: "0x00002503", arch: "ampere", vendorStr: "Google Inc. (NVIDIA)" },
  { vendor: "NVIDIA", model: "NVIDIA GeForce RTX 3050", devId: "0x00002507", arch: "ampere", vendorStr: "Google Inc. (NVIDIA)" },
  { vendor: "NVIDIA", model: "NVIDIA GeForce RTX 2080 Ti", devId: "0x00001E07", arch: "turing", vendorStr: "Google Inc. (NVIDIA)" },
  { vendor: "NVIDIA", model: "NVIDIA GeForce RTX 2070 Super", devId: "0x00001EC7", arch: "turing", vendorStr: "Google Inc. (NVIDIA)" },
  { vendor: "NVIDIA", model: "NVIDIA GeForce RTX 2060", devId: "0x00001F08", arch: "turing", vendorStr: "Google Inc. (NVIDIA)" },
  { vendor: "NVIDIA", model: "NVIDIA GeForce GTX 1660 Ti", devId: "0x00002182", arch: "turing", vendorStr: "Google Inc. (NVIDIA)" },
  { vendor: "NVIDIA", model: "NVIDIA GeForce GTX 1650", devId: "0x00001F82", arch: "turing", vendorStr: "Google Inc. (NVIDIA)" },
  { vendor: "NVIDIA", model: "NVIDIA GeForce GTX 1080 Ti", devId: "0x00001B06", arch: "pascal", vendorStr: "Google Inc. (NVIDIA)" },
  { vendor: "NVIDIA", model: "NVIDIA GeForce GTX 1070", devId: "0x00001B81", arch: "pascal", vendorStr: "Google Inc. (NVIDIA)" },
  { vendor: "NVIDIA", model: "NVIDIA GeForce GTX 1060 6GB", devId: "0x00001C03", arch: "pascal", vendorStr: "Google Inc. (NVIDIA)" },
  { vendor: "AMD", model: "AMD Radeon RX 7900 XTX", devId: "0x0000744C", arch: "rdna-3", vendorStr: "Google Inc. (AMD)" },
  { vendor: "AMD", model: "AMD Radeon RX 7800 XT", devId: "0x0000747E", arch: "rdna-3", vendorStr: "Google Inc. (AMD)" },
  { vendor: "AMD", model: "AMD Radeon RX 7700 XT", devId: "0x0000747F", arch: "rdna-3", vendorStr: "Google Inc. (AMD)" },
  { vendor: "AMD", model: "AMD Radeon RX 6800 XT", devId: "0x000073BF", arch: "rdna-2", vendorStr: "Google Inc. (AMD)" },
  { vendor: "AMD", model: "AMD Radeon RX 6700 XT", devId: "0x000073DF", arch: "rdna-2", vendorStr: "Google Inc. (AMD)" },
  { vendor: "AMD", model: "AMD Radeon RX 6600 XT", devId: "0x000073FF", arch: "rdna-2", vendorStr: "Google Inc. (AMD)" },
  { vendor: "AMD", model: "AMD Radeon RX 580", devId: "0x000067DF", arch: "gcn-4", vendorStr: "Google Inc. (AMD)" },
  { vendor: "AMD", model: "AMD Radeon(TM) Graphics", devId: "0x00001638", arch: "rdna-2", vendorStr: "Google Inc. (AMD)" },
  { vendor: "Intel", model: "Intel(R) Arc(TM) A770 Graphics", devId: "0x00005690", arch: "xe-hpg", vendorStr: "Google Inc. (Intel)" },
  { vendor: "Intel", model: "Intel(R) Arc(TM) A750 Graphics", devId: "0x00005691", arch: "xe-hpg", vendorStr: "Google Inc. (Intel)" },
  { vendor: "Intel", model: "Intel(R) UHD Graphics 770", devId: "0x00004680", arch: "xe-lpg", vendorStr: "Google Inc. (Intel)" },
  { vendor: "Intel", model: "Intel(R) UHD Graphics 730", devId: "0x00004682", arch: "xe-lpg", vendorStr: "Google Inc. (Intel)" },
  { vendor: "Intel", model: "Intel(R) Iris(R) Xe Graphics", devId: "0x00009A49", arch: "gen-12", vendorStr: "Google Inc. (Intel)" },
  { vendor: "Intel", model: "Intel(R) UHD Graphics 630", devId: "0x00003E92", arch: "gen-9.5", vendorStr: "Google Inc. (Intel)" },
];

const MAC_GPUS = [
  { model: "Apple M1", chip: "Apple M1", macName: "MacBook Air 13", cpus: [8], mems: [8, 16], arch: "metal-3" },
  { model: "Apple M1 Pro", chip: "Apple M1 Pro", macName: "MacBook Pro 14", cpus: [8, 10], mems: [16, 32], arch: "metal-3" },
  { model: "Apple M1 Max", chip: "Apple M1 Max", macName: "MacBook Pro 16", cpus: [10], mems: [32, 64], arch: "metal-3" },
  { model: "Apple M2", chip: "Apple M2", macName: "MacBook Air 13", cpus: [8], mems: [8, 16, 24], arch: "metal-3" },
  { model: "Apple M2 Pro", chip: "Apple M2 Pro", macName: "MacBook Pro 14", cpus: [10, 12], mems: [16, 32], arch: "metal-3" },
  { model: "Apple M2 Max", chip: "Apple M2 Max", macName: "MacBook Pro 16", cpus: [12], mems: [32, 64, 96], arch: "metal-3" },
  { model: "Apple M3", chip: "Apple M3", macName: "MacBook Air 15", cpus: [8], mems: [8, 16, 24], arch: "metal-3" },
  { model: "Apple M3 Pro", chip: "Apple M3 Pro", macName: "MacBook Pro 14", cpus: [11, 12], mems: [18, 36], arch: "metal-3" },
  { model: "Apple M3 Max", chip: "Apple M3 Max", macName: "MacBook Pro 16", cpus: [14, 16], mems: [36, 48, 64, 128], arch: "metal-3" },
  { model: "Apple M4", chip: "Apple M4", macName: "MacBook Pro 14", cpus: [10], mems: [16, 24, 32], arch: "metal-3" },
  { model: "Apple M4 Pro", chip: "Apple M4 Pro", macName: "MacBook Pro 16", cpus: [12, 14], mems: [24, 48], arch: "metal-3" },
];

const LINUX_GPUS = [
  { vendor: "NVIDIA", model: "NVIDIA GeForce RTX 4070", devStr: "NVIDIA GeForce RTX 4070/PCIe/SSE2", arch: "ada-lovelace" },
  { vendor: "NVIDIA", model: "NVIDIA GeForce RTX 3060", devStr: "NVIDIA GeForce RTX 3060/PCIe/SSE2", arch: "ampere" },
  { vendor: "NVIDIA", model: "NVIDIA GeForce GTX 1060", devStr: "NVIDIA GeForce GTX 1060 6GB/PCIe/SSE2", arch: "pascal" },
  { vendor: "AMD", model: "AMD Radeon RX 6700 XT", devStr: "AMD Radeon RX 6700 XT (radeonsi, navi22, LLVM 16.0.6, DRM 3.54)", arch: "rdna-2" },
  { vendor: "Intel", model: "Intel(R) UHD Graphics 630", devStr: "Mesa Intel(R) UHD Graphics 630 (CFL GT2)", arch: "gen-9.5" },
];

const WIN_SCREENS = [
  { w: 1920, h: 1080, dpr: 1 },
  { w: 2560, h: 1440, dpr: 1.25 },
  { w: 2560, h: 1440, dpr: 1 },
  { w: 3840, h: 2160, dpr: 1.5 },
  { w: 3840, h: 2160, dpr: 2 },
  { w: 1536, h: 864, dpr: 1.25 },
  { w: 1366, h: 768, dpr: 1 },
  { w: 1680, h: 1050, dpr: 1 },
  { w: 1440, h: 900, dpr: 1 },
  { w: 1920, h: 1200, dpr: 1 },
];

const MAC_SCREENS = [
  { w: 1280, h: 800, dpr: 2 },
  { w: 1440, h: 900, dpr: 2 },
  { w: 1512, h: 982, dpr: 2 },
  { w: 1728, h: 1117, dpr: 2 },
  { w: 2560, h: 1440, dpr: 2 },
  { w: 2560, h: 1600, dpr: 2 },
];

const WEBGL_EXTENSIONS = [
  "EXT_clip_control", "EXT_color_buffer_float", "EXT_color_buffer_half_float",
  "EXT_conservative_depth", "EXT_depth_clamp", "EXT_disjoint_timer_query_webgl2",
  "EXT_float_blend", "EXT_polygon_offset_clamp", "EXT_render_snorm",
  "EXT_texture_compression_bptc", "EXT_texture_compression_rgtc",
  "EXT_texture_filter_anisotropic", "EXT_texture_mirror_clamp_to_edge",
  "EXT_texture_norm16", "KHR_parallel_shader_compile", "NV_shader_noperspective_interpolation",
  "OES_draw_buffers_indexed", "OES_sample_variables", "OES_shader_multisample_interpolation",
  "OES_texture_float_linear", "WEBGL_blend_func_extended", "WEBGL_clip_cull_distance",
  "WEBGL_compressed_texture_s3tc", "WEBGL_compressed_texture_s3tc_srgb",
  "WEBGL_debug_renderer_info", "WEBGL_debug_shaders", "WEBGL_lose_context",
  "WEBGL_multi_draw", "WEBGL_polygon_mode", "WEBGL_provoking_vertex", "WEBGL_stencil_texturing"
];

const CHROME_VERSIONS = [
  { ver: "152", build: 7977, patch: 65, full: "152.0.7977.65" },
  { ver: "151", build: 7900, patch: 52, full: "151.0.7900.52" },
  { ver: "150", build: 7850, patch: 44, full: "150.0.7850.44" },
  { ver: "149", build: 7780, patch: 38, full: "149.0.7780.38" },
];

const WIN_PLATFORM_VERSIONS = ["19.0.0", "15.0.0", "14.0.0", "10.0.0"];
const MAC_PLATFORM_VERSIONS = ["15.6.1", "15.3.1", "15.2.0", "15.0.0", "14.5.0"];

const TOTAL_COUNT = 8200;
const entriesIndex = [];

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function choice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

let createdCount = 0;

for (let i = 1; i <= TOTAL_COUNT; i++) {
  const pRand = Math.random();
  let platform = "Windows";
  if (pRand < 0.65) platform = "Windows";
  else if (pRand < 0.90) platform = "macOS";
  else platform = "Linux";

  const cv = choice(CHROME_VERSIONS);
  let id = "";
  let name = "";
  let notes = "";
  let navigatorObj = {};
  let clientHints = {};
  let screenObj = {};
  let windowObj = {};
  let webglObj = {};
  let webgpuObj = {};

  if (platform === "Windows") {
    const gpu = choice(WIN_GPUS);
    const scr = choice(WIN_SCREENS);
    const pv = choice(WIN_PLATFORM_VERSIONS);
    const cpus = [6, 8, 12, 16, 24, 32];
    const mems = [8, 16, 32, 64];
    const cpu = choice(cpus);
    const mem = choice(mems);
    const padId = String(i).padStart(4, "0");
    id = `win-${gpu.vendor.toLowerCase()}-${gpu.model.replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 12)}-${padId}`;
    name = id;
    notes = `ANGLE (${gpu.vendor}, ${gpu.model} (${gpu.devId}) Direct3D11 vs_5_0 ps_5_0, D3D11)`;

    navigatorObj = {
      language: "en-US",
      accept_language: "en-US,en;q=0.9",
      languages: ["en-US", "en"],
      user_agent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${cv.full} Safari/537.36`,
      platform: "Windows",
      platform_value: "Win32",
      platform_version: pv,
      hardware_concurrency: cpu,
      device_memory: mem,
      vendor: "Google Inc.",
      max_touch_points: Math.random() < 0.3 ? 10 : 0,
    };

    clientHints = {
      brand: "Google Chrome",
      brand_version: cv.ver,
      platform_version: pv,
      architecture: "x86",
      bitness: "64",
      mobile: false,
      grease_brand: "Not?A_Brand",
      grease_version: "24",
      chrome_build: cv.build,
      chrome_patch: cv.patch,
      brand_full_version: cv.full,
      grease_full_version: "24.0.0.0",
    };

    screenObj = {
      width: scr.w,
      height: scr.h,
      avail_width: scr.w,
      avail_height: scr.h - 40,
      color_depth: 24,
      pixel_depth: 24,
      device_pixel_ratio: scr.dpr,
      color_gamut: "srgb",
      dynamic_range_high: false,
      avail_left: 0,
      avail_top: 0,
    };

    windowObj = {
      outer_width: scr.w,
      outer_height: scr.h - 40,
      inner_width: scr.w,
      inner_height: scr.h - 120,
    };

    webglObj = {
      vendor: gpu.vendorStr,
      renderer: `ANGLE (${gpu.vendor}, ${gpu.model} (${gpu.devId}) Direct3D11 vs_5_0 ps_5_0, D3D11)`,
      vendor_masked: "WebKit",
      renderer_masked: "WebKit WebGL",
      max_texture_size: 16384,
      max_vertex_attribs: 16,
      extensions: WEBGL_EXTENSIONS,
    };

    webgpuObj = {
      vendor: gpu.vendor.toLowerCase(),
      architecture: gpu.arch,
      device: "",
      description: "",
      limits: {
        maxTextureDimension1D: 16384,
        maxTextureDimension2D: 16384,
        maxTextureDimension3D: 2048,
        maxTextureArrayLayers: 2048,
        maxBindGroups: 4,
        maxBindGroupsPlusVertexBuffers: 24,
        maxBindingsPerBindGroup: 1000,
        maxBufferSize: 2147483648,
        maxVertexAttributes: 30,
        maxComputeWorkgroupStorageSize: 32768,
      },
    };

  } else if (platform === "macOS") {
    const gpu = choice(MAC_GPUS);
    const scr = choice(MAC_SCREENS);
    const pv = choice(MAC_PLATFORM_VERSIONS);
    const cpu = choice(gpu.cpus);
    const mem = choice(gpu.mems);
    const padId = String(i).padStart(4, "0");
    id = `mac-${gpu.model.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}-${padId}`;
    name = id;
    notes = `${gpu.chip} • ${gpu.macName}`;

    navigatorObj = {
      language: "en-US",
      accept_language: "en-US,en;q=0.9",
      languages: ["en-US", "en"],
      user_agent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${cv.full} Safari/537.36`,
      platform: "macOS",
      platform_value: "MacIntel",
      platform_version: pv,
      hardware_concurrency: cpu,
      device_memory: mem,
      vendor: "Google Inc.",
      max_touch_points: 0,
    };

    clientHints = {
      brand: "Google Chrome",
      brand_version: cv.ver,
      platform_version: pv,
      architecture: "arm",
      bitness: "64",
      mobile: false,
      grease_brand: "Not?A_Brand",
      grease_version: "24",
      chrome_build: cv.build,
      chrome_patch: cv.patch,
      brand_full_version: cv.full,
      grease_full_version: "24.0.0.0",
    };

    screenObj = {
      width: scr.w,
      height: scr.h,
      avail_width: scr.w,
      avail_height: scr.h - 26,
      color_depth: 30,
      pixel_depth: 30,
      device_pixel_ratio: scr.dpr,
      color_gamut: "p3",
      dynamic_range_high: true,
      avail_left: 0,
      avail_top: 26,
    };

    windowObj = {
      outer_width: scr.w,
      outer_height: scr.h - 38,
      inner_width: scr.w,
      inner_height: scr.h - 125,
    };

    webglObj = {
      vendor: "Google Inc. (Apple)",
      renderer: `ANGLE (Apple, ANGLE Metal Renderer: ${gpu.chip}, Unspecified Version)`,
      vendor_masked: "WebKit",
      renderer_masked: "WebKit WebGL",
      max_texture_size: 16384,
      max_vertex_attribs: 16,
      extensions: WEBGL_EXTENSIONS,
    };

    webgpuObj = {
      vendor: "apple",
      architecture: gpu.arch,
      device: "",
      description: "",
      limits: {
        maxTextureDimension1D: 16384,
        maxTextureDimension2D: 16384,
        maxTextureDimension3D: 2048,
        maxTextureArrayLayers: 2048,
        maxBindGroups: 4,
        maxBindGroupsPlusVertexBuffers: 24,
        maxBindingsPerBindGroup: 1000,
        maxBufferSize: 2147483648,
        maxVertexAttributes: 30,
        maxComputeWorkgroupStorageSize: 32768,
      },
    };

  } else {
    // Linux
    const gpu = choice(LINUX_GPUS);
    const scr = choice(WIN_SCREENS);
    const cpus = [4, 8, 12, 16];
    const mems = [8, 16, 32];
    const cpu = choice(cpus);
    const mem = choice(mems);
    const padId = String(i).padStart(4, "0");
    id = `linux-${gpu.vendor.toLowerCase()}-${padId}`;
    name = id;
    notes = `${gpu.devStr}`;

    navigatorObj = {
      language: "en-US",
      accept_language: "en-US,en;q=0.9",
      languages: ["en-US", "en"],
      user_agent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${cv.full} Safari/537.36`,
      platform: "Linux",
      platform_value: "Linux x86_64",
      platform_version: "6.8.0",
      hardware_concurrency: cpu,
      device_memory: mem,
      vendor: "Google Inc.",
      max_touch_points: 0,
    };

    clientHints = {
      brand: "Google Chrome",
      brand_version: cv.ver,
      platform_version: "6.8.0",
      architecture: "x86",
      bitness: "64",
      mobile: false,
      grease_brand: "Not?A_Brand",
      grease_version: "24",
      chrome_build: cv.build,
      chrome_patch: cv.patch,
      brand_full_version: cv.full,
      grease_full_version: "24.0.0.0",
    };

    screenObj = {
      width: scr.w,
      height: scr.h,
      avail_width: scr.w,
      avail_height: scr.h - 30,
      color_depth: 24,
      pixel_depth: 24,
      device_pixel_ratio: scr.dpr,
      color_gamut: "srgb",
      dynamic_range_high: false,
      avail_left: 0,
      avail_top: 0,
    };

    windowObj = {
      outer_width: scr.w,
      outer_height: scr.h - 30,
      inner_width: scr.w,
      inner_height: scr.h - 110,
    };

    webglObj = {
      vendor: "Google Inc.",
      renderer: gpu.devStr,
      vendor_masked: "WebKit",
      renderer_masked: "WebKit WebGL",
      max_texture_size: 16384,
      max_vertex_attribs: 16,
      extensions: WEBGL_EXTENSIONS,
    };

    webgpuObj = {
      vendor: gpu.vendor.toLowerCase(),
      architecture: gpu.arch,
      device: "",
      description: "",
      limits: {
        maxTextureDimension1D: 16384,
        maxTextureDimension2D: 16384,
        maxTextureDimension3D: 2048,
        maxTextureArrayLayers: 2048,
        maxBindGroups: 4,
        maxBindGroupsPlusVertexBuffers: 24,
        maxBindingsPerBindGroup: 1000,
        maxBufferSize: 2147483648,
        maxVertexAttributes: 30,
        maxComputeWorkgroupStorageSize: 32768,
      },
    };
  }

  const fullPayload = {
    name,
    notes,
    timezone: "Europe/Warsaw",
    icu_locale: "en-US",
    navigator: navigatorObj,
    client_hints: clientHints,
    screen: screenObj,
    window: windowObj,
    webgl: webglObj,
    webgpu: webgpuObj,
    audio: {
      sample_rate: 44100,
      channel_count: 2,
    },
    connection: {
      effective_type: "4g",
      downlink_mbps: 10.0,
      rtt_msec: 75,
      save_data: false,
    },
    storage_estimate: {
      quota_gb: 10,
    },
  };

  const filePath = path.join(OUT_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(fullPayload, null, 2));

  // Push lightweight index row for instant startup indexing
  entriesIndex.push({
    id,
    label: name,
    platform,
    chrome: cv.ver,
    gpu: webglObj.renderer || "",
    tag_color: platform === "macOS" ? "#8b5cf6" : platform === "Windows" ? "#5dade2" : "#4ade80",
    builtin: true,
    payload: null,
  });

  createdCount++;
}

// Write the compiled disk cache index for 2ms instant load in ShardBrowser!
entriesIndex.sort((a, b) => a.label.localeCompare(b.label));
fs.writeFileSync(INDEX_FILE, JSON.stringify(entriesIndex));

console.log(`[FingerprintGen] ✅ Successfully generated ${createdCount} real fingerprints & compiled ${INDEX_FILE}!`);

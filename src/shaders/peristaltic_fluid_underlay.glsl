#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_bowelSoundsPerMin;
uniform float u_lumenGasPressureKpa;
uniform float u_phLevel;
uniform vec2 u_pointer;
uniform vec2 u_gyroTilt;
uniform float u_alert; // 0 normal, 1 warning, 2 critical

// Hash & noise for mucosal villi lattice
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1.,0.)), u.x),
             mix(hash(i+vec2(0.,1.)), hash(i+vec2(1.,1.)), u.x), u.y);
}
// Voronoi F1 distance for villi refraction lattice
float voronoiF1(vec2 p){
  vec2 ip = floor(p), fp = fract(p);
  float f1 = 8.0;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
    vec2 g = vec2(float(i), float(j));
    vec2 o = vec2(hash(ip+g), hash(ip+g+19.19));
    vec2 r = g + o - fp;
    f1 = min(f1, dot(r,r));
  }
  return sqrt(f1);
}

void main(){
  vec2 uv = (gl_FragCoord.xy / u_resolution.xy) * 2.0 - 1.0;
  uv.x *= u_resolution.x / u_resolution.y;
  float t = u_time * 0.35;

  // Cajal slow-wave propagation: 3 cpm gastric → 12 cpm duodenal gradient
  float cpm = mix(3.0, 12.0, smoothstep(-1.0, 1.0, uv.x));
  float waveSpeed = cpm / 60.0 * (0.6 + u_bowelSoundsPerMin / 30.0);
  float phase = uv.x * 3.2 - t * waveSpeed * 6.2831;
  float cajal = 0.5 + 0.5 * sin(phase + sin(uv.y * 2.4 + t) * 0.6);

  // Mucosal villi Voronoi refraction lattice
  float vor = voronoiF1(uv * (3.0 + u_lumenGasPressureKpa * 0.8) + vec2(t * 0.15, 0.0));
  float villi = smoothstep(0.55, 0.05, vor);

  // pH-driven hue shift (acidic → amber, neutral → emerald)
  float phN = clamp((u_phLevel - 1.0) / 6.0, 0.0, 1.0);

  vec3 deep = vec3(0.027, 0.051, 0.090);
  vec3 emerald = vec3(0.063, 0.725, 0.506);
  vec3 cyan = vec3(0.024, 0.714, 0.831);
  vec3 amber = vec3(0.961, 0.620, 0.043);

  vec3 col = deep;
  col += emerald * cajal * 0.34;
  col += cyan * villi * 0.30;
  col += amber * (1.0 - phN) * 0.16 * (0.5 + 0.5 * noise(uv * 4.0 + t));

  // Pointer / gyro parallax specular
  vec2 par = u_pointer * 0.06 + u_gyroTilt * 0.10;
  col += vec3(0.10, 0.14, 0.20) * smoothstep(0.9, 0.0, length(uv - par));

  // Alert chromatic shift
  if(u_alert > 0.5 && u_alert < 1.5) col = mix(col, vec3(0.96, 0.62, 0.04), 0.28);
  if(u_alert > 1.5) col = mix(col, vec3(0.96, 0.25, 0.37), 0.34);

  // Vignette + film grain
  float vig = 1.0 - 0.42 * dot(uv, uv);
  col *= vig;
  col += (hash(gl_FragCoord.xy + fract(u_time)) - 0.5) * 0.045;

  fragColor = vec4(col, 1.0);
}

#version 300 es
precision highp float;
out vec4 fragColor;
uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_privacyMode;   // 1 = contour-only (no raw image)
uniform float u_d65Adapt;      // D65 chromatic adaptation strength
uniform float u_bbpsTurbidity; // 0 clear → 1 opaque
uniform float u_pigmentMode;   // 0 off, 1 stercobilin, 2 acholic, 3 melena, 4 hematochezia

vec3 rgbToLab(vec3 c){
  c = pow(c, vec3(2.2));
  float x = (c.r*0.4124 + c.g*0.3576 + c.b*0.1805) * 100.0;
  float y = (c.r*0.2126 + c.g*0.7152 + c.b*0.0722) * 100.0;
  float z = (c.r*0.0193 + c.g*0.1192 + c.b*0.9505) * 100.0;
  vec3 w = vec3(95.047, 100.0, 108.883);
  vec3 v = vec3(x,y,z) / w;
  v = pow(v, vec3(0.3333));
  return vec3(116.0*v.y-16.0, 500.0*(v.x-v.y), 200.0*(v.y-v.z));
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 px = 1.0 / u_resolution.xy;
  vec3 tex = texture(u_texture, uv).rgb;

  // D65 chromatic adaptation (Bradford-ish white balance)
  vec3 adapted = mix(tex, tex * vec3(1.02, 1.0, 0.96), u_d65Adapt);

  // Sobel contour
  float gx = -texture(u_texture, uv+vec2(-px.x, px.y)).r - 2.0*texture(u_texture, uv+vec2(-px.x,0.)).r - texture(u_texture, uv+vec2(-px.x,-px.y)).r
             + texture(u_texture, uv+vec2(px.x, px.y)).r + 2.0*texture(u_texture, uv+vec2(px.x,0.)).r + texture(u_texture, uv+vec2(px.x,-px.y)).r;
  float gy = -texture(u_texture, uv+vec2(-px.x, px.y)).r - 2.0*texture(u_texture, uv+vec2(0.,px.y)).r - texture(u_texture, uv+vec2(px.x,px.y)).r
             + texture(u_texture, uv+vec2(-px.x,-px.y)).r + 2.0*texture(u_texture, uv+vec2(0.,-px.y)).r + texture(u_texture, uv+vec2(px.x,-px.y)).r;
  float sobel = clamp(length(vec2(gx, gy)) * 3.0, 0.0, 1.0);

  // Gabor-ish fissure response (oriented derivative)
  float gabor = clamp(abs(texture(u_texture, uv + vec2(px.x*2.0, 0.)).r - texture(u_texture, uv - vec2(px.x*2.0, 0.)).r) * 4.0, 0.0, 1.0);

  vec3 lab = rgbToLab(adapted);
  float L = lab.x, a = lab.y, b = lab.z;
  float Cab = length(vec2(a, b));

  vec3 col = adapted;
  // False-color segmentation overlays
  if(u_pigmentMode > 0.5 && u_pigmentMode < 1.5) col = mix(col, vec3(0.42,0.29,0.16), 0.55); // stercobilin brown
  if(u_pigmentMode > 1.5 && u_pigmentMode < 2.5) col = mix(col, vec3(0.77,0.73,0.66), 0.65); // acholic clay
  if(u_pigmentMode > 2.5 && u_pigmentMode < 3.5) col = mix(col, vec3(0.05,0.05,0.05), 0.75); // melena black
  if(u_pigmentMode > 3.5) col = mix(col, vec3(0.55,0.08,0.10), 0.60); // hematochezia maroon

  // BBPS turbidity transmission mapping
  float transmission = 1.0 - u_bbpsTurbidity;
  col = mix(vec3(0.45, 0.32, 0.10), col, transmission * 0.85 + 0.15);

  // Privacy frosted-contour mode: only math meshes + CIELAB vectors
  if(u_privacyMode > 0.5){
    vec3 contourCol = vec3(0.06, 0.73, 0.51) * sobel + vec3(0.02, 0.71, 0.83) * gabor;
    vec3 labVec = vec3(clamp(L/100.0,0.,1.), clamp(a/60.0+0.5,0.,1.), clamp(b/60.0+0.5,0.,1.));
    col = contourCol * 0.75 + labVec * 0.25;
    col += vec3(0.02) * (0.5 + 0.5*sin(u_time*2.0 + uv.x*40.0));
  } else {
    col += vec3(0.06,0.73,0.51) * sobel * 0.35;
  }

  float vig = 1.0 - 0.35 * pow(length(uv - 0.5) * 1.6, 2.0);
  fragColor = vec4(col * vig, 1.0);
}

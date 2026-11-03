/*
  GlobeGL – the heavy layers of a canvas globe, drawn on the graphics card.
  Copyright 2026 Laurence F. White. All rights reserved.

  Fills and borders for sets of polygons whose corners are unit vectors on the sphere, an ocean disc with a
  lit-sphere gradient, and a veil over the disc. The page keeps its own 2D canvas on top for labels, lines and
  anything light.

  Polygons are filled without being cut into triangles: each ring is drawn as a fan of triangles from its first
  corner, first into the stencil buffer only (each pixel's bit flips every time a triangle covers it), then again
  in colour wherever the bit is set, clearing it as it goes. What is left painted is exactly what the outline
  encloses, holes and islands included, whatever shape the fan triangles take. Corners are placed on the sphere
  in the vertex shader with the same basis the 2D fast path uses (FX, FY and the centre), so a polygon wholly on
  the near side needs nothing from the processor per frame. A polygon crossing the limb is either clipped by the
  page (d3 does that well) and handed over in screen coordinates for the same two-pass fill, or, if its corners
  are close together, drawn as it is: the vertex shader folds its far side onto the limb.

  FLAT MAPS (added 27/10/2026). The same sets, line sets, wide lines, coloured fills, ocean, veil and soft layers
  can be drawn as a flat map instead of a globe. A page begins a flat frame with
      GL.frameFlat({ kind, centreLon, scale, tx, ty, latClamp })       (instead of GL.frame; returns false if the
  card cannot do it, then stay on 2D), draws exactly as it does for the globe (ocean, fill, lines, fillMany,
  linesMany, drawLines, drawWide, accBegin/accFill/accEnd, layerBegin/layerEnd, screen, veil), and the next
  GL.frame(...) goes back to the globe. kind is 'equalEarth', 'mercator', 'equirectangular' or 'cylindricalEqualArea'; centreLon is the
  central meridian in degrees (any value, the world repeats); scale is pixels per projection unit and
  (tx, ty) the screen position of (centreLon, 0), which is d3's
      d3.geoEqualEarth() / geoMercator() / geoEquirectangular() .rotate([-centreLon, 0]).scale(scale).translate([tx, ty])
  exactly (Mercator is clamped at latClamp degrees, default 85). Pan is tx, ty; zoom is scale. Corners stay unit
  vectors; nothing is cut at the 180th meridian. On first use in flat mode each set builds a second copy of its
  corners as unwrapped longitude and latitude (rings that enclose a pole are closed along the pole, the map edge),
  drawn three times, 360 degrees apart, and clipped to the map outline by a stencil bit. A set that moves (move())
  is rebuilt on the next flat draw. GlobeGL.flatProject(p, lon, lat) and flatInvert(p, x, y) do the arithmetic on
  the processor (for hit tests); GL.canFlat() tells whether the card can. GL.night(rgba, sunLon, sunLat, twilight)
  shades the night side of a flat map (a veil faded across the terminator). Edges between corners are straight on
  the map, so sparse outlines want their corners densified; the land mask is stretched at high latitude in Mercator.

  * kind 'cylindricalEqualArea' (added 27/10/2026): a rectangular equal-area map, x = lambda * cos(p0), y = sin(phi) / cos(p0), y up,
    with the standard parallel p0 given as `parallel` in degrees (default 30 = Behrmann; 0 = Lambert; 45 = Gall-Peters). The outline
    is a rectangle 2*pi*cos(p0) wide and 2/cos(p0) high in projection units, and the whole of repeat, fillPattern, drawWide dashes,
    night(), the ocean/mask/zone passes and the hit-test helpers work as for the others (latClamp is ignored). Pages draw the same
    projection with d3 through GlobeGL.d3CylindricalEqualArea(parallel), which returns a d3.geoProjection (d3 has none of its own):
        GlobeGL.d3CylindricalEqualArea(30).rotate([-centreLon, 0]).scale(scale).translate([tx, ty])
    GlobeGL.flatWidth(kind, scale, parallel) gives the width in pixels of one whole-world copy (the repeat step), for any kind.

  Added later the same day:
  * frameFlat({..., repeat: true}) draws as many whole-world copies as the canvas needs (or repeat: [-1, 0, 1], whole
    copies counted from the central one), each clipped to its own outline, so pages need no extra passes. Every
    draw call below then runs once per copy (soft layers and coloured fills too); screen() is not repeated, and
    takes any outline. For hit tests fold x into the central copy first: GlobeGL.flatFold(p, x), which flatInvert
    does itself when p.repeat is set (with d3: x -= xw * Math.round((x - tx) / xw), xw = the map's width in
    pixels at the equator: 2*pi*scale for Mercator and equirectangular, about 5.4136*scale for Equal Earth). In Equal Earth the copies touch only at the equator.
  * GL.fillPattern(S, list, {kind, spacing, ink}) draws a hatch over the listed items (not overlapping one another)
    in globe and flat modes; kind 'diag' | 'back' | 'cross' | 'horiz' | 'vert' | 'grid' | 'dots', spacing in CSS
    pixels, ink 'both' | 'light' | 'dark', as the Data Visualiser's hatchTile. Paint the base colour first. The
    pattern is fixed to the screen from the canvas's top left and is DPR-aware. It is the same stencil fill with a
    different colour pass, so it costs about the same as fillMany.
  * GL.drawWide(L, colour, width, runs, [dash, gap]) draws dashed lines (CSS pixels, counted along each polyline from
    its first point, so they hold their place while the view pans or turns): on the globe by arc length times the
    radius, on a flat map by length in the projection's units times the scale. In Equal Earth the length is kept
    with each line's own middle as the central meridian, so the dashes stretch a little with distance from it.
  * GL.ocean on a flat map is one colour: col0 mixed 35% of the way to col1 (the gradient arguments are ignored).
    GL.night is flat only.
*/
(function () {
'use strict';

/* A corner on the far side is moved out along its own direction to the limb. The outline then winds round
   each point of the disc exactly as often as the part of the shape in view covers it, so a shape crossing the
   limb fills correctly with no clipping on the processor, provided its corners are close together (a long edge
   wholly behind the limb would cut across as a chord). Nothing changes for a shape wholly on the near side. */
var LIMB = '  vec2 s = vec2(dot(uFX, aV), dot(uFY, aV));\n' +
  '  if (dot(uVZ, aV) < 0.0) { float l = length(s); s = l > 1e-9 ? s * (uR / l) : vec2(uR, 0.0); }\n' +
  '  s += uC;\n';
var VS_SPHERE = '#version 300 es\n' +
  'in vec3 aV;\n' +
  'uniform vec3 uFX; uniform vec3 uFY; uniform vec3 uVZ; uniform float uR; uniform vec2 uC; uniform vec2 uSize;\n' +
  'void main() {\n' + LIMB +
  '  gl_Position = vec4(s.x / uSize.x * 2.0 - 1.0, 1.0 - s.y / uSize.y * 2.0, 0.0, 1.0);\n' +
  '}\n';
/* Lines on the sphere, with no clipping on the processor: a corner on the far side is given a depth beyond
   the far plane, so the card cuts every segment where it passes behind the globe. Corners on the near side sit
   on the near plane; a segment crossing the limb is cut within a hair of it. */
var VS_LINES = '#version 300 es\n' +
  'in vec3 aV;\n' +
  'uniform vec3 uFX; uniform vec3 uFY; uniform vec3 uVZ; uniform vec2 uC; uniform vec2 uSize;\n' +
  'void main() {\n' +
  '  vec2 s = vec2(dot(uFX, aV), dot(uFY, aV)) + uC;\n' +
  '  float z = max(-1.0, -dot(uVZ, aV) * 1000.0);\n' +
  '  gl_Position = vec4(s.x / uSize.x * 2.0 - 1.0, 1.0 - s.y / uSize.y * 2.0, z, 1.0);\n' +
  '}\n';
var VS_SCREEN = '#version 300 es\n' +
  'in vec2 aP;\n' +
  'uniform vec2 uSize;\n' +
  'void main() { gl_Position = vec4(aP.x / uSize.x * 2.0 - 1.0, 1.0 - aP.y / uSize.y * 2.0, 0.0, 1.0); }\n';
/* Wide lines: each segment an instance, a quad spanning its two ends, as wide as asked in screen pixels. The
   ends come from one list of points read twice, one point apart; a zero point separates the polylines, and a
   segment touching one is dropped. Cut at the limb by depth, as the thin lines are. */
var VS_WIDE = '#version 300 es\n' +
  'in vec3 aA; in vec3 aB; in vec2 aQ;\n' +
  'uniform vec3 uFX; uniform vec3 uFY; uniform vec3 uVZ; uniform vec2 uC; uniform vec2 uSize; uniform float uHalf;\n' +
  'void main() {\n' +
  '  if (dot(aA, aA) < 0.25 || dot(aB, aB) < 0.25) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }\n' +
  '  vec2 s0 = vec2(dot(uFX, aA), dot(uFY, aA)) + uC, s1 = vec2(dot(uFX, aB), dot(uFY, aB)) + uC;\n' +
  '  vec2 d = s1 - s0; float L = length(d); vec2 t = L > 1e-6 ? d / L : vec2(1.0, 0.0); vec2 n = vec2(-t.y, t.x);\n' +
  '  vec3 P = aQ.x < 0.5 ? aA : aB;\n' +
  '  vec2 s = (aQ.x < 0.5 ? s0 - t * uHalf * 0.5 : s1 + t * uHalf * 0.5) + n * aQ.y * uHalf;\n' +
  '  float z = max(-1.0, -dot(uVZ, P) * 1000.0);\n' +
  '  gl_Position = vec4(s.x / uSize.x * 2.0 - 1.0, 1.0 - s.y / uSize.y * 2.0, z, 1.0);\n' +
  '}\n';
/* Many fills of many colours in one call, for items that tile without overlapping (river valleys). Each fan
   triangle adds its corner colour where it faces the viewer and takes it away where it faces away, into a
   float image: the sum at a pixel is the winding number of each outline times its colour, so exactly the colour
   of the one item it lies in, and nothing outside them all. aS turns each ring so that outlines add and holes
   take away, whichever way the data winds them; uFlip fixes which way the card counts as facing. */
var VS_ACC = '#version 300 es\n' +
  'in vec3 aV; in vec4 aCol; in float aS;\n' +
  'uniform vec3 uFX; uniform vec3 uFY; uniform vec3 uVZ; uniform float uR; uniform vec2 uC; uniform vec2 uSize;\n' +
  'out vec4 vCol; out float vS;\n' +
  'void main() {\n' + LIMB +
  '  vCol = vec4(aCol.rgb * aCol.a, aCol.a); vS = aS;\n' +
  '  gl_Position = vec4(s.x / uSize.x * 2.0 - 1.0, 1.0 - s.y / uSize.y * 2.0, 0.0, 1.0);\n' +
  '}\n';
var FS_ACC = '#version 300 es\n' +
  'precision highp float;\n' +
  'in vec4 vCol; in float vS; uniform float uFlip;\n' +
  'out vec4 o;\n' +
  'void main() { o = vCol * (gl_FrontFacing ? vS : -vS) * uFlip; }\n';
var FS_ACCOUT = '#version 300 es\n' +
  'precision highp float;\n' +
  'uniform sampler2D uTex; uniform float uAlpha;\n' +
  'out vec4 o;\n' +
  'void main() { vec4 c = clamp(texelFetch(uTex, ivec2(gl_FragCoord.xy), 0), 0.0, 1.0); o = vec4(min(c.rgb, vec3(c.a)), c.a) * uAlpha; }\n';
var FS_FLAT = '#version 300 es\n' +
  'precision mediump float;\n' +
  'uniform vec4 uColour;\n' +
  'out vec4 o;\n' +
  'void main() { o = vec4(uColour.rgb * uColour.a, uColour.a); }\n';
/* the ocean, or a veil: a quad over the whole canvas, kept to the disc with a one-pixel soft edge */
var FS_DISC = '#version 300 es\n' +
  'precision highp float;\n' +
  'uniform vec2 uC; uniform float uR; uniform float uDPR; uniform float uHdev;\n' +
  'uniform vec2 uG0; uniform float uGr0; uniform vec2 uG1; uniform float uGr1;\n' +
  'uniform vec3 uCol0; uniform vec3 uCol1; uniform vec4 uVeil; uniform float uMode;\n' +
  'uniform vec3 uEX; uniform vec3 uEY; uniform vec3 uEZ; uniform float uUseMask; uniform float uLod;\n' +
  'uniform vec3 uLand; uniform sampler2D uMask;\n' +
  'uniform float uUseZones; uniform sampler2D uZones; uniform sampler2D uPal; uniform vec2 uZoneSize;\n' +
  'out vec4 o;\n' +
  'void main() {\n' +
  '  vec2 p = vec2(gl_FragCoord.x, uHdev - gl_FragCoord.y) / uDPR;\n' +
  '  float d = length(p - uC);\n' +
  '  float inside = clamp(uR - d + 0.5, 0.0, 1.0);\n' +
  '  if (inside <= 0.0) discard;\n' +
  '  vec4 c;\n' +
  '  if (uMode < 0.5) {\n' +
  /* as canvas does it: the largest t for which p lies on the circle between the two given, radius >= 0 */
  '    vec2 cd = uG1 - uG0, pd = p - uG0; float dr = uGr1 - uGr0;\n' +
  '    float A = dot(cd, cd) - dr * dr, B = dot(pd, cd) + uGr0 * dr, C = dot(pd, pd) - uGr0 * uGr0;\n' +
  '    float t = 0.0;\n' +
  '    if (abs(A) < 1e-6) t = C / (2.0 * B);\n' +
  '    else { float D = max(0.0, B * B - A * C), q = sqrt(D); float t1 = (B + q) / A, t2 = (B - q) / A;\n' +
  '      t = max(t1, t2); if (uGr0 + t * dr < 0.0) t = min(t1, t2); }\n' +
  '    t = clamp(t, 0.0, 1.0);\n' +
  '    c = vec4(mix(uCol0, uCol1, t), 1.0);\n' +
  /* where the pixel is on the sphere, and whether that is land: the inverse of the orthographic view */
  '    if (uUseMask > 0.5) {\n' +
  '      vec2 q = (p - uC) / uR; float zz = sqrt(max(0.0, 1.0 - dot(q, q)));\n' +
  '      vec3 v = uEX * q.x + uEY * q.y + uEZ * zz;\n' +
  '      vec2 uv = vec2(atan(v.y, v.x) / 6.2831853 + 0.5, 0.5 - asin(clamp(v.z, -1.0, 1.0)) / 3.1415927);\n' +
  '      float m = textureLod(uMask, uv, uLod).r;\n' +
  '      c.rgb = mix(c.rgb, uLand, m);\n' +
  /* regions as a map of ids: the id under the pixel, exactly (no filtering), then its colour from the palette */
  '      if (uUseZones > 0.5) {\n' +
  '        ivec2 tp = ivec2(clamp(uv * uZoneSize, vec2(0.0), uZoneSize - 1.0));\n' +
  '        vec4 zz4 = texelFetch(uZones, tp, 0);\n' +
  '        int id = int(zz4.r * 255.0 + 0.5) + int(zz4.g * 255.0 + 0.5) * 256;\n' +
  '        vec4 pc = texelFetch(uPal, ivec2(id, 0), 0);\n' +
  '        c.rgb = mix(c.rgb, pc.rgb, pc.a);\n' +
  '      }\n' +
  '    }\n' +
  '  } else c = uVeil;\n' +
  '  c.a *= inside;\n' +
  '  o = vec4(c.rgb * c.a, c.a);\n' +
  '}\n';
/* Soft layers. What is drawn between layerBegin and layerEnd goes to an offscreen image at half resolution,
   which is blurred (a Gaussian in two passes) and laid over the frame, kept to the land by the land mask so that
   a soft edge never spills over a coastline. For borders known only roughly: the width is given by the page. */
var FS_BLUR = '#version 300 es\n' +
  'precision highp float;\n' +
  'uniform sampler2D uTex; uniform vec2 uRes; uniform vec2 uDir; uniform float uStep;\n' +
  'out vec4 o;\n' +
  'void main() {\n' +
  '  vec2 uv = gl_FragCoord.xy / uRes;\n' +
  '  vec4 acc = vec4(0.0); float wsum = 0.0;\n' +
  '  for (int k = -7; k <= 7; k++) {\n' +
  '    float t = float(k) / 3.5;\n' +
  '    float w = exp(-0.5 * t * t);\n' +
  '    acc += texture(uTex, uv + uDir * float(k) * uStep / uRes) * w; wsum += w;\n' +
  '  }\n' +
  '  o = acc / wsum;\n' +
  '}\n';
var FS_COMP = '#version 300 es\n' +
  'precision highp float;\n' +
  'uniform sampler2D uTex; uniform vec2 uDev; uniform float uAlpha;\n' +
  'uniform vec2 uC; uniform float uR; uniform float uDPR; uniform float uHdev;\n' +
  'uniform vec3 uEX; uniform vec3 uEY; uniform vec3 uEZ; uniform float uUseMask; uniform float uLod; uniform sampler2D uMask;\n' +
  'out vec4 o;\n' +
  'void main() {\n' +
  '  vec2 p = vec2(gl_FragCoord.x, uHdev - gl_FragCoord.y) / uDPR;\n' +
  '  vec2 q = (p - uC) / uR;\n' +
  '  float d2 = dot(q, q);\n' +
  '  if (d2 >= 1.0) discard;\n' +
  '  float m = 1.0;\n' +
  '  if (uUseMask > 0.5) {\n' +
  '    vec3 v = uEX * q.x + uEY * q.y + uEZ * sqrt(1.0 - d2);\n' +
  '    vec2 uv = vec2(atan(v.y, v.x) / 6.2831853 + 0.5, 0.5 - asin(clamp(v.z, -1.0, 1.0)) / 3.1415927);\n' +
  '    m = smoothstep(0.25, 0.75, textureLod(uMask, uv, uLod).r);\n' +
  '  }\n' +
  '  o = texture(uTex, gl_FragCoord.xy / uDev) * (m * uAlpha);\n' +
  '}\n';

/* Hatching: the colour pass of a stencil fill drawn as a pattern fixed to the screen instead of a flat colour,
   the look of the page's hatchTile: a dark stroke (rgba 6,10,18,.72; 2.1 px, or 1.5 alone) with a light one over it
   (white .8; 0.9 px, or 1.1 alone) as ink 'both', 'dark' or 'light', in tiles of uSp CSS pixels from the canvas's
   top left. uHK: 0 diag, 1 back, 2 cross, 3 horiz, 4 vert, 5 grid, 6 dots. */
var FS_HATCH = '#version 300 es\n' +
  'precision highp float;\n' +
  'uniform float uHK; uniform float uSp; uniform float uInk; uniform float uDPR; uniform float uHdev;\n' +
  'out vec4 o;\n' +
  'float cov(float d, float hw) { return clamp((hw - d) * uDPR + 0.5, 0.0, 1.0); }\n' +
  'float fam(float v, float period) { return abs(mod(v + 0.5 * period, period) - 0.5 * period); }\n' +
  'float strokes(vec2 p, float hw) {\n' +
  '  float s = uSp, d = 1e9;\n' +
  '  if (uHK < 0.5 || (uHK > 1.5 && uHK < 2.5)) d = min(d, fam(p.x + p.y, s) * 0.7071068);\n' +
  '  if ((uHK > 0.5 && uHK < 1.5) || (uHK > 1.5 && uHK < 2.5)) d = min(d, fam(p.x - p.y, s) * 0.7071068);\n' +
  '  if ((uHK > 2.5 && uHK < 3.5) || (uHK > 4.5 && uHK < 5.5)) d = min(d, abs(mod(p.y, s) - 0.5 * s));\n' +
  '  if ((uHK > 3.5 && uHK < 4.5) || (uHK > 4.5 && uHK < 5.5)) d = min(d, abs(mod(p.x, s) - 0.5 * s));\n' +
  '  return cov(d, hw * 0.5);\n' +
  '}\n' +
  'float dots(vec2 p, float r) { return cov(length(mod(p, uSp) - 0.5 * uSp), r); }\n' +
  'void main() {\n' +
  '  vec2 p = vec2(gl_FragCoord.x, uHdev - gl_FragCoord.y) / uDPR;\n' +
  '  float dk = 0.0, lt = 0.0, r = min(uSp * 0.2, 2.2);\n' +
  '  bool dot = uHK > 5.5;\n' +
  /* uInk: 0 both, 1 dark, 2 light */
  '  if (uInk < 1.5) dk = dot ? dots(p, r) : strokes(p, uInk < 0.5 ? 2.1 : 1.5);\n' +
  '  if (uInk != 1.0) lt = dot ? dots(p, uInk > 1.5 ? r * 0.8 : r * 0.6) : strokes(p, uInk > 1.5 ? 1.1 : 0.9);\n' +
  '  float ad = 0.72 * dk, al = 0.8 * lt;\n' +
  '  vec3 rgb = vec3(1.0) * al + vec3(6.0, 10.0, 18.0) / 255.0 * ad * (1.0 - al);\n' +
  '  o = vec4(rgb, al + ad * (1.0 - al));\n' +
  '}\n';

/* ---- flat maps. Corners arrive as (longitude, latitude) in radians, longitude unwrapped along each ring so that
   no edge ever jumps across the seam; the world is drawn three times (gl_InstanceID 0..2, or uShift for wide
   lines) 360 degrees apart, and the page's central meridian is subtracted here. The formulas are d3's. */
var FLATGLSL = 'const float PI = 3.141592653589793; const float M = 0.8660254037844386;\n' +
  'const float A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796;\n' +
  'uniform float uKind; uniform float uCl; uniform float uK; uniform vec2 uT; uniform float uLim; uniform float uYmax;\n' +
  'vec2 fproj(float lam, float phi) {\n' +
  '  if (uKind < 0.5) { float th = asin(M * sin(phi)), t2 = th * th, t6 = t2 * t2 * t2;\n' +
  '    return vec2(lam * cos(th) / (M * (A1 + 3.0 * A2 * t2 + t6 * (7.0 * A3 + 9.0 * A4 * t2))), th * (A1 + A2 * t2 + t6 * (A3 + A4 * t2))); }\n' +
  '  if (uKind < 1.5) return vec2(lam, log(tan(0.7853981633974483 + 0.5 * clamp(phi, -uLim, uLim))));\n' +
  '  if (uKind > 2.5) return vec2(lam * uLim, sin(phi) / uLim);\n' +
  '  return vec2(lam, phi);\n' +
  '}\n';
var VS_FLAT = '#version 300 es\n' +
  'in vec2 aV;\n' +
  'uniform vec2 uSize;\n' + FLATGLSL +
  'void main() {\n' +
  '  vec2 u = fproj(aV.x - uCl + 6.283185307179586 * float(gl_InstanceID - 1), aV.y);\n' +
  '  vec2 s = vec2(uT.x + uK * u.x, uT.y - uK * u.y);\n' +
  '  gl_Position = vec4(s.x / uSize.x * 2.0 - 1.0, 1.0 - s.y / uSize.y * 2.0, 0.0, 1.0);\n' +
  '}\n';
var VS_ACC_FLAT = '#version 300 es\n' +
  'in vec2 aV; in vec4 aCol; in float aS;\n' +
  'uniform vec2 uSize;\n' + FLATGLSL +
  'out vec4 vCol; out float vS;\n' +
  'void main() {\n' +
  '  vec2 u = fproj(aV.x - uCl + 6.283185307179586 * float(gl_InstanceID - 1), aV.y);\n' +
  '  vec2 s = vec2(uT.x + uK * u.x, uT.y - uK * u.y);\n' +
  '  vCol = vec4(aCol.rgb * aCol.a, aCol.a); vS = aS;\n' +
  '  gl_Position = vec4(s.x / uSize.x * 2.0 - 1.0, 1.0 - s.y / uSize.y * 2.0, 0.0, 1.0);\n' +
  '}\n';
/* a latitude of 99 radians marks the gap between polylines */
var VS_WIDE_FLAT = '#version 300 es\n' +
  'in vec2 aA; in vec2 aB; in vec2 aQ;\n' +
  'uniform vec2 uSize; uniform float uHalf; uniform float uShift;\n' + FLATGLSL +
  'void main() {\n' +
  '  if (aA.y > 5.0 || aB.y > 5.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }\n' +
  '  vec2 ua = fproj(aA.x - uCl + uShift, aA.y), ub = fproj(aB.x - uCl + uShift, aB.y);\n' +
  '  vec2 s0 = vec2(uT.x + uK * ua.x, uT.y - uK * ua.y), s1 = vec2(uT.x + uK * ub.x, uT.y - uK * ub.y);\n' +
  '  vec2 d = s1 - s0; float L = length(d); vec2 t = L > 1e-6 ? d / L : vec2(1.0, 0.0); vec2 n = vec2(-t.y, t.x);\n' +
  '  vec2 s = (aQ.x < 0.5 ? s0 - t * uHalf * 0.5 : s1 + t * uHalf * 0.5) + n * aQ.y * uHalf;\n' +
  '  gl_Position = vec4(s.x / uSize.x * 2.0 - 1.0, 1.0 - s.y / uSize.y * 2.0, 0.0, 1.0);\n' +
  '}\n';
/* Dashed wide lines: the same quads with the distance along the line in screen pixels carried to the fragments. The
   distance is counted from the start of each polyline, from a cumulative length kept per corner: on the sphere the
   angle along the great circle times the globe's radius in pixels, on a flat map the length in the projection's own
   units times the scale (worked out once per projection, with the line's own middle as its central meridian), so
   the dashes keep their place while the view pans or turns and stretch with the zoom. */
var VS_WIDE_D = '#version 300 es\n' +
  'in vec3 aA; in vec3 aB; in vec2 aQ; in float aDA; in float aDB;\n' +
  'uniform vec3 uFX; uniform vec3 uFY; uniform vec3 uVZ; uniform vec2 uC; uniform vec2 uSize; uniform float uHalf; uniform float uR;\n' +
  'out float vD;\n' +
  'void main() {\n' +
  '  if (dot(aA, aA) < 0.25 || dot(aB, aB) < 0.25) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }\n' +
  '  vec2 s0 = vec2(dot(uFX, aA), dot(uFY, aA)) + uC, s1 = vec2(dot(uFX, aB), dot(uFY, aB)) + uC;\n' +
  '  vec2 d = s1 - s0; float L = length(d); vec2 t = L > 1e-6 ? d / L : vec2(1.0, 0.0); vec2 n = vec2(-t.y, t.x);\n' +
  '  vec3 P = aQ.x < 0.5 ? aA : aB;\n' +
  '  vec2 s = (aQ.x < 0.5 ? s0 - t * uHalf * 0.5 : s1 + t * uHalf * 0.5) + n * aQ.y * uHalf;\n' +
  '  vD = aQ.x < 0.5 ? aDA * uR - uHalf * 0.5 : aDB * uR + uHalf * 0.5;\n' +
  '  float z = max(-1.0, -dot(uVZ, P) * 1000.0);\n' +
  '  gl_Position = vec4(s.x / uSize.x * 2.0 - 1.0, 1.0 - s.y / uSize.y * 2.0, z, 1.0);\n' +
  '}\n';
var VS_WIDE_FLAT_D = '#version 300 es\n' +
  'in vec2 aA; in vec2 aB; in vec2 aQ; in float aDA; in float aDB;\n' +
  'uniform vec2 uSize; uniform float uHalf; uniform float uShift;\n' + FLATGLSL +
  'out float vD;\n' +
  'void main() {\n' +
  '  if (aA.y > 5.0 || aB.y > 5.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }\n' +
  '  vec2 ua = fproj(aA.x - uCl + uShift, aA.y), ub = fproj(aB.x - uCl + uShift, aB.y);\n' +
  '  vec2 s0 = vec2(uT.x + uK * ua.x, uT.y - uK * ua.y), s1 = vec2(uT.x + uK * ub.x, uT.y - uK * ub.y);\n' +
  '  vec2 d = s1 - s0; float L = length(d); vec2 t = L > 1e-6 ? d / L : vec2(1.0, 0.0); vec2 n = vec2(-t.y, t.x);\n' +
  '  vec2 s = (aQ.x < 0.5 ? s0 - t * uHalf * 0.5 : s1 + t * uHalf * 0.5) + n * aQ.y * uHalf;\n' +
  '  vD = aQ.x < 0.5 ? aDA * uK - uHalf * 0.5 : aDB * uK + uHalf * 0.5;\n' +
  '  gl_Position = vec4(s.x / uSize.x * 2.0 - 1.0, 1.0 - s.y / uSize.y * 2.0, 0.0, 1.0);\n' +
  '}\n';
var FS_DASH = '#version 300 es\n' +
  'precision highp float;\n' +
  'uniform vec4 uColour; uniform vec2 uDash;\n' +
  'in float vD; out vec4 o;\n' +
  'void main() {\n' +
  '  float t = mod(vD, uDash.x + uDash.y);\n' +
  '  float a = clamp(t + 0.5, 0.0, 1.0) * clamp(uDash.x - t + 0.5, 0.0, 1.0) * uColour.a;\n' +
  '  o = vec4(uColour.rgb * a, a);\n' +
  '}\n';
/* the pixel back to longitude (relative to the central meridian) and latitude, and how far inside the map
   outline it lies in pixels (soft edge): the inverse of fproj */
var FLATINV = 'float funproj(vec2 p, out vec2 ll) {\n' +
  '  vec2 u = vec2(p.x - uT.x, uT.y - p.y) / uK;\n' +
  '  float lam, phi, dx, dy = (uYmax - abs(u.y)) * uK;\n' +
  '  if (uKind < 0.5) {\n' +
  '    float t = clamp(u.y / 1.26, -1.0471975511965976, 1.0471975511965976), t2, t6, f;\n' +
  '    for (int i = 0; i < 7; i++) { t2 = t * t; t6 = t2 * t2 * t2;\n' +
  '      t -= (t * (A1 + A2 * t2 + t6 * (A3 + A4 * t2)) - u.y) / (A1 + 3.0 * A2 * t2 + t6 * (7.0 * A3 + 9.0 * A4 * t2)); }\n' +
  '    t = clamp(t, -1.0471975511965976, 1.0471975511965976); t2 = t * t; t6 = t2 * t2 * t2;\n' +
  '    f = M * (A1 + 3.0 * A2 * t2 + t6 * (7.0 * A3 + 9.0 * A4 * t2));\n' +
  '    lam = u.x * f / cos(t); phi = asin(clamp(sin(t) / M, -1.0, 1.0));\n' +
  '    dx = (PI - abs(lam)) * uK * cos(t) / f;\n' +
  '  } else if (uKind > 2.5) {\n' +
  '    lam = u.x / uLim; phi = asin(clamp(u.y * uLim, -1.0, 1.0));\n' +
  '    dx = (PI - abs(lam)) * uK * uLim;\n' +
  '  } else {\n' +
  '    lam = u.x; phi = uKind < 1.5 ? 2.0 * atan(exp(u.y)) - 1.5707963267948966 : u.y;\n' +
  '    dx = (PI - abs(lam)) * uK;\n' +
  '  }\n' +
  '  ll = vec2(lam, phi);\n' +
  '  return clamp(min(dx, dy) + 0.5, 0.0, 1.0);\n' +
  '}\n';
/* the ocean of a flat map (a flat colour, the land from the mask by the inverse projection, regions by id), or a
   veil, kept to the map outline. The mask is read with explicit gradients of its coordinates, so the level of
   detail follows the projection (finer land towards the poles of Equal Earth, Mercator's stretch) with no seam. */
var FS_OCEAN_FLAT = '#version 300 es\n' +
  'precision highp float;\n' + FLATGLSL + FLATINV +
  'uniform float uDPR; uniform float uHdev;\n' +
  'uniform vec3 uCol0; uniform vec3 uCol1; uniform vec4 uVeil; uniform float uMode; uniform vec3 uSun; uniform float uTw;\n' +
  'uniform float uUseMask; uniform vec3 uLand; uniform sampler2D uMask;\n' +
  'uniform float uUseZones; uniform sampler2D uZones; uniform sampler2D uPal; uniform vec2 uZoneSize;\n' +
  'out vec4 o;\n' +
  'void main() {\n' +
  '  vec2 p = vec2(gl_FragCoord.x, uHdev - gl_FragCoord.y) / uDPR, ll;\n' +
  '  float inside = funproj(p, ll);\n' +
  '  vec2 uv = vec2((ll.x + uCl) / 6.283185307179586 + 0.5, 0.5 - ll.y / PI);\n' +
  '  vec2 gx = dFdx(uv), gy = dFdy(uv);\n' +
  '  if (inside <= 0.0) discard;\n' +
  '  vec4 c;\n' +
  '  if (uMode < 0.5) {\n' +
  '    c = vec4(mix(uCol0, uCol1, 0.35), 1.0);\n' +
  '    if (uUseMask > 0.5) {\n' +
  '      float m = textureGrad(uMask, uv, gx, gy).r;\n' +
  '      c.rgb = mix(c.rgb, uLand, m);\n' +
  '      if (uUseZones > 0.5) {\n' +
  '        ivec2 tp = ivec2(clamp(vec2(fract(uv.x), uv.y) * uZoneSize, vec2(0.0), uZoneSize - 1.0));\n' +
  '        vec4 zz4 = texelFetch(uZones, tp, 0);\n' +
  '        int id = int(zz4.r * 255.0 + 0.5) + int(zz4.g * 255.0 + 0.5) * 256;\n' +
  '        vec4 pc = texelFetch(uPal, ivec2(id, 0), 0);\n' +
  '        c.rgb = mix(c.rgb, pc.rgb, pc.a);\n' +
  '      }\n' +
  '    }\n' +
  '  } else {\n' +
  '    c = uVeil;\n' +
  /* night: the veil fades in across the terminator, where the sun is uTw (sine of the twilight angle) below the horizon */
  '    if (uMode > 1.5) { float la = ll.x + uCl; vec3 nv = vec3(cos(ll.y) * cos(la), cos(ll.y) * sin(la), sin(ll.y)); c.a *= 1.0 - smoothstep(-max(uTw, 1e-4), max(uTw, 1e-4), dot(nv, uSun)); }\n' +
  '  }\n' +
  '  c.a *= inside;\n' +
  '  o = vec4(c.rgb * c.a, c.a);\n' +
  '}\n';
var FS_COMP_FLAT = '#version 300 es\n' +
  'precision highp float;\n' + FLATGLSL + FLATINV +
  'uniform sampler2D uTex; uniform vec2 uDev; uniform float uAlpha; uniform float uDPR; uniform float uHdev;\n' +
  'uniform float uUseMask; uniform sampler2D uMask;\n' +
  'out vec4 o;\n' +
  'void main() {\n' +
  '  vec2 p = vec2(gl_FragCoord.x, uHdev - gl_FragCoord.y) / uDPR, ll;\n' +
  '  float inside = funproj(p, ll);\n' +
  '  vec2 uv = vec2((ll.x + uCl) / 6.283185307179586 + 0.5, 0.5 - ll.y / PI);\n' +
  '  vec2 gx = dFdx(uv), gy = dFdy(uv);\n' +
  '  if (inside <= 0.0) discard;\n' +
  '  float m = 1.0;\n' +
  '  if (uUseMask > 0.5) m = smoothstep(0.25, 0.75, textureGrad(uMask, uv, gx, gy).r);\n' +
  '  o = texture(uTex, gl_FragCoord.xy / uDev) * (m * uAlpha * inside);\n' +
  '}\n';

function compile(gl, type, src) {
  var sh = gl.createShader(type);
  gl.shaderSource(sh, src); gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}
function program(gl, vs, fs) {
  var p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'aV');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (var i = 0; i < n; i++) { var a = gl.getActiveUniform(p, i); u[a.name] = gl.getUniformLocation(p, a.name); }
  return { p: p, u: u };
}

function create(canvas) {
  var gl = null;
  try { gl = canvas.getContext('webgl2', { stencil: true, antialias: true, premultipliedAlpha: true, alpha: true }); } catch (e) { gl = null; }
  if (!gl) return null;
  var sphereP, screenP, discP, lineP, blurP, compP;
  try {
    sphereP = program(gl, VS_SPHERE, FS_FLAT);
    lineP = program(gl, VS_LINES, FS_FLAT);
    screenP = program(gl, VS_SCREEN, FS_FLAT);
    discP = program(gl, VS_SCREEN, FS_DISC);
    blurP = program(gl, VS_SCREEN, FS_BLUR);
    compP = program(gl, VS_SCREEN, FS_COMP);
  } catch (err) {
    if (window.console) console.warn('GlobeGL: falling back to 2D:', err.message);
    return null;
  }
  /* the later additions are optional: a page that does not use them must not lose the card over them */
  var wideP = null, accP = null, accOutP = null;
  try { wideP = program(gl, VS_WIDE, FS_FLAT); } catch (err) { wideP = null; }
  try { accP = program(gl, VS_ACC, FS_ACC); accOutP = program(gl, VS_SCREEN, FS_ACCOUT); } catch (err) { accP = null; }
  /* flat maps are optional too: without them canFlat() says no and the page stays on its 2D path */
  var flatP = null, fwideP = null, faccP = null, oceanFlatP = null, compFlatP = null, flat = null, outlineOn = false;
  try {
    flatP = program(gl, VS_FLAT, FS_FLAT); oceanFlatP = program(gl, VS_SCREEN, FS_OCEAN_FLAT); compFlatP = program(gl, VS_SCREEN, FS_COMP_FLAT);
  } catch (err) { flatP = null; if (window.console) console.warn('GlobeGL: no flat maps:', err.message); }
  var patSphereP = null, patFlatP = null, wideDashP = null, fwideDashP = null;
  try { wideDashP = program(gl, VS_WIDE_D, FS_DASH); } catch (err) { wideDashP = null; }
  try { patSphereP = program(gl, VS_SPHERE, FS_HATCH); } catch (err) { patSphereP = null; }
  if (flatP) {
    try { patFlatP = program(gl, VS_FLAT, FS_HATCH); } catch (err) { patFlatP = null; }
    try { fwideP = program(gl, VS_WIDE_FLAT, FS_FLAT); } catch (err) { fwideP = null; }
    try { fwideDashP = program(gl, VS_WIDE_FLAT_D, FS_DASH); } catch (err) { fwideDashP = null; }
    try { faccP = program(gl, VS_ACC_FLAT, FS_ACC); } catch (err) { faccP = null; }
  }
  var W = 1, H = 1, DPR = 1, view = { fx: [0, 0, 0], fy: [0, 0, 0], cx: 0, cy: 0, r: 1, vz: [1, 0, 0] };
  var maskTex = null, maskW = 0, zoneTex = null, zoneW = 0, zoneH = 0, palTex = null;

  /* one quad over the canvas, for the ocean and the veil */
  var quadVao = gl.createVertexArray(), quadBuf = gl.createBuffer();
  gl.bindVertexArray(quadVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  var aPd = gl.getAttribLocation(discP.p, 'aP');
  gl.enableVertexAttribArray(aPd);
  gl.vertexAttribPointer(aPd, 2, gl.FLOAT, false, 0, 0);

  /* the stream buffer for polygons clipped at the limb, in screen coordinates */
  var scrVao = gl.createVertexArray(), scrBuf = gl.createBuffer(), scrIdx = gl.createBuffer();
  gl.bindVertexArray(scrVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, scrBuf);
  var aPs = gl.getAttribLocation(screenP.p, 'aP');
  gl.enableVertexAttribArray(aPs);
  gl.vertexAttribPointer(aPs, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, scrIdx);
  gl.bindVertexArray(null);

  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.DEPTH_TEST);

  var current = null;
  function use(P) {
    if (current === P) return;
    current = P; gl.useProgram(P.p);
    if (P.u.uSize) gl.uniform2f(P.u.uSize, W, H);
    if (flat && (P === flatP || P === fwideP || P === faccP || P === oceanFlatP || P === compFlatP || P === patFlatP || P === fwideDashP)) setFlatU(P);
    if (P === sphereP || P === lineP || P === wideP || P === accP || P === patSphereP || P === wideDashP) {
      gl.uniform3fv(P.u.uFX, view.fx); gl.uniform3fv(P.u.uFY, view.fy); gl.uniform2f(P.u.uC, view.cx, view.cy);
    }
    if (P === lineP || P === wideP || P === sphereP || P === accP || P === patSphereP || P === wideDashP) gl.uniform3fv(P.u.uVZ, view.vz);
    if (P === sphereP || P === accP || P === patSphereP || P === wideDashP) gl.uniform1f(P.u.uR, view.r);
  }
  /* flat maps: the projection's uniforms, one draw call for the three copies of the world, and the map outline
     kept in stencil bit 7 (0x80) so that nothing draws outside it; the even-odd fill uses bit 0 */
  function setFlatU(P) {
    var u = P.u;
    if (u.uKind != null) gl.uniform1f(u.uKind, flat.kind);
    if (u.uCl != null) gl.uniform1f(u.uCl, flat.cl);
    if (u.uK != null) gl.uniform1f(u.uK, flat.k);
    if (u.uT != null) gl.uniform2f(u.uT, flat.tx + flat.off, flat.ty);
    if (u.uLim != null) gl.uniform1f(u.uLim, flat.lim);
    if (u.uYmax != null) gl.uniform1f(u.uYmax, flat.ymax);
  }
  function de(mode, count, off) {
    if (flat && current !== screenP) gl.drawElementsInstanced(mode, count, gl.UNSIGNED_INT, off, 3);
    else gl.drawElements(mode, count, gl.UNSIGNED_INT, off);
  }
  function clipOn() {
    if (!flat || !outlineOn) return;
    gl.enable(gl.STENCIL_TEST); gl.stencilFunc(gl.EQUAL, flat.ref, 0xfe); gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
  }
  /* the copies of the map (repeat): one pass per copy of the draw calls, each clipped to its own outline, whose
     stencil value is 0x80 plus twice its number; screen() takes any outline */
  function eachCopy(fn) {
    if (!flat || flat.copies.length < 2) return fn();
    for (var c = 0; c < flat.copies.length; c++) { flat.off = flat.copies[c].off; flat.ref = flat.copies[c].ref; current = null; fn(); }
    flat.off = 0; flat.ref = 0x80; current = null;
  }
  function clipOff() { if (flat && outlineOn) gl.disable(gl.STENCIL_TEST); }
  /* the colour pass of a hatch: the pattern's program and its uniforms in place of a flat colour */
  var HATCH = { diag: 0, back: 1, cross: 2, horiz: 3, vert: 4, grid: 5, dots: 6 };
  function setPat(o) {
    var P = flat ? patFlatP : patSphereP;
    use(P);
    gl.uniform1f(P.u.uHK, HATCH[o.kind] || 0); gl.uniform1f(P.u.uSp, o.spacing || 9);
    gl.uniform1f(P.u.uInk, o.ink === 'dark' ? 1 : o.ink === 'light' ? 2 : 0);
    gl.uniform1f(P.u.uDPR, DPR); gl.uniform1f(P.u.uHdev, canvas.height);
  }
  function stencilFill(count, colour, drawFn, pat) {
    if (flat && outlineOn) {
      gl.enable(gl.STENCIL_TEST); gl.stencilMask(0x01);
      gl.colorMask(false, false, false, false);
      var sr = current === screenP ? 0x80 : flat.ref, sm = current === screenP ? 0x80 : 0xfe;
      gl.stencilFunc(gl.EQUAL, sr, sm); gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
      drawFn();
      gl.colorMask(true, true, true, true);
      gl.stencilFunc(gl.EQUAL, sr | 1, sm | 1); gl.stencilOp(gl.ZERO, gl.ZERO, gl.ZERO);
      if (pat) setPat(pat); else gl.uniform4fv(current.u.uColour, colour);
      drawFn();
      gl.stencilMask(0xff); gl.disable(gl.STENCIL_TEST);
      return;
    }
    /* pass 1: flip the stencil wherever a fan triangle lands */
    gl.enable(gl.STENCIL_TEST);
    gl.colorMask(false, false, false, false);
    gl.stencilFunc(gl.ALWAYS, 0, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
    drawFn();
    /* pass 2: paint where the count came out odd, and put the stencil back to nothing */
    gl.colorMask(true, true, true, true);
    gl.stencilFunc(gl.NOTEQUAL, 0, 0xff);
    gl.stencilOp(gl.ZERO, gl.ZERO, gl.ZERO);
    if (pat) setPat(pat); else gl.uniform4fv(current.u.uColour, colour);
    drawFn();
    gl.disable(gl.STENCIL_TEST);
  }

  /* fan triangles and border segments for a list of rings, appended to the arrays given */
  function addRings(rings, dims, verts, tri, lines, base) {
    for (var r = 0; r < rings.length; r++) {
      var a = rings[r], n = a.length / dims;
      if (n < 3) continue;
      var first = base.v;
      for (var k = 0; k < a.length; k++) verts.push(a[k]);
      base.v += n;
      /* a closed ring repeats its first corner at the end; the fan and the segments cope either way */
      for (var t = 1; t < n - 1; t++) tri.push(first, first + t, first + t + 1);
      for (var s = 0; s < n - 1; s++) lines.push(first + s, first + s + 1);
    }
  }

  function gather(S, list, which, colour, pat) {
    if (flat) S = flatOf(S);
    if (!S) return;
    var total = 0, i, r;
    for (i = 0; i < list.length; i++) { r = S.ranges[list[i]]; if (r) total += r[which]; }
    if (!total) return;
    var out = new Uint32Array(total), at = 0, off = which === 1 ? 0 : S.triLen;
    for (i = 0; i < list.length; i++) {
      r = S.ranges[list[i]];
      if (!r || !r[which]) continue;
      var from = off + r[which - 1];
      out.set(S.idx.subarray(from, from + r[which]), at); at += r[which];
    }
    use(flat ? flatP : which === 1 ? sphereP : lineP);
    gl.bindVertexArray(S.vao2);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, out, gl.STREAM_DRAW);
    if (which === 1) stencilFill(total, colour, function () { de(gl.TRIANGLES, total, 0); }, pat);
    else { gl.uniform4fv((flat ? flatP : lineP).u.uColour, colour); clipOn(); de(gl.LINES, total, 0); clipOff(); }
  }

  /* the soft layer: two half-resolution images, the first with a stencil for the fills drawn into it */
  var layer = null, quadVaos = {}, quadQ = null, accOn = false;
  function quadFor(P) {
    var key = P === blurP ? 'b' : P === compP ? 'c' : P === compFlatP ? 'f' : 'a';
    if (quadVaos[key]) return quadVaos[key];
    var v = gl.createVertexArray();
    gl.bindVertexArray(v); gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    var a = gl.getAttribLocation(P.p, 'aP'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return (quadVaos[key] = v);
  }
  function ensureLayer() {
    var w = Math.max(1, Math.round(canvas.width / 2)), h = Math.max(1, Math.round(canvas.height / 2));
    if (layer && layer.w === w && layer.h === h) return layer;
    if (layer) { layer.tex.forEach(function (t) { gl.deleteTexture(t); }); layer.fbo.forEach(function (f) { gl.deleteFramebuffer(f); }); gl.deleteRenderbuffer(layer.rb); }
    layer = { w: w, h: h, tex: [], fbo: [], rb: gl.createRenderbuffer() };
    gl.bindRenderbuffer(gl.RENDERBUFFER, layer.rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, w, h);
    for (var k = 0; k < 2; k++) {
      var t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      var f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      if (k === 0) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, layer.rb);
      layer.tex.push(t); layer.fbo.push(f);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return layer;
  }

  var blank = null;
  function blankTex() {
    if (blank) return blank;
    blank = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, blank);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    return blank;
  }

  /* the float image the coloured fills add into: 32-bit where the card can blend it, else 16-bit; multisampled
     where the card allows, within a budget of samples, and resolved into a texture to lay over the frame */
  var accFmt = null, acc = null, accFlip = 1;
  if (accP && gl.getExtension('EXT_color_buffer_float')) accFmt = gl.getExtension('EXT_float_blend') ? gl.RGBA32F : gl.RGBA16F;
  function ensureAcc() {
    var w = canvas.width, h = canvas.height;
    if (acc && acc.w === w && acc.h === h) return acc;
    if (acc) { gl.deleteTexture(acc.tex); gl.deleteFramebuffer(acc.fbo); if (acc.rb) { gl.deleteRenderbuffer(acc.rb); gl.deleteFramebuffer(acc.msFbo); } }
    acc = { w: w, h: h, tex: gl.createTexture(), fbo: gl.createFramebuffer(), rb: null, msFbo: null };
    gl.bindTexture(gl.TEXTURE_2D, acc.tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, accFmt, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, acc.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, acc.tex, 0);
    var ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE, samples = 0;
    if (ok) {
      var avail = gl.getInternalformatParameter(gl.RENDERBUFFER, accFmt, gl.SAMPLES) || [];
      for (var k = 0; k < avail.length; k++) if (avail[k] <= 4 && avail[k] * w * h <= 16e6 && avail[k] > samples) samples = avail[k];
    }
    if (ok && samples > 1) {
      acc.rb = gl.createRenderbuffer(); acc.msFbo = gl.createFramebuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, acc.rb);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, accFmt, w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, acc.msFbo);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, acc.rb);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        gl.deleteRenderbuffer(acc.rb); gl.deleteFramebuffer(acc.msFbo); acc.rb = acc.msFbo = null;
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) { accFmt = null; acc = null; }
    return acc;
  }
  /* the orientation of a ring seen from outside the sphere: +1 one way round, -1 the other */
  function ringTurn(a) {
    var n = a.length / 3, cx = 0, cy = 0, cz = 0, sx = 0, sy = 0, sz = 0;
    for (var i = 0; i < n; i++) {
      var j = (i + 1) % n, x0 = a[i * 3], y0 = a[i * 3 + 1], z0 = a[i * 3 + 2], x1 = a[j * 3], y1 = a[j * 3 + 1], z1 = a[j * 3 + 2];
      cx += x0; cy += y0; cz += z0;
      sx += y0 * z1 - z0 * y1; sy += z0 * x1 - x0 * z1; sz += x0 * y1 - y0 * x1;
    }
    return sx * cx + sy * cy + sz * cz >= 0 ? 1 : -1;
  }

  /* ---- flat maps: the second copy of a set's corners.
     Each ring's longitude is unwrapped along the ring (every step takes the short way round), so no edge ever
     jumps across the 180th meridian and a shape crossing it is simply one shape reaching past +-180. The ring is
     then shifted by whole turns until its middle lies within (-180, 180]; the shader draws it at -360, 0 and +360
     degrees, and whichever copy lands on the map shows. Corners at a pole have no longitude and are dropped. If the
     unwrapped ring has gone once round the globe it encloses a pole: it is closed through that pole (up the
     meridian where it ended, along the pole, down the meridian where it began), which is the map edge in Equal
     Earth and equirectangular and the clamp in Mercator. The border lines are the original edges only. */
  var TAU = 2 * Math.PI, HPI = Math.PI / 2;
  /* scratch space for building flat copies, reused so that a set that moves every frame costs no garbage */
  var SL = new Float64Array(1024), SP = new Float64Array(1024), SO = new Int32Array(1024);
  function Bgrow(B, nv, nt, nl) {
    if ((B.v + nv) * 2 > B.ll.length) { var q = new Float32Array(Math.max(B.ll.length * 2, (B.v + nv) * 2 + 1024)); q.set(B.ll); B.ll = q; var g = new Int8Array(q.length / 2); g.set(B.sg); B.sg = g; }
    if (B.nt + nt > B.tri.length) { var t = new Uint32Array(Math.max(B.tri.length * 2, B.nt + nt + 1024)); t.set(B.tri); B.tri = t; }
    if (B.nl + nl > B.li.length) { var l = new Uint32Array(Math.max(B.li.length * 2, B.nl + nl + 1024)); l.set(B.li); B.li = l; }
  }
  function flatRing(a, o, n, hole, B) {
    if (SL.length < n + 256) { SL = new Float64Array(n + 512); SP = new Float64Array(n + 512); SO = new Int32Array(n + 512); }
    var L = SL, P = SP, O = SO, have = false, prev = 0, cum = 0, i, k, m = 0;
    for (i = 0; i < n; i++) {
      var x = a[o + i * 3], y = a[o + i * 3 + 1], z = a[o + i * 3 + 2], h = Math.sqrt(x * x + y * y);
      if (h < 1e-5) continue;
      var l = Math.atan2(y, x);
      if (have) cum += l - prev - TAU * Math.round((l - prev) / TAU); else { cum = l; have = true; }
      prev = l; L[m] = cum; P[m] = Math.atan2(z, h); O[m] = i; m++;
    }
    if (m < 3) return;
    var raw0 = L[0], dc = raw0 - prev - TAU * Math.round((raw0 - prev) / TAU);
    var W = Math.round((L[m - 1] - L[0] + dc) / TAU), N = m;
    if (W) {
      var mean = 0, lend = L[0] + TAU * W, p0 = P[0], l0 = L[0];
      for (i = 0; i < m; i++) mean += P[i];
      var pole = mean >= 0 ? HPI : -HPI, nm = Math.max(1, Math.ceil(Math.abs(pole - p0) / 0.06)), np = 14;
      L[N] = lend; P[N++] = p0;
      for (k = 1; k <= nm; k++) { L[N] = lend; P[N++] = p0 + (pole - p0) * k / nm; }
      for (k = 1; k <= np; k++) { L[N] = lend + (l0 - lend) * k / np; P[N++] = pole; }
      for (k = 1; k < nm; k++) { L[N] = l0; P[N++] = pole + (p0 - pole) * k / nm; }
    }
    var mn = Infinity, mx = -Infinity, area = 0;
    for (i = 0; i < N; i++) {
      if (L[i] < mn) mn = L[i]; if (L[i] > mx) mx = L[i];
      var j = i + 1 === N ? 0 : i + 1; area += L[i] * P[j] - L[j] * P[i];
    }
    Bgrow(B, N, (N - 2) * 3, (m - 1) * 2);
    var shift = -TAU * Math.floor(((mn + mx) / 2 + Math.PI) / TAU), s = (hole ? -1 : 1) * (area >= 0 ? 1 : -1), first = B.v;
    var ll = B.ll, sg = B.sg, at = first * 2;
    for (i = 0; i < N; i++) { ll[at++] = L[i] + shift; ll[at++] = P[i]; sg[first + i] = s; }
    B.v += N;
    var tri = B.tri, nt = B.nt;
    for (i = 1; i < N - 1; i++) { tri[nt++] = first; tri[nt++] = first + i; tri[nt++] = first + i + 1; }
    B.nt = nt;
    var li = B.li, nl = B.nl;
    for (i = 0; i < m - 1; i++) if (O[i + 1] === O[i] + 1) { li[nl++] = first + i; li[nl++] = first + i + 1; }
    B.nl = nl;
  }
  /* a polyline unwrapped and shifted the same way; a corner at a pole takes its neighbour's longitude, so
     meridians run into the pole. Appends longitude and latitude to ll and returns the number of corners. */
  function flatPoly(a, o, m, ll) {
    var X = [], Y = [], have = false, prev = 0, cum = 0, i, first = -1;
    for (i = 0; i < m; i++) {
      var x = a[o + i * 3], y = a[o + i * 3 + 1], z = a[o + i * 3 + 2], h = Math.sqrt(x * x + y * y);
      Y.push(Math.atan2(z, h));
      if (h < 1e-5) { X.push(have ? cum : null); continue; }
      var l = Math.atan2(y, x);
      if (have) cum += l - prev - TAU * Math.round((l - prev) / TAU); else { cum = l; have = true; first = i; }
      prev = l; X.push(cum);
    }
    if (first < 0) return 0;
    for (i = 0; i < first; i++) X[i] = X[first];
    var mn = Infinity, mx = -Infinity;
    for (i = 0; i < m; i++) { if (X[i] < mn) mn = X[i]; if (X[i] > mx) mx = X[i]; }
    var shift = -TAU * Math.floor(((mn + mx) / 2 + Math.PI) / TAU);
    for (i = 0; i < m; i++) ll.push(X[i] + shift, Y[i]);
    return m;
  }
  var FB = { ll: new Float32Array(4096), sg: new Int8Array(2048), tri: new Uint32Array(4096), li: new Uint32Array(4096), v: 0, nt: 0, nl: 0 };
  function flatOf(S) {
    if (S.f && !S.fdirty) return S.f;
    var fresh = !S.f, T = S.f, B = FB, ranges = [], first = [], cnt = [], i, r;
    B.v = 0; B.nt = 0; B.nl = 0;
    for (i = 0; i < S.rm.length; i++) {
      var t0 = B.nt, l0 = B.nl, v0 = B.v, rl = S.rm[i];
      for (r = 0; r < rl.length; r++) {
        var rg = rl[r];
        if (S.xyz) flatRing(S.xyz, rg[0] * 3, rg[1], rg[2], B);
        else flatRing(S.items[i][rg[3]], 0, rg[1], rg[2], B);
      }
      ranges.push([t0, B.nt - t0, l0, B.nl - l0]); first.push(v0); cnt.push(B.v - v0);
    }
    if (fresh) {
      T = S.f = { vao: gl.createVertexArray(), vb: gl.createBuffer(), ib: gl.createBuffer(), vao2: gl.createVertexArray(), sib: gl.createBuffer(), vao3: null };
      gl.bindVertexArray(T.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, T.vb);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(T.vao2);
      gl.bindBuffer(gl.ARRAY_BUFFER, T.vb);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, T.sib);
      if (S.vao3 && faccP) {
        T.vao3 = gl.createVertexArray(); T.sgb = gl.createBuffer(); T.colb = gl.createBuffer(); T.aib = gl.createBuffer();
        gl.bindVertexArray(T.vao3);
        gl.bindBuffer(gl.ARRAY_BUFFER, T.vb); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        var aS = gl.getAttribLocation(faccP.p, 'aS'), aC = gl.getAttribLocation(faccP.p, 'aCol');
        gl.bindBuffer(gl.ARRAY_BUFFER, T.sgb); gl.enableVertexAttribArray(aS); gl.vertexAttribPointer(aS, 1, gl.BYTE, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, T.colb); gl.enableVertexAttribArray(aC); gl.vertexAttribPointer(aC, 4, gl.UNSIGNED_BYTE, true, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, T.aib);
      }
      gl.bindVertexArray(null);
    }
    var usage = fresh ? gl.STATIC_DRAW : gl.DYNAMIC_DRAW;
    gl.bindVertexArray(T.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, T.vb); gl.bufferData(gl.ARRAY_BUFFER, B.ll.subarray(0, B.v * 2), usage);
    var nT = B.nt, nL = B.nl, same = !fresh && T.idx && T.idx.length === nT + nL, k;
    if (same) {
      var old = T.idx;
      for (k = 0; k < nT && same; k++) if (old[k] !== B.tri[k]) same = false;
      for (k = 0; k < nL && same; k++) if (old[nT + k] !== B.li[k]) same = false;
    }
    var idx = T.idx;
    if (!same) {
      idx = new Uint32Array(nT + nL);
      idx.set(B.tri.subarray(0, nT), 0); idx.set(B.li.subarray(0, nL), nT);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, T.ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, usage);
    }
    T.idx = idx; T.ranges = ranges; T.triLen = nT; T.verts = B.v; T.first = first; T.cnt = cnt;
    if (T.vao3) {
      gl.bindVertexArray(T.vao3);
      gl.bindBuffer(gl.ARRAY_BUFFER, T.sgb); gl.bufferData(gl.ARRAY_BUFFER, B.sg.subarray(0, B.v), usage);
      gl.bindBuffer(gl.ARRAY_BUFFER, T.colb); gl.bufferData(gl.ARRAY_BUFFER, T.verts * 4, usage);
      if (S.cols) flatColours(T, S.cols);
    }
    gl.bindVertexArray(null);
    S.fdirty = false;
    return T;
  }
  function flatColours(T, bytes) {
    var v = new Uint8Array(T.verts * 4);
    for (var i = 0; i < T.first.length; i++) {
      var c0 = bytes[i * 4], c1 = bytes[i * 4 + 1], c2 = bytes[i * 4 + 2], c3 = bytes[i * 4 + 3];
      for (var k = T.first[i], e = k + T.cnt[i]; k < e; k++) { v[k * 4] = c0; v[k * 4 + 1] = c1; v[k * 4 + 2] = c2; v[k * 4 + 3] = c3; }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, T.colb); gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
  }
  function dropFlat(S) {
    var T = S.f;
    if (!T) return;
    gl.deleteVertexArray(T.vao); gl.deleteBuffer(T.vb); gl.deleteBuffer(T.ib); gl.deleteVertexArray(T.vao2); gl.deleteBuffer(T.sib);
    if (T.vao3) { gl.deleteVertexArray(T.vao3); gl.deleteBuffer(T.sgb); gl.deleteBuffer(T.colb); gl.deleteBuffer(T.aib); }
    S.f = null;
  }
  function flatLinesOf(L) {
    if (L.f && !L.fdirty) return L.f;
    var ll = [], idx = [], base = 0, i;
    for (i = 0; i < L.pl.length; i++) {
      var m = L.xyz ? flatPoly(L.xyz, L.pl[i][0] * 3, L.pl[i][1], ll) : flatPoly(L.lines[L.pl[i][2]], 0, L.pl[i][1], ll);
      for (var t = 0; t < m - 1; t++) idx.push(base + t, base + t + 1);
      base += m;
    }
    if (!L.f) {
      L.f = { vao: gl.createVertexArray(), vb: gl.createBuffer(), ib: gl.createBuffer(), count: 0 };
      gl.bindVertexArray(L.f.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, L.f.vb); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, L.f.ib);
    } else gl.bindVertexArray(L.f.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, L.f.vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(ll), gl.STATIC_DRAW);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW);
    L.f.count = idx.length; L.fdirty = false;
    gl.bindVertexArray(null);
    return L.f;
  }
  function flatWideOf(L) {
    if (L.f) return L.f;
    var pts = new Float32Array(L.pts * 2 + 2), at = 0, i, tmp;
    for (i = 0; i < L.n; i++) {
      tmp = [];
      var m = flatPoly(L.src[i], 0, L.count[i], tmp);
      if (m !== L.count[i]) { tmp = []; for (var q = 0; q < L.count[i]; q++) tmp.push(0, 0); }
      pts.set(tmp, at * 2); at += L.count[i];
      pts[at * 2] = 0; pts[at * 2 + 1] = 99; at++;
    }
    var F = L.f = { vao: gl.createVertexArray(), vb: gl.createBuffer(), pts: pts, cb: null, cumKind: -1, d: null };
    gl.bindVertexArray(F.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadQ);
    var aQ = gl.getAttribLocation(fwideP.p, 'aQ');
    gl.enableVertexAttribArray(aQ); gl.vertexAttribPointer(aQ, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, F.vb);
    gl.bufferData(gl.ARRAY_BUFFER, pts, gl.STATIC_DRAW);
    F.aA = gl.getAttribLocation(fwideP.p, 'aA'); F.aB = gl.getAttribLocation(fwideP.p, 'aB');
    gl.enableVertexAttribArray(F.aA); gl.vertexAttribDivisor(F.aA, 1);
    gl.enableVertexAttribArray(F.aB); gl.vertexAttribDivisor(F.aB, 1);
    gl.bindVertexArray(null);
    return F;
  }
  /* the map outline, a convex polygon fanned from the origin, in screen pixels */
  function outlinePts(off) {
    var tx = flat.tx + off, pts = [tx, flat.ty], k, n = 96, p, ph;
    function put(lam, phi) { var q = flatRaw(flat.kind, lam, phi, flat.lim); pts.push(tx + flat.k * q[0], flat.ty - flat.k * q[1]); }
    if (flat.kind === 0) {
      for (k = 0; k <= n; k++) put(Math.PI, HPI - Math.PI * k / n);
      for (k = 0; k <= n; k++) put(-Math.PI, -HPI + Math.PI * k / n);
      put(Math.PI, HPI);
    } else {
      var y = flat.ymax, x = flat.kind === 3 ? Math.PI * flat.lim : Math.PI, e = flat.k;
      pts.push(tx + x * e, flat.ty - y * e, tx + x * e, flat.ty + y * e, tx - x * e, flat.ty + y * e, tx - x * e, flat.ty - y * e, tx + x * e, flat.ty - y * e);
    }
    return pts;
  }
  function outlineStencil() {
    use(screenP);
    gl.bindVertexArray(scrVao); gl.bindBuffer(gl.ARRAY_BUFFER, scrBuf);
    gl.enable(gl.STENCIL_TEST); gl.colorMask(false, false, false, false);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE); gl.stencilMask(0xfe);
    for (var c = 0; c < flat.copies.length; c++) {
      var pts = outlinePts(flat.copies[c].off);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.STREAM_DRAW);
      gl.stencilFunc(gl.ALWAYS, flat.copies[c].ref, 0xff);
      gl.drawArrays(gl.TRIANGLE_FAN, 0, pts.length / 2);
    }
    gl.colorMask(true, true, true, true); gl.stencilMask(0xff); gl.disable(gl.STENCIL_TEST);
  }
  var accQ = null;
  function accDraw(S, list) {
    var i;
    if (flat) S = flatOf(S);
    var total = 0, r;
    for (i = 0; i < list.length; i++) { r = S.ranges[list[i]]; if (r) total += r[1]; }
    if (!total) return;
    var out = new Uint32Array(total), at = 0;
    for (i = 0; i < list.length; i++) {
      r = S.ranges[list[i]];
      if (!r || !r[1]) continue;
      out.set(S.idx.subarray(r[0], r[0] + r[1]), at); at += r[1];
    }
    var AP = flat ? faccP : accP;
    use(AP);
    gl.uniform1f(AP.u.uFlip, accFlip);
    gl.bindVertexArray(S.vao3);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, out, gl.STREAM_DRAW);
    de(gl.TRIANGLES, total, 0);
  }
  function accCompose(alpha) {
    if (acc.msFbo) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, acc.msFbo); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, acc.fbo);
      gl.blitFramebuffer(0, 0, acc.w, acc.h, 0, 0, acc.w, acc.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    use(accOutP);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, acc.tex);
    gl.uniform1i(accOutP.u.uTex, 3); gl.uniform1f(accOutP.u.uAlpha, alpha === undefined ? 1 : alpha);
    gl.bindVertexArray(quadFor(accOutP));
    clipOn(); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); clipOff();
    current = null;
  }
  /* dashes: the cumulative length at every corner (see VS_WIDE_D) and a vertex array that reads it */
  function dashVao(P, src, cb, dims) {
    var D = { vao: gl.createVertexArray(), src: src, cb: cb, dims: dims };
    gl.bindVertexArray(D.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadQ);
    var aQ = gl.getAttribLocation(P.p, 'aQ'); gl.enableVertexAttribArray(aQ); gl.vertexAttribPointer(aQ, 2, gl.FLOAT, false, 0, 0);
    D.aA = gl.getAttribLocation(P.p, 'aA'); D.aB = gl.getAttribLocation(P.p, 'aB'); D.aDA = gl.getAttribLocation(P.p, 'aDA'); D.aDB = gl.getAttribLocation(P.p, 'aDB');
    [D.aA, D.aB, D.aDA, D.aDB].forEach(function (a) { gl.enableVertexAttribArray(a); gl.vertexAttribDivisor(a, 1); });
    gl.bindVertexArray(null);
    return D;
  }
  function cumBuffer(cum, old) {
    var b = old || gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, cum, gl.STATIC_DRAW);
    return b;
  }
  function globeDash(L) {
    if (L.d) return L.d;
    var cum = new Float32Array(L.pts + 1), i, k;
    for (i = 0; i < L.n; i++) {
      var a = L.src[i], st = L.start[i], run = 0;
      for (k = 1; k < L.count[i]; k++) {
        var x0 = a[k * 3 - 3], y0 = a[k * 3 - 2], z0 = a[k * 3 - 1], x1 = a[k * 3], y1 = a[k * 3 + 1], z1 = a[k * 3 + 2];
        var cx = y0 * z1 - z0 * y1, cy = z0 * x1 - x0 * z1, cz = x0 * y1 - y0 * x1;
        run += Math.atan2(Math.sqrt(cx * cx + cy * cy + cz * cz), x0 * x1 + y0 * y1 + z0 * z1);
        cum[st + k] = run;
      }
    }
    return (L.d = dashVao(wideDashP, L.vb, cumBuffer(cum), 3));
  }
  function flatDash(L, F) {
    if (!F.d) F.d = dashVao(fwideDashP, F.vb, null, 2);
    if (F.cumKind === flat.key) return F.d;
    var cum = new Float32Array(L.pts + 1), i, k, lim = flat.kind === 3 ? flat.lim : 85 * Math.PI / 180;
    for (i = 0; i < L.n; i++) {
      var st = L.start[i], n = L.count[i], mn = Infinity, mx = -Infinity, run = 0, px = 0, py = 0;
      for (k = 0; k < n; k++) { var lo = F.pts[(st + k) * 2]; if (lo < mn) mn = lo; if (lo > mx) mx = lo; }
      for (k = 0; k < n; k++) {
        var q = flatRaw(flat.kind, F.pts[(st + k) * 2] - (mn + mx) / 2, F.pts[(st + k) * 2 + 1], lim);
        if (k) run += Math.sqrt((q[0] - px) * (q[0] - px) + (q[1] - py) * (q[1] - py));
        px = q[0]; py = q[1]; cum[st + k] = run;
      }
    }
    F.cb = F.d.cb = cumBuffer(cum, F.cb);
    F.cumKind = flat.key;
    return F.d;
  }
  function wideRuns(L, runs, fn) {
    var list = runs || [[0, L.n]];
    for (var k = 0; k < list.length; k++) {
      var a = list[k][0], b = list[k][1];
      while (k + 1 < list.length && list[k + 1][0] === b) b = list[++k][1];
      if (b <= a) continue;
      var first = L.start[a], n = L.start[b - 1] + L.count[b - 1] - 1 - first;
      if (n < 1) continue;
      fn(first, n);
    }
  }
  function dashDraw(D, L, runs, shifts, P) {
    gl.bindVertexArray(D.vao);
    wideRuns(L, runs, function (first, n) {
      var e = D.dims * 4;
      gl.bindBuffer(gl.ARRAY_BUFFER, D.src);
      gl.vertexAttribPointer(D.aA, D.dims, gl.FLOAT, false, 0, first * e);
      gl.vertexAttribPointer(D.aB, D.dims, gl.FLOAT, false, 0, (first + 1) * e);
      gl.bindBuffer(gl.ARRAY_BUFFER, D.cb);
      gl.vertexAttribPointer(D.aDA, 1, gl.FLOAT, false, 0, first * 4);
      gl.vertexAttribPointer(D.aDB, 1, gl.FLOAT, false, 0, (first + 1) * 4);
      for (var c3 = 0; c3 < shifts.length; c3++) {
        if (P.u.uShift != null) gl.uniform1f(P.u.uShift, shifts[c3]);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
      }
    });
  }
  function drawWideFlat(L, colour, width, runs, dash) {
    var P = dash && fwideDashP ? fwideDashP : fwideP;
    if (!P) return;
    var F = flatWideOf(L);
    use(P);
    var c = colour;
    if (width < 1) { c = [colour[0], colour[1], colour[2], colour[3] * width]; width = 1; }
    gl.uniform4fv(P.u.uColour, c); gl.uniform1f(P.u.uHalf, width / 2);
    clipOn();
    if (P === fwideDashP) {
      gl.uniform2f(P.u.uDash, dash[0], dash[1]);
      dashDraw(flatDash(L, F), L, runs, [-TAU, 0, TAU], P);
    } else {
      gl.bindVertexArray(F.vao); gl.bindBuffer(gl.ARRAY_BUFFER, F.vb);
      wideRuns(L, runs, function (first, n) {
        gl.vertexAttribPointer(F.aA, 2, gl.FLOAT, false, 0, first * 8);
        gl.vertexAttribPointer(F.aB, 2, gl.FLOAT, false, 0, (first + 1) * 8);
        for (var c3 = -1; c3 <= 1; c3++) { gl.uniform1f(fwideP.u.uShift, c3 * TAU); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n); }
      });
    }
    clipOff();
  }
  function oceanFlat(col0, col1, land, zones) {
    use(oceanFlatP);
    var u = oceanFlatP.u;
    var useZones = !!(zones && zoneTex && palTex);
    var useMask = !!((land || useZones) && (maskTex || useZones));
    gl.uniform1f(u.uUseMask, useMask ? 1 : 0);
    gl.uniform1f(u.uUseZones, useZones ? 1 : 0);
    if (useZones) {
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, zoneTex); gl.uniform1i(u.uZones, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, palTex); gl.uniform1i(u.uPal, 2);
      gl.uniform2f(u.uZoneSize, zoneW, zoneH);
    }
    if (useMask) {
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, land && maskTex ? maskTex : blankTex()); gl.uniform1i(u.uMask, 0);
      gl.uniform3fv(u.uLand, land || [0, 0, 0]);
    }
    gl.uniform1f(u.uDPR, DPR); gl.uniform1f(u.uHdev, canvas.height);
    gl.uniform3fv(u.uCol0, col0); gl.uniform3fv(u.uCol1, col1); gl.uniform1f(u.uMode, 0);
    gl.bindVertexArray(quadFor(oceanFlatP)); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  var api = {
    gl: gl,
    resize: function (w, h, dpr) {
      W = w; H = h; DPR = dpr;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, w, 0, 0, h, w, h]), gl.STATIC_DRAW);
      current = null;
    },
    /* start a frame: the view in the same terms as the page's fast projection */
    frame: function (fx, fy, cx, cy, r, vz) {
      view = { fx: fx, fy: fy, cx: cx, cy: cy, r: r, vz: vz || [1, 0, 0] };
      flat = null; outlineOn = false;
      current = null;
      gl.clearColor(0, 0, 0, 0); gl.clearStencil(0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    },
    /* start a frame as a flat map (see the note at the top); false if the card cannot */
    frameFlat: function (p) {
      if (!flatP) return false;
      var kd = flatKind(p), lim = flatLim(p, kd);
      flat = { kind: kd, cl: (p.centreLon || 0) * Math.PI / 180, k: p.scale, tx: p.tx, ty: p.ty, lim: lim, key: kd === 3 ? 3 + lim : kd, ymax: flatRaw(kd, 0, HPI, lim)[1], off: 0, ref: 0x80, copies: null };
      var list = [0];
      if (p.repeat) {
        var xw = 2 * flatRaw(kd, Math.PI, 0, lim)[0] * p.scale;
        if (p.repeat === true) {
          list = [];
          for (var q = -8; q <= 8; q++) if (p.tx + q * xw + xw / 2 > 0 && p.tx + q * xw - xw / 2 < W) list.push(q);
          if (!list.length) list = [0];
        } else list = p.repeat.slice();
        list = list.slice(0, 16);
        flat.xw = xw;
      }
      flat.copies = list.map(function (q, i) { return { off: q * (flat.xw || 0), ref: 0x80 | (i << 1) }; });
      flat.off = flat.copies[0].off; flat.ref = flat.copies[0].ref;
      if (list.length === 1 && list[0] === 0) { flat.off = 0; flat.ref = 0x80; }
      flat.main = flat.copies.length < 2;
      outlineOn = true; current = null;
      gl.clearColor(0, 0, 0, 0); gl.clearStencil(0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      outlineStencil();
      return true;
    },
    canFlat: function () { return !!flatP; },
    /* flat maps only: a shade over the night side, given the sun's subsolar point (degrees) and the width of the
       twilight band (degrees of sun angle, default 6); rgba as for veil. Not yet in globe mode (does nothing). */
    night: function (rgba, sunLon, sunLat, twilight) {
      if (!flat) return;
      var D = Math.PI / 180, cp = Math.cos(sunLat * D);
      use(oceanFlatP);
      var u = oceanFlatP.u;
      gl.uniform1f(u.uDPR, DPR); gl.uniform1f(u.uHdev, canvas.height);
      gl.uniform4fv(u.uVeil, rgba); gl.uniform1f(u.uMode, 2);
      gl.uniform3f(u.uSun, cp * Math.cos(sunLon * D), cp * Math.sin(sunLon * D), Math.sin(sunLat * D));
      gl.uniform1f(u.uTw, Math.sin((twilight == null ? 6 : twilight) * D));
      gl.bindVertexArray(quadFor(oceanFlatP)); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    ocean: function (col0, col1, g0x, g0y, gr0, g1x, g1y, gr1, land, zones) {
      if (flat) return oceanFlat(col0, col1, land, zones);
      use(discP);
      var u = discP.u, r = view.r;
      var useZones = !!(zones && zoneTex && palTex);
      var useMask = !!((land || useZones) && (maskTex || useZones));
      gl.uniform1f(u.uUseMask, useMask ? 1 : 0);
      gl.uniform1f(u.uUseZones, useZones ? 1 : 0);
      if (useZones) {
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, zoneTex); gl.uniform1i(u.uZones, 1);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, palTex); gl.uniform1i(u.uPal, 2);
        gl.uniform2f(u.uZoneSize, zoneW, zoneH);
      }
      if (useMask) {
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, land && maskTex ? maskTex : blankTex()); gl.uniform1i(u.uMask, 0);
        gl.uniform3f(u.uEX, view.fx[0] / r, view.fx[1] / r, view.fx[2] / r);
        gl.uniform3f(u.uEY, view.fy[0] / r, view.fy[1] / r, view.fy[2] / r);
        gl.uniform3fv(u.uEZ, view.vz); gl.uniform3fv(u.uLand, land || [0, 0, 0]);
        /* texels per screen pixel at the centre of the disc sets the level of detail */
        gl.uniform1f(u.uLod, Math.max(0, Math.log2(maskW / (2 * Math.PI * r))));
      }
      gl.uniform2f(u.uC, view.cx, view.cy); gl.uniform1f(u.uR, view.r);
      gl.uniform1f(u.uDPR, DPR); gl.uniform1f(u.uHdev, canvas.height);
      gl.uniform2f(u.uG0, g0x, g0y); gl.uniform1f(u.uGr0, gr0); gl.uniform2f(u.uG1, g1x, g1y); gl.uniform1f(u.uGr1, gr1);
      gl.uniform3fv(u.uCol0, col0); gl.uniform3fv(u.uCol1, col1); gl.uniform1f(u.uMode, 0);
      gl.bindVertexArray(quadVao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    veil: function (rgba) {
      if (flat) {
        use(oceanFlatP);
        gl.uniform1f(oceanFlatP.u.uDPR, DPR); gl.uniform1f(oceanFlatP.u.uHdev, canvas.height);
        gl.uniform4fv(oceanFlatP.u.uVeil, rgba); gl.uniform1f(oceanFlatP.u.uMode, 1);
        gl.bindVertexArray(quadFor(oceanFlatP)); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        return;
      }
      use(discP);
      var u = discP.u;
      gl.uniform2f(u.uC, view.cx, view.cy); gl.uniform1f(u.uR, view.r);
      gl.uniform1f(u.uDPR, DPR); gl.uniform1f(u.uHdev, canvas.height);
      gl.uniform4fv(u.uVeil, rgba); gl.uniform1f(u.uMode, 1);
      gl.bindVertexArray(quadVao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    /* a set of items, each a list of rings of unit vectors (Float32Array x,y,z,...), uploaded once */
    set: function (items) {
      var verts = [], tri = [], lines = [], base = { v: 0 }, ranges = [], rm = [];
      for (var i = 0; i < items.length; i++) {
        var t0 = tri.length, l0 = lines.length, rl = [], bv = base.v;
        for (var q = 0; q < items[i].length; q++) {
          var qn = items[i][q].length / 3;
          if (qn >= 3) { rl.push([bv, qn, items[i][q].hole ? 1 : 0, q]); bv += qn; }
        }
        rm.push(rl);
        addRings(items[i], 3, verts, tri, lines, base);
        ranges.push([t0, tri.length - t0, l0, lines.length - l0]);
      }
      var S = { vao: gl.createVertexArray(), vb: gl.createBuffer(), ib: gl.createBuffer(), ranges: ranges,
                triLen: tri.length, verts: base.v, rm: rm, items: items, xyz: null, f: null, fdirty: false,
                /* a second view of the same corners, with indices gathered each frame for batched calls */
                vao2: gl.createVertexArray(), sib: gl.createBuffer(), idx: null };
      gl.bindVertexArray(S.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, S.vb);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
      var aV = gl.getAttribLocation(sphereP.p, 'aV');
      gl.enableVertexAttribArray(aV);
      gl.vertexAttribPointer(aV, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, S.ib);
      var idx = new Uint32Array(tri.length + lines.length);
      idx.set(tri, 0); idx.set(lines, tri.length);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      S.idx = idx;
      gl.bindVertexArray(S.vao2);
      gl.bindBuffer(gl.ARRAY_BUFFER, S.vb);
      gl.enableVertexAttribArray(aV);
      gl.vertexAttribPointer(aV, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, S.sib);
      gl.bindVertexArray(null);
      return S;
    },
    /* new corners for a set or a line set made earlier, in the same order and number (shapes that move) */
    move: function (S, verts) {
      if (!S) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, S.vb);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts);
      S.xyz = verts; S.fdirty = true;
    },
    drop: function (S) {
      if (!S) return;
      gl.deleteVertexArray(S.vao); gl.deleteBuffer(S.vb); gl.deleteBuffer(S.ib);
      gl.deleteVertexArray(S.vao2); gl.deleteBuffer(S.sib);
      dropFlat(S);
    },
    fill: function (S, i, colour) {
      if (flat) S = flatOf(S);
      var r = S.ranges[i];
      if (!r || !r[1]) return;
      use(flat ? flatP : sphereP);
      gl.bindVertexArray(S.vao);
      stencilFill(r[1], colour, function () { de(gl.TRIANGLES, r[1], r[0] * 4); });
    },
    lines: function (S, i, colour) {
      if (flat) S = flatOf(S);
      var r = S.ranges[i];
      if (!r || !r[3]) return;
      use(flat ? flatP : lineP);
      gl.bindVertexArray(S.vao);
      gl.uniform4fv((flat ? flatP : lineP).u.uColour, colour);
      clipOn(); de(gl.LINES, r[3], (S.triLen + r[2]) * 4); clipOff();
    },
    /* Many items in one call. Every WebGL call has a fixed cost, and at the world view the land alone was
       170 fills. Items filled together must not overlap one another (the stencil counts them as one shape),
       which holds for countries; lines have no such limit. */
    fillMany: function (S, list, colour) { gather(S, list, 1, colour); },
    linesMany: function (S, list, colour) { gather(S, list, 3, colour); },
    /* a screen-space hatch over the listed items (which must not overlap), in globe and flat modes: o = {kind:
       'diag'|'back'|'cross'|'horiz'|'vert'|'grid'|'dots', spacing (CSS px), ink: 'both'|'light'|'dark'}; draw the base
       colour first. Tiles start at the canvas's top left, as the page's 2D patterns do. False if unavailable. */
    fillPattern: function (S, list, o) {
      if (!(flat ? patFlatP : patSphereP)) return false;
      gather(S, list, 1, null, o);
      return true;
    },
    /* Static lines (coasts, borders, meshes): a list of polylines of unit vectors, uploaded once and drawn in
       one call, clipped at the limb by the card. */
    lineSet: function (lines) {
      var verts = [], idx = [], base = 0, pl = [];
      for (var i = 0; i < lines.length; i++) {
        var a = lines[i], m = a.length / 3;
        if (m < 2) continue;
        for (var k = 0; k < a.length; k++) verts.push(a[k]);
        for (var t = 0; t < m - 1; t++) idx.push(base + t, base + t + 1);
        pl.push([base, m, i]);
        base += m;
      }
      var L = { vao: gl.createVertexArray(), vb: gl.createBuffer(), ib: gl.createBuffer(), count: idx.length, pl: pl, lines: lines, xyz: null, f: null, fdirty: false };
      gl.bindVertexArray(L.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, L.vb);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
      var aV = gl.getAttribLocation(lineP.p, 'aV');
      gl.enableVertexAttribArray(aV);
      gl.vertexAttribPointer(aV, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, L.ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      return L;
    },
    drawLines: function (L, colour) {
      if (!L || !L.count) return;
      if (flat) {
        var F = flatLinesOf(L);
        use(flatP);
        gl.bindVertexArray(F.vao);
        gl.uniform4fv(flatP.u.uColour, colour);
        clipOn(); de(gl.LINES, F.count, 0); clipOff();
        return;
      }
      use(lineP);
      gl.bindVertexArray(L.vao);
      gl.uniform4fv(lineP.u.uColour, colour);
      gl.drawElements(gl.LINES, L.count, gl.UNSIGNED_INT, 0);
    },
    dropLines: function (L) {
      if (!L) return;
      gl.deleteVertexArray(L.vao); gl.deleteBuffer(L.vb); gl.deleteBuffer(L.ib);
      if (L.f) { gl.deleteVertexArray(L.f.vao); gl.deleteBuffer(L.f.vb); gl.deleteBuffer(L.f.ib); L.f = null; }
    },
    /* a polygon already clipped and projected by the page: rings of screen x,y pairs */
    screen: function (rings, fillColour, lineColour) {
      var verts = [], tri = [], lines = [], base = { v: 0 };
      addRings(rings, 2, verts, tri, lines, base);
      if (!tri.length) return;
      use(screenP);
      gl.bindVertexArray(scrVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, scrBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STREAM_DRAW);
      var idx = new Uint32Array(tri.length + lines.length);
      idx.set(tri, 0); idx.set(lines, tri.length);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, scrIdx);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STREAM_DRAW);
      if (fillColour) stencilFill(tri.length, fillColour, function () { gl.drawElements(gl.TRIANGLES, tri.length, gl.UNSIGNED_INT, 0); });
      if (lineColour && lines.length) {
        gl.uniform4fv(screenP.u.uColour, lineColour);
        gl.drawElements(gl.LINES, lines.length, gl.UNSIGNED_INT, tri.length * 4);
      }
    },
    /* the land, drawn flat (equirectangular) on a canvas by the page, for the ocean pass to look up */
    landMask: function (cv) {
      maskTex = gl.createTexture(); maskW = cv.width;
      gl.bindTexture(gl.TEXTURE_2D, maskTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, cv);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.generateMipmap(gl.TEXTURE_2D);
    },
    hasMask: function () { return !!maskTex; },
    /* a map of region ids (RGBA bytes: id in red and green) and a palette of colours by id, for regions that
       tile the land without overlapping, such as time zones */
    zoneMap: function (w, h, bytes) {
      zoneTex = gl.createTexture(); zoneW = w; zoneH = h;
      gl.bindTexture(gl.TEXTURE_2D, zoneTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    },
    hasZones: function () { return !!zoneTex; },
    palette: function (bytes) {
      if (!palTex) palTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, palTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, bytes.length / 4, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    },
    /* draw into the soft layer until layerEnd */
    layerBegin: function () {
      var L = ensureLayer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, L.fbo[0]);
      gl.viewport(0, 0, L.w, L.h);
      gl.clearColor(0, 0, 0, 0); gl.clearStencil(0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      current = null;
      if (flat) { if (flat.copies.length > 1) outlineStencil(); else outlineOn = false; }   /* one copy: wrapped content may blur across the seam, the outline is applied on laying it over */
    },
    /* blur what was drawn by radiusPx (screen pixels, about two standard deviations) and lay it over the frame,
       kept to the land where the land mask is loaded */
    layerEnd: function (radiusPx, alpha) {
      var L = layer, step = Math.max(0.3, radiusPx * DPR / 2 / 3.5);
      gl.disable(gl.BLEND);
      use(blurP);
      gl.uniform2f(blurP.u.uRes, L.w, L.h); gl.uniform1f(blurP.u.uStep, step); gl.uniform1i(blurP.u.uTex, 3);
      gl.bindVertexArray(quadFor(blurP));
      gl.uniform2f(blurP.u.uSize, W, H);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, L.fbo[1]); gl.bindTexture(gl.TEXTURE_2D, L.tex[0]);
      gl.uniform2f(blurP.u.uDir, 1, 0); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, L.fbo[0]); gl.bindTexture(gl.TEXTURE_2D, L.tex[1]);
      gl.uniform2f(blurP.u.uDir, 0, 1); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.enable(gl.BLEND);
      if (flat) {
        outlineOn = true;
        eachCopy(function () {
          use(compFlatP);
          var uf = compFlatP.u;
          gl.bindTexture(gl.TEXTURE_2D, L.tex[0]); gl.uniform1i(uf.uTex, 3);
          gl.uniform2f(uf.uDev, canvas.width, canvas.height); gl.uniform1f(uf.uAlpha, alpha === undefined ? 1 : alpha);
          gl.uniform1f(uf.uDPR, DPR); gl.uniform1f(uf.uHdev, canvas.height);
          gl.uniform1f(uf.uUseMask, maskTex ? 1 : 0);
          if (maskTex) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, maskTex); gl.uniform1i(uf.uMask, 0); gl.activeTexture(gl.TEXTURE3); }
          gl.bindVertexArray(quadFor(compFlatP)); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        });
        current = null;
        return;
      }
      use(compP);
      var u = compP.u, r = view.r;
      gl.bindTexture(gl.TEXTURE_2D, L.tex[0]); gl.uniform1i(u.uTex, 3);
      gl.uniform2f(u.uDev, canvas.width, canvas.height); gl.uniform1f(u.uAlpha, alpha === undefined ? 1 : alpha);
      gl.uniform2f(u.uC, view.cx, view.cy); gl.uniform1f(u.uR, r);
      gl.uniform1f(u.uDPR, DPR); gl.uniform1f(u.uHdev, canvas.height);
      gl.uniform1f(u.uUseMask, maskTex ? 1 : 0);
      if (maskTex) {
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, maskTex); gl.uniform1i(u.uMask, 0);
        gl.uniform3f(u.uEX, view.fx[0] / r, view.fx[1] / r, view.fx[2] / r);
        gl.uniform3f(u.uEY, view.fy[0] / r, view.fy[1] / r, view.fy[2] / r);
        gl.uniform3fv(u.uEZ, view.vz);
        gl.uniform1f(u.uLod, Math.max(0, Math.log2(maskW / (2 * Math.PI * r))));
      }
      gl.bindVertexArray(quadFor(compP)); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      current = null;
    },
    /* Wide lines: a list of polylines of unit vectors, uploaded once. drawWide draws all of them, or only the
       runs of lines given as [first, end) pairs, at a width in screen pixels (under one pixel, fainter instead). */
    wideSet: function (lines) {
      if (!wideP) return null;
      var total = 0, i;
      for (i = 0; i < lines.length; i++) total += lines[i].length / 3 + 1;
      var pts = new Float32Array(total * 3 + 3), start = new Int32Array(lines.length), count = new Int32Array(lines.length), at = 0;
      for (i = 0; i < lines.length; i++) {
        start[i] = at; count[i] = lines[i].length / 3;
        pts.set(lines[i], at * 3); at += count[i] + 1;          /* the zero after it is the separator */
      }
      var L = { vao: gl.createVertexArray(), vb: gl.createBuffer(), start: start, count: count, n: lines.length, pts: at, src: lines, f: null, d: null };
      gl.bindVertexArray(L.vao);
      if (!quadQ) { quadQ = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quadQ); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), gl.STATIC_DRAW); }
      gl.bindBuffer(gl.ARRAY_BUFFER, quadQ);
      var aQ = gl.getAttribLocation(wideP.p, 'aQ');
      gl.enableVertexAttribArray(aQ); gl.vertexAttribPointer(aQ, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, L.vb);
      gl.bufferData(gl.ARRAY_BUFFER, pts, gl.STATIC_DRAW);
      L.aA = gl.getAttribLocation(wideP.p, 'aA'); L.aB = gl.getAttribLocation(wideP.p, 'aB');
      gl.enableVertexAttribArray(L.aA); gl.vertexAttribDivisor(L.aA, 1);
      gl.enableVertexAttribArray(L.aB); gl.vertexAttribDivisor(L.aB, 1);
      gl.bindVertexArray(null);
      return L;
    },
    drawWide: function (L, colour, width, runs, dash) {
      if (!L || !L.n) return;
      if (flat) { drawWideFlat(L, colour, width, runs, dash); return; }
      if (dash && wideDashP) {
        use(wideDashP);
        var cd = colour, wd = width;
        if (wd < 1) { cd = [colour[0], colour[1], colour[2], colour[3] * wd]; wd = 1; }
        gl.uniform4fv(wideDashP.u.uColour, cd); gl.uniform1f(wideDashP.u.uHalf, wd / 2); gl.uniform2f(wideDashP.u.uDash, dash[0], dash[1]);
        dashDraw(globeDash(L), L, runs, [0], wideDashP);
        return;
      }
      use(wideP);
      var c = colour;
      if (width < 1) { c = [colour[0], colour[1], colour[2], colour[3] * width]; width = 1; }
      gl.uniform4fv(wideP.u.uColour, c); gl.uniform1f(wideP.u.uHalf, width / 2);
      gl.bindVertexArray(L.vao); gl.bindBuffer(gl.ARRAY_BUFFER, L.vb);
      var list = runs || [[0, L.n]];
      for (var k = 0; k < list.length; k++) {
        var a = list[k][0], b = list[k][1];
        /* runs that meet are drawn as one */
        while (k + 1 < list.length && list[k + 1][0] === b) b = list[++k][1];
        if (b <= a) continue;
        var first = L.start[a], n = L.start[b - 1] + L.count[b - 1] - 1 - first;
        if (n < 1) continue;
        gl.vertexAttribPointer(L.aA, 3, gl.FLOAT, false, 0, first * 12);
        gl.vertexAttribPointer(L.aB, 3, gl.FLOAT, false, 0, (first + 1) * 12);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
      }
    },
    dropWide: function (L) {
      if (!L) return;
      gl.deleteVertexArray(L.vao); gl.deleteBuffer(L.vb);
      if (L.f) { gl.deleteVertexArray(L.f.vao); gl.deleteBuffer(L.f.vb); if (L.f.cb) gl.deleteBuffer(L.f.cb); if (L.f.d) gl.deleteVertexArray(L.f.d.vao); L.f = null; }
      if (L.d) { gl.deleteVertexArray(L.d.vao); gl.deleteBuffer(L.d.cb); L.d = null; }
    },
    /* Coloured fills for items that do not overlap: a set as set() makes, each ring flagged .hole if it is one;
       then accColours gives each item its colour (RGBA bytes, four per item), and between accBegin and accEnd,
       accFill draws whichever items are listed, all in one call. Without float images the same is done item by
       item through the stencil. */
    accSet: function (items) {
      var S = api.set(items), signs = new Int8Array(S.verts), first = new Int32Array(items.length), cnt = new Int32Array(items.length), at = 0;
      for (var i = 0; i < items.length; i++) {
        first[i] = at;
        for (var r = 0; r < items[i].length; r++) {
          var a = items[i][r], n = a.length / 3;
          if (n < 3) continue;
          var s = (a.hole ? -1 : 1) * ringTurn(a);
          for (var k = 0; k < n; k++) signs[at + k] = s;
          at += n;
        }
        cnt[i] = at - first[i];
      }
      S.first = first; S.cnt = cnt; S.cols = null;
      if (accP) {
        S.vao3 = gl.createVertexArray(); S.sgb = gl.createBuffer(); S.colb = gl.createBuffer(); S.aib = gl.createBuffer();
        gl.bindVertexArray(S.vao3);
        gl.bindBuffer(gl.ARRAY_BUFFER, S.vb);
        var aV = gl.getAttribLocation(accP.p, 'aV'); gl.enableVertexAttribArray(aV); gl.vertexAttribPointer(aV, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, S.sgb); gl.bufferData(gl.ARRAY_BUFFER, signs, gl.STATIC_DRAW);
        var aS = gl.getAttribLocation(accP.p, 'aS'); gl.enableVertexAttribArray(aS); gl.vertexAttribPointer(aS, 1, gl.BYTE, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, S.colb); gl.bufferData(gl.ARRAY_BUFFER, S.verts * 4, gl.STATIC_DRAW);
        var aC = gl.getAttribLocation(accP.p, 'aCol'); gl.enableVertexAttribArray(aC); gl.vertexAttribPointer(aC, 4, gl.UNSIGNED_BYTE, true, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, S.aib);
        gl.bindVertexArray(null);
      }
      return S;
    },
    accColours: function (S, bytes) {
      S.cols = bytes;
      if (S.f && S.f.vao3 && !S.fdirty) flatColours(S.f, bytes);
      if (!S.vao3) return;
      var v = new Uint8Array(S.verts * 4);
      for (var i = 0; i < S.first.length; i++) {
        var c0 = bytes[i * 4], c1 = bytes[i * 4 + 1], c2 = bytes[i * 4 + 2], c3 = bytes[i * 4 + 3];
        for (var k = S.first[i], e = k + S.cnt[i]; k < e; k++) { v[k * 4] = c0; v[k * 4 + 1] = c1; v[k * 4 + 2] = c2; v[k * 4 + 3] = c3; }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, S.colb); gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
    },
    accDrop: function (S) {
      if (!S) return;
      api.drop(S);
      if (S.vao3) { gl.deleteVertexArray(S.vao3); gl.deleteBuffer(S.sgb); gl.deleteBuffer(S.colb); gl.deleteBuffer(S.aib); }
    },
    accBegin: function () {
      accOn = !!(accFmt && (!flat || faccP) && ensureAcc());
      if (!accOn) return false;
      gl.bindFramebuffer(gl.FRAMEBUFFER, acc.msFbo || acc.fbo);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.blendFunc(gl.ONE, gl.ONE);
      current = null;
      return true;
    },
    accFill: function (S, list) {
      var i;
      if (!accOn) {
        if (!S.cols) return;
        for (i = 0; i < list.length; i++) {
          var b = S.cols, j = list[i] * 4;
          api.fill(S, list[i], [b[j] / 255, b[j + 1] / 255, b[j + 2] / 255, b[j + 3] / 255]);
        }
        return;
      }
      /* with several copies of the map, each is summed and laid over on its own at accEnd */
      if (flat && flat.copies.length > 1) { (accQ || (accQ = [])).push([S, list]); return; }
      accDraw(S, list);
    },
    accEnd: function (alpha) {
      if (!accOn) return;
      accOn = false;
      if (accQ) {
        var qs = accQ; accQ = null;
        for (var c = 0; c < flat.copies.length; c++) {
          flat.off = flat.copies[c].off; flat.ref = flat.copies[c].ref; current = null;
          gl.bindFramebuffer(gl.FRAMEBUFFER, acc.msFbo || acc.fbo);
          gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
          gl.blendFunc(gl.ONE, gl.ONE);
          for (var q = 0; q < qs.length; q++) accDraw(qs[q][0], qs[q][1]);
          accCompose(alpha);
        }
        flat.off = 0; flat.ref = 0x80; current = null;
        return;
      }
      accCompose(alpha);
    },
    /* which way the card counts a triangle as facing, set once by the page if its fills come out negative */
    accFlip: function (f) { if (f) accFlip = f; return accFlip; },
    canAcc: function () { return !!accFmt; },
    renderer: function () {
      var d = gl.getExtension('WEBGL_debug_renderer_info');
      return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    }
  };
  /* with several copies of the map, these draw once for each, each clipped to its own outline */
  ['fill', 'lines', 'fillMany', 'linesMany', 'drawLines', 'drawWide', 'ocean', 'veil', 'night', 'fillPattern'].forEach(function (name) {
    var f = api[name];
    if (!f) return;
    api[name] = function () {
      if (!flat || flat.copies.length < 2) return f.apply(api, arguments);
      var a = arguments;
      eachCopy(function () { f.apply(api, a); });
    };
  });
  return api;
}

/* a d3 path context that collects what d3 draws (clipped at the limb) as rings of screen points */
function ringCollector() {
  var rings = [], cur = null;
  return {
    rings: rings,
    reset: function () { rings.length = 0; cur = null; },
    moveTo: function (x, y) { cur = [x, y]; rings.push(cur); },
    lineTo: function (x, y) { if (cur) cur.push(x, y); },
    closePath: function () { if (cur && cur.length >= 4) cur.push(cur[0], cur[1]); cur = null; },
    arc: function () {}
  };
}

/* a GeoJSON geometry (or feature) as rings or polylines of unit vectors, for set() and lineSet() */
function toXYZ(g) {
  g = g && g.geometry ? g.geometry : g;
  var out = [], D = Math.PI / 180;
  function add(r) {
    var a = new Float32Array(r.length * 3);
    for (var i = 0; i < r.length; i++) {
      var l = r[i][0] * D, p = r[i][1] * D, c = Math.cos(p);
      a[i * 3] = c * Math.cos(l); a[i * 3 + 1] = c * Math.sin(l); a[i * 3 + 2] = Math.sin(p);
    }
    out.push(a);
  }
  if (!g) return out;
  var c = g.coordinates, i, j;
  if (g.type === 'Polygon' || g.type === 'MultiLineString') for (i = 0; i < c.length; i++) add(c[i]);
  else if (g.type === 'MultiPolygon') for (i = 0; i < c.length; i++) for (j = 0; j < c[i].length; j++) add(c[i][j]);
  else if (g.type === 'LineString') add(c);
  return out;
}

/* CSS colour to premultiply-ready floats */
function rgba(s) {
  var c = d3.rgb(s);
  return [c.r / 255, c.g / 255, c.b / 255, c.opacity == null ? 1 : c.opacity];
}

/* the flat projections on the processor, d3's own arithmetic. flatRaw: unit coordinates (x east, y north) of a
   longitude relative to the central meridian and a latitude, both in radians. flatProject / flatInvert take the
   same object as frameFlat (degrees in, pixels out; flatInvert returns null off the map). */
var FA = { A1: 1.340264, A2: -0.081106, A3: 0.000893, A4: 0.003796, M: Math.sqrt(3) / 2 };
function flatRaw(kind, lam, phi, lim) {
  if (kind === 0) {
    var th = Math.asin(FA.M * Math.sin(phi)), t2 = th * th, t6 = t2 * t2 * t2;
    return [lam * Math.cos(th) / (FA.M * (FA.A1 + 3 * FA.A2 * t2 + t6 * (7 * FA.A3 + 9 * FA.A4 * t2))), th * (FA.A1 + FA.A2 * t2 + t6 * (FA.A3 + FA.A4 * t2))];
  }
  if (kind === 1) return [lam, Math.log(Math.tan(Math.PI / 4 + Math.max(-lim, Math.min(lim, phi)) / 2))];
  if (kind === 3) return [lam * lim, Math.sin(phi) / lim];
  return [lam, phi];
}
function flatInvRaw(kind, x, y, lim) {
  if (kind === 0) {
    var t = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, y / 1.26)), t2, t6;
    for (var i = 0; i < 12; i++) {
      t2 = t * t; t6 = t2 * t2 * t2;
      t -= (t * (FA.A1 + FA.A2 * t2 + t6 * (FA.A3 + FA.A4 * t2)) - y) / (FA.A1 + 3 * FA.A2 * t2 + t6 * (7 * FA.A3 + 9 * FA.A4 * t2));
    }
    t = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, t)); t2 = t * t; t6 = t2 * t2 * t2;
    return [x * FA.M * (FA.A1 + 3 * FA.A2 * t2 + t6 * (7 * FA.A3 + 9 * FA.A4 * t2)) / Math.cos(t), Math.asin(Math.max(-1, Math.min(1, Math.sin(t) / FA.M)))];
  }
  if (kind === 1) return [x, 2 * Math.atan(Math.exp(y)) - Math.PI / 2];
  if (kind === 3) return [x / lim, Math.asin(Math.max(-1, Math.min(1, y * lim)))];
  return [x, y];
}
function flatKind(p) { return p.kind === 'mercator' ? 1 : (p.kind === 'equirectangular' || p.kind === 'equirect') ? 2 : p.kind === 'cylindricalEqualArea' ? 3 : 0; }
/* the fourth number of flatRaw: Mercator's latitude clamp, or for the cylindrical equal-area the cosine of its standard parallel */
function flatLim(p, kd) {
  if (kd === 3) return Math.cos((p.parallel == null ? 30 : p.parallel) * Math.PI / 180);
  return (p.latClamp == null ? 85 : p.latClamp) * Math.PI / 180;
}
function flatWidth(kind, scale, parallel) {
  var p = { kind: kind, parallel: parallel }, kd = flatKind(p);
  return 2 * flatRaw(kd, Math.PI, 0, flatLim(p, kd))[0] * scale;
}
/* d3.geoProjection for the cylindrical equal-area with the given standard parallel (degrees, default 30) */
function d3CylindricalEqualArea(parallel) {
  var c = Math.cos((parallel == null ? 30 : parallel) * Math.PI / 180);
  function raw(lam, phi) { return [lam * c, Math.sin(phi) / c]; }
  raw.invert = function (x, y) { return [x / c, Math.asin(Math.max(-1, Math.min(1, y * c)))]; };
  return d3.geoProjection(raw);
}
function flatProject(p, lon, lat) {
  var D = Math.PI / 180, kd = flatKind(p), lim = flatLim(p, kd);
  var lam = (lon - p.centreLon) * D;
  lam -= 2 * Math.PI * Math.round(lam / (2 * Math.PI));
  var q = flatRaw(kd, lam, lat * D, lim);
  return [p.tx + p.scale * q[0], p.ty - p.scale * q[1]];
}
/* x folded into the central copy of a repeated map: use it before flatInvert or d3's invert */
function flatFold(p, x) {
  var kd = flatKind(p), lim = flatLim(p, kd), xw = 2 * flatRaw(kd, Math.PI, 0, lim)[0] * p.scale;
  return x - xw * Math.round((x - p.tx) / xw);
}
function flatInvert(p, x, y) {
  var D = Math.PI / 180, kd = flatKind(p), lim = flatLim(p, kd);
  if (p.repeat) x = flatFold(p, x);
  var ux = (x - p.tx) / p.scale, uy = (p.ty - y) / p.scale;
  var ymax = flatRaw(kd, 0, Math.PI / 2, lim)[1];
  if (Math.abs(uy) > ymax) return null;
  var q = flatInvRaw(kd, ux, uy, lim);
  if (Math.abs(q[0]) > Math.PI) return null;
  return [q[0] / D + p.centreLon, q[1] / D];
}

window.GlobeGL = { create: create, ringCollector: ringCollector, rgba: rgba, toXYZ: toXYZ, flatProject: flatProject, flatInvert: flatInvert, flatFold: flatFold, flatWidth: flatWidth, d3CylindricalEqualArea: d3CylindricalEqualArea };
})();

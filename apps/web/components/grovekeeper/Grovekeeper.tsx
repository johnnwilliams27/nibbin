/**
 * The Grovekeeper — the canonical hero mascot, as a self-contained animated SVG.
 *
 * Pure markup + CSS (no client JS), so it renders on the server. The idle loop
 * (breathe / blink / leaf-sway / lantern-swing + glow) lives in an inline
 * <style> and is disabled under prefers-reduced-motion. All gradient/filter ids
 * are `gk`-prefixed so they never clash with the procedural creature engine's
 * output on the same page.
 *
 * Source of truth for the art: reference/grovekeeper-explore.html.
 * NOTE: this animated SVG won't render in email — emails use a static PNG.
 */
const SVG = `<svg viewBox="0 0 420 500" role="img" aria-label="The Grovekeeper" style="width:100%;height:auto;display:block;overflow:visible" xmlns="http://www.w3.org/2000/svg">
<style>
.gk-bob{animation:gkBob 3.8s ease-in-out infinite}
@keyframes gkBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
.gk-leaves{transform-box:fill-box;transform-origin:bottom center;animation:gkSway 4.2s ease-in-out infinite}
@keyframes gkSway{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}}
.gk-lantern{transform-box:fill-box;transform-origin:top center;animation:gkSwing 3s ease-in-out infinite}
@keyframes gkSwing{0%,100%{transform:rotate(-5deg)}50%{transform:rotate(5deg)}}
.gk-glow{transform-box:fill-box;transform-origin:center;animation:gkPulse 2.4s ease-in-out infinite}
@keyframes gkPulse{0%,100%{opacity:.45;transform:scale(.9)}50%{opacity:.9;transform:scale(1.12)}}
.gk-eyes{transform-box:fill-box;transform-origin:center;animation:gkBlink 5s infinite}
@keyframes gkBlink{0%,93%,100%{transform:scaleY(1)}96.5%{transform:scaleY(.08)}}
@media (prefers-reduced-motion:reduce){.gk-bob,.gk-leaves,.gk-lantern,.gk-glow,.gk-eyes{animation:none}}
</style>
<defs>
<radialGradient id="gkBody" cx="40%" cy="28%" r="86%"><stop offset="0%" stop-color="#9CC663"/><stop offset="60%" stop-color="#688E33"/><stop offset="100%" stop-color="#537526"/></radialGradient>
<linearGradient id="gkLeafA" x1="0" y1="0" x2="0.5" y2="1"><stop offset="0%" stop-color="#BEDD84"/><stop offset="100%" stop-color="#5C8A2C"/></linearGradient>
<linearGradient id="gkLeafB" x1="0" y1="0" x2="0.5" y2="1"><stop offset="0%" stop-color="#A7CD6C"/><stop offset="100%" stop-color="#517D27"/></linearGradient>
<linearGradient id="gkNut" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0%" stop-color="#E6B271"/><stop offset="100%" stop-color="#B3753A"/></linearGradient>
<linearGradient id="gkCap" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0%" stop-color="#A2703B"/><stop offset="100%" stop-color="#674222"/></linearGradient>
<linearGradient id="gkWood" x1="0" y1="0" x2="1" y2="0.2"><stop offset="0%" stop-color="#A06840"/><stop offset="45%" stop-color="#7A5230"/><stop offset="100%" stop-color="#5C3D22"/></linearGradient>
<linearGradient id="gkLeather" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#B5824A"/><stop offset="100%" stop-color="#82592F"/></linearGradient>
<linearGradient id="gkFlap" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#C8945A"/><stop offset="100%" stop-color="#A06D3C"/></linearGradient>
<linearGradient id="gkBrass" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#F1CE73"/><stop offset="50%" stop-color="#C8941F"/><stop offset="100%" stop-color="#9C6B0C"/></linearGradient>
<radialGradient id="gkGlass" cx="50%" cy="38%" r="65%"><stop offset="0%" stop-color="#FFF9DA"/><stop offset="52%" stop-color="#F6CC4E"/><stop offset="100%" stop-color="#D99E1A"/></radialGradient>
<radialGradient id="gkGlow" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#FFE48C" stop-opacity=".95"/><stop offset="100%" stop-color="#FFD24A" stop-opacity="0"/></radialGradient>
<radialGradient id="gkPupil" cx="42%" cy="35%" r="75%"><stop offset="0%" stop-color="#3B3930"/><stop offset="100%" stop-color="#191711"/></radialGradient>
<radialGradient id="gkWhite" cx="50%" cy="34%" r="72%"><stop offset="0%" stop-color="#FFFFFF"/><stop offset="100%" stop-color="#E7EEDC"/></radialGradient>
<radialGradient id="gkCheek" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#E88E76" stop-opacity=".55"/><stop offset="100%" stop-color="#E88E76" stop-opacity="0"/></radialGradient>
<filter id="gkBlurSm" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2.6"/></filter>
<filter id="gkBlurMd" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="5.5"/></filter>
<filter id="gkBlurLg" x="-120%" y="-120%" width="340%" height="340%"><feGaussianBlur stdDeviation="10"/></filter>
<filter id="gkGrain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .5 0"/></filter>
<clipPath id="gkBodyClip"><path d="M205 150 C156 150 120 190 118 246 C116 298 122 354 150 386 C176 410 234 410 260 386 C288 354 294 298 292 246 C290 190 254 150 205 150 Z"/></clipPath>
</defs>
<ellipse cx="210" cy="458" rx="104" ry="15" fill="#23291A" opacity=".16" filter="url(#gkBlurMd)"/>
<g class="gk-bob">
<ellipse cx="178" cy="405" rx="22" ry="14" fill="#415A1A"/>
<ellipse cx="236" cy="405" rx="22" ry="14" fill="#415A1A"/>
<ellipse cx="174" cy="401" rx="14" ry="7" fill="#5E8330" opacity=".7"/>
<ellipse cx="232" cy="401" rx="14" ry="7" fill="#5E8330" opacity=".7"/>
<ellipse cx="300" cy="296" rx="26" ry="30" fill="#2E4714" opacity=".35" filter="url(#gkBlurMd)"/>
<path d="M205 150 C156 150 120 190 118 246 C116 298 122 354 150 386 C176 410 234 410 260 386 C288 354 294 298 292 246 C290 190 254 150 205 150 Z" fill="url(#gkBody)" stroke="#3C541C" stroke-width="2.4"/>
<g clip-path="url(#gkBodyClip)">
<ellipse cx="262" cy="344" rx="116" ry="150" fill="#3B5A16" opacity=".17" filter="url(#gkBlurLg)"/>
<ellipse cx="188" cy="320" rx="74" ry="84" fill="#CFE79C" opacity=".5" filter="url(#gkBlurMd)"/>
<path d="M152 166 C128 186 119 214 118 246" fill="none" stroke="#E5F2C6" stroke-width="9" stroke-linecap="round" opacity=".5" filter="url(#gkBlurSm)"/>
<ellipse cx="205" cy="166" rx="46" ry="16" fill="#2C4413" opacity=".3" filter="url(#gkBlurMd)"/>
<rect x="110" y="140" width="200" height="280" filter="url(#gkGrain)" opacity=".05" style="mix-blend-mode:multiply"/>
</g>
<g class="gk-leaves">
<g opacity=".25" filter="url(#gkBlurSm)"><path d="M205 122 C187 100 187 62 207 46 C223 64 223 102 207 124 Z" fill="#2C4413" transform="translate(3 4)"/></g>
<g transform="rotate(-33 205 120)"><path d="M205 120 C189 100 189 66 205 50 C221 66 221 100 205 120 Z" fill="url(#gkLeafB)" stroke="#46651F" stroke-width="1.6"/><path d="M205 113 L205 60" stroke="#3F5C1C" stroke-width="1.4" opacity=".45"/><path d="M201 96 C199 86 200 74 204 64" stroke="#D6E9AC" stroke-width="1.6" opacity=".5" fill="none"/></g>
<g transform="rotate(33 205 120)"><path d="M205 120 C189 100 189 66 205 50 C221 66 221 100 205 120 Z" fill="url(#gkLeafB)" stroke="#46651F" stroke-width="1.6"/><path d="M205 113 L205 60" stroke="#3F5C1C" stroke-width="1.4" opacity=".45"/></g>
<g><path d="M205 122 C187 100 187 62 205 44 C223 62 223 100 205 122 Z" fill="url(#gkLeafA)" stroke="#46651F" stroke-width="1.6"/><path d="M205 114 L205 54" stroke="#3F5C1C" stroke-width="1.4" opacity=".45"/><path d="M200 98 C198 84 199 70 204 56" stroke="#E2F0C2" stroke-width="2" opacity=".55" fill="none"/></g>
</g>
<path d="M186 126 C186 120 224 120 224 126 C224 146 214 164 205 164 C196 164 186 146 186 126 Z" fill="url(#gkNut)" stroke="#7E5329" stroke-width="2"/>
<ellipse cx="197" cy="138" rx="6" ry="9" fill="#F4D2A0" opacity=".5" filter="url(#gkBlurSm)"/>
<path d="M181 127 C181 115 229 115 229 127 C229 134 219 138 205 138 C191 138 181 134 181 127 Z" fill="url(#gkCap)" stroke="#5E3D20" stroke-width="1.4"/>
<path d="M190 122 l4 8 M205 120 l0 9 M220 122 l-4 8" fill="none" stroke="#5E3D20" stroke-width="1.2" opacity=".5"/>
<path d="M184 120 C195 116 215 116 226 120" stroke="#C79A5E" stroke-width="1.4" opacity=".5" fill="none"/>
<rect x="201" y="106" width="8" height="11" rx="4" fill="#5E3D20"/>
<g class="gk-eyes">
<ellipse cx="174" cy="236" rx="30" ry="33" fill="url(#gkWhite)" stroke="#3C541C" stroke-width="2.2"/>
<ellipse cx="240" cy="236" rx="30" ry="33" fill="url(#gkWhite)" stroke="#3C541C" stroke-width="2.2"/>
<path d="M147 220 C152 210 166 207 178 211" stroke="#C9D3BC" stroke-width="3" fill="none" opacity=".5"/>
<path d="M213 220 C218 210 232 207 244 211" stroke="#C9D3BC" stroke-width="3" fill="none" opacity=".5"/>
<circle cx="181" cy="242" r="18.5" fill="url(#gkPupil)"/>
<circle cx="233" cy="242" r="18.5" fill="url(#gkPupil)"/>
<circle cx="174" cy="234" r="6.5" fill="#fff"/>
<circle cx="226" cy="234" r="6.5" fill="#fff"/>
<circle cx="188" cy="250" r="3" fill="#fff" opacity=".85"/>
<circle cx="240" cy="250" r="3" fill="#fff" opacity=".85"/>
<circle cx="186" cy="251" r="4" fill="#7AA23E" opacity=".4"/>
<circle cx="238" cy="251" r="4" fill="#7AA23E" opacity=".4"/>
</g>
<ellipse cx="138" cy="274" rx="16" ry="11" fill="url(#gkCheek)"/>
<ellipse cx="276" cy="274" rx="16" ry="11" fill="url(#gkCheek)"/>
<path d="M192 277 Q207 293 222 277" fill="none" stroke="#30301C" stroke-width="5" stroke-linecap="round"/>
<path d="M196 282 Q207 289 218 282" fill="none" stroke="#C98E78" stroke-width="2.4" stroke-linecap="round" opacity=".5"/>
<ellipse cx="176" cy="372" rx="40" ry="14" fill="#2C4413" opacity=".28" filter="url(#gkBlurMd)"/>
<path d="M160 352 C152 328 206 300 292 290" fill="none" stroke="url(#gkLeather)" stroke-width="10" stroke-linecap="round"/>
<path d="M160 350 C154 330 204 302 290 292" fill="none" stroke="#D2A36A" stroke-width="2" stroke-linecap="round" opacity=".4"/>
<rect x="144" y="344" width="64" height="46" rx="11" fill="url(#gkLeather)" stroke="#5E3C20" stroke-width="2"/>
<path d="M140 346 C140 341 212 341 212 346 L212 363 C212 370 140 370 140 363 Z" fill="url(#gkFlap)" stroke="#5E3C20" stroke-width="1.8"/>
<path d="M140 348 C140 344 212 344 212 348" stroke="#E6C390" stroke-width="1.4" opacity=".5" fill="none"/>
<path d="M144 360 C144 356 208 356 208 360" stroke="#5E3C20" stroke-width="1.2" stroke-dasharray="3 3" opacity=".4" fill="none"/>
<rect x="171" y="362" width="10" height="8" rx="2" fill="#5E3C20"/>
<path d="M176 347 l3.2 6.5 7.2 .5 -5.4 4.8 1.7 7 -6.7 -3.8 -6.7 3.8 1.7 -7 -5.4 -4.8 7.2 -.5 Z" fill="#F6D45F" stroke="#B98F1F" stroke-width="1.1"/>
<path d="M122 303 C110 318 108 335 119 344 C129 351 144 350 154 345" fill="none" stroke="#3C541C" stroke-width="21" stroke-linecap="round"/>
<path d="M122 303 C110 318 108 335 119 344 C129 351 144 350 154 345" fill="none" stroke="#6A9636" stroke-width="17" stroke-linecap="round"/>
<path d="M119 312 C111 324 110 335 117 342" fill="none" stroke="#A6CD6C" stroke-width="3" stroke-linecap="round" opacity=".4"/>
<ellipse cx="155" cy="346" rx="14" ry="12.5" fill="#6A9636" stroke="#3C541C" stroke-width="2.4"/>
<path d="M288 303 C302 304 314 321 308 341" fill="none" stroke="#3C541C" stroke-width="21" stroke-linecap="round"/>
<path d="M288 303 C302 304 314 321 308 341" fill="none" stroke="#5F8A2E" stroke-width="17" stroke-linecap="round"/>
<ellipse cx="308" cy="343" rx="15" ry="13" fill="#5F8A2E" stroke="#3C541C" stroke-width="2.4" transform="rotate(14 308 343)"/>
<ellipse cx="303" cy="339" rx="6" ry="5" fill="#9CC25B" opacity=".4"/>
<g transform="translate(-12,0)">
<path d="M320 410 C318 332 324 250 322 184 C321 163 335 150 349 154 C362 158 366 172 357 182" fill="none" stroke="url(#gkWood)" stroke-width="10" stroke-linecap="round"/>
<path d="M315 405 C313 332 319 250 318 186" fill="none" stroke="#F0D7A8" stroke-width="2" stroke-linecap="round" opacity=".35"/>
<path d="M324 400 C322 330 327 250 325 188" fill="none" stroke="#4A2F18" stroke-width="2" stroke-linecap="round" opacity=".4"/>
</g>
<path d="M299 351 C296 345 299 338 306 337 C312 337 314 345 311 349 C308 354 302 355 299 351 Z" fill="#5F8A2E" stroke="#3C541C" stroke-width="2.2"/>
<ellipse cx="304" cy="343" rx="3" ry="2.2" fill="#9CC25B" opacity=".4"/>
<g class="gk-lantern">
<circle class="gk-glow" cx="338" cy="214" r="42" fill="url(#gkGlow)"/>
<path d="M338 168 a7 7 0 0 1 0 14" fill="none" stroke="#8A5F0C" stroke-width="2.6"/>
<line x1="338" y1="182" x2="338" y2="190" stroke="#8A5F0C" stroke-width="2.4"/>
<path d="M326 190 L350 190 L346 197 L330 197 Z" fill="url(#gkBrass)" stroke="#7C5408" stroke-width="1.4"/>
<rect x="321" y="197" width="34" height="40" rx="6" fill="url(#gkGlass)" stroke="#7C5408" stroke-width="2.4"/>
<rect x="324" y="200" width="9" height="34" rx="4" fill="#FFF7D2" opacity=".35"/>
<line x1="338" y1="197" x2="338" y2="237" stroke="#9C6B0C" stroke-width="1.4" opacity=".45"/>
<line x1="321" y1="216" x2="355" y2="216" stroke="#9C6B0C" stroke-width="1.2" opacity=".4"/>
<circle cx="338" cy="216" r="7" fill="#FFF7CE"/>
<path d="M328 237 L348 237 L344 244 L332 244 Z" fill="url(#gkBrass)" stroke="#7C5408" stroke-width="1.4"/>
<rect x="334" y="244" width="8" height="5" rx="2" fill="#9C6B0C"/>
</g>
</g>
</svg>`;

export interface GrovekeeperProps {
  /** Rendered width in px (height follows the 420:500 aspect). */
  size?: number;
  className?: string;
}

export function Grovekeeper({ size = 220, className }: GrovekeeperProps) {
  return (
    <span
      className={className}
      style={{ display: 'inline-block', width: size, lineHeight: 0 }}
      dangerouslySetInnerHTML={{ __html: SVG }}
    />
  );
}

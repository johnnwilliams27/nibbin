/**
 * Idle/blink/sway animations for creature renders. Include once per surface.
 * Reduced-motion: creatures go static but stay fully visible (design-system rule).
 */
export const creatureCss = `
svg.cr{display:inline-block;animation:nib-bob 3.6s ease-in-out infinite;}
svg.cr.eggy{animation:nib-wob 4.2s ease-in-out infinite;transform-origin:50% 88%;}
svg.cr.floaty{animation:nib-floaty 4s ease-in-out infinite;}
@keyframes nib-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
@keyframes nib-floaty{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
@keyframes nib-wob{0%,100%{transform:rotate(0)}30%{transform:rotate(-3deg)}70%{transform:rotate(2.6deg)}}
svg.cr .lid{transform-box:fill-box;transform-origin:center;transform:scaleY(0);animation:nib-blink 5.5s infinite;}
@keyframes nib-blink{0%,93%,100%{transform:scaleY(0)}95.5%,97%{transform:scaleY(1)}}
svg.cr .tassel{transform-box:fill-box;transform-origin:top center;animation:nib-sway 3.6s ease-in-out infinite;}
@keyframes nib-sway{0%,100%{transform:rotate(0)}50%{transform:rotate(8deg)}}
svg.cr .glowpulse{animation:nib-glow 2.8s ease-in-out infinite;}
@keyframes nib-glow{0%,100%{opacity:.18}50%{opacity:.4}}
@media (prefers-reduced-motion: reduce){
  svg.cr,svg.cr.eggy,svg.cr.floaty,svg.cr .lid,svg.cr .tassel,svg.cr .glowpulse{animation:none!important;}
  svg.cr .lid{transform:scaleY(0);}
  svg.cr .glowpulse{opacity:.3;}
}
`;

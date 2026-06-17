/**
 * Idle animations for creature renders. Include once per surface (web/grove —
 * NOT email, which uses static PNG rasters). Each is a slow, low-amplitude idle
 * loop; under prefers-reduced-motion every creature goes fully static but stays
 * visible (design-system rule).
 *
 * Class hooks (emitted by the engine): the <svg> carries `cr` / `cr eggy` /
 * `cr floaty` (whole-body motion); inside, `.blink` (eye group), `.tassel`
 * (grad cord), `.glowpulse` (Wisp flame glow / Glim abdomen glow), `.flicker`
 * (Wisp flame), `.flutter` (Puff/Glim wings), `.sway` (Sprout sprig/flower,
 * Longear ears), `.lid` (legacy Keeper eyelid).
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
svg.cr .blink{transform-box:fill-box;transform-origin:center;animation:nib-eyeblink 5.2s infinite;}
@keyframes nib-eyeblink{0%,92%,100%{transform:scaleY(1)}96%{transform:scaleY(.1)}}
svg.cr .tassel{transform-box:fill-box;transform-origin:top center;animation:nib-sway 3.6s ease-in-out infinite;}
@keyframes nib-sway{0%,100%{transform:rotate(0)}50%{transform:rotate(8deg)}}
svg.cr .sway{transform-box:fill-box;transform-origin:bottom center;animation:nib-featuresway 4.6s ease-in-out infinite;}
@keyframes nib-featuresway{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}}
svg.cr .flicker{transform-box:fill-box;transform-origin:bottom center;animation:nib-flicker 2.2s ease-in-out infinite;}
@keyframes nib-flicker{0%,100%{transform:scaleY(1) scaleX(1)}50%{transform:scaleY(1.07) scaleX(.96)}}
svg.cr .flutter{transform-box:fill-box;transform-origin:center;animation:nib-flutter 1.8s ease-in-out infinite;}
@keyframes nib-flutter{0%,100%{transform:scaleY(1)}50%{transform:scaleY(.93)}}
svg.cr .glowpulse{animation:nib-glow 2.8s ease-in-out infinite;}
@keyframes nib-glow{0%,100%{opacity:.18}50%{opacity:.4}}
@media (prefers-reduced-motion: reduce){
  svg.cr,svg.cr.eggy,svg.cr.floaty,svg.cr .lid,svg.cr .blink,svg.cr .tassel,svg.cr .sway,svg.cr .flicker,svg.cr .flutter,svg.cr .glowpulse{animation:none!important;}
  svg.cr .lid{transform:scaleY(0);}
  svg.cr .blink{transform:scaleY(1);}
  svg.cr .glowpulse{opacity:.3;}
}
`;
